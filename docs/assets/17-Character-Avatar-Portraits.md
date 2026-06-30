# 17 Character Avatar Portraits — 자산 설계·생성 (BG-style 2:3 흉상/bust)

## 목적

delivered 5종 character 각각의 **Baldur's Gate 풍 PIXEL PORTRAIT(흉상/bust)** asset class를 정의한다.
이 문서는 그 portrait의 **생성(generation)·자산 설계** 관점 SSOT다 — framing 계약, character별 base
prompt, prestige tier별 prompt delta(5 × 3 = 15), 생성 runbook, manifest `portraits` schema, 품질
검수를 고정한다.

런타임 **소비/렌더/배치 계약**(어느 패널 slot에, 어떤 CSS frame으로, 어떤 fallback으로 그리는지)과
**테스트 가능한 수용 기준(AC)** 은 [[SPEC-304-character-avatar-portraits]]가 소유한다 — 본 문서는 AC를
중복하지 않는다. character 정체성·house style·기존 base prompt는 [[12-PixelLab-Prompts]], 생성 ID/SHA-256
추적은 [[13-PixelLab-Asset-Registry]], prestige tier 외형 delta(T1→T3 escalation)는 [[15-Character-State-Model]]
§2/§4가 source다.

> **현황(2026-06-29)**: **spec 작성 단계**다. PixelLab 생성 tool 호출·manifest.json 편집·이미지 생성은
> 본 문서에서 **수행하지 않는다**(deferred). 본 문서는 prompt/runbook/schema를 turnkey로 고정하고, 실제
> 20장 생성·SHA-256 기록·manifest `portraits` 블록 반영은 인증/credit 확인 후 asset pack **버전업**에서
> 수행한다. 생성 전까지 런타임은 portrait 미가용으로 간주하고 [[SPEC-304-character-avatar-portraits]]의
> placeholder fallback으로 동작한다.

---

## 1. Portrait Framing 계약 (LOCKED — SPEC-304와 동일)

이 절은 [[SPEC-304-character-avatar-portraits]]가 그대로 참조하는 **공유 계약**이다. 변경 시 두 문서를 함께 고친다.

1. **Asset class = `portraits`**: 정적(STATIC) front 또는 slight three-quarter **bust portrait**(머리→
   가슴 중앙/어깨)다. top-down sprite가 **아니다**, animation이 **아니다**, baked frame이 **없다**.
2. **Aspect & size**: 세로 **2:3**. canonical source target **512×768 px**(pixel 선명도를 위해 세로 ≥512,
   transparent). 실제 export 크기는 생성 후 manifest에 source-of-truth로 기록한다.
3. **Frame ownership = web UI(CSS)**: 장식용 BG-style frame/border는 **dashboard가 CSS(또는 기존
   panel-frame asset)로 렌더**한다. portrait 이미지에 **굽지 않는다**. 따라서 portrait art는 CSS frame이
   얼굴을 자르지 않도록 **~6–10% safe padding**을 두고 그 안에서 읽혀야 한다.
4. **구도**: head→mid-chest, front 또는 slight 3/4, **시선은 viewer를 향한다**(gaze toward viewer). 어깨와
   상반신 갑옷이 보이되 무기·full body는 frame 밖이거나 암시만 한다.
5. **signature accent color**(character별): face/엄니/머리 + 상반신 갑옷 + 1개 signature accent로 정체성을
   읽게 한다. 색만으로 구분하지 않고 실루엣/장비/표정으로도 구분되게 한다.
6. **readability**: dashboard 패널 slot 표시 크기 **약 220×330 px**(2:3 유지)에서 얼굴·엄니·표정·signature
   accent가 또렷이 읽혀야 한다. 작은 디테일(텍스트, 미세 문양)은 금지.

| character key | signature accent (palette token) | bust 정체성 anchor(읽혀야 하는 것) |
| --- | --- | --- |
| `orc-high-warchief-mascot` | `ember` `#D6723F` (ember orange) | 높은 상투+거친 갈기, 큰 ivory 엄니, fierce battle-shout, 비대칭 spiked iron 견갑 |
| `orc-claude-storm-shaman` | `mana` `#4AA3DF` (teal storm) | 차분한 advisor 표정, weathered moss cloak hood/어깨, teal storm rune 광 |
| `orc-codex-field-engineer` | `mana` `#4AA3DF` (teal magic-tech) | 집중한 장인 표정, leather apron+charcoal bracer, 어깨 옆 teal tech glow/단말 광 |
| `orc-unknown` | muted `moss`/`bone` + 미약한 `mana` glint | neutral/모호한 표정, simple leather vest, 작은 mysterious charm의 teal glint |
| `orc-iron-commander` | `danger` `#C94C4C` + iron gray(`charcoal`) | 단호한(stern) 표정, 뿔 투구(horned helm), blackened iron 견갑, 붉은 망토 깃 |

---

## 2. 공통 style / negative 규약 (모든 portrait 공통)

[[12-PixelLab-Prompts]] 공통 style/IP 규약을 portrait로 reframe한 것이다. 각 character positive에 아래
**framing prefix**와 **style suffix**를 붙이고, **negative**를 공통으로 둔다.

### Framing prefix (positive 앞)

```text
vertical 2:3 pixel art character portrait bust, framed from the top of the head down to mid-chest and shoulders, front view with a slight three-quarter turn, eyes gazing toward the viewer, centered with generous safe padding so the face is never cropped, 512x768, transparent background
```

### Style suffix (positive 뒤)

```text
dark fantasy pixel art for the developer tool Orc Camp, original orc archetype, warm olive-green orc skin with moss-green shadows and pale highlights, oversized ivory tusks, readable bust silhouette at small panel size, limited Orc Camp palette, crisp nearest-neighbor pixel art, clean blocky outlines, high contrast on a dark background, no blur, no gradients, no photorealism, no text, no letters, no numbers, no logo, no watermark, no faction emblem, no baked frame or border, not based on any existing game character
```

### 공통 Negative

```text
full body, legs, hips, waist-down, top-down sprite, walking pose, action pose, multiple characters, crowd, baked decorative frame, ornate carved border, baked background scene, landscape, weapon as the focus, text, letters, numbers, runes with readable glyphs, logo, watermark, faction emblem, clan symbol, photorealism, smooth gradients, blurry edges, anime style, modern sci-fi, helmet covering the whole face, tiny unreadable facial details
```

> 생성 시: `{framing prefix}, {character positive}, {style suffix}` 순서로 결합한다. negative는 character별
> 추가 negative와 합친다.

---

## 3. Character별 base portrait prompt (5종)

각 prompt는 [[12-PixelLab-Prompts]] §Character Prompts의 base 정체성을 **bust portrait로 reframe**한 것이다
(얼굴·엄니·머리·표정·어깨/상반신 갑옷·signature accent 중심, full body·무기 강조 제거).

### 3.1 `orc-high-warchief-mascot` — Orc High Warchief Mascot

Positive (character 본문):
```text
fierce orc high warchief mascot bust, broad muscular veteran orc, long black hair tied in a high topknot with a loose mane over the shoulders, oversized ivory tusks, heavy brow and strong jaw, fierce battle-shout expression with bared teeth, asymmetrical spiked iron shoulder armor with heavy fur trim and rugged leather straps across the upper chest, a single bone trophy at the collar, warm ember-orange metal highlights, confident veteran camp-leader presence
```
Negative (추가):
```text
exact armor copy, exact axe copy, recognizable horde warchief, named franchise warchief, giant axe filling the frame, clan tattoo glyph
```
Signature accent: `ember` `#D6723F`.

### 3.2 `orc-claude-storm-shaman` — Orc Claude Storm Shaman

Positive:
```text
calm orc storm shaman strategist bust, observant thoughtful expression, weathered dark moss-green cloak hood draped over the shoulders, charcoal cloth wraps and bone-and-leather fasteners at the collar, the carved top of a staff or a small round totem just visible at one shoulder, soft teal storm-magic glow tracing the cloak edge, wise advisor presence
```
Negative (추가):
```text
exact famous staff, exact famous shaman armor, glowing eyes too bright, full robe to the floor, lightning filling the frame
```
Signature accent: `mana` `#4AA3DF` (teal storm — arc/번개 톤).

### 3.3 `orc-codex-field-engineer` — Orc Codex Field Engineer

Positive:
```text
rugged orc field engineer bust, focused practical working expression, leather apron over the chest with charcoal metal bracers and bone fasteners, a compact dark-iron tool strap across one shoulder, a small glowing terminal tablet edge with a teal magic-tech glow at one shoulder, soft cool teal circuit-like light, capable camp-engineer presence
```
Negative (추가):
```text
robot, modern laptop logo, sci-fi visor, readable terminal text, brand mark on the tablet
```
Signature accent: `mana` `#4AA3DF` (teal magic-tech — circuit/cool 톤, shaman의 storm arc와 구분).

### 3.4 `orc-unknown` — Unknown Orc Grunt

Positive:
```text
generic orc camp grunt bust, neutral undetermined expression, simple worn leather vest over the shoulders, plain cloth wraps, a small mysterious charm hanging at the collar with a faint teal glint, muted moss-green and bone colors, low-key anonymous presence with no clear specialization
```
Negative (추가):
```text
heavy unique armor, clear warrior look, clear mage look, clear engineer look, bright saturated accent, distinctive insignia
```
Signature accent: muted `moss` `#4F6F52` / `bone` `#D8C9A3` + charm의 미약한 `mana` glint.

### 3.5 `orc-iron-commander` — Orc Iron Commander

Positive:
```text
disciplined orc iron commander bust, stern hardened expression, blackened iron plate armor over the shoulders and upper chest, a horned iron helm framing the face without covering it, the collar of a deep red command cape at the shoulders, danger-red and iron-gray accents, authoritative command presence
```
Negative (추가):
```text
exact famous hammer, exact armor copy, named franchise warchief, recognizable signature warhammer in frame, full-face visor
```
Signature accent: `danger` `#C94C4C` + iron gray(`charcoal` `#262D2F`).

---

## 4. Prestige tier별 prompt delta (5 × 3 = 15)

[[15-Character-State-Model]] §4의 tier escalation을 **bust portrait로 reframe**한 `edit_description` 델타다.
각 델타는 해당 character의 **base portrait에서** 생성한다(체이닝 금지 — 항상 base를 source로; 정체성 드리프트
방지, doc 15 §4와 동일 정책). bust이므로 escalation은 **상반신/어깨 갑옷 + 견장(insignia)/관(crown/helm) +
collar의 trophy + signature accent 강도 + 표정 격**으로 표현한다(full-body 장비·무기 escalation은 frame
밖이므로 암시만).

**공통 접미**(모든 tier 델타 말미에 결합):
```text
keep the SAME orc identity, face, tusks, hair, head proportions, and bust framing as the source portrait; vertical 2:3 bust, head to mid-chest, eyes toward viewer, ~6-10% safe padding, transparent background, crisp pixel art, no baked frame, no text, no letters, no logo, no watermark, no faction emblem, not based on any existing game character; edit the static armor/insignia/accent appearance only, do NOT change the framing, pose, or expression into a new character.
```

> **무기/IP 주의(bust 한정)**: portrait는 흉상이므로 무기는 frame 밖이거나 어깨 위 haft 암시에 그친다. 무기를
> frame 안으로 끌어들이거나 signature weapon 실루엣으로 수렴시키지 않는다. `use_color_palette_from_reference`
> 권고는 doc 15 §4와 동일(T1=true로 색 일관, T2/T3=false로 새 accent 도입).

### 4.1 `orc-high-warchief-mascot`

> ⚠️ **IP 발산(필수)**: base는 기존 게임 warchief archetype 재해석([[13-PixelLab-Asset-Registry]]). 고티어로
> 갈수록 상징 실루엣 수렴 압력↑ → T2/T3는 §6 IP 리뷰 **blocking**. 각 델타에 발산 문구 포함.

**T1 — Ironclad Veteran** (`use_color_palette_from_reference: true`)
```text
Reinforce the bust armor: heavier layered iron shoulder plate with riveted trim and a thicker fur-lined mantle over the shoulders; add an engraved bronze collar piece and one more bone trophy at the collar. Slightly strengthen the warm ember metal highlights. Keep the helm/topknot silhouette clearly distinct from any iconic horde warchief.
```
**T2 — Ember Champion** (`use_color_palette_from_reference: false`; ember-red + subtle gold)
```text
Make the bust far more elaborate: full sculpted spiked pauldrons, an ornate engraved breastplate edge, a regal fur mantle, a bone-and-iron circlet across the brow, and gilded trophy chains at the collar. Intensify the warm ember glow on the metal so the bust reads as a champion. Keep the silhouette original and distinct from any iconic existing warchief; no recognizable signature weapon in frame.
```
**T3 — Legendary Warlord** (`use_color_palette_from_reference: false`; ember-red + gold filigree)
```text
Make this the most lavish legendary warlord bust: massive ornate spiked pauldrons, gold-trimmed blackened plate with glowing ember-red filigree, a heavy ceremonial fur cloak collar, and a towering crested helm or crown above the brow. Add a subtle blazing ember aura behind the shoulders and a few floating sparks. Keep the face, tusks, and silhouette clearly ORIGINAL and distinct from any iconic existing warchief; do not bring a signature weapon into frame.
```

### 4.2 `orc-claude-storm-shaman`

> ⚠️ **IP 발산**: T3는 §6 IP 리뷰 **blocking**(유명 shaman 수렴 방지).

**T1 — Storm Adept** (`use_color_palette_from_reference: true`)
```text
Reinforce the shaman regalia at the shoulders: a thicker layered ceremonial robe collar with a reinforced shoulder mantle over the weathered cloak; add bone-inlaid fasteners and a small focusing crystal at one shoulder. Slightly brighten the teal storm-rune trim along the collar edge.
```
**T2 — Tempest Shaman** (`use_color_palette_from_reference: false`; brighter teal + subtle silver)
```text
Make the regalia far more elaborate: an ornate storm-warden robe collar with metal-and-bone pauldrons and layered cloth at the shoulders; a glowing storm crystal and a few small orbiting teal spark motes near one shoulder. Intensify the teal storm magic so the bust reads as a stronger caster, with short arcs along the collar.
```
**T3 — Stormcaller Archon** (`use_color_palette_from_reference: false`; teal-gold)
```text
Make this the most powerful archon bust: flowing storm-silk robe with glowing teal-gold filigree and a high ceremonial collar framing the neck; a levitating totem ring near one shoulder wreathed in crackling teal lightning, with floating runes (no readable glyphs) behind the shoulders. Keep the face and silhouette original and distinct from any famous shaman.
```

### 4.3 `orc-codex-field-engineer`

**T1 — Senior Engineer** (`use_color_palette_from_reference: true`)
```text
Reinforce the work rig at the shoulders: a plated work-harness over the leather apron with sturdier charcoal-iron bracers and one extra precision tool on the shoulder strap; a larger terminal-tablet edge at one shoulder. Slightly brighten the teal magic-tech glow.
```
**T2 — Master Artificer** (`use_color_palette_from_reference: false`; brighter teal)
```text
Make the rig far heavier and more elaborate at the bust: an engineer's exo-harness with metal pauldrons and forearm gauntlets, plus a compact backpack tool-rig strap over the shoulder; a holographic teal projection (no readable text) rising from the terminal tablet near one shoulder, with small floating glyph motes. Intensify the cool teal tech light.
```
**T3 — Grand Forgewright** (`use_color_palette_from_reference: false`; teal-gold circuitry)
```text
Make this the most advanced artificer bust: an ornate plated exosuit collar with glowing teal-gold circuitry tracing the shoulder armor; a small floating drone or a radiant projected console edge near one shoulder. Add a subtle blazing tech-forge aura behind the shoulders with a few sparks (no readable schematic text).
```

### 4.4 `orc-unknown` (정체불명 유지 — 절제)

**T1 — Seasoned Grunt** (`use_color_palette_from_reference: true`)
```text
Reinforce the gear modestly while keeping it generic and undetermined: studded leather with a single worn iron shoulder guard and a sturdier collar; keep the small mysterious charm, slightly larger. Add only a faint muted accent glow. Do not commit to any specific archetype (not a clear warrior, mage, or engineer).
```
**T2 — Camp Veteran** (`use_color_palette_from_reference: true`)
```text
Layered hide-and-iron at the shoulders with a simple plain shoulder guard; brighten the mysterious charm at the collar a little, with a modest dust/spark accent. Keep the silhouette ambiguous and the colors muted moss/bone — still "type unknown", just more seasoned.
```
**T3 — Grizzled Warband Elder** (`use_color_palette_from_reference: false`; muted, low saturation)
```text
Heavy battered plate-over-hide at the shoulders with a few small trophies at the collar and a strongly glowing enigmatic charm; add a restrained aura around the bust. Keep it deliberately understated and muted — an experienced elder of indeterminate role, NOT resolved into any famous character archetype.
```

### 4.5 `orc-iron-commander`

> ⚠️ **IP 발산(필수)**: base는 기존 게임 commander archetype 재해석. T2/T3는 §6 IP 리뷰 **blocking**(특히 유명
> warchief/signature hammer 수렴 방지 — bust에 hammer를 frame 안으로 끌어들이지 않는다).

**T1 — Iron Enforcer** (`use_color_palette_from_reference: true`)
```text
Reinforce and thicken the bust armor: heavier layered blackened-iron shoulder plate with bulkier riveted pauldrons; a deeper red command cape collar with iron trim. Slightly strengthen the danger-red and iron-gray accents. Keep the horned helm and cape shape clearly distinct from any iconic existing horde warchief.
```
**T2 — Siege Marshal** (`use_color_palette_from_reference: false`; danger-red + iron, subtle steel sheen)
```text
Make the bust far more elaborate and fortress-like: ornate blackened-iron plate with a command insignia/crest on the chest, spiked pauldrons, and a longer command cape collar with iron clasps. Intensify the danger-red command presence. Keep the crest and helm clearly distinct from any iconic existing horde warchief; original insignia only, no signature weapon in frame.
```
**T3 — Iron Sovereign** (`use_color_palette_from_reference: false`; red-iron + gold filigree)
```text
Make this the most imposing legendary bust: blackened war-plate with glowing red-gold filigree, a tall horned command crown or great helm framing the face, and a heavy ceremonial cape collar. Add a subtle dominating command aura behind the shoulders with a few floating embers. IMPORTANT: the silhouette, crown/helm, and crest must be clearly ORIGINAL and distinct from any iconic existing horde warchief; do not reproduce that character's recognizable armor, crest, or weapon, and keep any weapon out of frame.
```

---

## 5. Manifest `portraits` schema (정의 — manifest.json은 본 문서에서 편집하지 않음)

`portraits`는 manifest top-level의 `characters`와 **형제(sibling)** 블록으로 추가한다. 파일은
`asset-packs/orc-camp-default/portraits/` 아래에 둔다. base는 `portraits/<key>.webp`, tier는
`portraits/tiers/<suffix>/<key>-<suffix>.webp`.

### 5.1 LOCKED schema (SPEC-304와 동일 블록)

```json
"portraits": {
  "version": 1,
  "root": "portraits",
  "frame_aspect": "2:3",
  "source_size": [512, 768],
  "items": {
    "orc-high-warchief-mascot": {
      "file": "orc-high-warchief-mascot.webp",
      "source_size": [512, 768],
      "tiers": {
        "veteran":  { "file": "tiers/veteran/orc-high-warchief-mascot-veteran.webp" },
        "champion": { "file": "tiers/champion/orc-high-warchief-mascot-champion.webp" },
        "warlord":  { "file": "tiers/warlord/orc-high-warchief-mascot-warlord.webp" }
      }
    }
  }
}
```

### 5.2 필드 설명

- `version`: schema 버전(현재 `1`).
- `root`: asset pack 내 portrait 루트 디렉터리(`portraits`).
- `frame_aspect`: 모든 portrait 공통 세로비 `"2:3"`(런타임 CSS frame slot이 강제할 aspect).
- `source_size`: 블록 기본 source target `[512, 768]`. **실제 export 크기는 item별 `source_size`로
  override**하여 source-of-truth로 기록한다(생성 후 실측값).
- `items.<key>`: key는 `characters`의 key와 **정확히 일치**한다(5종).
  - `file`: base portrait 경로(`root` 기준 상대). 예 `orc-high-warchief-mascot.webp`.
  - `source_size`: 그 base portrait의 실제 크기(생성 후 실측). 블록 기본값과 다르면 여기 값이 우선.
  - `tiers.<suffix>.file`: prestige tier portrait 경로. suffix는 SPEC-302/doc 13/doc 15와 동일.
- (생성 후 권장 확장 필드 — 생성 시 추가): item·tier별 `pixellab_id_or_source`, `sha256`, `prompt_ref`,
  `seed`, `ip_review`(고티어). 미생성 상태에서는 추가하지 않는다(파일 자체가 없으므로).

### 5.3 20장 전체 경로 매핑 (key ↔ file)

5 base + 5×3 tier = **20 portrait**. tier suffix는 [[SPEC-302-mascot-prestige-tiers]]/doc 13 item 10/doc 15와 동일.

| character key | base file | T1 | T2 | T3 |
| --- | --- | --- | --- | --- |
| `orc-high-warchief-mascot` | `orc-high-warchief-mascot.webp` | `tiers/veteran/orc-high-warchief-mascot-veteran.webp` | `tiers/champion/orc-high-warchief-mascot-champion.webp` | `tiers/warlord/orc-high-warchief-mascot-warlord.webp` |
| `orc-claude-storm-shaman` | `orc-claude-storm-shaman.webp` | `tiers/adept/orc-claude-storm-shaman-adept.webp` | `tiers/tempest/orc-claude-storm-shaman-tempest.webp` | `tiers/archon/orc-claude-storm-shaman-archon.webp` |
| `orc-codex-field-engineer` | `orc-codex-field-engineer.webp` | `tiers/senior/orc-codex-field-engineer-senior.webp` | `tiers/artificer/orc-codex-field-engineer-artificer.webp` | `tiers/forgewright/orc-codex-field-engineer-forgewright.webp` |
| `orc-unknown` | `orc-unknown.webp` | `tiers/seasoned/orc-unknown-seasoned.webp` | `tiers/veteran/orc-unknown-veteran.webp` | `tiers/elder/orc-unknown-elder.webp` |
| `orc-iron-commander` | `orc-iron-commander.webp` | `tiers/enforcer/orc-iron-commander-enforcer.webp` | `tiers/marshal/orc-iron-commander-marshal.webp` | `tiers/sovereign/orc-iron-commander-sovereign.webp` |

> `tiers/veteran/`는 mascot T1과 unknown T2가 **다른 파일명**(`orc-high-warchief-mascot-veteran` vs
> `orc-unknown-veteran`)으로 같은 suffix 폴더를 공유한다 — key 접두가 충돌을 막는다. (doc 13/15 suffix 정의를
> 그대로 따른 결과다.)

---

## 6. 생성 Runbook (deferred — 본 문서에서 호출하지 않음)

### 6.1 생성 경로 위험 고지 (PixelLab → 외부 fallback)

> ✅ **확정(2026-06-30) — 20종 전부 owner 외부 image-gen 제작·채택**. PixelLab `create_map_object`(view=side, 280×400)는 **probe로 실현가능성만 확인**했고(그 산출물은 폐기), 최종 자산은 **owner가 외부 image-gen으로 만든 고품질 pixel 흉상 20종**(1254×1254)을 **512×512 lossless WebP**로 변환해 채택했다. 편차: **baked dark 배경**(투명 아님; §1 "transparent"는 권장 기본으로 재해석)·**512×512(1:1)**(2:3 slot이 cover-crop). 실 delivered 기록(SHA-256·tier 매핑·편차)은 [[13-PixelLab-Asset-Registry]] item 12, 런타임 계약·tier seam은 [[SPEC-304-character-avatar-portraits]] §6. 아래 PixelLab 시도순서는 *probe 당시 참고용*으로 보존한다.

> ⚠️ PixelLab `create_character`는 **top-down RPG sprite generator**다. 정면 **bust portrait**를 보장하지
> 않는다(view가 `low/high top-down`/`side`이고 정사각 sprite를 산출, 세로 2:3 흉상이 아님). backgrounds·logo와
> **동일 정책**(doc 13 item 4·9, [[12-PixelLab-Prompts]] §Logo & Brand Mark, §Dashboard First-Page
> Background)으로 **외부 image-gen fallback**을 1순위 실사용 경로로 본다.

시도 순서:

1. **PixelLab `create_character`(front 단일 시도)**: `body_type="humanoid"`, front/`south` 1방향, 가능한
   최대 size. MCP size cap(≈128 → export ≈247px square)이라 512×768 세로 bust는 사실상 불가 → **실패 예상,
   기록만 남기고 다음 단계**.
2. **PixelLab `create_ui_asset` 또는 `create_map_object`(bust 시도)**: portrait 형태의 framed asset을 시도.
   결과가 흉상·2:3·512 선명도를 만족하면 채택. 만족 못 하면 다음 단계.
3. **외부 pixel-art image generator(주 경로)**: §2 framing prefix + §3 character positive + §2 style suffix를
   prose로 결합해 세로 2:3 bust 생성 → nearest-neighbor crisp pixel art로 정리 → transparent **WEBP/PNG**로
   export(≥512 tall). prestige tier는 §4 델타를 base portrait에 적용(가능하면 외부 tool의 reference/seed 고정).
   IP·palette 규약 **재확인 필수**(원본 archetype, 기존 게임 캐릭터/이름/문양/정확한 갑옷·무기 복제 금지;
   §2 negative + palette guide 준수).

공통 파라미터: aspect **2:3**, source ≥ **512×768**, transparent, no text/logo, Orc Camp palette(§1 표 +
[[12-PixelLab-Prompts]] §Palette Guide), ~6–10% safe padding.

### 6.2 생성 시 portrait별 기록 항목

생성한 portrait마다 [[13-PixelLab-Asset-Registry]]에 아래를 기록하고 manifest `portraits`에 반영한다:

- `id` / `tool`: PixelLab character/object id **또는** `external:<generator-name>`.
- **actual source size**(실측 px) — manifest `source_size`의 source-of-truth.
- **SHA-256**(파일 단위).
- extracted path: `portraits/<key>.webp` 또는 `portraits/tiers/<suffix>/<key>-<suffix>.webp`.
- 사용 prompt(본 문서 §3/§4 참조) + `seed` + (해당 시) `use_color_palette_from_reference`.
- **IP 리뷰 결과**(고티어 blocking): mascot **T2/T3**, storm-shaman **T3**, iron-commander **T2/T3**는
  배포 전 IP 리뷰를 **통과(blocking)** 해야 manifest 노출. 미통과 시 재생성 또는 해당 tier 보류.

### 6.3 라이선스 게이트 (배포 전 필수)

portrait도 다른 PixelLab/외부 생성물과 동일한 license 미확정 posture를 상속한다([[13-PixelLab-Asset-Registry]]
item 3, [[08-Decisions|D-009]]). `commercial_use`/`redistribution`/`attribution_required`가 확정되기 전에는
npm package/배포 산출물에 portrait를 **번들하지 않는다**. release 단계에서 release-engineer와 공동 게이트한다.

### 6.4 Delivery status (20 portrait — 전부 `delivered`, 2026-06-30)

> **SUPERSEDED**: 20종 전부 **delivered**(owner 외부 제작 → 512×512 lossless WebP). 파일별 SHA-256·tier(suffix) 매핑·편차의 **canonical 기록은 [[13-PixelLab-Asset-Registry]] item 12**다. 아래 표는 초기 planned/probe 시점 골격으로 보존하며, 실제 상태는 doc 13 item 12를 따른다(base는 probe(280×400) 기록이 남아 있으나 최종 채택본은 외부 512×512다).

| # | character key | tier | suffix | file | `id`/`tool` | source_size | SHA-256 | IP review | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `orc-high-warchief-mascot` | base | — | `orc-high-warchief-mascot.webp` | create_map_object `54ce81e2` | [280,400] | `1eea786f…` | n/a | **delivered** |
| 2 | `orc-high-warchief-mascot` | T1 | veteran | `tiers/veteran/orc-high-warchief-mascot-veteran.webp` |  |  |  | n/a | planned |
| 3 | `orc-high-warchief-mascot` | T2 | champion | `tiers/champion/orc-high-warchief-mascot-champion.webp` |  |  |  | **blocking** | planned |
| 4 | `orc-high-warchief-mascot` | T3 | warlord | `tiers/warlord/orc-high-warchief-mascot-warlord.webp` |  |  |  | **blocking** | planned |
| 5 | `orc-claude-storm-shaman` | base | — | `orc-claude-storm-shaman.webp` | create_map_object `158c03f6` | [280,400] | `c5624556…` | n/a | **delivered** |
| 6 | `orc-claude-storm-shaman` | T1 | adept | `tiers/adept/orc-claude-storm-shaman-adept.webp` |  |  |  | n/a | planned |
| 7 | `orc-claude-storm-shaman` | T2 | tempest | `tiers/tempest/orc-claude-storm-shaman-tempest.webp` |  |  |  | n/a | planned |
| 8 | `orc-claude-storm-shaman` | T3 | archon | `tiers/archon/orc-claude-storm-shaman-archon.webp` |  |  |  | **blocking** | planned |
| 9 | `orc-codex-field-engineer` | base | — | `orc-codex-field-engineer.webp` | create_map_object `b4d443de` | [280,400] | `482558ba…` | n/a | **delivered** |
| 10 | `orc-codex-field-engineer` | T1 | senior | `tiers/senior/orc-codex-field-engineer-senior.webp` |  |  |  | n/a | planned |
| 11 | `orc-codex-field-engineer` | T2 | artificer | `tiers/artificer/orc-codex-field-engineer-artificer.webp` |  |  |  | n/a | planned |
| 12 | `orc-codex-field-engineer` | T3 | forgewright | `tiers/forgewright/orc-codex-field-engineer-forgewright.webp` |  |  |  | n/a | planned |
| 13 | `orc-unknown` | base | — | `orc-unknown.webp` | create_map_object `99b2fa89` (cropped) | [280,400] | `8d32bec8…` | n/a | **delivered** |
| 14 | `orc-unknown` | T1 | seasoned | `tiers/seasoned/orc-unknown-seasoned.webp` |  |  |  | n/a | planned |
| 15 | `orc-unknown` | T2 | veteran | `tiers/veteran/orc-unknown-veteran.webp` |  |  |  | n/a | planned |
| 16 | `orc-unknown` | T3 | elder | `tiers/elder/orc-unknown-elder.webp` |  |  |  | n/a | planned |
| 17 | `orc-iron-commander` | base | — | `orc-iron-commander.webp` | create_map_object `50e724ff` | [280,400] | `5afc42a4…` | n/a | **delivered** |
| 18 | `orc-iron-commander` | T1 | enforcer | `tiers/enforcer/orc-iron-commander-enforcer.webp` |  |  |  | n/a | planned |
| 19 | `orc-iron-commander` | T2 | marshal | `tiers/marshal/orc-iron-commander-marshal.webp` |  |  |  | **blocking** | planned |
| 20 | `orc-iron-commander` | T3 | sovereign | `tiers/sovereign/orc-iron-commander-sovereign.webp` |  |  |  | **blocking** | planned |

---

## 7. 품질 검수 (portrait 전용)

[[12-PixelLab-Prompts]] §검수 기준 + portrait 전용:

- **framing**: head→mid-chest bust, 2:3, ~6–10% safe padding 안에서 얼굴이 잘리지 않는다. front/slight 3/4,
  시선 viewer.
- **size**: source ≥ 512 tall, transparent. 실제 크기를 manifest `source_size`에 기록.
- **frame 미포함**: 이미지에 장식 frame/border가 굽히지 않았다(frame은 CSS 소유).
- **identity**: 패널 slot(~220×330)에서 얼굴·엄니·표정·signature accent로 character가 즉시 식별된다.
- **tier 구분**: base→T1→T2→T3가 색만이 아니라 어깨/견장/관·collar trophy·실루엣 두께로 구분된다(작은 크기에서도).
- **text artifact 없음**: 발광/console/rune 연출에 글자·숫자·워터마크가 새겨지지 않는다.
- **IP 오인**: mascot T2/T3, storm-shaman T3, iron-commander T2/T3 — 유명 캐릭터/무기 수렴 재검수(blocking).
- **palette**: dark 배경에서 ember/teal/red 강화가 과포화·halo 없이 읽힌다.

---

## 8. Acceptance handoff

테스트 가능한 수용 기준(AC), 런타임 resolve(어느 패널 slot·CSS frame·placeholder fallback·reduced-motion),
배치 계약은 [[SPEC-304-character-avatar-portraits]]가 소유한다. 본 문서는 AC를 중복 정의하지 않으며, prompt/
schema/runbook이 SPEC-304의 계약(asset class·2:3·512×768·CSS frame ownership·20 roster·`portraits` schema)과
**1:1로 정합**함을 보장한다. 불일치 발견 시 §1/§5의 LOCKED 블록을 두 문서에서 함께 고친다.

## 관련 문서

- [[SPEC-304-character-avatar-portraits]] — 런타임/렌더/배치 계약 + 수용 기준(AC) SSOT
- [[12-PixelLab-Prompts]] — house style·palette·IP 규약·character base prompt
- [[13-PixelLab-Asset-Registry]] — delivered 5종·tier roster·생성 ID/SHA-256 추적
- [[15-Character-State-Model]] — prestige tier 외형 delta(T1→T3) source
- [[SPEC-302-mascot-prestige-tiers]] — tier 임계·선택·latch 런타임 계약
- [[08-Decisions|D-009]] — asset license 게이트
