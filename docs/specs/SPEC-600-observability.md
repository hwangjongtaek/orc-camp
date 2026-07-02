---
spec: SPEC-600
title: Observability — activity log·debug log·doctor 진단
status: approved
updated: 2026-07-02
requirements: [R-OBS-001, R-OBS-002, R-OBS-003, R-OBS-004]
decisions: [D-003, D-008, D-015, D-016, D-028, D-043]
tags:
  - specs
  - observability
  - activity-log
  - debug-log
  - doctor
  - diagnostics
  - epic-7
---

# SPEC-600 — Observability (activity log·debug log·doctor 진단)

Orc Camp **전체 제품**의 **관측성·진단 계약**의 단일 진실 공급원(SSOT)이다. Epic 7([[README]])의 진입 spec이며 세 기둥을 고정한다:

1. **Activity log(R-OBS-001)**: 사용자에게 보여줄 수 있는 운영 event(scanner·status change·control 결과·tmux error·reconnect)를 담는 **in-memory ring buffer**. `ActivityEvent` 모델(05-Backend 도메인 재사용), event taxonomy, 그리고 surfacing 경로(dashboard activity rail + [[SPEC-102-realtime-sync]]의 `activity` WS frame)를 소유한다.
2. **Debug log(R-OBS-002, R-OBS-003)**: scanner/API/control 오류와 timing을 파일에 기록하는 **local debug log**. log level, rotation/size bound, **"무엇을 기록해도 되는가"의 정밀 계약**, 그리고 [[SPEC-006-privacy-redaction]]와 공유하는 redaction chokepoint를 소유한다.
3. **doctor 진단 depth(R-OBS-004 + 관측성 비기능)**: [[SPEC-100-server-lifecycle]] doctor surface 위에서 **debug log 위치 discoverability**와 **basic check를 넘는 진단 내용**, 그리고 "**terminal 원문 없이 문제를 신고**한다"는 목표(doctor 결과 + debug log만으로 triage 가능)를 소유한다.

> **핵심 불변식 ① — no raw output in logs(확정, [[08-Decisions|D-016]] / [[SPEC-006-privacy-redaction]] §2.5)**: debug log에는 **capture 텍스트(raw도 redacted도)·preview text·`currentWorkSummary`·startup token·미-redact `cmdline`을 기록하지 않는다**. log에 쓰는 모든 자유 텍스트(tmux stderr, error message)는 기록 **직전** [[SPEC-006-privacy-redaction]] §2.1의 단일 `redact()` chokepoint를 통과한다(방어선). 이 불변식은 activity log의 `message`에도 동일하게 적용된다.

> **핵심 불변식 ② — local-only, no telemetry(확정, [[08-Decisions|D-003]])**: activity log·debug log는 사용자 local machine에만 존재하며 어떤 cloud/원격으로도 자동 전송하지 않는다. 사용자가 문제를 신고할 때는 §2.10의 redacted **problem report 번들**을 **명시적으로** 공유한다(자동 텔레메트리 없음).

> **핵심 불변식 ③ — activity ≠ snapshot state(확정)**: activity event는 [[SPEC-102-realtime-sync]]의 convergent state-diff가 **아니다**. append-only 로그 항목이며 정렬·dedup 권위 키는 `seq`/`id`이고 snapshot `version`을 bump하지 않는다(§2.4). 누락된 activity event는 상태 정확성 문제가 아니므로 state-diff처럼 gap→resync를 강제하지 않는다(best-effort, tail 재조회 + id dedup).

## 1. Scope

### In scope

- **`ActivityEvent` 모델**(§2.1): [[05-Backend]] 도메인(`id`/`type`/`target`/`severity`/`message`/`createdAt`)을 구현 가능한 wire 계약으로 확정하고 `seq`/`code`/`detail`/`source`로 보강.
- **activity event taxonomy**(§2.2): R-OBS-001가 열거한 5개 class(scanner / status change / control 결과 / tmux error / reconnect)와 server/client 출처 분리.
- **activity ring buffer**(§2.3): in-memory bound·FIFO eviction·ordering·dedup, 종료 시 폐기([[SPEC-100-server-lifecycle]] §2.8 dispose 책임 정합).
- **activity surfacing**(§2.4): live = [[SPEC-102-realtime-sync]] `activity` WS frame payload(본 spec 소유), bootstrap tail, dashboard activity rail로의 노출(렌더링은 [[SPEC-201-dashboard-screens]]).
- **debug log destination·format**(§2.5): JSON Lines 항목 스키마, 경로(해석은 [[SPEC-500-settings-persistence]]/[[SPEC-100-server-lifecycle]], 본 spec은 **포맷·내용·rotation** 소유).
- **debug log level·debug mode**(§2.6): `error|warn|info|debug`, 기본 level, `--debug`/env opt-in, tmux raw command·timing은 debug level에서만(단 capture 텍스트는 어떤 level에서도 미기록).
- **"무엇을 기록해도 되는가" 계약**(§2.7): allowed/forbidden 필드 표 + redaction-before-write 방어선(R-OBS-003).
- **rotation·size bound**(§2.8): per-file 상한·rotated file 수·총 disk cap.
- **doctor 진단 depth**(§2.9): `log.path` check **detail 내용**(경로·writable·size·level·rotation), basic check를 넘는 observability diagnostics block(R-OBS-004).
- **problem report 번들**(§2.10): doctor 결과 + redacted debug log tail = terminal 원문 없이 triage 가능(관측성 비기능).
- 다룬 요구사항: **R-OBS-001, R-OBS-002, R-OBS-003, R-OBS-004, 관측성 비기능**.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| redaction 패턴 카탈로그·`redact()`/`sanitize()` 구현·false-redaction 측정 | privacy 계약. 본 spec은 그 chokepoint를 **재사용**만 | [[SPEC-006-privacy-redaction]] |
| doctor **command surface**(flag·5개 basic check 집합·exit code semantics) | CLI 표면. 본 spec은 `log.path` **detail 내용**과 추가 diagnostics만 | [[SPEC-100-server-lifecycle]] |
| control action **audit 의미**(text/key/interrupt·target 재검증·confirm) | control 슬라이스. 본 spec은 그 결과를 **activity event로 적재**만 | [[SPEC-400-control-actions]] |
| `activity` WS frame **envelope·전송·reconnect 프로토콜** | realtime transport. 본 spec은 그 frame이 싣는 **payload(ActivityEvent)**만 | [[SPEC-102-realtime-sync]] |
| activity rail·debug 상태의 **화면 렌더링·카피** | dashboard 화면 | [[SPEC-201-dashboard-screens]] / [[SPEC-202-design-accessibility]] |
| config/log **path 해석 규칙**(XDG vs macOS app dir) | 영속 경로 계약 | [[SPEC-500-settings-persistence]] / [[SPEC-100-server-lifecycle]] |
| API error 사용자 표면 envelope·`requestId` **생성** | snapshot/API 런타임. 본 spec은 debug log **목적지**와 correlation 적재만 | [[SPEC-101-snapshot-api]] (R-API-005) |
| version·smoke·packaging 진단 심화 | 배포 진단 | [[SPEC-700-packaging-release]] |

## 2. Contract

### 2.1 `ActivityEvent` 모델 (R-OBS-001; [[05-Backend]] 도메인 확정)

[[05-Backend]]의 `ActivityEvent`(`id`/`type`/`target`/`severity`/`message`/`createdAt`)를 wire 계약으로 확정한다. 직렬화 키는 camelCase다.

```ts
type ActivitySeverity = 'info' | 'warn' | 'error';   // activity는 사용자 표면 → debug level 없음

type ActivityType =
  // scanner event (R-OBS-001)
  | 'scanner.started' | 'scanner.stale' | 'scanner.recovered' | 'scanner.error'
  // status change (R-OBS-001)
  | 'orc.status_changed' | 'orc.terminated'
  // control action 결과 (R-OBS-001, R-CTRL-007 / [[SPEC-400-control-actions]])
  | 'control.result'
  // interactive passthrough arm-session 요약 (R-CTRL-009, [[SPEC-401-interactive-input]] §2.9 / [[08-Decisions|D-043]]) — arm-session당 1건, per-keystroke event 미발행
  | 'control.passthrough_session'
  // tmux error (R-OBS-001, R-TMUX-004)
  | 'tmux.error'
  // reconnect/연결 (R-OBS-001, [[SPEC-102-realtime-sync]]) — client 합성(§2.4)
  | 'connection.disconnected' | 'connection.reconnected'
  // server lifecycle
  | 'server.started' | 'server.stopping';

interface ActivityTarget {        // event가 가리키는 entity (server-wide면 전체 null)
  campId?: string;                // "session:"+sessionId ([[08-Decisions|D-017]])
  orcId?: string;                 // "pane:"+paneId ([[08-Decisions|D-017]])
  paneId?: string;                // "%12" — 구조 식별자(redaction-safe, [[SPEC-006-privacy-redaction]] §2.3); control.result 권위 target([[SPEC-400-control-actions]] §2.8, [[08-Decisions|D-028]])
  tmuxTarget?: string;            // 표시 전용 (D-017; 권위는 orcId/paneId/campId)
}

interface ActivityDetail {        // 전부 redaction-safe 구조 값 (자유 텍스트 금지)
  correlationId?: string;         // debug log requestId/errorId 연결 (R-API-005, §2.5)
  outcome?: 'success' | 'failure';// coarse 결과 (control.result·status 등 공통)
  exitCode?: number;              // tmux/control 종료 코드
  durationMs?: number;            // timing
  fromStatus?: string;            // status change 전이 (enum 값, [[SPEC-005-data-contract]])
  toStatus?: string;
  // control.result 전용 — [[SPEC-400-control-actions]] §2.8 매핑 (R-CTRL-007 / [[08-Decisions|D-028]]); 모두 redaction-safe
  action?: 'input' | 'key' | 'interrupt';
  controlOutcome?: 'success' | 'partial' | 'aborted' | 'failed'; // 4-값 control 결과(coarse outcome과 동반)
  reason?: string;                // aborted/failed 안정 token(target_gone/target_mismatch/tmux_exec_failed/confirm_required/key_not_allowed)
  keyName?: string;               // action='key'면 allowlist 키 이름(secret 아님)
  inputByteLength?: number;       // action='input'이면 text byteLength(내용 아님)
  inputRedactedFlag?: boolean;    // text의 redaction 패턴 매칭 여부(내용 미포함)
  // control.passthrough_session 전용 — [[SPEC-401-interactive-input]] §2.9 매핑 (R-CTRL-009 / [[08-Decisions|D-043]]); 모두 redaction-safe 집계 스칼라(원문 미포함)
  keystrokeCount?: number;        // arm-session 동안 전송된 keystroke 수(수치 집계, 내용 아님)
  execFailures?: number;          // 세션 중 controlExec 실패 수
  keyHistogram?: Record<string, number>; // (optional, **기본 off**) allowlist 키 이름별 빈도. behavior side-channel이라 opt-in; literal 문자·원문은 절대 담지 않는다([[SPEC-401-interactive-input]] §2.9 Q6)
  // 금지: capture 텍스트·preview·currentWorkSummary·token·send-keys raw text·전송 key 시퀀스·passthrough keystroke 원문·literal text
}

interface ActivityEvent {
  id: string;                     // 안정 고유 id (dedup 키). 예 "act:" + seq
  seq: number;                    // server runtime 단위 단조 증가 (정렬 권위 키, §2.3)
  type: ActivityType;             // taxonomy (§2.2)
  severity: ActivitySeverity;     // info | warn | error
  target: ActivityTarget | null;  // 대상 entity, server-wide면 null
  code: string;                   // 안정 machine code (i18n·필터용; message 파싱 불요)
  message: string;                // 사람용, redacted·metadata-only (불변식 ① 통과)
  detail?: ActivityDetail;        // 구조적 redaction-safe 메타
  createdAt: string;              // ISO 8601 server time
  source: 'server' | 'client';    // client = 연결 끊김 등 client 합성(§2.4)
}
```

- **`message` 규칙(확정)**: 항상 redaction-safe·metadata-only 문장이다. capture 콘텐츠 단편을 담지 않으며, 자유 텍스트(예: tmux stderr 요약)를 포함할 경우 `redact()`(불변식 ①)를 통과한 값만 쓴다. UI는 색만으로 의미를 전달하지 않으므로(접근성 비기능) `severity`·`code`·`type`을 함께 제공해 icon/label 렌더를 가능케 한다(렌더링은 [[SPEC-201-dashboard-screens]]/[[SPEC-202-design-accessibility]]).
- **`code` 규칙(확정)**: 안정 문자열(예: `scanner.tmux_unreachable`, `control.target_revalidation_failed`). 변경 시 본 spec과 의존 테스트를 함께 갱신한다([[SPEC-006-privacy-redaction]] class 토큰 안정성 규칙과 동형).
- **`detail` 규칙(확정)**: 구조적·열거형·수치 값만. 자유 텍스트·콘텐츠·token을 절대 담지 않는다.

### 2.2 Activity event taxonomy (R-OBS-001)

R-OBS-001가 명시한 5개 class를 빠짐없이 매핑한다(severity는 대표값, 상황에 따라 상향 가능).

| class (R-OBS-001) | `type` | 대표 severity | `target` | `detail` 핵심 | 출처/소유 |
| --- | --- | --- | --- | --- | --- |
| scanner event | `scanner.started`/`scanner.recovered` | info | null | `durationMs` | scanner([[SPEC-101-snapshot-api]] 런타임) |
| scanner event(staleness) | `scanner.stale` | warn | null | `durationMs` | scanner staleness(R-TMUX-005) |
| scanner event(scan 실패) | `scanner.error` | error | null/`tmuxTarget` | `code`·`exitCode`·`correlationId` | scanner |
| status change | `orc.status_changed` | info | `orcId`/`campId` | `fromStatus`·`toStatus` | status 추론([[SPEC-004-status-inference]]) |
| status change(종료) | `orc.terminated` | info | `orcId`/`campId` | `toStatus='terminated'` | retention(R-ORC-006) |
| control action 결과 | `control.result` | info(성공)/warn(partial·aborted)/error(failed) | `orcId`/`paneId`/`tmuxTarget` | `action`·`controlOutcome`·`outcome`·`reason`·`exitCode`·`correlationId` | [[SPEC-400-control-actions]] §2.8(R-CTRL-007, [[08-Decisions|D-028]]) |
| passthrough arm-session 요약 | `control.passthrough_session` | info(정상)/warn(rate-limit·drift disarm) | `orcId`/`paneId` | `keystrokeCount`·`durationMs`·`execFailures`·`inputRedactedFlag`·(opt) `keyHistogram`·`correlationId`(armSessionId) | [[SPEC-401-interactive-input]] §2.9(R-CTRL-009, [[08-Decisions|D-043]]) |
| tmux error | `tmux.error` | warn/error | `tmuxTarget`/`orcId` | `code`·`exitCode` | tmux exec(R-TMUX-004) |
| reconnect event | `connection.disconnected`/`connection.reconnected` | warn/info | null | `durationMs`(끊김 지속) | **client 합성**(§2.4, [[SPEC-102-realtime-sync]]) |

- **control.result(R-CTRL-007 정합, canonical)**: `control.result`는 control audit의 **canonical 표현**이며([[08-Decisions|D-028]]), [[SPEC-400-control-actions]] §2.8이 control 실행 결과(success/partial/aborted/failed)를 본 모델의 `target`/`detail`로 매핑해 적재한다(§2.2.1). 실패는 `severity='error'` + `detail.outcome='failure'` + `detail.controlOutcome='failed'`이며, target 재검증 실패 등 사유는 안정 `code`(예 `control.target_revalidation_failed`)와 `detail.reason`로 식별한다(원문 echo 금지 — [[05-Backend]] "재검증 실패 시 activity event에 실패 원인 기록"을 redaction-safe code로 구현). send-keys 원문·전송 key 시퀀스는 어떤 필드에도 담지 않는다(§2.7).
- **scanner.error / tmux.error(R-TMUX-004 정합)**: 특정 target 실패는 전체 장애가 아니라 target별 event로 기록한다([[05-Backend]] 비동기 처리). message는 tmux stderr 요약(redact 통과)이며 capture 콘텐츠를 포함하지 않는다([[SPEC-006-privacy-redaction]] AC-13 정합).
- **control.passthrough_session(R-CTRL-009 정합, 2026-07-02 신설)**: interactive passthrough([[SPEC-401-interactive-input]] §2.9, [[08-Decisions|D-043]])는 per-keystroke event를 발행하지 않고 **arm-session당 정확히 1건**의 요약 event를 disarm/close 시 산출한다. `detail`은 집계 스칼라(`keystrokeCount`·`durationMs`·`execFailures`·`inputRedactedFlag`, optional 기본-off `keyHistogram`)만 담고 **keystroke 원문·literal text·전송 key 시퀀스·token은 어떤 필드에도 담지 않는다**(§2.7 금지 확장, [[SPEC-006-privacy-redaction]] non-persistence 정합). `code`는 안정 `control.passthrough_session`이다. 매핑 producer 소유는 [[SPEC-401-interactive-input]] §2.9, 모델·code·taxonomy 권위는 본 spec이다([[08-Decisions|D-028]] frame-role split 정신 재사용).

#### 2.2.1 control.result 필드 매핑 ([[SPEC-400-control-actions]] §2.8 → `ActivityEvent`) — canonical ([[08-Decisions|D-028]])

control action의 audit 데이터는 아래와 같이 본 모델의 `target`/`detail`로 매핑된다. 본 spec이 receiving canonical을 소유하고, producer 매핑은 [[SPEC-400-control-actions]] §2.8이 소유한다(두 spec 동형).

| control action 데이터 | → `ActivityEvent` 위치 | 비고 |
| --- | --- | --- |
| (고정) | `type` = `'control.result'` | canonical token (구조·token 권위 = 본 spec) |
| `action`(input/key/interrupt) | `detail.action` | |
| `outcome`(success/partial/aborted/failed) | `detail.controlOutcome` | 4-값 보존 |
| (파생) success→success, 그 외→failure | `detail.outcome` | coarse(기존 AC 정합) |
| (파생) success→info, partial·aborted→warn, failed→error | `severity` | |
| (파생) action+outcome | `code` | 안정 machine code([[SPEC-400-control-actions]] §2.8 code 표) |
| `reason`(target_gone/target_mismatch/...) | `detail.reason` | aborted/failed만 |
| `orcId` | `target.orcId` | "pane:%12" |
| `paneId` | `target.paneId` | "%12" — 권위([[08-Decisions|D-017]]) |
| `tmuxTarget` | `target.tmuxTarget` | 표시 전용 |
| `keyName` | `detail.keyName` | action='key'만 |
| `inputByteLength` | `detail.inputByteLength` | 내용 아님 |
| `inputRedactedFlag` | `detail.inputRedactedFlag` | boolean |
| `exitCode` | `detail.exitCode` | |
| `durationMs` | `detail.durationMs` | |
| `requestId`/`errorId` | `detail.correlationId` | debug log 연결(R-API-005) |
| send-keys text·전송 key 시퀀스·token | **미직렬화(금지)** | 불변식 ①·[[08-Decisions|D-016]], §2.7 |

- **`id`/`seq`/`createdAt`/`source`/`message`(확정)**: 본 spec이 부여한다(`source='server'`, `seq`는 §2.3 단조 증가). `message`는 redaction-safe·metadata-only 요약이며 send-keys 원문을 담지 않는다(§2.1 `message` 규칙).
- **`agentType` 제외(확정)**: producer의 재검증 대조용 `agentType`은 canonical control.result 매핑에 포함하지 않는다(audit 식별엔 `target.orcId`/`target.paneId`로 충분; 확장 검토는 §6/[[SPEC-400-control-actions]] §6 Q).

### 2.3 Activity ring buffer (R-OBS-001)

```ts
const ACTIVITY_CAPACITY = 500;        // ring buffer 최대 항목 수 (PoC 검증 가설, §3.5)
const ACTIVITY_BOOTSTRAP_TAIL = 50;   // 초기/재연결 시 노출하는 최근 항목 수 (가설)
```

- **memory only(확정, [[02-Requirements]] 데이터 보존 정책)**: activity event는 **memory ring buffer**에만 보관한다([[05-Backend]] "event history: memory ring buffer"). disk·SQLite 영속은 MVP 비목표(P1 `R-P1-006` opt-in). 단 event의 **운영 사실 요약**은 debug log에도 별도 기록될 수 있다(§2.5; 두 경로는 분리).
- **bound·eviction(확정)**: capacity `ACTIVITY_CAPACITY`를 초과하면 **가장 오래된 항목부터 FIFO eviction**한다. 버퍼 점유는 capacity를 절대 초과하지 않는다(메모리 상한 보장).
- **ordering·dedup(확정, 불변식 ③)**: 정렬 권위 키는 `seq`(server runtime 단위 단조 증가)다. client는 `id`로 dedup한다. activity event는 snapshot `version`을 bump하지 않으며 convergent state-diff가 아니다.
- **종료 시 폐기(확정)**: process 종료 시 ring buffer는 폐기된다([[SPEC-100-server-lifecycle]] §2.8 disposal — runtime state dispose 호출 책임은 SPEC-100, 버퍼 소유는 본 spec). 재시작은 새 `seq` 시퀀스(0부터)와 새 `runtimeEpoch`([[SPEC-102-realtime-sync]] §2.4)를 갖는다.

### 2.4 Activity surfacing — WS frame · bootstrap · rail (R-OBS-001)

- **live 전송(확정)**: 새 activity event는 [[SPEC-102-realtime-sync]] envelope의 **`activity` frame** payload로 전송된다. payload shape = §2.1 `ActivityEvent`(본 spec 소유). frame envelope의 `version`은 emit 시점의 **현재 snapshot version**을 싣되([[SPEC-102-realtime-sync]] §2.3, "현재"), activity 정렬은 `seq`/`createdAt`으로 한다(불변식 ③). token은 frame payload에 직렬화하지 않는다([[SPEC-102-realtime-sync]] §2.1 정합).
- **bootstrap tail(확정)**: dashboard 최초 로드·재연결 시 activity rail은 초기 항목이 필요하다. server는 ring buffer의 **최근 `ACTIVITY_BOOTSTRAP_TAIL`개**를 bootstrap tail로 제공한다. **배치(snapshot 필드 vs 전용 read)**는 [[SPEC-101-snapshot-api]] snapshot 직렬화와 정합해야 하므로 cross-spec 조정 항목이다(§6 C1). 본 spec은 tail **항목 shape = `ActivityEvent`**와 **개수 정책**을 소유한다. 재연결 시 client는 tail을 재조회하고 `id`로 dedup해 중복 없이 합친다(best-effort; gap→resync 불요).
- **client 합성 event(확정)**: `connection.disconnected`/`connection.reconnected`는 **연결이 끊긴 동안** server가 보낼 수 없으므로(정의상) client가 **로컬에서 합성**해 같은 `ActivityEvent` shape(`source:'client'`, `seq`는 client-local 음수 또는 별도 네임스페이스로 server seq와 충돌 회피)로 rail에 삽입한다. server 측 `server_stale_changed`(연결됨·scan 실패, [[SPEC-102-realtime-sync]] §3.4)와는 **직교**하며 혼동하지 않는다(stale ≠ disconnected). 이 합성 항목의 렌더링·정확한 client store 위치는 [[SPEC-201-dashboard-screens]]/[[SPEC-200-frontend-architecture]] 소유이며, 본 spec은 **모델과 출처 분리**만 고정한다.
- **control.result frame-role split(확정, [[08-Decisions|D-028]]; [[SPEC-102-realtime-sync]] §2.3 참조)**: control action audit의 canonical 표현은 `control.result` ActivityEvent이며 **내구 rail 항목으로서 `activity` WS frame**으로 전송된다(payload=§2.1, transport=[[SPEC-102-realtime-sync]] §2.3). 행위 client의 **즉시(actor-scoped) 결과**는 [[SPEC-400-control-actions]] §2.2의 **동기 HTTP 응답**(`ControlResult`)이 담당한다. [[SPEC-102-realtime-sync]] §2.3 카탈로그의 **`control_result` frame**은 actor의 optimistic echo를 위한 **optional/forward** 최적화일 뿐 canonical audit이 아니다 — MVP 정규 경로는 (HTTP 응답=actor) + (`activity` frame=rail)이며, 한 control action은 rail에 control.result ActivityEvent **1건**만 만든다(중복 금지). 어느 frame에도 token·send-keys 원문을 직렬화하지 않는다([[SPEC-102-realtime-sync]] §2.1).
- **rail 노출(참조)**: activity rail의 배치·카피·필터 UI는 [[SPEC-201-dashboard-screens]] §2.3(3-pane) 소유다. 본 spec은 rail이 소비하는 **payload**만 제공한다.

### 2.5 Debug log — destination·format·항목 스키마 (R-OBS-002)

- **목적(R-OBS-002)**: scanner/API/control 오류와 timing을 **local 파일**에 기록해, activity log(휘발·요약)와 별개로 사후 triage를 가능케 한다.
- **destination(확정 + 참조)**: 단일 debug log 파일(예시 경로 `~/.local/state/orc-camp/debug.log` — [[SPEC-100-server-lifecycle]] §4.5 doctor 예시). **path 해석 규칙**은 [[SPEC-500-settings-persistence]]/[[SPEC-100-server-lifecycle]] 소유, 본 spec은 그 경로에 쓰는 **포맷·내용·rotation**을 소유한다. doctor가 이 경로를 표기한다(§2.9, R-OBS-004).
- **format(확정)**: **JSON Lines**(한 줄당 1 JSON object)로, 사람·스크립트·doctor가 파싱 가능하다. 각 줄은 아래 스키마를 따른다.

```ts
type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type LogComponent = 'scanner' | 'api' | 'control' | 'tmux' | 'ws' | 'server';

interface DebugLogEntry {
  ts: string;                 // ISO 8601
  level: LogLevel;
  component: LogComponent;
  code: string;               // 안정 event/error code (activity.code와 정렬 가능)
  phase?: string;             // 예 'capture-pane' | 'snapshot' | 'send-keys-precheck'
  command?: string;           // tmux allowlist subcommand + arg shape (값 아님; §2.7)
  paneId?: string;            // 구조 식별자 (통과, [[SPEC-006-privacy-redaction]] §2.3)
  target?: string;            // tmuxTarget 표시용
  exitCode?: number;
  durationMs?: number;        // timing (R-OBS-002)
  matchCount?: number;        // redaction-stats (test/debug 전용, [[SPEC-006-privacy-redaction]] §3.5)
  requestId?: string;         // R-API-005 correlation (사용자 event↔log 연결)
  errorId?: string;
  message?: string;           // redact() 통과한 stderr/error 요약 (자유 텍스트 방어선, §2.7)
}
```

- **correlation(확정, R-API-005 정합)**: API/control 오류는 사용자 표면(activity event·API error envelope, [[SPEC-101-snapshot-api]] §2.9 / [[SPEC-400-control-actions]])과 debug log를 **분리** 기록하되 동일 `requestId`/`errorId`로 연결한다. 사용자에게는 안정 code+message만, 운영자에게는 debug log 상세만 보인다([[SPEC-101-snapshot-api]] R-API-005). 어느 쪽도 terminal raw output을 담지 않는다(불변식 ①).
- **timing(확정, R-OBS-002)**: scanner tick, tmux command, API 요청, control 실행은 `durationMs`를 기록한다(장시간 block·성능 회귀 진단용; Scan latency 비기능과 정합).

### 2.6 Debug log — level·debug mode (R-OBS-002)

```ts
const DEFAULT_LOG_LEVEL: LogLevel = 'info';   // 기본 level (PoC 검증 가설, §3.5)
```

- **level 의미(확정)**: `error`(실패) ⊃ `warn`(degrade·재시도) ⊃ `info`(수명주기·요약·timing) ⊃ `debug`(tmux raw command·argv shape·세부 timing). level 설정 = 그 level 이상만 기록.
- **기본 level(가설)**: `info`. `--debug` flag 또는 env(예 `ORC_CAMP_LOG_LEVEL=debug`)로 `debug` opt-in한다(정확한 flag/env 이름은 [[SPEC-100-server-lifecycle]] CLI 표면과 정합 — §6 C2). [[06-Infra]] "debug mode: tmux raw command와 timing 출력"을 이 level로 구현한다.
- **debug level의 한계(확정·불변식 ①)**: debug level은 tmux **command**(allowlist subcommand + `-t <paneId> -S -<N>` 같은 arg shape)와 timing을 더 자세히 남길 뿐이며, **어떤 level에서도 capture 텍스트(raw/redacted)·preview·summary·send-keys payload·token을 기록하지 않는다**([[06-Infra]] "sensitive output은 debug log에 기본 저장하지 않는다"를 "결코 저장하지 않는다"로 강화 — [[SPEC-006-privacy-redaction]] §2.5).

### 2.7 "무엇을 기록해도 되는가" 계약 (R-OBS-003) — headline invariant

debug log·activity `message`에 **기록 가능한 것 / 금지된 것**을 정밀히 고정한다. 모든 자유 텍스트는 기록 직전 `redact()`(불변식 ①)를 통과한다.

| 분류 | 필드 | 기록 | 근거 |
| --- | --- | --- | --- |
| 시각 | `ts`/`createdAt`(ISO 8601) | **허용** | 메타데이터 |
| 분류 | `level`/`component`/`severity`/`code`/`type` | **허용** | 안정 enum/code |
| 구조 식별자 | `paneId`/`target`/`campId`/`orcId`/`windowIndex`/`paneIndex` | **허용** | tmux token 구조 식별자([[SPEC-006-privacy-redaction]] §2.3 통과) |
| tmux 명령 | `command`(allowlist subcommand + arg shape) | **허용** | read-only allowlist 명령·target·수치만([[SPEC-006-privacy-redaction]] §2.6) |
| 진단 수치 | `exitCode`/`durationMs`/`matchCount` | **허용** | 수치 메타 |
| 상관 키 | `requestId`/`errorId`/`correlationId` | **허용** | R-API-005 연결 |
| 오류 자유 텍스트 | `message`(tmux stderr·error 요약) | **허용(단, `redact()` 통과 후)** | 콘텐츠 우발 혼입 시 secret 마스킹(방어선, R-OBS-003) |
| capture 콘텐츠 | `recentOutput`/preview text/raw 버퍼 | **금지** | 불변식 ①, R-PRIV-005 ([[SPEC-006-privacy-redaction]] §2.5) |
| 추론 텍스트 | `currentWorkSummary` | **금지** | 콘텐츠 파생([[SPEC-004-status-inference]]) |
| control payload | send-keys text·전송 key 시퀀스 | **금지** | 사용자가 입력한 secret 가능([[SPEC-400-control-actions]]) |
| 비밀 | startup token | **금지** | 비영속([[SPEC-100-server-lifecycle]] §2.6, R-SEC-002) |
| 미-redact argv | raw `cmdline`(`--token=…`) | **금지(redact 후만)** | [[SPEC-006-privacy-redaction]] §2.7 cmdline chokepoint |

- **redaction chokepoint 재사용(확정)**: 본 spec은 redaction 패턴/구현을 **재정의하지 않고** [[SPEC-006-privacy-redaction]] §2.1 `redact()`를 그대로 호출한다(단일 chokepoint, [[08-Decisions|D-016]]). 즉 scanner error에 박힌 secret이 stderr로 새어 log message에 닿더라도 평문으로 남지 않는다.
- **이중 방어(확정)**: (a) capture 텍스트는 **애초에 log에 넘기지 않는다**(설계상 금지), (b) 그럼에도 log에 쓰는 자유 텍스트는 `redact()`를 거친다(우발 혼입 방어). 두 방어가 동시에 성립해야 한다.

### 2.8 Debug log — rotation·size bound (R-OBS-002)

```ts
const LOG_MAX_BYTES = 5 * 1024 * 1024;   // per-file 상한 5 MiB (PoC 검증 가설)
const LOG_KEEP_FILES = 3;                // 보관할 rotated 파일 수 (가설)
// 총 disk 점유 ≤ LOG_MAX_BYTES * (LOG_KEEP_FILES + 1)  (활성 1 + rotated K)
```

- **rotation(확정 정책, 값은 가설)**: 활성 `debug.log`가 `LOG_MAX_BYTES`를 초과하면 `debug.log.1` … `debug.log.K`로 회전(roll)하고 가장 오래된 것을 삭제한다. 총 disk 점유는 `LOG_MAX_BYTES*(LOG_KEEP_FILES+1)` 이하로 bound된다(무한 증가 방지, 비기능 신뢰성).
- **append·실패 격리(확정)**: log 쓰기는 append-only이며, log 파일 쓰기 실패(권한·disk full)는 **제품 장애가 아니다** — log를 건너뛰되 server/scan은 계속 동작한다(비기능 신뢰성, [[06-Infra]] 정신). doctor는 이 불가 상태를 `log.path` fail로 보고한다(§2.9, [[SPEC-100-server-lifecycle]] §2.3).

### 2.9 doctor 진단 depth (R-OBS-004)

[[SPEC-100-server-lifecycle]]가 doctor **command surface**(5개 basic check·exit semantics·`{id,label,status,detail}` 형태)를 소유한다. 본 spec은 그 위에서 두 가지를 소유한다.

**(A) `log.path` check의 detail 내용(R-OBS-004 — debug log 위치 discoverability)**

- doctor의 `log.path` check `detail`은 **해석된 debug log 절대 경로**(R-OBS-004의 핵심), writability, 현재 활성 파일 size, 현재 `level`, rotation 상태를 표기한다.
- 분류는 [[SPEC-100-server-lifecycle]] §2.3을 따른다: 경로 해석·쓰기 가능 = **pass**(경로 표기), 불가(권한/디렉터리 부재) = **fail**.
- **token·콘텐츠 비노출**: detail에는 경로·수치·level만 담고 log **내용**을 출력하지 않는다(불변식 ①).

```ts
interface LogPathDetail {            // doctor checks[].detail (id='log.path')
  path: string;                      // 해석된 절대 경로 (R-OBS-004)
  writable: boolean;
  sizeBytes: number;                 // 활성 파일 크기
  level: LogLevel;                   // 현재 적용 level
  rotation: { maxBytes: number; keep: number };
}
```

**(B) basic check를 넘는 observability diagnostics block(관측성 비기능)**

doctor `--json` 출력에 5개 check 외 **진단 컨텍스트 block**을 추가해, terminal 원문 없이도 환경·최근 오류 윤곽을 파악하게 한다. 이 block을 [[SPEC-100-server-lifecycle]]의 doctor JSON envelope(`{checks, summary, ok}`)에 **sibling**으로 싣는 배치는 cross-spec 조정 항목이다(§6 C3).

```ts
interface DoctorDiagnostics {
  environment: {                     // 일부는 [[SPEC-700-packaging-release]] 소유 값 참조
    appVersion: string;
    nodeVersion: string;
    os: string; arch: string;        // 예 'darwin' / 'arm64'
    tmuxVersion: string | null;      // 'tmux -V' (없으면 null, [[SPEC-100-server-lifecycle]] tmux.installed)
  };
  log: LogPathDetail;                // (A)와 동일 (경로 discoverability 중복 제공)
  recentErrors: {                    // debug log 최근 윈도 요약 — 콘텐츠 미포함
    windowEntries: number;           // 검사한 최근 항목 수
    counts: { error: number; warn: number };
    lastErrorAt: string | null;      // 최근 error의 ts (메시지 미포함)
    topCodes: { code: string; count: number }[]; // 안정 code 집계 (자유 텍스트 아님)
  };
}
```

- **recentErrors 규칙(확정)**: debug log 최근 윈도를 읽어 **code별 집계·count·최근 ts만** 보고하고 **message 본문·capture 콘텐츠는 출력하지 않는다**. 이로써 "어떤 종류의 오류가 얼마나 났는가"를 콘텐츠 없이 전달한다(관측성 비기능).
- **R-CLI-005 정합**: `log.path` check 자체의 존재·pass/warn/fail·exit 기여는 [[SPEC-100-server-lifecycle]] 소유다. 본 spec은 그 **detail·diagnostics 내용**만 심화한다.

### 2.10 problem report 번들 — terminal 원문 없는 신고 (관측성 비기능)

관측성 비기능: "사용자가 문제를 신고할 때 terminal 원문 없이도 doctor 결과와 debug log로 원인 파악이 가능해야 한다." 이를 **공유 가능한 redacted 번들**로 구현한다.

```ts
interface ProblemReport {
  generatedAt: string;               // ISO 8601
  doctor: { checks: unknown[]; summary: unknown; ok: boolean }; // [[SPEC-100-server-lifecycle]] doctor --json
  diagnostics: DoctorDiagnostics;    // §2.9 (B)
  logTail: DebugLogEntry[];          // 최근 N개 debug log 항목 (이미 §2.7 계약을 만족 → 추가 redaction 불요지만 재검증)
}
```

- **불변식(확정)**: `ProblemReport`는 **capture 텍스트·preview·`currentWorkSummary`·startup token·미-redact `cmdline`을 절대 포함하지 않는다**(불변식 ①). `logTail`은 §2.7 계약을 이미 만족한 항목이므로 본질적으로 안전하나, 번들 생성 시 동일 invariant를 **재검증**(assert)한다(이중 방어).
- **local-only·명시 공유(확정, 불변식 ②)**: 번들은 자동 전송되지 않는다. 사용자가 파일로 저장해 명시적으로 공유한다([[08-Decisions|D-003]]).
- **생성 surface(제안·조정)**: 번들 생성 CLI(예: `orc-camp doctor --report [path]` 또는 `--include-log`)는 doctor **flag 집합**을 확장하므로 [[SPEC-100-server-lifecycle]] §2.3과 조정한다(§6 C2). 본 spec은 번들 **내용·invariant**를 소유하고 정확한 flag 이름은 SPEC-100 확정에 위임한다.

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다([[SPEC-000-conventions]] 표기 규칙).

### 3.1 activity ↔ debug log 분리 (확정, R-OBS-001/002)

- activity log = **사용자 표면**(휘발 ring buffer, 5 taxonomy, severity info/warn/error, message는 비민감 요약). debug log = **운영자 표면**(파일, error/warn/info/debug, 상세 + timing + correlation). 같은 사건이 양쪽에 나타날 수 있으며 `correlationId`/`code`로 연결한다(R-API-005 정합).
- 둘 중 어느 쪽도 terminal raw output을 담지 않는다(불변식 ①). 차이는 **상세도와 영속성**이지 redaction 강도가 아니다(둘 다 redacted).

### 3.2 redaction-before-write (확정, R-OBS-003, [[08-Decisions|D-016]])

- log·activity `message`에 쓰는 모든 자유 텍스트는 [[SPEC-006-privacy-redaction]] §2.1 `redact()`를 **쓰기 직전** 통과한다. 본 spec은 패턴을 재정의하지 않고 그 chokepoint를 호출만 한다.
- capture 텍스트는 redaction 여부와 무관히 **log 경로로 넘기지 않는다**(§2.7 금지 행). 두 방어가 동시 성립(§2.7 이중 방어).

### 3.3 best-effort 전달·실패 격리 (확정, 비기능 신뢰성)

- activity ring buffer overflow는 **가장 오래된 항목 eviction**으로 처리하며 새 event 기록을 막지 않는다(§2.3).
- debug log 쓰기 실패(권한·disk full)는 server/scan을 중단시키지 않는다(§2.8). doctor가 `log.path` fail로 표면화한다.
- `activity` WS frame 미전달(연결 끊김)은 best-effort다 — 재연결 시 bootstrap tail 재조회 + `id` dedup으로 보충하며 gap→resync를 강제하지 않는다(불변식 ③, [[SPEC-102-realtime-sync]] §3.5 state-diff와 구분).

### 3.4 doctor health·exit 정합 (확정, [[08-Decisions|D-015]] / R-CLI-005)

- `log.path` check의 pass/warn/fail과 exit 기여는 [[SPEC-100-server-lifecycle]] §3.5(fail≥1 → exit 1)를 따른다. 본 spec의 diagnostics block·recentErrors는 **exit code에 영향을 주지 않는다**(정보 제공 전용; warn/fail 판정은 5개 basic check만).

### 3.5 tunable 한계 (모두 PoC 검증 가설)

| 상수 | 초기값(가설) | 소유 | 보정 근거 |
| --- | --- | --- | --- |
| `ACTIVITY_CAPACITY` | 500 | 본 spec | 메모리 vs 이력 깊이 ([[SPEC-007-test-validation]]) |
| `ACTIVITY_BOOTSTRAP_TAIL` | 50 | 본 spec | rail 가독성·초기 전송량 |
| `DEFAULT_LOG_LEVEL` | `info` | 본 spec | 잡음 vs 진단력 |
| `LOG_MAX_BYTES` | 5 MiB | 본 spec | disk 점유·rotation 빈도 |
| `LOG_KEEP_FILES` | 3 | 본 spec | 이력 보관 vs disk |
| `recentErrors.windowEntries` | 200 | 본 spec | triage 윈도 크기 |

전부 [[SPEC-007-test-validation]] 측정/운영 관찰로 확정한다.

## 4. Acceptance criteria

> secret 예시는 실제 값 대신 token shape/placeholder를 쓴다([[SPEC-000-conventions]]). "any log surface" = { debug log 파일, activity `message`/`detail`, doctor 출력, problem report 번들 }. 임계값은 §3.5 가설 표기를 따른다.

```text
SPEC-600-AC-01 (R-OBS-001)
  Given scanner event·status change·control 결과·tmux error·reconnect 중 하나가 발생할 때
  When activity ring buffer를 검사하면
  Then 해당 사건이 §2.2 taxonomy의 ActivityType으로 적재되고,
       그 ActivityEvent는 id·seq·type·severity·target·code·message·createdAt·source를 가진다.
```

```text
SPEC-600-AC-02 (R-OBS-001, R-CTRL-007, [[08-Decisions|D-028]])  [canonical 매핑]
  Given [[SPEC-400-control-actions]]의 control action이 성공/partial/abort/실행실패로 끝날 때
  When activity log를 검사하면
  Then 그 결과는 type='control.result' 인 canonical ActivityEvent 1건으로 적재되고,
       target={orcId,paneId,tmuxTarget} 와 detail.action·detail.controlOutcome(success|partial|aborted|failed)·
       detail.outcome(success|failure)·detail.reason(실패 시 안정 token)을 담으며,
       실패는 severity=error + 안정 code(예 control.target_revalidation_failed)로 식별되고
       send-keys로 전송한 text payload·전송 key 시퀀스는 message·detail 어디에도 포함되지 않는다
       (detail.inputByteLength + detail.inputRedactedFlag 만).
```

```text
SPEC-600-AC-03 (R-OBS-001)
  Given ring buffer에 ACTIVITY_CAPACITY(가설 500) 개 항목이 찬 상태에서
  When 추가 event가 들어오면
  Then 가장 오래된 항목이 FIFO로 제거되고 버퍼 점유는 ACTIVITY_CAPACITY를 초과하지 않으며,
       남은 항목의 seq 순서(단조 증가)가 보존된다.
```

```text
SPEC-600-AC-04 (R-OBS-001 / R-API-001 정합)
  Given dashboard가 연결되어 있고 새 activity event가 생길 때
  When 전송을 관측하면
  Then 그 event는 [[SPEC-102-realtime-sync]] envelope의 activity frame payload(=ActivityEvent)로 전달되고,
       최초 로드·재연결 시에는 최근 ACTIVITY_BOOTSTRAP_TAIL(가설 50)개 tail이 제공되어
       client가 id로 dedup해 중복 없이 합칠 수 있다.
```

```text
SPEC-600-AC-05 (R-OBS-002)
  Given scanner/API/control 오류가 발생할 때
  When debug log 파일을 검사하면
  Then 각 오류가 JSON Lines DebugLogEntry로 기록되고,
       ts·level·component·code 와 timing(durationMs)을 포함하며 파싱 가능하다.
```

```text
SPEC-600-AC-06 (R-OBS-003, R-PRIV-005)  [headline — planted secret]
  Given capture 또는 tmux stderr에 GitHub token 형태 `ghp_<token>`이 박힌 scanner error가 발생하고
        debug level로 logging이 켜져 있을 때
  When debug log 파일 전체를 검사하면
  Then `ghp_<token>` literal이 파일 어디에도 나타나지 않는다
       (자유 텍스트는 redact() 통과, capture 텍스트는 애초에 미기록 — 이중 방어).
```

```text
SPEC-600-AC-07 (R-OBS-003, R-PRIV-005)  [metadata-only 계약]
  Given 어떤 level(info/debug 포함)에서든 debug log를 기록할 때
  When 임의의 log 항목을 검사하면
  Then capture 텍스트(raw/redacted)·preview text·currentWorkSummary·startup token·
       미-redact cmdline 이 포함되지 않고, §2.7 허용 필드(메타데이터·구조 식별자·수치·code)만 담긴다.
```

```text
SPEC-600-AC-08 (R-OBS-003)  [redaction-before-write 방어선]
  Given log message로 쓰일 자유 텍스트(tmux stderr 등)에 secret(예 `sk-<token>`)이 우발적으로 섞일 때
  When 그 message가 debug log·activity message로 기록되면
  Then 기록 직전 [[SPEC-006-privacy-redaction]] redact() 를 통과해 secret literal 대신
       [REDACTED:<class>] 토큰이 남는다(any log surface).
```

```text
SPEC-600-AC-09 (R-OBS-002)
  Given debug log 활성 파일이 LOG_MAX_BYTES(가설 5 MiB)를 초과하도록 쓰일 때
  When rotation 동작을 관측하면
  Then 활성 파일이 회전되고 가장 오래된 rotated 파일이 삭제되어,
       전체 debug log disk 점유가 LOG_MAX_BYTES*(LOG_KEEP_FILES+1) 이하로 bound된다.
```

```text
SPEC-600-AC-10 (R-OBS-004, R-CLI-005)
  Given 임의의 환경에서
  When `orc-camp doctor`(또는 --json)를 실행하면
  Then log.path check의 detail이 해석된 debug log 절대 경로·writable·sizeBytes·level·rotation을 표기하고,
       그 경로 표기에 log 내용·token이 포함되지 않는다.
```

```text
SPEC-600-AC-11 (관측성 비기능)  [terminal 원문 없는 triage]
  Given tmux command 실패가 debug log와 activity log에 기록된 상황에서
  When doctor --json 결과(diagnostics 포함)와 debug log를 함께 검토하면
  Then component·code·exitCode·durationMs·recentErrors(code 집계)로 원인 윤곽을 파악할 수 있고,
       그 과정에서 어떤 terminal raw output(capture/preview/summary)도 노출되지 않는다.
```

```text
SPEC-600-AC-12 (R-OBS-002 / R-API-005 정합)  [사용자↔로그 correlation]
  Given API/control 오류가 사용자 표면(activity event/API error envelope)과 debug log에 분리 기록될 때
  When 두 기록을 비교하면
  Then 동일 correlationId(=requestId/errorId)로 연결되며,
       사용자 표면에는 안정 code+요약만, debug log에는 상세가 있고 둘 다 terminal 원문을 담지 않는다.
```

```text
SPEC-600-AC-13 (R-OBS-001 / R-API-002 정합)  [reconnect ≠ stale]
  Given WS 연결이 끊겼다가 재연결될 때
  When activity log를 검사하면
  Then connection.disconnected/connection.reconnected 가 source='client'로 기록되고,
       이는 server가 보내는 scanner.stale(연결됨·scan 실패)과 구분된다([[SPEC-102-realtime-sync]] §3.4).
```

```text
SPEC-600-AC-14 (R-OBS-003, R-SEC-002 정합)  [token 비노출]
  Given server가 startup token을 발급하고 logging/doctor/report가 동작하는 동안
  When debug log·activity·doctor 출력·problem report 번들을 token literal로 검사하면
  Then 어디에서도 token이 발견되지 않는다([[SPEC-100-server-lifecycle]] §2.6 / AC-10 정합).
```

```text
SPEC-600-AC-15 (관측성 비기능)  [problem report invariant]
  Given §2.10 problem report 번들을 생성할 때
  When 번들 내용을 검사하면
  Then doctor 결과·diagnostics·redacted logTail 을 포함하되
       capture 텍스트·preview·currentWorkSummary·startup token·미-redact cmdline 은 포함하지 않으며,
       번들은 자동 전송되지 않고 사용자가 명시적으로 공유한다([[08-Decisions|D-003]]).
```

```text
SPEC-600-AC-16 (R-OBS-001, R-CTRL-007, [[08-Decisions|D-028]])  [frame-role split]
  Given 한 control action이 실행될 때
  When 그 결과 전달 경로를 관측하면
  Then 행위 client의 즉시 결과는 [[SPEC-400-control-actions]] §2.2 동기 HTTP 응답(ControlResult)으로 반환되고,
       내구 rail 항목은 control.result ActivityEvent 가 activity WS frame([[SPEC-102-realtime-sync]] §2.3)으로 전달되며,
       rail에는 그 control action당 control.result event가 정확히 1건만 생기고(중복 없음),
       control_result frame은 optional/forward이므로 그것이 없어도 rail·actor 결과가 모두 성립한다.
```

```text
SPEC-600-AC-17 (R-CTRL-009 부수, [[08-Decisions|D-043]])  [passthrough audit — 집계·비원문]
  Given interactive passthrough arm-session이 여러 keystroke를 전송한 뒤 disarm/close될 때
  When 그 audit 산출을 관측하면
  Then type='control.passthrough_session' ActivityEvent가 arm-session당 정확히 1건 적재되고(per-keystroke event 없음),
       detail은 집계 스칼라(keystrokeCount·durationMs·execFailures·inputRedactedFlag, optional 기본-off keyHistogram)만 담으며,
       어떤 필드에도 keystroke 원문·literal text·전송 key 시퀀스·token이 직렬화되지 않는다(§2.7 금지 확장).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-OBS-001 | ActivityEvent 모델 + 5 taxonomy(scanner/status/control/tmux/reconnect) + canonical control.result 매핑(§2.2.1, [[08-Decisions\|D-028]]) + frame-role split(§2.4) + bound ring buffer + activity WS frame·bootstrap tail | SPEC-600-AC-01, AC-02, AC-03, AC-04, AC-13, AC-16 |
| R-OBS-002 | debug log JSON Lines(오류 + timing) + level/debug mode + rotation/size bound + correlation | SPEC-600-AC-05, AC-09, AC-12 |
| R-OBS-003 | metadata-only 계약(§2.7) + redaction-before-write(redact() 재사용, [[08-Decisions\|D-016]]) + capture 텍스트 미기록 이중 방어 | SPEC-600-AC-06, AC-07, AC-08, AC-14 |
| R-OBS-004 | doctor log.path detail = 해석된 절대 경로·writable·size·level·rotation(위치 discoverability) | SPEC-600-AC-10 |
| 관측성 비기능 | doctor diagnostics block(environment·recentErrors code 집계) + problem report 번들 = terminal 원문 없이 triage | SPEC-600-AC-11, AC-15 |
| R-CTRL-009 (부수; 1차 [[SPEC-401-interactive-input]]) | `control.passthrough_session` taxonomy·집계-only ActivityDetail 필드·비원문 불변식(2026-07-02 개정, [[08-Decisions|D-043]]) | SPEC-600-AC-17 |

> 부수/공동 충족(1차 소유는 타 spec): **R-CTRL-007**(control 결과 audit — 1차 [[SPEC-400-control-actions]]; 본 spec은 canonical `control.result` 적재 모델·target/detail 매핑(§2.2.1)·frame-role split([[08-Decisions\|D-028]]), AC-02/AC-16), **R-API-005**(API error 분리 — 1차 [[SPEC-101-snapshot-api]]; 본 spec은 debug log 목적지·correlation, AC-12), **R-PRIV-005**(원문 비저장 — 1차 [[SPEC-006-privacy-redaction]]; 본 spec은 log 계약, AC-06/AC-07), **R-CLI-005**(doctor check — 1차 [[SPEC-100-server-lifecycle]]; 본 spec은 log.path detail, AC-10), **R-SEC-002**(token 비영속 — 1차 [[SPEC-100-server-lifecycle]]; 본 spec은 log 비노출, AC-14), **R-API-002**(reconnect — 1차 [[SPEC-102-realtime-sync]]; 본 spec은 connection event, AC-13). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — activity bootstrap tail 배치**: 본 spec(§2.4)은 activity tail 항목 shape(`ActivityEvent`)와 개수(`ACTIVITY_BOOTSTRAP_TAIL`)를 소유하나, **어디로 전달하는가**(snapshot 필드 `recentActivity` vs 전용 read endpoint)는 [[SPEC-101-snapshot-api]] snapshot 직렬화와 정합해야 한다. 제안: snapshot 부트스트랩에 `recentActivity` tail을 포함(shape는 본 spec, 필드 배치는 SPEC-101). SPEC-101 작성/갱신 시 확정 필요.
- **C2 — log level·report flag CLI surface**: `--debug`/`ORC_CAMP_LOG_LEVEL`(§2.6)와 problem report 생성 flag(`doctor --report`, §2.10)는 [[SPEC-100-server-lifecycle]] §2.3 doctor·공통 flag 집합을 확장한다. 본 spec은 **내용·invariant**를 소유하고 정확한 flag/env 이름은 SPEC-100과 조정해 확정한다.
- **C3 — doctor JSON에 diagnostics block 추가**: §2.9 (B) `DoctorDiagnostics`를 [[SPEC-100-server-lifecycle]] doctor `--json` envelope(`{checks, summary, ok}`)에 sibling으로 싣는다. SPEC-100이 envelope를 소유하므로 추가 위치·키 이름(`diagnostics`)을 그 spec과 정합한다. exit code에는 영향 없음(§3.4).
- **C4 — environment 값 소유**: §2.9 `environment.appVersion`/`tmuxVersion` 등은 [[SPEC-700-packaging-release]](version·smoke) / [[SPEC-100-server-lifecycle]](`tmux -V`)와 값 출처가 겹친다. 본 spec은 그 값을 **재사용·표기**만 하며 1차 산출은 해당 spec에 위임한다.
- **C5 — control audit envelope 정합 (해소, [[08-Decisions|D-028]], Seam H)**: 과거 [[SPEC-400-control-actions]]는 flat `ControlAuditEvent{type:'control_action', …}`를, 본 spec은 `ActivityEvent{type:'control.result', target{}, detail{}, seq, source, code, message}`를 정의해 `type` token·구조가 충돌했고, [[SPEC-102-realtime-sync]] §2.3은 `control_result`/`activity` frame을 역할 미정으로 분리 카탈로그했다. **해소**: canonical = 본 spec `ActivityEvent(type='control.result')`. SPEC-400 §2.8이 control action을 본 spec `target`(orcId/paneId/tmuxTarget)·`detail`(action/controlOutcome/outcome/reason/keyName/inputByteLength/inputRedactedFlag/exitCode/durationMs/correlationId)로 매핑한다(§2.2.1). frame-role: actor 결과 = 동기 HTTP 응답, rail = `activity` frame(§2.4), `control_result` frame = optional/forward([[SPEC-102-realtime-sync]] §2.3). 세 spec 정합 확인 완료.

### Open Questions (검토 필요 / PoC·정합 대상)

- **Q1 — 임계값 확정**: `ACTIVITY_CAPACITY=500`·`ACTIVITY_BOOTSTRAP_TAIL=50`·`LOG_MAX_BYTES=5MiB`·`LOG_KEEP_FILES=3`·`DEFAULT_LOG_LEVEL=info`는 전부 §3.5 가설이다. [[SPEC-007-test-validation]] 측정·운영 관찰로 확정. **검토 필요.**
- **Q2 — client 합성 event의 store 위치**: `connection.disconnected/reconnected`(source='client')를 서버 activity와 같은 rail store에 병합할지, 별도 connection-state 채널로 둘지는 [[SPEC-200-frontend-architecture]]/[[SPEC-201-dashboard-screens]] 정합 대상이다. 본 spec은 모델·출처 분리만 고정. **검토 필요.**
- **Q3 — activity `code` 공개 계약 범위**: `ActivityType`/`code` 집합을 어디까지 안정 공개 계약으로 고정할지(UI 필터·테스트 의존). 변경 프로토콜은 [[SPEC-006-privacy-redaction]] class 토큰 안정성 규칙과 동형으로 둔다. **검토 필요.**
- **Q4 — recentErrors 윈도 비용**: doctor diagnostics의 `recentErrors`(§2.9 B)는 debug log 최근 윈도를 읽어 집계한다. 대용량 rotated 파일에서 읽기 비용·경계(활성 파일만 vs rotated 포함)를 확정 필요. **검토 필요.**
- **Q5 — P1 SQLite 영속 연계**: `R-P1-006`(event history SQLite opt-in)이 도입되면 ring buffer(휘발)와 영속 event history의 관계·retention을 정의해야 한다. MVP는 memory-only이므로 비-blocker이나 forward pre-flag. **검토 필요.**
