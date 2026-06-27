# 04 Frontend

## 기술 가정

MVP frontend는 TypeScript 기반 web app으로 가정한다.

- App: React + Vite
- State: Zustand 또는 Redux Toolkit 중 lightweight store 우선
- Server state/event: WebSocket + small REST client
- Styling: CSS Modules 또는 vanilla-extract. pixel UI token은 CSS variable로 관리
- Test: Vitest + Testing Library + Playwright

## 라우팅

| Route | 목적 |
| --- | --- |
| `/` | camp list dashboard |
| `/camps/:sessionId` | camp detail |
| `/settings` | local settings |

MVP는 local app이므로 browser history route를 사용하되, deep link가 깨지지 않도록 server fallback을 제공한다.

## 상태 관리

### Client State

- selected camp
- selected orc
- inspector panel open/closed
- terminal preview line count
- command draft
- local UI preference

### Server/Event State

- tmux sessions
- windows/panes
- detected agents
- status snapshot
- current work summary and confidence
- activity events
- control action result

WebSocket event를 canonical update source로 두고, 초기 진입과 복구 시 REST snapshot을 가져온다.

## 주요 컴포넌트

| Component | 역할 |
| --- | --- |
| `AppShell` | layout, connection banner, global command |
| `CampListView` | camp card grid/list |
| `CampCard` | session summary와 상태 count |
| `CampDetailView` | scene, inspector, activity rail orchestration |
| `CampScene` | pixel camp background와 orc sprite 배치 |
| `OrcSprite` | agent status visual |
| `OrcInspector` | selected agent 상세 정보, current work summary, confidence |
| `TerminalPreview` | redacted output preview |
| `CommandDock` | text send, interrupt, attach/copy |
| `ActivityLog` | event stream 표시 |
| `SettingsPanel` | scan/redaction/asset 설정 |

## API 계약

Frontend는 backend의 internal local API만 사용한다.

- `GET /api/snapshot`: 전체 tmux/camp/orc snapshot
- `GET /api/camps/:id`: camp detail snapshot
- `POST /api/orcs/:id/input`: text input 전송
- `POST /api/orcs/:id/key`: allowlist key 입력 전송
- `POST /api/orcs/:id/interrupt`: interrupt action
- `GET /api/settings`: local settings 조회
- `PATCH /api/settings`: local settings 수정
- `WS /api/events`: snapshot delta, status change, control result

## 데이터 흐름

1. app load 시 `/api/snapshot`을 요청한다.
2. WebSocket 연결 후 `snapshot.version` 이후 event를 구독한다.
3. tmux scan delta가 들어오면 store를 갱신한다.
4. 사용자가 control action을 실행하면 optimistic update는 제한적으로만 적용한다.
5. backend의 `control_result` event를 받은 뒤 terminal preview와 status를 갱신한다.

## 오류 처리

- local server 연결 실패: reconnect banner와 retry
- tmux command 실패: camp 또는 orc 단위 error state
- stale/terminated 상태: inspector에서 마지막 정상 metadata와 refresh 안내
- control action 실패: modal/toast와 activity log 양쪽에 기록
- snapshot stale: last updated timestamp와 manual refresh

## 성능 전략

- terminal output preview는 line count와 byte size를 제한한다.
- camp scene sprite animation은 CSS sprite sheet 또는 canvas 중 단순한 방식을 택한다.
- WebSocket event는 debounce/batch 처리해 rapid tmux polling으로 render storm이 나지 않게 한다.
- 큰 snapshot은 camp list summary와 camp detail payload를 분리한다.

## 테스트 전략

- 상태 store reducer/unit test
- API client contract test
- camp list empty/loading/error rendering test
- command dock action confirmation test
- Playwright로 dashboard load, camp selection, control modal flow 검증
- visual regression은 PixelLab.ai asset 도입 이후 추가

## Open Questions

- camp scene을 DOM layout으로 구현할지 canvas로 구현할지 결정이 필요하다. MVP는 접근성과 구현 속도 때문에 DOM sprite를 우선한다.
- terminal preview redaction을 frontend/backend 어디서 수행할지 결정해야 한다. 기본은 backend redaction 후 frontend 표시다.
