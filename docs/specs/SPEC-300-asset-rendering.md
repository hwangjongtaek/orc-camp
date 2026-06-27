---
spec: SPEC-300
title: 런타임 asset 소비·sprite 상태머신·fallback
status: approved
updated: 2026-06-27
requirements: [R-UI-003, R-UI-006, R-P1-004]
decisions: [D-007, D-009, D-013]
tags:
  - specs
  - asset
  - render
  - sprite
  - frontend
---

# SPEC-300 — 런타임 asset 소비·sprite 상태머신·fallback

이 spec은 dashboard 런타임이 **완성된 asset pack(`asset-packs/orc-camp-default/manifest.json`)을 소비해 orc sprite를 상태 기반으로 렌더**하는 계약을 고정한다. asset *생성*은 종료됐고([[13-PixelLab-Asset-Registry]] ledger, manifest `generation_status.state="closed"`), 본 spec은 *소비/렌더*만 다룬다.

입력은 [[SPEC-005-data-contract]]가 만든 `Orc`(특히 `agentType`·`status`·`statusConfidence`)와 `asset-packs/orc-camp-default/manifest.json`이다. 본 spec은 그 위에 ① manifest resolution(frame_size/anchor/fps/state·direction 폴더), ② `agentType→character` / `status→animation state` / `status→effect overlay` 매핑, ③ sprite 상태머신(전이·frame 재생·`terminated` lifecycle), ④ `prefers-reduced-motion` freeze, ⑤ asset 누락 시 placeholder fallback을 정의한다.

> **SSOT 불변식(확정, [[08-Decisions|D-013]])**: 런타임 asset 사양의 단일 진실원은 `asset-packs/orc-camp-default/manifest.json`이다. 평면 spritesheet(옛 64×64 가정)·고정 frame count·고정 path를 가정하지 않는다. frame_size/anchor/scale/`fps`/`frames`/state·direction 폴더/`reduced_motion.fallback_frame`은 **manifest에서 resolve**한다. manifest와 본문이 충돌하면 manifest를 따르고 §6에 기록한다.

> 본 spec은 scene 배치·선택·screen 상태가 아니라 **sprite 렌더 메커니즘**만 소유한다. scene layout/selection/empty·loading 화면은 [[SPEC-201-dashboard-screens]], 디자인 토큰·키보드·접근성 라벨은 [[SPEC-202-design-accessibility]], asset 패키징·license 강제는 [[SPEC-700-packaging-release]] 소유다.

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
- 다루는 요구사항: R-UI-003(scene 내 orc 렌더), R-UI-006(placeholder parity), R-P1-004(agent별 sprite variant·상태별 animation).

### Out of scope (다른 spec으로)

| 항목 | 이유 | 소유 spec |
| --- | --- | --- |
| camp scene layout·orc 배치 좌표·selection marker·terrain/prop 배치·empty/loading 화면 | scene 구성 | [[SPEC-201-dashboard-screens]] (R-UI-001~005/007) |
| 디자인 토큰·focus·keyboard nav·status의 비-색상 라벨/aria | 디자인·접근성 | [[SPEC-202-design-accessibility]] (R-UI-006 접근성 비기능) |
| `status`/`agentType`/confidence **추론 규칙** | 데이터 산출 | [[SPEC-004-status-inference]] / [[SPEC-003-agent-detection]] |
| scan 출력 데이터 shape(`Orc` 필드·enum 직렬화) | 데이터 계약 | [[SPEC-005-data-contract]] |
| asset **생성**(PixelLab prompt/seed) | 생성 종료 | [[13-PixelLab-Asset-Registry]] (closed) |
| asset pack npm 번들·license 강제·doctor smoke | 패키징·배포 | [[SPEC-700-packaging-release]] (D-009) |
| `roaming`(이동) 애니메이션 활성화·8방향 movement | P1 movement | 본 spec §3.7 pre-flag, P1 |
| control 상징(`orc-iron-commander`, `interrupt-hand`) UI | control flow | [[SPEC-400-control-actions]] |

> **`roaming`·`terminated`는 status enum이 아니다(확정)**: status enum은 [[SPEC-004-status-inference]]의 7종(`active`/`waiting`/`idle`/`stale`/`error`/`unknown`/`terminated`)이다. `roaming`은 manifest에 존재하는 **시각(이동) animation state**일 뿐 status enum 값이 아니며 MVP에서 status로부터 진입하지 않는다(§3.2, §3.7). `terminated`는 status enum 값이지만 manifest상 전용 애니메이션이 없는 **정적 표현**이다(§3.3).

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
    "anchor": [116, 208], "scale": 1,                  // 발 위치 기준점 (frame 내 px)
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
- **frame_size는 character마다 다르다(확정 처리)**: `orc-high-warchief-mascot`/`orc-claude-storm-shaman`/`orc-codex-field-engineer` = `[232,232]` anchor `[116,208]`; `orc-unknown` = `[228,228]` anchor `[114,204]`; `orc-iron-commander` = `[236,236]` anchor `[118,212]`. layout 박스·anchor 배치는 **그 character의** frame_size/anchor를 쓴다(전역 상수 금지).
- **렌더 스케일(확정)**: `image-rendering: pixelated`(nearest-neighbor)로 그린다. logical 크기는 `frame_size × scale`(현재 scale=1). anchor는 sprite를 ground 좌표에 정렬하는 기준점(frame 내 px)이며 좌표 배치는 [[SPEC-201-dashboard-screens]]가 소비한다.

### 2.3 매핑 계약 (확정 표)

**(a) `agentType → character key`** — [[14-MVP-PoC-Scope]] 런타임 asset 계약 기준, manifest 실제 delivery로 보정(§6 C1):

| `agentType` | character key | frame_size | 비고 |
| --- | --- | --- | --- |
| `claude-code` | `orc-claude-storm-shaman` | 232 | |
| `codex` | `orc-codex-field-engineer` | 232 | |
| `unknown` | `orc-unknown` | 228 | manifest delivered(§6 C1). 미해석 시 mascot fallback(§3.1) |
| (mascot / selected camp leader / README·empty) | `orc-high-warchief-mascot` | 232 | universal fallback character도 겸함 |

> `orc-iron-commander`(236)는 manifest에 있으나 **agent session orc가 아니라 control/interrupt 상징**이다. 본 spec의 orc 렌더 매핑은 이를 사용하지 않는다([[SPEC-400-control-actions]] 소관).

**(b) `status → animation state`** — manifest의 모든 agent character는 `idle`/`active`/`waiting`/`error`/`stale`(+`roaming`)를 가진다:

| Orc `status` | animation state | 비고 |
| --- | --- | --- |
| `active` | `active` | |
| `waiting` | `waiting` | |
| `idle` | `idle` | |
| `error` | `error` | mascot은 `error` south-only → direction fallback(§3.2) |
| `stale` | `stale` | |
| `unknown` | `idle` | 전용 `unknown` 애니메이션 없음 → `idle`로 표현(+ overlay로 구분) |
| `terminated` | **(정적)** `reduced_motion.fallback_frame` 고정 | 전용 애니메이션 없음(coverage:none), death/fall 금지(§3.3) |
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

## 3. Behavior rules

### 3.1 character key 해석과 fallback chain (확정)

1. `agentType`을 §2.3(a) 표로 character key에 매핑한다.
2. `manifest.characters[characterKey]`가 존재하면 그 character로 resolve한다.
3. 없으면 `orc-high-warchief-mascot`로 fallback한다(universal mascot, manifest 보장 character).
4. mascot도 없거나 `manifest == null`이면 **placeholder mode**로 간다(§3.6).
5. placeholder가 아닌 한, `frameSize`/`anchor`는 **해석된 character의** 값을 쓴다(232/228/236 각각).

### 3.2 animation state 해석 (status→state, direction/state fallback) (확정)

1. `status`를 §2.3(b)로 animation state에 매핑한다.
2. `status == 'terminated'` → animation 없이 정적 처리(§3.3). `mode='static'`.
3. 그 외 state에 대해 direction을 정한다. **MVP는 `direction='south'`**(§3.7). P1 movement에서 8방향으로 확장.
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

  (any state) ── status=terminated ──► [TERMINATED: static fallback frame + terminated-ghost, NO animation]
  (prefers-reduced-motion) ──────────► [STATIC: reduced_motion.fallback_frame, NO frame advance]
```

규칙(확정):

1. **재생**: `mode='animated'`이면 `framePaths`(frame 0..frames-1)를 manifest `fps`로 순환(loop) 재생한다. 한 frame의 표시 시간 = `1000/fps` ms.
2. **전이 시 리셋**: `status` 변화로 animation state가 바뀌면 새 state의 frame 0부터 재생을 시작한다(이전 frame index 이월 금지). 같은 state로 유지되면 재생 위상은 유지한다(매 snapshot마다 frame 0 리셋 금지 — 깜빡임 방지).
3. **`unknown` status**: `idle` animation을 재생하되 overlay는 `unknown-charm`을 합성한다(§2.3c). status를 색상/포즈 단독으로 단정하지 않는다.
4. **`terminated` lifecycle(확정, manifest 명시)**:
   - animation을 재생하지 않는다. `mode='static'`, `staticFramePath = reduced_motion.fallback_frame`(south/idle frame_000), `overlayPath = terminated-ghost`.
   - **death/fall 애니메이션 사용 금지**: manifest `animations.terminated.coverage="none"`, `note: "PixelLab falling-back-death is deprecated ... must not be used."`. 따라서 별도 사망 시퀀스를 합성하지 않는다.
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

### 3.8 license 게이트 / 비-재배포 (미해소, [[08-Decisions|D-009]])

- manifest `license`의 `commercial_use`/`redistribution`/`attribution_required`는 현재 **`"unknown"`**이다. 조건이 명시 확인되기 전에는 asset pack을 npm package 등 외부로 **재배포하지 않는다**([[14-MVP-PoC-Scope]] 패키징 게이트, [[09-Reviews]] Issue Register).
- 따라서 **런타임 코드 구현과 asset 패키징 배포를 분리**한다(확정): 본 spec의 renderer는 asset pack을 `assetBasePath`(로컬/dev 경로)에서 **참조만** 하고, 배포 산출물 포함 여부·license 강제·doctor smoke는 [[SPEC-700-packaging-release]]가 소유한다. asset이 배포본에 없으면 §3.6 placeholder로 동작하므로 기능은 license 확정과 독립적으로 검증 가능하다.

## 4. Acceptance criteria

> 각 AC는 고정 `OrcRenderInput`+`RenderEnvironment` fixture(Given) → renderer가 `SpriteRenderState` 산출(When) → 렌더 모델/경로/모드(Then)로 검증한다. 경로·frame count·fps는 §2.2 규칙대로 **manifest에서 resolve**한 값과 일치해야 한다.

- **SPEC-300-AC-01** (R-P1-004) — manifest resolution, 3 frame size
  - Given `manifest`가 로드되고 `agentType ∈ {claude-code, codex, unknown}` 각각의 orc fixture에서
  - When renderer가 `SpriteRenderState`를 산출하면
  - Then `characterKey`는 각각 `orc-claude-storm-shaman`/`orc-codex-field-engineer`/`orc-unknown`이고, `frameSize`는 각각 `[232,232]`/`[232,232]`/`[228,228]`, `anchor`는 `[116,208]`/`[116,208]`/`[114,204]`로 **해당 character의 manifest 값**과 일치한다.

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

- **SPEC-300-AC-05** (R-P1-004, R-UI-003) — `terminated` 정적 + ghost, death/fall 금지
  - Given `status=terminated`인 orc fixture에서
  - When renderer가 산출하면
  - Then `mode='static'`, `framePaths=null`, `staticFramePath`는 그 character의 `reduced_motion.fallback_frame`(south/idle frame_000), `overlayPath`는 `terminated-ghost`이며, 어떤 death/fall frame 시퀀스도 산출되지 않는다(`animations.terminated.coverage=="none"`).

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

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-UI-003 | camp scene 내 orc sprite 렌더(manifest resolve·frame_size/anchor·terminated 정적·placeholder), scene 좌표는 SPEC-201 공동 | SPEC-300-AC-05, AC-06, AC-09, AC-12 |
| R-UI-006 | asset 미탑재/누락 시 placeholder, layout size를 frame_size로 고정·동일 interaction·license 비재배포에서도 동작 | SPEC-300-AC-08, AC-09, AC-10, AC-13 |
| R-P1-004 | agentType별 sprite variant(character 매핑)+status별 animation state·fps frame 재생·effect overlay·reduced-motion·전이 | SPEC-300-AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-11 |

> R-UI-005(loading/empty/stale 등 화면 상태)와 접근성 비기능(색상 단독 금지·keyboard)은 [[SPEC-201-dashboard-screens]]·[[SPEC-202-design-accessibility]] 소유이며, 본 spec은 sprite 측 status overlay·reduced-motion·placeholder 라벨로 **지원**한다(소유 주장 아님). 전체 매트릭스 롤업은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진 보정 필요)

- **C1 — `orc-unknown`·`orc-iron-commander`는 더 이상 "미생성 gap"이 아니다(중요)**: [[14-MVP-PoC-Scope]] "런타임 Asset 계약" 표와 [[11-PixelLab-Asset-Setup]] character 우선순위 표는 `orc-unknown`(`unknown`→mascot 잠정 fallback)·`orc-iron-commander`를 **미생성 gap**으로 기술한다. 그러나 SSOT인 `manifest.json`([[08-Decisions|D-013]])은 두 character를 **이미 delivery**했다(`orc-unknown` `[228,228]` anchor `[114,204]`, `orc-iron-commander` `[236,236]` anchor `[118,212]`, 각 6 state + roaming, 8방향, exports zip/sha256 포함, `generation_status.character_count=5`). 본 spec은 SSOT 우선 원칙에 따라 `unknown → orc-unknown`을 1차 매핑으로 채택하고 mascot은 character fallback으로 강등했다(§2.3a, §3.1). **upstream 정정 필요**: 14-MVP/11-PixelLab의 "gap" 문구를 "delivered, runtime 소비 가능"으로 갱신하고, 매핑을 mascot→orc-unknown으로 바꾸는 결정을 [[08-Decisions]]에 `D-0xx`로 남길 것을 제안한다. **검토 필요.**
- **C2 — 14-MVP의 "(idle 4 / active 8 / waiting 4 / error 6 / stale 3)" 표기 모호**: [[14-MVP-PoC-Scope]] PoC 렌더 subset 문장의 괄호 수치는 **frame count가 아니라 manifest `fps`** 값이다(실제 frame count는 대부분 7, `roaming` 9). 본 spec은 frame count·fps를 모두 manifest에서 resolve하도록 §2.2에서 고정했다. 14-MVP 문구에 "(= fps)"를 명시해 frame count로 오독되지 않게 보정 권장.
- **C3 — scene 좌표·anchor 소비 경계**: 본 spec은 `frame_size`/`anchor`/`scale`을 노출만 하고, background `safe_area [390,520,890,330]` 내 orc 배치 좌표·간격·겹침 해소는 [[SPEC-201-dashboard-screens]] 소유다. SPEC-201 작성 시 anchor 기준 배치 규약을 본 spec §2.2와 정합화해야 한다(현재 SPEC-201은 `planned`).

### Open Questions

- **Q1 — overlay anchor/offset 위치 규약**: status overlay(64×64)를 sprite frame(232/228/236) 위 어디에 합성할지(머리 위/우상단 badge 등)는 디자인 결정이며 [[SPEC-202-design-accessibility]]·[[SPEC-201-dashboard-screens]]와 좌표 규약을 정해야 한다. 현재는 "별도 layer"까지만 고정. **검토 필요.**
- **Q2 — frame preload·메모리 budget**: orc 다수(비기능: 20 session/100 pane)일 때 state별 7-frame × 다방향 PNG preload 전략·texture 상한([[11-PixelLab-Asset-Setup]] Runtime Config `preload list`/`max texture size`)이 미정. MVP는 south/idle 정적부터이므로 부담이 낮으나, 애니메이션·8방향 확장 시 lazy load/캐시 정책을 [[SPEC-200-frontend-architecture]]와 정해야 한다.
- **Q3 — animation 위상 동기화 모델**: §3.3-2의 "전이 시 frame 0 리셋 / 유지 시 위상 보존"을 RAF 기반 시계로 구현할지, snapshot 주기(1~5s, [[08-Decisions|D-014]])와 독립된 렌더 루프로 둘지 [[SPEC-200-frontend-architecture]]와 정합 필요(snapshot 주기보다 frame 재생이 빠르므로 렌더 루프는 snapshot과 분리되어야 한다).
- **Q4 — `roaming`/8방향 진입 조건(P1)**: `roaming`은 status가 아닌 이동 표현이므로, P1 movement에서 어떤 신호(예: cwd 변경, 사용자 배치)로 진입·direction을 정할지 미정. MVP 비범위(§3.7).
- **Q5 — license 확정 의존**: §3.8 비-재배포는 manifest `license="unknown"` 동안 유효하다. license 확정(commercial/redistribution 허용) 시 [[SPEC-700-packaging-release]]가 asset 번들 포함을 결정하면 본 spec의 L2 placeholder 경로는 배포본에서 비활성(정상 asset 경로)로 전환된다. **SPEC-700과 공동 검토 필요.**
