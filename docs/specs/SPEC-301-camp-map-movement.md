---
spec: SPEC-301
title: camp 맵·이동·roaming (orc 공간 배치·movement)
status: approved
updated: 2026-06-28
requirements: [R-UI-003, R-UI-006, R-UI-008, R-ORC-005, R-P1-004, R-P1-013]
decisions: [D-007, D-013, D-017, D-035]
tags:
  - specs
  - frontend
  - dashboard
  - camp-map
  - movement
  - roaming
  - sprite
  - epic-4
---

# SPEC-301 — camp 맵·이동·roaming (orc 공간 배치·movement)

이 spec은 camp detail scene을 **정적 lane/slot 격자에서 게임형 pixel MAP으로 전환**하는 계약을 고정한다. 맵에서 orc는 **위치(position)와 애니메이션**으로 현재 활동(status)을 드러내며, 위치는 새 데이터 없이 **기존 `Orc` 필드의 결정적 함수**다. 본 spec은 [[SPEC-300-asset-rendering]] §3.7의 P1 movement를 **진입(enter)·소유**하고 그 Open Question **Q4(`roaming`/8방향 진입 조건)를 해소**한다.

입력은 [[SPEC-005-data-contract]]가 만든 `Orc`(특히 `windowIndex`·`status`·`paneId`)와 `asset-packs/orc-camp-default/manifest.json`의 background/`safe_area`·props·tilesets·character `roaming` 8방향 walk-cycle이다. 본 spec은 그 위에 ① **zone(window) 분할**, ② **station(status) 앵커**, ③ **slot(paneId) fan-out**, ④ **target position = f(windowIndex, status, paneId, mapDims)**, ⑤ **roaming 진입·8방향 quantize·보간**, ⑥ **activity 표시(speech bubble + 상시 label/overlay)**, ⑦ **맵 render contract(DOM 기본·canvas P2·공유 clock·zero layout shift·keyboard·reduced-motion)**, ⑧ **성능 예산(20 session/100 pane)**, ⑨ **placeholder parity**를 정의한다.

> **소유 경계**:
> - **소유(본 spec)**: 맵 layout(zone/station/slot 배치 규칙·좌표 함수), orc movement·`roaming` 진입 조건 + direction quantize + 보간, activity speech bubble 배치, **맵 render contract**(DOM/canvas 매체·공유 애니메이션 clock·zero layout shift·맵 keyboard nav·reduced-motion snap).
> - **참조(타 spec 소유, 재소유 금지)**: sprite frame·상태머신·fallback 값·`reduced_motion.fallback_frame`·manifest resolution → [[SPEC-300-asset-rendering]]. window=lane/pane=slot 의미·selection(`orcId`/`?orc=`)·데이터 매핑·layout 안정성·비-orc pane → [[SPEC-201-dashboard-screens]]. 비-색상 status encoding·키보드/roving-tabindex/focus·대비·reduced-motion **값** → [[SPEC-202-design-accessibility]]. 라우팅·store·데이터 흐름 → [[SPEC-200-frontend-architecture]]. control 진입점(send/key/interrupt) → [[SPEC-400-control-actions]]. `Orc` 필드 shape → [[SPEC-005-data-contract]].

> **불변식(확정)**:
> - **INV-1 (client-derived, 서버 데이터 불변)**: orc 위치는 **전적으로 client에서** 기존 `Orc` 필드(`windowIndex`/`status`/`paneId`) + camp의 window 집합 + map 치수로 계산한다. `Orc`/`Camp`/`ScanResult`/snapshot/WS event에 **좌표(x/y/position 등) 필드를 추가하지 않는다**. 본 spec은 **`web/`-only**이며 [[SPEC-005-data-contract]] 데이터 계약을 바꾸지 않는다.
> - **INV-2 (권위 식별자로만 배치, [[08-Decisions|D-017]])**: 배치/선택의 키는 `paneId`(`orcId`)·`windowIndex`다. `tmuxTarget`/`tmuxSessionName`은 표시 전용이며 **위치 계산에 쓰지 않는다**. reindex/rename으로 표시값이 바뀌어도 위치·선택은 유지된다.
> - **INV-3 (read-only consumer)**: 맵 renderer는 어떤 tmux command도 호출하지 않고 redaction 후 데이터만 소비한다([[SPEC-300-asset-rendering]] §2.1, [[08-Decisions|D-016]]).
> - **INV-4 (status/summary 단정 금지)**: `status`는 `statusConfidence`와, `currentWorkSummary`는 `summarySource`/`summaryIsEstimated`와 함께만 표시한다(R-ORC-005). 공간 은유가 raw `tmuxTarget`/status를 가리지 않는다([[SPEC-202-design-accessibility]] A7).

## 1. Scope

### In scope / Out of scope

| 구분 | 항목 | 비고 |
| --- | --- | --- |
| **In** | zone(window) 분할 규칙: `safe_area` play-field → `windowIndex`별 zone grid (§2.2) | window grouping 공간화 |
| **In** | station(status) 앵커 테이블: 7 `OrcStatus` → zone 내 고정 prop 앵커 (§2.3) | 위치=상태 |
| **In** | slot(paneId) fan-out: 동일 zone+status orc의 결정적 offset, reindex 안정성 (§2.4) | 위치=식별 |
| **In** | target position 함수 `f(windowIndex, status, paneId, mapDims)` (§2.5) | 순수·결정적 |
| **In** | roaming 진입·direction 8방향 quantize·보간 (§3.1, **Q4 해소**) | P1 movement(R-P1-004) |
| **In** | activity speech bubble + 상시 label/overlay 배치 (§2.6) | R-ORC-005 표시 |
| **In** | 맵 render contract: DOM 기본/canvas P2·공유 clock·zero layout shift·keyboard·reduced-motion snap (§2.7, §3.2) | — |
| **In** | 성능 예산 20 session/100 pane (§3.3, 가설) | SPEC-007 측정 패턴 |
| **In** | placeholder parity: background/props/tiles 누락 시 (§3.4, R-UI-006) | layout/interaction/a11y 불변 |
| **Out** | sprite frame·상태머신·`reduced_motion.fallback_frame`·manifest resolution | [[SPEC-300-asset-rendering]] |
| **Out** | window=lane/pane=slot 의미·selection 라우팅·비-orc pane·inspector 콘텐츠 | [[SPEC-201-dashboard-screens]] |
| **Out** | 비-색상 status encoding·키보드/대비/reduced-motion **수치값** | [[SPEC-202-design-accessibility]] |
| **Out** | 라우팅·store·deep-link 메커니즘 | [[SPEC-200-frontend-architecture]] |
| **Out** | control 액션 flow(send/key/interrupt modal·재검증) | [[SPEC-400-control-actions]] |
| **Out** | `status`/`agentType`/summary **추론** | [[SPEC-004-status-inference]] / [[SPEC-003-agent-detection]] |
| **Out** | 서버 좌표 필드 추가·snapshot/WS 좌표 전송 | INV-1로 **금지** |
| **Out** | idle ambient micro-wander **활성화**(기본 off, P1/선택) | §3.1-8, 비-load-bearing |

> **MVP vs P1 분리(확정)**: 정적 **맵 layout**(zone/station/slot 위치로 활동을 공간 표현)은 R-UI-003 "camp scene이 orc 위치를 드러낸다"의 공간적 실현이며, movement가 꺼져도(또는 reduced-motion에서) orc는 자신의 target position으로 **snap**해 맵이 완전히 동작한다. **`roaming` 보간·8방향 walk-cycle**은 그 위의 **P1 progressive enhancement**(R-P1-004 + R-P1-013, §6)다. 즉 reduced-motion 경로 == movement-off 경로 == snap이다.

## 2. Contract

### 2.1 입력 — 소비 데이터 (읽기 전용)

```ts
// [[SPEC-005-data-contract]] Orc의 배치 관련 subset (전체 필드·shape는 SPEC-005)
interface OrcMapInput {
  id: string;          // "pane:%12" — selection/렌더 stable key ([[08-Decisions|D-017]])
  paneId: string;      // "%12" — 배치 권위 식별자(slot rank·offset 키). tmuxTarget 아님(INV-2)
  windowIndex: number; // → zone (§2.2)
  status: OrcStatus;   // 7종 → station 앵커 (§2.3)
  // activity 표시용(§2.6). 값/추론은 SPEC-004/005 소유
  currentWorkSummary: string | null;
  summarySource: string;        // 5종 enum, 없으면 'unknown'
  summaryIsEstimated: boolean;  // 자동 추정=true
  statusConfidence: number;     // [0,1]
  tmuxTarget: string;           // 표시 전용(label). 위치에 사용 금지(INV-2)
  // agentType/agentTypeConfidence → character·sprite는 SPEC-300이 소비
}

// 맵 치수 — background manifest에서 resolve (asset 누락 시도 동일 logical 치수, §3.4)
interface MapDims {
  logical: [number, number]; // background logical_size, 기본 [1672, 941]
  playField: { x: number; y: number; w: number; h: number }; // safe_area, 기본 {390,520,890,330}
}
```

- `OrcMapInput`은 모두 [[SPEC-005-data-contract]]가 산출한 필드의 **읽기 전용 subset**이다. 본 spec은 어떤 필드도 추가·합성하지 않는다(INV-1).
- `MapDims`는 manifest `backgrounds.warbase-sunset-dashboard.logical_size`(`[1672,941]`)와 `safe_area`(`[390,520,890,330]` = `[x,y,w,h]`)에서 resolve한다. **background 이미지가 없어도** logical 치수·playField는 상수로 유지된다(§3.4) → asset 유무와 무관하게 zone/station 좌표가 동일하다.

**맵 스프라이트 스케일 `mapSpriteScale`(확정 메커니즘, 값은 가설)**:

- native sprite frame(232/228px)은 play-field(890×330 logical)에 비해 과대하므로(한 zone에 다수 sprite 불가) **맵 레벨 균일 스케일** `mapSpriteScale < 1`을 도입한다. 이는 [[SPEC-300-asset-rendering]] §2.2의 per-character render `scale`(현재 1)과 **별개의 맵 배치용 스케일**이다.
- logical sprite box = `frame_size × mapSpriteScale`, scaled anchor = `anchor × mapSpriteScale`. **asset과 placeholder 박스에 동일하게 적용**한다(toggle parity 보존 — [[SPEC-202-design-accessibility]] AC-17, [[SPEC-300-asset-rendering]] §3.6). 균일 스케일이므로 frame_size 종횡비는 보존된다.
- `mapSpriteScale` 가설 초기값 `0.20`(232px → on-field footprint ≈ 46px), 범위 가설 `[0.15, 0.30]`. station 앵커·ring 간격(§2.4)·zone 분할(§2.2)은 이 **scaled footprint**가 들어맞는 좌표계에서 동작한다(§4 AC-14로 feasibility 검증).
- **`REF_FRAME_MAX`(확정 메커니즘, 값 가설 `232`)**: ring/stack 간격(§2.4-3/§2.4-5)의 scaled footprint는 character별 `frame_size`(232 vs 228)가 아니라 **layout 상수 `REF_FRAME_MAX`** 기준(`REF_FRAME_MAX * mapSpriteScale`)으로 정의한다. 이는 같은 `(windowIndex, status, paneId)` 입력의 slot 좌표가 **`agentType`(=character frame_size)에 의존하지 않도록** 보장하기 위함이다(INV-1·§2.5 순수성: 위치는 `windowIndex`/`status`/`paneId`의 함수이며 character 종류와 무관). 즉 spacing은 character-independent 상수로 고정하고, 개별 sprite 박스만 자기 `frame_size × mapSpriteScale`로 그린다.
- **불변식 보존**: scaled box는 fixed-aspect 컨테이너 안 logical 좌표로 배치되므로 zero layout shift(§3.2)와 frame_size 종횡비 고정은 그대로 유지된다.

### 2.2 zone = window (분할 계약)

play-field(`MapDims.playField`)를 `windowIndex`별로 **하나의 zone**으로 분할한다([[SPEC-201-dashboard-screens]] §2.3 "window=lane" 의미를 공간으로 보존).

**분할 규칙(확정 구조, 상수는 가설)**:

1. `Z` = camp 내 distinct `windowIndex` 수(≥1). `windows` = `windowIndex` 오름차순 distinct 배열.
2. zone은 `cols × rows` grid로 배치한다: `cols = min(Z, ZONE_COLS_MAX)`, `rows = ceil(Z / cols)`. `ZONE_COLS_MAX`는 가설(초기 `4`).
3. zone은 `windows` 오름차순으로 **row-major**(좌→우, 상→하) 배치한다. `zoneIndexOf(windowIndex)` = `windows`에서 그 값의 rank(0-based).
4. cell 치수: `cw = (playField.w - (cols-1)*ZONE_GUTTER) / cols`, `ch = (playField.h - (rows-1)*ZONE_GUTTER) / rows`. `ZONE_GUTTER` 가설(초기 `16` logical px).
5. grid 위치 `(c,r)`: `c = zoneIndex mod cols`, `r = floor(zoneIndex / cols)`.
   `zoneRect = { x: playField.x + c*(cw+ZONE_GUTTER), y: playField.y + r*(ch+ZONE_GUTTER), w: cw, h: ch }`.
6. **zone header**: 각 zone 상단-중앙에 `command-tent` + `banner-pole`(manifest `objects/props`) prop과 plain-text label **"window {windowIndex}"**를 둔다. header는 ground layer(낮은 z)로 sprite/label을 가리지 않는다.

- `zoneRect`는 `(windowIndex, windows, mapDims)`의 결정적 함수다(같은 window 집합·치수 → 같은 rect).
- **inner rect**(station 배치 영역) = `zoneRect`를 `ZONE_PAD`(가설 `24px`)로 inset하고 상단 `ZONE_HEADER_H`(가설 `40px`)를 header에 양보한 사각형.
- **최소 zone 보장·스크롤 commitment(확정, F10)**: zone이 7 station + 최소 fan-out을 담으려면 inner rect가 degenerate하면 안 된다. 따라서 `MIN_ZONE = { w: MIN_ZONE_W, h: MIN_ZONE_H }`(가설 `MIN_ZONE_W=260`, `MIN_ZONE_H=200` logical px, §2.1 `mapSpriteScale` 기준 7 station+1 ring 수용치)를 **하한으로 강제**한다. window가 많아 `cw < MIN_ZONE_W` 또는 `ch < MIN_ZONE_H`가 되면(특히 `rows ≥ 4`), play-field를 `cols` 폭에 맞춘 **세로 스크롤 캔버스**로 전환한다(zone은 `MIN_ZONE` 크기를 유지하고 play-field의 logical 높이가 zone grid에 맞춰 늘어남). 가로는 `cols ≤ ZONE_COLS_MAX`로 고정해 가로 스크롤을 피한다. 이로써 station 배치가 다-window camp에서 깨지지 않는다(§4 AC-14). 스크롤 컨테이너도 fixed-aspect 변환·zero layout shift(§3.2)를 유지한다.

### 2.3 station = status (앵커 매핑 계약)

각 zone의 **inner rect** 안에 7 `OrcStatus`별 **고정 station 앵커**를 둔다. 각 station은 manifest `objects/props`의 prop 1개로 표현하고, orc는 자기 status의 station 주변에 모인다(§2.4). 앵커는 inner rect 정규 좌표 `(nx, ny) ∈ [0,1]`로 정의하며 절대 좌표는 `innerRect.x + nx*innerRect.w`, `innerRect.y + ny*innerRect.h`다.

| `OrcStatus` | station prop (manifest `objects/props`) | 정규 앵커 `(nx,ny)`·가설 | 은유 근거 |
| --- | --- | --- | --- |
| `active` | `workbench` | `(0.30, 0.45)` | 작업대에서 작업 중 — 능동 작업의 직관 |
| `waiting` | `campfire` | `(0.55, 0.40)` | 모닥불가에서 입력/사용자 응답 대기(`waiting-bubble` 보강) |
| `idle` | `bedroll` | `(0.78, 0.55)` | 침구에서 휴식 — 할 일 없음 |
| `error` | `notice-board` | `(0.50, 0.72)` | 게시판에 걸린 경보 — 주의 필요(`error-burst` 보강) |
| `stale` | `stone-marker` | `(0.22, 0.75)` | 풍화된 표석 — 멈춘/오래된 데이터 |
| `unknown` | `utility-totem` | `(0.80, 0.25)` | 정체불명 토템 — 미식별(`unknown-charm` 보강) |
| `terminated` | `locked-chest` | `(0.95, 0.95)` **edge·static** | 잠긴 궤짝(가장자리) — 종료된 세션을 정적 보관 |

규칙(확정):

1. **prop은 ground layer, label은 그 위**: station prop은 sprite보다 **낮은 z**(ground)로 그린다. status overlay 아이콘·plain-text status label·`tmuxTarget` label은 sprite보다 **높은 z**로 그린다. 따라서 station prop이 **status label/target을 가리지 않는다**([[SPEC-202-design-accessibility]] R4·A7).
2. **`terminated`는 zone 가장자리·정적**: terminated orc는 zone edge를 따라 **1-D stack**(§2.4-5; centered ring 아님 → corner overflow 방지)으로 정적 배치하고 [[SPEC-300-asset-rendering]] §3.3의 `terminated` lifecycle(정적 frame + `terminated-ghost`, death/fall 금지)을 따른다. roaming으로 진입/이탈 보간을 하지 않는다(아래 §3.1-5 예외).
3. **station 앵커는 manifest prop 누락과 독립**: prop 이미지가 없어도 앵커 좌표는 동일하게 산출되며 §3.4 CSS marker로 대체된다(위치=상태 정보 보존).
4. 앵커 정규 좌표는 **시각 튜닝 가설**이다(겹침·label 가독성으로 보정). 단 (a) 7 station이 서로 다른 앵커를 가지고, (b) `terminated`가 edge corner이며, (c) station이 label을 가리지 않는다는 **구조 규칙은 확정**이다.

### 2.4 slot = paneId (fan-out 계약)

동일 `(zone, status)`에 속한 복수 orc는 station 앵커를 중심으로 **결정적 offset**으로 펼친다. offset 키는 `paneId`(권위, [[08-Decisions|D-017]])이며 `tmuxTarget` reindex에 **불변**이다.

**fan-out 규칙(확정 구조, 상수는 가설)**:

1. **slotRank**: 동일 `(zoneIndex, status)` orc를 `paneId` **숫자 오름차순**(`%N`의 `N` 파싱, tie-break 전체 문자열)으로 정렬한 rank(0-based). `paneId`가 안정하므로 slotRank는 tmuxTarget/window 표시값 reindex에 **불변**이다(INV-2).
2. **ring 배치**(비-terminated): `slotRank=0`은 station 앵커 `S`에 놓는다. `slotRank≥1`은 동심 ring으로 펼친다. ring `k`(≥1) 용량 `cap(k) = RING_BASE * k`(가설 `RING_BASE=6`). 누적 용량으로 slotRank → `(ring k, 내부 index m)` 결정.
3. **반경/각도**: `radius(k) = min(k * RING_STEP, R_MAX)`. **`RING_STEP`은 scaled sprite footprint 기준으로 정의한다**: `RING_STEP = RING_CLEARANCE * (REF_FRAME_MAX * mapSpriteScale)`(가설 `RING_CLEARANCE=1.15`; `REF_FRAME_MAX`는 §2.1의 character-independent 상수 — slot 좌표가 `agentType`에 의존하지 않도록) → ring이 §2.1 scaled sprite를 비-중첩으로 둘러싼다(890×330에 cramped되지 않음, §4 AC-14). `R_MAX` = inner rect로 클램프되는 상한. 각도 `θ = θ0 + (m / cap(k)) * 2π`, `θ0 = -π/2`(상단 시작) + ring별 half-step offset(방사 정렬 방지). `slotOffset = (radius*cosθ, radius*sinθ)`.
4. **overflow(확정 동작, 임계 가설)**: `SLOT_SOFT_MAX`(가설 `12`/station) 초과 시 ring을 계속 늘리되 `radius`가 `R_MAX`에 닿으면 외곽 ring에 **각도 밀집(controlled overlap)**으로 쌓고 `paneId` 오름차순 back-to-front로 그린다. **orc를 숨기지 않는다**(read-only 관측성: 모든 orc 표시). sprite를 frame_size 종횡비 미만으로 비-균일 축소하지 않는다(layout 불변, §2.7; 균일 스케일은 §2.1 `mapSpriteScale`만).
5. **`terminated` 1-D edge stack(확정, F9)**: `terminated` orc는 ring이 아니라 **zone 가장자리(기본 우측 edge)를 따라 1차원으로 stack**한다. `slotRank`(paneId asc) 순으로 edge 위 시작점에서 `STACK_PITCH = STACK_CLEARANCE * (REF_FRAME_MAX * mapSpriteScale)`(가설 `STACK_CLEARANCE=1.05`; §2.1 character-independent 상수) 간격으로 배치하며, edge 길이를 넘으면 안쪽으로 한 칸 들여 다음 줄로 이어간다(corner를 ring으로 넘치게 하지 않음). 정적 배치이므로 roaming하지 않는다(§3.1-5).

- `slotOffset`은 `slotRank`의 결정적 함수이고 `slotRank`는 동일-(zone,status) peer `paneId` 집합의 결정적 함수다. 따라서 같은 입력 → 같은 offset.
- peer 집합이 바뀌면(같은 station에 orc가 합류/이탈) slotRank가 재계산될 수 있다(고유한 군집 변화). 그 전이는 §3.1 roaming이 매끄럽게 처리한다. **단 `tmuxTarget` reindex만으로는 slotRank가 바뀌지 않는다**(INV-2, §4 AC-03).

### 2.5 target position (순수 함수)

```ts
// 결정적·순수. 무작위/wall-clock 의존 없음(보간 clock은 rendered pos에만 작용, target엔 무관)
function targetPosition(orc: OrcMapInput, ctx: CampLayoutContext, dims: MapDims): Vec2 {
  const zr      = zoneRect(orc.windowIndex, ctx.windows, dims);   // §2.2
  const inner   = innerRect(zr);                                  // §2.2
  const S       = stationAnchor(orc.status, inner);               // §2.3
  const rank    = slotRank(orc.paneId, ctx.peersOf(orc));         // §2.4 (동일 zone+status peer paneIds)
  return add(S, slotOffset(rank, inner));                         // §2.4
}
// CampLayoutContext = { windows: number[] /*오름차순 distinct windowIndex*/,
//                       peersOf(orc): string[] /*동일 (zone,status) paneId 집합*/ }
```

- **순수성/결정성(확정)**: 동일 `(orc, ctx, dims)`는 항상 동일 `targetPosition`을 산출한다. 이는 §4 AC-12로 검증한다.
- **입력 한정(INV-1)**: 함수가 읽는 orc 필드는 `windowIndex`·`status`·`paneId`뿐이다(+ camp window 집합·동일 군집 peer paneId + map 치수). 좌표는 어디서도 데이터로 **수신되지 않는다**.

### 2.6 activity 표시 (speech bubble + 상시 label/overlay)

| 요소 | 트리거 | 내용 | 가림 금지 |
| --- | --- | --- | --- |
| **status label** (plain text) | **항상** | `OrcStatus` 영문 label([[SPEC-202-design-accessibility]] §2.2) | sprite 머리 위, 최상위 z |
| **status overlay icon** | **항상** | `objects/status-ui` 아이콘([[SPEC-300-asset-rendering]] §2.3c) | label을 가리지 않음(§2.3-1) |
| **raw target label** | **항상**(R-UI-007) | `tmuxTarget` | A7: 은유가 가리지 않음 |
| **activity speech bubble** | **hover/focus/select 시에만** | `currentWorkSummary` + `summarySource` + `summaryIsEstimated`면 estimated 마커(`~`/`est.`) | bubble가 status label·target을 가리지 않음 |

규칙(확정):

1. **항상 표시(label+overlay+target)**: status label·overlay·raw `tmuxTarget`은 **모든 orc에 상시** 표시한다(공간 은유가 상태/식별을 숨기지 않음 — [[SPEC-202-design-accessibility]] A7, R-UI-007). 색 단독 금지.
2. **bubble는 on-demand**: speech bubble은 hover/focus/select에서만 띄운다(100-pane 혼잡 방지). bubble 위치는 sprite 상단/측면이며 status label·target label을 가리지 않게 배치한다.
3. **단정 금지(R-ORC-005, INV-4)**: bubble의 summary는 `summaryIsEstimated=true`면 estimated 마커를 동반하고 `summarySource`를 표기한다. `currentWorkSummary==null`이면 "no summary"로 표시한다(합성 금지).

### 2.7 맵 render contract

- **매체(확정): DOM 기본 / canvas P2 escape hatch**. 맵은 **DOM 절대 위치 sprite**를 background 위에 합성하는 것을 기본으로 한다. 성능 예산(§3.3)을 규모에서 못 맞추면 canvas/WebGL 렌더 레이어를 **P2 대체 경로**로 둔다(동일 `SpriteRenderState`([[SPEC-300-asset-rendering]] §2.4) + §2.5 position 계약 뒤에서 교체, 단 keyboard/selection/a11y는 DOM overlay로 보존). 이는 **[[SPEC-201-dashboard-screens]] Q4(DOM vs canvas scene)**를 **DOM=기본, canvas=P2**로 해소한다([[SPEC-300-asset-rendering]] Q4는 roaming 진입 질문으로 §3.1에서 별도 해소됨 — 혼동 금지).
- **scene 배치 supersede(확정, F3)**: camp detail **scene 배치**(좌표·정렬)는 본 spec(§2.2~2.5)이 소유하며, **[[SPEC-201-dashboard-screens]] SPEC-201-AC-03의 "paneIndex 오름차순 lane slot 배치" 진술을 scene 컨텍스트에서 supersede**한다. SPEC-201의 `paneIndex` 오름차순 정렬은 list/table 등 비-scene 표시에 한정되도록 재범위화됐다(SPEC-201 §2.3·AC-03 개정). window grouping·selection·비-orc pane·layout 안정성은 SPEC-201이 계속 소유한다.
- **fixed-aspect 컨테이너(확정)**: 맵은 background와 같은 16:9 logical 좌표계(`MapDims.logical`, 기본 `1672×941`)를 갖는 **고정 종횡비 컨테이너**다. sprite·station·label은 logical 좌표로 배치 후 컨테이너 스케일로 함께 변환된다 → 뷰포트 리사이즈가 sprite의 상대 위치를 바꾸지 않는다(**zero layout shift**, §3.2).
- **sprite box(확정)**: 각 sprite는 해당 character의 manifest `frame_size`(232/228 등)에 **§2.1 `mapSpriteScale`을 곱한** logical box(= `frame_size × mapSpriteScale`, 종횡비 보존)이며, scaled anchor(`anchor × mapSpriteScale`)가 rendered ground 위치에 정렬된다. `mapSpriteScale`은 asset·placeholder에 동일 적용된다(§3.2, AC-08). `image-rendering: pixelated`.
- **z 레이어(확정, back→front)**: background → terrain/ground → zone header + station prop → terminated edge sprite → active sprite(ground y, 동률 시 `paneId` asc 정렬) → status overlay icon → status label + raw target label → selection/hover marker(`ui/selection-markers`) → activity speech bubble.
- **selection(참조 SPEC-201/200)**: sprite click / `Enter` / `Space` → `?orc=<orcId>` 설정해 inspector를 연다. selection 키는 `orcId`(reindex 불변, INV-2). control 진입점은 inspector(SPEC-201) → flow는 [[SPEC-400-control-actions]].
- **공유 애니메이션 clock(확정, F1 — phase는 state-entry에 anchor)**: 모든 sprite의 frame 진행·보간은 **단일 공유 시계**(하나의 `requestAnimationFrame` 루프, 전역 시간 `t`)에서 파생한다. per-sprite `setInterval`/타이머·per-sprite RAF는 **0건**(성능). 단 frame index는 un-anchored 전역 `t`가 아니라 **각 sprite의 state-entry 시각 `tEnter`에 anchor**한다: `frame = floor((t − tEnter) * fps) mod frames`([[SPEC-300-asset-rendering]] `fps`/`frames`). `tEnter`는 그 sprite가 현재 animation state로 전이한 시각(공유 clock 값)이다.
  - 이로써 [[SPEC-300-asset-rendering]] **§3.3-2(전이 시 frame 0부터 재생 / 같은 state 유지 시 위상 보존)**를 **위반하지 않는다**: state 전이 시 `tEnter`를 갱신해 새 state가 frame 0에서 시작하고, state가 유지되면 `tEnter` 불변이라 위상이 보존된다(매 snapshot frame 0 리셋 없음).
  - 보간(roaming) 진행도 동일 clock의 `(t − tweenStart)`로 계산한다(§3.1). 이 모델은 SPEC-300 §3.3의 재생 규칙을 **준수(respect)**하는 구현 메커니즘이며, "단일 clock으로 SPEC-300 §3.3를 대체·충족한다"는 의미가 아니다(소유는 SPEC-300).
- **keyboard(참조 SPEC-202 값)**: 각 zone = **하나의 roving-tabindex 그룹**(zone당 single tab stop). `Tab`/`Shift+Tab`은 zone 간(및 dock control 간, [[SPEC-202-design-accessibility]] K1) 이동, Arrow는 focus된 zone 내부 orc 간 이동(결정적 순서: ground 위치 row-major, 동률 시 slotRank), `Enter`/`Space`로 선택. 이는 [[SPEC-202-design-accessibility]] K2(orc layer roving tabindex)를 **zone 단위로 구체화**한다(§6 coordination note).
- **reduced-motion(참조 SPEC-202/300)**: `prefers-reduced-motion: reduce`면 rendered pos를 target으로 즉시 snap하고 정적 frame([[SPEC-300-asset-rendering]] `reduced_motion.fallback_frame`)을 표시하며, walk-cycle·autoplay·ambient wander를 시작하지 않는다(§3.1-7).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설을 구분한다. 데이터 값은 상류(SPEC-005/004/300)를 소비만 한다.

### 3.1 roaming 진입·direction·보간 (Q4 해소)

> **SPEC-300 Q4 해소(확정)**: `roaming`은 **status enum이 아니라 시각 전이**다. cwd 변경·사용자 배치 같은 별도 신호가 **필요 없다**. roaming은 **렌더된 현재 위치 `renderedPos`가 target position(§2.5)과 달라질 때** 진입한다. target은 `status`가 바뀌어 station이 옮겨지거나(`zone`/`slot` 변화 포함) 할 때 변한다. 즉 roaming 진입은 **기존 `Orc` 필드의 순수 함수**이며 새 데이터/신호를 도입하지 않는다(INV-1).

규칙:

1. **진입 조건(확정)**: orc별로 renderer는 `renderedPos`(화면상 현재 logical 위치)를 유지한다. `targetPos = targetPosition(...)`(§2.5). `|targetPos − renderedPos| > ε`(가설 `ε=1px`)이면 **roaming 진입**: `animationState='roaming'`, 공유 clock으로 `renderedPos`를 `targetPos`로 보간한다.
2. **direction = 이동 벡터의 8방향 quantize(확정, F7 — half-open 버킷)**: `θ = atan2(dy, dx)`(`dy = target.y − rendered.y`, 화면 y는 아래로 증가). `θ`를 각 방향 중심 ±22.5°의 **half-open 구간 `[center − 22.5°, center + 22.5°)`**로 양자화해 manifest `roaming.folders`의 방향 이름에 매핑한다. 경계 각도(예: 정확히 +22.5°)는 항상 상위(다음) 버킷에 속하므로 결정적이다(§4 AC-05).

   | 이동 벡터 방향(화면) | manifest direction | 버킷 중심 | half-open 구간 |
   | --- | --- | --- | --- |
   | 오른쪽 | `east` | 0° | `[-22.5°, +22.5°)` |
   | 오른쪽-아래 | `south-east` | 45° | `[22.5°, 67.5°)` |
   | 아래 | `south` | 90° | `[67.5°, 112.5°)` |
   | 왼쪽-아래 | `south-west` | 135° | `[112.5°, 157.5°)` |
   | 왼쪽 | `west` | 180° | `[157.5°, 180°] ∪ [-180°, -157.5°)` |
   | 왼쪽-위 | `north-west` | -135° | `[-157.5°, -112.5°)` |
   | 위 | `north` | -90° | `[-112.5°, -67.5°)` |
   | 오른쪽-위 | `north-east` | -45° | `[-67.5°, -22.5°)` |

   - 구현은 `bucket = floor((deg + 180 + 22.5) / 45) mod 8`로 동일 결과를 얻는다(`deg ∈ [-180,180)`). `west`는 atan2 wrap(±180°)을 포함하므로 위 공식의 wrap 처리로 단일 버킷이 된다.
   - 요청 direction 폴더가 없으면 `south`로 강등한다([[SPEC-300-asset-rendering]] §3.2-4 fallback 위임).
3. **도착(확정)**: `|target − rendered| ≤ ε`이면 `renderedPos := targetPos`로 snap하고 **status 애니메이션**([[SPEC-300-asset-rendering]] §2.3b)으로 전환하며 **direction은 `south`**(MVP, [[SPEC-300-asset-rendering]] §3.7-1·§3.2-3)로 facing한다.
4. **최초 등장(확정)**: 직전 `renderedPos`가 없는 신규 orc는 `targetPos`에 **즉시 spawn(snap)**한다(대량 fly-in 방지). (대안: zone 가장자리에서 걸어 들어오기 — 선택/가설, 기본 비활성.)
5. **`terminated` 예외(확정)**: status가 `terminated`로 바뀌면 edge station(§2.3-2)으로 향하는 보간 없이 **즉시 정적 처리**한다([[SPEC-300-asset-rendering]] §3.3, death/fall 금지). 즉 terminated는 roaming하지 않는다.
6. **보간 duration/easing(가설)**: `duration = clamp(distance / ROAM_SPEED, ROAM_MIN_MS, ROAM_MAX_MS)`. `ROAM_SPEED` 가설 `140` logical px/s, `[ROAM_MIN_MS, ROAM_MAX_MS]` 가설 `[250, 1500]`ms, easing `ease-in-out`(가설). 거리 비례 + 클램프로 cross-zone 장거리 이동도 과도하게 길지 않게 한다. 모두 **PoC 보정 대상**.
7. **reduced-motion(확정)**: `prefers-reduced-motion: reduce`면 §1·§2.7대로 `renderedPos := targetPos` 즉시 snap, 정적 frame, walk-cycle·autoplay 미시작([[SPEC-202-design-accessibility]] AC-11). 이는 movement-off 경로와 동일하다.
8. **mid-walk retarget(확정 규칙, 파라미터 가설, F11)**: roaming 보간 중에 `targetPos`가 다시 바뀌면(예: 도착 전 status가 한 번 더 변화), 새 tween을 **현재 `renderedPos`에서** 다시 시작한다: `tweenStart := t`, duration은 `현재 renderedPos → 새 targetPos` 거리로 §3.1-6 공식으로 **재계산**하고, direction은 `새 targetPos − 현재 renderedPos`로 **재-quantize**한다. animation state는 `roaming` 유지(state 미변화 시 §2.7 `tEnter` 불변으로 walk-cycle 위상 보존). 직전 tween의 잔여 위치를 버리지 않으므로 순간이동이 없다. easing 누적 처리(재시작 시 ease-in 반복 여부)는 가설(§6 Q3).
9. **idle ambient micro-wander(선택·P1, 기본 off)**: idle이며 도착 상태인 sprite가 station 주변 반경 `WANDER_R`(가설) 내에서 작은 발걸음을 갖는 ambient 효과. 결정성을 위해 `paneId`로 seed한다. **reduced-motion에서 비활성**, 기본 off, **core AC 비대상**(비-load-bearing).

### 3.2 zero layout shift (확정)

1. sprite는 fixed-aspect 컨테이너 안 **절대 위치**이므로 status·위치·roaming·hover/select 변화가 **인접 요소 reflow를 유발하지 않는다**(CLS 0). bubble는 overlay(absolute)로 떠서 layout을 밀지 않는다.
2. asset 토글(탑재↔미탑재)이 layout을 바꾸지 않는다: sprite box는 manifest `frame_size`로 고정([[SPEC-300-asset-rendering]] §3.6, [[SPEC-202-design-accessibility]] P2/AC-17), station/zone 좌표는 §3.4 placeholder에서도 동일.
3. 데이터 refresh(WS batch)로 scroll/layout이 튀지 않는다([[SPEC-201-dashboard-screens]] §3.6, [[SPEC-202-design-accessibility]] AC-12). 본 맵은 batch 적용 결과만 구독한다(batch 메커니즘은 SPEC-200/102 소유).

### 3.3 성능 예산 (가설, 20 session / 100 pane)

1. **목표(가설)**: 20 session / **100 pane(=100 sprite)**가 동시에 roaming하는 worst case에서, 공유 clock 렌더 루프가 frame time **≤ 16.7ms p95(≈60fps)**(허용 degrade 목표 ≥ 50fps)를 유지하고, **long task > 50ms 없음**, **CLS = 0**. 임계는 **success hypothesis**이며 측정으로 보정한다.
2. **측정 방법(참조)**: [[SPEC-007-test-validation]] §2.1 measurement(M) 계층 방법론 패턴(input·method·formula·threshold)을 FE 렌더 측정에 준용한다. FE 컴포넌트/렌더 측정 계층은 forward([[SPEC-900-traceability-rollup]] §0 layer C/M)이며, 본 예산은 [[SPEC-201-dashboard-screens]] AC-14(20/100 layout shift 없음)·[[SPEC-200-frontend-architecture]] 성능(정규화·windowing)과 정합한다.
3. **미달 시 완화(가설)**: (a) 뷰포트/가시 zone 안 sprite만 애니메이션, off-screen은 정적; (b) 공유 clock으로 frame 계산 분할; (c) canvas P2 경로(§2.7). 어느 경우든 keyboard/selection/a11y·zero layout shift는 보존한다.

### 3.4 placeholder parity (R-UI-006, [[08-Decisions|D-007]]) (확정)

asset(background/props/tiles/sprite)이 없거나 일부 누락돼도 **동일 layout·interaction·a11y**가 동작한다.

| 누락 대상 | 대체(확정) |
| --- | --- |
| background 이미지 | terrain tile(`orc-camp-terrain-square-topdown.moss-ground`) 타일링, 그것도 없으면 CSS gradient ground. logical 치수·playField는 상수 유지 → zone/station 좌표 불변 |
| station prop | 동일 station 앵커에 **CSS marker**(작은 box + station/status glyph + label) → 위치=상태 정보 보존 |
| zone header prop | CSS label "window {windowIndex}"만 렌더 |
| sprite | [[SPEC-300-asset-rendering]] L1/L2 placeholder(box = `frame_size × mapSpriteScale`, asset과 동일 스케일, 위치·interaction 불변) |
| status overlay | CSS glyph fallback([[SPEC-202-design-accessibility]] R1) |

규칙:

1. **zone/station 위치 불변**: zone 분할·station 앵커·slot offset은 manifest **asset과 무관하게** `mapDims`(상수)·`Orc` 필드만으로 계산되므로 asset 누락이 배치를 바꾸지 않는다.
2. **status 구분 유지**: placeholder에서도 위치(station) + label + overlay/CSS glyph로 7종 status가 grayscale-구분 가능하다([[SPEC-202-design-accessibility]] AC-16와 동치).
3. **interaction/a11y parity**: selection·hover·focus·keyboard·bubble·reduced-motion이 placeholder에서도 동일 동작한다([[SPEC-300-asset-rendering]] §3.6, [[SPEC-202-design-accessibility]] P1).
4. **no layout shift**: asset 유무 토글이 layout을 바꾸지 않는다(§3.2-2).

## 4. Acceptance criteria

> 각 AC는 고정 `OrcMapInput[]` + `MapDims` + (필요 시) `prefers-reduced-motion` fixture(Given) → 맵 layout/movement 모델 산출(When) → 좌표/전이/표시/접근성(Then)으로 검증한다. 좌표는 §2.2~2.5 규칙대로 계산한 값과 일치해야 한다. movement 보간/성능 임계는 가설이며 구조 규칙은 확정이다.

- **SPEC-301-AC-01** (R-UI-003, R-UI-008) — zone partition 결정성
  - Given distinct `windowIndex` 집합과 `MapDims`가 주어진 camp fixture에서
  - When 맵이 zone을 산출하면
  - Then zone 수 = distinct `windowIndex` 수이고, 각 zone은 `windowIndex` 오름차순 row-major로 `cols×rows` grid에 배치되며, 모든 `zoneRect`가 `playField` 안에 있고, 같은 window 집합·치수에 대해 동일 `zoneRect`가 재현된다(§2.2).

- **SPEC-301-AC-02** (R-UI-003, [[SPEC-202-design-accessibility]] R4 정합) — station↔status 매핑·terminated edge·label 비가림
  - Given 7 `OrcStatus` 각각의 orc가 한 zone에 있는 fixture에서
  - When 맵이 station을 배치하면
  - Then 각 status가 §2.3 표의 고유 station prop 앵커(`active→workbench`, `waiting→campfire`, `idle→bedroll`, `error→notice-board`, `stale→stone-marker`, `unknown→utility-totem`, `terminated→locked-chest` edge)에 매핑되고, `terminated`는 zone edge를 따라 **1-D stack**(§2.4-5, corner overflow 없음)으로 정적 배치되며, station prop이 status label/`tmuxTarget` label을 가리지 않는다(prop=ground z < label z).

- **SPEC-301-AC-03** (R-UI-003, [[08-Decisions|D-017]]) — slot 결정성·tmuxTarget reindex 불변
  - Given 동일 `(zone,status)`에 복수 orc가 있고, 이후 `tmuxTarget`만 reindex된(예: `%12`→window 재배치로 표시 target 변경, `paneId` 동일) 두 snapshot fixture에서
  - When 맵이 slot offset을 산출하면
  - Then 각 orc의 slot offset은 `paneId` 오름차순 slotRank의 결정적 함수이고, **`tmuxTarget` reindex만으로는 어떤 orc의 위치도 바뀌지 않으며**(INV-2), 같은 `paneId`는 같은 offset을 갖는다(§2.4).

- **SPEC-301-AC-04** (R-P1-004, R-P1-013) — roaming 진입(status 변화)·도착 전이 (**SPEC-300 Q4**)
  - Given 한 orc(`id`)가 `status=idle`로 도착해 있다가 `status=active`로 바뀐 fixture에서(reduced-motion 아님)
  - When 맵이 frame을 진행하면
  - Then target station이 idle(bedroll)→active(workbench)로 바뀌어 `renderedPos≠targetPos`가 되고 `animationState='roaming'`(walk-cycle)으로 `renderedPos`를 `targetPos`로 보간하며, 도착(`|Δ|≤ε`) 시 `targetPos`로 snap하고 status 애니메이션(`active`)·facing `south`로 전환한다. roaming은 status enum이 아니라 target 변화로만 진입한다(별도 신호 불요, INV-1).

- **SPEC-301-AC-05** (R-P1-004, R-P1-013, [[SPEC-300-asset-rendering]] §3.2 정합) — 8방향 quantize·경계 결정성·south fallback
  - Given roaming 중 이동 벡터(`target − rendered`)가 8방향 각 버킷의 중심값 **및 경계값(±22.5°의 배수, 예: 22.5°, 67.5°)**에 해당하는 fixture에서
  - When 맵이 direction을 산출하면
  - Then `atan2(dy,dx)`가 §3.1-2의 **half-open 구간 `[center−22.5°, center+22.5°)`**로 양자화되어 manifest `roaming.folders` 방향 이름(`east`/`south-east`/`south`/`south-west`/`west`/`north-west`/`north`/`north-east`)에 매핑되고, **경계 각도는 항상 상위 버킷으로 결정적으로 귀속**되며(동률 없음), 해당 방향 폴더가 없으면 `south`로 강등된다.

- **SPEC-301-AC-06** (R-ORC-005, INV-4) — activity bubble + 상시 label/overlay
  - Given `currentWorkSummary` 유/무, `summaryIsEstimated=true/false`인 orc fixture에서
  - When orc를 hover/focus/select하면
  - Then speech bubble가 `currentWorkSummary`(+`summarySource`, `summaryIsEstimated=true`면 estimated 마커)를 표시하고(`null`이면 "no summary", 합성 없음), status label·overlay·raw `tmuxTarget`은 hover와 무관하게 **항상** 표시되며 bubble가 이를 가리지 않는다.

- **SPEC-301-AC-07** (R-P1-004, 비기능 접근성, [[SPEC-202-design-accessibility]] AC-11 정합) — reduced-motion snap
  - Given `prefers-reduced-motion: reduce`이고 임의 status를 가진 orc 집합 + status 변화 fixture에서
  - When 맵을 렌더하면
  - Then 모든 orc는 `targetPos`로 **즉시 snap**(보간 없음)되고 정적 frame([[SPEC-300-asset-rendering]] `reduced_motion.fallback_frame`)을 표시하며, walk-cycle·autoplay·ambient wander가 시작되지 않는다.

- **SPEC-301-AC-08** (R-UI-003, R-UI-006, [[SPEC-202-design-accessibility]] AC-12/17 정합) — zero layout shift
  - Given 맵이 렌더된 상태에서 (i) status/위치 변화·roaming, (ii) hover/select, (iii) asset 탑재↔미탑재 토글, (iv) 뷰포트 리사이즈가 발생할 때
  - When layout을 측정하면
  - Then sprite는 fixed-aspect 컨테이너 내 절대 위치라 인접 요소 reflow가 없고 CLS=0이며, sprite box는 `frame_size × mapSpriteScale`(§2.1)로 고정되고 그 스케일이 **asset·placeholder에 동일 적용**되어 asset 토글 시 layout shift가 0이다.

- **SPEC-301-AC-09** (R-UI-003, R-UI-004 진입, [[SPEC-202-design-accessibility]] AC-07/K2 정합) — keyboard roving-tabindex(zone 단위)·선택
  - Given 마우스 없이 키보드만 쓰는 사용자와 복수 zone 맵에서
  - When `Tab`/Arrow/`Enter`로 이동하면
  - Then 각 zone이 하나의 roving-tabindex 그룹(zone당 single tab stop)이고, `Tab`/`Shift+Tab`은 zone 간 이동, Arrow는 focus zone 내부 orc 간 결정적 순서 이동, `Enter`/`Space`는 focus orc를 선택해 `?orc=<orcId>`로 inspector를 열며, 어떤 orc도 키보드로 도달 불가능하지 않다.

- **SPEC-301-AC-10** (R-UI-006) — placeholder parity
  - Given background/props/tiles/sprite asset이 미탑재/누락인 fixture에서
  - When 맵을 렌더·조작하면
  - Then zone/station/slot 위치가 asset 탑재 시와 **동일**하게 산출되고(CSS ground + station CSS marker), 7종 status가 위치+label+overlay/CSS glyph로 grayscale-구분 가능하며, selection·hover·keyboard·bubble·reduced-motion이 동일 동작하고, asset 토글로 layout shift가 0이다(§3.4).

- **SPEC-301-AC-11** (비기능 성능) — 20 session/100 pane 프레임 예산 (측정=비-게이트 / 구조=게이트)
  - Given 20 session / 100 pane(100 sprite)가 동시에 roaming하는 fixture에서([[SPEC-007-test-validation]] §2.1 측정 패턴 준용)
  - When 맵 렌더 루프를 측정·검사하면
  - Then **(a) 비-게이트 M-layer 측정(가설)**: frame time p95 ≤ 16.7ms(degrade 허용 ≥ 50fps), long task > 50ms 없음은 **success hypothesis**이며 CI 게이트가 아니라 측정으로 보정한다([[SPEC-900-traceability-rollup]] §0 M-layer, [[SPEC-007-test-validation]] §2.1). **(b) 게이트 가능한 결정적 sub-assertion(확정)**: CLS=0(§3.2, AC-08), 단일 공유 clock·per-sprite 타이머 0건(AC-13), off-screen sprite의 static 전환 토글(§3.3-3)이 동작한다. 측정 미달 시 §3.3-3 완화(가시 영역 한정·canvas P2)로 보정하되 (b)는 항상 성립한다.

- **SPEC-301-AC-12** (R-UI-003, R-UI-008, INV-1) — target position 순수성·서버 데이터 불변
  - Given 동일 `(orc, CampLayoutContext, MapDims)` 입력을 반복 적용하고, 동일 입력의 `OrcMapInput`/snapshot/WS payload를 검사할 때
  - When `targetPosition`을 산출하면
  - Then 매 호출이 동일 좌표를 산출하고(순수·결정적), 함수가 읽는 orc 필드는 `windowIndex`/`status`/`paneId`뿐이며, `Orc`/`Camp`/`ScanResult`/snapshot/WS 어디에도 좌표(x/y/position) 필드가 **존재하지 않는다**([[SPEC-005-data-contract]] 불변).

- **SPEC-301-AC-13** (R-P1-004, 비기능 성능, [[SPEC-300-asset-rendering]] §3.3-2 정합) — 단일 공유 clock + state-entry anchored phase
  - Given 다수 sprite가 애니메이션/roaming하고, 한 sprite가 `idle→active`로 전이한 뒤 같은 `active`로 두 snapshot이 이어지는 fixture에서
  - When 렌더 루프를 검사하면
  - Then (a) 모든 sprite의 frame 진행·보간이 **하나의 공유 시간원**(단일 `requestAnimationFrame` 루프)에서 파생되고 per-sprite 타이머/RAF(`setInterval` 등)가 **0건**이며, (b) frame index = `floor((t − tEnter)*fps) mod frames`([[SPEC-300-asset-rendering]] `fps`/`frames`)로 **state-entry `tEnter`에 anchor**되어, `idle→active` 전이에서 `active`가 **frame 0부터** 시작하고(`tEnter` 갱신) 이어지는 동일 `active` snapshot에서는 frame 0으로 강제 리셋하지 않는다(위상 보존). 즉 단일 clock이 [[SPEC-300-asset-rendering]] §3.3-2를 **위반하지 않는다**.

- **SPEC-301-AC-14** (R-UI-003, R-UI-008, R-UI-006) — geometry feasibility·uniform map scale parity
  - Given native `frame_size`(232/228) sprite와 play-field(890×330 logical), 그리고 한 zone에 동일 status orc 다수 + 다-window(`rows≥4`) camp fixture에서
  - When 맵이 §2.1 `mapSpriteScale`·§2.2 zone·§2.4 ring을 산출하면
  - Then (a) scaled sprite box(`frame_size × mapSpriteScale`)가 자신의 zone inner rect 안에 들어가고 ring 간격 `RING_STEP`이 scaled footprint 기준이라 인접 ring sprite가 비-중첩이며(890×330에 cramped되지 않음), (b) inner rect는 `MIN_ZONE` 하한을 만족하거나(다-window는 §2.2 스크롤 전환) degenerate하지 않고, (c) `mapSpriteScale`이 **asset과 placeholder 박스에 동일하게 적용**되어 toggle 시 box 크기·layout이 변하지 않으며(AC-08·[[SPEC-202-design-accessibility]] AC-17 동치), frame_size 종횡비가 보존된다.

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-003 | camp scene을 zone/station/slot 공간 맵으로 실현(window=lane·pane=slot 의미 보존, SPEC-201-AC-03 scene 배치 supersede), 결정적 배치·feasible geometry·zero layout shift·keyboard | SPEC-301-AC-01, AC-02, AC-03, AC-08, AC-09, AC-12, AC-14 |
| R-UI-006 | background/props/tiles/sprite 누락 시 placeholder parity(위치·status·interaction·a11y 불변, uniform `mapSpriteScale` 토글 parity, no layout shift) | SPEC-301-AC-08, AC-10, AC-14 |
| R-ORC-005 | activity bubble에 `summarySource`/estimated 마커 + 상시 status label/confidence 동반(단정 금지) | SPEC-301-AC-06 |
| R-P1-004 | status별 sprite animation을 공간 맵으로 확장: `roaming` walk-cycle 진입·8방향·reduced-motion·공유 clock(state-entry anchored) | SPEC-301-AC-04, AC-05, AC-07, AC-13 |
| **R-UI-008** | orc 위치+애니메이션으로 활동을 공간 표현, 위치는 기존 필드의 결정적 함수(서버 좌표 불추가) | SPEC-301-AC-01, AC-02, AC-03, AC-12, AC-14 |
| **R-P1-013** | status 변화 시 roaming으로 이동·8방향 direction(P1 movement) | SPEC-301-AC-04, AC-05 |
| 비기능: 성능 (20/100) | 단일 공유 clock·fixed-aspect·완화 전략(가설 임계) | SPEC-301-AC-11, AC-13 |
| 비기능: 접근성 (keyboard/reduced-motion) | zone roving-tabindex·snap (값은 [[SPEC-202-design-accessibility]]) | SPEC-301-AC-07, AC-09 |

> **소유/부수 분담**: 본 spec은 R-UI-003(공간 배치)·R-P1-004(movement animation)의 **맵/이동 측면**을 소유하고, sprite 메커니즘(SPEC-300)·화면 콘텐츠/selection(SPEC-201)·접근성 수치값(SPEC-202)은 **참조**한다(이중 ownership 아님). R-UI-008/R-P1-013은 [[08-Decisions|D-035]]로 [[02-Requirements]]에 **채택 완료**됐다(R-UI-008 = P0 spatial-activity, R-P1-013 = P1 roaming). 전체 매트릭스 롤업은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (조정 필요 — 본 spec은 직접 수정하지 않고 기록)

- **C1 — 신규 요구사항 채택(F4) — ✅ 해소(2026-06-28)**: R-UI-008은 [[02-Requirements]] R-UI 그룹에, R-P1-013은 P1 그룹에, D-035는 [[08-Decisions]]에 **채택 완료**됐고 SPEC-301 frontmatter `requirements`/`decisions`와 [[SPEC-900-traceability-rollup]]에도 반영됐다(아래 drop-in 텍스트가 그대로 적용됨). 이하 원 제안 맥락은 기록으로 보존한다. 채택 전 맥락: [[02-Requirements]]에는 "orc 위치/이동으로 활동을 공간 표현"·"status 변화 시 roaming 이동"을 **명시한 R-\*가 없다**(R-UI-003은 "camp scene + orc character"까지, R-P1-004는 "agent별 sprite variant·상태별 animation"까지). spec-reviewer(F4)는 이를 정식 요구사항으로 승격할 것을 요청했다. **단 본 spec-author의 write scope는 `docs/specs/`로 한정**되며 청사진(`docs/product/`) 직접 편집은 권한 밖이다(coordinator 전달 승인은 user 권위가 아님). 따라서 아래 **drop-in 텍스트를 확정 제안**하고, [[02-Requirements]]·[[08-Decisions]] 반영은 orchestrator/user가 적용(또는 user가 본 agent에 명시 위임)하도록 남긴다. 채택 전까지 R-UI-003/R-P1-004로 부수 충족하며, **채택 즉시** SPEC-301 frontmatter `requirements`에 `R-UI-008, R-P1-013`을 추가하고 [[SPEC-900-traceability-rollup]] §2.4·§3.2를 갱신한다.

  적용 대상 파일: `docs/product/02-Requirements.md`(P0 `### P0` R-UI 그룹 끝 / P1 `### P1` 그룹 끝), `docs/product/08-Decisions.md`(말미, 현재 최신 `D-034` 다음).

  - **R-UI-008 (ADOPTED, P0)** — `02-Requirements.md` R-UI 그룹에 추가:
    > `- **R-UI-008**: camp detail은 orc의 위치와 애니메이션으로 현재 활동(status)을 공간적으로 표현해야 하며, 각 orc의 위치는 기존 Orc 필드(windowIndex/status/paneId)의 결정적 함수여야 하고 새로운 server 좌표 데이터(x/y 등)를 도입하지 않는다.`
  - **R-P1-013 (ADOPTED, P1)** — `02-Requirements.md` `### P1` 그룹에 추가:
    > `- **R-P1-013**: status 변화 시 orc가 roaming walk-cycle 애니메이션으로 새 위치로 이동하고, 이동 방향을 8방향으로 표현한다.`
  - **D-035 (ADOPTED)** — `08-Decisions.md` 말미에 추가:
    > `## D-035: camp 공간 맵·movement는 client-derived이며 서버 좌표를 추가하지 않는다`
    > `- 결정: camp detail을 zone(window)=공간, station(status)=위치, slot(paneId)=fan-out으로 구성하는 공간 맵으로 한다. orc 위치는 client에서 기존 Orc 필드의 결정적 함수로 계산하고, Orc/Camp/ScanResult/snapshot/WS에 좌표 필드를 추가하지 않는다([[SPEC-005-data-contract]] 불변). roaming은 status enum이 아니라 target 위치 변화 시 진입하는 시각 전이다.`
    > `- 근거: read-only·privacy·data-contract SSOT([[08-Decisions|D-018]]) 보존, web-only 변경으로 backend 영향 0.`
    > `- 영향: R-UI-008/R-P1-013 신설, [[SPEC-301-camp-map-movement]] 소유, [[SPEC-300-asset-rendering]] Q4 해소·[[SPEC-201-dashboard-screens]] AC-03 scene 배치 supersede.`
- **C2 — SPEC-202 K2(roving tabindex) 구체화(coordination)**: [[SPEC-202-design-accessibility]] K2는 "orc sprite layer = roving tabindex"를 규정한다. 본 spec은 이를 **zone 단위 그룹**(zone당 single tab stop, Tab=zone 간 / Arrow=zone 내)으로 구체화한다(§2.7, AC-09). 의미 충돌은 아니며 K2의 granularity 보강이다. SPEC-202 게이트에서 정합 확인 권장.
- **C3 — SPEC-201 §2.3 lane/slot ↔ 맵 의미 일치**: [[SPEC-201-dashboard-screens]] §2.3은 window=lane·pane=slot을 소유한다. 본 spec의 zone=window·slot=paneId는 그 의미를 **공간으로 보존**한다(lane→zone, slot 정렬은 paneId rank). SPEC-201 §2.3에 "camp detail 배치는 SPEC-301 공간 맵이 소유, lane/slot 의미 보존"을 cross-ref로 추가했다(아래 NOTE). 두 spec의 정렬 키(SPEC-201은 `paneIndex` 표시 정렬, 본 spec은 `paneId` rank 배치)는 **표시 정렬 vs 공간 배치**로 역할이 다르며, 배치는 reindex 불변(D-017)을 위해 `paneId`를 쓴다.

### Open Questions (검토 필요)

- **Q1 — station 앵커 정규 좌표·zone grid 상수 튜닝**: §2.3 앵커 `(nx,ny)`와 §2.2 `ZONE_COLS_MAX`/`ZONE_GUTTER`/`ZONE_PAD`/`ZONE_HEADER_H`는 시각 가설이다. 7 station 비가림·label 가독성·zone 가독 밀도로 prototype 보정 필요. 구조 규칙(서로 다른 앵커·terminated edge·label 비가림)은 확정.
- **Q2 — slot ring 상수·overflow 임계(메커니즘 확정, 값만 가설)**: feasibility 메커니즘은 F2/F10으로 **확정**됐다 — 균일 `mapSpriteScale`(§2.1), scaled-footprint 기준 `RING_STEP`(§2.4-3), `MIN_ZONE` 하한 + 다-window 세로 스크롤(§2.2). 남은 것은 **튜닝 값**(`mapSpriteScale`/`RING_BASE`/`RING_CLEARANCE`/`R_MAX`/`SLOT_SOFT_MAX`/`MIN_ZONE_*`)과 한 station에 동일 status orc가 매우 많을 때(예: 한 window 50 active pane) 가독성 vs "모두 표시(read-only)" trade-off의 측정 보정뿐이다.
- **Q3 — roaming 보간 파라미터**: §3.1-6 `ROAM_SPEED`/`ROAM_MIN_MS`/`ROAM_MAX_MS`/easing, §3.1-1 `ε`, 최초 등장 spawn 방식(snap vs walk-in), ambient wander 활성화/`WANDER_R`(§3.1-8)는 가설·선택. reduced-motion에서는 모두 비활성(확정).
- **Q4 — DOM↔canvas 전환 임계**: §2.7 canvas P2 escape hatch로 전환할 정확한 성능 임계(§3.3 예산 미달 시점)와 canvas 경로의 a11y/selection DOM overlay 설계는 [[SPEC-200-frontend-architecture]]·[[SPEC-007-test-validation]] FE 측정 계층(forward)과 함께 확정. MVP는 DOM.
- **Q5 — overlay/bubble anchor 좌표 규약**: status overlay(64×64)·speech bubble의 sprite anchor 기준 정확 offset은 [[SPEC-300-asset-rendering]] Q1(overlay anchor)과 공동 확정 필요. 본 spec은 z-순서·비가림(§2.3-1, §2.6)까지 고정.
