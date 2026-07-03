---
spec: SPEC-103
title: Pane live view stream (attach/detach·폴링·프레임)
status: approved
updated: 2026-07-03
requirements: [R-API-006, R-PRIV-008, R-UI-012]
decisions: [D-041, D-042, D-044, D-045, D-005]
tags:
  - specs
  - realtime
  - websocket
  - terminal
  - live-view
  - backend
  - epic-2
---

# SPEC-103 — Pane live view stream (attach/detach·폴링·프레임)

Terminal Workspace([[18-Terminal-Workspace]] §4 Phase 1)는 사용자가 **보고 있는 pane 1개**를 준실시간(sub-second)으로 갱신하는 **live pane view 채널**을 요구한다([[02-Requirements]] R-API-006, R-UI-012). 이 채널은 [[SPEC-102-realtime-sync]]의 스냅샷 diff 스트림과 **독립된 별도 논리 채널**이며, scanner 루프(1–5s)와 무관하게 focused pane만 고빈도(가설 250–500ms) `capture-pane`으로 읽어 **redacted 프레임**을 push한다.

본 spec은 그 **live view 채널의 프로토콜·프레임 스키마·폴링 정책·부하 한도·노출/redaction 경계의 SSOT**다:

- client가 pane에 붙고 떼는 **attach/detach 프로토콜**(client→server 프레임)과 그에 응답하는 **server→client 프레임 스키마**(`pane_view_seed`/`pane_view`/`pane_view_end`).
- 폴링 정책과 **부하 한도**(연결당 동시 attach 1, exposure/탭/attach 게이트, 즉시 중단) — [[08-Decisions|D-041]].
- 프레임이 실어 나르는 텍스트의 **redaction 경계**(전 프레임 redacted-only, [[SPEC-006-privacy-redaction]] `sanitizeCapture` chokepoint 재사용) — [[08-Decisions|D-042]], R-PRIV-008.
- **스크롤백 seed + 커서 + 화면 재현 한계**(capture-pane 기반) — [[08-Decisions|D-045]].
- **exposure gate**(글로벌 노출 설정 + per-attach focus) — [[08-Decisions|D-044]].
- Phase 2 **control-mode 확장** 노트(forward) — [[08-Decisions|D-041]] (c).

> **소유 경계**: 본 spec은 **live view 채널의 프로토콜·프레임 의미·폴링/부하 정책·seed/cursor 계약**을 소유한다. **WS 전송 봉투(`WsEnvelope`)·연결/handshake/auth·close code·프레임 카탈로그 등록**은 [[SPEC-102-realtime-sync]], **redaction 카탈로그·`sanitizeCapture`/`redact` chokepoint·ANSI stream redaction·read-only allowlist**는 [[SPEC-006-privacy-redaction]], **snapshot `version` 생성·스냅샷 diff·`GET /api/orcs/:orcId/preview` exposure gate 값**은 [[SPEC-101-snapshot-api]], **orc/pane identity(`orcId = "pane:" + paneId`, [[08-Decisions|D-017]])**는 [[SPEC-005-data-contract]], **터미널 화면/레이아웃·xterm.js 통합·스위칭 UX**는 [[SPEC-203-terminal-workspace]], **키보드 passthrough(write 경로)**는 [[SPEC-401-interactive-input]]가 소유한다. 본 spec은 이들을 참조만 한다.

> **불변식(확정)**: ① live view는 **read-only**다 — 프레임 생성은 [[SPEC-006-privacy-redaction]] §2.6 `tmuxExec` READONLY_ALLOWLIST(`capture-pane`/`list-panes`) 안에서만 수행하고 **새 write 경로를 만들지 않는다**([[08-Decisions|D-019]]/[[08-Decisions|D-041]]). ② 모든 emit 프레임의 텍스트는 [[SPEC-006-privacy-redaction]] `sanitizeCapture` **단일 chokepoint를 통과한 redacted 값만** 싣는다(redaction-before-egress, PF-05 정식화 — [[08-Decisions|D-016]]/[[08-Decisions|D-042]], R-PRIV-008). ③ live view 프레임은 스냅샷 `version`을 쓰지 않는다 — `WsEnvelope.version = null`이고, attach 내 ordering은 **per-attach `viewSeq`**로 판단한다(스냅샷 재조립/gap/resync와 무관 — [[SPEC-102-realtime-sync]] 소유). ④ 폴링은 **exposure on + 탭 활성 + attach 유지** 3조건이 동시에 참일 때만 수행하고, 하나라도 깨지면 **즉시 중단**한다([[08-Decisions|D-041]]/[[08-Decisions|D-044]]). ⑤ 연결당 **동시 attach는 최대 1 pane**이다(MVP, [[08-Decisions|D-041]]).

## 1. Scope

### In scope

- client→server **attach/detach 프레임**(`view.attach`/`view.detach`)의 계약과 상태 전이(§2.2).
- server→client **live view 프레임**(`pane_view_seed`/`pane_view`/`pane_view_end`)의 스키마·의미·`viewSeq` ordering(§2.3, §2.4).
- **폴링 정책·부하 한도**: `PANE_VIEW_INTERVAL_MS`, 연결당 attach 1, exposure/탭/attach 게이트, 즉시 중단, supersede 규칙(§3.1–§3.3, [[08-Decisions|D-041]]).
- **redaction 경계**: 전 프레임 redacted-only, Phase 1 plain capture, Phase 1.5 styled 게이트(§3.4, [[08-Decisions|D-042]], R-PRIV-008 — 메커니즘은 [[SPEC-006-privacy-redaction]] 소유).
- **exposure gate**: 글로벌 노출 상속 + per-attach focus, exposure-off attach 거부(§3.5, [[08-Decisions|D-044]]).
- **seed/cursor/화면 재현 계약과 그 한계**(capture-pane 기반, §2.5, §3.6, [[08-Decisions|D-045]]).
- **read-only 강제**: capture/cursor/geometry 모두 READONLY_ALLOWLIST 명령으로만 수집(§2.5, §3.7).
- Phase 2 control-mode 확장의 **forward 계약 노트**(§6, [[08-Decisions|D-041]] (c)).

### Out of scope (다른 spec으로)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| `WsEnvelope`(`type`/`seq`/`version`/`emittedAt`/`payload`)·WS handshake·auth·close code·프레임 타입 카탈로그 등록 | WS 전송 계약 | [[SPEC-102-realtime-sync]] |
| redaction 패턴 카탈로그·`sanitizeCapture`/`redact`·ANSI stream redaction·`tmuxExec` allowlist 정의 | privacy·read-only 메커니즘 | [[SPEC-006-privacy-redaction]] |
| 스냅샷 `version` 생성·스냅샷 diff·`GET /api/orcs/:orcId/preview` exposure gate 값·저장 | snapshot runtime | [[SPEC-101-snapshot-api]] |
| exposure 설정의 **저장/토글 UI·값** | 설정 영속화·화면 | [[SPEC-500-settings-persistence]], [[SPEC-201-dashboard-screens]] |
| xterm.js 렌더·orc rail·스위칭 단축키·관전/조종 상태 표시·접근성 | terminal workspace UX | [[SPEC-203-terminal-workspace]] |
| 키보드 passthrough·arm/disarm·send-keys write 경로 | interactive input(write) | [[SPEC-401-interactive-input]] |
| Phase 2 `tmux -C` control-mode 브리지 상세 계약 | 후속 슬라이스(본 spec은 forward 노트만) | 후속 SPEC-1xx ([[08-Decisions|D-041]] (c)) |

## 2. Contract

### 2.1 채널 개요

- live view는 **기존 WS `/api/events` 위의 별도 논리 채널**이다. 새 endpoint·새 socket을 만들지 않는다. 연결/handshake/auth/close code는 [[SPEC-102-realtime-sync]] §2.1을 그대로 따른다(startup token 필요).
- 모든 프레임은 [[SPEC-102-realtime-sync]] §2.2 `WsEnvelope`로 감싼다. live view 프레임은 스냅샷 sequence와 무관하므로 **`WsEnvelope.version = null`**이다. **`WsEnvelope.seq` 예외(확정, 2026-07-02 리뷰 반영, [[08-Decisions|D-041]])**: live view 프레임(`pane_view_seed`/`pane_view`/`pane_view_end`)은 [[SPEC-102-realtime-sync]] 연결 `seq` sequence에 **참여하지 않는다** — seq를 증가시키지 않고(직전 state seq 반복) client의 [[SPEC-102-realtime-sync]] §3.5-2 seq-gap 검사에서 **제외**된다. 따라서 고빈도 `pane_view` 유실/coalesce는 state 채널 re-snapshot resync를 트리거하지 않는다. attach 스트림 내부의 순서·중복 판정은 오직 payload의 **`viewSeq`**로 한다(§2.4).
- 채널은 **가입형(attach)**이다. server는 client가 명시적으로 `view.attach`하기 전에는 어떤 live view 프레임도 보내지 않는다.

### 2.2 client→server 프레임 (attach/detach)

[[SPEC-102-realtime-sync]] §2.3 `WsFrameType`에 **client→server** 멤버 `view.attach`/`view.detach`를 추가한다(카탈로그 등록은 SPEC-102 §2.3 개정 소유). `WsEnvelope.version`은 client→server이므로 `null`이다.

```ts
interface ViewAttachPayload {
  orcId: string;   // "pane:" + paneId ([[08-Decisions|D-017]], [[SPEC-005-data-contract]])
}
interface ViewDetachPayload {
  orcId: string;   // 현재 attach 중인 orcId (불일치 시 §3.3-4 no-op)
}
```

- **`view.attach {orcId}`**: 지정 pane의 live view를 시작한다. server는 게이트(§3.5)를 통과하면 **`pane_view_seed`를 정확히 1회** 보낸 뒤 폴링 스트림(`pane_view`)을 시작한다. 거부되면 seed 없이 **`pane_view_end`**(reason=`exposure_off`/`pane_gone`/`error`)를 보낸다.
- **`view.detach {orcId}`**: live view를 중단한다. server는 폴링을 즉시 멈추고 **`pane_view_end reason=detached`**를 보낸다.
- **동시 attach 1(확정, [[08-Decisions|D-041]])**: 이미 attach 중인 연결이 다른 `orcId`로 `view.attach`하면, server는 **이전 attach를 `pane_view_end reason=superseded`로 닫고** 새 attach로 전환한다(연결당 활성 attach는 항상 ≤1).

### 2.3 server→client 프레임 (live view)

[[SPEC-102-realtime-sync]] §2.3 `WsFrameType`에 **server→client** 멤버 `pane_view_seed`/`pane_view`/`pane_view_end`를 추가한다. 모든 프레임의 텍스트(`lines`)는 [[SPEC-006-privacy-redaction]] `sanitizeCapture` 산출(redacted)이다.

```ts
// 커서 좌표계(확정, §2.5): origin = **현재 보이는 화면(visible screen) 좌상단**.
//   x ∈ [0, cols-1], y ∈ [0, rows-1] (tmux #{cursor_x}/#{cursor_y}, visible-screen-relative).
//   seed.lines[]는 스크롤백을 포함하므로, seed 버퍼 내 커서 행 = (lines.length - rows) + y
//   (즉 visible 영역은 seed 버퍼의 마지막 rows줄; scrollback seed 길이만큼 offset).
interface CursorPos { x: number; y: number; }

// styled 오버레이 상수(확정). charset·길이 bound의 SSOT는 [[SPEC-006-privacy-redaction]] §2.8(mechanism owner);
//   본 spec은 wire 형식으로 동일 값을 재기술한다(세 spec 문구 일치).
const SGR_MAX = 32;                 // sgr 파라미터 문자열 최대 길이(가설 상향 여지, 하지만 유한 bound는 확정)
const SGR_RE = /^[0-9;:]{1,32}$/;   // sgr MUST match. 즉 ^[0-9;:]{1,SGR_MAX}$ (SGR 숫자 파라미터 only, ESC/문자 불가)
const MAX_SPANS_PER_LINE = 256;     // (선택 bound) spans[i] run 개수 상한(가설) — DoS/버퍼 폭주 방지. 초과분은 drop→plain fallback

// Phase 1.5 styled 오버레이(§2.3.1, [[08-Decisions|D-042]]). Phase 1(plain) 프레임에는 존재하지 않는다(spans 부재 = plain).
interface StyleSpan {
  start: number;   // 반열림 [start, end) 시작 offset — 이미 redacted된 lines[i] 문자열 인덱스,
                   //   단위 = UTF-16 code unit(JS String.prototype.slice 의미). xterm client가 JS이므로 고정.
  end: number;     // 반열림 끝 offset(exclusive). 0 <= start < end <= lines[i].length.
  sgr: string;     // SGR 숫자 파라미터 ONLY. MUST match ^[0-9;:]{1,SGR_MAX}$ (예: "1;31", "38;5;204").
                   //   client는 ESC[<sgr>m … ESC[0m 로 렌더. ESC/OSC/DCS/raw escape byte·임의 문자는 절대 담기지 않는다.
}

// attach 직후 1회. 스크롤백 seed(oldest→newest) 전체를 싣는다.
interface PaneViewSeedPayload {
  orcId: string;
  cols: number;                 // pane native width  (#{pane_width})
  rows: number;                 // pane native height (#{pane_height})
  cursor: CursorPos | null;     // 조회 실패 시 null
  lines: string[];              // redacted scrollback seed, 오래된→최신 순 (Phase 1과 동일 — 절대 불변)
  spans?: StyleSpan[][];        // Phase 1.5 styled 오버레이(선택). spans[i] = lines[i]의 정렬·비중첩 style run 배열.
                                //   불변식: spans 존재 시 spans.length === lines.length(빈 배열 = unstyled 라인).
                                //   부재(undefined) = plain(Phase 1 동작). §2.3.1.
  capturedAt: string;           // ISO 8601 server time
  redacted: boolean;            // 1개 이상 패턴이 마스킹됐는가 (SanitizedCapture.redacted)
  byteClamped: boolean;         // byte cap(B) tail-clamp 발생 여부
  viewSeq: number;              // 이 attach의 첫 프레임 = 0
}

// 폴링 tick마다. 현재 보이는 window(redacted) 또는 변경된 tail.
interface PaneViewPayload {
  orcId: string;
  cols: number;
  rows: number;
  cursor: CursorPos | null;
  lines: string[];              // redacted current window 또는 changed tail(oldest→newest) (Phase 1과 동일)
  spans?: StyleSpan[][];        // Phase 1.5 styled 오버레이(선택). spans[i] = lines[i]의 정렬·비중첩 style run 배열.
                                //   spans.length === lines.length. 부재 = plain. §2.3.1
  capturedAt: string;
  redacted: boolean;
  byteClamped: boolean;         // 이 tick도 byte cap(B) tail-clamp될 수 있음(2026-07-02 리뷰 반영)
  viewSeq: number;              // seed 이후 +1씩 단조 증가(이 attach 범위)
}

// 스트림 종료(정상/거부/오류 모두).
interface PaneViewEndPayload {
  orcId: string;
  reason: 'detached' | 'pane_gone' | 'exposure_off' | 'tab_hidden' | 'superseded' | 'error';
}
```

- `pane_view_seed`는 attach당 **정확히 1회**, 항상 `viewSeq = 0`이다. 이후 모든 `pane_view`는 `viewSeq`가 strict +1이다(§2.4).
- `pane_view.lines`는 기본적으로 **현재 보이는 window 전체(redacted)**를 싣는다. server는 대역폭 최적화로 **직전 emit 대비 변경된 tail만** 실을 수 있으나(가설), 이 결정은 redacted 버퍼 상에서만 수행한다(§3.4). client는 seed를 base로, `pane_view`를 window 치환/tail append로 적용한다(렌더 규칙은 [[SPEC-203-terminal-workspace]]).
- `pane_view_end`는 스트림의 **마지막 프레임**이다. 이후 같은 attach의 `pane_view`는 오지 않는다. client가 다시 보려면 새 `view.attach`가 필요하다.

### 2.3.1 styled 오버레이(`spans`) — Phase 1.5 wire 계약 (확정, [[08-Decisions|D-042]], R-PRIV-008)

Phase 1.5(색 재현)는 `lines`를 바꾸지 않고 **`spans`(선택적 SGR 오버레이)** 만 추가한다. 이 표현은 [[SPEC-006-privacy-redaction]] §2.8 ANSI/styled redaction 알고리즘(tokenize → **모든 ESC/C0/C1 strip** → plain-redact → style re-map)의 **network egress 실현**이다 — SPEC-006이 메커니즘을, 본 spec이 채널 wire 형식을 소유한다. `capture-pane -e`의 raw escape byte를 그대로 흘리는 대신, redacted plain `lines` + 구조화된 SGR span으로 나눠 실어 **T-14/PF-05(redaction-before-egress)를 프레임 경계에서 구조적으로 검증 가능**하게 만든다. 아래를 **확정(CONFIRMED) wire 계약 텍스트**로 고정한다.

1. **span은 redaction 이후에만 적용된다.** `spans[i]`의 `start`/`end`는 **이미 redacted된 `lines[i]` 문자열**을 인덱싱한다(반열림 `[start, end)`, 단위 = **UTF-16 code unit**, JS `String.prototype.slice` 의미). span은 redacted 산출 위에만 얹히며 raw 텍스트를 참조하지 않는다.
2. **span은 `[REDACTED:<class>]` 토큰 경계를 가로지르거나 쪼갤 수 없다.** redacted 토큰은 **원자 단위**이며, style span은 그 토큰의 앞/뒤 edge에서 clip된다(토큰 내부를 부분 스타일하지 않는다). 이는 [[SPEC-006-privacy-redaction]] §2.8 step 4 style re-map 규칙과 동일하다.
3. **`sgr`는 `^[0-9;:]{1,SGR_MAX}$`(SGR_MAX=32)를 MUST match**한다 — charset `[0-9;:]`·길이 1..SGR_MAX로 유한 제한된 SGR 숫자 파라미터만(예: `"1;31"`, `"38;5;204"`). **임의 텍스트·문자·ESC를 담을 수 없으므로 구조적으로 secret 콘텐츠를 밀반출할 수 없다**(letter가 ESC byte를 안 갖는다는 이유로 escape 검사만 통과시키는 blind spot을 charset 검사가 닫는다). client는 `ESC[<sgr>m … ESC[0m`로만 렌더한다. charset/길이 bound의 mechanism SSOT는 [[SPEC-006-privacy-redaction]] §2.8이며 본 규칙은 그 wire 실현이다.
4. **wire에는 raw escape sequence가 전혀 실리지 않는다.** 따라서 redaction-before-egress 불변식(T-14/PF-05)은 **프레임 경계에서 구조적으로 검증 가능**하다 — 어떤 secret이 노출되려면 `lines[i]`에 literal로 나타나야 하는데 `lines[i]`는 `sanitizeCapture`를 통과했고, escape가 존재하지 않으므로 escape 안에 숨을 수도 없다. 이것이 (`-e` byte를 그대로 보내는 대신) **spans-over-redacted-plain** 설계를 채택한 이유다.
5. **styled 프레임도 기존 live view 불변식을 모두 그대로 지킨다.** `WsEnvelope.version = null`(§2.4), `viewSeq` 단조(§2.4), `sanitizeCapture` 단일 chokepoint(§3.4), `redacted`/`byteClamped` 플래그(§2.3) — `spans`는 **additive(추가 전용)** 이며 이 중 어느 것도 바꾸지 않는다. 불변식: `spans` 존재 시 `spans.length === lines.length`(빈 배열 = unstyled 라인). `pane_view` changed-tail(§2.3, Q2)을 실을 때도 `spans`는 그 `lines`와 index 병렬로 정렬된다.
7. **span 정렬·비중첩(일반 `StyleSpan[][]` 불변식, 두 payload 공통).** 각 `spans[i]` 내부의 run은 **`start` 오름차순 정렬**되고 **서로 겹치지 않는다**: 모든 인접 쌍에 대해 `spans[i][k].end <= spans[i][k+1].start`. 또한 `0 <= start < end <= lines[i].length`(rule 1 offset 범위)이고, `spans[i]`의 run 개수는 `MAX_SPANS_PER_LINE`(가설 256)을 넘지 않는다 — 초과·중복·역순 span은 malformed로 간주해 그 프레임을 plain fallback(§3.4-3, rule 6)한다. 이 불변식은 `pane_view_seed`·`pane_view` 양쪽에 동일하게 적용된다.
6. **backward-compat / fail-safe fallback.** `spans` **부재(undefined)** = plain = Phase 1 동작(§3.4-2, AC-06). Phase 1 client는 `spans`를 무시하고 `lines`만 렌더해 **변경 없이 계속 동작**한다. 게이트 미충족·styled 경로 오류·runtime self-check 실패(§3.4-3) 시 server는 그 프레임에서 **`spans`를 생략(plain fallback)** 하며, **부분·raw 프레임을 절대 emit하지 않는다**([[08-Decisions|D-042]] (c)).

> **client 렌더 규칙(참고, 상세는 [[SPEC-203-terminal-workspace]] 소유)**: client는 `lines[i]`를 `spans[i]`의 각 run만큼 `ESC[<sgr>m`로 감싸(run 사이·바깥은 `ESC[0m`) xterm.js에 write한다. `spans`를 무시하면 `lines`(string[]) 자체가 곧 plain redacted lines다 — styled `lines`는 baseline `redact(strip-ALL-escapes(SAME -e raw))`의 lines와 **element-wise 동일**해야 한다(불변식 4·비파괴성, AC-20; join separator 불명확성 없음).

### 2.4 viewSeq ordering (스냅샷 version과 분리 — 확정)

- live view 프레임의 재조립 권위 키는 **`viewSeq`**다. attach 시작 시 `pane_view_seed.viewSeq = 0`, 이후 `pane_view`마다 +1. **새 attach마다 0으로 리셋**한다.
- `WsEnvelope.version`은 live view 프레임에서 **항상 `null`**이다. client는 live view 프레임에 대해 [[SPEC-102-realtime-sync]]의 스냅샷 `version` 비교·gap 감지·resync를 **적용하지 않는다**(별도 채널).
- `viewSeq`가 비연속(예: `viewSeq > 직전+1`)이면 client는 **재-attach(detach 후 attach)로만 회복**한다 — live view는 스냅샷과 달리 replay/부분 resync를 정의하지 않는다(다음 seed가 완전한 base다).
- WS 연결이 끊기면 attach는 소멸한다. 재연결 후 client가 live view를 원하면 [[SPEC-102-realtime-sync]] §3.3 스냅샷 복구와 **독립적으로** 새 `view.attach`를 보낸다.

### 2.5 read-only 수집 계약 (capture·cursor·geometry)

live view는 pane당 tick마다 아래 **read-only 명령만** [[SPEC-006-privacy-redaction]] §2.6 `tmuxExec`로 수행한다(READONLY_ALLOWLIST 밖 명령·`send-keys`·`-C` control mode 금지):

| 목적 | 명령(개념) | allowlist | 산출 |
| --- | --- | --- | --- |
| 화면/스크롤백 텍스트 | Phase 1: `capture-pane -p -J -t <paneId> -S -<CAPTURE_LINES>` (`-e` 미사용). Phase 1.5 styled(게이트 통과 시): 동일 명령에 **`-e` 플래그만 추가**(`capture-pane -p -e -J …`) — escape 포함 출력을 [[SPEC-006-privacy-redaction]] §2.8 tokenize→strip→redact→style-remap으로 처리. `-J`로 wrapped line join. | `capture-pane` (기존) | Phase 1: raw → `sanitizeCapture` → `lines`. Phase 1.5: raw(-e) → §2.8 파이프라인 → redacted `lines` + `spans` |
| geometry + 커서 | `list-panes -t <paneId> -F '#{pane_id} #{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{cursor_flag} #{alternate_on}'` (아래 target-row 규칙) | `list-panes` (기존) | `cols`/`rows`/`cursor`(+alt-screen 힌트) |

- **커서 조회 결정(확정)**: 커서·geometry는 **이미 allowlist에 있는 `list-panes`의 format 변수**(`#{cursor_x}`/`#{cursor_y}`/`#{pane_width}`/`#{pane_height}`)로 얻는다. 이로써 **새 subprocess 진입점·새 allowlist 항목을 추가하지 않고** read-only 불변식([[08-Decisions|D-019]])을 그대로 유지한다. [[18-Terminal-Workspace]]/[[08-Decisions|D-045]]가 예시한 `display-message -p` 경로는 **채택하지 않는다**(READONLY_ALLOWLIST에 없어 추가가 필요하므로 노출면이 늘고, `list-panes`로 동일 값을 얻을 수 있음). 이 divergence는 §6 Conflict/Upstream에 기록해 D-045 ratify 시 정합화한다.
- **target-row 매칭(확정, 2026-07-02 리뷰 반영)**: `list-panes -t <paneId>`는 **paneId가 속한 window의 모든 pane row**를 반환할 수 있다(multi-pane window). 따라서 format에 **`#{pane_id}`를 포함**해 반환 행 중 `pane_id == <paneId>`인 **정확히 그 pane 행**만 채택한다(또는 `-f '#{==:#{pane_id},<paneId>}'` 필터로 서버 측 제한). 매칭 행이 없으면 pane이 사라진 것으로 보고 §3.7 `pane_gone` 처리한다.
- **커서 좌표계(확정, §2.3 CursorPos)**: `#{cursor_x}`/`#{cursor_y}`는 **visible-screen 상대 좌표**(origin=보이는 화면 좌상단, `x∈[0,cols-1]`, `y∈[0,rows-1]`)다. seed `lines[]`는 스크롤백을 포함하므로 seed 버퍼 내 커서 행 = `(lines.length - rows) + cursor.y`이다. capture는 **`-J`(wrapped line join)**로 취득해 커서 행 계산이 논리 라인 기준으로 일관되게 한다.
- **`cursor_flag`/`alternate_on` 사용(구현 정합, 2026-07-02)**: `#{cursor_flag}`가 `0`(커서 숨김)이면 server는 별도 필드를 두지 않고 **`cursor: null`로 매핑**한다(§2.3 CursorPos는 `{x,y}|null`뿐 — 숨김=null=조회실패와 동일 취급). `#{alternate_on}`(alternate-screen 활성)은 §2.5 format으로 **수집하되 Phase 1 프레임 필드로는 노출하지 않는다**(frozen 계약 §2.3에 해당 필드가 없음) — xterm.js alt-screen 힌트가 필요하면 [[SPEC-203-terminal-workspace]] 요청 시 프레임 필드를 추가하는 **forward 계약 확장**으로 다룬다. 둘 다 read-only format 변수라 새 명령이 아니다.
- capture는 한 tick에서 `list-panes`(geometry+cursor, target-row 매칭) → `capture-pane`(텍스트) 순으로 수행하되, 둘 다 실패 시 그 tick은 프레임을 skip한다(§3.7 degradation).
- capture 산출 raw는 `sanitizeCapture` 반환 후 폐기한다 — raw는 프레임·로그·디스크 어디에도 도달하지 않는다([[SPEC-006-privacy-redaction]] §2.5, 불변식 ②).
- **styled `-e`는 read-only 불변식을 유지한다(확정)**: Phase 1.5 styled capture는 여전히 **`capture-pane`(기존 READONLY_ALLOWLIST 항목)** 을 호출하며 **`-e` 플래그만 추가**할 뿐이다 — 새 subcommand·새 allowlist 항목·새 subprocess 진입점을 만들지 않는다(불변식 ①, [[08-Decisions|D-019]], [[SPEC-006-privacy-redaction]] §2.6). `-e`는 상태 비변경 read 플래그이므로 §3.7 read-only 강제·AC-07(spawn된 subcommand는 `{capture-pane, list-panes}`뿐)이 그대로 성립한다. raw(-e) 버퍼는 §2.8 파이프라인 통과 후 폐기되며 프레임에는 redacted `lines` + `spans`만 도달한다(§2.3.1 불변식 4).

### 2.6 프레임과 스냅샷 채널의 관계

- live view와 스냅샷 diff([[SPEC-102-realtime-sync]])는 **같은 WS 연결의 두 독립 채널**이다. live view 프레임(`version:null`)은 스냅샷 store에 영향을 주지 않고, 스냅샷 프레임은 live view 렌더에 영향을 주지 않는다.
- orc identity는 두 채널에서 동일하다(`orcId = "pane:" + paneId`, [[08-Decisions|D-017]]). client는 스냅샷에서 얻은 orc를 `view.attach`한다.

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다.

### 3.1 폴링 주기·부하 한도 (확정 골격 + 가설 수치, [[08-Decisions|D-041]])

```ts
// PoC 검증 가설 — §6 Q1, [[SPEC-007-test-validation]] 측정으로 확정
const PANE_VIEW_INTERVAL_MS = 250; // 250–500ms 범위 가설(sub-second 갱신 목표)
const MAX_ATTACH_PER_CONNECTION = 1; // MVP 확정(D-041)
const MAX_VIEW_CAPTURE_FAILURES = 3; // 연속 non-pane_gone 실패 상한(가설) → pane_view_end reason=error (§3.7)
```

- **확정**: 연결당 동시 attach는 **최대 1 pane**이다(§2.2 supersede). 이로써 tmux 서버에 가하는 고빈도 capture 부하가 연결당 상수로 bound된다.
- **가설**: `PANE_VIEW_INTERVAL_MS`(250–500ms)와 tmux 서버 실측 부하(pane당 최대 Hz)는 [[SPEC-007-test-validation]] 하니스로 보정한다(§6 Q1).
- server는 폴링을 **fixed-interval이 아니라 이전 tick 완료 후 간격**으로 스케줄해(capture가 느린 pane에서 tick이 겹치지 않게) 백로그를 만들지 않는다.

### 3.2 폴링 게이트 (확정, [[08-Decisions|D-041]]/[[08-Decisions|D-044]])

server는 다음 **3조건이 모두 참**일 때만 폴링(`capture-pane`)을 수행한다:

1. **attach 유지**: 해당 연결이 이 `orcId`에 attach 중.
2. **exposure on**: 글로벌 preview exposure 설정이 켜짐(§3.5, [[08-Decisions|D-044]]).
3. **탭 활성**: client가 탭 가시성을 알린 상태(§3.3).

하나라도 거짓이 되면 폴링을 **즉시 중단**하고 상황에 맞는 `pane_view_end`(reason=`detached`/`exposure_off`/`tab_hidden`)를 보낸다. exposure/탭 조건은 재충족 시 client의 새 `view.attach`로만 재개한다(자동 재개 없음 — 명시 행위 원칙).

### 3.3 attach 상태 전이 (확정)

- **detached → attached**: `view.attach` + 게이트 통과 → `pane_view_seed`(viewSeq=0) → 폴링(`pane_view`).
- **attached → detached**: `view.detach`/WS close/게이트 위반 → 폴링 중단 → `pane_view_end`.
- **attached(A) → attached(B)**: 다른 orcId로 `view.attach` → A를 `pane_view_end reason=superseded`로 닫고 B로 전환(연결당 ≤1).
- **탭 가시성**: client는 탭 hidden/visible 전이를 알린다. 전달 방식(전용 프레임 vs `view.detach`/`view.attach` 재사용)은 client 구현이 정하되, **hidden이면 server 폴링이 반드시 멈춰야** 한다(불변식 ④). MVP 권장: 탭 hidden 시 client가 `view.detach`를 보내고 visible 복귀 시 재-attach한다.
- **no-op**: attach 중이 아닌 `orcId`로 `view.detach`가 오면 server는 no-op(프레임 없음)한다.

### 3.4 redaction 경계 (확정, [[08-Decisions|D-042]], R-PRIV-008)

1. **모든 emit 프레임의 `lines`는 [[SPEC-006-privacy-redaction]] `sanitizeCapture` 산출(redacted)만** 싣는다(불변식 ②). raw capture는 chokepoint 밖으로 나가지 않는다. 이는 [[SPEC-006-privacy-redaction]] PF-05(redaction-before-egress)를 live/network 채널로 **정식화**한 것이다.
2. **Phase 1 = plain(확정)**: capture는 `-p`(no `-e`)로 수행하고 기존 평문 카탈로그를 그대로 적용한다. 새 redaction 위험 0([[08-Decisions|D-042]] (a)).
3. **Phase 1.5 styled = 게이트(확정된 unlock 조건, [[08-Decisions|D-042]])**: styled(`spans`) emit은 아래 **세 조건이 모두 참일 때만** 허용한다 — 하나라도 거짓이면 server는 그 tick에서 `spans`를 생략하고 **plain으로 fail-safe fallback**한다([[08-Decisions|D-042]] (c), §2.3.1 불변식 6).
   - **(a)** [[SPEC-006-privacy-redaction]] §2.8 ANSI/styled redaction(tokenize→strip-ALL-escapes→plain-redact→style-remap)이 `approved` — **충족**(2026-07-02 Accepted, SPEC-006 §2.8·AC-20).
   - **(b)** [[SPEC-007-test-validation]] styled 코퍼스(`TC-M-STYLED`)가 green이고 `secret-recall == 1.0 == plain`(styled 경로의 secret-recall이 plain 경로와 동일).
   - **(c)** **runtime self-check(프레임마다 — 확정, 기동 self-test 대체 금지)**: styled 경로가 산출한 프레임의 redacted plain `lines`가 **동일 `-e` capture에 steps 2–3만 적용한 산출**, 즉 `redact(strip-ALL-escapes(SAME -e raw))`([[SPEC-006-privacy-redaction]] §2.8 step 2–3 = `sanitizeStyledCapture`의 `.lines`)과 **일치**함을 **emit되는 모든 프레임(매 tick)** 검증한다. **비교 표현은 `lines: string[]` 배열의 element-wise 동등**(양 경로 모두 `splitLF`로 `string[]` 산출; join separator 불명확성 없음 — 원소별 `===`)이다. **baseline은 별도 `capture-pane -p` 재호출이 아니라 같은 `-e` raw의 steps 2–3 출력**이다(두 번째 capture는 비결정적이라 styled를 영구 plain fallback으로 잘못 고정하므로 금지). 아울러 프레임의 **모든 `spans[i][k].sgr`가 `^[0-9;:]{1,SGR_MAX}$`를 만족**하고 §2.3.1 rule 7(정렬·비중첩·bound)을 만족하는지 검증한다. `lines` 불일치 또는 어떤 span의 charset/구조 위반이 있으면 그 프레임은 위반 span을 drop하고 **plain으로 fail-safe fallback**한다(그 tick만; fail-safe = plain, D-042 (c)). 이 self-check는 **정확성 tripwire**이므로 성능 사유로 완화하지 않는다 — 250–500ms hot path 비용 우려는 §6 Q7/Q8로 라우팅해 측정·보정한다(다운그레이드 금지).
   승인·게이트 통과 전까지는 §3.4-2 Phase 1 plain 고정(AC-06)이며, styled의 `secret-recall`은 plain과 동일(1.0)이어야 한다(§3.4-3(b)/(c)).
4. `redacted`/`byteClamped` 플래그는 `SanitizedCapture`를 그대로 전달한다. redaction-stats(`matchCount`)는 **wire에 직렬화하지 않는다**([[SPEC-006-privacy-redaction]] §3.5 ④).

### 3.5 exposure gate (확정, [[08-Decisions|D-044]])

- live view attach는 preview와 **동일한 글로벌 exposure 설정**을 상속한다(R-PRIV-006, [[08-Decisions|D-026]] `GET /api/orcs/:orcId/preview` gate가 쓰는 그 설정 — 값·저장은 [[SPEC-101-snapshot-api]]/[[SPEC-500-settings-persistence]] 소유). 여기에 **명시적 per-attach 사용자 행위(focus/attach)**를 추가로 요구한다.
- exposure **off**인 상태에서 `view.attach`가 오면 server는 seed를 보내지 않고 **`pane_view_end reason=exposure_off`**로 거부한다. attach 중 exposure가 off로 바뀌면 폴링을 중단하고 같은 프레임으로 종료한다(§3.2).
- **per-pane 지속 gate(“이 orc만 노출” 승격)는 forward**다(§6, [[08-Decisions|D-044]]) — 새 저장 상태·privacy 표면 증가라 MVP 범위 밖.

### 3.6 화면 재현 수준·한계 (확정, [[08-Decisions|D-045]])

capture-pane 기반이므로 재현 범위를 다음으로 한정하고, 그 **한계를 명시**한다:

- **재현(목표)**: (a) 스크롤백 seed = 캡처 창 `CAPTURE_LINES`줄(초기 200, 상향은 [[SPEC-006-privacy-redaction]] §3.4 tunable로 조정 — 값 소유는 SPEC-006), (b) 커서 위치(`list-panes` cursor_x/cursor_y, §2.5), (c) 현재 보이는 화면(alternate-screen 콘텐츠 포함, capture된 그대로)을 xterm.js에 반영.
- **비목표(한계, 재현하지 않음)**: 진짜 cell-diff 실시간 emulation, scroll-region/mouse-tracking/OSC 완전 재현. 이는 capture-pane 스냅샷 텍스트로 불가하며, 저지연·고충실은 Phase 2 control mode(§6, [[08-Decisions|D-041]] (c))로 개선한다.
- seed의 `cols`/`rows`는 pane native geometry(`#{pane_width}`/`#{pane_height}`)를 반영한다. geometry가 변하면 다음 `pane_view`가 갱신된 값을 싣는다(리사이즈 렌더는 [[SPEC-203-terminal-workspace]]).

### 3.7 read-only 강제·degradation (확정)

- live view의 어떤 tick도 [[SPEC-006-privacy-redaction]] §2.6 READONLY_ALLOWLIST 밖 명령을 spawn하지 않는다(불변식 ①). `tmux -C`(control mode)는 Phase 1에서 절대 쓰지 않는다.
- `capture-pane`/`list-panes` 실패·timeout(per-call timeout `T`, [[SPEC-002-tmux-discovery]] §2.6)이면 그 tick은 skip한다. pane이 사라졌으면(capture가 “pane not found” 류로 실패, 또는 §2.5 target-row 매칭 실패) 폴링을 중단하고 **`pane_view_end reason=pane_gone`**을 보낸다.
- **max-consecutive-failure(확정, 2026-07-02 리뷰 반영)**: `pane_gone`으로 분류되지 않는 실패(timeout·transient error 등)가 **연속 `MAX_VIEW_CAPTURE_FAILURES`회**(가설 3회, §6 Q1) 발생하면, 무한히 무프레임으로 tick을 skip하지 않고 폴링을 중단하며 **`pane_view_end reason=error`**를 보낸다(client는 재-attach로만 재개). 성공 tick은 카운터를 리셋한다.
- cursor/geometry 조회만 실패하면 `cursor`를 `null`로 두고 텍스트 프레임은 계속 보낸다(부분 degradation).

### 3.8 전송 backpressure·실행 격리 (확정 골격 + 가설 수치, 2026-07-02 리뷰 반영)

- **WS-send backpressure(확정)**: live view는 연결당 `pane_view`를 무한 버퍼링하지 않는다. server는 **다음 폴링 tick을 (i) WS socket write buffer가 drain됐고 (ii) 직전 프레임이 전송 완료**된 뒤에만 스케줄한다. 느린 client로 tick이 밀리면 프레임을 쌓지 않고 **최신값으로 coalesce-to-latest**한다 — `pane_view`는 convergent(현재 화면=latest-wins)라 중간 tick을 버려도 정확성이 유지된다(seed는 예외로 유실 금지). 이로써 연결당 live 버퍼가 상수로 bound된다([[SPEC-102-realtime-sync]] §3.6 backpressure 정신과 정합).
- **실행 격리(확정)**: live 폴링(≈250ms)과 scan 루프(1–5s)는 둘 다 [[SPEC-006-privacy-redaction]] §2.6 `tmuxExec`를 쓰지만 **별도 spawn/concurrency 예산**을 갖는다 — live capture 큐는 scan 큐와 분리되어 hung live capture가 scan tick을 지연시키거나 그 반대가 되지 않는다. live 채널의 동시 spawn은 연결당 attach 1(§3.1)로 이미 bound된다.
- **T ↔ interval 관계(확정)**: per-call timeout `T`(≈2000ms, [[SPEC-002-tmux-discovery]] §2.6)가 `PANE_VIEW_INTERVAL_MS`(250–500ms)보다 **크다**. 따라서 tick은 fixed-interval이 아니라 **직전 tick 완료 후 간격**으로만 스케줄하며(§3.1, 백로그 방지), capture가 `T`에 근접해 느려지면 실효 갱신 주기가 자연히 늘어난다(silent degradation을 §6 Q1에서 측정해 `T`/interval/failure 임계를 보정).
- **전역(연결 간) 동시 capture 상한 미설정(nit, MVP 허용)**: 본 계약은 **연결당** attach 1만 강제하고 여러 연결에 걸친 전역 동시 capture 상한은 두지 않는다. MVP는 단일 local client(127.0.0.1)라 실질 문제가 없으나, P2 multi-client에서는 전역 capture budget이 필요하므로 **forward로 flag**한다(§6 Q7).

## 4. Acceptance criteria

```text
SPEC-103-AC-01 (R-API-006)
  Given exposure on 상태에서 client가 어떤 orcId로 view.attach 를 보낼 때
  When server가 게이트(§3.5)를 통과하면
  Then server는 pane_view_seed 를 정확히 1회(viewSeq=0) 보내고,
       그 payload는 cols/rows/cursor/lines/capturedAt/redacted/byteClamped/viewSeq 를 가지며,
       lines 는 oldest→newest 순의 redacted 스크롤백 seed(최대 CAPTURE_LINES줄)이다.
```

```text
SPEC-103-AC-02 (R-API-006)
  Given attach가 성립해 seed(viewSeq=0)를 받은 뒤
  When pane 내용이 갱신되면
  Then server는 PANE_VIEW_INTERVAL_MS(가설 250–500ms) 간격으로 pane_view 프레임을 보내고,
       각 프레임의 viewSeq 는 직전보다 정확히 +1 이며 WsEnvelope.version 은 null 이다.
```

```text
SPEC-103-AC-03 (R-API-006 / [[08-Decisions|D-041]])  [부하 한도 — 동시 attach 1]
  Given 어떤 연결이 orcId A 에 attach 중일 때
  When 같은 연결이 orcId B 로 view.attach 를 보내면
  Then server는 A 를 pane_view_end reason=superseded 로 닫고 B 로만 폴링하며,
       그 연결의 동시 활성 attach 수는 항상 ≤ 1 이다.
```

```text
SPEC-103-AC-04 (R-API-006 / [[08-Decisions|D-041]])  [폴링 게이트 — 즉시 중단]
  Given attach 중인 연결에서
  When view.detach 를 보내거나 / 탭이 hidden 이 되거나 / exposure 가 off 로 바뀌면
  Then server는 그 즉시 해당 pane 의 capture-pane 폴링을 멈추고
       reason 이 각각 detached / tab_hidden / exposure_off 인 pane_view_end 를 보낸다
       (자동 재개 없이 새 view.attach 로만 재개).
```

```text
SPEC-103-AC-05 (R-PRIV-008 / [[08-Decisions|D-042]])  [redaction-before-egress]
  Given capture 스크롤백에 `ghp_<token>` 형태 secret이 포함될 때
  When 그 pane 을 attach 해 pane_view_seed·pane_view 를 수신하면
  Then 어떤 프레임의 lines 에도 `ghp_<token>` literal 이 나타나지 않고
       해당 위치는 [REDACTED:github-token] 로 대체되어 있다(sanitizeCapture chokepoint 통과).
```

```text
SPEC-103-AC-06 (R-PRIV-008 / [[08-Decisions|D-042]])  [Phase 1 plain fallback]
  Given ANSI stream redaction([[SPEC-006-privacy-redaction]])+테스트가 아직 미승인일 때
  When live view 프레임을 emit 하면
  Then capture는 -p(no -e) plain 으로 수행되어 styled(SGR) 텍스트를 emit 하지 않고,
       기존 평문 redaction 카탈로그가 그대로 적용된다.
```

```text
SPEC-103-AC-07 (R-UI-012 / [[08-Decisions|D-019]]/[[08-Decisions|D-041]])  [read-only 불변식]
  Given live view가 한 pane 을 여러 tick 폴링하는 동안
  When 실제 spawn된 tmux argv 를 관측하면
  Then subcommand 는 {capture-pane, list-panes} 뿐이고(+기존 scan allowlist),
       send-keys/paste-buffer/`tmux -C` 등 어떤 write·control-mode 경로도 spawn되지 않는다.
```

```text
SPEC-103-AC-08 (R-UI-012 / [[08-Decisions|D-045]])  [커서·geometry 조회 경로]
  Given attach 중인 pane 에 대해
  When server가 커서 위치와 geometry 를 조회하면
  Then 이미 allowlist 에 있는 list-panes 의 format 변수
       (#{pane_width}/#{pane_height}/#{cursor_x}/#{cursor_y})로 얻어
       cols/rows/cursor 를 채우며, 새 allowlist 항목(예: display-message)을 추가하지 않는다.
       (조회 실패 시 cursor=null 로 두고 텍스트 프레임은 계속 보낸다.)
```

```text
SPEC-103-AC-09 (R-API-006 / [[08-Decisions|D-005]])  [별도 채널 — 스냅샷과 분리]
  Given 같은 WS 연결에서 스냅샷 diff([[SPEC-102-realtime-sync]])와 live view 가 함께 흐를 때
  When client가 프레임을 처리하면
  Then live view 프레임(version:null)은 스냅샷 store·version/gap/resync 로직에 영향을 주지 않고,
       live view ordering 은 오직 viewSeq 로 판정된다(스냅샷 version 비교 미적용).
```

```text
SPEC-103-AC-10 (R-PRIV-008 / [[08-Decisions|D-044]])  [exposure gate]
  Given 글로벌 exposure 가 off 인 상태에서
  When client가 어떤 orcId 로 view.attach 를 보내면
  Then server는 pane_view_seed 를 보내지 않고 pane_view_end reason=exposure_off 로 거부하며,
       그 pane 에 대한 capture-pane 폴링을 시작하지 않는다.
```

```text
SPEC-103-AC-11 (R-API-006 / [[08-Decisions|D-045]])  [pane 소멸·재현 한계]
  Given attach 중인 pane 이 종료(close)되어 capture-pane 이 실패할 때
  When 다음 폴링 tick 이 돌면
  Then server는 폴링을 멈추고 pane_view_end reason=pane_gone 을 보내며,
       live view 는 capture-pane 으로 표현 가능한 범위(스크롤백·커서·현재 화면)만 재현하고
       cell-diff/scroll-region/mouse 는 재현하지 않는다(한계 명시).
```

```text
SPEC-103-AC-12 (R-API-006)  [seed 이후 viewSeq 연속성·재-attach 회복]
  Given attach 스트림에서 viewSeq 가 비연속(예: 유실로 gap)일 때
  When client가 이를 감지하면
  Then client는 스냅샷식 부분 resync 를 시도하지 않고 detach 후 재-attach 로만 회복하며,
       새 attach 의 pane_view_seed 가 viewSeq=0 의 완전한 base 를 다시 제공한다.
```

```text
SPEC-103-AC-13 (R-API-006 / [[08-Decisions|D-041]])  [seq 예외 — live 유실 ≠ state resync]
  Given attach 중 고빈도 pane_view 프레임 하나가 유실/coalesce 될 때
  When client가 프레임 sequence 를 검사하면
  Then live view 프레임은 WsEnvelope.seq 연결 sequence 에 참여하지 않아
       [[SPEC-102-realtime-sync]] §3.5-2 seq-gap 검사에서 제외되고,
       state 채널 re-snapshot resync 가 트리거되지 않으며,
       live 복구는 viewSeq-gap 감지 시 재-attach 로만 이뤄진다.
```

```text
SPEC-103-AC-14 (R-UI-012 / [[08-Decisions|D-045]])  [multi-pane target-row 매칭·커서 좌표계]
  Given target pane 이 여러 pane 을 가진 window 에 속할 때
  When server가 list-panes -t <paneId> 로 geometry/커서를 조회하면
  Then format 의 #{pane_id} 로 pane_id == <paneId> 인 정확히 그 행만 채택해
       다른 pane 의 cols/rows/cursor 를 잘못 싣지 않고(행 없음 → pane_gone),
       cursor 는 visible-screen 상대 좌표(origin=화면 좌상단, y∈[0,rows-1])로,
       seed 버퍼 내 커서 행은 (lines.length - rows) + cursor.y 로 계산된다.
```

```text
SPEC-103-AC-15 (R-API-006)  [WS backpressure — coalesce-to-latest]
  Given 느린 client 로 인해 폴링 tick 이 전송보다 빨리 도착하는 상황에서
  When server가 다음 tick 을 스케줄하면
  Then 다음 폴링은 socket write buffer drain + 직전 프레임 전송 완료 후에만 수행되고,
       밀린 중간 pane_view 는 쌓이지 않고 최신값으로 coalesce 되어(convergent latest-wins)
       연결당 live 버퍼가 상수로 bound 된다(seed 는 유실 금지).
```

```text
SPEC-103-AC-16 (R-API-006)  [max-consecutive-failure → error 종료]
  Given attach 중 non-pane_gone capture 실패(timeout/transient)가 연속 발생할 때
  When 연속 실패가 MAX_VIEW_CAPTURE_FAILURES(가설 3)회에 도달하면
  Then server는 무한 무프레임 skip 을 멈추고 폴링을 중단하며
       pane_view_end reason=error 를 보낸다(성공 tick 은 카운터 리셋).
```

```text
SPEC-103-AC-17 (R-UI-012 / [[08-Decisions|D-041]])  [실행 격리 — live 폴링 ↔ scan 루프]
  Given live 폴링(≈250ms)과 scan 루프(1–5s)가 동시에 tmuxExec 를 사용할 때
  When live capture 가 T(≈2000ms)에 근접해 느려지거나 hang 될 때
  Then live capture 는 scan 큐와 분리된 spawn/concurrency 예산에서 실행되어
       scan tick 을 지연시키지 않고(그 반대도 아님),
       실효 live 갱신 주기는 T > interval 관계에 따라 자연히 늘어날 뿐 scan 을 막지 않는다.
```

```text
SPEC-103-AC-18 (R-PRIV-008 / R-UI-012 / R-API-006 / [[08-Decisions|D-042]])  [styled 프레임 wire 형식 — no raw escape·sgr charset·정렬]
  Given Phase 1.5 게이트(§3.4-3)를 통과해 styled 프레임(pane_view_seed/pane_view)이 emit될 때
  When 그 프레임을 관측하면
  Then (a) spans 는 lines 에 병렬(spans.length === lines.length)이고 각 StyleSpan 은
           반열림 [start,end) UTF-16 offset(이미 redacted된 lines[i] 인덱스, 0<=start<end<=lines[i].length)을 가지며,
       (b) 프레임의 어떤 필드에도 raw escape byte(ESC 0x1B / OSC / DCS / CSI 원형)가 나타나지 않고
           (styled는 spans-over-redacted-plain 표현으로만 실린다),
       (c) 각 spans[i] 내부 run 은 start 오름차순 정렬·비중첩이다(spans[i][k].end <= spans[i][k+1].start),
       (d) spans[i] 의 run 개수는 MAX_SPANS_PER_LINE(가설 256) 이하다,
       (e) 모든 span 의 sgr 이 정규식 ^[0-9;:]{1,SGR_MAX}$(SGR_MAX=32)를 만족한다
           (SGR 숫자 파라미터 only — 임의 텍스트/문자/ESC 불가; tokenizer 버그로 secret 텍스트가 sgr 로 새는 것을 charset 검사가 차단).
```

```text
SPEC-103-AC-19 (R-PRIV-008 / [[08-Decisions|D-042]])  [span은 [REDACTED:*] 토큰을 가로지르지 않음]
  Given styled 프레임의 lines[i]에 [REDACTED:<class>] 토큰이 포함될 때
  When spans[i]의 각 style run [start,end)을 검사하면
  Then 어떤 run도 그 [REDACTED:*] 토큰 경계를 가로지르거나 쪼개지 않고
       토큰의 앞/뒤 edge에서 clip되어(토큰은 원자 단위), 스타일이 redacted 토큰 내부를 부분 착색하지 않는다.
```

```text
SPEC-103-AC-20 (R-API-006 / R-PRIV-008 / [[08-Decisions|D-042]])  [spans = 비파괴 오버레이]
  Given styled 프레임의 lines(string[])와, 동일 -e raw 에 steps 2–3(redact(strip-ALL-escapes(SAME -e raw)))만
        적용한 redacted plain lines(string[])가 있을 때
  When 두 lines 배열을 비교하면
  Then 두 string[] 이 element-wise 로 동등하다(원소별 ===, 길이·각 원소 일치; join separator 불명확성 없음)
       — spans 는 lines 를 바꾸지 않는 순수 오버레이이므로 client 가 spans 를 무시해도 정확히 redacted plain 을 얻는다.
       (baseline 은 별도 capture-pane -p 재호출이 아니라 같은 -e raw 의 steps 2–3 출력이다.)
```

```text
SPEC-103-AC-21 (R-PRIV-008 / [[08-Decisions|D-042]])  [gate-release predicate + per-frame self-check + plain fail-safe]
  Given styled emit 게이트 조건 (a)SPEC-006 §2.8 approved · (b)SPEC-007 styled 코퍼스 secret-recall==1.0==plain ·
        (c)per-frame runtime self-check 에서
  When emit 되는 모든 프레임(매 tick)에 대해 self-check 를 수행하면
  Then (i) self-check 는 styled lines(string[])가 redact(strip-ALL-escapes(SAME -e raw))의 lines(string[])와
           element-wise 동등한지, 그리고 모든 span 의 sgr 이 ^[0-9;:]{1,SGR_MAX}$ 를 만족하고 §2.3.1 rule 7 구조를
           만족하는지를 프레임마다 검증하며(기동 1회 self-test 로 대체하지 않는다),
       (ii) 게이트 (a)/(b)/(c) 중 하나라도 거짓이거나 self-check 위반·styled 경로 오류가 있으면 server 는 그 프레임에서
            위반 span 을 drop 하고 plain(Phase 1 동작)으로 fail-safe fallback 하며 부분·raw escape 프레임을 절대 emit 하지 않고
            (spans 부재 = plain; Phase 1 client 는 변경 없이 계속 동작),
       (iii) 이 self-check 는 정확성 tripwire 로 성능 사유로 완화되지 않으며 hot-path 비용은 §6 Q7/Q8 로 라우팅된다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-API-006 | 스냅샷과 독립된 live pane view 채널(attach/detach·seed·폴링 프레임·viewSeq ordering·부하 한도·pane 소멸 처리·seq 예외·backpressure coalesce·failure 종료·실행 격리) | SPEC-103-AC-01, AC-02, AC-03, AC-04, AC-09, AC-11, AC-12, AC-13, AC-15, AC-16, AC-17 |
| R-PRIV-008 | 전 프레임 redacted-only(sanitizeCapture chokepoint, PF-05 정식화)·Phase 1 plain fallback·exposure gate·**Phase 1.5 styled wire 형식(spans-over-redacted-plain, no raw escape·[REDACTED:*] 비관통·비파괴 오버레이·gate-release predicate + plain fail-safe)** | SPEC-103-AC-05, AC-06, AC-10, AC-18, AC-19, AC-20, AC-21 |
| R-UI-012 | read-only 고빈도 capture(allowlist 내, styled는 `-e` 플래그만 추가)·커서/geometry 조회(multi-pane target-row·좌표계)·capture-pane 재현 한계·실행 격리·**styled 색 오버레이(spans) 프레임 형식** | SPEC-103-AC-07, AC-08, AC-11, AC-14, AC-17, AC-18 |

> 부수 정합(1차 소유 타 spec): **[[08-Decisions|D-041]]**(부하 한도 — AC-03/04/07), **[[08-Decisions|D-042]]**(ANSI×redaction — 메커니즘 [[SPEC-006-privacy-redaction]]; 본 spec은 채널 적용, AC-05/06), **[[08-Decisions|D-044]]**(exposure gate — AC-04/10), **[[08-Decisions|D-045]]**(재현 한계·커서 — AC-08/11), **[[08-Decisions|D-005]]**(snapshot+WS 구조 재사용 — AC-09). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]]/[[SPEC-007-test-validation]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — 커서 조회 경로 vs [[08-Decisions|D-045]] 문구**: [[18-Terminal-Workspace]] §4/[[08-Decisions|D-045]]는 커서를 `display-message -p`(cursor_x/y)로 조회한다고 예시한다. 그러나 `display-message`는 현재 [[SPEC-006-privacy-redaction]] §2.6 READONLY_ALLOWLIST에 **없다**. 본 spec은 **이미 allowlist에 있는 `list-panes`의 format 변수**(`#{cursor_x}`/`#{cursor_y}`/`#{pane_width}`/`#{pane_height}`)로 동일 값을 얻어 **allowlist 확장 없이** read-only 불변식을 유지하기로 **결정**했다(§2.5, AC-08). D-045 ratify 시 이 divergence(“display-message 대신 list-panes”)를 반영하거나, `display-message`를 굳이 도입할 근거(예: alternate-screen 세부 포맷)가 있으면 [[SPEC-006-privacy-redaction]] §2.6에 read-only query로 추가하는 결정을 별도 확정해야 한다. **security-privacy / tmux-systems 리뷰 필요.**
- **C2 — `WsFrameType` 카탈로그 등록 소유**: 본 spec이 정의한 `view.attach`/`view.detach`(C→S)와 `pane_view_seed`/`pane_view`/`pane_view_end`(S→C)는 [[SPEC-102-realtime-sync]] §2.3 `WsFrameType`에 멤버로 등록돼야 한다(2026-07-02 개정으로 반영). 봉투 필드(`version:null`·`seq`)의 의미도 SPEC-102가 소유하므로 두 spec의 필드 규약이 어긋나면 SPEC-102가 권위다.
- **C3 — exposure 설정 재사용(신규 필드 없음)**: 본 spec은 [[08-Decisions|D-026]]/R-PRIV-006의 **기존 글로벌 exposure 설정을 재사용**한다([[08-Decisions|D-044]]). [[SPEC-500-settings-persistence]]/[[SPEC-101-snapshot-api]]가 live view attach도 그 게이트로 판정함을 명시해야 한다(신규 저장 필드 없음).
- **C4 — 상태 Accepted (RESOLVED 2026-07-02)**: 본 spec의 근거 결정 [[08-Decisions|D-041]]/[[08-Decisions|D-042]]/[[08-Decisions|D-044]]/[[08-Decisions|D-045]]는 spec-reviewer + 도메인 리뷰 게이트 통과 후 **2026-07-02 제품 오너가 전부 Accepted 승인**했다. 본 spec은 `approved`이며 구현 착수 가능하다.

### Open Questions (PoC 검증 대상)

- **Q1 — `PANE_VIEW_INTERVAL_MS`·`T`·failure 임계·tmux 부하**: 250–500ms 폴링 주기, per-call timeout `T`(≈2000ms)와 interval의 관계(§3.8 silent degradation), `MAX_VIEW_CAPTURE_FAILURES`(가설 3), pane당 최대 안전 Hz, 고빈도 `capture-pane`이 tmux 서버에 주는 실측 부하는 [[SPEC-007-test-validation]] 하니스로 측정해 확정한다(§3.1/§3.7/§3.8). 부하가 크면 주기를 늘리거나 changed-tail만 emit(§2.3)로 완화. **1차 실측(2026-07-02, 실 tmux 3.6b, 30줄 pane, `list-panes`+`capture-pane` 왕복)**: capture당 **p50≈10ms / p95≈36ms** — 250ms interval 대비 ~1/25로 백로그 여유 충분(단일 focused pane, MAX_ATTACH=1 기준). 다중 pane·대용량 scrollback 부하는 [[SPEC-007-test-validation]] 정식 하니스로 후속 확정.
- **Q2 — changed-tail vs full-window emit**: `pane_view`가 매 tick 전체 window를 보낼지, 직전 대비 변경 tail만 보낼지(대역폭 vs 렌더 정확도)는 측정으로 결정한다. 어느 쪽이든 redacted 버퍼 상에서만 diff한다(§3.4). **검토 필요.**
- **Q3 — 탭 가시성 전달 프레임**: MVP는 탭 hidden 시 client `view.detach`/visible 시 재-attach를 권장(§3.3)하나, 전용 가시성 프레임(`view.visibility`)이 더 깔끔한지 [[SPEC-203-terminal-workspace]]와 정합화가 필요하다. 어느 쪽이든 불변식 ④(hidden→폴링 중단)는 유지. **검토 필요.**
- **Q4 — 이전 orc 화면 LRU 캐시**: [[SPEC-203-terminal-workspace]]가 전환 체감을 위해 이전 pane의 마지막 화면을 client LRU로 잠깐 보존할 수 있다. 그 캐시 텍스트는 이미 redacted 프레임이므로 재-redaction은 불필요하나, 메모리 상한·만료는 SPEC-203이 소유한다(본 spec은 프레임이 이미 redacted임을 보장). **정합 확인.**
- **Q5 — Phase 1.5 styled 도입 시점 (RESOLVED 2026-07-03 — 형식 확정, 게이트는 SPEC-007 코퍼스 green 대기)**: styled 프레임의 **wire 형식은 §2.3.1로 확정**됐다 — `lines`(redacted plain)는 불변, 선택적 `spans: StyleSpan[][]`(`{start,end,sgr}`, UTF-16 반열림 offset, 정렬·비중첩, `sgr` MUST match `^[0-9;:]{1,SGR_MAX}$` with SGR_MAX=32)를 병렬 오버레이로 추가하며 raw escape byte는 wire에 실리지 않는다(AC-18~21). **unlock predicate**도 §3.4-3으로 확정: (a)[[SPEC-006-privacy-redaction]] §2.8 approved(충족) · (b)[[SPEC-007-test-validation]] `TC-M-STYLED` secret-recall==1.0==plain · (c)runtime self-check(styled redacted plain == plain 산출). 잔여는 (b) styled 코퍼스가 CI에서 green이 되는 것뿐이며, 그전까지 §3.4-2 plain fallback 고정(AC-06). 색 재현의 **저지연 개선**(control mode)은 Q6 forward.
- **Q6 — Phase 2 control-mode 확장(forward)**: 저지연(<100ms) push는 `tmux -C attach` 상주 브리지로 개선한다([[08-Decisions|D-041]] (c)). 그 브리지는 tmux 바이너리를 상주 attach하는 **새 subprocess 진입점**이라 `tmuxExec` allowlist 밖이므로, 브리지가 발행하는 명령을 **read-only sub-allowlist**(attach·refresh-client·subscribe류, `send-keys` 금지)로 별도 고정하는 sub-계약을 후속 SPEC이 소유해야 한다. 후속 소유자는 **`SPEC-104-control-mode-bridge`(제안 ID, 미생성)**로 name-placeholder한다(orchestrator가 ID 확정). 본 spec은 Phase 1(폴링) 계약만 확정하고 이를 **forward로 pre-flag**한다.
- **Q7 — 전역(연결 간) 동시 capture 상한(forward, P2)**: 본 계약은 **연결당** attach 1만 강제하고 여러 연결에 걸친 전역 capture budget은 두지 않는다(§3.8). MVP 단일 local client에선 무해하나, P2 multi-client(remote/team)에서는 tmux 서버 부하 폭주를 막을 전역 상한이 필요하다. [[SPEC-102-realtime-sync]] Q5(subscription scoping)와 함께 후속 슬라이스로 다룬다. **검토 필요(P2).**
- **Q8 — styled per-frame self-check·tokenize/style-remap hot-path 비용(측정)**: §3.4-3(c)의 **프레임마다** self-check(styled `lines` == steps 2–3 산출 element-wise 비교 + 모든 `sgr` charset/구조 검증)와 §2.8 tokenize→strip→redact→style-remap이 250–500ms 고빈도 경로에서 감당 가능한지 [[SPEC-007-test-validation]] styled 하니스([[SPEC-006-privacy-redaction]] §6 Q7/Q8 공동)로 측정한다. **원칙(확정)**: self-check는 정확성 tripwire이므로 비용이 크더라도 프레임 단위를 완화하지 않고, 필요하면 interval을 늘리거나 changed-tail(Q2)로 검사 범위를 줄이는 방향으로만 보정한다(검사 자체를 건너뛰지 않는다). **검토 필요.**
