---
spec: SPEC-201
title: Dashboard 화면 (camp list/detail/inspector/preview)·상태
status: approved
updated: 2026-06-28
requirements: [R-UI-001, R-UI-002, R-UI-003, R-UI-004, R-UI-005, R-UI-007, R-PRIV-006]
decisions: [D-002, D-005, D-017, D-021]
tags:
  - specs
  - frontend
  - dashboard
  - screens
  - epic-3
---

# SPEC-201 — Dashboard 화면 (camp list/detail/inspector/preview)·상태

Orc Camp dashboard의 **화면 표면(screen surface)**과 **그 화면이 표시하는 콘텐츠·상태**의 단일 진실 공급원(SSOT)이다. [[SPEC-200-frontend-architecture]]가 라우팅·store·데이터 흐름이라는 *앱 골격*을 소유한다면, 본 spec은 그 골격 위에 올라가는 **camp list / camp detail / orc inspector / terminal preview** 4개 화면 슬라이스의 **레이아웃·콘텐츠 매핑·상태 렌더링·preview 노출 동작**을 고정한다. 표시할 필드의 값은 [[SPEC-005-data-contract]] `ScanResult`를, 변경 신호는 [[SPEC-102-realtime-sync]]를 그대로 소비한다.

> **소유 경계**:
> - **소유(본 spec)**: 화면 인벤토리·각 화면의 콘텐츠 매핑(어떤 SPEC-005 필드를 어디에 그리는가)·7종 dashboard 상태의 **구분 렌더링**·terminal preview 렌더링 컴포넌트와 **노출/line-count 동작(R-PRIV-006 UI·behavior)**·orc 배치/선택(placement/selection)·raw tmux target 상시 노출(R-UI-007).
> - **참조(타 spec 소유)**: 앱 라우팅·store·server/client state 분리·데이터 흐름 → [[SPEC-200-frontend-architecture]]. design token·키보드 내비·contrast·motion → [[SPEC-202-design-accessibility]]. sprite 애니메이션·상태머신·asset fallback → [[SPEC-300-asset-rendering]](본 spec은 sprite를 **어디에 놓고 어떻게 선택**하는지만 소유, 그 sprite가 **무엇을 그리는지**는 SPEC-300). control action flow(modal·target 재검증·optimistic update) → [[SPEC-400-control-actions]](본 spec은 inspector의 **진입점**만 소유). snapshot/REST·WS 계약 → [[SPEC-101-snapshot-api]] / [[SPEC-102-realtime-sync]]. preview/redaction 규칙·`preview.text` 내용 제약 → [[SPEC-006-privacy-redaction]]. settings **저장 값**(preview line count·exposure) → [[SPEC-500-settings-persistence]](본 spec은 그 값을 읽고 쓰는 **UI·동작**만 소유). activity log payload → [[SPEC-600-observability]].

> **불변식(확정)**:
> - **① 표시 전용 vs 권위 식별자**: 화면에 그리는 `tmuxTarget`/`tmuxSessionName`은 표시 전용이고, 선택·키·재조립의 권위는 `orcId`(`pane:`+paneId)/`campId`(`session:`+sessionId)다([[08-Decisions|D-017]]). raw tmux target은 **항상** 노출한다(R-UI-007).
> - **② 사실 단정 금지**: `status`는 항상 `statusConfidence`와 함께, `currentWorkSummary`는 `summaryIsEstimated`/`summarySource`와 함께 렌더한다(R-ORC-005, [[SPEC-005-data-contract]] §3.6).
> - **③ frontend는 redaction을 하지 않는다**: terminal preview에 그리는 텍스트는 backend가 이미 redaction한 `preview.text`(redacted tail)뿐이다([[SPEC-006-privacy-redaction]], [[08-Decisions|D-016]]). frontend는 원문을 받지도, 재구성하지도, 추가 마스킹하지도 않는다.
> - **④ 상태는 색만으로 전달하지 않는다**: 모든 status·dashboard 상태는 icon/label/pose를 함께 쓴다([[DESIGN]] Usage Rules, 비기능 접근성).

## 1. Scope

### In scope

- **화면 인벤토리(4 슬라이스)**: Camp List(`/`, R-UI-001/002), Camp Detail(`/camps/:campId`, R-UI-003), Orc Inspector(detail 내 panel, R-UI-004), Terminal Preview(inspector 내 컴포넌트 + 노출/line-count 동작, R-PRIV-006).
- **콘텐츠 매핑**: 각 화면 요소가 소비하는 [[SPEC-005-data-contract]] 필드의 정확한 매핑과 표시 의무(R-UI-002/003/004, R-UI-007).
- **7종 dashboard 상태의 구분 렌더링**(R-UI-005): `loading` / `tmux-not-installed`(empty-tmux) / `no-session` / `no-agent-detected` / `tmux-error` / `disconnected` / `stale-snapshot`. SPEC-005 빈상태 인코딩 + [[SPEC-102-realtime-sync]] disconnected/stale 신호로의 매핑.
- **상태 레이어링 규칙**: 전체화면 교체 상태 vs overlay(banner/badge) 상태 vs 범위 한정(per-camp/per-orc) 상태의 우선순위·공존 규칙.
- **orc 배치/선택**: camp scene 내 window/pane → lane/slot 배치, 선택 상태, 비-orc pane 처리(placement/selection만; sprite는 [[SPEC-300-asset-rendering]]).
- **Terminal Preview 컴포넌트 계약**: preview 메타(`{lines,truncated,redacted,text?}`) 렌더, 노출 on/off 토글, line-count 컨트롤, redacted/truncated 표시, `preview=null`(capture 실패) vs 빈 preview(`lines=0`) 구분, 텍스트 선택/복사.
- **per-component 표준 상태**: loading / empty / error / no-data 분기.

### Out of scope (다른 spec으로)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| 라우팅 정의·store 구조·server/client state 분리·snapshot↔WS 재조립 적용 위치 | 앱 아키텍처 | [[SPEC-200-frontend-architecture]] |
| design token·색/타이포 값·키보드 내비 순서·focus·contrast·reduced-motion 정책 | 디자인 시스템·접근성 | [[SPEC-202-design-accessibility]] |
| sprite frame·상태→pose 매핑·애니메이션·asset 미탑재 placeholder 렌더 | asset 런타임 | [[SPEC-300-asset-rendering]] |
| control modal·target 재검증·allowlist key·optimistic update·confirm flow | control 액션 | [[SPEC-400-control-actions]] |
| `GET /api/snapshot`/`/api/camps/:campId`/manual refresh response shape, `version` 생성 | snapshot runtime | [[SPEC-101-snapshot-api]] |
| WS event envelope·reconnect·gap→resync·disconnected/stale **신호 산출** | realtime sync | [[SPEC-102-realtime-sync]] |
| preview redaction 패턴·line/byte cap **값**·`preview.text` 내용 불변식 | privacy 계약 | [[SPEC-006-privacy-redaction]] |
| preview line count·exposure **저장 값**·settings API | settings 영속화 | [[SPEC-500-settings-persistence]] |
| activity log 항목 payload·event history | observability | [[SPEC-600-observability]] |

## 2. Contract

### 2.1 화면 인벤토리와 라우팅 바인딩

라우팅 정의는 [[SPEC-200-frontend-architecture]] / [[04-Frontend]] 소유다. 본 spec은 각 route가 **무엇을 렌더하는가**만 고정한다.

| # | 화면 | route(참조) | 주요 컴포넌트(역할은 [[04-Frontend]]) | 다루는 R-* |
| --- | --- | --- | --- | --- |
| 1 | Camp List | `/` | `CampListView` · `CampCard` · `StatusSummaryBar` | R-UI-001, R-UI-002 |
| 2 | Camp Detail | `/camps/:campId` | `CampDetailView` · `CampScene` · (`OrcSprite` → SPEC-300) | R-UI-003 |
| 3 | Orc Inspector | `/camps/:campId`(panel; `?orc=<orcId>`) | `OrcInspector` · control 진입점(→ SPEC-400) | R-UI-004 |
| 4 | Terminal Preview | inspector 내부 컴포넌트 | `TerminalPreview` + 노출/line 컨트롤 | R-PRIV-006 |

- deep link: `/camps/:campId?orc=<orcId>`로 camp + 선택 orc를 복원한다. `campId`/`orcId`는 권위 식별자(`session:`+sessionId / `pane:`+paneId, [[08-Decisions|D-017]])다. 해당 entity가 현재 snapshot에 없으면 §3.7 not-found 처리. (deep link 라우팅 메커니즘 자체는 [[SPEC-200-frontend-architecture]].)

### 2.2 Camp List 콘텐츠 매핑 (R-UI-001, R-UI-002)

`CampListView`는 dashboard **첫 화면**이며 marketing hero가 아니다([[DESIGN]] Layout). `ScanResult.camps[]`를 `tmuxSessionName` 오름차순([[SPEC-005-data-contract]] §3.4)으로 렌더한다. repeated item에만 card를 쓴다([[DESIGN]] Layout).

**`CampCard`(camp 1개) 콘텐츠 — 모든 항목 SPEC-005 `Camp` 필드 직매핑:**

| card 요소 | SPEC-005 필드 | 표시 의무 |
| --- | --- | --- |
| session 이름 | `tmuxSessionName` | 표시 전용(rename 가변) |
| raw target 식별 | `sessionId`(via `campId`) | R-UI-007: session 식별자 상시 노출 |
| window 수 | `windowCount` | — |
| pane 수 | `paneCount` | 비-orc 포함 |
| detected orc 수 | `orcCount` | `= orcs.length` |
| active count | `statusSummary.active` | **필수**(R-UI-002) |
| waiting count | `statusSummary.waiting` | **필수**(R-UI-002) |
| error count | `statusSummary.error` | **필수**(R-UI-002) |
| stale count | `statusSummary.stale` | **필수**(R-UI-002) |
| (보강) idle/unknown/terminated | `statusSummary.{idle,unknown,terminated}` | 권장(7키 완전 표시), 색만으로 구분 금지 |
| last activity | `lastActivityAt` | null이면 "—"; 상대 표기 허용 |

- status count는 **icon+label+숫자**로 표시한다(색만으로 구분 금지). count가 0이면 시각적으로 약화하되 4개 필수 status 슬롯은 유지해 camp 간 비교를 보존한다.
- **`StatusSummaryBar`**(global): 최상위 `ScanResult.statusSummary`(모든 camp 합)를 요약 표시한다(R-UI-001 "어디에 멈춘 agent가 있는가"를 첫 화면에서). camp별 `statusSummary`의 합과 일치한다([[SPEC-005-data-contract]] §3.2-5).
- card 클릭 → `/camps/:campId`. 선택 entity의 권위 키는 `campId`다.

### 2.3 Camp Detail · CampScene 콘텐츠/배치 (R-UI-003)

`CampDetailView`는 full-bleed pixel camp scene을 중심에 두고 inspector/activity rail을 좌우·하단 dock으로 배치한다([[DESIGN]] Layout, 3-pane). `CampScene`은 선택된 camp(`campId`)의 `Camp` 객체를 소비한다.

- **scene = 조작 표면**: 장식 배경이 아니라 agent 위치/상태를 드러낸다([[03-UX-UI]] Pixel Art 적용). 본 spec은 **layout/placement/selection**을 소유하고, 그 자리에 그려지는 sprite(pose·애니메이션·placeholder)는 [[SPEC-300-asset-rendering]]이 소유한다.

> **NOTE (cross-ref, 공간 맵)**: camp detail의 orc **배치는 이제 [[SPEC-301-camp-map-movement]]가 공간 pixel 맵(zone=window·station=status·slot=paneId)으로 소유**한다. 본 §2.3의 lane/slot 의미는 그 맵 **아래에 보존**된다: window=lane → **zone**, pane=slot → station 주변 **slot fan-out**(배치 키는 reindex 불변을 위해 `paneId`, [[08-Decisions|D-017]]). 본 spec은 콘텐츠 매핑·selection(`?orc=<orcId>`)·비-orc pane·layout 안정성을 계속 소유하고, **공간 좌표 함수·movement/roaming·맵 render contract**는 SPEC-301이 소유한다(§6 Q4 DOM↔canvas도 SPEC-301에서 DOM=기본/canvas=P2로 해소).
- **배치 모델(window 그룹핑; scene 좌표는 SPEC-301)**: orc를 `windowIndex`로 그룹핑한다(window 단위 묶음 의미 보존). **scene 공간 배치 좌표·그룹 내부 정렬은 [[SPEC-301-camp-map-movement]]가 소유**한다(zone=window·station=status·slot=paneId fan-out; 배치 키는 reindex 불변을 위해 `paneId`, [[08-Decisions|D-017]]). `paneIndex` 오름차순 정렬은 **list/table 등 비-scene 표시**에 한정 적용된다([[SPEC-005-data-contract]] §3.4). group(zone) 헤더에 window 식별을 표기한다.
- **orc slot 콘텐츠**: 각 slot은 `OrcSprite`(상태 visual, SPEC-300) + status badge(label) + raw target 라벨(`tmuxTarget`, R-UI-007)을 가진다. status badge는 `status`(+`statusConfidence` 시각 강도)로 그린다(사실 단정 금지).
- **비-orc pane 처리(확정)**: `orcs[]`에 없는 pane(비-candidate, `paneCount > orcCount`)은 orc로 렌더하지 않는다([[SPEC-005-data-contract]] §3.2-2). camp의 `paneCount`/`windowCount` 집계로만 반영하고, scene은 빈 camp slot 또는 비활성 tile로 표현해 "이 window엔 agent가 없다"를 드러낼 수 있다(선택적; layout shift 금지 — §3.6).
- **선택(selection)**: slot 클릭/포커스 → `?orc=<orcId>`로 inspector를 연다. 선택 상태는 client state(selected orc, [[04-Frontend]] Client State)이며 권위 키는 `orcId`다. 동일 paneId가 reindex로 `tmuxTarget`이 바뀌어도 선택은 유지된다([[08-Decisions|D-017]]).
- **layout 안정성**: orc 추가/상태 변화/hover로 lane·slot의 aspect ratio가 바뀌어 layout shift가 나면 안 된다([[DESIGN]] Spacing/Motion, §3.6).
- camp detail 헤더는 `tmuxSessionName` + `sessionId` + 집계(`orcCount`/`statusSummary`/`lastActivityAt`)를 표시한다(R-UI-007 raw 식별 상시 노출).

### 2.4 Orc Inspector 콘텐츠 매핑 (R-UI-004)

`OrcInspector`는 선택된 orc(`orcId`)의 `Orc` 객체를 소비한다. R-UI-004가 요구하는 4영역(metadata, status confidence, current work summary, terminal preview, control 진입점)을 모두 포함한다.

| inspector 영역 | SPEC-005 `Orc` 필드 | 표시 의무 |
| --- | --- | --- |
| agent type | `agentType` + `agentTypeConfidence` | type+confidence 동반(단정 금지). `unknown`이면 명시(낮은 confidence) |
| raw tmux target | `tmuxTarget` + `paneId` | **R-UI-007: 항상 노출**, 권위는 `paneId` |
| 위치 | `sessionName` · `windowIndex` · `paneIndex` | — |
| working directory | `cwd` | redaction 통과값([[SPEC-006-privacy-redaction]] §2.3) |
| command | `command` | monospace |
| status | `status` + `statusConfidence` | **항상 confidence 동반**(R-ORC-005). 7종 enum |
| current work summary | `currentWorkSummary` + `summarySource` + `summaryIsEstimated` | `summaryIsEstimated=true`면 **estimated 마커**(추정값 강조), `summarySource` 표시. null이면 "no summary"(`summarySource=unknown`) |
| last activity | `lastActivityAt` | — |
| (보강) provenance | `agentSignals`/`statusSignals`(ruleId만) | 선택적 "why" 디스클로저(redaction-safe, [[SPEC-005-data-contract]] §3.5) |
| terminal preview | `preview` | §2.5 `TerminalPreview` |
| control 진입점 | — | send/key/interrupt 액션 진입 버튼. **flow는 [[SPEC-400-control-actions]]** |

- **estimated 마커 규칙**: `summaryIsEstimated=true`(자동 추정) → "estimated"/`~` 류 시각 마커를 summary 옆에 둔다. `user_label`로만 `false`일 수 있다([[SPEC-005-data-contract]] §3.6-3). summary가 추정임을 사용자가 사실로 오해하지 않게 한다([[02-Requirements]] Observation 수용 기준, [[03-UX-UI]] Open Question).
- **control 진입점만 소유**: inspector는 control 액션의 **버튼/진입점**을 렌더하지만 modal·target 재검증·optimistic update·결과 반영은 [[SPEC-400-control-actions]] 소유다. 진입점은 control이 불가한 조건(token 부재·orc `terminated`/`stale`·`disconnected`)에서 disabled로 표시한다(상세 enable/disable 규칙은 SPEC-400과 조율 — §6 Q4).
- terminated/stale orc: 즉시 제거하지 않고([[SPEC-005-data-contract]] §3.2-6, R-ORC-006) 마지막 정상 metadata를 유지하며 종료/stale 라벨과 refresh 안내를 표시한다([[04-Frontend]] 오류 처리).

### 2.5 Terminal Preview 컴포넌트 계약 (R-PRIV-006 — 본 슬라이스 소유)

[[08-Decisions|D-021]]에 따라 scan-MVP는 preview를 metadata-only로 두고 R-PRIV-006(노출 여부·line count 조정)을 **preview 텍스트를 실제 렌더하는 이 슬라이스**로 미뤘다. 따라서 preview **렌더링·노출 동작은 본 spec이 소유**한다. 저장되는 setting 값은 [[SPEC-500-settings-persistence]](R-SET-001 preview line count·exposure) 소유다.

**입력 데이터(읽기 전용)**: `Orc.preview: Preview | null`([[SPEC-005-data-contract]] §2.7).

```ts
// SPEC-005 §2.7 재인용(소유 아님): shape는 SPEC-005, 내용 제약은 SPEC-006
interface Preview {
  lines: number;        // redacted tail 줄 수(노출/잠재 노출 가능 줄 수), ≥0
  truncated: boolean;   // lines > PREVIEW_LINES 또는 byteClamped
  redacted: boolean;    // redaction 매칭이 1개 이상 있었는가
  text?: string[];      // 있으면 redacted tail(≤ PREVIEW_LINES). backend가 이미 redaction함
}
```

**컴포넌트 props(본 spec 소유):**

```ts
interface TerminalPreviewProps {
  preview: Preview | null;        // selected orc의 preview 메타(+선택적 redacted text)
  exposureEnabled: boolean;       // 노출 on/off (settings 미러, SPEC-500 저장)
  lineCount: number;              // 표시 희망 줄 수 (settings 미러, SPEC-500 저장)
  onToggleExposure(next: boolean): void;   // → PATCH /api/settings (SPEC-500)
  onChangeLineCount(next: number): void;   // → PATCH /api/settings (SPEC-500)
}
```

**렌더 규칙(확정):**

1. **`preview === null`(capture 실패)** → "preview unavailable" 상태로 렌더한다. 이는 §3.7 "capture 실패" 상태이며 **빈 preview(`lines=0`)와 구분**한다(capture 실패 vs 출력 없음).
2. **`exposureEnabled === false`** → 텍스트를 렌더하지 않는다. "Preview hidden" placeholder + show 토글만 표시하고, `preview.text`를 **요청·표시하지 않는다**(노출면 최소화). `redacted`/`truncated` 같은 메타 배지도 텍스트 없이 표시 가능하다.
3. **`exposureEnabled === true`** → `preview.text`를 표시한다. 표시 줄 수는 `min(lineCount, preview.text.length)`이며, 가용 tail(`preview.text`, ≤ `PREVIEW_LINES`)을 초과하는 줄을 합성하지 않는다(frontend가 데이터를 만들어내지 않는다).
4. **redaction 표시**: `preview.redacted === true`면 "redacted" 배지를 표시한다(민감정보 노출 가능성을 계속 인지시킴 — [[03-UX-UI]] UX 원칙). 텍스트의 `[REDACTED:*]` 토큰은 backend 산출 그대로 렌더한다(frontend 추가 마스킹 없음).
5. **truncated 표시**: `preview.truncated === true`면 "truncated" 표시(전체가 아님을 알림). `preview.lines`로 tail 줄 수를 노출한다.
6. **텍스트 표면**: monospace, **text selection·copy 가능**([[03-UX-UI]] 접근성). 자동 저장/외부 전송 없음([[DESIGN]] Anti-patterns, R-PRIV-004).
7. **frontend redaction 금지(불변식 ③)**: 표시 텍스트는 `preview.text`(backend redacted tail)뿐이다. 원문을 받지도 재구성하지도 추가 마스킹하지도 않는다([[SPEC-006-privacy-redaction]], R-PRIV-002).

**노출/line-count 컨트롤(R-PRIV-006 동작 — 본 spec 소유):**

- **exposure 토글**: 사용자가 preview 텍스트 노출을 on/off 한다. 변경은 `onToggleExposure` → settings 저장([[SPEC-500-settings-persistence]]). off면 규칙 2.
- **line-count 컨트롤**: 사용자가 표시 줄 수를 조정한다. 변경은 `onChangeLineCount` → settings 저장. **유효 범위는 `[1, PREVIEW_LINES]`**(backend가 내려주는 redacted tail이 최대 `PREVIEW_LINES`=12이므로, 그 이상은 표시할 데이터가 없다 — §6 Q1). line count를 늘려도 backend tail보다 많은 줄을 만들지 않는다.
- **기본값(가설, 검토 필요)**: exposure 기본 on / lineCount 기본 = `PREVIEW_LINES`(12). 단 **이 default 노출 범위는 UX와 보안 사이에서 PoC로 검증할 가설**이다([[03-UX-UI]] Open Question). 보수적 대안(default off)도 후보이며 default 값 자체는 [[SPEC-500-settings-persistence]]가 확정한다(§6 Q2).
- per-orc 노출 상태는 client state(terminal preview line count는 이미 [[04-Frontend]] Client State에 명시)이며 settings 저장 값을 미러링한다.

> **데이터 출처 의존(검토 필요)**: `preview.text`가 inspector에 도달하는 경로는 본 spec이 결정하지 않는다 — exposure on인 **선택된 orc에 한해** 텍스트를 가져오는 lazy fetch(노출면 최소화)를 권장하나, snapshot/camp-detail에 settings-gated로 포함할지 별도 per-orc endpoint를 둘지는 [[SPEC-101-snapshot-api]]/[[SPEC-500-settings-persistence]]와 조율한다(§6 Q1).

### 2.6 Dashboard 상태 모델 (R-UI-005)

R-UI-005가 요구하는 7종 상태를 **서로 구분되게** 렌더한다. 각 상태는 SPEC-005 필드 조합 또는 [[SPEC-102-realtime-sync]] 신호로 결정한다.

| UI 상태 | 결정 조건(소비 신호) | 출처 |
| --- | --- | --- |
| `loading` | 첫 snapshot 도착 전(데이터 없음) | client(아직 `GET /api/snapshot` 미완) |
| `tmux-not-installed`(empty-tmux) | `tmux.installed === false` | [[SPEC-005-data-contract]] §3.3 not_installed |
| `no-session` | `tmux.installed === true && camps.length === 0` | SPEC-005 §3.3 — **2 sub-variant**: `server-not-running`(`serverRunning=false`) / `running-no-session`(`serverRunning=true`) |
| `no-agent-detected` | `camps.length > 0 && Σ orcCount === 0` (모든 camp `orcCount=0`) | SPEC-005 §3.3 "sessions but no agent" |
| `tmux-error` | `diagnostics.tmuxErrors.length > 0` (범위: bulk phase=global, `target=paneId`=per-orc) | SPEC-005 §2.1 `Diagnostics` |
| `disconnected` | WS 전송 끊김(close/heartbeat 미수신) | [[SPEC-102-realtime-sync]] §3.4 신호 |
| `stale-snapshot` | `stale === true` 또는 `server_stale_changed{stale:true}` | SPEC-005 `stale`/`lastGoodAt`, SPEC-102 §3.4 |

- **`no-agent-detected` ≠ `no-session`(확정, R-UI-005)**: 전자는 camp(session)는 있으나 모든 `orcCount=0`이고, 후자는 `camps=[]`다. 서로 다른 화면 콘텐츠(전자는 camp scene을 그리되 "No agents detected", 후자는 session 생성 안내)로 렌더한다([[03-UX-UI]] 상태 설계).
- **`no-session` 2 sub-variant**: `server-not-running`(tmux 설치됨, server 미실행)과 `running-no-session`(server 실행, session 0)은 [[SPEC-005-data-contract]] §3.3 / R-TMUX-006이 구분하므로 **카피를 달리** 렌더한다(전자: "tmux server not running", 후자: "no tmux sessions yet" + 생성 안내).
- `disconnected`와 `stale-snapshot`은 **직교**하며([[SPEC-102-realtime-sync]] §3.4) 동시에 표현될 수 있다(연결은 끊겼고 데이터도 last-good).

### 2.7 상태 레이어링 규칙 (확정)

dashboard 상태는 **세 레이어**로 나뉘며 동시에 공존할 수 있다.

| 레이어 | 상태 | 렌더 방식 | 공존 |
| --- | --- | --- | --- |
| **A. 전체화면 콘텐츠**(상호 배타) | `loading` · `tmux-not-installed` · `no-session` · `no-agent-detected` · `populated` | 메인 영역 전체 교체 | 1개만 |
| **B. overlay**(직교) | `disconnected` · `stale-snapshot` | 상단 banner / badge, 기존 콘텐츠 유지 | A 위에 0~2개 |
| **C. 범위 한정** | `tmux-error`(per-camp/per-orc) · orc `terminated`/`unknown`/`error`(per-orc) | 해당 camp card/scene slot/inspector 국소 표시 | A·B와 무관 다수 |

- **레이어 A 우선순위**: `loading`(첫 snapshot 전) → 첫 snapshot 후엔 `tmux.installed`/`camps`/`orcCount`로 A를 결정한다. **첫 snapshot 이후 WS가 끊겨도 다시 `loading`으로 돌아가지 않는다** — 마지막 콘텐츠를 유지하고 레이어 B `disconnected` overlay를 띄운다([[03-UX-UI]] Disconnected: "마지막 정상 snapshot 유지").
- **레이어 B는 콘텐츠를 가리지 않는다**: `disconnected`/`stale` banner는 보이던 camp list/detail을 유지한 채 "지연 가능/신뢰 불가"를 알리고 reconnect 상태·manual refresh(R-API-004) 진입점을 제공한다([[04-Frontend]] 오류 처리).
- **레이어 C `tmux-error` 범위 판정**: `tmuxErrors[].target`이 `paneId`면 해당 orc에 국소 error 표시, bulk(`target=null`, phase=`probe`/`inventory`)면 camp 또는 global error로 표시한다. 특정 target 실패가 전체 dashboard 장애로 전파되면 안 된다(R-TMUX-004 정합).

## 3. Behavior rules

확정 규칙과 가설(검토 대상)을 구분한다. 데이터 값·신호는 모두 상류(SPEC-005/101/102) 산출을 소비만 하며 본 spec은 **표시·구분·동작**을 결정한다.

### 3.1 상태 해석 순서 (확정, R-UI-005)

매 렌더에서 다음 순서로 상태를 해석한다.

1. **레이어 B(overlay) 먼저 평가**(콘텐츠와 직교): WS 신호로 `disconnected`, snapshot/`server_stale_changed`로 `stale-snapshot`을 각각 set/clear.
2. **레이어 A(콘텐츠) 평가**: snapshot 미도착이면 `loading`. 도착 후엔 `tmux.installed`→`camps.length`→`Σ orcCount` 조합으로 `tmux-not-installed`/`no-session`(+sub-variant)/`no-agent-detected`/`populated` 중 1개.
3. **레이어 C 평가**: `diagnostics.tmuxErrors`와 per-orc `status`로 국소 표시.
4. 최종 화면 = A(1개) + B(0~2 overlay) + C(국소 다수)의 합성.

### 3.2 disconnected vs stale 표현 (확정, R-UI-005)

[[SPEC-102-realtime-sync]] §3.4가 분리한 신호를 화면에서 **구분 가능**하게 렌더한다.

1. `disconnected`(전송 끊김): 상단 reconnect banner + 보이던 데이터에 "지연 가능" 표식. backoff 재연결 진행 표시([[SPEC-102-realtime-sync]] §3.3). close code `4401`(token 무효)이면 banner 대신 "재실행/URL 재확인" 안내로 전환한다([[SPEC-102-realtime-sync]] §2.1).
2. `stale-snapshot`(연결됨·last-good): stale badge + `lastGoodAt`(마지막 정상 수집 시각) + manual refresh(R-API-004) 진입점. 영향받는 orc는 `status=stale`로 내려올 수 있다([[SPEC-005-data-contract]] §2.3).
3. 두 신호는 동시에 표현될 수 있고(끊겼고 last-good), 사용자가 둘을 혼동하지 않게 라벨을 분리한다.

### 3.3 estimated·confidence 표시 (확정, R-ORC-005)

1. `status`는 항상 `statusConfidence`와 함께 렌더한다(confidence 없는 status를 단정 표시하지 않는다). confidence는 시각 강도/수치/라벨로 표현하되 색만으로 전달하지 않는다.
2. `agentType`은 항상 `agentTypeConfidence`와 함께 렌더한다. `unknown` type은 ghost/placeholder 성격으로 낮은 confidence를 명시한다([[03-UX-UI]] Unknown agent).
3. `currentWorkSummary`는 `summaryIsEstimated=true`면 estimated 마커를, 항상 `summarySource`를 동반한다. 자동 추정을 확정 사실처럼 보이게 하지 않는다.

### 3.4 raw tmux target 상시 노출 (확정, R-UI-007)

camp/orc metaphor와 **무관하게** raw tmux 식별이 항상 확인 가능해야 한다.

1. Camp List: card에 `sessionId`(via `campId`)와 `tmuxSessionName`.
2. Camp Detail: 헤더에 `sessionId`+`tmuxSessionName`, scene slot에 `tmuxTarget` 라벨.
3. Orc Inspector: `tmuxTarget` + `paneId`를 상시 노출(권위는 `paneId`).
4. `tmuxTarget`/`tmuxSessionName`은 표시 전용이며 reindex/rename으로 변해도 선택·동작은 권위 식별자(`paneId`/`sessionId`)로 유지된다([[08-Decisions|D-017]]).

### 3.5 terminal preview 노출 동작 (확정, R-PRIV-006)

§2.5 컴포넌트 계약을 따른다. 핵심 동작 불변식:

1. exposure off → `preview.text` 미요청·미표시(노출면 최소화).
2. exposure on → backend redacted tail(`preview.text`)만, `min(lineCount, text.length)` 줄 표시. frontend는 redaction/원문 재구성을 하지 않는다.
3. line-count 변경은 표시 줄 수만 바꾸며 backend tail(≤`PREVIEW_LINES`)을 초과하는 데이터를 합성하지 않는다. 설정 변경은 [[SPEC-500-settings-persistence]]에 저장된다.
4. `redacted`/`truncated`/`lines` 메타를 항상 사용자에게 노출해 "전체가 아님·민감정보 가려짐"을 인지시킨다.

### 3.6 layout 안정성·성능 (확정 + 가설)

1. data refresh(WS batch 적용)로 scroll position·layout이 튀지 않는다([[DESIGN]] Motion, [[04-Frontend]] 성능). camp scene slot/lane은 안정 aspect ratio를 유지한다([[DESIGN]] Spacing).
2. WS event는 batch 단위로 적용 후 1회 render한다([[SPEC-102-realtime-sync]] §2.5/§3.6). 본 화면 슬라이스는 batch 적용 결과만 구독한다(debounce/batch 메커니즘은 SPEC-200/SPEC-102 소유).
3. **20 session / 100 pane**에서 camp list·detail 조작이 끊기지 않아야 한다(비기능 성능). camp list summary와 camp detail payload를 분리해 큰 snapshot의 초기 렌더 비용을 낮춘다([[04-Frontend]] 성능 전략 — 분리 fetch 위치는 [[SPEC-101-snapshot-api]] `GET /api/camps/:campId`).
4. (가설, 검토 필요) 100-pane scene의 sprite 렌더 비용·DOM vs canvas 선택은 [[SPEC-300-asset-rendering]]/[[04-Frontend]] Open Question과 [[SPEC-007-test-validation]] 측정으로 보정한다.

### 3.7 per-component 표준 상태 (확정)

각 데이터 의존 컴포넌트는 다음 분기를 가진다.

| 컴포넌트 | loading | empty | error | no-data 특수 |
| --- | --- | --- | --- | --- |
| `CampListView` | skeleton card | §2.6 no-session/no-agent 위임 | tmux-error banner(레이어 C) | — |
| `CampScene` | scene skeleton | "No agents detected"(camp orcCount=0) | per-orc error slot | 비-orc pane은 빈 slot |
| `OrcInspector` | metadata skeleton | 선택 orc 없음 시 empty hint | orc-scoped error | `terminated`/`stale`: 마지막 metadata + 라벨 |
| `TerminalPreview` | preview skeleton | `lines=0`: "no output" | `preview=null`: "preview unavailable"(capture 실패) | exposure off: "Preview hidden" |

- **deep link not-found**: `campId`/`orcId`가 현재 snapshot에 없으면(종료/미존재) inspector/detail은 "not found / 종료됨" 상태로 렌더하고 camp list로 복귀 경로를 제공한다(앱 라우팅은 [[SPEC-200-frontend-architecture]]).
- **`preview=null` ≠ `lines=0`(확정)**: capture 실패(`null`)와 출력 없음(`lines=0`)을 서로 다른 메시지로 렌더한다([[SPEC-005-data-contract]] §2.7, capture 실패는 `diagnostics.tmuxErrors`에 동반).

### 3.8 반응형 동작 (확정 + 가설)

1. desktop: 3-pane(camp scene · inspector · activity rail)을 허용한다([[DESIGN]] Layout).
2. mobile: camp scene 위주로 보이고 inspector는 bottom sheet로 전환한다([[DESIGN]] Layout). raw target·status·preview 컨트롤은 bottom sheet에서도 접근 가능해야 한다(R-UI-007/R-PRIV-006 보존).
3. (가설, 검토 필요) mobile dashboard를 MVP 범위에 포함할지 desktop-first로 제한할지는 [[03-UX-UI]] Open Question이며 미확정이다. 본 spec은 desktop 3-pane을 1차로, mobile bottom-sheet를 degrade 경로로 둔다.

## 4. Acceptance criteria

```text
SPEC-201-AC-01 (R-UI-001, R-UI-002)
  Given camps[] 가 있는 snapshot이 로드된 상태에서
  When CampListView 를 렌더하면
  Then 각 CampCard 는 tmuxSessionName, windowCount, paneCount, orcCount,
       statusSummary.active/waiting/error/stale, lastActivityAt 을 표시하고,
       camps 는 tmuxSessionName 오름차순으로 정렬되며(§2.2, SPEC-005 §3.4),
       각 status count 는 색이 아닌 icon+label+숫자로도 식별 가능하다.
```

```text
SPEC-201-AC-02 (R-UI-002)
  Given 임의 CampCard 에 대해
  When 표시된 active/waiting/error/stale count 를 합산·비교하면
  Then 값이 그 camp 의 statusSummary 필드와 일치하고,
       모든 camp 의 statusSummary 합이 StatusSummaryBar(최상위 statusSummary)와 일치한다.
```

```text
SPEC-201-AC-03 (R-UI-003)
  Given 선택된 camp 의 orcs[] 가 여러 window/pane 에 걸쳐 있을 때
  When CampScene 을 렌더하면
  Then orc 는 windowIndex 로 그룹핑되고(공간 scene 배치 좌표·내부 정렬은
       [[SPEC-301-camp-map-movement]] §2.2~2.5 가 소유·supersede),
       각 orc 표시는 raw tmuxTarget 라벨과 status badge(label)를 가지고,
       orcs[] 에 없는 비-orc pane 은 orc sprite 로 렌더되지 않는다(paneCount>orcCount 시).
       (참고: paneIndex 오름차순 배치 진술은 scene 이 아니라 list/table 등 비-scene 표시
       컨텍스트에 한정 적용된다 — SPEC-005 §3.4 정렬.)
```

```text
SPEC-201-AC-04 (R-UI-004, R-ORC-005)
  Given 한 orc 를 선택해 OrcInspector 가 열린 상태에서
  When inspector 콘텐츠를 검사하면
  Then agentType(+agentTypeConfidence), tmuxTarget(+paneId), cwd, command,
       status(+statusConfidence), currentWorkSummary(+summarySource), lastActivityAt,
       terminal preview, control 진입점을 모두 표시하고,
       status 는 항상 statusConfidence 와 함께,
       summaryIsEstimated=true 인 summary 는 estimated 마커와 함께 렌더된다.
```

```text
SPEC-201-AC-05 (R-UI-005)
  Given (a) 첫 snapshot 도착 전, (b) tmux.installed=false,
        (c) installed=true·camps=[], (d) camps 있으나 모든 orcCount=0 환경에서
  When dashboard 를 렌더하면
  Then 각각 loading / tmux-not-installed / no-session / no-agent-detected 상태가
       서로 다른 화면 콘텐츠로 렌더되어 사용자가 네 상태를 구분할 수 있다.
```

```text
SPEC-201-AC-06 (R-UI-005)
  Given camps 가 비어있지 않고 모든 camp 의 orcCount=0 인 snapshot과
        camps=[] 인 snapshot 을 각각 렌더할 때
  When 두 화면을 비교하면
  Then no-agent-detected 상태(camp scene + "No agents detected")가
       no-session 상태(session 생성 안내)와 명확히 다르게 렌더된다.
       또한 no-session 의 server-not-running(serverRunning=false)과
       running-no-session(serverRunning=true)이 서로 다른 카피로 구분된다.
```

```text
SPEC-201-AC-07 (R-UI-005, [[SPEC-102-realtime-sync]] §3.4 정합)
  Given 첫 snapshot 으로 콘텐츠가 렌더된 뒤
  When (i) WS 가 끊기면 / (ii) server_stale_changed{stale:true} 가 오면
  Then (i) disconnected banner 가 기존 콘텐츠를 유지한 채 표시되고(loading 으로 복귀하지 않음),
       (ii) stale badge + lastGoodAt + manual refresh 진입점이 표시되며,
       두 신호는 동시 발생 시 각각 구분되어(끊김 vs last-good) 표현된다.
```

```text
SPEC-201-AC-08 (R-UI-007)
  Given 임의의 camp card / camp detail 헤더 / orc inspector 에 대해
  When 각 화면을 검사하면
  Then camp 식별(sessionId+tmuxSessionName)과 orc 의 raw tmuxTarget(+paneId)이
       항상 노출되며, tmuxTarget/tmuxSessionName 이 reindex/rename 으로 바뀌어도
       선택·동작은 권위 식별자(paneId/sessionId)로 유지된다.
```

```text
SPEC-201-AC-09 (R-PRIV-006)
  Given OrcInspector 의 TerminalPreview 에서
  When 사용자가 exposure 토글과 line-count 컨트롤을 조작하면
  Then exposure off 면 preview.text 가 표시되지 않고("Preview hidden"),
       exposure on 이면 min(lineCount, preview.text.length) 줄이 표시되며,
       변경 값은 settings 저장 경로(PATCH /api/settings, [[SPEC-500-settings-persistence]])로 전달된다.
```

```text
SPEC-201-AC-10 (R-PRIV-006, R-PRIV-002 정합)
  Given backend 가 redaction 한 preview.text(redacted tail, [REDACTED:*] 포함)에 대해
  When TerminalPreview 가 텍스트를 표시하면
  Then 표시 텍스트는 preview.text 그대로이며 frontend 가 추가 redaction/원문 재구성을 하지 않고,
       preview.redacted=true 면 "redacted" 배지를, preview.truncated=true 면 "truncated"+lines 를 표시하며,
       텍스트는 selection·copy 가능하다.
```

```text
SPEC-201-AC-11 (R-UI-004, [[SPEC-005-data-contract]] §2.7 정합)
  Given 한 orc 의 preview=null(capture 실패), 다른 orc 의 preview.lines=0(출력 없음)일 때
  When TerminalPreview 를 각각 렌더하면
  Then preview=null 은 "preview unavailable"(capture 실패),
       preview.lines=0 은 "no output" 으로 서로 다르게 렌더되어 두 상태가 구분된다.
```

```text
SPEC-201-AC-12 (R-UI-005, R-TMUX-004 정합)
  Given diagnostics.tmuxErrors 에 target=paneId 인 capture 오류와
        target=null 인 bulk(inventory) 오류가 함께 있을 때
  When dashboard 를 렌더하면
  Then per-orc 오류는 해당 orc slot/inspector 에 국소 표시되고,
       bulk 오류는 camp/global tmux-error 로 표시되며,
       어느 경우든 나머지 camp/orc 의 정상 렌더가 유지된다(전체 장애 전파 없음).
```

```text
SPEC-201-AC-13 (R-UI-004, [[SPEC-400-control-actions]] 경계)
  Given OrcInspector 가 열린 상태에서
  When control 진입점을 검사하면
  Then send/key/interrupt 진입 버튼이 존재하되,
       선택 orc 가 terminated/stale 이거나 disconnected 이거나 token 부재면 disabled 로 표시되고,
       실제 action flow(modal·target 재검증·결과 반영)는 본 화면이 아니라
       [[SPEC-400-control-actions]] 로 위임된다.
```

```text
SPEC-201-AC-14 (R-UI-003, 비기능 성능)
  Given 20 session / 100 pane 규모 snapshot 에서
  When WS batch 가 적용되어 status 가 갱신될 때
  Then camp list/detail 의 scroll position·layout 이 튀지 않고(layout shift 없음),
       batch 적용 후 1회 render 로 반영된다([[SPEC-102-realtime-sync]] §2.5/§3.6).
       (측정 절차·임계는 [[SPEC-007-test-validation]].)
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-001 | camp list 첫 화면 + StatusSummaryBar(최상위 statusSummary) | SPEC-201-AC-01, AC-02 |
| R-UI-002 | CampCard 콘텐츠 매핑(session명·win/pane·orc·active/waiting/error/stale·lastActivity) | SPEC-201-AC-01, AC-02 |
| R-UI-003 | CampScene window=lane / pane=slot 배치, 비-orc pane 처리, layout 안정성 | SPEC-201-AC-03, AC-14 |
| R-UI-004 | OrcInspector 4영역(metadata·confidence·summary+estimated·preview·control 진입점) | SPEC-201-AC-04, AC-11, AC-13 |
| R-UI-005 | 7종 상태 구분 렌더 + 레이어링(전체화면/overlay/범위), no-agent≠no-session, disconnected≠stale, tmux-error scoping | SPEC-201-AC-05, AC-06, AC-07, AC-12 |
| R-UI-007 | raw tmux target 상시 노출(card/detail/inspector), 표시 전용 vs 권위 식별자 | SPEC-201-AC-08 |
| R-PRIV-006 | TerminalPreview 노출 토글 + line-count 컨트롤(UI·behavior), backend redacted text only | SPEC-201-AC-09, AC-10 |

> 부수 충족(1차 소유는 타 spec): **R-ORC-005**(estimated/confidence 사실-단정 금지 표시 — 데이터 1차 [[SPEC-005-data-contract]]; 본 spec은 렌더, AC-04), **R-PRIV-002**(backend redaction 후 전달 — 1차 [[SPEC-006-privacy-redaction]]; 본 spec은 frontend 비-redaction 표시, AC-10), **R-API-002/R-UI-005 신호**(disconnected/stale — 신호 산출 1차 [[SPEC-102-realtime-sync]]; 본 spec은 화면 렌더, AC-07), **R-TMUX-004**(target 실패 격리 — 1차 [[SPEC-002-tmux-discovery]]; 본 spec은 국소 error 렌더, AC-12), **R-TMUX-006**(빈 상태 구분 — 1차 [[SPEC-005-data-contract]]; 본 spec은 화면 구분, AC-05/AC-06). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **U1 — `preview.text` 전달 경로 미정(상류 의존, 검토 필요)**: 본 spec은 preview **렌더링·노출 동작**을 소유하나 `preview.text`가 inspector에 **어떻게 도달하는지**는 [[SPEC-101-snapshot-api]]가 미정이다. scan-MVP/snapshot은 preview metadata-only가 기본([[SPEC-005-data-contract]] §2.7, [[08-Decisions|D-021]])이다. 권장: exposure on인 **선택 orc만** 텍스트를 가져오는 lazy fetch(예: `GET /api/orcs/:orcId/preview`, 노출면 최소화) — snapshot 전체에 text를 싣는 것은 100-pane에서 노출면·payload 양쪽으로 불리. SPEC-101에 endpoint 추가 또는 camp-detail의 settings-gated 포함 중 택일 필요. **검토 필요.**
- **U2 — preview default 노출 범위(검토 필요)**: §2.5 기본값(exposure on / lineCount=`PREVIEW_LINES`=12)은 [[03-UX-UI]] Open Question("default 노출 범위가 UX와 보안 사이에서 적절한지")에 걸린 **가설**이다. 보수적 대안은 default off다. default **값**은 [[SPEC-500-settings-persistence]](R-SET-001)가 확정하고 본 spec은 동작만 소유한다.
- **U3 — line-count 상한 vs backend tail**: line-count 컨트롤 유효 범위를 `[1,PREVIEW_LINES]`(=12)로 두었으나, dashboard가 더 긴 tail(최대 `CAPTURE_LINES`=200)을 노출하길 원하면 [[SPEC-006-privacy-redaction]] `PREVIEW_LINES`와 [[SPEC-101-snapshot-api]] 전달 계약을 함께 올려야 한다(live tail은 P1 R-P1-012). MVP는 12 상한 유지. **검토 필요.**

### Open Questions (검토 필요)

- **Q1 — control 진입점 enable/disable 규칙 소유**: §2.4/AC-13의 disabled 조건(terminated/stale/disconnected/token 부재)을 본 spec(진입점)과 [[SPEC-400-control-actions]](flow) 중 어디가 권위로 둘지 경계 확정 필요. 현재는 본 spec이 진입점 가시성, SPEC-400이 실행 가능성으로 분담.
- **Q2 — 비-orc pane 시각화 수준**: 비-orc pane을 빈 camp slot으로 그릴지(§2.3) 완전히 숨길지는 정보 밀도 vs 단순성 trade-off다. [[03-UX-UI]] "window를 실제 공간으로 표현할지 agent 중심 재배치할지" Open Question과 함께 prototype으로 보정. **검토 필요.**
- **Q3 — mobile 범위**: §3.8 mobile bottom-sheet를 MVP에 포함할지 desktop-first로 제한할지 미확정([[03-UX-UI]] Open Question). 본 spec은 desktop 3-pane 1차 + mobile degrade로 둔다.
- **Q4 — DOM vs canvas scene**: 100-pane scene 렌더를 DOM sprite로 갈지 canvas로 갈지는 [[SPEC-300-asset-rendering]]/[[04-Frontend]] Open Question(접근성·성능 trade-off)이다. 배치/선택은 본 spec, 렌더 매체 결정은 SPEC-300. [[SPEC-007-test-validation]] 측정으로 보정.
- **Q5 — terminated/stale retention 표시 시간**: orc를 종료 후 얼마나 남길지(retention window)는 [[SPEC-004-status-inference]] §3.7 소유다. inspector/scene의 fade-out·정리 타이밍은 그 값에 맞춰 표시만 한다(본 spec은 표시, retention은 상류).
