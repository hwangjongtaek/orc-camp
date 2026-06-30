---
title: 배경 4-타일 생성·병합 가이드 (1672×941 ×4 → 3004×1652)
updated: 2026-06-29
owner: scene-placement-engineer
related: [SPEC-301 §2.1a, SPEC-300 §2.5/§2.6b, DESIGN.md]
---

# 배경 4-타일 생성·병합 가이드

캠프 배경(image-ground)은 선명할수록 좋다(SPEC-301 §2.1a "선명도 요구사항"). 그러나 이미지 생성 도구가 **1672×941에서 출력이 캡**되는 경우가 많아 단일 3344 렌더를 못 얻는다. 그래서 **한 장면을 1672×941 타일 4장(2×2, 겹침 포함)으로 생성**한 뒤 **단일 고해상 이미지(≈3004×1652)로 병합**한다. 이 문서는 그 (1) 타일 레이아웃/겹침 규약, (2) 생성 프롬프트 템플릿, (3) 병합·적용 절차를 정의한다.

> 기준 산출물 `orccamp-default`(현재 적용본)는 이 절차로 만들어졌다: `orc-camp-bg-tile-{a,b,c,d}.png` → 병합 ≈3004×1652 → world(3344×1882)에 fit → WebP. manifest `backgrounds.orccamp-default.source_reference`가 본 문서를 가리킨다.

---

## 1. 타일 레이아웃 (2×2, 겹침)

| 타일 | 위치 | 병합 캔버스 좌표 (좌상단) | 담당 영역(최종 3004×1652 기준) |
|---|---|---|---|
| **A** | top-left | `(0, 0)` | x[0..1672] · y[0..941] |
| **B** | top-right | `(1332, 0)` | x[1332..3004] · y[0..941] |
| **C** | bottom-left | `(0, 711)` | x[0..1672] · y[711..1652] |
| **D** | bottom-right | `(1332, 711)` | x[1332..3004] · y[711..1652] |

- 각 타일 = **1672 × 941** (16:9).
- **가로 겹침 `ox = 340px`**: 좌열(A·C)의 우측 340px ↔ 우열(B·D)의 좌측 340px가 같은 영역.
- **세로 겹침 `oy = 230px`**: 상단행(A·B)의 하단 230px ↔ 하단행(C·D)의 상단 230px가 같은 영역.
- 병합 크기 = `(2·1672 − ox) × (2·941 − oy)` = **3004 × 1652**.
- 위치 공식: `bx = 1672 − ox = 1332`, `cy = 941 − oy = 711`.

```
        x:0        1332      1672           3004
   y:0  ┌───────────A───────────┐
        │        ┌──────────────B──────────┐
        │        │  A∩B 세로 seam(340px)   │
   941  └────────┼ = 하늘 그라데이션 + 빈   │
        ┌────────C─┤   courtyard만(+광원) ──┤
   711… │ A∩C/B∩D   │ ┌───────────D──────────┐
        │ 가로 seam  │ │  C∩D 세로 seam =     │
        │ (230px)    │ │  빈 courtyard만      │
  1652  └───────────┘ └──────────────────────┘
   ↑ 중앙 4-겹침(A∩B∩C∩D) = x[1332..1672]·y[711..941] → 반드시 빈 courtyard
```

### 1a. 겹침(seam) 좌표 맵 — 타일 로컬 픽셀 기준

각 타일은 **자기 로컬 좌표(0..1672 × 0..941)** 로 그린다. 아래 밴드에 들어가는 그림은 옆 타일과 **겹쳐 블렌딩**되므로, 두 타일에서 **동일 픽셀 위치·동일 모양**이어야 한다.

| seam | 공유 타일 | 한쪽 로컬 밴드 | 반대쪽 로컬 밴드 | seam 중심선(로컬) |
|---|---|---|---|---|
| 세로(상) | A↔B | A: x[1332..1672] (우 340) | B: x[0..340] (좌 340) | A x≈1502 / B x≈170 |
| 세로(하) | C↔D | C: x[1332..1672] (우 340) | D: x[0..340] (좌 340) | C x≈1502 / D x≈170 |
| 가로(좌) | A↔C | A: y[711..941] (하 230) | C: y[0..230] (상 230) | A y≈826 / C y≈115 |
| 가로(우) | B↔D | B: y[711..941] (하 230) | D: y[0..230] (상 230) | B y≈826 / D y≈115 |
| **중앙 4-겹침** | A∩B∩C∩D | A:(1502,826) B:(170,826) | C:(1502,115) D:(170,115) | merged 정중앙 (1502,826) |

### 1b. seam-safe 배치 규칙 (어긋남 방지의 핵심)

독립 생성된 4장은 seam의 **딱딱한 윤곽(landmark)** 을 픽셀 정렬할 수 없다 → feather 블렌딩하면 이중상/단차가 생긴다. 따라서:

1. **seam 밴드에는 연속 필드만.** 위 표의 밴드, 특히 **중앙 4-겹침**에는 *경계가 분명한 개별 오브젝트를 두지 않는다*. 허용: 하늘 그라데이션, 열린 ground 바닥, 일직선으로 길게 이어지는 벽/울타리/길/물가, 지평선, **원경 저대비 실루엣**(먼 산·도시·대성당 스카이라인 — 지평선 위에서 seam을 가로질러도 됨). **금지(seam 위)**: 미들그라운드의 또렷한 랜드마크(타워·요새 keep·게이트·석상·토템·제단/dais·상자 등).
2. **랜드마크는 단일 타일 내부(코너)로.** 한 타일만 그리는 영역 = 병합 캔버스 네 코너: A-only `x[0..1332]·y[0..711]`, B-only `x[1672..3004]·y[0..711]`, C-only `x[0..1332]·y[941..1652]`, D-only `x[1672..3004]·y[941..1652]`. 중앙 focal(워테이블/제단/dais)도 dead-center가 아니라 **한 상단 타일 내부**(예: A 내부 중앙-좌, merged≈(1180,560) → A 로컬≈(1180,560))에 **한 번만** 그리고, 나머지 타일의 같은 자리는 빈 courtyard로 비운다.
3. **광원(태양/달)은 seam 위 유일 허용 오브젝트.** 부드러운 방사형 글로우라 약간의 오차를 feather가 흡수한다. 단 A·B 두 장에서 **동일 중심·동일 반지름**으로: A 로컬 중심 `(≈1502, Yh)`, B 로컬 중심 `(≈170, Yh)`, 같은 `Yh`(지평선 근처 고정값, 4번).
4. **지평선·바닥면·울타리 라인 y 고정.** A·B는 하늘/지면 분기선(지평선)을 **동일 y**(권장 `y≈300`, 위에서 ~32%)로 두고 하늘은 개별 오브젝트 없는 그라데이션. courtyard 바닥은 4장 동일 시점·동일 질감(연속 필드 → 블렌딩 관대).
5. **C·D의 울타리·성벽·경계 펜스는 타일 _하단_(전경)에만.** ⚠️ 흔한 어긋남 원인: C·D의 펜스/성벽을 타일 _상단_(로컬 y 작음)에 그리면 그 자리는 merged y≈711..941 = **이미지 세로 정중앙 + A∩C/B∩D seam**이라, ① A·B 하단엔 펜스가 없어 단차가 생기고 ② seam 블렌딩으로 끊겨 보인다. 따라서 경계 구조물은 C·D **하단 전경**(로컬 y 큰 쪽, 권장 `y≈660..760` → merged `y≈1370..1470`, 화면 하단 ~85%)에 두고, **C·D에서 동일 y**로 일직선 연속(C∩D 세로 seam을 한 줄로 가로지름)시킨다. C·D **상단 230px(A∩C/B∩D seam)** 와 그 위 정중앙대는 **빈 courtyard만** 둔다(= A·B 하단의 열린 courtyard와 그대로 이어짐).
   - **단조로움 방지**: center를 열어두는 대신 **rampart/전경 가장자리에 자산을 촘촘히** 배치한다(배너·방패·화로·무기걸이·배럴·장작·전쟁북·초소·토템 등). 특히 설원·사막처럼 바닥 텍스처가 밋밋한 테마에서 필수. 단 자산은 **좌/우 third(단일 타일 영역)** 에 분산하고, **C∩D seam 위 펜스 구간(merged x[1332..1672])은 개별 오브젝트 없이 plain 연속**으로 둔다. 큰 게이트타워/초소 같은 랜드마크는 한쪽 third(단일 타일) 안에만.

> **가장 확실한 방법은 §2의 outpainting 체인**(이웃 타일의 겹침 띠를 고정 컨텍스트로 확장)으로, 위 규칙을 자동으로 만족시킨다. 4장 완전 독립 생성은 fallback이며 위 1–5를 반드시 지킨다.

---

## 2. 생성 프롬프트 템플릿

4장을 **하나의 장면 콘셉트**에서, **동일 스타일·팔레트·조명·시점**으로 생성한다.

**권장(1순위) — outpainting 체인**: 4장을 따로 만들지 말고, 한 장을 만든 뒤 **이웃의 겹침 띠(§1a)를 고정 컨텍스트로 두고 확장**한다 → 공유 피처가 *문자 그대로 동일*해져 §1b 규칙이 자동 충족된다. 순서:
1. **A** 생성(좌상).
2. **B** = A의 우측 340px(`x[1332..1672]`)를 좌측 컨텍스트로 고정한 채 우측을 outpaint.
3. **C** = A의 하단 230px(`y[711..941]`)를 상단 컨텍스트로 고정한 채 아래로 outpaint.
4. **D** = B의 하단 230px + C의 우측 340px(두 변)를 고정한 채 코너를 outpaint.
각 단계 출력은 정확히 1672×941로 크롭. (이러면 §1b-5의 "C·D 펜스를 하단에"도 자연히 지켜진다 — A·B 하단이 빈 courtyard이므로 C·D 상단도 빈 courtyard로 확장되고, 펜스는 그 아래 전경에만 새로 그려진다.)

**대안(2순위) — 4장 독립 생성**: outpainting/region을 못 쓰면 아래 공통 preamble을 고정하고 **§1b seam-safe 배치 규칙**을 프롬프트에 반드시 반영(랜드마크는 코너 단일 타일, seam·중앙은 연속 필드, 광원만 동일 좌표, C·D 펜스는 하단 전경).

### 픽셀아트 STYLE 절 (모든 preamble의 첫 절 — 필수)

생성기는 "detailed / painterly" 류 단어를 **실사풍 디지털 페인팅**으로 해석해 픽셀 게임 느낌을 잃는다. 따라서 **모든 preamble은 아래 STYLE 절로 시작**하고, 본 가이드의 모든 프롬프트에는 `Detailed`·`painterly`·`realistic`·`photo` 같은 단어를 쓰지 않는다(부정문 안의 `NOT … painterly`는 예외).

```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
```

- **별도 negative prompt 필드가 있는 생성기**(SD/Flux 계열 등)에는 다음을 negative로 넣으면 더 강하게 픽셀화된다:
  ```
  photorealistic, photograph, realistic, 3D render, octane, unreal engine, digital painting,
  painterly, oil painting, concept art, smooth gradient, soft shading, blurry, depth of field,
  bloom, hdr, film grain, anti-aliased, high detail
  ```
- 결과가 여전히 부드러우면: 출력 해상도를 더 낮춰(예: 836×470) 생성 후 **nearest-neighbor 업스케일**하거나, 후처리로 픽셀 그리드를 강제한다. 업스케일은 반드시 `-filter point`(nearest)로 한다:
  ```bash
  for t in a b c d; do
    magick ~/Downloads/orc-camp-bg{N}-tile-$t.png \
      -posterize 6 -resize 25% -filter point -resize 400% \
      ~/Downloads/orc-camp-bg{N}-tile-$t.png
  done
  ```
  단 이 후처리는 §3 병합 **전** 각 타일에 동일 파라미터로 적용한다(병합 후 한 번에 하면 겹침 feather가 다시 흐려진다).

### 공통 preamble (모든 타일에 그대로)
```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
A pixel-art orc warbase at sunset, top-down ~45° bird's-eye view.
Warm orange-red dusk sky with a low sun near the horizon; cracked red-dirt courtyard;
dark iron-and-timber orc structures with red banners and horde sigils; lit torches and
braziers. Consistent lighting, color palette, and perspective across the whole scene.
A 16:9 fragment of one larger scene with seamless edges. No characters, no UI, no text.
Output exactly 1672x941.
```

### 타일별 region 절 (preamble 뒤에 append) — §1b seam-safe 배치 적용
- **A (top-left)**:
  ```
  LEFT portion of the warbase: a tall horned watchtower with a ladder and a red banner at the
  far LEFT, a barred wooden gate below it (both INSIDE the upper-left, local y<700), red canyon
  cliffs along the left. The central war-table dais sits INSIDE this tile at local (~1180,~560)
  on open ground (NOT on the right edge). The low SUN is a soft radial glow centered on the
  RIGHT-edge seam at local (~1502,~300), same size/color as tile B; horizon line at y≈300. Keep
  the rightmost 340px (A&B seam) as plain dusk-sky gradient above and OPEN cracked-dirt courtyard
  below — no structures there. Open courtyard across the lower area.
  ```
- **B (top-right)**:
  ```
  RIGHT portion: a massive horned fortress keep with a glowing arched gate at the far RIGHT,
  spiked palisades and walls along the right. The low SUN is the SAME soft radial glow centered
  on the LEFT-edge seam at local (~170,~300), identical size/color to tile A; horizon at y≈300.
  Keep the leftmost 340px (A&B seam) as plain dusk-sky gradient above and OPEN cracked-dirt
  courtyard below — NO war-table, no structures there (the war-table belongs to tile A). Open
  courtyard across the lower area.
  ```
- **C (bottom-left)**:
  ```
  LOWER-LEFT foreground: keep the TOP 230px (A&C seam) and the whole upper-middle as WIDE OPEN
  cracked-dirt courtyard, continuous in tone with tile A above. A canyon cliff runs down the far
  LEFT edge; a teal crystal totem, red horde banners, chains, crates and lit braziers cluster
  along the far-LEFT edge in the LOWER area (local y>500), clear of the top seam. A timber-and-
  stone boundary fence with red banners runs straight across the BOTTOM foreground at local
  y≈700 (NOT across the middle), continuing off the RIGHT edge.
  ```
- **D (bottom-right)**:
  ```
  LOWER-RIGHT foreground: keep the TOP 230px (B&D seam) and the left two-thirds as WIDE OPEN
  cracked-dirt courtyard, continuous with tile B above and tile C to the left. The SAME timber-
  and-stone boundary fence with red banners and braziers continues straight across the BOTTOM
  foreground at the SAME local y≈700 (one continuous line with tile C, NOT across the middle).
  The right-edge cliff with cactus/agave plants sits in the lower-right corner.
  ```

### 겹침 일관성 지시 (각 타일 프롬프트에 append — §1a/§1b의 영문 지시)
```
This is tile {A|B|C|D} of a 2x2 set (each 1672x941) merged into 3004x1652 with 340px horizontal
and 230px vertical overlaps. The OVERLAP BANDS blend with neighbors, so put NOTHING with a hard
outline there — only continuous fields:
- A&B seam = A's right 340px / B's left 340px: plain sky gradient (top) + open courtyard (bottom).
  The ONLY object allowed here is the low SUN, drawn IDENTICALLY in both: A center (~1502,~300),
  B center (~170,~300), same radius/color. Horizon line at y≈300 in BOTH A and B.
- A&C and B&D seams = bottom 230px of A/B / TOP 230px of C/D: open courtyard only, same ground tone.
  Put NO fence/wall in the top of C/D (that lands at the image's vertical center and breaks).
- C&D foreground: any boundary fence/wall goes in the BOTTOM of C/D (local y≈700, image bottom
  ~85%) as ONE straight continuous line at the SAME y in both, crossing the C&D seam.
- DEAD CENTER (A:(1502,826) B:(170,826) C:(1502,115) D:(170,115)) is shared by all four tiles —
  keep it EMPTY open courtyard in every tile.
Landmarks (tower, keep, gate, totem, war-table/dais, crates) go ONLY inside single-tile corners,
never straddling a seam. Keep lighting/palette/perspective identical so tiles blend.
```

저장 파일명: `orc-camp-bg-tile-a.png` … `-d.png` (각 1672×941), `~/Downloads/`.

---

## 3. 병합 절차 (ImageMagick — 별도 stitcher 불필요)

타일이 별도 생성이라 겹침이 픽셀-동일하지 않으므로 **겹침 밴드를 feather(그라데이션 알파)로 블렌딩**한다.

```bash
A=~/Downloads/orc-camp-bg-tile-a.png; B=~/Downloads/orc-camp-bg-tile-b.png
C=~/Downloads/orc-camp-bg-tile-c.png; D=~/Downloads/orc-camp-bg-tile-d.png
OUT=~/Downloads/orc-camp-bg-merged.png
ox=340; oy=230; bx=1332; cy=711; W=3004; H=1652

# feather 마스크: leading edge에서 alpha 0→1 (가로/세로/코너)
magick -size ${ox}x941 -define gradient:direction=east gradient:black-white rampH.png
magick rampH.png \( -size $((1672-ox))x941 xc:white \) +append maskH.png    # 좌측 ox 페이드인
magick -size 1672x${oy} -define gradient:direction=south gradient:black-white rampV.png
magick rampV.png \( -size 1672x$((941-oy)) xc:white \) -append maskV.png    # 상단 oy 페이드인
magick maskH.png maskV.png -compose multiply -composite maskHV.png          # 코너(2D)

# 마스크를 알파로 적용
magick "$B" maskH.png  -alpha off -compose CopyOpacity -composite Bm.png
magick "$C" maskV.png  -alpha off -compose CopyOpacity -composite Cm.png
magick "$D" maskHV.png -alpha off -compose CopyOpacity -composite Dm.png

# A 위에 B,C,D 순서로 합성
magick -size ${W}x${H} xc:black \
  "$A" -geometry +0+0     -composite \
  Bm.png -geometry +${bx}+0   -composite \
  Cm.png -geometry +0+${cy}   -composite \
  Dm.png -geometry +${bx}+${cy} -composite \
  "$OUT"
```

### 겹침 값이 다를 때 (offset 재측정)
생성기의 겹침이 340/230과 다르면 `bx`,`cy`가 어긋나 피처가 misalign된다. 다운스케일 subimage-search로 재측정:
```bash
# 타일을 280px 폭으로 줄여 빠르게 매칭 (factor ≈ 1672/280 ≈ 5.97)
magick "$A" -resize 280x a_s.png; magick "$B" -resize 280x b_s.png; magick "$C" -resize 280x c_s.png
magick b_s.png -crop 93x158+0+0 +repage bL.png    # B 좌측 1/3 패치
magick compare -metric RMSE -subimage-search a_s.png bL.png _.png   # @x,y → bx≈x*5.97, by≈y*5.97
magick c_s.png -crop 280x52+0+0 +repage cT.png     # C 상단 1/3 패치
magick compare -metric RMSE -subimage-search a_s.png cT.png _.png   # @x,y → cy≈y*5.97
```
그 다음 `ox = 1672 − bx`, `oy = 941 − cy`로 위 스크립트의 값을 갱신한다. (`compare -subimage-search`는 full-res에서 매우 느리므로 반드시 다운스케일.)

---

## 4. world 적용 (asset-pack + manifest)

병합본(≈3004×1652)을 world(3344×1882)에 무왜곡 fit + WebP 압축 후 적용:

```bash
PACK=asset-packs/orc-camp-default
# cover+center-crop으로 3344×1882에 맞춤(왜곡 없음, 가장자리 cliff만 소폭 crop)
magick ~/Downloads/orc-camp-bg-merged.png -resize 3344x1882^ -gravity center -extent 3344x1882 -strip _fit.png
# WebP q92 (≈1.6MB; PNG 31MB→불가). 배경은 alpha 불필요.
magick _fit.png -strip -quality 92 -define webp:method=6 "$PACK/backgrounds/orccamp-default-background.webp"
shasum -a 256 "$PACK/backgrounds/orccamp-default-background.webp"; stat -f%z "$PACK/backgrounds/orccamp-default-background.webp"
```

manifest `backgrounds.<key>` 갱신:
- `file`: `backgrounds/<name>.webp`
- `native_size`: `[3344, 1882]` (파일 dims), `world_scale`: `1` (= world, 업스케일 0), `logical_size`: `[3344, 1882]`
- `sha256` / `bytes`: 위 출력값
- `ground.polygon` / `safe_area`: world(3344×1882) 좌표계. 구도가 기준과 같으면 유지, 다르면 **scene-placement-engineer가 재측정**(magick `-trim`/육안). `ground.ratio ≥ REFERENCE_GROUND_RATIO`(0.281) 게이트 통과 필수(SPEC-301 §2.8f).

> 메모: 병합본 native ≈3004이고 world 3344로 1.14× 업스케일이 들어간다(체감 거의 없음). 완전 무업스케일을 원하면 world를 3004×1652로 두고 `logical_size=[3004,1652]`·ground 좌표를 비율(×0.898, ×0.878) 재계산한다(`ground.ratio`는 불변). 단 `web/tests/ground.test.ts`의 하드코딩 값도 함께 갱신해야 한다.

---

## 5. 더 큰 해상도가 필요하면
같은 규약을 **3×3 / 3×2** 등으로 확장 가능: 타일 수만 늘리고 `ox/oy`·위치 공식을 동일하게 적용한다(겹침은 인접 타일 간 일정하게). 최종 world 크기와 ground 좌표만 그에 맞춰 다시 잡는다.

---

## 6. 테마 카탈로그 (제안 테마별 4-타일 프롬프트)

모든 테마가 공유하는 것은 **단 두 가지**뿐이다: (1) **§2 픽셀아트 STYLE 절**, (2) **§1a/§1b 병합 기하 계약**(seam=연속 필드, dead-center 열림, 큰 walkable ground 1개, 광원만 A&B seam 동일 좌표). **그 외 구도·오브젝트·앵커 위치는 전부 자유이며, 컨셉마다 달라야 한다.**

> ⚠️ **레이아웃 고정 금지 (단조로움의 원인 제거)**: 아래는 *요구사항이 아니다* — 본 성채(keep)가 우측에 있을 필요 없음 · 화면 하단을 성벽/울타리로 막을 필요 없음 · 제단(altar/dais) 필수 아님 · 타워·게이트 필수 아님 · 좌-타워/우-요새 좌우 대칭 금지. 각 컨셉은 **자기만의 고유 오브젝트 세트**로 **풍부하고 복잡한(layered)** 장면을 구성한다.

`ratio 게이트(≥0.281)`는 **"큰 열린 walkable ground 패치 1개"** 만 있으면 충족된다(위치·모양 자유). 따라서 구도를 획일화할 이유가 없다. seam 연결성은 *기하 제약*일 뿐 *구도*를 강제하지 않는다 — 또렷한 오브젝트를 seam·dead-center에만 안 두면, 나머지는 무엇을/어디에 두든 자유다.

### 6.0 풍부함·다양성 체크리스트 (모든 테마 필수)

- **레이어드 깊이 4단**: ① 원경 실루엣/스카이라인(저대비, 지평선 위 — seam 가로질러도 됨) → ② 미들그라운드 구조물(코너 단일-타일 zone에 배치) → ③ 전경 소품(C·D 하단, C∩D seam 밖) → ④ 바닥 디테일(길·자국·웅덩이·식생·균열).
- **구조물 ≥3종**(같은 것 반복 금지) + **컨셉 시그니처 오브젝트 ≥2종**(그 테마에만 있는 것).
- **지형 변주**: 고저차·계단·둔덕·물/용암/얼음/모래 패치·식생 — 평평한 단색 바닥 금지.
- **비대칭**: 좌우/상하 미러 금지. 앵커(가장 큰 구조물)는 **컨셉마다 다른 위치**(좌·우·후면-중앙 실루엣 중 택1).
- **밀도**: 빈 공간을 캠프 클러터로 채우되 **열린 walkable ground 1개는 반드시 남긴다**(중앙 포함, 비대칭 가능).
- **안티-클리셰**: "좌-타워 + 우-요새 + 중앙-제단 + 하단-성벽" 골격으로 회귀하지 말 것.

**모든 테마 공통 — 각 타일 프롬프트 끝에 반드시 추가:**

> 겹침 일관성(§1a/§1b·§2) — 레이아웃 무관, 기하만 강제:
> ```
> This is tile {A|B|C|D} of a 2x2 set (each 1672x941, 340px H / 230px V overlap) merged into one
> scene. OVERLAP BANDS blend with neighbors — put NOTHING with a hard outline there, only
> CONTINUOUS fields: sky gradient, open ground, ONE straight continuous run (a path / water-edge /
> low wall) if any, or a DISTANT low-detail background silhouette above the horizon.
> - A&B seam (A right 340 / B left 340): sky + open ground; the ONLY bright object is the light
>   source (sun/moon), drawn IDENTICALLY — A center (~1502,Yh), B center (~170,Yh), same Yh, radius,
>   color. Horizon at the same Yh in both. A distant skyline silhouette MAY span here (low contrast).
> - A&C / B&D seams (bottom 230 of A/B = top 230 of C/D): open ground, same tone — no midground
>   structure or foreground prop here (it would sit at the image's vertical center and break).
> - C&D seam (C right 340 / D left 340): open ground; if a path/water-edge/low wall crosses, make
>   it ONE straight continuous line at the SAME y in both, with no discrete prop on the seam.
> - DEAD CENTER (shared by all four) = open walkable ground in every tile.
> Every DISTINCT landmark/prop sits fully INSIDE one single-tile corner (A=upper-left, B=upper-
> right, C=lower-left, D=lower-right) OR is a distant background silhouette. Keep ONE LARGE open
> walkable ground patch. Make the scene DENSE, LAYERED and ASYMMETRIC. Identical lighting/palette/
> perspective. NO forced "tower-left + keep-right + altar-center + wall-bottom" layout.
> ```
> 하드 제약(§1b·§2): 각 타일 **정확히 1672×941**, **§2 픽셀아트 STYLE 절로 시작**(`Detailed`/`painterly`/`realistic` 금지, 별도 negative 필드 시 §2 negative), **큰 열린 walkable ground 1개 유지**, seam·dead-center에 또렷한 구조물·소품 금지(원경 실루엣·연속 라인만 허용), 캐릭터·UI·텍스트 없음. 저장: `orc-camp-bg{N}-tile-{a,b,c,d}.png`.
>
> **생성법**: 1순위 = §2 outpainting 체인(A→B→C→D, 자유 구도 그대로 이어 확장 → seam 자동 일치, 풍부함에 가장 유리). 2순위(4장 독립) = 각 **또렷한 오브젝트를 그게 속한 코너 타일 1장에만** 그리고, seam·dead-center는 열린 ground, 광원만 A&B seam 동일 좌표. 원경 앵커는 4장 모두 동일 실루엣·동일 지평선으로.

---

### 테마 0 — Default (orccamp-default) · 이끼·대지·ember

> **에픽 몬스터 descriptor 안내(§6 전 테마 공통)**: 각 테마 블록 끝의 **"에픽 몬스터"** 절은 그 배경에 어울리는 비-상호작용 ambient 보스 몬스터 1마리의 **배경별 art concept**(비주얼·팔레트 매치·시그니처·IP-safe 제약)만 정의한다. 거동(배경별 variant resolution·full-`ground.polygon` roaming·dwell/error FSM·비-상호작용)은 [[SPEC-303-epic-monster-npc]], **캐논 512 base contract + 5 애니메이션(active/waiting/idle/roaming/error) PROMPT·생성 runbook·manifest `monsters` 스키마**는 [[16-Epic-Monster-NPC]]가 SSOT다(여기에 full prompt를 중복하지 않는다).

기본 배경 `orccamp-default`(일반 orc 워캠프, 이끼·바위 지면, ember 광원)의 몬스터.

**에픽 몬스터 (epic monster NPC) — `monster-mosshide-behemoth` (Mosshide Behemoth)**
- **비주얼 컨셉**: 거대한 네발 엄니 전투-야수(콜로서스급 war-beast). 이끼와 바위가 엉겨붙은 두꺼운 hide, 등에 이끼 낀 바위 융기, ember가 새어나오는 눈과 콧김. 육중하고 느리게 어슬렁거리는 실루엣.
- **팔레트 매치**: moss-green·earth-brown 본체 + 바위 회색 + **ember orange** 액센트(눈·균열) — 기본 캠프의 이끼/대지/ember 톤과 일치.
- **시그니처**: ① 등의 이끼-바위 융기(보울더 갑각), ② ember-lit 엄니·눈, ③ 이끼 줄기가 드리운 네 다리.
- **IP-safe 제약**: 완전 오리지널 생물(**not based on any existing game monster**), top-down ~45° bird's-eye에서 읽히는 실루엣, **512×512**, bottom-center(feet) anchor, 비-상호작용 ambient NPC. STYLE은 §2 픽셀아트 절(`Detailed`/`painterly` 금지).

---

### 테마 1 — Froststeel (야간 설원 워캠프) · 한색 대비
팔레트: deep indigo·teal night, green aurora, frost white·ice blue, 일부 warm brazier.
**시그니처 오브젝트**: 빙하 절벽에 박힌 얼음-요새, 오로라, 톱니 빙산 스카이라인, 매머드/서리늑대 비스트-펜, 얼음 동상, 사슴뿔 솟대, 눈썰매·보급더미, 부서진 얼음창 바리케이드, 모닥불 링, 발리스타 둔덕, 얼어붙은 연못, 서리 소나무.
**구성(이 테마의 변주)**: 앵커=**좌-후면**의 빙하 요새(우측 강제 아님). 후면 지평선=오로라+빙산 실루엣(연속·seam 가로지름). 전경은 **성벽으로 막지 않고** 천막·썰매·비스트펜·모닥불·바리케이드를 흩뿌림. 열린 walkable ground=중앙~우측 설원의 굽은 길.

**Preamble (4장 공통)**
```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
A pixel-art orc warcamp at night on a snow-dusted tundra, top-down ~45° bird's-eye view, a DENSE
LAYERED ASYMMETRIC scene. Deep indigo-and-teal night sky with a rippling green AURORA and a low
pale MOON near the horizon; a jagged ICE-MOUNTAIN skyline silhouette far on the horizon (distant,
low-contrast). The orc anchor is a frost-rimed FORTRESS carved into a GLACIER / ice-cliff toward
the BACK-LEFT (not the right). Scattered across the snow: hide war-tents, antler totems, frost-rimed
banner poles, a beast-pen with a shaggy frost-beast, supply sleds, stacked crates and firewood, a
ballista on a snow mound, broken ice-spike barricades, a crackling campfire ring, weapon racks,
war-drums and glowing braziers (cold blue and warm orange) — clustered around the edges, NOT walling
off the bottom. Keep ONE large open packed-snow clearing (center to right) with a winding trodden
path and a frozen pond. Varied terrain: snow drifts, ice patches, cracked-frozen-mud, low rocks.
Consistent cold moonlit lighting, palette, and perspective. A 16:9 fragment of one larger scene
with seamless edges. No characters, no UI, no text. Output exactly 1672x941.
```
- **A**: `A (top-left): the glacier FORTRESS carved into a frost ice-cliff fills the upper-left (local x<1100, y<700) — frost-rimed horned walls, a watchtower, banners, a torch-lit gate; antler totems and a war-tent on the snow below it. The MOON is a soft pale radial glow centered on the RIGHT-edge seam at local (~1502,~300), same as tile B; aurora + distant ice-mountain silhouette across the top. Keep the rightmost 340px (A&B seam) as plain night-sky above and OPEN snow below. Leave a large open snow clearing toward lower-right.`
- **B**: `B (top-right): NO fortress here — open snowfield under the aurora and the distant ice-mountain silhouette. The MOON is the SAME radial glow centered on the LEFT-edge seam at local (~170,~300), identical to tile A. In the upper-right corner (local x>1100): a ballista on a snow mound, a beast-pen with a shaggy frost-beast, frost-rimed banner poles and a small ice-totem. Keep the leftmost 340px (A&B seam) as plain night-sky above and OPEN snow below. Wide open snow across the center-lower area.`
- **C**: `C (bottom-left): keep the TOP 230px (A&C seam) and center as OPEN packed-snow continuous with tile A; the glacier cliff base runs down the far-LEFT edge. Cluster in the LOWER-LEFT (local y>500, off the top seam): hide war-tents, a campfire ring, supply sleds, stacked crates/firewood, weapon racks, a blue crystal totem and braziers — SCATTERED props, NOT a continuous wall. A winding trodden snow path leads toward the open center-right; snow drifts and footprints dress the bottom.`
- **D**: `D (bottom-right): keep the TOP 230px (B&D seam) and the left two-thirds as OPEN packed-snow continuous with tiles B and C. In the LOWER-RIGHT corner (local x>340, off the C&D seam): broken ice-spike barricades, a war-drum, snow-dusted barrels, a frost shrine-stone, and the right-edge frozen cliff with snow-dusted pines. A frozen pond sits lower-center-right. Leave the bottom mostly OPEN (no full-width wall); snow drifts dress the foreground.`

**에픽 몬스터 (epic monster NPC) — `monster-frostfang-colossus` (Frostfang Colossus)**
- **비주얼 컨셉**: 우뚝 솟은 뿔 달린 빙수(ice-beast). 서리가 낀 텁수룩한 백색 모피, 등을 따라 자란 빙하-블루 수정 능선, 입김이 서리로 흩날림. 거대하고 묵직한 한기 실루엣.
- **팔레트 매치**: frost-white·ice-blue 본체 + glacial-blue 수정 + **aurora-teal** 글로우 — 테마 1의 한색 대비(인디고/teal night, 오로라)와 일치.
- **시그니처**: ① 등의 빙하-수정 능선(aurora-teal 발광), ② 휘어진 서리 뿔, ③ 서리 낀 입김/엄니.
- **IP-safe 제약**: 완전 오리지널 생물(**not based on any existing game monster**), top-down ~45°에서 읽히는 실루엣, **512×512**, bottom-center(feet) anchor, 비-상호작용 ambient NPC. STYLE은 §2 픽셀아트 절.

---

### 테마 2 — Emberforge (용암 흑요석 요새) · 난색·드라마틱
팔레트: black obsidian·charcoal, ember orange·magma red, ash grey sky.
**시그니처 오브젝트**: 활화산, 용암 강+돌다리, 거대 모루-대장간, 제련로·굴뚝, 냉각 웅덩이, 슬래그 더미, 마그마 대포, 사슬 포로 우리, 흑요석 첨탑, 재 안개, ember vent.
**구성(이 테마의 변주)**: 앵커=**후면-중앙** 화산+포지-성채 실루엣(연속·지평선). 미들그라운드 대장간 복합=**우측**. "장벽"은 성벽이 아니라 **용암 강 + 돌다리**가 전경을 가로지름. 열린 ground=중앙-좌 흑요석 광장.

**Preamble (4장 공통)**
```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
A pixel-art orc volcanic stronghold at dusk, top-down ~45° bird's-eye view, a DENSE LAYERED
ASYMMETRIC scene. Dark ash-grey and deep-red smoky sky with drifting embers; a great erupting
VOLCANO and a fortified FORGE-CITADEL silhouette far on the horizon (distant, low-contrast), its
dim red glow low on the horizon. Across the cracked black-obsidian ground: branching LAVA CHANNELS
crossed by orc stone bridges, a huge anvil-forge with chimney stacks and forge-fires (toward the
right), smelting furnaces, cooling pools, slag heaps, a magma cannon on a platform, chained captive
cages, obsidian spires, ember braziers and red horde banners — clustered around the edges, NOT a
bottom wall. Keep ONE large open obsidian plaza (center to left) with glowing magma veins as
walkable ground. Varied terrain: lava cracks, ash drifts, basalt steps, ember vents. Consistent hot
ember lighting, palette, and perspective. A 16:9 fragment of one larger scene with seamless edges.
No characters, no UI, no text. Output exactly 1672x941.
```
- **A**: `A (top-left): the erupting VOLCANO + forge-citadel silhouette runs across the TOP (distant, spanning toward tile B). In the upper-left (local x<1100, y<700): jagged obsidian spires with magma cracks, a slag heap and an iron watchtower with banners. The dim red volcano glow is a soft radial light centered on the RIGHT-edge seam at local (~1502,~300), same as tile B. Keep the rightmost 340px (A&B seam) as plain smoky-sky above and OPEN obsidian plaza below. Leave open obsidian ground lower-left.`
- **B**: `B (top-right): the great ANVIL-FORGE complex anchors the upper-right (local x>1000, y<700) — chimney stacks, glowing forge-fires, smelting furnaces, an iron keep wall. The dim red volcano glow is the SAME radial light centered on the LEFT-edge seam at local (~170,~300), identical to tile A; volcano silhouette continues across the top. Keep the leftmost 340px (A&B seam) as plain smoky-sky above and OPEN obsidian below. Open obsidian-and-magma ground across the center-lower area.`
- **C**: `C (bottom-left): keep the TOP 230px (A&C seam) and center as OPEN cracked-obsidian plaza with magma veins continuous with tile A. Cluster in the LOWER-LEFT (local y>500, off the top seam): cooling pools, a magma crystal totem, charred crates, chained captive cages, fire braziers and red banners — SCATTERED, NOT a wall. A LAVA CHANNEL with a stone bridge curves through the foreground (a continuous edge, not a fence). Ash drifts and ember vents dress the bottom.`
- **D**: `D (bottom-right): keep the TOP 230px (B&D seam) and the left two-thirds as OPEN obsidian plaza continuous with tiles B and C. In the LOWER-RIGHT (local x>340, off the C&D seam): a magma cannon on a basalt platform, slag heaps, the forge complex base with ember vents, and a lava pool with a stone bridge. If a lava channel crosses the C&D seam, make it ONE continuous edge at the same y. Leave the bottom mostly OPEN; ash and ember dress the foreground.`

**에픽 몬스터 (epic monster NPC) — `monster-magma-colossus` (Magma Colossus)**
- **비주얼 컨셉**: 흑요석 장갑을 두른 거구 golem-beast. 몸 전체에 마그마 균열이 ember-red/orange로 작열하고, 어깨/등에서 연기 분출구(smoke vent)가 피어오름. 갈라진 용암이 흐르는 묵직한 실루엣.
- **팔레트 매치**: black obsidian·charcoal·ash-grey 본체 + **magma red·ember orange** 균열 발광 — 테마 2의 난색·드라마틱(흑요석/용암/재) 톤과 일치.
- **시그니처**: ① 몸의 마그마 균열망(ember 발광), ② 어깨/등의 연기 분출구, ③ 흑요석 판 장갑·재 안개.
- **IP-safe 제약**: 완전 오리지널 생물(**not based on any existing game monster**), top-down ~45°에서 읽히는 실루엣, **512×512**, bottom-center(feet) anchor, 비-상호작용 ambient NPC. STYLE은 §2 픽셀아트 절.

---

### 테마 3 — Mirebog (늪지 워캠프) · 음습·녹색
팔레트: murky green·olive, fog grey, witch-fire green, weathered timber.
**시그니처 오브젝트**: 반쯤 가라앉은 폐허 지구라트-사원, 말뚝 위 오두막 마을, 늪 위 널다리·선착장, 코러클 보트, 어망, 거대 버섯, 매단 우리, 도깨비불 등, 악어 우리, 이끼 솟대, 갈대밭, 쓰러진 통나무, 안개.
**구성(이 테마의 변주)**: 앵커=**후면-좌** 안개 속 폐허 사원 실루엣 + **우측** 말뚝마을. 전경은 **성벽 아님** — 늪 위 널다리·보트·어망·버섯이 흩뿌려짐. 열린 ground=중앙 진흙 공터.

**Preamble (4장 공통)**
```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
A pixel-art orc swamp warcamp at dusk, top-down ~45° bird's-eye view, a DENSE LAYERED ASYMMETRIC
scene. Murky green-grey foggy sky with a dim hazy sun low on the horizon; a half-sunken ruined
ZIGGURAT-TEMPLE silhouette looms in the fog far on the horizon (distant, low-contrast). A stilt
ORC VILLAGE on timber piles stands over the bog water toward the right. Across the swamp: timber
BOARDWALKS and jetties over shallow stagnant water, coracle boats, fishing nets on racks, giant
glowing mushrooms, mossy totems, hanging cages, will-o-wisp witch-fire lanterns, a croc pen,
vine-wrapped crates, tattered red banners and warm torches — clustered around the edges, NOT a
bottom wall. Keep ONE large open muddy clearing (center) with moss and reed patches as walkable
ground. Varied terrain: mud, moss, reeds, water channels, fallen logs. Consistent damp foggy dusk
lighting, palette, and perspective. A 16:9 fragment of one larger scene with seamless edges.
No characters, no UI, no text. Output exactly 1672x941.
```
- **A**: `A (top-left): the half-sunken ruined ZIGGURAT-TEMPLE silhouette looms in the fog across the upper area (distant). In the upper-left (local x<1100, y<700): a mossy bluff, a leaning bog-timber watchtower, totems and tattered banners. The dim hazy sun is a soft radial glow centered on the RIGHT-edge seam at local (~1502,~300), same as tile B. Keep the rightmost 340px (A&B seam) as plain foggy-sky above and OPEN muddy ground below. Leave open muddy clearing lower-right.`
- **B**: `B (top-right): the stilt ORC VILLAGE on timber piles over bog water anchors the upper-right (local x>1000, y<700) — plank huts, rope bridges, hanging cages, witch-fire lanterns. The dim hazy sun is the SAME radial glow centered on the LEFT-edge seam at local (~170,~300), identical to tile A; temple silhouette continues in the fog. Keep the leftmost 340px (A&B seam) as plain foggy-sky above and OPEN muddy ground below. Open muddy clearing across the center-lower area.`
- **C**: `C (bottom-left): keep the TOP 230px (A&C seam) and center as OPEN muddy clearing with moss and reeds continuous with tile A. Cluster in the LOWER-LEFT (local y>500, off the top seam): a green-glow swamp totem, giant mushrooms, fishing nets on racks, coracle boats, vine-wrapped crates and lantern braziers — SCATTERED, NOT a wall. A timber BOARDWALK over shallow water curves through the foreground (a continuous edge, not a fence). Reeds and a water channel dress the bottom.`
- **D**: `D (bottom-right): keep the TOP 230px (B&D seam) and the left two-thirds as OPEN muddy clearing with shallow water continuous with tiles B and C. In the LOWER-RIGHT (local x>340, off the C&D seam): a timber jetty with moored coracles, a croc pen, hanging cages on a post, giant mushrooms and a mossy bluff with mangroves. If a boardwalk/water-edge crosses the C&D seam, make it ONE continuous line at the same y. Leave the bottom mostly OPEN; reeds dress the foreground.`

**에픽 몬스터 (epic monster NPC) — `monster-bog-leviathan` (Bog Leviathan)**
- **비주얼 컨셉**: 거대한 양서류 늪지 호러. 이끼와 덩굴이 엉긴 hide, 등/아가미에서 witch-fire 녹색이 발광하고, 몸에서 탁한 늪물이 뚝뚝 떨어짐. 낮게 웅크려 미끄러지듯 움직이는 실루엣.
- **팔레트 매치**: murky green·olive 본체 + weathered 갈빛 + **witch-fire green** 글로우 + fog-grey 물기 — 테마 3의 음습·녹색(늪/안개/도깨비불) 톤과 일치.
- **시그니처**: ① 등/아가미의 witch-fire 발광 무늬, ② 이끼·덩굴 hide, ③ 떨어지는 늪물·물갈퀴 발.
- **IP-safe 제약**: 완전 오리지널 생물(**not based on any existing game monster**), top-down ~45°에서 읽히는 실루엣, **512×512**, bottom-center(feet) anchor, 비-상호작용 ambient NPC. STYLE은 §2 픽셀아트 절. ※ `mirebog-camp` 배경은 **등록 완료**(image-ground, `ground.polygon` ratio 0.3274 gate PASS)이며 `backgrounds.mirebog-camp.epic_monster = "monster-bog-leviathan"` 정방향 링크가 있다 — 자산(512 base + 5 애니메이션) 생성 후 렌더([[SPEC-303-epic-monster-npc]] §3.1/§3.4, [[16-Epic-Monster-NPC]]).

---

### 테마 4 — Sunscorch (대낮 사막 워캠프) · 명료·고대비
팔레트: pale-blue/white sky, tan sandstone·bleached bone, harsh sun, sparse hard shadows.
**시그니처 오브젝트**: 반쯤 묻힌 고대 뼈-거상/지구라트, 사막 전쟁-바자르(시장 천막), 차양, 비스트 라인(팩 리저드), 물 저수조, 투기장 구덩이, 모래 둔덕, 선인장, 뼈 무더기, 보급 마차, 해골 솟대, 열기 아지랑이.
**구성(이 테마의 변주)**: 앵커=**후면-중앙** 모래에 묻힌 뼈-거상+지구라트 실루엣. 좌=바자르 천막+비스트 라인, 우=물 저수조+투기장. 전경 **성벽·제단 없음** — 시장 가판·차양·둔덕·선인장. 열린 ground=중앙 모래 투기장.

**Preamble (4장 공통)**
```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
A pixel-art orc desert warcamp at bright midday, top-down ~45° bird's-eye view, a DENSE LAYERED
ASYMMETRIC scene. Pale blue-and-white midday sky with a harsh high sun and faint heat haze; a
half-buried ancient BONE-COLOSSUS and a sandstone ZIGGURAT silhouette far on the horizon (distant,
low-contrast). A bustling orc WAR-BAZAAR of market tents and sun-shade canopies spreads toward the
left; beast-lines (pack lizards), a stone water CISTERN and an arena fighting-pit toward the right.
Across the sand: dune ridges, cactus clusters, bone totems, bone piles, supply wagons, rope-tied
crates, red banners and unlit torches — clustered around the edges, NOT a bottom wall. Keep ONE
large open sun-baked sand arena (center) of tan sand and cracked clay as walkable ground. Varied
terrain: dunes, cracked clay, gravel, sparse dry shrubs. Consistent harsh bright daylight, palette,
and perspective. A 16:9 fragment of one larger scene with seamless edges. No characters, no UI,
no text. Output exactly 1672x941.
```
- **A**: `A (top-left): the half-buried BONE-COLOSSUS + ziggurat silhouette runs across the TOP (distant, spanning toward tile B). In the upper-left (local x<1100, y<700): a cluster of war-bazaar market tents and sun-shade canopies, a sandstone watchtower, bone totems and red banners. The harsh high SUN is a small bright radial glow centered on the RIGHT-edge seam at local (~1502,~170), same as tile B. Keep the rightmost 340px (A&B seam) as plain pale-sky above and OPEN sand below. Leave open sand arena lower-right.`
- **B**: `B (top-right): a stone water CISTERN and a railed arena fighting-pit anchor the upper-right (local x>1000, y<700) — plus a sandstone-and-bone keep wall and beast-lines of pack lizards. The harsh high SUN is the SAME bright radial glow centered on the LEFT-edge seam at local (~170,~170), identical to tile A; colossus silhouette continues across the top. Keep the leftmost 340px (A&B seam) as plain pale-sky above and OPEN sand below. Open sand-and-clay arena across the center-lower area.`
- **C**: `C (bottom-left): keep the TOP 230px (A&C seam) and center as OPEN sun-baked sand continuous with tile A. Cluster in the LOWER-LEFT (local y>500, off the top seam): market stalls under canopies, a bleached bone totem, supply wagons, rope-tied crates, bone piles and an unlit torch — SCATTERED, NOT a wall. A low dune ridge with cactus clusters rolls through the foreground (a continuous sand edge, not a fence). Cracked clay and footprints dress the bottom.`
- **D**: `D (bottom-right): keep the TOP 230px (B&D seam) and the left two-thirds as OPEN sand-and-clay arena continuous with tiles B and C. In the LOWER-RIGHT (local x>340, off the C&D seam): a beast-pen with pack lizards, a water trough, bone piles, red banners and the right-edge sandstone mesa with cacti and dry shrubs. If a dune ridge crosses the C&D seam, make it ONE continuous sand line at the same y. Leave the bottom mostly OPEN; gravel and shrubs dress the foreground.`

**에픽 몬스터 (epic monster NPC) — `monster-duneplate-scourge` (Duneplate Scourge)**
- **비주얼 컨셉**: 뼈-판 갑각을 두른 거대 사막 야수(전갈/투구벌레형). 사암-탄 carapace에 햇빛에 바랜 뼈 가시가 솟고, 강한 정오 햇살에 또렷한 hard shadow를 드리움. 낮게 깔린 위협적 실루엣.
- **팔레트 매치**: sandstone-tan·bleached-bone 본체 + 짙은 hard-shadow 대비 + 옅은 sun-glare — 테마 4의 명료·고대비(사암/뼈/강한 햇빛) 톤과 일치.
- **시그니처**: ① 분절 뼈-판 carapace, ② 등/꼬리의 sun-bleached 뼈 가시, ③ 또렷한 hard shadow·집게/꼬리.
- **IP-safe 제약**: 완전 오리지널 생물(**not based on any existing game monster**), top-down ~45°에서 읽히는 실루엣, **512×512**, bottom-center(feet) anchor, 비-상호작용 ambient NPC. STYLE은 §2 픽셀아트 절. ※ `sunscorch-camp` 배경은 현재 designed-only(미생성)라 배경 등록 후 활성화된다([[SPEC-303-epic-monster-npc]] §3.1).

---

### 테마 5 — Necropolis (언데드 네크로폴리스 캠프) · 고딕·한색·teal ghost-fire
팔레트: deep blue-black, teal/cyan ghost-flame(주 액센트), purple drape, pale moonlight, bone white, sparse warm candle.
**시그니처 오브젝트**: 거대 고딕 대성당, 로브 lich 석상, 묘지(묘비·열린 무덤), 납골당/크립트, 교수대·철창, 뼈 무더기, 촛불 의식 원, 해골-기둥 철책, 갈까마귀 횃대, 거미줄, teal ghost-fire 화로, purple 배너, charnel 마차.
**구성(이 테마의 변주)**: 앵커=**후면 전체** 고딕 대성당 스카이라인 실루엣(연속·spanning). 코너=납골당·크립트·lich 석상. 전경 **제단 필수 아님** — 묘지(묘비·열린 무덤·교수대·뼈더미·촛불 의식 원). 열린 ground=중앙 cobblestone 광장(옅은 sigil).
레퍼런스: `~/Downloads/undead-camp-background-3344-1882.png`(팔레트·오브젝트 어휘 참고용; 구도는 위 §6.0대로 변주).

**레퍼런스 활용(구도는 베끼지 않음)**: 위 레퍼런스에서는 **팔레트·재료·오브젝트 어휘만** 차용한다(lich 석상, 고딕 대성당, teal ghost-fire, purple 배너, 옅은 해골 sigil, 십자 묘비, 해골-기둥 철책). **구도는 §6.0 자유 규칙**을 따라 아래처럼 변주한다 — 레퍼런스의 "좌-석상 / 우-대성당" 고정 대칭 구도를 그대로 복제하지 않는다(대성당은 후면 스카이라인 실루엣으로, 크립트·납골당은 코너로, 전경은 묘지로). 제단은 선택 사항이며 dead-center에 두지 않는다.

**Preamble (4장 공통)**
```
Strict 16-bit retro-game PIXEL ART, top-down RPG/strategy tileset style: crisp hard-edged
square pixels, NO anti-aliasing, a small indexed color palette (~24-48 colors), dithering
instead of smooth gradients, flat cel-shaded blocks of color, low-resolution chunky sprite/tile
look, visible pixel grid. NOT photorealistic, NOT a 3D render, NOT a digital painting / painterly,
no soft shading, no smooth gradients, no blur, no realistic textures, no depth-of-field, no bloom.
A pixel-art undead necropolis warcamp at night, top-down ~45° bird's-eye view, a DENSE LAYERED
ASYMMETRIC scene. Deep blue-black moonlit sky with a large pale FULL MOON near the horizon; a vast
gothic CATHEDRAL and a city of spires form a skyline SILHOUETTE across the whole back horizon
(distant, low-contrast). Midground orc-undead structures: stone mausoleums and crypts, tall robed
skeletal LICH STATUES, arched gateways glowing teal-green. Across the dark cobblestone: a graveyard
of tilted tombstones and open graves, gibbets and iron cages, bone piles, a candle ritual-circle,
charnel wagons, skull-topped iron fences, spider-web banners, raven perches, ghostly teal/cyan
brazier flames, purple draped banners and sparse warm candles — clustered around the edges, NOT a
bottom wall. Keep ONE large open dark cobblestone plaza (center) with a faint engraved skull sigil
as walkable ground. Varied terrain: cobble, cracked flagstone, mud, scattered bones. Consistent
cold moonlit, teal-lit gothic atmosphere, palette, and perspective. A 16:9 fragment of one larger
scene with seamless edges. No characters, no UI, no text. Output exactly 1672x941.
```
- **A**: `A (top-left): the gothic CATHEDRAL skyline silhouette spans the TOP (distant, continuing toward tile B). In the upper-left (local x<1100, y<700): a tall robed LICH STATUE with a staff, stone crypts, a purple-draped tent and teal ghost-flame braziers. The pale FULL MOON is a soft radial glow centered on the RIGHT-edge seam at local (~1502,~220), same as tile B. Keep the rightmost 340px (A&B seam) as plain night-sky (moon only) above and OPEN cobblestone below. Leave open plaza lower-right.`
- **B**: `B (top-right): a stone MAUSOLEUM with a teal-glowing arched gateway and stairs anchors the upper-right (local x>1000, y<700) — spired walls, hanging iron cages, a second lich statue. The pale FULL MOON is the SAME radial glow centered on the LEFT-edge seam at local (~170,~220), identical to tile A; cathedral silhouette continues across the top. Keep the leftmost 340px (A&B seam) as plain night-sky (moon only) above and OPEN cobblestone below. Open cobblestone plaza across the center-lower area.`
- **C**: `C (bottom-left): keep the TOP 230px (A&C seam) and center as OPEN dark cobblestone plaza (faint skull sigil) continuous with tile A. Cluster in the LOWER-LEFT (local y>500, off the top seam): tilted tombstones, an open grave, a gibbet, bone piles, a candle ritual-circle, spider-web banners and teal braziers — SCATTERED graves, NOT a wall. A low skull-topped iron railing runs a short stretch (a continuous edge, not a full-width fence). Cracked flagstone and scattered bones dress the bottom.`
- **D**: `D (bottom-right): keep the TOP 230px (B&D seam) and the left two-thirds as OPEN cobblestone plaza continuous with tiles B and C. In the LOWER-RIGHT (local x>340, off the C&D seam): a sunken crypt entrance with stairs, a charnel wagon, iron gibbet cages, a raven perch, bone piles and purple banners; an optional small necro-altar may sit here (not required). If an iron railing crosses the C&D seam, make it ONE continuous line at the same y. Leave the bottom mostly OPEN; scattered bones dress the foreground.`

> 주의(언데드 테마 ground): courtyard 재질이 dirt가 아니라 **dark cobblestone**이다. 병합 후 ground polygon/safe_area는 cobblestone 열린 영역 기준으로 **재측정**한다(scene-placement-engineer). 중앙 해골 sigil 위/주변도 walkable로 본다.

**에픽 몬스터 (epic monster NPC) — `monster-bonewraith-revenant` (Bonewraith Revenant)**
- **비주얼 컨셉**: 우뚝 솟은 해골 언데드 콜로서스. 뼈 갑옷에 보라색 누더기 망토가 휘날리고, 몸 전체가 teal/cyan ghost-fire에 휘감김. 달빛에 창백하게 빛나는 위압적 실루엣.
- **팔레트 매치**: bone-white·deep-blue-black 본체 + **purple** 누더기 + **teal/cyan ghost-fire** 글로우 + pale moonlight — 테마 5의 고딕·한색·teal ghost-fire 톤과 일치.
- **시그니처**: ① 몸을 휘감는 teal/cyan ghost-fire, ② 보라색 누더기 망토, ③ 뼈 갑옷·창백한 두개골.
- **IP-safe 제약**: 완전 오리지널 생물(**not based on any existing game monster**), top-down ~45°에서 읽히는 실루엣, **512×512**, bottom-center(feet) anchor, 비-상호작용 ambient NPC. STYLE은 §2 픽셀아트 절.
- **feasibility(중요)**: `necropolis-camp`는 최소 polygon(ratio 0.2191, [[SPEC-301-camp-map-movement]] §2.8f 예외 배경)이라 [[SPEC-303-epic-monster-npc]] §3.4가 **scale 0.65로 축소**(full sprite ≈333px)를 권장한다 — art는 512×512로 동일하게 생성하되 런타임 배치만 축소된다(별도 자산 불요).

---

> 새 테마 추가 시: §6.0 체크리스트(레이어드 깊이·구조물 ≥3종·시그니처 ≥2종·비대칭·밀도·안티-클리셰)를 채운 **컨셉 고유 구성**으로 작성한다 — 앵커 위치·전경 구성을 기존 5개 테마와 **다르게** 잡고, 좌-타워/우-요새/중앙-제단/하단-성벽 골격을 재사용하지 않는다. **preamble은 반드시 §2 픽셀아트 STYLE 절로 시작**하고 `Detailed`/`painterly` 류 단어를 쓰지 않는다. 시그니처/구성 2줄 + preamble + A/B/C/D 형식을 따르고, §1a/§1b 기하 계약(seam·dead-center·광원·큰 열린 ground)만 지키면 구도는 자유다. 생성 후 §3(병합)→§4(world 적용)→ground 재측정(scene-placement-engineer) 절차로 등록한다.
