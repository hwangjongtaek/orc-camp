# 01 Planning

## 배경

AI coding agent를 여러 개 동시에 실행하면 터미널 탭, tmux pane, 작업 상태가 빠르게 흩어진다. 사용자는 각 agent가 어느 프로젝트에서 무엇을 하고 있는지, 멈춰 있는지, 입력을 기다리는지, 위험한 command 직전인지 확인하기 위해 여러 terminal을 직접 순회해야 한다.

Orc Camp는 이 문제를 tmux 기반 local orchestration layer로 해결한다. tmux session을 camp로, AI agent session을 orc character로 표현해 복수 agent 운영을 한 화면에서 파악하고 제어할 수 있게 한다.

## 문제 정의

- 여러 tmux session에서 실행 중인 AI agent 상태를 한눈에 볼 수 없다.
- agent가 작업 중인지, 사용자 입력을 기다리는지, 오류로 멈췄는지 파악하기 어렵다.
- 특정 agent에게 입력을 보내거나 interrupt하는 작업이 터미널 문맥 전환에 의존한다.
- 장시간 병렬 작업을 맡긴 뒤 진행 상황을 추적할 lightweight dashboard가 없다.
- terminal output에는 민감 정보가 섞일 수 있어 무분별한 원격 전송은 위험하다.

## 제품 가설

local tmux 상태를 자동 수집하고 게임형 dashboard로 시각화하면, 복수 AI agent를 운영하는 개발자가 더 빠르게 상태를 파악하고 필요한 개입을 줄일 수 있다.

## 타깃 사용자

- tmux를 사용해 여러 개발 작업을 병렬로 운영하는 software engineer
- Claude Code, Codex 등 CLI 기반 AI coding agent를 자주 쓰는 개발자
- agent 여러 개에 작업을 나눠 맡기고 진행 상황을 관찰하려는 power user
- terminal 중심 workflow를 유지하되 시각적 관제 화면을 원하는 사용자

## 주요 사용 시나리오

1. 사용자가 `orc-camp`를 실행한다.
2. CLI가 local tmux server를 scan하고 web dashboard를 localhost에 띄운다.
3. dashboard 첫 화면에는 tmux session별 Orc camp가 나열된다.
4. 사용자가 특정 camp에 들어가면 해당 tmux session의 window/pane에서 감지된 AI agent session이 orc character로 표시된다.
5. 사용자는 각 orc의 상태, 최근 활동, 현재 작업 추정, working directory, agent 종류를 확인한다.
6. 필요하면 특정 orc를 선택해 terminal preview를 보거나, text input/send key/interrupt 같은 제한된 control action을 실행한다.

## 고객 가치

- agent 운영 상황을 한 화면에서 파악한다.
- terminal context switching을 줄인다.
- 장시간 실행 중인 작업의 이상 상태를 빠르게 발견한다.
- local-first 구조로 terminal output과 workspace 정보를 외부로 보내지 않는다.
- 도트 기반 camp metaphor로 복잡한 orchestration 상태를 직관적으로 이해한다.

## 비즈니스 검토

### 시장/세그먼트

초기 시장은 AI coding agent를 적극적으로 사용하는 developer power user다. 특히 tmux, terminal multiplexer, CLI coding agent를 이미 쓰는 사용자가 명확한 early adopter다.

### 차별화

- 단순 terminal multiplexer wrapper가 아니라 AI agent session 상태를 제품의 1급 개념으로 둔다.
- local-first dashboard로 민감한 terminal context를 외부 서비스에 전송하지 않는다.
- camp/orc metaphor와 pixel UI로 복수 agent 상태를 빠르게 인지할 수 있게 한다.

### 수익성 가정

MVP는 개인 productivity tool로 검증한다. 이후 유료화는 pro 기능, team mode, remote observer, agent run history, workflow automation, enterprise policy pack으로 확장 가능하다.

### GTM

- 개인 개발자용 CLI로 공개한다.
- Claude Code/Codex power user 커뮤니티와 tmux 사용자층을 우선 공략한다.
- 데모는 "여러 agent가 camp 안에서 일하는 화면"을 중심으로 전달한다.

## 성공 지표

- 첫 실행 후 dashboard가 10초 안에 열리는 비율
- tmux session/pane 탐지 성공률
- Claude Code/Codex agent session 식별 정확도
- 사용자가 dashboard에서 camp detail까지 진입하는 비율
- control action 실행 후 terminal 상태와 dashboard 상태가 일치하는 비율
- 주간 활성 사용자당 관찰한 agent session 수

## 비목표

- AI agent 자체를 새로 구현하지 않는다.
- tmux를 대체하지 않는다.
- 초기 버전에서 remote host, Kubernetes, cloud dashboard를 지원하지 않는다.
- agent의 내부 reasoning이나 private context를 강제로 추출하지 않는다.

## Open Questions

- "현재 하고 있는 일"은 terminal title, 최근 output, user-provided label, agent status hook 중 어떤 조합으로 표현할 것인가?
- 각 agent session의 lifecycle을 pane lifecycle과 동일하게 볼 수 있는가?
- 사용자가 직접 camp/orc 이름을 부여하는 기능이 MVP에 필요한가?

