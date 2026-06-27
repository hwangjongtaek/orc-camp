# 07 Roadmap

## MVP 목표

현재 machine의 tmux session을 Orc camp로 시각화하고, Claude Code/Codex agent session의 상태 확인과 제한된 제어를 가능하게 한다.

## Milestone 0: Discovery Prototype

- tmux session/window/pane inventory 수집
- Claude Code/Codex 후보 pane 탐지
- CLI `orc-camp scan` 출력
- 상태 confidence 모델 초안

## Milestone 1: Local Dashboard Skeleton

- `orc-camp` 실행 시 local server와 browser open
- camp list 화면
- camp detail 화면
- WebSocket event stream
- empty/loading/error 상태

## Milestone 2: Orc Interaction MVP

- orc inspector
- terminal preview
- text input send
- interrupt confirm flow
- activity log
- local token guard

## Milestone 3: Pixel Camp Experience

- placeholder pixel camp scene
- sprite status animation
- PixelLab.ai asset pack integration
- camp/orc visual identity 정리
- reduced motion 대응

## Milestone 4: Persistence and Customization

- camp/orc alias 저장
- settings panel
- redaction rule
- event history opt-in
- scan interval tuning

## Milestone 5: Packaging and Distribution

- npm package
- `doctor` command
- macOS/Linux smoke test
- onboarding docs
- demo recording

## 우선순위

### P0

- tmux discovery
- local dashboard
- agent detection
- status display
- terminal preview
- text input/interrupt
- localhost security guard

### P1

- alias/customization
- PixelLab.ai final assets
- redaction controls
- history storage
- Linux validation

### P2

- remote camps
- dashboard에서 agent start
- multi-user/team observer
- workflow automation

## 리스크

- AI agent 상태 추론 정확도가 낮으면 dashboard 신뢰도가 떨어진다.
- tmux pane control은 잘못된 대상에 command를 보낼 위험이 있다.
- terminal preview가 민감 정보를 노출할 수 있다.
- pixel UI가 기능적 dashboard보다 장식적으로 보이면 사용성이 떨어진다.

## 검증 실험

- 실제 Claude Code/Codex pane 5개 이상을 실행하고 detection 정확도 측정
- 20개 pane 이상에서 scan latency 측정
- 사용자 1명이 dashboard만 보고 어느 agent가 입력 대기 중인지 맞힐 수 있는지 테스트
- interrupt confirm flow가 잘못된 pane action을 방지하는지 테스트

## Open Questions

- MVP demo를 실제 PixelLab.ai asset으로 할지 placeholder로 할지 결정해야 한다.
- remote camp는 제품 차별화에 중요하지만 보안/운영 복잡도가 크므로 별도 단계로 분리한다.

