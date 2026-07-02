---
spec: SPEC-203
title: Terminal Workspace — terminal 모드 화면·orc rail·스위칭·xterm.js·관전/조종 표시
status: approved
updated: 2026-07-02
requirements: [R-UI-012, R-UI-005, R-UI-007, R-UI-008, R-PRIV-006]
decisions: [D-045, D-046, D-044, D-043, D-035]
tags:
  - specs
  - frontend
  - terminal
  - workspace
  - xterm
  - epic-3
---

# SPEC-203 — Terminal Workspace (terminal 모드 화면·orc rail·스위칭·xterm.js·관전/조종 표시)

[[18-Terminal-Workspace]] §3의 **Terminal Workspace**를 구현 가능한 화면 계약으로 고정한다. camp detail 안에서 **map 모드 ↔ terminal 모드**를 전환해, 선택된 orc(=tmux pane)를 **tmux pane에 준하는 터미널 화면**(xterm.js)으로 보고, camp 컨텍스트를 벗어나지 않고 **자리에서 오크를 전환하며 관전·조종**하는 작업공간의 **레이아웃·스위칭·모드 표시·접근성**을 소유한다([[08-Decisions|D-045]]/[[08-Decisions|D-046]], R-UI-012).

본 spec은 **화면 표면(terminal-mode UI)**만 소유한다. 화면에 그릴 **데이터(pane view read 채널)**는 [[SPEC-103-pane-live-stream]]가, **키보드 입력·arm/disarm 보안 의미**는 [[SPEC-401-interactive-input]]가, **map-mode dock 화면(camp list/detail/inspector/dock preview peek)**은 [[SPEC-201-dashboard-screens]]가 소유한다.

> **소유 경계**:
> - **소유(본 spec, SPEC-203)**: terminal 모드 진입/라우팅(`?orc=` SSOT 미러)·레이아웃(camp header / Orc Rail / Terminal Viewport / status bar / composed input)·오크 스위칭 4수단 + 퀵 스위처 + LRU last-screen·xterm.js 통합/lazy-load·재현 한계 UI 표현(D-045)·관전(Observe)/조종(Control) **시각 표시·터미널 focus·키보드 트랩 규칙**·armed focus의 `C-c` **라우팅 결정**·auto-disarm **카운트다운 표시**·waiting 오크 강조·per-component 표준 상태.
> - **참조(타 spec 소유)**: `view.attach`/`view.detach`·`pane_view_seed`/`pane_view`/`pane_view_end`·폴링/부하 한도·redaction 경계·스크롤백 seed/cursor read → [[SPEC-103-pane-live-stream]]. arm/disarm 수명주기·`INTERACTIVE_KEY_ALLOWLIST`·keystroke rate cap·배치 audit·`PASSTHROUGH_IDLE_MS`·`C-c` confirm/`/interrupt` **server 의미** → [[SPEC-401-interactive-input]] / [[SPEC-400-control-actions]]. 라우팅·store·`?orc=` SSOT·code-split 배선 → [[SPEC-200-frontend-architecture]]. design token·키보드/focus·reduced-motion·contrast·색-비의존 규칙 → [[SPEC-202-design-accessibility]]. map-mode dock 화면·dock preview peek·7종 dashboard 상태 산출 → [[SPEC-201-dashboard-screens]]. sprite/portrait 렌더 → [[SPEC-300-asset-rendering]]. 공간 맵(map 모드) 배치·movement → [[SPEC-301-camp-map-movement]].

> **불변식(확정)**:
> - **① 선택 SSOT는 `?orc=`**: map/rail/URL 어디서 바꿔도 `?orc=<orcId>`(권위 키 `orcId`=`pane:`+paneId, [[08-Decisions|D-017]]/[[08-Decisions|D-035]])로 동기화된다. terminal 모드는 이 selection SSOT를 **소비만** 하고 새 식별자를 만들지 않는다([[SPEC-200-frontend-architecture]] §2.2).
> - **② read-only·redaction-before-transport 상속**: viewport에 그리는 텍스트는 [[SPEC-103-pane-live-stream]]가 이미 redaction한 `pane_view*` 프레임의 `lines`뿐이다. frontend는 원문을 받지도·재구성하지도·추가 마스킹하지도 않는다(불변식 [[SPEC-201-dashboard-screens]] ③ 확장, [[SPEC-006-privacy-redaction]]).
> - **③ Observe = no egress**: 조종(Control)으로 명시 arm하기 전에는 어떤 키스트로크도 나가지 않는다. server가 이를 강제하고([[SPEC-401-interactive-input]] §2.5, `409 not_armed`), 본 spec은 arm 없이는 xterm이 키를 **캡처(trap)조차 하지 않도록** UI를 강제한다(§2.6).
> - **④ 상태·모드는 색만으로 전달하지 않는다**: Observe/Control 모드, orc status, 연결/노출 상태는 icon/label/border-style/pose를 함께 쓴다([[SPEC-202-design-accessibility]] §2.2, R-UI-005).
> - **⑤ 재현은 capture-pane 한계 안**: viewport는 스크롤백 seed(`CAPTURE_LINES`=200부터)·cursor·현재 보이는 화면(alternate-screen 포함, 캡처된 그대로)만 재현하고, 진짜 cell-diff emulation·scroll-region/mouse-tracking/OSC 완전 재현은 하지 않는다([[08-Decisions|D-045]]). 이 한계를 UI에 명시한다.

## 1. Scope

### In scope

- **terminal 모드 화면 인벤토리와 진입**(R-UI-012): camp detail 내 **map 모드 ↔ terminal 모드** 토글(기존 `LayoutModeSwitcher` 확장), 맵에서 orc **더블클릭/Enter** 진입, `?orc=` deep-link 복원.
- **레이아웃 계약**: camp header(뒤로가기·상태 칩·모드 스위처) · **Orc Rail**(portrait 썸네일 + StatusBadge + 한 줄 요약, waiting 강조) · **Terminal Viewport**(xterm.js, native cols×rows, fit/scale, redacted 배지) · **status bar**(target·cwd·모드·지연) · **composed input**(개선된 CommandDock: 멀티라인 + 이력).
- **오크 스위칭 계약**: rail 클릭 · `[`/`]`(또는 ←/→) prev/next · `Cmd/Ctrl+1..9` rail 점프 · `Cmd/Ctrl+K` 퀵 스위처(이름/status fuzzy) · 전환 시 detach→attach([[SPEC-103-pane-live-stream]]) · 이전 오크 마지막 화면 **LRU 캐시**(즉시 전환 체감).
- **xterm.js 통합**(R-UI-012, [[08-Decisions|D-046]]): terminal 모드 진입 시 **lazy-load/code-split**, `pane_view*` 프레임 렌더, cursor 반영, 스크롤백 seed 렌더, 재현 한계 UI 표기([[08-Decisions|D-045]]).
- **관전/조종 시각 표시·focus 규칙**: 색-비의존 Observe/Control 표시, xterm 키 캡처는 **Control 모드에서만**, Observe는 트랩 금지 + escape/disarm 키, armed focus의 `C-c` → confirm/`/interrupt` 라우팅([[SPEC-401-interactive-input]] §2.7), auto-disarm 카운트다운(`PASSTHROUGH_IDLE_MS`=240s 정합).
- **노출 게이트 UI**(R-PRIV-006, [[08-Decisions|D-044]]): exposure off/`pane_view_end reason=exposure_off`면 raw 텍스트가 아닌 **명시적 gated 상태**를 렌더.
- **per-component 표준 상태**: loading/empty/exposure-off/disconnected/stale를 [[SPEC-201-dashboard-screens]] §2.6/§2.7 상태 모델·레이어링을 재사용해 terminal 모드에 매핑.
- 다룬 요구사항: **R-UI-012**(1차), R-PRIV-006(노출 UI 측면), R-UI-005/R-UI-007(터미널 컨텍스트 상태·raw target 표시), R-UI-008(부수: mode 공존).

### Out of scope (다른 spec으로 미룸)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| `view.attach`/`view.detach`·`pane_view*` 프레임 스키마·폴링/부하 한도·redaction 경계·seed/cursor read | pane view read 채널 | [[SPEC-103-pane-live-stream]] |
| arm/disarm endpoint·`INTERACTIVE_KEY_ALLOWLIST`·keystroke rate cap·재검증·배치 audit·`PASSTHROUGH_IDLE_MS` **server 값** | passthrough 보안 의미 | [[SPEC-401-interactive-input]] |
| `C-c` confirm modal·`/interrupt` 계약·send-keys 템플릿·optimistic update | destructive write 경로 | [[SPEC-400-control-actions]] |
| 라우팅 정의·store shape·`?orc=` mirror 메커니즘·lazy import/code-split 배선 | app 골격 | [[SPEC-200-frontend-architecture]] |
| design token 값·키보드 focus order/roving tabindex·reduced-motion·contrast 규칙 | 디자인·접근성 | [[SPEC-202-design-accessibility]] |
| map-mode dock(camp list/detail/inspector/dock preview peek)·7종 상태 산출 | in-map 화면 | [[SPEC-201-dashboard-screens]] |
| 공간 맵(map 모드) zone/station/slot 배치·movement/roaming | 공간 맵 | [[SPEC-301-camp-map-movement]] |
| sprite pose·portrait·placeholder 렌더 | asset 런타임 | [[SPEC-300-asset-rendering]] |
| preview line count·exposure **저장 값** | settings 영속화 | [[SPEC-500-settings-persistence]] |

## 2. Contract

### 2.1 화면 인벤토리·모드 전환·라우팅 (R-UI-012, R-UI-008, [[08-Decisions|D-035]])

terminal 모드는 **새 route가 아니라 camp detail(`/camps/:campId`)의 표시 모드**다. 라우팅 정의·`?orc=` mirror 메커니즘은 [[SPEC-200-frontend-architecture]] §2.2 소유이고, 본 spec은 그 위에서 **무엇을 렌더하는가**만 고정한다.

| 개념 | 값 | 출처 |
| --- | --- | --- |
| route | `/camps/:campId?orc=<orcId>` (terminal 모드도 동일 route) | [[SPEC-200-frontend-architecture]] §2.2 |
| 모드 상태 | client `ui` slice `layoutMode: 'map' \| 'terminal'` (세션-local) | [[SPEC-200-frontend-architecture]] §2.3 `ui` slice |
| 선택 SSOT | `?orc=<orcId>` (map/rail/URL 동기, 불변식 ①) | [[08-Decisions|D-017]]/[[08-Decisions|D-035]] |

- **모드 스위처(확정)**: camp detail 헤더의 기존 `LayoutModeSwitcher`를 **map/terminal 2-value 토글**로 확장한다. 토글은 `layoutMode`만 바꾸고 `?orc=` selection·`campId`를 보존한다(모드 전환이 선택을 잃지 않는다).
- **진입 제스처(확정)**: map 모드에서 orc를 **더블클릭 또는 포커스 후 `Enter`**하면 그 orc를 선택(`?orc=`)하며 `layoutMode='terminal'`로 전환한다. 단일 클릭은 기존대로 선택만(map 모드 유지, [[SPEC-201-dashboard-screens]] §2.3 selection).
- **deep-link 복원(확정)**: `?orc=<orcId>`가 있는 URL로 진입하면 selection이 복원된다. `layoutMode` 자체는 URL이 아니라 client state이므로 deep-link는 기본 map 모드로 열리고(모드는 URL 식별자가 아님), 사용자가 스위처로 terminal 모드에 들어간다(모드까지 공유하려는 요구는 §6 Q1 forward).
- **선택 부재(확정)**: `?orc=`가 없는 채 terminal 모드면 Terminal Viewport는 empty("select an orc")를 렌더하고 Orc Rail은 유지한다(§2.8).
- **mode 공존(R-UI-008 부수, 확정)**: terminal 모드는 map 모드(공간 배치·status의 공간 표현, [[SPEC-301-camp-map-movement]]/R-UI-008)를 **대체하지 않고 병존**한다. 두 모드는 동일 status source([[SPEC-005-data-contract]] `Orc.status`+`statusConfidence`)를 소비하며, 스위처로 언제나 map 모드로 돌아갈 수 있다(R-UI-008 공간 표현은 SPEC-301이 계속 소유).

### 2.2 레이아웃 계약 (R-UI-012, R-UI-007)

terminal 모드 레이아웃은 [[18-Terminal-Workspace]] §3.1 5-region 구조를 고정한다. region 배치·간격·token은 [[SPEC-202-design-accessibility]] 소유(값 복제 금지), 본 spec은 **구성·콘텐츠·상태**를 소유한다.

```text
┌────────────────────────────────────────────────────────┐
│ CampHeader (뒤로가기 · 상태 칩 · LayoutModeSwitcher)      │  ← 2.1
├──────────┬─────────────────────────────────────────────┤
│ OrcRail  │  TerminalViewport (xterm.js)                │  ← 2.3 / 2.4
│ (2.3)    │  native cols×rows · fit/scale · redacted 배지 │
│          │─────────────────────────────────────────────│
│          │ TerminalStatusBar: target·cwd·mode·latency  │  ← 2.7
│          │ ComposedInput (개선된 CommandDock)            │  ← 2.7
└──────────┴─────────────────────────────────────────────┘
```

```ts
// 본 spec 소유 — terminal 모드 컴포넌트 계약(도메인 타입은 [[SPEC-005-data-contract]] import)
type LayoutMode = 'map' | 'terminal';

interface TerminalWorkspaceProps {
  campId: string;                 // "session:"+sessionId
  selectedOrcId: string | null;   // ?orc= mirror ([[SPEC-200-frontend-architecture]] ui slice)
  layoutMode: LayoutMode;
  onSelectOrc(orcId: string): void;     // rail/switch → ?orc= 갱신(불변식 ①)
  onExitTerminalMode(): void;           // 스위처/뒤로가기 → layoutMode='map'
}
```

- **CampHeader(확정)**: 뒤로가기(→ camp list), camp 식별(`tmuxSessionName`+`sessionId`, R-UI-007 상시 노출), 집계 상태 칩(`statusSummary`), `LayoutModeSwitcher`. header는 map/terminal 공통.
- **레이아웃 안정성(확정)**: orc 추가/상태 변화/hover/스위칭으로 region의 aspect ratio·scroll position이 튀면 안 된다(zero layout shift, [[SPEC-202-design-accessibility]] M3/B6, [[SPEC-201-dashboard-screens]] §3.6과 동일 불변식). viewport 크기 변화는 xterm fit(§2.4)로 흡수한다.

### 2.3 Orc Rail 계약 (R-UI-012, R-UI-005, R-UI-007)

Orc Rail은 camp 내 orc 목록을 세로 rail로 표시하는 스위칭·orchestration 표면이다.

```ts
interface OrcRailItem {
  orcId: string;                  // 권위 키(pane:+paneId)
  portrait: PortraitRef;          // sprite/portrait 참조 — 렌더는 [[SPEC-300-asset-rendering]]
  status: OrcStatus;              // 7종 enum
  statusConfidence: number;       // 사실 단정 금지(불변식 ④)
  summaryLine: string;            // currentWorkSummary 1줄 요약(estimated 마커 동반)
  summaryIsEstimated: boolean;
  tmuxTarget: string;             // raw target 라벨(R-UI-007)
  selected: boolean;              // selectedOrcId === orcId
  emphasized: boolean;            // status === 'waiting' (§2.3 orchestration 신호)
}
```

- **항목 구성(확정)**: 각 rail 항목은 `portrait 썸네일` + `StatusBadge`(icon+label+confidence, [[SPEC-202-design-accessibility]] §2.3) + `summaryLine`(한 줄) + `tmuxTarget` 라벨을 가진다. status는 항상 `statusConfidence`와 함께, summary는 `summaryIsEstimated=true`면 estimated 마커와 함께 렌더한다(R-UI-005/R-ORC-005 정합).
- **waiting 강조(확정, orchestration 1차 신호; 2026-07-02 리뷰 반영)**: `status === 'waiting'`(입력 대기) 항목은 rail-item 수준에서 **StatusBadge와 별개의 뚜렷한 emphasis 채널**을 갖는다 — StatusBadge(icon+label+confidence, [[SPEC-202-design-accessibility]] 소유)를 **대체하지 않고 그 위에 덧붙인다**(ownership 충돌 없음): (a) rail 항목 자체의 **leading emphasis marker/pip**("needs input"), (b) **정렬 승격**(waiting 항목을 rail 상단 그룹으로 pin), (c) 항목 컨테이너 **border/weight 강조**. 세 채널 모두 **색-비의존**이라 grayscale에서 일반 `waiting` StatusBadge와도 구분되는 별도 emphasis level이 식별된다(불변식 ④, AC-12 검증). reduced-motion에서는 emphasis를 정적 표현(정적 marker·pin·정적 badge)으로 한다([[SPEC-202-design-accessibility]] M2). 카운트/토스트 orchestration은 [[18-Terminal-Workspace]] §3.4 후속.
- **선택/스위칭(확정)**: 항목 클릭/`Enter`/`Space` → `onSelectOrc(orcId)`로 `?orc=` 갱신(불변식 ①). rail은 zone(window)당 roving-tabindex 그룹으로 키보드 도달 가능([[SPEC-202-design-accessibility]] §2.4 K2 NOTE와 정합). 선택 항목은 `selected` 시각 표시(accent border + 별도 표식, 색 단독 금지).
- **raw target 상시 노출(확정, R-UI-007)**: rail 항목·status bar·viewport 어디서도 raw `tmuxTarget`(+ status bar의 `paneId`)이 항상 확인 가능하다. 표시 전용이며 reindex/rename으로 변해도 선택·스위칭은 권위 키(`orcId`)로 유지된다([[08-Decisions|D-017]]).

### 2.4 Terminal Viewport · xterm.js 통합 (R-UI-012, [[08-Decisions|D-045]]/[[08-Decisions|D-046]])

Terminal Viewport는 [[SPEC-103-pane-live-stream]] read 채널의 `pane_view*` 프레임을 xterm.js로 렌더한다.

```ts
// [[SPEC-103-pane-live-stream]] 소유 프레임(재인용, 본 spec은 소비만):
// server→client: pane_view_seed | pane_view | pane_view_end
//   payload: { orcId, cols, rows, cursor: {x,y} | null, lines: string[] /* redacted */, viewSeq, ... }
//   pane_view_end.reason: 'detached' | 'pane_gone' | 'exposure_off' | 'tab_hidden' | 'superseded' | 'error'
// client→server: view.attach {orcId} | view.detach {orcId}

interface TerminalViewportProps {
  orcId: string | null;
  frame: PaneViewFrame | null;    // 최신 pane_view*(seed 포함) — [[SPEC-103-pane-live-stream]]
  endReason: PaneViewEndReason | null; // pane_view_end 수신 시
  exposureEnabled: boolean;       // 글로벌 exposure ([[08-Decisions|D-044]], settings 미러)
  connected: boolean;             // WS 전송 상태([[SPEC-200-frontend-architecture]] connection slice)
  stale: boolean;                 // server staleness (직교)
  controlMode: 'observe' | 'control';  // §2.6
}
```

- **lazy-load/code-split(확정, [[08-Decisions|D-046]])**: xterm.js와 그 addon(fit 등)은 **terminal 모드 최초 진입 시 dynamic import**로 로드한다(초기 번들에 포함하지 않음). 로드 중에는 viewport에 loading 상태(§2.8)를 렌더한다. 코드-스플릿 배선 메커니즘은 [[SPEC-200-frontend-architecture]] 소유이며, 본 spec은 "terminal 모드 전에는 xterm 청크가 로드되지 않는다"는 관측 가능한 계약을 요구한다.
- **attach/detach 트리거(확정)**: viewport가 mount되고 `orcId`가 있으며 exposure on + 탭 활성일 때 [[SPEC-103-pane-live-stream]] `view.attach {orcId}`를 보내고, unmount·orc 전환·exposure off·탭 hidden·terminal 모드 이탈 시 `view.detach`를 보낸다. attach는 **글로벌 exposure gate 상속 + 명시 focus/attach**를 요구한다([[08-Decisions|D-044]]).
- **렌더 규칙(확정, redaction 상속·불변식 ②)**: `pane_view_seed`의 `lines`(스크롤백 seed)로 xterm 버퍼를 초기화하고, 이후 `pane_view`의 `lines`/`cursor`로 화면을 갱신한다. 표시 텍스트는 프레임의 redacted `lines`뿐이며 frontend는 추가 마스킹·원문 재구성을 하지 않는다. `[REDACTED:*]` 토큰은 backend 산출 그대로 렌더한다.
- **native cols×rows·fit(확정)**: viewport는 프레임의 `cols`×`rows`를 pane native 크기로 반영하고, 뷰포트 물리 크기에 맞춰 **fit/scale**(축소 스케일 또는 스크롤)한다. cols×rows 변화·창 리사이즈는 layout shift 없이 흡수한다(§2.2).
- **재현 한계 표기(확정, [[08-Decisions|D-045]] 불변식 ⑤)**: viewport는 재현 수준을 UI로 정직하게 표기한다 — (a) redacted 배지(민감정보 가려짐), (b) "capture 기반(near-real-time)" 표식(진짜 실시간 emulation이 아님), (c) 스크롤백은 캡처 창(`CAPTURE_LINES`=200부터) seed로 시작하며 그 이전 히스토리는 없음을 표기. scroll-region/mouse-tracking/OSC 완전 재현은 하지 않으며(비목표), 이를 오해하지 않게 표시한다.
- **cursor(확정)**: 프레임 `cursor:{x,y}`가 있으면 xterm cursor 위치를 반영하고, `null`이면 cursor를 표시하지 않는다([[08-Decisions|D-045]] (b) cursor read; cursor read 메커니즘·format 변수는 [[SPEC-103-pane-live-stream]] 소유이며 본 spec은 프레임 `cursor` 필드만 소비한다).
- **접근성 — screen reader(확정, 2026-07-02 리뷰 반영, [[SPEC-202-design-accessibility]] 정합)**: canvas/DOM 렌더 터미널은 보조기술에 불투명하므로, xterm을 **`screenReaderMode: true`**(또는 동등 accessible live region)로 구성해 SR 사용자가 agent 출력(=핵심 작업 대상)을 읽을 수 있게 한다. redacted 배지·gated 상태·Observe/Control 표시기·latency 표식은 비어있지 않은 `aria-label`/`role="status"`류 accessible name을 갖는다([[SPEC-202-design-accessibility]] §2.4 K6). SR용 텍스트도 redacted `lines`만 노출한다(불변식 ②).
- **exposure off / end 상태(확정)**: `exposureEnabled === false`이거나 `pane_view_end reason='exposure_off'`면 raw 텍스트를 렌더하지 않고 §2.8의 gated 상태("preview hidden — exposure off")를 렌더한다. 다른 `end.reason`(`pane_gone`/`detached`/`tab_hidden`/`superseded`/`error`)도 §2.8 표준 상태로 매핑한다.

### 2.5 오크 스위칭 계약 (R-UI-012)

터미널 컨텍스트를 벗어나지 않고 오크를 전환하는 4수단 + 퀵 스위처를 고정한다. 모든 전환은 결국 `onSelectOrc(orcId)` → `?orc=` 갱신(불변식 ①)으로 수렴한다.

| # | 수단 | 동작 | 소유 |
| --- | --- | --- | --- |
| S1 | rail 클릭/`Enter`/`Space` | 해당 orc로 전환 | 본 spec §2.3 |
| S2 | `[` / `]` (또는 `←` / `→`) | rail 순서 기준 prev/next orc | 본 spec |
| S3 | `Alt+1..9` (lead-key `g` `1..9` 대안) | rail 순번 1..9 점프 | 본 spec |
| S4 | `Cmd/Ctrl+K` | 퀵 스위처(이름/status fuzzy) 열기 — **1차 점프 수단** | 본 spec |

- **S3 rebind(확정, 2026-07-02 리뷰 반영)**: rail 순번 점프는 `Cmd/Ctrl+1..9`가 **브라우저 탭 전환과 충돌**(대개 `preventDefault` 불가 → 앱이 못 받음)하므로, **비예약 chord `Alt+1..9`**(또는 lead-key `g` 후 `1..9`)로 바인딩한다. rail 순번 점프는 편의 수단이고, 이름/status 기반 **1차 점프 수단은 퀵 스위처 S4(`Cmd/Ctrl+K`)**다.
- **키 스코프(확정, Observe와 정합)**: 스위칭 단축키는 (a) Observe 모드에서 항상 동작하고, (b) Control 모드에서 xterm이 키를 캡처할 때는 **비-printable modifier 조합(`Cmd/Ctrl+K` S4, `Alt+digit` S3)**만 앱이 우선 가로채 passthrough로 새지 않게 하며, `[`/`]`(S2, plain key)는 Control 모드에서는 rail 포커스일 때만 동작한다(터미널 입력과 모호성 제거). 정확한 focus 우선순위는 [[SPEC-202-design-accessibility]] §2.4와 정합.
- **in-UI 단축키 legend(확정, 2026-07-02 리뷰 반영, nit)**: 스위칭·모드·disarm 단축키는 **shortcut-only 발견성에 의존하지 않는다** — rail/status bar에 상시 hint 또는 `?`/도움말 오버레이 legend로 노출한다(키보드 사용자·신규 사용자 발견성, [[SPEC-202-design-accessibility]] §2.4).
- **퀵 스위처(S4, 확정)**: `Cmd/Ctrl+K`로 orc 이름(`tmuxTarget`/summary)·status를 fuzzy 검색하는 오버레이를 연다. 오버레이는 focus trap(K5 성격)을 갖고 `Escape`로 닫히며 포커스를 트리거로 반환한다([[SPEC-202-design-accessibility]] §2.4 K4/K5). 선택 시 `onSelectOrc`. (P1 command palette R-P1-009는 이 backbone을 보존, [[SPEC-202-design-accessibility]] K7.)
- **전환 시 detach→attach(확정)**: orc 전환 시 workspace(레이아웃·모드)는 유지되고 **이전 orc `view.detach` → 새 orc `view.attach`**만 수행한다([[SPEC-103-pane-live-stream]]). 스트림 재구독으로 화면이 새 orc로 바뀐다.
- **LRU last-screen 캐시(확정, 값은 가설)**: 즉시 전환 체감을 위해 이전 orc의 **마지막 렌더 화면(redacted 프레임 스냅샷)**을 client LRU 캐시에 잠깐 보존해, 새 attach의 `pane_view_seed` 도착 전까지 이전 orc로 돌아오면 캐시 화면을 즉시 보여준다. 캐시는 **redacted 프레임만** 담고(원문 없음, 불변식 ②), **메모리 상한**(`TERMINAL_LRU_MAX` 항목 수 — 가설, §6 Q2)을 가지며 terminal 모드 이탈/탭 종료 시 폐기한다. 캐시 화면은 **stale로 명확히 표식**(라이브 아님)하고 새 프레임 도착 시 즉시 대체한다.
- **LRU vs exposure 우선순위(확정, 2026-07-02 리뷰 반영, 불변식 ③/[[08-Decisions|D-044]])**: 글로벌 exposure가 **off이면 LRU 캐시가 무효화되고 어떤 캐시 화면도 렌더되지 않는다** — exposure off 전이 시점에 LRU 캐시를 **즉시 purge**하고(캐시된 redacted 화면조차 표시 금지), exposure off 상태에서 캐시된 orc로 복귀해도 §2.8 gated 상태만 렌더한다. exposure는 캐시보다 **항상 우선**하며 이는 노출 게이트가 캐시로 우회되지 않게 한다(§2.4 exposure-off / §2.8, AC-05/AC-10 검증).

### 2.6 관전(Observe)/조종(Control) 표시·focus·키보드 트랩 (R-UI-012, [[SPEC-401-interactive-input]] 정합)

본 spec은 [[SPEC-401-interactive-input]]의 server 의미(arm-session·auto-disarm·allowlist·`C-c` 게이트)를 **화면·focus·라우팅으로 표면화**한다(server 값은 SPEC-401 소유, 본 spec은 그와 정합).

```ts
interface ControlModeState {
  mode: 'observe' | 'control';
  armSessionId: string | null;    // control일 때만 — [[SPEC-401-interactive-input]] §2.2
  idleTimeoutMs: number;          // arm 응답의 idleTimeoutMs (= PASSTHROUGH_IDLE_MS, 가설 240s)
  idleRemainingMs: number;        // auto-disarm 카운트다운 표시용
}

// disarm 키(확정, 2026-07-02 리뷰 반영) — TUI-critical 키와 충돌 없는 전용 chord.
const DISARM_KEY = 'Ctrl+Alt+.';  // 1차. 대안: 짧은 창 내 Escape 2연타(double-Escape).
                                  // 금지: Escape 단독(vim/Claude Code 필수)·C-c(interrupt 라우팅)·Tab(트랩된 유일 탈출키).
```

- **모드 색-비의존 표시(확정, 불변식 ④)**: Observe/Control을 **색만으로 구분하지 않는다** — viewport 테두리 **style**(예: Observe=solid muted, Control=heavy/double border) + **명시 label**("Observing" / "CONTROL — armed") + **icon**(눈/키보드류)을 함께 쓴다. grayscale에서도 두 모드가 구분되어야 한다([[SPEC-202-design-accessibility]] §2.2, AC-03 성격).
- **키보드 트랩은 Control에서만(확정, 불변식 ③)**: xterm.js가 키 입력을 캡처(브라우저 기본 동작 가로채기 = 트랩)하는 것은 **Control 모드일 때만**이다. **Observe 모드에서 viewport는 키를 트랩하지 않는다** — 스크롤/텍스트 선택/복사만 가능하고 `Tab`으로 정상적으로 focus를 빠져나갈 수 있다([[SPEC-202-design-accessibility]] §2.4 focus order 보존). Observe에서 오작동으로 키가 나가는 일이 없다(server도 `409 not_armed`로 이중 방어, [[SPEC-401-interactive-input]] AC-01).
- **arm/disarm UX(확정)**: 명시 토글(버튼) 또는 viewport 클릭 후 확인으로 arm한다 — client는 [[SPEC-401-interactive-input]] `POST /passthrough/arm`을 호출하고, 성공(`armSessionId`, `idleTimeoutMs`) 시 Control 모드로 전환한다. disarm(사용자 토글/escape) 시 `POST /passthrough/disarm`을 호출한다. arm 실패(재검증 drift `410/409`)면 Control로 전환하지 않고 사유를 표시한다.
- **escape/disarm 키(확정, 2026-07-02 리뷰 반영)**: Control 모드에서 사용자가 트랩을 벗어나는 disarm 키는 **`DISARM_KEY = Ctrl+Alt+.`**(대안 double-Escape)로 고정한다 — TUI-critical 키와 충돌하지 않도록 **`Escape` 단독·`C-c`·`Tab`을 disarm 키로 쓰지 않는다**(`Escape`는 vim/Claude Code 필수, `C-c`는 interrupt로 라우팅, `Tab`은 트랩 중 유일 탈출 경로가 되면 안 됨). 이 키는 passthrough로 나가지 않고 disarm→Observe 전환을 수행하며, **xterm이 Control 모드로 focus를 잡고 있어도 항상 최우선으로 동작한다**(키 핸들러가 xterm 캡처보다 먼저 가로챔). 전용 disarm 버튼도 병행 제공한다([[SPEC-202-design-accessibility]] §2.4).
- **auto-disarm 카운트다운(확정, 값 정합)**: Control 모드는 마지막 키스트로크 이후 무입력 시간을 표시하고, `idleRemainingMs`가 임계에 가까우면 카운트다운/경고를 보여준 뒤 server auto-disarm(`PASSTHROUGH_IDLE_MS`, 가설 240s)과 **동일 값**으로 Observe로 되돌아간다. UI 타이머는 server `idleTimeoutMs`(arm 응답)를 신뢰하며 독자 값을 쓰지 않는다([[SPEC-401-interactive-input]] §2.6 C3-(b) 정합). 키스트로크마다 타이머를 리셋한다.
- **armed `C-c` 라우팅(확정, 본 spec이 소유하는 client 라우팅)**: Control 모드로 xterm이 focus를 잡은 상태에서 사용자가 `C-c`(및 `C-d`/`C-z`/`C-\`)를 누르면, terminal key handler는 이를 **passthrough로 보내지 않는다**. `C-c`는 [[SPEC-400-control-actions]] §2.7 **interrupt confirm modal → `/interrupt {confirmed:true}`** 경로로 라우팅하고(파괴적 chord 확인 게이트 유지), 나머지 파괴적 chord(`C-d`/`C-z`/`C-\`)는 `INTERACTIVE_KEY_ALLOWLIST` 밖이므로 egress하지 않고 무시/안내한다([[SPEC-401-interactive-input]] §2.7 `PASSTHROUGH_FORBIDDEN_CHORDS`, AC-05 정합). confirm modal focus/trap은 [[SPEC-202-design-accessibility]] K5.
- **printable 배칭(참조)**: printable 키스트로크를 `PASSTHROUGH_LITERAL_BURST_MAX`(≤256B, 가설) 이하 burst로 묶어 `/input {submit:false, passthrough}`로 보내는 것은 client 책임이다([[SPEC-401-interactive-input]] §2.8 C3-(c)). Enter/named 키는 `/key {passthrough}`로 보낸다.

### 2.7 status bar · composed input (R-UI-012, R-UI-007)

- **TerminalStatusBar(확정)**: viewport 하단에 `tmuxTarget`+`paneId`(R-UI-007 raw 식별 상시), `cwd`(redaction 통과값, [[SPEC-006-privacy-redaction]] §2.3), **mode**(Observe/Control, §2.6 색-비의존), **latency**(마지막 `pane_view` 수신 지연/`viewSeq` 기반 표식)를 표시한다. latency는 near-real-time임을 알리는 표식이며 수치 임계는 가설(§3).
- **ComposedInput(확정)**: 하단 composed input은 기존 `CommandDock`([[SPEC-201-dashboard-screens]] §2.5, [[SPEC-400-control-actions]])의 개선판으로 **멀티라인 프롬프트 + 입력 이력**을 지원한다. 긴 프롬프트는 폼(멀티라인) 전송([[SPEC-400-control-actions]] `/input`)이, 짧은 상호작용(y/n·방향키·Enter)은 §2.6 passthrough가 담당한다(역할 분담).
- **control 가능성 표시(확정, 경계)**: ComposedInput·arm 토글은 [[SPEC-400-control-actions]] §2.11 disabled predicate(token 부재·orc `terminated`/`stale`·`disconnected`)에서 disabled + 사유로 표시한다. 실제 action flow(modal·재검증·결과)는 [[SPEC-400-control-actions]]/[[SPEC-401-interactive-input]] 소유다.
- **composed input과 passthrough 배타(확정)**: composed input에 focus가 있으면 그 키 입력은 폼 draft이며 passthrough로 새지 않는다(xterm viewport와 별개 focus 영역). passthrough는 viewport가 focus를 잡은 Control 모드에서만 발생한다(§2.6).

### 2.8 per-component 표준 상태 (R-UI-005, [[SPEC-201-dashboard-screens]] §2.6/§2.7 재사용)

terminal 모드는 [[SPEC-201-dashboard-screens]] §2.6 상태 모델과 §2.7 레이어링(A 전체화면 / B overlay / C 범위)을 **그대로 재사용**한다(새 상태 의미를 만들지 않음). terminal-mode 매핑:

| 컴포넌트 | loading | empty | exposure-off | disconnected(overlay) | stale(overlay) |
| --- | --- | --- | --- | --- | --- |
| Terminal Viewport | xterm chunk 로드 / seed 대기 skeleton | `orcId` 없음: "select an orc" · `lines=0`: "no output" | "preview hidden — exposure off"(raw 텍스트 미표시) | 마지막 화면 유지 + "지연 가능"(loading 복귀 없음) | 캐시/last-good 화면 + stale badge + refresh 진입점 |
| Orc Rail | rail skeleton | camp orcCount=0: "No agents detected" | (해당 없음 — 메타만) | 유지 + 배너 | 유지 + badge |
| ComposedInput | disabled(로딩) | selection 없음: disabled | disabled(노출 없이 blind 입력 방지, §6 Q4) | disabled + 사유 | disabled + 사유 |

- **exposure-off는 raw가 아니라 gated 상태(확정, R-PRIV-006/[[08-Decisions|D-044]])**: 글로벌 exposure off이거나 `pane_view_end reason='exposure_off'`면 viewport는 **명시적 gated placeholder**("Terminal hidden — enable preview exposure in settings")를 렌더하고 raw 텍스트·프레임 `lines`를 요청·표시하지 않는다(노출면 최소화). 텍스트 없이 target/mode 메타는 표시 가능하다.
- **disconnected ≠ stale(확정, 직교)**: [[SPEC-201-dashboard-screens]] §2.6/§3.2와 동일하게 두 상태를 구분 렌더한다. terminal 모드 진입 후 WS가 끊겨도 `loading`으로 복귀하지 않고 마지막 화면 + disconnected overlay를 유지한다.
- **pane_view_end 매핑(확정, 2026-07-02 리뷰 반영 — [[SPEC-103-pane-live-stream]] §3.2 정합)**: `reason='pane_gone'` → "pane closed"(orc terminated 안내), `reason='detached'`/`'tab_hidden'` → **client가 조건 충족 시 새 `view.attach`를 명시적으로 재발행**(탭 visible + exposure on + focus 시 재-attach; **server auto-resume 없음**, re-attach는 exposure+focus 게이트를 다시 통과), `reason='superseded'` → 다른 attach로 대체됨, `reason='error'` → error 상태(refresh 진입점). 어떤 end도 전체 workspace 장애로 전파되지 않는다(범위 한정, 레이어 C).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다([[SPEC-000-conventions]]).

1. **선택 SSOT `?orc=`(확정)**: 모든 스위칭은 `?orc=` 갱신으로 수렴하고 map/rail/URL이 동기화된다(불변식 ①, §2.1/§2.5).
2. **Observe = 트랩 없음·no egress(확정)**: Observe 모드에서 xterm은 키를 트랩하지 않고, arm 없이는 키스트로크가 나가지 않는다(불변식 ③, §2.6, [[SPEC-401-interactive-input]] AC-01).
3. **Control 트랩 + escape(확정)**: 키 트랩은 Control 모드에서만이며, 명시 escape/disarm 키로 항상 트랩을 벗어날 수 있다(§2.6, [[SPEC-202-design-accessibility]] §2.4).
4. **색-비의존 모드/상태(확정)**: Observe/Control·status·연결/노출 상태는 label+icon+shape로 구분되며 색은 보조다(불변식 ④, §2.3/§2.6).
5. **armed 파괴적 chord 라우팅(확정)**: armed focus의 `C-c`는 confirm/`/interrupt`로만, 나머지 `PASSTHROUGH_FORBIDDEN_CHORDS`는 egress 금지(§2.6, [[SPEC-401-interactive-input]] §2.7).
6. **재현 한계 명시(확정)**: viewport는 capture-pane 한계(seed 시작점·near-real-time·no full emulation)를 UI로 표기한다(불변식 ⑤, §2.4, [[08-Decisions|D-045]]).
7. **lazy-load(확정)**: xterm 청크는 terminal 모드 진입 전 로드되지 않는다(§2.4, [[08-Decisions|D-046]]).
8. **detach→attach 전환(확정)**: orc 전환은 workspace 유지 + detach→attach이며 LRU 캐시는 redacted-only·상한·stale 표식(§2.5).
9. **zero layout shift(확정)**: 모드 전환·스위칭·상태 변화·리사이즈가 layout/scroll을 밀지 않는다(§2.2, [[SPEC-202-design-accessibility]] M3/B6).
10. **reduced-motion(확정)**: waiting 강조·전환·campfire류 장식 모션은 `prefers-reduced-motion: reduce`에서 정적으로 대체하고 정보는 icon/label 교체로 전달한다(§2.3, [[SPEC-202-design-accessibility]] §2.5).
11. **상수(가설)**: `TERMINAL_LRU_MAX`(LRU 항목 수)·latency 표식 임계·스위칭 단축키 정확 바인딩·auto-disarm 카운트다운 경고 시점은 **PoC 검증 가설**이다([[SPEC-007-test-validation]]·사용성 검증). `PASSTHROUGH_IDLE_MS`(240s)는 [[SPEC-401-interactive-input]] server 값을 UI가 상속(독자 값 없음).

## 4. Acceptance criteria

```text
SPEC-203-AC-01 (R-UI-012)
  Given camp detail 이 map 모드로 열린 상태에서
  When 사용자가 orc 를 더블클릭(또는 포커스 후 Enter)하거나 LayoutModeSwitcher 로 terminal 모드를 켜면
  Then layoutMode='terminal' 로 전환되어 CampHeader·OrcRail·TerminalViewport·TerminalStatusBar·ComposedInput 5-region 이 렌더되고,
       ?orc= selection 과 campId 가 보존되며, 스위처로 다시 map 모드로 돌아갈 수 있다(mode 공존, R-UI-008).
```

```text
SPEC-203-AC-02 (R-UI-012, [[08-Decisions|D-046]]) — xterm lazy-load
  Given dashboard 초기 로드 후 아직 terminal 모드에 진입하지 않았을 때
  When 로드된 JS 청크를 관측하면
  Then xterm.js 및 그 addon 청크가 로드되지 않았고,
       terminal 모드 최초 진입 시 dynamic import 로 로드되며 그 동안 viewport 는 loading 상태를 렌더한다.
```

```text
SPEC-203-AC-03 (R-UI-012, [[08-Decisions|D-017]]/[[08-Decisions|D-035]]) — ?orc SSOT 동기
  Given map/rail/URL 세 진입점이 있을 때
  When (i) 맵에서 orc 를 선택하거나 (ii) rail 항목을 클릭하거나 (iii) ?orc=<orcId> URL 로 진입하면
  Then 세 경우 모두 selectedOrcId 가 동일 orcId(pane:+paneId)로 수렴해 동기화되고,
       tmuxTarget/tmuxSessionName 이 reindex/rename 으로 바뀌어도 선택은 권위 키(orcId)로 유지된다.
```

```text
SPEC-203-AC-04 (R-UI-012) — 스위칭 4수단 + 퀵 스위처 + detach→attach
  Given terminal 모드에서 orc A 가 선택된 상태에서
  When rail 클릭(S1) / [ · ](S2) / Alt+숫자(S3, 비예약 chord) / Cmd·Ctrl+K 퀵 스위처(S4, 1차 점프) 로 orc B 로 전환하면
  Then 네 수단 모두 ?orc= 를 B 로 갱신하고 workspace(레이아웃·모드)는 유지된 채
       A 에 view.detach, B 에 view.attach 가 발생하며([[SPEC-103-pane-live-stream]]),
       S3 는 브라우저 탭 전환과 충돌하는 Cmd/Ctrl+digit 을 쓰지 않고(비예약 chord),
       퀵 스위처는 이름/status fuzzy 검색을 제공하고 Escape 로 닫혀 포커스를 트리거로 반환하며,
       스위칭·모드·disarm 단축키는 in-UI legend/hint 로 노출된다(shortcut-only 발견성 아님).
```

```text
SPEC-203-AC-05 (R-UI-012, R-PRIV-006/[[08-Decisions|D-044]] 정합) — LRU last-screen 즉시 전환·exposure 우선
  Given orc A 에서 B 로 전환한 뒤 B 의 pane_view_seed 도착 전에 다시 A 로 돌아올 때
  When (i) exposure on 이면 A 를 재선택하고, (ii) LRU 캐시가 채워진 뒤 exposure 를 off 로 토글하면
  Then (i) A 의 마지막 redacted 화면(LRU 캐시)이 seed 도착 전까지 즉시 표시되되 stale(라이브 아님)로 표식되고
       캐시는 redacted 프레임만 담으며 TERMINAL_LRU_MAX(가설) 상한과 terminal 모드 이탈 시 폐기 규칙을 따르며,
       (ii) exposure off 전이 시 LRU 캐시가 즉시 purge 되어 이후 그 orc 로 복귀해도 캐시 화면이 렌더되지 않고
       §2.8 gated 상태만 표시된다(exposure 가 캐시보다 항상 우선, 노출 게이트 우회 불가).
```

```text
SPEC-203-AC-06 (R-UI-012, R-CTRL-009 정합) — 키보드 트랩은 Control 에서만·disarm 키 확정
  Given (i) Observe 모드와 (ii) Control(armed) 모드에서 각각 viewport 에 focus 가 있을 때
  When 키를 입력하고 Tab, 그리고 DISARM_KEY(=Ctrl+Alt+.) 를 누르면
  Then (i) Observe 에서는 xterm 이 키를 트랩하지 않아 Tab 으로 focus 를 빠져나갈 수 있고 어떤 키스트로크도 egress 되지 않으며,
       (ii) Control 에서는 xterm 이 키를 캡처(트랩)해 passthrough egress 하되 DISARM_KEY 가
       xterm 캡처보다 먼저 가로채여 항상 disarm→Observe 로 탈출시키고(passthrough 로 새지 않음),
       disarm 키는 Escape 단독·C-c·Tab 이 아니다(TUI-critical 키 비충돌).
```

```text
SPEC-203-AC-07 (R-UI-012, [[SPEC-401-interactive-input]] §2.7) — armed C-c 라우팅
  Given Control(armed) 모드로 viewport 가 focus 를 잡은 상태에서
  When 사용자가 C-c 를 누르면 그리고 C-d/C-z/C-\ 를 누르면
  Then C-c 는 passthrough 로 나가지 않고 [[SPEC-400-control-actions]] §2.7 interrupt confirm modal → /interrupt 로 라우팅되며(confirm 우회 불가),
       C-d/C-z/C-\ 는 PASSTHROUGH_FORBIDDEN_CHORDS 로 egress 되지 않는다(무시/안내).
```

```text
SPEC-203-AC-08 (R-UI-012, [[SPEC-401-interactive-input]] §2.6) — auto-disarm 카운트다운 정합
  Given Control(armed) 모드에서 마지막 키스트로크 이후 무입력이 지속될 때
  When idleRemainingMs 가 임계에 접근하고 PASSTHROUGH_IDLE_MS(arm 응답 idleTimeoutMs, 가설 240s)를 초과하면
  Then UI 는 arm 응답의 idleTimeoutMs 값을 사용해(독자 값 아님) 카운트다운/경고를 표시하고
       server auto-disarm 과 동일 값으로 Observe 로 되돌아가며, 키스트로크마다 타이머가 리셋된다.
```

```text
SPEC-203-AC-09 (R-UI-012, [[SPEC-202-design-accessibility]] §2.2) — 색-비의존 모드 표시
  Given 디스플레이를 grayscale(채도 0)로 강제한 상태에서
  When Observe 와 Control 모드를 각각 렌더하면
  Then 두 모드가 색 없이도 viewport border-style + label("Observing"/"CONTROL — armed") + icon 으로 구분되어
       동일하게 보이지 않는다.
```

```text
SPEC-203-AC-10 (R-PRIV-006, [[08-Decisions|D-044]]) — exposure-off gated 상태·LRU purge
  Given 글로벌 exposure 가 off 이거나 pane_view_end reason='exposure_off' 를 수신했을 때
  When Terminal Viewport 를 렌더하면
  Then raw 터미널 텍스트/프레임 lines 가 표시·요청되지 않고 명시적 gated placeholder
       ("Terminal hidden — enable preview exposure")가 렌더되며, target/mode 메타만 표시되고,
       LRU 캐시된 어떤 화면도(redacted 포함) 렌더되지 않는다(exposure 우선, AC-05-(ii) 정합).
```

```text
SPEC-203-AC-11 (R-UI-012, R-UI-005, [[SPEC-201-dashboard-screens]] §2.6/§2.7 재사용) — 표준 상태
  Given (a) xterm 로드/seed 대기, (b) orcId 없음, (c) lines=0, (d) WS 끊김, (e) stale 인 각 상황에서
  When Terminal Viewport 를 렌더하면
  Then 각각 loading skeleton / "select an orc" / "no output" / disconnected(마지막 화면 유지·loading 복귀 없음) /
       stale(last-good + badge + refresh) 로 서로 구분되어 렌더되고, disconnected 와 stale 는 직교로 동시 표현 가능하다.
```

```text
SPEC-203-AC-12 (R-UI-012, R-UI-005) — waiting 오크 강조(색-비의존·별도 emphasis level)
  Given camp 에 (a) status='waiting' orc, (b) 일반 다른 status orc 가 함께 있을 때
  When Orc Rail 을 grayscale 로 렌더하면
  Then waiting orc 는 StatusBadge(icon+label+confidence) 를 유지한 채 그 위에 별도 rail-item emphasis 채널
       (leading marker/pip "needs input" · 상단 정렬 승격 · 컨테이너 border/weight)을 추가로 가져,
       색 없이도 일반 waiting StatusBadge 만 있는 항목과 구분되는 emphasis level 이 식별되며(ownership: StatusBadge 대체 아님),
       reduced-motion 에서는 emphasis 가 정적 표현으로 유지된다.
```

```text
SPEC-203-AC-13 (R-UI-007) — raw target·mode·재현 한계 상시 표기
  Given terminal 모드의 임의 orc 화면에서
  When Orc Rail 항목과 TerminalStatusBar 를 검사하면
  Then raw tmuxTarget(+ status bar 의 paneId)·cwd·mode(Observe/Control)·latency 가 상시 노출되고,
       viewport 는 redacted 배지와 capture-기반(near-real-time·seed 시작점·no full emulation) 재현 한계를 표기한다.
```

```text
SPEC-203-AC-14 (R-UI-012, [[SPEC-202-design-accessibility]] M3/B6) — zero layout shift
  Given terminal 모드에서
  When map↔terminal 모드 전환·orc 스위칭·status 갱신·뷰포트 리사이즈가 발생하면
  Then region 의 layout/scroll position 이 튀지 않고(CLS 유발 reflow 없음),
       cols×rows 변화는 xterm fit/scale 로 흡수된다.
```

```text
SPEC-203-AC-15 (R-UI-012, [[08-Decisions|D-045]]) — 재현 한계·redaction 상속
  Given pane_view_seed(스크롤백 seed)와 이후 pane_view(cursor 포함) 프레임을 렌더할 때
  When viewport 콘텐츠를 검사하면
  Then 표시 텍스트는 프레임의 redacted lines 뿐이고(frontend 추가 마스킹/원문 재구성 없음, [REDACTED:*] 그대로),
       cursor:{x,y} 는 반영하고 null 이면 미표시하며, seed 이전 히스토리는 없음을 표기하고
       scroll-region/mouse-tracking/OSC 완전 재현은 하지 않는다.
```

```text
SPEC-203-AC-16 (R-UI-012, 비기능 접근성, [[SPEC-202-design-accessibility]] §2.4) — 2026-07-02 리뷰 반영: screen reader
  Given screen reader 로 terminal 모드를 탐색할 때
  When Terminal Viewport 와 그 상태 표시기를 검사하면
  Then xterm 이 screenReaderMode(또는 동등 accessible live region)로 구성되어 agent 출력(redacted lines)을
       SR 로 읽을 수 있고, redacted 배지·gated 상태·Observe/Control 표시기·latency 표식이
       비어있지 않은 accessible name(aria-label / role=status 류)을 가지며, SR 텍스트도 redacted lines 만 노출한다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-012 | terminal 모드 진입/레이아웃·orc rail·스위칭 4수단+퀵 스위처+LRU·xterm lazy-load·관전/조종 표시·재현 한계·screen reader(전 항목) | SPEC-203-AC-01~AC-16 |
| R-PRIV-006 | exposure off/`exposure_off` end → gated 상태(raw 미표시), 글로벌 exposure 상속([[08-Decisions|D-044]]), LRU 캐시 exposure-우선 purge | SPEC-203-AC-05, AC-10 |
| R-UI-005 | terminal-mode 표준 상태 구분(loading/empty/exposure-off/disconnected/stale) + waiting 강조([[SPEC-201-dashboard-screens]] §2.6/§2.7 재사용) | SPEC-203-AC-11, AC-12 |
| R-UI-007 | raw tmuxTarget+paneId·cwd·mode 상시 노출, 표시 전용 vs 권위 키(orcId) | SPEC-203-AC-03, AC-13 |
| R-UI-008 (부수) | terminal 모드가 map 모드(공간 status 표현, [[SPEC-301-camp-map-movement]])를 대체 않고 병존·동일 status source | SPEC-203-AC-01 |

> 부수 충족(1차 소유는 타 spec): **R-CTRL-009**(관전/조종 2단계 — server 의미 1차 [[SPEC-401-interactive-input]]; 본 spec은 focus/트랩/`C-c` 라우팅/카운트다운 표시, AC-06/AC-07/AC-08), **R-ORC-005**(status/estimated 사실-단정 금지 — 데이터 1차 [[SPEC-005-data-contract]]; 본 spec은 rail 렌더, AC-12), **비기능 접근성**(색-비의존/키보드/reduced-motion/screen reader — 규칙 1차 [[SPEC-202-design-accessibility]]; 본 spec은 terminal-mode 적용, AC-06/AC-09/AC-12/AC-14/AC-16). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].
>
> R-UI-012·[[08-Decisions|D-045]]/[[08-Decisions|D-046]]/[[08-Decisions|D-044]]는 spec-reviewer + 도메인 리뷰(product-ui / security-privacy / tmux-systems) 게이트 통과 후 **2026-07-02 Accepted 승인**됐다(본 spec `approved`).

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요)

- **C1 — [[SPEC-103-pane-live-stream]] 프레임 스키마 정합(cross-cluster, P0)**: 본 spec은 `pane_view_seed`/`pane_view`/`pane_view_end{reason}` 프레임과 `{orcId,cols,rows,cursor,lines,viewSeq}` 필드·`view.attach`/`view.detach` 메시지를 **소비**로 가정한다(§2.4). SPEC-103 저자가 이 프레임 이름·필드·`end.reason` 6-값(`detached`/`pane_gone`/`exposure_off`/`tab_hidden`/`superseded`/`error`)을 확정하면 §2.4/§2.8 매핑을 그에 맞춘다. **SPEC-103 저자와 맞춰야 하는 P0 접점.**
- **C2 — [[SPEC-401-interactive-input]] client 접점(cross-cluster, P0, SPEC-401 §6 C3 대응)**: (a) armed focus의 `C-c`/파괴적 chord 라우팅(§2.6)은 SPEC-401 §2.7이 요구하는 client 라우팅을 본 spec이 구현한다. (b) auto-disarm 카운트다운은 arm 응답 `idleTimeoutMs`(= `PASSTHROUGH_IDLE_MS`)와 정합한다(§2.6). (c) printable 배칭(≤`PASSTHROUGH_LITERAL_BURST_MAX`)은 client 책임이다. **SPEC-401 C3와 상호 정합 확인됨 — 값 변경 시 동기 갱신 필요.**
- **C3 — [[SPEC-200-frontend-architecture]] `layoutMode`·code-split·store 배선 (RESOLVED 2026-07-02)**: [[SPEC-200-frontend-architecture]] §2.3 `UiSlice`에 `layoutMode: 'map' | 'terminal'`가 추가되고 §2.1에 terminal 번들 xterm lazy chunk(code-split, [[08-Decisions|D-046]]) note가 명시되어 계약이 정합화됐다. `?orc=` mirror는 기존 SSOT를 재사용한다(신규 URL param 없음). 잔여 없음.
- **C4 — [[SPEC-500-settings-persistence]] exposure 재사용**: terminal 모드 attach는 preview와 **동일 글로벌 exposure 설정**을 상속하며([[08-Decisions|D-044]]) 신규 per-pane 저장 필드를 만들지 않는다. SPEC-500과 정합(신규 필드 없음).
- **C5 — [[18-Terminal-Workspace]]·[[DESIGN]] 청사진 정합(write scope 밖)**: 본 spec은 설계안(§3)을 구현 계약으로 고정했다. DESIGN.md의 3-pane/preview-tab 서술이 terminal 모드를 포함하지 않으므로 orchestrator/user가 DESIGN을 "map 모드 + terminal 모드(xterm workspace)" 병존으로 갱신할 것을 제안한다(직접 수정하지 않음).

### Open Questions (검토 필요 / PoC·정합 대상)

- **Q1 — `layoutMode`의 URL 표현**: 모드를 `?orc=`처럼 URL(예 `?mode=terminal`)에 미러해 deep-link로 모드까지 복원할지, client state로만 둘지(§2.1). deep-link 공유 UX vs SSOT 단순성 trade-off. 본 spec은 client state 1차. **검토 필요.**
- **Q2 — LRU 캐시 메모리 상한·redaction 재적용(부분 해소, 2026-07-02 리뷰 반영)**: exposure-off precedence는 확정됐다(§2.5 exposure off → LRU 즉시 purge, AC-05/AC-10). 남은 미확정은 `TERMINAL_LRU_MAX` 값과, 캐시 화면이 이후 redaction 패턴 변경 시 무효화가 필요한지다([[18-Terminal-Workspace]] §7). 캐시는 redacted 프레임만 담으나(불변식 ②) 패턴 강화 시 캐시 무효화 정책을 [[SPEC-006-privacy-redaction]]와 정합해 판정. **검토 필요(값·패턴 무효화).**
- **Q3 — 스위칭/disarm 키 바인딩(해소, 2026-07-02 리뷰 반영)**: S3=`Alt+1..9`(비예약, 브라우저 탭 전환 비충돌)·S4=`Cmd/Ctrl+K`(1차 점프)·`DISARM_KEY=Ctrl+Alt+.`(대안 double-Escape; Escape 단독/C-c/Tab 금지)로 확정했다(§2.5/§2.6). S2 `[`/`]`는 Control 모드에서 rail 포커스일 때만 동작. 남은 것은 사용성 PoC 미세 튜닝(정확 chord 최종 확인)뿐. **PoC 튜닝.**
- **Q4 — exposure off에서 arm 허용 여부**: [[08-Decisions|D-044]] 글로벌 exposure off이면 viewport가 gated(§2.8)라 화면을 못 보는데 blind arm/타이핑을 허용할지. 본 spec은 exposure off 시 ComposedInput/arm disabled(§2.8)로 **보수적 거부** 1차([[SPEC-401-interactive-input]] §6 Q3와 정합). **검토 필요.**
- **Q5 — latency 표식 임계·near-real-time 표현**: status bar latency(§2.7) 임계·표현(수치 vs 등급)과 `viewSeq` 기반 지연 산출은 [[SPEC-103-pane-live-stream]] 폴링 주기(`PANE_VIEW_INTERVAL_MS` 250–500ms 가설)와 정합해 [[SPEC-007-test-validation]] 측정으로 보정. **검토 필요.**
