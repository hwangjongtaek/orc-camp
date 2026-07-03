---
spec: SPEC-402
title: Orchestration — command broadcast(대상 선택·단일 confirm·순차 실행·batch audit)
status: approved
updated: 2026-07-03
requirements: [R-CTRL-010, R-CTRL-005, R-CTRL-007, R-CTRL-008]
decisions: [D-050, D-051, D-043, D-041]
tags:
  - specs
  - control
  - orchestration
  - broadcast
  - backend
  - epic-5
---

# SPEC-402 — Orchestration (command broadcast)

Terminal Workspace([[18-Terminal-Workspace]] §3.4/§4 Phase 3)는 여러 orc를 관찰하다 **같은 입력을 대상 집합에 broadcast**하는 orchestration을 요구한다(예: "입력 대기 중인 오크 전부에게 같은 프롬프트"). 본 spec은 그 **broadcast의 경로·확인·실행·집계·audit 계약의 SSOT**다.

broadcast는 **새 write 경로를 만들지 않는다**. 각 대상 orc에 대해 기존 [[SPEC-400-control-actions]] `POST /api/orcs/:orcId/input`(composed-input, `expected` 재검증)를 per-orc **순차** 재사용하고([[08-Decisions|D-050]]), N≥2면 **모든 대상을 나열한 단일 confirm** 후 실행하며, 결과를 **per-orc 집계**하고 **`control.broadcast` batch audit**(원문 비저장)을 산출한다([[08-Decisions|D-051]]).

> **소유 경계**: 본 spec은 **broadcast API 표면·대상 재검증·순차 실행 오케스트레이션·부분 실패 정책·결과 집계·batch audit producer 매핑**을 소유한다. **per-orc write egress(`controlExec` send-keys·`/input` gate pipeline·`expected` 재검증 메커니즘)**는 [[SPEC-400-control-actions]], **`control.broadcast` `ActivityEvent` 모델·taxonomy·code**는 [[SPEC-600-observability]], **broadcast UI(대상 다중 선택·ConfirmModal·결과 표시·waiting toast 연결)**는 [[SPEC-203-terminal-workspace]], **키보드 passthrough·arm/disarm**은 [[SPEC-401-interactive-input]]가 소유한다. 본 spec은 이들을 참조·재사용만 한다.

> **불변식(확정 — [[08-Decisions|D-050]]/[[08-Decisions|D-051]] Accepted 2026-07-03)**: ① broadcast는 **composed-input(form) 경로만** 쓴다 — arm/passthrough 실시간 전파([[SPEC-401-interactive-input]], 연결당 1 pane [[08-Decisions|D-041]])를 쓰지 않는다([[08-Decisions|D-050]], §2.2). ② 각 대상 egress는 [[SPEC-400-control-actions]] §2.5 **gate pipeline 전체**(schema→controllability→**fresh `expected` 재검증**→execute→audit)를 그대로 통과한다 — broadcast가 어떤 게이트도 약화하지 않는다(R-CTRL-005/008, §2.4). ③ 실행은 **per-orc 순차**이며 [[SPEC-400-control-actions]] §2.10 **per-pane single-writer 직렬화**를 보존한다(§2.5). ④ N≥2 broadcast는 **모든 대상을 나열한 단일 confirm**을 거친다([[08-Decisions|D-051]], §2.3). ⑤ batch audit은 **집계 스칼라 + per-orc {orcId, ok, errorCode}만** 담고 **command 원문 텍스트를 어떤 필드에도 저장하지 않는다**([[08-Decisions|D-028]] non-storage 확장, §2.7). ⑥ MVP는 **단일 camp 범위**다(blast radius bound, [[08-Decisions|D-051]], §2.8).

## 1. Scope

### In scope

- **broadcast API 표면**: `POST /api/camps/:campId/broadcast` request/response·error(§2.1).
- **경로 결정**: composed-input(form) 재사용만, arm/passthrough 미사용(§2.2, [[08-Decisions|D-050]]).
- **단일 confirm 계약**(N≥2): 모든 대상(paneId/tmuxTarget/agentType/command) 나열(§2.3, [[08-Decisions|D-051]]).
- **per-orc gate pipeline 재사용 + `expected` 재검증**(mis-target 방어, §2.4, R-CTRL-005).
- **순차 실행·single-writer 보존**(§2.5).
- **부분 실패 정책**: best-effort continue + per-orc 집계(§2.6, [[08-Decisions|D-051]]).
- **결과 집계 응답**(per-orc ok/errorCode, §2.6).
- **`control.broadcast` batch audit producer 매핑**(원문 비저장, §2.7, R-CTRL-007).
- **대상 선택 필터·범위·상한**: 단일 camp, 대상 cap N(가설)·rate(§2.8).

### Out of scope (다른 spec으로 미룸)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| per-orc `send-keys` egress·`controlExec`·`/input` gate·`expected` 재검증 메커니즘 | write 경로(재사용) | [[SPEC-400-control-actions]] |
| `control.broadcast` `ActivityEvent` 모델·taxonomy·code·저장 | observability | [[SPEC-600-observability]] |
| 대상 다중 선택 UI·ConfirmModal 렌더·결과 표시·waiting toast 연결 | terminal workspace UX | [[SPEC-203-terminal-workspace]] |
| 키보드 passthrough·arm/disarm | interactive input | [[SPEC-401-interactive-input]] |
| 프롬프트 템플릿/이력 재사용 | P1 이월(§2.8 scope note) | 후속 슬라이스([[SPEC-500-settings-persistence]] forward) |
| cross-camp broadcast | blast radius — forward(P2) | 후속 슬라이스([[08-Decisions|D-051]]) |
| multi-arm 실시간 전파 | 비권장·forward pre-flag | [[SPEC-401-interactive-input]] §6([[08-Decisions|D-050]]) |

## 2. Contract

### 2.1 broadcast API 표면 (R-CTRL-010)

broadcast는 **state-changing**이며 token auth 미들웨어 뒤에 있다([[SPEC-400-control-actions]] §2.5 Gate 1, [[SPEC-100-server-lifecycle]] §3.3). path param은 stable `campId`(`session:<id>`, [[08-Decisions|D-017]])로 **camp 범위를 바인딩**한다(§2.8).

| Method | Path | action | 요구 body 핵심 | 비고 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/camps/:campId/broadcast` | 대상 집합에 동일 input fan-out | `input`, `targets[]` | per-orc 순차 `/input` 재사용([[08-Decisions|D-050]]) |

> **경로 대안(확정 선택)**: [[08-Decisions|D-051]] "단일 camp" 범위를 URL로 강제하기 위해 `/api/camps/:campId/broadcast`를 채택한다. camp-무관 `/api/broadcast` + body `campId`도 가능하나, path 바인딩이 cross-camp 대상 혼입을 구조적으로 차단하므로 전자를 쓴다(§2.8, §6 Q2).

```ts
// 대상 선택은 client-side(§2.8 필터). server에는 명시적 targets 배열로만 온다.
interface BroadcastTarget {
  orcId: string;            // "pane:%<n>" ([[08-Decisions|D-017]])
  expected: ExpectedTarget; // 사용자가 본 값. per-orc fresh read 대조(§2.4, [[SPEC-400-control-actions]] §2.2/§2.6)
}
interface BroadcastInput {
  text: string;             // 공통 입력. [[SPEC-400-control-actions]] §2.2 InputRequest.text 제약 상속(≤MAX_INPUT_BYTES·control-byte 필터)
  submit?: boolean;         // 기본 true(각 orc에 literal 후 Enter, [[SPEC-400-control-actions]] §2.3)
}
interface BroadcastRequest {
  input: BroadcastInput;
  targets: BroadcastTarget[]; // 1..BROADCAST_MAX_TARGETS(§2.8). 전 orcId 는 :campId 내여야 함(§2.8)
  confirmed?: boolean;        // N≥2면 true 필수(§2.3). N==1은 form-path와 동일 취급
  requestId?: string;         // (선택) at-most-once dedup([[SPEC-400-control-actions]] §2.10)
}
```

- **엄격 schema(확정, R-CTRL-008)**: unknown 필드는 `422 validation_error`로 거부한다 — broadcast도 **자유 명령/subcommand/args 필드를 두지 않는다**([[SPEC-400-control-actions]] §2.2 정신). `input.text`는 [[SPEC-400-control-actions]] §2.2/§2.3.1 제약(byteLength·control-byte 필터)을 그대로 상속한다.

성공/부분 응답(`200`):

```ts
interface BroadcastPerOrcResult {
  orcId: string;
  paneId: string;
  ok: boolean;                         // 이 orc egress 성공 여부
  outcome: 'success' | 'partial' | null;  // [[SPEC-400-control-actions]] ControlResult.outcome(성공 시), 실패 시 null
  errorCode: string | null;            // 실패 시 [[SPEC-400-control-actions]] §2.9 code(target_gone/target_mismatch/not_controllable/tmux_exec_failed/rate_limited/...)
  auditEventId: string | null;         // per-orc control.result ActivityEvent.id(성공/실패 모두 산출, §2.7)
}
interface BroadcastResult {
  ok: true;                            // 요청 자체가 접수·처리됨(개별 실패는 results 로)
  campId: string;
  targetCount: number;
  successCount: number;
  failureCount: number;
  results: BroadcastPerOrcResult[];    // targets 순서 보존, per-orc 집계
  batchAuditEventId: string;           // control.broadcast batch ActivityEvent.id(§2.7)
  requestId: string | null;
}
```

- **`ok:true`의 의미(확정)**: 요청 body가 유효하고 broadcast가 **접수·순차 처리 완료**됐음을 뜻한다. **개별 orc 실패는 `ok:false`가 아니라 `results[].ok=false` + `errorCode`로** 표현한다(best-effort, §2.6). 요청 자체가 거부되는 경우(schema·confirm 누락·범위 위반·상한 초과)만 §2.9 error 응답이다.

### 2.2 경로 결정 — composed-input(form) only ([[08-Decisions|D-050]])

- **composed-input 재사용(확정)**: broadcast는 각 대상에 [[SPEC-400-control-actions]] `POST /api/orcs/:orcId/input`(literal text + 기본 Enter, `expected` 재검증)를 **per-orc 호출**하는 것과 의미적으로 동일하다. server는 대상마다 [[SPEC-400-control-actions]] §2.5 gate pipeline을 재사용한다(§2.4/§2.5).
- **arm/passthrough 미사용(확정, 기각 대안 명시)**: broadcast는 [[SPEC-401-interactive-input]] arm/passthrough 실시간 전파를 **쓰지 않는다**. 근거: passthrough arm은 **연결당 1 pane**([[08-Decisions|D-041]])의 interactive single-pane 미러링인 반면 broadcast는 **의도된 one-shot fan-out**이다 — form 경로가 이미 재검증·single-writer·per-action audit을 갖추고 있어 재사용이 안전하다. **기각**: multi-arm 실시간 전파는 blast radius가 너무 커(다중 pane 동시 raw 키스트로크) forward pre-flag로만 남긴다([[08-Decisions|D-050]], [[SPEC-401-interactive-input]] §6).
- **새 writer 없음(확정, R-CTRL-008)**: broadcast는 **두 번째 writer나 새 egress 템플릿을 만들지 않는다** — egress는 전부 [[SPEC-400-control-actions]] §2.1 `controlExec`(single-writer, `send-keys` 3 템플릿)로만 나간다. broadcast는 **오케스트레이터**일 뿐 writer가 아니다(AC-01/AC-09).

### 2.3 단일 confirm 계약 (N≥2, [[08-Decisions|D-051]])

- **N≥2 → 단일 confirm 필수(확정)**: 대상이 2개 이상이면 실행 전 **모든 대상을 나열한 단 하나의 confirm**을 거친다. server는 `confirmed:true` 없이 온 N≥2 요청을 `422 confirm_required`로 거부한다(broadcast confirm은 server-강제, [[SPEC-400-control-actions]] §2.7 interrupt confirm과 동형).
- **confirm이 나열할 대상 필드(확정)**: 각 대상의 **`paneId`·`tmuxTarget`·`agentType`·`command`**(=`ExpectedTarget` 4필드, [[SPEC-400-control-actions]] §2.2)와 broadcast할 `input.text` 요약. 실제 modal 렌더·초기 포커스·focus-trap은 [[SPEC-203-terminal-workspace]]/[[SPEC-202-design-accessibility]] 소유이며 본 spec은 **confirm이 있어야 하고 무엇을 보여야 하는지**만 강제한다(AC-02).
- **N==1(확정)**: 대상 1개 broadcast는 단일 `/input` form-path와 동일 취급이다 — 별도 broadcast confirm을 강제하지 않는다(일반 control과 동일 UX). `confirmed`는 무시된다.

### 2.4 per-orc gate pipeline 재사용 · `expected` 재검증 (R-CTRL-005/008)

- **gate pipeline 전체 통과(확정)**: 각 대상 egress는 [[SPEC-400-control-actions]] §2.5 gate를 **순서대로 그대로** 통과한다 — token(요청 1회) → schema → orc 해석(Gate 3) → controllability(Gate 4) → **fresh read-only `expected` 재검증(Gate 5, R-CTRL-005)** → action-specific → execute(`controlExec`) → audit. broadcast는 어떤 게이트도 건너뛰거나 약화하지 않는다(AC-03).
- **mis-target 방어(확정, R-CTRL-005)**: 대상 선택은 client-side(§2.8)이므로, server는 **대상마다** 그 orc의 fresh read 값이 요청의 `expected`(paneId/command/agentType)와 일치하는지 [[SPEC-400-control-actions]] §2.6대로 재검증한다. 불일치(`target_gone`/`target_mismatch`)면 그 orc는 **egress 없이 실패로 집계**하고 다음 대상으로 진행한다(best-effort, §2.6, AC-05/AC-08).
- **camp 범위 재확인(확정)**: 각 `target.orcId`의 paneId가 `:campId` camp에 속하는지 재확인한다. 범위 밖 orcId가 섞이면 요청 전체를 `422 validation_error`(또는 `403 out_of_camp_scope`)로 거부한다(§2.8, blast radius bound).
- **exposure semantics = form-path(확정, P1-J, [[08-Decisions|D-044]])**: broadcast는 **form-path([[SPEC-400-control-actions]]) exposure 의미**를 따른다 — control action의 게이트는 **context-display + `expected` 재검증**이며 **live-view exposure gate가 아니다**. 따라서 **글로벌 exposure가 off여도 broadcast는 차단되지 않는다**(preview 화면 노출과 write 실행은 별개 축). 이는 [[SPEC-401-interactive-input]] §2.3 **arm**이 exposure-off에서 거부되는 것과 **다르다** — arm은 "보지 못하는 pane에 지속 타이핑"(blind interactive)이라 exposure를 요구하지만, broadcast는 조작자가 대상 목록을 명시 confirm하는 one-shot form 전송이므로 [[SPEC-400-control-actions]] control action과 동일하게 exposure 독립이다(AC-10).

### 2.5 순차 실행 · single-writer 보존 (확정)

- **per-orc 순차(확정)**: 대상들은 `targets` 순서로 **하나씩 순차** 처리한다. 이로써 (a) [[SPEC-400-control-actions]] §2.10 **per-pane single-writer 직렬화**가 자연히 보존되고(같은 pane에 동시 write 없음), (b) tmux 서버에 동시 write 폭주를 만들지 않는다.
- **input의 text+Enter 원자성 계승(확정)**: 각 orc의 `/input`은 [[SPEC-400-control-actions]] §2.3대로 literal text 후 Enter(submit=true)를 그 pane에 대해 직렬 전송한다. text는 갔으나 Enter 실패면 그 orc는 `outcome:'partial'`로 집계한다([[SPEC-400-control-actions]] §3.6).
- **동시성 상한(확정 골격)**: MVP는 순차(concurrency 1)로 고정한다. 대상이 많을 때의 처리량은 §2.8 `BROADCAST_MAX_TARGETS` cap으로 bound된다 — 병렬 실행은 single-writer·부하 관점에서 이득이 작아 도입하지 않는다(§6 Q1).

### 2.6 부분 실패 정책 · 결과 집계 ([[08-Decisions|D-051]])

- **best-effort continue(확정)**: 한 orc egress가 실패해도 **중단하지 않고 다음 대상을 계속** 처리한다. 근거: 각 orc는 독립적이고 조작자가 대상 집합을 **명시적으로 confirm**했으므로, 한 대상의 drift가 나머지 전송을 막을 이유가 없다.
- **집계(확정)**: 각 대상의 결과를 `results[]`에 per-orc `{orcId, paneId, ok, outcome, errorCode, auditEventId}`로 집계하고 `successCount`/`failureCount`를 낸다(§2.1).
- **stop-on-first 대안(문서화, 미채택)**: 첫 실패에서 중단하는 정책도 가능하나, "명시적으로 confirm된 독립 대상 집합"에는 best-effort가 조작자 의도에 더 부합하고 부분 성공을 투명하게 보고한다. 따라서 **best-effort를 채택**하고 stop-on-first는 대안으로만 기록한다(향후 옵션화는 §6 Q3).

### 2.7 batch audit — `control.broadcast` (원문 비저장, R-CTRL-007, [[08-Decisions|D-051]])

broadcast 1회는 **batch audit event 1건**을 [[SPEC-600-observability]] `ActivityEvent`(`code:'control.broadcast'`)로 산출한다. 아울러 각 per-orc egress는 [[SPEC-400-control-actions]] §2.8 **per-action `control.result`**를 종전대로 산출한다(개별 대상의 상세 audit은 form-path와 동일). envelope·저장·`id`/`seq`는 [[SPEC-600-observability]] 소유이며 본 spec은 **producer 매핑**만 소유한다(§6 C2 정합).

```ts
// producer view — [[SPEC-600-observability]] ActivityEvent 로 매핑. 새 envelope 정의 없음.
interface BroadcastAuditMapping {
  type: 'control.result';               // canonical control audit type 재사용([[SPEC-600-observability]] §2.1)
  code: 'control.broadcast';            // 신규 안정 machine code(§6 C2 — SPEC-600 code 집합에 추가)
  severity: 'info' | 'warn' | 'error';  // 전부 성공→info · 일부 실패→warn · 전부 실패→error
  target: { campId: string };           // camp 범위(대상은 detail 집계). server-wide 아님
  detail: {                             // → ActivityEvent.detail — 전부 redaction-safe 구조 값
    action: 'broadcast';
    targetCount: number;                // 대상 수(수치, 내용 아님)
    successCount: number;
    failureCount: number;
    inputByteLength: number;            // broadcast text byteLength(내용 아님)
    inputRedactedFlag: boolean;         // text 가 redaction 패턴에 매칭됐는지(내용 미포함, [[SPEC-006-privacy-redaction]])
    perOrc: Array<{ orcId: string; ok: boolean; errorCode: string | null }>; // per-orc 결과(구조 식별자 + 결과만)
    correlationId: string | null;       // requestId
  };
  // 금지: broadcast 한 command 원문 텍스트·전송 key 시퀀스·token — 어떤 필드에도 직렬화 금지.
}
```

- **원문 비저장(확정, [[08-Decisions|D-028]]/R-PRIV-004 확장)**: batch audit은 **command 원문 텍스트를 어떤 필드에도 담지 않는다** — `inputByteLength`(수치) + `inputRedactedFlag`(boolean)만. `perOrc[]`도 구조 식별자(`orcId`)와 결과(`ok`/`errorCode`)만 담는다. token은 어떤 필드에도 직렬화하지 않는다([[SPEC-600-observability]] §2.7, [[SPEC-102-realtime-sync]] §2.1, AC-06).
- **severity 매핑(확정)**: `failureCount==0`→`info`; `0<failureCount<targetCount`→`warn`; `failureCount==targetCount`→`error`. [[SPEC-600-observability]] §2.1 `ActivitySeverity` 정합.
- **frame-role(참조)**: batch event의 rail 항목은 [[SPEC-102-realtime-sync]] `activity` frame([[SPEC-600-observability]] §2.4 payload). broadcast는 **동기 REST 응답**(`BroadcastResult`)이 actor 결과이고 rail은 (batch `control.broadcast` 1건 + per-orc `control.result` N건)이다 — broadcast에는 **신규 WS 프레임이 필요 없다**([[SPEC-102-realtime-sync]] 불변, §6 C3, AC-06).

### 2.8 대상 선택·범위·상한 (R-CTRL-010)

- **대상 선택 = client-side(확정)**: waiting-only / active 전체 / 수동 다중 선택 같은 **필터는 client가 수행**해 명시적 `targets:[{orcId, expected}]`로 server에 보낸다([[SPEC-203-terminal-workspace]] UI 소유). server는 필터 의미를 알지 못하고 **주어진 대상만** 재검증·실행한다 — 이로써 필터 로직이 write 경로에 개입하지 않고 mis-target 방어(§2.4)가 대상 단위로 성립한다(AC-08).
- **단일 camp 범위(확정, MVP, [[08-Decisions|D-051]])**: 모든 대상은 `:campId` **한 camp 안**이어야 한다(blast radius bound). 범위 밖 orcId 혼입은 요청 거부(§2.4). **cross-camp broadcast는 forward(P2)**로 pre-flag한다(§6 Q2).
- **중복 대상 de-dup(확정, P1-I)**: `targets[]`에 같은 `orcId`(또는 파생 `paneId`)가 중복되면 server는 **de-dup해 orc당 정확히 1회만** 실행한다(같은 pane에 실수로 N회 전송 방지, single-writer·오폭 방어 정합). de-dup는 첫 출현을 채택하고 중복 항목은 결과 집계에 `errorCode:'duplicate_target'`(또는 무시)로 표기해 조작자가 인지할 수 있게 한다. UI는 confirm modal에서 **중복을 제거·표시**한다([[SPEC-203-terminal-workspace]] §2.10). (대안: 중복을 as-listed로 실행 — 채택하지 않음; broadcast는 멱등적 의도가 아니라 pane당 1 프롬프트가 자연스럽다.)
- **대상 상한·rate(가설)**: 한 broadcast의 (de-dup 후) 대상 수는 `BROADCAST_MAX_TARGETS`(가설)로 cap하고, broadcast 요청 자체도 [[SPEC-400-control-actions]] §2.10 global rate limit을 상속한다. 초과 시 `422 too_many_targets` 또는 `429 rate_limited`. 값은 §6 Q1/[[SPEC-007-test-validation]].
- **프롬프트 템플릿 = P1 이월(scope note)**: 프롬프트 템플릿/이력 재사용([[18-Terminal-Workspace]] §3.4)은 broadcast MVP 범위 밖이며 후속 슬라이스([[SPEC-500-settings-persistence]] forward)로 미룬다. broadcast는 **한 번에 하나의 `input.text`**만 fan-out한다.

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다([[SPEC-000-conventions]]).

1. **composed-input only(확정)**: broadcast는 form 경로만 재사용하고 arm/passthrough를 쓰지 않는다(§2.2, AC-01, [[08-Decisions|D-050]]).
2. **새 writer 없음(확정)**: egress는 [[SPEC-400-control-actions]] `controlExec`만. broadcast는 오케스트레이터(§2.2, AC-09).
3. **N≥2 단일 confirm(확정)**: 모든 대상 나열, `confirmed:true` 없으면 `422 confirm_required`(§2.3, AC-02).
4. **gate pipeline 전체·`expected` 재검증(확정)**: 대상마다 fresh 재검증, 어떤 게이트도 약화 없음(§2.4, AC-03/AC-08, R-CTRL-005).
5. **순차·single-writer 보존(확정)**: per-orc 순차, per-pane 직렬화 유지(§2.5, AC-04).
6. **best-effort 집계(확정)**: 한 실패에 중단하지 않고 계속, per-orc 결과 집계(§2.6, AC-05, [[08-Decisions|D-051]]).
7. **batch audit 원문 비저장(확정)**: `control.broadcast` 1건, command 원문·token 비직렬화(§2.7, AC-06).
8. **단일 camp 범위(확정, MVP)**: 대상은 한 camp, cross-camp forward(§2.8, AC-07, [[08-Decisions|D-051]]).
9. **신규 WS 프레임 없음(확정)**: 동기 REST 결과 + 기존 activity stream(§2.7, AC-06).
10. **상수(가설)**: `BROADCAST_MAX_TARGETS`·rate·동시성(순차 고정)·프롬프트 템플릿 이월은 PoC/사용성 검증 가설이다([[SPEC-007-test-validation]]).

## 4. Acceptance criteria

> token/secret 예시는 placeholder를 쓴다([[SPEC-000-conventions]]). "gate pipeline" = [[SPEC-400-control-actions]] §2.5.

```text
SPEC-402-AC-01 (R-CTRL-010 / [[08-Decisions|D-050]])  [composed-input only — no arm]
  Given camp 안 여러 orc 를 대상으로 broadcast 할 때
  When POST /api/camps/:campId/broadcast {input, targets} 를 처리하면
  Then 각 대상 egress 는 [[SPEC-400-control-actions]] /input(literal+Enter) form 경로로만 나가고,
       [[SPEC-401-interactive-input]] arm-session 을 만들거나 multi-arm 실시간 전파를 하지 않는다.
```

```text
SPEC-402-AC-02 (R-CTRL-010 / [[08-Decisions|D-051]])  [N≥2 단일 confirm — 모든 대상 나열]
  Given 대상이 2개 이상(N≥2)인 broadcast 요청에서
  When confirmed:true 없이 요청하면 그리고 confirm UI 를 렌더하면
  Then confirmed 누락 요청은 422 confirm_required 로 거부되고,
       단 하나의 confirm 이 모든 대상의 paneId·tmuxTarget·agentType·command 와 broadcast 할 input 요약을 나열한다
       (N==1 은 일반 /input 과 동일 취급, 별도 broadcast confirm 미강제).
```

```text
SPEC-402-AC-03 (R-CTRL-010, R-CTRL-005 / [[08-Decisions|D-051]])  [per-orc gate pipeline + fresh 재검증]
  Given 대상 집합에 대해 broadcast 실행이 승인됐을 때
  When 각 대상을 처리하면
  Then 대상마다 [[SPEC-400-control-actions]] §2.5 gate(schema→controllability→fresh expected 재검증→execute→audit)를
       순서대로 통과하고, 어떤 대상도 재검증(Gate 5)을 건너뛰지 않는다.
```

```text
SPEC-402-AC-04 (R-CTRL-010)  [순차 실행 · per-pane single-writer 보존]
  Given N개 대상 broadcast 를 실행할 때
  When egress 순서를 관측하면
  Then 대상은 targets 순서로 per-orc 순차 처리되고,
       같은 paneId 에 대해 [[SPEC-400-control-actions]] §2.10 per-pane single-writer(at-most-one in-flight) 직렬화가 보존된다.
```

```text
SPEC-402-AC-05 (R-CTRL-010 / [[08-Decisions|D-051]])  [best-effort 부분 실패 + 집계]
  Given 대상 중 하나의 pane 이 사라졌거나 target drift 로 재검증에 실패할 때
  When broadcast 를 처리하면
  Then 그 orc 는 egress 없이 실패로 집계되고(results[].ok=false + errorCode),
       나머지 대상은 계속 처리되며(중단 없음),
       응답 results[] 가 대상별 {ok, outcome, errorCode} 와 successCount/failureCount 를 집계한다.
```

```text
SPEC-402-AC-06 (R-CTRL-007 / [[08-Decisions|D-051]], [[08-Decisions|D-028]])  [batch audit 원문 비저장 · 신규 프레임 없음]
  Given broadcast 실행에서 사용자가 secret 형태(예: ghp_<token>)를 포함한 input.text 를 fan-out 할 때
  When 산출된 control.broadcast batch ActivityEvent·응답·debug log 를 검사하면
  Then (a) ghp_<token> literal·broadcast command 원문·전송 key 시퀀스·startup token 이 어떤 필드에도 나타나지 않고,
           detail 은 targetCount·successCount·failureCount·inputByteLength·inputRedactedFlag(boolean)·perOrc[{orcId,ok,errorCode}]·correlationId 만 담으며,
       (b) broadcast 결과는 동기 REST 응답 + 기존 activity stream(batch 1건 + per-orc control.result N건)으로 표현되고
           [[SPEC-102-realtime-sync]] 에 신규 WS 프레임을 추가하지 않는다.
```

```text
SPEC-402-AC-07 (R-CTRL-010 / [[08-Decisions|D-051]])  [단일 camp 범위 · 대상 상한 · 중복 de-dup]
  Given broadcast 요청 targets 에 :campId 밖 orcId 가 섞이거나, 대상 수가 BROADCAST_MAX_TARGETS(가설)를 초과하거나,
        같은 orcId/paneId 가 중복 포함될 때
  When 요청을 처리하면
  Then (a) 범위 밖 orcId 혼입은 422 validation_error(또는 403 out_of_camp_scope)로,
       (b) (de-dup 후) 상한 초과는 422 too_many_targets(또는 429 rate_limited)로 요청 전체가 거부되어 blast radius 가 bound 되고,
       (c) 중복 orcId/paneId 는 de-dup 되어 orc 당 정확히 1회만 실행되며 중복 항목은 결과에 표기된다(as-listed 반복 실행 아님).
```

```text
SPEC-402-AC-08 (R-CTRL-005, R-CTRL-010)  [mis-target 방어 — client 선택 ≠ 신뢰]
  Given 대상 선택이 client-side(waiting-only/active/수동)로 이뤄져 server 에 targets 로 올 때
  When server 가 각 대상을 처리하면
  Then server 는 필터 의미를 신뢰하지 않고 대상마다 fresh read 로 expected(paneId/command/agentType)를 재검증하며,
       재검증 불일치 대상은 egress 없이 실패 집계된다(오폭 방어, [[SPEC-400-control-actions]] §2.6).
```

```text
SPEC-402-AC-09 (R-CTRL-008, [[08-Decisions|D-019]])  [새 writer 없음 · 구조적 임의 명령 불가]
  Given broadcast 요청 스키마와 실제 egress 를 관측할 때
  When targets/input 외 임의 필드나 subcommand/shell 자유 명령 필드를 주입 시도하면
  Then unknown 필드가 422 validation_error 로 거부되고,
       모든 egress 는 [[SPEC-400-control-actions]] controlExec literal/key 템플릿(single-writer, shell:false)으로만 구성되어
       broadcast 는 두 번째 writer 나 임의 shell 실행 경로를 만들지 않는다.
```

```text
SPEC-402-AC-10 (R-CTRL-010 / [[08-Decisions|D-044]])  [exposure 독립 — form-path 의미]
  Given 글로벌 preview exposure 가 off 인 상태에서 broadcast 를 실행할 때
  When 요청을 처리하면
  Then broadcast 는 exposure-off 로 차단되지 않고(context-display + expected 재검증 gate 만 적용, live-view gate 아님),
       [[SPEC-401-interactive-input]] arm 이 exposure-off 에서 거부되는 것과 달리 form-path control action 과 동일하게 실행된다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-CTRL-010 | command broadcast(composed-input only·단일 camp·대상 상한·중복 de-dup·순차 fan-out·부분 실패 집계·exposure 독립) | SPEC-402-AC-01, AC-02, AC-04, AC-05, AC-07, AC-09, AC-10 |
| R-CTRL-005 | 대상별 fresh `expected` 재검증(client 선택 불신뢰·오폭 방어) | SPEC-402-AC-03, AC-08 |
| R-CTRL-007 | `control.broadcast` batch audit + per-orc `control.result`(원문 비저장) | SPEC-402-AC-06 |
| R-CTRL-008 | 새 writer 없음·gate pipeline 재사용·구조적 임의 명령 불가 | SPEC-402-AC-03, AC-09 |

> 부수 정합(1차 소유 타 spec): **[[08-Decisions|D-050]]**(composed-input only, arm 기각 — AC-01), **[[08-Decisions|D-051]]**(단일 confirm·순차·best-effort·batch audit·단일 camp — AC-02/05/06/07), **[[08-Decisions|D-028]]**(canonical audit envelope·non-storage — AC-06), **[[08-Decisions|D-041]]**(passthrough 연결당 1 pane — arm 부적합 근거). write egress·gate·재검증 메커니즘은 [[SPEC-400-control-actions]], audit 모델은 [[SPEC-600-observability]], UI는 [[SPEC-203-terminal-workspace]] 소유. 전체 추적 매트릭스는 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — 상태 Accepted (RESOLVED 2026-07-03)**: 근거 결정 [[08-Decisions|D-050]]/[[08-Decisions|D-051]]는 도메인 리뷰(security-privacy·product-ui) + spec-reviewer P0-gap 게이트(P0 0) 통과 후 **2026-07-03 제품 오너가 Accepted 승인**했다. 본 spec은 `approved`이며 구현 착수 가능하다. (이하 원 리뷰 대상 기록.) 도메인 리뷰(security-privacy: broadcast 오폭·audit 비저장 / product-ui: broadcast UX·confirm 모달 정합) + spec-reviewer 게이트 후 승인받아야 `approved` 승격 가능하다.
- **C2 — `control.broadcast` taxonomy 등록**: §2.7 batch audit은 [[SPEC-600-observability]] `ActivityType`/`code` 집합에 `control.broadcast` code와 `detail.perOrc[]`·broadcast 집계 필드 등록을 요구한다. 등록·code 토큰·detail 스키마는 [[SPEC-600-observability]] 소유이며 본 spec은 producer 매핑만 제안한다. **SPEC-600 정합 확인 필요.**
- **C3 — 신규 WS 프레임 불필요 확인**: broadcast는 동기 REST 결과 + 기존 `activity` frame으로 성립하므로 [[SPEC-102-realtime-sync]]에 신규 프레임을 추가하지 않는다(§2.7, AC-06). SPEC-102 개정에 "broadcast = unchanged"를 명시했다.

### Open Questions (검토 필요 / PoC 대상)

- **Q1 — `BROADCAST_MAX_TARGETS`·rate·순차 vs 병렬(측정)**: 대상 상한·broadcast rate·(순차 고정 대비) 제한 병렬의 처리량/부하 trade-off는 [[SPEC-007-test-validation]] 하니스·사용성으로 보정한다(§2.5/§2.8). **PoC 튜닝.**
- **Q2 — cross-camp broadcast(forward, P2)**: MVP는 단일 camp로 blast radius를 bound한다([[08-Decisions|D-051]]). cross-camp fan-out은 신뢰 경계·오폭 반경이 커 forward(P2)다. `/api/broadcast`(camp-무관) 경로 채택 여부는 그때 판정한다(§2.1). **검토 필요(P2).**
- **Q3 — 부분 실패 옵션화(stop-on-first)**: MVP는 best-effort continue를 고정한다(§2.6). 향후 조작자가 stop-on-first를 옵션으로 고를 수 있게 할지는 사용성 질문이다. **검토 필요.**
- **Q4 — 프롬프트 템플릿/이력**: broadcast 프롬프트 템플릿·이력 재사용([[18-Terminal-Workspace]] §3.4)은 P1 이월이며([[SPEC-500-settings-persistence]] forward) 착수 시 broadcast `input`과의 연결을 정의한다. **검토 필요(P1).**
