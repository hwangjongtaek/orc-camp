---
spec: SPEC-302
title: character prestige tier — 누적 token/cost 기반 캐릭터 외형 단계 resolution
status: draft
updated: 2026-06-29
requirements: [R-P2-008, R-P1-004, R-P1-005, R-UI-006]
decisions: [D-036]
tags:
  - specs
  - asset
  - sprite
  - character
  - mascot
  - prestige
  - tier
  - frontend
---

# SPEC-302 — character prestige tier resolution

이 spec은 dashboard 런타임이 **usage-driven character**(agent 세션을 대표하는 orc character)를 렌더할 때, **그 orc 자신의 누적 LLM token/cost**에 따라 **외형 단계(prestige tier)** 를 선택하는 계약을 고정한다. tier가 올라갈수록 갑옷/의장이 두텁고 화려해지고, 장비가 호화로워지며, `active` 연출이 강렬해진다(캐릭터별 tier 외형·생성 prompt는 [[15-Character-State-Model]]).

> **적용 대상(확정)**: tier는 **`prestige` 블록을 가진 character**에 적용한다 — 현재 pack의 **delivered 5종 전부**: `orc-high-warchief-mascot`(mascot), `orc-claude-storm-shaman`(Claude), `orc-codex-field-engineer`(Codex), `orc-unknown`(미확정 agent), `orc-iron-commander`(iron commander). **`orc-iron-commander`도 포함된다(확정)**: `CHARACTER_POOL`(§2.3a′)을 통해 실제 orc(pane)에 배정되면 그 orc의 usage로 tier가 정해진다 — 다른 character와 **완전히 동일한 메커니즘**이다. iron-commander의 *control/interrupt 상징* 역할([[SPEC-400-control-actions]])은 usage·tier와 무관한 **별개 축**이며, 본 tier가 그 control 역할을 바꾸지 않는다(그 축의 visual은 SPEC-400 소관·미정). tier는 **per-orc**다: 같은 character key로 렌더되는 orc가 여럿이면 각자 자기 usage로 tier를 갖는다. 어떤 orc가 어떤 character key로 해석되는지는 [[SPEC-300-asset-rendering]] §2.3(a)(agentType→character) / §2.3(a′)(`CHARACTER_POOL` 읽기-순서) / §3.1이 정한다 — 본 spec은 그 결과를 받는다(manifest의 `role` 문자열은 서술 라벨일 뿐 선정 메커니즘이 아니다).

본 spec은 **소비/선택 메커니즘**만 다룬다: ① 누적 token/cost → tier index 판정, ② tier → manifest variant resolution(미가용 tier의 하향 폴백), ③ tier가 [[SPEC-300-asset-rendering]]의 `status → animation state` / `status → effect overlay` 위에 **얹히는 합성 순서**, ④ reduced-motion·placeholder parity. tier 자산의 *생성*(PixelLab `create_character_state`, prompt/seed/ID)과 tier별 외형 사양은 [[15-Character-State-Model]]가 SSOT다.

> **상태(draft)**: 본 기능은 채택 P1을 보강하는 **forward(R-P2-008 proposed)** 다. 자산 생성이 [[13-PixelLab-Asset-Registry]] 기준 closed·인증 보류이므로, 본 spec은 **schema-first**로 계약을 고정하고 tier 자산이 들어오기 전까지 런타임이 **항상 base(tier 0)로 안전 폴백**하도록 설계한다(§3.3). 데이터 의존성(누적 token/cost 수집)은 미구현 forward다(§2.2).

> **소유 경계**: 본 spec은 *tiered character의 tier 선택*만 소유한다. character key 해석(agentType→character·pool·mascot 폴백)·animation state 전이·frame 재생·effect overlay·reduced-motion freeze·placeholder의 **메커니즘**은 [[SPEC-300-asset-rendering]]가 소유하고, 본 spec은 그 입력(어떤 character variant를 base로 쓸지)만 한 단계 앞에서 정한다. scan 데이터 shape는 [[SPEC-005-data-contract]], `status` 추론은 [[SPEC-004-status-inference]], 배치/이동은 [[SPEC-301-camp-map-movement]].

## 1. Scope

### In scope

- **tier 판정**: orc 누적 token/cost → `tierIndex ∈ {0,1,2,3}`. 임계 상수, 1차 축(tokens)·보조 축(cost), 누락(`null`)→0, **단조 비감소 latch**(§3.2). 모든 tiered character에 **공통 임계**(§3.1; character별 override는 manifest `thresholds`로 가능하나 기본은 공유).
- **tier → variant resolution**: manifest `characters[<tiered key>].prestige.tiers[]`에서 해당 tier의 variant(root/rotations/animations)를 고르고, **자산 미가용(`status:"planned"` 또는 `pixellab_character_id:null` 또는 root 누락) 시 하향 폴백**(highest available ≤ 요청 tier → base).
- **합성 순서**(§3.4): tier가 base character를 교체 → 그 위에서 [[SPEC-300-asset-rendering]]의 `status→animation state`·`status→effect overlay`가 그대로 동작. tier variant에 animation이 없으면 **variant 정지 외형 우선**(§3.4 step4).
- **reduced-motion·placeholder parity**: tier가 결정돼도 [[SPEC-300-asset-rendering]] §3.4/§3.5와 동일하게 freeze/placeholder 동작.
- **적용 대상**: `prestige` 블록을 가진 character(현 pack 5종: mascot·storm-shaman·codex·unknown·iron-commander). `prestige` 블록 부재 character(구버전 pack·custom·placeholder)는 tier 0 고정.
- 다루는 요구사항: **R-P2-008**(proposed, character prestige tier — 본 spec 1차 소유). **secondary/parity**(1차 소유는 [[SPEC-300-asset-rendering]], 본 spec은 그 위 한 단계만 추가): R-P1-004(agent별 sprite variant — "동일 character의 외형 variant" 축으로 확장), R-P1-005(asset-pack 교체 substrate — tier는 manifest/asset-pack 구동), R-UI-006(asset 없을 때 placeholder/layout parity — §3.5, AC-07).

### Out of scope (다른 spec으로)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| tier 자산 외형 정의·생성 prompt/seed/ID·생성 runbook | 자산 생성 | [[15-Character-State-Model]] / [[13-PixelLab-Asset-Registry]] |
| sprite 상태머신·frame 재생·effect overlay·reduced-motion·placeholder **메커니즘** | 렌더 메커니즘 | [[SPEC-300-asset-rendering]] |
| 누적 token/cost **수집 규칙**(transcript 파싱·필드 직렬화) | 데이터 산출/계약 | §2.2 forward → [[SPEC-002-tmux-discovery]] / [[SPEC-005-data-contract]] / [[SPEC-004-status-inference]] |
| 어떤 orc가 어떤 character key로 해석되는지(agentType→character·pool 배정) | character key 배정 규칙 | [[SPEC-300-asset-rendering]] §2.3(a/a′)·§3.1 (본 spec은 그 결과를 받음) |
| `orc-iron-commander`의 **control/interrupt 상징** 역할의 visual(usage 무관 별개 축) | control 상징 | [[SPEC-400-control-actions]] (본 spec은 iron-commander의 *prestige tier*만 소유; control-symbol visual은 미정) |
| orc 배치 좌표·이동 | 화면/배치 | [[SPEC-201-dashboard-screens]] / [[SPEC-301-camp-map-movement]] |
| tier별 전용 active **animation**(모션) | 후속 자산 | [[15-Character-State-Model]] §5 (deferred) |

## 2. 입력

### 2.1 manifest 입력

`characters[<tiered key>].prestige`(schema는 [[15-Character-State-Model]] §4.2). 핵심:
- `axis`: `"cumulative_tokens"`(1차) — 보조 `"cumulative_cost_usd"`.
- `thresholds.tier{1,2,3}.{min_tokens,min_cost_usd}` — 우선순위(확정): **런타임은 manifest `thresholds`가 있으면 그것을, 없으면 §3.1 spec 상수(기본 seed)를 사용**한다. spec 상수는 **canonical 기본값의 SSOT**이고, manifest의 상이값은 **정당한 character별 override**로 간주한다(드리프트 경고가 아니라 의도된 차등) — override가 있으면 §6에 기록한다.
- `tiers[]`: tier 1~3 variant 엔트리(`tier`/`label`/`status`/`pixellab_character_id`/`root`/`rotations`/`animations`/`reduced_motion`). tier 0은 character의 top-level base 필드. `label`은 character별로 다르다([[15-Character-State-Model]] §2.2/§6).
  - `status` enum(확정): `"planned"`(자산 미생성, `pixellab_character_id:null`) | `"staged"`(자산 생성·배치·승인 완료지만 **rollout 보류** — resolution 제외, 하향 폴백 대상; **점진 도입(phased rollout)**용 — §3.6) | `"available"`(생성·배치 완료 + **rollout 완료**, resolution 후보) | `"deprecated"`(예약, resolution 제외). §3.3은 **`"available"`만 후보**로 보며 `"planned"`/`"staged"`/`"deprecated"`는 모두 하향 폴백된다.
- `prestige` 블록 **부재**(구버전 pack·custom character·placeholder) ⇒ tier 0 고정(폐기 안전).

### 2.2 데이터 입력 (forward — 미구현 의존성)

tier 판정은 orc별 **누적 token/cost**를 요구하나, **현재 [[SPEC-005-data-contract]] `Orc`에는 해당 필드가 없다.** 본 spec은 다음 신규 필드를 **제안**하며, 실제 수집/직렬화는 forward다(scope: design/docs/spec).

```ts
// [[SPEC-005-data-contract]] Orc에 추가 제안 (forward)
interface OrcUsage {
  cumulativeTokens: number | null;   // 세션 누적 billable tokens(input+output). 측정 불가 시 null
  cumulativeCostUsd: number | null;  // 누적 추정 cost(USD). 불가 시 null
  source: 'transcript' | 'estimated' | 'unknown';
  measuredAt: string | null;         // ISO 8601, 마지막 측정 시각
}
// Orc: { ... ; usage: OrcUsage | null }   // null = 미측정/수집 불가
```

- 출처(forward): agent 세션 transcript/usage(예: Claude Code/Codex 세션 JSONL 누적 usage). 수집은 [[SPEC-002-tmux-discovery]]의 process/세션 introspection 능력 확장으로 best-effort·degradable해야 한다(획득 불가 시 `usage=null`, 단정 금지 — [[SPEC-006-privacy-redaction]] 비저장·redaction 원칙 준수).
- ⚠️ **신규 위협면 — 보안 리뷰 완료, CONDITIONAL GO**: transcript/usage 읽기는 tmux capture를 넘어 **세션 로그 파일을 직접 읽는 새 read surface**다(민감 내용 포함 가능). security-privacy-engineer 사전 리뷰가 이를 [[SPEC-008-usage-collection]](privacy/security 소유, [[08-Decisions|D-039]])로 격리하고 **CONDITIONAL GO**를 판정했다. 구현은 SPEC-008 §1.1 GO 조건(G1~G8: 집계 스칼라만 산출·content 구조적 skip·비저장·root confinement·bounded read·degradable null·misattribution 금지·provider-pluggable)을 **전부** 충족할 때만 착수할 수 있고, transcript 원문/경로/secret을 저장·log·직렬화·반환하는 어떤 경로도 **금지(NO-GO)**다. 본 spec은 그 계약이 산출한 `OrcUsage`(숫자 집계)만 소비한다(원문 비접촉). 현재는 forward로 격리돼 blocker는 아니다.
- `orc-unknown`(agent type 미확정): usage 출처가 더 약할 수 있다(어떤 agent인지 모름). 획득 불가 시 `usage=null`→tier 0이 정상 동작이며, 단정하지 않는다.
- `usage=null` 또는 두 축 모두 `null` ⇒ tier 0.

## 3. 계약

### 3.1 tier 임계 상수 (SSOT, 모든 tiered character 공통)

```ts
const PRESTIGE_TIER1_MIN_TOKENS = 1_000_000;
const PRESTIGE_TIER2_MIN_TOKENS = 5_000_000;
const PRESTIGE_TIER3_MIN_TOKENS = 20_000_000;
// 보조 축(tokens 분해 불가 시)
const PRESTIGE_TIER1_MIN_COST_USD = 5;
const PRESTIGE_TIER2_MIN_COST_USD = 25;
const PRESTIGE_TIER3_MIN_COST_USD = 100;
```
초기값이며 **튜닝 대상**이다(근거 [[15-Character-State-Model]] §3). 이 상수는 **canonical 기본값(default seed)의 SSOT**이고 모든 tiered character가 기본으로 공유한다. 런타임 우선순위는 §2.1대로 **manifest `thresholds` 우선, 부재 시 본 상수**다(character별 override는 정당). 기본값 변경 시 본 절을 갱신하고, override 발생 시 §6에 기록한다.

### 3.2 tier 판정 (pure function + latch)

```ts
function rawTierForUsage(usage: OrcUsage | null): 0|1|2|3 {
  if (!usage) return 0;
  const t = usage.cumulativeTokens;
  if (t != null) {
    if (t >= PRESTIGE_TIER3_MIN_TOKENS) return 3;
    if (t >= PRESTIGE_TIER2_MIN_TOKENS) return 2;
    if (t >= PRESTIGE_TIER1_MIN_TOKENS) return 1;
    return 0;
  }
  const c = usage.cumulativeCostUsd;            // tokens 없을 때만 cost 축
  if (c != null) {
    if (c >= PRESTIGE_TIER3_MIN_COST_USD) return 3;
    if (c >= PRESTIGE_TIER2_MIN_COST_USD) return 2;
    if (c >= PRESTIGE_TIER1_MIN_COST_USD) return 1;
  }
  return 0;
}
```

- **게이트(확정, P0)**: tier 판정·latch는 **resolved character가 `prestige` 블록을 가진 character일 때만** 수행한다. 비대상(=`prestige` 부재 character; 구버전/custom/placeholder)은 `rawTierForUsage`를 호출하지 않고 latch를 계산·저장하지 않으며 **`displayedTier=0`을 보고**한다(usage가 주어져도 0). 합성 순서상 이 게이트(§3.4 step1)가 §3.2(tier 판정·latch)보다 **앞선다** — 비대상에는 §3.2가 진입하지 않는다.
- **단조 비감소 latch**(확정, tiered character 한정): 같은 orc에 대해 런타임이 본 tier는 내려가지 않는다. `displayedTier = max(prevDisplayedTier(id, characterKey), rawTierForUsage(usage))`. usage가 일시적으로 `null`/감소해도 시각적 강등(깜빡임)을 만들지 않는다.
  - **상태 저장·키잉(복합 키, 확정)**: latch 상태(`prevDisplayedTier`)는 **render 레이어**(spriteResolver 호출자 / scene store)가 **`(orc id, resolvedCharacterKey)` 복합 키**로 보관한다. orc id만으로 키잉하면, [[SPEC-300-asset-rendering]] §2.3(a′) pool index 재배정으로 **같은 id의 resolved character key가 snapshot 간 바뀔 때** tier가 엉뚱한 character(또는 비대상)로 **이월**된다 — 이를 막기 위해 character key를 키에 포함한다. scan snapshot이나 server 데이터에는 저장하지 않는다(read-only·data-contract 불변, [[SPEC-005-data-contract]] §2.1). 클라이언트 표시 상태이며 새로고침/재기동 시 재계산된다.
  - **리셋 트리거(확정)**: (i) 어떤 snapshot의 `camps[].orcs[]`에서 해당 `id`가 **사라지면**, 또는 (ii) 같은 `id`의 **resolved character key가 직전 snapshot과 달라지면**, 그 (id, 옛 characterKey) latch 항목을 제거한다. 재등장/재배정 후에는 `prevDisplayedTier` 없이 raw부터 재시작한다(`paneId` 안정 식별자 기준 — [[SPEC-005-data-contract]] §2.1).
- **결정성 경계(확정, [[SPEC-300-asset-rendering]] §2.4 cross-link)**: `rawTierForUsage(usage)`는 **순수 함수**다(같은 `usage` → 같은 raw tier). latch는 그 위에 얹힌 **명시적 상태머신**으로, SPEC-300 §2.4 결정성은 **latch 상태를 입력의 일부로 포함**시켜 성립한다(= `(usage, resolvedCharacterKey, prevDisplayedTier(id, characterKey))`가 같으면 결과 같음). SPEC-300 §3.1 forward note에 이 예외를 명시한다.

### 3.3 tier → variant resolution + 하향 폴백 (확정)

```
대상: characters[key].prestige가 있는 tiered character (없으면 즉시 BASE)
요청 tier = displayedTier (3..0)
for k in [요청 tier .. 1]:           // 높은 tier부터 내려오며
  e = prestige.tiers[tier==k]
  if e exists AND e.status == "available" AND e.pixellab_character_id != null AND e.root 존재:
    return variant(e)                // 이 tier variant를 base로 사용
return BASE                           // tier 0 = character top-level base 필드
```
- **자산 미가용은 절대 placeholder로 떨어지지 않고 base로 폴백**한다(생성 전 안전 동작 = 항상 base가 보임). character 자체 미해석 시에만 [[SPEC-300-asset-rendering]] §3.1 character 폴백(mascot→placeholder)이 적용된다.
- `prestige` 블록 부재(구버전/custom/placeholder) ⇒ BASE.

**관측 가능한 resolution 결과(확정, 테스트 대상)**: tier resolution은 다음 타입을 산출하고, 이 필드들이 §3.4·AC의 검증 대상이다. 런타임은 이를 [[SPEC-300-asset-rendering]] §2.4 `SpriteRenderState` 확장으로 노출한다(forward: `prestigeTier`/`appearanceRoot`/`frameRoot`/`tierMotion` 추가 — owner SPEC-300 §2.4와 합의해 반영).

```ts
interface CharacterTierResolution {
  characterKey: string;                 // 해석된 tiered character key (mascot/storm-shaman/codex/unknown)
  displayedTier: 0 | 1 | 2 | 3;        // §3.2 latch 적용 후 표시 tier
  appearanceKey: string;                // 선택된 variant character key. tier 0이면 base character key
  appearanceRoot: string;               // 정지 외형(rotation/static frame)을 resolve하는 root
  frameRoot: string;                    // animation frame resolve root. variant가 animation 보유 시 variant root, 아니면 == appearanceRoot
  tierMotion: 'animated' | 'static_tier'; // static_tier = §3.4 step4 둘째 분기(tier≥1·animation 미보유→정지)
}
```
- tier 0 / `prestige` 부재 ⇒ `{ displayedTier:0, appearanceKey: base character key, appearanceRoot=frameRoot=base root, tierMotion:'animated' }`.

### 3.4 합성 순서 (tier ⊕ animation state ⊕ effect overlay)

1. character key 해석([[SPEC-300-asset-rendering]] §3.1) → tiered character key(mascot/storm-shaman/codex/unknown) 또는 비대상.
2. **본 spec**: §3.2 tier 판정 → §3.3 variant 선택. 이 variant가 이후 단계의 **base character를 대체**(root/rotations/animations/reduced_motion 출처).
3. 이후는 [[SPEC-300-asset-rendering]] 그대로: `status → animation state`(§3.2), frame 재생(§3.3), `status → effect overlay`(§3.4), reduced-motion freeze(§3.4).
4. **animation 미보유 tier 처리 — variant 외형 우선(확정, P0 결정)**: tier 자산은 현재 rotation만 갖고 animation이 없다([[15-Character-State-Model]] §4.2, "animation 미생성"). 폴백 우선순위는 **반드시 variant 정지 외형이 base animation보다 우선**한다 — 그렇지 않으면 orc는 상시 어떤 status로 애니메이션하므로 tier 외형이 normal-motion에서 **영영 보이지 않는다**(자기무력화). 따라서:
   - 선택된 variant가 요청 animation state 폴더를 **가지면** → variant root로 애니메이션(`tierMotion='animated'`, frameRoot=variant).
   - 가지지 **않으면**(현 tier 1~3의 기본) → **그 variant의 정지 rotation frame**(요청 direction, 없으면 south)으로 표시한다(`tierMotion='static_tier'`, frameRoot=appearanceRoot=variant). **base character의 animation으로 대체하지 않는다**(그러면 base 외형이 보여 tier가 사라짐).
     - **경로 조립(확정)**: static_tier frame = `appearanceRoot + "/" + prestige.tiers[k].rotations[direction]`(direction 없으면 `rotations["south"]`). 이는 [[SPEC-300-asset-rendering]] §2.2 경로 조립의 **tier variant `rotations` 확장**이며, 결과를 `SpriteRenderState.staticFramePath`로 노출한다(SPEC-300 §2.2 표에 "tier variant `rotations[dir]` → `staticFramePath`" 브리지 추가 — forward, owner SPEC-300과 합의).
   - tier 0(base)는 종전과 동일하게 [[SPEC-300-asset-rendering]] §3.2~3.3로 정상 애니메이션한다(회귀 없음).
   - 결과: tier ≥1에서는 **두텁고 화려한 외형이 항상(정지로) 노출**되고, 그 대신 모션은 보류된다. tier별 모션 복원은 [[15-Character-State-Model]] §5 deferred이며, tier variant에 animation이 생기는 순간 이 규칙(첫 분기)이 자동으로 애니메이션으로 승급한다(forward-compatible).
5. **effect overlay는 tier와 무관**하다([[SPEC-300-asset-rendering]] §2.3(c) `objects/status-ui` 매핑 불변). tier의 active 강화는 sprite 외형(캐릭터별 ember/storm/tech/fel/red-iron 연출)으로만 표현하고, overlay 아이콘 세트는 바꾸지 않는다(중복·과포화 방지). active 연출 강도는 tier에 따라 커지며 **T3 active는 전 character에서 극단적으로 화려**하다([[15-Character-State-Model]] §4.4) — 이는 tier variant animation **자산의 속성**일 뿐, 본 spec의 resolution·합성·overlay 계약은 불변이다(런타임은 자산이 가진 프레임을 그대로 재생).

### 3.5 reduced-motion·placeholder parity (확정)

- `prefers-reduced-motion`: §3.3로 정한 variant의 `reduced_motion.fallback_frame`(없으면 base의 것)으로 freeze. tier 판정 자체는 동일하게 수행(정지 외형은 tier 반영).
- asset 미탑재/누락: [[SPEC-300-asset-rendering]] §3.5 placeholder. placeholder는 tier를 시각화하지 않아도 되며(단일 placeholder), **layout/anchor/interaction parity**는 유지한다([[SPEC-300-asset-rendering]] R-UI-006).

### 3.6 점진 도입(phased rollout, 확정)

tier는 **한꺼번에 전부 켜지 않고 단계적으로 도입**한다. 도입 단위는 per-tier `status`이며, 자산이 생성·승인됐어도 **rollout 전에는 `"staged"`**로 두어 resolution에서 제외하고, 준비되면 `"available"`로 승격한다. §3.3 폴백이 이를 안전하게 처리한다 — `"staged"` tier는 후보가 아니므로 그보다 높은 raw tier를 가진 orc도 **현재 `"available"`한 가장 높은 tier(없으면 base)** 로 표시된다(시각적 결손/placeholder 없음).

- **도입 순서(확정)**: **(1) 모든 character의 T1 먼저** → **(2) 그 다음 각 character의 T2·T3**. 낮은 tier가 가장 자주 노출되므로 폭넓게 먼저 깔고, 고티어(외형·연출 강함→검수/IP 리스크 큼, animation 비용 큼)는 후행한다.
- **PHASE 구성(확정, 2026-06-30 — budget 소진 대응)**: PixelLab generation budget이 당장 복구되지 않으므로 **T1만 활용하는 phase로 고정**한다.
  - **Phase 1 (현재·배포 대상)**: **delivered 5종 전부 T1 = `available`**. T1 자산 = 8방향 rotation + **idle·active·roaming** animation(8프레임 v3, mascot T1은 추가로 waiting·stale·error까지 풀세트). T1에서 **animation 미보유 상태(여타 4종의 waiting·stale·error)는 §3.4 `static_tier`로 그 tier의 정지 rotation 표시**(base 대체 없음). 런타임은 usage가 높아도(raw T2/T3) §3.3 하향 폴백으로 **항상 T1(가장 높은 available)** 을 보여준다 = 실질적으로 **T1만 사용**.
  - **Phase 2 (다음 phase·budget 복구/충전 후)**: 각 character **T2·T3 도입**(현 `staged`) — T2/T3 animation 생성(T3 active = 극단적으로 화려, §3.4), blocking IP 리뷰(§2.7 mascot/shaman/iron/unknown 고티어) 통과 후 `available` 승격. + 전 character **waiting·stale·error animation 보강**(현재 static_tier 폴백). 승격은 manifest `status` 변경으로 점진(§3.6 상향 허용·강등 금지).
  - **현 status(2026-06-30)**: 5종 × {T1 `available`, T2 `staged`, T3 `staged`}. mascot T2(champion)는 망토 개선 재생성 반영; unknown은 fel demon-hunter 쌍검+T3 악마날개로 전면 개정.
- **승격 조건(tier N을 `"staged"`→`"available"`로)**: ① 8방향 rotation 승인(무기 일관성·IP — [[15-Character-State-Model]] §4.3), ② 해당 tier의 animation 세트 제작·검수 완료(또는 의도적으로 `static_tier`로 출시한다는 결정), ③ (T2/T3 등 고위험 tier는) §IP 리뷰 통과. 승격은 manifest `status` 한 줄 변경 + 본 절·[[13-PixelLab-Asset-Registry]] 기록으로 한다.
- **단조 latch와의 상호작용(주의)**: latch(§3.2)는 `displayedTier`(폴백 적용 후 표시값)가 아니라 **raw tier 기준으로 보관**하지 않는다 — latch는 **표시 tier**를 잠근다. 따라서 rollout으로 T2가 새로 `available`이 되면, 이미 T1로 latch된 orc도 다음 판정에서 raw가 T2 이상이면 자연히 T2로 올라간다(상향은 허용, 강등만 금지). 반대로 어떤 tier를 `available`→`staged`로 **내리는 운영은 권장하지 않는다**(이미 그 tier를 본 orc가 latch로 유지하려 하나 자산이 후보에서 빠지면 §3.3로 하향 폴백되어 시각적 강등이 발생 — 강등 금지 원칙과 충돌). 일단 켠 tier는 유지한다.

## 4. Acceptance Criteria

- **SPEC-302-AC-01** (R-P2-008) — tier 판정 임계
  - Given tiered character, `usage.cumulativeTokens` = 0 / 1.2M / 6M / 25M fixture에서
  - When tier를 판정하면
  - Then 각각 `rawTier` = 0 / 1 / 2 / 3 이다. 경계값(정확히 1,000,000 / 5,000,000 / 20,000,000)은 해당 tier로 **올림**(≥)이다.
- **SPEC-302-AC-02** (R-P2-008) — cost 보조 축·경계·null
  - Given `cumulativeTokens=null` & `cumulativeCostUsd` = 4.99 / 5 / 30 / 100 / `usage=null` fixture에서
  - Then `rawTier` = 0 / 1 / 2 / 3 / 0 이다(tokens 부재 시 cost 축, cost 경계 $5/$25/$100은 inclusive(≥), 둘 다 부재 시 0).
- **SPEC-302-AC-03** (R-P2-008) — 단조 비감소 latch
  - Given 같은 orc `id`가 tier 2로 표시된 뒤, 다음 snapshot에서 `usage`가 tier 1 상당으로 감소(또는 `null`)한 fixture에서
  - Then 표시 tier는 **2로 유지**된다(강등 없음). 다른 `id`는 독립이다.
- **SPEC-302-AC-04** (R-P2-008, R-P1-005) — 자산 미가용 하향 폴백
  - Given `displayedTier=3`이지만 `prestige.tiers`의 tier 3가 `status:"planned"`(또는 `pixellab_character_id:null`)이고 tier 1만 `available`인 fixture에서
  - Then resolution은 `appearanceKey`=tier 1 variant key, `appearanceRoot`=tier 1 root다(선택 variant=tier 1). tier 1도 미가용이면 `appearanceKey`=base character key·`appearanceRoot`=base root(tier 0)이고, **placeholder로는 떨어지지 않는다**(`tierMotion`은 §3.4에 따름).
- **SPEC-302-AC-05** (R-P2-008) — 비대상 character는 tier 0 (게이트)
  - Given **resolved characterKey를 직접 주입**한 fixture: (a) `prestige` 블록이 manifest에 없는 character key(구버전/custom), (b) placeholder/character-fallback 경로 — **둘 다 `usage.cumulativeTokens=25M`을 부여**해서
  - Then 둘 다 `displayedTier=0`·`appearanceKey`=각자 base key로 동작하고(§3.2 게이트로 `rawTierForUsage` 미호출·latch 미저장) [[SPEC-300-asset-rendering]] 결과와 동일하다(회귀 없음). usage가 tier 3 상당이어도 0이다.
- **SPEC-302-AC-06** (R-P2-008, R-P1-004) — 합성 순서(tier ⊕ status)·variant 외형 우선
  - Given **resolved characterKey=`orc-high-warchief-mascot`(직접 주입)**, tier 2 variant가 `available`(animation 미보유 — 현 자산 현실), `status=active`, reduced-motion 아님 fixture에서
  - Then `appearanceKey`=tier 2 variant key, `appearanceRoot`=tier 2 root이고 `animationState='active'`다. tier 2가 active animation을 **미보유**하므로 `tierMotion='static_tier'`·`frameRoot`=tier 2 root이며 표시 frame은 tier 2의 **정지 rotation**(`active` 방향)이다 — **base root의 active 폴더로 대체되지 않는다**(§3.4 step4). effect overlay는 `active-spark`로 tier와 무관하다.
  - And tier 2 variant가 active animation을 **보유한** 변형 fixture에서는 `tierMotion='animated'`·`frameRoot`=tier 2 root로 tier 2의 active animation이 재생된다(forward 승급).
- **SPEC-302-AC-07** (R-P2-008, R-UI-006) — reduced-motion·placeholder parity
  - Given `prefers-reduced-motion`(tier 2 available) / asset 미탑재 fixture에서
  - Then 전자는 tier 2 variant의 `reduced_motion.fallback_frame`으로 freeze(frame 미진행), 후자는 placeholder로 layout/anchor parity 유지(tier 시각화는 선택).
- **SPEC-302-AC-08** (R-P2-008) — latch 리셋(identity 소멸→재등장)
  - Given orc `id=pane:%7`이 tier 2로 표시된 뒤, 다음 snapshot의 `camps[].orcs[]`에서 `%7`이 사라지고, 그 다음 snapshot에서 같은 `id=pane:%7`이 tier 0 상당 usage로 재등장한 fixture에서
  - Then `%7`의 latch 항목은 소멸 시 제거되어 재등장 시 `displayedTier`는 **0부터 재계산**된다(이전 2를 유지하지 않는다). 소멸되지 않은 다른 `id`의 latch는 영향받지 않는다.
- **SPEC-302-AC-09** (R-P2-008, R-P1-004) — 비-mascot tiered character의 tier resolution + 합성(일반화 증명)
  - Given **resolved characterKey를 직접 주입**: `orc-claude-storm-shaman`(tier 2 variant `available`, animation 미보유), `usage.cumulativeTokens=6M`, `status=active`, reduced-motion 아님; 그리고 동일 조건의 `orc-codex-field-engineer`·`orc-unknown`·`orc-iron-commander` fixture에서
  - Then 각 character는 `characterKey`=자기 key, `displayedTier=2`, `appearanceKey`=자기 tier 2 variant key, `appearanceRoot`=자기 tier 2 root, `tierMotion='static_tier'`·`frameRoot`=tier 2 root로 resolve된다(§3.4 static_tier 규칙이 mascot 전용이 아니라 tiered character 전체에 동일 적용 — base root로 대체되지 않음).
- **SPEC-302-AC-10** (R-P2-008) — latch 복합 키: character key 변동 시 리셋(pool 재배정)
  - Given orc `id=pane:%5`가 `orc-claude-storm-shaman`으로 tier 3을 표시한 뒤, 다음 snapshot에서 [[SPEC-300-asset-rendering]] §2.3(a′) pool 재배정으로 같은 `%5`의 resolved characterKey가 `orc-codex-field-engineer`(또는 `prestige` 블록 없는 character)로 **바뀐** fixture에서
  - Then `(%5, orc-claude-storm-shaman)` latch는 제거되고 새 `(%5, orc-codex-field-engineer)`는 `prevDisplayedTier` 없이 raw부터 재시작한다(tier 3 이월 없음). 새 character가 `prestige` 부재면 §3.2 게이트로 `displayedTier=0`이다(이월 0).
- **SPEC-302-AC-11** (R-P2-008, R-P1-005) — 점진 도입(staged) 하향 폴백
  - Given **resolved characterKey=`orc-high-warchief-mascot`(직접 주입)**, `displayedTier=3`, manifest `prestige.tiers`에서 **T1=`"available"`, T2·T3=`"staged"`**(자산은 있으나 rollout 보류)인 fixture에서
  - Then resolution은 `appearanceKey`=**T1 variant key**·`appearanceRoot`=T1 root다(§3.3·§3.6: `"staged"`는 후보 제외 → 가장 높은 `"available"` tier로 하향 폴백). **placeholder로 떨어지지 않는다.**
  - And T1까지 `"staged"`(또는 `"planned"`)면 `appearanceKey`=base character key·tier 0이다.
  - And 이후 T2를 `"available"`로 승격한 fixture에서는 같은 `displayedTier=3`이 `appearanceKey`=T2 variant key로 상향된다(rollout 승격 반영; latch는 표시 tier를 잠그되 상향은 허용 — §3.6).

## 5. 의존성·forward

- **데이터(blocker for live)**: §2.2 `Orc.usage` 수집·직렬화([[SPEC-002-tmux-discovery]]/[[SPEC-005-data-contract]]/[[SPEC-004-status-inference]]). 미구현 시 tier 0 고정 — 본 spec의 resolution은 동작하지만 항상 0.
- **자산(blocker for tier>0 visual)**: 각 tiered character의 tier 1~3 variant 생성([[15-Character-State-Model]] §4) + manifest `prestige` 반영(asset pack v0.2.0). 미생성 시 §3.3로 base 폴백.
- **인증(blocker for 생성)**: `PIXELLAB_AUTH_HEADER` 설정.
- **런타임 구현**: [[SPEC-200-frontend-architecture]] spriteResolver에 §3.2~3.4 추가(현재 `resolveCharacter`가 character key만 해석 — tier 단계를 그 직후에 삽입). **게이트는 resolved character의 `prestige` 블록 존재(manifest 구동)** 다 — 하드코딩 key whitelist가 아니라, `prestige`를 가진 어떤 character(custom/future pack 포함)도 동작하고 없으면 tier 0. 본 spec이 4종을 열거한 것은 현재 pack의 적용 대상 설명일 뿐이다.

## 6. manifest와의 충돌 기록

(없음 — 본 spec 작성 시점 manifest에 `prestige` 블록 미반영. v0.2.0 반영 시 §3.1 thresholds 일치 여부 및 character별 `thresholds` override 여부를 본 절에 기록한다.)
