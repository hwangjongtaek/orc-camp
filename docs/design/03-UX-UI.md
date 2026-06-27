# 03 UX/UI

## UX 원칙

- 첫 화면에서 "어떤 camp가 있고, 어디에 agent가 멈춰 있는가"를 즉시 보여준다.
- camp/orc 은유는 인지를 돕는 장치로 쓰고, 실제 tmux 정보는 항상 확인 가능하게 둔다.
- control action은 가까이 두되, 위험 action은 확인과 명확한 대상 표시를 요구한다.
- terminal output은 필요한 만큼만 보여주고, 민감 정보 노출 가능성을 계속 인지시킨다.

## 정보 구조

```text
Dashboard
  Camp List
    Camp Summary
    Global Activity
    Settings
  Camp Detail
    Pixel Camp Scene
    Orc Inspector
    Terminal Preview
    Command Dock
    Activity Log
```

## 화면 목록

### 1. Camp List

- tmux session별 camp card를 표시한다.
- card에는 session 이름, windows/panes 수, detected orcs 수, 상태 summary, last activity를 표시한다.
- 빈 상태에서는 tmux가 없거나 session이 없음을 구분해 보여준다.

### 2. Camp Detail

- 선택한 tmux session을 camp scene으로 표현한다.
- 감지된 AI agent pane은 orc sprite로 표시한다.
- 각 orc는 agent type, status, pane id, working directory를 inspector에서 확인할 수 있다.
- window/pane grouping은 camp area 또는 lane으로 표현한다.

### 3. Orc Inspector

- 선택한 orc의 상세 상태를 보여준다.
- 기본 정보: agent type, command, tmux target, cwd, current work summary, summary source, last activity, status confidence.
- 최근 terminal output preview를 포함한다.
- text input, send, interrupt, attach/copy action을 제공한다.

### 4. Command Dock

- 선택한 orc에게 보낼 text input을 작성한다.
- send action과 interrupt action은 분리한다.
- interrupt는 confirm modal을 띄우고 tmux target을 명시한다.

### 5. Activity Log

- scan event, agent status change, user control action, tmux error를 시간순으로 보여준다.
- log는 session-local 표시를 기본으로 하고 저장은 opt-in이다.

### 6. Settings

- scan interval
- terminal preview line count
- redaction on/off 및 redaction rule
- camp/orc alias
- asset pack selection

## 사용자 여정

### Journey A: 현재 agent 상태 확인

1. 사용자가 `orc-camp`를 실행한다.
2. dashboard가 열리고 camp list가 보인다.
3. waiting 또는 error badge가 있는 camp를 클릭한다.
4. camp detail에서 해당 orc sprite를 선택한다.
5. inspector에서 최근 output과 상태 confidence를 확인한다.

### Journey B: 특정 agent에게 입력 전송

1. 사용자가 camp detail에서 orc를 선택한다.
2. terminal preview로 대상이 맞는지 확인한다.
3. command dock에 입력할 text를 작성한다.
4. send를 실행한다.
5. activity log에 control action과 결과가 표시된다.

### Journey C: 멈춘 agent interrupt

1. error 또는 long-running 상태의 orc를 선택한다.
2. interrupt action을 누른다.
3. confirm modal에서 agent type, tmux target, cwd를 확인한다.
4. 확인하면 `C-c`가 해당 pane으로 전달된다.
5. dashboard는 후속 상태를 갱신한다.

## 상태 설계

| 상태 | UI 처리 |
| --- | --- |
| Loading | campfire loading animation과 "Scanning tmux sessions" 표시 |
| Empty tmux | tmux 미설치와 session 없음 상태를 분리 |
| Empty camp | camp scene은 표시하되 "No agents detected" 상태 |
| Unknown agent | ghost/placeholder orc로 표시하고 confidence 낮음을 명시 |
| Error | error badge, tmux command 실패 message, retry action |
| Disconnected | local server 연결 끊김 banner와 reconnect 상태 |
| Terminated | 종료된 orc를 짧게 남겨 원인을 확인할 수 있게 표시 |
| Stale snapshot | 마지막 정상 snapshot을 유지하되 stale badge와 manual refresh 표시 |

## 접근성

- 모든 icon button은 accessible label과 tooltip을 가진다.
- keyboard navigation은 camp card, orc sprite, inspector action 순서를 보장한다.
- `prefers-reduced-motion`에서 sprite animation을 정지 image로 대체한다.
- terminal preview는 text selection과 copy가 가능해야 한다.
- color contrast는 dark background 기준 WCAG AA를 목표로 한다.

## Pixel Art 적용 방식

- camp scene은 실제 조작 표면이다. 장식 배경이 아니라 agent 위치와 상태를 드러내야 한다.
- sprite 크기는 최소 48px logical size를 확보한다.
- state effect는 sprite 주변에 겹치되 status badge text를 가리지 않는다.
- 실제 asset pack은 준비되어 있다([[14-MVP-PoC-Scope]] 런타임 Asset 계약). PoC(scan 슬라이스)는 asset 렌더 없이 진행하고, camp scene 렌더 슬라이스는 south/idle 정적 frame부터 소비한다. asset 미탑재/누락 시에는 placeholder sprite와 tile background로 동일 layout을 유지한다.

## Open Questions

- camp detail에서 tmux window를 실제 공간으로 표현할지, agent 중심으로 재배치할지 결정이 필요하다.
- terminal preview의 default 노출 범위가 UX와 보안 사이에서 적절한지 검증해야 한다.
- mobile dashboard를 MVP에 포함할지, desktop-first로 제한할지 결정해야 한다.
- current work summary가 추정값임을 어느 정도로 강조해야 사용자가 오해하지 않는지 검증해야 한다.
