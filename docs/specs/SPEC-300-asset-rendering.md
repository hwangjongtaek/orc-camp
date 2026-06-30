---
spec: SPEC-300
title: 런타임 asset 소비·sprite 상태머신·fallback
status: approved
updated: 2026-06-29
requirements: [R-UI-003, R-UI-006, R-P1-004, R-P1-005]
decisions: [D-007, D-009, D-013]
tags:
  - specs
  - asset
  - render
  - sprite
  - scene
  - terrain
  - frontend
---

# SPEC-300 — 런타임 asset 소비·sprite 상태머신·fallback

이 spec은 dashboard 런타임이 **완성된 asset pack(`asset-packs/orc-camp-default/manifest.json`)을 소비해 orc sprite를 상태 기반으로 렌더**하는 계약을 고정한다. asset *생성*은 종료됐고([[13-PixelLab-Asset-Registry]] ledger, manifest `generation_status.state="closed"`), 본 spec은 *소비/렌더*만 다룬다.

입력은 [[SPEC-005-data-contract]]가 만든 `Orc`(특히 `agentType`·`status`·`statusConfidence`)와 `asset-packs/orc-camp-default/manifest.json`이다. 본 spec은 그 위에 ① manifest resolution(frame_size/anchor/fps/state·direction 폴더), ② `agentType→character` / `status→animation state` / `status→effect overlay` 매핑, ③ sprite 상태머신(전이·frame 재생·`terminated` lifecycle), ④ `prefers-reduced-motion` freeze, ⑤ asset 누락 시 placeholder fallback을 정의한다.

> **SSOT 불변식(확정, [[08-Decisions|D-013]])**: 런타임 asset 사양의 단일 진실원은 `asset-packs/orc-camp-default/manifest.json`이다. 평면 spritesheet(옛 64×64 가정)·고정 frame count·고정 path를 가정하지 않는다. frame_size/anchor/scale/`fps`/`frames`/state·direction 폴더/`reduced_motion.fallback_frame`은 **manifest에서 resolve**한다. manifest와 본문이 충돌하면 manifest를 따르고 §6에 기록한다.

> 본 spec은 scene **배치**·선택·screen 상태가 아니라 **sprite 및 scene asset(terrain·backdrop·decor·shadow) 렌더 메커니즘**을 소유한다(§2.5/§2.6/§3.9). scene의 **공간 배치**(어디에·어떤 지형 타입·어디에 scenery·parallax·z 레이어 순서)는 [[SPEC-301-camp-map-movement]] §2.7/§2.8이 소유한다(소유 분담: SPEC-300=asset resolve·타일 선택·이미지 fit·shadow shape / SPEC-301=world 좌표·결정적 terrain field·scenery scatter·parallax·z·lighting). scene layout/selection/empty·loading 화면은 [[SPEC-201-dashboard-screens]], 디자인 토큰·키보드·접근성 라벨은 [[SPEC-202-design-accessibility]], asset 패키징·license 강제는 [[SPEC-700-packaging-release]] 소유다.

## 1. Scope

### In scope

- **manifest resolution**: character key별 `frame_size`/`anchor`/`scale` 해석(3가지 frame size 232/228/236 처리), state별 `fps`/`frames`/`frame_pattern`, `animations/<state>/<direction>/frame_%03d.png` 폴더-frame 경로 조립, `reduced_motion.fallback_frame` 해석.
- **매핑 계약**: `agentType → character key`, `status(7종) → animation state`, `status → effect overlay(objects/status-ui)`.
- **sprite 상태머신**: orc `status` 변화 시 animation state 전이, manifest `fps`로 frame 시퀀스 loop 재생, `idle`/`active`/`waiting`/`error`/`stale` 재생, `terminated` lifecycle(정적 fallback frame + ghost overlay, death/fall 애니메이션 금지), `unknown` 처리.
- **reduced motion**: `prefers-reduced-motion`에서 각 character `reduced_motion.fallback_frame` 고정(frame 진행 없음).
- **placeholder fallback(R-UI-006, [[08-Decisions|D-007]])**: asset 미탑재/character key/frame 누락 시 CSS pixel placeholder, layout size는 manifest `frame_size`로 고정, 동일 layout/interaction 유지.
- **direction/state fallback**: 요청 direction/state 부재 시 `south`/`idle`로 강등(mascot `error`는 south-only 등).
- **character fallback chain**: character key 미해석 시 `orc-high-warchief-mascot`(universal mascot) → placeholder.
- **license 게이트(미해소, [[08-Decisions|D-009]])**: 런타임은 asset pack을 **로컬 경로에서 참조만** 하고, 외부 재배포(npm 번들)는 license 확정 전까지 하지 않는다([[SPEC-700-packaging-release]] 공동).
- **scene asset 렌더 메커니즘(§2.5/§2.6/§3.9, image-ground 갱신)**: ① **단일 배경 이미지 full-cover 소비**(`scene.backdrop` → `backgrounds[ref].file`, image-ground = world 전체; corner-Wang 자동 타일링은 superseded), ② decor/scenery prop resolve(`scene.decor`, station/header 예약 prop 제외 — zone-grid fallback 한정), ③ per-sprite ground shadow resolve(CSS 타원 기본 / asset), ④ 이들의 manifest 선언 계약(§2.5)과 asset 누락 시 CSS fallback(§3.9, placeholder parity).
- **epic monster NPC 렌더(§2.7/§3.10, [[SPEC-303-epic-monster-npc]]·[[16-Epic-Monster-NPC]])**: active background의 512×512 boss 몬스터 variant를 `monsters` manifest에서 resolve해 **비-상호작용 단일 sprite 레이어**로 그린다. 표시 animation(`roaming`/`active`/`waiting`/`idle`/`error`)은 orc `status`가 아니라 [[SPEC-303-epic-monster-npc]] 컨트롤러가 정한다(status-less FSM). asset 미생성/누락 시 **렌더 생략**(non-load-bearing — orc placeholder parity와 다름).
- 다루는 요구사항: R-UI-003(scene 내 orc 렌더 + 입체 scene asset 렌더), R-UI-006(placeholder parity), R-P1-004(agent별 sprite variant·상태별 animation), R-P1-005(camp background/asset-pack 교체의 asset 소비 substrate — backdrop·tileset이 manifest/asset-pack 구동; 전환 UI 자체는 [[SPEC-500-settings-persistence]] forward).

### Out of scope (다른 spec으로)

| 항목 | 이유 | 소유 spec |
| --- | --- | --- |
| terrain field(어떤 cell이 어떤 지형)·backdrop/scenery/depth 레이어 **배치 좌표**·orc 배치 좌표·parallax·z-순서·lighting | scene 공간 배치 | [[SPEC-301-camp-map-movement]] §2.7/§2.8 (본 spec은 그 입력을 받아 asset만 그림) |
| selection marker·empty/loading 화면·비-scene(list/table) 표시 | scene 구성/화면 | [[SPEC-201-dashboard-screens]] (R-UI-001~005/007) |
| 디자인 토큰·focus·keyboard nav·status의 비-색상 라벨/aria | 디자인·접근성 | [[SPEC-202-design-accessibility]] (R-UI-006 접근성 비기능) |
| `status`/`agentType`/confidence **추론 규칙** | 데이터 산출 | [[SPEC-004-status-inference]] / [[SPEC-003-agent-detection]] |
| scan 출력 데이터 shape(`Orc` 필드·enum 직렬화) | 데이터 계약 | [[SPEC-005-data-contract]] |
| asset **생성**(PixelLab prompt/seed) | 생성 종료 | [[13-PixelLab-Asset-Registry]] (closed) |
| asset pack npm 번들·license 강제·doctor smoke | 패키징·배포 | [[SPEC-700-packaging-release]] (D-009) |
| `roaming`(이동) 애니메이션 활성화·8방향 movement | P1 movement | 본 spec §3.7 pre-flag, P1 |
| control 상징(`orc-iron-commander`, `interrupt-hand`) UI | control flow | [[SPEC-400-control-actions]] |

> **`roaming`·`terminated`는 status enum이 아니다(확정)**: status enum은 [[SPEC-004-status-inference]]의 7종(`active`/`waiting`/`idle`/`stale`/`error`/`unknown`/`terminated`)이다. `roaming`은 manifest에 존재하는 **시각(이동) animation state**일 뿐 status enum 값이 아니며 MVP에서 status로부터 진입하지 않는다(§3.2, §3.7). `terminated`는 status enum 값이지만 manifest상 전용 애니메이션이 없어 **idle 애니메이션으로 대체 재생**한다(#52; ghost overlay로 표식, reduced-motion에서는 정적; §3.3).

## 2. Contract

### 2.1 입력 — 소비 데이터

런타임 renderer는 아래 입력만 소비한다(추론·수집 없음).

```ts
// [[SPEC-005-data-contract]] Orc의 렌더 관련 subset (전체 필드는 SPEC-005)
interface OrcRenderInput {
  id: string;                 // "pane:%12" — 렌더 instance 식별(stable key). [[08-Decisions|D-017]]
  agentType: 'claude-code' | 'codex' | 'unknown';  // → character key (§2.3)
  status: 'active' | 'waiting' | 'idle' | 'stale' | 'error' | 'unknown' | 'terminated'; // → animation state (§2.3)
  statusConfidence: number;   // [0,1] — 색상/애니메이션만이 아닌 보조 표기에 활용(라벨은 SPEC-202)
  tmuxTarget: string;         // 표시 전용(렌더 식별엔 id 사용)
}

// 런타임 환경 신호
interface RenderEnvironment {
  manifest: AssetManifest | null;     // asset-packs/orc-camp-default/manifest.json (null=미탑재)
  assetBasePath: string;              // manifest.json이 위치한 pack root의 base URL/경로 (runtime config)
  prefersReducedMotion: boolean;      // window.matchMedia('(prefers-reduced-motion: reduce)')
}
```

- renderer는 어떤 tmux command도 호출하지 않고 어떤 capture 원문도 다루지 않는다(입력은 redaction 후 데이터, [[08-Decisions|D-016]]).
- `Orc`가 snapshot에서 사라지면 그 sprite instance(`id`)는 제거된다. `terminated` retention(짧게 남김)은 [[SPEC-004-status-inference]] §3.7/[[SPEC-005-data-contract]]가 소유하며, renderer는 **snapshot에 존재하는 orc만** 렌더한다.

### 2.2 manifest resolution 계약

manifest의 character entry 형태(실제 `manifest.json`):

```jsonc
"characters": {
  "<characterKey>": {
    "root": "sprites/<characterKey>/<Char>",          // pack root 기준 상대 경로
    "frame_size": [232, 232],                          // [w, h] — character마다 다름 (232/228/236)
    "anchor": [116, 175], "scale": 1,                  // 발 위치(실제 content 최하단) 기준점 — frame 내 px. 그림자도 이 앵커에 그려져 발에 밀착
    "directions": ["south","east","north","west","south-east","north-east","north-west","south-west"],
    "animations": {
      "<state>": { "frames": 7, "fps": 4, "frame_pattern": "frame_%03d.png",
                   "folders": { "south": "animations/.../south", ... },
                   "coverage": "south-only" /* 선택: 일부 state는 방향 일부만 */ },
      "terminated": { "coverage": "none", "runtime_behavior": "static fallback plus status effect only" }
    },
    "reduced_motion": { "fallback_state": "idle", "fallback_direction": "south",
                        "fallback_frame": "animations/.../south/frame_000.png" }  // root 기준 상대
  }
}
```

**경로 조립 규칙(확정)**:

| 산출 | 공식 |
| --- | --- |
| `packRoot` | `assetBasePath` (manifest.json이 위치한 디렉터리) |
| `characterRoot` | `packRoot + "/" + character.root` |
| frame 폴더 | `characterRoot + "/" + character.animations[state].folders[direction]` |
| frame 파일(i) | `<frame 폴더> + "/" + format(character.animations[state].frame_pattern, i)`, `i ∈ [0, frames-1]` |
| reduced-motion frame | `characterRoot + "/" + character.reduced_motion.fallback_frame` |
| status overlay 아이콘 | `packRoot + "/" + manifest.objects["status-ui"].root + "/" + items[<key>].file` (size `[64,64]`) |

- **frame count·fps는 항상 manifest에서 읽는다**: `frames`(보통 7, `roaming` 9)와 `fps`(idle 4 / active 8 / waiting 4 / error 6 / stale 3 / roaming 8). 코드에 하드코딩하지 않는다. `frame_pattern`은 `frame_%03d.png`(0-padding 3자리)이므로 7-frame이면 `frame_000.png`~`frame_006.png`이다.
- **frame_size는 character마다 다르다(확정 처리)**: `orc-high-warchief-mascot`/`orc-claude-storm-shaman`/`orc-codex-field-engineer` = `[232,232]` anchor `[116,175]`; `orc-unknown` = `[228,228]` anchor `[114,172]`; `orc-iron-commander` = `[236,236]` anchor `[118,176]`. layout 박스·anchor 배치는 **그 character의** frame_size/anchor를 쓴다(전역 상수 금지). **anchor y는 frame 내 실제 발 content 최하단(트림 측정값)에 맞춘다** — 과거 anchor가 빈 패딩(예 208/204/212)에 있어 sprite·그림자가 발보다 ~30px 아래에 놓여 "공중부양"처럼 보이던 버그를 수정했다.
- **렌더 스케일(확정)**: `image-rendering: pixelated`(nearest-neighbor)로 그린다. logical 크기는 `frame_size × scale`(현재 scale=1). anchor는 sprite를 ground 좌표에 정렬하는 기준점(frame 내 px)이며 좌표 배치는 [[SPEC-201-dashboard-screens]]가 소비한다.

### 2.3 매핑 계약 (확정 표)

**(a) `agentType → character key`** — [[14-MVP-PoC-Scope]] 런타임 asset 계약 기준, manifest 실제 delivery로 보정(§6 C1):

| `agentType` | character key | frame_size | 비고 |
| --- | --- | --- | --- |
| `claude-code` | `orc-claude-storm-shaman` | 232 | |
| `codex` | `orc-codex-field-engineer` | 232 | |
| `unknown` | `orc-unknown` | 228 | manifest delivered(§6 C1). 미해석 시 mascot fallback(§3.1) |
| (mascot / selected camp leader / README·empty) | `orc-high-warchief-mascot` | 232 | universal fallback character도 겸함 |

> `orc-iron-commander`(236)는 manifest에 있으나 [[SPEC-400-control-actions]]의 control/interrupt 상징이기도 하다. agentType→character **1차 매핑**에는 쓰지 않지만, 아래 (a′) **sequential 배치 pool**에는 시각 다양성용 roaming orc로 포함한다.

**(a′) sequential character 배치(확정, #49)** — `agentType → character`는 이제 **1차 결정자가 아니라 fallback**이다. 동일 agentType orc가 똑같이 보이지 않도록, CampMap은 camp의 orc를 **읽기 순서(windowIndex/paneIndex asc)대로** 큐레이트된 `CHARACTER_POOL`을 **순환**시켜 각 orc에 `characterKey`를 부여한다(`characterKeyForIndex(i, pool)`; pool = `availableCharacterPool(manifest)` = manifest에 실재하는 pool 항목, pool 순서 유지). 해석 우선순위(`resolveCharacter`): **명시 `characterKey`(manifest에 존재) → `agentType→character`(a) → mascot fallback(§3.1)**. `characterKey`는 `renderedPos`/layout과 무관한 **시각 선택**이므로 §2.5 position·zero layout shift·placeholder parity를 바꾸지 않는다. `CHARACTER_POOL` 순서(가설, QA 보정): `orc-claude-storm-shaman` → `orc-codex-field-engineer` → `orc-iron-commander` → `orc-high-warchief-mascot` → `orc-unknown`. (manifest 없음/placeholder 경로에서는 pool이 비어 `characterKey=undefined` → (a) 매핑으로 강등.)

**(b) `status → animation state`** — manifest의 모든 agent character는 `idle`/`active`/`waiting`/`error`/`stale`(+`roaming`)를 가진다:

| Orc `status` | animation state | 비고 |
| --- | --- | --- |
| `active` | `active` | |
| `waiting` | `waiting` | |
| `idle` | `idle` | |
| `error` | `error` | mascot은 `error` south-only → direction fallback(§3.2) |
| `stale` | `stale` | |
| `unknown` | `idle` | 전용 `unknown` 애니메이션 없음 → `idle`로 표현(+ overlay로 구분) |
| `terminated` | **`idle`**(#52, animated loop) | 전용 애니메이션 없음(coverage:none)→idle 대체, ghost overlay 표식, death/fall 금지, reduced-motion freeze(§3.3) |
| *(시각 전용)* `roaming` | `roaming` | status enum 아님. MVP 미진입, P1 movement(§3.7) |

**(c) `status → effect overlay`** (`objects/status-ui`, size `[64,64]`):

| Orc `status` | overlay key | 파일 |
| --- | --- | --- |
| `active` | `active-spark` | active-spark.png |
| `waiting` | `waiting-bubble` | waiting-bubble.png |
| `idle` | `idle-glow` | idle-glow.png |
| `error` | `error-burst` | error-burst.png |
| `stale` | `stale-clock` | stale-clock.png |
| `unknown` | `unknown-charm` | unknown-charm.png |
| `terminated` | `terminated-ghost` | terminated-ghost.png |
| *(roaming)* | none(또는 미세 dust, 전용 아이콘 없음 → overlay 생략) | — |

- overlay는 sprite와 **별도 layer**다(sprite frame 위에 합성). overlay 부재(아이콘 load 실패) 시 sprite는 정상 렌더하고 overlay만 생략하되, 상태 구분은 [[SPEC-202-design-accessibility]]의 비-색상 라벨이 보장한다(색상/애니메이션 단독 금지, R 비기능 접근성).

### 2.4 출력 — `SpriteRenderState`

renderer가 매 snapshot/event마다 orc별로 산출하는 결정적 렌더 모델:

```ts
type RenderMode = 'animated' | 'static' | 'placeholder';

interface SpriteRenderState {
  orcId: string;                 // OrcRenderInput.id (stable key)
  characterKey: string;          // 해석된 character (fallback 적용 후)
  frameSize: [number, number];   // 해석된 character의 frame_size (placeholder 박스 크기와 동일)
  anchor: [number, number];
  mode: RenderMode;
  animationState: string | null; // 'idle'|'active'|'waiting'|'error'|'stale'|'roaming' (placeholder/terminated는 null 가능)
  direction: string;             // 해석된 direction (MVP 'south')
  framePaths: string[] | null;   // animated: frames 시퀀스. static/placeholder: null
  fps: number | null;            // animated만
  staticFramePath: string | null;// static(terminated)·reduced-motion: 고정 frame 1장
  overlayPath: string | null;    // status effect 아이콘 (없으면 null)
  loop: boolean;                 // animated는 true
}
```

- 같은 입력(`OrcRenderInput` + `RenderEnvironment`)은 항상 같은 `SpriteRenderState`를 만든다(결정성, 테스트 가능성).

### 2.5 scene asset manifest 계약 (background image·decor·shadow; terrain Wang은 superseded)

맵 scene을 **입체(깊이)** 있게 렌더하기 위해 renderer가 소비하는 **scene asset 선언 shape**를 고정한다. *어디에·어디에 scenery·z*는 [[SPEC-301-camp-map-movement]] §2.8 소유이고, 본 절·§2.6은 **선언된 asset을 resolve·렌더하는 메커니즘**만 소유한다. **씬 배치 산출물(ground 산정·placement·비율 게이트)의 owner는 `scene-placement-engineer`**(`.claude/agents/scene-placement-engineer.md`)다.

> **SUPERSEDED — Wang/타일 지면 → 단일 배경 이미지(image-ground, 확정·구현, 2026-06-29)**: camp 배경은 더 이상 **per-zone corner-Wang 자동 타일링/zone-grid 지형이 아니다**. 대신 **단일 배경 이미지**가 곧 ground다(`BackdropLayer`, `web/src/components/scene/BackdropLayer.tsx`: 배경 이미지를 world 전체에 full-cover로 페인트). 배경 이미지가 `logical_size` + walkable `ground` polygon을 가지면 [[SPEC-301-camp-map-movement]] §2.1 **image-ground 모드**(이미지가 native 해상도 world, 뷰포트 drag-pan)로 동작한다. 따라서 **§2.5a corner-Wang tileset 선언·§2.6a Wang 자동 타일링·terrain field 렌더는 superseded**(런타임에서 미사용)이며 아래 (a)는 **legacy 기록**으로만 보존한다(zone-grid fallback에서도 이제 CSS gradient ground만 쓰고 Wang 타일링은 그리지 않는다). manifest의 `tilesets`(flat-variant 2종)·`WangDef` 타입은 잔존하나 scene 렌더는 소비하지 않는다.

> **SSOT(확정)**: 아래 선언의 권위는 `asset-packs/orc-camp-default/manifest.json`이다([[08-Decisions|D-013]]). 현재 manifest는 `scene.backdrop.background_ref="orccamp-default"`(image-ground, 아래 (b))·`scene.decor`·`scene.shadow`를 선언하며, `backgrounds`에 `orccamp-default`(default, `logical_size [1672,941]`·`ground.polygon`·`safe_area` 보유 → image-ground)와 legacy `warbase-sunset-dashboard`(ground polygon 없음 → zone-grid fallback)를 가진다. 선언/이미지가 없으면 renderer는 §3.9 CSS fallback으로 동작한다(placeholder parity, 기능 검증은 asset과 독립).

**(a) corner-based Wang tileset 선언 — SUPERSEDED(legacy 기록)** — image-ground(단일 배경 이미지)가 지형을 대체했다. 아래는 폐기된 자동 타일링 모델의 기록이며 런타임은 소비하지 않는다(§2.6a도 superseded):

```jsonc
"tilesets": {
  "orc-camp-terrain-wang-topdown": {
    "type": "wang_corner",              // flat "tiles_pro"와 구분: 자동 타일링 대상
    "tile_shape": "square_topdown",
    "view": "top-down",
    "tile_size": [32, 32],
    "tile_count": 16,
    "root": "tiles/orc-camp-terrain-wang-topdown",
    "wang": {
      "kind": "corner",                 // corner(4 모서리) 기반. edge 기반 아님
      "corner_count": 4,
      "terrains": ["moss", "dirt"],     // index 0=moss(base), 1=dirt — 2-terrain 전이
      "base_terrain": "moss",
      "corner_order": ["NW", "NE", "SE", "SW"],     // corner mask 비트 조립 순서(MSB→LSB)
      "base_tile_ids": { "moss": "0000", "dirt": "1111" }, // 단일-terrain 채움 타일 key
      "tiles": {                        // key = corner_order대로 조립한 4-bit mask(1 = terrains[1])
        "0000": "wang-00.png", "0001": "wang-01.png", "0010": "wang-02.png", "0011": "wang-03.png",
        "0100": "wang-04.png", "0101": "wang-05.png", "0110": "wang-06.png", "0111": "wang-07.png",
        "1000": "wang-08.png", "1001": "wang-09.png", "1010": "wang-10.png", "1011": "wang-11.png",
        "1100": "wang-12.png", "1101": "wang-13.png", "1110": "wang-14.png", "1111": "wang-15.png"
      }
    }
  }
}
```

- 16 타일 = 2 terrain × 4 corner의 2⁴ 조합 전수. key는 `corner_order`(`NW,NE,SE,SW`) 순으로 각 corner의 terrain index(0/1)를 이어붙인 4-bit 문자열이다.
- flat-variant tileset은 그대로 유지하며 **accent**(§2.6d)·**L1 fallback**(§3.9)으로 재사용한다(폐기 아님).

**(b) background image 레이어 선언** (`scene.backdrop`) — 단일 배경 이미지 = ground(image-ground, 확정·구현):

```jsonc
// 실제 manifest(scene.backdrop) — image-ground 기본
"scene": {
  "backdrop": {
    "background_ref": "orccamp-default", // backgrounds key 참조(default = ground 보유 이미지)
    "role": "background",
    "fit": "native",            // image-ground: 이미지를 native 해상도로(=world), 스케일 다운 없음
    "vertical_anchor": "center",
    "repeat_x": false,
    "parallax": 0               // 단일 ground 이미지 = world이므로 parallax 없음(0)
  }
}
```

- **image-ground(확정)**: `background_ref`가 `logical_size` + `ground` polygon을 가진 배경(예: `orccamp-default`)을 가리키면 그 이미지가 곧 world다([[SPEC-301-camp-map-movement]] §2.1). 이미지는 world 전체를 **full-cover**(`background-size: cover`, centered)로 페인트하며, world = `logical_size`(native px)이므로 cover는 1:1 native 표시다. `fit="native"`/`parallax=0`/`repeat_x=false`가 이를 반영한다.
- **legacy 호환(zone-grid)**: `ground` polygon이 없는 배경(예: `warbase-sunset-dashboard`)을 가리키면 zone-grid world([[SPEC-301-camp-map-movement]] §2.2)에 동일 이미지를 full-cover로 깐다(배경 자체는 비-제약: world/zone/station 좌표는 배경 치수와 무관, F2 재결정 정합).
- **이전(superseded) 모델**: 구 `scene.backdrop`는 `role="horizon"`·`fit="cover-width"`·`vertical_anchor="top"`·`repeat_x=true`·`parallax=0.3`의 **비-제약 지평선 + parallax**였다(Wang terrain 위 깊이 레이어). image-ground 도입으로 backdrop이 곧 ground가 되며 이 horizon/parallax 모델은 **superseded**다(parallax 변환은 image-ground에서 비활성).

**(c) decor/scenery set 선언** (`scene.decor`) — 결정적 산재 장식:

```jsonc
"scene": {
  "decor": {
    "source_objects": ["props", "wartable-warbase"],
    "items": [
      { "ref": "props/log-pile",    "category": "ground",       "weight": 3 },
      { "ref": "props/barrel",      "category": "ground",       "weight": 2 },
      { "ref": "props/rope-coil",   "category": "ground",       "weight": 2 },
      { "ref": "props/supply-crate","category": "ground",       "weight": 2 },
      { "ref": "props/tool-rack",   "category": "tall",         "weight": 1 },
      { "ref": "wartable-warbase/ember-brazier",          "category": "light-source", "weight": 1 },
      { "ref": "wartable-warbase/timber-palisade-corner", "category": "boundary",     "weight": 1 }
    ],
    "exclude_reserved": true   // 아래 station/zone-header 예약 prop은 decor로 쓰지 않음
  }
}
```

- **station/zone-header 예약 prop 제외(확정)**: `workbench`·`campfire`·`bedroll`·`notice-board`·`stone-marker`·`utility-totem`·`locked-chest`(station, [[SPEC-301-camp-map-movement]] §2.3) 및 `command-tent`·`banner-pole`(zone header, §2.2)은 **status/zone 의미를 지닌 앵커**이므로 decor set에서 제외한다(장식 campfire가 `waiting` station으로 오인되지 않게 — 의미 충돌 방지).

**(d) per-sprite ground shadow 선언** (`scene.shadow`):

```jsonc
"scene": {
  "shadow": {
    "mode": "css",                 // "css"(기본) | "asset"
    "asset_ref": null,             // 선택: ui/...의 타원 그림자 sprite key
    "css": { "shape": "ellipse", "opacity": 0.35, "footprint_ratio": 0.46 } // 타원 그림자(발 밀착, 과대 방지) — 높이는 너비×0.3
  }
}
```

- 기본은 CSS 타원 그림자(추가 asset 불요, 100-pane budget 친화). `asset` 모드면 `asset_ref` sprite를 sprite anchor 아래에 합성한다. shadow의 **배치(offset/scale·z)**는 [[SPEC-301-camp-map-movement]] §2.7 z-stack·§2.8e가 소유한다.

> dusk **lighting**(vignette/ambient)은 asset이 아니라 CSS overlay이며 [[SPEC-301-camp-map-movement]] §2.8d가 소유한다(manifest 선언 없음, tokens-only).

### 2.6 scene asset resolution 메커니즘 (확정)

renderer는 [[SPEC-301-camp-map-movement]]가 제공한 배치 입력(world rect·sprite ground 좌표; legacy zone-grid에서는 zone rect·decor placement)을 받아 아래 **결정적** 메커니즘으로 asset을 그린다. 모두 `image-rendering: pixelated`. terrain field 입력은 image-ground에서 더 이상 쓰이지 않는다((a) superseded).

> **image-ground 레이어 정책(확정·구현)**: image-ground 모드에서는 배경 이미지가 자체 scenery를 가지므로 renderer는 **CSS Decor/Station 레이어를 렌더하지 않는다**((c) decor·station prop은 zone-grid fallback에서만). lighting/shadow/label/overlay는 유지한다((e), [[SPEC-301-camp-map-movement]] §2.7 z-stack ⑤·⑧~⑫).

**(a) Wang corner 자동 타일링 — SUPERSEDED(legacy 기록, 런타임 미사용)**: image-ground(단일 배경 이미지, (b))가 지형을 대체했다. 폐기된 모델은 가시 world grid의 각 cell 4 corner terrain index(`terrainAt`)를 `wang.corner_order`로 4-bit mask로 조립해 `wang.tiles[mask]`를 결정적으로 선택하는 자동 타일링이었다. **현재 renderer는 어떤 Wang/타일 지면도 그리지 않는다**(per-zone TerrainLayer 컴포넌트 부재). zone-grid fallback에서도 지면은 CSS gradient(§3.9)만 쓴다.

**(b) background image resolution(확정·구현)**: `scene.backdrop.background_ref`로 `backgrounds[ref].file`을 resolve해 **world 전체를 덮는 단일 배경 이미지**로 그린다(`BackdropLayer`: `background-size: cover`, centered, `image-rendering: pixelated`). 배경이 `logical_size` + `ground` polygon을 가지면 world = `logical_size`(native)이므로 cover는 native 1:1 표시이고 뷰포트가 drag-pan으로 탐색한다([[SPEC-301-camp-map-movement]] §2.1/§2.7 image-ground). 배경 이미지가 없으면 CSS gradient ground로 강등한다(§3.9). parallax 변환은 image-ground에서 비활성(`parallax=0`); legacy parallax는 superseded.

**(c) decor resolution(확정 — zone-grid fallback 한정)**: legacy zone-grid 모드에서만, SPEC-301 §2.8c `decorPlacements`가 제공한 각 `DecorInstance{ref, x, y}`에 대해 `objects[group].items[name]`(64×64)을 resolve해 그 위치에 그린다(`pointer-events:none`·label보다 낮은 z, asset 누락 시 §3.9). **image-ground 모드에서는 CSS decor 레이어를 렌더하지 않는다**(배경 이미지가 scenery 보유 — §2.6 intro).

**(d) accent tile — SUPERSEDED(legacy 기록)**: flat-variant tileset을 Wang ground 위 정적 accent로 덧그리던 모델은 Wang ground 제거((a) superseded)로 폐기됐다(런타임 미사용).

**(e) shadow resolution(확정)**: `scene.shadow.mode`가 `css`면 sprite footprint(`frame_size × mapSpriteScale`, [[SPEC-301-camp-map-movement]] §2.1)에 `footprint_ratio`를 적용한 CSS 타원을 sprite anchor 아래에 그린다. `asset`이면 `asset_ref` sprite를 같은 위치에 그린다. **placeholder sprite(§3.6)도 동일하게 shadow를 받는다**(parity). shadow 위치/z는 SPEC-301 §2.7/§2.8e.

### 2.7 epic monster NPC asset resolution (확정 — [[SPEC-303-epic-monster-npc]]·[[16-Epic-Monster-NPC]])

camp scene마다 환경에 어울리는 **Epic boss monster**(512×512)를 ambient NPC로 그린다. 본 절은 그
**asset/manifest resolution**을, §3.10은 **렌더/상태머신**을 소유한다. 행동(roaming·random anim·교차
error)은 [[SPEC-303-epic-monster-npc]], 생성·prompt·schema는 [[16-Epic-Monster-NPC]]가 소유한다.

1. **variant resolution(결정적)**: 현재 active background 키 `bg`로 (i) `backgrounds[bg].epic_monster`
   (monster key)를 우선 보고, 없으면 (ii) `monsters` 중 `background == bg`인 엔트리를 고른다. 둘 다 없으면
   몬스터를 **렌더하지 않는다**(scene당 0 또는 1마리, [[16-Epic-Monster-NPC]] §6).
2. **status 필터(확정)**: status enum SSOT는 [[16-Epic-Monster-NPC]] §6(`"planned" | "available" | "deprecated"`)다.
   `monsters[key].status != "available"`(예: `"planned"`)이거나 `pixellab_character_id` 미설정이면 **미생성**으로
   보고 렌더 생략(non-load-bearing, §3.10-5). 생성 runbook이 status를 `"available"`로 올리면 렌더된다. 생성
   전까지 scene에 몬스터는 없다.
3. **frame/anchor/scale**: `monsters[key]`의 `frame_size`(512×512), `anchor`, `scale`을 그 variant 값으로
   해석한다(오크 character 해석과 동일 메커니즘, §2.2). 화면 렌더 스케일·background별 축소(necropolis 최소
   polygon)는 [[SPEC-303-epic-monster-npc]] feasibility가 정한다.
4. **animation 경로 조립**: `monsters[key].animations[state].folders[direction]/frame_%03d.png`를 §2.2와
   동일하게 조립한다. `state ∈ {roaming, active, waiting, idle, error}`(status enum 아님 — §3.10).
   `roaming`은 8방향, dwell 4종은 MVP south-only(`coverage:"south-only"`).
5. **loader 호환**: `monsters`/`backgrounds.*.epic_monster`는 manifest loader([[SPEC-300-asset-rendering]]
   §2.2, cast 기반)가 **미소비 키로 무시**하므로 additive하게 추가해도 기존 character/scene 해석을 바꾸지
   않는다(테스트 green 유지 — `web/src/assets/manifest.ts` `AssetManifest` 캐스트).

## 3. Behavior rules

### 3.1 character key 해석과 fallback chain (확정)

1. `agentType`을 §2.3(a) 표로 character key에 매핑한다.
2. `manifest.characters[characterKey]`가 존재하면 그 character로 resolve한다.
3. 없으면 `orc-high-warchief-mascot`로 fallback한다(universal mascot, manifest 보장 character).
4. mascot도 없거나 `manifest == null`이면 **placeholder mode**로 간다(§3.6).
5. placeholder가 아닌 한, `frameSize`/`anchor`는 **해석된 character의** 값을 쓴다(232/228/236 각각).

> **forward(R-P2-008, [[SPEC-302-mascot-prestige-tiers]])**: character key가 **`prestige` 블록을 가진 character**(현 pack delivered 5종 `orc-high-warchief-mascot`·`orc-claude-storm-shaman`·`orc-codex-field-engineer`·`orc-unknown`·`orc-iron-commander`)로 해석된 경우, §3.2(animation state) **이전에** [[SPEC-302-mascot-prestige-tiers]] §3.2~3.3가 그 orc의 누적 token/cost로 **prestige tier variant**를 골라 base character를 교체할 수 있다(미가용 시 base 폴백). tier가 결정한 variant root 위에서 본 절 이후(§3.2~3.5)가 그대로 동작한다. tier 자산·`Orc.usage` 수집은 forward이며, 미도입 시 본 절 동작은 불변(항상 base). **결정성 예외**: SPEC-302 tier 판정은 `(orc id, character key)`별 단조 latch(가변 상태)를 쓰므로, §2.4 결정성("같은 입력→같은 `SpriteRenderState`")은 **latch 상태를 입력의 일부로 포함**해 성립한다(SPEC-302 §3.2). tier 미도입 시에는 본 절이 순수 함수로 §2.4를 그대로 만족.

### 3.2 animation state 해석 (status→state, direction/state fallback) (확정)

1. `status`를 §2.3(b)로 animation state에 매핑한다.
2. `status == 'terminated'` → **idle 애니메이션 재생**(#52, §3.3): `STATUS_TO_STATE['terminated']='idle'` → `mode='animated'`(+ ghost overlay). reduced-motion이면 §3.5 freeze(static). (이전: `mode='static'` 고정.)
3. 그 외 state에 대해 direction을 정한다. **MVP는 `direction='south'`**(§3.7). P1 movement에서 8방향으로 확장. **요청 direction 존중(#50, 확장)**: 입력에 `direction`이 주어지면 `roaming`(이동)뿐 아니라 **arrived 상태(예: active dwell)에서도** 그 방향 폴더로 렌더한다(없으면 §3.2-4로 south fallback). `direction` 미지정 시에는 종전대로 south다. 이로써 [[SPEC-301-camp-map-movement]] §3.1-10의 "roam 후 dwell facing을 cycle별 random 8방향"이 실현된다.
4. **direction fallback(확정)**: `character.animations[state].folders[direction]`이 없으면 `south`로 강등한다(예: `orc-high-warchief-mascot.error`는 `coverage:"south-only"` → south만 존재).
5. **state fallback(확정)**: 매핑된 state가 character에 아예 없으면 `idle`로 강등한다. `idle`도 없으면(비정상) placeholder(§3.6).
6. `prefersReducedMotion == true`이면 어떤 state든 정적 처리로 전환한다(§3.5). `mode='static'`.

### 3.3 sprite 상태머신 (전이·재생·terminated lifecycle)

**animation state 머신** — 노드 = animation state, 전이 트리거 = `Orc.status` 변화:

```
                       status=active        status=waiting
   ┌───────────────────────────────► active ◄──────────────────┐
   │                                   │  ▲                     │
   │ status=idle / unknown             │  │ status=active       │
   ▼                                   ▼  │                     │
 idle ◄──── status=idle/unknown ──── (any state) ── status=waiting ──► waiting
   ▲                                   │  ▲  │                     │
   │ status=idle                       │  │  │ status=stale        │ status=error
   │                                   ▼  │  ▼                     ▼
   └──────────────────────────────── stale   error ◄── status=error ─┘

  (any state) ── status=terminated ──► [TERMINATED: idle anim loop + terminated-ghost (#52); reduced-motion → static]
  (prefers-reduced-motion) ──────────► [STATIC: reduced_motion.fallback_frame, NO frame advance]
```

규칙(확정):

1. **재생**: `mode='animated'`이면 `framePaths`(frame 0..frames-1)를 manifest `fps`로 순환(loop) 재생한다. 한 frame의 표시 시간 = `1000/fps` ms.
2. **전이 시 리셋**: `status` 변화로 animation state가 바뀌면 새 state의 frame 0부터 재생을 시작한다(이전 frame index 이월 금지). 같은 state로 유지되면 재생 위상은 유지한다(매 snapshot마다 frame 0 리셋 금지 — 깜빡임 방지).
3. **`unknown` status**: `idle` animation을 재생하되 overlay는 `unknown-charm`을 합성한다(§2.3c). status를 색상/포즈 단독으로 단정하지 않는다.
4. **`terminated` lifecycle(#52 갱신, manifest 명시)**:
   - **idle 애니메이션을 재생한다(멈춤 아님)**: `STATUS_TO_STATE['terminated']='idle'` → `mode='animated'`, idle frame 시퀀스 loop, `overlayPath = terminated-ghost`(여전히 ghost로 표식). 전용 `terminated` 애니메이션(`coverage:"none"`)은 없으므로 idle로 대체한다. (이전: 정적 fallback frame 고정 — #52에서 "idle 상태로 애니메이션 적용"으로 변경.)
   - **reduced-motion에서는 정적**: `prefers-reduced-motion`이면 §3.5대로 idle fallback frame 1장으로 freeze(+ ghost overlay). 즉 idle 애니메이션은 normal-motion 한정.
   - **death/fall 애니메이션 사용 금지**: manifest `animations.terminated.coverage="none"`, `note: "PixelLab falling-back-death is deprecated ... must not be used."`. 별도 사망 시퀀스를 합성하지 않는다(idle 호흡만). 이동은 여전히 정적(snap, [[SPEC-301-camp-map-movement]] §3.1-5) — roaming하지 않는다.
   - terminated orc는 [[SPEC-004-status-inference]] §3.7 retention 동안 snapshot에 남아 있으므로 sprite도 그동안 정적 ghost로 유지된다. snapshot에서 빠지면 sprite instance(`orcId`)를 제거한다(렌더는 retention 시간을 직접 계산하지 않는다).
5. **결정성**: 동일 status 입력 시퀀스는 동일 전이·동일 `SpriteRenderState` 시퀀스를 만든다.

### 3.4 effect overlay (확정)

- §2.3(c) 표로 `status`별 overlay 아이콘(`objects/status-ui`, 64×64)을 sprite 위 별도 layer로 합성한다.
- overlay 아이콘 load 실패 시 sprite는 그대로 렌더하고 overlay만 생략한다(graceful). 상태 식별의 최종 보장은 [[SPEC-202-design-accessibility]]의 텍스트/aria 라벨이다(색상·애니메이션·아이콘 단독 의존 금지).

### 3.5 reduced motion (확정, R 접근성 비기능)

- `prefersReducedMotion == true`이면 **모든** orc는 자신의 `reduced_motion.fallback_frame`(각 character의 south/idle frame_000) **1장으로 고정**하고 frame 진행을 멈춘다(`mode='static'`, `fps=null`, `framePaths=null`).
- status 구분은 정지 상태에서도 유지된다: status별 overlay 아이콘(§3.4)과 비-색상 라벨(SPEC-202)은 reduced-motion에서도 렌더한다. 즉 "모션 제거"는 frame 애니메이션만 끄고 상태 정보는 보존한다.
- 이 동작은 [[SPEC-202-design-accessibility]] 접근성 계약과 공동이며, media query 구독·갱신(런타임 중 설정 변경 반영)은 SPEC-202와 정합한다.

### 3.6 placeholder fallback (R-UI-006, [[08-Decisions|D-007]]) (확정)

asset이 없거나 일부가 누락돼도 동일 layout/interaction이 동작해야 한다. 3단계로 강등한다:

| 단계 | 트리거 | 동작 |
| --- | --- | --- |
| L0 정상 | manifest + 해석된 character + frame 존재 | §3.3 animated 또는 §3.5 static |
| L1 character/frame 누락 | manifest는 있으나 character key/특정 frame load 실패 | 그 **character의 frame_size**로 CSS pixel placeholder 박스 + overlay(가능 시) + 텍스트 라벨 |
| L2 pack 미탑재 | `manifest == null` 또는 pack 경로 접근 불가 | **기본 frame_size `[232,232]`**로 CSS pixel placeholder 박스 + 텍스트 라벨 |

placeholder 규칙(확정):

1. **layout size 고정**: placeholder 박스 크기는 manifest `frame_size`(해석 가능하면 해당 character, 아니면 232×232)로 고정한다. asset 유무와 무관하게 scene layout·orc 점유 박스·hit area가 동일하다(동일 layout/interaction, R-UI-006).
2. **interaction parity**: 선택/hover/inspector 연결 등 모든 interaction은 placeholder에서도 동일하게 동작한다(렌더 모드는 시각 표현만 바꾸고 상호작용 계약을 바꾸지 않는다).
3. **상태 표기 parity**: placeholder는 색상 단독이 아니라 `agentType`·`status` 텍스트 라벨(및 가능 시 overlay 아이콘)로 상태를 표기한다(SPEC-202 접근성).
4. PoC asset이 없어도 dashboard가 동작하도록, placeholder는 manifest·network 없이 순수 CSS로 그릴 수 있어야 한다.

### 3.7 PoC 렌더 subset과 확장 (확정 순서)

[[14-MVP-PoC-Scope]] PoC 렌더 우선순위를 본 spec의 단계로 채택한다:

1. `direction='south'`, `state='idle'`의 **첫 frame**(= `reduced_motion.fallback_frame`) 정적 렌더부터 시작한다.
2. 그다음 status별 frame 시퀀스를 manifest `fps`로 재생한다(§3.3).
3. `prefers-reduced-motion`에서 1번 정적 frame으로 고정(§3.5).
4. **8방향·`roaming`은 P1 movement 도입 시 확장**한다. MVP에서 `roaming`은 status로부터 진입하지 않으며 direction은 `south` 고정이다.

> **NOTE (cross-ref, P1 movement)**: P1 movement의 `roaming` 진입·8방향 direction은 이제 [[SPEC-301-camp-map-movement]]가 **진입(enter)·소유**한다. 본 spec은 `roaming` walk-cycle frame 시퀀스(9f@8)·direction 폴더·`south` fallback(§3.2-4)·reduced-motion freeze(§3.5) 등 **sprite 메커니즘만** 제공하고, "언제 roaming에 들어가고 어느 방향으로 가는가"는 SPEC-301 §3.1이 결정한다(요약: 렌더된 위치가 `f(windowIndex,status,paneId)` target과 달라지면 진입, direction = 이동 벡터의 8방향 quantize). 아래 Q4는 SPEC-301에서 **해소**됐다.

### 3.8 license 게이트 / 비-재배포 (미해소, [[08-Decisions|D-009]])

- manifest `license`의 `commercial_use`/`redistribution`/`attribution_required`는 현재 **`"unknown"`**이다. 조건이 명시 확인되기 전에는 asset pack을 npm package 등 외부로 **재배포하지 않는다**([[14-MVP-PoC-Scope]] 패키징 게이트, [[09-Reviews]] Issue Register).
- 따라서 **런타임 코드 구현과 asset 패키징 배포를 분리**한다(확정): 본 spec의 renderer는 asset pack을 `assetBasePath`(로컬/dev 경로)에서 **참조만** 하고, 배포 산출물 포함 여부·license 강제·doctor smoke는 [[SPEC-700-packaging-release]]가 소유한다. asset이 배포본에 없으면 §3.6 placeholder로 동작하므로 기능은 license 확정과 독립적으로 검증 가능하다.

### 3.9 scene asset fallback / placeholder parity (R-UI-006, 확정)

background image/decor/shadow asset이 없거나 일부 누락돼도 동일 layout·배치·interaction이 유지된다(R-UI-006, [[SPEC-301-camp-map-movement]] §3.4와 공동). 배치 좌표(world/ground/safe_area/slot·sprite ground)는 asset과 무관하게 SPEC-301이 산출하므로 fallback은 **시각 표현만** 바꾼다.

| 대상 | L0 정상 | L1 부분 누락 | L2 미탑재 |
| --- | --- | --- | --- |
| background(ground) | 단일 배경 이미지 full-cover(§2.6b, image-ground/zone-grid) | — | CSS gradient ground |
| decor (zone-grid fallback 한정) | prop sprite(§2.6c) | 일부 ref 누락 → 해당 instance만 생략(non-load-bearing) | 전부 생략(또는 CSS marker, 선택) |
| shadow | CSS 타원/asset(§2.6e) | — | CSS 타원(항상 가능) |

> **superseded**: 구 terrain row(corner-Wang/flat-variant 타일링 + accent)·backdrop horizon+parallax row는 image-ground 전환으로 폐기됐다(§2.5/§2.6 supersede). 지면 fallback은 이제 **배경 이미지 → CSS gradient** 2단계다.

규칙(확정):

1. 어떤 fallback 단계에서도 ground/safe_area/slot 좌표·sprite box·scroll 위치가 변하지 않는다(zero layout shift, [[SPEC-202-design-accessibility]] AC-17, [[SPEC-301-camp-map-movement]] §3.2).
2. decor·background·shadow는 **장식/배경**이므로 누락이 status/label/raw target 가독성을 떨어뜨리지 않는다(상태 텍스트는 항상 상위 z, [[SPEC-301-camp-map-movement]] §2.7·[[SPEC-202-design-accessibility]] A7).
3. 배경 이미지가 없어도 ground는 CSS gradient로 그려진다(빈 화면 회귀 방지). **모든 CSS fallback 레이어(gradient ground·dusk lighting·shadow·station marker)는 `--oc-color-*` 토큰만 사용하고 raw hex literal을 쓰지 않는다([[SPEC-202-design-accessibility]] AC-01/B1).**

### 3.10 epic monster sprite 렌더 (status-less FSM·non-interactive·non-load-bearing) (확정 — [[SPEC-303-epic-monster-npc]])

> **적용 단계(2026-06-30)**: [[SPEC-303-epic-monster-npc]] §3 적용 단계에 따라 **Phase 1(현재)은 `roaming`만 표시**한다(연속 roaming, 8방향). `idle`/`active`/`waiting`/`error` 자산은 manifest에 존재하나 **Phase 2에서 적용**한다. 아래 FSM은 전체 설계이며 Phase 1에서는 `displayedState`가 항상 `roaming`이다.

§2.7로 resolve한 몬스터를 그리는 규칙. **animation 선택 권한은 orc `status`가 아니라
[[SPEC-303-epic-monster-npc]] 컨트롤러**(이동·dwell·교차)에 있다는 점이 오크 sprite(§3.2~§3.3)와 본질적
차이다.

1. **status-less FSM**: 표시 state는 컨트롤러가 매 tick 제공하는 `displayedState ∈ {roaming, active,
   waiting, idle, error}`다. §3.2의 `status → state` 표를 **타지 않는다**(몬스터는 status가 없다). 받은
   state로 §2.7-4 경로를 조립해 `mode='animated'`로 manifest `fps` loop 재생한다(재생/전이 리셋 규칙은
   §3.3-1·§3.3-2 재사용: state가 바뀌면 frame 0부터, 같으면 위상 유지).
   - `roaming` = 컨트롤러가 준 8방향 `direction`(이동 벡터 quantize, [[SPEC-301-camp-map-movement]] §3.1-2).
   - dwell(`active`/`waiting`/`idle`) = [[SPEC-303-epic-monster-npc]]가 seeded-random으로 고른 state,
     direction은 south MVP(dwell south-only).
   - `error` = 오크 footprint 교차 latch 동안 재생(최우선, §3.10-2). `error-burst` overlay(§3.4)를 옵션으로
     합성할 수 있다.
2. **state 우선순위(확정)**: `error`(교차 latch) > `roaming`(이동 중) > dwell(`active`/`waiting`/`idle`).
   컨트롤러가 이 우선순위로 단일 `displayedState`를 확정해 전달하므로 renderer는 그대로 그린다.
3. **direction/state fallback**: §3.2-4/§3.2-5 그대로 — `folders[direction]` 부재 시 `south` 강등,
   state 부재 시 `idle` 강등, `idle`도 없으면 미렌더(§3.10-5, placeholder 아님).
4. **reduced motion(확정)**: `prefers-reduced-motion`이면 §3.5처럼 `reduced_motion.fallback_frame`
   (idle/south rotation) **1장으로 고정**, frame 진행·roaming·교차 error animation **전부 정지**. 몬스터는
   정적으로 남아 입체감만 유지한다([[SPEC-301-camp-map-movement]] §3.5-4 scene 정적 페인트와 정합).
5. **non-load-bearing fallback(확정 — orc placeholder parity와 다름)**: 몬스터는 데이터를 운반하지 않으므로
   **asset/variant 미생성·누락 시 placeholder 없이 단순 렌더 생략**한다. 이는 orc의 §3.6 placeholder
   parity(상태 정보 보존 위해 박스 필수)와 **명시적으로 다르다**(몬스터 부재로 잃는 정보 없음). layout/배치
   불변(몬스터는 §2.7 외 어떤 좌표 계약에도 참여하지 않음, [[SPEC-303-epic-monster-npc]] 비-상호작용).
6. **non-interactive(확정)**: 몬스터 레이어는 `pointer-events:none`, tab order/keyboard nav 제외, 선택
   marker·inspector·status overlay·라벨·speech bubble을 갖지 않는다. z-순서는 [[SPEC-301-camp-map-movement]]
   §2.7 z-stack이 정한다(orc와의 depth 처리 포함). 오크 선택/hover hit area를 가리지 않는다.

## 4. Acceptance criteria

> 각 AC는 고정 `OrcRenderInput`+`RenderEnvironment` fixture(Given) → renderer가 `SpriteRenderState` 산출(When) → 렌더 모델/경로/모드(Then)로 검증한다. 경로·frame count·fps는 §2.2 규칙대로 **manifest에서 resolve**한 값과 일치해야 한다.

- **SPEC-300-AC-01** (R-P1-004) — manifest resolution, 3 frame size
  - Given `manifest`가 로드되고 `agentType ∈ {claude-code, codex, unknown}` 각각의 orc fixture에서
  - When renderer가 `SpriteRenderState`를 산출하면
  - Then `characterKey`는 각각 `orc-claude-storm-shaman`/`orc-codex-field-engineer`/`orc-unknown`이고, `frameSize`는 각각 `[232,232]`/`[232,232]`/`[228,228]`, `anchor`는 `[116,175]`/`[116,175]`/`[114,172]`로 **해당 character의 manifest 값**(발 content 최하단)과 일치한다.

- **SPEC-300-AC-02** (R-P1-004) — status→animation state·fps·frame 경로
  - Given `agentType=claude-code`, `status=active`, reduced-motion 아님인 fixture에서
  - When renderer가 산출하면
  - Then `mode='animated'`, `animationState='active'`, `fps`는 manifest `animations.active.fps`(=8), `framePaths.length`는 manifest `animations.active.frames`(=7)이고, `framePaths[0]`은 `animations.active.folders.south + "/frame_000.png"`로 끝나며 `loop=true`다.

- **SPEC-300-AC-03** (R-P1-004) — status→effect overlay 매핑
  - Given `status ∈ {active, waiting, idle, error, stale, unknown, terminated}` 각각의 fixture에서
  - When renderer가 산출하면
  - Then `overlayPath`는 각각 `active-spark`/`waiting-bubble`/`idle-glow`/`error-burst`/`stale-clock`/`unknown-charm`/`terminated-ghost`(`objects/status-ui`, 64×64) 파일을 가리킨다.

- **SPEC-300-AC-04** (R-P1-004) — `unknown` status는 idle 애니메이션 + unknown-charm
  - Given `status=unknown`인 orc fixture에서
  - When renderer가 산출하면
  - Then `animationState='idle'`(전용 unknown 애니메이션을 만들지 않음)이고 `overlayPath`는 `unknown-charm`이다.

- **SPEC-300-AC-05** (R-P1-004, R-UI-003) — `terminated` idle 애니메이션 + ghost (#52), death/fall 금지
  - Given `status=terminated`인 orc fixture에서
  - When renderer가 산출하면
  - Then `mode='animated'`, `animationState='idle'`, `framePaths`는 idle frame 시퀀스(loop), `overlayPath`는 `terminated-ghost`이며, 어떤 death/fall frame 시퀀스도 산출되지 않는다(`animations.terminated.coverage=="none"`로 idle 대체). **단 `prefers-reduced-motion`이면 `mode='static'`(idle fallback frame freeze) + ghost**.

- **SPEC-300-AC-06** (R-P1-004, R-UI-003) — reduced motion freeze
  - Given `prefersReducedMotion == true`이고 임의의 비-terminated status를 가진 orc 집합 fixture에서
  - When renderer가 각 orc를 산출하면
  - Then 각 orc는 `mode='static'`, `staticFramePath`가 자신의 `reduced_motion.fallback_frame`이며 `framePaths=null`·`fps=null`이다(어떤 frame 애니메이션도 진행되지 않는다). status overlay 아이콘은 그대로 산출된다.

- **SPEC-300-AC-07** (R-P1-004) — direction fallback (mascot error south-only)
  - Given `characterKey=orc-high-warchief-mascot`, `status=error`, (확장 가정) 요청 `direction='east'`인 fixture에서
  - When renderer가 direction을 해석하면
  - Then `animations.error.folders.east`가 없으므로 `direction='south'`로 강등되고, `framePaths`는 south error 폴더의 frame을 가리킨다(렌더 누락 없음).

- **SPEC-300-AC-08** (R-UI-006) — character 미해석 시 mascot fallback
  - Given `manifest`는 있으나 해석된 character key가 `manifest.characters`에 없는(예: 미래 신규 agentType) fixture에서
  - When renderer가 산출하면
  - Then `characterKey='orc-high-warchief-mascot'`로 fallback하며 `mode`는 placeholder가 아니다(asset이 있으면 정상 렌더).

- **SPEC-300-AC-09** (R-UI-006, R-UI-003) — placeholder parity (pack 미탑재)
  - Given `manifest == null`(asset pack 미탑재)인 orc fixture에서
  - When renderer가 산출하면
  - Then `mode='placeholder'`, `frameSize=[232,232]`(기본)이고, 동일 layout 박스 크기와 동일 interaction(선택/hover/inspector 연결)이 유지되며, `agentType`·`status` 텍스트 라벨로 상태가 표기된다(색상 단독 아님).

- **SPEC-300-AC-10** (R-UI-006) — placeholder layout size = 해석된 frame_size
  - Given `manifest`는 있으나 `agentType=unknown`의 character frame load가 실패한 fixture에서
  - When renderer가 산출하면
  - Then `mode='placeholder'`이고 placeholder 박스 크기는 `orc-unknown`의 `frame_size [228,228]`로 고정된다(해석 가능한 character의 frame_size 사용, layout 불변).

- **SPEC-300-AC-11** (R-P1-004) — 전이 시 frame 리셋 / 유지 시 위상 보존
  - Given 같은 orc(`id`)가 `status=idle`로 렌더되다가 `status=active`로 바뀐 뒤, 이어서 같은 `active`로 두 번째 snapshot이 온 fixture에서
  - When renderer가 각 snapshot을 처리하면
  - Then `idle→active` 전이에서 `active` frame 0부터 재생을 시작하고, 이어지는 동일 `active` snapshot에서는 frame index를 0으로 강제 리셋하지 않는다(재생 위상 보존, 깜빡임 없음).

- **SPEC-300-AC-12** (R-UI-003) — scene 내 orc 렌더 계약
  - Given camp detail에 N개 orc가 있는 snapshot fixture에서
  - When renderer가 각 orc를 산출하면
  - Then orc마다 `orcId` stable key로 하나의 `SpriteRenderState`가 산출되고, 각 sprite는 자신의 `frameSize`/`anchor`로 [[SPEC-201-dashboard-screens]]가 제공하는 좌표에 배치 가능한 모델을 노출한다(scene 배치 좌표 자체는 SPEC-201 소유).

- **SPEC-300-AC-13** (R-UI-006) — license 게이트: 비-재배포에서도 동작
  - Given 배포 산출물에 asset pack이 포함되지 않은 환경(`manifest == null`, license `"unknown"`)에서
  - When dashboard가 camp detail을 렌더하면
  - Then 모든 orc가 placeholder로 동일 layout/interaction을 유지하며 렌더된다(asset 재배포 없이 기능 검증 가능, [[08-Decisions|D-009]]/[[SPEC-700-packaging-release]]).

> 아래 AC-14~18은 **scene asset 렌더 메커니즘**(§2.5/§2.6/§3.9)을 검증한다. *배치 좌표·terrain field·decor placement* fixture는 [[SPEC-301-camp-map-movement]] §2.8이 제공하며, 본 AC는 그 입력에 대한 **asset resolve·타일 선택·fallback**을 검증한다(placement 자체는 SPEC-301-AC-15~21).

- **SPEC-300-AC-14** (R-UI-003) — Wang corner 자동 타일링 결정성 — **(superseded — image-ground)**
  - image-ground(단일 배경 이미지)가 Wang 자동 타일링을 대체했고 런타임은 어떤 Wang 타일도 그리지 않는다(§2.5/§2.6a superseded). 지형 렌더 검증은 **SPEC-300-AC-16(background image full-cover)** + **[[SPEC-301-camp-map-movement]] SPEC-301-AC-22/23(image-ground world·ground-ratio gate)**로 대체된다. AC ID는 추적 안정성을 위해 보존하나 더 이상 게이트하지 않는다.

- **SPEC-300-AC-15** (R-UI-006, R-UI-003) — terrain fallback chain — **(superseded — image-ground)**
  - per-zone Wang/flat terrain 타일링이 제거돼 fallback 체인은 **배경 이미지 → (없으면) CSS gradient ground** 2단계로 단순화됐다. "단일 평면 tile 회귀 방지"는 더 이상 적용 대상이 아니다(타일 모델 자체 폐기). placeholder parity·zero layout shift 검증은 **SPEC-300-AC-16** + **SPEC-301-AC-20(image-ground placeholder parity)**가 대체한다.

- **SPEC-300-AC-16** (R-UI-003, R-P1-005) — background image full-cover resolution (image-ground·비-제약)
  - Given `scene.backdrop.background_ref` 선언과 (i) `ground` polygon 보유 배경(`orccamp-default`, image-ground)·(ii) polygon 없는 legacy 배경(`warbase-sunset-dashboard`, zone-grid) fixture 각각에서
  - When renderer가 background를 resolve하면
  - Then `backgrounds[ref].file`을 **world 전체 full-cover**(`background-size: cover`, centered, `image-rendering: pixelated`)로 그리고, (i)에서는 world = `logical_size`(native)라 cover가 native 1:1 표시이며, `background_ref`/이미지 부재 시 CSS gradient ground로 강등되고, 두 경우 모두 world/zone/sprite 좌표가 배경 치수와 **무관하게 동일**하다(배경이 sprite/placement를 제약하지 않음, F2).

- **SPEC-300-AC-17** (R-UI-003, R-UI-006) — decor resolution + station-prop 제외 (zone-grid fallback 한정)
  - Given `scene.decor` 선언(`exclude_reserved=true`·`reserved[]` 명시)과 SPEC-301 decor placement fixture(legacy zone-grid)에서
  - When renderer가 decor를 resolve하면
  - Then decor ref는 `objects[group].items[*]`로 resolve되고, station/zone-header 예약 prop(`workbench`/`campfire`/`bedroll`/`notice-board`/`stone-marker`/`utility-totem`/`locked-chest`/`command-tent`/`banner-pole`)은 decor set에 **포함되지 않으며**, 일부 ref asset 누락 시 해당 instance만 생략되고(non-load-bearing) layout·다른 decor·sprite 배치가 불변이다. (image-ground 모드는 CSS decor 레이어를 렌더하지 않으므로 본 AC는 zone-grid fallback에 한정 — §2.6 intro.)

- **SPEC-300-AC-18** (R-UI-003, R-UI-006) — per-sprite ground shadow (depth + parity)
  - Given `scene.shadow.mode ∈ {css, asset}` fixture와 asset/placeholder sprite 각각에서
  - When renderer가 sprite를 그리면
  - Then `css` 모드는 sprite footprint(`frame_size × mapSpriteScale`)에 `footprint_ratio`를 적용한 타원 그림자를, `asset` 모드는 `asset_ref` sprite를 sprite anchor 아래에 그리고, **placeholder sprite도 동일하게 shadow를 받으며**(parity), shadow 유무가 sprite box 크기·layout을 바꾸지 않는다(zero layout shift).

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-003 | camp scene 내 orc sprite 렌더(manifest resolve·frame_size/anchor·terminated 정적·placeholder) + **단일 배경 이미지(image-ground) full-cover·decor(zone-grid fallback)·shadow**, 배치 좌표는 SPEC-301 공동. (Wang 자동 타일링 AC-14/15는 superseded) | SPEC-300-AC-05, AC-06, AC-09, AC-12, AC-16, AC-17, AC-18 |
| R-UI-006 | asset 미탑재/누락 시 placeholder, layout size를 frame_size로 고정·동일 interaction·license 비재배포에서도 동작 + **배경 이미지→CSS gradient fallback parity**(§3.9). (terrain fallback chain AC-15는 superseded) | SPEC-300-AC-08, AC-09, AC-10, AC-13, AC-16, AC-17, AC-18 |
| R-P1-004 | agentType별 sprite variant(character 매핑)+status별 animation state·fps frame 재생·effect overlay·reduced-motion·전이 | SPEC-300-AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-11 |
| R-P1-005 (substrate) | camp background/asset-pack 교체의 **asset 소비 substrate**: 단일 배경 이미지(`scene.backdrop`→`backgrounds[ref]`, image-ground/zone-grid)가 manifest/asset-pack 구동이라 pack/background 교체로 scene이 바뀜. **per-camp 전환 UI·설정은 [[SPEC-500-settings-persistence]] forward**(본 spec은 소유 주장 아님) | SPEC-300-AC-16 |

> R-UI-005(loading/empty/stale 등 화면 상태)와 접근성 비기능(색상 단독 금지·keyboard)은 [[SPEC-201-dashboard-screens]]·[[SPEC-202-design-accessibility]] 소유이며, 본 spec은 sprite 측 status overlay·reduced-motion·placeholder 라벨로 **지원**한다(소유 주장 아님). 전체 매트릭스 롤업은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진 보정 필요)

- **C1 — `orc-unknown`·`orc-iron-commander`는 더 이상 "미생성 gap"이 아니다(중요)**: [[14-MVP-PoC-Scope]] "런타임 Asset 계약" 표와 [[11-PixelLab-Asset-Setup]] character 우선순위 표는 `orc-unknown`(`unknown`→mascot 잠정 fallback)·`orc-iron-commander`를 **미생성 gap**으로 기술한다. 그러나 SSOT인 `manifest.json`([[08-Decisions|D-013]])은 두 character를 **이미 delivery**했다(`orc-unknown` `[228,228]` anchor `[114,172]`, `orc-iron-commander` `[236,236]` anchor `[118,176]`, 각 6 state + roaming, 8방향, exports zip/sha256 포함, `generation_status.character_count=5`). 본 spec은 SSOT 우선 원칙에 따라 `unknown → orc-unknown`을 1차 매핑으로 채택하고 mascot은 character fallback으로 강등했다(§2.3a, §3.1). **upstream 정정 필요**: 14-MVP/11-PixelLab의 "gap" 문구를 "delivered, runtime 소비 가능"으로 갱신하고, 매핑을 mascot→orc-unknown으로 바꾸는 결정을 [[08-Decisions]]에 `D-0xx`로 남길 것을 제안한다. **검토 필요.**
- **C2 — 14-MVP의 "(idle 4 / active 8 / waiting 4 / error 6 / stale 3)" 표기 모호**: [[14-MVP-PoC-Scope]] PoC 렌더 subset 문장의 괄호 수치는 **frame count가 아니라 manifest `fps`** 값이다(실제 frame count는 대부분 7, `roaming` 9). 본 spec은 frame count·fps를 모두 manifest에서 resolve하도록 §2.2에서 고정했다. 14-MVP 문구에 "(= fps)"를 명시해 frame count로 오독되지 않게 보정 권장.
- **C3 — scene 좌표·anchor 소비 경계**: 본 spec은 `frame_size`/`anchor`/`scale`을 노출만 하고, background `safe_area [390,520,890,330]` 내 orc 배치 좌표·간격·겹침 해소는 [[SPEC-201-dashboard-screens]]/[[SPEC-301-camp-map-movement]] 소유다. SPEC-301이 anchor 기준 배치(`mapSpriteScale`·world 좌표)를 본 spec §2.2와 정합화한다(SPEC-301 §2.1).
- **C4 — corner-Wang tileset 요구 철회(RESOLVED — image-ground로 대체, 2026-06-29)**: ~~manifest에 corner-Wang tileset이 필요하다~~는 이전 요구는 **철회**됐다. camp 배경이 **단일 배경 이미지(image-ground)**로 전환돼(§2.5/§2.6 supersede) corner-Wang tileset·terrain field가 더 이상 필요 없다. manifest는 이제 `scene.backdrop.background_ref="orccamp-default"`(image-ground)·`scene.decor`·`scene.shadow`와 `backgrounds.orccamp-default`(`logical_size`·`ground.polygon`·`safe_area`)를 **이미 보유**한다([[08-Decisions|D-013]] SSOT). `tilesets`의 flat-variant 2종·`WangDef` 타입은 잔존하나 scene 렌더는 소비하지 않는다. **잔여 조치 없음**(asset 생성 게이트가 1건 해소됨). 신규 배경 추가 시에는 [[SPEC-301-camp-map-movement]] §2.8 ground-ratio 게이트(`groundRatio ≥ REFERENCE_GROUND_RATIO`)를 통과해야 하며 owner는 `scene-placement-engineer`다.

### Open Questions

- **Q1 — overlay anchor/offset 위치 규약**: status overlay(64×64)를 sprite frame(232/228/236) 위 어디에 합성할지(머리 위/우상단 badge 등)는 디자인 결정이며 [[SPEC-202-design-accessibility]]·[[SPEC-201-dashboard-screens]]와 좌표 규약을 정해야 한다. 현재는 "별도 layer"까지만 고정. **검토 필요.**
- **Q2 — frame preload·메모리 budget**: orc 다수(비기능: 20 session/100 pane)일 때 state별 7-frame × 다방향 PNG preload 전략·texture 상한([[11-PixelLab-Asset-Setup]] Runtime Config `preload list`/`max texture size`)이 미정. MVP는 south/idle 정적부터이므로 부담이 낮으나, 애니메이션·8방향 확장 시 lazy load/캐시 정책을 [[SPEC-200-frontend-architecture]]와 정해야 한다.
- **Q3 — animation 위상 동기화 모델**: §3.3-2의 "전이 시 frame 0 리셋 / 유지 시 위상 보존"을 RAF 기반 시계로 구현할지, snapshot 주기(1~5s, [[08-Decisions|D-014]])와 독립된 렌더 루프로 둘지 [[SPEC-200-frontend-architecture]]와 정합 필요(snapshot 주기보다 frame 재생이 빠르므로 렌더 루프는 snapshot과 분리되어야 한다).
- **Q4 — `roaming`/8방향 진입 조건(P1) — 해소됨**: ~~`roaming`은 status가 아닌 이동 표현이므로, P1 movement에서 어떤 신호로 진입·direction을 정할지 미정.~~ [[SPEC-301-camp-map-movement]] §3.1이 해소: `roaming`은 별도 신호(cwd 변경 등) 없이 **렌더된 위치가 target position `f(windowIndex,status,paneId,mapDims)`와 달라질 때**(주로 `status` 변화로 station이 옮겨질 때) 진입하고, **direction = 이동 벡터(target−rendered)를 8방향으로 quantize**(폴더 부재 시 `south` fallback, §3.2-4)한다. 새 서버 데이터/신호를 도입하지 않는 기존 `Orc` 필드의 순수 함수다. MVP는 여전히 정적 south(§3.7)이며 movement는 P1.
- **Q5 — license 확정 의존**: §3.8 비-재배포는 manifest `license="unknown"` 동안 유효하다. license 확정(commercial/redistribution 허용) 시 [[SPEC-700-packaging-release]]가 asset 번들 포함을 결정하면 본 spec의 L2 placeholder 경로는 배포본에서 비활성(정상 asset 경로)로 전환된다. **SPEC-700과 공동 검토 필요.**
- ~~**Q6 — Wang `corner_order`/terrain index 규약 정합**~~ — **CLOSED(image-ground supersede)**: corner-Wang tileset이 단일 배경 이미지로 대체돼(§2.5/§2.6 supersede) corner_order/mask 정합 검토는 불요.
- ~~**Q7 — accent/variation tile 사용 정책**~~ — **CLOSED(image-ground supersede)**: Wang ground 위 accent tile 모델이 폐기돼 정책 결정이 불요(§2.6d superseded).
