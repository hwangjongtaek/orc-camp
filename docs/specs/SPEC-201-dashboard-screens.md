---
spec: SPEC-201
title: Dashboard 화면 (camp list/detail/inspector)·상태
status: approved
updated: 2026-07-08
requirements: [R-UI-001, R-UI-002, R-UI-003, R-UI-004, R-UI-005, R-UI-007, R-UI-012]
decisions: [D-002, D-005, D-017, D-021, D-044, D-045, D-046]
tags:
  - specs
  - frontend
  - dashboard
  - screens
  - epic-3
---

# SPEC-201 — Dashboard 화면 (camp list/detail/inspector)·상태

Orc Camp dashboard의 **화면 표면(screen surface)**과 **그 화면이 표시하는 콘텐츠·상태**의 단일 진실 공급원(SSOT)이다. [[SPEC-200-frontend-architecture]]가 라우팅·store·데이터 흐름이라는 *앱 골격*을 소유한다면, 본 spec은 그 골격 위에 올라가는 **camp list / camp detail / orc inspector** 3개 화면 슬라이스의 **레이아웃·콘텐츠 매핑·상태 렌더링**을 고정한다. 표시할 필드의 값은 [[SPEC-005-data-contract]] `ScanResult`를, 변경 신호는 [[SPEC-102-realtime-sync]]를 그대로 소비한다. **map 모드는 read-only**이며, live pane **관전**과 **조종(command 전송)**은 [[SPEC-203-terminal-workspace]] terminal 모드가 소유한다(2026-07-08 개정 — 구 dock Preview 탭 제거).

> **소유 경계**:
> - **소유(본 spec)**: 화면 인벤토리·각 화면의 콘텐츠 매핑(어떤 SPEC-005 필드를 어디에 그리는가)·7종 dashboard 상태의 **구분 렌더링**·orc 배치/선택(placement/selection)·raw tmux target 상시 노출(R-UI-007). **map 모드 dock은 read-only**(Details 메타 + Activity 피드) 두 탭만 소유하고, live pane **관전(terminal preview)·조종(control/command 전송)**은 소유하지 않는다 → [[SPEC-203-terminal-workspace]](2026-07-08 개정으로 dock Preview 탭·`PanePreview`/`TerminalPreview`/`CommandDock` 제거).
> - **참조(타 spec 소유)**: 앱 라우팅·store·server/client state 분리·데이터 흐름 → [[SPEC-200-frontend-architecture]]. design token·키보드 내비·contrast·motion → [[SPEC-202-design-accessibility]]. sprite 애니메이션·상태머신·asset fallback → [[SPEC-300-asset-rendering]](본 spec은 sprite를 **어디에 놓고 어떻게 선택**하는지만 소유, 그 sprite가 **무엇을 그리는지**는 SPEC-300). live pane 관전·조종 표면(xterm viewport·ComposedInput·Observe/Control arm) 전체 → [[SPEC-203-terminal-workspace]](본 spec은 map↔terminal 진입 제스처를 **소유하지 않으며**, 배치만 참조 — §2.3a-6). control action flow(modal·target 재검증·optimistic update) → [[SPEC-400-control-actions]]. snapshot/REST·WS 계약 → [[SPEC-101-snapshot-api]] / [[SPEC-102-realtime-sync]]. preview/redaction 규칙·`preview.text` 내용 제약 → [[SPEC-006-privacy-redaction]]. terminal preview 노출 게이트·live view exposure(R-PRIV-006)는 [[SPEC-203-terminal-workspace]] §2.8 viewport가 소비, **저장 값**(preview line count·exposure) → [[SPEC-500-settings-persistence]]. activity log payload → [[SPEC-600-observability]].

> **불변식(확정)**:
> - **① 표시 전용 vs 권위 식별자**: 화면에 그리는 `tmuxTarget`/`tmuxSessionName`은 표시 전용이고, 선택·키·재조립의 권위는 `orcId`(`pane:`+paneId)/`campId`(`session:`+sessionId)다([[08-Decisions|D-017]]). raw tmux target은 **항상** 노출한다(R-UI-007).
> - **② 사실 단정 금지**: `status`는 항상 `statusConfidence`와 함께, `currentWorkSummary`는 `summaryIsEstimated`/`summarySource`와 함께 렌더한다(R-ORC-005, [[SPEC-005-data-contract]] §3.6).
> - **③ frontend는 redaction을 하지 않는다(일반 원칙)**: live pane 텍스트를 그리는 표면은 backend가 이미 redaction한 텍스트만 렌더하고, frontend는 원문을 받지도·재구성하지도·추가 마스킹하지도 않는다([[SPEC-006-privacy-redaction]], [[08-Decisions|D-016]]). 2026-07-08 개정 이후 map 모드에는 pane 텍스트 표면이 없으므로 이 불변식은 이제 [[SPEC-203-terminal-workspace]] terminal 모드 viewport에 적용된다(과거의 map-mode preview는 제거).
> - **④ 상태는 색만으로 전달하지 않는다**: 모든 status·dashboard 상태는 icon/label/pose를 함께 쓴다([[DESIGN]] Usage Rules, 비기능 접근성).

> **2026-07-02 개정(draft)**: [[18-Terminal-Workspace]] 설계안([[08-Decisions|D-045]]/[[08-Decisions|D-046]]/[[08-Decisions|D-044]], R-UI-012)에 따라 **dock Preview 탭(§2.5)의 read-only preview peek ↔ 신규 terminal 모드(xterm workspace)의 이관·공존**을 §2.5a로 추가하고, §2.3a에 terminal 모드 **진입 affordance**를 명시했다(신규 AC-17/AC-18). terminal 모드 화면·레이아웃·스위칭·관전/조종은 [[SPEC-203-terminal-workspace]]가 소유하고, live pane view 채널은 [[SPEC-103-pane-live-stream]], 키보드 passthrough 보안 의미는 [[SPEC-401-interactive-input]]가 소유한다. 본 spec은 **in-map dock 화면과 그 dock↔terminal 이관 접점**만 소유한다. 기존 dock 동작·불변식(zero layout shift·상태 구분 렌더·estimated/confidence·raw target 상시·노출 게이트)은 **그대로 보존**한다. 상류 결정(D-044/045/046, R-UI-012)이 **2026-07-02 Accepted 승인**되어 본 spec은 `approved`다.

> **2026-07-08 개정(approved)**: map 모드 dock의 **Preview 탭(§2.3a 탭 표·§2.4·§2.5·§2.5a)**과 그 구성요소 `PanePreview`/`TerminalPreview`/`CommandDock`(및 web client `api.getOrcPreview`/`OrcPreviewResponse` 호출)이 **코드에서 제거**됐다. live pane **관전**과 **조종(command 전송)**은 이제 전적으로 [[SPEC-203-terminal-workspace]] terminal 모드(xterm viewport + ComposedInput의 Observe/Control arm)가 소유한다 — map 모드의 read-only redacted preview peek과 그 inline `CommandDock`은 삭제됐고, **map 모드 dock은 순수 read-only**(Details 메타 + Activity 피드 두 탭)다. 관전·조종을 하려면 사용자는 terminal 모드로 진입한다. map↔terminal 진입 제스처(camp header `LayoutModeSwitcher`, 맵 orc 더블클릭/Enter)는 [[SPEC-203-terminal-workspace]] §2.1 소유로 **불변**이며, 오직 구 Preview 탭 **안에** 있던 "Open terminal"/"Expand" affordance만 함께 제거됐다. 이에 따라 §2.5/§2.5a는 **superseded/removed**로 표기하고(불변식 ③ read-only/redaction 일반 원칙은 이제 SPEC-203 viewport에 적용), 화면 인벤토리는 **4→3 슬라이스**(Camp List / Camp Detail / Orc Inspector)로 축소했다. R-PRIV-006(노출 여부·line count)은 SPEC-201이 더 이상 preview 컴포넌트를 렌더하지 않으므로 본 spec의 `requirements`에서 제거했고, 노출 값은 여전히 존재하되([[SPEC-500-settings-persistence]] 소유) 이를 소비하는 viewport exposure gate는 [[SPEC-203-terminal-workspace]] §2.8이 소유한다(§5 참조). 서버 endpoint `GET /api/orcs/:orcId/preview` 자체의 존재는 본 개정 범위 밖이다 — web client가 더 이상 호출하지 않을 뿐 서버/백엔드 계약은 그대로다.

## 1. Scope

### In scope

- **화면 인벤토리(3 슬라이스)**: Camp List(`/`, R-UI-001/002), Camp Detail(`/camps/:campId`, R-UI-003), Orc Inspector(detail 내 dock Details 탭, R-UI-004). (구 4번째 슬라이스 **Terminal Preview**는 2026-07-08 제거 — live pane 관전은 [[SPEC-203-terminal-workspace]] terminal 모드로 이관.)
- **콘텐츠 매핑**: 각 화면 요소가 소비하는 [[SPEC-005-data-contract]] 필드의 정확한 매핑과 표시 의무(R-UI-002/003/004, R-UI-007).
- **7종 dashboard 상태의 구분 렌더링**(R-UI-005): `loading` / `tmux-not-installed`(empty-tmux) / `no-session` / `no-agent-detected` / `tmux-error` / `disconnected` / `stale-snapshot`. SPEC-005 빈상태 인코딩 + [[SPEC-102-realtime-sync]] disconnected/stale 신호로의 매핑.
- **상태 레이어링 규칙**: 전체화면 교체 상태 vs overlay(banner/badge) 상태 vs 범위 한정(per-camp/per-orc) 상태의 우선순위·공존 규칙.
- **orc 배치/선택**: camp scene 내 window/pane → lane/slot 배치, 선택 상태, 비-orc pane 처리(placement/selection만; sprite는 [[SPEC-300-asset-rendering]]).
- **per-component 표준 상태**: loading / empty / error / no-data 분기.

> **제거(2026-07-08)**: 구 in-scope 항목 "Terminal Preview 컴포넌트 계약"(preview 메타 렌더·노출 토글·line-count·redacted/truncated·`preview=null` vs `lines=0`·텍스트 선택/복사)은 map 모드에서 **삭제**됐다. 해당 관전 기능은 [[SPEC-203-terminal-workspace]] terminal 모드 viewport가 소유한다.

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
| live pane 관전 viewport(xterm·스크롤백·커서)·terminal 모드 화면/스위칭·조종(ComposedInput·arm) | terminal workspace | [[SPEC-203-terminal-workspace]] |
| live pane view 채널(`view.attach`/`pane_view*`)·viewport exposure gate(R-PRIV-006 소비) | live stream | [[SPEC-103-pane-live-stream]] / [[SPEC-203-terminal-workspace]] §2.8 |
| activity log 항목 payload·event history | observability | [[SPEC-600-observability]] |

## 2. Contract

### 2.1 화면 인벤토리와 라우팅 바인딩

라우팅 정의는 [[SPEC-200-frontend-architecture]] / [[04-Frontend]] 소유다. 본 spec은 각 route가 **무엇을 렌더하는가**만 고정한다.

| # | 화면 | route(참조) | 주요 컴포넌트(역할은 [[04-Frontend]]) | 다루는 R-* |
| --- | --- | --- | --- | --- |
| 1 | Camp List | `/` | `CampListView` · `CampCard` · `StatusSummaryBar` | R-UI-001, R-UI-002 |
| 2 | Camp Detail | `/camps/:campId` | `CampDetailView` · `CampScene` · (`OrcSprite` → SPEC-300) | R-UI-003 |
| 3 | Orc Inspector | `/camps/:campId`(dock Details 탭; `?orc=<orcId>`) | `OrcInspector`(read-only 메타; control·terminal preview 진입점 없음 — map 모드 read-only) | R-UI-004 |

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

`CampDetailView`는 **단일 컬럼(single-column)** 레이아웃이다(구현됨, #41~#45 후속). 맵(`CampScene`/`CampMap`)이 **행 전체 폭**을 차지하고, 그 **아래**에 단일 **탭 dock**(`CampDock`, `web/src/components/inspector/CampDock.tsx`)을 둔다. **우측 inspector 컬럼(데스크톱 340px)과 mobile bottom-sheet는 제거**됐다 — 모든 뷰포트 폭에서 동일한 단일 dock을 쓴다(§2.3a). `CampScene`은 선택된 camp(`campId`)의 `Camp` 객체를 소비한다.

> **레이아웃 변경(확정·구현)**: 구 모델은 좌측(map+activity rail) + 우측 inspector 컬럼(데스크톱) / mobile bottom-sheet였다. 신 모델은 **map(full-width) → CampDock(full-width, 하단)** 단일 컬럼이다. map이 행 전체를 차지해 더 큰 맵 표면을 확보한다([[03-UX-UI]] Layout). `BottomSheet`/`useMediaQuery` 컴포넌트는 코드에 잔존하나 `CampDetailView`에서는 **미사용**이다.

- **scene = 조작 표면**: 장식 배경이 아니라 agent 위치/상태를 드러낸다([[03-UX-UI]] Pixel Art 적용). 본 spec은 **layout/placement/selection**을 소유하고, 그 자리에 그려지는 sprite(pose·애니메이션·placeholder)는 [[SPEC-300-asset-rendering]]이 소유한다.

> **NOTE (cross-ref, 공간 맵)**: camp detail의 orc **배치는 이제 [[SPEC-301-camp-map-movement]]가 공간 pixel 맵(zone=window·station=status·slot=paneId)으로 소유**한다. 본 §2.3의 lane/slot 의미는 그 맵 **아래에 보존**된다: window=lane → **zone**, pane=slot → station 주변 **slot fan-out**(배치 키는 reindex 불변을 위해 `paneId`, [[08-Decisions|D-017]]). 본 spec은 콘텐츠 매핑·selection(`?orc=<orcId>`)·비-orc pane·layout 안정성을 계속 소유하고, **공간 좌표 함수·movement/roaming·맵 render contract**는 SPEC-301이 소유한다(§6 Q4 DOM↔canvas도 SPEC-301에서 DOM=기본/canvas=P2로 해소).
- **배치 모델(window 그룹핑; scene 좌표는 SPEC-301)**: orc를 `windowIndex`로 그룹핑한다(window 단위 묶음 의미 보존). **scene 공간 배치 좌표·그룹 내부 정렬은 [[SPEC-301-camp-map-movement]]가 소유**한다(zone=window·station=status·slot=paneId fan-out; 배치 키는 reindex 불변을 위해 `paneId`, [[08-Decisions|D-017]]). `paneIndex` 오름차순 정렬은 **list/table 등 비-scene 표시**에 한정 적용된다([[SPEC-005-data-contract]] §3.4). group(zone) 헤더에 window 식별을 표기한다.
- **orc slot 콘텐츠**: 각 slot은 `OrcSprite`(상태 visual, SPEC-300) + status badge(label) + raw target 라벨(`tmuxTarget`, R-UI-007)을 가진다. status badge는 `status`(+`statusConfidence` 시각 강도)로 그린다(사실 단정 금지).
- **비-orc pane 처리(확정)**: `orcs[]`에 없는 pane(비-candidate, `paneCount > orcCount`)은 orc로 렌더하지 않는다([[SPEC-005-data-contract]] §3.2-2). camp의 `paneCount`/`windowCount` 집계로만 반영하고, scene은 빈 camp slot 또는 비활성 tile로 표현해 "이 window엔 agent가 없다"를 드러낼 수 있다(선택적; layout shift 금지 — §3.6).
- **선택(selection)**: slot 클릭/포커스 → `?orc=<orcId>`로 inspector를 연다. 선택 상태는 client state(selected orc, [[04-Frontend]] Client State)이며 권위 키는 `orcId`다. 동일 paneId가 reindex로 `tmuxTarget`이 바뀌어도 선택은 유지된다([[08-Decisions|D-017]]).
- **layout 안정성**: orc 추가/상태 변화/hover로 lane·slot의 aspect ratio가 바뀌어 layout shift가 나면 안 된다([[DESIGN]] Spacing/Motion, §3.6).
- camp detail 헤더는 `tmuxSessionName` + `sessionId` + 집계(`orcCount`/`windowCount`/`paneCount`/`statusSummary`/`lastActivityAt`)를 표시한다(R-UI-007 raw 식별 상시 노출).

### 2.3a Camp dock — 단일 탭 통합 (R-UI-004 진입점, 구현·확정)

map 아래 단일 dock(`CampDock`)이 구 우측 inspector 컬럼과 별도 activity rail을 **하나의 탭 표면으로 통합**한다. 탭은 WAI-ARIA tabs(`web/src/components/ui/Tabs.tsx`)로 구현한다.

| 탭 id | label | 렌더 컴포넌트 | 콘텐츠 | 다루는 R-* |
| --- | --- | --- | --- | --- |
| `details` | Details (기본 활성) | `OrcInspector` | 선택 orc **read-only 메타데이터 + provenance**(control 진입점 없음) | R-UI-004 |
| `activity` | Activity | 최근 활동 피드 | recent activity(badge = 건수) | R-OBS-001 forward(피드 표시) |

> **제거(2026-07-08)**: 구 `preview` 탭(`PanePreview` = exposure-gated redacted terminal tail + inline `CommandDock`)은 삭제됐다. dock은 이제 `details`/`activity` **두 탭만** 가지며 map 모드는 read-only다. 구현: `web/src/components/inspector/CampDock.tsx`는 `details`(OrcInspector)·`activity` 두 탭만 렌더한다. live 관전+조종은 [[SPEC-203-terminal-workspace]] terminal 모드로 이관됐다.

**탭 dock 계약(확정·구현):**

1. **WAI-ARIA tabs**: `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`/`aria-controls`/`aria-labelledby`. **roving tabindex**(활성 탭 `tabindex=0`, 나머지 `-1` → tablist 전체가 단일 tab stop). `ArrowLeft/Right`·`ArrowUp/Down`·`Home`/`End`로 focus 이동하며 **자동 활성화**(focus = 활성). 키보드/focus 값 규약은 [[SPEC-202-design-accessibility]] 소유.
2. **활성 패널만 mount(lazy)**: 비활성 탭의 `render()`는 실행되지 않는다(활성 탭만 mount — 접근성·비용 최소화). map 모드 두 탭(`details`/`activity`)은 모두 read-only 경량 표면이며 pane 텍스트 fetch를 트리거하지 않는다(2026-07-08 개정으로 exposure-gated preview fetch는 map 모드에서 제거 — live view는 [[SPEC-203-terminal-workspace]] 소유).
3. **모든 폭에서 dock 사용**: 데스크톱/모바일 구분 없이 동일 dock을 쓴다(우측 컬럼·mobile bottom-sheet 제거, §3.8).
4. **불변식 보존(확정)**: 접근성(WAI-ARIA tabs·키보드)·CLS(zero layout shift, 탭 전환이 맵 layout/scroll을 밀지 않음) 불변식을 유지한다. raw `tmuxTarget`+`paneId`(R-UI-007)·status+confidence(R-ORC-005)는 Details 탭에서 도달 가능하다. **map 모드 dock은 read-only**이므로 terminal preview·control 진입점을 포함하지 않는다 — live 관전(R-PRIV-006 viewport)과 조종([[SPEC-400-control-actions]] flow)은 [[SPEC-203-terminal-workspace]] terminal 모드가 소유한다(2026-07-08 개정).
5. **selection 연동**: orc 선택(`?orc=<orcId>`)이 없으면 dock은 그대로 존재하되 Details 탭이 empty hint("select an orc")를 렌더한다. selection 권위 키는 `orcId`(§2.3, [[08-Decisions|D-017]]).
6. **terminal 모드 진입 affordance(개정·확정, R-UI-012, [[08-Decisions|D-045]])**: map 모드에서 사용자는 전체 terminal workspace로 진입한다 — camp header의 `LayoutModeSwitcher`(map/terminal)와 맵에서 orc **더블클릭/Enter**가 `layoutMode='terminal'`로 전환한다(진입 제스처·모드 상태는 [[SPEC-203-terminal-workspace]] §2.1 소유). 진입 시 selection(`?orc=`)·`campId`가 보존된다. **(2026-07-08 개정)** 구 Preview 탭 내부의 "Open terminal"/"Expand" affordance는 Preview 탭과 함께 제거됐고, `LayoutModeSwitcher` + 더블클릭/Enter 제스처만 남는다. map/terminal 어느 쪽이든 선택 SSOT는 동일 `?orc=`다(불변식 ①, [[08-Decisions|D-035]]).

### 2.4 Orc Inspector 콘텐츠 매핑 (R-UI-004)

`OrcInspector`는 선택된 orc(`orcId`)의 `Orc` 객체를 소비하며 **dock의 Details 탭**(§2.3a)에 렌더된다. R-UI-004가 요구하는 영역 중 **read-only metadata, status confidence, current work summary, provenance**를 포함한다. **map 모드는 read-only이며 control 진입점도 terminal preview도 없다**(2026-07-08 개정으로 구 Preview 탭·`PanePreview` 제거) — live 관전·조종은 [[SPEC-203-terminal-workspace]] terminal 모드에서 도달한다.

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

- **estimated 마커 규칙**: `summaryIsEstimated=true`(자동 추정) → "estimated"/`~` 류 시각 마커를 summary 옆에 둔다. `user_label`로만 `false`일 수 있다([[SPEC-005-data-contract]] §3.6-3). summary가 추정임을 사용자가 사실로 오해하지 않게 한다([[02-Requirements]] Observation 수용 기준, [[03-UX-UI]] Open Question).
- **control 진입점은 map 모드에 없다(2026-07-08 개정·구현)**: 구 `CommandDock`(send/key/interrupt) 진입점은 map 모드(dock)에서 **완전히 제거**됐다 — `OrcInspector`(Details)도, 삭제된 Preview 탭도 control 버튼을 렌더하지 않는다. 조종(command 전송)은 [[SPEC-203-terminal-workspace]] terminal 모드의 ComposedInput(Control arm)에서만 가능하며, control action flow(modal·target 재검증·optimistic update·§2.11 disabled predicate)는 [[SPEC-400-control-actions]] 소유다. `preview` 필드(terminal tail)도 map 모드에서 렌더하지 않는다 — live 관전은 terminal 모드 viewport([[SPEC-203-terminal-workspace]])가 소유한다.
- terminated/stale orc: 즉시 제거하지 않고([[SPEC-005-data-contract]] §3.2-6, R-ORC-006) 마지막 정상 metadata를 유지하며 종료/stale 라벨과 refresh 안내를 표시한다([[04-Frontend]] 오류 처리).

### 2.5 Terminal Preview 컴포넌트 계약 — **REMOVED(2026-07-08, superseded by [[SPEC-203-terminal-workspace]])**

> **제거 사유**: map 모드 dock의 read-only redacted preview peek(`PanePreview`/`TerminalPreview`)과 그 inline `CommandDock`이 코드에서 **삭제**됐다(`web/src/components/preview/` 디렉터리·`web/src/components/control/CommandDock.tsx` 제거, web client `api.getOrcPreview` 호출 제거). live pane **관전**의 유일한 surface는 이제 [[SPEC-203-terminal-workspace]] terminal 모드 viewport(xterm)이고, **조종(command 전송)**은 그 ComposedInput(Control arm)이다. 따라서 본 절이 규정하던 컴포넌트 계약(`TerminalPreviewProps`·렌더 규칙 1~7·exposure 토글·line-count 컨트롤·`preview=null` vs `lines=0` 구분·텍스트 selection/copy)은 map 모드에서 **더 이상 존재하지 않는다**.

- **read-only/redaction 불변식(구 렌더 규칙 7 = 불변식 ③)은 일반 원칙으로 존속**한다: live pane 텍스트를 그리는 표면은 backend가 이미 redaction한 텍스트만 렌더하고 frontend는 원문을 받지도·재구성하지도·추가 마스킹하지도 않는다([[SPEC-006-privacy-redaction]], R-PRIV-002). 이 원칙은 이제 map-mode preview가 아니라 [[SPEC-203-terminal-workspace]] viewport에 적용된다.
- **노출 게이트(R-PRIV-006)**: exposure on/off·line-count의 **저장 값**은 여전히 [[SPEC-500-settings-persistence]]가 소유하되, 이를 **소비해 raw 텍스트를 게이트**하는 주체는 map 모드가 아니라 [[SPEC-203-terminal-workspace]] §2.8 viewport exposure gate다(§5 Traceability 참조).
- **서버 endpoint 불변**: `GET /api/orcs/:orcId/preview` 서버 endpoint 자체의 존재는 본 개정 범위 밖이다 — web client가 더 이상 호출하지 않을 뿐이며, 그 endpoint의 계약을 규정하는 상류 spec 진술은 그대로 유효하다(본 spec은 이를 삭제하지 않는다).
- **Q6(대화형 터미널) 경로**: 구 §2.5 TODO의 "대화형 터미널로의 개선"은 [[SPEC-203-terminal-workspace]](read-only 고충실 view [[SPEC-103-pane-live-stream]] + arm 기반 passthrough [[SPEC-401-interactive-input]])로 **완전히 이관**됐다(§6 Q6).

### 2.5a Dock preview peek ↔ terminal 모드 공존 — **REMOVED(2026-07-08, no longer applicable)**

> **제거 사유**: 본 절은 dock Preview peek과 terminal 모드의 **공존·이관(promotion)·공유 exposure gate**를 규정했으나, 2026-07-08 개정으로 dock Preview peek 자체가 삭제됐다. 이제 "두 표면"이 아니라 **terminal 모드 단일 표면**만 live pane view를 소유하므로, peek↔terminal 이관·공존 계약은 성립하지 않는다. 공유 exposure gate·read-only/redaction 불변식 공유·arm 기반 passthrough는 이제 온전히 [[SPEC-203-terminal-workspace]](§2.8 exposure gate·§2.5 캐시 purge) + [[SPEC-401-interactive-input]]가 소유한다. map↔terminal **진입 제스처**(camp header `LayoutModeSwitcher`, 맵 orc 더블클릭/Enter)는 §2.3a-6이 참조하고 [[SPEC-203-terminal-workspace]] §2.1이 소유한다(불변).

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

### 3.5 terminal preview 노출 동작 — **이관(2026-07-08) → [[SPEC-203-terminal-workspace]]**

> map 모드에는 더 이상 preview 텍스트 표면이 없다(§2.5 REMOVED). 구 §3.5 동작 불변식(exposure off → 텍스트 미요청·미표시, exposure on → backend redacted tail만 표시, line-count 상한, redacted/truncated/lines 메타 상시 노출)은 이제 [[SPEC-203-terminal-workspace]] §2.8 viewport exposure gate가 소유한다. 노출 값(exposure on/off·line count)의 저장은 [[SPEC-500-settings-persistence]]가 소유한다. 일반 원칙(불변식 ③ frontend 비-redaction)은 존속하며 SPEC-203 viewport에 적용된다.

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

- **deep link not-found**: `campId`/`orcId`가 현재 snapshot에 없으면(종료/미존재) inspector/detail은 "not found / 종료됨" 상태로 렌더하고 camp list로 복귀 경로를 제공한다(앱 라우팅은 [[SPEC-200-frontend-architecture]]).
- **`TerminalPreview` 표준 상태 행 제거(2026-07-08)**: 구 `TerminalPreview`(preview skeleton / `lines=0` "no output" / `preview=null` "preview unavailable" / exposure off "Preview hidden")와 "`preview=null` ≠ `lines=0`" 구분 규칙은 map 모드에서 제거됐다. 해당 상태 처리는 이제 [[SPEC-203-terminal-workspace]] viewport(§2.8 등)가 소유한다.

### 3.8 반응형 동작 (확정·구현 — 단일 컬럼 통합)

1. **모든 폭에서 단일 컬럼**: camp detail은 **map(full-width) → CampDock(full-width 탭, 하단)** 단일 컬럼이다(§2.3/§2.3a). 우측 inspector 컬럼·별도 activity rail은 제거됐다.
2. **bottom-sheet 제거(supersede)**: 구 모델의 mobile slide-up bottom-sheet는 **제거**됐고 동일 dock 탭(§2.3a)으로 대체됐다. raw `tmuxTarget`+`paneId`·status+confidence는 dock의 Details 탭에서 모든 폭에서 도달 가능하다(R-UI-007 보존). **(2026-07-08)** terminal preview·control 진입점은 map 모드 dock에서 제거됐고 [[SPEC-203-terminal-workspace]] terminal 모드에서 도달한다(R-PRIV-006 viewport·[[SPEC-400-control-actions]] flow).
   > **NOTE (superseded — #45 bottom-sheet)**: 이전 NOTE(≤880px slide-up bottom-sheet `role="dialog"` + focus-trap)는 단일 dock 통합으로 **superseded**됐다. `BottomSheet`/`useMediaQuery` 컴포넌트는 코드에 잔존하나 `CampDetailView`에서 미사용이다(§2.3). 맵 drag-to-pan은 pointer/touch에서 계속 동작한다([[SPEC-301-camp-map-movement]] §2.7 #42).
3. **세로 우선 스크롤**: 단일 컬럼이므로 좁은 폭에서도 map → dock 순으로 세로 스크롤되며 별도 modal 전환이 없다. tokens-only·reduced-motion-safe([[SPEC-202-design-accessibility]]). dock 탭 전환은 zero layout shift(§2.3a-4).

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
       status(+statusConfidence), currentWorkSummary(+summarySource), lastActivityAt 를 read-only 로 표시하고
       (map 모드는 read-only — terminal preview 도 control 진입점도 없다; live 관전·조종은
        [[SPEC-203-terminal-workspace]] terminal 모드에서 도달, §2.4/AC-15),
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

> **SPEC-201-AC-09 — REMOVED(2026-07-08)**: TerminalPreview exposure 토글·line-count 컨트롤 AC. map 모드 preview 제거로 무효. 노출 게이트 검증은 [[SPEC-203-terminal-workspace]](viewport exposure gate) 소유로 이관.

> **SPEC-201-AC-10 — REMOVED(2026-07-08)**: TerminalPreview redacted 텍스트 표시(추가 redaction 금지·redacted/truncated 배지·selection/copy) AC. map 모드 preview 제거로 무효. frontend 비-redaction 검증은 [[SPEC-203-terminal-workspace]] viewport(불변식 ③) 소유로 이관.

> **SPEC-201-AC-11 — REMOVED(2026-07-08)**: `preview=null`(capture 실패) vs `preview.lines=0`(출력 없음) 구분 렌더 AC. map 모드 preview 제거로 무효. 해당 상태 구분은 [[SPEC-203-terminal-workspace]] viewport 소유로 이관.

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
SPEC-201-AC-13 (R-UI-004, [[SPEC-400-control-actions]]/[[SPEC-203-terminal-workspace]] 경계) — map 모드는 read-only
  Given orc 를 선택해 map 모드 dock(Details/Activity)이 열린 상태에서
  When dock 전체를 검사하면
  Then map 모드 어느 탭에도 control 진입점(send/key/interrupt 버튼)이나 terminal preview 가 존재하지 않고
       (구 Preview 탭·CommandDock·PanePreview 부재),
       조종은 오직 [[SPEC-203-terminal-workspace]] terminal 모드 ComposedInput(Control arm)에서만 가능하며,
       실제 action flow(modal·target 재검증·결과 반영)는 [[SPEC-400-control-actions]] 로 위임된다.
```

```text
SPEC-201-AC-14 (R-UI-003, 비기능 성능)
  Given 20 session / 100 pane 규모 snapshot 에서
  When WS batch 가 적용되어 status 가 갱신될 때
  Then camp list/detail 의 scroll position·layout 이 튀지 않고(layout shift 없음),
       batch 적용 후 1회 render 로 반영된다([[SPEC-102-realtime-sync]] §2.5/§3.6).
       (측정 절차·임계는 [[SPEC-007-test-validation]].)
```

```text
SPEC-201-AC-15 (R-UI-004, R-UI-007, [[SPEC-203-terminal-workspace]] 경계) — 단일 dock·read-only 두 탭
  Given camp detail 을 임의의 뷰포트 폭에서 렌더할 때
  When 화면 구조를 검사하면
  Then map 이 행 전체 폭을 차지하고 그 아래 단일 CampDock 이 존재하며(우측 inspector 컬럼·mobile bottom-sheet 부재),
       dock 은 Details / Activity 2개 탭(role=tab, WAI-ARIA tabs, roving tabindex)만 가지고(구 Preview 탭 부재),
       기본 활성 Details 탭은 OrcInspector(raw tmuxTarget+paneId·status+confidence)를 read-only 로 렌더하되
       control 버튼(Send)도 terminal preview 도 없으며(map 모드 read-only),
       선택 orc 가 없으면 Details 가 empty hint("select an orc")를 렌더하되 dock 은 유지된다.
```

> **SPEC-201-AC-16 — REMOVED(2026-07-08)**: 구 Preview 탭 lazy mount·exposure-gated `getOrcPreview` fetch·control dock 동거 AC. Preview 탭·PanePreview·CommandDock·`getOrcPreview` 제거로 무효. lazy view attach·exposure gate 검증은 [[SPEC-203-terminal-workspace]]로 이관.

```text
SPEC-201-AC-17 (R-UI-012, [[08-Decisions|D-045]], [[SPEC-203-terminal-workspace]] 경계) — map→terminal 진입 제스처(선택 보존)
  Given orc 를 선택한 map 모드(read-only dock: Details/Activity)에서
  When (i) camp header LayoutModeSwitcher 의 terminal 토글 또는 맵 orc 더블클릭·Enter 로 terminal 모드로 진입하고
       (ii) 다시 map 모드로 돌아오면
  Then (i) layoutMode='terminal' 로 전환되며 selection(?orc=)·campId 가 보존되고(terminal 화면·관전·조종은 [[SPEC-203-terminal-workspace]] 소유),
       (ii) map 모드로 돌아오면 dock 이 read-only 두 탭(Details/Activity)으로 그대로 렌더되며(구 Preview peek 부재),
       어느 모드든 선택 SSOT 는 동일 ?orc= 다.
       (참고: 구 Preview 탭 내부 "Open terminal"/"Expand" affordance 는 Preview 탭과 함께 제거됐다.)
```

> **SPEC-201-AC-18 — REMOVED(2026-07-08)**: dock Preview peek ↔ terminal 모드 **공유 exposure gate** AC. dock peek 제거로 "두 표면 공유" 전제가 무효. 글로벌 exposure off 시 raw 텍스트 미표시·미요청 검증은 이제 단일 표면(terminal 모드) 대상으로 [[SPEC-203-terminal-workspace]] §2.8이 소유한다.

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-001 | camp list 첫 화면 + StatusSummaryBar(최상위 statusSummary) | SPEC-201-AC-01, AC-02 |
| R-UI-002 | CampCard 콘텐츠 매핑(session명·win/pane·orc·active/waiting/error/stale·lastActivity) | SPEC-201-AC-01, AC-02 |
| R-UI-003 | CampScene window=lane / pane=slot 배치, 비-orc pane 처리, layout 안정성 | SPEC-201-AC-03, AC-14 |
| R-UI-004 | OrcInspector Details 탭(read-only metadata·confidence·summary+estimated·provenance), read-only dock 두 탭(Details/Activity) 통합. **map 모드는 read-only** — terminal preview·control 진입점은 제거(2026-07-08), live 관전·조종은 [[SPEC-203-terminal-workspace]] 소유 | SPEC-201-AC-04, AC-13, AC-15 |
| R-UI-005 | 7종 상태 구분 렌더 + 레이어링(전체화면/overlay/범위), no-agent≠no-session, disconnected≠stale, tmux-error scoping | SPEC-201-AC-05, AC-06, AC-07, AC-12 |
| R-UI-007 | raw tmux target 상시 노출(card/detail/inspector Details 탭), 표시 전용 vs 권위 식별자 | SPEC-201-AC-08, AC-15 |
| ~~R-PRIV-006~~ (2026-07-08 이관 → [[SPEC-203-terminal-workspace]]) | SPEC-201은 더 이상 preview 컴포넌트를 렌더하지 않으므로 R-PRIV-006을 **소유·충족하지 않는다**(frontmatter `requirements`에서 제거). 노출 on/off·line count의 **저장 값**은 [[SPEC-500-settings-persistence]]가, 이를 소비하는 **viewport exposure gate**는 [[SPEC-203-terminal-workspace]] §2.8이 소유. 구 AC-09/AC-10/AC-16/AC-18은 REMOVED | — (SPEC-203 소유) |
| R-UI-012 (부수; 1차 [[SPEC-203-terminal-workspace]]) | map→terminal **진입 제스처**(LayoutModeSwitcher·맵 orc 더블클릭/Enter, 배치만 참조)·선택 SSOT(`?orc=`) 보존. terminal 화면/스위칭/관전조종·공유 exposure gate는 [[SPEC-203-terminal-workspace]] 소유(구 dock peek 이관·공존 §2.5a는 REMOVED) | SPEC-201-AC-17 |

> 부수 충족(1차 소유는 타 spec): **R-ORC-005**(estimated/confidence 사실-단정 금지 표시 — 데이터 1차 [[SPEC-005-data-contract]]; 본 spec은 렌더, AC-04), **R-PRIV-002**(backend redaction 후 전달 — 1차 [[SPEC-006-privacy-redaction]]; 2026-07-08 map 모드 preview 제거로 본 spec은 더 이상 pane 텍스트를 렌더하지 않음 → frontend 비-redaction 표시 검증은 [[SPEC-203-terminal-workspace]] viewport로 이관, 구 AC-10 REMOVED), **R-API-002/R-UI-005 신호**(disconnected/stale — 신호 산출 1차 [[SPEC-102-realtime-sync]]; 본 spec은 화면 렌더, AC-07), **R-TMUX-004**(target 실패 격리 — 1차 [[SPEC-002-tmux-discovery]]; 본 spec은 국소 error 렌더, AC-12), **R-TMUX-006**(빈 상태 구분 — 1차 [[SPEC-005-data-contract]]; 본 spec은 화면 구분, AC-05/AC-06). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **U1 — `preview.text` 전달 경로(2026-07-08 해소/이관)**: map 모드 preview 제거로 SPEC-201에는 더 이상 `preview.text` 전달 문제가 없다. live pane view 전달 경로(`view.attach`/`pane_view*`·exposure-gated)는 이제 [[SPEC-203-terminal-workspace]]/[[SPEC-103-pane-live-stream]]이 소유한다. (참고: 서버 endpoint `GET /api/orcs/:orcId/preview`는 존치하되 web client가 더 이상 호출하지 않는다.)
- **U2 — preview default 노출 범위(이관 → [[SPEC-500-settings-persistence]]/[[SPEC-203-terminal-workspace]])**: default exposure/lineCount 가설은 SPEC-201이 더 이상 렌더 주체가 아니므로 저장 값은 [[SPEC-500-settings-persistence]](R-SET-001)가, 소비(viewport gate)는 [[SPEC-203-terminal-workspace]]가 소유한다.
- **U3 — line-count 상한 vs backend tail(이관)**: live tail 상한(P1 R-P1-012)·`PREVIEW_LINES` vs `CAPTURE_LINES` 조율은 이제 live view surface([[SPEC-203-terminal-workspace]]/[[SPEC-103-pane-live-stream]]/[[SPEC-006-privacy-redaction]]) 소유다. SPEC-201은 관여하지 않는다.
- **U4 — DESIGN 청사진 레이아웃 stale(3-pane + bottom-sheet + preview 탭)**: `DESIGN.md`(L207-208)·`docs/design/DESIGN.md`(L58-59)는 여전히 **desktop 3-pane(camp scene·inspector·activity rail) + mobile bottom-sheet** 레이아웃을 기술한다. 본 spec §2.3/§2.3a/§3.8의 **단일 컬럼 + read-only 탭 dock**(우측 컬럼·bottom-sheet 제거) 및 2026-07-08 개정(Preview 탭 제거, dock=Details/Activity 두 탭)과 충돌한다. **write scope(`docs/specs/`) 밖**이므로 직접 수정하지 않고 기록한다 — orchestrator/user가 DESIGN 청사진의 layout 문단을 "single-column map + 하단 read-only 탭 dock(Details/Activity), live 관전·조종은 terminal 모드([[SPEC-203-terminal-workspace]])"로 갱신할 것을 제안한다.

### Open Questions (검토 필요)

- **Q1 — control 진입점 소유(2026-07-08 해소)**: control 진입점은 map 모드 dock에서 **완전히 제거**됐다(구 Preview 탭·`CommandDock` 삭제). 조종 진입점 배치·arm/disarm·disabled predicate 가시화는 모두 [[SPEC-203-terminal-workspace]](ComposedInput Control arm)·[[SPEC-400-control-actions]](§2.11 predicate·flow)가 소유한다. SPEC-201은 map 모드가 read-only임만 규정한다(§2.4/AC-13) — 경계 확정됨.
- **Q2 — 비-orc pane 시각화 수준**: 비-orc pane을 빈 camp slot으로 그릴지(§2.3) 완전히 숨길지는 정보 밀도 vs 단순성 trade-off다. [[03-UX-UI]] "window를 실제 공간으로 표현할지 agent 중심 재배치할지" Open Question과 함께 prototype으로 보정. **검토 필요.**
- **Q3 — mobile 범위(부분 해소)**: 구 3-pane + mobile bottom-sheet 분기는 **단일 컬럼 dock**(§2.3a/§3.8)으로 통합돼 desktop/mobile 레이아웃 분기가 제거됐다(map full-width + dock 탭, 모든 폭 공통). 남은 미확정은 좁은 폭에서의 dock 높이·맵 viewport 비율 튜닝(가설)뿐이다([[03-UX-UI]] Open Question). **검토 필요(튜닝).**
- **Q6 — live view + passthrough 전환(2026-07-08 완전 이관)**: 구 §2.5 TODO의 "대화형 터미널로의 확장"은 [[18-Terminal-Workspace]] 설계안(R-UI-012, [[08-Decisions|D-045]]/[[08-Decisions|D-046]])으로 구체화됐고, 2026-07-08 개정으로 dock preview peek이 제거되면서 **terminal 모드가 유일한 live 관전·조종 표면**이 됐다 — read-only 고충실 view([[SPEC-103-pane-live-stream]] `pane_view*`, xterm.js 렌더 [[SPEC-203-terminal-workspace]])와 arm 기반 키보드 passthrough([[SPEC-401-interactive-input]]). read-only/redaction 불변식(불변식 ③, R-PRIV-002)은 view가 redaction-before-transport로, write는 기존 `controlExec` single-writer 재사용으로 보존된다. SPEC-201은 map 모드 read-only 화면과 map→terminal 진입 제스처 참조(§2.3a-6)만 소유한다 — dock↔terminal 이관·공존(§2.5a)은 REMOVED. **경계 확정됨.**
- **Q4 — DOM vs canvas scene**: 100-pane scene 렌더를 DOM sprite로 갈지 canvas로 갈지는 [[SPEC-300-asset-rendering]]/[[04-Frontend]] Open Question(접근성·성능 trade-off)이다. 배치/선택은 본 spec, 렌더 매체 결정은 SPEC-300. [[SPEC-007-test-validation]] 측정으로 보정.
- **Q5 — terminated/stale retention 표시 시간**: orc를 종료 후 얼마나 남길지(retention window)는 [[SPEC-004-status-inference]] §3.7 소유다. inspector/scene의 fade-out·정리 타이밍은 그 값에 맞춰 표시만 한다(본 spec은 표시, retention은 상류).
