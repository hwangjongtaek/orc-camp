---
spec: SPEC-303
title: epic monster NPC — 배경별 ambient 보스 몬스터 배치·roaming·error 거동 계약
status: draft
updated: 2026-06-29
requirements: [R-UI-010, R-P1-004, R-UI-008]
decisions: [D-037]
tags:
  - specs
  - frontend
  - dashboard
  - camp-map
  - monster
  - npc
  - roaming
  - sprite
  - epic-4
---

# SPEC-303 — epic monster NPC (배경별 ambient 보스 몬스터)

이 spec은 camp detail scene에 **배경 환경에 어울리는 epic 보스 몬스터 1마리**를 ambient NPC로 띄우는 런타임 거동 계약을 고정한다. 몬스터는 데이터를 운반하지 않는 **비-상호작용·비-load-bearing** 장식이며, 해당 배경의 walkable **`ground.polygon` 전체**를 결정적으로 roaming하다가 도착할 때마다 무작위(seeded) dwell 애니메이션을 재생하고, **orc와 교차(footprint overlap)하면 `error` 애니메이션으로 래치**된다. 좌표·상태는 `monster id(seed) + 활성 polygon + 공유 clock + orc footprint stream`으로 client에서 결정적으로 도출하며 새 server 데이터/좌표를 도입하지 않는다(INV-1). roam/dwell은 `t`의 순수 함수이나, error 래치는 누적기를 쓰므로 출력은 **tick 입력 시퀀스의 결정적 함수**다(순수-`f(t)` 아님 — §3.6 결정성 경계).

본 spec은 [[SPEC-301-camp-map-movement]]가 소유한 image-ground 배치 모델(§2.1a/§2.7/§2.8) 위에 **별도 ambient mover**를 얹는다. orc는 polygon의 내접 rect(`safe_area`)에 clamp되지만(§2.1a-2), epic monster는 **polygon 전체**를 roaming하는 점이 핵심 대비다(§3.4). 자산 *생성*(512×512 base + 5 애니메이션 prompt/seed/ID)·render 메커니즘(manifest resolution·frame 재생·anchor/scale)은 본 spec이 소유하지 않는다.

> **상태(draft)**: 본 기능은 신규 채택 후보다(**R-UI-010 proposed**, **D-037 proposed**). PixelLab MCP 인증은 **확인됨**(2026-06-29, 구독 active)이나 **512는 MCP로 생성 불가**(`create_character` size≤128)라 **PixelLab 웹 UI에서 512 생성 후 export zip을 import**한다([[16-Epic-Monster-NPC]] §2/§5 / [[13-PixelLab-Asset-Registry]]). 자산이 들어오기 전까지 본 spec은 **schema-first**로 거동을 고정해 런타임이 **몬스터를 렌더하지 않고 안전 통과**하도록 설계한다(§3.12). 배치/거동은 자산 유무와 무관하게 결정적이다.

> **소유 경계**: 본 spec은 *epic monster의 배치·roaming·dwell FSM·error 래치·비-상호작용 규칙*만 소유한다. ① 몬스터 자산 외형·생성 prompt/seed/ID·생성 runbook·512 base contract → [[16-Epic-Monster-NPC]] / [[13-PixelLab-Asset-Registry]]. ② sprite render 메커니즘(manifest resolution·FSM state→animation 매핑·frame 재생·anchor/scale·error overlay precedence·reduced-motion 정지 frame·"미가용→미렌더") → [[SPEC-300-asset-rendering]]. ③ image-ground world/`ground.polygon`/`safe_area`/drag-pan·orc 배치·공유 clock·z-stack·zero layout shift → [[SPEC-301-camp-map-movement]]. ④ 배경별 art concept(팔레트·시그니처·IP 제약) → [[background-tile-merge-guide]] §6. ⑤ orc `status`/데이터 shape → [[SPEC-004-status-inference]] / [[SPEC-005-data-contract]]. 본 spec은 그 위에서 **몬스터 controller의 입력→출력**만 정의한다.

> **불변식(확정, [[SPEC-301-camp-map-movement]] 계승)**:
> - **INV-1 (client-derived, 서버 데이터 불변)**: 몬스터 좌표·상태는 전적으로 client에서 `monster id`(seed) + 활성 배경 `ground.polygon` + 공유 clock + orc footprint stream으로 계산한다. `Orc`/`Camp`/`ScanResult`/snapshot/WS에 **몬스터 또는 좌표 필드를 추가하지 않는다**. `Math.random`/`Date.now`/server 좌표 금지(`web/src/scene/patrol.ts` `mix(seed,k)` 패턴).
> - **INV-NLB (non-load-bearing)**: 몬스터는 정보를 운반하지 않으므로 자산 미가용 시 **그냥 렌더하지 않는다**(placeholder box 없음 — orc의 placeholder parity 의무에서 **유일하게 면제**되는 scene 요소). 어떤 경우에도 orc 배치/grid/zero-layout-shift를 교란하지 않는다(§3.8).
> - **INV-NI (non-interactive)**: `pointer-events:none`, tab order/keyboard nav 제외, selection/inspector/status overlay/label/speech bubble 없음. orc 데이터 모델·`computeCells`/grid 입력에서 제외된다(§3.8).

## 1. Scope

### In scope

| 구분 | 항목 | 비고 |
| --- | --- | --- |
| **In** | **variant resolution**: 활성 배경(manifest key) → epic monster variant(roster) — scene당 정확히 1마리 (§3.1) | 6 variant ↔ 6 배경 |
| **In** | **상수 SSOT**: scale/frame/footprint/leg·dwell duration/속도/error debounce 임계 (§3.2) | 가설(튜닝 대상) |
| **In** | **footprint geometry + overlap predicate**: 몬스터·orc ground-contact box·AABB 겹침 판정 (§3.3) | 결정적 |
| **In** | **full-polygon roaming**: point-in-polygon waypoint sampling + footprint clamp + 배경별 feasibility(necropolis scale) (§3.4) | `safe_area`가 아닌 **polygon 전체** |
| **In** | **dwell FSM**: roam→dwell(seeded {active,waiting,idle})→roam 루프, `displayedState`/`direction`/`tEnter` 도출 (§3.5) | `patrolAt` 미러 |
| **In** | **MonsterController**: `sync`/`tick(orcFootprints,t)` 변이 + `snapshot(t)` 순수 read·결정성 경계 (§3.6) | `RoamingController` 패턴 |
| **In** | **orc-intersection → error 래치**: overlap→`error` halt·nearest-orc facing·`ERROR_MIN_MS` debounce·resume (§3.7) | latch as explicit state |
| **In** | **non-interactivity / non-load-bearing**: pointer/tab/selection 제외·orc 배치 비교란 (§3.8, §3.12) | INV-NI/INV-NLB |
| **In** | **z-order/depth**: §2.7 z-stack 내 위치(베이스라인 y-sort vs MVP behind-orcs)·interaction 비가림 (§3.9) | — |
| **In** | **reduced-motion**: 단일 정적 frame(idle, south), roam/cycle/error 미동작 (§3.10) | [[SPEC-202-design-accessibility]] AC-11 정합 |
| **In** | **성능**: +1 sprite/scene·O(orcs) overlap/frame·공유 clock(per-monster 타이머 0) (§3.11) | §3.3 budget 비-가산 |

### Out of scope (다른 spec/문서로)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| 몬스터 512 base contract·5 애니메이션 prompt/seed/ID·생성 runbook | 자산 생성 | [[16-Epic-Monster-NPC]] / [[13-PixelLab-Asset-Registry]] |
| sprite frame 재생·FSM state→animation·anchor/scale·error overlay precedence·"미가용→미렌더" 메커니즘 | 렌더 메커니즘 | [[SPEC-300-asset-rendering]] |
| image-ground world/polygon/safe_area/drag-pan·orc 배치·공유 clock·z-stack·CLS=0 | 맵 계약 | [[SPEC-301-camp-map-movement]] |
| 배경별 art concept(팔레트·시그니처·IP 제약) | art concept | [[background-tile-merge-guide]] §6 |
| manifest `monsters` 스키마·`backgrounds.<bg>.epic_monster` 링크·등록 | manifest | [[16-Epic-Monster-NPC]](스키마) / asset-runtime-engineer(작성) |
| orc `status`/`agentType`/배치 좌표 추론 | 상류 | [[SPEC-004-status-inference]] / [[SPEC-005-data-contract]] / [[SPEC-301-camp-map-movement]] |
| 신규 server 좌표/몬스터 데이터 전송 | INV-1로 **금지** | — |

## 2. 입력

### 2.1 manifest 입력 (읽기 전용)

스키마는 [[16-Epic-Monster-NPC]]가 소유한다. 본 spec이 소비하는 필드:

```ts
// 활성 배경 → variant 링크 (asset-runtime-engineer가 manifest에 작성)
//   backgrounds["<bg>"].epic_monster: "<monster-key>" | undefined
// monsters["<monster-key>"]:
interface MonsterDef {
  key: string;                 // "monster-frostfang-colossus" 등 (roster FROZEN)
  label: string;               // "Frostfang Colossus"
  status: 'planned' | 'available' | 'deprecated';
  pixellab_character_id: string | null;
  frame_size: [number, number]; // [512, 512]
  anchor: [number, number];     // bottom-center (feet), orc와 동일 규약
  scale?: number;               // 본질(intrinsic) asset 스케일 = 1(character와 동일 규약, [[16-Epic-Monster-NPC]]).
                                //   화면 렌더 footprint 스케일은 본 spec §3.2 MONSTER_SCALE(default 0.9, necropolis 0.65)와
                                //   이 intrinsic scale의 곱이다(배경별 축소는 manifest가 아니라 SPEC-303 render-scale로 소유).
  directions: string[];         // roaming 8-dir 폴더 이름 (없으면 south fallback)
  animations: {                 // active|waiting|idle|roaming|error (planned 단계엔 placeholder)
    active?: AnimRef; waiting?: AnimRef; idle?: AnimRef; roaming?: AnimRef; error?: AnimRef;
  };
}
```

- variant resolution(§3.1)은 `backgrounds[active].epic_monster` → `monsters[key]`만 읽는다. 링크/엔트리/자산 미가용은 **미렌더**(§3.12).
- `roster` 키/라벨/배경 매핑은 **FROZEN**(아래 §3.1 표 = [[16-Epic-Monster-NPC]] / merge-guide §6와 동일해야 함).

### 2.2 소비 데이터 (읽기 전용)

| 입력 | 출처 | 용도 |
| --- | --- | --- |
| `activeBackgroundKey` | 현재 camp scene 배경(`scene.backdrop.background_ref` 또는 per-camp 배경) | variant resolution(§3.1) |
| `ground.polygon`(logical px) | [[SPEC-301-camp-map-movement]] §2.1a `GroundContext.polygon` | roaming 영역(§3.4) |
| `orcFootprints[]` | 각 orc의 `RoamingController.snapshot(id,t).renderedPos`(순수 read) → footprint box(§3.3) | error overlap 판정(§3.7) |
| `t` | 공유 애니메이션 clock([[SPEC-301-camp-map-movement]] §2.7) | roam/dwell/error 시간 구동 |
| `prefers-reduced-motion` | 매체 질의 | §3.10 정지 |

- 몬스터는 **polygon**을 읽고, orc는 **`safe_area`**(polygon 내접 rect)를 읽는다 — 두 mover의 영역이 의도적으로 다르다(§3.4).
- `orcFootprints`는 orc `renderedPos`(이미 결정적·INV-1)에서 파생한 **읽기 전용** 박스이며, 몬스터는 orc 위치를 바꾸지 않는다.

## 3. 계약 (Contract)

> **적용 단계 (phased rollout, 2026-06-30 확정)**: 자산은 6종 모두 `roaming`(8방향) + `idle`/`active`/`waiting`/`error`(south)
> 9프레임이 **인도 완료**([[13-PixelLab-Asset-Registry]] item#11)이나, **현재 적용 범위는 `roaming`만**이다.
> - **Phase 1 (현재 적용)**: 몬스터는 `ground.polygon`을 **끊김 없이 계속 roaming**한다 — 짧은-보폭 waypoint 루프를
>   ping-pong으로 순회(한 leg ≤ `MONSTER_STEP_MAX`)하고, `displayedState`는 **항상 `roaming`**(8방향, §3.1-2 quantize).
>   **orc 회피(확정·2026-06-30)**: 매 tick orc 중심들을 읽어 각 orc의 clearance disc(반경 = 몬스터 footprint 반폭 +
>   `ORC_AVOID_RADIUS`)에서 밀려나도록 rendered 위치를 보정해 **오크와 겹치지 않고 둘러간다**(폴리곤 내부 유지, facing은
>   진행 방향). 결정적(orc 위치도 순수)·`Math.random`/`Date.now` 없음. 이로써 §3.7 "orc-intersection→`error`"는 회피로
>   **대체**된다(교차가 사실상 발생하지 않음; error 연출이 꼭 필요하면 Phase 2에서 회피와 함께 재검토). §3.5 무작위 dwell은
>   여전히 미적용(자산만 보유).
> - **Phase 2 (이후 추가 예정)**: §3.5 dwell(무작위 active/waiting/idle) + §3.7 error 래치(+latch/cooldown/liveness)를 켠다.
>   이때 §3.6 컨트롤러의 dwell/error 경로와 AC-05/06/08/09/16이 활성화된다. Phase 전환은 설정 플래그 1개로 토글(기본 Phase 1).
>
> 아래 §3.4~§3.12는 **전체 설계**를 기술한다. Phase 1에서 비활성인 부분(§3.5 dwell, §3.7 error)은 각 절 머리에 표시한다.

### 3.1 variant resolution (배경 → 몬스터, scene당 1마리)

```
resolveMonster(activeBackgroundKey, manifest):
  // CANONICAL SSOT (2-step). [[SPEC-300-asset-rendering]] §2.7-1 / [[16-Epic-Monster-NPC]] §6 이 동일 규칙을
  // mirror 한다(이중 소유 아님 — 본 절이 권위, 그쪽은 render 측 참조).
  key = manifest.backgrounds[activeBackgroundKey]?.epic_monster                 // (i) 정방향 링크 우선
  if !key:                                                                      // (ii) 역탐색 fallback(결정적)
    key = first k in sortedKeys(manifest.monsters) where monsters[k].background == activeBackgroundKey
  if !key: return null                               // 링크/역탐색 모두 없음 → 미렌더
  m = manifest.monsters[key]
  if !m: return null                                 // 엔트리 없음 → 미렌더
  if m.status != 'available' or m.pixellab_character_id == null: return null  // 자산 미가용 → 미렌더(§3.12)
  return m                                            // scene당 정확히 1마리
```

> **resolution SSOT(확정)**: 위 2-step이 권위 규칙이다. 정방향 링크(`backgrounds.<bg>.epic_monster`)가 1차, `monsters[k].background` 역탐색(키 사전순 결정적)이 fallback이다. 둘 다 동일 결과를 내도록 **등록된 배경은 정방향 링크를 갖춰야 한다**(예: `mirebog-camp` → `monster-bog-leviathan`). AC-01이 정방향·역탐색 두 경로를 모두 검증한다.

**roster (FROZEN — [[16-Epic-Monster-NPC]] / [[background-tile-merge-guide]] §6와 동일)**:

| variant key | label | 배경(manifest key) | merge-guide §6 테마 | feasibility(§3.4) |
| --- | --- | --- | --- | --- |
| `monster-mosshide-behemoth` | Mosshide Behemoth | `orccamp-default` | 테마 0 Default | scale 0.9 |
| `monster-frostfang-colossus` | Frostfang Colossus | `froststeel-camp` | 테마 1 Froststeel | scale 0.9 |
| `monster-magma-colossus` | Magma Colossus | `emberforge-camp` | 테마 2 Emberforge | scale 0.9 |
| `monster-bog-leviathan` | Bog Leviathan | `mirebog-camp`(등록·gate PASS 0.3274) | 테마 3 Mirebog | scale 0.9 |
| `monster-duneplate-scourge` | Duneplate Scourge | `sunscorch-camp`(theme, 미생성 배경) | 테마 4 Sunscorch | scale 0.9(배경 등록 후) |
| `monster-bonewraith-revenant` | Bonewraith Revenant | `necropolis-camp` | 테마 5 Necropolis | **scale 0.65**(최소 polygon) |

- **`mirebog-camp`는 등록 완료**(image-ground, `ground.polygon` ratio 0.3274 gate PASS, detail-panel switcher 선택 가능 — [[16-Epic-Monster-NPC]] §4)이며 manifest에 `backgrounds.mirebog-camp.epic_monster = "monster-bog-leviathan"` 정방향 링크가 있다(§3.4 feasibility 표 포함). 따라서 mirebog 활성 시 Bog Leviathan이 정상 resolve된다(자산 available 후 렌더).
- **`sunscorch-camp`만** 아직 manifest 배경 엔트리가 없다(theme designed-only). 해당 배경이 등록되기 전에는 활성화될 수 없으므로 **자연히 미렌더**다(§3.12). 등록 시 정방향 `epic_monster` 링크 + §3.4 feasibility 추가로 동일 규칙 적용.
- legacy `warbase-sunset-dashboard`처럼 `ground.polygon`이 없는 배경(zone-grid fallback)에는 epic monster를 두지 않는다(roaming 영역 정의 불가 → 미렌더).

### 3.2 상수 (SSOT, 가설 — 튜닝 대상)

```ts
// 크기·footprint (frame은 512 고정, scale은 배경별)
const MONSTER_FRAME = 512;                       // 512×512 (PixelLab plan max)
const MONSTER_SCALE_DEFAULT = 0.9;              // = GROUND_SPRITE_SCALE → sprite ≈460.8px (orc ≈209px의 ~2.2×)
const MONSTER_SCALE_NECROPOLIS = 0.65;          // 최소 polygon override → sprite ≈332.8px (§3.4)
const MONSTER_FOOTPRINT_RATIO = 0.5;            // ground-contact 폭 / frame edge (cf. shadow footprint_ratio 0.46)
const ORC_FOOTPRINT_RATIO = 0.5;               // overlap 판정용 orc ground-contact 폭 / REF_FRAME_MAX
const FOOTPRINT_ASPECT = 0.4;                   // 납작한 발자국: height = width × aspect
// roaming (느리고 육중하게 — orc보다 느림)
const MONSTER_SPEED = 90;                       // logical px/s (orc ROAM_SPEED 140보다 느림)
const MONSTER_LEG_MIN_MS = 1400, MONSTER_LEG_MAX_MS = 3200;     // seeded 이동 leg 지속
const MONSTER_DWELL_MIN_MS = 2200, MONSTER_DWELL_MAX_MS = 5200; // seeded dwell 지속
const WAYPOINT_MAX_ATTEMPTS = 24;              // 결정적 재샘플 상한(초과 시 centroid fallback)
// error 래치 (rising-edge trigger + bounded duty cycle → liveness 보장, §3.7)
const ERROR_MIN_MS = 1200;                     // error 1회 지속(halt). 경과 후 overlap 지속과 무관하게 resume
const ERROR_COOLDOWN_MS = 2000;                // resume 후 재트리거 금지 구간(붐비는 camp에서 stuck 방지)
// → 최악 error duty cycle = 1200/(1200+2000) ≈ 37.5% → roaming이 시간의 ≥62.5% 진행(전체영역 roaming 목표 보존)
const DWELL_ANIMS = ['active', 'waiting', 'idle'] as const; // dwell 무작위 선택 풀(§3.5)
const MVP_DIRECTION = 'south';                  // [[SPEC-301-camp-map-movement]] 계승
```

- **render footprint scale = `MONSTER_SCALE`(아래) × manifest intrinsic `monsters.<key>.scale`(=1)**. manifest intrinsic scale은 character와 동형으로 1이며([[16-Epic-Monster-NPC]]), 배경별 축소(necropolis)는 manifest가 아니라 본 spec의 `MONSTER_SCALE` render-scale로 소유한다(§3.4). `orccamp-default`/`froststeel`/`emberforge` = `MONSTER_SCALE_DEFAULT`(0.9), `necropolis-camp` = `MONSTER_SCALE_NECROPOLIS`(0.65).
- leg/dwell duration은 **monster id로 seed된 monster당 고정값**(per-cycle 변동은 forward, §6 Q2) — `patrolAt`의 `legDur`/`dwellDur` 패턴 그대로(O(1) 순수 계산 유지).

### 3.3 footprint geometry + overlap predicate (결정적)

- **footprint = AABB(축 정렬 박스)**. sprite의 ground anchor(= `renderedPos`, bottom-center)를 **중심**으로 하는 발자국 박스. AABB를 채택해 overlap 판정을 O(1)·정확·결정적으로 둔다(ellipse 정밀화는 §6 Q3 튜닝).

```ts
function footprintBox(center: Vec2, frameEdge: number, scale: number, ratio: number): Rect {
  const w = frameEdge * scale * ratio;          // 몬스터: 512·scale·0.5 / orc: REF_FRAME_MAX(232)·0.9·0.5
  const h = w * FOOTPRINT_ASPECT;               // 납작
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}
// 몬스터 footprint: footprintBox(monsterPos, MONSTER_FRAME, scale, MONSTER_FOOTPRINT_RATIO)
//   → scale 0.9: w≈230.4, h≈92.2 / scale 0.65: w≈166.4, h≈66.6
// orc footprint:     footprintBox(orcRenderedPos, REF_FRAME_MAX, GROUND_SPRITE_SCALE, ORC_FOOTPRINT_RATIO)
//   → w≈104.4, h≈41.8

function overlap(a: Rect, b: Rect): boolean {     // AABB 교차
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
```

- overlap은 **footprint(발 접지면)** 기준이지 sprite box 기준이 아니다. 거대한 몬스터의 상반신(머리·어깨)이 orc 위로 겹쳐 보여도 발이 떨어져 있으면 `error`가 아니다(과민 트리거 방지). 머리/어깨가 ground 영역 위로 솟는 것은 큰 생물의 정상 외형이다(orc의 머리가 발 anchor 위에 있는 것과 동일).

### 3.4 full-polygon roaming (point-in-polygon + footprint clamp + 배경별 feasibility)

> **핵심 대비([[SPEC-301-camp-map-movement]] §2.1a-2)**: orc target은 polygon **내접 rect `safe_area`**에 `clampToRect`로 보수적 clamp된다. epic monster는 그 제약을 받지 않고 **`ground.polygon` 전체**를 roaming한다 — 단, footprint(발자국)가 polygon 밖으로 새지 않도록 clamp한다.

- **point-in-polygon**: `web/src/scene/ground.ts`의 `pointInPolygon(p, polygon)`(ray-cast)을 재사용한다(신규 polygon 발명 금지 — 기존 `ground.polygon` 사용).
- **footprint clamp(폴리곤 내부 보장)**: waypoint 후보의 **footprint 박스 4코너 + 중심**이 모두 `pointInPolygon`이어야 채택한다. 이로써 발자국 전체가 walkable polygon 안에 머문다. `MONSTER_MARGIN = footprint_w/2`(수평)·`footprint_h/2`(수직)가 실질 erosion이다.
- **deterministic waypoint sampling(monster-id seed + cycle index)** — `patrolAt`의 seed 패턴 미러, polygon bbox에서 seeded 후보를 뽑아 footprint-in-polygon을 통과할 때까지 결정적 재샘플:

```ts
function monsterWaypoint(seed: number, polygon: Vec2[], bbox: Rect, safeArea: Rect, k: number,
                         frameEdge: number, scale: number): Vec2 {
  for (let a = 0; a < WAYPOINT_MAX_ATTEMPTS; a += 1) {
    const h = mix(seed, k * 131 + a);            // 결정적
    const cx = bbox.x + frac(h) * bbox.w;
    const cy = bbox.y + frac(mix(h, 1)) * bbox.h;
    if (footprintInPolygon({ x: cx, y: cy }, polygon, frameEdge, scale)) return { x: cx, y: cy };
  }
  // 결정적 fallback = 내접 safe_area 중심으로 clamp. safe_area는 polygon 내접 rect이므로
  // 그 중심·내부는 항상 polygon 안이고(concave에서도 안전, polygonCentroid와 달리), MONSTER_MARGIN
  // clamp로 footprint 4코너까지 polygon 내부가 보장된다(footprint feasibility 불변, §3.4 게이트).
  return clampToRect(rectCenter(safeArea), safeArea, MONSTER_MARGIN);
}
// footprintInPolygon = footprint 4코너 + 중심 모두 pointInPolygon
// MONSTER_MARGIN = { x: footprint_w/2, y: footprint_h/2 } (footprint = frameEdge·scale·MONSTER_FOOTPRINT_RATIO)
```

- **waypoint 0 = roam 시작점**(첫 mount의 결정적 spawn) = `monsterWaypoint(seed, …, 0)`. 이후 cycle n의 목표는 `monsterWaypoint(seed, …, n)`. seed = `paneHash(monster.key)` 류의 32-bit mix(`Math.random`/`Date.now` 금지).
- **배경별 feasibility note (필수)**: footprint가 polygon 안에 들어가는 feasible 영역이 비어선 안 된다. 측정(footprint 4코너+중심 in-polygon, 20px 격자 샘플) 결과:

  | 배경 | polygon ratio | scale 0.9 feasible(영역 bbox) | 채택 scale |
  | --- | --- | --- | --- |
  | `orccamp-default` | 0.2815 | 充분(≈2060×760) | **0.9** |
  | `froststeel-camp` | 0.3619 | 충분(≈1880×1100) | **0.9** |
  | `emberforge-camp` | 0.3301 | 충분(≈1760×1040) | **0.9** |
  | `mirebog-camp` | 0.3274 | 충분(≈1660×1100, footprint 4코너+중심 in-polygon 측정) | **0.9** |
  | `necropolis-camp` | **0.2191(최소)** | feasible하나 좁음(≈1560×760), full sprite 460px가 고딕 4면 구조물에 시각적으로 근접 | **0.65**(reduced) |

  - **necropolis 결정(확정 권장)**: 최소 polygon(ratio 0.2191, [[SPEC-301-camp-map-movement]] §2.8f 예외 배경)에서는 `MONSTER_SCALE_NECROPOLIS = 0.65`로 축소한다. scale 0.65에서 footprint ≈166px·full sprite ≈333px이며 feasible 영역(≈1620×780)이 더 여유로워, 육중한 몬스터가 둘러싼 크립트/대성당에서 자연스럽게 떨어져 roaming한다. **scale을 줄여도** footprint clamp 규칙은 동일하다(영역은 자동으로 약간 넓어짐).
  - 대안(둘 다 허용): scale 유지 + **더 타이트한 inner region**(polygon을 추가 margin으로 erode한 영역에서만 waypoint 샘플). 권장은 scale 축소(단순·결정적·자산 1세트로 충족).

### 3.5 dwell FSM (roam → dwell(무작위) → roam …)

> **⏸ Phase 2 (이후 적용 예정 — 현재 미적용)**: Phase 1은 dwell 없이 연속 roaming만 한다(§3 적용 단계). 아래는 Phase 2에서 켜질 dwell 설계다(`dwellDur>0`일 때만 동작).

`patrolAt`(`web/src/scene/patrol.ts`)을 미러한 **순수 함수** `monsterRoamAt(seed, polygon, bbox, frameEdge, scale, t0, t)` — cycle은 `[dwell at wp_n]` 다음 `[roam wp_n → wp_{n+1}]`로 연쇄된다(연속 경로, 순간이동 없음).

```
seed, legDur(seed), dwellDur(seed)               // §3.2, monster당 고정(O(1))
cycle = legDur + dwellDur
local = max(0, t - t0)                            // t0 = roam 루프 시작(§3.6)
n = floor(local / cycle); within = local - n*cycle
wpN = monsterWaypoint(seed, …, n)

if within < dwellDur:                             // ── DWELL ──
  dwellAnim = DWELL_ANIMS[ mix(seed, 7000 + n) % 3 ]   // 무작위 {active,waiting,idle}, cycle별 re-roll
  return { pos: wpN, moving: false,
           displayedState: dwellAnim,
           direction: DIRECTIONS[ mix(seed, 9000 + n) % 8 ] ?? MVP_DIRECTION,  // dwell facing: cycle별 seeded 8-dir(없으면 south)
           tEnter: t0 + n*cycle }
else:                                             // ── ROAM ──
  wpN1 = monsterWaypoint(seed, …, n+1)
  p = (within - dwellDur) / legDur
  return { pos: lerp(wpN, wpN1, easeInOut(p)), moving: true,
           displayedState: 'roaming',
           direction: quantizeVector(wpN1.x - wpN.x, wpN1.y - wpN.y),  // §3.1-2 half-open 8-dir
           tEnter: t0 + n*cycle + dwellDur }
```

- **dwell anim 무작위(seeded)**: `mix(seed, 7000+n) % 3` → `{active, waiting, idle}` 중 하나. 같은 `(monster.key, n)` → 같은 anim(결정적, AC-05). cycle마다 re-roll되어 한 곳에서 work→대기→idle을 번갈아 연기한다.
- **roaming direction**: 이동 벡터의 8방향 quantize는 [[SPEC-301-camp-map-movement]] §3.1-2 half-open 버킷(`quantizeVector`)을 그대로 쓴다. 요청 direction 폴더가 manifest에 없으면 `south`로 강등([[SPEC-300-asset-rendering]] §3.2-4 위임).
- **`displayedState`/`direction`/`tEnter`는 [[SPEC-301-camp-map-movement]] `MotionSnapshot`을 미러**한다: `tEnter`는 현재 anim state로 전이한 공유-clock 시각(frame phase anchor, [[SPEC-301-camp-map-movement]] §2.7), `displayedState ∈ {roaming, active, waiting, idle}`(error는 §3.7에서 상위 합성).

### 3.6 MonsterController (sync/tick + snapshot, 결정성 경계)

[[SPEC-301-camp-map-movement]] `RoamingController`(`web/src/scene/roaming.ts`)의 "변이는 `sync/tick`에서만, `snapshot(t)`는 순수 read" 패턴을 따른다. 단 입력에 **orc footprint stream**이 추가되고, **error 래치**라는 명시적 상태머신이 얹힌다.

```ts
interface MonsterState {
  seed: number;            // mix(monster.key)
  polygon: Vec2[]; bbox: Rect; frameEdge: number; scale: number;
  t0: number;              // roam 루프 시작(첫 sync 시각)
  pausedAccum: number;     // error로 멈춘 누적 ms(루프 clock에서 제외 → resume 시 순간이동 없음)
  error: boolean;          // 래치된 error
  errorEnterT: number;     // error 진입 시각(ERROR_MIN_MS + tEnter)
  cooldownUntil: number;   // resume 후 재트리거 금지 종료 시각(t < cooldownUntil이면 overlap 무시)
  haltPos: Vec2;           // error 동안 동결 위치
  faceDir: string;         // 가장 가까운 침범 orc 향 8-dir(없으면 south)
  lastT: number;           // 직전 tick 시각(paused 누적용)
}

class MonsterController {
  // 활성 배경/variant/polygon/scale을 적용. monster.key 또는 polygon이 바뀌면(배경 전환) state 전체를
  // 리셋(t0=t, pausedAccum=0, error=false, cooldownUntil=0, lastT=t) → 새 배경에서 spawn부터 재시작.
  // 같은 monster.key·polygon이면 기존 state 유지(roam 위상 보존). reduced-motion flag 저장.
  sync(monster: MonsterDef | null, ground: GroundContext | null, t, { reducedMotion }): void;

  // 매 공유-clock tick: orc footprint와 t로 error 래치 + 루프 clock(pausedAccum)을 갱신(변이).
  tick(orcFootprints: Rect[], t: number): void {
    const dt = Math.max(0, t - state.lastT); state.lastT = t;
    if (reducedMotion || !monster) return;                 // §3.10
    const lt = t - state.t0 - state.pausedAccum;           // 루프 clock(=error 제외)
    const cur = state.error ? state.haltPos : monsterRoamAt(…, lt).pos;
    const mfp = footprintBox(cur, frameEdge, scale, MONSTER_FOOTPRINT_RATIO);
    const hits = orcFootprints.filter(o => overlap(mfp, o));
    if (state.error) {
      state.pausedAccum += dt;                             // 루프 일시정지(lt 동결 → haltPos 유지)
      if (hits.length > 0) state.faceDir = faceNearest(cur, hits);   // 침범 orc 추적
      if (t - state.errorEnterT >= ERROR_MIN_MS) {         // ── resume: overlap 지속과 무관하게 해제 ──
        state.error = false;
        state.cooldownUntil = t + ERROR_COOLDOWN_MS;       // 즉시 재트리거 금지(걸어서 벗어남)
      }
    } else if (hits.length > 0 && t >= state.cooldownUntil) {  // ── 진입(rising-edge, cooldown 밖) ──
      state.error = true; state.errorEnterT = t; state.haltPos = cur;
      state.faceDir = faceNearest(cur, hits);              // 8-dir(없으면 south)
    }
    // cooldown 중(t < cooldownUntil) overlap은 무시 → 몬스터가 orc를 지나쳐 계속 roaming(liveness)
  }

  // 순수 read(렌더 ref 갱신용). error면 동결 frame을, 아니면 roam/dwell frame을 반환.
  snapshot(t: number): MonsterSnapshot | null {
    if (reducedMotion) return { renderedPos: spawn, displayedState: 'idle', direction: 'south', tEnter: t0 };
    if (!monster) return null;
    if (state.error) return { renderedPos: state.haltPos, displayedState: 'error',
                              direction: state.faceDir, tEnter: state.errorEnterT };
    const lt = t - state.t0 - state.pausedAccum;
    const f = monsterRoamAt(…, lt);                        // §3.5
    return { renderedPos: f.pos, displayedState: f.displayedState, direction: f.direction, tEnter: f.tEnter };
  }
}
interface MonsterSnapshot { renderedPos: Vec2; displayedState: 'roaming'|'active'|'waiting'|'idle'|'error'; direction: string; tEnter: number; }
```

- **결정성 경계(확정, 단 순수-`f(t)`는 아님)**: `monsterRoamAt`는 **순수 함수**다(같은 `seed`+`polygon`+`t0`+`t` → 같은 frame). 그러나 error 래치 + `pausedAccum`(연속시간 누적기) 때문에 controller 출력은 **임의 `t`만의 순수 함수가 아니다** — 코드베이스의 다른 mover(`roaming.ts`/`patrol.ts`/`wander.ts`)가 `snapshot(t)=f(seed,t)`인 것과 달리 본 controller는 **tick 재생이 필요한 첫 mover**다(누적기 보유). 결정성은 **래치 상태와 tick 입력 시퀀스를 입력의 일부로 포함**해 성립한다 — 즉 **같은 `seed`+`polygon`+`scale`+`ERROR_MIN_MS`+`ERROR_COOLDOWN_MS` + 동일한 `tick(orcFootprints_i, t_i)` 시퀀스 → 같은 `MonsterState` → 같은 `snapshot` 출력**([[SPEC-302-mascot-prestige-tiers]] §3.2 latch 결정성 경계와 동형). orc footprint stream 자체가 결정적(orc 위치는 INV-1)이므로 전체 파이프라인이 결정적이다. **frame-rate 독립성**: resume 지점은 `pausedAccum`이 흡수하므로 cadence와 무관하고, 잔여 오차는 tick 1틱(≈16.7ms) 이내다. (forward: error 에피소드를 `[startLt,endLt]` 구간으로 저장해 `lt`를 해석적으로 계산하면 순수-`f(t)`로 환원 가능 — §6 Q.)
- **순간이동 방지**: error 동안 `pausedAccum`이 `dt`만큼 증가해 `lt`가 동결되므로 resume 시 루프가 멈춘 지점에서 이어진다. `t0`/`pausedAccum`/`error`/`cooldownUntil`만 변이하고 좌표는 결코 데이터로 수신되지 않는다(INV-1).
- **lifecycle/reset(확정)**: `sync`에서 `monster.key` 또는 `polygon`(배경 전환)이 바뀌면 `MonsterState` 전체를 리셋한다(`t0=t`, `pausedAccum=0`, `error=false`, `cooldownUntil=0`, `haltPos`/`faceDir` 초기화) → 새 배경에서 spawn(waypoint 0)부터 재시작. 동일 `key`+`polygon`이면 state를 유지해 roam 위상을 보존한다(불필요한 재시작 깜빡임 방지, [[SPEC-302-mascot-prestige-tiers]] §3.2 reset 트리거 명시성과 동급). reduced-motion 토글은 state를 리셋하지 않고 `tick`이 §3.10대로 정지/재개만 한다(AC-17).

### 3.7 orc-intersection → error 래치 (halt·facing·debounce·resume)

> **⏸ Phase 2 (이후 적용 예정 — 현재 미적용)**: Phase 1은 orc 교차 시 `error`를 재생하지 않고 그대로 roaming을 지난다(§3 적용 단계). 아래는 Phase 2에서 켜질 error 설계다.

1. **판정(§3.3)**: 매 tick에 몬스터 footprint와 **각 orc footprint**(orc `renderedPos` = `RoamingController.snapshot`의 순수 read)를 AABB overlap한다. O(orcs)(§3.11).
2. **진입(rising-edge latch)**: error가 아니고 **cooldown 밖**(`t ≥ cooldownUntil`)일 때 한 마리라도 overlap → `error=true`로 래치, **그 자리에서 정지**(`haltPos`), `error` anim 재생, 가장 가까운 침범 orc 방향으로 **8-dir facing**(`faceNearest` = `quantizeVector(orcCenter − monsterAnchor)`; **동거리 tie-break = orcCenter.x 오름차순 → y 오름차순**으로 결정적 선택, footprint에 id가 없어도 기하만으로 deterministic; 후보 없음 같은 경계는 `south` fallback). cooldown 중 overlap은 무시한다(아래 5).
3. **고정 지속 + resume(stuck 방지)**: error는 **정확히 `ERROR_MIN_MS` 동안** 유지된 뒤 **overlap 지속 여부와 무관하게 해제**된다(붐비는 camp에서 정지한 몬스터로 orc가 걸어들어와 latch를 무한 연장하던 결함 제거). 해제 시 `cooldownUntil = t + ERROR_COOLDOWN_MS`를 설정해 즉시 재트리거를 막는다. (이전의 "overlap 해소 AND 경과" 양조건은 liveness를 깨므로 폐기.)
4. **resume 연속성**: 복귀 시 `pausedAccum`이 error 지속을 흡수했으므로 **멈춘 waypoint 진행에서 연속 재개**(§3.6). resume 직후 몬스터는 여전히 겹쳐 있어도 cooldown 동안 roam을 진행해 orc를 **걸어서 지나친다**. error 중 facing은 매 tick 가장 가까운 침범 orc로 갱신(여러 orc가 번갈아 침범해도 결정적으로 가장 가까운 쪽).
5. **liveness 보장(전체영역 roaming 목표)**: error duty cycle ≤ `ERROR_MIN_MS/(ERROR_MIN_MS+ERROR_COOLDOWN_MS)` ≈ 37.5% → 몬스터는 시간의 **≥62.5%를 roaming**하므로 붐비는 camp에서도 walkable 전체를 계속 순회한다(AC-16). (대안 forward: footprint에 orc id를 실어 "새로 겹친 orc"에만 재트리거 — 현재는 id-free time-cooldown으로 hard bound 확보, §6 Q.)
6. **error의 합성 우선순위**: `error`는 dwell/roam보다 우선한다(snapshot이 error면 roam/dwell을 무시하고 동결). overlay/precedence의 **렌더** 합성은 [[SPEC-300-asset-rendering]]이 소유(본 spec은 state 선택만).

### 3.8 non-interactivity / non-load-bearing (INV-NI / INV-NLB)

- **pointer-events: none** — 클릭/hover/drag가 몬스터를 통과해 뒤의 orc/빈 공간에 도달한다(빈 공간 클릭 해제·drag-pan을 막지 않음, [[SPEC-301-camp-map-movement]] §2.6c). selection marker/inspector/`?orc=` 라우팅 대상 아님.
- **tab order/keyboard nav 제외** — roving-tabindex 그룹([[SPEC-301-camp-map-movement]] §2.7)에 들어가지 않는다. focus 불가.
- **표시 요소 없음** — status label/overlay/raw `tmuxTarget`/activity·ambient speech bubble을 갖지 않는다(데이터 비운반).
- **orc 모델·layout에서 제외** — orc 데이터 모델, `computeCells`/grid(§2.4b), station/slot, zero-layout-shift 불변식의 **입력이 아니다**. 몬스터 추가/제거가 어떤 orc의 target/cell/slot/렌더 위치도 바꾸지 않는다(AC-10). 몬스터는 절대 위치 overlay 1개일 뿐 layout box를 만들지 않는다(CLS=0).

### 3.9 z-order / depth ([[SPEC-301-camp-map-movement]] §2.7 z-stack)

- **공통 불변(확정)**: 몬스터는 **항상 status overlay/status label/raw target/selection marker/speech bubble(z-stack ⑧–⑪) 아래**에 그려지고 `pointer-events:none`이다 → 어떤 orc의 상태/식별 텍스트·선택도 가리거나 가로채지 않는다([[SPEC-202-design-accessibility]] A7/R4, INV-4). 몬스터는 자기 ground shadow(§2.7 ④)를 받는다.
- **MVP fallback(권장 1차 구현)**: shadow(④)와 terminated edge sprite(⑤) 사이에 **전용 몬스터 레이어**를 두어 **항상 모든 orc sprite(⑥) 뒤**에 그린다. y-sort 통합 비용 0, 어떤 orc도 가리지 않음(큰 생물이 공간상 앞이어도 뒤에 그려지는 약한 depth 부정확은 허용).
- **목표(향후)**: 몬스터를 active sprite(⑥)와 **동일 baseline y-sort 버킷**에 넣어 ground-anchor y로 정렬한다(orc 뒤·앞이 깊이대로). 동률 y에서는 몬스터를 **orc 뒤**로(비-상호작용 거대 sprite가 orc를 시각적으로 덮지 않도록). 어느 경우든 ⑧–⑪은 몬스터 위에 유지된다.

### 3.10 reduced-motion ([[SPEC-202-design-accessibility]] AC-11 정합)

- `prefers-reduced-motion: reduce`면 몬스터는 **단일 정적 frame(`idle`, `south`)** 만 그린다(자산은 [[SPEC-300-asset-rendering]] `reduced_motion.fallback_frame`). roam/dwell cycle·error 애니메이션·facing 갱신을 **시작하지 않는다**.
- 정적 위치 = 결정적 spawn(`monsterWaypoint(seed, …, 0)`; 재샘플 실패 시 §3.4 safe_area-center fallback) — 동일 seed/polygon → 동일 위치. movement-off 경로와 정합([[SPEC-301-camp-map-movement]] §1·§3.1-7).

### 3.11 성능 ([[SPEC-301-camp-map-movement]] §3.3 budget 비-가산)

- scene당 **+1 애니메이션 sprite**(100-sprite 예산 대비 무시 가능, ~1%). per-monster `setInterval`/RAF **0건** — orc와 **동일 공유 clock**으로 frame/보간 구동([[SPEC-301-camp-map-movement]] §2.7, AC-13 패턴).
- overlap 판정 = tick당 **O(orcs)** AABB(가벼움). off-screen 시 [[SPEC-301-camp-map-movement]] §3.3-3 가시영역 tick 게이트에 함께 포함될 수 있다.
- error/roam은 §3.5 §3.7대로 순수 함수 + 작은 상태머신이라 long-task를 만들지 않는다. §3.3 sprite 애니메이션 budget에 실질적으로 가산하지 않는다(AC-13).

### 3.12 placeholder / non-load-bearing (INV-NLB)

- 자산 미가용(variant 링크 없음 / 엔트리 없음 / `status:"planned"` / `pixellab_character_id:null` / `ground.polygon` 없는 배경) → **그냥 렌더하지 않는다**. orc처럼 placeholder box를 그리지 **않는다**(monster는 정보 비운반 → placeholder parity에서 면제되는 유일한 scene 요소).
- 미렌더든 렌더든 **layout 영향 0**(§3.8). 자산이 나중에 들어오면(`status:"available"`+id) 동일 거동으로 자동 등장한다(schema-first forward-compatible).

## 4. Acceptance criteria

> 각 AC는 고정 fixture(활성 배경 key·`ground.polygon`·monster seed·orc `renderedPos[]`·공유 clock `t`·필요 시 `prefers-reduced-motion`)(Given) → 몬스터 controller 산출(When) → 좌표/상태/전이/비간섭(Then)으로 검증한다. 모두 결정적·순수다.

- **SPEC-303-AC-01** (R-UI-010) — variant resolution·scene당 1마리
  - Given 활성 배경 key별 fixture: 정방향 링크 있는 `orccamp-default`/`froststeel`/`emberforge`/`necropolis`/`mirebog`; 정방향 링크는 없지만 `monsters[k].background`만 가리키는 배경(역탐색 케이스); `ground.polygon` 없는 `warbase-sunset-dashboard`; manifest에 없는 미등록 `sunscorch`에서
  - When `resolveMonster`(2-step, §3.1)를 호출하면
  - Then 정방향 링크 배경은 roster의 정확히 1개 variant로 해석되고(`orccamp-default→monster-mosshide-behemoth`, `mirebog→monster-bog-leviathan` 등), 정방향 링크가 없어도 `background` 역탐색으로 **동일 variant**가 해석되며(1-step·2-step 결과 일치), polygon 없는/미등록/링크·역탐색 모두 없는 배경은 `null`(미렌더)이고, scene당 monster는 최대 1마리다.

- **SPEC-303-AC-02** (R-UI-010, INV-NLB) — 자산 미가용 → 미렌더(placeholder 없음·layout 비교란)
  - Given variant가 `status:"planned"` 또는 `pixellab_character_id:null`인 fixture, 그리고 동일 orc 집합에 대해 monster 유/무 두 fixture에서
  - When 렌더 입력을 산출하면
  - Then 미가용 variant는 **렌더되지 않고 placeholder box도 생성되지 않으며**(orc parity와 대비), monster 유/무가 모든 orc의 target/cell/slot/`renderedPos`를 **동일**하게 유지한다(layout 비교란, CLS=0).

- **SPEC-303-AC-03** (R-UI-010, R-UI-008, INV-1) — full-polygon roaming + footprint clamp(safe_area 대비)
  - Given `orccamp-default` polygon + monster seed fixture에서 여러 cycle의 waypoint를 산출할 때
  - When `monsterWaypoint`/`monsterRoamAt`를 호출하면
  - Then 모든 waypoint의 **footprint 4코너 + 중심이 `pointInPolygon`** 이고(발자국이 polygon 내부), 일부 waypoint는 orc의 내접 `safe_area` rect **밖**의 polygon 영역에 존재하며(= polygon 전체 사용, safe_area보다 넓음), 재샘플 실패 시 fallback(`safe_area` 중심 clamp, §3.4)도 **footprint 4코너+중심이 polygon 내부**다(점만이 아니라 발자국 전체).

- **SPEC-303-AC-04** (R-UI-010, INV-1) — deterministic seeded waypoint sequence
  - Given 동일 `(seed, polygon)`로 `monsterWaypoint(…, k)`를 k=0..N 반복 호출할 때
  - When 두 번 산출해 비교하면
  - Then 두 시퀀스가 동일하고(순수·결정적, `Math.random`/`Date.now` 없음), 서로 다른 seed는 서로 다른 시퀀스를 만들며, waypoint 0(spawn)도 결정적이다.

- **SPEC-303-AC-05** (R-UI-010, R-P1-004) — 무작위 dwell anim 선택 결정성
  - Given `(seed, cycleIndex n)` fixture에서
  - When dwell anim을 선택하면
  - Then `DWELL_ANIMS[mix(seed,7000+n)%3] ∈ {active,waiting,idle}` 이고 같은 `(seed,n)`은 같은 anim(결정적), 연속 cycle은 re-roll되어 한 자리에서 anim이 바뀌며, dwell facing은 cycle별 seeded 8-dir(없으면 south)이다.

- **SPEC-303-AC-06** (R-UI-010, R-P1-004) — roam→dwell→roam FSM·MotionSnapshot 도출
  - Given monster가 cycle n의 dwell 구간과 roam 구간에 걸치는 `t` fixture에서
  - When `monsterRoamAt(t)`를 산출하면
  - Then dwell 구간은 `displayedState ∈ {active,waiting,idle}`·`moving=false`·`pos=wp_n`·`tEnter=t0+n·cycle`, roam 구간은 `displayedState='roaming'`·`moving=true`·`pos=lerp(wp_n,wp_{n+1})`·`tEnter=t0+n·cycle+dwellDur`이며, cycle 경계에서 경로가 연속(순간이동 없음)이다.

- **SPEC-303-AC-07** (R-UI-010, R-P1-004, [[SPEC-301-camp-map-movement]] §3.1-2 정합) — roaming 8-dir quantize·south fallback
  - Given roam leg의 이동 벡터가 8버킷 중심·경계(±22.5°의 배수) fixture에서
  - When direction을 산출하면
  - Then [[SPEC-301-camp-map-movement]] half-open 버킷(`quantizeVector`)으로 양자화되어 manifest direction 폴더에 매핑되고, 경계 각도는 결정적으로 상위 버킷에 귀속되며, 해당 폴더가 없으면 `south`로 강등된다.

- **SPEC-303-AC-08** (R-UI-010) — orc-intersection → error 래치·halt·facing
  - Given monster footprint가 한 orc footprint와 overlap하는 `t` fixture에서
  - When `tick(orcFootprints,t)` 후 `snapshot(t)`를 읽으면
  - Then `displayedState='error'`, `renderedPos`가 overlap 시점 위치에 **동결(halt)**, `direction`이 가장 가까운 침범 orc 향 8-dir(후보 경계 없음 시 `south`)이다. overlap이 전혀 없으면 error에 진입하지 않는다.

- **SPEC-303-AC-09** (R-UI-010) — error 고정 지속(`ERROR_MIN_MS`)·cooldown·resume 연속성
  - Given overlap이 `ERROR_MIN_MS` 내내 지속되는 fixture, 그리고 `ERROR_MIN_MS` 경과 직후 다시 overlap하는 fixture에서
  - When tick을 진행하면
  - Then error는 진입 후 **정확히 `ERROR_MIN_MS`** 유지된 뒤 **overlap 지속과 무관하게** 해제되고 `cooldownUntil=t+ERROR_COOLDOWN_MS`가 설정되며, cooldown 동안 overlap은 재트리거를 일으키지 않고(flicker/stuck 없음), resume 후 `renderedPos`는 멈춘 waypoint 진행에서 **연속**(pausedAccum 흡수 → 순간이동 없음)이다.

- **SPEC-303-AC-10** (R-UI-010, INV-NI, INV-NLB) — non-interactivity·orc 배치 비교란
  - Given monster가 있는 scene fixture에서
  - When 입력 모델·렌더 트리를 검사하면
  - Then monster는 `pointer-events:none`·tab order 제외·selection/inspector/overlay/label/bubble 없음이고, orc 데이터 모델·`computeCells`/grid 입력에서 제외되며, monster 유/무가 orc 배치(target/cell/slot/renderedPos)·CLS을 바꾸지 않는다(AC-02와 정합).

- **SPEC-303-AC-11** (R-UI-010, [[SPEC-202-design-accessibility]] A7/R4 정합) — z-order·interaction 비가림
  - Given monster + orc + status overlay/label/raw target/selection marker/bubble fixture에서
  - When z-순서를 검사하면
  - Then monster는 status overlay/label/raw target/selection marker/bubble(z-stack ⑧–⑪) **아래**에 그려지고 `pointer-events:none`이라 어떤 orc의 상태/식별 텍스트·선택도 가리거나 가로채지 않으며, MVP 구현에서는 모든 orc sprite 뒤(④와 ⑤ 사이) 레이어에 놓인다.

- **SPEC-303-AC-12** (R-UI-010, [[SPEC-202-design-accessibility]] AC-11 정합) — reduced-motion 정지
  - Given `prefers-reduced-motion: reduce` fixture에서
  - When monster를 렌더하면
  - Then 단일 정적 frame(`idle`, `south`)을 결정적 spawn 위치에 표시하고 roam/dwell cycle·error 애니메이션·facing 갱신을 **시작하지 않는다**.

- **SPEC-303-AC-13** (R-UI-010, 비기능 성능, [[SPEC-301-camp-map-movement]] §3.3 정합) — 성능 비-가산·공유 clock
  - Given 100-pane scene + monster 1마리 fixture에서
  - When 렌더 루프·overlap 판정을 검사하면
  - Then monster는 per-monster 타이머/RAF 0건으로 **공유 clock**에서 구동되고, overlap 판정이 tick당 **O(orcs)** 이며, §3.3 sprite 애니메이션 budget(AC-11)에 실질 비용을 더하지 않는다(CLS=0·단일 clock sub-assertion은 게이트 가능).

- **SPEC-303-AC-14** (R-UI-010, R-UI-008) — 배경별 feasibility·necropolis reduced scale
  - Given 등록된 5 배경 polygon(`orccamp-default`/`froststeel`/`emberforge`/`mirebog`/`necropolis`) fixture에서
  - When 채택 scale(default 0.9, necropolis 0.65)로 footprint feasible 영역(footprint 4코너+중심 in-polygon)을 측정하면
  - Then 모든 배경에서 feasible 영역이 **비어있지 않고**(§3.4 표), `necropolis-camp`는 `MONSTER_SCALE_NECROPOLIS=0.65`로 footprint(≈166px)·full sprite(≈333px)가 최소 polygon에 여유 있게 들어가며, `mirebog-camp`(ratio 0.3274)를 포함한 나머지는 0.9로 충분하다(feasible bbox 수치는 estimate; 측정 fixture 권장 — §6 Q).

- **SPEC-303-AC-15** (R-UI-010, INV-1) — controller 결정성 경계(래치 포함)
  - Given 동일 `(seed, polygon, scale, ERROR_MIN_MS)`와 동일한 `tick(orcFootprints_i, t_i)` 시퀀스를 두 번 적용할 때
  - When `snapshot(t)`를 비교하면
  - Then 두 실행이 동일한 `MonsterState`와 동일한 snapshot 출력을 내고(latch 상태를 입력의 일부로 포함하면 순수·결정적), orc footprint stream이 결정적이므로 전체 파이프라인이 결정적이며, snapshot/WS/Orc 어디에도 monster·좌표 필드가 존재하지 않는다(INV-1).

- **SPEC-303-AC-16** (R-UI-010, INV-1) — 다중-orc 밀집에서 roaming liveness(전체영역 목표)
  - Given walkable 전역에 분산된 다수 orc(예: cell 그리드를 채운 fixture) + 몬스터 경로가 반복 교차하는 장시간 `tick` 시퀀스에서
  - When 충분히 긴 구간의 tick을 진행하면
  - Then error 누적 시간 비율이 `ERROR_MIN_MS/(ERROR_MIN_MS+ERROR_COOLDOWN_MS)`(≈37.5%) 이하로 bound되고, 몬스터는 시간의 ≥62.5%를 `roaming`/dwell로 진행하며 정지(stuck)하지 않고 polygon의 서로 다른 영역을 계속 방문한다(§3.7-5 — "전체 walkable 영역 roaming" 목표 보존).

- **SPEC-303-AC-17** (R-UI-010, INV-1) — controller lifecycle/reset
  - Given 동일 `monster.key`+`polygon` 연속 `sync` → `monster.key`/`polygon`이 바뀌는(배경 전환) `sync` → reduced-motion 토글 fixture에서
  - When 각 `sync`/`tick`을 적용하면
  - Then 동일 key+polygon `sync`는 state(roam 위상)를 유지하고, key/polygon 변경 `sync`는 `MonsterState`를 리셋해 spawn(waypoint 0)부터 재시작하며(`t0=t`,`pausedAccum=0`,`error=false`,`cooldownUntil=0`), reduced-motion 토글은 state를 리셋하지 않고 §3.10대로 정지/재개만 한다.

## 5. Traceability

| 요구사항/결정 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| **R-UI-010** (epic monster ambient NPC) | 배경별 variant resolution(2-step)·full-polygon roaming·무작위 dwell FSM·orc-intersection→error(rising-edge·cooldown·liveness)·비-상호작용/비-load-bearing·z-order·reduced-motion·lifecycle·성능 | SPEC-303-AC-01~17 |
| **D-037** (epic monster 결정) | 비-상호작용·full-polygon roaming·error-on-intersection·non-load-bearing·생성 deferred 선택을 본 spec이 구체화 | SPEC-303-AC-01/02/03/08/12/16 |
| R-P1-004 (sprite variant·animation) | status-less FSM(roaming/active/waiting/idle/error) animation 적용·8-dir roaming·dwell anim 무작위·reduced-motion 정지 | SPEC-303-AC-05/06/07/12 |
| R-UI-008 (활동의 공간 표현·client-derived 결정성) | 좌표=`monster id + clock + polygon`의 결정적 함수, 서버 좌표 불추가(INV-1) | SPEC-303-AC-03/04/14/15/16/17 |
| INV-NLB / R-UI-006 대비 | monster는 placeholder parity **면제**(미가용→미렌더) — orc parity와 명시 대비 | SPEC-303-AC-02 |

**크로스링크**: [[SPEC-301-camp-map-movement]](image-ground world·polygon·safe_area·공유 clock·z-stack·orc roaming controller 패턴), [[SPEC-300-asset-rendering]](monster render contract·FSM state→animation·error overlay·미가용→미렌더), [[SPEC-302-mascot-prestige-tiers]](latch 결정성 경계 동형), [[16-Epic-Monster-NPC]](512 base contract·5 애니메이션 prompt·manifest `monsters` 스키마·생성 runbook), [[background-tile-merge-guide]] §6(배경별 art concept), [[SPEC-202-design-accessibility]](A7·AC-11), [[SPEC-005-data-contract]](INV-1 데이터 불변).

**의존성·forward**:
- **자산(blocker for visual)**: 6 variant 512 base + 5 애니메이션 생성([[16-Epic-Monster-NPC]]) + manifest `monsters`/`backgrounds.<bg>.epic_monster` 반영(asset pack v0.2.x). 미생성 시 §3.12로 미렌더(거동 schema는 동작).
- **생성 경로**: MCP 인증 확인됨(2026-06-29). 512는 **PixelLab 웹 UI 생성**(MCP `create_character` size≤128) → export zip import → manifest `status:"available"` 반영([[16-Epic-Monster-NPC]] §2/§5, [[13-PixelLab-Asset-Registry]]).
- **배경(blocker for mirebog/sunscorch monster)**: 두 테마 배경 manifest 등록 + ground-ratio 게이트 통과([[SPEC-301-camp-map-movement]] §2.8f). 등록 전까지 해당 monster는 자연 미렌더.
- **런타임 구현**: `web/src/scene/`에 `MonsterController`(§3.6) 신규 + `CampMap`이 활성 배경 variant를 resolve해 공유 clock에 연결(별도 비-상호작용 sprite 레이어). [[SPEC-300-asset-rendering]] render contract 소비.

## 6. Open Questions / manifest 충돌

### manifest 충돌 기록

- (없음 — 본 spec 작성 시점 manifest에 `monsters` 블록·`backgrounds.<bg>.epic_monster` 링크 미반영. asset-runtime-engineer가 [[16-Epic-Monster-NPC]] 스키마로 추가 시 본 절에 roster 키/scale 일치 여부를 기록한다.)

### Open Questions (검토 필요)

- **Q1 — z-order: y-sort vs MVP behind-orcs (검토 필요)**: §3.9는 MVP로 "항상 orc 뒤"를 권장하고 목표로 "baseline y-sort 동률 시 orc 뒤"를 둔다. 거대 sprite가 공간상 앞일 때의 depth 정확도와 구현 비용 trade-off는 product-ui-designer/product-frontend-architect와 정합 필요. 어느 경우든 ⑧–⑪ 비가림·`pointer-events:none`은 불변.
- **Q2 — per-cycle leg/dwell duration 변동 (검토 필요)**: 현재 leg/dwell duration은 monster당 고정(O(1), `patrolAt` 미러)이고 무작위성은 waypoint·dwell anim의 cycle별 re-roll로 표현한다. cycle별 duration 변동(더 자연스러운 리듬)은 누적합이 필요해 O(1) 순수성을 깨므로 forward(고정 cycle 테이블 또는 누적합 캐시). 비-blocker.
- **Q3 — footprint geometry: AABB vs ellipse (검토 필요)**: overlap을 AABB로 정의(O(1)·정확·테스트 용이)했다. ground 접지면은 본래 타원(shadow `footprint_ratio` 0.46)에 가까우므로 ellipse 정밀화가 시각적으로 더 맞을 수 있으나 판정 비용/복잡도가 오른다. 튜닝 대상.
- **Q4 — `MONSTER_SCALE`/footprint/속도/error 임계 (가설)**: §3.2 상수(scale 0.9/0.65, footprint_ratio 0.5, speed 90, leg/dwell, `ERROR_MIN_MS` 1200)는 가설이며 시각·성능 보정 대상. necropolis 0.65는 §3.4 측정 근거가 있으나 art 최종본에서 재확인 필요.
- **Q5 — R-UI 신규 id 충돌(검토 필요·플래그)**: 본 spec은 **R-UI-010**을 사용한다. `R-UI-009`는 [[SPEC-301-camp-map-movement]] §6 C5 / [[SPEC-900-traceability-rollup]] §6 C2가 **image-ground 정식 승격용으로 예약(proposed, 미반영)**해 둔 id라 충돌을 피해 R-UI-010을 택했다. 두 제안 모두 02-Requirements 미반영이므로 orchestrator가 image-ground를 R-UI-009로 정식 채택할 때 본 spec의 R-UI-010과 함께 정렬하면 된다. (마찬가지로 [[SPEC-301-camp-map-movement]] §6 C5의 "D-036(image-ground)" 제안은 이미 mascot prestige tier가 D-036을 점유해 **stale**이며, 본 spec은 다음 free id **D-037**을 사용한다.)
