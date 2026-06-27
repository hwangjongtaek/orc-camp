---
spec: SPEC-101
title: snapshot runtime·REST API
status: approved
updated: 2026-06-27
requirements: [R-API-003, R-API-004, R-API-005, R-PRIV-006]
decisions: [D-005, D-014, D-016, D-017, D-018, D-019, D-024, D-025, D-026, D-033]
tags:
  - specs
  - api
  - rest
  - snapshot
  - runtime
  - backend
---

# SPEC-101 — snapshot runtime·REST API

`orc-camp serve` 슬라이스(Epic 2, [[README]])에서 **local server가 메모리에 유지하는 snapshot runtime**과 **read-only REST API 표면**을 고정한다. 즉 (a) scanner를 interval로 돌려 in-memory snapshot을 만들고 diff engine으로 변경을 산출하는 런타임, (b) 이 snapshot/변경이 참조하는 **snapshot version(sequence id)**, (c) `GET /api/health`·`GET /api/snapshot`·`GET /api/camps/:campId` REST 계약, (d) manual refresh 지원과 API error 분리(사용자 event vs local debug log)를 정의한다.

이 spec은 **데이터의 모양(shape)을 정의하지 않는다.** snapshot payload의 camp/orc/diagnostics/staleness 필드는 [[SPEC-005-data-contract]]가 SSOT로 소유([[08-Decisions|D-018]])하며, 본 spec은 그 `ScanResult`를 **재사용·서빙(serve)**하고 server-runtime envelope(version)만 덧입힌다. WebSocket event payload·reconnect는 [[SPEC-102-realtime-sync]], server 수명주기·token·CORS·port는 [[SPEC-100-server-lifecycle]], control(POST input/key/interrupt)은 [[SPEC-400-control-actions]], settings 저장은 [[SPEC-500-settings-persistence]], redaction 메커니즘은 [[SPEC-006-privacy-redaction]]가 소유한다.

> **불변식(확정)**:
> ① snapshot runtime은 [[SPEC-002-tmux-discovery]]의 read-only scanner만 구동한다 — serve/refresh/REST 어떤 경로도 `tmuxExec` allowlist 밖 명령이나 `send-keys`/`paste-buffer`를 호출하지 않는다([[08-Decisions|D-019]]).
> ② `GET /api/snapshot`이 내보내는 `data`는 [[SPEC-005-data-contract]] `ScanResult`(`schemaVersion=1`)와 **동일 도메인 shape**다. 본 spec은 camp/orc/preview/staleness/diagnostics를 재정의하지 않는다.
> ③ identity 권위는 `paneId`/`sessionId`다([[08-Decisions|D-017]]). REST path param·event 참조 모두 `camp.id`/`orc.id`(stable id)를 쓰며 `tmuxTarget`/`tmuxSessionName`은 표시 전용이다.
> ④ runtime state(snapshot·last-good·version·event buffer)는 **memory only**다. capture 원문은 어떤 응답·로그·디스크에도 저장하지 않는다([[08-Decisions|D-016]], R-PRIV-004/005). version은 non-durable이며 server 재시작은 `runtimeEpoch`로 식별한다([[08-Decisions|D-025]], §2.2/§3.5).
> ⑤ `GET /api/snapshot`은 **preview 텍스트를 싣지 않는다**(metadata-only 유지, [[08-Decisions|D-021]]/[[08-Decisions|D-026]]). preview 텍스트는 §2.11 per-orc lazy endpoint(`GET /api/orcs/:orcId/preview`)로만, **token + exposure gate**를 거쳐 backend-redacted tail로만 serve한다([[08-Decisions|D-024]], [[08-Decisions|D-026]], R-PRIV-006). snapshot 노출면을 최소화한다.

## 1. Scope

### In scope

- **snapshot runtime**: serve 모드에서 scanner를 interval로 구동해 in-memory **current snapshot**을 유지하는 루프(§2.1). [[SPEC-002-tmux-discovery]] inventory + [[SPEC-004-status-inference]] 추론 + [[SPEC-005-data-contract]] 조립을 재사용하며, cycle 간 직전 snapshot을 `prior`로 전달해 `active`/`terminated`를 가능케 한다([[08-Decisions|D-014]] `--watch` 등가).
- **snapshot version(sequence id)**: server-runtime 권위 `snapshotVersion`의 정의·증가 규칙·event 참조 계약(§2.2, R-API-003). event **payload**는 [[SPEC-102-realtime-sync]]가 소유하되, event가 참조하는 version은 본 spec이 소유한다.
- **diff engine**: (prior published snapshot, 새 scan 결과)를 stable id로 비교해 변경 event를 산출하는 **메커니즘**과 version bump 트리거(§2.3). event type 분류·wire payload는 [[SPEC-102-realtime-sync]] 소유.
- **REST API**: `GET /api/health`(§2.5), `GET /api/snapshot`(§2.6), `GET /api/camps/:campId`(§2.7), `POST /api/refresh`(§2.8, R-API-004), `GET /api/orcs/:orcId/preview`(§2.11, per-orc lazy preview text — [[08-Decisions|D-026]], R-PRIV-006). request/response·error state·read-only vs state-changing·idempotency·pagination 판단을 정의한다.
- **snapshot bootstrap 보강**(§2.4/§2.6): `GET /api/snapshot` envelope에 `runtimeEpoch`(restart 식별, [[08-Decisions|D-025]])와 `recentActivity` bootstrap tail([[SPEC-600-observability]] `ActivityEvent` shape 재사용 — 본 spec은 **배치·개수**만)을 실어 dashboard activity rail·restart 감지를 부트스트랩한다.
- **API error 분리**(§2.9, R-API-005): 사용자에게 보이는 event/응답 envelope vs local debug log 분리, 양쪽 모두 [[SPEC-006-privacy-redaction]] sanitize 통과. `422 validation_failed`(+`fieldErrors[]`) 포함.
- 다룬 요구사항: **R-API-003**(event의 snapshot version/sequence id), **R-API-004**(manual refresh), **R-API-005**(API error 분리), **R-PRIV-006**(preview 노출 gate — 데이터 경로/API 절반; UI는 [[SPEC-201-dashboard-screens]], 저장 값은 [[SPEC-500-settings-persistence]], redaction은 [[SPEC-006-privacy-redaction]]). R-API-001(REST 초기 snapshot + WS 변경 분리)은 [[SPEC-102-realtime-sync]]와 **공동**이며 본 spec은 REST 절반(초기 snapshot)을 소유한다.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| camp/orc/preview/staleness/diagnostics 필드 shape·`schemaVersion`·enum | 출력 데이터 계약 SSOT(본 spec은 재사용·serve) | [[SPEC-005-data-contract]] |
| WebSocket event **payload**·event type 분류·reconnect 핸드셰이크 | realtime 계약 | [[SPEC-102-realtime-sync]] |
| server 시작/종료·port 선택·startup token 발급·token 검증·CORS·`127.0.0.1` bind | server 수명주기·보안 경계 | [[SPEC-100-server-lifecycle]] |
| control(POST input/key/interrupt)·target 재검증·audit | state-changing tmux control | [[SPEC-400-control-actions]] |
| settings 저장 위치·shape·PATCH 검증(`scanInterval` 등) | local config/persistence | [[SPEC-500-settings-persistence]] |
| debug log 파일 위치·포맷·rotation | observability | [[SPEC-600-observability]] |
| redaction 패턴·sanitize chokepoint·tmux allowlist wrapper **메커니즘** | privacy 계약(본 spec은 redacted 데이터만 serve) | [[SPEC-006-privacy-redaction]] |
| tmux command set·timeout·error isolation·last-good 판정 **규칙** | inventory 수집 | [[SPEC-002-tmux-discovery]] |
| preview 텍스트 **렌더링·inspector UI·노출 토글 컨트롤** | dashboard 화면 동작(본 spec은 데이터 경로만) | [[SPEC-201-dashboard-screens]] |
| `preview.exposureEnabled`/`preview.lineCount` **저장 값·경계** | local config/persistence(본 spec은 그 값을 gate로 소비) | [[SPEC-500-settings-persistence]] |
| `ActivityEvent` **필드 shape·taxonomy·ring buffer·bootstrap tail 개수 산출** | observability(본 spec은 snapshot bootstrap tail **배치**만) | [[SPEC-600-observability]] |
| `runtimeEpoch` **발급 메커니즘·WS welcome frame**·reconnect 핸드셰이크 | realtime 계약(본 spec은 health/snapshot에 **노출**만) | [[SPEC-102-realtime-sync]] |
| `PATCH /api/settings` 필드 검증 **의미**(`fieldErrors[].code`) | settings payload(본 spec은 `422` envelope만 소유) | [[SPEC-500-settings-persistence]] |

## 2. Contract

### 2.1 snapshot runtime(serve 모드 scan loop)

- server process는 **단일 scanner instance**를 소유한다. 시작 시 1회 scan을 수행해 **first published snapshot**을 만들고, 이후 `scanInterval`마다 재-scan한다.
- `scanInterval`은 [[SPEC-500-settings-persistence]]의 settings에서 읽는다(R-SET-001). 허용 경계는 비기능 요구 "Scan latency 1–5초"에서 도출한 **확정 경계 `[1,5]`초**, default `3s`는 **PoC 검증 가설**이다([[08-Decisions|D-014]], [[SPEC-001-scan-cli]] §3.1과 동일 경계).
- 각 cycle은 [[SPEC-002-tmux-discovery]] read-only inventory + [[SPEC-004-status-inference]] 추론 + [[SPEC-005-data-contract]] 조립으로 후보 `ScanResult`를 만든다. **직전 published snapshot을 `prior`로 전달**해 [[SPEC-004-status-inference]]가 `active`(직전 대비 변화)·`terminated`(사라진 paneId)를 판정한다 — `orc-camp scan --watch`와 동일 메커니즘([[08-Decisions|D-014]]).
- **staleness 재사용(확정, R-TMUX-005)**: cycle의 inventory 수집이 실패하면 [[SPEC-002-tmux-discovery]] §2.7대로 last-good으로 fallback(`stale=true`, `lastGoodAt`)한다. last-good이 없으면 위조하지 않는다(`stale=false`, 빈 inventory). runtime은 last-good snapshot을 메모리에 보관한다.
- **non-overlap(확정)**: 단일 in-flight scan만 허용한다. 한 cycle이 `scanInterval`보다 오래 걸리면 다음 tick은 **건너뛰고(coalesce)** 진행 중 scan 완료를 기다린다 — scan storm·중첩 spawn을 금지한다(20 session/100 pane 성능 비기능과 정합).
- **atomic publish(확정)**: published snapshot은 immutable 객체이며 cycle 완료 시 참조 swap으로 atomic 교체한다. 진행 중 GET은 **torn read 없이** 단일 version의 완전한 snapshot을 본다(§3.4).
- memory only: snapshot·last-good·`snapshotVersion`·event buffer는 디스크에 저장하지 않는다. server 재시작은 `snapshotVersion`을 초기화하며 client는 full resync한다(§3.5, [[SPEC-102-realtime-sync]] reconnect와 정합).

### 2.2 snapshot version (sequence id) — R-API-003

`snapshotVersion`은 **server-runtime 권위의 단조 증가 정수**이며, snapshot과 모든 변경 event가 공유하는 sequence id다.

- 타입 `number`(정수, ≥0). server 시작 시 `0`(=아직 published snapshot 없음, cold start)에서 출발하고, **first published snapshot에서 `1`**이 된다.
- **증가 규칙(확정)**: cycle이 산출한 후보를 diff engine(§2.3)이 직전 published snapshot과 비교해 **유의미한 변경(≥1 change event, 또는 staleness/tmux 가용성 transition)**이 있을 때만 published snapshot을 교체하며 `snapshotVersion += 1`로 bump한다. 변경이 없으면(오직 `scannedAt`만 전진) version은 유지하고 published snapshot도 교체하지 않는다(§3.1). 즉 **하나의 version은 하나의 변경 batch에 1:1 대응**한다.
- **event 참조(확정, R-API-003)**: diff가 emit하는 모든 변경 event는 자신이 속한 published snapshot의 `snapshotVersion`을 carry한다(payload 필드명·shape는 [[SPEC-102-realtime-sync]] 소유). 따라서 client는 REST snapshot의 version과 WS event의 version으로 **순서·중복(dedup)·복구**를 판정한다(§3.2, R-API-002 recovery).
- **liveness vs content 분리(확정)**: 매 cycle 전진하는 `scannedAt`/스캔 성공 여부는 **content version이 아니다**. cycle별 heartbeat는 `GET /api/health`의 `lastScanAt`/`lastScanOk`로 노출하며 `snapshotVersion`과 분리한다(§2.5).
- **version 계약 권위([[08-Decisions|D-025]])**: 본 절의 정의(단조 증가·**변경 tick당 +1**(변경 없으면 미증가)·atomic-commit으로 직렬화(partial batch 직렬화 금지)·version↔diff-batch 1:1)는 [[08-Decisions|D-025]]로 확정됐다(§3.1과 동형). version은 **non-durable**이며 server 재시작은 `runtimeEpoch`로 식별한다(§3.5). `runtimeEpoch`는 server lifetime마다 새로 생성되는 불투명 식별자(예 UUID 또는 시작 timestamp)로, [[SPEC-102-realtime-sync]] §2.4 WS welcome이 싣는 값과 **동일**하다 — REST(`GET /api/health`·`GET /api/snapshot`)와 WS가 같은 epoch를 보고해 client가 restart를 일관되게 판정한다(§3.2/§3.5, Q1·Q6 해소).

### 2.3 diff engine (변경 산출 메커니즘)

- 입력: `prior`(직전 published snapshot) + `next`(이번 cycle 후보 `ScanResult`). 출력: 순서가 결정적인 변경 event 목록 + bump 여부.
- **stable id 키(확정, [[08-Decisions|D-017]])**: 비교는 `orc.id`(=`pane:`+paneId)·`camp.id`(=`session:`+sessionId)를 키로 한다. `tmuxTarget`/`tmuxSessionName` 변화만으로는 동일 entity로 본다(rename/reindex는 metadata 변경 event이지 add/remove가 아니다).
- diff가 검출하는 **변경 범주(category)**(event type 명칭·payload는 [[SPEC-102-realtime-sync]] 소유):
  - orc added / removed(사라진 paneId → [[SPEC-004-status-inference]] `terminated` retention과 정합, 즉시 drop 아님) / status 변경 / metadata 변경(`currentWorkSummary`·`cwd`·`command`·`tmuxTarget` 등).
  - camp added / removed / 집계(`statusSummary`·`orcCount`) 변경.
  - **top-level transition**: `stale` 전이(fresh↔stale, R-TMUX-005), tmux 가용성(`installed`/`serverRunning`) 전이(R-TMUX-006), `diagnostics` 신규 오류.
- **bump 트리거(확정)**: 위 범주 중 ≥1이 검출되면 §2.2 규칙대로 `snapshotVersion`을 bump하고 published snapshot을 교체한다. (event payload·전송은 [[SPEC-102-realtime-sync]].)
- diff 산출은 결정적이다(같은 prior/next → 같은 event 집합·순서). 정렬은 [[SPEC-005-data-contract]] §3.4(session→window→pane)를 따른다.

### 2.4 server payload와 scan `--json`의 관계 (재사용 계약)

| 측면 | `orc-camp scan --json`([[SPEC-001-scan-cli]]) | `GET /api/snapshot`(본 spec) |
| --- | --- | --- |
| body 도메인 | [[SPEC-005-data-contract]] `ScanResult` | **동일** `ScanResult`(같은 serializer 재사용) |
| envelope | 없음(top-level가 `ScanResult`) | `{ snapshotVersion, emittedAt, data: ScanResult }` |
| 실행 모델 | 단발 1회(또는 `--watch` stream) | serve 루프의 current published snapshot |
| 전송 | stdout | HTTP 200 JSON |

- **재사용 단언(확정)**: `data`는 [[SPEC-005-data-contract]] §2.1 schema(`schemaVersion=1`)에 그대로 validate된다. 본 spec은 `data` 내부 어떤 필드도 추가·제거·rename하지 않는다. server는 thin envelope(`snapshotVersion`·`emittedAt`)만 덧붙인다.
- `emittedAt`(ISO 8601)은 **이 HTTP 응답을 만든 server 시각**이며, `data.scannedAt`(스캔 실행 시각)·`data.lastGoodAt`(inventory 수집 시각)과 구분된다. stale일 때 `emittedAt > data.lastGoodAt`다.

```ts
// 본 spec이 소유하는 server-runtime envelope. data 내부는 [[SPEC-005-data-contract]] 소유.
// ActivityEvent shape는 [[SPEC-600-observability]] §2.1 소유(여기서는 import해 배치만 한다).
interface SnapshotResponse {
  snapshotVersion: number;   // §2.2. ≥1 (published). WS event가 참조하는 sequence id (R-API-003)
  runtimeEpoch: string;      // §2.2/§3.5. server 재시작 식별자([[08-Decisions|D-025]]). WS welcome([[SPEC-102-realtime-sync]] §2.4)와 동일 값
  emittedAt: string;         // ISO 8601, 이 응답 생성 server 시각
  data: ScanResult;          // [[SPEC-005-data-contract]] ScanResult 그대로 (camps/staleness/diagnostics). preview 텍스트 미포함(metadata-only, 불변식 ⑤)
  recentActivity: ActivityEvent[]; // bootstrap tail(최근 ACTIVITY_BOOTSTRAP_TAIL개). shape·taxonomy는 [[SPEC-600-observability]] §2.1/§2.4 소유, 배치/개수만 본 spec
}

interface CampResponse {
  snapshotVersion: number;   // 응답이 파생된 published snapshot version
  emittedAt: string;
  data: Camp;                // [[SPEC-005-data-contract]] Camp 그대로
}

interface HealthResponse {   // §2.5. camp/orc 데이터·원문 비포함
  status: 'ok';
  schemaVersion: 1;
  snapshotVersion: number;   // 현재 published version (0 = 아직 없음)
  runtimeEpoch: string;      // §2.5/§3.5. 현재 server lifetime 식별자([[08-Decisions|D-025]]). WS welcome과 동일 → restart 감지 parity
  scannerRunning: boolean;
  lastScanAt: string | null; // 마지막 scan 시도 시각(성공/실패 무관). heartbeat
  lastScanOk: boolean;       // 마지막 cycle inventory 수집 성공 여부
  stale: boolean;            // 현재 published snapshot의 staleness (data.stale 미러)
  tmux: { installed: boolean; serverRunning: boolean };
  uptimeMs: number;
}

interface OrcPreviewResponse {  // §2.11. per-orc lazy preview text (R-PRIV-006, [[08-Decisions|D-026]])
  snapshotVersion: number;      // 이 preview가 파생된 published snapshot version
  runtimeEpoch: string;         // restart 식별 parity ([[08-Decisions|D-025]])
  emittedAt: string;            // ISO 8601
  orcId: string;                // "pane:"+paneId (echo, [[08-Decisions|D-017]])
  preview: {                    // capture 실패/미보유 시 null
    lines: number;              // 노출된 redacted 줄 수 (≤ preview.lineCount ≤ PREVIEW_LINES)
    truncated: boolean;         // 원본 tail이 lines를 초과했는가 ([[SPEC-006-privacy-redaction]] §2.4)
    redacted: boolean;          // ≥1 redaction 매칭 (SanitizedCapture.redacted, [[SPEC-006-privacy-redaction]] §2.1)
    exposureEnabled: boolean;   // settings preview.exposureEnabled 미러 ([[SPEC-500-settings-persistence]])
    text?: string[];            // exposureEnabled=true 일 때만. redacted tail 줄 배열. raw 원문 절대 미포함
  } | null;
}

interface ApiError {         // §2.9. 사용자에게 보이는 표면 (R-API-005)
  error: {
    code: string;            // 안정 machine enum (아래 §2.9 표)
    message: string;         // 사용자 안전 문구 (redacted, 원문/secret 불포함)
    requestId: string;       // debug log 상관 키 (사용자↔로그 분리 연결)
    fieldErrors?: Array<{    // 422 validation_failed 전용 확장(§2.9). 필드별 검증 오류. code 의미는 [[SPEC-500-settings-persistence]] §2.6 소유
      field: string;         // 예 "scanInterval" | "preview.lineCount"
      code: string;          // 예 "out_of_range" | "type_mismatch" | "unknown_field" | "redaction_floor_locked"
      message: string;       // 사용자 안전 문구
      allowed?: string;      // 예 "1..5"
    }>;
  };
}
```

### 2.5 `GET /api/health` (read-only, liveness)

- **용도**: liveness/readiness probe. `doctor`(R-CLI-005)·외부 모니터링·dashboard 연결 점검이 소비한다.
- **응답**: `200` + `HealthResponse`. server가 살아있으면 항상 `200`(snapshot 미생성 cold start면 `snapshotVersion=0`, `scannerRunning` 반영).
- **민감도(확정)**: camp/orc/preview/cwd/summary 등 workspace 파생 데이터를 **포함하지 않는다**. tmux 가용성 boolean과 runtime 상태만 노출한다 → token 없이 노출해도 안전한 최소 표면이다(token 경계는 [[SPEC-100-server-lifecycle]] 소유; [[08-Decisions|D-024]]로 health는 token-exempt 확정).
- **`runtimeEpoch`(확정, [[08-Decisions|D-025]])**: health 응답은 현재 `runtimeEpoch`를 노출해 client가 **server 재시작을 감지**하게 한다(version reset과 짝). 이 값은 [[SPEC-102-realtime-sync]] §2.4 WS welcome이 싣는 epoch와 **동일**하다 — REST·WS parity로 restart 판정이 일관된다(§3.5).
- **token 경계(확정, [[08-Decisions|D-024]])**: `GET /api/health`와 `/api/events` handshake만 token-exempt이며, 나머지 모든 `/api/*`(snapshot/camps/preview/refresh/settings)는 startup token을 요구한다. health는 가용성 boolean·runtime 상태만 담아 token 없이도 안전하다.
- safe·idempotent. body는 결정적 shape.

### 2.6 `GET /api/snapshot` (read-only, 전체 snapshot)

- **용도**: R-API-001의 REST 절반 — frontend가 초기 상태를 1회 fetch하고, WS 끊김 시 복구 fetch한다(R-API-002).
- **응답**: `200` + `SnapshotResponse`. `data`는 current published snapshot의 `ScanResult`다.
- **metadata-only(확정, 불변식 ⑤, [[08-Decisions|D-021]]/[[08-Decisions|D-026]])**: `data`는 preview **텍스트**를 싣지 않는다(`preview`는 `{lines,truncated,redacted}` 메타만, shape는 [[SPEC-005-data-contract]]). preview 텍스트는 §2.11 per-orc endpoint로만 노출된다 → snapshot 노출면 최소화.
- **`runtimeEpoch`·`recentActivity`(확정)**: envelope는 `runtimeEpoch`(restart 식별, [[08-Decisions|D-025]], §2.2)와 `recentActivity` bootstrap tail을 싣는다. `recentActivity`는 [[SPEC-600-observability]] §2.4의 최근 `ACTIVITY_BOOTSTRAP_TAIL`(가설 50)개 `ActivityEvent`로, dashboard activity rail이 최초 로드·복구 시 부트스트랩하게 한다(item shape·taxonomy는 [[SPEC-600-observability]] 소유, 배치·개수만 본 spec — [[SPEC-600-observability]] C1 해소). client는 `id`로 dedup해 live `activity` frame과 중복 없이 합친다(activity는 `snapshotVersion`을 bump하지 않음 — [[SPEC-600-observability]] 불변식 ③).
- **cold start**: first published snapshot 이전(드문 sub-초 window)에는 `503 snapshot_not_ready` + `Retry-After: 1`을 반환한다. 부분 데이터를 위조하지 않는다(§3.5, readiness 순서는 [[SPEC-100-server-lifecycle]]).
- **권한(결정)**: snapshot은 `cwd`·`command`·`currentWorkSummary`·preview 메타 등 workspace 파생(=redacted여도 민감) 데이터를 담으므로 **startup token을 요구**한다([[08-Decisions|D-024]] read API 보호). 검증 메커니즘·실패 응답은 [[SPEC-100-server-lifecycle]] 소유. token 없으면 `401 unauthorized`.
- **conditional GET(MVP 권장, 검토 필요)**: 응답에 `ETag: "<snapshotVersion>"`를 실어 `If-None-Match`가 현재 version과 같으면 `304 Not Modified`(body 없음)를 반환한다 — manual refresh polling의 대역폭/렌더 절약(§2.8). 단 `recentActivity`/`runtimeEpoch`는 `snapshotVersion` bump 없이 바뀔 수 있으므로(activity는 version을 bump하지 않음 — [[SPEC-600-observability]] 불변식 ③), `304`는 **snapshot `data` 동일**만 의미하고 activity 최신화는 WS `activity` frame이 담당한다(§6 Q4).
- **pagination/filter/sort(판단)**: dataset은 비기능 상한(≤20 session/≤100 pane)으로 bounded이고 정렬은 [[SPEC-005-data-contract]] §3.4가 이미 결정적이므로 **MVP에 pagination/filter/sort query를 두지 않는다**(full snapshot 1개). multi-host/remote(P2)로 dataset이 커지면 도입을 재검토한다(§6 Q).
- safe·idempotent.

### 2.7 `GET /api/camps/:campId` (read-only, camp 상세)

- **path param**: `:campId` = [[SPEC-005-data-contract]] `camp.id`(=`"session:"+sessionId`, 정규식 `^session:\$[0-9]+$`, 예 `session:$0`). 권위는 `sessionId`이며 `tmuxSessionName`이 아니다([[08-Decisions|D-017]]).
  - id에 reserved char(`:`·`$`)가 포함되므로 client는 percent-encoding을 권장한다(`session:$0` → `session%3A%240`). server는 percent-decode 후 current published snapshot의 `camp.id`와 매칭한다.
- **응답**: `200` + `CampResponse`(`data` = 해당 `Camp`, current published snapshot에서 추출 — 별도 scan 없음, snapshot과 동일 version 일관성).
- **error**: 형식이 `camp.id` 정규식과 불일치 → `400 bad_request`. current snapshot에 해당 id 없음 → `404 camp_not_found`.
- **권한**: §2.6과 동일(token 요구). `ETag: "<snapshotVersion>"` 동일 적용.
- safe·idempotent.

### 2.8 `POST /api/refresh` (manual refresh) — R-API-004

- **용도**: dashboard의 manual refresh. interval을 기다리지 않고 **즉시 out-of-cycle scan**을 트리거해 최신 데이터를 산출한다. **manual refresh(R-API-004)의 1차 경로**이며([[08-Decisions|D-033]]), 미가용/실패 시 `GET /api/snapshot` 재요청을 fallback으로 둔다(아래 degraded fallback).
- **동작**: 요청 시 진행 중 scan이 없으면 1회 read-only scan을 수행하고, diff/version bump(§2.2~2.3)·event emit([[SPEC-102-realtime-sync]])을 정상 cycle과 동일하게 거친 뒤 결과 snapshot을 반환한다.
  - 진행 중 scan이 있으면 **coalesce**: 신규 scan을 띄우지 않고 진행 중 scan 완료에 합류해 그 결과를 반환한다(중복 spawn 금지, §2.1 non-overlap과 정합).
  - **rate limit(확정, 값은 가설)**: 최소 refresh 간격 `R_min`(초기 가설 `1s`) 내 추가 요청은 진행 결과로 coalesce하거나 `429 refresh_rate_limited` + `Retry-After`를 반환한다 — scan storm 방지.
- **응답**: `200` + `SnapshotResponse`(새 snapshot). scan 실패 시 last-good fallback(`data.stale=true`)을 그대로 반환한다(R-TMUX-005 재사용) — refresh 자체는 실패가 아니라 데이터/staleness로 보고한다.
- **분류(중요)**: refresh는 **server runtime state를 바꾸는(version bump·event emit) state-changing 표면**이므로 startup token을 요구한다(R-SEC-003, 검증은 [[SPEC-100-server-lifecycle]]). 그러나 **tmux에 대해서는 read-only**다 — [[SPEC-002-tmux-discovery]] allowlist scanner만 구동하며 `send-keys` 류를 호출하지 않는다([[08-Decisions|D-019]] 불변식 유지). 이 둘을 혼동하지 않는다.
- **idempotency**: coalescing·rate-limit으로 **재시도 안전(safe to retry)**하다(중복 요청이 추가 tmux 부작용을 만들지 않음). 단 엄밀한 idempotency key는 두지 않는다(MVP).
- **degraded fallback(명시, [[08-Decisions|D-033]])**: `POST /api/refresh` 미가용/실패 환경에서도 client가 `GET /api/snapshot`을 재-fetch하면 마지막 cycle snapshot을 다시 받을 수 있다 — R-API-004의 최소 충족 경로다. 단 이는 **interval 데이터**이고 강제 fresh가 아니다. [[08-Decisions|D-033]]로 **refresh 1차·GET fallback**이 확정됐다(§6 Q5 해소; FE 동작 조율은 [[SPEC-200-frontend-architecture]]).

### 2.9 API error 분리 — R-API-005

API/runtime 오류는 **사용자에게 보이는 표면**과 **local debug log**로 분리 기록하며, 양쪽 모두 [[SPEC-006-privacy-redaction]] sanitize를 통과한다.

- **사용자 표면**:
  - request-bound 오류 → REST 응답 `ApiError` envelope(§2.4). `message`는 사용자 안전 문구(stable, 원문/secret/stack 불포함), `code`는 안정 enum, `requestId`로 로그와 연결.
  - out-of-band runtime 오류(scan 실패·tmux 오류 등 특정 request에 속하지 않음) → 사용자 표면은 (a) `data.diagnostics`/`data.stale`로 snapshot에 반영([[SPEC-005-data-contract]])되고, (b) [[SPEC-102-realtime-sync]] error/diagnostic event로 push된다(payload는 SPEC-102).
- **local debug log**(목적지·포맷은 [[SPEC-600-observability]]): 동일 `requestId`/`errorId` 키로 상세(code·HTTP status·timing·tmux stderr 요약·내부 stack)를 기록한다. **capture 원문은 기록하지 않는다**(R-PRIV-005/R-OBS-003). 양쪽 message는 sanitize 후 값이다([[08-Decisions|D-016]]).
- **분리 원칙(확정)**: 사용자에게는 안정적·비민감 code+message만, 운영자에게는 debug log의 상세만 노출한다. 둘 중 어느 쪽도 terminal raw output을 담지 않는다.

**REST error code ↔ HTTP status 표**:

| HTTP | `code` | 발생 | 비고 |
| --- | --- | --- | --- |
| 400 | `bad_request` | `:campId` 형식 위반, 잘못된 query | message에 입력 echo 시 redaction 적용 |
| 401 | `unauthorized` | token 누락/불일치(state-changing·보호 read) | 검증 메커니즘 [[SPEC-100-server-lifecycle]] |
| 404 | `camp_not_found` | current snapshot에 해당 `camp.id` 없음 | §2.7 |
| 404 | `orc_not_found` | current snapshot에 해당 `orc.id` 없음 | §2.11 preview |
| 404 | `not_found` | 알 수 없는 route | |
| 405 | `method_not_allowed` | 예: `POST /api/snapshot` | read-only endpoint에 mutate 메서드 |
| 422 | `validation_failed` | request body 필드 검증 실패(예: `PATCH /api/settings`) | `error.fieldErrors[]` 포함(envelope §2.4, 의미 [[SPEC-500-settings-persistence]] §2.6) |
| 429 | `refresh_rate_limited` | `POST /api/refresh` rate limit | `Retry-After` 포함(§2.8) |
| 503 | `snapshot_not_ready` | first published snapshot 이전 | `Retry-After` 포함(§2.6) |
| 500 | `internal_error` | uncaught 내부 오류 | `requestId`로 debug log 연결, message는 generic |

- **`422 validation_failed`(확정, [[SPEC-500-settings-persistence]] C1 해소)**: request body 필드 검증 실패에 쓴다. envelope는 §2.4 `ApiError`를 확장해 `error.fieldErrors[]`(`field`·`code`·`message`·`allowed?`)를 싣는다. 이 **확장 shape는 본 spec(envelope)이 소유**하고, settings 필드별 검증 의미(`out_of_range`/`type_mismatch`/`unknown_field`/`redaction_floor_locked`)는 [[SPEC-500-settings-persistence]] §2.6이 소유한다. 경로/형식 위반인 `400 bad_request`와 구분한다(400 = 요청 형식 자체가 잘못, 422 = 형식은 맞으나 필드 값 의미가 규칙 위반).

### 2.10 endpoint 분류 요약 (read-only vs state-changing)

| Method·Path | 분류 | tmux 영향 | token | idempotent | 소유 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health` | read-only | 없음 | **exempt**([[08-Decisions|D-024]]) | 예 | 본 spec |
| `GET /api/snapshot` | read-only | 없음 | 요구 | 예 | 본 spec |
| `GET /api/camps/:campId` | read-only | 없음 | 요구 | 예 | 본 spec |
| `GET /api/orcs/:orcId/preview` | read-only | 없음 | 요구 | 예 | 본 spec(§2.11) |
| `POST /api/refresh` | state-changing(runtime) | **read-only**(scanner) | 요구 | retry-safe(coalesce) | 본 spec |
| `GET /api/settings` | read-only | 없음 | 요구([[08-Decisions|D-024]]) | 예 | [[SPEC-500-settings-persistence]] |
| `PATCH /api/settings` | state-changing | 간접(`scanInterval`→cadence) | 요구 | spec-500 소유 | [[SPEC-500-settings-persistence]] |
| `POST /api/orcs/:orcId/{input,key,interrupt}` | state-changing | **mutate**(send-keys) | 요구 | spec-400 소유 | [[SPEC-400-control-actions]] |

> token 검증·CORS·`127.0.0.1` bind는 모든 endpoint 공통이며 [[SPEC-100-server-lifecycle]]가 소유한다. 본 spec은 **어느 endpoint가 token을 요구하는지**만 분류하고, 검증 구현은 참조한다. [[08-Decisions|D-024]]로 `GET /api/health`와 `/api/events` handshake를 **제외한 모든 `/api/*`가 token을 요구**한다(read 포함). preview는 token + exposure(R-PRIV-006) 이중 gate다(§2.11).

### 2.11 `GET /api/orcs/:orcId/preview` (read-only, per-orc lazy preview text) — R-PRIV-006·R-UI-004, [[08-Decisions|D-026]]

선택된 **단일 orc**의 terminal preview 텍스트를 lazy로 가져오는 경로다. `GET /api/snapshot`은 metadata-only(§2.6, 불변식 ⑤)를 유지하므로 preview **텍스트**는 이 endpoint로만 노출된다. 이는 게이트 P0-1과 [[SPEC-201-dashboard-screens]] U1(inspector preview 데이터 경로 부재)을 해소한다([[08-Decisions|D-026]]).

- **path param**: `:orcId` = [[SPEC-005-data-contract]] `orc.id`(=`"pane:"+paneId`, 정규식 `^pane:%[0-9]+$`, 예 `pane:%12`). 권위는 `paneId`이며 `tmuxTarget`이 아니다([[08-Decisions|D-017]]). reserved char(`:`·`%`) 때문에 client는 percent-encoding을 권장한다(`pane:%12` → `pane%3A%2512`). server는 percent-decode 후 current published snapshot의 `orc.id`와 매칭한다.
- **lazy·per-orc(확정)**: 한 요청은 **하나의 orc** preview만 산출한다. snapshot 전체에 preview 텍스트를 싣지 않는다. 텍스트는 current published snapshot이 보유한 그 orc의 **이미 sanitize된 capture tail**에서 잘라 serve하며, 이 endpoint는 별도 out-of-cycle scan을 트리거하지 않는다(강제 fresh는 `POST /api/refresh`, §2.8과 구분).
- **token gate(확정, [[08-Decisions|D-024]])**: startup token을 요구한다. token 없으면 `401 unauthorized`(검증 메커니즘 [[SPEC-100-server-lifecycle]]).
- **exposure gate(확정, R-PRIV-006, [[SPEC-500-settings-persistence]] §2.7)**: settings `preview.exposureEnabled`가 `false`이면 응답에서 **텍스트를 생략**한다(`preview.text` 미포함, `preview.exposureEnabled:false`). `true`일 때만 redacted tail 텍스트를 포함한다. 노출 줄 수는 `preview.lineCount`(≤ `PREVIEW_LINES`)를 따른다. exposure off 전환은 노출면 최소화의 일부다([[SPEC-201-dashboard-screens]] §2.5).
- **redaction(확정, [[SPEC-006-privacy-redaction]] §2.1/§2.4)**: 반환 `preview.text`는 backend가 `sanitizeCapture` chokepoint를 통과시킨 **redacted tail(최대 `PREVIEW_LINES`줄, 현행 가설 12)**뿐이다. **raw capture(미-redact 원문)는 어떤 필드에도 직렬화하지 않는다**([[08-Decisions|D-016]], R-PRIV-004/005). server-side redaction이 wire 전송 **이전에 항상** 적용된다([[SPEC-006-privacy-redaction]] PF-05 redaction-before-egress를 network 경계로 확장).
- **capture 실패 / 데이터 없음(확정)**: 그 orc의 capture가 실패했거나 보유 tail이 없으면 `preview` 필드를 **`null`**로 반환한다(부분 데이터 위조 금지). HTTP는 `200`을 유지한다(가용성은 데이터로 보고, §3.3 staleness 정신과 정합).
- **응답**: `200` + `OrcPreviewResponse`(§2.4). version 일관성을 위해 current published snapshot과 동일 `snapshotVersion`/`runtimeEpoch`을 carry한다(별도 scan 없음).
- **error**: 형식이 `orc.id` 정규식과 불일치 → `400 bad_request`. current snapshot에 해당 `orc.id` 없음 → `404 orc_not_found`. token 없음 → `401 unauthorized`.
- safe·idempotent. snapshot/runtime state를 바꾸지 않는다(read-only, refresh와 구분).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다.

### 3.1 version bump 결정성(확정)

1. 한 cycle에서 diff(§2.3)가 0건이면(오직 `scannedAt` 전진) `snapshotVersion`은 **불변**이고 published snapshot도 교체하지 않는다. → 같은 version은 항상 동일 content를 가리킨다.
2. diff가 ≥1건이면 `snapshotVersion += 1`, published snapshot을 atomic 교체, event는 새 version을 carry한다.
3. version은 단조 비감소다(절대 되돌아가지 않음, server lifetime 내).

### 3.2 reconnect/recovery 정합(확정, R-API-002 공동)

1. client는 WS 끊김 시 `GET /api/snapshot`을 fetch해 권위 상태와 `snapshotVersion = V`·`runtimeEpoch = E`를 얻는다. 직전 epoch와 `E`가 다르면 server restart이므로 version 비교 없이 즉시 full resync한다(§3.5-4, [[08-Decisions|D-025]]).
2. (같은 epoch 내) client는 version ≤ V인 (buffered) WS event를 **dedup/discard**하고 V 이후 event만 적용한다(ordering 키).
3. MVP는 event replay buffer를 제공하지 않는다 — 복구는 **full REST snapshot 재-fetch**다. gap이 의심되면 client는 다시 `GET /api/snapshot`으로 전체 동기화한다([[SPEC-102-realtime-sync]] reconnect와 정합).

### 3.3 staleness·가용성 serve(확정, R-TMUX-005/006 재사용)

1. published snapshot의 `data.stale`/`data.lastGoodAt`/`data.tmux`는 [[SPEC-002-tmux-discovery]]/[[SPEC-005-data-contract]] 의미를 변형 없이 serve한다.
2. `stale` 전이와 tmux 가용성 전이는 diff 변경 범주이며 version bump + event를 유발한다(§2.3).
3. cold start와 "데이터 없음"을 구분한다: first publish 이전 = `503 snapshot_not_ready`(§2.6), first publish 이후의 빈 상태 = `200` + `camps=[]`(빈 상태 인코딩은 [[SPEC-005-data-contract]] §3.3).

### 3.4 동시성·일관성(확정)

1. published snapshot은 immutable이며 참조 swap으로 교체된다. 동시 GET은 **단일 version의 완전한 snapshot**을 받는다(torn read 없음).
2. `GET /api/snapshot`과 `GET /api/camps/:campId`가 같은 시점에 같은 published version을 가리키면 둘의 camp 데이터는 일관된다.
3. `POST /api/refresh`가 만든 새 published snapshot은 다음 GET부터 보인다(refresh 응답 body는 그 새 version).

### 3.5 memory only·재시작(확정, 재사용)

1. snapshot·last-good·`snapshotVersion`·event buffer·error 상관 데이터는 **메모리에만** 둔다. 디스크 직렬화·캐시 파일 없음.
2. capture 원문은 어떤 응답 필드·debug log·디스크에도 나타나지 않는다([[08-Decisions|D-016]], R-PRIV-004/005). REST API는 [[SPEC-005-data-contract]]/[[SPEC-006-privacy-redaction]]가 허용한 표면 **이상으로 노출 면을 늘리지 않는다**.
3. server 재시작 시 `snapshotVersion`은 `0`에서 다시 시작한다(durable하지 않음, [[08-Decisions|D-025]]). client는 재시작을 full resync로 처리한다(§3.2, [[SPEC-102-realtime-sync]]).
4. **`runtimeEpoch`로 restart 식별(확정, [[08-Decisions|D-025]], Q1·Q6 해소)**: server는 lifetime마다 새 `runtimeEpoch`(불투명 식별자)를 부여하고 `GET /api/health`·`GET /api/snapshot` envelope과 [[SPEC-102-realtime-sync]] §2.4 WS welcome에 **동일 값**으로 싣는다. client가 직전과 다른 `runtimeEpoch`를 관측하면 version 비교에 의존하지 않고 즉시 **full re-snapshot**으로 복구한다(version은 epoch 경계를 넘어 비교하지 않는다). MVP는 event replay buffer를 두지 않는다(§3.2). `recentActivity`(§2.6)도 새 epoch의 ring buffer(빈 상태에서 재시작) 기준으로 재부트스트랩된다([[SPEC-600-observability]] §2.3).

## 4. Acceptance criteria

```text
SPEC-101-AC-01 (R-API-001)
  Given serve 모드 server가 first snapshot을 publish한 상태에서
  When GET /api/snapshot 을 호출하면
  Then 200 + { snapshotVersion(정수 ≥1), emittedAt(ISO 8601), data } 를 반환하고,
       data 는 [[SPEC-005-data-contract]] §2.1 ScanResult schema(schemaVersion=1)에 validate되며
       (camps/orcs/staleness/diagnostics 포함), envelope는 data 내부 필드를 추가·rename하지 않는다.
```

```text
SPEC-101-AC-02 (R-API-001)
  Given 동일 inventory에 대해
  When `orc-camp scan --json` 출력과 GET /api/snapshot 의 data 를 비교하면
  Then 두 payload는 동일 ScanResult 도메인 shape(같은 serializer)이며,
       차이는 본 spec envelope(snapshotVersion/emittedAt)뿐이다(SPEC-005 재사용).
```

```text
SPEC-101-AC-03 (R-API-003)
  Given serve 루프가 여러 cycle을 도는 동안
  When 매 published snapshot의 snapshotVersion을 관측하면
  Then snapshotVersion은 단조 비감소 정수이고,
       content 변경(diff ≥1)이 있는 cycle에서만 정확히 +1 bump되며,
       변경 없는 cycle(오직 scannedAt 전진)에서는 불변이다.
```

```text
SPEC-101-AC-04 (R-API-003)
  Given 한 orc의 status가 cycle 사이에 바뀌어 diff가 변경 event를 산출할 때
  When 새 published snapshot과 그 event를 관측하면
  Then published snapshotVersion == prior+1 이고,
       emit된 변경 event가 carry하는 version == 그 새 snapshotVersion 이다
       (event payload shape은 [[SPEC-102-realtime-sync]]; 본 AC는 version 일치만 검증).
```

```text
SPEC-101-AC-05 (R-API-002)  [공동: [[SPEC-102-realtime-sync]]]
  Given WS 끊김 후 client가 GET /api/snapshot 으로 snapshotVersion V 를 얻은 뒤
  When version ≤ V 인 event를 받으면
  Then client는 그 event를 dedup/discard하고 V 이후 event만 적용할 수 있으며,
       gap 의심 시 GET /api/snapshot 재-fetch로 full resync된다(event replay buffer 없음).
```

```text
SPEC-101-AC-06 (R-API-004)
  Given interval 중간 시점에
  When POST /api/refresh 를 호출하면
  Then 200 + SnapshotResponse 를 반환하고,
       반환된 data.scannedAt 은 요청 시각 이후의 out-of-cycle scan 결과(강제 fresh)이며,
       단순히 직전 published snapshot을 재반환한 것이 아니다(coalesce 케이스 제외).
```

```text
SPEC-101-AC-07 (R-API-004, [[08-Decisions|D-019]])
  Given POST /api/refresh 처리 중
  When 실제 spawn된 subprocess argv를 관측하면
  Then 호출은 [[SPEC-002-tmux-discovery]] allowlist(list-sessions/list-windows/list-panes/capture-pane/-V)
       및 process introspection(ps)뿐이고, send-keys/paste-buffer 등 상태 변경 command는
       한 번도 호출되지 않는다(refresh는 tmux read-only).
```

```text
SPEC-101-AC-08 (R-API-004)
  Given R_min 간격 내에 다수의 POST /api/refresh 가 동시/연속 도착할 때
  When server가 이를 처리하면
  Then 추가 scan을 중복 spawn하지 않고 진행 중 scan에 coalesce하거나
       429 refresh_rate_limited + Retry-After 로 거부하여, scan storm이 발생하지 않는다
       (단일 in-flight scan 불변식 유지).
```

```text
SPEC-101-AC-09 (R-API-005)
  Given 어떤 REST 요청이 오류를 유발할 때
  When 응답과 local debug log를 비교하면
  Then 응답은 { error:{ code, message, requestId } } envelope로 사용자 안전 message만 담고,
       동일 requestId 키로 debug log에 상세(code·status·timing·내부 detail)가 기록되어
       사용자 표면과 운영 로그가 분리된다.
```

```text
SPEC-101-AC-10 (R-API-005, R-PRIV-005/R-OBS-003)
  Given capture/입력에 알려진 secret 샘플이 관여한 오류 경로에서
  When 사용자 응답 message와 debug log 항목을 검사하면
  Then 양쪽 모두 [[SPEC-006-privacy-redaction]] sanitize를 통과한 값이며,
       capture된 terminal 원문·secret literal을 포함하지 않는다.
```

```text
SPEC-101-AC-11 (R-API-005, R-TMUX-005)
  Given serve 루프의 한 cycle에서 inventory 수집이 실패하고 last-good이 있을 때
  When GET /api/snapshot 을 호출하면
  Then 200 + data.stale=true, data.lastGoodAt < data.scannedAt 로 last-good을 serve하고,
       그 실패는 (a) data.diagnostics 에 반영되며 (b) debug log에 기록되고,
       runtime 오류가 전체 API 장애로 전파되지 않는다(REST는 계속 응답).
```

```text
SPEC-101-AC-12 (R-API-003, [[08-Decisions|D-017]])
  Given current snapshot에 camp.id="session:$0" 인 camp가 있을 때
  When GET /api/camps/session%3A%240 (percent-encoded) 을 호출하면
  Then 200 + CampResponse(data = 그 Camp, sessionId 권위 매칭)를 반환하고,
       존재하지 않는 id는 404 camp_not_found, 형식 위반은 400 bad_request 이며,
       매칭은 tmuxSessionName이 아니라 sessionId로 수행된다.
```

```text
SPEC-101-AC-13 (R-API-004, R-SEC-003)
  Given endpoint 분류(§2.10)에 대해
  When 각 endpoint를 token 없이 호출하면
  Then GET /api/snapshot·/api/camps/:id 와 state-changing POST /api/refresh 는
       401 unauthorized 로 거부되고(검증 메커니즘 [[SPEC-100-server-lifecycle]]),
       GET 계열은 safe·idempotent하며 POST /api/refresh 만 runtime state를 바꾼다.
```

```text
SPEC-101-AC-14 (R-API-001)  [liveness]
  Given server가 살아있는(또는 cold start) 상태에서
  When GET /api/health 를 호출하면
  Then 200 + { status:'ok', snapshotVersion, scannerRunning, lastScanAt, lastScanOk, stale, tmux, uptimeMs } 를
       반환하고, camp/orc/preview/cwd/summary 등 workspace 파생 데이터와 terminal 원문을 포함하지 않는다.
```

```text
SPEC-101-AC-15 (R-API-001)  [동시성·일관성]
  Given scan cycle이 published snapshot을 교체하는 도중에
  When 동시 GET /api/snapshot 요청들이 도착하면
  Then 각 응답은 단일 snapshotVersion의 완전한 snapshot(torn read 없음)이고,
       ETag가 현재 version과 같은 If-None-Match 요청은 304 Not Modified 를 받는다.
```

```text
SPEC-101-AC-16 (R-API-003, [[08-Decisions|D-016]])  [memory only]
  Given server가 여러 cycle 운영 후 재시작될 때
  When 디스크와 재시작 후 상태를 검사하면
  Then snapshot·last-good·snapshotVersion·event buffer는 디스크에 저장되지 않고,
       어떤 파일/응답/로그에도 capture 원문이 없으며,
       재시작 후 snapshotVersion은 0(이후 first publish시 1)에서 다시 시작한다.
```

```text
SPEC-101-AC-17 (R-PRIV-006, [[08-Decisions|D-024]], [[08-Decisions|D-026]])  [preview endpoint — gate·redacted tail]
  Given preview.exposureEnabled=true·valid token이고 current snapshot에 orc.id="pane:%12"가 있을 때
  When GET /api/orcs/pane%3A%2512/preview (percent-encoded) 를 호출하면
  Then 200 + OrcPreviewResponse 를 반환하고 preview.text 는 [[SPEC-006-privacy-redaction]]
       sanitizeCapture 산출의 redacted tail(≤ preview.lineCount ≤ PREVIEW_LINES)뿐이며,
       raw capture(미-redact 원문)는 어떤 응답 필드에도 직렬화되지 않고,
       동일 호출을 token 없이 하면 401 unauthorized 로 거부된다([[08-Decisions|D-024]]).
```

```text
SPEC-101-AC-18 (R-PRIV-006, [[08-Decisions|D-026]])  [exposure off·실패 fallback·식별]
  Given valid token으로 GET /api/orcs/:orcId/preview 를 호출할 때
  When (a) preview.exposureEnabled=false 이거나 (b) 그 orc의 capture가 실패/미보유이거나
        (c) orcId가 orc.id 정규식 위반 또는 (d) 존재하지 않는 orc.id 인 경우
  Then (a)는 200 이되 preview.text 를 생략(preview.exposureEnabled:false)하고,
       (b)는 200 + preview:null(부분 데이터 위조 없음)이며,
       (c)는 400 bad_request, (d)는 404 orc_not_found 를 반환하고,
       어떤 경우에도 raw capture 원문이 응답에 나타나지 않는다.
```

```text
SPEC-101-AC-19 (R-API-005, [[SPEC-500-settings-persistence]] §2.6)  [422 envelope]
  Given 필드 검증을 위반하는 PATCH /api/settings 요청이 처리될 때
  When 응답을 검사하면
  Then 422 validation_failed + ApiError envelope(§2.4)를 반환하고,
       error.fieldErrors[]({field, code, message, allowed?})로 위반 필드를 식별하며,
       message·fieldErrors 어디에도 capture 원문/secret 이 없고(redaction 통과),
       경로/형식 위반인 400 bad_request 와 구분된다(필드 검증 의미는 [[SPEC-500-settings-persistence]] 소유).
```

```text
SPEC-101-AC-20 (R-OBS-001 정합, [[SPEC-600-observability]] §2.4)  [activity bootstrap tail]
  Given serve 모드 server가 activity ring buffer에 event를 보유한 상태에서
  When GET /api/snapshot 을 호출하면
  Then SnapshotResponse.recentActivity 가 최근 ACTIVITY_BOOTSTRAP_TAIL(가설 50)개 이하의
       ActivityEvent([[SPEC-600-observability]] §2.1 shape)로 채워져 dashboard activity rail을
       부트스트랩할 수 있고, client는 id로 dedup해 live activity frame과 중복 없이 합칠 수 있으며,
       recentActivity 변화는 snapshotVersion 을 bump하지 않는다(activity ≠ snapshot state).
```

```text
SPEC-101-AC-21 (R-API-003, [[08-Decisions|D-025]])  [runtimeEpoch restart parity]
  Given server가 실행 중 재시작될 때
  When GET /api/health·GET /api/snapshot·WS welcome([[SPEC-102-realtime-sync]] §2.4)의 runtimeEpoch를 비교하면
  Then 한 server lifetime 동안 세 경로가 동일 runtimeEpoch를 보고하고,
       재시작 후에는 새 runtimeEpoch(이전과 다름)와 snapshotVersion 0→1 재시작이 관측되어,
       client가 version 비교에 의존하지 않고 restart를 감지해 full re-snapshot으로 복구한다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-API-003 | server-runtime `snapshotVersion`(sequence id) 정의·단조 bump 규칙([[08-Decisions\|D-025]])·event 참조·diff engine·camp id 권위·`runtimeEpoch` restart 식별([[08-Decisions\|D-025]]) | SPEC-101-AC-03, AC-04, AC-12, AC-16, AC-21 |
| R-API-004 | `POST /api/refresh`(즉시 out-of-cycle scan, tmux read-only, coalesce/rate-limit) 1차 + GET 재-fetch fallback([[08-Decisions\|D-033]]) | SPEC-101-AC-06, AC-07, AC-08, AC-13 |
| R-API-005 | API error 분리(사용자 envelope vs debug log, requestId 상관), 양쪽 redaction, 원문 비기록, `422 validation_failed` envelope(+`fieldErrors[]`) | SPEC-101-AC-09, AC-10, AC-11, AC-19 |
| R-PRIV-006 (데이터 경로/API 절반) | `GET /api/orcs/:orcId/preview` per-orc lazy endpoint: token([[08-Decisions\|D-024]]) + exposure([[SPEC-500-settings-persistence]]) 이중 gate, backend-redacted tail(≤ `PREVIEW_LINES`, [[SPEC-006-privacy-redaction]]), raw 미직렬화, capture 실패 → `null`. snapshot은 metadata-only 유지([[08-Decisions\|D-026]]) | SPEC-101-AC-17, AC-18 |

> 공동/부수 충족(1차 소유는 타 spec): **R-API-001**(REST 초기 snapshot — 본 spec REST 절반, WS 절반은 [[SPEC-102-realtime-sync]]): AC-01, AC-02, AC-14, AC-15. **R-API-002**(reconnect 복구 — REST snapshot 복구 경로): AC-05([[SPEC-102-realtime-sync]] 공동). **R-TMUX-005**(staleness serve): AC-11 — 1차 [[SPEC-002-tmux-discovery]]. **R-SEC-003**(state-changing·read token 거부): AC-13, AC-17 — 1차 [[SPEC-100-server-lifecycle]]([[08-Decisions|D-024]]). **R-PRIV-004/005·R-OBS-003**(원문 비저장·log redaction): AC-10, AC-16, AC-17 — 1차 [[SPEC-006-privacy-redaction]]/[[SPEC-600-observability]]. **R-OBS-001**(activity bootstrap tail — snapshot 배치): AC-20 — 1차 [[SPEC-600-observability]]. **R-UI-004**(inspector preview 데이터 경로): AC-17, AC-18 — 1차 [[SPEC-201-dashboard-screens]](UI), 본 spec은 데이터 경로. 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream

- **C1 — 청사진 REST 표 보강**: [[05-Backend]] "API 설계" REST 표에는 `GET /api/health`·`/api/snapshot`·`/api/camps/:campId`만 있고 manual refresh endpoint가 없다. 본 spec은 R-API-004 충족을 위해 `POST /api/refresh`를 추가했다(state-changing 표면, tmux read-only). [[08-Decisions|D-033]]로 `POST /api/refresh`가 1차 경로로 확정됐다 → spec 측은 닫힘, **청사진 REST 표 갱신만 잔존**(orchestrator).
- **C2 — WS event 예시의 `campId`/`version`**: [[05-Backend]] WebSocket 예시는 `"campId": "session:work"`(이름 기반)·`"version": 42`를 쓴다. 본 spec은 `snapshotVersion`(server-runtime 권위, [[08-Decisions|D-017]] sessionId 기반 id)으로 고정한다. event payload는 [[SPEC-102-realtime-sync]] 소유이나 **id 권위·version 출처**는 본 spec/[[SPEC-005-data-contract]]와 정합화 필요.
- **C3 — preview-text 데이터 경로 추가([[08-Decisions|D-026]]; 게이트 P0-1·[[SPEC-201-dashboard-screens]] U1 해소)**: [[05-Backend]] REST 표·snapshot 예시는 preview를 metadata-only로만 두어 inspector preview(R-UI-004)·R-PRIV-006의 **텍스트 데이터 경로가 없었다**. 본 spec은 §2.11 `GET /api/orcs/:orcId/preview`(token + exposure 이중 gate, backend-redacted tail)로 이를 추가하고 `GET /api/snapshot`은 metadata-only를 유지한다 → 청사진 REST 표에 preview 행 추가 권고(orchestrator).
- **C4 — `422 validation_failed` envelope 추가([[SPEC-500-settings-persistence]] C1 해소)**: §2.9 error 표에 `422 validation_failed`(+`error.fieldErrors[]`)를 추가했다. envelope 확장 shape는 본 spec, settings 필드별 검증 의미는 [[SPEC-500-settings-persistence]] §2.6 소유. `400 bad_request`(형식)와 구분.
- **C5 — snapshot `recentActivity` bootstrap tail([[SPEC-600-observability]] C1 해소)**: §2.4/§2.6 envelope에 `recentActivity`(`ActivityEvent` tail, 개수 `ACTIVITY_BOOTSTRAP_TAIL`)를 추가해 dashboard activity rail 부트스트랩 경로를 확정했다. item shape·taxonomy·개수 산출은 [[SPEC-600-observability]] 소유, 본 spec은 **배치**만.

### Open Questions (검토 필요)

- **Q1 — version bump 정책 (해소: [[08-Decisions|D-025]])**: "변경 tick당 +1(변경 없으면 미증가)·atomic-commit(partial batch 직렬화 금지)·version↔diff-batch 1:1"로 [[08-Decisions|D-025]]가 §2.2/§3.1을 확정했다. reconnect dedup(§3.2)·WS event 정합은 [[SPEC-102-realtime-sync]]와 동일 계약을 공유한다. **닫힘.**
- **Q2 — refresh rate-limit 값(가설)**: `R_min=1s`·coalesce vs 429 정책은 **PoC 검증 가설**이다. scan latency(p95)·동시 클릭 패턴으로 보정([[SPEC-007-test-validation]] 측정 절차).
- **Q3 — health/snapshot의 token 요구 (해소: [[08-Decisions|D-024]])**: read API도 startup token으로 보호한다 — `GET /api/health`와 `/api/events` handshake만 token-exempt이고 snapshot/camps/preview/settings 등 나머지 `/api/*`는 token 요구다(§2.5/§2.10). 검증 메커니즘·CORS·`127.0.0.1` bind는 [[SPEC-100-server-lifecycle]] 소유. **닫힘.**
- **Q4 — conditional GET(ETag/304) MVP 포함 여부(검토 필요)**: §2.6/§2.7의 ETag는 효율 최적화다. MVP 필수가 아니면 후속으로 미룰 수 있다. FE polling 패턴([[SPEC-200-frontend-architecture]])과 조율.
- **Q5 — manual refresh 경로 (해소: [[08-Decisions|D-033]])**: `POST /api/refresh`(out-of-cycle 강제 scan, tmux read-only, coalesce + rate-limit)를 1차로, `GET /api/snapshot` 재요청을 fallback으로 확정했다(§2.8). FE 동작 조율은 [[SPEC-200-frontend-architecture]]. **닫힘.**
- **Q6 — `snapshotVersion` 비-durable·restart 식별 (해소: [[08-Decisions|D-025]])**: version은 non-durable이고 restart는 `runtimeEpoch`로 식별한다 — `GET /api/health`·`GET /api/snapshot`·WS welcome([[SPEC-102-realtime-sync]] §2.4)이 **동일 epoch**를 보고하고, 복구는 full re-snapshot이다(§3.2/§3.5-4). `runtimeEpoch` 발급·WS welcome shape는 [[SPEC-102-realtime-sync]] 소유. **닫힘.**
- **Q7 — `scanInterval` live-reload**: `PATCH /api/settings`로 interval을 바꾸면 다음 cycle부터 즉시 반영하는지, 재시작이 필요한지 [[SPEC-500-settings-persistence]]와 정합 필요(본 spec은 즉시 반영을 가정).
- **Q8 — out-of-band runtime 오류의 사용자 event vs diagnostics 중복**: scan 실패를 (a) `data.diagnostics`·`data.stale`과 (b) [[SPEC-102-realtime-sync]] error event 양쪽으로 노출할 때 중복/우선순위를 SPEC-102와 공동 정의 필요(§2.9).
