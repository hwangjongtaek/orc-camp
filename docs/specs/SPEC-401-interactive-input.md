---
spec: SPEC-401
title: Interactive keyboard input — passthrough·arm/disarm·batched audit
status: draft
updated: 2026-07-02
requirements: [R-CTRL-009, R-CTRL-001, R-CTRL-002, R-CTRL-005, R-CTRL-007]
decisions: [D-043, D-044, D-006, D-028]
tags:
  - specs
  - control
  - passthrough
  - interactive-input
  - security
  - backend
---

# SPEC-401 — Interactive keyboard input (passthrough·arm/disarm·batched audit)

Terminal Workspace([[18-Terminal-Workspace]] §3.3/§5.3)의 **키보드 passthrough** 계약을 고정한다. 사용자가 터미널 뷰포트에 **직접 타이핑**해 선택된 orc(=tmux pane)에 입력을 전달하는 상호작용을, **관전(Observe, 기본) / 조종(Control, armed) 2단계 모델**과 그에 필요한 server/security 의미(arm/disarm 수명주기·auto-disarm·확장 key allowlist·keystroke rate cap·expected-target 재검증 재적용·배치 audit)로 정의한다([[08-Decisions|D-043]], R-CTRL-009).

> **핵심 불변식 — 새 write 경로 없음(확정, [[08-Decisions|D-043]] (a))**: passthrough의 tmux egress는 **오직 [[SPEC-400-control-actions]] §2.1 `controlExec` single-writer**(고정 `send-keys` 3 템플릿: literal / key / interrupt)로만 나간다. 본 spec은 **두 번째 writer를 추가하지 않는다**. 따라서 injection·mis-target·임의 셸 실행 방어(R-CTRL-005/008, [[08-Decisions|D-028]])를 그대로 상속한다.

> **핵심 불변식 — Observe = no egress(확정, R-CTRL-009)**: 명시적 arm 없이는 키스트로크가 **절대** 나가지 않는다. server는 passthrough egress를 **live arm-session이 있을 때만** 수용하고, 없으면 `controlExec`를 호출하지 않는다(§2.5, AC-01).

> **2026-07-02 리뷰 반영(security-privacy)**: (P0) literal 경로 **control-byte 필터**([[SPEC-400-control-actions]] §2.3.1 상속, §2.4/§2.7, AC-13) — `-l`이 raw `0x03/0x04/0x1a/0x1c`를 통과시켜 destructive-chord 제외·`/interrupt` confirm을 우회하던 구멍을 막았다. (P1) **exposure-gated arm**(off이면 arm 거부, §2.3, AC-14), **armSessionId actor binding**(cross-connection replay 차단, §2.2, AC-15), **keyHistogram default-off**(side-channel, §2.9), rate-limit **interim warn 신호**(§2.8). Q3/Q5/Q6 해소(§6).

## 소유 경계 (ownership boundary)

| 관심사 | 소유 |
| --- | --- |
| passthrough egress **경로**(controlExec·send-keys 템플릿)·base KEY_ALLOWLIST·안전 게이트·per-action `control.result` audit·per-pane 직렬화 | [[SPEC-400-control-actions]] (본 spec이 **재사용**) |
| passthrough **security 의미**: arm/disarm 수명주기·auto-disarm·확장 `INTERACTIVE_KEY_ALLOWLIST`·keystroke rate cap·재검증 재적용 timing·**배치 audit** | **본 spec (SPEC-401)** |
| Observe/Control **시각 표시**·arm 토글 **UX**·터미널 **focus 처리**·접근성 | [[SPEC-203-terminal-workspace]] (본 spec은 server 의미만) |
| read-only **live pane view**(화면을 보는 read 경로) | [[SPEC-103-pane-live-stream]] (본 spec의 write 경로와 직교) |
| `ActivityEvent` **envelope·저장·seq/id/message** | [[SPEC-600-observability]] (본 spec은 producer로 **매핑**만) |
| redaction 패턴·non-persistence 데이터 흐름 | [[SPEC-006-privacy-redaction]] (§2.5 재사용) |

## 1. Scope

### In scope

- **관전/조종 2단계 모델**과 server가 강제하는 **arm/disarm 수명주기**(§2.2), **auto-disarm**(§2.6).
- **arm/disarm 표면**: `POST /api/orcs/:orcId/passthrough/arm`·`/disarm`(minimal, egress는 하지 않음 — §2.3). arm 시 [[SPEC-400-control-actions]] §2.6 재검증 수행.
- **passthrough egress 재사용 계약**: 기존 [[SPEC-400-control-actions]] `/input`(literal)·`/key` endpoint를 `passthrough` 마커로 재사용(§2.4). **새 endpoint/writer 없음**.
- **확장 `INTERACTIVE_KEY_ALLOWLIST`**(§2.7): base `KEY_ALLOWLIST`의 **superset**, **armed passthrough에서만** 적용, 파괴적 chord 제외.
- **literal 문자 passthrough**: printable 키스트로크는 `controlExec` `literal` 템플릿(`-l --`, `submit:false`)으로 전송(§2.4).
- **expected-target 재검증 재적용**(§2.5, R-CTRL-005): arm 시점 + 매 egress burst. drift 시 abort + auto-disarm.
- **rate limit**: [[SPEC-400-control-actions]] §2.10 per-pane 직렬화 재사용 + **keystroke rate cap** 추가(§2.8).
- **배치 audit**(§2.9, R-CTRL-007): keystroke 단위가 아닌 **arm-session 단위 요약** 1건을 [[SPEC-600-observability]] `ActivityEvent`(code `control.passthrough_session`)로 산출. **키스트로크 원문·literal 텍스트·token 비직렬화**([[SPEC-006-privacy-redaction]] §2.5 확장).
- 다룬 요구사항: **R-CTRL-009**(1차), R-CTRL-001/002/005/007(passthrough 측면 재사용·확장).

### Out of scope (다른 spec으로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| `controlExec` writer·send-keys 3 템플릿·base KEY_ALLOWLIST·안전 게이트·per-action `control.result` | write 경로 SSOT, 본 spec은 재사용 | [[SPEC-400-control-actions]] §2.1~§2.10 |
| Observe/Control **시각 표시**·arm 토글 버튼/클릭 UX·터미널 focus/키보드 트랩·reduced-motion | 화면·상호작용 표면 | [[SPEC-203-terminal-workspace]] |
| **live pane view**(read: attach/detach·pane_view 프레임·폴링) | read 경로(직교) | [[SPEC-103-pane-live-stream]] |
| `ActivityEvent` **모델·seq/id/createdAt/message·ring buffer** | observability SSOT | [[SPEC-600-observability]] §2.1~§2.4 |
| redaction 패턴 카탈로그·`redact()` 구현 | privacy SSOT | [[SPEC-006-privacy-redaction]] |
| startup token 생성·검증 메커니즘 | 공통 auth | [[SPEC-100-server-lifecycle]] §2.6 |
| interrupt(`C-c`) confirm modal·전용 endpoint 계약 | destructive 경로(불변) | [[SPEC-400-control-actions]] §2.7 |

## 2. Contract

### 2.1 모델 개요 — 관전/조종 (R-CTRL-009, [[08-Decisions|D-043]])

- **Observe(관전, 기본)**: client는 어떤 키스트로크 egress도 하지 않는다(스크롤/복사만 — [[SPEC-203-terminal-workspace]] 소유). server는 passthrough egress를 **거부**한다(live arm-session 부재 → §2.5).
- **Control(조종, armed)**: 명시 arm 후에만 터미널 focus 키스트로크가 [[SPEC-400-control-actions]] write 경로로 전달된다. arm은 뚜렷한 상태 표시([[SPEC-203-terminal-workspace]])를 동반하고, 무입력 `PASSTHROUGH_IDLE_MS` 후 auto-disarm된다(§2.6).
- **API surface 결정(확정)**: egress는 **기존 [[SPEC-400-control-actions]] endpoint를 재사용**한다(`/input` literal·`/key`). arm/disarm은 1차적으로 client UI 상태지만, **server가 rate limit·재검증·allowlist·배치 audit을 강제**해야 하므로 **최소한의 server-side arm-session** 개념을 도입한다(§2.2). arm-session 관리용 `/passthrough/arm`·`/disarm` 두 endpoint는 **egress를 하지 않으며 `controlExec`를 호출하지 않는다**(§2.3) — single-writer 불변식을 건드리지 않는다.

### 2.2 server-side arm-session (최소 도입 근거 포함, R-CTRL-009/005/007)

배치 audit 범위 지정·auto-disarm·keystroke rate cap·**server-enforced Observe 보장**을 위해 최소 in-memory arm-session을 둔다. 정당화: 이 4가지는 모두 server에서만 강제 가능하며, arm-session 없이는 (a) 재검증 baseline을 arm 시점에 고정할 수 없고, (b) 배치 audit을 하나의 세션으로 묶을 수 없으며, (c) "arm 안 하면 키가 안 나간다"를 server가 보장할 수 없다.

```ts
// in-memory only, 종료 시 폐기(memory-only, [[SPEC-006-privacy-redaction]] §2.5 정신). disk 비저장.
interface PassthroughArmSession {
  armSessionId: string;         // 서버 생성 opaque id(상관용). token 아님·audit엔 correlationId로만 노출.
  actorId: string;              // arm한 인증 연결(WS/HTTP) 식별자 — egress는 같은 actor에서만 유효(§2.2 binding, 리뷰 반영)
  orcId: string;                // "pane:%12"
  paneId: string;               // "%12" — controlExec -t 권위 target ([[08-Decisions|D-017]])
  baseline: ExpectedTarget;     // arm 시점 재검증 통과 값(§2.5 대조 기준). ExpectedTarget = [[SPEC-400-control-actions]] §2.2
  armedAt: number;              // epoch ms
  lastKeystrokeAt: number;      // auto-disarm 판정 기준(§2.6)
  // 감사 accumulator — 전부 non-raw(내용 미포함):
  keystrokeCount: number;       // 전송 op(문자 수 포함) 누계 — 문자 수만, 내용 아님
  literalByteTotal: number;     // literal burst byteLength 합(내용 아님)
  redactedFlag: boolean;        // 세션 중 literal burst가 redaction 패턴에 매칭된 적 있는지(boolean)
  keyHistogram: Record<string, number>; // allowlist 키 이름→횟수(secret 아님, optional)
  execFailures: number;         // tmux_exec_failed 누계
  closed: boolean; closeReason: string | null; // 'user_disarm'|'idle_timeout'|'target_gone'|'target_mismatch'|'conn_closed'|'not_controllable'|'exposure_off'
}

const PASSTHROUGH_IDLE_MS = 240_000;      // 무입력 auto-disarm (가설 3–5m band, §3)
const PASSTHROUGH_KEYSTROKE_RATE = 20;    // arm-session당 초당 키스트로크 상한(가설, §3)
const PASSTHROUGH_LITERAL_BURST_MAX = 256;// literal burst 권장 byteLength 상한(client 배칭 힌트, ≤ MAX_INPUT_BYTES)
```

- **범위(확정)**: arm-session은 `(paneId, 인증된 연결/actor)` 단위다. 같은 pane에 대해 동시에 **at-most-one live arm-session**(중복 arm은 기존 세션 갱신 또는 거부 — 가설, §3).
- **actor binding(확정, 2026-07-02 리뷰 반영 — Q5 해소, defense-in-depth)**: `armSessionId`는 이를 만든 **인증 연결(`actorId`)에 바인딩**된다. passthrough egress(§2.4 마커) 처리 시 server는 요청 actor가 arm-session의 `actorId`와 **일치하는지** 검사하고, 불일치면 `409 not_armed`로 거부한다(controlExec 미호출). 이로써 `armSessionId`가 유출되어도 **다른 연결에서 replay할 수 없다** — token auth([[SPEC-100-server-lifecycle]]) 위의 추가 방어선이다. 인증 연결 종료 시 세션은 `conn_closed`로 닫힌다(§2.6). `armSessionId`는 token이 아니며 audit엔 `correlationId`로만 노출된다(원문 아님).
- **memory-only(확정)**: arm-session·accumulator는 memory에만 있고 disk/telemetry로 나가지 않는다([[08-Decisions|D-003]], [[SPEC-006-privacy-redaction]] §2.5).

### 2.3 arm / disarm endpoint (egress 없음, R-CTRL-004/005/007)

두 endpoint 모두 [[SPEC-100-server-lifecycle]] token auth 미들웨어 뒤에 있고([[SPEC-400-control-actions]] §2.5 Gate 1 재사용), **`controlExec`를 호출하지 않는다**(send-keys 미발행 — single-writer 불변, AC-10).

| Method | Path | 동작 | body | 성공 응답 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/orcs/:orcId/passthrough/arm` | 재검증 후 arm-session 생성 | `{ expected: ExpectedTarget }` | `{ ok:true, armSessionId, armedAt, idleTimeoutMs }` |
| `POST` | `/api/orcs/:orcId/passthrough/disarm` | 세션 종료 + 배치 audit flush | `{ armSessionId }` | `{ ok:true, auditEventId }` |

```ts
interface PassthroughArmRequest    { expected: ExpectedTarget }          // [[SPEC-400-control-actions]] §2.2 ExpectedTarget
interface PassthroughDisarmRequest { armSessionId: string }
```

- **arm 처리(확정)**: (1) token → (2) schema(unknown 필드 거부) → (3) orc 해석/controllability([[SPEC-400-control-actions]] Gate 3/4) → (3.5) **exposure gate** → (4) **[[SPEC-400-control-actions]] §2.6 fresh read-only 재검증**을 수행하고 통과 시 `baseline = expected`로 arm-session을 생성한다. 재검증 실패면 세션을 만들지 않고 [[SPEC-400-control-actions]] §2.9 코드(`410 target_gone`/`409 target_mismatch`/`409 not_controllable`)로 거부한다(AC-02). **arm 자체는 read-only**(재검증 read만) — 어떤 send-keys도 발행하지 않는다.
- **exposure-gated arm(확정, 2026-07-02 리뷰 반영 — Q3 해소 "refuse", [[08-Decisions|D-044]]/[[08-Decisions|D-006]])**: 글로벌 exposure gate(R-PRIV-006, [[08-Decisions|D-044]])가 **off**이면 arm을 **거부**한다(`409 exposure_off`). 근거: exposure off면 사용자는 pane 화면([[SPEC-103-pane-live-stream]] live view)을 볼 수 없으므로 arm은 **blind write**가 되어 mis-target 리스크(D-006 정신)를 키운다 — "보지 못하는 pane에 타이핑 금지". 이미 arm된 세션 중 exposure가 off로 바뀌면 auto-disarm한다(§2.6, `closeReason='exposure_off'`). per-pane exposure 승격은 [[08-Decisions|D-044]] forward이므로 MVP는 글로벌 gate만 본다(AC-14).
- **disarm 처리(확정)**: 해당 `armSessionId` 세션을 닫고(`closeReason='user_disarm'`) §2.9 배치 audit 1건을 flush한다. 알 수 없는/이미 닫힌 세션은 idempotent no-op(응답 `auditEventId:null` 가능).
- **자유 명령 필드 없음(확정, R-CTRL-008)**: arm은 `expected`만, disarm은 `armSessionId`만 받는다 — subcommand/shell/key 필드가 없다. unknown 필드는 `422 validation_error`.

### 2.4 passthrough egress — 기존 endpoint 재사용 (R-CTRL-001/002, [[08-Decisions|D-043]])

egress는 **[[SPEC-400-control-actions]]의 `/input`·`/key`를 재사용**하되, request에 **`passthrough` 마커**를 실어 passthrough-origin임을 표시한다. 마커가 있으면 server는 arm-session 규칙(§2.5·§2.7·§2.8·§2.9)을 적용한다. 마커가 없으면 기존 form-path([[SPEC-400-control-actions]] §2.2) 그대로다.

```ts
interface PassthroughMarker { armSessionId: string }   // 유일 필드 — 자유 명령 필드 없음(R-CTRL-008)

// [[SPEC-400-control-actions]] §2.2 request의 optional 확장(unknown 필드 거부 유지):
//   InputRequest { text; submit?; expected; requestId?; passthrough?: PassthroughMarker }
//   KeyRequest   { key;         expected; requestId?; passthrough?: PassthroughMarker }
//   InterruptRequest 는 passthrough 를 받지 않는다(§2.7 destructive 불변).
```

- **printable 문자 → literal 템플릿(확정)**: 화면에 찍히는 문자(letters/digits/punctuation/Space 등)는 client가 **burst로 묶어** `/input {text, submit:false, expected, passthrough}`로 보내고, server는 [[SPEC-400-control-actions]] §2.3 `literal` 템플릿 `['send-keys','-t',paneId,'-l','--',text]`로 전송한다. `-l --`가 키 이름 해석을 차단한다.
- **control-byte 필터 계승(확정, 2026-07-02 리뷰 반영)**: passthrough literal egress는 [[SPEC-400-control-actions]] **§2.3.1 control-byte 필터를 그대로 상속**한다 — `text`에 control byte(`U+0000–U+001F`/`U+007F`)가 있으면 `422 control_char_not_allowed`로 거부되고 send-keys가 발행되지 않는다. 이유: `-l`은 키 **이름** 해석만 막고 **raw `0x03/0x04/0x1a/0x1c` 같은 제어 byte는 그대로 전달**하므로, 이 필터가 없으면 literal 경로가 §2.7 파괴적 chord 제외와 `/interrupt` confirm을 **우회**한다. 따라서 passthrough에서 모든 제어 기능(개행 포함)은 literal이 아니라 `/key`(Enter/Tab/화살표/안전 chord) 또는 `/interrupt`로만 전달된다(AC-13). 사용자가 `C-c`를 **문자로** 쳐도 리터럴 문자열이면 통과하나, 제어 byte로 오면 거부된다.
- **`submit:false` 강제(확정)**: passthrough `/input`은 **자동 Enter를 붙이지 않는다** — passthrough는 raw 키스트로크 미러링이므로 Enter는 사용자의 별도 키 이벤트다. `passthrough` 마커가 있는데 `submit:true`(또는 생략 시 form 기본 true를 계승)면 `422 validation_error`로 거부한다. 즉 passthrough `/input`은 `submit:false`를 **명시**해야 한다(AC-03).
- **named 키 → key 템플릿(확정)**: Enter/Tab/화살표/function 키/안전 chord 등은 `/key {key, expected, passthrough}`로 보내고, server는 §2.7 `INTERACTIVE_KEY_ALLOWLIST` 검증 후 [[SPEC-400-control-actions]] §2.3 `key` 템플릿으로 전송한다.
- **op 종류 불변(확정)**: passthrough는 [[SPEC-400-control-actions]] `ControlOp`의 `literal`/`key` 두 종만 쓴다. **새 op 종류를 만들지 않는다**. `interrupt` op은 passthrough로 도달하지 않는다(§2.7).

### 2.5 게이트 순서 · Observe 보장 · 재검증 재적용 (R-CTRL-005/009)

passthrough egress는 [[SPEC-400-control-actions]] §2.5 게이트를 **그대로** 통과하며, 아래 passthrough 게이트가 추가된다(느슨해지는 게이트 없음).

| # | gate | 실패 시 | 소유 |
| --- | --- | --- | --- |
| 1 | token auth | `401 unauthorized` | [[SPEC-100-server-lifecycle]] |
| 2 | schema(마커 포함, unknown 거부) | `422 validation_error` | [[SPEC-400-control-actions]] §2.5 + 본 §2.4 |
| **2.5** | **arm-session 해석 + actor binding** | `409 not_armed`(마커 있으나 live 세션 없음/만료/**actor 불일치** §2.2) | **본 spec** |
| 3 | orc 해석 | `404 orc_not_found` | [[SPEC-400-control-actions]] |
| 4 | controllability | `409 not_controllable` | [[SPEC-400-control-actions]] |
| **5** | **target 재검증(fresh read)** | `410 target_gone`/`409 target_mismatch` → **egress abort + auto-disarm** | **R-CTRL-005**, [[SPEC-400-control-actions]] §2.6 |
| 6 | action-specific(§2.7 allowlist / rate cap) | `422 key_not_allowed` / `429 rate_limited` | 본 §2.7·§2.8 |
| 7 | execute(`controlExec`) | `502 tmux_exec_failed`(execFailures++) | [[SPEC-400-control-actions]] §2.1 |
| 8 | audit accumulate(§2.9) | 배치 — per-action event 미발행 | 본 §2.9 |

- **Observe = server-enforced no egress(확정, AC-01)**: `passthrough` 마커가 있으나 해당 `armSessionId`의 live 세션이 없으면(=arm 안 함/만료/닫힘) Gate 2.5에서 `409 not_armed`로 거부하고 **`controlExec`를 호출하지 않는다**. 즉 client가 오작동해도 arm 없이는 키가 나가지 않는다. (마커 없는 form-path는 기존 [[SPEC-400-control-actions]] 규칙.)
- **재검증 재적용 timing(확정, R-CTRL-005)**: (a) **arm 시점**에 §2.3 재검증으로 baseline 확정, (b) **매 egress burst**마다 [[SPEC-400-control-actions]] §2.6 Gate 5 재검증을 그대로 재수행한다(passthrough가 재검증을 **약화하지 않는다**). 각 egress request가 하나의 burst이므로 재검증은 request 단위로 실행된다 — client가 문자를 burst로 묶을수록 재검증 횟수가 준다(비용 §6 Q).
- **drift → abort + auto-disarm(확정)**: egress 중 재검증이 `target_gone`/`target_mismatch`면 그 egress를 abort하고(send-keys 미발행) **arm-session을 즉시 닫아 배치 audit을 flush**한다(`closeReason=target_gone|target_mismatch`, severity warn). 이후 egress는 재-arm을 요구한다(AC-06).

### 2.6 auto-disarm (R-CTRL-009, [[08-Decisions|D-043]] (b))

- **idle auto-disarm(확정, 값은 가설)**: `now - lastKeystrokeAt > PASSTHROUGH_IDLE_MS`인 arm-session은 auto-disarm된다 — 세션을 닫고(`closeReason='idle_timeout'`) §2.9 배치 audit을 flush한다. 판정은 sweep 또는 다음 egress 시 lazily 수행할 수 있다(구현 자유). auto-disarm 후 egress는 `409 not_armed`이며 재-arm이 필요하다(AC-07).
- **기타 close 트리거(확정)**: 재검증 drift(§2.5), controllability 상실(status `terminated`/`stale`), 인증 연결 종료(`conn_closed`), **글로벌 exposure off(`exposure_off`, §2.3 리뷰 반영)**, 명시 disarm(§2.3). 모두 배치 audit 1건을 flush한다.
- **client 정합(참조)**: UI의 auto-disarm 표시·타이머 리셋·상태 배지는 [[SPEC-203-terminal-workspace]] 소유다. 본 spec은 **server 측 세션 종료·audit flush**만 강제한다.

### 2.7 확장 `INTERACTIVE_KEY_ALLOWLIST` (R-CTRL-002, [[08-Decisions|D-043]] (c))

armed passthrough의 `/key`는 base 대신 확장 allowlist를 쓴다. 이는 [[SPEC-400-control-actions]] §2.4 `KEY_ALLOWLIST`의 **superset**이며, **passthrough 마커가 있을 때만** 적용된다(마커 없는 form-path `/key`는 여전히 base `KEY_ALLOWLIST`).

```ts
// base ⊂ INTERACTIVE_KEY_ALLOWLIST. armed passthrough(/key + passthrough 마커)에서만 사용.
const INTERACTIVE_KEY_ALLOWLIST = new Set([
  ...KEY_ALLOWLIST,                                   // [[SPEC-400-control-actions]] §2.4 base(navigation/editing)
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12', // TUI 기능키
  'C-a','C-e','C-k','C-u','C-w','C-l','C-b','C-f','C-p','C-n','C-r', // readline 편집/탐색(비파괴)
  'M-b','M-f',                                        // 단어 단위 이동(비파괴)
]); // 초기 membership = PoC 검증 가설(§3). 파괴적 chord는 아래처럼 영구 제외(확정).

// 영구 제외(확정) — passthrough allowlist에 절대 넣지 않는다. raw arming으로 열지 않는다.
const PASSTHROUGH_FORBIDDEN_CHORDS = ['C-c','C-d','C-z','C-\\','C-q','C-s','C-]'];
```

- **파괴적 chord 제외 유지(확정, R-CTRL-002/003 정신)**: `C-c`(interrupt)·`C-d`(EOF/종료)·`C-z`(suspend)·`C-\\`(SIGQUIT) 등은 `INTERACTIVE_KEY_ALLOWLIST`에 **없다**. passthrough `/key`로 이 chord를 보내면 `422 key_not_allowed`로 거부되고 send-keys가 발행되지 않는다(AC-05). passthrough는 이 chord들을 **raw arming으로 열지 않는다**.
- **양 경로 모두 차단(확정, 2026-07-02 리뷰 반영)**: 이 제외는 **두 경로 모두**에서 성립해야 유효하다 — (1) `/key` 경로는 `INTERACTIVE_KEY_ALLOWLIST` membership으로, (2) `/input` **literal 경로는 §2.4 control-byte 필터**([[SPEC-400-control-actions]] §2.3.1)로 raw `0x03/0x04/0x1a/0x1c` 전달을 차단한다. 두 필터가 동시에 성립해야 "passthrough에서 파괴적 제어는 confirm/전용 endpoint로만"이라는 보장이 참이다(AC-05·AC-13).
- **`C-c`는 confirm 게이트 유지(확정)**: 사용자가 armed 상태에서 `C-c`를 누르면 client는 이를 passthrough로 보내지 않고 [[SPEC-400-control-actions]] §2.7 **interrupt confirm modal → `/interrupt {confirmed:true}`** 경로로 라우팅한다([[SPEC-203-terminal-workspace]] focus 처리와 정합). `/interrupt`는 `passthrough` 마커를 받지 않으므로(§2.4) passthrough가 confirm을 우회할 수 없다(AC-05).
- **확장 membership(가설)**: 위 superset 구성은 agent TUI(Claude Code/Codex) 사용성 PoC로 보정한다([[SPEC-400-control-actions]] §6 Q3와 동일 축). 단 `PASSTHROUGH_FORBIDDEN_CHORDS` 제외는 가설이 아니라 확정 경계다.

### 2.8 rate limit · per-pane 직렬화 (R-CTRL-009, [[08-Decisions|D-043]] (d))

- **per-pane 직렬화 재사용(확정)**: 같은 `paneId`에 대한 passthrough egress는 [[SPEC-400-control-actions]] §2.10 per-pane mutex(at-most-one in-flight)로 직렬화된다 — 키스트로크 interleave가 발생하지 않는다(AC-11). 새 직렬화 기전을 만들지 않는다.
- **keystroke rate cap 추가(확정 정책, 값은 가설)**: arm-session당 keystroke rate를 `PASSTHROUGH_KEYSTROKE_RATE`(가설 20/s)로 캡한다. 초과 egress는 `429 rate_limited`로 거절하고 accumulator의 실패로 집계하되 **원문은 저장하지 않는다**. runaway(자동 스크립트 폭주 타이핑)를 막는다.
- **interim rate 신호(확정, 2026-07-02 리뷰 반영 — nit)**: rate-limit이 세션 종료 전까지 아무 신호도 주지 않으면(배치 audit이라) 사용자가 폭주를 늦게 안다. 따라서 rate cap이 지속 초과될 때 **throttled(가설: ≤1건/10s) interim `warn` activity 신호**를 [[SPEC-600-observability]] `ActivityEvent`로 산출한다(code 재사용 또는 `control.passthrough_session`의 warn 조기 emit — 원문 미포함, 세션 종료 시 최종 요약과 별개). 세부 code는 §6 C1 SPEC-600 정합에 따른다.
- **client 배칭(참조)**: printable 문자를 `PASSTHROUGH_LITERAL_BURST_MAX` 이하 burst로 묶어 request 수(및 재검증 횟수)를 줄이는 것은 [[SPEC-203-terminal-workspace]] client 책임이다. server는 배칭 여부와 무관히 캡을 강제한다.
- **[[SPEC-400-control-actions]] global rate limit 계승(확정)**: pane/global rate limit(§2.10)도 그대로 적용된다.

### 2.9 배치 audit — `control.passthrough_session` (R-CTRL-007, [[08-Decisions|D-043]] (e), [[SPEC-006-privacy-redaction]] §2.5)

키스트로크 단위 audit은 과다하므로, **arm-session이 닫힐 때(disarm/auto-disarm/drift/conn 종료) 세션 요약 1건**을 [[SPEC-600-observability]] `ActivityEvent`로 산출한다. envelope(`id`/`seq`/`createdAt`/`source`/`message`)와 저장은 [[SPEC-600-observability]] 소유이며, 본 spec은 **producer 매핑**만 소유한다.

```ts
// producer view — [[SPEC-600-observability]] ActivityEvent 로 매핑. 새 envelope 정의 없음.
interface PassthroughSessionMapping {
  type: 'control.result';                 // 기존 canonical control audit type 재사용([[SPEC-600-observability]] §2.1)
  code: 'control.passthrough_session';    // 신규 안정 machine code(§6 C1 — SPEC-600 code 집합에 추가)
  severity: 'info' | 'warn' | 'error';    // 정상 종료→info · drift/rate-heavy/idle→warn · execFailures>0→error
  target: { orcId: string; paneId: string; tmuxTarget: string }; // arm 시점 baseline([[08-Decisions|D-017]])
  detail: {                               // → ActivityEvent.detail — 전부 non-raw
    controlOutcome: 'success' | 'aborted' | 'failed'; // 세션 결과(4-값 중 partial 미사용)
    outcome: 'success' | 'failure';       // coarse(success→success, 그 외→failure)
    reason: string | null;                // closeReason(user_disarm/idle_timeout/target_gone/target_mismatch/conn_closed/not_controllable)
    keystrokeCount: number;               // 세션 키스트로크/문자 누계(수치만, 내용 아님)  ── §6 C1: SPEC-600 detail 확장 필요
    durationMs: number;                   // armedAt→close 지속(→ ActivityEvent.detail.durationMs)
    inputRedactedFlag: boolean;           // 세션 literal이 redaction 패턴에 매칭된 적 있는지(내용 미포함)
    keyHistogram?: Record<string, number>;// DEFAULT-OFF opt-in. allowlist 키 이름→횟수만(literal 텍스트/문자 절대 불포함). 리뷰 반영·§6 C1
    execFailures: number;                 // tmux_exec_failed 누계
    correlationId: string;                // armSessionId(상관용; token 아님)
  };
  // 금지: 전송한 literal 텍스트·키스트로크 원문·전송 key 시퀀스·startup token — 어떤 필드에도 직렬화 금지.
}
```

- **배치 단위(확정, R-CTRL-007)**: passthrough egress는 [[SPEC-400-control-actions]] §2.8 **per-action `control.result`를 발행하지 않는다** — 세션당 `control.passthrough_session` **정확히 1건**만 산출한다(로그 폭주 방지, AC-08/AC-09). (form-path 개별 action은 종전대로 per-action `control.result`.)
- **non-persistence 확장(확정, [[08-Decisions|D-016]]/[[SPEC-006-privacy-redaction]] §2.5)**: 세션 요약은 **keystroke 원문·literal 텍스트·전송 key 시퀀스를 어떤 필드에도 담지 않는다** — `keystrokeCount`·`durationMs`·`inputRedactedFlag`(boolean)·`keyHistogram`(키 이름 카운트)만 남긴다. token은 어떤 필드에도 직렬화하지 않는다(AC-08). scan/제어 슬라이스의 non-persistence 계약을 passthrough로 확장한다.
- **`keyHistogram` default-off(확정, 2026-07-02 리뷰 반영 — Q6 해소)**: `keyHistogram`은 키 이름 빈도라는 **행동 side-channel**이므로 **기본 off·opt-in**이다(기본 산출 필드는 `keystrokeCount`·`durationMs`·`inputRedactedFlag`·`execFailures`·`correlationId`). opt-in되어도 **allowlist 키 이름과 횟수만** 담고 **literal 텍스트·타이핑한 문자는 절대 담지 않는다**. 기본 off이면 필드를 생략한다(AC-08).
- **severity 매핑(확정)**: 정상 종료(user_disarm/idle_timeout, execFailures=0)=`info`; drift abort·rate-limit 다발·exposure_off=`warn`; `execFailures>0`=`error`. [[SPEC-600-observability]] §2.1 `ActivitySeverity` 정합.
- **frame-role(참조)**: rail 항목은 [[SPEC-102-realtime-sync]] `activity` frame([[SPEC-600-observability]] §2.4 payload). passthrough에는 actor per-action HTTP echo가 여러 건이지만 rail audit은 세션 1건이다(중복 금지).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다([[SPEC-000-conventions]]).

1. **새 writer 없음(확정)**: passthrough egress는 `controlExec` literal/key 템플릿으로만 나간다. arm/disarm endpoint는 send-keys를 발행하지 않는다(§2.3, AC-10).
2. **Observe = no egress(확정)**: live arm-session 없는 passthrough 마커 egress는 `409 not_armed`, controlExec 미호출(§2.5, AC-01).
3. **arm 시 재검증(확정)**: arm은 [[SPEC-400-control-actions]] §2.6 fresh read-only 재검증 통과 후에만 세션을 만든다. arm 자체는 read-only(§2.3, AC-02).
4. **재검증 약화 금지(확정)**: 매 egress burst마다 Gate 5 재검증을 재수행한다. drift면 abort + auto-disarm(§2.5, AC-06).
5. **submit:false(확정)**: passthrough `/input`은 자동 Enter를 붙이지 않는다(§2.4, AC-03).
6. **파괴적 chord 제외(확정)**: `C-c`/`C-d`/`C-z`/`C-\\` 등은 `INTERACTIVE_KEY_ALLOWLIST` 밖이며 passthrough로 열리지 않는다. `C-c`는 confirm 게이트/전용 endpoint 유지(§2.7, AC-05).
7. **배치·비저장 audit(확정)**: 세션당 `control.passthrough_session` 1건, keystroke 원문·literal·token 비직렬화(§2.9, AC-08/AC-09).
8. **per-pane 직렬화 재사용(확정)**: 같은 pane egress는 at-most-one in-flight(§2.8, AC-11).
9. **상수(가설)**: `PASSTHROUGH_IDLE_MS=240s(3–5m band)`·`PASSTHROUGH_KEYSTROKE_RATE=20/s`·`PASSTHROUGH_LITERAL_BURST_MAX=256B`·`INTERACTIVE_KEY_ALLOWLIST` membership은 모두 **PoC 검증 가설**이며 [[SPEC-007-test-validation]]·사용성 검증으로 보정한다. `PASSTHROUGH_FORBIDDEN_CHORDS` 제외는 확정 경계다.

## 4. Acceptance criteria

> token/secret 예시는 placeholder를 쓴다([[SPEC-000-conventions]]). "fresh read" = 실행 시점 read-only 재조회([[SPEC-400-control-actions]] §2.6). "armed" = live arm-session 존재.

```text
SPEC-401-AC-01 (R-CTRL-009)
  Given Observe(기본) 상태로 어떤 arm-session도 없을 때
  When passthrough 마커(armSessionId)를 실은 /input 또는 /key egress 를 valid token으로 보내면
  Then Gate 2.5에서 409 not_armed 로 거부되고 controlExec 가 호출되지 않으며(어떤 send-keys 도 없음),
       마커 없는 form-path 요청만 기존 [[SPEC-400-control-actions]] 규칙으로 처리된다.
```

```text
SPEC-401-AC-02 (R-CTRL-009, R-CTRL-005)
  Given orcId=pane:%12 에 대해
  When POST /api/orcs/pane:%12/passthrough/arm {expected} 를 보내면
  Then server가 [[SPEC-400-control-actions]] §2.6 fresh read-only 재검증을 수행하고,
       통과 시 baseline=expected 로 arm-session(armSessionId)을 만들어 반환하며 send-keys 는 발행하지 않고,
       재검증 불일치면 세션을 만들지 않고 410 target_gone / 409 target_mismatch 로 거부한다.
```

```text
SPEC-401-AC-03 (R-CTRL-009, R-CTRL-001)
  Given armed 상태에서 사용자가 "abc" 를 타이핑할 때
  When client가 /input {text:"abc", submit:false, expected, passthrough} 를 보내면
  Then controlExec 가 ['send-keys','-t','%12','-l','--','abc'] 를 발행하고 Enter 를 자동으로 붙이지 않으며,
       같은 요청에서 submit:true(또는 생략)면 422 validation_error 로 거부된다.
```

```text
SPEC-401-AC-04 (R-CTRL-009, R-CTRL-002)
  Given armed 상태의 /key + passthrough 요청에서
  When key ∈ INTERACTIVE_KEY_ALLOWLIST(예 "Up","F2","C-a")와 key ∉ 그 집합(임의 문자열)을 각각 보내면
  Then 전자는 ['send-keys','-t','%12',key] 로 전송되고,
       후자는 422 key_not_allowed 로 거부되며 send-keys 가 발행되지 않는다.
```

```text
SPEC-401-AC-05 (R-CTRL-009, R-CTRL-002, R-CTRL-003)
  Given armed 상태에서 파괴적 chord(C-c/C-d/C-z/C-\\)를 다룰 때
  When passthrough /key 로 그 chord 를 보내면 그리고 사용자가 armed 상태에서 C-c 를 누르면
  Then passthrough /key 의 그 chord 는 422 key_not_allowed 로 거부되고(send-keys 없음),
       C-c 는 [[SPEC-400-control-actions]] §2.7 confirm modal → /interrupt {confirmed:true} 로만 라우팅되며
       /interrupt 는 passthrough 마커를 받지 않아 confirm 을 우회할 수 없다.
```

```text
SPEC-401-AC-06 (R-CTRL-009, R-CTRL-005)
  Given armed 세션 중 대상 pane의 foreground command 가 바뀌거나 pane 이 사라졌을 때
  When 다음 passthrough egress 가 도착하면
  Then Gate 5 fresh 재검증이 drift 를 감지해 그 egress 를 abort(send-keys 없음)하고,
       arm-session 을 즉시 닫아 §2.9 배치 audit 1건(reason=target_mismatch/target_gone, severity=warn)을 flush하며,
       이후 egress 는 재-arm 을 요구한다(409 not_armed).
```

```text
SPEC-401-AC-07 (R-CTRL-009)
  Given armed 세션에서 마지막 키스트로크 이후 PASSTHROUGH_IDLE_MS(가설 240s) 를 초과하도록 무입력일 때
  When 그 세션을 검사/다음 egress 를 시도하면
  Then 세션이 auto-disarm(closeReason='idle_timeout')되어 §2.9 배치 audit 1건이 flush되고,
       이후 passthrough egress 는 409 not_armed 로 거부되어 재-arm 이 필요하다.
```

```text
SPEC-401-AC-08 (R-CTRL-007, R-PRIV-004, [[08-Decisions|D-016]])
  Given armed 세션 중 사용자가 secret 형태(예: ghp_<token>)를 포함해 타이핑한 뒤 세션이 닫힐 때
  When 산출된 control.passthrough_session ActivityEvent·debug log 를 검사하면
  Then ghp_<token> literal·전송한 literal 텍스트·키스트로크 원문·전송 key 시퀀스·startup token 이
       message·detail 어디에도 나타나지 않고, detail 은 keystrokeCount·durationMs·inputRedactedFlag(boolean)·
       (optional)keyHistogram·execFailures·correlationId 만 담는다.
```

```text
SPEC-401-AC-09 (R-CTRL-007, [[08-Decisions|D-043]])
  Given 하나의 arm-session 동안 N 회의 passthrough egress(문자·키)가 일어날 때
  When activity ring buffer([[SPEC-600-observability]])를 검사하면
  Then passthrough egress 는 per-action control.result 를 발행하지 않고,
       세션이 닫힐 때 code='control.passthrough_session' 인 ActivityEvent 가 정확히 1건 산출된다(키스트로크 단위 audit 없음).
```

```text
SPEC-401-AC-10 (R-CTRL-008, [[08-Decisions|D-019]], [[08-Decisions|D-043]])
  Given passthrough(arm/disarm + armed egress)와 scan 을 함께 실행하는 동안
  When 실제로 spawn된 tmux argv 전체를 관측하면
  Then send-keys 를 발행한 호출은 모두 controlExec 의 literal/key 템플릿과 일치하고,
       /passthrough/arm·/passthrough/disarm 은 send-keys 를 전혀 발행하지 않으며(arm=read-only 재검증, disarm=audit flush),
       tmuxExec('send-keys',…) 는 여전히 throw 한다(single-writer 불변, read 경로 무변경).
```

```text
SPEC-401-AC-11 (R-CTRL-009)
  Given 같은 paneId 로 armed passthrough egress 가 빠르게 연속 도착할 때
  When 이를 처리하면
  Then [[SPEC-400-control-actions]] §2.10 per-pane mutex 로 at-most-one in-flight 직렬 실행되어 키스트로크가 interleave되지 않고,
       PASSTHROUGH_KEYSTROKE_RATE(가설 20/s) 초과분은 429 rate_limited 로 거절되며 원문은 저장되지 않는다.
```

```text
SPEC-401-AC-12 (R-CTRL-009, R-CTRL-008)
  Given passthrough 요청 스키마에 대해
  When passthrough 마커에 armSessionId 외 임의 필드나 subcommand/shell/key 자유 명령 필드를 주입 시도하면
  Then unknown 필드가 422 validation_error 로 거부되고, passthrough 는 어떤 자유 명령 필드도 추가하지 않으며,
       egress 는 여전히 [[SPEC-400-control-actions]] literal/key 템플릿으로만 구성된다(구조적 불가).
```

```text
SPEC-401-AC-13 (R-CTRL-002, R-CTRL-003, [[08-Decisions|D-043]])  [passthrough literal control-byte 필터 — 2026-07-02 리뷰 반영]
  Given armed 상태에서 passthrough /input 의 text 가 raw control byte(0x03=^C, 0x04=^D, 0x1a=^Z, 0x1c=^\, 0x0a=개행)를 포함할 때
  When 그 egress 를 처리하면
  Then [[SPEC-400-control-actions]] §2.3.1 필터를 상속해 422 control_char_not_allowed 로 거부되고 send-keys 가 발행되지 않으며,
       -l -- 를 통해서도 어떤 제어 byte 도 pane 에 도달하지 못한다(literal 경로의 destructive/confirm 우회 차단, [[SPEC-007-test-validation]] control-byte injection 케이스).
```

```text
SPEC-401-AC-14 (R-CTRL-009, R-CTRL-005, [[08-Decisions|D-044]])  [exposure-gated arm — 2026-07-02 리뷰 반영]
  Given 글로벌 exposure gate 가 off 인 상태에서
  When POST /api/orcs/:orcId/passthrough/arm 을 보내면
  Then 409 exposure_off 로 거부되어 arm-session 이 생성되지 않고(blind write 금지),
       이미 arm 된 세션 중 exposure 가 off 로 바뀌면 auto-disarm(closeReason='exposure_off')되어 배치 audit 1건이 flush된다.
```

```text
SPEC-401-AC-15 (R-CTRL-009, R-CTRL-004)  [armSessionId actor binding — 2026-07-02 리뷰 반영]
  Given 연결 A 가 arm 해 armSessionId 를 받은 뒤 그 id 가 다른 연결 B 로 유출/재사용될 때
  When 연결 B 가 그 armSessionId 로 passthrough egress 를 보내면
  Then server 가 세션의 actorId 와 요청 actor 불일치를 감지해 409 not_armed 로 거부하고 controlExec 를 호출하지 않으며,
       연결 A 종료 시 세션은 conn_closed 로 닫힌다(유출 id 의 cross-connection replay 불가; token auth 위 방어선).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-CTRL-009 | Observe/Control 2단계·server arm-session(actor binding)·auto-disarm·확장 allowlist·rate cap·배치 audit·재검증 재적용·exposure-gated arm(전 항목) | SPEC-401-AC-01~AC-15 |
| R-CTRL-001 | printable → controlExec `literal`(`-l --`, submit:false) egress + control-byte 필터 계승 | SPEC-401-AC-03, SPEC-401-AC-13 |
| R-CTRL-002 | armed `/key` = `INTERACTIVE_KEY_ALLOWLIST`(superset), 비허용/파괴적 chord 거부, literal control-byte 차단 | SPEC-401-AC-04, SPEC-401-AC-05, SPEC-401-AC-13 |
| R-CTRL-005 | arm 시점 + 매 egress burst 재검증([[SPEC-400-control-actions]] §2.6 재사용), drift → abort+auto-disarm | SPEC-401-AC-02, SPEC-401-AC-06 |
| R-CTRL-007 | 세션당 `control.passthrough_session` 1건, 원문 비저장·keyHistogram default-off([[SPEC-600-observability]] 매핑) | SPEC-401-AC-08, SPEC-401-AC-09 |
| R-CTRL-003 (정신) | `C-c`는 passthrough 밖 confirm 게이트/전용 endpoint 유지; literal control-byte로도 우회 불가 | SPEC-401-AC-05, SPEC-401-AC-13 |
| R-CTRL-004 (계승) | armSessionId actor binding = token auth 위 replay 방어선 | SPEC-401-AC-15 |
| R-CTRL-008 (계승) | 새 writer/자유 명령 필드 없음, controlExec 단일 writer 확장 | SPEC-401-AC-10, SPEC-401-AC-12 |
| R-PRIV-004 (확장) | keystroke 원문·literal·token 비직렬화(non-persistence 확장), keyHistogram default-off | SPEC-401-AC-08 |
| [[08-Decisions\|D-043]] | passthrough=controlExec 위 arm/disarm 2단계, 확장 allowlist, batch audit | SPEC-401-AC-01~AC-15 |
| [[08-Decisions\|D-006]] (계승) | 보수적 재검증 abort, not_controllable, blind-write 금지 | SPEC-401-AC-06, SPEC-401-AC-14 |
| [[08-Decisions\|D-044]] (exposure) | 글로벌 exposure off 시 arm 거부·exposure_off auto-disarm | SPEC-401-AC-14 |

> R-CTRL-009는 **proposed(미승인)**이며 [[08-Decisions|D-043]](proposed)에 근거한다 — spec-reviewer + 도메인 리뷰(security-privacy / tmux-systems / product-ui) 게이트에서 ratify한다. 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — [[SPEC-600-observability]] `ActivityDetail` 확장 필요(검토 필요)**: 배치 요약(§2.9)은 `keystrokeCount`(수치)와 optional `keyHistogram`을 필요로 하나 [[SPEC-600-observability]] §2.1 `ActivityDetail`에는 아직 없다(있는 것: `durationMs`·`inputRedactedFlag`·`outcome`·`controlOutcome`·`reason`·`correlationId`). **제안**: SPEC-600 `ActivityDetail`에 `keystrokeCount?: number`·`keyHistogram?: Record<string,number>`를 non-raw 필드로 추가하고, `ActivityEvent.code` 안정 집합에 `control.passthrough_session`을 추가한다. envelope(type/seq/id/message) 자체는 재정의하지 않는다. SPEC-600 소유자 승인 대상. (임시 대안: `keystrokeCount`를 기존 `inputByteLength`로 근사하되 의미가 달라 비권장.)
- **C2 — [[SPEC-400-control-actions]] request 스키마 확장(본 개정에서 반영)**: `InputRequest`/`KeyRequest`에 optional `passthrough?: PassthroughMarker`를 추가하고 `InterruptRequest`에는 추가하지 않는다. unknown-field 거부·R-CTRL-008(자유 명령 필드 부재)는 유지된다. SPEC-400 개정 §2.12에 접점을 명시했다.
- **C3 — [[SPEC-203-terminal-workspace]] 정합(cross-cluster, 저자 매칭 필요)**: (a) `C-c` 등 파괴적 키를 armed focus에서 passthrough로 보내지 말고 confirm/interrupt 경로로 라우팅해야 한다(§2.7) — client focus 처리가 이 라우팅을 구현해야 한다. (b) auto-disarm 표시·타이머·arm 토글 UX는 SPEC-203 소유이나 server의 `idleTimeoutMs`(arm 응답)와 정합해야 한다. (c) printable 문자 배칭(≤`PASSTHROUGH_LITERAL_BURST_MAX`)은 client 책임이다. **SPEC-203 저자가 맞춰야 하는 P0 접점.**
- **C4 — [[SPEC-103-pane-live-stream]] 직교성(확인)**: passthrough write와 live view read는 별 채널이며 서로 blocking 관계가 아니다. 단 [[08-Decisions|D-044]] 글로벌 exposure gate가 off인 orc에 대해 arm을 허용할지(쓰기지만 화면을 못 보는 상태)는 정합 필요 — §6 Q3.
- **C5 — arm/disarm endpoint 도입의 최소성(리뷰 대상)**: locked 계약은 "egress는 기존 endpoint 재사용, arm/disarm은 주로 client 상태"를 요구한다. 본 spec은 audit 범위·auto-disarm·server-enforced Observe를 위해 **egress를 하지 않는** 최소 arm/disarm endpoint 2개를 도입했다(§2.3). security-privacy-engineer가 이 최소성/정당성을 게이트한다.

### Open Questions (검토 필요 / PoC·정합 대상)

- **Q1 — 재검증 비용 vs burst 크기**: 매 egress burst 재검증(§2.5)은 [[SPEC-400-control-actions]] §2.6 `list-panes -a` 재조회를 유발한다. 빠른 타이핑에서 request/재검증 폭증 가능 — client 배칭(§2.8)과 재검증 캐시 창(가설: arm baseline 이후 `PASSTHROUGH_REVALIDATE_MS` 내 재사용) 도입 여부를 [[SPEC-007-test-validation]] 측정으로 판정. 단 재검증을 **약화하지 않는** 선에서만. **검토 필요.**
- **Q2 — 상수 확정**: `PASSTHROUGH_IDLE_MS`(3–5m band)·`PASSTHROUGH_KEYSTROKE_RATE`·`PASSTHROUGH_LITERAL_BURST_MAX`·`INTERACTIVE_KEY_ALLOWLIST` membership은 §3.9 가설. 사용성·안전 측정으로 확정. **검토 필요.**
- **Q3 — exposure off에서 arm 허용 여부 (해소, 2026-07-02 리뷰 반영)**: **거부(refuse)**로 확정 — 글로벌 exposure off이면 arm을 `409 exposure_off`로 거부하고 세션 중 off 전환 시 auto-disarm한다(§2.3/§2.6, AC-14, [[08-Decisions|D-044]]/[[08-Decisions|D-006]]). blind write 금지. per-pane 승격은 [[08-Decisions|D-044]] forward.
- **Q4 — 중복 arm 정책**: 같은 pane/연결에 arm 중복 요청 시 기존 세션 갱신 vs 거부(§2.2). 사용성 PoC로 보정. **검토 필요.**
- **Q5 — armSessionId 취급 (해소, 2026-07-02 리뷰 반영)**: `armSessionId`를 **인증 연결(`actorId`)에 바인딩**하고 egress 시 actor 일치를 강제한다(§2.2, AC-15) — 유출돼도 cross-connection replay 불가. token auth([[SPEC-100-server-lifecycle]]) 위 defense-in-depth. token 아니며 audit엔 correlationId로만 노출.
- **Q6 — keyHistogram 노출 위험 (해소, 2026-07-02 리뷰 반영)**: `keyHistogram`은 **기본 off·opt-in**으로 확정하고, opt-in되어도 allowlist 키 이름·횟수만 담으며 **literal 텍스트/문자는 절대 포함하지 않는다**(§2.9, AC-08). 기본 산출은 `keystrokeCount`·`durationMs`·`inputRedactedFlag`·`execFailures`·`correlationId`.
