---
spec: SPEC-400
title: Control actions·안전장치·audit·UI flow
status: approved
updated: 2026-06-27
requirements: [R-CTRL-001, R-CTRL-002, R-CTRL-003, R-CTRL-004, R-CTRL-005, R-CTRL-006, R-CTRL-007, R-CTRL-008, R-UI-004]
decisions: [D-006, D-019, D-017, D-016, D-003, D-028]
tags:
  - specs
  - control
  - safety
  - audit
  - security
  - backend
---

# SPEC-400 — Control actions·안전장치·audit·UI flow

Orc Camp의 **첫 state-changing(쓰기) 표면**인 control action의 계약을 고정한다. scan/serve 슬라이스의 모든 tmux 접근은 read-only였다([[08-Decisions|D-019]], [[SPEC-006-privacy-redaction]] §2.6 — `list-*`/`capture-pane`만). 본 spec은 사용자가 dashboard에서 선택한 orc(=tmux pane)에 **text 입력·allowlist key·interrupt**를 전달하는 별도의·엄격히 게이트된 **쓰기 경로(`controlExec`)**를 정의한다. 이 쓰기 경로는 scanner의 read-only 불변식을 **느슨하게 만들지 않는다** — read 경로(`tmuxExec`)의 allowlist는 그대로 read-only이고, control은 `tmuxExec`와 **물리적으로 분리된** 별도 wrapper만으로 `send-keys`를 spawn한다(§2.1). 이 경계는 명시적이며 테스트로 강제된다(§4 AC-09/AC-10).

본 spec이 정의하는 것: (a) read-only vs write-path 경계(§2.1), (b) 3개 control endpoint의 request/response·error(§2.2~§2.3·§2.9), (c) `send-keys` 인자 템플릿과 injection 차단(§2.3), (d) key allowlist(§2.4), (e) 안전 게이트 파이프라인(§2.5), (f) 실행 직전 target 재검증(§2.6, R-CTRL-005), (g) control context·confirm(§2.7, R-CTRL-006·R-CTRL-003), (h) audit event producer 계약과 privacy(§2.8, R-CTRL-007), (i) inspector → action → modal → execute → toast UI flow(§2.11).

> **쓰기 경계 불변식(확정, [[08-Decisions|D-019]] 확장)**: tmux를 spawn하는 진입점은 정확히 둘이며 권한이 분리된다 — **read 경로** `tmuxExec`(`list-sessions`/`list-windows`/`list-panes`/`capture-pane`/`-V` allowlist, `send-keys`는 denylist, [[SPEC-006-privacy-redaction]] §2.6)와 **write 경로** `controlExec`(`send-keys` **단일** subcommand, 고정 인자 템플릿 3종, §2.1·§2.3). control endpoint는 `controlExec`만 호출하고 scanner는 `tmuxExec`만 호출한다. 이 분리는 코드·테스트로 강제되며 어느 쪽도 다른 쪽의 권한을 얻지 못한다.

> **인증 의존(확정, R-CTRL-004 = R-SEC-003 floor)**: 모든 control endpoint는 [[SPEC-100-server-lifecycle]] §2.6/§3.3의 startup token auth 미들웨어 **뒤에** 위치한다. token 생성·전달·검증 메커니즘은 본 spec이 재정의하지 않고 그대로 소비한다(§2.5 Gate 1).

> **식별자 권위(확정, [[08-Decisions|D-017]])**: 제어 대상의 권위 식별자는 `paneId`(`#{pane_id}`)다. `orcId`(`pane:%<n>`)는 `paneId`를 인코딩하고, `tmuxTarget`(`session:window.pane`)은 표시 전용·가변이다(rename/reindex). `send-keys`의 `-t` target은 가변 `tmuxTarget`이 아니라 **안정 `paneId`**를 쓴다(잘못된 pane 전송 방지, [[08-Decisions|D-006]]).

## 1. Scope

### In scope

- **read-only vs write-path 경계**: `controlExec` 쓰기 wrapper의 정의와 `tmuxExec`(read)와의 권한 분리(§2.1, [[08-Decisions|D-019]] 확장).
- **control endpoint 표면**: `POST /api/orcs/:orcId/input`(R-CTRL-001), `POST /api/orcs/:orcId/key`(R-CTRL-002), `POST /api/orcs/:orcId/interrupt`(R-CTRL-003) — request/response·error state·권한·idempotency 판단(§2.2~§2.3, §2.9, §2.10).
- **`send-keys` 인자 템플릿**: text(`-l --` literal), key(allowlist), interrupt(`C-c`)의 고정 argv 템플릿과 argument/command injection 차단(§2.3, R-CTRL-001/002/008).
- **key allowlist**(§2.4, R-CTRL-002).
- **안전 게이트 파이프라인**: token → schema → target 재검증 → action-specific → 실행 → audit 순서(§2.5).
- **target 재검증**(§2.6, R-CTRL-005): 실행 직전 `orcId→paneId/tmuxTarget/current command/agentType`가 마지막 snapshot과 일치하는지 fresh read-only 재검증, 불일치 시 abort + audit.
- **control context·confirm**(§2.7, R-CTRL-006·R-CTRL-003): interrupt confirm modal과 input/key command dock이 표시할 `agentType`/`tmuxTarget`/`cwd`/`current command`, 그리고 backend의 confirm 강제.
- **arbitrary shell command 금지**(§2.1·§2.3, R-CTRL-008): API 표면이 임의 명령 실행을 **구조적으로 불가능**하게 만드는 설계.
- **audit producer 계약**(§2.8, R-CTRL-007): 모든 control 결과(success/partial/aborted/failed + reason)를 [[SPEC-600-observability]]의 canonical `ActivityEvent`(`type:'control.result'`)로 **매핑·산출**. event 모델·저장·포맷·`id`/`seq`/`message` 부여는 SPEC-600 소유, 본 spec은 control action → `target`/`detail` **매핑(producer)**을 소유([[08-Decisions|D-028]]).
- **concurrency·rate limit**(§2.10): pane별 직렬화, in-flight 가드, rate limit(가설).
- **UI flow contract**(§2.11): inspector entry → action → (interrupt) confirm modal → execute → result toast/audit. 진입점 enable/disable 실행 가능성.
- 다룬 요구사항: **R-CTRL-001~008**, R-UI-004(control entry → action flow 측면).

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| startup token 생성·전달·검증 **메커니즘** | 본 spec은 그 gate를 소비만 | [[SPEC-100-server-lifecycle]] §2.6 |
| loopback bind·CORS·Host 검증·외부 bind opt-in | 공통 보안 경계 | [[SPEC-100-server-lifecycle]] §2.7 |
| activity log **저장·포맷·ring buffer·debug log** | observability SSOT, 본 spec은 event를 **산출**만 | [[SPEC-600-observability]] |
| `control.result` event **payload(ActivityEvent) 모델·저장**(canonical) | observability SSOT | [[SPEC-600-observability]] §2.1~§2.4 |
| `control_result`/`activity` **WS frame envelope·전송·reconnect**(payload는 위) | realtime transport 계약 | [[SPEC-102-realtime-sync]] §2.3 |
| inspector **레이아웃**·control 진입점 **가시성**·command dock 배치 | 화면 표면 | [[SPEC-201-dashboard-screens]] §2.4 |
| destructive action **a11y**(focus trap·Cancel 기본 포커스·label·hit area) | 접근성 비장식화 게이트 | [[SPEC-202-design-accessibility]] §2.3/§2.8 |
| `Orc`/`AgentType`/`OrcStatus` 필드 shape·enum·redaction | 데이터 계약·privacy | [[SPEC-005-data-contract]], [[SPEC-006-privacy-redaction]] |
| pane raw 수집·`paneId`/`command`/`cmdline` 출처·timeout·error isolation | inventory 수집(재검증 read가 재사용) | [[SPEC-002-tmux-discovery]] |
| snapshot version·diff·`GET /api/snapshot` | snapshot runtime | [[SPEC-101-snapshot-api]] |

## 2. Contract

### 2.1 read-only vs write-path 경계: `controlExec` ([[08-Decisions|D-019]] 확장; R-CTRL-008)

tmux 바이너리를 spawn하는 진입점은 **두 개**이며 권한이 분리된다.

| wrapper | 소유 | 허용 subcommand | 금지 | 호출자 |
| --- | --- | --- | --- | --- |
| `tmuxExec` (read) | [[SPEC-006-privacy-redaction]] §2.6 | `list-sessions`/`list-windows`/`list-panes`/`capture-pane`/`-V` (fail-closed allowlist) | `send-keys` 포함 모든 상태변경(denylist) | scanner / 재검증 read(§2.6) |
| `controlExec` (write) | **본 spec** | `send-keys` **단 하나**(고정 템플릿 3종) | 그 외 모든 subcommand(템플릿 외 구성 불가) | control endpoint handler만 |

```ts
// 본 spec이 정의하는 유일한 쓰기 경로. send-keys 외 어떤 subcommand도 구성 불가능하다.
type ControlOp =
  | { kind: 'literal';   paneId: string; text: string } // 텍스트 입력(literal)
  | { kind: 'key';       paneId: string; key: string }  // allowlist key
  | { kind: 'interrupt'; paneId: string };              // C-c

const CONTROL_TIMEOUT_MS = 2000; // 가설(§3, [[SPEC-002-tmux-discovery]] §2.6 T와 정합)

function controlExec(op: ControlOp): SpawnResult {
  // 0) paneId 형식 강제: 정확히 ^%[0-9]+$ 아니면 throw(spawn 안 함). 식별자 권위 [[08-Decisions|D-017]].
  // 1) subcommand는 하드코딩 'send-keys'. 호출자는 subcommand/flag를 절대 주입할 수 없다.
  // 2) kind별 고정 argv 템플릿(§2.3). key는 KEY_ALLOWLIST 검증 후에만(§2.4).
  // 3) child_process.spawn('tmux', argv, { shell: false, timeout: CONTROL_TIMEOUT_MS })
  //    shell:false → 셸 보간/`run-shell`/`if-shell` 경유 임의 명령 실행 경로 원천 차단.
  // 4) timeout 초과 시 SIGTERM→SIGKILL. send-keys는 즉시 반환형이라 정상상황 timeout은 드묾.
}
```

- **`tmuxExec`는 변경 없음**: scanner의 read-only allowlist는 그대로다. `send-keys`는 `tmuxExec`의 `STATE_CHANGING_DENYLIST`에 남아 있으므로 **read 경로로는 쓰기가 불가능**하다([[SPEC-006-privacy-redaction]] §2.6). control은 이 allowlist를 **느슨하게 하지 않고**, 분리된 `controlExec`를 추가할 뿐이다.
- **구조적 R-CTRL-008**: control endpoint 어디에도 "tmux subcommand"나 "shell command" 같은 **자유 명령 파라미터가 없다**(§2.2 schema). `controlExec`의 subcommand는 하드코딩이고 인자는 3개 템플릿으로 고정된다. 따라서 임의 명령 실행은 **API shape 차원에서 불가능**하다(문서가 아니라 타입·테스트로 강제 — AC-09).
- **단일 writer 단언**: 전체 server에서 `send-keys`를 spawn하는 코드는 `controlExec` **하나**다. test는 (a) `tmuxExec('send-keys', …)`가 throw하고 spawn하지 않으며, (b) control+scan을 함께 돌렸을 때 `send-keys`로 spawn된 모든 argv가 `controlExec` 템플릿과 정확히 일치함을 관측한다(AC-10).

### 2.2 control endpoint 표면 (R-CTRL-001/002/003)

세 endpoint 모두 **state-changing**이며 token auth 미들웨어 뒤에 있다(§2.5 Gate 1, [[SPEC-100-server-lifecycle]] §3.3). path param은 stable `orcId`(`pane:%<n>`)다([[08-Decisions|D-017]], [[SPEC-101-snapshot-api]] §2.7 path 규칙 정합).

| Method | Path | action | 요구 body 핵심 | 비고 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/orcs/:orcId/input` | text 입력 | `text`, `submit?`, `expected` | literal 전송 후 기본 Enter(R-CTRL-001) |
| `POST` | `/api/orcs/:orcId/key` | allowlist key | `key`, `expected` | `key ∈ KEY_ALLOWLIST`(R-CTRL-002) |
| `POST` | `/api/orcs/:orcId/interrupt` | interrupt | `confirmed: true`, `expected` | confirm 강제 + `C-c`(R-CTRL-003) |

공통 request 타입(엄격 schema — **unknown 필드 거부**가 R-CTRL-008 schema-층 방어):

```ts
interface ExpectedTarget {           // 사용자가 inspector/modal에서 본 값(§2.7). 실행 직전 fresh read와 대조(§2.6).
  paneId: string;                    // orcId 파생 paneId와 동일해야 함(^%[0-9]+$)
  tmuxTarget: string;                // 표시 전용 target(가변) — drift 감지용
  command: string;                   // #{pane_current_command} foreground — "같은 orc인가" 최강 신호
  agentType: 'claude-code' | 'codex' | 'unknown'; // [[SPEC-005-data-contract]]
}

interface InputRequest     { text: string; submit?: boolean; expected: ExpectedTarget; requestId?: string }
interface KeyRequest       { key: string;                    expected: ExpectedTarget; requestId?: string }
interface InterruptRequest { confirmed: true;                expected: ExpectedTarget; requestId?: string }
```

- **`text`**: UTF-8 string, `byteLength ≤ MAX_INPUT_BYTES`(가설 4 KiB, §3). `submit`(기본 `true`)이면 literal text 전송 후 별도 `Enter` key 전송(§2.3).
- **`key`**: 정확히 한 토큰. `KEY_ALLOWLIST`(§2.4) 외면 거부.
- **`confirmed`**: 리터럴 `true`만 허용. 누락/`false`면 `confirm_required`(R-CTRL-003 backend 강제).
- **`requestId`**(선택): at-most-once dedup용 상관 id(§2.10). rail 항목인 control.result `ActivityEvent.detail.correlationId`(§2.8)와 동기 HTTP 응답 `ControlResult.requestId`에 carry되나 token은 절대 carry하지 않는다([[SPEC-102-realtime-sync]] §2.1).
- 본 spec은 **자유 명령/subcommand/args 필드를 schema에 두지 않는다** — 그런 필드는 unknown으로 거부된다(R-CTRL-008).

성공 응답(`200`):

```ts
interface ControlResult {
  ok: true;
  action: 'input' | 'key' | 'interrupt';
  orcId: string;                     // "pane:%12"
  paneId: string;                    // "%12" (실행에 쓴 권위 target)
  tmuxTarget: string;                // fresh read로 확인된 현재 target(표시)
  outcome: 'success' | 'partial';    // partial = input의 text는 갔으나 Enter 실패(§3.6)
  executedAt: string;                // ISO 8601
  requestId: string | null;
  auditEventId: string;              // 산출된 control.result ActivityEvent.id (§2.8, [[SPEC-600-observability]])
}
```

실패/abort 응답: §2.9. **성공이든 실패든 audit event를 산출**하므로 응답은 항상 `auditEventId`를 담는다(R-CTRL-007).

### 2.3 `send-keys` 인자 템플릿과 injection 차단 (R-CTRL-001/002/008)

`controlExec`가 만드는 argv는 정확히 아래 3종뿐이며 모두 `spawn('tmux', argv, { shell:false })`로 실행된다.

| kind | argv 템플릿 | 의미 | injection 방어 |
| --- | --- | --- | --- |
| `literal` | `['send-keys','-t',paneId,'-l','--',text]` | `text`를 **리터럴 키스트로크**로 pane에 입력 | `-l`=리터럴(키 이름 해석 안 함) + `--`=옵션 파싱 종료. `text`가 `C-c`/`-X`/`$(...)`여도 **문자 그대로** 입력됨. shell:false로 셸 미해석. |
| `key` | `['send-keys','-t',paneId,key]` | `key`(예 `Enter`)를 **키로 해석** | `-l` 미사용(키 해석 필요)이나 `key`는 `KEY_ALLOWLIST`(§2.4)로 제한 → 임의 키/chord 주입 차단. |
| `interrupt` | `['send-keys','-t',paneId,'C-c']` | SIGINT 키 시퀀스 전송 | `C-c` 하드코딩. body에서 키를 받지 않음. confirm 게이트(§2.7). |

- **text 입력의 `-l` 필수성(확정, 보안 핵심)**: 텍스트 입력은 **반드시** `-l --`를 쓴다. `-l`이 없으면 tmux가 `text`를 키 이름으로 해석해(예: 사용자가 입력란에 `C-c`라 치면 실제 interrupt가 전송됨) **키 주입(key-name injection)**이 발생한다. `-l`은 이를 막아 텍스트를 리터럴로만 전달한다. `--`는 `-`로 시작하는 텍스트가 tmux 플래그로 오인되는 것을 막는다.
- **text 입력 + Enter 분리(확정)**: `submit=true`면 ① `controlExec({kind:'literal', text})` 성공 후 ② `controlExec({kind:'key', key:'Enter'})`를 순차 호출한다(설계 청사진 "text 후 Enter 전송", [[05-Backend]]). 같은 paneId에 대해 직렬 실행되며(§2.10), ①성공 ②실패면 `outcome:'partial'`로 audit한다(§3.6).
- **`-t paneId`로 단일 target(확정, R-CTRL-001)**: 모든 템플릿은 안정 `paneId`를 `-t`로 지정해 **명시 선택된 pane에만** 전송한다. 가변 `tmuxTarget`을 쓰지 않으므로 reindex로 인한 오전송을 차단한다([[08-Decisions|D-006]]/[[08-Decisions|D-017]]).
- **arbitrary shell 불가(확정, R-CTRL-008)**: subcommand는 항상 `send-keys`, 셸 미사용, `run-shell`/`if-shell` 미도달. text는 pane 내부 프로그램(=agent)으로의 입력일 뿐 host 셸을 직접 실행하지 않는다. host에서 임의 명령을 실행시키는 endpoint·파라미터는 존재하지 않는다.

### 2.4 key allowlist (R-CTRL-002)

`/key`는 아래 고정 집합만 허용한다(navigation/editing 위주). 값은 tmux key 표기다.

```ts
const KEY_ALLOWLIST = new Set([
  'Enter', 'Tab', 'BTab', 'Escape', 'Space', 'BSpace',
  'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Delete',
]); // 초기 집합(가설, §3). 변경 시 본 §·의존 테스트 동시 갱신.
```

- **확정**: allowlist 밖 토큰(임의 문자열, `C-d`/`C-z`/`C-\\`/`M-x` 등 제어·메타 chord, 함수키 등)은 `key_not_allowed`로 거부하고 **spawn하지 않는다**(AC-03).
- **확정**: 잠재적으로 파괴적인 제어 chord는 `/key`에서 **제외**한다 — `C-c`(interrupt)는 confirm 게이트가 붙은 **전용 endpoint**로만 제공하고, `C-d`(EOF/종료)·`C-z`(suspend)·`C-\\`(SIGQUIT)는 agent를 죽이거나 멈출 수 있어 MVP allowlist에 넣지 않는다.
- **가설**: allowlist 구성·확장(예: agent TUI가 요구하는 키)은 PoC/사용성 검증으로 보정한다(§6 Q).

### 2.5 안전 게이트 파이프라인 (R-CTRL-004/005/008)

모든 control 요청은 아래 게이트를 **순서대로** 통과해야 실행된다. 어느 게이트든 실패하면 **`controlExec`를 호출하지 않고** abort하며, 인증을 통과한 요청은 결과를 audit한다(§2.8).

| # | gate | 실패 시 | 근거 |
| --- | --- | --- | --- |
| 1 | **token auth** | `401 unauthorized`(미들웨어, 핸들러 미도달) | R-CTRL-004([[SPEC-100-server-lifecycle]] §2.6/§3.3) |
| 2 | **method/schema** | `422 validation_error`(unknown 필드·타입·길이·`confirmed`·key 형식) | R-CTRL-008(자유 명령 필드 부재), R-CTRL-002/003 |
| 3 | **orc 해석** | `404 orc_not_found`(현재 published snapshot에 `orcId` 없음) | [[08-Decisions|D-017]] |
| 4 | **controllability** | `409 not_controllable`(status `terminated`/`stale`) | [[08-Decisions|D-006]] |
| 5 | **target 재검증(fresh read)** | `410 target_gone` / `409 target_mismatch` (§2.6) | **R-CTRL-005** |
| 6 | **action-specific** | key allowlist(`422 key_not_allowed`) / interrupt confirm(`422 confirm_required`) | R-CTRL-002/003 |
| 7 | **execute** (`controlExec`) | `502 tmux_exec_failed`(spawn 실패/timeout/non-zero) | §2.1 |
| 8 | **audit** | (실패해도 결과는 응답에 반영; audit 유실은 §3.7) | R-CTRL-007 |

- Gate 1은 [[SPEC-100-server-lifecycle]] 미들웨어가 소유하므로 token 부재 요청은 **control 핸들러에 도달하지 않는다**(audit 대상 아님 — control action이 성립하지 않음). Gate 2~8의 결과만 audit한다.
- Gate 5(재검증)는 **Gate 7 직전에** 수행해 time-of-check↔time-of-use 창을 최소화한다(§3.5 잔여 TOCTOU).

### 2.6 target 재검증 (R-CTRL-005)

control 실행 직전, `orcId`가 가리키는 pane이 **사용자가 본 것과 여전히 동일한지** fresh read-only 재검증한다. 재검증은 **read 경로(`tmuxExec`)** 로만 수행하고(쓰기는 통과 후에만), abort 시 audit한다.

- **fresh read(확정)**: published snapshot은 최대 `scanInterval`만큼 오래됐을 수 있으므로, 재검증은 **실행 시점에** 해당 pane을 read-only로 재조회한다 — `tmuxExec('list-panes', ['-a','-F',<FMT_P>])`로 inventory를 다시 받아 `paneId`로 필터하고(필요 시 `pane_pid → ps` cmdline까지, [[SPEC-002-tmux-discovery]] §2.8), agent 판정([[SPEC-003-agent-detection]])을 동일 read 파이프라인으로 재산출한다. 캐시된 snapshot만 믿지 않는다(AC-16).
- **검증 술어(확정)**: 아래가 **모두** 참이어야 통과한다(`expected` = 사용자가 modal/inspector에서 본 값, §2.7).

  | 항목 | 통과 조건 | 불일치 결과 |
  | --- | --- | --- |
  | identity | fresh에 `expected.paneId`(=`orcId` 파생) pane 존재 | 부재 → `410 target_gone` |
  | target | `fresh.tmuxTarget == expected.tmuxTarget` | 다름 → `409 target_mismatch` |
  | command | `fresh.command(foreground) == expected.command` | 다름 → `409 target_mismatch` |
  | agentType | `fresh.agentType == expected.agentType` | 다름 → `409 target_mismatch` |

- **보수적 abort(확정, [[08-Decisions|D-006]])**: 식별자 권위는 `paneId`지만([[08-Decisions|D-017]]), R-CTRL-005는 `target`·`current command`까지 일치를 요구한다. 따라서 `paneId`가 살아 있어도 **foreground command가 바뀌었거나**(예: `claude` 종료 후 같은 pane에 `bash`가 떠 있음) **target이 reindex로 달라졌으면 abort**한다. 이는 "사용자가 의도한 orc가 아닐 수 있는" 상태로의 전송을 막는 안전 우선 결정이다(잘못된 pane/문맥에 text·interrupt 전송 방지).
- **abort = audit + no write(확정)**: 재검증 실패 시 `controlExec`를 호출하지 않고 `outcome:'aborted'`·`reason`(`target_gone`/`target_mismatch`)으로 audit event를 산출한다(§2.8, AC-06/AC-07).
- **잔여 TOCTOU(가설/한계)**: 재검증 read와 `send-keys` write는 별도 tmux spawn이라 둘 사이 원자성이 없다. 창을 최소화(Gate 7 직전 재검증)하되 완전 제거는 tmux 수준 원자성이 없어 불가하다 — 수용된 bounded 리스크로 §6 Q에 추적한다.

### 2.7 control context·confirm (R-CTRL-006, R-CTRL-003)

- **control context(확정, R-CTRL-006)**: 사용자가 action을 일으키는 지점에서 항상 **`agentType` / `tmuxTarget` / `cwd` / current command** 4개를 표시한다.
  - **interrupt**: confirm modal이 이 4개를 표시한다(파괴적이므로 모달 필수).
  - **input·key**: inspector command dock의 context 헤더가 이 4개를 상시 표시한다([[SPEC-201-dashboard-screens]] §2.4 inspector 콘텐츠와 정합 — 레이아웃은 SPEC-201, 표시 의무는 본 spec).
  - **coherence(확정)**: modal/context가 표시하는 이 4개 값이 그대로 request의 `expected`(§2.2)가 되어 backend가 재검증(§2.6)한다. 즉 **사용자가 확인한 것 = backend가 대조하는 것**이다(AC-11). `cwd`는 표시·맥락용이며 redaction된 값이다([[SPEC-006-privacy-redaction]] §2.3); 재검증 술어에는 noise를 피하려 포함하지 않는다(command/agentType/target/paneId로 충분).
- **interrupt confirm 강제(확정, R-CTRL-003)**: interrupt는 UI confirm modal **그리고** backend `confirmed:true` 요구의 **이중 게이트**다(defense in depth). UI를 우회한 직접 호출도 `confirmed`가 없으면 `confirm_required`로 거부된다(AC-04). modal a11y(focus trap·초기 포커스 Cancel·destructive 비장식화)는 [[SPEC-202-design-accessibility]] §2.3 K5/§2.8 A6 소유.

### 2.8 audit producer 계약 — `control.result` ActivityEvent 산출 (R-CTRL-007, [[08-Decisions|D-028]])

모든 control action의 결과를 [[SPEC-600-observability]]의 **canonical `ActivityEvent`(`type:'control.result'`)** 한 건으로 산출한다. event 모델·`id`/`seq`/`createdAt`/`message` 부여·ring buffer 저장·포맷은 [[SPEC-600-observability]] §2.1~§2.3 소유다. 본 spec은 control action 데이터를 그 canonical envelope의 **`target`/`detail`로 매핑하는 producer**를 소유한다.

> **canonical 모델 = [[SPEC-600-observability]] `ActivityEvent`(확정, [[08-Decisions|D-028]])**: control audit의 단일 표현은 SPEC-600 `ActivityEvent`이며 `type`은 `'control.result'`다. 본 spec은 별도 envelope를 정의하지 않는다 — 과거의 flat `ControlAuditEvent{type:'control_action', …}`는 폐기하고(§6 C4) 아래 매핑만 고정한다. `type` token·구조는 SPEC-600이 권위다.

```ts
// control audit producer: SPEC-600 ActivityEvent(type='control.result')로 매핑한다.
// SPEC-600이 id/seq/createdAt/source='server'/message를 부여하고 ring buffer에 적재한다([[SPEC-600-observability]] §2.1~§2.3).
interface ControlResultMapping {                  // = SPEC-600 ActivityEvent(control.result)의 producer view
  type: 'control.result';                         // canonical token ([[SPEC-600-observability]] §2.1/§2.2)
  severity: 'info' | 'warn' | 'error';            // success→info · partial|aborted→warn · failed→error
  code: string;                                   // 안정 machine code (action+outcome 파생; 아래 표)
  target: {                                       // → ActivityEvent.target ([[SPEC-600-observability]] §2.1)
    orcId: string;                                // "pane:%12"
    paneId: string;                               // "%12" — 실행 권위 target ([[08-Decisions|D-017]])
    tmuxTarget: string;                           // 표시 전용 (행위 시점)
  };
  detail: {                                       // → ActivityEvent.detail — 전부 redaction-safe 구조 값
    action: 'input' | 'key' | 'interrupt';
    controlOutcome: 'success' | 'partial' | 'aborted' | 'failed'; // 4-값 control 결과(보존)
    outcome: 'success' | 'failure';               // coarse (success→success, partial|aborted|failed→failure)
    reason: string | null;                        // aborted/failed token(target_gone/target_mismatch/tmux_exec_failed/confirm_required/key_not_allowed/...)
    keyName: string | null;                       // action='key'면 allowlist 키 이름(secret 아님), 그 외 null
    inputByteLength: number | null;               // action='input'이면 text byteLength(내용 아님), 그 외 null
    inputRedactedFlag: boolean | null;            // text의 redaction 패턴 매칭 여부(내용 미포함, [[SPEC-006-privacy-redaction]]), 그 외 null
    exitCode: number | null;                      // tmux 종료 코드
    durationMs: number | null;                    // 실행 timing
    correlationId: string | null;                 // requestId/errorId — debug log 연결(R-API-005)
  };
  // 금지: send-keys 원문(text)·전송 key 시퀀스·token은 어떤 필드에도 직렬화하지 않는다([[SPEC-600-observability]] §2.7).
}
```

**`code` 파생(확정)** — `ActivityEvent.code`는 안정 machine code이고, fine-grained 사유는 `detail.reason`이 담는다:

| action·outcome | `code` | `detail.reason` |
| --- | --- | --- |
| input success/partial | `control.input_sent` | null |
| key success | `control.key_sent` | null |
| interrupt success | `control.interrupt_sent` | null |
| aborted (target_gone/target_mismatch) | `control.target_revalidation_failed` | `target_gone`/`target_mismatch` |
| aborted (confirm 누락) | `control.confirm_required` | `confirm_required` |
| aborted (key 비허용) | `control.key_not_allowed` | `key_not_allowed` |
| failed (tmux non-zero/timeout) | `control.tmux_exec_failed` | `tmux_exec_failed` |

- **확정(R-CTRL-007)**: success·partial·aborted·failed **모두** control.result ActivityEvent **1건**을 산출한다. 응답의 `ControlResult.auditEventId`가 그 `ActivityEvent.id`를 가리킨다(AC-12).
- **privacy 불변식(확정, [[08-Decisions|D-016]] 확장, R-PRIV-004/005)**: ActivityEvent는 **입력 원문(`text`)·전송 key 시퀀스를 어떤 필드에도 직렬화하지 않는다**. `input`은 `detail.inputByteLength` + `detail.inputRedactedFlag`(매칭 여부 boolean)만 남긴다 — 사용자가 친 텍스트에 token/secret이 들어갈 수 있으므로 scan 슬라이스의 non-persistence 계약을 **쓰기 경로로 확장**한다. `key`는 `detail.keyName`(allowlist 키 이름, secret 아님)만 남긴다. **token은 어떤 audit 필드에도 직렬화하지 않는다**([[SPEC-600-observability]] §2.7 금지 행 / [[SPEC-102-realtime-sync]] §2.1 정합)(AC-13).
- **severity 매핑(확정)**: 성공=`info`, partial(text는 갔으나 Enter 실패) 및 안전장치 abort(재검증 실패·confirm 누락)=`warn`, 실행 실패(tmux non-zero/timeout)=`error`. [[SPEC-600-observability]] §2.1 `ActivitySeverity`와 정합.
- **`agentType` 처리(확정)**: 과거 flat 모델의 `agentType`은 canonical control.result 매핑에서 **제외**한다 — 재검증 대조용 값일 뿐 audit 식별엔 `target.orcId`/`target.paneId`로 충분하다(필요 시 `detail` 확장은 §6 Q로 추적).

#### 2.8.1 frame-role split — actor 결과 vs rail 항목 (확정, [[08-Decisions|D-028]]; [[SPEC-102-realtime-sync]] §2.3 참조)

control action 1건의 결과가 두 표면에 어떻게 나뉘는지를 고정한다(transport frame은 [[SPEC-102-realtime-sync]] §2.3 소유 — 본 spec은 재정의하지 않고 역할만 배정한다).

| 표면 | 무엇 | 범위 | 소유 |
| --- | --- | --- | --- |
| **동기 HTTP 응답**(`ControlResult`, §2.2 `200`) | 행위 client의 **즉시(request-scoped) 결과** | actor 전용 | 본 spec |
| **`activity` WS frame** | 내구 **rail 항목** = control.result `ActivityEvent`(§2.8) | 연결된 모든 dashboard | payload [[SPEC-600-observability]] §2.4 / transport [[SPEC-102-realtime-sync]] §2.3 |
| **`control_result` WS frame** | actor의 optimistic echo | actor 전용 | **optional/forward**(아래) |

- **MVP 정규 경로(확정)**: 행위자 결과 = **HTTP 응답**, rail 항목 = **`activity` frame**. 한 control action은 rail에 control.result ActivityEvent **1건**만 만든다(중복 금지).
- **`control_result` frame = optional/forward(확정)**: [[SPEC-102-realtime-sync]] §2.3 카탈로그의 `control_result` frame은 actor의 optimistic echo를 위한 **선택적 향후 최적화**일 뿐 canonical audit이 아니다. 채택하면 본 spec §2.2 `ControlResult`를 직렬화하며(token 미직렬화), 채택하지 않아도 (HTTP 응답=actor) + (`activity` frame=rail)로 모든 표면이 성립한다(AC-12 검증). pessimistic update(§2.11)이므로 actor는 `control_result` echo에 의존하지 않는다.

### 2.9 error model / status codes

| HTTP | code | 트리거 | gate | audit |
| --- | --- | --- | --- | --- |
| `401` | `unauthorized` | token 부재/불일치 | 1 | 미들웨어 처리(control action 미성립, debug log는 [[SPEC-600-observability]]) |
| `404` | `orc_not_found` | `orcId`가 published snapshot에 없음 | 3 | aborted |
| `409` | `not_controllable` | status `terminated`/`stale` | 4 | aborted |
| `410` | `target_gone` | 재검증 시 `paneId` 부재(pane 종료) | 5 | aborted |
| `409` | `target_mismatch` | target/command/agentType drift | 5 | aborted |
| `422` | `validation_error` | schema 위반·unknown 필드·`text` 초과 | 2 | aborted(인증 통과분) |
| `422` | `key_not_allowed` | `key ∉ KEY_ALLOWLIST` | 6 | aborted |
| `422` | `confirm_required` | interrupt에 `confirmed:true` 부재 | 6 | aborted |
| `429` | `rate_limited` | pane/global rate limit 초과(§2.10) | 6.5 | aborted(가설) |
| `502` | `tmux_exec_failed` | `send-keys` spawn 실패/timeout/non-zero | 7 | failed |
| `503` | `snapshot_not_ready` | cold start(첫 snapshot 전, [[SPEC-101-snapshot-api]] §2.6) | 3 | (미성립) |

- error 본문은 `{ ok:false, error:{ code, message }, auditEventId? }`이며 **민감 정보·token·capture 원문을 담지 않는다**([[SPEC-100-server-lifecycle]] §2.6 정합). 사용자에게 보이는 event와 local debug log는 분리 기록한다(R-API-005, [[SPEC-600-observability]]).

### 2.10 idempotency·concurrency·rate limit

- **non-idempotent(확정)**: control action은 본질적으로 비멱등이다(text 2회 = 2회 입력). 따라서 **server·client 모두 자동 재시도하지 않는다**. 네트워크 불확실 시 client는 재전송 대신 결과(응답/`control_result`)를 기다린다.
- **at-most-once dedup(권장, 가설)**: 선택적 `requestId`가 주어지면 짧은 TTL(가설 10s) 내 동일 `requestId` 재요청은 **재실행하지 않고** 직전 결과를 반환한다(중복 클릭/재시도 안전). TTL·범위는 PoC로 보정(§6 Q).
- **pane별 직렬화(확정)**: 같은 `paneId`에 대한 control은 **at-most-one in-flight**로 직렬화한다(per-pane mutex). 이는 (a) 키스트로크 interleave 방지, (b) input의 text+Enter 2-step 원자성 근사를 보장한다. 직렬화 대기 중 추가 요청은 큐잉하거나 `429`로 빠르게 거절한다(가설; 기본 큐 깊이 1).
- **rate limit(가설, 안전)**: runaway loop(자동 스크립트의 폭주 입력)를 막기 위해 pane별·global rate limit을 둔다(가설: pane당 ~5 req/s, global ~20 req/s). 초과 시 `429 rate_limited` + audit(warn). 임계값은 §6 Q.
- **pagination/filter/sort: N/A**(단일 리소스 action endpoint).

### 2.11 UI flow contract (R-UI-004, R-CTRL-003/006)

inspector entry → action → (interrupt) confirm modal → execute → result toast/audit의 **흐름 계약**을 소유한다. inspector **레이아웃·진입점 가시성**은 [[SPEC-201-dashboard-screens]] §2.4, destructive **a11y**는 [[SPEC-202-design-accessibility]]가 소유한다.

- **진입점 실행 가능성(확정, [[SPEC-201-dashboard-screens]] §6 Q1 분담)**: control 진입점은 아래 중 하나라도 참이면 **disabled**다 — (a) token 부재, (b) orc status `terminated`/`stale`, (c) WS `disconnected`(stale snapshot 위에서 행동 금지). SPEC-201은 진입점 **가시성**을, 본 spec은 **실행 가능성(enable 술어)**을 소유한다.
- **pessimistic update(확정)**: control은 **낙관적 성공 표시를 하지 않는다**. 버튼은 in-flight 동안 disabled(중복 클릭 차단), 결과는 server 응답 + 재검증 통과 후에만 확정된다. orc의 실제 상태 변화(예: interrupt 후 `waiting`)는 정상 snapshot/WS 경로([[SPEC-102-realtime-sync]])로 반영된다 — control 응답이 상태를 위조하지 않는다.
- **flow 상태(확정)**: `idle → submitting → (success | aborted | failed)`.
  - input/key: 클릭 → `submitting` → 응답.
  - interrupt: 클릭 → confirm modal(context 4필드 표시, 초기 포커스 Cancel) → 확인 → `submitting`(`confirmed:true`) → 응답.
- **result 표면(확정)**: 성공 → 짧은 success toast; abort(재검증 실패) → 사용자에게 사유를 알리는 warning toast("대상이 바뀌어 전송을 취소했습니다" 등) + inspector 강제 새로고침 유도; failed → error toast. 모든 결과는 activity rail의 audit 항목으로도 남는다(R-CTRL-007 / R-OBS-001, [[SPEC-600-observability]]).

```text
[inspector]  agentType·tmuxTarget·cwd·command (context)         # R-CTRL-006
   ├─ input "..."  ──► POST /input {text, expected}             # R-CTRL-001
   ├─ key  Enter   ──► POST /key   {key, expected}              # R-CTRL-002
   └─ interrupt ─► [confirm modal: context 4필드, Cancel 기본]  # R-CTRL-003/006
                     └─ 확인 ──► POST /interrupt {confirmed:true, expected}
   응답 ─► toast(success/aborted/failed) + activity audit       # R-CTRL-007
```

## 3. Behavior rules

확정 규칙과 PoC 검증 가설을 구분한다.

1. **쓰기 경로 분리(확정)**: `send-keys`는 `controlExec`로만 spawn된다. `tmuxExec` allowlist는 read-only 그대로이며 `send-keys`는 denylist에 남는다(§2.1). read 경로로는 쓰기 불가.
2. **단일 target(확정)**: 모든 send-keys는 안정 `paneId`를 `-t`로 지정한다. 가변 `tmuxTarget`을 target으로 쓰지 않는다(R-CTRL-001/[[08-Decisions|D-006]]/[[08-Decisions|D-017]]).
3. **text literal(확정)**: text 입력은 `-l --`로 리터럴 전송한다. `-l` 누락은 키 주입 취약점이므로 금지(§2.3).
4. **재검증 보수성(확정)**: 실행 직전 fresh read-only 재검증에서 identity/target/command/agentType 중 하나라도 불일치면 abort + audit(§2.6, R-CTRL-005).
5. **confirm 이중 게이트(확정)**: interrupt는 UI modal + backend `confirmed:true`를 모두 요구(§2.7, R-CTRL-003).
6. **input 2-step·partial(확정)**: `submit=true`는 literal text → Enter 순차. ①성공 ②실패면 `outcome:'partial'`로 보고·audit(§2.2/§2.8). 같은 pane 직렬화로 둘 사이 다른 입력이 끼어들지 않는다(§2.10).
7. **audit 비저장 원문(확정)**: input text 원문·전송 key 시퀀스는 control.result ActivityEvent·log에 저장하지 않는다 — `detail.inputByteLength` + `detail.inputRedactedFlag`만(§2.8, [[08-Decisions|D-016]] 확장, canonical 모델 [[SPEC-600-observability]]).
8. **pessimistic·비위조(확정)**: control 응답·UI는 상태를 위조하지 않는다. 실제 상태 변화는 snapshot/WS로 반영(§2.11).
9. **상수(가설)**: `CONTROL_TIMEOUT_MS=2000`, `MAX_INPUT_BYTES=4 KiB`, `KEY_ALLOWLIST`(§2.4), dedup TTL `10s`, rate limit(pane ~5/s·global ~20/s)은 전부 **PoC 검증 가설**이며 [[SPEC-007-test-validation]] 측정·사용성 검증으로 보정한다.

## 4. Acceptance criteria

> token/secret 예시는 placeholder를 쓴다([[SPEC-000-conventions]]). "보호 route" = token auth 미들웨어 뒤([[SPEC-100-server-lifecycle]] §3.3). "fresh read" = 실행 시점 read-only 재조회(§2.6).

```text
SPEC-400-AC-01 (R-CTRL-001)
  Given orcId=pane:%12 를 선택하고 재검증이 통과하는 상태에서
  When POST /api/orcs/pane:%12/input {text:"hello", submit:true} 를 valid token으로 보내면
  Then controlExec 가 ['send-keys','-t','%12','-l','--','hello'] 를 spawn한 뒤
       ['send-keys','-t','%12','Enter'] 를 spawn하고,
       %12 외 어떤 pane에도 send-keys 가 전송되지 않는다.
```

```text
SPEC-400-AC-02 (R-CTRL-001, R-CTRL-008)
  Given text 가 tmux/셸 메타문자를 포함할 때(예: text="C-c $(reboot)")
  When /input 이 실행되면
  Then 그 text 는 `-l --` 리터럴로 전송되어 interrupt나 셸 실행으로 해석되지 않고
       문자 그대로 pane에 입력된다(shell:false, 키 미해석).
```

```text
SPEC-400-AC-03 (R-CTRL-002)
  Given /key 요청에서
  When key ∈ KEY_ALLOWLIST(예 "Enter")와 key ∉ allowlist(예 "C-d","M-x",임의 문자열)를 각각 보내면
  Then 전자는 ['send-keys','-t','%12','Enter'] 로 전송되고,
       후자는 422 key_not_allowed 로 거부되며 send-keys 가 spawn되지 않는다.
```

```text
SPEC-400-AC-04 (R-CTRL-003)
  Given /interrupt 요청에서
  When confirmed 누락/false 와 confirmed:true 를 각각 보내면
  Then 전자는 422 confirm_required 로 거부되어 send-keys 가 없고,
       후자는(재검증 통과 시) ['send-keys','-t','%12','C-c'] 가 정확히 1회 전송된다.
```

```text
SPEC-400-AC-05 (R-CTRL-004)
  Given server 가 실행 중일 때
  When /input·/key·/interrupt 를 token 없이/잘못된 token으로 보내면
  Then 각각 401 로 거부되어 controlExec 가 호출되지 않으며(어떤 상태 변경도 없음),
       valid token 요청만 control 핸들러에 도달한다([[SPEC-100-server-lifecycle]] 미들웨어).
```

```text
SPEC-400-AC-06 (R-CTRL-005)
  Given orcId 가 가리키는 pane 의 foreground command 가 마지막 snapshot 이후 바뀌었을 때
        (예: expected.command="claude" 였으나 fresh read 에서 "bash")
  When 그 orc 에 /input(또는 /key,/interrupt)을 보내면
  Then 실행 직전 fresh 재검증이 mismatch 를 감지해 409 target_mismatch 로 abort하고,
       send-keys 가 전송되지 않으며, outcome="aborted", reason="target_mismatch" 인 audit event 가 1건 산출된다.
```

```text
SPEC-400-AC-07 (R-CTRL-005)
  Given orcId 의 paneId 가 fresh read 에서 더 이상 존재하지 않을 때(pane 종료)
  When 그 orc 에 control action 을 보내면
  Then 410 target_gone 으로 abort하고 send-keys 가 전송되지 않으며,
       outcome="aborted", reason="target_gone" 인 audit event 가 산출된다.
```

```text
SPEC-400-AC-08 (R-CTRL-005)
  Given paneId 는 동일하나 tmuxTarget 이 reindex 로 바뀌어 expected.tmuxTarget 과 다를 때
  When control action 을 보내면
  Then 재검증이 target drift 를 감지해 409 target_mismatch 로 abort하고
       send-keys 가 전송되지 않는다(보수적 안전, [[08-Decisions|D-006]]).
```

```text
SPEC-400-AC-09 (R-CTRL-008)
  Given control endpoint request schema 와 controlExec 코드에 대해
  When 임의의 subcommand/shell-command 문자열을 body 필드로 주입 시도하면
  Then schema 가 unknown 필드를 거부하고(422), controlExec 의 subcommand 는 'send-keys' 로
       하드코딩되어 호출자가 다른 subcommand/셸 명령을 구성할 수 없다(구조적 불가, shell:false).
```

```text
SPEC-400-AC-10 (R-CTRL-008, [[08-Decisions|D-019]])
  Given control 과 scan 을 함께 실행하는 동안
  When 실제로 spawn된 tmux argv 전체를 관측하면
  Then send-keys 를 spawn한 호출은 모두 controlExec 템플릿(literal/key/interrupt)과 일치하고,
       tmuxExec('send-keys',…) 는 throw 하며 spawn하지 않고,
       scanner 가 spawn한 subcommand 는 read-only allowlist(+`-V`)뿐이다(read 경로 무변경).
```

```text
SPEC-400-AC-11 (R-CTRL-006)
  Given interrupt confirm modal(및 input/key command dock)이 열린 상태에서
  When 표시 내용과 전송 request 를 검사하면
  Then 화면은 agentType/tmuxTarget/cwd/current command 4개를 표시하고,
       그 4개(중 paneId/tmuxTarget/command/agentType)가 그대로 request.expected 가 되어
       backend 재검증(§2.6)에 사용된다(본 것=대조하는 것).
```

```text
SPEC-400-AC-12 (R-CTRL-007, [[08-Decisions|D-028]])
  Given 인증을 통과한 control 요청이 성공/partial/abort/실행실패 중 하나로 끝날 때
  When activity log(=[[SPEC-600-observability]] ring buffer)를 검사하면
  Then 각 결과마다 type='control.result' 인 canonical ActivityEvent 가 정확히 1건 산출되고,
       target={orcId,paneId,tmuxTarget} 와 detail.action·detail.controlOutcome(success/partial/aborted/failed)·
       detail.reason(실패 시 안정 token) 을 담으며, 응답의 auditEventId 가 그 ActivityEvent.id 를 가리킨다
       (rail 항목은 activity frame, 행위자 결과는 동기 HTTP 응답 — §2.8.1).
```

```text
SPEC-400-AC-13 (R-CTRL-007, R-PRIV-004, [[08-Decisions|D-016]])
  Given /input 으로 보낸 text 에 secret 형태(예: ghp_<token>)가 포함될 때
  When 그 control.result ActivityEvent 와 debug log 를 검사하면
  Then text 원문이 어디에도 저장되지 않고(detail.inputByteLength + detail.inputRedactedFlag 만),
       ghp_<token> literal 이 ActivityEvent(message/detail)·log 어디에도 나타나지 않으며,
       전송 key 시퀀스·token(인증) 도 직렬화되지 않는다([[SPEC-600-observability]] §2.7).
```

```text
SPEC-400-AC-14 (R-UI-004)
  Given inspector 의 control 진입점에 대해
  When token 부재 / orc status terminated|stale / WS disconnected 중 하나일 때와 정상일 때를 비교하면
  Then 전자에서는 진입점이 disabled(실행 불가)이고, 정상일 때만 enable되며,
       실행은 낙관적 성공 표시 없이 server 결과 후 toast/audit 로만 확정된다(pessimistic).
```

```text
SPEC-400-AC-15 (R-CTRL-001/002/003, 안전)
  Given 같은 paneId 로 두 control 요청이 거의 동시에 도착할 때
  When 둘을 처리하면
  Then 같은 pane 에 대해 at-most-one in-flight 로 직렬 실행되어 키스트로크가 interleave되지 않고
       (input 의 text→Enter 2-step 사이에 다른 입력이 끼지 않으며),
       초과분은 큐잉 또는 429 로 처리된다.
```

```text
SPEC-400-AC-16 (R-CTRL-005)
  Given published snapshot 이 scanInterval 만큼 오래됐고 그 사이 pane 이 바뀌었을 때
  When control 을 실행하면
  Then 재검증은 캐시된 snapshot 이 아니라 실행 시점 fresh read-only 재조회 결과로 술어를 평가한다
       (stale snapshot 만으로 통과시키지 않음).
```

```text
SPEC-400-AC-17 (R-CTRL-005, [[08-Decisions|D-006]])
  Given orc status 가 terminated 또는 stale 일 때
  When 그 orc 에 control action 을 보내면
  Then 409 not_controllable 로 거부되어 send-keys 가 전송되지 않고 audit(aborted)된다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-CTRL-001 | `/input` literal `-l --` 전송 + Enter, 단일 paneId target | SPEC-400-AC-01, SPEC-400-AC-02 |
| R-CTRL-002 | `/key` KEY_ALLOWLIST 강제, 비허용 키 거부 | SPEC-400-AC-03 |
| R-CTRL-003 | `/interrupt` UI modal + backend `confirmed:true` 이중 게이트, `C-c` | SPEC-400-AC-04, SPEC-400-AC-11 |
| R-CTRL-004 | 모든 endpoint가 startup token auth 미들웨어 뒤([[SPEC-100-server-lifecycle]] §2.6) | SPEC-400-AC-05 |
| R-CTRL-005 | 실행 직전 fresh read-only 재검증(identity/target/command/agentType), abort+audit | SPEC-400-AC-06, SPEC-400-AC-07, SPEC-400-AC-08, SPEC-400-AC-16, SPEC-400-AC-17 |
| R-CTRL-006 | control context 4필드(agentType/tmuxTarget/cwd/command) = `expected`, modal/dock 표시 | SPEC-400-AC-11 |
| R-CTRL-007 | success/partial/aborted/failed 모두 control.result `ActivityEvent` 산출([[SPEC-600-observability]] canonical 모델로 target/detail 매핑, 원문 비저장, frame-role split §2.8.1) | SPEC-400-AC-12, SPEC-400-AC-13 |
| R-CTRL-008 | `controlExec` 단일 writer·`send-keys` 하드코딩·unknown 필드 거부·shell:false (구조적 불가) | SPEC-400-AC-09, SPEC-400-AC-10 |
| R-UI-004 (control entry→action flow) | inspector 진입점 실행 가능성(enable 술어)·pessimistic flow | SPEC-400-AC-14 |
| [[08-Decisions\|D-019]] (확장) | read `tmuxExec` 무변경 + write `controlExec` 분리, read 경로 쓰기 불가 | SPEC-400-AC-10 |
| [[08-Decisions\|D-006]] (control safety) | 단일 selected target, 보수적 재검증 abort, not_controllable | SPEC-400-AC-08, SPEC-400-AC-17 |

> R-CTRL-004는 token gate **메커니즘**을 [[SPEC-100-server-lifecycle]]이 1차 소유하고 본 spec이 **control endpoint 적용**을 소유한다(R-SEC-003 floor 재사용). R-UI-004의 inspector **레이아웃**은 [[SPEC-201-dashboard-screens]], destructive **a11y**는 [[SPEC-202-design-accessibility]]가 소유한다. 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진/index·결정 보정 필요)

- **C1 — 신규 결정 후보(검토 필요, [[08-Decisions]] `D-0xx` 승격 대상)**: 아래 design 결정은 security gate(security-privacy-engineer)·product-architect 검토 후 확정한다 — (a) **`controlExec` 분리 write-path**로 [[08-Decisions|D-019]]를 read-only→guarded-write로 확장(§2.1), (b) **보수적 재검증 abort**: paneId가 살아도 target/command/agentType drift면 abort(§2.6), (c) **input text 비저장 audit**으로 [[08-Decisions|D-016]] non-persistence를 쓰기 경로로 확장(§2.8), (d) **interrupt backend confirm 강제**(`confirmed:true`, §2.7), (e) **KEY_ALLOWLIST 구성**(제어 chord 제외, §2.4).
- **C2 — [[SPEC-006-privacy-redaction]] §3.6 PF-04 해소**: SPEC-006이 pre-flag한 "control mis-target(잘못된 pane에 send-keys)"(PF-04, R-CTRL-005/008)를 본 spec §2.1(분리 write-path)·§2.6(재검증)·§2.3(`-t paneId` 단일 target)으로 정식 소유·해소한다. SPEC-006은 pre-flag만, 구현 계약은 본 spec.
- **C3 — [[SPEC-201-dashboard-screens]] §6 Q1 분담 확정**: control 진입점 enable/disable의 **가시성**(SPEC-201)과 **실행 가능성**(본 spec §2.11)의 경계를 본 spec이 enable 술어로 확정한다. SPEC-201 Q1과 정합 확인 필요.
- **C4 — control audit envelope 정합 (해소, [[08-Decisions|D-028]], Seam H)**: 과거 본 spec은 flat `ControlAuditEvent{type:'control_action', …flat}`를 산출했고 [[SPEC-600-observability]]는 `ActivityEvent{type:'control.result', target{}, detail{}, seq, source, code, message}`를 canonical로 정의해 `type` token·구조가 충돌했다. 또 [[SPEC-102-realtime-sync]] §2.3은 `control_result`/`activity` frame을 분리 카탈로그했으나 역할 분담이 미정이었다. **해소**: canonical 모델은 SPEC-600 `ActivityEvent(type='control.result')`이며 본 spec §2.8이 control action을 그 `target`(orcId/paneId/tmuxTarget)·`detail`(action/controlOutcome/outcome/reason/keyName/inputByteLength/inputRedactedFlag/exitCode/durationMs/correlationId)로 매핑하는 **producer**로 재정의했다. frame-role(§2.8.1): 행위자 결과 = 동기 HTTP 응답(§2.2), rail 항목 = `activity` frame(SPEC-600 §2.4 payload, SPEC-102 §2.3 transport), `control_result` frame = optional/forward. 세 spec 정합 확인 완료.
- **C5 — [[SPEC-600-observability]] 정합 (해소)**: activity log 저장·포맷·ring buffer·redaction의 SSOT인 SPEC-600이 `draft`로 작성되어 canonical `ActivityEvent`·`control.result` 매핑(§2.2.1)·non-persistence(§2.7)·severity를 소유한다. 본 spec §2.8 producer 매핑이 SPEC-600 §2.1~§2.2·§2.7과 정합함을 확인했다([[08-Decisions|D-028]]).

### Open Questions (검토 필요 / PoC·정합 대상)

- **Q1 — 잔여 TOCTOU 창**: 재검증 read와 send-keys write 사이 비원자 창(§2.6). tmux 수준 원자성 부재로 완전 제거 불가. 창 최소화 외 추가 완화(예: 재검증 직후 pane lock·activity 기반 추가 확인)가 필요한지 검토. **검토 필요.**
- **Q2 — token transport header 이름**: control 요청의 token 운반 header(`Authorization: Bearer` vs `X-Orc-Camp-Token`)는 [[SPEC-100-server-lifecycle]] Q2에 의존. FE/Backend 정합 후 확정. **검토 필요.**
- **Q3 — KEY_ALLOWLIST 범위**: agent TUI(예: Claude Code/Codex 대화형 UI)가 실제로 요구하는 키(함수키·일부 chord) 포함 여부. 사용성 PoC로 보정하되 파괴적 chord(`C-d`/`C-z`/`C-\\`)는 제외 유지. **검토 필요.**
- **Q4 — input 자동 Enter 기본값**: `submit` 기본 `true`(즉시 제출) vs `false`(검토 후 별도 Enter). agent에 잘못된 명령을 자동 제출할 위험 vs 편의 trade-off. **검토 필요.**
- **Q5 — rate limit·dedup·큐 깊이 임계값**: pane/global rate limit, `requestId` dedup TTL(10s), per-pane 큐 깊이(1)는 모두 가설(§2.10). 사용성·안전 측정으로 확정. **검토 필요.**
- **Q6 — 재검증 비용·정합성**: control마다 fresh `list-panes -a` 재조회는 추가 tmux spawn이다(20 pane bulk 1회). control 빈도가 낮아 latency 영향은 작다고 가정하나, 대형 camp에서 측정 필요. published snapshot의 `snapshotVersion`을 `expected`에 함께 실어 stale 판정을 보강할지 [[SPEC-101-snapshot-api]]와 정합. **검토 필요.**
- **Q7 — `cwd` 재검증 포함 여부**: 현재 재검증 술어는 paneId/target/command/agentType만 본다(§2.6). agent 작업으로 `cwd`가 정상 변동하므로 제외했으나, cwd 변동을 "다른 작업 문맥"으로 보고 경고할지 검토. **검토 필요.**
- **Q8 — keyboard shortcut 제공 여부**: control action을 단축키로 제공할지([[02-Requirements]] Open Question)·실수 전송 방지. [[SPEC-202-design-accessibility]] keyboard 계약과 정합. **검토 필요.**
