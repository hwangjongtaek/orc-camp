# 05 Backend

## 역할

Orc Camp backend는 CLI process 안에서 실행되는 local server다. tmux 상태를 수집하고, AI agent session을 식별하며, dashboard에 snapshot/event API를 제공하고, 사용자의 control action을 tmux pane으로 전달한다.

## 기술 가정

MVP는 TypeScript monorepo를 가정한다.

- CLI/server: Node.js + TypeScript
- HTTP server: Fastify 또는 Hono
- WebSocket: native ws 또는 framework plugin
- tmux integration: `child_process`로 `tmux` command 호출
- local persistence: JSON config에서 시작, P1에서 SQLite 검토

tmux control의 안정성과 배포 단일 binary가 중요해지면 Rust backend로 재검토한다.

## 도메인 모델

```text
Camp
  id
  tmuxSessionName
  windows[]
  orcs[]
  statusSummary
  lastActivityAt

Orc
  id
  agentType
  tmuxTarget
  sessionName
  windowIndex
  paneIndex
  paneId
  cwd
  command
  status
  statusConfidence
  currentWorkSummary
  summarySource
  lastActivityAt
  preview

ActivityEvent
  id
  type
  target
  severity
  message
  createdAt
```

## Agent Detection

### 1. tmux inventory 수집

- `tmux list-sessions`
- `tmux list-windows -a`
- `tmux list-panes -a -F ...`
- `tmux capture-pane -p -t <target> -S -<lines>`

### 2. Agent 후보 판정

- pane command가 `claude`, `codex`, 알려진 agent binary인 경우
- pane title 또는 command line에 agent signature가 있는 경우
- 최근 output에 agent-specific prompt/status pattern이 있는 경우
- 사용자가 alias 또는 manual mark를 지정한 경우

### 3. 상태 추론

- 최근 output 변경 여부
- prompt/input 대기 pattern
- pane process alive 여부
- error keyword 또는 exit state
- adapter별 parser result

상태 추론은 항상 `statusConfidence`를 함께 제공한다. 확신할 수 없으면 `unknown` 또는 낮은 confidence로 반환한다.
현재 작업 추정은 `currentWorkSummary`와 `summarySource`로 분리한다. source는 `pane_title`, `recent_output`, `recent_prompt`, `user_label`, `unknown` 중 하나로 시작한다.

## API 설계

### REST

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/health` | local server 상태 |
| `GET` | `/api/snapshot` | 전체 camp/orc snapshot |
| `GET` | `/api/camps/:campId` | camp 상세 snapshot |
| `POST` | `/api/orcs/:orcId/input` | text 입력 전송 |
| `POST` | `/api/orcs/:orcId/key` | 제한된 key 입력 전송 |
| `POST` | `/api/orcs/:orcId/interrupt` | interrupt 전송 |
| `GET` | `/api/settings` | local settings |
| `PATCH` | `/api/settings` | settings 수정 |

### WebSocket Event

```json
{
  "type": "orc_status_changed",
  "version": 42,
  "campId": "session:work",
  "orcId": "pane:%12",
  "status": "waiting",
  "createdAt": "2026-06-25T10:00:00+09:00"
}
```

## Control Actions

| Action | tmux 처리 | 안전 장치 |
| --- | --- | --- |
| text input | `tmux send-keys -t <target> -l -- <text>` 후 `Enter` 전송 | target 확인 |
| key input | allowlist key만 `send-keys` | allowlist |
| interrupt | `tmux send-keys -t <target> C-c` | confirm required |
| attach command | command copy 또는 spawn terminal 검토 | MVP는 copy 우선 |

control action 실행 직전에는 orc id가 가리키는 tmux pane id, target, current command가 마지막 snapshot과 호환되는지 재검증한다. 재검증에 실패하면 action을 중단하고 activity event에 실패 원인을 기록한다.

## 인증/권한

- MVP local server는 `127.0.0.1` binding을 기본으로 한다.
- server startup 시 random session token을 생성하고 dashboard URL에 포함한다.
- state-changing API는 token을 요구한다.
- 외부 network binding은 config opt-in과 warning을 요구한다.

## 데이터 저장

### MVP

- config: user config directory의 JSON file
- runtime state: memory
- event history: memory ring buffer

### P1

- SQLite로 session alias, history, event, user preference 저장
- 민감 output 저장은 opt-in

## 비동기 처리

- tmux scanner는 interval polling으로 snapshot을 만든다.
- scan result는 diff engine을 거쳐 event stream으로 변환한다.
- long-running tmux command는 timeout을 둔다.
- tmux command 실패는 전체 scan 실패가 아니라 target별 error로 기록한다.

## 보안 리스크

- terminal output에 token, key, private path가 포함될 수 있다.
- dashboard input 전송은 잘못된 pane에 command를 보낼 위험이 있다.
- localhost token이 유출되면 local API가 악용될 수 있다.
- remote binding을 허용하면 terminal control surface가 외부에 노출된다.
- current work summary가 terminal output 기반일 때 민감 정보가 요약 field로 누출될 수 있다.

## Open Questions

- process command line을 cross-platform으로 얼마나 안정적으로 얻을 수 있는가?
- tmux pane별 process tree introspection이 필요한가?
- Claude Code/Codex 상태 pattern을 제품 코드에 내장할지, adapter package로 분리할지 결정해야 한다.
