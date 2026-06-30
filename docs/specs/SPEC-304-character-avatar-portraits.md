---
spec: SPEC-304
title: Character Avatar Portraits — Detail panel 우측 BG식 흉상
status: draft
updated: 2026-06-29
requirements: [R-UI-011, R-UI-004, R-P1-004, R-P2-008, R-UI-006]
decisions: [D-038]
tags:
  - specs
  - camp-visual
  - inspector
  - asset
  - portraits
---

# SPEC-304 — Character Avatar Portraits (Detail panel 우측 BG식 흉상)

선택된 orc의 **character 정체성**을 Baldur's Gate 풍 **세로 2:3 흉상(bust) portrait**로 camp Detail 패널(`OrcInspector`의 "Details" dock tab) **우측**에 표시하는 런타임 **소비/렌더/배치 계약 + 수용 기준(AC)** SSOT다.

자산 *생성* 관점(흉상 framing 계약, character별 prompt, prestige tier prompt delta, 생성 runbook, manifest `portraits` 스키마 상세)은 [[17-Character-Avatar-Portraits]]가 소유한다. 본 spec은 prompt를 중복하지 않고, [[17-Character-Avatar-Portraits]] §1/§5의 LOCKED 블록(asset class·2:3·512×768·CSS frame ownership·20 roster·`portraits` schema)을 **그대로 참조**한다. 불일치 발견 시 두 문서를 함께 고친다.

> **현황(2026-06-29)**: **spec 작성 단계**다. portrait 자산 20장은 미생성(planned)이며 manifest `portraits` 블록도 미반영이다. 따라서 런타임은 본 spec의 **placeholder 폴백**으로 동작하고, 자산은 PixelLab 우선 시도 + 외부 image-gen 폴백([[17-Character-Avatar-Portraits]] §6)으로 후속 생성한다. schema-first로 고정해 자산 생성 전에도 zero-layout-shift로 안전 동작한다([[08-Decisions|D-038]]).

## 1. Scope

### In scope

- inspector(Details) **탭 내** portrait slot의 **렌더/배치 계약**: 2:3 box, CSS frame ownership, name/role caption, dock-폭 기반 2-col↔1-col reflow(페이지 우측 컬럼·mobile sheet 아님 — §2.3).
- **결정적 portrait resolution**: 표시 character key 결정(sprite와 동일 precedence) + prestige tier 적용 + 폴백 체인 + placeholder 강등.
- manifest top-level **`portraits` 스키마 참조 계약**(소유: [[17-Character-Avatar-Portraits]] §5).
- delivered **5종 base + 15 tier = 20 portrait** roster의 런타임 계약(§7 per-character 표).
- 수용 기준(AC).

### Out of scope (다른 슬라이스/단계)

- 실제 portrait 이미지 **생성**·SHA-256·IP 리뷰·license 게이트 → [[17-Character-Avatar-Portraits]] §6, [[08-Decisions|D-009]].
- prestige **tier 임계·latch·token/cost resolution** 자체 → [[SPEC-302-mascot-prestige-tiers]](본 spec은 그 결과 tier만 *소비*).
- character key **sequential 배정** 알고리즘 → [[SPEC-300-asset-rendering]] §2.3(본 spec은 그 결과 key만 *소비*).
- **animated** portrait, full-body portrait, roster 외 character.
- map scene의 sprite 렌더(별개 자산 축) → [[SPEC-300-asset-rendering]].

## 2. Contract

### 2.1 manifest `portraits` 블록 (참조 — 소유: [[17-Character-Avatar-Portraits]] §5)

manifest top-level에 `characters`와 **형제** 블록으로 `portraits`를 둔다. 파일은 `asset-packs/orc-camp-default/portraits/` 아래. base = `portraits/<key>.webp`, tier = `portraits/tiers/<suffix>/<key>-<suffix>.webp`.

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

- `items.<key>`의 key는 manifest `characters`의 key와 **정확히 일치**한다(5종).
- `frame_aspect`는 모든 portrait 공통 `"2:3"`(런타임 CSS slot이 강제).
- `source_size`는 블록 기본 `[512, 768]`이며 item별 실측값으로 override 가능(source-of-truth).
- `tiers.<suffix>`의 suffix는 [[SPEC-302-mascot-prestige-tiers]]/[[13-PixelLab-Asset-Registry]] item 10과 동일.

### 2.2 Portrait resolution (결정적 순수 함수)

표시 character key는 sprite resolver([[SPEC-300-asset-rendering]] §2.3, `web/src/assets/spriteResolver.ts`)와 **동일 precedence**로 `manifest.characters`에 대해 정한다(그래야 portrait가 같은 orc의 sprite와 같은 archetype을 보인다). prestige tier는 [[SPEC-302-mascot-prestige-tiers]] §3.3이 산출한 **`CharacterTierResolution`**(`{ characterKey, displayedTier: 0|1|2|3, appearanceKey, … }`)에서 **숫자 `displayedTier`**를 받아 소비한다 — SPEC-302 출력에는 tier suffix 문자열이 **없다**. portrait **파일**은 별도 `portraits.items` 블록에 대해 폴백 체인으로 고른다.

```text
PortraitInput  = { characterKey?: string; agentType: AgentType; displayedTier: 0 | 1 | 2 | 3 }
PortraitEnv    = { manifest: AssetManifest | null; assetBasePath: string }
PortraitState  = {
  characterKey: string;            // 표시 character (sprite와 동일하게 manifest.characters에서 resolve)
  tier: string | null;             // 최종 적용 portrait tier suffix (base면 null)
  mode: 'asset' | 'placeholder';
  src: string | null;              // mode==='asset'일 때만 실제 파일 경로
  frameAspect: '2:3';
  sourceSize: [number, number];    // 해당 portrait의 source_size (item override 없으면 블록 기본)
  caption: { name: string; role: string };  // slot 하단 표기 (§7)
}
```

**1) character key resolution**(정체성 — `manifest.characters` 기준, SPEC-300 §2.3와 동일): 명시 `characterKey`(`characters`에 존재 시) → `AGENT_TO_CHARACTER[agentType]` → mascot(`orc-high-warchief-mascot`). 결과 key는 그 orc의 sprite가 쓰는 key와 **동일**하다(file 존재 여부와 무관하게 `characters`로 판정).

**2) numeric tier → suffix 매핑**: `displayedTier` k(1..3)는 §7 표에서 그 character의 **k번째 tier suffix**로 매핑한다(예: `orc-high-warchief-mascot`+2 → `champion`). `displayedTier=0` → base(suffix 없음). 이 숫자→suffix 매핑은 **SPEC-304 소관**이며(SPEC-302는 숫자만 제공) §7 per-character 표가 SSOT다.

**3) portrait 파일 폴백 체인**(`portraits.items` 기준; 상위 우선, 첫 가용에서 정지):

1. resolved character의 **resolved-tier** portrait (`items[key].tiers[suffix].file`, k≥1)
2. resolved character의 **base** portrait (`items[key].file`)
3. `AGENT_TO_CHARACTER[agentType]` character의 **base** portrait
4. mascot의 **base** portrait
5. **CSS placeholder**(`mode:'placeholder'`, `src:null`) — silhouette / 기존 emblem object

> **tier 폴백 범위(SPEC-302와 다름, 의도적)**: portrait는 tier 해소를 *재실행하지 않는다*. 체인은 **resolved-tier → base**만 본다(중간 tier를 T3→T2→T1로 내려 걷지 않는다 — 그 sprite-자산 down-walk는 [[SPEC-302-mascot-prestige-tiers]] §3.3이 이미 수행해 `displayedTier`를 확정했다). SPEC-302와 공유되는 보장은 "tier 자산 미가용을 placeholder로 강등하지 않는다"뿐이다. 결과적으로 어떤 tier portrait가 없어 base로 떨어지면 `PortraitState.tier=null`이 되어 SPEC-302의 `displayedTier`와 **다를 수 있다**(sprite는 tier를 보이나 portrait는 base — 의도된 거동).
> **sprite↔portrait 정체성 분기(부분 커버리지)**: character key는 1)에서 `characters` 기준으로 sprite와 동일하게 고르지만, 파일은 `portraits.items` 기준이라 resolved character의 portrait가 **전무**하면 체인 3·4로 **다른 archetype**(agentType character 또는 mascot)의 portrait가 보일 수 있다. 즉 부분 생성 상태에서 portrait가 sprite와 다른 archetype일 수 있음은 **의도된 graceful degradation**이다(§3, AC-16).

### 2.3 Detail 패널 slot 배치 계약

> **레이아웃 전제(중요)**: [[SPEC-201-dashboard-screens]] §2.3a/§3.8(확정·구현, #41~#45)에서 **데스크톱 우측 inspector 컬럼(340px)과 mobile bottom-sheet는 제거**됐다. camp detail은 모든 폭에서 **map(full-width) → 하단 단일 탭 dock(`CampDock`)** 단일 컬럼이며, `OrcInspector`는 그 dock의 **Details 탭** 안에서 단일 세로 stack으로 렌더된다. 따라서 portrait는 **페이지 레벨 우측 컬럼/모바일 시트가 아니라**, Details 탭 콘텐츠(`oc-inspector`) **내부의 2-col 그리드**로 둔다.

- portrait slot은 `OrcInspector`(Details tab, [[SPEC-201-dashboard-screens]] §2.4) **콘텐츠 내부**에 둔다: **넓은 dock**에서는 `metadata 컬럼 | portrait 컬럼`의 2-col 그리드(portrait가 우측), **좁은 dock**에서는 **1-col로 reflow**(portrait가 metadata 위로 stack)한다.
- reflow 분기 기준은 **dock/컨테이너 폭**(container query 또는 dock-width 브레이크포인트)이며, 뷰포트 레벨 분기나 제거된 mobile sheet가 **아니다**.
- portrait box는 항상 **2:3 박스를 예약**한다(asset이든 placeholder든 동일 박스). 1-col↔2-col reflow도 dock 탭 전환과 동일하게 zero layout shift 원칙을 따른다([[SPEC-201-dashboard-screens]] §2.3a-4, §3 AC-08).
- portrait box 아래에 name/role caption을 둔다(`name`/`role`은 §7 per-character 표).
- 장식 frame은 **web UI(CSS)** 가 렌더한다(이미지에 미포함). 가능하면 기존 inspector panel-frame asset 활용.

## 3. Behavior rules

- **결정적**: 동일 `PortraitInput`+manifest ⇒ 동일 `PortraitState`(난수·시계 비의존). 테스트 가능.
- **status 비단언**: portrait는 status를 사실로 표현하지 않는다. status 표시는 기존 `StatusBadge`가 소유하며, 같은 character·tier면 status가 달라도 portrait는 **동일**하다(idle/active/error 등에 따라 바뀌지 않음).
- **정적·reduced-motion no-op**: portrait는 애니메이션이 없다. `prefers-reduced-motion`에서도 동작 변화 없음(추가 정지 처리 불필요).
- **placeholder graceful 강등**: manifest가 `null`이거나 `portraits` 블록이 없거나 key/파일이 없으면 깨진 이미지 대신 `mode:'placeholder'`로 CSS placeholder를 그린다(절대 broken image 아님).
- **zero-layout-shift**: portrait 유무·asset↔placeholder 전환이 패널 layout을 흔들지 않는다(slot이 2:3 박스를 선예약). [[SPEC-300-asset-rendering]]·R-UI-006의 placeholder parity 원칙과 동일.
- **tier 소비만**: 본 spec은 tier를 *고르지 않는다*. [[SPEC-302-mascot-prestige-tiers]]가 준 숫자 `displayedTier`(0~3)를 §2.2-2로 suffix에 매핑해 파일만 고른다. tier 미해결/미도입이면 `displayedTier=0` → base portrait.
- **부분 커버리지 분기(의도)**: character key는 `characters` 기준으로 sprite와 동일하게 정하지만 파일은 `portraits.items` 기준이라, 자산이 부분 생성된 동안 portrait의 archetype이 sprite와 **다를 수 있다**(§2.2 체인 3·4 폴백). 이는 broken image보다 안전한 의도된 강등이다(AC-16).
- **선택 없음 상태**: orc 미선택이면 portrait slot은 렌더하지 않거나(기존 "Select an orc to inspect it." 빈 상태와 동일) 중립 placeholder를 둔다 — 어느 쪽이든 zero-layout-shift를 깨지 않는다(AC-17).

## 4. Acceptance criteria

```text
SPEC-304-AC-01 (R-UI-011, R-P1-004)
  Given manifest에 top-level `portraits` 블록이 있고
  When 그 스키마를 검증하면
  Then `version`·`root`·`frame_aspect:"2:3"`·`source_size`·`items`를 가지며, 각 `items.<key>`는
       `characters`의 key와 일치하고 `file`(+선택적 item `source_size` override, +선택적 `tiers.<suffix>.file`)을 가진다.
  And `PortraitState.sourceSize`는 item에 `source_size`가 있으면 그 값을, 없으면 블록 기본 `source_size`를 반영한다.

SPEC-304-AC-02 (R-UI-011, R-P1-004)
  Given 명시 `characterKey`가 manifest `portraits.items`에 존재할 때
  When resolvePortrait를 호출하면
  Then 그 character의 portrait가 agentType→character 매핑보다 우선해 선택된다(characterKey 정확 일치).

SPEC-304-AC-03 (R-UI-011, R-P1-004)
  Given 명시 characterKey가 없고 agentType이 'codex'이며 해당 base portrait가 있을 때
  When resolvePortrait를 호출하면
  Then `orc-codex-field-engineer` base portrait가 선택된다(AGENT_TO_CHARACTER 매핑).

SPEC-304-AC-04 (R-UI-011, R-UI-006)
  Given resolved character의 portrait도 agentType portrait도 manifest에 없을 때
  When resolvePortrait를 호출하면
  Then mascot(`orc-high-warchief-mascot`) base portrait로 폴백한다(존재 시).

SPEC-304-AC-05 (R-P2-008, R-UI-011)
  Given resolved character가 `orc-high-warchief-mascot`이고 SPEC-302가 `displayedTier=2`를 주며
       그 champion(2번째 tier) portrait가 manifest `portraits`에 있을 때
  When resolvePortrait를 호출하면
  Then §2.2-2 매핑으로 suffix='champion'이 되어 `items[...].tiers.champion.file`이 선택되고 `tier==='champion'`이다.

SPEC-304-AC-06 (R-P2-008, R-UI-011)
  Given resolved character가 `orc-high-warchief-mascot`이고 `displayedTier=2`이지만 그 champion portrait
       파일이 manifest에 없고 base portrait는 있을 때
  When resolvePortrait를 호출하면
  Then 같은 character의 base portrait로 폴백해 `tier===null`이고(중간 tier를 내려 걷지 않음) placeholder로 강등하지 않는다.

SPEC-304-AC-07 (R-UI-006, R-UI-011)
  Given manifest가 null이거나 `portraits` 블록이 없거나 key/파일이 전부 없을 때
  When resolvePortrait를 호출하면
  Then `mode==='placeholder'`·`src===null`을 반환하고 broken image를 만들지 않는다.

SPEC-304-AC-08 (R-UI-006, R-UI-011)
  Given portrait slot이 렌더된 상태에서
  When asset 모드와 placeholder 모드를 토글하면
  Then 패널의 portrait box 치수(2:3)와 주변 metadata 위치가 변하지 않는다(zero-layout-shift).

SPEC-304-AC-09 (R-UI-004, R-UI-011)
  Given Details 탭 콘텐츠(`oc-inspector`)가 렌더된 상태에서
  When dock/컨테이너 폭을 reflow 브레이크포인트 위/아래로 바꾸면
  Then 넓은 dock에서는 `metadata | portrait` 2-col 그리드(portrait 우측), 좁은 dock에서는 1-col(portrait가
       metadata 위로 stack)로 reflow한다 — 페이지 레벨 우측 컬럼이나 mobile bottom-sheet가 아니다(둘 다 SPEC-201 §2.3a/§3.8에서 제거됨).

SPEC-304-AC-10 (R-UI-004, R-UI-011)
  Given orc가 선택된 상태에서
  When portrait slot을 렌더하면
  Then portrait 하단에 §7 표의 display name과 role caption이 표시된다.

SPEC-304-AC-11 (R-UI-011)
  Given 어떤 portrait가 asset 모드로 렌더될 때
  When slot의 box 비율을 측정하면
  Then 2:3(세로)이 유지된다(`frame_aspect`).

SPEC-304-AC-12 (R-UI-011)
  Given 동일한 PortraitInput과 manifest를 두 번 줄 때
  When resolvePortrait를 각각 호출하면
  Then 두 결과 PortraitState가 동일하다(결정적, 난수/시계 비의존).

SPEC-304-AC-13 (R-UI-004, R-UI-011)
  Given 같은 character·tier의 orc에 대해 status만 active/error/idle로 다를 때
  When portrait를 resolve·렌더하면
  Then portrait `src`/외형은 동일하다(status는 portrait가 아니라 StatusBadge로만 표현).

SPEC-304-AC-14 (R-UI-011)
  Given `prefers-reduced-motion: reduce` 환경에서
  When portrait를 렌더하면
  Then 렌더된 DOM에 portrait 관련 animation/transition이 적용되지 않고, 출력(`PortraitState`·표시 프레임)이
       비-reduced-motion 렌더와 동일하다(정적 자산이므로 reduced-motion 분기 자체가 no-op).

SPEC-304-AC-15 (R-UI-011)
  Given 장식 frame 표현을 검증할 때
  When portrait asset과 slot을 확인하면
  Then frame/border는 CSS(또는 panel-frame asset)로 렌더되고 portrait 이미지에는 baked frame이 없다
       (이미지 측 검증은 [[17-Character-Avatar-Portraits]] §7 품질 검수가 보장).

SPEC-304-AC-16 (R-UI-006, R-UI-011)
  Given resolved character key가 sprite와 동일하게 정해졌으나 그 character의 portrait(tier·base)가
       manifest `portraits`에 전무하고, agentType character 또는 mascot의 base portrait는 있을 때
  When resolvePortrait를 호출하면
  Then 파일은 §2.2 체인 3·4로 그 다른 archetype portrait를 선택하며(`mode:'asset'`), 이 sprite↔portrait
       archetype 분기는 부분 커버리지에서 허용된 거동이다(broken image·placeholder로 떨어지지 않음).

SPEC-304-AC-17 (R-UI-004, R-UI-011)
  Given orc가 선택되지 않은 상태에서
  When Details 탭을 렌더하면
  Then portrait slot은 렌더되지 않거나 중립 placeholder로 표시되며, 어느 경우든 패널 layout이 선택 상태
       대비 흔들리지 않는다(기존 "Select an orc to inspect it." 빈 상태 유지).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-011 (proposed) | inspector Details 탭 내 BG식 2:3 흉상 portrait slot·결정적 resolve·정적·비-load-bearing·CSS frame·dock-폭 reflow | SPEC-304-AC-01~17 |
| R-UI-004 | inspector 보강(character 식별 portrait·caption·status 분리·dock-폭 reflow·no-selection) | SPEC-304-AC-09, AC-10, AC-13, AC-17 |
| R-P1-004 | agent별 character variant 자산(`portraits`)의 런타임 소비·resolve | SPEC-304-AC-01, AC-02, AC-03 |
| R-P2-008 (proposed) | resolved 숫자 `displayedTier`→suffix 매핑·tier portrait 선택·base 폴백(SPEC-302 결과 소비) | SPEC-304-AC-05, AC-06 |
| R-UI-006 | 자산 미가용 시 placeholder parity·zero-layout-shift·부분 커버리지 graceful 분기 | SPEC-304-AC-04, AC-07, AC-08, AC-16 |

> orphan 진술 점검: 본 spec의 모든 §2/§3 규칙은 위 AC 중 하나 이상이 검증한다. tier 임계·생성·license는 의도적 out-of-scope(각 소유 spec/doc가 검증).

## 6. Open Questions / Conflicts

- **proposed 상태**: `R-UI-011`·`D-038`은 proposed(미승인)다. 승인 전까지 본 spec은 `draft`이며 P0 추적 대상이 아니다(forward, [[SPEC-302-mascot-prestige-tiers]]/[[SPEC-303-epic-monster-npc]]와 동일 posture).
- **흉상 생성 경로 — 확정(2026-06-30)**: PixelLab `create_map_object`(view=side) probe로 실현가능성을 먼저 확인한 뒤, **owner가 외부 image-gen으로 고품질 pixel 흉상 20종(5 base + 15 tier)을 직접 제작·제공**해 이를 채택했다(초기 PixelLab probe 산출물은 대체·폐기). 본 런타임 계약은 생성 경로와 무관(파일만 소비)하므로 변경 없음. 생성 기록·SHA-256·매핑은 [[13-PixelLab-Asset-Registry]] item 12.
- **Delivered 20종의 LOCKED 계약 대비 편차(2026-06-30, 의도적·수용)**: (a) **배경**: 투명이 아니라 **baked dark 배경** — Baldur's Gate 풍 framed 초상과 정합하며 CSS frame이 그 위를 감싼다(장식 *frame*은 여전히 미-baked). (b) **source 크기/비율**: 512×768(2:3)이 아니라 **512×512(1:1)**; 2:3 slot이 `object-fit: cover`로 좌우를 약간 crop(머리·세로 full). §1/§2.1의 "transparent·512×768"은 *권장 기본*으로 해석하고, 실측은 manifest `source_size`(=[512,512]) + `frame_aspect`(=2:3)가 SSOT다. 두 편차 모두 CSS 2:3 slot이 흡수하므로 §2~§4 계약/AC는 유효하다.
- **Tier 소비 — 개선·배선 완료(2026-06-30)**: 5×3 tier portrait **전부 delivered·manifest 반영**(owner 직접 제작 → IP 리뷰 충족, 종전 high-tier blocking 해소). orc의 prestige tier 상승 시 해당 tier portrait가 표시되도록 런타임 seam을 배선했다 — `web/src/assets/prestige.ts`의 `displayedTierForOrc(orc)`가 tier를 산출(현재 `Orc.usage` 미수집으로 0=base; **SPEC-302 forward**)하고 `OrcInspector`가 이를 `resolvePortrait`에 전달한다. resolver는 displayedTier→suffix→tier portrait를 이미 매핑(§2.2)하므로 usage 데이터가 들어오면 **추가 코드 변경 없이** tier portrait가 자동 표시된다. 검증: `web/tests/portraitManifest.test.ts`(displayedTier 1/2/3 → 각 character tier 파일), `web/tests/prestige.test.ts`.
- **SPEC-201 패널 레이아웃**: [[SPEC-201-dashboard-screens]] §2.3a/§3.8(확정·구현)은 의도적으로 **단일 full-width 탭 dock**으로 전환했다 — 데스크톱 우측 inspector 컬럼(340px)과 mobile bottom-sheet는 **제거**됐고 `OrcInspector`는 Details 탭 안 단일 세로 stack이다. 따라서 본 spec은 제거된 우측 컬럼을 되살리는 게 **아니라**, Details 탭 콘텐츠(`oc-inspector`) **내부**에 portrait slot(dock-폭 기반 2-col↔1-col reflow, §2.3)을 추가한다. 구현 시 `OrcInspector.tsx`·`global.css`에 container-width 그리드 reflow를 더하고, SPEC-201 §2.4(OrcInspector) 계약에 portrait slot을 보강한다.
- **placeholder 자산**: placeholder를 순수 CSS(silhouette)로 할지 기존 emblem object([[13-PixelLab-Asset-Registry]] brand candidate)를 재사용할지는 구현 재량 — 어느 쪽도 zero-layout-shift(AC-08)를 깨면 안 된다.
- **`source_size` 단위**: 외부 gen 결과가 character마다 다른 크기면 item별 `source_size` override로 기록(§2.1). 비정수 배율은 CSS slot이 2:3로 흡수.

## 7. Per-character avatar 계약 (5 base — "각 캐릭터 별 spec")

각 character의 런타임 portrait 계약 요약이다. tier 외형 delta·prompt는 [[17-Character-Avatar-Portraits]] §3/§4, tier resolution은 [[SPEC-302-mascot-prestige-tiers]] 소유. 모든 base 파일은 `portraits/<key>.webp`, tier는 `portraits/tiers/<suffix>/<key>-<suffix>.webp`.

| characterKey | display name (caption) | role (caption) | signature accent | 표정/무드 | bust framing anchor | tier suffix (T1/T2/T3) |
| --- | --- | --- | --- | --- | --- | --- |
| `orc-high-warchief-mascot` | Orc High Warchief | 주인공 mascot · camp leader | `ember` `#D6723F` | fierce battle-shout, 단호한 leader | 높은 상투+갈기, 큰 ivory 엄니, 비대칭 spiked iron 견갑 | veteran / champion / warlord |
| `orc-claude-storm-shaman` | Orc Storm Shaman | Claude agent (claude-code) | `mana` `#4AA3DF` (storm arc) | 차분·관찰하는 advisor | weathered moss cloak hood·어깨, teal storm rune 광 | adept / tempest / archon |
| `orc-codex-field-engineer` | Orc Field Engineer | Codex agent (codex) | `mana` `#4AA3DF` (circuit) | 집중한 실무 장인 | leather apron+charcoal bracer, 어깨 teal tech glow | senior / artificer / forgewright |
| `orc-unknown` | Unknown Orc | agent type 미확정 | muted `moss`/`bone` + 미약한 teal glint | neutral·모호 | simple leather vest, 작은 mysterious charm | seasoned / veteran / elder |
| `orc-iron-commander` | Orc Iron Commander | control/interrupt 상징 | `danger` `#C94C4C` + iron(`charcoal`) | 단호한 stern command | 뿔 투구(horned helm), blackened iron 견갑, 붉은 망토 깃 | enforcer / marshal / sovereign |

> caption role은 식별 보조 표기이며 status를 단언하지 않는다(AC-13). caption은 **표시된 character**(resolved characterKey)를 설명하는 것이지 그 orc의 *탐지된 `agentType`*을 단언하지 않는다 — sequential pool 배정 시 표시 character가 agentType과 다를 수 있으므로(예: `codex` orc에 `orc-iron-commander` skin), agentType·status는 metadata·StatusBadge가 소유한다. `orc-iron-commander`의 control 상징 역할은 prestige tier와 무관한 별개 축이다([[SPEC-400-control-actions]], [[08-Decisions|D-036]]).

## 관련 문서

- [[17-Character-Avatar-Portraits]] — 흉상 framing 계약·character별 prompt·tier delta·생성 runbook·manifest `portraits` 스키마(자산 SSOT)
- [[SPEC-300-asset-rendering]] — character precedence·placeholder parity·결정적 resolve 원칙
- [[SPEC-302-mascot-prestige-tiers]] — prestige tier 임계·latch·resolution(본 spec이 결과 소비)
- [[SPEC-201-dashboard-screens]] §2.4 — OrcInspector(Details) 패널(우측 portrait slot 신설 대상)
- [[12-PixelLab-Prompts]]·[[13-PixelLab-Asset-Registry]] — house style·palette·생성 추적
- [[08-Decisions|D-038]] — avatar portrait asset class·CSS frame·생성 경로 결정 / [[08-Decisions|D-009]] license 게이트
