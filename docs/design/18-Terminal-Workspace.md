---
title: Terminal Workspace — preview tab 개선 설계안
updated: 2026-07-02
tags:
  - design
  - terminal
  - preview
  - orc-camp
---

# 18 Terminal Workspace (preview tab 개선 설계안)

> **상태**: 설계안(blueprint) → **spec 작성 완료(2026-07-02, opus-1)**. §7 위임 브리프대로 신규 [[SPEC-103-pane-live-stream]]·[[SPEC-203-terminal-workspace]]·[[SPEC-401-interactive-input]] 작성, [[SPEC-006-privacy-redaction]]·[[SPEC-102-realtime-sync]]·[[SPEC-201-dashboard-screens]] 개정, 접점 [[SPEC-400-control-actions]]·[[SPEC-600-observability]]·[[SPEC-200-frontend-architecture]]·[[SPEC-202-design-accessibility]] 정합. 결정 [[08-Decisions|D-041]]~[[08-Decisions|D-046]](**2026-07-02 Accepted 승인**), 요구사항 R-UI-012/R-API-006/R-PRIV-008/R-CTRL-009. 도메인 리뷰(tmux/security/ui) + spec-reviewer 게이트 통과(P0-gap 0), 관련 spec `approved`. **Phase 1 백엔드(SPEC-103 live view + SPEC-401 server passthrough) 구현 착수.**
>
> **목표**: 현재 preview tab은 "간단한 에이전트 현황 파악" 수준에 머물러 있다. 이를 **실제 터미널에서 tmux pane을 쓰는 것과 거의 유사한 경험**으로 끌어올리고, camp UI 안에서 **오크를 스위칭하며 관찰·orchestration** 할 수 있는 작업공간으로 재설계한다.

## 1. 현재 상태 점검 (as-is audit)

### 1.1 데이터 경로

| 항목 | 현재 값 | 근거 |
| --- | --- | --- |
| 캡처 방식 | `capture-pane -p -S -200` — **plain text, ANSI 없음** | `src/tmux/inventory.ts:475` |
| 캡처 주기 | 스캔 주기와 동일 (**1–5초**, 설정값) | `src/server/runtime.ts` schedule, `settings.ts` bounds |
| preview 노출량 | redacted tail **최대 12줄** (`PREVIEW_LINES`) | `src/types.ts:512` |
| 전달 방식 | 탭 열 때 1회 `GET /api/orcs/:id/preview` fetch; 스냅샷 diff로 orc 객체가 바뀔 때만 refetch. **스트리밍 없음** | `web/src/components/preview/PanePreview.tsx` |
| 렌더 | `<pre>` 텍스트. 색·커서·스크롤백·TUI 재현 없음 | `web/src/components/preview/TerminalPreview.tsx` |

### 1.2 입력(제어) 경로

- SPEC-400 경로는 건재: `send-keys` 3개 고정 템플릿(literal / allowlist key / C-c), expected-target 재검증, 감사 로그, 비관적 흐름 (`src/server/control.ts`).
- 그러나 UI는 **폼 기반 CommandDock** — 텍스트 input + 15개 키 버튼 + Interrupt 모달. 터미널 화면과 시각적으로 분리되어 있고 **키보드 직접 입력(passthrough)이 없다**.

### 1.3 오크 스위칭/공간

- 오크 선택은 맵 클릭 → `?orc=` URL 파라미터(SSOT)뿐. **Preview 탭 안에서 오크를 전환할 수단이 없고**, 단축키도 없다.
- Preview는 맵 아래 dock의 3개 탭 중 하나로, 높이가 제한된 보조 패널이다. "작업공간"이 아니다.

### 1.4 판정

핵심 병목은 **화면 충실도**다. Claude Code·Codex는 풀스크린 TUI인데, ANSI 없는 12줄 plain tail은 사실상 판독 불가능하다. 그다음이 **지연(1–5초 폴링)**, **입력 단절(폼↔화면 분리)**, **스위칭 부재** 순.

## 2. 목표 경험 (to-be)

1. **tmux pane 준하는 화면**: ANSI 색·커서·스크롤백을 가진 실제 터미널 렌더(xterm.js), pane의 native cols×rows 반영.
2. **준실시간**: 보고 있는 pane은 sub-second 갱신 (Phase 1: 250–500ms 폴링 push, Phase 2: control-mode push <100ms).
3. **자리에서 스위칭**: 터미널 컨텍스트를 벗어나지 않고 오크 전환 (roster rail + 단축키 + 퀵 스위처).
4. **자연스러운 입력**: 명시적 "조종 모드"에서 터미널에 직접 타이핑 → send-keys 전달. 폼 입력은 멀티라인 프롬프트용으로 병행.
5. **orchestration 기반**: waiting 오크 감지 → 점프, (후속) 멀티 오크 broadcast.

기존 불변식은 유지한다: read-only tmux(쓰기는 SPEC-400 send-keys 경로만), redaction-before-transport, exposure gate, 127.0.0.1 + token, 디스크 비저장.

## 3. UX 설계 — "Terminal Workspace"

### 3.1 진입/레이아웃

- CampDetail에 **map 모드 ↔ terminal 모드** 전환을 추가한다(기존 `LayoutModeSwitcher` 확장). 맵에서 오크 **더블클릭/Enter**로 terminal 모드 진입.
- terminal 모드 레이아웃:

```text
┌────────────────────────────────────────────────────────┐
│ camp header (뒤로가기 · 상태 칩 · 모드 스위처)              │
├──────────┬─────────────────────────────────────────────┤
│ Orc Rail │  Terminal Viewport (xterm.js)               │
│ ┌──────┐ │  - pane native cols×rows, fit/scale         │
│ │orc 1 │ │  - 스크롤백(캡처 창 200줄부터 시작)             │
│ │orc 2*│ │  - redacted 배지 오버레이                     │
│ │orc 3 │ │                                             │
│ └──────┘ │─────────────────────────────────────────────│
│ waiting  │ status bar: target·cwd·모드(관전/조종)·지연    │
│ 강조     │ composed input (기존 CommandDock 개선판)       │
└──────────┴─────────────────────────────────────────────┘
```

- **Orc Rail**: camp 내 오크 목록 — portrait 썸네일 + StatusBadge + 한 줄 요약. `waiting`(입력 대기) 오크는 시각적으로 강조(orchestration의 1차 신호).
- 선택 SSOT는 그대로 `?orc=` URL 파라미터. 맵/rail/URL 어느 쪽에서 바꿔도 동기화된다.

### 3.2 오크 스위칭

| 수단 | 동작 |
| --- | --- |
| rail 클릭 | 해당 오크로 전환 |
| `[` / `]` (또는 ←/→) | 이전/다음 오크 |
| `Cmd/Ctrl+1..9` | rail 순번 점프 |
| `Cmd/Ctrl+K` | 퀵 스위처(이름/상태 fuzzy) |

전환 시 workspace는 유지되고 스트림만 detach→attach 된다. 이전 오크의 마지막 화면은 LRU 캐시로 잠깐 보존해 전환 체감을 즉각적으로 만든다.

### 3.3 입력 모델 — 관전/조종 2단계

- **관전(Observe, 기본)**: 키 입력이 절대 나가지 않는다. 스크롤/복사만 가능.
- **조종(Control)**: 명시적 토글(버튼 또는 터미널 클릭 후 확인)로 **arm**. 상태 표시(테두리·status bar)가 명확히 바뀌고, 터미널 포커스의 키스트로크가 SPEC-400 경로로 전달된다. 무입력 N분 후 auto-disarm. 위험 chord(C-c 등 destructive)는 기존 확인 모달 유지.
- **composed input**: 기존 CommandDock의 텍스트 입력은 하단에 유지·개선(멀티라인, 이력). 긴 프롬프트는 폼이, 짧은 상호작용(y/n, 방향키, Enter)은 passthrough가 담당.

### 3.4 orchestration (후속 단계)

- waiting 오크 발생 → rail 강조 + 토스트 "orc N이 입력을 기다립니다" → 클릭 시 해당 오크로 점프.
- 멀티 선택 → 동일 프롬프트 broadcast (오크별 expected-target 재검증, 개별 결과 집계).
- 프롬프트 템플릿/이력 재사용.

## 4. 기술 아키텍처 (단계별)

### Phase 1 — Live View 채널 (폴링 push, read-only 유지)

- 클라이언트가 focused pane에 `view.attach` (기존 `/api/events` WS에 클라→서버 메시지 추가) → 서버는 **해당 pane 1개만** 250–500ms 간격 `capture-pane` 고빈도 폴링 → 변경 diff → **redaction** → `pane_view` 프레임 push. `view.detach`/연결 종료 시 폴링 중단.
- 클라이언트는 xterm.js로 렌더. 커서 위치·geometry는 **이미 read-only allowlist에 있는 `list-panes` format 변수**(`#{cursor_x}`/`#{cursor_y}`/`#{pane_width}`/`#{pane_height}`)로 조회한다 — `display-message`를 새로 allowlist에 넣지 않는다(spec 확정, [[08-Decisions|D-045]], [[SPEC-103-pane-live-stream]] §2.5). *(원안의 `display-message -p`는 spec 단계에서 이 방식으로 대체됨.)*
- ANSI 색은 §5.1 redaction 결정 전까지 **plain 우선, 색은 Phase 1.5** 로 분리 가능.
- 스크롤백: 최초 attach 시 캡처 창(현 200줄, 상향 검토) 전체를 seed로 전송.
- 부하 가드: 동시 attach 상한(예: 클라이언트당 1 pane), 폴링은 exposure on + 탭 활성일 때만.

### Phase 2 — tmux control mode 브리지 (push, <100ms)

- 서버가 `tmux -C attach` 상주 클라이언트 1개를 유지, `%output` 이벤트를 pane별로 구독해 push. iTerm2 tmux 통합과 동일 메커니즘.
- 단, control mode 클라이언트는 임의 tmux 명령 실행이 가능하므로 **브리지가 발행하는 명령 세트를 allowlist로 고정**하고 read-only 불변식을 spec으로 재정의해야 한다(§5.2).

### Phase 3 — orchestration

- broadcast API(SPEC-400 확장), waiting 감지 알림 흐름, 템플릿.

### 기존 계약과의 접점

- SPEC-101 스냅샷/SPEC-102 WS는 그대로 두고 **별도 채널(프레임 타입 추가)** 로 얹는다 — 스캔 루프와 live view 폴링은 독립.
- SPEC-400 제어 경로는 그대로 재사용(passthrough도 결국 send-keys 3 템플릿 + allowlist 확장).

## 5. P0 결정 필요 항목 (spec 전 반드시 판정)

1. **ANSI × redaction**: SGR escape가 secret 패턴을 중간에서 쪼갤 수 있다 → redaction 미탐 위험. 후보: (a) SGR 토큰화 → plain 재조립 후 redact → 스타일 re-map, (b) 색 포기(plain 유지), (c) redact 후 escape 재주입 금지 + 라인 단위 스타일만. **security-privacy-engineer 검토 필수. 이 결정이 Phase 1.5/2의 게이트.**
2. **read-only 불변식 재정의**: control mode 브리지(Phase 2)와 고빈도 capture-pane(Phase 1)이 "tmux를 절대 변경하지 않는다" 계약과 충돌하지 않는지 — 명령 allowlist, 부하 한도(pane당 최대 Hz, 동시 attach 수)를 계약으로 명문화.
3. **키보드 passthrough 보안 모델**: KEY_ALLOWLIST 확장 범위(C-* chord, 임의 문자 literal), rate limit, 감사 로그 볼륨(키스트로크 단위 audit은 과다 — 배치/요약 정책 필요).
4. **exposure gate 단위**: 현재 글로벌 설정 1개. workspace에서는 pane별/세션별 gate 또는 "이 orc만 노출" 승격이 필요한지.
5. **화면 재현 수준**: alternate screen/커서/스크롤 영역을 어디까지 재현할지 (capture-pane 기반의 한계 명시).

## 6. 단계별 가치 (요약)

| Phase | 사용자 가치 | 리스크 |
| --- | --- | --- |
| 1 | TUI가 "읽히는" 실제 터미널 화면 + sub-second 갱신 + 스위칭 UX | 낮음 (read-only 유지, 기존 스택 위) |
| 1.5 | ANSI 색 | 중간 (redaction 설계 필요) |
| 2 | tmux 수준 지연(<100ms) | 중간~높음 (control mode 경계) |
| 3 | 멀티 오크 orchestration | 중간 (UX 복잡도) |

## 7. Spec 작성 위임 브리프 (→ opus-1 세션)

본 문서를 입력으로, docs/specs SSOT에 다음을 작성/개정한다. 기존 컨벤션(SPEC-000, R-* 추적성, 테스트 가능한 AC) 준수.

### 신규 spec

| ID(제안) | 범위 | 참조 |
| --- | --- | --- |
| **SPEC-103-pane-live-stream** | attach/detach 프로토콜, 폴링 정책·부하 한도, `pane_view` 프레임 스키마, redaction 경계, 스크롤백 seed, Phase 2 control-mode 확장 노트 | §4, §5.1–5.2 |
| **SPEC-203-terminal-workspace** | terminal 모드 화면/레이아웃, orc rail, 스위칭 단축키/퀵 스위처, xterm.js 통합 계약, 관전/조종 상태 표시, 접근성(reduced-motion, 키보드 트랩) | §3 |
| **SPEC-401-interactive-input** (또는 SPEC-400 개정) | 키보드 passthrough, arm/disarm 수명주기, allowlist 확장, rate limit, audit 정책 | §3.3, §5.3 |

### 개정

- **SPEC-006**: ANSI stream redaction 계약 (§5.1 결정 반영).
- **SPEC-102**: WS 프레임 타입 추가(`pane_view` 등) + 클라→서버 메시지 도입.
- **SPEC-201**: dock Preview 탭 → terminal 모드로의 이관/공존 정의.
- **02-Requirements**: R-* 신설(터미널 충실도, 지연, 스위칭, passthrough 보안), **08-Decisions**: D-041+ (폴링 vs control mode, ANSI redaction 전략, passthrough 모델, exposure 단위).

### 권장 파이프라인 (roster)

1. spec-author — SPEC-103/203/401 초안.
2. 병렬 리뷰: tmux-systems-engineer(폴링·control mode 경계·부하), security-privacy-engineer(§5.1/5.3), product-ui-designer(§3 워크스페이스 UX·DESIGN.md 정합).
3. spec-reviewer — P0 gap 게이트 후 구현 착수.

### 오픈 퀘스천 (spec에서 판정)

- 폴링 주기/attach 상한의 구체 수치와 tmux 서버 부하 실측 방법 (qa-test-strategist 하니스).
- xterm.js 도입 시 번들 크기·라이선스(MIT) — "런타임 의존성 최소" 원칙과의 조율(web SPA 측 의존이므로 CLI 원칙과는 별개임을 명시).
- 이전 오크 화면 LRU 캐시의 메모리 상한과 redaction 재적용 여부.

## 8. Phase 2/3 Spec 작성 위임 브리프 (→ opus-1 세션, 2026-07-03)

> **상태**: **spec 작성 완료(2026-07-03, opus-1)**. 신규 [[SPEC-104-control-mode-bridge]]·[[SPEC-402-orchestration]] 작성, [[SPEC-103-pane-live-stream]](§6 Q6 RESOLVED)·[[SPEC-006-privacy-redaction]]·[[SPEC-400-control-actions]]·[[SPEC-401-interactive-input]]·[[SPEC-600-observability]]·[[SPEC-102-realtime-sync]]·[[SPEC-203-terminal-workspace]] 개정, [[02-Requirements]] R-API-007/R-CTRL-010/R-UI-013(proposed), [[08-Decisions]] D-047~D-051(Proposed·미승인). 파이프라인: spec-author → 병렬 도메인 리뷰(tmux-systems 2 BLOCK·security 2 BLOCK·ui PASS-with-P1) → 전 P0 해소 → **spec-reviewer P0-gap 게이트 PASS(P0 0)**. 결정 D-047~D-051 **제품 오너 승인 대기**(승인 전까지 SPEC-104/402는 `draft`). 구현 배치는 승인 후 분할(A=src/ 브리지, B=web/ broadcast UI).

> **전제(완료 상태)**: Phase 1([[SPEC-103-pane-live-stream]]·[[SPEC-203-terminal-workspace]]·[[SPEC-401-interactive-input]], D-041~D-046)과 Phase 1.5 styled(SPEC-103 §2.3.1 spans-over-redacted-plain, [[SPEC-006-privacy-redaction]] §2.8, [[08-Decisions|D-042]] 게이트 해소)는 **구현·라이브 실증·main 머지 완료**다. §5의 P0 중 1(ANSI)·3(passthrough)·5(재현 수준)은 해소됐고, 2(read-only 재정의)의 브리지 부분이 Phase 2로 이월돼 있다([[08-Decisions|D-041]] (c) forward, SPEC-103 §6 Q6). 본 절은 남은 두 축의 spec 위임 브리프다.

### 신규 spec

| ID(제안) | 범위 | 참조 |
| --- | --- | --- |
| **SPEC-104-control-mode-bridge** (SPEC-103 §6 Q6의 name-placeholder 확정) | `tmux -C attach` 상주 브리지의 read-only sub-계약: 브리지가 발행 가능한 명령 sub-allowlist(초기 attach·refresh-client·subscribe류만, `send-keys` 등 write 전면 금지 — **구현 spec [[SPEC-104-control-mode-bridge]]/[[08-Decisions|D-048]]에서 effective allowlist=∅로 확정: refresh-client/capture-pane도 금지, 브리지는 명령을 발행하지 않음**)와 그 **강제 지점**(브리지 stdin 단일 writer, line-granular fail-close), 수명주기(기동/crash/tmux 재시작 감지), **폴링 fallback**(실패 시 SPEC-103 경로로 silent degrade — 클라 무변경), 부하/백프레셔(`%output` 폭주 coalescing), audit | §4 Phase 2, §5.2 |
| **SPEC-402-orchestration** (또는 SPEC-400 §확장) | broadcast: 대상 orc 집합 선택 → **단일 confirm(대상 목록 명시)** → per-orc 순차 실행(기존 single-writer 유지) + 결과 집계(성공/실패 per orc), audit(`control.broadcast` batch), 대상 필터(waiting만/active 전체 등), 프롬프트 템플릿은 scope 판정(P1 이월 가능) | §4 Phase 3 |

### P0 결정 필요 (D-047+)

1. **브리지 redaction 경계**: `%output`은 escape 포함 **chunk 스트림**이라 secret이 chunk 경계에서 쪼개질 수 있다(Phase 1은 매 tick 전체 window 재캡처라 무풍). 후보: (a) **하이브리드(권장 검토): `%output`을 dirty-signal로만 쓰고 실제 프레임은 기존 `capture-pane` 경로 유지** — 레이턴시는 폴링→이벤트 트리거로 <100ms 달성하면서 redaction 경로·wire 계약(§2.3.1) 완전 불변, (b) 라인-완성 버퍼링 후 line 단위 `sanitizeStyledCapture`, (c) 화면 상태 재구성 후 sanitize. security-privacy-engineer 검토 필수 — **이 결정이 SPEC-104의 게이트**.
2. **브리지 read-only sub-allowlist**: 구체 명령 세트와 위반 시 fail-close(브리지 즉시 종료→폴링 fallback) 계약. 상주 subprocess는 `tmuxExec` allowlist 밖의 **새 진입점**이므로 별도 강제 메커니즘이 필요하다.
3. **broadcast 경로 vs arm 모델**: passthrough arm은 연결당 1 pane([[08-Decisions|D-041]])이다. broadcast는 (a) **composed-input(폼) 경로만 사용(권장)** — arm/passthrough 무관, 기존 `POST /input` per-orc + 재검증(expected) 재사용, 오폭 위험 최소, (b) multi-arm 실시간 전파 — **비권장/forward pre-flag**(파괴 반경 큼). 결정으로 고정할 것.
4. **broadcast confirm·audit 계약**: 대상 N≥2일 때 confirm 필드(대상 목록·agentType·command), 부분 실패 시 중단 vs 계속, audit 스키마(원문 비저장 원칙 유지 — byteLength/대상 수/실패 수만).

### 개정

- **SPEC-103**: §6 Q6 해소(브리지가 동일 `pane_view_seed`/`pane_view`/`pane_view_end` 프레임을 발행 — wire 계약 불변이 목표), fallback 전환 시 viewSeq/재-attach 의미.
- **SPEC-006**: §2.8 입력이 스트림일 때의 적용 노트(P0-1 결정 반영; 하이브리드 채택 시 "변경 없음" 명시로 충분).
- **SPEC-401/400**: broadcast가 재사용하는 gate pipeline(재검증·rate)과 새 audit action.
- **SPEC-203**: broadcast UI(대상 선택·결과 집계·waiting toast(§2.9 기구현)와의 연결), SPEC-102(신규 프레임 없으면 불변 확인), **02-Requirements** R-* 신설, **08-Decisions** D-047+.

### 권장 파이프라인 (roster)

1. spec-author — SPEC-104/402 초안 + 개정.
2. 병렬 리뷰: tmux-systems-engineer(브리지 수명주기·`%output` 실제 semantics·부하), security-privacy-engineer(P0-1/2·broadcast 오폭·audit), product-ui-designer(broadcast UX·confirm 모달 정합).
3. spec-reviewer — P0 gap 게이트 → 제품 오너 D-047+ 승인 → 구현 배치 분할(예: A=src/ 브리지, B=web/ broadcast UI).

### 오픈 퀘스천 (spec에서 판정)

- 브리지 상주 프로세스의 리소스 계약(1개 고정? tmux 서버당?)과 `doctor` 진단 항목.
- broadcast 대상 상한(N 상한, rate)과 camp 경계(단일 camp 내로 제한?).
- Phase 2가 Phase 1 폴링을 **대체**하는지 **공존**(기본 폴링, opt-in 브리지)하는지 — 기본값 결정.
