# 16 Epic Monster NPC — 자산 설계·생성 (background별 512×512 보스 몬스터)

## 목적

camp scene마다 환경에 어울리는 **Epic boss monster**를 NPC로 둔다. 이 문서는 그 몬스터의
**생성(generation)·자산 설계** 관점 SSOT다 — base character 계약(512×512), background별 variant
prompt, 5종 animation prompt(`active`/`waiting`/`idle`/`roaming`/`error`), 생성 runbook, manifest
`monsters` schema, 품질 검수를 고정한다.

런타임 **행동**(전체 walkable polygon roaming, 랜덤 dwell animation, 오크 교차 시 `error`,
비-상호작용)은 [[SPEC-303-epic-monster-npc]]가, 런타임 **렌더**(레이어·상태머신·fallback)는
[[SPEC-300-asset-rendering]] §2.7/§3.10이 소유한다. background별 **art 컨셉 프롬프트**는
[[background-tile-merge-guide]] §6 각 테마 블록의 "Epic monster" 절에 있다. 일반 prompt 규약은
[[12-PixelLab-Prompts]], 생성 ID/SHA-256 기록은 [[13-PixelLab-Asset-Registry]]가 소유한다.

> **현황(2026-06-29 갱신 — PixelLab MCP 인증 확인됨)**: PixelLab MCP는 **활성·인증**(구독 active, Tier 2:
> Pixel Artisan; 생성 잔량 확인)으로 더 이상 인증 보류 상태가 아니다. **단, 512는 MCP로 생성 불가**다 —
> MCP `create_character`의 `size`는 **최대 128px**(export ~247px)로 제한되므로, **512×512 native 생성은
> PixelLab 웹 UI**에서 수행하고 export zip을 import한다(이 경로 채택 — 사용자 결정 2026-06-29). 본 문서는
> 설계·prompt·schema를 고정하고, 실제 512 생성(웹 UI)→export zip 배치→manifest 반영(`status:"available"`)은
> asset pack **버전업(v0.2.0)**에서 수행한다. 생성 전까지 런타임은 몬스터를 렌더하지 않는다(§6, INV-NLB).
> 생성 전까지 런타임은 몬스터를 **렌더하지 않는다**(non-load-bearing — [[SPEC-303-epic-monster-npc]]
> §non-interactive, [[SPEC-300-asset-rendering]] §3.10).

---

## 1. 개념과 오크 캐릭터와의 차이

Epic monster는 오크 agent sprite와 **다른 클래스**다. 데이터(agent/pane)에 매이지 않는 **ambient NPC**이며
scene당 **정확히 1마리**(active background로 선택)다.

| 축 | 오크 캐릭터(agent sprite) | Epic monster NPC |
| --- | --- | --- |
| 데이터 바인딩 | `Orc`(tmux pane/agent) 1:1 | **없음**(데이터 무관, 순수 ambient) |
| 수 | camp의 orc 수만큼(최대 100) | scene당 **1마리** |
| 크기(frame) | ≈232px(요청 120) | **512×512**(PixelLab 요금제 최대) |
| animation set | idle·roaming·active·waiting·**stale**·error(+terminated=idle) | active·waiting·idle·roaming·**error** (stale/terminated 없음) |
| animation 선택 | `Orc.status` → state(§2.3) | **status 없음**; [[SPEC-303-epic-monster-npc]] 컨트롤러가 random dwell + roaming + 교차 error로 선택 |
| 이동 범위 | `safe_area` 내접 rect로 clamp | **`ground.polygon` 전체**(walkable 영역 전부) |
| 상호작용 | 선택·inspector·키보드·status overlay | **전부 없음**(`pointer-events:none`, tab order 제외) |
| asset 누락 시 | placeholder 박스 필수(상태 정보 보존, §3.6) | **렌더 생략**(정보 없음 → placeholder 불필요) |

---

## 2. Base Character Contract (512×512, 모든 variant 공통)

[[12-PixelLab-Prompts]] §Character Generation Standard를 몬스터용으로 확장한다. 목적: 같은 camp scene
안에서 frame size·camera angle·anchor가 오크 sprite와 정합하면서, 몬스터는 **압도적으로 크게**(오크의 ≈4–5×)
보이게 하는 것.

- **생성 경로: PixelLab 웹 UI**(512×512). **MCP `create_character`는 `size` 최대 128px**(export ~247px,
  2026-06-29 확인)로 512 native가 불가하므로 512 생성은 웹 UI에서 하고 export zip을 import한다. MCP는 ≤128
  draft/실험용으로만 사용. (참고: 오크는 size 120 → export 232px(~1.93×); 512는 웹 UI 한도.)
- Mode: 웹 UI 최고 품질(v3 상당). 실제 export frame size는 생성 후 [[13-PixelLab-Asset-Registry]]에
  source-of-truth로 기록하고 manifest `frame_size`를 그 값으로 교체한다.
- **Body type**: skeletal colossus(`monster-bonewraith-revenant`)는 `humanoid`. 네발 beast
  (behemoth/colossus 등)는 quadruped. **MCP quadruped는 템플릿 `bear/cat/dog/horse/lion` 중 하나 필수**
  (가장 근접: behemoth→bear). 웹 UI는 더 넓은 body type을 지원할 수 있으므로 생성 시 가장 근접한 type +
  prompt로 형태를 유도한다(양서류 bog-leviathan·전갈 duneplate-scourge는 정확한 템플릿이 없어 prompt 의존).
- View: `low top-down` (오크와 동일 카메라각)
- Directions: 8방향(아래 §4 direction 커버리지 참고)
- Prompt size phrase: `512x512 creature` (오크의 `120x120 character` 대응)
- Background: transparent
- Style: [[12-PixelLab-Prompts]] §공통 Style Prompt 그대로 — dark fantasy pixel art, readable silhouette
  at scene scale, crisp pixel art, no text, no logo
- **IP safety**: [[11-PixelLab-Asset-Setup]] 규칙 그대로 — **original creature**, 기존 게임의 보스/몬스터
  실루엣·이름·문양 재현 금지, `not based on any existing game monster or character` 명시.
- Anchor: **bottom-center**(발/하부 접지점). 512 frame 기준 가설 `[256, 384]`(하단 75% 높이) — 실제
  export frame에서 발 접지 y를 측정해 확정한다.

### 2.1 Base Character MCP Template

```json
{
  "mode": "v3",
  "body_type": "{four_legged | humanoid — variant별}",
  "name": "{Display Name}",
  "description": "{variant prompt — §5}",
  "size": 512,
  "view": "low top-down"
}
```

### 2.2 공통 prompt 접미 (모든 variant prompt 말미에 append)

```text
colossal epic boss creature, towering far larger than a humanoid, readable bold silhouette at small
scene scale, low top-down RPG sprite, transparent background, crisp pixel art, no text, no logo,
original design, not based on any existing game monster or character
```

---

## 3. Animation Set (5종 — status 없음)

오크와 달리 `stale`/`terminated`가 없다(agent가 아님). animation 선택은 status가 아니라
[[SPEC-303-epic-monster-npc]] 컨트롤러가 한다: 이동 중 `roaming`, 도착 dwell 시 `{active,waiting,idle}`
중 seeded-random, 오크 footprint와 교차 시 `error`(latch).

> **적용 단계(2026-06-30)**: 5종 모두 인도됐으나 **현재 적용은 `roaming`만**이다(연속 roaming). `idle`/`active`/`waiting`/`error`는 자산만 보유하고 **이후 Phase 2에서 적용**한다([[SPEC-303-epic-monster-npc]] §3 적용 단계). 본 §3 prompt/스펙은 전체(5종)를 유지한다.

> **§3 주 — animation 생성 경로(2026-06-29 확인·정정)**: `create_character` v3는 quadruped 미지원(humanoid
> 전용)이나, **`animate_character` v3 커스텀 애니메이션은 quadruped(네발 beast)에도 동작**한다(실측 확인). 따라서
> §3.1 커스텀 action 프롬프트를 **네발 beast·humanoid 모두**에 쓴다(template animation은 프레임 수가 고정
> `running-4-frames`=4f 등이라 9프레임 목표엔 쓰지 않음). **모든 애니메이션 = 9프레임**(사용자 계획, 2026-06-29):
> v3 `frame_count=8` → 출력 **9프레임**(1 reference + 8 animated; 오크 `roaming` 9f와 동일). **비용**: v3 커스텀 =
> **8 generation/방향** → roaming 8방향=64, dwell 4종 south=32 → variant당 **~96 gen**. 동시 job 슬롯 한도 **10**.

| Product state | engine | Directions | frames(=v3 `frame_count`+1) | 품질 규칙(거대 보스 스케일) |
| --- | --- | --- | --- | --- |
| `idle` | v3 custom | south MVP(→8dir 보류) | **9** (fc 8) | 느리고 묵직한 호흡, 발 고정, menacing 정적감 |
| `roaming` | v3 custom | **8방향** | **9** (fc 8) | 무게감 있는 walk cycle, 다리 교차·접지 분명, 미세 지면 흔들림 느낌, no sliding |
| `active` | v3 custom | south MVP(→8dir 보류) | **9** (fc 8) | 위협적 능동 동작(포효/내려치기 준비 느낌), 발 대부분 고정, no walking |
| `waiting` | v3 custom | south MVP(→8dir 보류) | **9** (fc 8) | 큰 호흡 + 주변 경계하듯 고개 돌림, 발 고정 |
| `error` | v3 custom | south MVP | **9** (fc 8) | 깜짝 놀람/격노 flash, 짧은 흔들림, 발 고정, no walking |

> **frame/direction 정책(확정)**: **모든 애니메이션 9프레임**(v3 `frame_count=8`). `roaming`만 8방향(이동 방향
> 시각화 필수), dwell 4종은 MVP **south 1방향**(오크 `error` south-only 선례). 8방향 dwell은 비용(8 gen/dir)
> 때문에 보류(§7). [[SPEC-300-asset-rendering]] §3.2-4 direction fallback이 south로 강등하므로 런타임 정합 유지.

### 3.1 Animation Prompts (모든 variant 공통; reference = 해당 variant base)

`{creature}` = variant 설명 명사구(예: "mossy boulder-hide behemoth"). animation은 base를 reference로
고정하고 action prompt만 바꾼다([[12-PixelLab-Prompts]] §State Animation Prompts 패턴).

**idle** (`breathing-idle`, frame_count 6)
```text
slow heavy breathing idle loop for a colossal {creature}, deep chest and shoulders rising and falling,
faint menacing sway, head low and watchful, feet firmly planted, no walking, no attack, no falling, no
death pose, keep same creature design, transparent background, crisp pixel art
```

**roaming** (`roaming`, 8방향, frame_count 8)
```text
clear heavy walking patrol cycle for a colossal {creature} with visible alternating leg motion, large
limbs lifting and planting with weight, ground-shaking lumbering gait, slow powerful body bob, no
sliding, no static legs, no idle pose, no attack, no falling, no death pose, keep same creature design,
transparent background, crisp pixel art
```

**active** (`active`, frame_count 6)
```text
menacing active loop for a colossal {creature}, powerful purposeful motion as if rearing up or readying
a heavy strike, shoulders and head surging, feet mostly planted, no walking across canvas, no falling,
no death pose, keep same creature design, transparent background, crisp pixel art
```

**waiting** (`waiting`, frame_count 6)
```text
watchful waiting loop for a colossal {creature}, large slow breathing with the head turning to scan the
surroundings, expectant looming pause, feet planted, no walking, no attack, no falling, no death pose,
keep same creature design, transparent background, crisp pixel art
```

**error** (`error`, frame_count 6)
```text
startled enraged alert loop for a colossal {creature}, short recoil then a furious flash, brief heavy
shake, feet planted, no walking across canvas, no attack swing, no falling, no death pose, keep same
creature design, transparent background, crisp pixel art
```

> `error`의 빨강 경보 flash는 sprite 자체에 녹이거나 [[SPEC-300-asset-rendering]] §3.4 effect overlay
> (`error-burst`)로 보강할 수 있다(오버레이는 오크와 동일 메커니즘 재사용).

---

## 4. Per-background Variant Roster (FROZEN — 6 variants ↔ 6 backgrounds)

키·라벨·background 매핑은 본 작업의 고정 roster다(변경 금지). 각 variant의 **art 컨셉 프롬프트**는
[[background-tile-merge-guide]] §6 해당 테마의 "Epic monster" 절에서 작성·확장한다. 아래 표는 그 컨셉을
base template(§2)·animation(§3)과 묶는 인덱스다.

> **prompt 보강(2026-06-29 — epic 화려함 강화)**: 아래 컨셉은 단순 beast가 아니라 **고대 war-titan급 보스**로 격상했다 — 산맥/갑주급 실루엣, 발광 룬·에너지 균열, 전리품·전투 깃발, 결정/가시 성장물, 극적 aura. **body_type은 실제 MCP enum**(`humanoid` | `quadruped`+template `bear/cat/dog/horse/lion`)으로 표기하며, 정확한 템플릿이 없는 형태(양서류·전갈)는 **가장 근접 템플릿 + prompt 의존**이다(또는 웹 UI). pro 모드 quadruped는 **template animation**(§3 주)을 쓴다.

| manifest key | label | background | merge-guide 테마 | body_type(MCP) | 컨셉(epic 보강·IP-safe; 팔레트 = 테마 일치) |
| --- | --- | --- | --- | --- | --- |
| `monster-mosshide-behemoth` | Mosshide Behemoth | `orccamp-default` | 테마 0 Default | quadruped(bear) | 고대 mossy boulder **war-titan** — 산맥 같은 이끼·바위 등판, 철고리 두른 거대 엄니, ember-magma 발광 균열·룬, 뼈 전리품·전투 깃발, 등줄기 ember/결정; moss-green·stone-grey·ember |
| `monster-frostfang-colossus` | Frostfang Colossus | `froststeel-camp` | 테마 1 Froststeel | quadruped(bear/horse) | 고대 **frost-titan** — 서리 흰 장모 + glacial-blue 결정 갑판, aurora-teal 에너지 뿔·가시, 얼음 룬·언 전리품·고드름 깃발; frost-white·glacial-blue·aurora-teal |
| `monster-magma-colossus` | Magma Colossus | `emberforge-camp` | 테마 2 Emberforge | quadruped(bear) | 고대 **magma golem-titan** — 흑요석·현무암 갑주에 ember-red/orange 용암 균열, 화산 vent·연기, forge 룬·발광 사슬·탄 뼈 전리품; obsidian·ember·ash |
| `monster-bog-leviathan` | Bog Leviathan | `mirebog-camp`(등록·gate PASS 0.3274) | 테마 3 Mirebog | quadruped(bear)+prompt(양서류) | 고대 **bog leviathan** — 이끼·덩굴·진흙물, witch-fire green 생물발광 무늬·균사, 뼈·표류목 가시, 어망·늪뼈 전리품, 녹색 늪안개; murky green·witch-fire green·fog |
| `monster-duneplate-scourge` | Duneplate Scourge | `sunscorch-camp`(테마, 미생성) | 테마 4 Sunscorch | quadruped+prompt(전갈) | 고대 **desert scourge-titan** — 뼈장갑 전갈형, sandstone 키틴·표백 bone 갑옷, 거대 분절 꼬리·집게, 새김 석판·해골 전리품·열기 아지랑이; sandstone·bone·harsh shadow |
| `monster-bonewraith-revenant` | Bonewraith Revenant | `necropolis-camp` | 테마 5 Necropolis | humanoid(skeletal) | 고대 **skeletal revenant colossus** — 고딕 bone 갑주 + 보라 장의 천, teal/cyan ghost-fire 휘감김, soul-flame 눈·갈비 spectral fire, 해골 왕관·발광 네크로 룬·spectral 사슬; bone·teal ghost-fire·purple |

- 6 variant ↔ 6 background. **등록된 background 5개**(default/froststeel/emberforge/necropolis/**mirebog**) +
  디자인-only 테마 1개(sunscorch). 등록된 5개는 `backgrounds.<bg>.epic_monster` 정방향 링크를 갖는다.
  sunscorch는 background 자체가 아직 미생성이라 manifest에서 **background 키를 새로 추가하지 않고**
  `monsters.<key>.background`로만 forward 연결한다(§6 매핑 주).
- 각 variant는 **실루엣이 서로 뚜렷이 구분**되고 **해당 background 팔레트와 일치**해야 한다.
- 몬스터는 그 background의 기존 `ground.polygon`을 roaming한다(새 polygon 만들지 않음 —
  [[SPEC-303-epic-monster-npc]]).

### 4.1 variant prompt 조립 규칙

variant prompt = `[merge-guide §6 테마의 Epic monster 컨셉 문장]` + `§2.2 공통 접미`. animation은 §3.1의 5
prompt에서 `{creature}`를 그 variant 명사구로 치환해 그대로 쓴다. seed는 variant별로 고정 기록(재현성,
[[13-PixelLab-Asset-Registry]]).

---

## 5. 생성 Runbook (turnkey — 512는 PixelLab 웹 UI)

> 전제: PixelLab 구독 active(확인됨). **512는 웹 UI에서 생성**한다(MCP `create_character` size≤128 — §2). MCP는
> ≤128 draft에만 사용.

variant마다(웹 UI):

1. **base 생성**: PixelLab 웹 앱에서 512·8방향·`low top-down`·transparent로 character 생성(variant prompt §4.1,
   body type §2). 8방향 rotation 완료 확인. (MCP draft가 필요하면 size 128로 `create_character` 후 `get_character`.)
2. **animation 생성**: state별로 §3.1 prompt를 적용(`roaming`=8방향, dwell 4종 `idle/active/waiting/error`=south
   MVP). 명명 규약은 manifest folder(§6)와 맞춘다([[12-PixelLab-Prompts]] §Animation Submission Rules).
3. **export → 배치**: export zip → `asset-packs/orc-camp-default/sprites/monsters/<key>/<Char>/`에 압축 해제
   (오크 sprite 경로 규약과 동일 구조: `rotations/`, `animations/<...>/<direction>/frame_%03d.png`).
4. **registry 기록**: [[13-PixelLab-Asset-Registry]]에 `pixellab_character_id`·export zip + SHA-256·
   extracted root·사용 prompt·seed·8방향 QA를 variant별로 기록.
5. **manifest 반영**: §6 schema의 해당 `monsters.<key>` 엔트리를 실제 frame_size/anchor/folder로 채우고
   `status:"planned"`→`"available"`, `pixellab_character_id:null`→실 ID로 교체. background 연결(§6) 확인.
6. **asset pack 버전업**: v0.2.0(prestige tier와 동일 버전업 묶음 가능).

---

## 6. Manifest `monsters` schema (planned 블록)

`asset-packs/orc-camp-default/manifest.json`에 **additive top-level `monsters`** 블록을 추가한다(런타임
loader는 cast 기반이라 미소비 키를 무시 — [[SPEC-300-asset-rendering]] §2.7). 각 엔트리는
`characters.*` shape를 따르되 `frame_size:[512,512]`, `status:"planned"`, `pixellab_character_id:null`,
`background:"<bg-key>"`를 갖는다. animation `folders`는 생성 전 placeholder 경로다.

```jsonc
"monsters": {
  "monster-mosshide-behemoth": {
    "display_name": "Mosshide Behemoth",
    "status": "planned",                 // enum: "planned" | "available" | "deprecated" (SSOT). 런타임은 "available"일 때만 렌더(SPEC-300 §2.7-2)
    "pixellab_character_id": null,
    "background": "orccamp-default",      // 이 몬스터가 속한 background
    "body_type": "four_legged",
    "role": "epic ambient boss NPC",
    "root": "sprites/monsters/monster-mosshide-behemoth/<Char>",
    "frame_size": [512, 512],            // 생성 후 실제 export 크기로 교체
    "scale": 1,                          // 본질 스케일. 화면 렌더 스케일/배경별 축소는 SPEC-303 feasibility
    "anchor": [256, 384],                // bottom-center 가설; export 후 확정
    "view": "low top-down",
    "directions": ["south","east","north","west","south-east","north-east","north-west","south-west"],
    "rotations": { "south": "rotations/south.png" /* …8방향 */ },
    "animations": {
      "roaming": { "pixellab_animation": "roaming", "frames": 8, "fps": 6,
                   "frame_pattern": "frame_%03d.png",
                   "folders": { "south": "animations/roaming/south" /* …8방향 */ } },
      "idle":    { "pixellab_animation": "breathing-idle", "frames": 6, "fps": 3,
                   "frame_pattern": "frame_%03d.png", "coverage": "south-only",
                   "folders": { "south": "animations/idle/south" } },
      "active":  { "pixellab_animation": "active",  "frames": 6, "fps": 4, "coverage": "south-only",
                   "frame_pattern": "frame_%03d.png", "folders": { "south": "animations/active/south" } },
      "waiting": { "pixellab_animation": "waiting", "frames": 6, "fps": 3, "coverage": "south-only",
                   "frame_pattern": "frame_%03d.png", "folders": { "south": "animations/waiting/south" } },
      "error":   { "pixellab_animation": "error",   "frames": 6, "fps": 6, "coverage": "south-only",
                   "frame_pattern": "frame_%03d.png", "folders": { "south": "animations/error/south" } }
    },
    "reduced_motion": { "fallback_state": "idle", "fallback_direction": "south",
                        "fallback_frame": "rotations/south.png" }
  }
  // monster-frostfang-colossus / -magma-colossus / -bog-leviathan / -duneplate-scourge /
  // -bonewraith-revenant : 동일 shape, background/ body_type/ root만 변경
}
```

**background 연결(2-way, 명시)**:
- 생성된 background 4개는 `backgrounds.<bg>.epic_monster: "<monster-key>"`로 정방향 링크한다
  (default→mosshide, froststeel→frostfang, emberforge→magma, necropolis→bonewraith).
- 등록된 background 5개(default/froststeel/emberforge/necropolis/**mirebog**)는 `backgrounds.<bg>.epic_monster`
  정방향 링크를 갖는다(mirebog → `monster-bog-leviathan`). 미생성 테마 `sunscorch`만 background 키를 새로
  만들지 않고 `monsters.<key>.background`로 forward 표기한다(해당 background 생성 시 정방향 링크 추가).
- 런타임 resolution: active background 키로 (i) `backgrounds[bg].epic_monster` 우선, 없으면 (ii)
  `monsters` 중 `background==bg`인 엔트리를 찾는다([[SPEC-300-asset-rendering]] §2.7).

---

## 7. 품질 검수 (생성 후)

[[11-PixelLab-Asset-Setup]] 체크리스트 + 몬스터 전용:
- 6 variant **실루엣이 서로 구분**되고(색 없이도) 각자의 background 팔레트와 일치.
- 8방향 rotation 정체성/형태 일관(드리프트 없음), `roaming` 8방향 다리 모션 분명(sliding 없음).
- scene scale에서 **오크 대비 압도적 크기**로 읽히되, `ground.polygon`(특히 necropolis 최소 polygon)에서
  footprint가 walkable을 벗어나지 않는지 [[SPEC-303-epic-monster-npc]] feasibility와 교차 확인.
- frame_size/anchor가 export 실값으로 manifest에 반영, 발 접지 y 정확.
- **IP 오인 가능성 재검수**(기존 게임 보스 몬스터로 보이지 않는지) — 배포 전 자산 리뷰 필수.
- ember/teal/witch-fire 등 발광이 dark 배경에서 과포화/halo 없이 읽힘.

## 8. 확장 여지 (deferred)

- dwell 4종(idle/active/waiting/error) **4/8방향** 확장(현재 south MVP).
- variant별 전용 `error` 연출(테마 색 flash)·`active` 강화 모션.
- background 추가(sunscorch 생성) 시 정방향 `epic_monster` 링크 + 그 background 전용 variant 튜닝(mirebog는 등록 완료).
- 몬스터-오크 교차 시 **오크 측 반응**(현재는 몬스터만 `error`) — [[SPEC-303-epic-monster-npc]] open question.
