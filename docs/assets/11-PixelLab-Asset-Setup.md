# 11 PixelLab Asset Setup

## 목적

Orc Camp의 pixel game UI에 사용할 PixelLab.ai 산출물을 어떤 형태로 받아야 하는지 정의한다. 목표는 "보기 좋은 이미지 묶음"이 아니라 재생성 가능하고, 패키징 가능하며, dashboard runtime에서 상태와 의미에 맞게 매핑할 수 있는 asset pack을 확보하는 것이다.

실제 생성 prompt와 작업 순서는 [[12-PixelLab-Prompts]]를 따른다.

> **현행 정합화 (2026-06-26)**: 아래 셋업 스펙 일부는 초기 요청 기준(예: `64×64` spritesheet, `orc-codex`/`orc-claude` 시트)으로 작성되었으나, **실제 전달된 asset pack은 `asset-packs/orc-camp-default/manifest.json`을 source of truth로 한다.** 실제 사양은 캐릭터 `232×232` 개별 frame PNG·8방향·state/direction별 폴더 구조이고, 전달 캐릭터는 `orc-high-warchief-mascot` / `orc-claude-storm-shaman` / `orc-codex-field-engineer` 3종이다. 스펙과 실제본이 다르면 manifest와 [[13-PixelLab-Asset-Registry]]가 우선한다. 런타임 소비 계약과 미생성 gap은 [[14-MVP-PoC-Scope]]의 "런타임 Asset 계약"을 참조한다.

## Pixellab 확인 내용

2026-06-25 기준 PixelLab.ai 공식 문서와 사이트에서 확인한 기능:

- character animation: text prompt, skeleton 기반, automatic character creator
- rotation: 4방향/8방향 view, isometric/top-down/side-scroller 관점
- style consistency: reference image 기반으로 character/object style 통일
- editing/inpainting: 기존 pixel art의 의상, accessory, environment 수정
- environments: scene, texture, tileset, game map 생성
- UI elements: button, health bar, menu item 같은 game UI component 생성
- API와 web creator, Pixelorama editor, Aseprite extension 제공

참고:

- https://www.pixellab.ai/
- https://www.pixellab.ai/docs
- https://www.pixellab.ai/pixellab-api
- https://www.pixellab.ai/docs/tools/rotate
- https://www.pixellab.ai/docs/tools/animate-with-text-pro
- https://www.pixellab.ai/docs/tools/create-map
- https://www.pixellab.ai/docs/tools/create-ui-elements-pro

## 받아야 할 산출물 요약

| 구분 | 필수 산출물 | 목적 |
| --- | --- | --- |
| Brand style | style reference image, palette, prompt pack | 전체 asset 일관성 유지 |
| Camp background | default camp scene, tile/terrain set, responsive crop guide | camp detail scene 배경 |
| Orc sprites | agent별 base sprite, 상태별 animation, transparent PNG/spritesheet | agent session 시각화 |
| State effects | active/waiting/error/stale/terminated effect | 상태 인지 보강 |
| UI elements | pixel panel, button, badge, icon set | dashboard UI 통일 |
| Metadata | manifest JSON, frame map, dimensions, anchor points | frontend runtime 매핑 |
| Generation data | prompt, negative prompt, seed, tool/model, options | 재생성/수정 가능성 |
| Legal data | license, commercial usage, attribution, redistribution 조건 | npm package 포함 가능성 판단 |

## Asset Pack 구조

실제 전달본 디렉터리(`asset-packs/orc-camp-default/`):

```text
asset-packs/
  orc-camp-default/
    manifest.json            # runtime source of truth
    palette.json
    LICENSE.md               # commercial/redistribution: TBD
    ATTRIBUTION.md
    generation/              # export metadata, prompt 출처, zip exports/
    backgrounds/
      warbase-sunset-dashboard.png
    sprites/                 # 캐릭터별 폴더 (spritesheet 아님)
      orc-high-warchief-mascot/<Char>/rotations/<dir>.png
      orc-high-warchief-mascot/<Char>/animations/<state>/<dir>/frame_%03d.png
      orc-claude-storm-shaman/...
      orc-codex-field-engineer/...
    tiles/
      orc-camp-terrain-square-topdown/    # 32px, 16 tiles
      orc-warbase-terrain-square-topdown/
    objects/
      props/                 # campfire, command-tent, workbench ... (64px)
      status-ui/             # active-spark, waiting-bubble, error-burst ... (64px)
      wartable-warbase/
    ui/
      frames/                # inspector/activity/terminal/command-dock/modal/camp-card (9-slice 후보)
      buttons/               # primary/secondary/danger/disabled
      selection-markers/     # selected/hover/active-target/danger-target ...
      states/                # loading-campfire, empty-camp-marker, disconnected-banner
```

> 초기 초안에는 `sprites/orc-codex.sheet.png` 같은 단일 spritesheet와 `effects/` 디렉터리를 가정했으나, 실제 전달본은 **캐릭터별 폴더 + state/direction별 개별 frame PNG** 구조이고 status 효과는 별도 `effects/`가 아니라 `objects/status-ui`로 제공된다. 상태→effect 매핑은 [[14-MVP-PoC-Scope]] "런타임 Asset 계약" 참조.

## 필수 Metadata

`manifest.json`은 frontend가 asset을 load하고 상태별 sprite를 매핑할 수 있을 만큼 구체적이어야 한다. **실제 전달본 `manifest.json`은 spritesheet row가 아니라 state·direction별 frame 폴더를 가리킨다.** 아래는 실제 캐릭터 엔트리의 형태다(전체는 `asset-packs/orc-camp-default/manifest.json`).

```json
{
  "id": "orc-camp-default",
  "version": "0.1.0",
  "source": "pixellab",
  "license": {
    "commercial_use": "unknown",
    "redistribution": "unknown",
    "attribution_required": "unknown",
    "terms_url": "https://www.pixellab.ai/"
  },
  "palette": { "file": "palette.json", "transparent_color": null },
  "characters": {
    "orc-codex-field-engineer": {
      "role": "Codex agent session character, field engineer",
      "root": "sprites/orc-codex-field-engineer/Orc_Codex_Field_Engineer",
      "frame_size": [232, 232],
      "scale": 1,
      "anchor": [116, 208],
      "view": "low top-down",
      "directions": ["south", "east", "north", "west", "south-east", "north-east", "north-west", "south-west"],
      "rotations": { "south": "rotations/south.png" },
      "animations": {
        "idle":    { "frames": 7, "fps": 4, "frame_pattern": "frame_%03d.png", "folders": { "south": "animations/.../south" } },
        "active":  { "frames": 7, "fps": 8, "folders": { "south": "animations/.../south" } },
        "waiting": { "frames": 7, "fps": 4, "folders": { "south": "animations/.../south" } },
        "error":   { "frames": 7, "fps": 6, "folders": { "south": "animations/.../south" } },
        "stale":   { "frames": 7, "fps": 3, "folders": { "south": "animations/.../south" } },
        "roaming": { "frames": 9, "fps": 8, "folders": { "south": "animations/.../south" } },
        "terminated": { "coverage": "none", "runtime_behavior": "static fallback plus status effect only" }
      },
      "reduced_motion": {
        "fallback_state": "idle",
        "fallback_direction": "south",
        "fallback_frame": "animations/.../south/frame_000.png"
      }
    }
  },
  "backgrounds": {
    "warbase-sunset-dashboard": {
      "file": "backgrounds/warbase-sunset-dashboard.png",
      "logical_size": [1672, 941],
      "safe_area": [390, 520, 890, 330]
    }
  },
  "tilesets": { "orc-camp-terrain-square-topdown": { "tile_size": [32, 32], "tile_count": 16 } },
  "objects": { "props": { "...": {} }, "status-ui": { "...": {} } },
  "ui": { "frames": {}, "buttons": {}, "selection_markers": {}, "states": {} }
}
```

핵심 차이(초안 → 실제본): `frame_size` `64→232`, `scale` `3→1`, anchor `[32,56]→[116,208]`, row-based state → folder-per-(state,direction), 단일 캐릭터 → 8방향 캐릭터 3종 + tiles/objects/ui 묶음. 상태별 frame 시퀀스 폴더의 전체 경로는 manifest를 직접 참조한다.

## PixelLab.ai에 요청할 입력/옵션 데이터

### 공통

- PixelLab.ai tool 이름: 예: Create map, Rotate, Animate with text, Create UI elements
- prompt와 negative prompt
- seed
- reference image와 concept image 원본
- target palette 또는 forced palette
- canvas size
- transparent background 여부
- output method
- 생성 일시와 생성자
- 선택된 결과 외 rejected variants
- 후처리 내역: crop, upscale, color reduce, manual edit, inpainting mask

### Character / Orc Sprite

- base character concept: main protagonist orc, Claude orc, Codex orc, unknown orc
- sprite frame size: **실제 전달본 `232x232`** (초안 권장 `64x64`는 폐기). manifest `frame_size`가 기준.
- transparent background: required
- direction: **실제 전달본은 8방향 생성 완료.** PoC 렌더는 `south` 1방향·정적 frame부터 시작하고 8방향/roaming은 P1 movement 도입 시 사용([[14-MVP-PoC-Scope]]).
- animation states: `idle`, `active`, `waiting`, `error`, `stale`, `terminated`, `roaming`
- `idle` / `breathing-idle`은 7-frame v3 custom animation을 기준으로 한다. PixelLab template `breathing-idle`은 4-frame 고정이므로 사용하지 않는다.
- `roaming`은 모든 character sprite에 필수로 생성한다. 8방향 character는 `roaming`도 8방향을 기준으로 한다.
- PixelLab에는 `roaming`이라는 template animation이 없다. `roaming`은 `mode="v3"` custom animation으로 생성하고, `animation_name="roaming"`에 product state 이름을 저장한다.
- `roaming` 품질 기준은 idle/slide가 아니라 다리가 번갈아 움직이는 walking patrol cycle이다. prompt에 `visible leg motion`, `alternating left and right steps`, `feet lifting and planting`, `no static legs`를 포함한다.
- PixelLab `falling-back-death` / `Falling Back Death (beta)` template은 결과가 불완전하므로 제품 animation mapping에 사용하지 않는다.
- `terminated`는 character death/fall animation이 아니라 static fallback frame, fade-out status effect, badge/icon 조합으로 표현한다.
- 각 state별 frame count와 FPS
- anchor point: 발 위치 또는 그림자 중심
- hitbox/selection box
- 상태별 구분 규칙: pose, accessory, effect, color accent

### Character Concept Direction

Orc Camp character는 World of Warcraft의 주요 오크 캐릭터를 내부 visual reference로 삼는다. 단, 제품에 포함되는 실제 asset, prompt, 파일명, UI label은 Blizzard/WoW 고유명사와 식별 가능한 외형을 그대로 사용하지 않고 Orc Camp 고유 캐릭터로 재해석한다.

| 내부 레퍼런스 | Orc Camp original archetype | 제품 역할 | 시각 방향 | 금지할 직접 복제 요소 |
| --- | --- | --- | --- | --- |
| 그롬 헬스크림 | `orc-warchief` / Berserker Warchief | 주인공, 대표 mascot, selected camp leader | 거대한 전투 도끼, 공격적인 전방 자세, 상처 많은 노련한 전사, ember/red accent | 이름, 정확한 갑옷/문신/무기 실루엣, 특정 clan emblem |
| 오그림 둠해머 | `orc-iron-commander` | 통제/명령/interrupt action의 상징 | 묵직한 hammer 계열 무기, 검은 철제 갑옷, 안정적인 지휘관 자세 | Doomhammer 고유 무기 디자인, 이름, 특정 armor silhouette |
| 스랄 | `orc-storm-shaman` | 관찰/회복/reconnect/waiting 상태의 상징 | shaman cloak, storm/mana accent, 차분한 stance, staff 또는 원형 totem | 이름, Doomhammer 소유 묘사, 정확한 복장/얼굴 특징 |
| 기타 오크 전사 계열 | `orc-grunt`, `orc-veteran`, `orc-guard` | generic agent, idle/active 기본 variant | 단순 무장, camp worker 느낌, 읽기 쉬운 silhouette | WoW faction emblem, 유명 캐릭터와 동일한 장비 |
| 기타 주술/흑마 계열 | `orc-seer`, `orc-ritualist` | warning/error/stale effect variant | hood, bone charm, smoke/magic effect | 특정 캐릭터명, 고유 staff/mask 디자인 |

PixelLab.ai에 전달하는 prompt는 아래처럼 고유명사를 제거한 original descriptor를 사용한다.

```text
original pixel art orc high warchief mascot, long black topknot hair, oversized ivory tusks, fierce battle shout, asymmetrical spiked iron shoulder armor, heavy fur trim, rugged leather straps, abstract bone trophy belt, massive generic crescent battle axe, ember red-black metal accents, dark fantasy camp leader, 120x120 transparent background, readable silhouette, not based on any existing game character
```

```text
original pixel art orc storm shaman, calm leader stance, teal storm magic accents, rugged camp outfit, 64x64 transparent background, readable silhouette, not based on any existing game character
```

#### Character별 우선순위와 전달 현황

| 우선순위 | 초안 키 | 실제 delivered key | 용도 | 현황 |
| --- | --- | --- | --- | --- |
| 1 | `orc-warchief` | `orc-high-warchief-mascot` | 주인공 mascot, README/empty state/selected camp leader, `unknown` 잠정 fallback | 전달 완료 (6 state + roaming, 8방향) |
| 2 | `orc-codex` | `orc-codex-field-engineer` | Codex agent session | 전달 완료 |
| 3 | `orc-claude` | `orc-claude-storm-shaman` | Claude agent session | 전달 완료 |
| 4 | `orc-unknown` | 228×228 | agent type 미확정 pane | **delivered.** runtime `unknown → orc-unknown` 1차 매핑([[08-Decisions|D-030]]) |
| 5 | `orc-iron-commander` | 236×236 | interrupt/control 상징 | **delivered.** control/interrupt 상징 character |

> 초안의 `orc-codex`/`orc-claude`/`orc-warchief` 키는 실제 manifest의 `orc-codex-field-engineer`/`orc-claude-storm-shaman`/`orc-high-warchief-mascot`로 대응한다. 미생성 gap(`orc-unknown`, `orc-iron-commander`)의 런타임 대체는 [[14-MVP-PoC-Scope]] "런타임 Asset 계약" 참조.

#### IP Safety Rules

- PixelLab.ai prompt에 `World of Warcraft`, `Grom Hellscream`, `Orgrim Doomhammer`, `Thrall` 같은 고유명사를 넣지 않는다.
- 파일명, manifest key, UI label에는 original archetype만 사용한다.
- reference board에는 고유 캐릭터명을 내부 메모로 남길 수 있지만, 생성 산출물은 original character로 검수한다.
- 유명 캐릭터의 정확한 얼굴, 갑옷, 무기, 문양, 색 조합을 그대로 재현하지 않는다.
- 공개 배포 전 asset review에서 "기존 게임 캐릭터로 오인될 가능성"을 별도 체크한다.

### Environment Concept Direction

#### Orc City Warbase / Wartable

Orc Camp의 camp detail과 command UI는 내부적으로 WoW 오그리마 도시의 전쟁기지, 성벽, 붉은 협곡, 전쟁 회의실 무드를 참고한다. 단, 제품 asset과 PixelLab prompt에는 고유명사와 식별 가능한 건축물/문양을 넣지 않고 Orc Camp 고유의 `orc city warbase`와 `wartable`로 재해석한다.

내부 reference:

- https://artistmonkeys.com/media/cache/sylius_shop_product_thumbnail/ce/18/Orgrimmar-assault-1.webp
- https://static.wikia.nocookie.net/wowwiki/images/8/8e/Orgrimmar_in_5.2.jpg/revision/latest?cb=20130329233819

Orc Camp original direction:

| 내부 레퍼런스 요소 | Orc Camp 재해석 | 사용처 | 금지할 직접 복제 요소 |
| --- | --- | --- | --- |
| 붉은 협곡과 거친 성벽 | red-clay canyon fortress, dark timber palisade | camp background, terrain variant | 도시 이름, 특정 skyline, exact gate silhouette |
| 뾰족한 목재/철제 방어 구조 | spiked timber-and-iron warbase architecture | panel frame, command dock, camp boundary prop | faction emblem, 특정 깃발 문양 |
| 전쟁 회의 테이블 | rugged wartable with blank map surface, markers, tools | command dock, inspector, camp prop | 읽을 수 있는 지도, 실제 게임 지역 윤곽 |
| 전쟁 깃발과 토템 | abstract torn banners, bone-and-iron posts | prop, selection marker, activity rail | clan symbol, recognizable crest |
| 화덕과 대장간 분위기 | ember-lit command hall, forge glow | loading, active status, background lighting | exact cinematic composition |

PixelLab.ai에 전달하는 prompt는 아래처럼 고유명사를 제거한다.

```text
original pixel art orc city warbase command hall for a developer dashboard, red clay canyon stone, dark timber palisades, black iron spikes, rugged hide awnings, ember-lit forge glow, central blank wartable with simple markers and tools, teal magic utility accents, clear safe area for character sprites and web-rendered UI, no readable map, no emblem, no text, no logo, not based on any existing game location
```

```text
original pixel art rugged orc wartable prop, blank parchment map surface without readable geography, small bone markers, iron daggers, rope, compass-like charm without letters, ember candle glow, dark timber legs, transparent background, no text, no logo, no faction symbol, not based on any existing game location
```

### Camp Background / Map

- view: top-down 또는 low top-down을 우선 검토
- logical canvas: dashboard 기준 `16:9`
- tile size: `16px` 또는 `32px`
- safe area: orc와 UI overlay가 올라가도 가려지지 않는 영역
- foreground/background layer 분리 여부
- tileable terrain, campfire, tent, workstation, log pile 같은 prop
- day/night variant 필요 여부
- responsive crop guide: desktop, tablet, mobile viewport에서 잘릴 수 있는 영역

### State Effects

- active: work motion, hammer/spark, mana glow
- waiting: speech bubble, question mark, idle bounce
- error: warning flash, red alert, shake frame
- stale: clock, dust, dim overlay
- terminated: fade-out, ghosted silhouette
- effect는 sprite와 별도 layer로 받을 것
- transparent PNG/spritesheet 필수

### UI Elements

생성 필요성 판정:

- UI asset은 **필요**하다. Orc Camp의 pixel game concept을 dashboard 전체에 일관되게 적용하려면 status icon, selection marker, panel frame, command dock, danger modal skin이 필요하다.
- 단, UI 기능 자체를 이미지로 만들지는 않는다. layout, text, focus state, keyboard interaction, accessible label은 web UI에서 구현한다.
- PixelLab.ai에는 text 없는 frame/icon/skin만 요청한다. full dashboard screenshot, text label image, command text가 박힌 button image는 생성하지 않는다.
- MVP에서는 기존 CSS component로 기능을 완성하고, PixelLab UI skin은 demo polish와 product identity를 높이는 layer로 붙인다.

- panel frame: inspector, activity log, modal
- button states: default, hover, active, disabled, danger
- status badge: active/waiting/idle/error/unknown/stale/terminated
- icons: send, interrupt, refresh, settings, copy, attach, visibility, lock
- 9-slice 가능 여부 또는 fixed-size component별 PNG
- 일반 dashboard text는 pixel image로 만들지 않는다. UI text는 web font/rendered text로 유지한다.

## Orc Camp 상태와 Asset 매핑

| Orc 상태 | Sprite state | Effect | Badge/Icon |
| --- | --- | --- | --- |
| `unknown` | `idle` | none 또는 question mark | `?` |
| `active` | `active` | spark/mana glow | activity icon |
| `waiting` | `waiting` | speech bubble | prompt icon |
| `idle` | `idle` | campfire idle shadow | pause icon |
| `error` | `error` | red alert/shake | warning icon |
| `stale` | `stale` | dim clock overlay | clock icon |
| `terminated` | static fallback frame | fade-out/ghost overlay | stop icon |
| `roaming` | `roaming` | none 또는 subtle dust | walking/roaming icon |

## 파일 포맷 기준

- 이미지: PNG 우선
- 투명 배경: sprite, effects, UI icons에는 alpha channel 필수
- animation: spritesheet PNG + manifest metadata 우선
- GIF/APNG는 preview 용도로만 사용하고 runtime source of truth로 두지 않는다.
- 원본 작업 파일: PixelLab.ai project/export, Pixelorama/Aseprite file이 있으면 함께 보관한다.
- palette: JSON 또는 GPL palette file로 별도 보관한다.

## 품질 검수 체크리스트

- 모든 sprite frame이 동일한 canvas size와 anchor point를 가진다.
- 상태별 pose가 색상 없이도 구분된다.
- dark background에서 sprite와 effect가 충분히 읽힌다.
- dashboard panel 위에 올라가는 icon은 1x/2x/3x에서 깨지지 않는다.
- nearest-neighbor scaling에서 흐림이 없다.
- transparent edge에 halo가 없다.
- `prefers-reduced-motion`용 static frame을 지정할 수 있다.
- asset 파일명과 manifest key가 일치한다.
- prompt/seed/tool/options로 재생성 가능한 수준의 기록이 있다.
- commercial use와 redistribution 조건이 확인되어 npm package 포함 가능하다.

## MVP에 필요한 최소 Asset Set

> **현황**: 아래 "최소 범위"는 초안 기준이며, **실제 전달본은 이 최소선을 이미 초과한다**(캐릭터 3종 × 6 state + roaming × 8방향, 배경 1종, terrain 2종, props/status-ui/wartable/selection-marker/frame/button/state 묶음, palette/license/attribution/generation metadata 포함). 따라서 PoC에서는 "새 asset 생성"이 아니라 **이미 있는 asset의 런타임 소비 subset 선정**이 과제다.

PoC(Slice 3) 렌더에 실제로 필요한 최소 subset([[14-MVP-PoC-Scope]]):

- 배경: `backgrounds/warbase-sunset-dashboard.png` 1종 (safe_area 활용)
- 캐릭터: `orc-high-warchief-mascot` / `orc-claude-storm-shaman` / `orc-codex-field-engineer`의 `south` 방향 `idle` frame (정적 시작)
- status 효과: `objects/status-ui`의 active/waiting/error/stale/terminated/idle/unknown 아이콘
- 미생성 gap: `orc-unknown`, `orc-iron-commander`는 mascot/아이콘으로 잠정 대체

초안의 단일 spritesheet(`orc-codex.sheet.png` 등)·`status-effects.sheet.png`·`ui-icons.sheet.png`는 실제 전달 구조(폴더 frame + 개별 아이콘 PNG)와 다르므로 파일명 그대로 기대하지 않는다.

## 세팅해야 할 Product/Frontend 값

### Design Tokens

- base tile size: `32px` (실제 terrain tileset 기준; 초안 `16px`에서 갱신)
- character sprite logical size: `232x232`, anchor `[116, 208]`, scale `1` (실제 manifest 기준; 초안 `64x64`·`3x`는 폐기)
- 상태/UI 아이콘 logical size: `64x64`, frame/button skin은 manifest의 `size` 사용
- image rendering: `pixelated`
- animation default FPS: idle 4, active 8, waiting 4, error 6, stale 3, roaming 8 (manifest 값과 일치)
- reduced motion fallback frame: 각 캐릭터 `reduced_motion.fallback_frame` (south/idle frame_000)

### Runtime Config

- active asset pack id
- asset base path
- state-to-sprite mapping
- state-to-effect mapping
- background id per camp
- fallback placeholder mapping
- preload list
- max texture/image size

### Packaging

- npm package에 포함할 asset과 optional download asset을 구분한다.
- license가 불명확한 asset은 package에 포함하지 않는다.
- asset pack version은 app version과 분리한다.
- generated asset metadata는 build artifact에 포함하되 API key나 계정 정보는 포함하지 않는다.

## 결정 필요 항목

해소됨(실제 전달본 기준):

- 방향: 8방향까지 생성 완료. PoC는 south 정적 frame부터 소비하고 나머지는 점진 확장.
- camp background: 단일 scene image(`warbase-sunset-dashboard`)와 terrain tileset 2종 + prop layer를 **둘 다** 확보. runtime은 단일 배경을 기본으로 쓰고 tile/prop은 보조.

남은 결정:

- PixelLab.ai license가 npm package 재배포를 허용하는지 확인해야 한다(미확인 시 asset 배포 보류, [[14-MVP-PoC-Scope]] 패키징 게이트).
- 추가 asset 생성 시 수동 다운로드 pack으로 받을지, API 생성 pipeline을 자동화할지 결정해야 한다.
- PixelLab.ai 계정/API key를 개인 계정으로 쓸지, 제품용 별도 계정으로 분리할지 결정해야 한다.
- 미생성 gap(`orc-unknown`, `orc-iron-commander`)을 신규 생성할지, 기존 mascot/아이콘 대체로 유지할지 결정해야 한다.
