---
spec: SPEC-202
title: 디자인 시스템 적용·접근성 계약
status: draft
updated: 2026-07-02
requirements: [R-UI-006, R-UI-005, R-UI-007, R-ORC-005, R-ORC-006, R-UI-012]
decisions: [D-045, D-046]
tags:
  - specs
  - design
  - accessibility
  - epic-3
---

# SPEC-202 — 디자인 시스템 적용·접근성 계약

이 spec은 [[DESIGN]](디자인 시스템 계약)을 **테스트 가능한 애플리케이션 규칙**으로 변환한다. DESIGN.md는 토큰·원칙의 **단일 진실 공급원(SSOT)**이며, 이 문서는 그 토큰이 *어떻게 소비되는지*(CSS 변수/픽셀 토큰 계약), 상태가 *색상에 의존하지 않고* 어떻게 전달되는지, 키보드·reduced-motion·대비·placeholder parity가 *어떤 검증 가능한 기준*을 만족해야 하는지를 고정한다. **토큰 값(hex/px 등)은 여기서 복제하지 않는다** — [[DESIGN]]을 참조하고, 이 문서는 *적용 규칙과 수용 기준*만 정한다.

이 계약은 [[SPEC-201-dashboard-screens]]의 모든 화면, [[SPEC-300-asset-rendering]]의 sprite 렌더, [[SPEC-400-control-actions]]의 control UI에 **횡단(cross-cutting)으로 적용**된다.

## 1. Scope

### In scope (이 spec이 OWN)

- **DESIGN.md 토큰 적용 계약**: color/typography/spacing/layout/component/motion/voice 토큰을 앱이 소비하는 인터페이스(CSS custom property 이름·역할·픽셀 토큰)와 적용 규칙. 값은 [[DESIGN]]이 권위.
- **비색상 status encoding 계약**: 7-status 모델(`active`/`waiting`/`idle`/`stale`/`error`/`unknown`/`terminated`, [[SPEC-005-data-contract]] `OrcStatus`)의 각 상태를 **icon + label + (animation/shape)**로 전달하는 redundant-encoding 계약. status effect overlay 매핑 포함.
- **키보드 내비게이션 계약**: camp list → detail → inspector → control entry의 full keyboard reachability, focus order, `focus-visible`, Escape/close 의미, modal focus trap.
- **reduced-motion 계약**: `prefers-reduced-motion: reduce`를 모든 애니메이션(sprite 포함)에서 존중. sprite fallback frame은 [[SPEC-300-asset-rendering]]의 fallback과 manifest `reduced_motion.fallback_frame`을 따른다.
- **대비·타깃 크기 계약**: text/status에 대한 WCAG 계열 대비 목표, 최소 타깃 크기. DESIGN.md가 수치를 고정하지 않은 항목은 **가설**로 표기.
- **placeholder parity (R-UI-006)**: asset 부재 시에도 동일 layout/interaction/accessibility가 유지된다. CSS placeholder를 manifest `frame_size`에 고정.
- **anti-pattern 적용 게이트**: [[DESIGN]] Anti-patterns가 화면에 **나타나면 안 되는 것**의 테스트 가능한 검증(첫 화면 marketing 금지, 색상 단독 status 금지 등).

### Out of scope (참조)

- 화면별 콘텐츠·레이아웃·정보 구조 → [[SPEC-201-dashboard-screens]] (이 spec은 거기에 적용되는 *규칙*만 정의).
- sprite 애니메이션 상태머신·frame 소비 메커니즘 → [[SPEC-300-asset-rendering]] (이 spec은 reduced-motion *honoring 규칙*만 정의).
- 앱 아키텍처·라우팅·상태 관리 → [[SPEC-200-frontend-architecture]].
- 토큰의 **값** (color hex, font family, px 수치) → [[DESIGN]] (SSOT, 복제 금지).
- control action의 안전장치·audit·재검증 → [[SPEC-400-control-actions]] (이 spec은 destructive UI의 *비장식화 게이트*만 정의).

## 2. Contract

### 2.1 DESIGN.md 토큰 소비 인터페이스 (CSS custom property)

앱은 [[DESIGN]] 토큰을 아래 **고정된 CSS 변수 이름**으로 노출한다. 변수 *이름·역할*은 이 spec이 권위이고, *값*은 [[DESIGN]]이 권위다(asset pack/theme 교체 시 값만 바뀌고 이름은 불변). 컴포넌트는 raw hex/px literal을 쓰지 않고 반드시 이 변수를 참조한다.

#### Color (값 = [[DESIGN]] Color)

| 의미 역할 | CSS 변수 | DESIGN.md 토큰 (값 SSOT) |
| --- | --- | --- |
| surface / base 배경 | `--oc-color-surface-base` | `ink` |
| surface / raised panel·toolbar | `--oc-color-surface-raised` | `charcoal` |
| primary action (campfire accent) | `--oc-color-primary` | `ember` |
| accent / selected / active agent | `--oc-color-accent` | `mana` |
| success / terrain | `--oc-color-success` | `moss` |
| text primary (on dark) | `--oc-color-text` | `parchment` |
| text secondary / muted | `--oc-color-text-muted` | `bone` |
| status danger / interrupt | `--oc-color-danger` | `danger` |
| status warning / waiting | `--oc-color-warning` | `warning` |
| border / divider | `--oc-color-border` | **가정**: [[DESIGN]] 미정. placeholder `<border-color>` (가설: `bone` @ 24% α 또는 `charcoal` +12% L). [[08-Decisions]] 확정 필요 |
| terminal mode indicator (관전/조종) border-**style** | `--oc-border-style-observe` / `--oc-border-style-control` | **가정(2026-07-02)**: terminal 모드 Observe/Control 구분을 **색이 아닌** border-style/굵기로 표현하는 토큰(예: Observe=`1px solid`, Control=`2px double` 또는 dashed). 색-비의존 요건([[SPEC-203-terminal-workspace]] mode indicator, §2.2)을 만족. 값은 [[DESIGN]]/[[08-Decisions]] 확정 필요. **검토 필요.** |

- status 색은 위 토큰의 **보조 채널**일 뿐이다. status→색 매핑(§2.3)은 §2.2의 icon/label/shape 위에 *덧붙는* 것이며 단독 신호가 아니다.
- purple/blue gradient 중심 SaaS surface 금지([[DESIGN]] Anti-patterns) — §2.8 게이트.

#### Spacing / radius / elevation (값 = [[DESIGN]] Spacing)

| 토큰 | CSS 변수 | 값(SSOT [[DESIGN]]) |
| --- | --- | --- |
| base unit | `--oc-space-1` | `4px` |
| panel 내부 | `--oc-space-2` | `8px` |
| (중간) | `--oc-space-3` | **가정** `12px` (DESIGN.md 미명시, scale 보간) |
| major section | `--oc-space-4` | `16px` |
| card radius | `--oc-radius-card` | ≤ `8px` |
| pixel panel radius | `--oc-radius-pixel` | `0px` 또는 `4px` |
| elevation | `--oc-elevation-*` | **가정**: pixel/flat 미감 → drop shadow 미사용. raised 표면은 `--oc-color-surface-raised` + `1px --oc-color-border`로 표현. [[08-Decisions]] 확정 후보 |

- density 원칙: toolbar/dense control은 `--oc-space-1`, panel 내부는 `--oc-space-2`, section 간격은 `--oc-space-4`를 기본으로 한다(운영 도구 밀도, [[DESIGN]] Spacing).

#### Typography (값 = [[DESIGN]] Typography)

| 역할 | CSS 변수 | 값(SSOT [[DESIGN]]) |
| --- | --- | --- |
| UI 본문 | `--oc-font-ui` | system sans-serif |
| terminal preview / code identifier | `--oc-font-mono` | monospace |
| logo / camp title / small badge 한정 | `--oc-font-pixel` | pixel font |

- `letter-spacing`은 전역 `0`([[DESIGN]] Typography).
- type scale는 compact. hero-scale type 금지. **가설**: heading 최대 `24px`, body `13–14px`, label/badge `11–12px`(DESIGN.md가 수치 미고정 → PoC 검증 후 [[08-Decisions]] 확정). 화면 적용은 [[SPEC-201-dashboard-screens]].

### 2.2 비색상 status encoding 계약 (핵심)

모든 orc status는 **색상과 무관하게** 식별 가능해야 한다. 각 status는 아래 세 채널의 **redundant encoding**으로 전달한다: (a) **label**(영문 plain text), (b) **icon/overlay**(고유 shape — manifest `objects.status-ui` 또는 CSS glyph fallback), (c) **shape 채널**(badge chip border-style + sprite motion/pose). 색은 (a)~(c)에 덧붙는 보조일 뿐, 단독 신호가 될 수 없다.

| `OrcStatus` | label (영문, [[DESIGN]] Voice) | overlay icon (manifest `status-ui` key) | badge chip shape (border-style) | sprite motion (manifest `animations`) | reduced-motion 정적 표현 |
| --- | --- | --- | --- | --- | --- |
| `active` | `Active` | `active-spark` | solid | `active` working loop (fps 8) | `reduced_motion.fallback_frame` |
| `waiting` | `Waiting` | `waiting-bubble` | solid + bubble glyph | `waiting` idle bounce/bubble | 정적 waiting frame |
| `idle` | `Idle` | `idle-glow` | solid (muted) | `idle` breathing | 정적 idle frame |
| `stale` | `Stale` | `stale-clock` | **dashed** | `stale` (frozen/dimmed, 본질적으로 정지) | 정적(이미 정지) + dim |
| `error` | `Error` | `error-burst` | **double**/heavy | `error` short shake/alert | 정적 alert frame(shake 제거) |
| `unknown` | `Unknown` | `unknown-charm` (`?` ghost) | **dotted** | `idle`/ghost placeholder pose | 정적 ghost frame |
| `terminated` | `Terminated` | `terminated-ghost` | dotted + strikethrough | `terminated` fade-out → hold | 정적 faded frame |

규칙:
- **R1 (icon 필수)**: status를 표시하는 모든 위치(camp card 집계, orc 행, inspector, sprite overlay)는 위 icon shape를 렌더한다. asset 미탑재 시 동등 의미의 CSS glyph fallback(예: `active`=spark/●, `waiting`=💬형 bubble, `error`=▲, `stale`=◷ clock, `unknown`=?, `terminated`=⊗)을 사용한다. fallback도 grayscale 구분 가능해야 한다.
- **R2 (label 필수)**: icon-only 표시 금지. 모든 status는 plain text label을 동반한다(축약 list view에서도 label 또는 `aria-label`로 노출). label 문구는 [[DESIGN]] Voice를 따른다(짧고 기능적, 농담 금지).
- **R3 (shape 채널)**: badge chip은 위 border-style을 status별로 다르게 적용해, 색 없이 chip만으로도 status군이 구분되게 한다(특히 dense list/CLI 정렬 출력 정합 — [[SPEC-005-data-contract]] §2.8 컬럼 계약과 의미 일치).
- **R4 (overlay 위치)**: status effect overlay는 sprite를 가리되 **status label text를 가리지 않는다**([[03-UX-UI]] Pixel Art 적용). overlay size는 manifest `objects.status-ui.size`(64×64) 기준, sprite anchor 기준 배치는 [[SPEC-300-asset-rendering]] 소관.
- **R5 (확정성 표시, R-ORC-005)**: status는 **항상 `statusConfidence`와 함께** 표시하고, 자동 추정값(`summaryIsEstimated=true`)은 estimated marker를 붙인다. `unknown`/낮은 confidence에 단정적 label 금지([[DESIGN]] Anti-patterns). confidence는 색이 아닌 텍스트/glyph(예: `~0.55`, `est.`)로도 전달한다.

### 2.3 Status Badge 컴포넌트 계약

- **구성(불변)**: `[icon][label][confidence/estimated affix]`. 세 요소 중 icon+label은 항상 렌더, confidence affix는 status가 추정일 때 필수(R-ORC-005).
- 색(§2.1 status 토큰)은 보조. 색을 제거(grayscale)해도 icon shape + label + chip border-style로 7종이 구분되어야 한다(§4 AC-03).
- variants: `inline`(orc 행/CLI 정합), `chip`(camp card 집계 count), `overlay`(sprite 위 effect). states: `default` / `selected`(accent border) / `dimmed`(stale/terminated). 화면 배치는 [[SPEC-201-dashboard-screens]].

### 2.4 키보드 내비게이션·focus 계약

엔트리 체인은 **camp list → camp detail → orc inspector → control entry**다. 전 구간이 키보드만으로 도달·조작 가능해야 한다([[02-Requirements]] 비기능 접근성).

- **K1 (focus order)**: DOM/탭 순서는 시각 순서와 일치한다. 권장 순서: (전역) skip-to-content → primary nav/refresh → (Camp List) camp grid → (선택 시) Camp Detail region → orc layer → Orc Inspector(메타데이터 → terminal preview → command dock input → send → interrupt).
- **K2 (roving tabindex)**: camp grid와 orc sprite layer 같은 동질 항목 집합은 single tab stop + Arrow key 이동(roving tabindex). `Enter`/`Space`로 활성화(camp 열기 / orc 선택).
  - **NOTE (scene/map granularity, [[SPEC-301-camp-map-movement]])**: camp scene/map의 orc layer는 **zone(window)당 하나의 roving-tabindex 그룹**으로 구성한다(zone당 single tab stop; `Tab`/`Shift+Tab`=zone 간, Arrow=zone 내 orc 간, `Enter`/`Space`=선택). 이는 K2의 granularity 구체화이며, 전 orc 도달성(SPEC-202-AC-07)·focus order(K1)는 그대로 보존된다.
- **K3 (focus-visible)**: 모든 interactive 요소는 키보드 포커스 시 가시 focus ring을 렌더한다(`:focus-visible`). focus outline을 제거(`outline:none` 단독)하면 안 된다. focus ring은 색뿐 아니라 형태(2px ring/offset)로도 구분되어야 한다(대비 §2.6).
- **K4 (Escape/close 의미)**: modal/bottom-sheet/overlay는 `Escape`로 닫히고, **포커스를 트리거 요소로 반환**한다. Camp Detail에서 `Escape`는 orc 선택 해제 → (재차) camp list 복귀의 단계적 의미를 가진다(구체 단계는 [[SPEC-201-dashboard-screens]]와 정합).
- **K5 (modal focus trap)**: interrupt confirm modal([[SPEC-400-control-actions]])은 열릴 때 포커스를 modal 내부로 가두고, 초기 포커스는 **안전한 기본값(Cancel)**에 둔다. destructive 확정 버튼이 자동 포커스 받지 않는다.
- **K6 (icon button 접근명)**: 모든 icon-only button은 `aria-label`/accessible name + tooltip을 갖는다([[03-UX-UI]] 접근성). send/interrupt/attach/copy/refresh/settings 포함.
- **K7 (forward)**: quick-switch·command palette(R-P1-009)는 이 focus order를 **키보드 backbone으로 보존**한다(추가 shortcut이 K1~K5를 깨지 않는다). P1 범위지만 본 계약이 forward 제약을 명시한다.

### 2.5 Reduced-motion 계약

`prefers-reduced-motion: reduce`가 활성일 때:

- **M1 (sprite)**: 모든 sprite 애니메이션을 정지하고, 각 캐릭터의 manifest `reduced_motion.fallback_frame`(예: `animations/idle.../south/frame_000.png`)을 정적 표시한다. fallback frame/state/direction은 manifest가 권위이며, 렌더 메커니즘은 [[SPEC-300-asset-rendering]] 소관(이 spec은 *media query honoring*과 *fallback이 manifest 선언값과 일치할 것*을 요구).
- **M2 (UI 모션)**: campfire loading/idle bounce/shake/fade 등 장식 모션과 비필수 CSS transition을 비활성화하거나 instant로 만든다. 정보 전달용 상태 변화는 모션 없이 icon/label 교체로 전달한다.
- **M3 (no layout shift)**: data refresh(scan/WebSocket event)로 UI가 튀거나 scroll position이 바뀌지 않는다([[DESIGN]] Motion). sprite/badge 상태 변화도 layout shift를 만들지 않는다(고정 aspect ratio, §2.7).
- **M4 (autoplay 금지)**: reduced-motion에서 무한 loop autoplay를 시작하지 않는다.

### 2.6 대비·타깃 크기 계약 (목표값은 가설)

DESIGN.md가 정확한 대비/크기 수치를 고정하지 않으므로 아래는 **WCAG 계열 가설**이며 PoC/디자인 QA로 검증 후 [[08-Decisions]]에 확정한다.

- **C1 (text 대비, 가설)**: 본문 text는 배경 대비 **≥ 4.5:1**, large text(≥ 18.66px bold 또는 ≥ 24px)는 **≥ 3:1**(WCAG AA). `parchment`/`bone` on `ink`/`charcoal` 조합은 측정으로 확인한다([[03-UX-UI]] color contrast AA 목표).
- **C2 (non-text/status 대비, 가설)**: status icon·badge border·focus ring 등 의미 전달 graphical 요소는 인접 색 대비 **≥ 3:1**(WCAG 1.4.11). 단, 색 대비 미달이어도 §2.2의 icon+label로 식별 가능해야 한다(색은 보조).
- **C3 (최소 타깃 크기, 가설)**: interactive 타깃은 **≥ 24×24 CSS px**(WCAG 2.2 AA), destructive/primary(send/interrupt)는 **≥ 44×44 CSS px**(가설). dense toolbar에서도 hit area는 시각 크기와 별개로 최소치를 만족한다.
- **C4 (terminal preview)**: terminal preview text는 selection·copy 가능해야 한다([[03-UX-UI]] 접근성). monospace(`--oc-font-mono`) + 대비 C1 충족.

### 2.7 Placeholder parity 계약 (R-UI-006)

- **P1 (동등성)**: PixelLab asset이 런타임에 미탑재/누락이어도 **동일한 layout·interaction·accessibility**가 동작한다. camp scene, orc 선택, inspector, status 구분(§2.2), 키보드(§2.4), reduced-motion(§2.5)이 placeholder에서도 모두 성립한다.
- **P2 (크기 고정)**: placeholder는 CSS pixel placeholder로 렌더하되 box size를 manifest `frame_size`(예: `[232,232]`)에 **고정**한다. asset 유무로 layout shift가 발생하지 않는다([[DESIGN]] Asset Rules, [[03-UX-UI]]).
- **P3 (status 유지)**: placeholder sprite도 §2.2 overlay icon/label/shape로 status를 구분 표시한다(asset 없는 상태에서 grayscale 구분 가능, §4 AC-16).
- **P4 (agent type)**: placeholder는 agent type(`claude-code`/`codex`/`unknown`)을 색이 아닌 label/형태로 구분한다([[SPEC-300-asset-rendering]] fallback과 정합).

### 2.8 Anti-pattern 적용 게이트 (테스트 가능한 "나타나면 안 됨")

[[DESIGN]] Anti-patterns를 화면 검증 가능한 규칙으로 고정한다. 각 항목은 §4 AC로 검증한다.

- **A1**: 첫 화면(root route)은 operational camp list/summary다. marketing landing page·hero를 첫 화면으로 렌더하지 않는다.
- **A2**: status를 **색상만으로** 구분하지 않는다(§2.2 강제).
- **A3**: card 안에 card를 중첩하지 않는다. repeated item에만 card를 사용하고 page section은 full-width band/unframed로 둔다.
- **A4**: hero-scale type 금지(§2.1 heading 상한). `letter-spacing` ≠ 0 금지.
- **A5**: purple/blue gradient 중심 SaaS surface 금지(§2.1 토큰만 사용).
- **A6**: destructive action(interrupt/send-key)을 장식적 버튼으로 숨기지 않는다 — 명시 label + 명확한 대상/결과 + confirm([[SPEC-400-control-actions]]).
- **A7**: 도트 콘셉트를 이유로 실제 상태/control/raw tmux target을 숨기지 않는다(R-UI-007). raw `tmuxTarget`은 항상 확인 가능해야 한다.

## 3. Behavior rules

결정 가능한 규칙. 임계값은 "확정" vs "가설"을 구분한다.

- **B1 (토큰 강제, 확정)**: 컴포넌트 스타일은 §2.1 CSS 변수를 통해서만 색/간격/폰트를 참조한다. raw hex/px literal 발견은 spec 위반(lint 게이트 권장).
- **B2 (grayscale 식별, 확정)**: 디스플레이를 grayscale(채도 0)로 강제해도 7종 status가 icon+label(+chip border-style)로 구분된다. 이는 색맹/단색 환경 대리 검증이다.
- **B3 (status는 confidence 동반, 확정 — R-ORC-005)**: status 표시 위치 어디서도 `statusConfidence` 없이 status를 단정 표시하지 않는다. 추정 summary는 estimated marker 필수.
- **B4 (focus 가시성, 확정)**: 키보드 인터랙션 시 활성 요소는 항상 가시 focus 표시를 갖는다. 마우스 인터랙션에서는 `:focus-visible` 정책에 따라 생략 가능.
- **B5 (reduced-motion 우선, 확정)**: `prefers-reduced-motion: reduce`가 모든 모션 결정에 우선한다. 충돌 시 정지/instant가 이긴다.
- **B6 (no layout shift, 확정)**: 상태/asset/refresh 변화는 reflow로 인접 요소 위치를 바꾸지 않는다(고정 box, §2.7 P2).
- **B7 (대비/크기 목표, 가설)**: §2.6 수치는 PoC/디자인 QA로 측정·검증 후 [[08-Decisions]] 확정. 측정 절차는 [[SPEC-007-test-validation]] 패턴(자동 대비 검사 + 수동 키보드 walkthrough)을 준용한다.
- **B8 (placeholder 동등, 확정 — R-UI-006)**: asset 부재가 layout/interaction/accessibility 회귀를 만들지 않는다. asset 토글은 AC-16/AC-17의 통과 여부를 바꾸지 않는다.

## 4. Acceptance criteria

각 기준은 통과/실패를 객관적으로 판정 가능해야 한다. 출처 `R-*`/비기능을 괄호로 표기한다.

- **SPEC-202-AC-01** (비기능: 디자인 일관성, [[DESIGN]])
  Given 빌드된 dashboard 스타일 번들에서
  When 컴포넌트 색/간격/폰트 선언을 검사하면
  Then 색·spacing·font는 §2.1 `--oc-color-*`/`--oc-space-*`/`--oc-font-*` 변수로만 참조되고, raw hex/px color literal이 0건이다(`--oc-radius-*`/`--oc-space-1=4px` 정의부 제외).

- **SPEC-202-AC-02** (비기능: 디자인 일관성, A5)
  Given dashboard의 surface 배경에서
  When 렌더된 배경을 검사하면
  Then primary surface는 `--oc-color-surface-base`/`--oc-color-surface-raised`이고, purple/blue 중심 gradient surface가 사용되지 않는다.

- **SPEC-202-AC-03** (비기능: 접근성 비색상, R-UI-005, [[DESIGN]] Anti-patterns)
  Given 디스플레이를 grayscale(채도 0)로 강제한 상태에서
  When 7종 `OrcStatus`(`active`/`waiting`/`idle`/`stale`/`error`/`unknown`/`terminated`)를 각각 렌더하면
  Then 각 status는 색 없이도 §2.2의 icon shape + label로 상호 구분 가능하고, 동일하게 보이는 두 status가 없다.

- **SPEC-202-AC-04** (비기능: 접근성 비색상, R-UI-005)
  Given 임의의 status badge를
  When 렌더하면
  Then icon과 plain text label이 항상 동시에 존재한다(icon-only 표시 0건). icon-only 축약 변형에서도 동일 label이 `aria-label`로 노출된다.

- **SPEC-202-AC-05** (R-ORC-005)
  Given 자동 추론된 status를 가진 orc를
  When status badge/inspector에 렌더하면
  Then `statusConfidence` 값(또는 confidence tier)이 함께 표시되고, `summaryIsEstimated=true`인 summary에는 estimated marker가 텍스트/glyph로 표시된다(색 단독 아님).

- **SPEC-202-AC-06** (R-UI-005, [[SPEC-300-asset-rendering]])
  Given asset pack이 탑재된 상태에서
  When 각 status overlay를 렌더하면
  Then overlay는 manifest `objects.status-ui`의 status별 key(`active-spark`/`waiting-bubble`/`idle-glow`/`stale-clock`/`error-burst`/`unknown-charm`/`terminated-ghost`)와 매핑되고, overlay가 status label text를 가리지 않는다.

- **SPEC-202-AC-07** (비기능: 접근성 키보드, R-UI-004, R-UI-007)
  Given 마우스 없이 키보드만 사용하는 사용자가
  When `Tab`/Arrow/`Enter`로 이동하면
  Then camp list → camp detail → orc inspector → command dock(input → send → interrupt) 순서로 모든 control에 도달·활성화할 수 있고(K1~K2), 어떤 control도 키보드로 도달 불가능하지 않다.

- **SPEC-202-AC-08** (비기능: 접근성 키보드)
  Given 임의의 interactive 요소가 키보드 포커스를 받을 때
  When focus 상태를 검사하면
  Then 가시 focus 표시(2px ring/offset 형태 포함)가 렌더되고, `outline:none`이 대체 가시 표시 없이 단독 적용된 요소가 0건이다(K3).

- **SPEC-202-AC-09** (비기능: 접근성 키보드, [[SPEC-400-control-actions]])
  Given interrupt confirm modal이 열린 상태에서
  When `Escape`를 누르거나 modal을 닫으면
  Then 포커스가 modal 내부에 trap되어 있다가(K5) 초기 포커스는 Cancel(안전 기본값)에 있었고, 닫힐 때 포커스가 interrupt 트리거 요소로 반환된다(K4).

- **SPEC-202-AC-10** (비기능: 접근성, [[03-UX-UI]] 접근성)
  Given 모든 icon-only button(send/interrupt/attach/copy/refresh/settings 등)을
  When 접근성 트리에서 검사하면
  Then 각 button은 비어있지 않은 accessible name(`aria-label`)과 tooltip을 갖는다(K6).

- **SPEC-202-AC-11** (비기능: 접근성 모션, [[DESIGN]] Motion, [[SPEC-300-asset-rendering]])
  Given OS/브라우저에서 `prefers-reduced-motion: reduce`가 설정된 상태에서
  When dashboard를 렌더하면
  Then sprite는 각 캐릭터 manifest `reduced_motion.fallback_frame`의 정적 frame으로 표시되고(M1), campfire loading/shake/bounce/fade 등 장식 모션과 autoplay loop가 비활성화된다(M2, M4).

- **SPEC-202-AC-12** (비기능: 신뢰성/UX, [[DESIGN]] Motion)
  Given dashboard가 표시 중인 상태에서
  When scan/WebSocket data refresh로 status·count·sprite가 변경되면
  Then scroll position이 유지되고, 인접 요소의 layout shift(CLS 유발 reflow)가 발생하지 않는다(M3, B6).

- **SPEC-202-AC-13** (비기능: 접근성 대비, 가설 — [[03-UX-UI]] AA 목표)
  Given dashboard의 text/배경 조합을
  When 대비를 측정하면
  Then 본문 text ≥ 4.5:1, large text ≥ 3:1을 만족한다(C1). 임계값은 가설이며 미달 조합은 [[08-Decisions]]에 색 조정으로 기록한다.

- **SPEC-202-AC-14** (비기능: 접근성 대비/크기, 가설)
  Given status icon·badge border·focus ring 및 interactive 타깃을
  When 측정하면
  Then 의미 전달 graphical 요소는 인접 대비 ≥ 3:1(C2), interactive 타깃 hit area ≥ 24×24 CSS px(destructive/primary ≥ 44×44, C3)을 만족한다. 임계값은 가설.

- **SPEC-202-AC-15** (비기능: 접근성, [[03-UX-UI]] 접근성)
  Given terminal preview가 표시된 상태에서
  When 사용자가 preview text를 드래그/복사하면
  Then text selection과 clipboard copy가 동작하고, monospace(`--oc-font-mono`)로 렌더된다(C4).

- **SPEC-202-AC-16** (R-UI-006)
  Given asset pack이 미탑재/누락인 상태에서
  When camp scene·orc 선택·inspector·status 구분·키보드·reduced-motion을 수행하면
  Then 모든 동작이 asset 탑재 시와 동일하게 성립하고(P1, P3), grayscale에서도 7종 status가 placeholder로 구분된다(AC-03과 동치).

- **SPEC-202-AC-17** (R-UI-006, [[DESIGN]] Asset Rules)
  Given 동일 화면에서 asset 탑재↔미탑재를 토글할 때
  When sprite 박스 크기를 측정하면
  Then placeholder/asset 모두 manifest `frame_size`에 고정되어 있고, 토글로 인한 layout shift가 0이다(P2, B6).

- **SPEC-202-AC-18** (R-UI-001, A1, [[DESIGN]] Anti-patterns)
  Given dashboard root route를
  When 최초 로드하면
  Then 첫 화면은 camp list/상태 summary(operational dashboard)이고, marketing landing/hero 섹션이 렌더되지 않는다.

- **SPEC-202-AC-19** (비기능: 디자인 일관성, A3/A4)
  Given dashboard의 컴포넌트 트리를
  When 검사하면
  Then card 내부에 또 다른 card가 중첩되지 않고(repeated item에만 card), heading은 §2.1 상한(가설 24px) 이내이며 `letter-spacing`은 0이다.

- **SPEC-202-AC-20** (R-CTRL-003, A6, [[SPEC-400-control-actions]])
  Given interrupt/send-key 같은 destructive control을
  When 렌더하면
  Then 명시 text label + 명확한 결과 문구를 가지며 장식적/모호한 버튼으로 위장되지 않고, interrupt는 confirm modal로 대상(agent type/tmux target/cwd)을 표시한다.

- **SPEC-202-AC-21** (R-UI-007, 비기능: 사용성, A7)
  Given 임의의 orc 행/inspector를
  When 표시하면
  Then camp/orc 은유와 무관하게 raw `tmuxTarget`과 plain text status label이 항상 확인 가능하고, 도트 콘셉트가 상태/control/target 정보를 가리지 않는다.

## 5. Traceability

| 요구사항 / 비기능 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-006 (placeholder parity) | §2.7 placeholder 동등성·frame_size 고정 | SPEC-202-AC-16, SPEC-202-AC-17 |
| R-UI-005 (상태 구분 표시) | §2.2 비색상 redundant encoding (이 spec=접근성 측면; 화면 렌더는 [[SPEC-201-dashboard-screens]]) | SPEC-202-AC-03, AC-04, AC-06 |
| R-UI-007 (raw tmux target 항상 노출) | §2.8 A7, §2.2 label | SPEC-202-AC-21 |
| R-UI-012 (부수; 1차 [[SPEC-203-terminal-workspace]]) | §2.1 terminal mode indicator border-**style** 토큰(`--oc-border-style-observe/-control`)으로 관전/조종을 **색-비의존** 구분(2026-07-02 개정) | SPEC-202-AC-03, AC-04 |
| R-UI-001 (첫 화면 camp list) | §2.8 A1 (이 spec=anti-pattern 게이트; 콘텐츠는 [[SPEC-201-dashboard-screens]]) | SPEC-202-AC-18 |
| R-UI-004 (inspector control 도달) | §2.4 키보드 focus order(접근성 측면) | SPEC-202-AC-07 |
| R-ORC-005 (status confidence·estimated 표시) | §2.2 R5, §2.3 affix | SPEC-202-AC-05 |
| R-ORC-006 (terminated/stale 표시) | §2.2 stale/terminated 행 encoding | SPEC-202-AC-03 |
| R-CTRL-003 (interrupt confirm) | §2.8 A6 비장식화 게이트 (계약 본문은 [[SPEC-400-control-actions]]) | SPEC-202-AC-09, AC-20 |
| 비기능: 접근성 — 비색상 | §2.2 grayscale 구분 | SPEC-202-AC-03, AC-04 |
| 비기능: 접근성 — 키보드 | §2.4 focus order/trap/접근명 | SPEC-202-AC-07, AC-08, AC-09, AC-10 |
| 비기능: 접근성 — 모션 | §2.5 reduced-motion + sprite fallback | SPEC-202-AC-11, AC-12 |
| 비기능: 접근성 — 대비/크기 (가설) | §2.6 대비·타깃 크기 | SPEC-202-AC-13, AC-14, AC-15 |
| 비기능: 사용성 (1분 이해, 밀도) | §2.1 density, §2.8 A7 raw target+label | SPEC-202-AC-21 |
| 비기능: 디자인 일관성 ([[DESIGN]] 적용) | §2.1 토큰 변수 계약, §2.8 anti-pattern | SPEC-202-AC-01, AC-02, AC-19 |
| R-P1-009 (keyboard quick-switch) — forward | §2.4 K7 focus backbone 보존 제약 | (forward — P1 spec에서 검증) |
| R-P1-004 (sprite variant/animation) — forward | §2.2/§2.5 status motion·reduced-motion 정합 | SPEC-202-AC-06, AC-11 (적용 측면) |

> 1차 슬라이스 범위 주석: R-UI-005/R-UI-001/R-UI-004는 화면 콘텐츠 ownership이 [[SPEC-201-dashboard-screens]]에 있고, 본 spec은 그 화면들에 횡단 적용되는 **접근성·디자인 적용 측면**을 검증한다(이중 ownership 아님 — 측면 분담). 전체 롤업은 [[SPEC-900-traceability-rollup]]이 통합한다.

## 6. Open Questions / Conflicts

- **대비/크기 수치 미고정 (가설)**: [[DESIGN]]이 정확한 대비비·최소 타깃 크기·type scale 수치를 고정하지 않는다. §2.6/§2.1의 값(4.5:1, 3:1, 24/44px, heading 24px)은 가설이며 PoC/디자인 QA 측정 후 [[08-Decisions]]에 확정 필요. 특히 `parchment`/`bone` on `ink`/`charcoal` 실측 대비 확인 필요.
- **`--oc-color-border` / elevation 토큰 부재**: [[DESIGN]]에 border·shadow 토큰이 없다. §2.1의 border/elevation 가정(flat, 1px border)을 디자인 확정으로 승격할지 [[08-Decisions]] 결정 필요.
- **Escape 단계 의미**: Camp Detail에서 `Escape`의 단계(orc 선택 해제 → camp list 복귀) 구체 동작은 [[SPEC-201-dashboard-screens]]와 정합 확정 필요(K4).
- **status overlay 정확 매핑 ownership**: overlay→sprite anchor 배치 좌표와 frame 소비는 [[SPEC-300-asset-rendering]] 소관. 본 spec은 매핑 *존재·non-occlusion·reduced-motion fallback*만 요구 — 두 spec 간 경계는 게이트에서 재확인.
- **CLI 정합**: §2.2 shape 채널(badge border-style)이 [[SPEC-005-data-contract]] §2.8 사람용 CLI 컬럼 출력의 비색상 status glyph와 의미적으로 일치해야 한다(같은 7종, 같은 의미). 시각 표현 차이는 허용하되 의미 매핑 일관성은 게이트 확인 항목.
- **Conflicts / Upstream**: 현재 [[02-Requirements]]/[[DESIGN]]과 직접 충돌 없음. mobile bottom-sheet inspector(R-P1/[[DESIGN]] Layout) 키보드/포커스 trap 규칙은 mobile 범위 확정 시 §2.4에 보강 예정([[03-UX-UI]] Open Questions의 mobile MVP 포함 여부에 종속).
