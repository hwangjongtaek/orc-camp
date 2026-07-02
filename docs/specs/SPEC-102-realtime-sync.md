---
spec: SPEC-102
title: Realtime sync (WebSocket event·reconnect)
status: approved
updated: 2026-07-02
requirements: [R-API-001, R-API-002, R-API-003]
decisions: [D-003, D-005, D-041]
tags:
  - specs
  - realtime
  - websocket
  - backend
  - epic-2
---

# SPEC-102 — Realtime sync (WebSocket event·reconnect)

Orc Camp dashboard는 [[SPEC-101-snapshot-api]]가 제공하는 **REST snapshot으로 초기 상태**를 채우고, 그 이후 변경은 **WebSocket event(delta)**로 받는다([[08-Decisions|D-005]], [[02-Requirements]] R-API-001). 본 spec은 그 **realtime event 계약과 복구 모델의 단일 진실 공급원(SSOT)**이다:

- WS **event envelope**(공통 봉투), **event type 카탈로그**, payload 형태와 출처.
- 각 event가 실어 나르는 **snapshot `version`(sequence id)**의 의미·전파·**ordering·idempotency**(R-API-003).
- **초기 상태 + delta 재조립(reconcile) 프로토콜**: REST snapshot과 WS delta를 client가 어떻게 합쳐 일관된 상태를 만드는가(R-API-001).
- **연결 끊김·복구(reconnect & recovery) 프로토콜**: WS drop 시 `disconnected` 신호, version gap 처리, 전체 re-snapshot vs replay, `stale`과 `disconnected`의 구분(R-API-002, R-UI-005 신호 부분).

> **소유 경계**: 본 spec은 **WS event 전송 계약·재조립·복구 프로토콜**을 소유한다. **snapshot의 형태·`version` 생성 규칙**은 [[SPEC-101-snapshot-api]], **event payload가 싣는 field 스키마**(orc/camp/status enum 등)는 [[SPEC-005-data-contract]], **server 수명주기·startup token 값/검증**은 [[SPEC-100-server-lifecycle]], **disconnected/stale banner의 화면 렌더링**은 [[SPEC-201-dashboard-screens]], **control_result event의 payload·의미**는 [[SPEC-400-control-actions]]가 소유한다. 본 spec은 이들을 참조만 한다.

> **불변식(확정)**: ① 모든 state-diff event는 정수 `version`(snapshot sequence)을 싣는다(R-API-003). ② event는 **convergent**(델타 증분이 아니라 entity id로 키된 결과값)이므로 재적용해도 상태가 수렴한다. ③ 재조립의 권위 키는 `version`이다. snapshot은 완전한 base이고, client는 `version > snapshot.version`인 event만 적용한다. ④ 복구의 정상 경로(MVP)는 **WS reconnect + REST 전체 re-snapshot**이다(replay는 선택적 최적화). ⑤ WS 연결은 [[SPEC-100-server-lifecycle]]의 startup token을 요구한다(R-SEC-003 정합).

> **2026-07-02 개정([[18-Terminal-Workspace]] Terminal Workspace, [[08-Decisions|D-041]])**: 본 spec의 `WsFrameType` **카탈로그를 확장**해, [[SPEC-103-pane-live-stream]]가 소유하는 **live pane view 채널**의 프레임 타입을 등록한다 — server→client `pane_view_seed`/`pane_view`/`pane_view_end`, client→server `view.attach`/`view.detach`(§2.3). live view는 **동일 WS `/api/events` 위의 별도 논리 채널**이다: 그 프레임은 **`WsEnvelope.version = null`**이고 순서는 스냅샷 `version`이 아니라 **per-attach `viewSeq`**로 판정하며, **재조립(§3.1)/gap 감지(§3.5)/resync/replay 대상이 아니다**(별도 채널 — 의미·폴링·부하·redaction·exposure gate는 [[SPEC-103-pane-live-stream]]가 소유하고 본 spec은 봉투·카탈로그 등록만 한다). 기존 스냅샷 diff 채널의 모든 불변식·AC는 그대로 유지된다. 근거 결정 [[08-Decisions|D-041]]는 **2026-07-02 Accepted 승인**되어 본 spec은 `approved`다(구현 착수 가능).

## 1. Scope

### In scope

- WS endpoint(`/api/events`) 연결·handshake·auth 표면(token 제시 방식, origin 검사, close code) — token 값/검증 규칙 자체는 [[SPEC-100-server-lifecycle]].
- 공통 **event envelope**(`type`/`seq`/`version`/`emittedAt`/`payload`)와 protocol 협상 frame(`welcome`).
- **event type 카탈로그**: lifecycle(`welcome`/`server_heartbeat`/`server_stale_changed`), state diff(`camp_added`/`camp_removed`/`camp_updated`/`orc_added`/`orc_updated`/`orc_status_changed`/`orc_removed`), 전달 wrapper(`batch`), cross-spec 탑승(`control_result`/`activity`).
- **version/sequence 모델**: event가 싣는 `version`의 의미, batch당 1 증가, ordering·idempotency·gap 정의(R-API-003).
- **초기 동기화 재조립 프로토콜**(R-API-001): snapshot base + delta 적용, snapshot↔WS-open race 해소.
- **reconnect & recovery 프로토콜**(R-API-002): `disconnected` 진입·backoff·재연결, 전체 re-snapshot 복구, version-gap → resync, server 재시작(epoch 변경) 감지.
- **`stale`(연결됨, last-good 데이터) vs `disconnected`(전송 끊김) 신호의 구분**(R-UI-005 신호 — 렌더링은 [[SPEC-201-dashboard-screens]]).
- heartbeat/liveness, batching/backpressure 같은 전송 신뢰성·성능 규칙.
- **live pane view 채널 프레임의 카탈로그 등록·봉투 전송**(`pane_view_seed`/`pane_view`/`pane_view_end`·`view.attach`/`view.detach`): 같은 WS 위의 별도 채널로 `WsEnvelope`에 실어 전송하고 `version:null`·`viewSeq` 규약을 명시한다(§2.3). **payload shape·폴링·부하·redaction·exposure gate 의미는 [[SPEC-103-pane-live-stream]] 소유**(본 spec은 전송·등록만).

### Out of scope (다른 spec으로)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| REST snapshot의 shape·필드·`GET /api/snapshot` 계약, `version` **생성** 규칙, manual refresh(R-API-004) | snapshot runtime | [[SPEC-101-snapshot-api]] |
| event payload가 싣는 orc/camp/status **field 스키마**(enum, nullability, identity) | 데이터 계약 | [[SPEC-005-data-contract]] |
| startup token **값/생성/검증**, server bind/CORS origin 정책, 종료 시 token 폐기(R-CLI-007), port | server 수명주기·보안 경계 | [[SPEC-100-server-lifecycle]] |
| `disconnected`/`stale`/`reconnecting` **banner·badge의 화면 렌더링**과 카피 | dashboard 상태 화면 | [[SPEC-201-dashboard-screens]] |
| `control_result` event의 **payload·의미·optimistic update** | control 액션 | [[SPEC-400-control-actions]] |
| `activity` event의 payload·activity log(R-OBS-001) | observability | [[SPEC-600-observability]] |
| tmux 구조 변화(session/window/pane 생성·삭제·rename, R-TMUX-003)의 **탐지/diff 산출** | scanner·diff engine | [[SPEC-101-snapshot-api]] (본 spec은 그 결과의 **event 전송**만 소유) |
| **live pane view 채널의 프레임 payload·attach/detach 프로토콜·폴링/부하 정책·seed/cursor·redaction·exposure gate** | live view 스트림 계약(별도 채널) | [[SPEC-103-pane-live-stream]] (본 spec은 프레임 타입 카탈로그 등록·봉투 전송만) |

## 2. Contract

### 2.1 연결·handshake·auth

- **Endpoint**: `WS /api/events` (동일 origin local server, [[04-Frontend]] API 계약과 정합). MVP는 `127.0.0.1` 바인딩 단일 local client를 가정한다(local-first, [[08-Decisions|D-003]]).
- **Auth(R-SEC-003 정합, 값은 [[SPEC-100-server-lifecycle]] 소유)**: WS handshake는 startup token을 요구한다. 브라우저 WebSocket은 커스텀 헤더를 못 붙이므로 token은 다음 중 하나로 제시한다(확정: 둘 다 허용):
  - query string: `GET /api/events?token=<token>`
  - `Sec-WebSocket-Protocol: orc-camp.v1, token.<token>` subprotocol 토큰.
  token 검증 실패 시 handshake를 거부하고 close code `4401`로 닫는다. token이 URL에 노출되는 누출 risk는 [[SPEC-100-server-lifecycle]]/[[SPEC-006-privacy-redaction]](debug log redaction)의 책임이며, 본 spec은 token을 frame payload·`activity` event에 직렬화하지 않는다.
- **Origin 검사(R-SEC-005 정합, 정책은 [[SPEC-100-server-lifecycle]] 소유)**: 허용되지 않은 `Origin`은 close code `4403`으로 거부한다.
- **Close code(확정 표면)**:

  | code | 의미 | client 동작 |
  | --- | --- | --- |
  | `1000` | 정상 종료 | reconnect 안 함 |
  | `1001` | server going away(종료/shutdown, R-CLI-007 정합) | `disconnected` 표시, reconnect 시도(보통 실패 → token 폐기) |
  | `1011` | server 내부 오류 | backoff reconnect |
  | `4401` | token 없음/무효 | reconnect 중단, 사용자에게 재실행/URL 재확인 안내(렌더링 SPEC-201) |
  | `4403` | origin 거부 | reconnect 중단 |
  | `4408` | protocol version 미지원 | reconnect 중단, upgrade 안내 |
  | `4429` | backpressure/연결 과다 → resync 요구 | 전체 re-snapshot 후 재연결(§3.6) |

- 연결 직후 server는 **반드시 `welcome` frame을 가장 먼저** 보낸다(§2.6). client는 `welcome` 수신 전에는 동기화 시작으로 보지 않는다.

### 2.2 Event envelope (공통 봉투)

직렬화 키는 camelCase, JSON text frame이다. envelope는 모든 server→client frame의 공통 봉투다.

```ts
type WsFrameType =
  // lifecycle (server→client, 비-diff)
  | 'welcome' | 'server_heartbeat' | 'server_stale_changed'
  // state diff (server→client)
  | 'camp_added' | 'camp_removed' | 'camp_updated'
  | 'orc_added' | 'orc_updated' | 'orc_status_changed' | 'orc_removed'
  // 전달 wrapper
  | 'batch'
  // cross-spec 탑승 (payload 소유는 타 spec)
  | 'control_result'        // [[SPEC-400-control-actions]]
  | 'activity'              // [[SPEC-600-observability]]
  // live pane view 채널 (server→client, version:null·viewSeq 순서 — [[SPEC-103-pane-live-stream]] 소유)
  | 'pane_view_seed' | 'pane_view' | 'pane_view_end'
  // client→server (optional)
  | 'client_hello' | 'pong'
  // client→server live view 제어 (payload·의미 [[SPEC-103-pane-live-stream]] 소유)
  | 'view.attach' | 'view.detach';

interface WsEnvelope<P = unknown> {
  type: WsFrameType;
  seq: number;              // per-connection frame counter. welcome=0, 이후 +1. 연결마다 리셋.
  version: number | null;   // snapshot sequence (R-API-003). state event/lifecycle는 정수, client→server는 null
  emittedAt: string;        // ISO 8601 server time
  payload: P;
}
```

- `seq`: **연결 단위** 단조 증가(+1) frame 카운터. TCP in-order 위에서 frame 누락(드물게 server 측 drop)을 감지하는 **transport sanity·중복 제거** 보조키다. 연결이 바뀌면 0부터 다시 시작하며, **재조립의 권위 키가 아니다**.
  - **live view frame 예외(확정, 2026-07-02 리뷰 반영, [[08-Decisions|D-041]])**: `seq`는 **state/lifecycle frame에만** 부여되는 sequence다. live view frame(`version:null`: `pane_view_seed`/`pane_view`/`pane_view_end`)은 **이 연결 seq sequence에 참여하지 않는다** — 고빈도(250–500ms)·유실 허용 채널이므로 seq를 소비/증가시키지 않고, envelope의 `seq`는 **직전 state seq를 반복(비증가)해** 싣는다. client는 §3.5-2 seq-gap 검사에서 live view frame을 **제외**한다(frame type 필터 후 검사). 따라서 `pane_view` 유실/coalesce는 state 채널 re-snapshot resync를 **트리거하지 않으며**, live view 복구는 viewSeq-gap → 재-attach로만 한다([[SPEC-103-pane-live-stream]] §2.4).
- `version`: **snapshot sequence(R-API-003)**. state-diff event는 그 변경이 적용된 **이후 상태의 snapshot version**을 싣는다. lifecycle frame은 emit 시점의 **현재 snapshot version**을 싣는다. `version`의 **생성·증가 규칙**은 [[SPEC-101-snapshot-api]]가 소유하며 본 spec은 그 값을 전파·참조한다(§2.4).
- `emittedAt`은 server 기준 시각이다. client 시계와 무관하게 ordering은 `version`/`seq`로 판단한다.

### 2.3 Event type 카탈로그

| type | 방향 | `version` | payload 요약 | 소유/참조 |
| --- | --- | --- | --- | --- |
| `welcome` | S→C | 현재 | protocol·현재 version·stale·heartbeat 주기·runtime epoch | 본 spec §2.6 |
| `server_heartbeat` | S→C | 현재 | `{ version, stale }` liveness | 본 spec §3.7 |
| `server_stale_changed` | S→C | 현재 | `{ stale, lastGoodAt, version }` | 본 spec §3.4 |
| `camp_added` | S→C | 결과 | 완전한 `Camp`(orcs 포함) | payload shape [[SPEC-005-data-contract]] |
| `camp_removed` | S→C | 결과 | `{ campId }` | 본 spec |
| `camp_updated` | S→C | 결과 | `campId` + 변경된 camp 필드(부분) | 필드 [[SPEC-005-data-contract]] |
| `orc_added` | S→C | 결과 | `{ campId }` + 완전한 `Orc` | payload shape [[SPEC-005-data-contract]] |
| `orc_status_changed` | S→C | 결과 | `campId`/`orcId` + status 축 필드 | 필드 [[SPEC-005-data-contract]], 추론 [[SPEC-004-status-inference]] |
| `orc_updated` | S→C | 결과 | `campId`/`orcId` + 비-status 필드(부분) | 필드 [[SPEC-005-data-contract]] |
| `orc_removed` | S→C | 결과 | `{ campId, orcId, reason }` | 본 spec, retention 시점 [[SPEC-004-status-inference]] |
| `batch` | S→C | 결과 | 한 scan tick diff의 묶음(§2.5) | 본 spec |
| `control_result` | S→C | 현재 | control 액션 결과 | payload [[SPEC-400-control-actions]] |
| `activity` | S→C | 현재 | activity log 항목 | payload [[SPEC-600-observability]] |
| `client_hello` | C→S | null | `{ lastVersion, runtimeEpoch }`(replay 최적화용, optional) | 본 spec §3.3 |
| `pong` | C→S | null | heartbeat 응답(optional) | 본 spec §3.7 |
| `pane_view_seed` | S→C | **null** | attach 직후 1회. `{orcId, cols, rows, cursor, lines(redacted seed), capturedAt, redacted, byteClamped, viewSeq:0}` | payload·의미 [[SPEC-103-pane-live-stream]] §2.3 |
| `pane_view` | S→C | **null** | 폴링 tick. `{orcId, cols, rows, cursor, lines(redacted), capturedAt, redacted, byteClamped, viewSeq}` | payload·의미 [[SPEC-103-pane-live-stream]] §2.3 |
| `pane_view_end` | S→C | **null** | 스트림 종료. `{orcId, reason: detached\|pane_gone\|exposure_off\|tab_hidden\|superseded\|error}` | payload·의미 [[SPEC-103-pane-live-stream]] §2.3 |
| `view.attach` | C→S | null | `{orcId}` live view 시작 요청 | payload·의미 [[SPEC-103-pane-live-stream]] §2.2 |
| `view.detach` | C→S | null | `{orcId}` live view 중단 요청 | payload·의미 [[SPEC-103-pane-live-stream]] §2.2 |

> **live pane view 채널(별도 채널, [[08-Decisions|D-041]])**: `pane_view_seed`/`pane_view`/`pane_view_end`와 `view.attach`/`view.detach`는 [[SPEC-103-pane-live-stream]]가 소유하는 **live view 채널**의 프레임이다. 본 spec은 이들을 `WsEnvelope`로 감싸 **전송**할 뿐 payload shape·폴링·부하·redaction·exposure gate를 정의하지 않는다. 이 프레임의 `WsEnvelope.version`은 **항상 `null`**이며(스냅샷 sequence 아님), 순서·중복 판정은 payload의 **`viewSeq`**(per-attach 단조 증가, seed=0)로 한다. 따라서 이 프레임은 §2.4 version 모델, §3.1 재조립, §3.5 gap→resync, §3.3 replay **어느 것의 대상도 아니다**(별도 채널이므로 스냅샷 store·`Vlast`에 영향 없음). **`WsEnvelope.seq` 예외(2026-07-02 리뷰 반영)**: live view frame은 연결 `seq` sequence에 **참여하지 않는다** — seq를 증가시키지 않고 직전 state seq를 반복(비증가)해 실으며, client는 §3.5-2 seq-gap 검사에서 이들을 **type 필터로 제외**한다. 즉 고빈도 `pane_view` 유실/coalesce가 state 채널 re-snapshot resync를 트리거하지 않는다(§2.2 seq 정의, [[SPEC-103-pane-live-stream]] §2.4).

#### 2.3.1 state-diff payload (convergent partial)

state-diff event는 **entity id로 키된 결과값**을 싣는다. 부분 갱신 event(`camp_updated`/`orc_updated`/`orc_status_changed`)는 **변경된 필드만** 포함하되 각 필드는 **델타가 아니라 새 전체 값**이다. client는 id 기준 merge로 적용한다(idempotent). nested 타입(`OrcStatus`, `StatusSummary`, `StatusSignal`, `SummarySource` 등)의 정의·enum·nullability는 [[SPEC-005-data-contract]]를 따른다.

```ts
// identity는 [[SPEC-005-data-contract]] / [[08-Decisions|D-017]]:
//   campId = "session:" + sessionId, orcId = "pane:" + paneId
interface OrcStatusChangedPayload {
  campId: string;
  orcId: string;
  status: OrcStatus;                 // [[SPEC-005-data-contract]] 7종
  statusConfidence: number;          // [0,1] — status와 항상 동반 (R-ORC-005)
  statusSignals?: StatusSignal[];    // redaction-safe provenance (SPEC-005 §3.5)
  currentWorkSummary: string | null;
  summarySource: SummarySource;
  summaryIsEstimated: boolean;
  lastActivityAt: string;            // ISO 8601
}

interface OrcUpdatedPayload {         // 비-status 축 변경(예: cwd/command/tmuxTarget reindex/summary-only)
  campId: string;
  orcId: string;
  cwd?: string;                      // redaction 적용값 (SPEC-006)
  command?: string;
  tmuxTarget?: string;               // 표시 전용 reindex (paneId 권위 — D-017)
  currentWorkSummary?: string | null;
  summarySource?: SummarySource;
  summaryIsEstimated?: boolean;
}

interface CampUpdatedPayload {        // rename + window/pane count + rollup
  campId: string;
  tmuxSessionName?: string;          // rename(표시 전용)
  windowCount?: number;
  paneCount?: number;
  statusSummary?: StatusSummary;
  lastActivityAt?: string | null;
}

interface OrcRemovedPayload {
  campId: string;
  orcId: string;
  reason: 'pane_closed' | 'no_longer_candidate' | 'session_gone' | 'retention_expired';
}
```

- **R-ORC-006 정합**: pane이 사라져도 orc를 즉시 `orc_removed`하지 않는다. 먼저 `orc_status_changed`(status=`terminated`/`stale`)로 짧게 남기고, retention 만료 후에야 `orc_removed`(reason=`retention_expired`)를 보낸다. retention 시점·status 판정은 [[SPEC-004-status-inference]] §3.7 소유.
- `camp_added`/`orc_added` payload는 각각 완전한 `Camp`/`Orc` 객체([[SPEC-005-data-contract]] §2.6)다 — 새 entity는 한 번에 완전한 상태로 도착한다.

### 2.4 version/sequence 모델 (R-API-003)

- snapshot runtime은 **단조 증가 정수 `version`**(snapshot sequence)을 유지한다. 생성 규칙은 [[SPEC-101-snapshot-api]] 소유다. 본 spec이 의존하는 **계약(확정)**:
  1. scanner의 한 tick이 만든 diff가 **≥1 변경**을 포함하면 `version`은 **정확히 +1** 증가해 새 commit 상태가 된다(변경 없는 tick은 version을 올리지 않는다).
  2. `GET /api/snapshot`의 `version`은 **commit 경계의 일관된 상태**를 가리킨다(batch 중간의 partial 상태를 직렬화하지 않는다). — 본 spec이 [[SPEC-101-snapshot-api]]에 요구하는 불변식(§6 D1).
- 한 tick(version `N`)에서 나온 모든 state-diff event는 **동일한 `version = N`**을 싣고, **하나의 `batch` frame**으로 전달함을 원칙으로 한다(§2.5). 즉 `version`은 batch당 +1이다.
- **ordering 규칙**: 한 연결 안에서 state event의 `version`은 **non-decreasing**(같은 batch는 같은 version, 다음 batch는 +1)이다. `seq`는 frame마다 strict +1이다.
- **gap 정의(확정)**: client의 적용 완료 version을 `Vlast`라 할 때, 들어온 event의 `version`이
  - `≤ Vlast` → 이미 반영됨 → **drop**(idempotent no-op).
  - `== Vlast + 1` → 정상 다음 batch → 적용.
  - `> Vlast + 1` → **gap**(중간 batch 유실) → 적용하지 않고 **resync**(§3.5).
- **runtime epoch**: server 재시작 시 `version` 카운터와 `sessionId`(SPEC-005 Q4)는 재할당될 수 있다. `welcome.runtimeEpoch`(server runtime instance 식별자)가 client가 보유한 epoch과 다르면 version 비교는 무의미하므로 client는 **무조건 전체 re-snapshot**으로 baseline을 리셋한다(§3.3).

### 2.5 batch frame (성능·원자성)

scanner는 interval polling으로 한 tick의 diff를 만든다([[05-Backend]], [[SPEC-101-snapshot-api]]). rapid polling이 render storm을 만들지 않도록([[04-Frontend]] 성능 전략) **한 tick의 모든 diff event를 하나의 `batch`로 묶어** 전달하고, client는 **batch 단위로 원자 적용 후 1회 render**한다.

```ts
interface BatchPayload {
  version: number;          // 이 batch 적용 후의 snapshot version
  changes: DiffEvent[];     // 같은 tick의 diff event들(순서 보존)
}
interface DiffEvent { type: Extract<WsFrameType,
  'camp_added'|'camp_removed'|'camp_updated'|
  'orc_added'|'orc_updated'|'orc_status_changed'|'orc_removed'>;
  payload: unknown; }       // payload shape는 §2.3.1
```

- 변경이 1건이어도 server는 `batch`로 보낼 수 있다(client는 단일 event와 동일하게 처리). 단건을 batch 없이 직접 보내는 것도 허용하되, 그 단건 event의 `version`은 동일 규칙을 따른다.
- batch 내 `changes`는 **부분 적용 금지**다: client는 batch 전체를 적용하거나(성공) 적용을 보류하고 resync한다. 중간까지만 적용하지 않는다.

### 2.6 lifecycle frame

```ts
interface WelcomePayload {
  protocolVersion: 1;        // WS envelope/protocol 버전(미지원 시 client는 4408 처리)
  version: number;           // 연결 시점의 현재 snapshot version
  stale: boolean;            // 현재 scanner staleness (SPEC-005)
  lastGoodAt: string | null;
  heartbeatIntervalMs: number; // server→client heartbeat 주기(§3.7)
  runtimeEpoch: string;      // server runtime instance 식별자(재시작 감지, §2.4)
  serverStartedAt: string;   // ISO 8601(진단용)
}
interface HeartbeatPayload   { version: number; stale: boolean; }
interface StaleChangedPayload{ stale: boolean; lastGoodAt: string | null; version: number; }
```

## 3. Behavior rules

확정 규칙과 상류 의존(가설은 상류 소유)을 구분한다. 임계값(heartbeat 주기·backoff·replay 버퍼 깊이)은 기본적으로 **PoC 검증 가설**이며 [[SPEC-007-test-validation]] 측정으로 보정한다.

### 3.1 초기 동기화 재조립 (확정, R-API-001)

snapshot(완전 base)과 WS delta를 합쳐 일관 상태를 만든다. snapshot 읽기와 WS 구독 사이의 race를 없애기 위해 **WS를 먼저 열어 event를 버퍼링한 뒤 snapshot에 base를 두는 순서**를 정규(normative)로 한다:

1. client는 WS `/api/events`를 연결하고 `welcome`을 받는다.
2. 들어오는 state event를 **버퍼에만 쌓고 아직 적용하지 않는다**.
3. client는 `GET /api/snapshot`을 호출해 `version = Vs`의 완전한 base 상태를 받는다([[SPEC-101-snapshot-api]]).
4. client는 snapshot을 base 상태로 적용하고 `Vlast = Vs`로 둔다.
5. 버퍼·이후 event 중 `version ≤ Vs`는 **drop**(이미 base에 반영)하고, `version > Vs`인 것을 §2.4 ordering으로 적용한다.
6. snapshot이 완전 base이므로 `Vs` 이후 event를 빠짐없이 순서대로 적용하면 상태가 수렴한다. (WS를 먼저 열었으므로 `Vs` 이후 어떤 batch도 버퍼에 존재한다 — 유실 없음.)

- 이후 단계 흐름은 [[04-Frontend]] 데이터 흐름(snapshot → WS 구독 → store 갱신)과 정합한다. UI는 manual refresh 없이 갱신된다(R-API-001; manual refresh 자체는 R-API-004 → [[SPEC-101-snapshot-api]]).

### 3.2 ordering & idempotency (확정, R-API-003)

1. 재조립 권위 키는 `version`이다. event는 convergent(결과값)이므로 **같은 event를 두 번 적용해도** 동일 상태로 수렴한다.
2. `version ≤ Vlast` event는 drop한다(중복/지연 안전).
3. `seq`는 연결 내 frame 누락·중복을 감지하는 보조키다. `seq`가 비연속(서버 측 frame drop)이면 client는 안전하게 resync(§3.5)한다. **단 seq 연속성 검사는 state/lifecycle frame에만 적용하고 live view frame(`version:null`)은 제외한다**(§2.2, §2.3 — live view는 별도 채널로 seq sequence에 참여하지 않음).
4. 부분 갱신 event는 entity id(`campId`/`orcId`, [[08-Decisions|D-017]])로 merge한다. 알 수 없는 id에 대한 `*_updated`/`*_status_changed`/`*_removed`는 상태 불일치 신호이므로 resync 한다(보수적).

### 3.3 reconnect & recovery (확정, R-API-002)

WS 연결이 끊기면:

1. client는 즉시 **`disconnected` 신호**로 전환한다(close 이벤트 또는 §3.7 heartbeat 미수신). 화면에 보이던 상태는 유지하되 "신뢰 불가/지연 가능"으로 표시한다(렌더링 [[SPEC-201-dashboard-screens]], R-UI-005).
2. **backoff 재연결**: exponential backoff + jitter로 재시도한다. 기본값 초기 0.5s → 최대 10s, jitter ±20%는 **PoC 검증 가설**이다.
3. 재연결되면 `welcome { version: Vw', runtimeEpoch }`을 받는다.
4. **복구 경로 결정**:
   - `runtimeEpoch`이 보유 epoch과 다르면(server 재시작) → 무조건 (a) 전체 re-snapshot.
   - 그 외:
     - **(a) 전체 re-snapshot — MVP 정규 경로(필수)**: `GET /api/snapshot`으로 base를 다시 받아(§3.1 재조립) `Vlast`를 재설정하고 live delta를 재개한다. 항상 정답이며 단순하다.
     - **(b) replay — 선택적 최적화(forward, 검토 필요)**: client가 `client_hello { lastVersion: Vlast, runtimeEpoch }`을 보내고, server의 event ring buffer([[05-Backend]] memory ring buffer)가 `Vlast+1..Vw'`를 모두 보유하면 server가 그 구간 event를 replay한 뒤 live로 잇는다. 버퍼가 구간을 다 못 채우면 server는 `4429`(또는 `resync_required` 신호)로 (a)를 요구한다.
5. 복구 후 client는 `disconnected`를 해제하고 정상 delta 스트림으로 복귀한다.

> MVP 수용 기준은 (a)만 요구한다. (b)는 버퍼 깊이·메모리 trade-off가 있어 [[SPEC-007-test-validation]] 측정 뒤 채택을 검토한다(§6 Q2).

### 3.4 `stale` vs `disconnected` 구분 (확정, R-UI-005 신호)

두 상태는 **직교**하며 본 spec이 신호를 명확히 분리한다(화면 표현은 [[SPEC-201-dashboard-screens]]):

| 신호 | 정의 | 출처 | 데이터 | 복구 |
| --- | --- | --- | --- | --- |
| `disconnected` | WS 전송이 끊김(close/heartbeat 미수신) | client 감지 | 마지막으로 받은 상태(점점 낡음) | reconnect + re-snapshot(§3.3) |
| `stale` | WS는 연결됨, 그러나 scanner가 fresh snapshot을 못 만듦(tmux scan 실패) | server `server_stale_changed{stale:true}` | last-good snapshot([[SPEC-005-data-contract]] `stale`/`lastGoodAt`, R-TMUX-005) | scanner 회복 시 server `server_stale_changed{stale:false}` |

- "연결되어 있으나 stale", "끊겼고(따라서 정의상 점점 낡음)"을 client가 동시에 표현할 수 있어야 한다. server는 staleness 전이마다 `server_stale_changed`를 보내고, `welcome`/`server_heartbeat`에도 현재 `stale`을 실어 재진입·idle 상태에서도 일관되게 판단하게 한다.

### 3.5 gap 감지 → resync (확정, R-API-002)

다음 중 하나면 client는 delta 적용을 멈추고 **`GET /api/snapshot` 전체 resync**(§3.1 재조립)를 수행한다:

1. 들어온 state event `version > Vlast + 1`(중간 batch 유실, §2.4).
2. `seq` 비연속(연결 내 frame 유실) — **state/lifecycle frame에 한함**. live view frame(`version:null`: `pane_view_seed`/`pane_view`/`pane_view_end`)은 연결 `seq` sequence에 참여하지 않으므로(§2.2, §2.3) seq-gap 검사 대상이 아니며, live view frame 유실은 **state 채널 resync를 트리거하지 않는다**(live 복구는 viewSeq-gap → 재-attach, [[SPEC-103-pane-live-stream]] §2.4).
3. `runtimeEpoch` 불일치(server 재시작).
4. 알 수 없는 entity id 대상 부분 갱신/삭제(§3.2-4).
5. server가 `4429`/`resync_required`로 backpressure resync를 요구.

resync는 단일 healthy 연결에서는 발생하지 않아야 하며, 주로 backpressure·재시작·구현 버그의 안전망이다.

### 3.6 batching·backpressure·성능 (확정 + 가설)

- 한 scanner tick의 diff는 하나의 `batch`로 합쳐 보내고 client는 batch 단위 1회 render한다(§2.5, render storm 방지 — [[04-Frontend]] 성능 전략, 비기능 "20 session/100 pane" 정합).
- **backpressure**: server는 연결당 무한 버퍼를 두지 않는다. client가 소비를 못 따라오면 server는 (i) 같은 entity의 연속 변경을 최신값으로 coalesce하거나(convergent라 안전), (ii) 임계 초과 시 `4429`로 닫아 client가 전체 re-snapshot으로 따라잡게 한다. 이로써 server 메모리 상한이 보장된다.
- 측정값(batch 크기 상한, coalesce 임계, 100-pane tick의 event 수·render 시간)은 **PoC 검증 가설**이며 [[SPEC-007-test-validation]]가 측정한다.

### 3.7 heartbeat·liveness (확정 + 가설)

- server는 변경이 없어도 `heartbeatIntervalMs`마다 `server_heartbeat { version, stale }`을 보낸다. client는 이를 (i) 연결 생존 확인, (ii) "변경은 없지만 내 `version`이 server 현재 version과 같은가" 동기 확인에 쓴다. heartbeat의 `version`이 `Vlast`보다 크면(놓친 변경) client는 resync한다.
- **half-open 감지**: client가 연속 **2 heartbeat 주기** 동안 어떤 frame도 못 받으면 연결을 `disconnected`로 간주하고 재연결을 시작한다(TCP가 조용히 죽은 경우 대비). 기본 주기 15s, 임계 2회는 **PoC 검증 가설**이다.
- WebSocket 표준 ping/pong control frame을 함께 써도 되며, 애플리케이션 `pong`(C→S)은 선택적이다.

## 4. Acceptance criteria

```text
SPEC-102-AC-01 (R-API-001)
  Given client가 §3.1 순서로 WS를 먼저 열어 event를 버퍼링하고
        GET /api/snapshot 으로 version=Vs base를 받은 뒤
  When version ≤ Vs event는 drop하고 version > Vs event를 순서대로 적용하면
  Then client 최종 상태가 server의 현재 상태와 일치한다(field 단위 동일),
       그리고 이 동기화는 manual refresh 없이 완료된다.
```

```text
SPEC-102-AC-02 (R-API-001)
  Given snapshot으로 초기화된 dashboard에서 어떤 orc의 status가 바뀔 때
  When server가 orc_status_changed(또는 그것을 담은 batch) event를 보내면
  Then client store가 해당 orcId merge로 갱신되어 새 status/statusConfidence가 반영되고,
       전체 재요청(GET /api/snapshot) 없이 UI가 변경을 표시한다.
```

```text
SPEC-102-AC-03 (R-API-003)
  Given 임의의 state-diff event(또는 batch)에 대해
  When envelope를 검사하면
  Then type/seq/version/emittedAt/payload 를 가지며,
       version은 정수≥1이고 한 연결 내에서 non-decreasing이며,
       batch당 정확히 +1 증가하고(같은 batch event는 동일 version),
       그 version은 그 변경을 산출한 diff 이후의 snapshot version과 같다.
```

```text
SPEC-102-AC-04 (R-API-003)
  Given 적용 완료 version이 Vlast인 client에
  When version ≤ Vlast 인 동일/지연 event가 다시 도착하면
  Then 그 event는 drop되어 상태가 변하지 않고(idempotent no-op),
       같은 convergent event를 두 번 적용해도 결과 상태가 동일하다.
```

```text
SPEC-102-AC-05 (R-API-003)
  Given 한 scanner tick이 여러 변경(예: orc 2건 status 변경 + camp_updated)을 만들 때
  When server가 이를 전달하면
  Then 그 변경들은 동일 version N을 공유하고 하나의 batch로 묶여 도착하며,
       client는 batch를 원자적으로(부분 적용 없이) 적용한 뒤 1회 render한다.
```

```text
SPEC-102-AC-06 (R-API-002)
  Given 동기화된 client의 WS 연결이 끊긴(close 또는 heartbeat 미수신) 뒤 재연결될 때
  When client가 GET /api/snapshot 으로 전체 상태를 다시 받고
       version > snapshot.version 인 delta를 재개하면
  Then client 최종 상태가 server 현재 상태와 일치하고,
       복구는 startup token 없는 별도 채널 없이 동일 WS+REST 경로로 이뤄진다.
```

```text
SPEC-102-AC-07 (R-API-002)
  Given WS 연결이 close되거나 연속 2 heartbeat 주기 동안 frame이 없을 때
  When client가 이를 감지하면
  Then client는 disconnected 신호로 전환하고(보이던 상태는 "지연 가능"으로 표시) 
       backoff 재연결을 시작한다(렌더링은 [[SPEC-201-dashboard-screens]]).
```

```text
SPEC-102-AC-08 (R-API-002)  [stale ≠ disconnected — R-UI-005 / R-TMUX-005 정합]
  Given WS는 연결된 채 scanner가 fresh snapshot 산출에 실패해 last-good을 쓰는 상황
  When server가 server_stale_changed{stale:true,lastGoodAt} 를 보내면
  Then client는 stale(연결됨·last-good 데이터)을 disconnected(전송 끊김)와 구분해 표현 가능하고,
       scanner 회복 시 server_stale_changed{stale:false} 로 stale을 해제한다.
```

```text
SPEC-102-AC-09 (R-API-002)
  Given 적용 완료 version Vlast인 client에 version > Vlast+1 인 event가 도착하면(gap)
  When client가 이를 감지하면
  Then 그 event를 순서 외 적용하지 않고 GET /api/snapshot 전체 resync를 수행해
       일관 상태로 회복한다. (seq 비연속·runtimeEpoch 불일치도 동일하게 resync를 트리거한다.)
```

```text
SPEC-102-AC-10 (R-API-002 / R-SEC-003 정합)
  Given startup token([[SPEC-100-server-lifecycle]] 소유)을 요구하는 WS endpoint에서
  When 유효 token 없이 /api/events handshake를 시도하면
  Then 연결이 close code 4401 로 거부되고,
       유효 token이 query 또는 Sec-WebSocket-Protocol 로 제시되면 welcome frame과 함께 수락된다.
```

```text
SPEC-102-AC-11 (R-API-003 / R-TMUX-003 부수 — serve-slice)
  Given tmux session/window/pane 생성·삭제·rename, agent 탐지/종료가 발생할 때
  When server가 diff를 event로 전달하면
  Then camp_added/camp_removed/camp_updated(rename·window/paneCount 포함),
       orc_added/orc_status_changed/orc_updated/orc_removed 가 해당 변화를 반영하며,
       각 event는 version을 싣는다(이로써 dashboard가 구조 변화를 manual refresh 없이 반영).
       (변화의 탐지/diff 산출은 [[SPEC-101-snapshot-api]] 소유.)
```

```text
SPEC-102-AC-12 (R-API-002)
  Given 변경이 없는 idle 연결에서
  When server가 heartbeatIntervalMs 마다 server_heartbeat{version,stale} 를 보내면
  Then client는 heartbeat.version 이 Vlast 보다 크면 resync하고,
       연속 2 주기 동안 frame 미수신 시 연결을 disconnected로 간주해 재연결을 시작한다.
```

```text
SPEC-102-AC-13 (R-API-002 / R-CLI-007 정합)  [server 재시작 감지]
  Given client가 보유한 runtimeEpoch 와 다른 epoch을 가진 server에 재연결될 때
  When welcome.runtimeEpoch 가 보유 값과 다르면
  Then client는 version 비교를 신뢰하지 않고 무조건 전체 re-snapshot으로 baseline을 리셋한 뒤
       delta를 재개한다(이전 runtime의 version/token은 폐기됨 — [[SPEC-100-server-lifecycle]]).
```

```text
SPEC-102-AC-14 (R-API-003 / [[08-Decisions|D-041]])  [live view = 별도 채널, 스냅샷 로직 미적용]
  Given 동일 WS 연결에서 스냅샷 diff event와 live view 프레임
        (pane_view_seed/pane_view/pane_view_end, view.attach/view.detach)이 함께 흐를 때
  When client가 envelope 를 검사·처리하면
  Then live view 프레임은 WsEnvelope.version === null 을 가지며,
       client는 그 프레임에 대해 §2.4 version 비교·§3.1 재조립·§3.5 gap→resync 를 적용하지 않고
       스냅샷 store·Vlast 를 변경하지 않으며(별도 채널),
       live view 순서는 payload.viewSeq(seed=0, 이후 +1)로만 판정한다.
       (스냅샷 diff event의 version 규약과 AC-01~13 은 모두 그대로 유지된다.)
```

```text
SPEC-102-AC-15 (R-API-002 / [[08-Decisions|D-041]])  [live frame 유실 ≠ state resync — seq 예외]
  Given attach 중인 연결에서 고빈도 live view frame(pane_view) 하나가 유실/coalesce 되고
        state/lifecycle frame 의 seq 는 연속인 상황에서
  When client가 seq 연속성을 검사하면
  Then live view frame 은 연결 seq sequence 에 참여하지 않아(§2.2/§2.3) seq-gap 으로 판정되지 않고,
       GET /api/snapshot 전체 re-snapshot resync 가 트리거되지 않으며,
       live view 복구는 viewSeq-gap → 재-attach([[SPEC-103-pane-live-stream]] §2.4)로만 이뤄진다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-API-001 | REST snapshot base + WS delta 재조립 프로토콜(WS-first 버퍼링, version>Vs 적용), manual refresh 없는 갱신 | SPEC-102-AC-01, AC-02 |
| R-API-002 | reconnect+전체 re-snapshot 복구, disconnected 신호, stale≠disconnected, version-gap→resync, heartbeat liveness, runtime-epoch 재시작 감지, live frame 유실의 resync 예외(seq 분리) | SPEC-102-AC-06, AC-07, AC-08, AC-09, AC-10, AC-12, AC-13, AC-15 |
| R-API-003 | event envelope의 `version`(snapshot sequence) 적재·ordering·idempotency·batch당 +1, live view 프레임의 `version:null`·별도 채널 분리 | SPEC-102-AC-03, AC-04, AC-05, AC-11, AC-14 |

> 부수 충족(1차 소유는 타 spec): **R-UI-005**(disconnected/stale 신호 — 렌더링 1차 [[SPEC-201-dashboard-screens]]; 본 spec은 신호 분리, AC-07/AC-08), **R-TMUX-005**(stale/lastGoodAt 의미 1차 [[SPEC-005-data-contract]]/[[SPEC-101-snapshot-api]]; 본 spec은 stale 전이 event, AC-08), **R-TMUX-003**(구조 변화 탐지/diff 1차 [[SPEC-101-snapshot-api]] serve-slice; 본 spec은 event 전송, AC-11), **R-SEC-003**(token 검증 1차 [[SPEC-100-server-lifecycle]]; 본 spec은 WS handshake 거부, AC-10), **R-CLI-007**(token/state 폐기 1차 [[SPEC-100-server-lifecycle]]; 본 spec은 epoch 재시작 처리, AC-13), **R-API-006**(live pane view 채널 1차 [[SPEC-103-pane-live-stream]]; 본 spec은 프레임 타입 카탈로그 등록·봉투 전송·`version:null`/`viewSeq` 분리, [[08-Decisions|D-041]], AC-14). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **D1 — snapshot `version` commit 경계(상류 요구)**: 본 spec의 재조립·gap 모델은 `GET /api/snapshot`의 `version`이 **batch commit 경계의 일관 상태**(partial batch 비직렬화)를 가리킨다고 가정한다(§2.4). [[SPEC-101-snapshot-api]]는 ① 단조 정수 `version`, ② 변경 tick당 +1, ③ snapshot의 atomic-commit 직렬화를 보장해야 한다. SPEC-101 작성 시 이 세 불변식을 명시 확정해야 한다(미확정이면 본 spec gap 모델이 약화).
- **D2 — event ring buffer 소유**: replay(§3.3-b) 최적화는 [[05-Backend]]의 memory ring buffer를 재사용한다. 그 버퍼의 깊이·보존 정책 소유가 [[SPEC-101-snapshot-api]]인지 본 spec인지 정해야 한다. MVP는 replay 미채택이라 blocker는 아니다.
- **D3 — `version` 필드명**: [[05-Backend]] WebSocket 예시는 event에 `version` 단일 필드를 쓴다. 본 spec은 그것을 snapshot sequence로 채택하고 protocol/envelope 버전은 `welcome.protocolVersion`으로 분리했다(이름 충돌 방지). 청사진 예시와 정합한다(보강, 충돌 아님).

### Open Questions (검토 필요)

- **Q1 — `seq`의 필요성**: TCP가 연결 내 순서·무손실을 보장하므로 `seq`는 server-측 frame drop·구현 버그 감지의 보조망일 뿐이다. PoC에서 실효가 낮으면 `seq`를 디버그 전용으로 낮추고 wire에서 제거를 검토. **검토 필요.**
- **Q2 — replay 채택 여부**: 전체 re-snapshot(§3.3-a)은 항상 정답이지만 100-pane snapshot 재전송 비용이 있다. ring buffer replay(§3.3-b)의 메모리·복잡도 trade-off를 [[SPEC-007-test-validation]] 측정으로 평가해 채택을 결정. MVP는 (a)만. **검토 필요.**
- **Q3 — heartbeat 주기·backoff·half-open 임계**: 15s heartbeat, 2주기 미수신=disconnected, 0.5s→10s exponential backoff는 모두 **PoC 검증 가설**이다. local 단일 client 환경의 실제 끊김 패턴으로 보정 필요.
- **Q4 — batch coalesce 임계·backpressure 정책**: §3.6의 coalesce 임계와 `4429` 트리거 조건은 100-pane 부하 측정 전까지 가설이다. local 단일 client에서 backpressure가 실제로 발생하는지부터 검증 필요. **검토 필요.**
- **Q5 — subscription scoping**: MVP는 단일 local client에 모든 camp/orc event를 스트리밍한다(per-camp 구독 없음). 대규모 inventory나 P2 multi-client(remote/team)에서 per-camp 구독 필터가 필요해지면 envelope에 scope를 추가하는 후속 슬라이스로 다룬다. 현재 비목표.
- **Q7 — live view 프레임의 `seq` 공유(해소: 2026-07-02 리뷰 반영)**: ~~live view 프레임이 연결 `seq`를 공유하면 유실 시 스냅샷 gap 오탐 위험~~ → **해소**. live view frame(`version:null`)은 연결 `seq` sequence에 **참여하지 않고**(비증가·직전 state seq 반복), client seq-gap 검사는 state/lifecycle frame에만 적용한다(§2.2/§2.3/§3.5-2). 이로써 고빈도 `pane_view` 유실/coalesce가 state 채널 re-snapshot resync를 트리거하지 않는다(AC-15). **CLOSED.**
- **Q6 — `orc_updated` vs `orc_status_changed` 경계**: status 축과 비-status 축의 분리(§2.3.1)는 명확하지만, summary-only 변경을 어느 event로 보낼지 등 경계 케이스는 [[SPEC-004-status-inference]] 산출 신호와 정합화가 필요하다. 둘 다 convergent merge라 client 정확성에는 영향 없음(전달 효율 문제). **검토 필요.**
