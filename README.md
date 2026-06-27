---
status: design-handoff-ready
created: 2026-06-25
tags:
  - product
  - orc-camp
  - ai-agent
  - tmux
---

<p align="center">
  <img src="asset-packs/orc-camp-default/brand/orc-camp-logo-transparent.png" alt="Orc Camp" width="480">
</p>

<p align="center">
  <b>command line 기반 AI agent orchestration tool</b><br>
  실행 중인 tmux session을 <b>camp</b>로, 그 안의 AI agent session(Claude Code · Codex)을 <b>orc</b>로 시각화한다.
</p>

# Orc Camp

Orc Camp는 command line 기반 AI agent orchestration tool이다. 사용자가 실행 중인 tmux session을 "camp"로 보고, 각 session 안에서 동작하는 Claude Code, Codex 등 AI agent terminal session을 "orc character"로 시각화해 상태 확인, 작업 맥락 파악, 제어를 돕는다.

## 핵심 컨셉

- **Camp**: 하나의 tmux session. 프로젝트, 작업 묶음, 또는 실험 환경을 나타낸다.
- **Orc**: tmux pane/window 안에서 실행 중인 AI agent session. Claude Code, Codex, 기타 CLI agent를 포함한다.
- **Campfire Dashboard**: `orc-camp` 실행 시 열리는 local web dashboard. camp 목록과 agent 상태를 보여준다.
- **Pixel Camp UI**: 도트 기반 게임 컨셉의 UI. 배경과 캐릭터 스프라이트는 향후 PixelLab.ai 산출물을 사용한다.

## 제품 문서

문서는 주제별 하위폴더로 구조화되어 있다. 전체 맵은 [[00-Index|docs/00-Index]]를 본다.

- **Product** (`docs/product/`): [[01-Planning|01 Planning]] · [[02-Requirements|02 Requirements]] · [[07-Roadmap|07 Roadmap]] · [[08-Decisions|08 Decisions]] · [[09-Reviews|09 Reviews]] · [[14-MVP-PoC-Scope|14 MVP PoC Scope]]
- **Design** (`docs/design/`): [[DESIGN|Design System Contract]] · [[03-UX-UI|03 UX/UI]] · [[04-Frontend|04 Frontend]] · [[05-Backend|05 Backend]] · [[06-Infra|06 Infra]] · [[10-System-Architecture|10 System Architecture]]
- **Assets** (`docs/assets/`): [[11-PixelLab-Asset-Setup|11 PixelLab Asset Setup]] · [[12-PixelLab-Prompts|12 PixelLab Prompts]] · [[13-PixelLab-Asset-Registry|13 PixelLab Asset Registry]]
- **Specs (구현 SSOT)** (`docs/specs/`): [docs/specs/README.md](docs/specs/README.md) · `SPEC-*.md`

## 현재 결정 요약

| 항목 | 결정 |
| --- | --- |
| 제품명 | Orc Camp |
| CLI command | `orc-camp` |
| 기본 실행 모델 | local-first CLI가 localhost web dashboard를 연다 |
| 핵심 integration | tmux session/window/pane discovery와 control |
| UI metaphor | tmux session = Orc camp, AI agent session = Orc character |
| MVP agent 지원 | Claude Code, Codex를 우선 탐지 대상으로 둔다 |
| 상태 전달 | polling 기반 tmux snapshot + WebSocket event stream |
| 외부 의존 | PixelLab.ai asset은 시각 품질 향상용이며 MVP 기능의 blocker로 두지 않는다 |

## 설계 단계 상태

2026-06-26 기준 초기 제품 설계와 PixelLab asset pack 구성이 완료되어 구현 저장소로 이관 가능한 상태다. 구현 착수 전에는 `orc-camp scan` prototype으로 tmux/agent 탐지 정확도와 상태 추론 threshold를 먼저 검증한다. 첫 구현 슬라이스의 범위·데이터 계약·검증 지표와, 실제 전달본 asset의 런타임 소비 계약은 [[14-MVP-PoC-Scope]]에 정리되어 있다(결정 [[08-Decisions|D-012, D-013]]).

## 구현 — scan 슬라이스 PoC (Epic 1)

read-only `orc-camp scan` CLI(Epic 1, [[14-MVP-PoC-Scope]])가 spec(`docs/specs/SPEC-001~007`)을 SSOT로 구현되어 있다. TypeScript + Vitest, 런타임 의존성 0.

```bash
npm install          # dev 의존성(typescript, vitest, tsx)만
npm run scan         # tsx로 직접 실행: 사람용 table 출력
npm run scan -- --json | jq .   # machine-readable JSON
npm run scan -- --watch 3       # 3초 주기 read-only 재-scan (NDJSON with --json)
npm test             # 결정적 CI 게이트: unit + integration (live tmux 불필요)
npm run typecheck    # tsc --noEmit (strict)
npm run build        # dist/cli.js 번들 → bin: orc-camp
```

- **read-only 불변식**: tmux 호출은 `tmuxExec` allowlist(`list-sessions`/`list-windows`/`list-panes`/`capture-pane` + `-V`)로 제한되며 상태 변경 command를 절대 호출하지 않는다(SPEC-006 §2.6). process introspection(`ps`)도 고정 argv·`shell:false`다.
- **privacy chokepoint**: capture/`cmdline`/`cwd`/`paneTitle`은 소비 전 단일 `redact()`/`sanitizeCapture()` 경계를 통과한다. 원문은 파일/log/`--json` 어디에도 저장되지 않는다(SPEC-006).
- **모듈 ↔ spec 매핑**: `src/redaction`+`src/tmux/exec.ts`(SPEC-006) · `src/tmux/inventory.ts`+`introspect.ts`(SPEC-002) · `src/detection`(SPEC-003) · `src/status`(SPEC-004) · `src/assemble.ts`+`src/render`(SPEC-005) · `src/cli.ts`+`src/scan.ts`(SPEC-001). 모듈 간 결합은 의존성 주입으로만 이뤄져 각 모듈이 `src/types.ts`(frozen 계약)에만 의존한다.
- **검증 현황**: 167 tests 통과(unit + integration + measurement, 결정적), e2e 6종(실 tmux). 실 환경 측정(SPEC-007 M1~M5)으로 detection 보정·status 검증·latency p95 807ms(101 pane) 완료.

## 구현 — local server (Epic 2, SPEC-100~101)

scan 도메인 모델(`ScanResult`)을 재사용해 HTTP로 노출하는 local-first server. `ScanRunner`를 interval로 돌려 in-memory snapshot을 유지하고 token-gated REST로 serve한다(런타임 의존성 여전히 0 — Node 내장 `http`).

```bash
npm run serve        # 127.0.0.1 bind, token-bearing URL을 stdout에 출력
npm run doctor       # 환경 health 5종 점검 (fail→exit 1)
orc-camp serve --port 4123 --no-open        # default는 browser 자동 open
```

- **보안 경계(SPEC-100)**: `127.0.0.1` 기본 bind, CSPRNG startup token(메모리 전용·비영속), 상수시간 `Authorization: Bearer` 검증, CORS allowlist, **Host-header 검증(DNS rebinding 방어)**, 외부 bind는 `--allow-external` + warning 필수.
- **REST API(SPEC-101)**: `GET /api/health`(token-exempt liveness) · `GET /api/snapshot`(ScanResult + `snapshotVersion`/ETag/304) · `GET /api/camps/:id` · `GET /api/orcs/:id/preview`(token + exposure 이중 gate, redacted tail만) · `POST /api/refresh`(coalesce/rate-limit, tmux는 read-only). 모든 read는 token 요구(D-024).
- **snapshot runtime**: 변경 tick당 `snapshotVersion +1`(diff engine), last-good/stale fallback 재사용, `runtimeEpoch`로 restart 식별. 보안 경계는 security-privacy-engineer 감사 **PASS(P0 0·P1 0)**.
- **후속(미구현)**: WebSocket realtime(SPEC-102), dashboard SPA(Epic 3), control actions(SPEC-400).

## 초기 범위

MVP는 "현재 실행 중인 tmux session을 발견하고, 그 안의 AI agent session을 시각적으로 관찰하며, 제한된 제어를 수행한다"에 집중한다. 원격 orchestration, multi-host cluster, agent 자동 작업 분배, cloud sync는 초기 범위에서 제외한다.

## Open Questions

- AI agent별 "현재 하고 있는 일"을 어느 수준까지 자동 추론할 것인가?
- Claude Code, Codex 외 agent를 generic adapter로 처리할 수 있는 최소 공통 상태 모델은 무엇인가?
- dashboard에서 terminal output을 얼마나 노출할 것인가? 민감 정보 보호 기본값이 필요하다.
- PixelLab.ai asset license와 배포 권한은 어떤 방식으로 관리할 것인가?
