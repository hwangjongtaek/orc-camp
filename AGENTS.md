# AGENTS.md

이 저장소에서 작업하는 AI coding agent를 위한 가이드다. 작업 전에 이 문서와 `docs/` 산출물을 먼저 읽고, 아래 제약을 지킨다.

## 프로젝트 개요

**Orc Camp**는 command line 기반 AI agent orchestration tool이다. 실행 중인 tmux session을 "camp"로, 그 안에서 동작하는 Claude Code/Codex 등 AI agent session을 "orc"로 시각화해, 상태 관찰과 제한된 제어를 돕는 local-first dashboard를 제공한다.

- **Camp** = tmux session
- **Orc** = pane/window 안에서 실행 중인 AI agent session
- **Campfire Dashboard** = `orc-camp` 실행 시 열리는 localhost web dashboard
- 핵심 가치는 tmux/agent orchestration이고, pixel UI와 PixelLab.ai asset은 시각 품질 향상 요소다(MVP blocker 아님).

## 현재 저장소 상태

2026-06-26 기준 이 저장소는 **설계 핸드오프(design-handoff) 단계**다. 구현 코드는 아직 없고, 다음으로 구성된다.

- `docs/product/`, `docs/design/`, `docs/assets/` — 제품 기획·설계·asset 청사진 문서(아래 인덱스 참조)
- `docs/specs/` — **구현 SSOT.** 청사진을 구현 가능한 spec(계약·동작 규칙·테스트 가능한 수용 기준·요구사항 추적)으로 변환한 단일 진실 공급원. 구현 착수 단계에서 추가됐다.
- `asset-packs/orc-camp-default/` — PixelLab.ai 기반 pixel asset pack(`manifest.json`을 source of truth로 함, 생성 종료)
- `.codex/` — project-scoped Codex subagent와 PixelLab MCP 설정 템플릿

구현 착수 전에는 `orc-camp scan` prototype으로 tmux/agent 탐지 정확도와 상태 추론 threshold를 먼저 검증한다(`docs/design/10-System-Architecture.md`의 Architecture Review 참고).

## 계획된 기술 스택 (가정, 미확정)

- **언어/구조**: TypeScript monorepo (CLI + local server + dashboard). 결정 D-004는 `Proposed` 상태이며, tmux control 안정성/단일 binary 배포/성능 요구가 커지면 Rust 재검토.
- **CLI/Server**: Node.js + TypeScript, HTTP는 Fastify 또는 Hono, WebSocket은 native `ws` 또는 framework plugin
- **tmux 연동**: `child_process`로 `tmux` command 호출 (`list-sessions`, `list-panes`, `capture-pane`, `send-keys`)
- **Frontend**: React + Vite, lightweight store(Zustand/Redux Toolkit), CSS Modules/vanilla-extract, pixel token은 CSS variable
- **저장**: MVP는 JSON config + in-memory state, P1에서 SQLite 검토
- **테스트**: Vitest + Testing Library + Playwright

새 코드를 추가할 때 위 가정을 기본값으로 따르되, 확정되지 않은 결정은 `docs/product/08-Decisions.md`를 확인하고 변경 시 그 문서를 함께 갱신한다.

## 반드시 지킬 제약

- **Local-first / 프라이버시**: terminal output을 외부로 전송하거나 대량 저장하지 않는다. server는 `127.0.0.1` binding이 기본이고, state-changing API는 startup token을 요구한다. external bind는 explicit opt-in + warning이 필요하다. (D-003, D-008)
- **Control 안전 장치**: text input은 명시적으로 선택된 target에만 보낸다. interrupt 등 destructive action은 confirm을 요구한다. control 실행 직전 tmux pane id/target/command가 마지막 snapshot과 호환되는지 재검증한다. (D-006)
- **상태 추론**: 확신할 수 없는 상태에 단정적 label을 쓰지 않는다. status에는 항상 `statusConfidence`를 함께 제공하고, 불확실하면 `unknown` 또는 낮은 confidence로 반환한다.
- **IP / 라이선스**: World of Warcraft 등 기존 게임의 고유 캐릭터명·문양·식별 가능한 외형을 제품 asset, PixelLab prompt, manifest key, 파일명, UI label에 사용하지 않는다. `orc-warchief`, `orc-storm-shaman` 같은 original archetype만 사용한다. license/redistribution 조건이 불명확한 asset은 npm package에 포함하지 않는다. (D-010, D-009)
- **디자인 시스템**: UI를 만들거나 수정하면 `docs/design/DESIGN.md`의 color/typography/spacing/layout/component/anti-pattern 계약을 따른다. marketing landing page를 첫 화면으로 만들지 않고, 상태를 색상만으로 구분하지 않는다.

## Asset Pack 규칙

- runtime asset의 source of truth는 `asset-packs/<pack>/manifest.json`이다(D-013). 실제 전달본은 spritesheet가 아니라 캐릭터 폴더의 state/direction별 개별 frame PNG 구조다(`232×232`, 8방향, 캐릭터 3종).
- manifest에는 frame size, anchor point, FPS, state mapping, reduced-motion fallback frame이 반드시 포함된다.
- 캐릭터는 manifest character key(`orc-high-warchief-mascot`, `orc-claude-storm-shaman`, `orc-codex-field-engineer`)로 참조하고, frame은 `animations/<state>/<direction>/frame_%03d.png`를 manifest로 resolve한다. 평면 파일명(`orc-codex-active.png` 등)을 가정하지 않는다.
- asset이 런타임에 미탑재/누락이면 CSS pixel placeholder를 쓰되 layout size는 manifest `frame_size` 기준으로 고정한다.
- runtime asset 소비 계약(상태→sprite/effect 매핑, PoC 최소 subset, 미생성 gap)은 `docs/product/14-MVP-PoC-Scope.md`를 따른다.
- PixelLab 생성 prompt와 작업 순서는 `docs/assets/12-PixelLab-Prompts.md`, asset 셋업은 `docs/assets/11-PixelLab-Asset-Setup.md`, 등록 현황은 `docs/assets/13-PixelLab-Asset-Registry.md`를 따른다.
- PixelLab MCP 토큰(`AUTH_HEADER`)은 절대 commit하지 않는다. `.codex/config.toml` 참고.

## 문서 인덱스 (`docs/`)

`docs/`는 주제별 하위폴더로 구조화되어 있다. 전체 맵은 `docs/00-Index.md`를 본다. Obsidian wikilink(`[[basename]]`)는 폴더 위치와 무관하게 basename으로 해석되므로 문서 간 참조는 그대로 동작한다.

| 폴더 | 문서 | 내용 |
| --- | --- | --- |
| `docs/` | `00-Index.md` | 전체 문서 맵·카테고리 |
| `docs/product/` | `01-Planning.md` | 제품 기획 |
| `docs/product/` | `02-Requirements.md` | 요구사항 (`R-*`) |
| `docs/product/` | `07-Roadmap.md` | 로드맵 |
| `docs/product/` | `08-Decisions.md` | 결정 기록 (`D-*`) |
| `docs/product/` | `09-Reviews.md` | 리뷰 기록 |
| `docs/product/` | `14-MVP-PoC-Scope.md` | 최소 PoC 슬라이스(`orc-camp scan`)·런타임 asset 계약 |
| `docs/design/` | `DESIGN.md` | Design System Contract (UI 작업 시 필독) |
| `docs/design/` | `03-UX-UI.md` | UX/UI 설계 |
| `docs/design/` | `04-Frontend.md` | Frontend 구조, 라우팅, API 계약 |
| `docs/design/` | `05-Backend.md` | Backend 도메인 모델, API, control action |
| `docs/design/` | `06-Infra.md` | 실행 방식, 배포, 보안, 호환성 |
| `docs/design/` | `10-System-Architecture.md` | 전체 시스템 아키텍처 |
| `docs/assets/` | `11-PixelLab-Asset-Setup.md` | PixelLab asset 셋업 |
| `docs/assets/` | `12-PixelLab-Prompts.md` | PixelLab 생성 prompt |
| `docs/assets/` | `13-PixelLab-Asset-Registry.md` | asset 등록 현황 (생성 종료 ledger) |
| `docs/specs/` | `README.md`, `SPEC-*.md` | **구현 SSOT.** MVP 슬라이스의 구현 spec (계약·동작 규칙·수용 기준·추적성) |

## 작업 규칙

- 제품 문서는 한국어로 작성되어 있다. 문서를 추가/수정할 때 같은 언어와 톤을 유지하고, 용어(tmux, pane, agent, camp, orc)는 원문을 유지한다.
- 설계 결정을 바꾸거나 새로 정하면 `docs/product/08-Decisions.md`에 `D-0xx` 항목으로 기록한다.
- 문서는 Obsidian wikilink(`[[...]]`)를 사용한다. wikilink는 파일명(basename)으로 해석되므로 `docs/` 하위폴더로 이동해도 vault 내에서는 그대로 동작한다.
- **구현 spec의 SSOT는 `docs/specs/`다.** 코드를 작성/수정하기 전 해당 영역 spec(`docs/specs/SPEC-*.md`)을 확인하고, 구현이 spec과 달라지면 spec을 먼저 갱신한다. 청사진(`docs/product`, `docs/design`)과 spec이 충돌하면 spec의 "Conflicts / Upstream"에 기록하고 `08-Decisions.md`로 해소한다. spec 작성·검토는 `.claude/SUBAGENTS.md`의 Implementation 계열 subagent를 사용한다.
- MVP 범위(local CLI/server, tmux scanner, Claude Code/Codex detector, web dashboard, status 시각화, text input/interrupt control)에 집중한다. remote multi-host, team sharing, cloud sync, agent job scheduler, 영구 full terminal log는 초기 범위에서 제외한다.
