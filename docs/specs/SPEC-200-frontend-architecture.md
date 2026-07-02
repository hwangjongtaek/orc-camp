---
spec: SPEC-200
title: Frontend 아키텍처·라우팅·상태·데이터 흐름
status: draft
updated: 2026-07-02
requirements: [R-UI-001, R-API-001, R-API-002, R-API-004, R-API-005, R-UI-005, R-UI-007, R-UI-012]
decisions: [D-003, D-004, D-005, D-017, D-046]
tags:
  - specs
  - frontend
  - dashboard
  - routing
  - state
  - epic-3
---

# SPEC-200 — Frontend 아키텍처·라우팅·상태·데이터 흐름

Orc Camp dashboard(Epic 3, [[README]]) **frontend app의 골격(skeleton)**을 고정한다. 즉 (a) **라우팅**(camp list / camp detail / settings, deep-link), (b) **상태 관리**(SERVER state vs CLIENT state 분리, store shape, 정규화), (c) **데이터 흐름**(REST snapshot bootstrap → WS delta reconcile, API client, auth token 처리), (d) **상태 전파 계약**(loading/empty/error/disconnected/stale를 store에서 파생해 화면으로 흘리는 방식), (e) **성능 전략**(20 session/100 pane 무-jank), (f) **테스트 경계**(Vitest/Testing Library/Playwright)를 정의한다.

이 spec은 **화면 레이아웃·컴포넌트 내부·디자인 토큰·asset 렌더링을 정의하지 않는다.** 그 위에서 동작하는 skeleton screen이 본 spec의 store·route·data-flow 계약을 소비한다.

> **소유 경계**: 본 spec은 **app 골격 계약**(route 표·store shape·reconcile reducer·bootstrap 순서·auth token 핸들링·view-status 파생·성능/테스트 전략)을 소유한다. 다음은 참조만 한다 — 화면별 레이아웃/컴포넌트/상태 카피는 [[SPEC-201-dashboard-screens]], 디자인 토큰·접근성은 [[SPEC-202-design-accessibility]], asset/sprite 렌더링은 [[SPEC-300-asset-rendering]], **REST payload shape·`POST /api/refresh`·error envelope**는 [[SPEC-101-snapshot-api]], **WS event payload·envelope·reconnect 프로토콜**은 [[SPEC-102-realtime-sync]], **도메인 데이터 shape(ScanResult/Camp/Orc/enum)**는 [[SPEC-005-data-contract]], **server·token·CORS·bind 메커니즘**은 [[SPEC-100-server-lifecycle]], control(text/key/interrupt)·optimistic update는 [[SPEC-400-control-actions]]가 소유한다.

> **불변식(확정)**:
> ① **identity 권위는 paneId/sessionId**다([[08-Decisions|D-017]]). store는 camp를 `camp.id`(`"session:"+sessionId`), orc를 `orc.id`(`"pane:"+paneId`)로 **정규화 키**한다. `tmuxTarget`/`tmuxSessionName`은 표시 전용이며 절대 store 키·route param 식별자·reconcile 키로 쓰지 않는다.
> ② **server state와 client state는 store 안에서 물리적으로 분리**한다. server state는 [[SPEC-101-snapshot-api]] snapshot + [[SPEC-102-realtime-sync]] delta만이 쓰기 권한을 갖고, UI는 read-only로 소비한다. client state(선택·UI 선호)는 server state를 변형하지 않는다([[04-Frontend]] 상태 분리).
> ③ **WS delta 적용은 idempotent**하다(convergent merge, [[SPEC-102-realtime-sync]] §3.2). 같은 batch를 두 번 적용해도 상태가 수렴한다. 재조립 권위 키는 snapshot `version`이다.
> ④ **startup token은 메모리에만** 둔다([[SPEC-100-server-lifecycle]] §2.6, R-CLI-007). store 영속/`localStorage`/`sessionStorage`/devtools 직렬화 대상에 token을 담지 않는다.
> ⑤ frontend는 backend의 **local API만** 소비한다(cloud backend 없음, [[08-Decisions|D-003]]).

## 1. Scope

### In scope

- **라우팅**(§2.2): route 표(`/`·`/camps/:campId`·`/settings`), history 모드·server fallback, deep-link 식별자 계약(stable id), orc 선택의 URL 반영(R-UI-001 첫 화면, R-UI-007 deep-link 지원).
- **상태 관리**(§2.3~2.4): store 기술 선택(가정), server/client slice 분리, 정규화된 entity store shape, selector/구독 경계.
- **reconcile 모델**(§2.5): `applySnapshot`(base) + `applyBatch`(delta)의 version-ordering·idempotent id-merge·gap→resync·runtimeEpoch 재시작 처리. [[SPEC-102-realtime-sync]] 프로토콜의 **client 측 구현 계약**(R-API-001 client bootstrap, R-API-003 ordering 소비).
- **data flow**(§2.6): bootstrap 순서(token capture → WS open+buffer → REST snapshot → drain), API client module 계약, auth token 핸들링(URL→memory→header/WS), manual refresh client trigger(R-API-004), error/loading/empty 전파(R-API-005·R-UI-005 store 측).
- **view-status 파생**(§2.7): tmux 가용성·camps·diagnostics·connection slice에서 화면이 소비할 status(loading/empty 4종/tmuxError/disconnected/stale/ready)를 파생하는 규칙. 렌더링은 [[SPEC-201-dashboard-screens]].
- **성능 전략**(§3.5): 정규화 + 좁은 selector 구독 + batch 1-render + 목록 windowing으로 20 session/100 pane 무-jank(비기능 "성능").
- **테스트 전략**(§3.6): Vitest unit(store/reducer/API client) ↔ Testing Library integration(route/상태 전파) ↔ Playwright e2e(bootstrap·reconnect·deep-link) 경계.
- 다룬 요구사항: **R-UI-001**(app/route level 첫 화면 = camp list), **R-API-001**(client realtime bootstrap). 공동: R-API-002(client reconnect 표면)·R-API-004(client refresh trigger)·R-API-005(client error 전파)·R-UI-005(store 측 상태 파생)·R-UI-007(deep-link 지원)·성능 비기능.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| 화면 레이아웃·컴포넌트 내부·상태 카피·empty/error 화면 렌더 | 화면 계약 | [[SPEC-201-dashboard-screens]] |
| 디자인 토큰(CSS variable 값)·접근성·키보드 네비게이션 | 디자인 시스템 | [[SPEC-202-design-accessibility]] |
| sprite 상태머신·asset manifest 소비·fallback 렌더 | asset 렌더 | [[SPEC-300-asset-rendering]] |
| REST payload shape·`POST /api/refresh` 동작·ApiError code 표·ETag | snapshot runtime | [[SPEC-101-snapshot-api]] |
| WS event payload·envelope·version 생성·reconnect 프로토콜 규칙 | realtime 계약 | [[SPEC-102-realtime-sync]] |
| ScanResult/Camp/Orc 필드·enum·nullability | 데이터 계약 | [[SPEC-005-data-contract]] |
| startup token 생성/검증·CORS·`127.0.0.1` bind·header 이름 확정 | server 보안 경계 | [[SPEC-100-server-lifecycle]] |
| control action 요청·optimistic update·target 재검증·confirm flow | control | [[SPEC-400-control-actions]] |
| settings payload·저장 | persistence | [[SPEC-500-settings-persistence]] |

## 2. Contract

### 2.1 기술 스택 (확정 vs 가정)

[[08-Decisions|D-004]](TS monorepo)는 **Proposed**이므로 아래 store 선택은 **가정(assumption)**으로 표기한다. 청사진([[04-Frontend]])·`AGENTS.md` 기본값을 따른다.

| 영역 | 선택 | 상태 |
| --- | --- | --- |
| App/번들러 | React + Vite | 가정([[04-Frontend]], D-004 Proposed) |
| 라우터 | React Router(`BrowserRouter`, history 모드) | 가정 |
| **Store** | **Zustand**(lightweight, slice 분리·selector 구독) | **가정(택1)** — RTK 대안은 §6 Q1 |
| Styling | CSS Modules 또는 vanilla-extract, pixel token은 CSS variable | 가정([[04-Frontend]], 값은 [[SPEC-202-design-accessibility]]) |
| Test | Vitest + Testing Library + Playwright | 가정([[04-Frontend]]) |
| Dev server origin | `http://localhost:5173`(Vite 기본) | 가정 — [[SPEC-100-server-lifecycle]] §2.7 CORS dev origin과 **정합 확정**(Q2 해소 제안) |

- **store 선택 근거(Zustand)**: (a) snapshot+delta는 reducer 한 곳(`applyBatch`)에서 명령형 merge가 자연스럽고, (b) 좁은 selector 구독으로 per-orc 렌더 격리가 쉬워 성능 전략(§3.5)에 직접 부합하며, (c) boilerplate가 적어 MVP 속도에 유리하다. **RTK로 바꿔도 본 spec의 store shape·reconcile 계약은 동일하게 성립한다**(엔진 교체 가능, §6 Q1). 어느 쪽이든 store는 **단일 store + slice**이며 server/client slice를 분리한다.

### 2.2 라우팅 (R-UI-001, R-UI-007)

`BrowserRouter`(history 모드). local app이므로 dev/prod 모두 **SPA fallback**(미매칭 path → `index.html`)을 제공해 deep-link가 깨지지 않게 한다([[04-Frontend]] 라우팅).

| Route | 목적 | param 식별자 |
| --- | --- | --- |
| `/` | **camp list dashboard (첫 화면, R-UI-001)** | — |
| `/camps/:campId` | camp detail(scene + inspector + activity rail orchestration) | `:campId` = `encodeURIComponent(camp.id)` = `encodeURIComponent("session:"+sessionId)` |
| `/camps/:campId?orc=<orcId>` | camp detail + 선택된 orc(inspector deep-link) | `<orcId>` = `orc.id` = `"pane:"+paneId` (search param) |
| `/settings` | local settings([[SPEC-500-settings-persistence]]) | — |

- **첫 화면 계약(R-UI-001, 확정)**: app entry(`/` 또는 token 부트 URL)는 **camp list route로 resolve**한다. marketing/landing이 아니다(`AGENTS.md` 제약). camp list 화면 내용은 [[SPEC-201-dashboard-screens]] 소유이나, **"첫 화면이 camp list"는 route level에서 본 spec이 보장**한다.
- **deep-link 식별자(확정, R-UI-007 지원·[[08-Decisions|D-017]])**: route param은 **stable id**(`sessionId`/`paneId` 파생)만 쓴다. `tmuxTarget`/`tmuxSessionName`(rename·reindex로 가변)은 URL에 쓰지 않는다. 따라서 deep-link는 session rename·pane reindex 후에도 동일 entity로 resolve된다. `camp.id`/`orc.id`에 reserved char(`:`·`$`·`%`)가 있으므로 **percent-encoding**한다(`session:$0` → `session%3A%240`, [[SPEC-101-snapshot-api]] §2.7 path 계약과 동일).
- **orc 선택의 URL 반영(R-UI-007 지원)**: orc 선택은 client state(§2.4)이지만 `?orc=<orcId>` search param에 **mirror**한다. reload/공유 시 선택이 복원되고, inspector가 항상 raw `tmuxTarget`을 표시할 수 있는 진입점을 deep-link로 보장한다(raw target 표시 자체의 렌더는 [[SPEC-201-dashboard-screens]]·R-UI-007).
- **resolve 실패**: `:campId`가 현재 store snapshot에 없으면(아직 미bootstrap / 삭제됨) route는 crash하지 않고 view-status `loading`(부트 전) 또는 `not_found`(부트 후 부재)로 파생해 camp list로의 복귀 경로를 제공한다(렌더 [[SPEC-201-dashboard-screens]]).
- **token query 보존(§2.6)**: 부트 URL `/?token=<token>`의 token은 app init에서 1회 읽고 **메모리로 옮긴 뒤 `history.replaceState`로 visible URL에서 제거**한다(이후 router 네비게이션은 client-side라 token 재노출 없음). token-in-URL 잔존 완화는 [[SPEC-100-server-lifecycle]] Q5 FE 측 대응이다.

### 2.3 상태 분리: SERVER state vs CLIENT state ([[04-Frontend]])

store는 세 slice로 나눈다. **server slice는 snapshot/delta만이 mutate**하고, UI는 read-only 소비한다.

| slice | 종류 | 쓰기 주체 | 예시 필드 |
| --- | --- | --- | --- |
| `server` | SERVER state | `applySnapshot`/`applyBatch`만 | camps/orcs(정규화), statusSummary, stale, lastGoodAt, tmux, diagnostics, snapshotVersion |
| `connection` | SERVER-derived 전송 상태 | WS/REST client | wsStatus, lastVersionApplied(`Vlast`), runtimeEpoch, bootstrapPhase, lastSnapshotAt |
| `ui` | CLIENT state | UI 액션 | selectedCampId, selectedOrcId, inspectorOpen, previewLineCount(pref), commandDraft, uiPrefs |

- **분리 불변식(확정)**: UI 액션은 `ui` slice만 쓴다. `server` slice를 UI가 직접 수정하지 않는다(예: 선택이 orc 데이터를 바꾸지 않음). control action의 결과 반영도 server slice로는 **`control_result` event/`POST` 응답을 통해서만** 들어온다([[SPEC-400-control-actions]] 소유; optimistic update는 거기서 제한적으로 정의).
- **client state 휘발성**: `ui` slice는 session-local이다. P1 alias/note 영속([[SPEC-500-settings-persistence]] R-P1-001)은 별도 settings 경로이며 본 store의 휘발 client state와 구분한다.

### 2.4 store shape (정규화)

직렬화/도메인 타입은 [[SPEC-005-data-contract]]가 SSOT다. 본 spec은 그 타입을 **정규화 컨테이너**에 담는 client store shape만 정의한다.

```ts
// 도메인 타입(Camp/Orc/OrcStatus/StatusSummary/TmuxAvailability/Diagnostics)은
// [[SPEC-005-data-contract]] §2.1 그대로 import. 본 spec은 재정의하지 않는다.

interface ServerSlice {
  schemaVersion: 1;
  snapshotVersion: number;          // 현재 적용된 published version (= Vlast). 0 = 미bootstrap
  scannedAt: string | null;
  stale: boolean;                   // server staleness (R-TMUX-005) — disconnected와 직교(§2.7)
  lastGoodAt: string | null;
  tmux: TmuxAvailability;           // {installed, serverRunning, version}
  statusSummary: StatusSummary;     // 최상위 7키 집계
  diagnostics: Diagnostics;
  campIds: string[];                // 정렬된 id 목록(렌더 순서, [[SPEC-005-data-contract]] §3.4)
  campsById: Record<string, Camp>;  // 키 = camp.id("session:"+sessionId)
  orcsById: Record<string, Orc>;    // 키 = orc.id("pane:"+paneId). camp.orcs는 orcId 참조로 평탄화
}

interface ConnectionSlice {
  wsStatus: 'idle' | 'connecting' | 'open' | 'disconnected' | 'reconnecting';
  bootstrapPhase: 'pending' | 'ws-open' | 'snapshot-applied' | 'live';
  lastVersionApplied: number;       // Vlast (재조립 권위 키, [[SPEC-102-realtime-sync]] §2.4)
  runtimeEpoch: string | null;      // welcome.runtimeEpoch (재시작 감지)
  lastSnapshotAt: string | null;    // 마지막 REST snapshot 수신 server 시각(emittedAt)
  refreshState: 'idle' | 'refreshing' | 'throttled';  // R-API-004 client
  lastError: ClientApiError | null; // §2.7 (ApiError 매핑, 원문/secret 불포함)
}

interface UiSlice {
  selectedCampId: string | null;    // route param과 동기
  selectedOrcId: string | null;     // ?orc= search param과 동기
  inspectorOpen: boolean;
  layoutMode: 'map' | 'terminal';   // camp detail 표시 모드(client-only 상태, SSOT는 ?orc= 유지 — [[SPEC-203-terminal-workspace]], [[08-Decisions|D-045]]). URL param 아님(D-035 정합: 좌표·모드 서버 비추가)
  previewLineCount: number;         // 표시 선호(상한은 [[SPEC-500-settings-persistence]]·[[SPEC-006-privacy-redaction]])
  commandDraft: Record<string, string>; // orcId → draft(전송은 [[SPEC-400-control-actions]])
  uiPrefs: UiPrefs;
}

interface ClientApiError {           // [[SPEC-101-snapshot-api]] ApiError 의 client 매핑(표시용)
  code: string;                      // 안정 enum(원문 그대로)
  message: string;                   // 사용자 안전 문구(server가 이미 redact)
  requestId: string;                 // debug log 상관(표시 안 함, 진단용)
  scope: 'global' | 'camp' | 'orc';  // 전파 범위(§2.7)
}
```

- **정규화 근거(성능, §3.5)**: `campsById`/`orcsById`는 **stable id 키 Map**이므로 delta merge가 O(1)이고, per-orc selector 구독으로 `orc_status_changed` 한 건이 그 orc-bound 컴포넌트만 재렌더하게 한다.
- **token은 store에 없다(불변식 ④)**: token은 별도 in-memory 모듈 singleton(§2.6)에 두고 store/devtools 직렬화에서 제외한다.
- **selector 경계(확정)**: 컴포넌트는 broad object가 아니라 **좁은 selector**(예: `s => s.server.orcsById[orcId]?.status`)로 구독하고 shallow equality를 쓴다. 목록은 `campIds`/orcId 배열만 구독해 항목 추가/삭제 시에만 부모가 갱신된다.
- **`layoutMode` + terminal 번들 code-split(확정, 2026-07-02, [[08-Decisions|D-046]])**: `layoutMode`는 `?orc=` SSOT를 대체하지 않는 **client-only 표시 상태**다(터미널 모드는 새 route가 아니라 camp detail의 표시 모드 — [[SPEC-203-terminal-workspace]]). 터미널 뷰포트가 쓰는 **xterm.js(MIT, web-only 의존)**와 terminal-mode 컴포넌트는 `layoutMode==='terminal'` 진입 시 **lazy-load(dynamic import / code-split)**하여 초기 번들·map 모드 로드에 영향을 주지 않는다. 이는 CLI 아티팩트의 "런타임 의존성 최소" 원칙([[SPEC-700-packaging-release]])과 별개 축(web 번들 의존)임을 명시한다([[08-Decisions|D-046]]).

### 2.5 reconcile 모델 (R-API-001 client / R-API-003 소비)

[[SPEC-102-realtime-sync]] §3 프로토콜의 **client 측 구현 계약**이다. 두 reducer로 표현한다.

```ts
// 1) REST snapshot을 base로 적용. [[SPEC-101-snapshot-api]] SnapshotResponse 소비.
function applySnapshot(res: SnapshotResponse): void;
//   - server slice를 ScanResult로 교체(정규화: campsById/orcsById 재구성, campIds 정렬 보존)
//   - lastVersionApplied = res.snapshotVersion (= Vs)
//   - bootstrapPhase = 'snapshot-applied' (이후 'live')

// 2) WS batch delta 적용. [[SPEC-102-realtime-sync]] BatchPayload 소비.
function applyBatch(version: number, changes: DiffEvent[], frameEpoch: string): ReconcileOutcome;
type ReconcileOutcome = 'applied' | 'dropped' | 'resync-required';
```

**version-ordering 규칙(확정, [[SPEC-102-realtime-sync]] §2.4 소비)** — `Vlast = connection.lastVersionApplied`:

1. `frameEpoch !== runtimeEpoch` → **resync-required**(server 재시작, §2.6 복구 (a)).
2. `version <= Vlast` → **dropped**(이미 반영, idempotent no-op).
3. `version === Vlast + 1` → **applied**: 아래 id-merge를 batch 단위 atomic 적용 후 `Vlast = version`.
4. `version > Vlast + 1` → **resync-required**(중간 batch 유실).

**id-merge(확정, convergent)** — 각 `DiffEvent`를 stable id로 적용한다([[SPEC-102-realtime-sync]] §2.3.1):

| event | 적용 |
| --- | --- |
| `camp_added` | `campsById[campId] = Camp`; `campIds`에 삽입 후 재정렬 |
| `camp_updated` | `campsById[campId]`에 부분 필드 **merge**(전체 값 교체, 델타 아님) |
| `camp_removed` | `campsById[campId]` 및 그 orcId들 삭제; `campIds`에서 제거 |
| `orc_added` | `orcsById[orcId] = Orc`; 소속 camp의 orcId 목록에 삽입 |
| `orc_status_changed` | `orcsById[orcId]`에 status 축 필드 merge(status·statusConfidence 동반) |
| `orc_updated` | `orcsById[orcId]`에 비-status 필드 merge |
| `orc_removed` | `orcsById[orcId]` 삭제(retention은 server가 `terminated` status로 선처리 — [[SPEC-102-realtime-sync]] §2.3.1) |

5. **atomic batch(확정, 성능)**: batch의 모든 change를 메모리에서 적용한 뒤 **단일 store commit**으로 반영해 **1회 render**한다([[SPEC-102-realtime-sync]] §2.5, render storm 방지). 부분 적용 금지 — 적용 중 알 수 없는 id 대상 `*_updated`/`*_removed`를 만나면 batch 적용을 보류하고 **resync-required**(보수적, [[SPEC-102-realtime-sync]] §3.2-4).
6. **resync-required 처리(확정, R-API-002)**: delta 적용을 멈추고 `GET /api/snapshot`을 재-fetch해 `applySnapshot`으로 baseline을 리셋한 뒤 live delta를 재개한다(event replay buffer 없음 — [[SPEC-101-snapshot-api]] §3.2).
7. **idempotency(확정, R-API-003)**: convergent event라 같은 batch를 두 번 받아도(2번 규칙 drop 또는 재적용 수렴) 최종 상태가 동일하다.

### 2.6 data flow: bootstrap·API client·auth (R-API-001)

#### 2.6.1 bootstrap 순서 (확정, [[SPEC-102-realtime-sync]] §3.1 client 측)

snapshot 읽기와 WS 구독 사이 race를 없애기 위해 **WS-first 버퍼링** 순서를 정규(normative)로 한다:

1. **token capture**: app init에서 `location` query `?token=<token>`을 읽어 in-memory token holder에 저장하고 visible URL에서 제거(§2.2). token 없으면 unauthorized view(재실행/URL 재확인 안내, 렌더 [[SPEC-201-dashboard-screens]]).
2. **WS open + buffer**: `wsStatus='connecting'` → `/api/events`(token 전달, §2.6.3) 연결. `welcome` 수신 전까지 동기화 시작 아님. 이후 들어오는 state event를 **버퍼에만 쌓고 적용하지 않는다**. `runtimeEpoch = welcome.runtimeEpoch`.
3. **REST snapshot base**: `GET /api/snapshot`(token header) → `applySnapshot(res)`, `Vlast = res.snapshotVersion = Vs`.
4. **drain**: 버퍼·이후 event 중 `version <= Vs`는 drop, `version > Vs`는 §2.5 ordering으로 적용. `bootstrapPhase='live'`.
5. 이후 manual refresh 없이 delta로 갱신(R-API-001). 화면은 `bootstrapPhase`/`wsStatus`에 따라 view-status를 파생(§2.7).

- **cold start(확정)**: `GET /api/snapshot`이 `503 snapshot_not_ready`(+`Retry-After`)면([[SPEC-101-snapshot-api]] §2.6) client는 `Retry-After`만큼 backoff 후 재시도하며 view-status `loading`을 유지한다(부분 데이터 위조 금지).

#### 2.6.2 reconnect & recovery (확정, R-API-002 client)

| 트리거 | client 동작 |
| --- | --- |
| WS close / 연속 2 heartbeat 주기 frame 미수신 | `wsStatus='disconnected'`(보이던 상태는 "지연 가능"로 표시), exponential backoff+jitter 재연결([[SPEC-102-realtime-sync]] §3.3, 값 가설) |
| 재연결 + `welcome.runtimeEpoch` **동일** | `GET /api/snapshot` 전체 re-snapshot(MVP 정규 경로) → `Vlast` 리셋 → live 재개 |
| 재연결 + `runtimeEpoch` **불일치**(server 재시작) | 무조건 전체 re-snapshot으로 baseline 리셋([[SPEC-102-realtime-sync]] §3.3, R-CLI-007 정합) |
| close code `4401`(token 무효) | reconnect 중단, unauthorized view(재실행 안내) |
| close code `4429`(resync 요구) | 전체 re-snapshot 후 재연결 |

#### 2.6.3 API client module·auth token (확정, [[SPEC-100-server-lifecycle]] §2.6 소비)

- **token holder**: in-memory singleton(`getToken()`/`setToken()`). store·`localStorage`·`sessionStorage`·로그·URL에 영속하지 않는다(불변식 ④). 탭 새로고침 시 token이 사라지므로 부트 URL을 다시 열어야 한다(단명 local process 모델, 수용된 trade-off).
- **REST 호출**: 단일 `apiClient`가 모든 요청에 token을 **HTTP header**로 부착한다. header 이름은 [[SPEC-100-server-lifecycle]] Q2 미확정 — 본 spec은 **`Authorization: Bearer <token>` 권장**(CSRF 내성: 브라우저가 cross-site에 자동 부착 못 함, 비-simple header라 preflight 유발). 이를 SPEC-100과 정합 확정한다(§6 Q2 해소 제안).
- **WS 호출**: 브라우저 WS는 custom header 불가([[SPEC-102-realtime-sync]] §2.1). 따라서 token을 (a) `Sec-WebSocket-Protocol: orc-camp.v1, token.<token>` subprotocol(**권장** — server access log에 token 미노출) 또는 (b) `?token=<token>` query로 전달한다. 둘 다 server가 허용([[SPEC-102-realtime-sync]] §2.1); 본 spec은 (a)를 1차로 둔다(token-in-URL 로깅 완화).
- **GET token 의존성 해소([[SPEC-100-server-lifecycle]] Q1)**: snapshot/camps GET이 token을 요구하더라도, token은 bootstrap 1단계에서 **첫 fetch 이전**에 capture되므로 부트스트랩 순서상 충돌이 없다. unauthorized(401)는 view-status `unauthorized`로 파생한다.
- **error 매핑**: REST 오류 응답 `ApiError {code,message,requestId}`([[SPEC-101-snapshot-api]] §2.4)를 `ClientApiError`로 변환해 connection slice에 저장한다. `message`만 사용자에게 표시하고 `requestId`는 진단용으로 보관, `code`로 화면 분기(§2.7). 원문/secret은 server가 이미 redact했으므로 client는 **추가 가공 없이 표시만** 한다.

#### 2.6.4 manual refresh (확정, R-API-004 client trigger)

- **1차 경로**: `refresh()` 액션이 `POST /api/refresh`(token)를 호출해 강제 out-of-cycle scan을 트리거하고, 반환 `SnapshotResponse`를 `applySnapshot`으로 반영한다([[SPEC-101-snapshot-api]] §2.8). `refreshState='refreshing'`.
- **rate-limit**: `429 refresh_rate_limited`면 `refreshState='throttled'`로 표시하고 `Retry-After` 후 idle 복귀(scan storm 방지).
- **degrade fallback**: `POST /api/refresh` 미가용/실패면 `GET /api/snapshot` 재-fetch로 마지막 cycle snapshot을 다시 받는다([[SPEC-101-snapshot-api]] §2.8 degraded fallback). 이는 R-API-004 최소 충족 경로다. 본 spec은 [[SPEC-101-snapshot-api]] Q5를 **POST /api/refresh 1차**로 FE 측 결정한다.

### 2.7 view-status 파생·error/loading/empty 전파 (R-UI-005·R-API-005 store 측)

화면이 분기할 **view-status**를 store에서 파생한다(렌더·카피는 [[SPEC-201-dashboard-screens]]). 우선순위(높은 것이 우선):

```ts
type GlobalViewStatus =
  | 'loading'            // bootstrapPhase != 'live' && snapshotVersion == 0
  | 'unauthorized'       // token 부재 또는 401/4401
  | 'disconnected'       // connection.wsStatus == 'disconnected' (전송 끊김 — server stale과 직교)
  | 'tmux_not_installed' // server.tmux.installed == false
  | 'tmux_not_running'   // installed && !serverRunning && camps == []
  | 'no_session'         // installed && serverRunning && camps == []
  | 'no_agent'           // camps 비어있지 않고 모든 camp orcCount == 0
  | 'tmux_error'         // server.diagnostics.tmuxErrors.length > 0 (부분 오류, 데이터는 유지)
  | 'ready';             // 위 외
// stale 은 직교 플래그: server.stale 를 ready/no_agent 등과 동시 표시 가능(badge).
```

- **파생 규칙(확정)**: empty 4종(`tmux_not_installed`/`tmux_not_running`/`no_session`/`no_agent`)은 [[SPEC-005-data-contract]] §3.3의 `(installed, serverRunning, camps, orcCount)` 조합을 그대로 따른다(R-UI-005, R-TMUX-006 정합). 본 spec은 그 조합을 **client 측에서 재파생**할 뿐 새 의미를 만들지 않는다.
- **stale ≠ disconnected(확정, [[SPEC-102-realtime-sync]] §3.4)**: `disconnected`(WS 끊김)와 `stale`(연결됨·last-good 데이터)은 직교다. store는 둘을 **동시에** 표현할 수 있어야 한다(예: `disconnected` 배너 + 데이터는 stale badge). 한 enum으로 합치지 않는다.
- **scope 전파(확정, R-API-005)**: error는 `scope`(global/camp/orc)로 격리한다. 특정 camp/orc의 tmux 오류가 전체 dashboard를 error로 만들지 않는다(비기능 신뢰성 — 부분 실패 비전파). global error는 connection slice `lastError`, scope error는 해당 entity 옆에 표시한다(렌더 [[SPEC-201-dashboard-screens]]).
- **manual refresh 노출**: `disconnected`/`stale`/`tmux_error` view-status는 화면에 `refresh()` 트리거를 노출할 근거가 된다(R-API-004; 버튼 렌더 [[SPEC-201-dashboard-screens]]).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다.

### 3.1 첫 화면·deep-link 결정성 (확정, R-UI-001·R-UI-007)

1. app entry는 항상 `/`(camp list)로 resolve한다. 부트 token query는 capture 후 제거되며 route는 `/`로 normalize된다.
2. `/camps/:campId`·`?orc=<orcId>`는 stable id만 식별자로 쓴다. 같은 sessionId/paneId면 rename·reindex 후에도 동일 entity로 resolve된다(D-017).
3. store 부트 전 deep-link 진입은 `loading`을, 부트 후 부재 id는 `not_found`를 파생한다(crash 없음).

### 3.2 reconcile 결정성 (확정, R-API-001·R-API-003)

1. 재조립 권위 키는 `version`이다. `applyBatch`는 §2.5 ordering(drop ≤Vlast / apply =Vlast+1 / resync >Vlast+1)을 결정적으로 따른다.
2. id-merge는 convergent(전체 값 교체)다. 같은 event 재적용은 no-op로 수렴한다.
3. batch는 atomic(전부 적용 또는 보류 후 resync)하며 적용 성공 시 1회 render한다.
4. runtimeEpoch 불일치·gap·seq 비연속·unknown id는 모두 `GET /api/snapshot` 전체 resync로 회복한다.

### 3.3 상태 분리 강제 (확정)

1. UI 액션은 `ui` slice만 mutate한다. server slice는 `applySnapshot`/`applyBatch`만 mutate한다.
2. 선택(selectedOrcId 등) 변경은 server 데이터를 바꾸지 않으며, server 데이터 변경(예: 선택된 orc가 `orc_removed`)은 UI에 selection-cleared로 파생된다(선택 id가 store에서 사라지면 inspector는 빈 상태로 degrade).

### 3.4 token·보안 (확정, [[SPEC-100-server-lifecycle]] 정합)

1. token은 memory-only. 영속 저장·URL 잔존·로그 출력 금지(불변식 ④, R-CLI-007).
2. 모든 보호 요청에 token을 부착한다(REST header, WS subprotocol/query). 미부착/401/4401은 `unauthorized` 파생.
3. client는 same-origin local API만 호출한다(cross-origin 호출 없음, CORS dev origin은 [[SPEC-100-server-lifecycle]] §2.7과 정합).

### 3.5 성능 전략 (확정 + 가설, 비기능 "성능: 20 session/100 pane")

- **정규화 + 좁은 selector(확정)**: entity Map + per-id selector 구독으로 단일 `orc_status_changed`가 그 orc-bound 컴포넌트만 재렌더한다. 목록 컨테이너는 id 배열만 구독해 추가/삭제 시에만 갱신한다.
- **batch 1-render(확정)**: 한 scan tick의 모든 delta는 하나의 batch로 1회 render(§2.5). rapid polling이 render storm을 만들지 않는다([[SPEC-102-realtime-sync]] §3.6 server coalesce와 정합).
- **목록 windowing(확정 방향, 임계 가설)**: camp list는 ≤20 cards로 bounded(virtualization 불요, memoized card). camp detail의 orc는 단일 session 범위로 bounded. **activity log**(event ring buffer)는 무한 증가하므로 **렌더 상한**(예: 최근 `N`개만 DOM, 초과분 가상화/페이드) — `N` 기본값은 **PoC 검증 가설**([[SPEC-007-test-validation]] 측정). 100-pane이 단일 화면(예: 전 camp 펼침)에 모이면 그 목록도 windowing 대상.
- **preview 비용(확정)**: terminal preview는 backend가 line/byte를 제한한 redacted tail만 받는다([[SPEC-006-privacy-redaction]], [[SPEC-005-data-contract]] §2.7). client는 그 상한을 넘겨 렌더하지 않는다(추가 가공 없음). 텍스트 노출/line-count 조정은 [[SPEC-201-dashboard-screens]]·R-PRIV-006([[08-Decisions|D-021]] 후속 슬라이스).
- **측정(확정)**: "20 session/100 pane 무-jank"의 구체 임계(batch apply 시간, frame budget, 재렌더 컴포넌트 수)는 [[SPEC-007-test-validation]] 측정 절차로 보정하는 **가설**이다(§4 AC-12).

### 3.6 테스트 전략 (확정 경계)

| 계층 | 도구 | 본 spec 책임 범위 |
| --- | --- | --- |
| unit | Vitest | `applySnapshot`/`applyBatch` reducer(version ordering·idempotency·gap→resync·id-merge), view-status 파생, token holder, `apiClient`(mocked fetch: header 부착·error 매핑·refresh/429), id encode/decode |
| integration | Vitest + Testing Library | route 렌더(첫 화면=camp list), deep-link resolve, view-status→화면 분기 전파(loading/empty/disconnected/stale), selection↔URL 동기, manual refresh 트리거 배선 |
| e2e | Playwright | bootstrap(snapshot→WS delta 라이브 갱신, no refresh), reconnect 복구(disconnected→re-snapshot), deep-link 진입, runtimeEpoch 재시작 resync. mock server/WS fixture 사용 |

- **경계(확정)**: 본 spec 테스트는 **골격(store·route·data-flow)**을 검증한다. 화면 픽셀/카피/컴포넌트 내부는 [[SPEC-201-dashboard-screens]], asset 렌더는 [[SPEC-300-asset-rendering]], 접근성은 [[SPEC-202-design-accessibility]] 테스트 소유다. visual regression은 PixelLab asset 도입 이후로 미룬다([[04-Frontend]] 테스트 전략).

## 4. Acceptance criteria

```text
SPEC-200-AC-01 (R-UI-001)
  Given 부트 token URL 또는 임의 app entry로 진입할 때
  When router가 resolve를 완료하면
  Then 첫 화면 route는 '/'(camp list dashboard)이고(landing/marketing 아님),
       store 부트 전이면 view-status='loading'으로 camp list route 위에서 대기한다.
```

```text
SPEC-200-AC-02 (R-UI-007, [[08-Decisions|D-017]])
  Given camp.id="session:$0", orc.id="pane:%12" 인 entity가 있을 때
  When /camps/session%3A%240?orc=pane%3A%2512 deep-link로 진입하고
       이후 그 session/pane이 rename·reindex되면(tmuxTarget/tmuxSessionName 변경)
  Then route는 동일 sessionId/paneId entity로 계속 resolve되며(stable id 권위),
       tmuxTarget/tmuxSessionName은 URL 식별자·store 키로 쓰이지 않는다.
```

```text
SPEC-200-AC-03 (R-API-001)
  Given client가 §2.6.1 순서로 WS를 먼저 열어 event를 버퍼링하고
        GET /api/snapshot 으로 version=Vs base를 applySnapshot 한 뒤
  When version<=Vs event는 drop하고 version>Vs event를 순서대로 applyBatch 하면
  Then store 최종 상태가 server 현재 상태와 일치하고(field 단위),
       이 동기화는 manual refresh 없이 bootstrapPhase='live'로 완료된다.
```

```text
SPEC-200-AC-04 (R-API-001, R-API-003)
  Given lastVersionApplied=Vlast 인 store에서
  When applyBatch(version, changes, frameEpoch) 를 호출하면
  Then frameEpoch!=runtimeEpoch 또는 version>Vlast+1 이면 'resync-required'를 반환하고,
       version<=Vlast 이면 'dropped'(no-op)이며,
       version==Vlast+1 이면 'applied'로 id-merge 후 Vlast=version 이 된다.
```

```text
SPEC-200-AC-05 (R-API-003)  [idempotency]
  Given 동일 batch(version=N, 같은 changes)를 두 번 적용할 때
  When 두 번째 적용을 관측하면
  Then 두 번째는 version<=Vlast 로 drop되거나 재적용되어도 결과 상태가 동일하고(convergent),
       store에 중복 camp/orc 항목이 생기지 않는다(stable id merge).
```

```text
SPEC-200-AC-06 (R-API-001)  [성능: batch 1-render]
  Given 한 scanner tick이 여러 변경(orc 2건 status + camp_updated)을 하나의 batch로 보낼 때
  When client가 그 batch를 적용하면
  Then 변경을 메모리에서 원자적으로 적용한 뒤 단일 store commit으로 1회 render하며,
       부분 적용 상태가 외부로 노출되지 않는다.
```

```text
SPEC-200-AC-07 (R-API-002)
  Given 동기화된 client의 WS 연결이 끊긴(close 또는 연속 2 heartbeat 주기 미수신) 뒤
  When client가 이를 감지하면
  Then connection.wsStatus='disconnected'로 전환하고(보이던 상태는 '지연 가능'),
       backoff 재연결 후 GET /api/snapshot 전체 re-snapshot으로 Vlast를 리셋해 복구한다.
```

```text
SPEC-200-AC-08 (R-API-002, R-CLI-007 정합)  [server 재시작]
  Given client 보유 runtimeEpoch 와 다른 epoch을 가진 server에 재연결될 때
  When welcome.runtimeEpoch 가 보유 값과 다르면
  Then client는 version 비교를 신뢰하지 않고 무조건 전체 re-snapshot으로 baseline을 리셋한 뒤
       delta를 재개한다(이전 runtime version/token 폐기).
```

```text
SPEC-200-AC-09 (R-SEC-002, R-SEC-003 client 정합)  [token 핸들링]
  Given 부트 URL '/?token=<token>' 로 진입할 때
  When app init과 이후 API 호출을 관측하면
  Then token은 메모리 holder에 저장되고 visible URL에서 제거되며(history.replaceState),
       store/localStorage/sessionStorage/로그 어디에도 영속되지 않고,
       REST 요청에는 token이 HTTP header로, WS handshake에는 subprotocol(또는 query)로 부착된다.
```

```text
SPEC-200-AC-10 (R-API-004)
  Given 동기화된 dashboard에서 사용자가 manual refresh를 트리거할 때
  When refresh() 가 실행되면
  Then POST /api/refresh(token)를 호출해 반환 SnapshotResponse를 applySnapshot으로 반영하고,
       429 refresh_rate_limited 면 refreshState='throttled'로 degrade하며,
       refresh 미가용 시 GET /api/snapshot 재-fetch fallback으로 R-API-004를 충족한다.
```

```text
SPEC-200-AC-11 (R-UI-005)  [view-status 파생]
  Given (a)tmux 미설치, (b)설치+server 미실행+camps=[], (c)server 실행+camps=[],
        (d)camps 있으나 모든 orcCount=0, (e)diagnostics.tmuxErrors>0 인 각 snapshot에서
  When global view-status를 파생하면
  Then 각각 tmux_not_installed / tmux_not_running / no_session / no_agent / tmux_error 로
       서로 구분되어 파생되고([[SPEC-005-data-contract]] §3.3 조합),
       server.stale 은 이들과 직교한 badge 플래그로 동시 표현된다.
```

```text
SPEC-200-AC-12 (R-API-005)  [error 격리·전파]
  Given 특정 REST 요청이 ApiError{code,message,requestId}를 반환하거나
        특정 camp/orc에 tmux 오류가 있을 때
  When client가 이를 전파하면
  Then 사용자 표시는 server가 redact한 message만 쓰고(원문/secret/requestId 미표시),
       error는 scope(global/camp/orc)로 격리되어 한 entity 오류가 전체 dashboard를
       error 상태로 만들지 않는다(부분 실패 비전파).
```

```text
SPEC-200-AC-13 (성능 비기능)  [selector 격리]
  Given 20 session/100 pane fixture로 채워진 store에서
  When 단일 orc_status_changed batch를 적용하면
  Then 재렌더되는 컴포넌트는 그 orcId-bound 컴포넌트(및 소속 camp 집계 1개)로 한정되고,
       무관한 camp/orc 컴포넌트는 재렌더되지 않으며,
       batch apply→commit이 frame budget 내에 완료된다([[SPEC-007-test-validation]] 측정, 임계 가설).
```

```text
SPEC-200-AC-14 (R-API-001, R-API-002)  [disconnected ≠ stale]
  Given WS는 연결된 채 server_stale_changed{stale:true}를 받은 상태와
        WS가 끊긴 disconnected 상태를 각각 만들면
  When store 플래그를 관측하면
  Then server.stale 과 connection.wsStatus='disconnected'가 독립 플래그로 존재해
       두 상태를 동시에/구분해 표현할 수 있다(한 enum으로 합치지 않음).
```

```text
SPEC-200-AC-15 (R-UI-001)  [상태 분리]
  Given UI 액션(selectedOrcId 변경, inspector toggle)을 수행할 때
  When store 변화를 관측하면
  Then ui slice만 변경되고 server slice(camps/orcs/version)는 불변이며,
       선택된 orc가 orc_removed로 사라지면 selection이 비워져 inspector가 빈 상태로 degrade한다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| **R-UI-001** | app/route level 첫 화면=camp list, route 표·SPA fallback·상태 분리 | SPEC-200-AC-01, AC-15 |
| **R-API-001** | client bootstrap(WS-first 버퍼→REST base→drain), reconcile reducer, batch 1-render | SPEC-200-AC-03, AC-04, AC-05, AC-06, AC-14 |
| R-API-002 (공동) | client reconnect 표면(disconnected 신호·re-snapshot 복구·runtimeEpoch 재시작) | SPEC-200-AC-07, AC-08, AC-14 |
| R-API-004 (공동) | manual refresh client trigger(POST /api/refresh 1차·429·GET fallback) | SPEC-200-AC-10 |
| R-API-005 (공동) | ApiError→client 매핑, scope 격리 전파(부분 실패 비전파) | SPEC-200-AC-12 |
| R-UI-005 (공동) | store 측 view-status 파생(loading/empty 4종/tmux_error/disconnected/stale) | SPEC-200-AC-11, AC-14 |
| R-UI-007 (공동) | deep-link stable id 식별자(rename/reindex 내성), orc 선택 URL mirror | SPEC-200-AC-02 |
| 성능 비기능 | 정규화+좁은 selector+batch 1-render+목록 windowing(20 session/100 pane) | SPEC-200-AC-06, AC-13 |

> 1차 소유: **R-UI-001**(route level), **R-API-001**(client 측). 공동 충족(1차 소유는 타 spec): R-API-002/004/005·R-API-003(reconnect/refresh/error/version protocol 1차 [[SPEC-101-snapshot-api]]/[[SPEC-102-realtime-sync]]; 본 spec은 client 구현), R-UI-005(상태 렌더 1차 [[SPEC-201-dashboard-screens]]; 본 spec은 store 측 파생), R-UI-007(raw target 표시 렌더 1차 [[SPEC-201-dashboard-screens]]/[[SPEC-005-data-contract]]; 본 spec은 deep-link 지원), R-SEC-002/003·R-CLI-007(token 1차 [[SPEC-100-server-lifecycle]]; 본 spec은 client 핸들링). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — WS endpoint 이름 불일치(조정 필요)**: [[SPEC-100-server-lifecycle]] §2.6은 WS를 `/ws`로, [[SPEC-102-realtime-sync]] §2.1과 [[04-Frontend]] API 계약은 `/api/events`로 표기한다. 본 spec은 realtime SSOT인 [[SPEC-102-realtime-sync]]를 따라 **`/api/events`**를 client 계약으로 채택한다. → SPEC-100 §2.6 WS 경로 표기를 `/api/events`로 정합 권고(orchestrator).
- **C2 — token transport header 이름([[SPEC-100-server-lifecycle]] Q2 해소 제안)**: 본 spec은 REST에 **`Authorization: Bearer <token>`**, WS에 **`Sec-WebSocket-Protocol` subprotocol token**(query는 fallback)을 1차로 제안한다. SPEC-100/102와 정합 확정 필요. → SPEC-100 Q2 / SPEC-102 §2.1과 공동 확정.
- **C3 — manual refresh 경로([[SPEC-101-snapshot-api]] Q5 해소 제안)**: 본 spec은 R-API-004를 **`POST /api/refresh` 1차 + `GET /api/snapshot` fallback**으로 FE 측 결정했다(§2.6.4). → SPEC-101 Q5에 반영.
- **C4 — dev origin 값([[SPEC-100-server-lifecycle]] Q6/§2.7 CORS dev origin)**: 본 spec은 Vite 기본 `http://localhost:5173`을 dev origin으로 둔다. → SPEC-100 CORS allowlist와 정합 확정.

### Open Questions (검토 필요)

- **Q1 — store 엔진 확정(Zustand vs RTK)**: D-004가 Proposed이므로 store 선택은 가정이다. 본 spec 계약(store shape·reconcile)은 엔진 무관하나, devtools/middleware·async 패턴 차이로 최종 택1 필요. **검토 필요.**
- **Q2 — ETag/304 conditional GET 활용([[SPEC-101-snapshot-api]] Q4)**: re-snapshot/refresh polling에서 `If-None-Match`로 304를 받는 최적화를 client가 채택할지. MVP 필수 아님. **검토 필요.**
- **Q3 — token-in-WS 운반 최종형**: subprotocol token(로깅 완화) vs query token(단순). server access log 노출·proxy 호환을 보고 확정([[SPEC-100-server-lifecycle]] Q5와 연계). **검토 필요.**
- **Q4 — activity log 렌더 상한 N·목록 windowing 임계**: §3.5의 `N`과 100-pane 단일 화면 windowing 임계는 **PoC 검증 가설**([[SPEC-007-test-validation]] 측정). **검토 필요.**
- **Q5 — orc 선택의 URL 표현**: search param(`?orc=`) vs nested route(`/camps/:campId/orcs/:orcId`). 본 spec은 search param을 1차로 두나 inspector 전체화면 등 화면 요구에 따라 [[SPEC-201-dashboard-screens]]와 재조율 가능. **검토 필요.**
- **Q6 — 탭 새로고침 token 유실 UX**: token이 memory-only라 reload 시 사라진다(부트 URL 재진입 필요). `sessionStorage` 임시 보관(보안 trade-off) vs 현행(엄격) 결정 필요. 본 spec은 현행(엄격, 불변식 ④)을 1차로 둔다. **검토 필요.**
