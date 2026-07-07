---
spec: SPEC-104
title: Control-mode bridge — 저지연 live view 트리거(read-only sub-계약·fallback)
status: approved
updated: 2026-07-03
requirements: [R-API-007, R-PRIV-008, R-UI-012]
decisions: [D-047, D-048, D-049, D-052, D-053, D-041, D-042]
tags:
  - specs
  - realtime
  - terminal
  - live-view
  - control-mode
  - backend
  - epic-2
---

# SPEC-104 — Control-mode bridge (저지연 live view 트리거·read-only sub-계약·fallback)

Terminal Workspace([[18-Terminal-Workspace]] §4 Phase 2)는 focused pane의 갱신을 **<100ms 목표**로 push하는 저지연 채널을 forward로 남겨뒀다([[SPEC-103-pane-live-stream]] §6 Q6, [[08-Decisions|D-041]] (c)). 이를 실현하는 것이 `tmux -C attach` **상주 control-mode 브리지**다. 브리지는 tmux 바이너리를 상주 attach하는 **새 subprocess 진입점**이므로 [[SPEC-006-privacy-redaction]] §2.6 `tmuxExec`의 per-call READONLY_ALLOWLIST **밖**이며, 별도의 read-only 강제·수명주기·fallback 계약이 필요하다.

본 spec은 그 **브리지의 read-only sub-계약·수명주기·트리거 의미·백프레셔·audit의 SSOT**다:

- 브리지가 발행 가능한 명령을 고정하는 **`BRIDGE_COMMAND_ALLOWLIST`와 그 강제 지점**(브리지 stdin single-writer wrapper·fail-close) — [[08-Decisions|D-048]].
- `%output`/`%window-pane-changed`/`%layout-change`를 **dirty-signal로만** 소비하고 실제 프레임은 기존 [[SPEC-103-pane-live-stream]] capture 경로로 만드는 **HYBRID redaction 경계** — [[08-Decisions|D-047]], R-PRIV-008.
- 브리지 **수명주기**(spawn / crash·`%exit`·EOF / tmux-server-restart 감지 / backoff restart).
- **fallback 투명성**: 브리지와 interval 폴링이 **동일 `PaneViewSession`**을 먹여 트리거 소스만 바뀌므로 viewSeq 리셋·재-attach가 없음 — [[SPEC-103-pane-live-stream]] §6 Q6 해소.
- **coexist default**: Phase 1 폴링이 기본이고 브리지는 opt-in 저지연 최적화, 실패 시 silent degrade — [[08-Decisions|D-049]].
- 브리지 start/stop/fallback/crash **audit**(원문 비저장) — [[SPEC-600-observability]].

> **소유 경계**: 본 spec은 **브리지 프로세스·read-only sub-allowlist·트리거 소스 전환·수명주기·백프레셔·브리지 audit**을 소유한다. **live view 프레임(`pane_view_seed`/`pane_view`/`pane_view_end`)의 스키마·의미·`viewSeq` ordering·`PaneViewSession`·attach/detach 프로토콜·게이트**는 [[SPEC-103-pane-live-stream]], **`sanitizeCapture`/`sanitizeStyledCapture` chokepoint·redaction 카탈로그·`tmuxExec` allowlist**는 [[SPEC-006-privacy-redaction]], **WS 전송 봉투·프레임 카탈로그 등록**은 [[SPEC-102-realtime-sync]], **write 경로(`controlExec` send-keys)**는 [[SPEC-400-control-actions]]가 소유한다. 본 spec은 이들을 참조·재사용만 한다 — 프레임을 **새로 정의하지 않고** 기존 SPEC-103 프레임 생성을 **트리거만** 한다.

> **불변식(확정 — [[08-Decisions|D-047]]/[[08-Decisions|D-048]]/[[08-Decisions|D-049]] Accepted 2026-07-03)**: ① 브리지는 **정상 상태에서 tmux 명령을 전혀 발행하지 않는다** — 유효 **`BRIDGE_COMMAND_ALLOWLIST = ∅`(빈 집합, [[08-Decisions|D-048]])**. attach 후 stdin을 **열어둔 채**(§2.5 P1-D) `%*` notification만 읽고, 의도된 teardown 외에는 **어떤 명령 byte도 stdin에 쓰지 않는다**(§2.4). `send-keys`/`paste-buffer`/`set-*`/`kill-*`/`refresh-client`/`capture-pane`/`list-panes` 전부 금지 — `refresh-client -C`는 실제 window를 resize하고 `capture-pane`은 control-mode stdout으로 redaction chokepoint를 우회하기 때문이다(리뷰 실증, [[08-Decisions|D-048]]). ② `%output` **octal-escaped text payload**는 **어떤 프레임·로그·디스크에도 버퍼링·redact·emit되지 않는다** — dirty-signal로만 쓰이고 폐기되며(§2.3/§2.9), 프레임은 [[SPEC-103-pane-live-stream]] `capture-pane` 재-read → `sanitizeCapture`/`sanitizeStyledCapture` chokepoint를 통과한 값만 싣는다(HYBRID, [[08-Decisions|D-047]], §2.3). `%output`은 **절대 `redact()`·logger·debug sink에 전달되지 않는다**(§2.9 P1-H). ③ 브리지 유무는 **client-visible 프레임을 바꾸지 않는다** — 트리거 소스가 폴링이든 브리지든 프레임은 byte-동일하고 `viewSeq`는 단조를 유지하며 re-attach가 필요 없다(§2.5, §2.6). ④ 브리지 위반·crash·`%exit`·tmux 재시작·읽기 EOF·prolonged `%pause`(staleness)는 **브리지 종료/해제 → SPEC-103 interval 폴링으로 silent fallback**을 트리거하고 client는 무변경이다(§2.5, §2.8, [[08-Decisions|D-049]]). ⑤ 기본 트리거 소스는 **폴링(SPEC-103)**이고 브리지는 opt-in이다([[08-Decisions|D-049]]). ⑥ 브리지 client는 **size-neutral**이다 — control-client `ignore-size`로 attach하고 **크기를 절대 보내지 않는다**(§2.2 P1-C, `ignore-size` 미지원 → 폴링 degrade).

## 1. Scope

### In scope

- 브리지 **프로세스 계약**: fixed argv·`shell:false`·read-only attach(`-r`, 지원 시)·상주 stdin single-writer(§2.2, §2.4).
- **`BRIDGE_COMMAND_ALLOWLIST`**와 fail-close 강제(§2.4, [[08-Decisions|D-048]]).
- **HYBRID 트리거 의미**: `%output`/`%window-pane-changed`/`%layout-change` → dirty-set → debounced capture(§2.3, [[08-Decisions|D-047]]).
- **수명주기**: spawn / EOF·`%exit`·crash 감지 / tmux-server-restart 감지 / backoff restart(§2.5).
- **fallback 투명성**: 동일 `PaneViewSession` 위 트리거 소스 전환, viewSeq 비리셋·재-attach 불필요(§2.6, [[SPEC-103-pane-live-stream]] §6 Q6 해소).
- **coexist default·opt-in**: 기본 폴링, 브리지 opt-in, 실패 시 silent degrade(§2.7, [[08-Decisions|D-049]]).
- **백프레셔**: `%output` 폭주 → pane당 pending capture at-most-one coalesce + min-interval floor(§2.8).
- 브리지 **audit**: start/stop/fallback/crash 관측(§2.9, 원문 비저장).

### Out of scope (다른 spec으로)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| live view 프레임 스키마·`viewSeq`·attach/detach 프로토콜·게이트·seed/cursor | 채널 계약 | [[SPEC-103-pane-live-stream]] |
| `sanitizeCapture`/`sanitizeStyledCapture` chokepoint·redaction 카탈로그·`-e` 파이프라인·`tmuxExec` allowlist | privacy·read-only 메커니즘 | [[SPEC-006-privacy-redaction]] |
| WS 봉투·프레임 카탈로그 등록·close code | WS 전송 | [[SPEC-102-realtime-sync]] |
| write 경로(`controlExec` send-keys 3 템플릿) | control(write) | [[SPEC-400-control-actions]] |
| xterm.js 렌더·스위칭·관전/조종 UX | terminal workspace UX | [[SPEC-203-terminal-workspace]] |
| 폴링 주기·`PANE_VIEW_INTERVAL_MS`·부하 한도 값 | Phase 1 폴링 정책 | [[SPEC-103-pane-live-stream]] |

## 2. Contract

### 2.1 개요 — 브리지는 프레임을 만들지 않고 트리거만 한다 (HYBRID, [[08-Decisions|D-047]])

- 브리지는 tmux control-mode(`tmux -C`)로 상주 attach해 tmux가 push하는 **notification 이벤트**(`%output` 등 `%*` 라인)를 읽는다. 이 이벤트는 "어떤 pane이 방금 바뀌었다"는 **dirty-signal로만** 쓴다. **브리지는 정상 상태에서 tmux 명령을 전혀 발행하지 않는다**(§2.4, 유효 allowlist=∅) — attach 후 stdin을 열어둔 채 notification만 소비한다(리뷰 실증: stdin을 열어두고 attach하면 명령 없이 `%output`이 스트리밍된다).
- 실제 live view 프레임은 여전히 [[SPEC-103-pane-live-stream]] §2.5 경로 — `list-panes`(geometry+cursor) → `capture-pane -p`(Phase 1) / `capture-pane -p -e`(Phase 1.5) → `sanitizeCapture`/`sanitizeStyledCapture` chokepoint → 동일 `pane_view_seed`/`pane_view`/`pane_view_end` 프레임 — 으로 만든다. 이 capture는 전부 [[SPEC-103-pane-live-stream]] `tmuxExec` 경로이며 **브리지 stdin이 아니다**(브리지는 capture를 발행하지 않는다). 브리지의 유일한 차이는 폴링 tick의 **트리거를 fixed-interval에서 event-triggered(debounced)로 바꾸는 것**뿐이다.
- 따라서 **redaction chokepoint와 §2.3.1 wire 계약은 완전히 불변**이다. `%output`의 **payload(tmux octal-escaped text — raw byte가 아니라 `\NNN` octal escape로 인코딩된 텍스트)**는 프레임에 버퍼링·redact·emit되지 않는다(불변식 ②). `%output`이 secret을 chunk 경계에서 쪼개도(예: `ghp_` + chunk 경계 + 나머지) 브리지는 그 payload를 **콘텐츠로 소비하지 않으므로**(prefix만 파싱, 나머지는 버퍼링 없이 폐기 — §2.3 P1-E) secret-split-at-chunk-boundary 위험이 구조적으로 없다 — 프레임은 tmux가 이미 재조립한 pane 화면을 [[SPEC-103-pane-live-stream]] `capture-pane`으로 다시 읽어 만든다.

### 2.2 브리지 프로세스 계약 (read-only 진입점·size-neutral, [[08-Decisions|D-048]])

```ts
// 브리지 spawn 인자(개념). 값·플랫폼 분기는 구현 소유이나 아래 제약은 확정 골격.
interface BridgeSpawnContract {
  bin: 'tmux';
  // 고정 argv. socket specifier(-L/-S)는 tmuxExec와 동일해야 한다(P1-F).
  //   예: [ ...socketArgs, '-C', 'attach-session', '-t', <sessionTarget>, '-f', 'ignore-size,no-detached-on-destroy'... ]
  socketArgs: string[];    // = tmuxExec가 쓰는 -L <name> 또는 -S <path> 그대로(P1-F, 공유 config authority)
  argv: string[];          // 위 socketArgs + 고정 attach argv
  shell: false;            // 셸 미경유(injection 차단, [[SPEC-400-control-actions]] §2.1 정신 재사용)
  sizeNeutral: 'ignore-size'; // control-client ignore-size 로 attach — 크기를 절대 보내지 않는다(P1-C). NOT `-r`.
}
```

- **fixed argv·`shell:false`(확정 골격)**: 브리지 argv는 사용자 입력으로 조립되지 않는 고정 형태다. `<sessionTarget>`은 구조 식별자(session id, `/^[$]\d+$/` 또는 세션명 — §2.4 (iii) strict 검증)로만 치환된다. **fixed-argv/`shell:false`는 SPAWN 경로만 보호하는 필요조건이며 충분조건이 아니다** — 상주 **stdin line 채널**도 동일한 no-injection 부담을 진다(§2.4 P0-B).
- **socket target 공유(확정, P1-F)**: 브리지 fixed argv는 [[SPEC-006-privacy-redaction]] §2.6 `tmuxExec`가 쓰는 **동일한 `-L <name>`/`-S <path>` socket specifier**를 반드시 실어야 한다(공유 config authority). 그렇지 않으면 기본/다른 tmux 서버에 attach해 엉뚱한 서버를 본다.
- **size-neutral(확정, P1-C — `-r` 아님)**: 브리지 client는 실제 window 크기를 **절대 바꾸지 않아야** 한다. `-r`(read-only client)는 **키보드 입력만 막고 크기 협상은 막지 않는다** — 따라서 부적합하다. 대신 control-client **`ignore-size`**(client flag)로 attach해 이 client의 크기가 window 크기 계산에 참여하지 않게 한다. 브리지는 **어떤 size도 보내지 않는다**(`refresh-client -C <WxH>` 금지, §2.4). `ignore-size` 미지원 tmux 버전은 **capability-degrade → 폴링**한다(§2.7). PoC 검증: attach가 `#{window_width}x#{window_height}`를 바꾸지 않고 `%layout-change`를 유발하지 않아야 한다(AC-10).
- **read-only 방어선 = stdin 강제(확정)**: read-only 불변식의 **1차·유일 방어선은 §2.4 stdin single-writer(allowlist=∅)**다 — `-r`/`ignore-size`는 편의·정확성 플래그일 뿐 보안 방어선이 아니다(버전 편차에도 stdin 강제가 성립).
- **상주(resident)**: 브리지는 attach 세션당 상주하며 stdout으로 control-mode notification 스트림을 읽는다. **stdout(raw control-mode 스트림)은 어떤 log/debug sink에도 쓰지 않는다**(§2.9 P2). stdin은 정상 상태에서 **명령 byte 0**이며 열린 채 유지된다(§2.5 P1-D).
- **attach의 비-콘텐츠 side effect 인지(확정, P2)**: control-mode attach는 콘텐츠를 노출하지 않지만 **관측 가능한 비-콘텐츠 side effect**가 있다 — client-attach hook(`client-attached` 등) 발화, `#{session_attached}`/`#{session_many_attached}` 증가, `destroy-unattached on` 세션이 브리지 attach로 **살아남음**. 이들은 redaction·read-only 위협이 아니지만 사용자 환경에 관측되므로 문서화한다(§6 Q6). 브리지는 이 side effect를 최소화하되(필요한 attach만) 제거할 수는 없다.
- **리소스 계약(§6 Q1 forward)**: 브리지 프로세스 수(1 고정 / tmux 서버당 / attach당)와 memory 상한은 §6 Q1에서 판정한다. MVP 골격은 **연결당 동시 attach 1**([[SPEC-103-pane-live-stream]] §3.1) 위에서 브리지도 그 focused pane만 관심 pane으로 삼는다.

### 2.3 트리거 의미 — subscription → dirty-set → triggered capture ([[08-Decisions|D-047]])

- 브리지는 control-mode stdout에서 아래 notification을 읽어 **dirty-set**(변경된 paneId 집합)에 표시한다. **각 notification은 verb·target id만 파싱하고 payload는 소비하지 않는다**(정확한 semantics는 리뷰 실증 반영):
  - **`%output %<pane> <octal-escaped text>`**: 해당 pane에 출력이 있었다는 신호. payload(tmux **octal-escaped text**)는 **prefix(`%output %<pane>`)만 파싱하고 나머지는 버퍼링 없이 폐기**한다(§2.1, P1-E). 표시하는 것은 `%<pane>`(dirty)뿐이다.
  - **`%window-pane-changed @<win> %<pane>`**: = **active-pane-changed(focus 전환)** 신호(geometry 아님) → 그 window의 새 active pane을 dirty로 표시.
  - **`%layout-change @<win> …`**: = **window-scoped** 레이아웃 변경(pane geometry일 수 있음) → 그 window의 **모든 pane**을 dirty로 표시(단일 pane이 아님). 다음 capture가 새 `cols`/`rows`를 싣는다([[SPEC-103-pane-live-stream]] §3.6).
  - **`%pane-mode-changed %<pane>`**: pane mode 진입/이탈(copy-mode 등) → 해당 pane dirty.
- **triggered capture(확정 골격)**: dirty-set에 현재 attach된 focused pane이 있으면, 브리지는 debounce 후 §2.5 **단일 capture scheduler**를 통해 [[SPEC-103-pane-live-stream]] §2.5 capture 1회를 트리거한다. 그 결과가 `PaneViewSession`으로 흘러 다음 `pane_view` 프레임이 된다. dirty-set은 capture 트리거 시 소거한다.
- **bounded stdout reader(확정, P1-E)**: 브리지 stdout reader는 **`%output` 한 라인 전체를 메모리에 버퍼링하지 않는다** — busy pane의 단일 burst는 임의로 긴 octal-escaped **한 라인**이라(멀티-MB 스파이크 가능) 전체 라인 버퍼링은 금지다. reader는 `%<verb> <id>` prefix를 읽어 dirty를 표시한 뒤 그 라인의 나머지를 **버퍼 없이 소진(drain)**하고 다음 라인으로 진행한다. 어떤 payload byte도 축적되지 않는다.
- **flow control(확정, tmux 3.2+, P1-E)**: tmux control-mode flow control을 처리한다 — **(a) 비활성화**하거나(브리지가 output을 소비만 하므로), (b) `%pause`/`%continue`를 처리한다. **prolonged `%pause`는 staleness 조건**으로 간주해 폴링으로 degrade한다(§2.8) — 그렇지 않으면 dirty 신호가 조용히 끊겨 화면이 감지 없이 stale해진다.
- **debounce·min-interval(§2.8)**: 연속 `%output` 폭주에도 capture는 pane당 pending at-most-one이며 min-interval floor 아래로는 트리거하지 않는다(백프레셔).
- **비-focused pane 신호(확정)**: attach된 focused pane이 아닌 pane의 신호는 dirty-set에 남기되 capture를 트리거하지 않는다(연결당 attach 1, [[SPEC-103-pane-live-stream]] §3.1). focused pane이 바뀌면(예 `%window-pane-changed`) 새 attach가 seed를 다시 만든다.

### 2.4 read-only 강제 — allowlist=∅ · stdin line-granular fail-close ([[08-Decisions|D-048]], P0-A/P0-B)

브리지의 read-only 방어선은 **브리지 child stdin에 쓰이는 line 채널**이다. control-mode stdin은 **newline/`;`-구분 텍스트 채널**이므로, verb만 검사하면 조작된 인자(pane/window/session 이름·OSC title이 newline/`;`/control byte를 품을 수 있음)가 **검사되지 않은 두 번째 라인**(예 `send-keys`)을 주입할 수 있다. 따라서 강제는 **line 단위**이며 아래를 확정한다.

```ts
// 유효 allowlist = ∅ (빈 집합). MVP 브리지는 정상 상태에서 어떤 tmux 명령도 발행하지 않는다.
const BRIDGE_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set(); // ∅ — 비어 있음(P0-A)

// 영구 금지(확정 경계) — 브리지 stdin에 절대 쓰지 않는다. (아래는 예시이며 allowlist=∅이므로 전부 자동 금지)
//   refresh-client  — `-C <WxH>`가 실제 window를 resize함(리뷰 실증: 200x50→80x24 + %layout-change + SIGWINCH) → read-only 위반
//   capture-pane    — 산출을 control-mode stdout으로 반환해 sanitizeCapture chokepoint를 우회함 → redaction bypass
//   list-panes/list-windows — 필요 없음(geometry는 [[SPEC-103-pane-live-stream]] tmuxExec 경로가 취득)
//   send-keys/paste-buffer/set-*/kill-*/run-shell/if-shell/respawn-*/new-*/split-*/resize-* — 명백한 write
```

- **P0-A — 유효 allowlist=∅(확정, [[08-Decisions|D-048]])**: MVP 브리지는 **어떤 tmux 명령도 발행하지 않는다**. `refresh-client`·`capture-pane`·`list-panes`를 포함해 **전부 제외**한다 — `refresh-client -C <WxH>`는 실제 window를 resize하고(read-only BROKEN, 리뷰가 tmux 3.6b에서 실증), `capture-pane`은 control-mode stdout으로 산출을 반환해 **`sanitizeCapture` chokepoint를 우회**한다(redaction BYPASS, 리뷰 실증). 둘 다 **verb-only allowlisting을 통과하지만** state/redaction 불변식을 깬다. 리뷰 실증대로 stdin을 열어둔 채 attach하면 **명령 없이 `%output`이 스트리밍**되므로, MVP는 명령이 필요 없다. **향후 명령 추가는 flag-level 검증 + 새 결정**을 요구한다(예: `refresh-client -B name:what:format` read-only subscription — 단 `-B`는 redraw cadence로 발화해 <100ms `%output` 대체가 아님, §6 Q5).
- **P0-B(i) — child stdin handle은 wrapper 전용(확정, 구조적 sole-writer)**: 브리지 child의 stdin file handle은 **single-writer wrapper 모듈에만 보관**되고 **다른 어떤 모듈도 그 handle에 쓸 수 없다**([[SPEC-006-privacy-redaction]] §2.6 "sole entry point, no other module writes it"의 동형 — 브리지 stdin 판). allowlist=∅ MVP에서 wrapper는 **teardown 시퀀스(의도된 detach) 외에는 어떤 byte도 쓰지 않는다**.
- **P0-B(ii) — 관측/비신뢰 문자열 비-보간(확정)**: pane id·window/session 이름·pane title 등 **tmux가 관측해 반환한 문자열을 stdin line에 절대 보간하지 않는다**. (브리지가 명령을 안 쓰므로 보간 대상 자체가 없다 — 이 규칙은 향후 명령 추가 시에도 불변 제약이다.)
- **P0-B(iii) — id 인자 strict 검증(확정)**: 만약 향후 id 인자를 stdin line에 실어야 하면, pane id는 **`/^%\d+$/`**, session/window id는 **`/^[$@]\d+$/`**를 MUST match하고 **newline/`;`/control byte를 포함하면 거부**한다. 어긋나면 fail-close.
- **P0-B(iv) — SPAWN 보호 ≠ stdin 보호(확정)**: fixed-argv/`shell:false`(§2.2)는 **spawn 경로만** 보호하는 필요조건이다. 상주 **stdin line 채널**은 동일한 no-injection 부담을 별도로 진다 — 위 (i)~(iii)가 그 부담을 진다.
- **강제 = line-granular fail-close(확정)**: wrapper는 stdin에 쓰이는 **각 line**을 검사한다. allowlist=∅이므로 **어떤 명령 line도 통과하지 못한다**(teardown 제외). 위반(비-allowlist verb·newline-주입 second line·strict-pattern 불일치 id)이 있으면 **그 byte를 쓰지 않고 브리지를 즉시 종료해 §2.5 fallback**을 트리거한다(AC-01). 강제의 최강 형태(allowlist=∅)는 "**spawn 이후 stdin은 teardown 외 명령 byte 0**"의 assertion이다(AC-09).
- **write 전면 금지(확정)**: 모든 write는 여전히 [[SPEC-400-control-actions]] `controlExec`(단일 writer)로만 나간다([[08-Decisions|D-019]]/[[08-Decisions|D-041]] 불변식 유지). 브리지는 write 경로가 아니다.

### 2.5 수명주기 — spawn·stdin-open·crash·restart·단일 scheduler·fallback

- **spawn(확정 골격)**: 브리지 opt-in([[08-Decisions|D-049]])이 켜지고 focused pane에 attach가 성립하면 브리지를 spawn한다. spawn 실패면 즉시 폴링 fallback(§2.7).
- **stdin OPEN for life(확정, P1-D)**: 브리지는 attach 수명 동안 child stdin을 **열어둔 채 유지**한다 — **stdin EOF는 tmux가 즉시 `%exit`/detach로 해석**한다(리뷰 실증). 따라서 (i) stdin을 실수로 닫으면 브리지가 죽고, (ii) **의도된 self-close(teardown)와 death를 구별**한다 — 의도된 close는 정상 종료(fallback 없이 브리지 정지), 예기치 않은 death는 §2.7 fallback을 트리거한다. allowlist=∅이므로 stdin은 열려 있으나 **byte 0**이다(§2.4).
- **종료 감지(확정)**: 아래 중 하나면 브리지를 **죽은 것으로 간주**한다 — (a) stdout **EOF**(브리지 프로세스 exit), (b) control-mode **`%exit`** notification(tmux client detach/서버 종료), (c) spawn된 프로세스 **crash/non-zero exit**, (d) §2.4 fail-close(비-allowlist stdin line 시도), (e) control-mode 프로토콜 파싱 불가(malformed), (f) **prolonged `%pause`**(flow-control staleness, §2.3/§2.8).
- **tmux-server-restart 감지(확정)**: `%exit` 또는 EOF 후 재-attach 시 tmux 서버가 재시작됐을 수 있다. 브리지는 재-attach를 **backoff**로 시도하되, 재시작으로 pane identity가 달라지면 그 판정은 다음 [[SPEC-103-pane-live-stream]] capture의 target-row 매칭(§2.5)·`pane_gone` 처리에 위임한다(브리지는 pane identity를 재정의하지 않는다).
- **backoff restart(확정 골격)**: 브리지 재기동은 지수 backoff로 시도하며, 재기동 시도 중에도 live view는 **폴링으로 무중단 유지**된다(fallback이 우선, 브리지는 복귀 시 다시 트리거 소스가 된다). backoff 상한·시도 횟수는 §6 Q1 가설.
- **단일 capture scheduler·atomic source handoff(확정, P1-G)**: `PaneViewSession`당 **capture scheduler는 정확히 하나**이며 두 트리거 소스(interval poll·bridge `%output`)가 그 **동일한 at-most-one-pending/coalesce 게이트**(§2.8)를 통해 capture를 요청한다. 트리거 소스는 **상호 배타적으로 arm**된다 — **브리지 arm 시 폴링 timer를 disarm**하고 그 반대도 성립(atomic handoff). 이로써 mid-attach 복구 시 (i) 이중 트리거가 없고 (ii) poll-started capture가 bridge-started capture 뒤에 늦게 끝나 stale 결과가 최신을 덮는 일이 없다(stale-wins 방지: scheduler는 stale in-flight 결과를 버린다)(AC-11).
- **모든 death → silent fallback(확정, [[08-Decisions|D-049]])**: 위 (a)~(f) 어느 것이든 **트리거 소스를 즉시 폴링으로 atomic 전환**한다(폴링 timer re-arm). client는 어떤 프레임 변화·재-attach·에러도 보지 않는다(§2.6). fallback은 §2.9 audit으로만 관측된다.

### 2.6 fallback 투명성 — 동일 `PaneViewSession`, viewSeq 비리셋 ([[SPEC-103-pane-live-stream]] §6 Q6 해소)

- **단일 세션(확정)**: 브리지 트리거와 interval 폴링은 **같은 [[SPEC-103-pane-live-stream]] `PaneViewSession`**을 먹인다. 트리거 소스(브리지 event vs interval timer)는 **capture를 언제 실행할지**만 정하고, capture→sanitize→프레임 생성·`viewSeq` 증가·전송은 전부 SPEC-103 세션 로직이 소유한다.
- **viewSeq 비리셋·재-attach 불필요(확정)**: 브리지↔폴링 트리거 소스 전환은 attach를 새로 만들지 않는다 — `pane_view_seed`를 다시 보내지 않고, `viewSeq`는 전환 지점을 가로질러 **단조 +1을 유지**한다(seed=0 리셋 없음). 즉 [[SPEC-103-pane-live-stream]] §6 Q6("fallback 시 viewSeq/재-attach 의미")를 **"트리거 소스만 바뀌고 세션·viewSeq·seed는 그대로"**로 해소한다(AC-03).
- **프레임 byte-동일(확정, R-PRIV-008)**: 같은 pane 상태에 대해 브리지-트리거 프레임과 폴링-트리거 프레임은 **byte-동일**하다 — 둘 다 동일 `capture-pane` + 동일 chokepoint를 통과하기 때문이다. 브리지는 프레임 콘텐츠에 어떤 필드도 더하지 않는다(불변식 ②/③, AC-02).

### 2.7 coexist default — 기본 폴링, 브리지 opt-in ([[08-Decisions|D-049]])

- **기본값 = 폴링(확정)**: Phase 2 브리지는 Phase 1 폴링을 **대체하지 않고 공존**한다. 기본 트리거 소스는 [[SPEC-103-pane-live-stream]] interval 폴링이며, 브리지는 **opt-in 저지연 최적화**다.
- **opt-in 게이트 = 설정 키(확정, [[08-Decisions|D-052]], §6 Q2 RESOLVED)**: 브리지 활성화는 [[SPEC-500-settings-persistence]] §2.2 config 키 **`liveViewBridge: boolean`(top-level, 기본 `false`)**로 판정한다. 유효 게이트 = `deps.spawnBridge` 존재 **AND** (`settings.liveViewBridge === true` **OR** `deps.liveViewBridge === true`) — deps 플래그는 **테스트 전용 오버라이드**로 존치한다. 설정은 **attach 시점마다 live-read**하며 attach 중 토글은 **다음 attach부터** 적용된다(진행 중 attach를 강제 종료하지 않음, [[SPEC-500-settings-persistence]] §2.7 정신). **capability 자동 감지로 켜지 않는다**([[08-Decisions|D-049]] default=polling 유지 — 미지원 tmux에서는 브리지 사망→무음 폴백이 안전망).
- **degrade는 항상 안전(확정)**: 브리지가 꺼져 있거나(opt-out) 실패하면(§2.5) live view는 폴링으로 완전 동작한다 — 브리지는 **정확성이 아니라 지연에만** 관여한다. 어떤 브리지 장애도 데이터 손실·에러 표면·재-attach를 만들지 않는다(§2.6).
- **capability 미충족 시(확정, P1-C 포함)**: 아래 중 하나면 브리지를 시도조차 하지 않거나 즉시 폴링으로 degrade한다(fallback과 동일한 client-무변경) — (i) tmux가 control-mode(`-C`)를 미지원, (ii) **`ignore-size` client flag 미지원**(size-neutral attach 불가 → window resize 위험이라 브리지 금지, §2.2 P1-C), (iii) spawn 불가, (iv) socket specifier 불일치. 이 판정은 브리지 arm 전에 수행한다.

### 2.8 백프레셔 — `%output` 폭주 coalesce + min-interval floor ([[SPEC-103-pane-live-stream]] §3.8 정신 재사용)

- **pane당 pending capture at-most-one(확정)**: `%output`이 폭주해도 브리지는 pane당 **최대 1개의 pending capture**만 유지한다 — dirty 표시가 이미 있으면 새 신호는 표시만 갱신하고 capture를 추가로 쌓지 않는다(coalesce-to-latest, [[SPEC-103-pane-live-stream]] §3.8 WS-send backpressure와 정합).
- **min-interval floor(확정 골격, 값 가설)**: 트리거된 capture는 pane당 `BRIDGE_MIN_CAPTURE_INTERVAL_MS`(가설, [[SPEC-103-pane-live-stream]] §3.1 `PANE_VIEW_INTERVAL_MS`보다 작되 0 아님) 아래로는 발화하지 않는다 — 이로써 (i) 지연이 <100ms로 bound되면서도 (ii) tmux 서버 capture 부하가 상한으로 capped된다(가설 수치는 §6 Q1/[[SPEC-007-test-validation]]).
- **실행 격리 계승(확정)**: 브리지-트리거 capture도 [[SPEC-103-pane-live-stream]] §3.8 실행 격리(live capture 큐 ↔ scan 큐 분리)를 그대로 상속한다. 브리지 event 처리(notification 파싱)와 capture 실행은 §2.5 단일 scheduler를 통해 분리되어, 느린 capture가 notification 수신을 막지 않는다.
- **`%pause` staleness → 폴링 degrade(확정, P1-E)**: tmux flow control(3.2+)에서 `%pause`가 지속되면 `%output` dirty 신호가 조용히 끊긴다 — 브리지가 이를 감지 못하면 화면이 **감지 없이 stale**해진다. 따라서 **prolonged `%pause`(임계 §6 Q1 가설)를 staleness 조건**으로 보고 §2.5 death(f)로 처리해 폴링으로 degrade한다(폴링은 dirty 신호에 의존하지 않으므로 stale을 만들지 않는다).

### 2.9 audit — 브리지 상태 전이 관측 (원문 비저장)

- 브리지 **start / stop / fallback / crash / restart**는 [[SPEC-600-observability]] `ActivityEvent`(또는 debug log)로 관측 가능해야 한다 — 운영자가 "지금 저지연 브리지가 동작 중인가, 폴링으로 degrade됐는가"를 판정할 수 있게. taxonomy·code 등록은 [[SPEC-600-observability]] 소유이며 본 spec은 **producer 매핑**만 제안한다(§6 C2 정합).
- **원문 비저장(확정, 불변식 ②)**: 브리지 audit은 상태 전이·사유(machine code)·pane 구조 식별자(paneId)만 담는다. `%output` payload·capture 콘텐츠·token은 **어떤 필드에도 직렬화하지 않는다**([[SPEC-006-privacy-redaction]] §2.5, [[SPEC-600-observability]] §2.7, [[08-Decisions|D-028]] non-storage).
- **parse-error 진단 = structural facts only(확정, P1-H)**: malformed notification·프로토콜 파싱 오류를 진단으로 남길 때 **구조적 사실(verb·length·byte offset)만** 기록하고 **`%output` payload byte는 절대 담지 않는다**. `%output` payload는 **`redact()`·어떤 logger·debug sink에도 전달되지 않는다**.
- **raw control-mode stdout 스트림 비-로깅(확정, P2)**: 브리지가 읽는 raw control-mode stdout 스트림은 **어떤 log/debug sink에도 기록하지 않는다**(payload가 그 스트림에 섞여 있으므로). 디버깅이 필요하면 structural fact(verb·offset·length)만 남긴다.
- **`doctor` 진단(확정, [[08-Decisions|D-053]], §6 Q3 RESOLVED)**: `doctor`([[SPEC-100-server-lifecycle]])는 브리지를 **정적 capability + 설정값만** 진단한다 — [[SPEC-600-observability]] §2.9 `DoctorDiagnostics.bridge` 블록 `{ enabled(설정값), tmuxVersion, controlModeSupported, socketArgs }`(정보 전용, **exit code 무영향**). `controlModeSupported`는 `tmux -V` 파싱 성공 && `ignore-size` 지원 버전(≥3.2) 기준이며 파싱 실패 시 false + detail로 fail-safe한다. **런타임 fallback 이력은 doctor 범위 밖** — 이미 `control.bridge_fallback` audit 이벤트로 조회 가능하므로 중복 노출하지 않는다.

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다([[SPEC-000-conventions]]).

1. **트리거만·프레임 불생성(확정)**: 브리지는 `pane_view*` 프레임을 만들지 않고 [[SPEC-103-pane-live-stream]] capture를 트리거만 한다. 프레임 생성·`viewSeq`·전송은 SPEC-103 소유(§2.1/§2.6, AC-02/AC-08).
2. **`%output` payload=dirty-signal only(확정)**: octal-escaped text payload는 콘텐츠로 소비·버퍼링(전체 라인 버퍼 금지)·redact·emit되지 않고 prefix만 파싱 후 폐기된다(§2.1/§2.3, AC-02/AC-08, [[08-Decisions|D-047]]).
3. **allowlist=∅ · stdin line fail-close(확정)**: 브리지는 정상 상태에서 tmux 명령을 전혀 발행하지 않는다(유효 allowlist=∅). stdin은 wrapper 전용 handle이며 비-allowlist line(newline-주입 second line 포함) 시도 시 브리지 종료→폴링 fallback(§2.4, AC-01, [[08-Decisions|D-048]]).
4. **write 없음·refresh-client/capture-pane 금지(확정)**: `refresh-client -C`(resize)·`capture-pane`(chokepoint 우회)를 포함해 어떤 명령도 stdin에 쓰지 않는다. write는 [[SPEC-400-control-actions]] `controlExec`만(§2.4, AC-01/AC-09).
5. **size-neutral(확정)**: `ignore-size`로 attach하고 크기를 절대 보내지 않는다(`-r` 아님). 미지원 → 폴링 degrade(§2.2/§2.7, AC-10, P1-C).
6. **socket 공유(확정)**: 브리지 argv는 `tmuxExec`와 동일 `-L`/`-S` socket specifier를 싣는다(§2.2, P1-F).
7. **fallback 투명·단일 scheduler(확정)**: 트리거 소스 전환은 viewSeq 비리셋·재-attach 불필요·프레임 byte-동일이고, 두 소스가 단일 scheduler를 통해 atomic handoff된다(stale-wins 방지)(§2.5/§2.6, AC-03/AC-11).
8. **stdin OPEN for life(확정)**: attach 수명 동안 stdin을 열어두며 의도된 self-close와 death를 구별한다(§2.5, P1-D).
9. **bounded reader·flow control(확정)**: 전체 라인 버퍼 금지·prefix drain, `%pause` staleness → 폴링 degrade(§2.3/§2.8, P1-E).
10. **coexist·default polling(확정)**: 기본 폴링, 브리지 opt-in, 실패 시 silent degrade(§2.7, AC-05, [[08-Decisions|D-049]]).
11. **백프레셔 coalesce(확정)**: pane당 pending capture at-most-one + min-interval floor(§2.8, AC-07).
12. **audit·진단 원문 비저장(확정)**: 브리지 상태 전이·structural fact만 관측; `%output` payload·capture 콘텐츠·token·raw stdout 스트림은 log/sink·`redact()`에 비전달(§2.9, P1-H).
13. **상수(가설)**: `BRIDGE_MIN_CAPTURE_INTERVAL_MS`·backoff 상한·재기동 시도 횟수·`%pause` staleness 임계·<100ms 지연 목표·브리지 프로세스 수/memory 상한은 모두 **PoC 검증 가설**이며 [[SPEC-007-test-validation]] 하니스로 보정한다(§6 Q1).

## 4. Acceptance criteria

> token/secret 예시는 placeholder를 쓴다([[SPEC-000-conventions]]). "폴링 경로" = [[SPEC-103-pane-live-stream]] interval capture. "브리지 경로" = 본 spec event-triggered capture.

```text
SPEC-104-AC-01 (R-API-007 / [[08-Decisions|D-048]])  [line-granular fail-close · allowlist=∅ — stdin 채널 관측]
  Given 상주 control-mode 브리지가 동작 중이고 그 child stdin 에 쓰인 모든 byte 를 관측할 때
  When (a) 정상 운영 동안, 그리고 (b) 비-allowlist verb 명령(예 send-keys)을 stdin 에 쓰려 하거나
       (c) pane/window/session 이름·title 에 newline/`;`/control byte 를 심어 두 번째 라인(예 send-keys)을 주입하려 하면
  Then (a) 정상 운영 동안 stdin 에는 teardown 외 어떤 명령 byte 도 기록되지 않고(유효 allowlist=∅),
       (b)/(c) 어떤 위반 line 도 stdin 에 기록되지 않고(line-granular fail-close) 브리지가 즉시 종료되어 폴링 fallback 이 트리거되며,
       관측된 stdin line 은 verb-only 가 아니라 line 전체가 검사되어 newline-주입 second line 이 통과하지 못한다.
```

```text
SPEC-104-AC-02 (R-PRIV-008 / [[08-Decisions|D-047]])  [redaction-unchanged · no %output payload in frame/log]
  Given 어떤 pane 의 %output 이 secret(예: ghp_<token>)을 chunk 경계에서 쪼개 전달할 때
  When 브리지가 그 %output 을 dirty-signal 로 소비해 capture 를 트리거하고 프레임이 생성되면
  Then (a) 그 프레임의 lines 는 폴링 경로와 동일한 sanitizeCapture/sanitizeStyledCapture chokepoint 를 통과한 값이고
           ghp_<token> literal 은 어떤 프레임 필드에도 나타나지 않으며([REDACTED:*] 로 대체),
       (b) %output 의 octal-escaped text payload 는 어떤 프레임·로그·debug sink·redact() 입력에도 전달/버퍼링/직렬화되지 않았고
           (reader 는 %output %<pane> prefix 만 파싱하고 나머지 라인을 버퍼 없이 drain),
       (c) 같은 pane 상태에 대해 브리지-트리거 프레임과 폴링-트리거 프레임이 byte-동일하다.
```

```text
SPEC-104-AC-03 (R-API-007 / [[08-Decisions|D-049]])  [fallback 투명 — viewSeq 단조·재-attach 없음]
  Given 브리지 경로로 live view 가 흐르는 attach 중(직전 프레임 viewSeq=k)에
  When 브리지가 crash/%exit/EOF/fail-close 로 종료되어 폴링으로 fallback 되면
  Then 같은 PaneViewSession 이 유지되어 pane_view_seed 가 재전송되지 않고(재-attach 없음),
       다음 폴링-트리거 pane_view 의 viewSeq 는 k+1 로 단조 연속이며, client 는 어떤 에러/재-attach 도 관측하지 않는다.
```

```text
SPEC-104-AC-04 (R-API-007)  [<100ms 지연 목표 — 측정 가설]
  Given 브리지 경로가 활성인 focused pane 에서
  When pane 에 출력이 발생한 시점부터 대응 pane_view 프레임이 client 에 도달한 시점까지의 지연을
       [[SPEC-007-test-validation]] 하니스로 측정하면
  Then 지연 중앙값이 <100ms 목표에 대해 보고되고(가설), 폴링 경로(250–500ms)보다 낮음이 확인된다
       (임계는 §6 Q1 측정으로 확정 — 미달 시 브리지는 정확성 손상 없이 폴링과 동일 결과를 낸다).
```

```text
SPEC-104-AC-05 (R-API-007 / [[08-Decisions|D-049]])  [coexist default — polling]
  Given 브리지 opt-in 이 꺼져 있거나 tmux control-mode 가 미지원인 환경에서
  When live view attach 가 성립하면
  Then live view 는 [[SPEC-103-pane-live-stream]] 폴링만으로 완전 동작하고(브리지 미spawn),
       브리지 활성 여부와 무관하게 client-visible 프레임 계약은 동일하다.
```

```text
SPEC-104-AC-06 (R-API-007)  [수명주기 — 종료 감지 → fallback]
  Given 브리지가 동작 중일 때
  When stdout EOF / %exit / 프로세스 crash / 프로토콜 파싱 불가 / tmux 서버 재시작 중 하나가 발생하면
  Then 브리지를 죽은 것으로 간주해 트리거 소스를 즉시 폴링으로 전환하고(silent),
       backoff 로 재-attach 를 시도하며 그 시도 중에도 live view 는 폴링으로 무중단 유지된다.
```

```text
SPEC-104-AC-07 (R-API-007)  [백프레셔 — coalesce + min-interval floor]
  Given 한 focused pane 에 %output 이 고빈도로 폭주할 때
  When 브리지가 이를 처리하면
  Then pane 당 pending capture 는 at-most-one 으로 coalesce 되고(신호는 dirty 표시만 갱신),
       트리거된 capture 는 BRIDGE_MIN_CAPTURE_INTERVAL_MS(가설) 아래로 발화하지 않아
       tmux capture 부하가 상한으로 bound 되며 지연은 여전히 <100ms 목표 안에 든다.
```

```text
SPEC-104-AC-08 (R-PRIV-008 / R-UI-012 / [[08-Decisions|D-047]])  [dirty-signal only — 프레임은 capture 경로 산출]
  Given 브리지가 %output/%window-pane-changed/%layout-change 를 수신할 때
  When 그 이벤트로 프레임이 만들어지는 경로를 관측하면
  Then 이벤트는 "어떤 pane 이 dirty 인가" 표시로만 쓰이고 프레임 텍스트는
       [[SPEC-103-pane-live-stream]] §2.5 capture-pane 재-read → chokepoint 산출이며,
       브리지는 %output 페이로드를 프레임 콘텐츠로 조립하지 않는다(HYBRID).
```

```text
SPEC-104-AC-09 (R-UI-012 / [[08-Decisions|D-019]]/[[08-Decisions|D-048]])  [브리지 argv·socket·stdin 명령 byte 0]
  Given 브리지가 tmux 를 attach 하는 동안
  When 실제 spawn 된 tmux argv 와 브리지 stdin 에 쓰인 byte 전체를 관측하면
  Then argv 는 고정 형태(<tmuxExec 동일 -L/-S socketArgs> -C attach-session -t <sessionId> + ignore-size)이고 shell:false 이며,
       spawn 이후 stdin 에는 teardown 외 명령 byte 가 0 이고(유효 allowlist=∅),
       refresh-client(-C resize)·capture-pane(chokepoint 우회)를 포함해 어떤 명령도 발행되지 않으며,
       write(send-keys 등)는 오직 [[SPEC-400-control-actions]] controlExec 로만 나간다(브리지는 write 진입점이 아님).
```

```text
SPEC-104-AC-10 (R-UI-012 / P1-C)  [size-neutral attach — window resize·%layout-change 미유발]
  Given 브리지가 ignore-size 로 control-mode attach 할 때
  When attach 전후의 #{window_width}x#{window_height} 를 비교하고 control-mode 스트림을 관측하면
  Then attach 가 window 크기를 바꾸지 않고 %layout-change 를 유발하지 않으며,
       브리지는 어떤 size(refresh-client -C <WxH> 등)도 stdin 으로 보내지 않고,
       ignore-size 미지원 tmux 에서는 브리지를 arm 하지 않고 폴링으로 degrade 한다.
```

```text
SPEC-104-AC-11 (R-API-007 / P1-G)  [단일 capture scheduler · atomic source handoff]
  Given 한 PaneViewSession 에 대해 mid-attach 로 브리지↔폴링 트리거 소스가 전환될 때
  When 두 소스가 capture 를 요청하면
  Then capture 는 세션당 단일 scheduler 의 at-most-one-pending/coalesce 게이트를 통과하고,
       한 소스가 arm 되면 다른 소스(timer 또는 bridge)가 disarm 되어(atomic handoff) 이중 트리거가 없으며,
       stale in-flight capture(예: 전환 전 시작된 poll capture)가 최신 결과를 덮지 않는다(stale-wins 방지).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-API-007 | control-mode 브리지 저지연 채널·read-only stdin 강제(HYBRID 트리거·line-granular fail-close·수명주기·fallback 투명·단일 scheduler atomic handoff·coexist default·백프레셔·<100ms 측정) | SPEC-104-AC-01, AC-03, AC-04, AC-05, AC-06, AC-07, AC-11 |
| R-PRIV-008 | 브리지 도입에도 redaction chokepoint·wire 계약 불변(dirty-signal only·%output payload 프레임/로그/redact 비도달·프레임 byte-동일) | SPEC-104-AC-02, AC-08 |
| R-UI-012 | 브리지 read-only 강제(allowlist=∅·no-injection·write 진입점 없음·size-neutral)·트리거만 하는 HYBRID | SPEC-104-AC-08, AC-09, AC-10 |

> 부수 정합(1차 소유 타 spec): **[[08-Decisions|D-047]]**(HYBRID redaction 경계 — AC-02/08), **[[08-Decisions|D-048]]**(read-only sub-allowlist fail-close — AC-01/09), **[[08-Decisions|D-049]]**(coexist default polling·silent fallback — AC-03/05/06), **[[08-Decisions|D-041]]**(read-only 부하 한도 계승), **[[08-Decisions|D-042]]**(styled chokepoint 재사용 — AC-02). frame 계약·`PaneViewSession`은 [[SPEC-103-pane-live-stream]], chokepoint는 [[SPEC-006-privacy-redaction]] 소유. 전체 추적 매트릭스는 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — 상태 Proposed(미승인) + 도메인 리뷰 P0 반영(2026-07-03)**: 본 spec의 근거 결정 [[08-Decisions|D-047]]/[[08-Decisions|D-048]]/[[08-Decisions|D-049]]는 **Proposed(2026-07-03)**이며 제품 오너 승인 전이다. **1차 도메인 리뷰(tmux-systems + security)가 2개 P0(BLOCK)를 제기해 본 개정에 반영**했다: (P0-A) tmux 3.6b 실증 — `refresh-client -C`가 실제 window resize(read-only BROKEN)·`capture-pane`가 control-mode stdout으로 redaction chokepoint 우회(BYPASS) → **유효 `BRIDGE_COMMAND_ALLOWLIST=∅`**로 고정, verb-only allowlisting 폐기(§2.4, D-048 개정); (P0-B) stdin은 newline/`;`-구분 텍스트 채널이라 verb-gating이 second-line 주입을 못 막음 → **line-granular fail-close + wrapper-전용 stdin handle + 비신뢰 문자열 비-보간 + strict id 패턴**(§2.4, AC-01/AC-09 line 채널 검증). P1(C~H: size-neutral `ignore-size`·stdin-open lifecycle·bounded reader/flow-control·socket 공유·단일 scheduler handoff·structural-fact 진단)도 folded. spec-reviewer 게이트 + 제품 오너 승인 후 `approved` 승격 가능하다. 승인 전까지 브리지는 미구현 forward이고 live view는 [[SPEC-103-pane-live-stream]] 폴링으로만 동작한다.
- **C2 — 브리지 audit taxonomy 등록**: §2.9 브리지 상태 전이 audit은 [[SPEC-600-observability]] `ActivityType`/`code` 집합에 신규 code(예 `bridge.started`/`bridge.fallback`) 등록을 요구할 수 있다. 등록 여부·code 토큰은 [[SPEC-600-observability]] 소유이며 본 spec은 producer 매핑만 제안한다. **SPEC-600 정합 확인 필요.**
- **C3 — [[SPEC-103-pane-live-stream]] §6 Q6 상호 참조**: SPEC-103 §6 Q6는 브리지 소유자를 `SPEC-104-control-mode-bridge`로 name-placeholder했다. 본 spec이 그 ID를 확정 점유하며, SPEC-103 §6 Q6는 "RESOLVED(SPEC-104 소유)"로 갱신됐다(§2.6 fallback 의미가 SPEC-103 §6 Q6의 "viewSeq/재-attach 의미" 물음을 해소).

### Open Questions (PoC·설계 판정 대상)

- **Q1 — 브리지 리소스·지연·부하 임계(측정)**: 브리지 프로세스 수(1 고정 / tmux 서버당 / attach당)·memory 상한, `BRIDGE_MIN_CAPTURE_INTERVAL_MS`, backoff 상한/시도 횟수, <100ms 지연 실측, event-triggered capture가 tmux 서버에 주는 부하는 [[SPEC-007-test-validation]] 하니스로 측정해 확정한다(§2.2/§2.8/§3.9). **1차 실측(2026-07-03, 실 tmux 3.6b, 120×40 pane)**: pane 출력→`%output` **dirty-signal 트리거 지연 p≈10.6ms**(send-keys→onDirty), 반복 출력 재트리거 5/5. capture(SPEC-103 실측 p50≈10–17ms) + WS send을 더해도 **end-to-end <100ms 목표에 여유**. **read-only 실증**: 브리지 attach가 window 크기(120×40)를 바꾸지 않음(`ignore-size`), dispose는 명령 발행 0의 clean teardown. 다중 pane·부하 상한·backoff 값은 [[SPEC-007-test-validation]] 정식 하니스로 후속 확정. **PoC 튜닝.**
- **Q2 — 브리지 opt-in 게이트 위치 (RESOLVED 2026-07-07, [[08-Decisions|D-052]])**: 게이트는 **설정 키 `liveViewBridge`(top-level, 기본 `false`, [[SPEC-500-settings-persistence]] §2.2)**로 판정한다. 유효 게이트 = `deps.spawnBridge` 존재 AND (`settings.liveViewBridge` OR `deps.liveViewBridge`). 설정은 attach마다 live-read(§2.7), attach 중 토글은 다음 attach부터 적용. per-attach 요청·capability 자동 감지는 기각(D-049 default=polling 유지).
- **Q3 — `doctor` 브리지 진단 (RESOLVED 2026-07-07, [[08-Decisions|D-053]])**: `doctor`는 **정적 capability + 설정값만** 진단한다 — [[SPEC-600-observability]] §2.9 `DoctorDiagnostics.bridge` `{ enabled, tmuxVersion, controlModeSupported, socketArgs }`(정보 전용, exit code 무영향, §2.9). 현재 트리거 소스·fallback 이력은 doctor 범위 밖(activity `control.bridge_fallback` audit이 소유).
- **Q4 — control-mode notification semantics·`ignore-size` 지원 실측(tmux 버전 편차, 2026-07-03 리뷰 반영)**: `%output`(octal-escaped text)·`%window-pane-changed`(active-pane focus)·`%layout-change`(window-scoped)·`%pane-mode-changed`의 발화 조건, `ignore-size` client flag 지원 범위, flow-control(`%pause`/`%continue`, 3.2+) 동작, `%pause` staleness 임계는 tmux 버전에 따라 다르다(3.x). tmux-systems 리뷰가 tmux 3.6b에서 (a) stdin-open attach가 명령 없이 `%output`을 스트리밍, (b) `refresh-client -C`가 실제 resize, (c) stdin EOF=즉시 detach를 실증했다. 잔여 버전 매트릭스는 [[SPEC-007-test-validation]] 하니스로 검증하고 미지원(특히 `ignore-size` 부재)은 §2.7 capability degrade(폴링)로 안전 처리한다. **tmux-systems 검증 계속.**
- **Q5 — format subscription(`refresh-client -B`)은 <100ms 대체 아님(P2)**: read-only format subscription 메커니즘은 `refresh-client -B name:what:format`이며 `-C`(size)가 아니다. 단 `-B`는 **redraw cadence로 발화**해 `%output` 수준의 <100ms 트리거를 대체하지 못하고, 도입하려면 flag-level 검증 + 새 결정이 필요하다(현재 allowlist=∅). MVP는 `-B`도 쓰지 않는다. **검토 필요.**
- **Q6 — attach의 비-콘텐츠 side effect(P2)**: control-mode attach는 client-attach hook·`#{session_attached}`·`destroy-unattached on` 세션 생존 등 관측 가능한 side effect를 만든다(§2.2). read-only/redaction 위협은 아니나 사용자 환경에 보이므로 문서화·최소화 방침을 확정할지 판정한다. **검토 필요.**
- **Q7 — 전역(연결 간) 브리지 상한**: MVP는 연결당 attach 1 위에서 브리지도 focused pane만 본다. P2 multi-client에서 브리지 다중화·전역 capture budget은 [[SPEC-103-pane-live-stream]] §6 Q7과 함께 forward. **검토 필요(P2).**
