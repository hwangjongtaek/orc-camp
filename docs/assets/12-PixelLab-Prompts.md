# 12 PixelLab Prompts

## 목적

Orc Camp의 PixelLab.ai asset을 일관된 style로 생성하기 위한 prompt pack과 작업 가이드다. 이 문서는 [[11-PixelLab-Asset-Setup]]의 asset pack 구조, manifest 요구사항, IP safety rules를 전제로 한다.

> **현행 정합화 (2026-06-26)**: 이 문서는 *생성 시점*의 prompt 쿡북이다. character 키(`orc-codex`/`orc-claude`/`orc-unknown` 등)와 `64x64` 같은 prompt 파라미터는 생성 당시 값이며, **실제 전달본·현행 진실원은 `asset-packs/orc-camp-default/manifest.json`과 [[13-PixelLab-Asset-Registry]]**다. 전달 캐릭터는 `orc-high-warchief-mascot`/`orc-claude-storm-shaman`/`orc-codex-field-engineer`(232×232, 8방향)이고 `orc-unknown`/`orc-iron-commander`는 미생성 gap이다. 런타임 소비 계약은 [[14-MVP-PoC-Scope]], 결정 근거는 [[08-Decisions|D-013]] 참조.

## 기본 원칙

- 실제 PixelLab.ai prompt에는 기존 게임 고유명사를 넣지 않는다.
- 모든 character는 Orc Camp 고유 archetype으로 생성한다.
- 먼저 `orc-warchief` mascot과 palette를 확정하고, 이후 asset은 그 결과물을 style reference로 사용한다.
- sprite, effect, UI icon은 transparent background를 기본으로 한다.
- dashboard text는 이미지로 생성하지 않는다. 텍스트는 web UI에서 렌더링한다.
- 모든 생성 결과는 prompt, seed, tool, canvas size, rejected variants, 후처리 내역과 함께 보관한다.

## 공통 Style Prompt

### Positive

```text
dark fantasy pixel art for a developer tool called Orc Camp, original orc characters, rugged camp atmosphere, readable silhouettes, compact game UI style, moss green terrain, ember orange campfire accents, teal blue magic highlights, parchment text panels, high contrast on dark background, clean sprite edges, crisp nearest-neighbor pixel art, no blur, no gradients, no photorealism
```

### Negative

```text
existing game character, copyrighted character, trademarked emblem, faction symbol, exact armor copy, exact weapon copy, realistic rendering, smooth gradients, blurry edges, excessive detail, unreadable silhouette, tiny facial details, modern sci-fi armor, anime style, text, logo, watermark
```

## Palette Guide

PixelLab.ai target palette 또는 forced palette가 가능하면 아래 색상을 기준으로 한다.

| Token | Hex | 사용 |
| --- | --- | --- |
| `ink` | `#171C1F` | dark background, shadow |
| `charcoal` | `#262D2F` | panel, metal |
| `moss` | `#4F6F52` | terrain, orc skin shadow |
| `orc-skin` | `#6D8A4A` | base orc skin |
| `orc-highlight` | `#9CB66A` | skin highlight |
| `ember` | `#D6723F` | campfire, active accent |
| `mana` | `#4AA3DF` | Codex/Claude magic-tech accent |
| `parchment` | `#F3E7C4` | light UI surface |
| `bone` | `#D8C9A3` | secondary UI, horns, straps |
| `danger` | `#C94C4C` | error, interrupt |
| `warning` | `#D6A43F` | waiting, caution |

## 생성 순서

1. `style-board`: palette, panel, terrain, mascot mood를 빠르게 확인한다.
2. `orc-warchief`: 주인공 mascot을 확정한다.
3. `orc-codex`, `orc-claude`, `orc-unknown`: agent별 base sprite를 생성한다.
4. state animation: `idle`, `active`, `waiting`, `error`, `stale`.
5. `roaming`: 모든 character에 필수 생성한다. 8방향 character는 `roaming`도 8방향으로 생성한다.
6. `terminated`: character animation이 아니라 status effect, static fallback, badge/icon으로 표현한다.
7. camp background와 terrain tileset.
8. state effects.
9. UI icons와 panel/button.
10. manifest와 palette metadata 정리.
11. IP safety, readability, transparent edge, frame alignment 검수.

## Character Generation Standard

`orc-warchief`에서 확정한 기준을 다음 character에도 그대로 적용한다. 목적은 같은 camp 안에 서 있을 때 frame size, camera angle, silhouette density, anchor 위치가 어긋나지 않게 하는 것이다.

### Base Character Contract

- PixelLab MCP tool: `create_character`
- Mode: `v3`
- Body type: `humanoid`
- Size: `120`
- View: `low top-down`
- Directions: v3 기준 8방향
- Prompt size phrase: `120x120 character`
- Background: transparent
- Style: dark fantasy pixel art, readable silhouette, crisp pixel art, no text, no logo
- IP safety: 고유 게임명, 캐릭터명, faction emblem, 정확한 장비 실루엣 금지
- Output target: 실제 PixelLab 결과의 frame size를 manifest source of truth로 기록한다. `orc-warchief`는 요청 size `120`에서 실제 `232x232px`로 export되었다.

### Base Character MCP Template

```json
{
  "mode": "v3",
  "body_type": "humanoid",
  "name": "{Display Name}",
  "description": "{character prompt}",
  "size": 120,
  "view": "low top-down"
}
```

### Required Animation Pack

새 character는 base 8방향 생성 후 아래 animation set까지 완료해야 `export-ready`로 본다.

| Product state | PixelLab animation name | Directions | Frames | `frame_count` | Quality rule |
| --- | --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 | 7 | 6 | breathing only, feet planted |
| `roaming` | `roaming` | 8 | 9 | 8 | visible alternating leg motion, no sliding |
| `active` | `active` | 8 | 7 | 6 | working motion, feet mostly planted |
| `waiting` | `waiting` | 8 | 7 | 6 | expectant idle, feet planted |
| `stale` | `stale` | 8 | 7 | 6 | upper-body only, legs locked still |
| `error` | `error` | 8 preferred, south-only acceptable for MVP | 7 | 6 | alert shake, no walking |
| `terminated` | none | n/a | n/a | n/a | use static fallback/effect only |

`falling-back-death` / `Falling Back Death (beta)`는 제품에서 사용하지 않는다.

### Animation Submission Rules

- `roaming`은 PixelLab template이 아니다. 반드시 `mode="v3"`, `animation_name="roaming"`으로 생성한다.
- `breathing-idle`도 7-frame 기준을 맞추기 위해 template이 아니라 `mode="v3"`, `animation_name="breathing-idle"`, `frame_count=6`으로 생성한다.
- PixelLab job slot 제한 때문에 8방향 state animation은 한 state씩 제출하고 완료 후 다음 state를 제출한다.
- 걷기 동작이 들어가면 해당 direction만 `delete_animation` 후 재생성한다.
- stale 계열 prompt에는 `upper-body only`, `both feet planted in the exact same spots`, `legs locked still`, `no stepping`, `no foot lift`, `no walking`, `no sliding`을 포함한다.
- roaming 계열 prompt에는 `visible leg motion`, `alternating left and right steps`, `feet lifting and planting`, `no sliding`, `no static legs`를 포함한다.

## Character Prompts

### `orc-warchief` Mascot

목적: 주인공, product mascot, selected camp leader.

Reference-derived traits:

- 긴 흑발과 상투, 큰 엄니, 강한 턱선, 야성적인 battle shout 표정
- 비대칭 spiked iron shoulder armor, fur trim, leather straps, bone trophy belt
- 거대한 single-bladed battle axe, generic crescent silhouette
- ember red/black metal accent, rugged veteran leader mood
- 단, 기존 게임 캐릭터의 이름, 로고, 문양, 정확한 갑옷/도끼 실루엣은 사용하지 않는다.

```text
original pixel art orc high warchief mascot for a dark fantasy developer dashboard, broad muscular veteran orc silhouette, warm olive green skin with bronze shadows, long black hair tied in a high topknot with loose mane, oversized ivory tusks, fierce battle shout expression, asymmetrical spiked iron shoulder armor, heavy fur trim, rugged leather straps, abstract bone trophy belt, massive single-bladed battle axe with a generic crescent blade silhouette, red-black metal accents, ember highlights, confident camp leader stance, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

Negative:

```text
existing game character, named fantasy franchise character, exact armor copy, exact axe copy, faction emblem, clan symbol, recognizable logo, photorealistic, blurry, over-detailed, tiny unreadable facial details, text, watermark
```

권장 옵션:

- Tool: PixelLab MCP `create_character`
- Mode: `v3`
- Character size: `120`
- View: `low top-down`
- Directions: 8
- Background: transparent
- Output: 8-direction base character first

### `orc-codex`

목적: Codex agent session. 빠르게 일하는 engineer-orc 느낌.

```text
original pixel art orc field engineer agent for a dark fantasy developer dashboard, rugged orc worker with compact tool belt, small glowing terminal tablet, teal blue magic-tech accent, focused working pose, dark fantasy camp outfit, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

Negative:

```text
robot, sci-fi armor, modern laptop logo, copyrighted character, faction emblem, unreadable tiny tools, photorealism, blur, text, watermark
```

### `orc-claude`

목적: Claude agent session. strategist/shaman 느낌.

```text
original pixel art orc storm shaman strategist for a dark fantasy developer dashboard, calm leader stance, weathered cloak, simple staff or round totem, teal storm magic accents, thoughtful expression, dark fantasy camp outfit, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

Negative:

```text
existing game character, exact famous hammer, exact famous armor, faction emblem, over-detailed robe, unreadable face, photorealism, blur, text, watermark
```

### `orc-unknown`

목적: agent type 미확정 pane.

```text
original pixel art generic orc camp grunt for a dark fantasy developer dashboard, simple leather vest, neutral stance, small mysterious charm, muted moss and bone colors, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

Negative:

```text
famous character, faction emblem, heavy unique armor, text, logo, watermark, photorealism, blur, unreadable silhouette
```

### `orc-iron-commander`

목적: interrupt/control/command action의 상징.

```text
original pixel art orc iron commander for a dark fantasy developer dashboard, heavy generic war hammer, blackened iron armor, disciplined stance, stern expression, danger red and iron gray accents, dark fantasy camp command role, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

Negative:

```text
exact famous hammer, exact armor copy, named fantasy franchise character, faction emblem, photorealism, blur, text, watermark
```

### Epic Monster NPC (background별 512×512 boss)

camp scene마다 환경에 맞는 거대 boss 몬스터(ambient NPC, scene당 1마리)의 **base character 계약·variant
prompt·5종 animation prompt(`active`/`waiting`/`idle`/`roaming`/`error`)·생성 runbook·manifest schema**는
별도 SSOT [[16-Epic-Monster-NPC]]가 소유한다. background별 art 컨셉 프롬프트는 [[background-tile-merge-guide]]
§6 각 테마의 "Epic monster" 절, 런타임 행동/렌더는 [[SPEC-303-epic-monster-npc]]·[[SPEC-300-asset-rendering]]
§2.7/§3.10. (오크 character와 달리 크기 512×512, `stale`/`terminated` 없음, status-less. 전체 prompt는 여기
중복하지 않는다.)

### Character Portrait (bust / avatar)

각 character의 **Baldur's Gate 풍 2:3 흉상(bust) portrait**(머리→가슴, 정적·정면, CSS frame은 web 소유)의
framing 계약·character별 base prompt·prestige tier delta(5 base + 15 tier = 20)·생성 runbook·manifest
`portraits` schema는 별도 SSOT [[17-Character-Avatar-Portraits]]가 소유한다. 런타임 렌더/배치/수용 기준은
[[SPEC-304-character-avatar-portraits]]. (top-down sprite와 달리 세로 2:3·512×768·transparent·frame
미포함. 전체 portrait prompt는 여기 중복하지 않는다.)

## State Animation Prompts

Animation은 base character를 reference image로 고정하고 action prompt만 바꾼다.

### Idle

```text
idle breathing loop, subtle chest breathing, slight shoulder rise and fall, small weight shift, feet planted, no walking, no attack, no falling, no death pose, calm camp stance, keep same character design, transparent background, 7 frames, crisp pixel art
```

MCP 호출 기준:

```json
{
  "mode": "v3",
  "animation_name": "breathing-idle",
  "action_description": "idle breathing loop, subtle chest breathing, slight shoulder rise and fall, small weight shift, feet planted, no walking, no attack, no falling, no death pose, calm camp stance",
  "directions": ["south", "east", "north", "west", "south-east", "north-east", "north-west", "south-west"],
  "frame_count": 6
}
```

### Active

```text
active working loop, quick focused working motion, hands and shoulders moving with purposeful effort, subtle ember sparks and teal magic-tech glow, feet mostly planted, no walking, no attack, no falling, no death pose, keep same character design, transparent background, 7 frames, crisp pixel art
```

### Waiting

```text
waiting for input loop, small idle bounce, curious pause, subtle speech bubble shaped effect without text, looking expectant, feet planted, no walking, no attack, no falling, no death pose, keep same character design, transparent background, 7 frames, crisp pixel art
```

### Error

```text
error alert loop, short startled pose, red warning flash effect, slight shake feel, feet planted, no walking, no attack, no falling, no death pose, keep same character design, transparent background, 7 frames, crisp pixel art
```

### Stale

```text
stale inactive standing loop, upper-body only motion, slumped shoulders, slow tired breathing, tiny head droop, subtle dust motes or clock-like shimmer without text, both feet planted in the exact same spots, legs locked still, no stepping, no foot lift, no walking, no patrol, no travel, no sliding, no attack, no falling, no death pose, keep same character design, transparent background, 7 frames, crisp pixel art
```

### Terminated

`Falling Back Death (beta)` / `falling-back-death` template은 사용하지 않는다. 제품 `terminated` 상태는 아래 prompt의 standalone effect 또는 static overlay로만 생성한다.

```text
terminated fade-out animation, ghosted silhouette, lowering weapon, soft dissolve effect, no movement across canvas, keep same character design, transparent background, 4 frames, crisp pixel art
```

### Roaming

모든 character에 필수로 생성한다. 8방향 character는 8방향 `roaming`을 생성하고, 전투/공격/사망 pose 없이 camp 안을 순찰하는 움직임으로 제한한다. `roaming`은 idle이나 sliding motion이 아니라 다리가 번갈아 움직이는 walking patrol cycle이어야 한다.

PixelLab template animation에 `roaming`은 존재하지 않는다. 생성 시 `template_animation_id="roaming"`을 사용하지 말고, `mode="v3"` custom animation으로 호출한다.

```text
clear walking patrol cycle with visible leg motion, alternating left and right steps, knees bending, feet lifting and planting on the ground, slight body bob, carrying the main tool or weapon steadily, no sliding, no static legs, no idle pose, no attack, no falling, no death pose, keep same character design, transparent background, 8 animated frames, crisp pixel art
```

MCP 호출 기준:

```json
{
  "mode": "v3",
  "animation_name": "roaming",
  "action_description": "clear walking patrol cycle with visible leg motion, alternating left and right steps, knees bending, feet lifting and planting on the ground, slight body bob, carrying the main tool or weapon steadily, no sliding, no static legs, no idle pose, no attack, no falling, no death pose",
  "directions": ["south", "east", "north", "west", "south-east", "north-east", "north-west", "south-west"],
  "frame_count": 8
}
```

## Rotation Prompts

MVP는 front/south 1방향으로 충분하다. P1에서 camp scene 이동이나 facing direction이 필요해지면 4방향 또는 8방향으로 확장한다.

### 4-direction

```text
generate four directional views of the same original orc character, south, east, north, west, keep armor and silhouette consistent, 64x64 each, transparent background, crisp pixel art, no text, no logo
```

### 8-direction

```text
generate eight directional views of the same original orc character for a top-down pixel game, keep proportions, armor, weapon and color accents consistent, 64x64 each, transparent background, crisp pixel art, no text, no logo
```

## Logo & Brand Mark

> **현황 (2026-06-27): 공식 로고 확정.** 제품 로고는 직접 제작한 아트워크로 확정했다.
> - 파일: `asset-packs/orc-camp-default/brand/orc-camp-logo-transparent.png` (1747×900, RGBA 투명 — 기본 사용), `…/orc-camp-logo.png` (RGB solid).
> - PixelLab MCP는 텍스트/워드마크/풀씬 로고를 생성하지 못하므로(모든 생성 prompt가 `no text, no logo`), 로고는 외부에서 제작했다. 아래 §A/§B는 *확정 로고를 설명·재현*하기 위한 기준 문서이며, README·dashboard header·첫 페이지에는 이 아트워크를 그대로 사용한다.
> - PixelLab로 생성했던 emblem object들은 로고가 아니라 **in-app 장식 crest/badge 등 다른 용도**로 활용한다(§C).

### A. 확정 로고 설명 (canonical description)

가로 lockup. 좌측 원형 엠블럼 + 우측 워드마크.

- **엠블럼(좌)**: 통나무(timber) 원형 링 + 로프/금속 리벳 결속, 링 뒤로 양날 도끼 2자루가 X자로 교차. 링 외곽 상하좌우에 청록(teal) 보석 cabochon, 상단에 다이아몬드형 보석 장식. 링 안쪽 어두운 배경에 정면을 응시하는 사나운 녹색 orc 얼굴(빛나는 amber 눈, 두꺼운 눈썹, 크게 솟은 아래 엄니, 옅은 war paint). orc 머리 위 작은 어두운 명판에 청록색 `</>` 코드 태그. orc 아래에는 돌로 둘러싼 캠프파이어(주황·노랑 불꽃).
- **워드마크(우)**: `ORC CAMP`, 두껍고 가독성 높은 pixel/bitmap typeface, parchment-cream→tan 글자 + 두꺼운 dark outline + 살짝 돌출된 3D 하단 엣지.
- **palette**: dark `ink` 배경, `moss`/olive green orc, `ember` orange 불, `parchment`/`bone` 글자, teal(`</>`·보석) accent, brown timber.
- **의미**: orc(agent) + 캠프파이어(camp) + `</>`(개발 도구)를 한 배지에 결합 — 제품 컨셉을 한 마크로 압축.

### B. 외부 image generator prompt (로고 재현 / variant 생성용)

PixelLab로는 불가. 외부 pixel-art image generator로 확정 로고를 재현하거나 variant를 만들 때 아래 prose prompt를 사용한다(확정 아트워크를 그대로 쓰는 것이 1순위, 이 prompt는 보조).

```text
Create an original pixel art horizontal logo lockup for a developer tool called "Orc Camp". Left: a round emblem made of a timber-log ring bound with rope and iron rivets, two double-bladed axes crossed in an X behind the ring, teal gem cabochons at the four cardinal points and a small diamond gem ornament at the top. Inside the ring on a dark background: a fierce front-facing green orc face with glowing amber eyes, heavy brow, large protruding lower tusks and subtle war paint; a small dark plaque above the orc head showing a teal "</>" code bracket symbol; a lit campfire with orange-yellow flames and stones below the orc face. Right: the wordmark "ORC CAMP" in a chunky highly legible pixel/bitmap typeface, parchment-cream to tan letters with a thick dark outline and a slight extruded 3D bottom edge, baseline-aligned to the emblem height. Limited dark-fantasy palette: dark ink background, moss/olive green, ember orange, parchment, bone, teal accent, brown timber. Crisp nearest-neighbor pixel art, thick clean blocky outlines, no blur, no smooth gradients, no photorealism. Transparent background. Horizontal lockup, generous padding, readable at small sizes. Do not copy any existing game logo, character, location, or faction emblem.
```

Variants:

- mark-only(favicon/header): 좌측 엠블럼만, 워드마크 문장 제거.
- 세로 stacked(첫 페이지 중앙): `horizontal logo lockup` → `vertical stacked lockup, emblem on top, wordmark below, centered`로 교체.

검수: AI는 `ORC CAMP` 철자와 `</>`를 틀리게 렌더한다. 틀리면 확정 아트워크(`brand/`)를 그대로 쓰고, 워드마크가 따로 필요하면 §D로 합성한다.

### C. PixelLab emblem objects — 로고 아님, 다른 용도로 활용

PixelLab `create_map_object`로 만든 아래 emblem object는 **로고가 아니다.** in-app 장식 crest/badge, empty/loading state, section/about 아이콘 등으로 재활용한다(상세·sha256은 [[13-PixelLab-Asset-Registry]]).

- `brand/orc-camp-emblem-candidate-6d4f79aa.png` — 대족장 흉상 crest(원형 석재·철 링 + 화염 배경). empty/loading state 또는 about/section 장식 후보.
- `brand/orc-camp-emblem-candidate-49e81156.png` — orc 두상 + 캠프파이어, 단순 실루엣. small badge / generic camp icon 후보.
- 정식 채택·용도 확정 시 manifest에 항목 추가(asset pack v0.1.0는 `generation_status: closed`이므로 버전업 결정 필요).

### D. web-rendered 워드마크 (보조)

정적 로고 외에 in-app에서 "Orc Camp" 텍스트가 필요하면 이미지가 아니라 `--oc-font-pixel` pixel font로 web에서 렌더한다(SPEC-202, DESIGN.md typography). 색은 `parchment`/`ember` on `ink`. 확정 로고 워드마크와 톤을 맞춘다.

## Camp Background Prompts

### Orc City Warbase / Wartable Direction

내부 reference는 WoW 오그리마 도시의 전쟁기지와 전쟁 회의실 무드다. 실제 PixelLab prompt에는 `Orgrimmar`, `World of Warcraft`, faction emblem, 특정 도시 gate/skyline을 넣지 않는다. Orc Camp 고유의 `orc city warbase`, `red clay canyon fortress`, `rugged wartable`로 변환한다.

Reference-derived traits:

- red clay canyon stone, dusty fortress floor, dark timber palisades
- black iron spikes, bone bindings, hide awnings, rough rope lashings
- ember-lit forge/campfire glow, teal utility magic accent
- central blank wartable or command surface, small non-readable markers and tools
- no readable map, no faction symbol, no existing game city silhouette

Positive:

```text
original pixel art orc city warbase command hall for a developer dashboard, red clay canyon stone, dark timber palisades, black iron spikes, rugged hide awnings, ember-lit forge glow, central blank wartable with simple markers and tools, teal magic utility accents, clear safe area for character sprites and web-rendered UI, top-down game scene, crisp pixel art, no readable map, no emblem, no text, no logo, not based on any existing game location
```

Negative:

```text
existing game city, exact fantasy franchise location, recognizable gate silhouette, faction emblem, clan symbol, readable map, readable text, logo, watermark, photorealism, smooth gradient, blur, crowded composition, character close-up
```

### Warbase Camp Detail Background

```text
dark fantasy orc city warbase pixel art background for Orc Camp developer dashboard, top-down command courtyard inside red clay canyon walls, dark timber palisades and black iron spikes, central blank wartable platform, ember braziers, forge glow, teal utility magic posts, open safe lanes for placing orc agent sprites, 16:9 composition, 1024x576, crisp pixel art, no readable map, no text, no logo, no faction symbol, not based on any existing game location
```

### Generated Warbase Sunset Dashboard Background

`~/Downloads/ogrimar.png`를 mood reference로 읽고, 기존 게임 위치를 복제하지 않는 Orc Camp 고유 배경으로 변환해 생성한 prompt다. 핵심은 붉은 협곡 도시, 노을 역광, 가시형 목재/철제 방어 구조, 중앙 작전 광장, 하단 sprite safe area다.

```text
Create an original pixel art background image for a developer dashboard product called Orc Camp. Use the provided concept only as mood: a vast red-clay canyon warbase at sunset, warm orange sky, distant mesas, rugged fortified orc city, dark timber palisades, black iron spikes, bone-and-hide construction, ember-lit towers, forge glow, scattered command tents, and a central wartable command courtyard. Composition should be a 16:9 dashboard background with a clear lower-center safe area for placing small character sprites and UI overlays. No existing game city, no recognizable franchise location, no faction emblem, no readable banner symbol, no readable text, no logo, no copied character, no close-up hero figure. Crisp detailed pixel art, warm sunset palette, high readability, original fantasy warbase design.
```

Review notes:

- 하단 중앙은 orc sprite와 selection marker 배치를 위한 open terrain으로 유지한다.
- 좌우/상단에 tower, palisade, spike silhouette를 배치해 dashboard panel과 겹쳐도 배경 정체성이 남도록 한다.
- banner는 추상적인 붉은 cloth만 허용하고 readable symbol은 금지한다.
- character close-up은 배경 generation에서 제외한다. Mascot은 별도 sprite layer로 배치한다.

### Dashboard First-Page Background (Hero / Loading / Empty)

> 용도: web dashboard **첫 페이지**(loading "Scanning tmux sessions…" / empty / connect 상태) 배경. 중앙 상단에 logo lockup, 하단 clearing에 mascot sprite를 얹는다. DESIGN.md의 "marketing landing page를 첫 화면으로 만들지 않는다" 원칙에 맞춰 **marketing hero가 아니라 첫 진입(로딩/빈) 상태 화면**으로 설계한다.
>
> 생성 경로: PixelLab MCP로는 단일 풀씬을 만들 수 없다. 외부 image generator prose prompt를 쓴다. 기존 `warbase-sunset-dashboard`(in-app camp detail용)와 달리 **실제 게임 위치를 reference로 쓰지 않는다** — IP 안전을 위해 처음부터 original composition으로 생성한다.

Positive:

```text
Create an original pixel art background for the first screen of a developer dashboard called Orc Camp. Scene: a quiet dark-fantasy orc camp at dusk from a calm wide angle — a central ember campfire with warm orange glow, a few rugged tents and timber workbenches, tool racks, moss-green terrain, packed-dirt and stone paths, scattered braziers, faint teal magic-utility glow, distant red-clay canyon walls fading into a deep ink-blue night sky with a few stars. Mood is calm, atmospheric and uncluttered — an empty camp waiting for its orcs. Composition: 16:9, with a large darker safe area in the upper-center for a logo and one line of status text, and an open lower-center clearing for a single small mascot sprite. Limited palette: dark ink background, moss green, ember orange, parchment, bone, small teal accent. Crisp nearest-neighbor pixel art, clean outlines, high contrast, no blur, no gradients, no photorealism. No text, no letters, no logo, no readable map, no faction symbol, no close-up character, not based on any existing game location.
```

Negative:

```text
existing game location, recognizable city skyline, faction emblem, clan symbol, readable map, readable text, logo, watermark, photorealism, smooth gradient, blur, busy clutter, crowded composition, character close-up, bright daylight, marketing hero banner
```

Review notes:

- 중앙 상단은 logo lockup + `Scanning tmux sessions…` 한 줄을 얹을 어두운 safe area로 비운다.
- 하단 중앙 clearing에는 mascot(`orc-high-warchief-mascot`) `idle`/`south` sprite를 별도 layer로 배치한다(배경에 캐릭터를 굽지 않는다).
- 첫 화면이므로 저자극·차분 톤. 강한 노을·과밀 디테일은 in-app `warbase-sunset-dashboard`와 구분되게 피한다.
- 생성 후 `backgrounds/`에 추가하고 manifest `backgrounds`에 `logical_size`·`safe_area`·`sha256`·`usage: "dashboard first-page"`로 등록한다.
- IP 최안전 in-house 대안: 외부 생성 대신 `tiles/orc-camp-terrain-square-topdown` + prop object들을 frontend에서 조합해 깐 뒤 campfire glow/vignette를 CSS로 얹어 첫 페이지 배경을 구성한다.

### Wartable Command Room Background

```text
dark fantasy orc wartable command room pixel art background for a developer dashboard, low top-down interior scene, massive rugged blank war table in the center, hide awnings, bone markers, dark iron corner posts, red clay stone floor, ember torchlight, teal magic utility glow, clear edge space for inspector panels and command dock, 16:9 composition, 1024x576, crisp pixel art, no readable map, no text, no logo, no faction symbol, not based on any existing game location
```

### Default Night Camp

```text
dark fantasy orc camp pixel art background for a developer dashboard, top-down camp scene, central campfire, tents, wooden workbenches, tool racks, stone paths, moss terrain, ember orange firelight, teal magical utility glow, clear open safe area for placing character sprites, 16:9 composition, 1024x576, crisp pixel art, no text, no logo, no copyrighted symbols
```

Negative:

```text
busy clutter, unreadable layout, text, logo, faction emblem, copyrighted symbol, photorealism, smooth gradient, blur, extreme darkness, character close-up
```

### Day Variant

```text
dark fantasy orc camp pixel art background daytime variant, same layout as night camp, moss terrain, tents, wooden workbenches, tool racks, stone paths, clear open safe area for character sprites, soft daylight, readable UI contrast, 16:9 composition, 1024x576, crisp pixel art, no text, no logo
```

### Terrain Tileset

```text
pixel art terrain tileset for dark fantasy orc camp, moss ground, dirt path, stone path, campfire ground, tent floor, wooden platform, 16x16 tiles, seamless edges, consistent palette, no text, no logo
```

### Warbase Terrain Tileset

```text
pixel art terrain tileset for an original dark fantasy orc city warbase, red clay canyon ground, cracked stone courtyard, dark timber platform, black iron grate, scorched forge floor, dusty packed path, bone-and-rope boundary edge, ember-lit stone, seamless square tiles, consistent Orc Camp palette, no text, no logo, no faction symbol, not based on any existing game location
```

### Terrain Tiles Pro Fallback

2026-06-25 생성에 사용한 fallback prompt다. `create_topdown_tileset` Wang tileset이 `unknown error`로 실패하면 이 방식으로 먼저 MVP terrain variation set을 확보한다.

```json
{
  "tool": "create_tiles_pro",
  "description": "1). moss ground tile for a dark fantasy orc camp developer dashboard 2). packed dirt path tile 3). stone path tile 4). wooden platform tile 5). scorched campfire ground tile 6). hide tent floor tile 7). muddy moss edge tile 8). root and pebble ground tile",
  "tile_type": "square_topdown",
  "tile_view": "top-down",
  "tile_size": 32,
  "outline_mode": "segmentation"
}
```

## Prop Object Prompts

### Wartable Prop

```text
original pixel art rugged orc wartable prop for Orc Camp developer dashboard, blank parchment map surface without readable geography, small bone markers, iron daggers, rope, compass-like charm without letters, ember candle glow, dark timber legs, red clay dust, transparent background, no text, no logo, no faction symbol, not based on any existing game location
```

### Wartable Prop Review Pack

`create_1_direction_object`로 64px prop 후보를 생성할 때 사용한다. map/table 계열은 readable geography가 나오기 쉬우므로 `blank map surface`, `no readable map`, `no letters`, `no numbers`를 반복한다.

```json
{
  "tool": "create_1_direction_object",
  "view": "top-down",
  "size": 64,
  "description": "Orc Camp transparent top-down pixel art wartable and warbase prop set for a dark fantasy developer dashboard, original orc city warbase mood, red clay canyon dust, dark timber, black iron spikes, bone markers, ember glow, teal utility magic, no readable map, no text, no logo, no letters, no numbers, no faction symbol, not based on any existing game location",
  "item_descriptions": [
    "rugged rectangular wartable with blank parchment map surface and no readable geography, transparent background",
    "round command table with bone markers and empty dark surface, no text, transparent background",
    "red clay stone war room floor marker, no symbol, transparent background",
    "black iron spike barricade segment, transparent background",
    "dark timber palisade corner with rope bindings, transparent background",
    "ember brazier for command hall lighting, transparent background",
    "teal utility magic post for dashboard status, transparent background",
    "bone marker set without letters or numbers, transparent background",
    "rolled blank map bundle with rope, no readable map, transparent background",
    "iron dagger and command token on blank hide mat, transparent background",
    "hide awning post with black iron cap, transparent background",
    "red clay supply urn with bone handles, transparent background",
    "forge coal tray with ember glow, transparent background",
    "warbase boundary stone with no emblem, transparent background",
    "small blank tactical board with charcoal frame, no text, transparent background",
    "rope-lashed command crate with empty top surface, transparent background"
  ]
}
```

### Camp Prop Review Pack

`create_1_direction_object`는 `size=64`에서 16개 후보를 review 상태로 생성한다. 아래 item 순서를 manifest key 순서로 유지한다.

```json
{
  "tool": "create_1_direction_object",
  "view": "top-down",
  "size": 64,
  "description": "Orc Camp transparent top-down pixel art prop set for a dark fantasy developer dashboard, consistent palette with moss green terrain, ember orange campfire accents, teal magic utility glow, rugged wood, dark iron, leather and bone details, no text, no logo",
  "item_descriptions": [
    "central ember campfire in a rough stone ring, transparent background",
    "hide command tent with bone stakes and dark leather trim, transparent background",
    "wooden workbench with simple tools and parchment-free surface, transparent background",
    "tool rack with generic axe, hammer, and rope shapes, transparent background",
    "log pile with chopped wood and moss shadows, transparent background",
    "supply crate with rope bindings and iron corners, transparent background",
    "teal magic utility totem for agent status, transparent background",
    "wooden notice board with no text and bone pins, transparent background",
    "small forge with anvil and ember glow, transparent background",
    "straw training dummy with leather straps, transparent background",
    "rolled bedroll bundle with hide blanket, transparent background",
    "banner pole with abstract torn cloth, no symbol, transparent background",
    "wooden barrel with iron bands, transparent background",
    "stone marker with abstract cuts, no readable rune, transparent background",
    "coiled rope and cable bundle, transparent background",
    "small locked chest with bone latch, transparent background"
  ]
}
```

## State Effect Prompts

Effects는 character와 별도 transparent layer로 받는다.

### Active Effect

```text
pixel art status effect spritesheet, active working state, ember sparks and small teal magic glow, transparent background, 32x32 frames, 4 frames, crisp pixel art, no text, no logo
```

### Waiting Effect

```text
pixel art status effect spritesheet, waiting for input state, small speech bubble shape without text, gentle bounce, transparent background, 32x32 frames, 4 frames, crisp pixel art, no letters, no logo
```

### Error Effect

```text
pixel art status effect spritesheet, error state, red alert flash and jagged warning burst, transparent background, 32x32 frames, 4 frames, crisp pixel art, no text, no logo
```

### Stale Effect

```text
pixel art status effect spritesheet, stale inactive state, small dim clock-like ring and dust particles, transparent background, 32x32 frames, 4 frames, crisp pixel art, no numbers, no text, no logo
```

### Terminated Effect

```text
pixel art status effect spritesheet, terminated state, ghost fade and dissolving particles, transparent background, 32x32 frames, 4 frames, crisp pixel art, no text, no logo
```

## UI Element Prompts

### UI Asset Necessity Review

Orc Camp는 실제 developer dashboard이므로 UI 기능 자체는 HTML/CSS component로 구현한다. PixelLab UI asset은 필수 기능이 아니라 visual skin layer다. 단, 제품 콘셉트가 "tmux session은 camp, AI agent session은 orc"이므로 아래 UI skin은 MVP demo와 product identity에 필요하다.

| UI asset | 필요 여부 | 이유 | 생성 방식 |
| --- | --- | --- | --- |
| Status/toolbar icon | Required | 상태와 command를 색상 외 형태로 구분해야 한다. | generated: `orc-camp-status-ui` |
| Selection ring / target marker | Required | camp scene에서 선택된 orc와 tmux target을 명확히 보여준다. | PixelLab static transparent object |
| Panel frame skin | Required for demo, optional for core function | inspector/activity/settings panel이 camp scene과 시각적으로 붙는다. | CSS 9-slice 또는 border-image |
| Command dock frame | Required for control UX | send/interrupt 영역이 위험 command surface임을 구분한다. | CSS frame + PixelLab skin |
| Danger confirm modal frame | Required for safety UX | interrupt 같은 위험 action을 일반 action과 분리한다. | CSS frame + PixelLab skin |
| Button skin | Optional | CSS button으로 충분하지만 pixel style polish에 도움된다. | CSS 우선, PixelLab은 border/skin만 |
| Full dashboard screenshot | Not needed | 실제 data/layout/접근성을 이미지가 대신하면 안 된다. | 생성 금지 |
| Text label image | Not needed | localization, accessibility, contrast 조정이 어렵다. | 생성 금지 |

UI asset 생성 원칙:

- 텍스트, 숫자, logo, readable rune은 생성하지 않는다. 모든 label은 web UI에서 렌더링한다.
- frame asset은 content 영역을 비우거나 단순 parchment/charcoal fill로 둔다.
- hover/active/disabled/danger state는 색상만 다르게 하지 않고 border notch, metal corner, ember/danger accent 등 형태 차이를 둔다.
- panel/button은 CSS로 stretch할 수 있게 9-slice friendly 구조를 우선한다.
- icon은 기존 `orc-camp-status-ui` pack을 우선 사용하고, 누락된 icon만 추가 생성한다.
- CSS placeholder로 대체 가능해야 하므로 manifest에는 fixed logical size와 stretch rule을 같이 기록한다.

### UI Generation Priority

1. `ui-selection-markers`: selected, hover, target, drop/attach marker.
2. `ui-panel-frames`: inspector, activity log, settings, terminal preview frame.
3. `ui-command-surfaces`: command dock, danger confirm modal, button skins.
4. `ui-loading-empty`: campfire loading frame, empty camp marker, disconnected banner accent.

### Panel Frame

```text
pixel art UI panel frame for a dark fantasy developer dashboard, charcoal stone and dark iron border, subtle parchment inner surface, compact readable layout, 9-slice friendly, no text, no logo, crisp pixel art
```

### Button Set

```text
pixel art UI button set for dark fantasy developer dashboard, primary ember button, danger red interrupt button, disabled charcoal button, hover highlight variant, compact rectangular shapes, no text, no logo, crisp pixel art
```

### Status Badge Set

```text
pixel art status badge icon set, active spark, waiting speech bubble without text, idle pause icon, error warning burst, unknown mystery charm, stale clock ring without numbers, terminated stop icon, transparent background, 32x32 icons, no letters, no logo, crisp pixel art
```

### Toolbar Icon Set

```text
pixel art toolbar icon set for developer dashboard, send arrow, interrupt stop, refresh, settings gear, copy, attach terminal, visibility eye, lock, transparent background, 32x32 icons, high contrast, no text, no logo, crisp pixel art
```

### UI Selection Marker Review Pack

Camp scene 안에서 선택/hover/target 상태를 표시하기 위한 transparent overlay다. character sprite 아래 또는 주변에 깔리므로 강한 면 채움보다 outline과 glow 중심으로 만든다.

```json
{
  "tool": "create_1_direction_object",
  "view": "top-down",
  "size": 64,
  "description": "Orc Camp transparent pixel art selection and target marker set for a dark fantasy developer dashboard, flat top-down UI overlays, readable at small size, ember orange, teal magic, bone and danger red accents, no text, no logo, no letters, no numbers",
  "item_descriptions": [
    "selected orc marker, teal magic oval ring with small corner notches, transparent center",
    "hover orc marker, thin bone oval ring, transparent center",
    "active target marker, ember orange pulse ring, transparent center",
    "danger target marker, red jagged warning ring, transparent center",
    "attach target marker, small hook shaped teal ring, transparent center",
    "stale target marker, dim gray clock-like oval ring without numbers, transparent center",
    "unknown target marker, faint teal question charm silhouette without question mark text, transparent center",
    "drop zone marker, dashed bone oval ring, transparent center",
    "focus reticle, four small iron corner brackets, transparent center",
    "current pane marker, square charcoal bracket frame with teal corners, transparent center",
    "tmux window lane divider, short bone-and-iron horizontal marker, transparent background",
    "camp boundary marker, moss stone corner marker, transparent center",
    "agent spawn marker, small ember footprint glow without actual text, transparent background",
    "activity pulse marker, small circular spark burst, transparent center",
    "disconnected marker, broken red ring pieces, transparent center",
    "reconnect marker, teal circular arrow ring without text, transparent center"
  ]
}
```

### Panel Frame MCP Payloads

Panel frame은 정확한 aspect ratio가 필요하므로 `create_map_object`를 사용한다. 생성 결과는 그대로 stretch하지 말고, 9-slice crop 가능 여부를 검수한 뒤 CSS `border-image` 또는 sliced PNG로 등록한다.

#### Inspector Panel Frame

```json
{
  "tool": "create_map_object",
  "width": 192,
  "height": 256,
  "view": "side",
  "description": "pixel art inspector panel frame for Orc Camp developer dashboard, vertical charcoal stone and dark iron border, parchment-dark inner surface, small bone corner brackets, subtle teal selected accent, 9-slice friendly border, empty center for web-rendered text, transparent outside, no text, no logo, no letters, no numbers",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

#### Activity Log Panel Frame

```json
{
  "tool": "create_map_object",
  "width": 192,
  "height": 256,
  "view": "side",
  "description": "pixel art activity log panel frame for Orc Camp developer dashboard, compact dark charcoal parchment panel, rugged iron rail on one side, small ember tick marks without text, 9-slice friendly border, empty center for web-rendered event rows, transparent outside, no text, no logo, no letters, no numbers",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

#### Terminal Preview Frame

```json
{
  "tool": "create_map_object",
  "width": 256,
  "height": 160,
  "view": "side",
  "description": "pixel art terminal preview frame for Orc Camp developer dashboard, dark ink terminal surface with rugged iron border, subtle moss shadow, tiny non-readable scanline texture, empty center for real terminal text, 9-slice friendly, transparent outside, no readable text, no logo, no letters, no numbers",
  "detail": "low detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

#### Settings Panel Frame

```json
{
  "tool": "create_map_object",
  "width": 192,
  "height": 192,
  "view": "side",
  "description": "pixel art settings panel frame for Orc Camp developer dashboard, square dark iron and bone frame, subtle gear-shaped corner ornaments without symbols, parchment-dark inner surface, 9-slice friendly border, empty center for web-rendered controls, transparent outside, no text, no logo, no letters, no numbers",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

### Command Surface MCP Payloads

#### Wartable Command Dock Frame

```json
{
  "tool": "create_map_object",
  "width": 320,
  "height": 96,
  "view": "side",
  "description": "pixel art wartable command dock frame for Orc Camp developer dashboard, wide horizontal command surface inspired by an original orc city warbase, dark timber tabletop, black iron corner spikes, red clay dust, ember action socket, danger interrupt socket clearly separated, central empty input well for web-rendered text, no readable map, no text, no logo, no letters, no numbers, no faction symbol, 9-slice friendly, transparent outside",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

#### Command Dock Frame

```json
{
  "tool": "create_map_object",
  "width": 320,
  "height": 96,
  "view": "side",
  "description": "pixel art command dock frame for Orc Camp developer dashboard, wide horizontal charcoal and dark iron control surface, central empty input well for web-rendered text, ember primary action socket on right, danger red interrupt socket separated from send area, rugged but compact, 9-slice friendly, transparent outside, no text, no logo, no letters, no numbers",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

#### Danger Confirm Modal Frame

```json
{
  "tool": "create_map_object",
  "width": 256,
  "height": 160,
  "view": "side",
  "description": "pixel art danger confirmation modal frame for Orc Camp developer dashboard, dark iron warning frame with red ember cracks, bone corner locks, empty parchment-dark center for web-rendered target details, clear separation for confirm and cancel buttons without text, transparent outside, no text, no logo, no letters, no numbers",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "medium shading"
}
```

#### Camp Card Frame

```json
{
  "tool": "create_map_object",
  "width": 192,
  "height": 112,
  "view": "side",
  "description": "pixel art camp card frame for Orc Camp dashboard list, compact rugged parchment and charcoal card, small campfire socket for status icon, open content area for web-rendered session name and counts, subtle moss and ember accents, 9-slice friendly, transparent outside, no text, no logo, no letters, no numbers",
  "detail": "medium detail",
  "outline": "selective outline",
  "shading": "basic shading"
}
```

### Button Skin MCP Payloads

버튼은 CSS state로 구현하고 PixelLab asset은 border/skin으로만 사용한다. 텍스트는 절대 이미지에 포함하지 않는다.

```json
[
  {
    "tool": "create_map_object",
    "width": 96,
    "height": 32,
    "view": "side",
    "description": "pixel art primary button skin for Orc Camp developer dashboard, compact rectangular ember orange and dark iron border, empty center for web-rendered text, 9-slice friendly, transparent outside, no text, no logo, no letters, no numbers",
    "detail": "low detail",
    "outline": "selective outline",
    "shading": "basic shading"
  },
  {
    "tool": "create_map_object",
    "width": 96,
    "height": 32,
    "view": "side",
    "description": "pixel art secondary button skin for Orc Camp developer dashboard, compact rectangular charcoal and bone border, empty center for web-rendered text, 9-slice friendly, transparent outside, no text, no logo, no letters, no numbers",
    "detail": "low detail",
    "outline": "selective outline",
    "shading": "basic shading"
  },
  {
    "tool": "create_map_object",
    "width": 96,
    "height": 32,
    "view": "side",
    "description": "pixel art danger button skin for Orc Camp developer dashboard, compact rectangular danger red and black iron border, sharper corner notches, empty center for web-rendered text, 9-slice friendly, transparent outside, no text, no logo, no letters, no numbers",
    "detail": "low detail",
    "outline": "selective outline",
    "shading": "basic shading"
  },
  {
    "tool": "create_map_object",
    "width": 96,
    "height": 32,
    "view": "side",
    "description": "pixel art disabled button skin for Orc Camp developer dashboard, compact rectangular muted charcoal and gray bone border, empty center for web-rendered text, 9-slice friendly, transparent outside, no text, no logo, no letters, no numbers",
    "detail": "low detail",
    "outline": "selective outline",
    "shading": "flat shading"
  }
]
```

### Loading and Empty State MCP Payloads

```json
[
  {
    "tool": "create_map_object",
    "width": 96,
    "height": 96,
    "view": "top-down",
    "description": "pixel art campfire loading emblem for Orc Camp dashboard, small ember campfire with teal sparks in a stone ring, transparent background, no text, no logo, no letters, no numbers",
    "detail": "medium detail",
    "outline": "selective outline",
    "shading": "medium shading"
  },
  {
    "tool": "create_map_object",
    "width": 128,
    "height": 96,
    "view": "top-down",
    "description": "pixel art empty camp marker for Orc Camp dashboard, quiet moss clearing with unlit campfire stones and small tools, transparent background, no character, no text, no logo, no letters, no numbers",
    "detail": "medium detail",
    "outline": "selective outline",
    "shading": "basic shading"
  },
  {
    "tool": "create_map_object",
    "width": 256,
    "height": 48,
    "view": "side",
    "description": "pixel art disconnected banner accent for Orc Camp dashboard, dark iron horizontal banner frame with broken teal connection sparks, empty center for web-rendered warning text, transparent outside, no text, no logo, no letters, no numbers",
    "detail": "low detail",
    "outline": "selective outline",
    "shading": "basic shading"
  }
]
```

### Status/UI Review Pack

상태 effect와 command icon을 한 번에 16개 후보로 생성할 때 사용한다. 생성 결과는 animated spritesheet가 아니라 1-direction static object이므로, character 상태 animation 위에 overlay 또는 badge로 배치한다.

```json
{
  "tool": "create_1_direction_object",
  "view": "top-down",
  "size": 64,
  "description": "Orc Camp transparent pixel art status effect and UI icon set for a dark fantasy developer dashboard, compact readable silhouettes, ember orange, teal magic, bone, iron, parchment accents, no text, no logo, no letters, no numbers",
  "item_descriptions": [
    "active status effect, ember sparks with small teal utility glow, transparent background",
    "waiting status effect, small blank speech bubble shape without text, transparent background",
    "error status effect, red jagged warning burst without symbol or letters, transparent background",
    "stale status effect, dim clock-like ring without numbers plus dust motes, transparent background",
    "terminated status effect, ghost fade and dissolving particles, transparent background",
    "idle status effect, soft campfire glow ring, transparent background",
    "unknown status effect, small mystery charm with teal glint, transparent background",
    "send command icon, simple arrow made of bone and ember, transparent background",
    "interrupt command icon, red stop hand silhouette with iron cuff, transparent background",
    "refresh command icon, circular arrows made of teal magic, transparent background",
    "settings icon, small iron gear with bone center, transparent background",
    "copy icon, two overlapping blank parchment sheets, no text, transparent background",
    "attach icon, simple iron hook and rope loop, transparent background",
    "lock icon, small iron lock with bone latch, transparent background",
    "visibility icon, stylized eye with teal glow, transparent background",
    "pause icon, two small bone pillars, transparent background"
  ]
}
```

## Prompt Templates

### Character Base Template

```text
original pixel art {archetype}, {role}, {equipment}, {pose}, {accent_colors}, dark fantasy orc camp style, readable silhouette, 64x64 sprite, transparent background, crisp nearest-neighbor pixel art, no text, no logo, not based on any existing game character
```

### Animation Template

```text
{state_name} animation for the same original orc character, {state_motion}, {state_effect}, keep same character design and proportions, no movement across canvas, transparent background, {frame_count} frames, crisp pixel art, no text, no logo
```

### Background Template

```text
dark fantasy orc camp pixel art background, {time_of_day}, {layout_elements}, {lighting}, clear safe area for placing character sprites, {composition}, crisp pixel art, no text, no logo, no copyrighted symbols
```

## PixelLab 작업 가이드

### 1. Style Lock

1. `orc-warchief` base sprite를 10개 이상 생성한다.
2. readable silhouette, 독창성, 상태 확장 가능성을 기준으로 1개를 고른다.
3. 선택본을 style reference로 고정한다.
4. palette와 prompt/seed를 `generation/prompts.md`, `generation/seeds.json`에 기록한다.

### 2. Character Expansion

1. `orc-codex`, `orc-claude`, `orc-unknown`, `orc-iron-commander`를 Character Generation Standard로 생성한다.
2. `orc-warchief`와 같은 palette, camera angle, canvas size, 비슷한 머리 높이, 발 anchor 위치를 유지한다.
3. 너무 유명 캐릭터처럼 보이는 variant는 rejected variants로 분류한다.
4. base 8방향 생성 후 Required Animation Pack을 완료한다.
5. 최종 후보를 export zip, extracted PNG, `manifest.json`, `palette.json`, `LICENSE.md`, `ATTRIBUTION.md`, generation metadata와 함께 정리한다.

### 3. State Animation

1. base sprite를 reference로 넣는다.
2. state별 prompt로 animation을 생성한다.
3. frame이 canvas 안에서 흔들리면 수동 보정 또는 재생성한다.
4. 모든 state row는 같은 frame count를 우선한다.
5. reduced motion fallback frame을 manifest에 지정한다.

### 4. Background / UI

1. camp background는 sprite 배치 safe area가 있는지 먼저 본다.
2. UI element는 텍스트 없는 frame/icon만 생성한다.
3. panel, button은 web CSS와 함께 사용할 수 있게 단순하고 반복 가능한 형태로 둔다.
4. 너무 장식적인 asset은 dashboard readability를 해치므로 reject한다.

### 5. Export

1. transparent PNG 또는 spritesheet PNG로 export한다.
2. `manifest.json`에 frame size, anchor, FPS, state mapping을 기록한다.
3. `palette.json`, `LICENSE.md`, `ATTRIBUTION.md`를 함께 둔다.
4. prompt/seed/tool/options와 rejected variants를 generation 폴더에 보관한다.

## 검수 기준

- prompt에 기존 게임 고유명사가 없다.
- character가 특정 기존 게임 캐릭터로 바로 인식되지 않는다.
- sprite는 64x64에서 역할과 상태가 읽힌다.
- 모든 character는 같은 ground anchor를 공유한다.
- state animation은 canvas 밖으로 움직이지 않는다.
- UI icon은 32x32에서 의미가 읽힌다.
- background는 orc sprite와 inspector panel을 가리지 않는다.
- 모든 asset은 manifest key와 파일명이 일치한다.
- 라이선스와 재배포 조건이 확인되기 전에는 npm package에 포함하지 않는다.
