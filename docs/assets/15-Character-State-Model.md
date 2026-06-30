# 15 Character State Model & Prestige Tiers

## 목적

PixelLab **character state**가 무엇인지, Orc Camp에서 "state"라는 단어가 가리키는 **두 가지 서로 다른 개념**을 어떻게 구분해 쓰는지, 그리고 그 위에 새로 도입하는 **prestige tier**(누적 token/cost 기반 외형 단계) 모델을 **delivered 5종 character 전부**(mascot·storm-shaman·codex·unknown·iron-commander)에 대해 정의하고 그 생성 절차를 기록한다.

이 문서는 **생성(generation)·자산 설계** 관점의 SSOT다. 런타임이 tier를 *소비/선택*하는 계약(누적 token/cost → tier → 표시)은 [[SPEC-302-mascot-prestige-tiers]]가 소유한다. 자산 생성 prompt/seed/ID 추적은 [[13-PixelLab-Asset-Registry]], 일반 prompt 규약은 [[12-PixelLab-Prompts]], 런타임 sprite 상태머신은 [[SPEC-300-asset-rendering]]가 소유한다.

> **현황(2026-06-29)**: PixelLab 자산 생성은 [[13-PixelLab-Asset-Registry]] 기준 **closed**이고, 본 작업 시점 MCP 인증(`PIXELLAB_AUTH_HEADER`)이 미설정이라 실제 state 생성은 **보류**다. 본 문서는 **설계·prompt·schema**를 turnkey로 고정하고, 실제 `create_character_state` 호출과 manifest 반영은 인증 복구 후 asset pack **버전업(v0.2.0)**에서 수행한다. 생성 전까지 런타임은 항상 base(tier 0)로 동작한다([[SPEC-302-mascot-prestige-tiers]] §fallback).

---

## 1. "State"라는 단어의 두 가지 의미 (혼동 금지)

Orc Camp에서 "state"는 문맥에 따라 **완전히 다른 두 축**을 가리킨다. 본 절은 그 경계를 고정한다.

| 축 | 정의 | 누가 만드나 | 누가 소비하나 | 변하는 트리거 |
| --- | --- | --- | --- | --- |
| **(A) PixelLab character state** (= variant) | 한 base character의 **정체성/체형/비율을 유지**한 채 외형(갑옷·장비·색)만 편집한 **별도 character**. `create_character_state`로 생성하며 8방향 rotation 전체에 동일 편집이 적용된다. 새 `character_id`를 받고 `group_id`로 원본과 묶인다. | 자산 생성(PixelLab MCP) | 자산 파이프라인·manifest | 디자이너/생성 작업(런타임 아님) |
| **(B) 런타임 animation state** | orc의 `status`(7종) → `idle`/`active`/`waiting`/`error`/`stale`(+`roaming`) animation 선택. sprite 위 effect overlay 합성 포함. | (이미 생성됨) | dashboard 런타임([[SPEC-300-asset-rendering]] §2.3/§3.2) | orc `status` 변화(snapshot마다) |

> **핵심**: (A)는 *어떤 외형의 캐릭터를 쓸지*, (B)는 *그 캐릭터가 지금 어떤 동작을 재생할지*다. 둘은 **직교**한다. 한 tier(=하나의 PixelLab character state)는 여전히 `idle`/`active`/… 전체 animation 세트를 가진다.

본 문서가 새로 도입하는 **prestige tier**는 **(A)의 특수한 용례**다: 같은 mascot의 외형을 단계적으로 호화롭게 만든 PixelLab character state들의 **순서 있는 묶음**이며, 런타임이 (A) 중 *어느 variant*를 base로 쓸지를 **누적 token/cost**로 고른다. 그 위에서 (B)는 그대로 동작한다.

### 1.1 PixelLab `create_character_state` 동작 요약

- 입력: `character_id`(원본), `edit_description`(편집 지시), 선택적 `seed`, `use_color_palette_from_reference`.
- 결과: 원본의 정체성·체형·비율을 유지한 채 편집이 **4/8방향 rotation 전체에 일관 적용된** 새 character. 새 `character_id` + 공유 `group_id`.
- **animation은 만들지 않는다**: state 생성은 rotation(정지 포즈)만 만든다. animation은 별도 `animate_character` 단계다. 본 작업은 사용자 지시에 따라 **animation을 진행하지 않는다** → tier별로 rotation variant만 생성한다.
- `use_color_palette_from_reference=true`면 원본 팔레트로 스냅(색 일관). 새 색(예: ember-gold)을 의도하면 `false`.

---

## 2. Prestige Tier 모델 (usage-driven character 전체)

### 2.1 대상과 의도

- **대상 character(tier 적용)**: delivered 5종 전부 —
  - `orc-high-warchief-mascot`(주인공 mascot, universal fallback — [[SPEC-300-asset-rendering]] §3.1)
  - `orc-claude-storm-shaman`(Claude agent)
  - `orc-codex-field-engineer`(Codex agent)
  - `orc-unknown`(agent type 미확정)
  - `orc-iron-commander`(iron commander)
- **`orc-iron-commander` 포함 근거**: iron-commander는 `CHARACTER_POOL`(SPEC-300 §2.3a′)에 포함돼 **실제 orc(pane)에 roaming skin으로 배정**되며, 그때 그 orc의 usage로 tier가 정해진다 — 다른 character와 동일. (별개로 iron-commander는 control/interrupt **상징** 역할도 갖지만 그 역할은 usage·tier와 무관하며 [[SPEC-400-control-actions]] 소관이다 — prestige tier는 그 역할을 바꾸지 않는다.)
- **의도**: 각 orc가 **누적해서 더 많은 LLM token/cost를 소비**할수록 그 전공을 시각적으로 보상한다 — 갑옷/의장이 두텁고 화려해지고, 장비가 호화로워지고, `active` 연출이 강렬해진다. 단, **각 archetype의 정체성은 유지**한다(warchief는 더 전설적인 전사로, shaman은 더 강대한 술사로, engineer는 더 정교한 장인으로, unknown은 여전히 "정체불명"을 유지하되 노련해 보이게).
- 모든 character가 **공통 4단계(base + 3)**·**공통 임계**([[SPEC-302-mascot-prestige-tiers]] §3.1)를 쓴다. tier는 **단조 증가**(한 orc가 도달한 tier는 세션 동안 내려가지 않음 — SPEC-302 §3.2 latch). 공통 3축(사용자 지시): ① 갑옷/의장을 **화려하고 두텁게**, ② 착용 **장비를 화려하게**, ③ `active` **effect를 화려하게**.

### 2.2 `orc-high-warchief-mascot` — 4단계

| Tier | key suffix | 라벨 | 갑옷 | 장비 | `active` effect |
| --- | --- | --- | --- | --- | --- |
| **0** | `` (base) | Warchief | 비대칭 spiked iron 견갑, fur trim, leather strap (현행) | crescent battle axe, bone trophy belt | ember 하이라이트(현행) |
| **1** | `-veteran` | Ironclad Veteran | 두꺼운 layered iron plate, 리벳 trim, 두툼한 fur mantle | 새김 bronze bracer, studded war-belt, 재단조 axe(bronze-bound haft) | ember 광택 강화 |
| **2** | `-champion` | Ember Champion | full pauldron + sculpted spike, 새김 breastplate, plated tasset/gauntlet, regal mantle | 더 큰 dual-bound axe(룬 음각·ember 발광), bone-iron circlet, gilded trophy chain | 더 강한 ember **aura** |
| **3** | `-warlord` | Legendary Warlord | gold-trim blackened plate + ember-red filigree, ceremonial fur cloak, crested helm/crown | rune-etched greataxe(ember·red-gold 에너지), ornate gauntlet, bone-and-gold trophy 다수 | **ember storm aura** + 부유 spark + 발밑 발광 rune halo |

### 2.3 `orc-claude-storm-shaman` — 4단계

base 정체성(유지): calm observant orc advisor, weathered dark moss cloak, staff/round totem, **teal storm magic** accent. 강화 축 = 로브/cloak 의장, staff/totem 격, storm-magic `active` 연출.

| Tier | key suffix | 라벨 | 의장(cloak/robe) | 장비(staff/totem) | `active` effect |
| --- | --- | --- | --- | --- | --- |
| **0** | `` (base) | Storm Shaman | weathered moss cloak, charcoal wraps (현행) | carved staff 또는 round totem | teal storm 하이라이트(현행) |
| **1** | `-adept` | Storm Adept | 두꺼운 layered ceremonial robe + 보강 shoulder mantle | bone-inlaid staff + 소형 focusing crystal | 밝아진 teal rune trim |
| **2** | `-tempest` | Tempest Shaman | ornate storm-warden robe + metal-and-bone 견갑 | totem-topped staff + 발광 storm crystal, 궤도 teal spark | 더 강한 storm-rune 지면 pulse + arc |
| **3** | `-archon` | Stormcaller Archon | flowing storm-silk robe + teal-gold filigree | levitating totem ring + 거대 runed storm staff(crackling teal lightning) | 소용돌이 storm aura + 부유 rune + 지면 lightning halo |

### 2.4 `orc-codex-field-engineer` — 4단계

base 정체성(유지): rugged orc field engineer, dark iron tool belt, glowing terminal tablet, **teal magic-tech** accent, leather apron. 강화 축 = 작업 갑주/rig, 도구/단말, tech-spark `active` 연출.

| Tier | key suffix | 라벨 | 갑주(work-rig) | 장비(tool/tablet) | `active` effect |
| --- | --- | --- | --- | --- | --- |
| **0** | `` (base) | Field Engineer | leather apron, charcoal metal bracer (현행) | dark iron tool belt, 소형 terminal tablet | teal tech 하이라이트(현행) |
| **1** | `-senior` | Senior Engineer | 보강 plated work-harness over apron | 정교 도구 다수 + 대형 dual-screen terminal rig | 밝아진 teal tech glow |
| **2** | `-artificer` | Master Artificer | 중장 engineer exo-harness + metal 견갑·forearm gauntlet | backpack tool-rig + tablet의 holographic teal projection | 더 강한 tech-spark + 부유 glyph |
| **3** | `-forgewright` | Grand Forgewright | ornate plated exosuit + teal-gold circuitry 발광 | multi-arm tool array / 부유 drone + radiant projected console | 작열 tech-forge aura + spark + 지면 발광 schematic halo |

### 2.5 `orc-unknown` — 4단계 (전면 개정 2026-06-30: fel demon-hunter 컨셉)

> **컨셉 전면 수정(사용자 지시)**: 기존 "정체불명 유지·절제" 컨셉을 폐기하고, **누적될수록 악마(fel)의 힘에 각성해 demon-hunter 전사로 변모**하는 서사로 바꾼다. **T1부터 demon-hunter 쌍검(dual fel combat swords)을 양손에 든다(dual-wield).** 최종(T3)은 **악마 날개를 펼치고 악마의 힘을 휘두르는 fel ascendant**.
> ⚠️ **무기 일관성(필수, 사용자 지시 2026-06-30)**: 1차 single-sword 생성에서 일부 방향 무기 부재/한 자루만 노출 결함 발생 → **쌍검을 양손에 각 한 자루씩, 8방향 전부에서 둘 다 grip·노출**되도록 정의한다(0자루·1자루 금지). prompt에 "DUAL-WIELDS TWO matching swords, one per hand; BOTH visible in EVERY 8 directions" 명시.
> ⚠️ **IP(필수)**: 내부 archetype ref = WoW demon hunter(Illidan급)이나 **고유명사 금지·iconic 재현 금지**(§2.7). 쌍검은 쓰되 **곡선 Warglaives 형태가 아닌 original 직선 demon-blade**로, **눈가리개(blindfold) 금지**(눈은 fel-green 발광), 뿔/날개/검은 original. base(tier 0)는 현행 generic grunt 유지(미각성).

| Tier | key suffix | 라벨 | 갑옷/외형 | 장비(무기) | `active` effect |
| --- | --- | --- | --- | --- | --- |
| **0** | `` (base) | Grunt | simple leather vest (현행, 미각성) | small charm (현행, 무기 없음) | none/미미(현행) |
| **1** | `-feltouched` | Fel-Touched Hunter | studded leather hunter 복장, 눈·장비에 옅은 fel-green glow | **fel-touched 쌍검(original 직선 demon-blade) 양손 grip, 8방향 둘 다 노출** | 옅은 fel glow |
| **2** | `-felreaver` | Fel Reaver | fel-green 발광 눈, 피부 fel rune/문신, 부분 spiked demonic armor | fel-green 화염을 두른 쌍검(양손, 8방향 둘 다) | fel aura |
| **3** | `-felascendant` | Fel Ascendant | **악마의 힘 각성 + 악마 날개**: fel-green 화염·aura, original 곡선 demonic 뿔, original 대형 demonic 날개, fel 문신, fel-green 발광 눈 | fel-energy 대형 쌍검(양손, 8방향 둘 다, original) | 대형 fel-fire aura + 부유 ember + 발밑 fel rune halo (**T3 극단적 연출 — §4.4**) |

### 2.6 `orc-iron-commander` — 4단계

base 정체성(유지): blackened iron armor, 뿔 투구, 붉은 망토, generic heavy war hammer, disciplined commander stance, **danger-red + iron-gray** accent. 강화 축 = 흑철 갑옷/지휘 의장, war hammer 격, command `active` 연출. (내부 ref = Orgrim Doomhammer → §2.7 IP 발산 제약 필수.)

| Tier | key suffix | 라벨 | 갑옷/의장 | 장비(hammer) | `active` effect |
| --- | --- | --- | --- | --- | --- |
| **0** | `` (base) | Iron Commander | blackened iron plate, 뿔 투구, 붉은 망토 (현행) | generic heavy war hammer | iron-gray/red 하이라이트(현행) |
| **1** | `-enforcer` | Iron Enforcer | 보강 layered 흑철 plate + 두꺼운 pauldron, 리벳 greave | 재단조 heavier war hammer(iron-studded haft) | 강해진 danger-red/iron 광택 |
| **2** | `-marshal` | Siege Marshal | 요새형 ornate 흑철 plate + 지휘 insignia/crest, spiked pauldron, 긴 command 망토 | 룬 음각 warhammer head, iron clasp | 더 강한 danger-red **command aura** + 지면 진동감 |
| **3** | `-sovereign` | Iron Sovereign | gold-iron filigree 들어간 legendary 흑철 war-plate + 높은 command 관/투구, ceremonial 망토 | rune-etched 거대 command warhammer(red-iron 에너지) | command **shockwave aura** + 부유 ember + 지면 발광 iron rune halo |

> iron-commander의 control/interrupt 상징 역할은 tier와 무관(별개 축, [[SPEC-400-control-actions]]). 위 tier는 iron-commander가 **roaming pool skin으로 배정된 orc**의 usage에 따라 적용된다([[SPEC-302-mascot-prestige-tiers]] §1).

### 2.7 IP-safety (모든 character·tier 공통)

[[11-PixelLab-Asset-Setup]] IP Safety Rules를 그대로 따른다. 고유명사(World of Warcraft/Grommash/Thrall/Illidan 등) 금지, 특정 게임 캐릭터의 정확한 갑옷·무기·문양·색 조합 재현 금지, 파일명/manifest key/label은 original archetype만. tier가 올라가도 **"기존 게임 캐릭터로 오인될 가능성"** 체크를 배포 전 자산 리뷰에 포함한다(특히 storm-shaman 고티어가 유명 shaman, mascot 고티어가 유명 warchief, iron-commander 고티어가 유명 warchief의 signature hammer(Doomhammer), **unknown 고티어가 유명 demon hunter(blindfold+twin warglaives)**에 수렴하지 않도록).
- **blocking 게이트(확정)**: **mascot T2/T3, storm-shaman T3, iron-commander T2/T3, unknown T2/T3**는 base/컨셉이 유명 캐릭터 archetype 재해석([[13-PixelLab-Asset-Registry]]: mascot=Grommash, iron-commander=Orgrim Doomhammer, **unknown=Illidan-class demon hunter**)이므로 수렴 위험이 가장 크다 — 이 variant들은 배포 전 IP 리뷰를 **필수 통과(blocking)** 해야 manifest `status:"available"`로 승격한다. 특히 **unknown은 눈가리개+한 쌍의 warglaive+특정 뿔/문신 조합을 재현하지 않는지** 확인한다. 통과 못 하면 재생성하거나 해당 tier를 `status:"staged"/"planned"`로 보류(런타임은 [[SPEC-302-mascot-prestige-tiers]] §3.3로 하위 tier/base 폴백).

---

## 3. 진입 기준 (누적 token/cost 임계값)

런타임 임계 *판정 로직*은 [[SPEC-302-mascot-prestige-tiers]] §3이 SSOT다. 본 절은 그 **초기 상수값**의 근거를 자산 측에서 기록한다(튜닝 대상).

- **1차 축 = 누적 billable tokens**(input+output), orc 세션 단위 누적. 토큰 분해 불가 시 **누적 추정 cost(USD)**를 보조 축으로 사용.
- 초기값(튜닝 가능):

- 모든 tiered character가 **동일 임계**를 공유한다(character별 차등 불필요; 필요 시 manifest `thresholds` override — SPEC-302 §3.1/§6).

| 상수(SPEC-302 §3.1) | 값(tokens) | 보조(cost USD) | 근거 |
| --- | --- | --- | --- |
| `PRESTIGE_TIER1_MIN_TOKENS` / `PRESTIGE_TIER1_MIN_COST_USD` | 100,000 | $3 | "충분히 돌린 한 세션" |
| `PRESTIGE_TIER2_MIN_TOKENS` / `PRESTIGE_TIER2_MIN_COST_USD` | 500,000 | $15 | "묵직한 세션" |
| `PRESTIGE_TIER3_MIN_TOKENS` / `PRESTIGE_TIER3_MIN_COST_USD` | 2,000,000 | $60 | "마라톤 세션" |

> **튜닝 이력(2026-06-30, [[08-Decisions|D-036]])**: 초기값 1M/5M/20M·$5/$25/$100은 실측 대비 과대(SPEC-008 collector가 읽는 값은 **per-session-file 누적**이고 라이브 관측은 세션당 ~45k–116k tok)라 tier가 사실상 안 보였음 → 위 값으로 하향. axis는 여전히 **per-session-file 누적**(cross-session 합산 아님)이며 PoC-tunable. (SPEC-302 §3.1 canonical과 동기화.)

- 데이터 출처: orc agent 세션의 transcript/usage(예: Claude Code/Codex 세션 JSONL의 누적 usage). **현재 scan 데이터 계약(`Orc`)에는 token/cost 필드가 없다** → 신규 수집 능력이 선행되어야 한다([[SPEC-302-mascot-prestige-tiers]] §2 데이터 의존성, [[SPEC-005-data-contract]]/[[SPEC-002-tmux-discovery]] forward). 데이터가 없으면 tier 0.

---

## 4. 생성 Runbook (turnkey, 인증 복구 후 실행)

> 전제: `PIXELLAB_AUTH_HEADER`(Bearer) 설정 + PixelLab MCP 200 응답. **animation은 생성하지 않는다**(rotation variant만).

각 tiered character의 각 tier는 **그 character의 base에서 직접** `create_character_state`로 생성한다(누적 편집으로 인한 정체성 드리프트 방지 — 항상 base id를 source로; 이전 tier를 source로 체이닝하지 않는다). 생성 후 `get_character`로 8방향 rotation 완료를 확인하고 export → `sprites/<character>/tiers/<suffix>/`에 배치 → [[13-PixelLab-Asset-Registry]]에 ID/SHA-256/prompt 기록 → manifest `prestige` 엔트리 채움(§4.2) → asset pack v0.2.0.

**base character id(source — [[13-PixelLab-Asset-Registry]]):**

| character | base `character_id` | tier suffix(T1/T2/T3) |
| --- | --- | --- |
| `orc-high-warchief-mascot` | `77acab26-ab4b-4d11-94b8-37c4c32e76b8` | `-veteran` / `-champion` / `-warlord` |
| `orc-claude-storm-shaman` | `5a2661d9-524f-431b-ba7d-619e44bb885d` | `-adept` / `-tempest` / `-archon` |
| `orc-codex-field-engineer` | `3b1c381a-a2ee-4afd-97de-21fa69d50e0a` | `-senior` / `-artificer` / `-forgewright` |
| `orc-unknown` | `50519f63-0f39-49da-9782-f75b93b8152c` | `-seasoned` / `-veteran` / `-elder` |
| `orc-iron-commander` | `b9a2dbff-d392-4703-9555-3ac2e1cf8df2` | `-enforcer` / `-marshal` / `-sovereign` |

> 생성 규모: 5 character × 3 tier = **15 variant**(8방향 rotation, animation 미생성). credit 여유([[13-PixelLab-Asset-Registry]] 잔액)와 우선순위(mascot → storm-shaman/codex → unknown → iron-commander) 확인 후 진행.

### 4.1 Tier별 `edit_description` (그대로 사용)

모든 prompt 말미 **공통 접미**(character-중립):  
`keep the SAME orc identity, face, body type, proportions, and base pose/stance as the source; low top-down RPG sprite, readable silhouette at small size, crisp pixel art, transparent background, no text, no logo, no faction symbol, not based on any existing game character; edit the static armor/equipment/effect appearance only, do NOT change the pose into a new animation.`

#### `orc-high-warchief-mascot`

> ⚠️ **mascot 전용 IP 발산 제약(필수)**: base mascot은 기존 게임 warchief(WoW Grommash)의 archetype 재해석임이 [[13-PixelLab-Asset-Registry]]에 명시돼 있다. 고티어로 갈수록 "거대 도끼 + ember"가 그 상징 실루엣으로 **수렴**할 압력이 커지므로, 아래 모든 mascot prompt 본문에 발산 제약을 포함했고(각 prompt 말미 문장), §2.6의 배포 전 IP 리뷰는 mascot T2/T3에 대해 **blocking(필수 통과)** 항목이다.

> ⚠️ **무기 일관성 규칙(생성 실증으로 추가 — 1차 생성 결함 정정)**: `create_character_state`에 "larger/enormous/dual-bound/greataxe"처럼 무기를 **확대·교체**하라고 지시하면, 모델이 무기를 손에 쥔 형태가 아니라 **figure 옆에 떠 있는 별도 prop**으로 다시 그리고 **후면(north/north-east 등) 방향에서 무기를 누락**한다(1차 T2/T3 8방향 중 일부에서 무기 부재/분리 발생, T3에는 text artifact까지). **정정 규칙**: 고티어라도 **base가 이미 쥐고 있는 그 도끼를 같은 크기·같은 그립·같은 위치로 유지**하고 **장식(rune·ember glow)만 추가**한다. prompt에 ① "keep the SAME single axe … same size/grip/position", ② "axe MUST stay gripped and visible in EVERY one of the 8 directions including rear/back views", ③ "do NOT add a second weapon / enlarge / detach / float / remove", ④ "no text/letters/watermark, ONE single axe only"를 **반드시 포함**한다. (T1은 이 보수적 표현을 이미 따라 8방향 모두 정상 — 검증됨.)

**T1 — Ironclad Veteran** (`use_color_palette_from_reference: true`)
```text
Reinforce and thicken the armor: heavier layered iron plate over the shoulders and chest with riveted trim, and a thicker fur-lined mantle. Upgrade the equipment: add engraved bronze bracers, a sturdier studded war-belt with more bone trophies, and a cleaner reforged battle axe with a bronze-bound haft. Slightly strengthen the warm ember metal highlights. Keep the silhouette, helm, and axe shape clearly distinct from any iconic existing Horde warchief or its signature weapon.
```
**T2 — Ember Champion** (`use_color_palette_from_reference: false`; ember-red + subtle gold) — *무기 일관성 정정판(실사용)*
```text
Make the armor far more elaborate and heavy: full sculpted spiked pauldrons, an ornate engraved breastplate, plated tassets, reinforced gauntlets, a regal fur mantle, a bone-and-iron circlet, and gilded trophy chains. Keep the SAME single battle axe the orc already holds in the source - same size, same two-handed grip, same position in the hands - and only add ember-glowing etched runes along its existing blade. Intensify the warm ember glow on the metal. The axe MUST stay gripped in the hands and clearly visible in EVERY one of the 8 directions including rear/back views; do NOT add a second weapon, enlarge, detach, float, or remove the axe. Static top-down pixel sprite, transparent background, no text/letters/watermark, ONE single axe only, not based on any existing game character; edit appearance only, keep the same pose (no new animation).
```
**T3 — Legendary Warlord** (`use_color_palette_from_reference: false`; ember-red + gold filigree) — *무기 일관성 정정판(실사용)*
```text
Make this the most lavish, legendary warlord version: massive ornate spiked pauldrons, gold-trimmed blackened plate armor with glowing ember-red filigree, a heavy ceremonial fur cloak, and a towering crested helm or crown. Keep the SAME single battle axe the orc already holds in the source - same size, same two-handed grip, same position - and only make it legendary with rune etching and crackling ember red-gold energy along its existing blade. Add a blazing ember aura, floating sparks, and a glowing rune halo at the feet. The axe MUST stay gripped in both hands and visible in EVERY one of the 8 directions including rear/back views; do NOT add a second weapon, enlarge, detach, float, or remove it. Keep the silhouette and axe shape original, distinct from any iconic existing warchief. Static top-down pixel sprite, transparent background, no text/letters/watermark, ONE single axe only, not based on any existing game character; edit appearance only, keep the same pose (no new animation).
```

#### `orc-claude-storm-shaman`

**T1 — Storm Adept** (`use_color_palette_from_reference: true`)
```text
Reinforce the shaman regalia: a thicker layered ceremonial robe with a reinforced shoulder mantle over the weathered cloak. Upgrade the equipment: a bone-inlaid carved staff topped with a small focusing crystal, sturdier bone-and-leather fasteners. Slightly brighten the teal storm-rune trim along the cloak edges.
```
**T2 — Tempest Shaman** (`use_color_palette_from_reference: false`; brighter teal + subtle silver)
```text
Make the regalia far more elaborate: an ornate storm-warden robe with metal-and-bone pauldrons and layered cloth. Richer equipment: a taller totem-topped staff crowned with a glowing storm crystal, with small orbiting teal spark motes. Intensify the teal storm magic so the casting pose reads as a stronger storm-rune ground pulse with short arcs.
```
**T3 — Stormcaller Archon** (`use_color_palette_from_reference: false`; teal-gold)
```text
Make this the most powerful archon version: flowing storm-silk robes with glowing teal-gold filigree and a high ceremonial collar. Legendary equipment: levitating totem rings around the body and a great runed storm staff wreathed in crackling teal lightning. Dramatically enhance the effect into a swirling storm aura with floating runes and a glowing teal lightning halo around the feet.
```

#### `orc-codex-field-engineer`

**T1 — Senior Engineer** (`use_color_palette_from_reference: true`)
```text
Reinforce the work rig: a plated work-harness over the leather apron with sturdier charcoal-iron bracers. Upgrade the equipment: more precision tools on a heavier tool belt and a larger dual-screen terminal rig. Slightly brighten the teal magic-tech glow.
```
**T2 — Master Artificer** (`use_color_palette_from_reference: false`; brighter teal)
```text
Make the rig far heavier and more elaborate: an engineer's exo-harness with metal pauldrons and forearm gauntlets, plus a compact backpack tool-rig. Richer equipment: a holographic teal projection rising from the terminal tablet. Intensify the tech effect so the working pose reads as a stronger tech-spark with small floating glyphs.
```
**T3 — Grand Forgewright** (`use_color_palette_from_reference: false`; teal-gold circuitry)
```text
Make this the most advanced artificer version: an ornate plated exosuit with glowing teal-gold circuitry tracing the armor. Legendary equipment: a multi-arm tool array (or small floating drones) and a radiant projected console. Dramatically enhance the effect into a blazing tech-forge aura with sparks and a glowing schematic halo around the feet.
```

#### `orc-unknown` (fel demon-hunter — 전면 개정 2026-06-30)

> ⚠️ **unknown 전용 IP 발산 제약(필수)**: archetype ref = Illidan-class demon hunter. 고유명사 금지, **눈가리개+곡선 한 쌍의 warglaive+특정 뿔/문신 조합 재현 금지**(§2.7 blocking). 쌍검은 쓰되 **original 직선 demon-blade**(곡선 warglaive 아님), 눈은 가리지 않고 fel-green 발광, 뿔/날개 original. 색은 새 fel-green 도입이므로 **전 tier `use_color_palette_from_reference: false`**.
> ⚠️ **쌍검 일관성(필수, 2026-06-30 실사용판)**: 양손에 각 1자루씩 **둘 다 8방향 전부에서 grip·노출**(0/1자루 금지).

**T1 — Fel-Touched Hunter** (`use_color_palette_from_reference: false`)
```text
Transform this orc into a fel-touched demon-hunter initiate: keep the same orc identity and body, light studded leather hunter garb, a faint fel-green glow in the eyes and gear. The orc DUAL-WIELDS TWO matching fel-touched combat swords, one in each hand (original straight demon-blades, NOT curved warglaives). BOTH swords MUST be gripped, one per hand, and clearly visible in EVERY one of the 8 directions including rear/back views - never show zero or only one blade. Original demon-hunter design.
```
**T2 — Fel Reaver** (`use_color_palette_from_reference: false`)
```text
Deepen the fel corruption of this dual-wielding demon-hunter orc: fel-green glowing eyes, glowing fel runes and markings on the skin, partial spiked demonic armor over hunter leathers, a faint fel aura. The orc DUAL-WIELDS TWO matching fel combat swords, one in each hand, now wreathed in fel-green fire (original straight blades, NOT curved warglaives). BOTH blades MUST be gripped, one per hand, and clearly visible in EVERY one of the 8 directions including rear/back views - never zero or only one. Original horns and markings.
```
**T3 — Fel Ascendant** (`use_color_palette_from_reference: false`; 악마 날개 포함)
```text
Make this the demonic ascendant climax: an orc DUAL-WIELDING TWO large fel-energy combat swords, one in each hand (original straight blades, NOT curved warglaives) - fel-green flames and aura, original curved demonic horns, glowing fel-green eyes, fel tattoos, LARGE original demonic wings spread behind, and a fel rune halo with floating embers at the feet. BOTH blades MUST be gripped, one per hand, and visible in EVERY one of the 8 directions including rear/back views - never zero or only one. IMPORTANT: ORIGINAL - no blindfold, no curved twin warglaives, original horn/wing/blade shapes.
```

#### `orc-iron-commander`

> ⚠️ **iron-commander 전용 IP 발산 제약(필수)**: base는 기존 게임 commander(Orgrim Doomhammer)의 archetype 재해석임이 [[13-PixelLab-Asset-Registry]]에 명시돼 있다. 고티어로 갈수록 "거대 hammer + 흑철"이 그 상징(특히 Doomhammer 무기)으로 수렴할 압력이 크므로, 아래 모든 prompt 본문에 발산 제약을 포함했고 §2.7 IP 리뷰는 iron-commander T2/T3에 **blocking** 항목이다.

**T1 — Iron Enforcer** (`use_color_palette_from_reference: true`)
```text
Reinforce and thicken the armor: heavier layered blackened-iron plate with bulkier riveted pauldrons and reinforced greaves, and a deeper red command cape with iron trim. Upgrade the equipment: a reforged, heavier war hammer with an iron-studded haft. Slightly strengthen the danger-red and iron-gray accents. Keep the helm, cape, and hammer head shape clearly distinct from any iconic existing Horde warchief and its signature hammer.
```
**T2 — Siege Marshal** (`use_color_palette_from_reference: false`; danger-red + iron, subtle steel sheen)
```text
Make the armor far more elaborate and fortress-like: ornate blackened-iron plate with a command insignia/crest, spiked pauldrons, and a longer command cape with iron clasps. Richer equipment: a larger war hammer with a rune-etched head. Intensify the danger-red command aura so the active pose reads as a stronger, ground-shaking command presence. Keep the silhouette, crest, and hammer profile clearly distinct from any iconic existing Horde warchief and its famous hammer — original insignia and hammer-head shape only.
```
**T3 — Iron Sovereign** (`use_color_palette_from_reference: false`; red-iron + gold filigree)
```text
Make this the most imposing, legendary version: blackened war-plate with glowing red-gold filigree, a tall horned command crown or great helm, and a heavy ceremonial cape. Legendary equipment: an enormous rune-etched command warhammer wreathed in crackling red-iron energy. Dramatically enhance the effect into a dominating command shockwave aura with floating embers and a glowing iron rune halo around the feet. IMPORTANT: the silhouette, crown/helm, and especially the hammer-head shape must be clearly ORIGINAL and distinct from any iconic existing Horde warchief and its famous hammer — do not reproduce that character's recognizable armor, crest, or weapon profile.
```

### 4.2 Manifest tier schema (생성 후 채움)

각 tiered character는 base의 현행 top-level 필드를 그대로 두고 `prestige` 블록을 추가한다(아래는 mascot 예시 — storm-shaman/codex/unknown도 동일 shape, `tiers[].label`·`root`만 character별로 다름). tier 1~3 엔트리는 base와 동일 shape(`root`/`frame_size`/`anchor`/`scale`/`directions`/`rotations`/`reduced_motion`)를 가지되, **생성 전에는** `pixellab_character_id: null` + `status: "planned"`로 둔다(런타임은 미가용 tier를 base로 폴백 — [[SPEC-302-mascot-prestige-tiers]] §3.3).

```jsonc
"orc-high-warchief-mascot": {
  // ... 기존 base 필드 유지 (root/rotations/animations/reduced_motion 등) ...
  "prestige": {
    "axis": "cumulative_tokens",          // 1차 축. 보조 cumulative_cost_usd
    "thresholds": {                        // SPEC-302 §3 상수의 manifest 사본(SSOT는 SPEC-302)
      "tier1": { "min_tokens": 1000000,  "min_cost_usd": 5   },
      "tier2": { "min_tokens": 5000000,  "min_cost_usd": 25  },
      "tier3": { "min_tokens": 20000000, "min_cost_usd": 100 }
    },
    "tiers": [
      { "tier": 1, "label": "Ironclad Veteran", "status": "planned",
        "pixellab_character_id": null,
        "root": "sprites/orc-high-warchief-mascot/tiers/veteran/<Char>",
        "rotations": { "south": "rotations/south.png" /* 8방향 */ },
        "animations": { /* 생성 후: base와 동일 state 세트, 미생성 시 base animation 재사용 */ },
        "reduced_motion": { "fallback_state": "idle", "fallback_direction": "south",
                            "fallback_frame": "rotations/south.png" } },
      { "tier": 2, "label": "Ember Champion",   "status": "planned", "pixellab_character_id": null, "root": "sprites/orc-high-warchief-mascot/tiers/champion/<Char>", "rotations": {}, "animations": {}, "reduced_motion": {} },
      { "tier": 3, "label": "Legendary Warlord", "status": "planned", "pixellab_character_id": null, "root": "sprites/orc-high-warchief-mascot/tiers/warlord/<Char>",  "rotations": {}, "animations": {}, "reduced_motion": {} }
    ]
  }
}
```

> **정책 갱신(2026-06-29): animation 제작 착수**. 초기 설계는 "animation 미생성(정지 외형만)"이었으나, 사용자 지시로 **tier별 animation을 제작**한다(§4.4). 그래도 `static_tier` 폴백은 **계속 유효**하다 — 한 tier의 animation이 아직 manifest에 연결되기 전(또는 의도적 정지 출시)에는 **variant 정지 외형이 base animation보다 우선**한다([[SPEC-302-mascot-prestige-tiers]] §3.4 step4, P0 결정): tier ≥1에서 variant가 animation을 미보유하면 **그 variant의 정지 rotation frame**으로 표시하고(`tierMotion='static_tier'`), **base animation으로 대체하지 않는다**(그러면 base 외형이 보여 tier가 사라짐). variant에 animation이 연결되는 순간 자동으로 애니메이션으로 승급한다. tier 0(base)는 정상 애니메이션한다.

### 4.3 품질 검수 (tier 추가분)

[[11-PixelLab-Asset-Setup]] 체크리스트 + tier 전용:
- 8방향 모두 동일 정체성/얼굴/체형 유지(드리프트 없음), tier 간 **silhouette이 작은 크기에서도 구분**된다(두께·실루엣 변화가 색 없이 읽힘).
- **무기/주요 장비 일관성(필수)**: 도끼·staff·hammer·tool 등 주요 장비가 **8방향 전부에 존재**하고 손에 **쥔(grip)** 상태이며 **떠 있는 별도 prop으로 분리되지 않는다**. 후면(north/north-east 등) 방향 누락이 가장 흔한 결함 — 반드시 확인. 무기 개수가 base와 동일한지(중복/2개化 금지) 확인. (생성 실증으로 추가된 규칙 — §4.1 무기 일관성 규칙 참조.)
- **text artifact 없음**: 스프라이트 안에 글자/숫자/워터마크가 새겨지지 않는다(특히 고티어 발광 연출에서 발생 관찰됨).
- tier가 올라가도 frame size/anchor가 base와 동일(런타임 layout 불변).
- ember/gold 강화가 dark 배경에서 과포화/halo 없이 읽힌다.
- IP 오인 가능성 재검수.
- **active 이펙트 강화 확인(§4.4)**: `active` animation에 tier-단계별 ember 연출(glow/aura/spark/halo)이 실제로 들어갔고 무기·갑옷을 가리지 않으며 모션 전 프레임에서 유지되는지.

### 4.4 애니메이션 제작 (8-frame v3 — 2026-06-29 착수)

> 사용자 지시로 tier variant에 animation을 제작한다. 본 절이 그 표준이다(생성 SSOT). 런타임 소비/폴백은 [[SPEC-302-mascot-prestige-tiers]] §3.4, 점진 도입은 §3.6.

- **프레임 표준 = 8프레임(확정)**. 요구는 "7프레임"이었으나 PixelLab MCP `animate_character`는 **v3 custom이 짝수(4–16)만** 허용하고 `breathing-idle` 템플릿은 4프레임 고정이라 **7(홀수)은 MCP로 불가**(검증: `frame_count:7` → "must be even" 거부). base의 7프레임은 web UI 산출로 추정. 따라서 **표준을 8로 확정**(사용자 승인). 산출물은 방향당 **9파일 = reference(0) + animated 8(1–8)**.
- **모드·비용**: `mode:"v3"`, `frame_count:8`, `directions` 8방향 명시(v3 기본 south-only이므로 반드시 8방향 지정). **비용 = state당 56 gen(7/dir × 8)**, tier당 287(idle·roaming·active·waiting·stale ×56 + error south 7), 3 tier 전체 약 861. 동시 job 슬롯 한도 10 → **state 1개(8 job)씩 순차** 생성(error south 1 job은 끼워 가능).
- **무기 일관성(필수)**: §4.1 규칙을 animation에도 적용 — 모든 action_description 말미에 "keeping the battle axe gripped"(캐릭터별 무기) 류 grip 절을 포함해 모션 중 무기 부유·누락을 막는다(실증: idle 8프레임에서 전·후면 8방향 grip 유지 확인).
- **state별 action_description(mascot, 실사용)** — fps는 manifest 표준(idle 4 / roaming 8 / active 8 / waiting 4 / stale 3 / error 6):
  - idle(8방향): `standing idle with subtle chest breathing and a slight weight shift, keeping the battle axe gripped in both hands`
  - roaming(8방향): `walking patrol cycle with clear visible leg motion, keeping the battle axe gripped in one hand at the side`
  - **active(8방향) — 화려한 이펙트 포함(사용자 지시)**: `active working loop, quick focused motion hefting and readying the battle axe with both hands, with a glowing warm ember aura and small embers rising around the axe head and shoulders`. **이펙트는 tier-단계별로 강화**한다(§2.2): T1=ember glow/sparks, T2=더 강한 ember aura, T3=ember-storm aura + 부유 spark + 발밑 발광 rune halo. (효과는 sprite 외형으로만; status-ui overlay는 불변 — [[SPEC-302-mascot-prestige-tiers]] §3.4 step5.)
  - **T3 active = 극단적으로 화려(전 character 공통, 사용자 지시 2026-06-30)**: tier가 올라갈수록 active animation의 연출을 강화하되, **T3 active는 모든 orc에서 "극단적으로 화려"하게** 표현한다 — 캐릭터 테마 에너지(mascot ember-storm / shaman teal-storm-lightning / codex tech-forge / unknown fel-fire / iron-commander red-iron shockwave)의 **대형 aura + 강한 무기 trail + 부유 입자(spark/ember/rune) + 발밑 발광 halo**가 프레임 전반에서 터지도록 action_description에 명시한다. T1/T2 active는 절제→중간 강도로 단계적. (무기 grip·정체성 유지 규칙은 그대로; 효과는 sprite 외형으로만.)
  - waiting(8방향): `waiting alertly, shifting weight with a small idle bounce and a curious look, keeping the battle axe gripped`
  - stale(8방향): `slumping tiredly with low energy, slow heavy idle, the battle axe lowered but still held in hand`
  - error(south-only): `staggering with a sharp alarm reaction, tense shoulders recoiling, keeping the battle axe gripped`
- **점진 도입 / PHASE 구성([[SPEC-302-mascot-prestige-tiers]] §3.6 — 2026-06-30, budget 소진 대응)**: budget이 당장 복구되지 않아 **T1만 활용하는 phase로 고정**.
  - **Phase 1(현재·배포)**: delivered 5종 전부 **T1 = `available`**. T1 = 8방향 rotation + **idle·active·roaming**(8프레임 v3) animation; **mascot T1만 waiting·stale·error까지 풀세트**, 나머지 4종은 그 3상태는 `static_tier` 정지 폴백(§3.4). 런타임은 usage가 높아도 §3.3 하향 폴백으로 항상 T1 표시 = 실질 T1만 사용.
  - **Phase 2(다음·budget 복구 후)**: 각 character **T2·T3**(현 `staged`) animation 생성(T3 active 극단적 화려) + blocking IP 리뷰 통과 후 `available` 승격, 그리고 전 character **waiting·stale·error** animation 보강. mascot T2(champion)는 망토 개선 재생성 완료 상태로 Phase 2 대기, unknown은 fel demon-hunter 쌍검+T3 악마날개 개정 완료.

---

## 5. 확장 여지 (deferred)

- ~~agent별 character로 tier 일반화~~ → **본 버전에서 완료**(§2.2~2.6: delivered 5종 — mascot·storm-shaman·codex·unknown·iron-commander 4단계 설계).
- ~~tier별 전용 `active`(및 기타 state) **animation**(모션) 생성~~ → **착수(2026-06-29, §4.4)**: 8-frame v3로 mascot부터 제작 중(T1 먼저). 잔여: champion·warlord animation + 나머지 4 character animation, manifest `animations` 연결.
- `orc-iron-commander`의 **control/interrupt 상징** 역할의 전용 visual/state(usage·prestige와 **무관한 별개 축**, [[SPEC-400-control-actions]] 소관) — 도입 여부 검토(현재 SPEC-400은 iron-commander 스프라이트를 control UI에 쓰지 않음).
- camp 전체 누적(모든 orc 합산) 축 옵션, tier 강등(세션 종료 시 reset) 정책.
- tier 전환 시 연출(transition flash) — reduced-motion 예외 포함.
- character별 임계 차등(현재는 공통; manifest `thresholds` override로 가능).
