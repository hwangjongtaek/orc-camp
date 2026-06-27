# 09 Reviews

## Review Summary

- **작성일**: 2026-06-25
- **판정**: 조건부 진행
- **P0 blocker**: 없음
- **핵심 조건**: agent 상태 추론 정확도, current work summary 신뢰도, terminal output 보안, tmux control 안전 장치를 MVP 검증 항목으로 둔다.

## Requirements Review

### 2026-06-25 실제품 기준 보강

`02-Requirements.md`를 실제 local CLI 제품 운영 기준으로 재검토했다. 기존 문서는 제품 방향은 충분했지만 구현팀이 놓치기 쉬운 launch failure, tmux 미설치, port 충돌, stale snapshot, token 검증, target misfire, redaction, current work confidence가 P0 요구사항으로 고정되어 있지 않았다.

### 보강한 P0 영역

- `scan`, `serve`, `doctor` command와 browser open 실패 fallback
- tmux inventory의 pane metadata, timeout, target별 error isolation
- current work summary, summary source, status confidence
- `terminated`, `stale` 상태와 snapshot lifecycle
- terminal preview line/byte limit, backend redaction, output non-persistence
- startup token, CORS 제한, state-changing API token 검증
- control action 직전 target 재검증과 activity audit event
- WebSocket reconnect와 REST snapshot recovery
- local config, debug log, diagnostics 요구사항

### 남은 판단

수동 mark/unmark는 P1로 유지했다. Discovery Prototype에서 Claude Code/Codex 탐지 정확도가 낮으면 P0로 승격해야 한다.

## Business Review

### 강점

- AI coding agent를 여러 개 동시에 쓰는 개발자에게 문제 인식이 명확하다.
- tmux와 CLI agent 사용자는 early adopter segment가 선명하다.
- local-first dashboard는 privacy-sensitive developer workflow에 적합하다.
- camp/orc metaphor는 데모와 제품 기억에 유리하다.

### 사업 리스크

- 전체 개발자 시장이 아니라 terminal/tmux power user로 초기 시장이 좁다.
- Claude Code/Codex 제품 자체가 dashboard 기능을 강화하면 차별화가 약해질 수 있다.
- 무료 CLI tool 기대가 강한 영역이라 유료화 지점은 후속 기능에서 찾아야 한다.

### 검증 필요

- 사용자가 실제로 dashboard를 계속 열어두고 쓰는지 확인해야 한다.
- agent 2-3개 수준에서도 가치가 있는지, 5개 이상에서만 가치가 생기는지 검증해야 한다.
- remote/team 기능 없이 개인 local tool만으로 retention이 나오는지 확인해야 한다.

## Usability Review

### 강점

- camp list -> camp detail -> orc inspector 흐름이 사용자의 tmux mental model과 잘 맞는다.
- 상태 badge와 sprite를 함께 사용하면 복수 agent 상태를 빠르게 인지할 수 있다.
- interrupt confirm은 위험 action의 실수를 줄인다.

### 사용성 리스크

- pixel UI가 정보 밀도를 낮추면 power user에게 불편할 수 있다.
- terminal preview redaction이 과하면 작업 판단이 어려워지고, 약하면 민감 정보 노출 위험이 커진다.
- agent 상태 confidence를 보여주지 않으면 잘못된 상태 추론이 제품 신뢰를 해칠 수 있다.

### 권장 보강

- camp detail에서 raw tmux target을 항상 확인 가능하게 둔다.
- status label 옆에 confidence 또는 "estimated" 표시를 제공한다.
- keyboard navigation과 quick switch를 P1로 고려한다.

## Architecture Review

### 강점

- local CLI/server/dashboard 구조가 제품 목표와 보안 요구에 맞다.
- REST snapshot + WebSocket event는 tmux polling 기반 시스템에 적합하다.
- tmux adapter, agent detector, state engine을 분리하면 agent 확장이 쉽다.

### Architecture Risks

- tmux output parsing은 환경과 agent version 변화에 취약하다.
- `send-keys` 기반 control은 powerful하지만 실수 비용이 있다.
- TypeScript child process 기반 구현이 충분히 안정적인지 검증이 필요하다.
- browser auto-open, port 충돌, localhost token 처리 같은 local app edge case가 많다.

### 권장 보강

- `orc-camp scan`을 먼저 구현해 detection 정확도를 제품 UI 이전에 검증한다.
- control action allowlist와 audit event를 초기부터 넣는다.
- tmux command timeout과 target별 error isolation을 P0에 포함한다.

## Issue Register

| Severity | Issue | Owner Area | Status |
| --- | --- | --- | --- |
| P1 | agent 상태 추론 threshold 검증 필요 | backend/product | open |
| P1 | current work summary source와 redaction 순서 결정 필요 | backend/UX | open |
| P1 | 수동 mark/unmark를 P0로 승격할지 결정 필요 | product/UX | open |
| P2 | PixelLab.ai asset license 확인 필요 | design/product | open |
| P2 | TypeScript vs Rust 장기 선택 기준 필요 | architecture | open |
| P2 | mobile dashboard MVP 포함 여부 결정 필요 | UX/frontend | open |

## Final Gate

초기 설계 기준으로 제품 진행은 가능하다. 단, MVP 구현 전 `tmux scan prototype`으로 detection/state 추론을 먼저 검증해야 한다. 이 결과가 낮으면 dashboard polish보다 manual labeling과 confidence 표시를 우선해야 한다.

## Design Handoff Gate

- **판정일**: 2026-06-26
- **판정**: Design handoff ready.
- **범위**: 제품 기획, requirements, UX/UI, frontend/backend/infra 설계, system architecture, PixelLab prompt/asset registry, asset pack manifest를 구현 저장소로 이관한다.
- **남은 blocker**: P0 없음.
- **구현 전 필수 검증**: `orc-camp scan` prototype으로 tmux session/window/pane discovery, Claude Code/Codex detection, state confidence 산출을 검증한다.
- **남은 P1/P2**: Issue Register의 P1/P2 항목은 구현 계획과 검증 milestone에서 추적한다.
