---
spec: SPEC-301
title: camp 맵·이동·roaming (orc 공간 배치·movement)
status: approved
updated: 2026-06-29
requirements: [R-UI-003, R-UI-004, R-UI-006, R-UI-008, R-ORC-005, R-P1-004, R-P1-005, R-P1-013]
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

> **핵심 모델(확정·구현, 2026-06-29) — image-ground(단일 배경 이미지) 우선**: camp 배경은 타일/zone-grid가 아니라 **단일 배경 이미지**다(§2.1a). 배경 이미지에 `logical_size`(= native px)와 walkable `ground` polygon이 있으면 **image-ground 모드**로 동작한다: 이미지가 곧 world(native 해상도, `BASE_SCALE=1`), 뷰포트는 이미지보다 작아 **drag-pan**으로 탐색하며 첫 mount 시 ground 중심으로 센터링한다(전체를 한 번에 보지 않음). 모든 orc는 walkable **safe_area**(polygon의 내접 rect) 내부에 배치된다. 배경에 ground polygon이 없으면(예: legacy `warbase-sunset-dashboard`) **§2.2 zone-grid world(fallback/placeholder)**로 동작한다(하위호환). **Wang/타일 지면은 제거**됐다(§2.8, [[SPEC-300-asset-rendering]] §2.5 supersede). 씬 배치 산출물(ground 산정·placement·비율 게이트)의 **owner는 `scene-placement-engineer`**(`.claude/agents/scene-placement-engineer.md`)다.

입력은 [[SPEC-005-data-contract]]가 만든 `Orc`(특히 `windowIndex`·`status`·`paneId`)와 `asset-packs/orc-camp-default/manifest.json`의 background `logical_size`/`safe_area`/`ground`·character `roaming` 8방향 walk-cycle이다. 본 spec은 그 위에 ① **image-ground 배치(world=이미지·safe_area placement·ratio 게이트)** 또는 **zone(window) 분할(fallback)**, ② **station(status) 앵커**, ③ **slot(paneId) fan-out**, ④ **target position = f(status, paneId)[image-ground] / f(windowIndex, status, paneId, mapDims)[zone-grid]**, ⑤ **roaming 진입·8방향 quantize·보간**, ⑥ **activity 표시(speech bubble + 상시 label/overlay)**, ⑦ **맵 render contract(DOM 기본·canvas P2·공유 clock·zero layout shift·drag-pan·keyboard·reduced-motion)**, ⑧ **성능 예산(20 session/100 pane)**, ⑨ **placeholder parity**를 정의한다.

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
| **In** | **image-ground 배치(default)**: 배경 이미지 = world(native), orc를 walkable `safe_area`에 결정적 배치 (§2.1a/§2.5) | 단일 배경 이미지 모델 |
| **In** | **ground-ratio 등록 게이트**: `groundRatio(polygon, world) ≥ REFERENCE_GROUND_RATIO`(=0.281) (§2.8 ground gate) | 신규 배경 등록 조건 |
| **In** | zone(window) 분할 규칙 (**legacy/fallback**): ground polygon 없는 배경 → `windowIndex`별 zone grid (§2.2) | window grouping 공간화(하위호환) |
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
| **In** | idle ambient micro-wander **활성화**(기본 ON·subtle, P1, #43) | §3.1-9, 비-load-bearing(reduced-motion off·결정적·jitter-only) |
| **In** | active **patrol loop**(roam↔active 반복·동선 randomize) + non-active **랜덤 rest**(기본 ON, P1, #49) | §3.1-10, 비-load-bearing(reduced-motion off·결정적·`renderedPos`-only) |

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

// 맵 치수 — zone grid(§2.2)에서 산출하는 "큰 논리 월드". background safe_area에 갇히지 않는다.
interface MapDims {
  world: { w: number; h: number };  // 전체 월드 logical 치수 = zone grid 합(§2.2)
  zone: { w: number; h: number };   // 단일 zone 고정 logical 치수(full-size sprite 수용)
  cols: number;                     // zone grid 열 수(= min(Z, ZONE_COLS_MAX))
}
// 뷰포트는 이 월드를 스크롤/팬한다(§2.7). background 이미지는 비-제약 backdrop(§3.4).
```

- `OrcMapInput`은 모두 [[SPEC-005-data-contract]]가 산출한 필드의 **읽기 전용 subset**이다. 본 spec은 어떤 필드도 추가·합성하지 않는다(INV-1).
- `MapDims`는 **zone 수와 고정 ZONE 치수(§2.2)에서 산출**하며 background 이미지 치수에 의존하지 않는다(원본-크기 sprite를 위해 placement를 background에서 분리 — F2 재결정). background/terrain이 없어도 zone/station/world 좌표는 상수로 유지된다(§3.4) → asset 유무와 무관하게 배치가 동일하다.

**맵 스프라이트 스케일 `mapSpriteScale`(확정 메커니즘, 값 가설) — 원본 크기 우선**:

- orc sprite는 **원본 크기에 가깝게** 표시한다(R-UI-008 "공간 표현"의 가독성 요구). native frame(232/228px)을 거의 그대로 쓰도록 `mapSpriteScale` 가설 초기값 **`0.9`**(232px → ≈209px footprint), 범위 가설 `[0.7, 1.0]`. 이는 [[SPEC-300-asset-rendering]] §2.2 per-character render `scale`(현재 1)과 별개의 맵 배치 스케일이며, asset·placeholder 박스에 동일 적용(toggle parity — [[SPEC-202-design-accessibility]] AC-17·[[SPEC-300-asset-rendering]] §3.6), 종횡비 보존.
- **핵심 구조 변경(F2 재결정)**: 더 이상 sprite를 background safe_area(890×330)에 맞춰 축소(구 `0.20`)하지 않는다. 대신 **placement 좌표계를 background에서 분리**해, full-size sprite가 들어맞는 **큰 논리 월드**(§2.2 고정-크기 zone grid)를 만들고 **뷰포트가 그 월드 위를 스크롤/팬**한다(§2.7). 즉 sprite 크기는 background 치수와 **무관**하다. 작은 camp은 월드가 뷰포트에 다 들어오고, orc/​window가 많은 camp만 스크롤로 탐색한다.
- **`REF_FRAME_MAX`(확정 메커니즘, 값 가설 `232`)**: ring/stack 간격(§2.4-3/§2.4-5)의 scaled footprint는 character별 `frame_size`(232 vs 228)가 아니라 **layout 상수 `REF_FRAME_MAX`** 기준(`REF_FRAME_MAX * mapSpriteScale`)으로 정의한다(같은 `(windowIndex, status, paneId)` slot 좌표가 `agentType`에 의존하지 않도록 — INV-1·§2.5). 개별 sprite 박스만 자기 `frame_size × mapSpriteScale`로 그린다.
- **불변식 보존**: sprite box는 월드 logical 좌표에 절대 배치되므로 zero layout shift(§3.2)·종횡비 고정 유지(스크롤·팬은 layout shift가 아니다; 데이터 refresh가 scroll 위치를 바꾸지 않는다 — §3.2).

> **두 world 모델(확정·구현)**: 아래 §2.1a image-ground가 **default**다. §2.1의 `mapSpriteScale`(0.9)·§2.2 zone-grid·§2.3 station·§2.4 slot 격자는 **legacy/fallback**(ground polygon 없는 배경)으로 보존된다. 두 모델 모두 placement는 순수·결정적(INV-1)이며 `web/src/scene/layout.ts:computeLayout(orcs, ground?)`가 `ground` 인자 유무로 분기한다.

### 2.1a image-ground 모드 (default·확정·구현)

배경 이미지가 곧 world인 모델. `web/src/scene/ground.ts`(순수·결정적; `Date.now`/`Math.random` 없음)가 background를 placement context로 변환한다.

**ground context 도출(`groundFromBackground(bg)`)**:

```ts
interface GroundContext {
  world: { w: number; h: number }; // = background.logical_size (= 2× native) = world 크기
  safeArea: Rect;                  // walkable polygon의 내접 rect — orc target은 여기에 clamp
  polygon: Vec2[];                 // walkable polygon (logical px, 2× 좌표) — ratio 게이트 SSOT
}
// bg.logical_size + bg.ground.polygon(≥3 vertices)이 있으면 GroundContext, 아니면 null(→ zone-grid).
// safeArea = bg.safe_area([x,y,w,h]) 우선, 없으면 polygon bbox.
```

**배경 requirements(확정·구현 — 2× world)**: 각 배경은 `native_size`(= 이미지 native px), `world_scale`(고정 배율), `logical_size = native_size × world_scale`(= world 크기)를 선언하고, image-ground로 쓰려면 **logical(2×) 좌표계의** walkable `ground.polygon`(+권장 `safe_area`)을 선언해야 한다. default `orccamp-default`: `native_size=[1672,941]`, `world_scale=2`, `logical_size=[3344,1882]`. world = `logical_size`(= 2× native)이며, **1672×941 PNG는 `image-rendering: pixelated`로 2× 업스케일**돼 world를 full-cover로 채운다([[SPEC-300-asset-rendering]] §2.6b). 2× world는 orc가 **원본 크기 sprite**로 들어가도록 ground 공간을 넓힌다(아래 스프라이트 스케일).

**선명도 요구사항(이미지 해상도, 확정)**: 배경은 world에 full-cover로 그려지므로 `native_size < logical_size`(= `world_scale > 1`)이면 그만큼 업스케일되어 흐려진다(HiDPI/retina에서는 device DPR 배율이 추가로 곱해져 sprite보다 더 흐리게 보인다 — sprite는 DPR만, 배경은 `world_scale × DPR`). 따라서 **배경 native 해상도는 world 크기(`logical_size`)와 같아야 한다(`world_scale = 1`, 업스케일 0)**. `orccamp-default`의 권장 재생성 해상도 = **현재 world 크기 `3344×1882`(16:9)** — 재생성본을 받으면 `native_size=[3344,1882]`·`world_scale=1`로 교체하고 `image-rendering`은 `pixelated`(혹은 디테일 일러스트면 `auto`)로 둔다. 더 높은 선명도(retina-perfect 배경)를 원하면 `6688×3764`도 가능하나 sprite/UI는 여전히 DPR-soft라 효용은 체감 위주다. 신규 배경도 이 규칙(native = world)을 따른다.

**placement(확정·구현, `groundLayout`/`groundTargetPosition`)**:

1. **world = `logical_size`**(= 2× native, 예 `3344×1882`). `BASE_SCALE=1`(1 logical px = 1 css px), **고정 스케일(zoom 없음, transform 없음)**. 뷰포트는 world보다 작아 **drag-pan으로만** 탐색한다(§2.7). 첫 mount 시 뷰포트를 ground 중심(`safeArea` center)으로 **센터링**한다(전체를 한 번에 보지 않음).
2. **모든 orc를 walkable `safeArea` 내부에 배치**: target = `stationAnchor(status, safeArea)` + ground-scaled slot fan-out을 `clampToRect(safeArea, GROUND_MARGIN)`로 클램프한다(`GROUND_MARGIN = (REF_FRAME_MAX × GROUND_SPRITE_SCALE)/2 = 104.4` → 원본 크기 sprite body 전체가 walkable rect 안). polygon은 **ratio 게이트**(§2.8)·향후 정밀 polygon 배치용이며, 현재 placement는 polygon 내접 rect(safe_area)로 **보수적 clamp**한다.
3. **slot peers는 status 단위로 키**: 모든 window가 단일 ground를 공유하므로 동일 status의 slot rank가 전역에서 유일·비중첩이 되도록 peer 집합을 **status로** 묶는다(zone-grid의 `(windowIndex, status)` 키와 다름). 따라서 서로 다른 window의 동일 status orc도 distinct ground slot을 받는다.
4. **`zoneIndex`는 window rank 유지**: placement는 단일 ground지만 `target.zoneIndex`는 `windowIndex` rank를 그대로 추적해 dock/keyboard 그룹(§2.7, window당 single tab stop)을 보존한다.
5. **결정성(INV-1 유지)**: target = `f(status, paneId-rank)`(+ground 상수). 동일 입력 → 동일 좌표. 서버 좌표/런타임 무작위 없음.

**스프라이트 스케일(확정·구현 — 원본 크기, 2× world 도입)**: image-ground sprite 스케일을 **`GROUND_SPRITE_SCALE = MAP_SPRITE_SCALE`(=0.9, 원본 크기)**로 통일했다(구 `0.3`에서 변경). 좁은 ground에 sprite를 축소해 욱여넣는 대신 **world(배경 이미지)를 `world_scale=2`로 확대**해 원본 크기 sprite가 walkable ground에 들어가게 한다. 따라서 `GROUND_PITCH_FACTOR = GROUND_SPRITE_SCALE / MAP_SPRITE_SCALE = 1.0`(slot/ring·terminated stack pitch가 zone-grid와 동일 footprint 기준). 두 world 모델의 sprite는 이제 동일 원본 크기(`frame_size × 0.9`)다.

**레이어 정책(확정·구현)**: image-ground 모드에서는 배경 이미지가 자체 scenery를 가지므로 **CSS Decor/Station 레이어를 렌더하지 않는다**(§2.8, [[SPEC-300-asset-rendering]] §2.6 intro). lighting/shadow/label/overlay·selection/bubble은 유지한다(§2.7 z-stack ⑤·⑧~⑫).

### 2.2 zone = window (분할 계약 — legacy/fallback)

> **적용 범위(확정)**: §2.2~§2.4(zone/station/slot 격자)는 **ground polygon이 없는 배경(legacy zone-grid 모드)에만** 적용된다. image-ground(default)는 §2.1a를 따른다. 아래 zone-grid 규칙은 하위호환·placeholder parity를 위해 보존한다.

각 `windowIndex`를 **고정 logical 치수의 zone 하나**로 만들고, zone들을 grid로 이어붙여 **큰 논리 월드**를 구성한다([[SPEC-201-dashboard-screens]] §2.3 "window=lane" 의미를 공간으로 보존). 뷰포트는 이 월드를 **스크롤/팬**한다(§2.7). 이는 구 모델의 "play-field 안에 zone을 욱여넣어 sprite를 축소"를 대체한다(F2 재결정 — 원본 크기 sprite 우선).

**분할 규칙(확정 구조, 상수는 가설)**:

1. `Z` = camp 내 distinct `windowIndex` 수(≥1). `windows` = `windowIndex` 오름차순 distinct 배열.
2. **zone 치수는 고정**: `ZONE_W × ZONE_H`(가설 `ZONE_W=1100`, `ZONE_H=820` logical px) — §2.1 full-size sprite(≈209px) 기준 7 station + fan-out을 비-중첩 수용하도록 산정한 값이며 동시에 `MIN_ZONE` 하한이다. zone은 `cols × rows` grid: `cols = min(Z, ZONE_COLS_MAX)`(가설 `ZONE_COLS_MAX=2`), `rows = ceil(Z / cols)`.
   > **NOTE (vertical-first growth, #41)**: `ZONE_COLS_MAX`를 `2`로 잡아 다-window camp의 월드가 **가로로 넓어지기보다 아래로 길어지게**(주로 세로 스크롤) 한다. single-window camp은 `cols=1`이라 1760px panel(1200px zone + 340px inspector)에 그대로 들어가 변화가 없다. 가로 스크롤은 2-zone 폭(`2·ZONE_W+ZONE_GUTTER`)으로 제한된다.
3. zone은 `windows` 오름차순 **row-major**(좌→우, 상→하) 배치. `zoneIndexOf(windowIndex)` = `windows` rank(0-based). grid 위치 `c = zoneIndex mod cols`, `r = floor(zoneIndex / cols)`.
4. `zoneRect = { x: c*(ZONE_W+ZONE_GUTTER), y: r*(ZONE_H+ZONE_GUTTER), w: ZONE_W, h: ZONE_H }`. `ZONE_GUTTER` 가설 `48` logical px.
5. **월드 치수**: `world = { w: cols*ZONE_W + (cols-1)*ZONE_GUTTER, h: rows*ZONE_H + (rows-1)*ZONE_GUTTER }`. 월드는 보통 뷰포트보다 크며 뷰포트가 그 위를 스크롤/팬한다(§2.7).
6. **zone header**: 각 zone 상단-중앙에 `command-tent` + `banner-pole`(manifest `objects/props`) prop과 plain-text label **"window {windowIndex}"**. header는 ground layer(낮은 z)로 sprite/label을 가리지 않는다.

- `zoneRect`·`world`는 `(windows, 상수)`의 결정적 함수다(같은 window 집합 → 같은 좌표).
- **inner rect**(station 배치 영역) = `zoneRect`를 `ZONE_PAD`(가설 `48px`)로 inset하고 상단 `ZONE_HEADER_H`(가설 `64px`)를 header에 양보한 사각형.
- **degenerate 없음·스크롤이 normal 모델(확정, F10 일반화)**: zone은 **항상 고정 `ZONE_W×ZONE_H`(=MIN_ZONE)**이므로 window 수와 무관하게 inner rect가 절대 degenerate하지 않는다. window/orc가 많으면 **월드가 커지고 뷰포트가 스크롤**로 탐색한다(가로는 `cols ≤ ZONE_COLS_MAX`로 묶어 주로 세로 스크롤; 구 "다-window 세로 스크롤 fallback"이 이제 **상시 normal 모델**). 스크롤·팬은 layout shift가 아니며 데이터 refresh가 scroll 위치를 바꾸지 않는다(§3.2).

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
3. **반경/각도**: `radius(k) = min(k * RING_STEP, R_MAX)`. **`RING_STEP`은 scaled sprite footprint 기준으로 정의한다**: `RING_STEP = RING_CLEARANCE * (REF_FRAME_MAX * mapSpriteScale)`(가설 `RING_CLEARANCE=1.15`; `REF_FRAME_MAX`는 §2.1의 character-independent 상수 — slot 좌표가 `agentType`에 의존하지 않도록) → ring이 §2.1 full-size scaled sprite를 비-중첩으로 둘러싼다(고정 zone inner rect 안, §4 AC-14). `R_MAX` = inner rect로 클램프되는 상한. 각도 `θ = θ0 + (m / cap(k)) * 2π`, `θ0 = -π/2`(상단 시작) + ring별 half-step offset(방사 정렬 방지). `slotOffset = (radius*cosθ, radius*sinθ)`.
4. **overflow(확정 동작, 임계 가설)**: `SLOT_SOFT_MAX`(가설 `12`/station) 초과 시 ring을 계속 늘리되 `radius`가 `R_MAX`에 닿으면 외곽 ring에 **각도 밀집(controlled overlap)**으로 쌓고 `paneId` 오름차순 back-to-front로 그린다. **orc를 숨기지 않는다**(read-only 관측성: 모든 orc 표시). sprite를 frame_size 종횡비 미만으로 비-균일 축소하지 않는다(layout 불변, §2.7; 균일 스케일은 §2.1 `mapSpriteScale`만).
5. **`terminated` 1-D edge stack(확정, F9)**: `terminated` orc는 ring이 아니라 **zone 가장자리(기본 우측 edge)를 따라 1차원으로 stack**한다. `slotRank`(paneId asc) 순으로 edge 위 시작점에서 `STACK_PITCH = STACK_CLEARANCE * (REF_FRAME_MAX * mapSpriteScale)`(가설 `STACK_CLEARANCE=1.05`; §2.1 character-independent 상수) 간격으로 배치하며, edge 길이를 넘으면 안쪽으로 한 칸 들여 다음 줄로 이어간다(corner를 ring으로 넘치게 하지 않음). 정적 배치이므로 roaming하지 않는다(§3.1-5).

- `slotOffset`은 `slotRank`의 결정적 함수이고 `slotRank`는 동일-(zone,status) peer `paneId` 집합의 결정적 함수다. 따라서 같은 입력 → 같은 offset.
- peer 집합이 바뀌면(같은 station에 orc가 합류/이탈) slotRank가 재계산될 수 있다(고유한 군집 변화). 그 전이는 §3.1 roaming이 매끄럽게 처리한다. **단 `tmuxTarget` reindex만으로는 slotRank가 바뀌지 않는다**(INV-2, §4 AC-03).

#### 2.4b personal-space bubble grid (#51, live map home)

> **배경**: #50에서 active orc를 random `patrolCenter`로 흩뿌리며 **겹침**이 생겼다. #51은 이를 **결정적 그리드**로 대체해 "map 전반 분산"과 "캐릭터 간 비겹침"을 **동시에** 만족한다. (이는 live 맵의 home을 §2.3 station/§2.4 slot에서 **그리드 cell로 대체**한다 — status 공간 인코딩은 상시 label/overlay(§2.6)로 유지. §2.3–§2.5의 순수 layout 함수 자체는 placeholder/keyboard 그룹핑용으로 보존.)

- **그리드(`computeCells(area, count)`, 순수)**: walkable 영역(image-ground = safe area 전체; zone-grid = zone별 inner rect)을 orc 수만큼 **near-square cell**로 row-major 분할한다. orc[i](읽기 순서 = windowIndex/paneIndex asc)는 cell[i]를 소유한다.
- **home + bound = cell**: orc의 controller target = cell **center**, patrol/rest clamp **bound = cell rect**다. §3.1-10 patrol/rest는 `PATROL_MARGIN`(= half-footprint)로 cell 안에 clamp되므로 **sprite box가 자기 cell을 벗어나지 않고 → 인접 orc와 겹치지 않는다**(목표: "일정 거리 버블 + 비겹침"). cell ≥ footprint면 여유 있게 비겹침, 과밀 camp는 cell이 작아지며 best-effort(센터는 여전히 분산).
- **불변식**: 순수·결정적(`Math.random`/`Date.now` 금지), `renderedPos`-only 효과는 §3.1-10이 담당(zero layout shift). 멤버십/수 변화 시 cell 재배치는 §3.1 roaming이 매끄럽게 walk-over로 처리한다.

### 2.5 target position (순수 함수)

```ts
// (A) image-ground (default, §2.1a): world = 배경 이미지, target = station anchor in safeArea
//     + ground-scaled slot fan-out, clamped to safeArea. peers는 STATUS로 키.
function groundTargetPosition(orc: OrcMapInput, ctx: CampLayoutContext, g: GroundContext): Vec2 {
  const inner = g.safeArea;                                       // walkable 내접 rect
  const S     = stationAnchor(orc.status, inner);                 // §2.3
  const rank  = slotRank(orc.paneId, ctx.peersOf(orc));          // peers = 동일 STATUS paneIds
  const raw   = slotOffset(rank, GROUND_REF_INNER);              // 순수 ring math (큰 ref rect)
  const off   = { x: raw.x * GROUND_PITCH_FACTOR, y: raw.y * GROUND_PITCH_FACTOR }; // ground footprint로 스케일
  return clampToRect(add(S, off), inner, GROUND_MARGIN);         // sprite body 전체가 안에
}

// (B) zone-grid (legacy/fallback, §2.2~2.4)
function targetPosition(orc: OrcMapInput, ctx: CampLayoutContext, dims: MapDims): Vec2 {
  const zr      = zoneRect(orc.windowIndex, ctx.windows, dims);   // §2.2
  const inner   = innerRect(zr);                                  // §2.2
  const S       = stationAnchor(orc.status, inner);               // §2.3
  const rank    = slotRank(orc.paneId, ctx.peersOf(orc));         // §2.4 (동일 (zone,status) peer paneIds)
  return add(S, slotOffset(rank, inner));                         // §2.4
}
// CampLayoutContext = { windows: number[] /*오름차순 distinct windowIndex*/,
//   peersOf(orc): string[] /* image-ground=동일 STATUS / zone-grid=동일 (zone,status) paneId 집합 */ }
```

- **순수성/결정성(확정)**: image-ground는 `(orc, status-peers, ground)`, zone-grid는 `(orc, ctx, dims)`에 대해 항상 동일 좌표를 산출한다. §4 AC-12(zone-grid)·AC-22(image-ground)로 검증한다.
- **입력 한정(INV-1)**: 두 함수 모두 읽는 orc 필드는 `windowIndex`·`status`·`paneId`뿐이다(+ground/zone 상수·peer paneId). 좌표는 어디서도 데이터로 **수신되지 않는다**. (image-ground는 placement에 `windowIndex`를 직접 쓰지 않지만 `target.zoneIndex`로 window rank를 추적해 keyboard 그룹을 보존한다 — §2.1a-4.)

### 2.6 activity 표시 (speech bubble + 상시 label/overlay)

| 요소 | 트리거 | 내용 | 가림 금지 |
| --- | --- | --- | --- |
| **status label** (plain text) | **항상** | `OrcStatus` 영문 label([[SPEC-202-design-accessibility]] §2.2) | sprite 머리 위, 최상위 z |
| **status overlay icon** | **항상** | `objects/status-ui` 아이콘([[SPEC-300-asset-rendering]] §2.3c) | label을 가리지 않음(§2.3-1) |
| **raw target label** | **항상**(R-UI-007) | `tmuxTarget` | A7: 은유가 가리지 않음 |
| **activity speech bubble** | **hover/focus/select 시에만** | `currentWorkSummary` + `summarySource` + `summaryIsEstimated`면 estimated 마커(`~`/`est.`) | bubble가 status label·target을 가리지 않음 |
| **ambient speech bubble(#50/#52)** | **간헐적 자동**(seeded schedule) | **WoW풍 orcish 어휘(`scene/orcish.ts`) + preview/summary 단어의 랜덤 조합**(`buildSpeechPool`→`speechAt`). `active` orc는 더 긴(≈2–3줄) 발화 | hover bubble에 양보, label·target 비가림, `aria-hidden` |

규칙(확정):

1. **항상 표시(label+overlay+target)**: status label·overlay·raw `tmuxTarget`은 **모든 orc에 상시** 표시한다(공간 은유가 상태/식별을 숨기지 않음 — [[SPEC-202-design-accessibility]] A7, R-UI-007). 색 단독 금지.
2. **bubble는 on-demand**: speech bubble은 hover/focus/select에서만 띄운다(100-pane 혼잡 방지). bubble 위치는 sprite 상단/측면이며 status label·target label을 가리지 않게 배치한다.
3. **단정 금지(R-ORC-005, INV-4)**: bubble의 summary는 `summaryIsEstimated=true`면 estimated 마커를 동반하고 `summarySource`를 표기한다. `currentWorkSummary==null`이면 "no summary"로 표시한다(합성 금지).

#### 2.6b ambient speech bubble (#50, 기본 ON·sparse)

- **목적/내용**: "살아있는 camp" 분위기로 orc가 **간헐적으로** 말풍선을 띄운다. 내용은 **WoW풍 orcish 어휘(`scene/orcish.ts`)를 그 orc의 preview/summary 단어 랜덤 조합에 섞은** 구 — `[opener] 작업단어… [closer]` 형태(opener=인사/긍정 "Zug zug"·"Lok'tar", closer=전투구호 "Lok'tar ogar!"·"Gol'Kosh!", 사이사이 grunt filler). orcish 어휘는 **단어 단위 library**(opener/closer/filler/chatter 그룹)로 보관한다. 작업 단어 풀은 `buildSpeechPool(currentWorkSummary, preview.text, command, cwd)`로 토큰화·dedupe·상한(가설 ≤24어)하며, 쓸 단어가 없으면 pure-orcish chatter fallback으로 대체(기능 가시성 보장).
- **`active` orc = 작업하며 수다(#52)**: `active` 상태 orc는 더 긴 발화(작업 단어 `[SPEECH_WORDS_ACTIVE_MIN, SPEECH_WORDS_ACTIVE_MAX]` 가설 `[4,7]`개 + **항상** opener·closer + grunt filler)를 띄워 말풍선이 **≈2–3줄**을 채운다(`oc-bubble--speech-multiline`, CSS `line-clamp: 3`). 그 외 status는 짧게(1–3 단어, opener/closer 간헐) 유지된다. **스케줄(주기/위상/표시시간)은 `active` 여부와 무관하게 동일** — 길이만 달라진다.
- **스케줄(순수·결정적)**: `speechAt(orcId, t, pool, active?)` = `(orcId, 공유 clock t, active)`의 순수 함수. orc별 seeded **주기**(`[SPEECH_PERIOD_MIN_MS, SPEECH_PERIOD_MAX_MS]` 가설 `[9s,18s]`) + seeded 위상에서 각 주기 시작 후 `SPEECH_DUR_MS`(가설 `3.2s`) 동안만 표시하고, 발화 문장은 주기 index로 re-roll한다. `Math.random`/`Date.now` 금지(단일 공유 clock으로 구동, 비-load-bearing). off-screen sprite는 §3.3-3 tick 게이트로 발화 계산도 건너뛴다.
- **불변식/게이팅**: ambient bubble은 **hover/focus/select 시 detailed activity bubble(§2.6-2)에 양보**(동시 표시 안 함)하고, status label·raw target을 가리지 않으며 `aria-hidden`(상시 정보 아님 → SR 스팸 방지). **reduced-motion에서 비활성**(no autoplay, [[SPEC-202-design-accessibility]] AC-11)이고 `terminated` orc는 발화하지 않는다(풀 empty). `renderedPos`/layout 불변(zero layout shift).

#### 2.6c selection marker + 빈 공간 클릭 해제 (#51)

- **selection marker(게임형)**: 선택된 orc는 **파란 사각형 테두리가 아니라** pixel-art **ground ring**(manifest `ui.selection_markers['selected-orc']` = pixellab asset)을 발(ground anchor) 아래에 footprint 크기로 깐다(orc가 ring 안에 선다). asset 미탑재/로드 실패 시 **CSS corner-bracket reticle**로 parity fallback한다(파란 박스로 회귀하지 않음). marker는 sprite **아래** z(ground decoration), `pointer-events:none`, sprite box 불변(zero layout shift), subtle pulse(reduced-motion에서 정지).
- **빈 공간 클릭 해제**: 맵 **빈 공간 클릭** 시 선택을 해제한다(`?orc=` 제거 → [[SPEC-200-routing-data]] §2.2 URL이 SSOT). orc/컨트롤 클릭(선택)과 **drag-pan 직후의 trailing click**(#42)은 해제하지 않는다(`suppressClick` 가드). 키보드 선택/포커스(§2.7 AC-09)는 영향 없음.

### 2.7 맵 render contract

- **매체(확정): DOM 기본 / canvas P2 escape hatch**. 맵은 **DOM 절대 위치 sprite**를 background 위에 합성하는 것을 기본으로 한다. 성능 예산(§3.3)을 규모에서 못 맞추면 canvas/WebGL 렌더 레이어를 **P2 대체 경로**로 둔다(동일 `SpriteRenderState`([[SPEC-300-asset-rendering]] §2.4) + §2.5 position 계약 뒤에서 교체, 단 keyboard/selection/a11y는 DOM overlay로 보존). 이는 **[[SPEC-201-dashboard-screens]] Q4(DOM vs canvas scene)**를 **DOM=기본, canvas=P2**로 해소한다([[SPEC-300-asset-rendering]] Q4는 roaming 진입 질문으로 §3.1에서 별도 해소됨 — 혼동 금지).
- **scene 배치 supersede(확정, F3)**: camp detail **scene 배치**(좌표·정렬)는 본 spec(§2.2~2.5)이 소유하며, **[[SPEC-201-dashboard-screens]] SPEC-201-AC-03의 "paneIndex 오름차순 lane slot 배치" 진술을 scene 컨텍스트에서 supersede**한다. SPEC-201의 `paneIndex` 오름차순 정렬은 list/table 등 비-scene 표시에 한정되도록 재범위화됐다(SPEC-201 §2.3·AC-03 개정). window grouping·selection·비-orc pane·layout 안정성은 SPEC-201이 계속 소유한다.
- **world = 배경 이미지 2× 확대(image-ground, default·확정·구현)**: world = `MapDims.world` = 배경 `logical_size`(= `native_size × world_scale` = 2× native, 예 `3344×1882`). native PNG(예 1672×941)는 `image-rendering: pixelated`로 2× 업스케일돼 world 전체를 full-cover로 채운다. world는 **고정 스케일(`BASE_SCALE=1`, transform/zoom 없음)**로 렌더되어 sprite가 원본 크기(`frame_size × 0.9`)로 보인다. **뷰포트는 world보다 작아** `overflow: auto` + **drag-pan으로만** 탐색하며(전체를 한 번에 보지 않음), **첫 mount 시 뷰포트를 walkable ground 중심(`safeArea` center)으로 센터링**한다(`CampMap` center-on-mount). zoom은 없다(아래 NOTE).
- **스크롤/팬 뷰포트 + 큰 논리 월드(legacy zone-grid — 원본-크기 sprite를 위한 구조)**: ground polygon이 없는 배경에서는 `MapDims.world`가 §2.2 zone grid 합이 되고, 화면상 고정 크기 **뷰포트**(panel)가 그 **큰 월드**를 `overflow: auto`(또는 pan transform)로 **스크롤/팬**한다. world 내부의 sprite·station·label은 world logical 좌표에 절대 배치되고, world는 고정 base 스케일로 렌더돼 sprite는 `frame_size × mapSpriteScale`(≈원본)로 크게 보인다. 작은 camp은 월드가 뷰포트에 다 들어와 스크롤이 없고, 큰 camp만 스크롤된다. **두 모델 공통**: world 레이아웃은 안정적이라 sprite/status/roaming/hover/select 변화·데이터 refresh가 **scroll 위치를 바꾸지 않고 인접 reflow를 만들지 않는다**(zero layout shift, §3.2). 뷰포트 리사이즈는 보이는 영역만 바꾸고 world 내 상대 위치는 불변이다.
  - **NOTE (drag-to-pan only — no zoom, #42 갱신·확정·구현)**: 뷰포트 탐색은 native scroll + **drag-to-pan**(맵 배경 위 pointer/touch drag → `scrollLeft/Top` 갱신; orc/버튼 클릭은 가로채지 않게 `DRAG_THRESHOLD`, touch는 native momentum scroll)뿐이다. **zoom in/out/fit은 미지원**(superseded): world는 고정 `world_scale=2`·`BASE_SCALE` 스케일로만 렌더되고 `scale(s)` transform·zoom state·zoom/Fit 버튼이 없다(`CampMap`에서 제거). focus-scroll-into-view(focus된 orc로 스크롤)는 보존되며 reduced-motion에서 pan은 즉시 적용된다([[SPEC-202-design-accessibility]] AC-11). `panzoom.ts`의 순수 pan 헬퍼는 유지된다(zoom 헬퍼 미사용).
- **sprite box(확정)**: 각 sprite는 해당 character의 manifest `frame_size`(232/228 등)에 **§2.1 `mapSpriteScale`을 곱한** logical box(= `frame_size × mapSpriteScale`, 종횡비 보존)이며, scaled anchor(`anchor × mapSpriteScale`)가 rendered ground 위치에 정렬된다. `mapSpriteScale`은 asset·placeholder에 동일 적용된다(§3.2, AC-08). `image-rendering: pixelated`.
- **z 레이어(확정, back→front)**: ① **배경 이미지 ground**(full-cover, image-ground = world 전체; [[SPEC-300-asset-rendering]] §2.6b; 없으면 CSS gradient ground) → ② (legacy zone-grid 한정) ground decor/scenery(결정적 산재, `pointer-events:none`, §2.8c) → ③ (legacy 한정) zone header + station prop → ④ per-sprite ground shadow([[SPEC-300-asset-rendering]] §2.6e, §2.8e) → ④′ **epic monster sprite**(비-상호작용 ambient NPC; MVP는 orc sprite 뒤, `pointer-events:none`; [[SPEC-303-epic-monster-npc]] §3.9) → ⑤ terminated edge sprite → ⑥ active sprite(ground y, 동률 시 `paneId` asc 정렬) → ⑦ dusk lighting/ambient/vignette overlay(§2.8d, `pointer-events:none`) → ⑧ status overlay icon → ⑨ status label + raw target label → ⑩ selection/hover marker(`ui/selection-markers`) → ⑪ activity speech bubble. **superseded**: 구 ① sky/backdrop+parallax·② corner-Wang terrain 레이어는 image-ground 단일 배경 이미지로 대체됐다(§2.8a/b supersede).
  - **epic monster(④′, 비-load-bearing)**: 배경별 ambient 보스 몬스터 1마리는 별도 비-상호작용 레이어로 그려진다. 자기 ground shadow(④)를 받고, **항상 status overlay/label/raw target/selection marker/bubble(⑧–⑪) 아래**·`pointer-events:none`이라 어떤 orc의 상태/식별 텍스트·선택도 가리거나 가로채지 않는다(A7/R4). 거동·배치는 [[SPEC-303-epic-monster-npc]] 소유(본 spec은 z 위치만 고정).
  - **불변(확정·INV-4/A7)**: 배경/decor/shadow/lighting 레이어는 **항상 status overlay·status label·raw `tmuxTarget`(⑧⑨) 아래**다 → 어떤 배경/장식 레이어도 status/식별 텍스트를 가리지 않는다([[SPEC-202-design-accessibility]] A7·R4). decor·shadow·lighting은 `pointer-events:none`이라 selection/hover/keyboard를 가로채지 않는다.
- **selection(참조 SPEC-201/200)**: sprite click / `Enter` / `Space` → `?orc=<orcId>` 설정해 inspector를 연다. selection 키는 `orcId`(reindex 불변, INV-2). control 진입점은 inspector(SPEC-201) → flow는 [[SPEC-400-control-actions]].
- **공유 애니메이션 clock(확정, F1 — phase는 state-entry에 anchor)**: 모든 sprite의 frame 진행·보간은 **단일 공유 시계**(하나의 `requestAnimationFrame` 루프, 전역 시간 `t`)에서 파생한다. per-sprite `setInterval`/타이머·per-sprite RAF는 **0건**(성능). 단 frame index는 un-anchored 전역 `t`가 아니라 **각 sprite의 state-entry 시각 `tEnter`에 anchor**한다: `frame = floor((t − tEnter) * fps) mod frames`([[SPEC-300-asset-rendering]] `fps`/`frames`). `tEnter`는 그 sprite가 현재 animation state로 전이한 시각(공유 clock 값)이다.
  - 이로써 [[SPEC-300-asset-rendering]] **§3.3-2(전이 시 frame 0부터 재생 / 같은 state 유지 시 위상 보존)**를 **위반하지 않는다**: state 전이 시 `tEnter`를 갱신해 새 state가 frame 0에서 시작하고, state가 유지되면 `tEnter` 불변이라 위상이 보존된다(매 snapshot frame 0 리셋 없음).
  - 보간(roaming) 진행도 동일 clock의 `(t − tweenStart)`로 계산한다(§3.1). 이 모델은 SPEC-300 §3.3의 재생 규칙을 **준수(respect)**하는 구현 메커니즘이며, "단일 clock으로 SPEC-300 §3.3를 대체·충족한다"는 의미가 아니다(소유는 SPEC-300).
- **keyboard(참조 SPEC-202 값)**: 각 zone = **하나의 roving-tabindex 그룹**(zone당 single tab stop). `Tab`/`Shift+Tab`은 zone 간(및 dock control 간, [[SPEC-202-design-accessibility]] K1) 이동, Arrow는 focus된 zone 내부 orc 간 이동(결정적 순서: ground 위치 row-major, 동률 시 slotRank), `Enter`/`Space`로 선택. 이는 [[SPEC-202-design-accessibility]] K2(orc layer roving tabindex)를 **zone 단위로 구체화**한다(§6 coordination note).
- **reduced-motion(참조 SPEC-202/300)**: `prefers-reduced-motion: reduce`면 rendered pos를 target으로 즉시 snap하고 정적 frame([[SPEC-300-asset-rendering]] `reduced_motion.fallback_frame`)을 표시하며, walk-cycle·autoplay·ambient wander를 시작하지 않는다(§3.1-7).

### 2.8 scene depth toolkit + ground-ratio 게이트 (background·scenery·lighting·shadow·ground gate)

맵 scene의 배치/좌표 계약. asset resolve·이미지 fit·CSS shadow shape 등 **렌더 메커니즘은 [[SPEC-300-asset-rendering]] §2.5/§2.6**가 소유하고, 본 절은 **무엇이 어디에 놓이는지**(world 좌표·결정적 scatter·z·lighting)와 **신규 배경 등록 게이트**를 소유한다. 모든 산출은 INV-1(client-derived, **서버 좌표 불추가·런타임 무작위 금지**)을 따른다.

> **SUPERSEDED(확정, 2026-06-29)**: 구 (a) backdrop horizon+parallax·(b) corner-Wang terrain field는 **image-ground 단일 배경 이미지**로 대체됐다([[SPEC-300-asset-rendering]] §2.5/§2.6 supersede). 아래 (a)/(b)는 legacy 기록으로만 보존한다. (c) decor scatter는 **legacy zone-grid fallback에만** 적용된다(image-ground는 CSS decor 미렌더). (d) lighting·(e) shadow는 두 모델 공통으로 유지된다.

**(a) background image(확정·구현, 구 backdrop+parallax는 superseded)**: image-ground는 단일 배경 이미지가 z-stack 최후면(§2.7 ①)이며 world 전체를 full-cover로 덮는다(= world = 2× native, native PNG는 `image-rendering: pixelated`로 2× 업스케일). `parallax=0`이므로 뷰포트 스크롤/drag-pan에서 배경은 world와 동률로 움직인다(별도 시차 변환 없음). 구 horizon+parallax(`P=0.3`, transform translate) 모델은 폐기됐다.

**(b) 결정적 terrain field — SUPERSEDED(legacy 기록)**: 구 `terrainAt(cornerX, cornerY) → terrainIndex`(moss/dirt corner field) 자동 타일링은 단일 배경 이미지로 대체됐다(런타임 미사용). 지면은 배경 이미지(또는 CSS gradient fallback)이다.

**(c) 결정적 scenery scatter(확정 — legacy zone-grid fallback 한정)**:

1. `decorPlacements(zoneRect, ctx) → DecorInstance[]`는 zone별 **결정적** scenery 목록을 산출한다. seed = `zoneIndex`(+layout 상수). `scene.decor.items`의 `weight`로 가중 선택하고 위치는 seeded hash로 정한다(**no `Math.random`·no wall-clock**). **image-ground 모드에서는 CSS decor 레이어를 렌더하지 않으므로**(배경 이미지가 scenery 보유) 본 항목은 zone-grid fallback에 한정 적용된다.
2. **배치 제약(확정)**: decor는 (i) station 앵커·slot ring 영역, (ii) zone header 영역, (iii) label/bubble 예상 영역을 **회피**해 배치한다(겹침 시 해당 instance drop). decor는 z상 sprite/label 아래(§2.7 ②)이고 **`pointer-events:none`**이라 selection/hover/keyboard를 가로채지 않는다(§2.7 불변).
3. **개수 budget(가설)**: zone당 decor ≤ `DECOR_MAX`(가설 `6`), category(ground/tall/light-source/boundary)별 상한도 가설 — 100-pane 성능(§3.3) 보호.
4. **결정성(확정)**: 동일 `(zoneRect, ctx)` → 동일 placement 집합.

**(d) dusk lighting/ambient(확정 구조, 값 가설)**:

1. world 위 단일 **lighting overlay**(CSS radial/linear gradient vignette + ambient tint)를 §2.7 ⑦(sprite 위, status overlay/label 아래)에 둔다. **tokens-only**([[SPEC-202-design-accessibility]] §2.1, raw hex 금지), `pointer-events:none`.
2. **label 가독성 보존(확정)**: lighting은 status overlay/label/raw target(⑧⑨)보다 **낮은 z**라 이들을 어둡게 만들지 않는다. vignette/ambient 강도는 [[SPEC-202-design-accessibility]] C1/C2 대비를 깨지 않는 선(가설, QA 보정).
3. **reduced-motion(확정)**: lighting은 정적(맥동/플리커 애니메이션 금지). brazier 등 `light-source` decor의 애니메이션도 reduce에서 정지(§3.5-4).

**(e) per-sprite ground shadow placement(확정)**:

1. 각 sprite 아래(§2.7 ④, sprite보다 낮은 z)에 ground shadow를 둔다. 위치 = sprite의 scaled ground anchor(`anchor × spriteScale`) 지점에 **중심**을 둔다 — anchor는 실제 발 content 최하단([[SPEC-300-asset-rendering]] §2.5)이라 그림자가 발에 밀착한다(과거 anchor가 빈 패딩에 있어 그림자가 발 아래 ~30px에 떠 보이던 버그 수정). 크기 = footprint(`frame_size × spriteScale`)에 `scene.shadow.css.footprint_ratio`(=0.46) 적용한 **납작한 타원**(높이 = 너비 × 0.3)이며 image-ground=`GROUND_SPRITE_SCALE`/zone-grid=`MAP_SPRITE_SCALE`. shape/asset resolve는 [[SPEC-300-asset-rendering]] §2.6e.
2. shadow는 layout box를 만들지 않는다(절대 위치 장식, zero layout shift). placeholder sprite도 shadow를 받는다(§3.4 parity).
3. terminated edge sprite도 **정적** shadow를 받는다(roaming 없이 정적, [[SPEC-300-asset-rendering]] §3.3).

**(f) ground-ratio 등록 게이트(확정·구현 — 신규 배경 등록 규칙)**:

신규 배경을 image-ground로 등록하려면 walkable ground가 default 배경보다 좁아선 안 된다(미래 camp이 default보다 활동영역이 부족하지 않도록). `web/src/scene/ground.ts`가 소유한다.

1. **참조 하한**: `REFERENCE_GROUND_RATIO = 0.281`(default `orccamp-default`의 측정 ratio 0.2815의 바닥값 — 참조 배경이 자기 게이트를 통과하도록 바로 아래로 설정).
2. **게이트**: `meetsGroundRatio(polygon, world) = groundRatio(polygon, world) ≥ REFERENCE_GROUND_RATIO`. 미달이면 **reject + 사유**(`ground_ratio <측정값> < reference 0.281`). 등록 가능한 배경만 image-ground로 쓴다.
   - **예외(확정)**: 게이트 미달 배경이라도 **명문화된 사용자 승인 예외**로 등록할 수 있다. 예외는 manifest `backgrounds.<key>.ground.gate`에 `pass:false` + `exception:true` + `accepted:"<근거/일시>"`로 박제한다. 예외 배경은 정직한 측정값(polygon/area/ratio)을 그대로 두고(위조 금지), 단지 등록을 허용한다 — 런타임은 게이트를 강제하지 않으며 orc는 `safe_area`에 clamp되어 정상 동작한다. 예외 1호: **`necropolis-camp`**(ratio 0.2191 < 0.2815, gothic courtyard가 4면 구조물로 둘러싸여 default보다 작음; 2026-06-29 사용자 승인). 예외는 "활동영역이 default보다 작아도 됨"을 user가 명시 수용한 경우에만 부여한다(기본은 reject).
3. **ratio는 polygon에서 재계산(SSOT)**: `groundRatio = shoelaceArea(polygon) / (world.w × world.h)`. manifest에 stored된 `ground.area`/`ratio`는 **신뢰하지 않고** polygon에서 재계산한다(위조·드리프트 방지). `shoelaceArea`는 polygon 정점의 절대 면적이다. 예외 배경도 stored 값은 정직한 측정값이어야 한다(`gate.exception`이 reject를 면제할 뿐 측정값을 바꾸지 않는다).
4. **scale 불변(확정)**: ratio는 `world_scale`에 **불변**이다 — polygon area와 world area가 같은 배율²로 함께 커지므로 비율은 일정하다(default: 1× area 442975/(1672·941) = 2× area 1771900/(3344·1882) = **0.2815**). 따라서 2× world 도입(변경 1) 후에도 게이트 결과는 동일하다(`0.2815 ≥ 0.281`).
5. **결정성(확정)**: 순수 함수(`Date.now`/`Math.random` 없음). 동일 polygon·world → 동일 ratio·동일 게이트 결과.
6. **owner**: 신규 배경의 ground polygon 산정·placement·게이트 통과 검증은 `scene-placement-engineer`가 소유한다(`.claude/agents/scene-placement-engineer.md`).

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
9. **idle ambient micro-wander(P1, 기본 ON·subtle, #43)**: idle이며 도착 상태인 sprite가 station 주변 반경 `WANDER_R`(가설 `≈8–14` logical px, **subtle**) 내에서 느린(slow `WANDER_FREQ`) 작은 표류를 갖는 ambient 효과로 "살아있는 camp" 분위기를 준다. **기본 ON**(CampMap이 `RoamingController({ambientWander:true})`로 구성)이되 다음을 **항상** 지킨다: 결정적(`paneId`+공유 clock seed, `Math.random`/`Date.now` 금지), idle+arrived에만, **reduced-motion에서 비활성**, `renderedPos`에만 작용하는 **순수 jitter**(target/slot/layout 불변 → zero layout shift). 따라서 §2.5 target·§2.4 slot·§4 core AC 결과를 바꾸지 않는다(비-load-bearing). reduced-motion 경로에서는 §2.7·§3.1-7대로 시작하지 않는다.
10. **active patrol loop + non-active 랜덤 rest(P1, 기본 ON·#49)**: 도착 후 동작을 status로 분기한다.
    - **active = 순찰 루프**: active orc는 station home에 그냥 서 있지 않고 `dwell(active anim) → roam(walk-cycle) → dwell → …`를 무한 반복한다. 루프는 **도착 시각 `arrivalT`에 앵커**되고 waypoint 0 = home이라 orc는 먼저 자기 자리로 **걸어간 뒤** 순찰을 시작한다(순간이동 없음). leg/dwell **지속시간**과 waypoint **각도·반경**(반경 `[PATROL_R_MIN, PATROL_R_MAX]` 가설 `≈[0.25,0.6]×SCALED_FOOTPRINT`)은 모두 `paneId` seed로 흐트러뜨려(`mix(paneHash, k)`) **fleet이 한 덩어리로 움직이지 않게** 동선을 randomize한다(목표: "모든 캐릭터가 함께 움직이지 않도록"). 순수 함수 `patrolAt(home, paneId, arrivalT, t)` — `Math.random`/`Date.now` 금지(INV-1).
      - **map 전반 분산 + 비겹침(#50→#51)**: 모든 orc의 **home은 §2.4b 그리드 cell의 center**다(active·non-active 공통). cell이 walkable 영역 전체에 깔리므로 orc가 **맵 전반에 분산**되고(목표: "patrol 시 좀 더 map 전반에 배치"), patrol/rest가 cell 안으로 clamp돼 **서로 겹치지 않는다**(§2.4b). (이는 #50의 random `patrolCenter`를 결정적 그리드로 대체해 spread와 non-overlap을 **동시에** 달성한다 — 더 이상 station-기반 배치가 아님. status는 상시 label/overlay로 전달, §2.6.)
      - **dwell 방향 randomize(#50)**: roam 후 dwell 시 active anim의 facing은 **남쪽 고정이 아니라 cycle별 seeded 8방향**(`DIRECTIONS[mix(seed,1000+n)]`)이다. [[SPEC-300-asset-rendering]] §3.2가 **arrived 상태에서도 요청 direction을 존중**하도록 확장돼(없으면 south fallback) 렌더된다(목표: "roam 후 active animation 이 random 방향").
    - **non-active = 랜덤 rest**: active가 아닌 orc는 자기 station 부근의 **seeded rest 좌표**(`restOffset(paneId)`, 반경 `REST_R` 가설 `≈0.4×SCALED_FOOTPRINT`)에서 대기한다. station이 status별로 공간 분리돼 있고 patrol/rest 반경이 station 간격보다 작게 묶이므로 **active 순찰 밴드와 겹치지 않는다**(목표: "active 캐릭터와 겹치지 않은 랜덤 위치에서 대기"). 대기 중에도 status 애니메이션(idle/waiting/…)은 계속 재생된다(목표: "active가 아닌 orc도 애니메이션 적용").
    - **공통 불변식**: patrol/rest는 `renderedPos`에만 작용하는 **순수 변위**(§2.5 target·§2.4 slot·§4 core AC 불변 → zero layout shift, 비-load-bearing)이고 walkable bound(zone inner rect / ground safe area)로 clamp하며, **reduced-motion에서 전부 비활성**(§3.1-7 snap). 기본 OFF인 controller(`RoamingController()`)에서는 active가 home에 그대로 정지(기존 AC-04 동작 보존)하므로 opt-in이다(CampMap이 `RoamingController({ambientWander:true, patrol:true})`로 구성).
11. **drag-and-drop 이동(#53, 기본 ON)**: 사용자가 orc를 **드래그 앤 드롭**해 맵 위 임의 위치로 옮길 수 있다.
    - **상호작용**: orc sprite(`<button>`) 위 pointer down→move가 `DRAG_START_PX`(가설 4px)를 넘으면 드래그로 전환된다(그 미만은 기존 tap=선택 유지). 드래그 중 sprite는 **포인터를 따라가고**(world는 `BASE_SCALE=1`이라 screen Δ = logical Δ), pointer up에서 **드롭**된다. 드롭 직후의 synthetic click은 억제돼 **드롭이 선택을 유발하지 않는다**. background drag-pan(§2.7 #42)은 orc(`<button>`)에서 시작하지 않으므로 충돌하지 않고, orc는 `touch-action:none`이라 터치도 스크롤 대신 드래그한다.
    - **드롭 후 동작(목표·확정)**: 드롭 위치는 walkable bound(ground safe area / zone inner rect)로 `PATROL_MARGIN` clamp돼 **활동영역 안에 안착**하고, 그 지점이 orc의 새 **home**이 된다. controller는 즉시 그 자리에 **snap**(walk-back 없음, `RoamingController.place()`)하고 그 orc를 **`pinned`**으로 표시한다. **pinned orc는 드롭 지점에 정확히 머물며 status 애니메이션만 제자리에서 재생**한다(active=active anim, waiting/idle=각 loop) — §3.1-9 wander·§3.1-10 patrol/rest **offset과 bound-clamp를 적용하지 않는다**. 이는 두 결함을 제거한다: ① 이전엔 `place()`가 **옛 cell bound**를 남겨 patrol/rest가 그 안으로 clamp돼 **드래그 전 위치로 복원**됐고, ② rest/patrol offset이 home 위에 더해져 **드롭 위치와 어긋났다**. (자동 배치 orc는 종전대로 cell 안에서 patrol/rest, §3.1-10.) 새 home은 client UI 상태(`ui.orcPositions[orcId]`)로 보관돼 **live 데이터 refresh를 가로질러 유지**되며(같은 home+`pinned`로 재-sync되므로 no-op), orc가 사라지면 prune된다.
    - **드래그 중 애니메이션(목표)**: 이동 중에는 status/walk-cycle이 아니라 **`idle` 애니메이션을, 드래그 시작 시점의 facing 방향으로** 출력한다(`resolveSprite`의 `dragging` 플래그가 state를 `idle`로 강제하고 방향을 고정; idle은 8방향 폴더 보유). reduced-motion에서는 §3.1-7대로 정지 프레임이되 이동(위치 추종) 자체는 사용자 동작이므로 허용된다.
    - **불변식**: 드래그는 사용자 의도 입력이므로 §3.1-9/-10의 결정적 ambient 효과와 달리 `ui.orcPositions`라는 **명시 상태**를 변경한다(여전히 `Math.random`/`Date.now` 미사용 — 위치는 포인터에서 옴). drop home은 §2.4b cell 대신 사용되며 patrol/rest는 walkable bound로 clamp된다. status 공간 인코딩은 상시 label/overlay(§2.6)로 유지되므로 사용자 재배치가 식별성을 해치지 않는다.
12. **epic monster ambient mover(forward — [[SPEC-303-epic-monster-npc]] 소유)**: orc와 별개로 배경별 **epic 보스 몬스터 1마리**가 동일 공유 clock 위에서 ambient roaming한다. **핵심 대비**: orc는 polygon 내접 rect(`safe_area`)에 clamp되지만(§2.1a-2), 몬스터는 **`ground.polygon` 전체**를 roaming하고(발자국 footprint만 polygon clamp), 도착 시 무작위(seeded) dwell anim({active,waiting,idle})을 재생하며, **orc footprint와 교차하면 `error`로 래치**된다. 몬스터는 **비-상호작용·비-load-bearing**(pointer/tab/selection 제외, orc 데이터 모델·`computeCells`/grid·zero-layout-shift 입력에서 제외, 자산 미가용 시 placeholder 없이 미렌더)이라 orc 배치를 교란하지 않는다. 결정적(`monster id + 공유 clock`, `Math.random`/`Date.now`/server 좌표 금지·INV-1)이고 reduced-motion에서 정지(idle/south). 세부 계약(controller·footprint·error debounce·z-order·feasibility)은 [[SPEC-303-epic-monster-npc]]가 소유한다(본 spec은 forward-pointer만).

### 3.2 zero layout shift (확정)

1. sprite는 fixed-aspect 컨테이너 안 **절대 위치**이므로 status·위치·roaming·hover/select 변화가 **인접 요소 reflow를 유발하지 않는다**(CLS 0). bubble는 overlay(absolute)로 떠서 layout을 밀지 않는다.
2. asset 토글(탑재↔미탑재)이 layout을 바꾸지 않는다: sprite box는 manifest `frame_size`로 고정([[SPEC-300-asset-rendering]] §3.6, [[SPEC-202-design-accessibility]] P2/AC-17), station/zone 좌표는 §3.4 placeholder에서도 동일.
3. 데이터 refresh(WS batch)로 scroll/layout이 튀지 않는다([[SPEC-201-dashboard-screens]] §3.6, [[SPEC-202-design-accessibility]] AC-12). 본 맵은 batch 적용 결과만 구독한다(batch 메커니즘은 SPEC-200/102 소유).

### 3.3 성능 예산 (가설, 20 session / 100 pane)

1. **목표(가설)**: 20 session / **100 pane(=100 sprite)**가 동시에 roaming하는 worst case에서, 공유 clock 렌더 루프가 frame time **≤ 16.7ms p95(≈60fps)**(허용 degrade 목표 ≥ 50fps)를 유지하고, **long task > 50ms 없음**, **CLS = 0**. 임계는 **success hypothesis**이며 측정으로 보정한다.
2. **측정 방법(참조)**: [[SPEC-007-test-validation]] §2.1 measurement(M) 계층 방법론 패턴(input·method·formula·threshold)을 FE 렌더 측정에 준용한다. FE 컴포넌트/렌더 측정 계층은 forward([[SPEC-900-traceability-rollup]] §0 layer C/M)이며, 본 예산은 [[SPEC-201-dashboard-screens]] AC-14(20/100 layout shift 없음)·[[SPEC-200-frontend-architecture]] 성능(정규화·windowing)과 정합한다.
3. **미달 시 완화(가설)**: (a) 뷰포트/가시 zone 안 sprite만 애니메이션, off-screen은 정적; (b) 공유 clock으로 frame 계산 분할; (c) canvas P2 경로(§2.7). 어느 경우든 keyboard/selection/a11y·zero layout shift는 보존한다.

### 3.4 placeholder parity (R-UI-006, [[08-Decisions|D-007]]) (확정)

asset(background image/props/sprite)이 없거나 일부 누락돼도 **동일 layout·interaction·a11y**가 동작한다. 배치 좌표(image-ground: world=상수 `logical_size`·`safeArea`·slot / zone-grid: zone/station/slot)는 asset과 무관하게 산출된다.

| 누락 대상 | 대체(확정) |
| --- | --- |
| background(ground) 이미지 | 단일 배경 이미지 full-cover([[SPEC-300-asset-rendering]] §2.6b) → 없으면 **CSS gradient ground**. world/`safeArea`(image-ground) 또는 world/zone(zone-grid) 좌표는 상수라 배치 불변 |
| ground decor/scenery (zone-grid fallback 한정) | prop sprite([[SPEC-300-asset-rendering]] §2.6c) → 일부 ref 누락 시 해당 instance만 생략(non-load-bearing). placement(§2.8c)는 asset 무관 → 불변. (image-ground는 CSS decor 미렌더) |
| per-sprite shadow | CSS 타원(항상 가능) 또는 asset([[SPEC-300-asset-rendering]] §2.6e) → 누락 개념 없음(CSS fallback 상시), depth cue 유지 |
| dusk lighting | CSS gradient/vignette overlay(asset 불요, tokens-only §2.8d) → 누락 개념 없음(항상 CSS) |
| station prop (zone-grid fallback 한정) | 동일 station 앵커에 **CSS marker**(작은 box + station/status glyph + label) → 위치=상태 정보 보존 |
| zone header prop (zone-grid fallback 한정) | CSS label "window {windowIndex}"만 렌더 |
| sprite | [[SPEC-300-asset-rendering]] L1/L2 placeholder(box = `frame_size × spriteScale`, asset과 동일 스케일 — image-ground는 `GROUND_SPRITE_SCALE`·zone-grid는 `MAP_SPRITE_SCALE`, 위치·interaction 불변) |
| status overlay | CSS glyph fallback([[SPEC-202-design-accessibility]] R1) |

> **superseded**: 구 terrain ground row(corner-Wang/flat-variant 타일링 + accent)·backdrop horizon+parallax row는 image-ground 전환으로 폐기됐다(§2.8 supersede). 지면 fallback은 이제 **배경 이미지 → CSS gradient** 2단계다.

규칙:

1. **배치 위치 불변**: image-ground placement(world=`logical_size`·`safeArea`·slot)와 zone-grid placement(zone/station/slot offset)는 manifest **이미지 asset과 무관하게** 상수·`Orc` 필드만으로 계산되므로 asset 누락이 배치를 바꾸지 않는다.
2. **status 구분 유지**: placeholder에서도 위치(station/ground slot) + label + overlay/CSS glyph로 7종 status가 grayscale-구분 가능하다([[SPEC-202-design-accessibility]] AC-16와 동치).
3. **interaction/a11y parity**: selection·hover·focus·keyboard·bubble·reduced-motion이 placeholder에서도 동일 동작한다([[SPEC-300-asset-rendering]] §3.6, [[SPEC-202-design-accessibility]] P1).
4. **no layout shift**: asset 유무 토글이 layout을 바꾸지 않는다(§3.2-2).

### 3.5 scene 레이어 런타임 규칙 (정적 페인트·성능·reduced-motion) (확정)

1. **정적 페인트(확정)**: 배경 이미지·decor·lighting·shadow는 **per-frame 애니메이션이 아니다**. 공유 clock 렌더 루프(§2.7)의 frame 작업(sprite frame·보간)에 포함되지 않으며, **뷰포트/스크롤(drag-pan) 변화 시에만** 다시 그린다. 즉 scene 레이어는 §3.3 100-pane sprite 애니메이션 budget에 비용을 더하지 않는다.
2. **배경은 단일 이미지(확정)**: image-ground 배경은 world 전체를 덮는 단일 이미지이며 parallax 변환이 없다(`parallax=0`). drag-pan은 `scrollLeft/Top` 갱신으로 layout/scroll 위치를 바꾸지 않는다(§3.2). 데이터 refresh가 scroll을 리셋하지 않는다.
3. **성능 친화 렌더(확정 지침)**: 배경은 단일 이미지, shadow는 CSS, lighting은 단일 overlay, decor(zone-grid fallback)는 zone당 `DECOR_MAX` 상한. canvas P2 경로(§2.7)는 이 정적 레이어를 단일 texture로 합성할 수 있다(keyboard/selection/a11y는 DOM overlay 보존).
4. **reduced-motion(확정)**: `prefers-reduced-motion: reduce`면 (a) decor 애니메이션(brazier flicker 등) off→정적, (b) lighting 맥동 off→정적. scene은 **정적으로 완전히 렌더**된다(입체감 유지, 모션만 제거). movement-off 경로와 정합(§1). (구 parallax off 규칙은 parallax 제거로 무효.)
5. **결정성·no server coords(확정)**: ground placement·decor scatter는 모두 결정적 함수이며 `Math.random`·wall-clock·서버 좌표를 쓰지 않는다(INV-1). 동일 world → 동일 scene.

## 4. Acceptance criteria

> 각 AC는 고정 `OrcMapInput[]` + `MapDims` + (필요 시) `prefers-reduced-motion` fixture(Given) → 맵 layout/movement 모델 산출(When) → 좌표/전이/표시/접근성(Then)으로 검증한다. 좌표는 §2.2~2.5 규칙대로 계산한 값과 일치해야 한다. movement 보간/성능 임계는 가설이며 구조 규칙은 확정이다.

- **SPEC-301-AC-01** (R-UI-003, R-UI-008) — zone partition 결정성
  - Given distinct `windowIndex` 집합과 `MapDims`가 주어진 camp fixture에서
  - When 맵이 zone을 산출하면
  - Then zone 수 = distinct `windowIndex` 수이고, 각 zone은 `windowIndex` 오름차순 row-major로 `cols×rows` grid에 배치되며, 모든 `zoneRect`가 `world`(= zone grid 합, §2.2) 안에 있고, 같은 window 집합에 대해 동일 `zoneRect`/`world`가 재현된다(§2.2).

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
  - Then sprite는 fixed-aspect 컨테이너 내 절대 위치라 인접 요소 reflow가 없고 CLS=0이며, sprite box는 `frame_size × spriteScale`(image-ground=`GROUND_SPRITE_SCALE` / zone-grid=`MAP_SPRITE_SCALE`, §2.1/§2.1a)로 고정되고 그 스케일이 **asset·placeholder에 동일 적용**되어 asset 토글 시 layout shift가 0이다.

- **SPEC-301-AC-09** (R-UI-003, R-UI-004 진입, [[SPEC-202-design-accessibility]] AC-07/K2 정합) — keyboard roving-tabindex(zone 단위)·선택
  - Given 마우스 없이 키보드만 쓰는 사용자와 복수 zone 맵에서
  - When `Tab`/Arrow/`Enter`로 이동하면
  - Then 각 zone이 하나의 roving-tabindex 그룹(zone당 single tab stop)이고, `Tab`/`Shift+Tab`은 zone 간 이동, Arrow는 focus zone 내부 orc 간 결정적 순서 이동, `Enter`/`Space`는 focus orc를 선택해 `?orc=<orcId>`로 inspector를 열며, 어떤 orc도 키보드로 도달 불가능하지 않다.

- **SPEC-301-AC-10** (R-UI-006) — placeholder parity
  - Given background image/props/sprite asset이 미탑재/누락인 fixture에서(image-ground 및 legacy zone-grid 각각)
  - When 맵을 렌더·조작하면
  - Then 배치 좌표(image-ground: world=`logical_size`·`safeArea`·slot / zone-grid: zone/station/slot)가 asset 탑재 시와 **동일**하게 산출되고(배경 부재 시 CSS gradient ground, zone-grid는 station CSS marker), 7종 status가 위치+label+overlay/CSS glyph로 grayscale-구분 가능하며, selection·hover·keyboard·bubble·reduced-motion이 동일 동작하고, asset 토글로 layout shift가 0이다(§3.4).

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
  - Given **원본 크기**에 가까운 sprite(`frame_size × mapSpriteScale`, `mapSpriteScale≈0.9` → ≈209px), 고정 `ZONE_W×ZONE_H` zone, 한 zone에 동일 status orc 다수 + 다-window camp fixture에서
  - When 맵이 §2.1 `mapSpriteScale`·§2.2 고정 zone/world·§2.4 ring을 산출하면
  - Then (a) full-size scaled sprite box가 자신의 zone inner rect 안에 들어가고 ring 간격 `RING_STEP`(scaled footprint 기준)이라 인접 ring sprite가 비-중첩이며, (b) zone은 **항상 고정 `ZONE_W×ZONE_H`(=MIN_ZONE)**라 window 수와 무관하게 degenerate하지 않고 window/orc가 많으면 **world가 커져 뷰포트가 스크롤**하며(§2.2/§2.7), (c) `mapSpriteScale`이 **asset과 placeholder 박스에 동일하게 적용**되어 toggle 시 box 크기·layout이 변하지 않으며(AC-08·[[SPEC-202-design-accessibility]] AC-17 동치), frame_size 종횡비가 보존된다.

> 아래 AC-15~21은 구 **rich map depth toolkit**(§2.8/§3.5)을 검증했다. image-ground(단일 배경 이미지) 전환으로 Wang terrain field·backdrop parallax 관련 항목(AC-15/16)은 **superseded**됐고, scenery/z/lighting/budget 항목(AC-17~21)은 image-ground에 맞춰 재범위화됐다. 신규 image-ground 검증은 **AC-22/AC-23**이다.

- **SPEC-301-AC-15** (R-UI-003, R-UI-008, INV-1) — 결정적 terrain field — **(superseded — image-ground)**
  - corner-Wang terrain field(`terrainAt`)가 단일 배경 이미지로 대체돼 런타임에 존재하지 않는다(§2.8b superseded). client-derived 결정성·서버 좌표 불추가 검증은 **AC-12(zone-grid target)·AC-22(image-ground target)**가 대체한다. AC ID는 추적 안정성을 위해 보존하나 게이트하지 않는다.

- **SPEC-301-AC-16** (R-UI-003) — backdrop parallax + scroll 안정 — **(superseded — image-ground)**
  - 단일 배경 이미지(`parallax=0`)가 backdrop horizon+parallax를 대체했다(§2.8a superseded). drag-pan 시 scroll/layout 안정성은 **AC-08(zero layout shift)·AC-22(image-ground drag-pan)**가 검증한다.

- **SPEC-301-AC-17** (R-UI-003, R-UI-007, [[SPEC-202-design-accessibility]] A7/R4 정합) — scene z-order·label 비가림
  - Given 배경 이미지·decor(zone-grid fallback)·shadow·lighting·sprite·status overlay·status label·raw target이 있는 scene fixture에서
  - When z-순서를 검사하면
  - Then §2.7 z-stack(①→⑪, back→front)대로 렌더되고, 배경/decor/shadow/lighting 레이어는 **항상 status overlay·status label·raw `tmuxTarget`(⑧⑨) 아래**에 위치해 어떤 배경/장식 레이어도 상태/식별 텍스트를 가리지 않으며, decor·shadow·lighting은 `pointer-events:none`이라 selection/hover/keyboard를 가로채지 않는다.

- **SPEC-301-AC-18** (R-UI-003, R-UI-008, INV-1) — 결정적 scenery scatter·비-개입 (zone-grid fallback 한정)
  - Given legacy zone-grid fixture와 `scene.decor` 선언에서 `decorPlacements(zoneRect, ctx)`를 반복 산출할 때(image-ground는 CSS decor 미렌더)
  - When placement를 산출하면
  - Then 동일 입력에 동일 placement 집합을 산출하고(seeded, `Math.random` 0건), decor가 station 앵커·slot ring·zone header·label 영역을 회피하며(겹침 시 drop), decor는 `pointer-events:none`이고 zone당 decor ≤ `DECOR_MAX`(가설)이며, sprite/label 배치를 바꾸지 않는다.

- **SPEC-301-AC-19** (R-P1-004, 비기능 접근성, [[SPEC-202-design-accessibility]] AC-11 정합) — reduced-motion: decor·lighting 정지
  - Given `prefers-reduced-motion: reduce`이고 decor(zone-grid)/lighting scene fixture에서
  - When 맵을 렌더하면
  - Then decor 애니메이션(brazier flicker 등)·lighting 맥동이 정지하며, scene은 **정적으로 입체감을 유지**한 채 렌더된다(모션만 제거; §3.5-4). (구 parallax off 항목은 parallax 제거로 무효.)

- **SPEC-301-AC-20** (R-UI-006, [[SPEC-202-design-accessibility]] AC-17 정합, [[SPEC-300-asset-rendering]] §3.9 공동) — image-ground placeholder parity·zero layout shift
  - Given background 이미지/decor/shadow asset을 각각 또는 전부 미탑재↔탑재로 토글하는 fixture에서
  - When 맵을 렌더·측정하면
  - Then 모든 단계에서 world/`safeArea`/slot 좌표(image-ground) 또는 zone/station/slot 좌표(zone-grid)·sprite box·scroll 위치가 **동일**하고(CLS=0), 배경 이미지가 없으면 최소 CSS gradient ground로 그려지며, depth cue(shadow/lighting의 CSS fallback)가 asset 없이도 유지된다(§3.4).

- **SPEC-301-AC-21** (비기능 성능, §3.3 정합) — scene 레이어 정적·budget 비가산
  - Given 20 session/100 pane + scene(배경 이미지/decor/lighting/shadow) fixture에서
  - When 렌더 루프를 검사하면
  - Then 배경 이미지·decor·lighting·shadow는 per-frame 애니메이션이 아니어서 공유 clock frame 작업에 미포함되고(§3.5-1), 뷰포트/drag-pan 변화 시에만 갱신되며, §3.3 sprite 애니메이션 budget(AC-11)에 scene 비용을 더하지 않는다.

- **SPEC-301-AC-22** (R-UI-003, R-UI-008, R-UI-006, INV-1) — image-ground world(2× native) + 원본 크기 placement (구현·`web/tests/ground.test.ts`)
  - Given `logical_size`(= `native_size × world_scale`, 2×) + walkable `ground.polygon`(logical 좌표) + `safe_area`를 가진 배경(예: `orccamp-default`)과 여러 window/status/terminated orc fixture에서
  - When `computeLayout(orcs, groundFromBackground(bg))`로 image-ground 배치를 산출하면
  - Then (a) `dims.world` = 배경 `logical_size`(= 2× native, 예 `3344×1882`)이고, (b) 모든 orc target이 walkable `safeArea` 내부(`GROUND_MARGIN=104.4` 여유로 **원본 크기** sprite body 포함)에 있으며, (c) 동일 입력에 동일 target(순수·결정적, `Math.random`/`Date.now` 없음)이고, (d) slot peers가 **status로 키**되어 서로 다른 window의 동일 status orc도 distinct ground slot을 받으며, (e) `target.zoneIndex`가 window rank를 추적하고(keyboard 그룹 보존), sprite scale은 `GROUND_SPRITE_SCALE = MAP_SPRITE_SCALE`(=0.9, 원본 크기)·`GROUND_PITCH_FACTOR=1.0`이 asset·placeholder에 동일 적용된다(zero layout shift). 좌표 필드는 `Orc`/snapshot/WS 어디에도 없다(INV-1).

- **SPEC-301-AC-23** (R-UI-006, R-UI-008) — ground geometry + 등록 ratio 게이트(scale 불변) (구현·`web/tests/ground.test.ts`)
  - Given default polygon(`orccamp-default`, 2× world `3344×1882`)과 작은 polygon fixture에서
  - When ground geometry/게이트 함수를 산출하면
  - Then (a) `shoelaceArea(polygon)` = `1771900` px²(2× world)이고, (b) `groundRatio` ≈ `0.282`(stored `0.2815`와 1e-3 이내, **`world_scale`에 불변**)이며, (c) `safe_area` 4코너가 모두 polygon 내부(`pointInPolygon`)이고, (d) `meetsGroundRatio(default)` = accept(`ratio ≥ REFERENCE_GROUND_RATIO`=0.281), 작은 polygon = reject + 사유(`ground_ratio … < reference`)이며 ratio는 stored가 아니라 polygon에서 **재계산**되고, (e) `groundFromBackground`는 polygon 보유 배경에 GroundContext(`world={3344,1882}`, `safeArea={1080,950,1320,800}`)를, 미보유/null 배경에 `null`(→ zone-grid)을 반환하며, (f) manifest `scene.backdrop.background_ref="orccamp-default"`가 `logical_size=[3344,1882]`와 게이트를 통과하는 ground를 가진다.

- **SPEC-301-AC-24** (R-UI-004, R-P1-004, INV-1) — drag-and-drop 이동·드롭 후 재개·드래그 idle anim (구현·`web/tests/dragMove.test.tsx`·`roaming.test.ts`·`spriteResolver.test.ts`)
  - Given live 맵의 orc fixture에서 orc sprite 위 pointer 제스처(down→move>`DRAG_START_PX`→up)와, threshold 미만의 tap을 각각 가하면
  - When `OrcSprite` 드래그 핸들러 → `CampMap.onMoveOrc` → `RoamingController.place()` + `ui.orcPositions` 업데이트가 실행되면
  - Then (a) 드래그 중 sprite는 포인터를 따라가고(`BASE_SCALE=1` → screen Δ = logical Δ) `oc-orc--dragging`이 적용되며 `resolveSprite({dragging:true, direction})`이 **`idle` 애니메이션을 드래그 시작 facing 방향**으로 출력하고(8방향), (b) 드롭은 walkable bound로 `PATROL_MARGIN` clamp된 위치를 새 home으로 **즉시 snap**하고 그 orc를 **`pinned`**으로 표시해 **드롭 지점에 정확히 머물며**(patrol/rest/wander offset·bound-clamp 미적용 → **드래그 전 위치로 복원되거나 어긋나지 않음**) status 애니메이션만 제자리 재생하며, (c) 드롭 직후 click은 억제돼 **선택을 유발하지 않고**, threshold 미만 tap은 기존대로 선택하며, (d) 새 home은 `ui.orcPositions[orcId]`로 보관돼 live snapshot refresh를 가로질러 유지되고(같은 home+pinned 재-sync는 no-op) orc 소멸 시 prune되며, (e) 위치는 포인터에서만 오므로 `Math.random`/`Date.now` 미사용(INV-1)이고 서버 `Orc`/snapshot에 좌표 필드를 추가하지 않는다.

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-003 | camp scene을 **image-ground(단일 배경 이미지=world, native·drag-pan)** 공간 맵으로 실현, orc를 walkable `safe_area`에 결정적 배치 + legacy zone/station/slot fallback(window=lane·pane=slot 의미 보존, SPEC-201-AC-03 scene 배치 supersede), zero layout shift·keyboard·scene z-order·lighting/shadow placement. (Wang terrain field AC-15·backdrop parallax AC-16은 superseded) | SPEC-301-AC-01, AC-02, AC-03, AC-08, AC-09, AC-12, AC-14, AC-17, AC-18, AC-22, AC-23 |
| R-UI-006 | background image/props/sprite 누락 시 placeholder parity(위치·status·interaction·a11y 불변, uniform sprite scale 토글 parity, no layout shift) + **배경 이미지→CSS gradient fallback**(빈 화면 회귀 방지) | SPEC-301-AC-08, AC-10, AC-14, AC-20, AC-22 |
| R-ORC-005 | activity bubble에 `summarySource`/estimated 마커 + 상시 status label/confidence 동반(단정 금지) | SPEC-301-AC-06 |
| R-P1-004 | status별 sprite animation을 공간 맵으로 확장: `roaming` walk-cycle 진입·8방향·reduced-motion·공유 clock(state-entry anchored) + scene 모션(decor/lighting) reduced-motion 정지 + **drag-and-drop 이동(드래그 중 idle anim·드롭 후 활동/대기 재개)** | SPEC-301-AC-04, AC-05, AC-07, AC-13, AC-19, AC-24 |
| R-UI-004 (interaction) | orc **drag-and-drop 재배치**(pointer 드래그→드롭, tap=선택 보존, 드롭=재배치+활동/대기 재개), client UI 상태(`ui.orcPositions`)로 보관·refresh 가로질러 유지 | SPEC-301-AC-24 |
| R-P1-005 (substrate) | 단일 배경 이미지(`scene.backdrop`→`backgrounds[ref]`, image-ground/zone-grid)가 manifest/asset-pack 구동 → pack/background 교체로 scene 배경 교체 가능. 신규 배경은 ground-ratio 게이트(§2.8f) 통과 필요. **per-camp 전환 UI·설정은 [[SPEC-500-settings-persistence]] forward**(소유 주장 아님) | SPEC-301-AC-20, AC-23 |
| **R-UI-008** | orc 위치+애니메이션으로 활동을 공간 표현, 위치는 기존 필드의 결정적 함수(서버 좌표 불추가; image-ground=f(status,paneId)/zone-grid=f(windowIndex,status,paneId)) | SPEC-301-AC-01, AC-02, AC-03, AC-12, AC-14, AC-22, AC-23 |
| **R-P1-013** | status 변화 시 roaming으로 이동·8방향 direction(P1 movement) | SPEC-301-AC-04, AC-05 |
| 비기능: 성능 (20/100) | 단일 공유 clock·fixed-aspect·완화 전략(가설 임계) + depth 레이어 정적·budget 비가산 | SPEC-301-AC-11, AC-13, AC-21 |
| 비기능: 접근성 (keyboard/reduced-motion) | zone roving-tabindex·snap + decor/lighting reduced-motion 정지 (값은 [[SPEC-202-design-accessibility]]) | SPEC-301-AC-07, AC-09, AC-19 |

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
- **C4 — Wang tileset 의존 철회(RESOLVED — image-ground로 대체, 2026-06-29)**: ~~§2.8 depth 배치가 corner-Wang tileset/terrain field에 의존한다~~는 이전 요구는 **철회**됐다. camp 배경이 **단일 배경 이미지(image-ground)**로 전환돼 Wang tileset·terrain field가 더 이상 필요 없다([[SPEC-300-asset-rendering]] §6 C4 RESOLVED 정합). manifest는 `scene.backdrop.background_ref="orccamp-default"`(image-ground)·`scene.decor`(zone-grid fallback용)·`scene.shadow`와 `backgrounds.orccamp-default`(`logical_size`·`ground.polygon`·`safe_area`)를 이미 보유한다. 신규 배경 등록은 §2.8f ground-ratio 게이트를 통과해야 하며 owner는 `scene-placement-engineer`다. **잔여 조치 없음.**
- **C5 — 신규 R-UI-009·D-036 채택 제안(F-rich-map) — image-ground로 모델 변경**: "입체감 있는 다층 scene"을 명시한 `R-*`가 없어 정식 승격을 **제안**한 항목이다. 단 **구현 모델이 corner-Wang/parallax depth toolkit에서 image-ground(단일 배경 이미지)로 변경**됐으므로 아래 drop-in 텍스트는 **갱신이 필요**하다(원안의 "corner-Wang 자동 타일링·backdrop+parallax"는 superseded). 현재 R-UI-003(scene)·R-UI-006(parity)로 부수 충족된다. **write scope(`docs/specs/`) 밖**이므로 drop-in만 제시하고 [[02-Requirements]]·[[08-Decisions]] 반영은 orchestrator/user에 위임한다(채택 즉시 frontmatter `requirements`에 `R-UI-009` 추가·[[SPEC-900-traceability-rollup]] §2.4 갱신).

  적용 대상: `docs/product/02-Requirements.md`(R-UI 그룹), `docs/product/08-Decisions.md`(말미).

  - **R-UI-009 (PROPOSED, P1 — image-ground 갱신안)** — `02-Requirements.md` R-UI 그룹:
    > `- **R-UI-009**: camp scene은 단일 배경 이미지(image-ground; 이미지=world, native 해상도, drag-pan)를 ground로 사용하고 orc를 배경의 walkable 영역(ground polygon/safe_area)에 결정적으로 배치해야 하며, 신규 배경은 walkable ground 비율이 기준값(REFERENCE_GROUND_RATIO) 이상이어야 등록 가능하고, 모든 레이어는 결정적(런타임 무작위 없음)·placeholder-parity·zero-layout-shift·reduced-motion-safe여야 하며 status/label/raw tmuxTarget을 가리지 않는다.`
  - **D-036 (PROPOSED — image-ground 갱신안)** — `08-Decisions.md` 말미(`D-035` 다음):
    > `## D-036: camp map은 image-ground(단일 배경 이미지=world) 모델이며 client-derived 결정적 배치다`
    > `- 결정: camp 배경은 타일/zone-grid가 아니라 단일 배경 이미지다. 배경에 logical_size(native px)와 walkable ground polygon이 있으면 이미지가 곧 world(native, drag-pan)이고 orc는 walkable safe_area에 배치된다. ground polygon이 없으면 legacy zone-grid로 fallback한다. 신규 배경은 ground 비율 게이트(groundRatio ≥ REFERENCE_GROUND_RATIO)를 통과해야 한다. 배치·ground 산정은 client의 결정적 함수이며 서버 좌표·런타임 무작위를 쓰지 않는다(D-035 정합). 배경/scene asset은 manifest 선언으로 소비한다(D-013 SSOT). corner-Wang 자동 타일링·backdrop parallax는 폐기(superseded).`
    > `- 근거: 단일 평면 tile/타일링 복잡도 제거(단일 배경 이미지가 풍부한 scenery 제공), read-only·privacy·data-contract SSOT 보존, web-only.`
    > `- 영향: R-UI-009 신설, [[SPEC-300-asset-rendering]] §2.5/§2.6/§3.9·[[SPEC-301-camp-map-movement]] §2.1a/§2.8/§3.4/§3.5 소유. 씬 배치 owner = scene-placement-engineer. 구 corner-Wang/parallax AC(SPEC-300-AC-14/15·SPEC-301-AC-15/16)는 superseded.`

### Open Questions (검토 필요)

- **Q1 — station 앵커 정규 좌표·zone grid 상수 튜닝**: §2.3 앵커 `(nx,ny)`와 §2.2 `ZONE_COLS_MAX`/`ZONE_GUTTER`/`ZONE_PAD`/`ZONE_HEADER_H`는 시각 가설이다. 7 station 비가림·label 가독성·zone 가독 밀도로 prototype 보정 필요. 구조 규칙(서로 다른 앵커·terminated edge·label 비가림)은 확정.
- **Q2 — slot ring 상수·overflow 임계(메커니즘 확정, 값만 가설)**: feasibility는 **큰 논리 월드 + 스크롤/팬 뷰포트 + 원본 크기 sprite(`mapSpriteScale≈0.9`)**로 재결정됐다(F2 재결정, §2.1/§2.2/§2.7) — 고정 `ZONE_W×ZONE_H` zone이 7 station + fan-out을 full-size로 비-중첩 수용하고, world = zone grid, 뷰포트가 스크롤. 남은 것은 **튜닝 값**(`mapSpriteScale`/`ZONE_W`/`ZONE_H`/`ZONE_GUTTER`/`RING_BASE`/`RING_CLEARANCE`/`R_MAX`/`SLOT_SOFT_MAX`)과 한 station에 동일 status orc가 매우 많을 때(예: 한 window 50 active pane) 가독성 vs "모두 표시(read-only)" trade-off, 그리고 base 렌더 스케일/팬 UX의 측정 보정뿐이다.
- **Q3 — roaming 보간 파라미터**: §3.1-6 `ROAM_SPEED`/`ROAM_MIN_MS`/`ROAM_MAX_MS`/easing, §3.1-1 `ε`, 최초 등장 spawn 방식(snap vs walk-in), ambient wander 활성화/`WANDER_R`(§3.1-8)는 가설·선택. reduced-motion에서는 모두 비활성(확정).
- **Q4 — DOM↔canvas 전환 임계**: §2.7 canvas P2 escape hatch로 전환할 정확한 성능 임계(§3.3 예산 미달 시점)와 canvas 경로의 a11y/selection DOM overlay 설계는 [[SPEC-200-frontend-architecture]]·[[SPEC-007-test-validation]] FE 측정 계층(forward)과 함께 확정. MVP는 DOM.
- **Q5 — overlay/bubble anchor 좌표 규약**: status overlay(64×64)·speech bubble의 sprite anchor 기준 정확 offset은 [[SPEC-300-asset-rendering]] Q1(overlay anchor)과 공동 확정 필요. 본 spec은 z-순서·비가림(§2.3-1, §2.6)까지 고정.
- **Q6 — scene 튜닝 값(가설, image-ground 갱신)**: §2.8c decor scatter seed·`DECOR_MAX`(zone-grid fallback 한정), §2.8d lighting vignette/ambient 강도(C1/C2 대비 보존)는 prototype/QA 보정 대상이다. **구조 규칙(결정성·label 비가림·placeholder parity·reduced-motion 정지·`pointer-events:none`)은 확정**이고 값만 가설이다. (구 terrain 분류·parallax `P` 튜닝 항목은 image-ground 전환으로 무효.)
- **Q7 — image-ground 튜닝·정밀 polygon 배치(가설, 신규)**: §2.1a `GROUND_SPRITE_SCALE = MAP_SPRITE_SCALE`(=0.9, 원본 크기) + `world_scale`(=2, world 확대로 원본 크기 sprite 수용)·§2.8f `REFERENCE_GROUND_RATIO`(=0.281), walkable 영역에 많은 orc가 모일 때(예: 한 status에 50 orc) safe_area 내 fan-out 가독성 vs "모두 표시(read-only)" trade-off, 그리고 **현재 polygon 내접 rect(safe_area) 보수적 clamp 대신 polygon 자체에 정밀 배치**로 walkable 면적을 더 쓰는 향후 개선은 prototype/QA 보정·후속 작업 대상이다. 구조 규칙(world=2× native·고정 스케일·drag-pan only·center-on-mount·결정적·ratio 게이트·status-keyed slot)은 확정. owner = `scene-placement-engineer`.
