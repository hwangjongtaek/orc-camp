# Design System Contract

이 문서는 Orc Camp UI를 생성하거나 수정하는 agent가 따라야 하는 디자인 시스템 계약이다.

> **두 DESIGN 문서의 역할(확정)**: 본 문서(`docs/design/DESIGN.md`)는 **prose 디자인 시스템 계약**(브랜드·원칙·voice·anti-pattern)으로 spec이 `[[DESIGN]]`로 참조하는 SSOT다. repo 루트 [`/DESIGN.md`](../../DESIGN.md)는 동일 디자인을 **google-labs `design.md` 포맷의 machine-readable 토큰+컴포넌트**로 표현한 파생 문서(UI 생성 agent용)다. 토큰 **값**(color/spacing/typography)은 양쪽이 일치하며, 실제 구현 값의 SSOT는 `web/src/styles/tokens.css`다(SPEC-202 §2.1: 변수 이름·역할은 SPEC-202, 값은 DESIGN). 값 변경 시 세 곳(tokens.css ↔ 두 DESIGN)을 함께 갱신한다.

## Brand

- 제품명은 **Orc Camp**로 표기한다.
- CLI command와 package identifier는 `orc-camp`를 사용한다.
- 핵심 은유는 "tmux session은 camp, AI agent session은 orc"이다.
- UI는 도트 기반 게임 콘셉트를 사용하되, 실제 사용자는 개발자이므로 정보 밀도와 조작성은 production tool 수준으로 유지한다.

## Color

### Core Palette

| Token | Hex | 용도 |
| --- | --- | --- |
| `ink` | `#171C1F` | 기본 배경, terminal preview |
| `charcoal` | `#262D2F` | panel, toolbar |
| `moss` | `#4F6F52` | camp terrain, success state |
| `ember` | `#D6723F` | primary action, campfire accent |
| `mana` | `#4AA3DF` | selected, active agent |
| `parchment` | `#F3E7C4` | 주요 text on dark |
| `bone` | `#D8C9A3` | secondary text |
| `danger` | `#C94C4C` | error, interrupt |
| `warning` | `#D6A43F` | waiting, caution |

### Usage Rules

- 어두운 camp background를 기본으로 하되, 상태 구분에 moss/ember/mana/warning/danger를 함께 사용한다.
- 상태를 색상만으로 전달하지 않는다. sprite pose, icon, label을 함께 사용한다.
- dashboard 전체가 하나의 색조로 보이지 않도록 terrain, fire, UI panel, selection 색을 분리한다.
- purple/blue gradient 중심의 SaaS 스타일을 사용하지 않는다.

## Typography

- 기본 UI font는 system sans-serif를 사용한다.
- terminal preview와 code identifier는 monospace를 사용한다.
- pixel font는 logo, camp title, small badge 등 제한된 영역에만 사용한다.
- dashboard 내부 heading은 compact하게 유지한다. hero-scale type은 사용하지 않는다.
- letter spacing은 `0`으로 둔다.

## Spacing

- base spacing unit은 `4px`다.
- toolbar와 dense control은 `4px`, panel 내부는 `8px`, major section 간격은 `16px`를 기본으로 한다.
- card radius는 최대 `8px`로 제한한다. pixel panel은 `0px` 또는 `4px` radius를 우선한다.
- sprite grid와 camp map은 안정적인 aspect ratio를 유지해 hover/state 변화로 layout shift가 생기지 않게 한다.

## Layout

- 첫 화면은 camp list와 상태 summary가 바로 보이는 operational dashboard다. landing page나 marketing hero를 만들지 않는다.
- camp detail은 full-bleed pixel camp scene을 전체 폭으로 두고, 그 아래 단일 **탭 dock**(Details / Preview / Activity)을 배치한다 — 모든 폭에서 단일 컬럼(우측 컬럼·모바일 bottom sheet 없음). 맵이 화면을 크게 쓰고, 기존 inspector + activity rail은 하나의 탭 패널로 통합된다(SPEC-201 §2.3).
- UI card 안에 card를 중첩하지 않는다.
- repeated item에만 card를 사용한다. page section은 full-width band 또는 unframed layout으로 둔다.
- 기본 camp scene은 단일 배경 이미지를 native 해상도로 보여주고 사용자가 드래그-팬으로 탐색한다(image-ground). orc는 이미지의 walkable ground 안에 배치된다. (ground polygon이 없는 배경은 legacy zone-grid로 fallback.)
- camp detail은 **map 모드 ↔ terminal 모드** 두 표시 모드를 갖는다(새 route 아님, `?orc=` SSOT 유지 — [[08-Decisions|D-045]]/[[08-Decisions|D-046]]). **map 모드**는 위의 camp scene + 단일 탭 dock이다. **terminal 모드**는 camp header · Orc Rail · Terminal Viewport(xterm.js) · Terminal Status Bar · Composed Input의 5-region workspace로, tmux pane에 준하는 화면(ANSI·커서·스크롤백)과 자리-스위칭·관전/조종 입력을 제공한다(SPEC-203). 두 모드 모두 동일 글로벌 exposure gate·zero-layout-shift·`prefers-reduced-motion`을 지킨다.
- Preview 탭(map 모드 dock)은 경량 read-only redacted terminal tail(peek)로 유지되고, 고충실 대화형 경험은 **terminal 모드의 live view 채널(SPEC-103) + 조종 모드 passthrough(SPEC-401)**가 담당한다(SPEC-201 §2.5a 공존). (이전의 "SSH 접속/PTY 브리지" 계획은 이 view-channel + arm passthrough 설계로 대체됨.)

## Components

- **Camp Card**: tmux session 이름, agent count, active/waiting/error count, last activity를 표시한다.
- **Orc Sprite**: agent session의 상태와 종류를 visual identity로 표현한다.
- **Status Badge**: `active`, `waiting`, `idle`, `error`, `unknown`, `terminated`, `stale`을 icon+label로 표시한다.
- **Terminal Preview**: read-only output preview. line 수 제한과 redaction 상태를 표시한다.
- **Command Dock**: text input, send, interrupt, attach/copy 같은 action을 제공한다.
- **Event Log**: scan, status change, control action, tmux error를 시간순으로 표시한다.
- **Settings Panel**: scan interval, redaction, aliases, asset pack 설정을 다룬다.
- **Orc Rail** (terminal 모드): camp 내 orc 목록을 portrait 썸네일 + Status Badge + 한 줄 요약으로 세로 배치하고, `waiting` orc를 색-비의존(테두리/아이콘/라벨) 강조로 부각한다(orchestration 1차 신호, SPEC-203).
- **Terminal Viewport** (terminal 모드): xterm.js 기반 read-only live 터미널 렌더(ANSI·커서·스크롤백, pane native cols×rows). redacted 배지 오버레이를 표시하고, 화면 재현 한계는 capture-pane 기반임을 명시한다([[08-Decisions|D-045]]).
- **Terminal Status Bar** (terminal 모드): 대상 target·cwd·모드(관전/조종)·지연을 표시한다.
- **Composed Input** (terminal 모드): Command Dock의 멀티라인·이력 확장판. 짧은 상호작용은 조종 모드 passthrough가, 긴 프롬프트는 폼이 담당한다(SPEC-401).
- **Mode Indicator** (관전/조종): Observe/Control 상태를 **색이 아닌** border-style + label + icon으로 구분한다(접근성; border-style/elevation 토큰은 [[SPEC-202-design-accessibility]] §2.1).
- **Quick Switcher**: 이름/상태 fuzzy 검색으로 orc를 전환하는 command-palette형 오버레이(SPEC-203 스위칭 계약).

## Motion

- pixel sprite animation은 상태 인지를 돕는 수준으로 짧고 반복 가능해야 한다.
- active 상태는 작업 motion, waiting 상태는 말풍선/idle bounce, error 상태는 짧은 shake 또는 alert frame을 사용한다.
- motion은 `prefers-reduced-motion`을 존중한다.
- dashboard data refresh로 UI가 튀거나 scroll position이 바뀌지 않게 한다.

## Voice

- UI 문구는 짧고 기능적이어야 한다.
- 제품 은유는 label과 empty state에만 가볍게 사용한다.
- 위험 action은 명확한 결과를 말한다. 예: "Interrupt this agent"는 허용하되 모호한 농담식 문구는 피한다.
- terminal, tmux, agent 용어는 개발자가 이해하는 원문을 유지한다.

## Asset Rules

- PixelLab.ai asset은 `camp background`, `orc sprite`, `status effect`, `item icon`으로 분류한다.
- character concept은 주요 fantasy orc archetype을 참고하되, 실제 제품 asset은 Orc Camp 고유 캐릭터로 만든다.
- PixelLab.ai 생성 prompt와 작업 순서는 [[12-PixelLab-Prompts]]를 따른다.
- **실제 전달본 asset pack은 준비 완료** 상태다. 캐릭터는 `manifest.json`의 character key(`orc-high-warchief-mascot`, `orc-claude-storm-shaman`, `orc-codex-field-engineer`)로 참조하고, 상태/방향별 frame은 캐릭터 폴더의 `animations/<state>/<direction>/frame_%03d.png` 경로를 manifest로 resolve한다(단일 `orc-codex-active.png` 같은 평면 파일명이 아니다).
- runtime의 asset 소비 계약(상태→sprite/effect 매핑, PoC 최소 subset, 미생성 gap)은 [[14-MVP-PoC-Scope]]를 따른다.
- asset이 런타임에 미탑재/누락이면 CSS pixel placeholder를 사용하되 layout size는 manifest `frame_size` 기준으로 고정한다.
- 외부 asset license, attribution, commercial usage 조건을 `08-Decisions.md`와 [[11-PixelLab-Asset-Setup]]에 기록한다.
- runtime asset은 PNG spritesheet와 `manifest.json`을 source of truth로 둔다.
- sprite frame size, anchor point, FPS, reduced-motion fallback frame은 manifest에 반드시 포함한다.

## Anti-patterns

- marketing landing page를 첫 화면으로 만들지 않는다.
- 도트 콘셉트를 이유로 실제 상태 정보와 control을 숨기지 않는다.
- 기존 게임의 고유 캐릭터명, faction emblem, 식별 가능한 무기/갑옷/얼굴을 제품 asset이나 prompt에 그대로 사용하지 않는다.
- terminal output을 대량으로 자동 저장하거나 외부로 전송하지 않는다.
- agent 상태를 확신할 수 없을 때 단정적인 label을 쓰지 않는다.
- interrupt, send key 같은 destructive action을 장식적 버튼으로 숨기지 않는다.
- 색상만으로 status를 구분하지 않는다.
