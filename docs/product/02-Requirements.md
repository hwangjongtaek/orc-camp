# 02 Requirements

## Review Scope

- **리뷰일**: 2026-06-25
- **기준**: 실제 개인 개발자가 설치해 매일 사용할 수 있는 local-first CLI 제품
- **판정**: 기존 요구사항은 제품 방향은 맞지만 P0 안전성, 진단성, privacy, lifecycle, 상태 confidence, current work 표시 요구가 부족했다. 본 문서는 MVP 구현 티켓으로 분해 가능한 수준으로 보강한다.

## 제품 목표

- tmux session을 Orc camp로 발견하고 표시한다.
- tmux session 내부의 AI agent session을 orc character로 시각화한다.
- agent 종류, 위치, 최근 활동, 현재 작업 추정, 상태와 confidence를 사용자가 빠르게 파악할 수 있게 한다.
- dashboard에서 안전한 범위의 tmux control action을 제공한다.
- terminal output과 local workspace 정보를 기본적으로 local machine 밖으로 보내지 않는다.
- 탐지 실패, tmux 오류, server 연결 끊김, stale snapshot 같은 실제 운영 상태를 사용자에게 명확히 보여준다.

## 제품 가정

- 사용자는 tmux를 이미 사용하거나 설치할 의향이 있는 developer power user다.
- MVP의 주 실행 환경은 macOS + tmux다.
- Linux는 P1 compatibility target으로 둔다.
- Windows native는 비목표이며, WSL + tmux는 문서화 후보로만 둔다.
- dashboard는 local machine의 browser에서 열린다.
- backend는 사용자의 local process로 실행되고 cloud backend를 사용하지 않는다.
- Claude Code와 Codex를 MVP의 우선 agent detector 대상으로 둔다.

## 비목표

- AI agent job scheduler를 MVP에서 제공하지 않는다.
- tmux가 없는 환경에서 자체 terminal multiplexer를 구현하지 않는다.
- 여러 host의 tmux session을 중앙에서 통합 관리하지 않는다.
- agent의 private chain-of-thought 또는 내부 상태를 추출하지 않는다.
- terminal output 전체를 기본 저장하지 않는다.
- remote dashboard, cloud sync, team observer mode를 MVP에서 제공하지 않는다.
- PixelLab.ai asset pipeline이 준비되기 전까지 최종 art quality를 blocker로 삼지 않는다.

## 기능 요구사항

### P0: MVP 필수

#### CLI와 실행 수명주기

- **R-CLI-001**: 사용자가 `orc-camp`를 실행하면 local server가 시작되고 dashboard URL이 생성된다.
- **R-CLI-002**: browser auto-open이 실패해도 CLI는 접속 가능한 dashboard URL을 stdout에 출력해야 한다.
- **R-CLI-003**: 기본 command 외에 `orc-camp scan`, `orc-camp serve`, `orc-camp doctor`를 제공해야 한다.
- **R-CLI-004**: `scan`은 dashboard 없이 tmux discovery와 agent detection 결과를 CLI에 출력해야 한다.
- **R-CLI-005**: `doctor`는 tmux 설치 여부, tmux server 접근 가능 여부, port 사용 가능 여부, config directory 접근 가능 여부를 점검해야 한다.
- **R-CLI-006**: 기본 port가 사용 중이면 사용 가능한 port를 선택하고 실제 URL을 출력해야 한다.
- **R-CLI-007**: 사용자가 process를 종료하면 local server token과 runtime state는 폐기되어야 한다.

#### Tmux Discovery

- **R-TMUX-001**: 실행 중인 tmux session, window, pane inventory를 수집해야 한다.
- **R-TMUX-002**: 각 pane에 대해 tmux target, pane id, session/window/pane index, current command, pane title, working directory, last activity timestamp를 수집해야 한다.
- **R-TMUX-003**: tmux session/window/pane 생성, 삭제, rename, pane 종료가 dashboard에 반영되어야 한다.
- **R-TMUX-004**: tmux command는 timeout을 가져야 하며, 특정 target 실패가 전체 dashboard 장애로 전파되면 안 된다.
- **R-TMUX-005**: scanner는 마지막 정상 snapshot과 현재 stale 상태를 구분해 제공해야 한다.
- **R-TMUX-006**: tmux가 설치되어 있지 않거나 실행 중인 session이 없으면 각각 다른 빈 상태를 제공해야 한다.

#### Agent Detection과 Orc 모델

- **R-ORC-001**: Claude Code와 Codex가 실행 중인 pane을 우선 탐지해야 한다.
- **R-ORC-002**: agent type을 확정할 수 없는 AI agent 후보는 `unknown` orc로 표시해야 한다.
- **R-ORC-003**: 각 orc는 agent type, tmux target, pane id, working directory, current command, status, status confidence, current work summary, summary source, last activity timestamp를 가져야 한다.
- **R-ORC-004**: current work summary는 terminal title, 최근 output, 최근 prompt, user label 중 사용 가능한 source를 명시해야 한다.
- **R-ORC-005**: 자동 추론된 current work summary와 status는 확정 사실처럼 표시하지 않고 confidence 또는 estimated 표시를 제공해야 한다.
- **R-ORC-006**: agent process가 종료되거나 pane이 사라진 경우 orc를 즉시 제거하지 말고 `terminated` 또는 `stale` 상태로 짧게 남겨 사용자가 변화를 인지할 수 있게 해야 한다.
- **R-ORC-007**: agent detector는 Claude Code/Codex 외 agent를 추가할 수 있도록 adapter boundary를 가져야 한다.

#### Dashboard와 UX

- **R-UI-001**: dashboard 첫 화면은 tmux session별 Orc camp 목록을 보여줘야 한다.
- **R-UI-002**: camp card는 session 이름, window/pane 수, detected orc 수, active/waiting/error/stale count, last activity를 표시해야 한다.
- **R-UI-003**: camp detail은 pixel camp scene과 orc character를 보여줘야 한다.
- **R-UI-004**: 사용자가 orc를 선택하면 inspector에서 metadata, status confidence, current work summary, terminal preview, control action을 확인할 수 있어야 한다.
- **R-UI-005**: loading, empty tmux, no session, no agent detected, tmux error, disconnected, stale snapshot 상태를 구분해 표시해야 한다.
- **R-UI-006**: PixelLab.ai asset이 없어도 placeholder pixel asset으로 동일한 layout과 interaction이 동작해야 한다.
- **R-UI-007**: camp/orc metaphor와 별개로 raw tmux target을 항상 확인할 수 있어야 한다.
- **R-UI-008**: camp detail은 orc의 위치와 애니메이션으로 현재 활동(status)을 공간적으로 표현해야 하며, 각 orc의 위치는 기존 Orc 필드(windowIndex/status/paneId)의 결정적 함수여야 하고 새로운 server 좌표 데이터(x/y 등)를 도입하지 않는다.
- **R-UI-010** (proposed, 미승인): camp detail은 활성 배경 환경에 어울리는 **epic 보스 몬스터를 ambient NPC로 1마리** 띄울 수 있어야 한다. 몬스터는 **비-상호작용**(선택/inspector/keyboard 대상 아님)·**비-load-bearing**(데이터 비운반, 자산 미가용 시 placeholder 없이 미렌더)이며, 배경의 walkable **`ground.polygon` 전체**를 결정적으로 roaming하면서 도착 시 무작위(seeded) dwell 애니메이션(active/waiting/idle)을 재생하고, **orc와 footprint 교차 시 `error` 애니메이션으로 래치**된다. 좌표·상태는 client-derived 결정적 함수(서버 좌표 불추가, INV-1)이고 reduced-motion에서 정지하며, orc 배치/zero-layout-shift를 교란하지 않는다. 런타임 거동 [[SPEC-303-epic-monster-npc]], 자산 모델 [[16-Epic-Monster-NPC]], 배경별 art concept [[background-tile-merge-guide]] §6, 결정 [[08-Decisions|D-037]]. 자산 *생성*은 `PIXELLAB_AUTH_HEADER` 보류로 deferred. (`R-UI-009`는 image-ground 정식 승격용으로 예약돼 있어 본 항목은 R-UI-010을 사용한다 — [[SPEC-301-camp-map-movement]] §6 C5.)
- **R-UI-011** (proposed, 미승인): camp detail의 orc inspector(Details)는 선택된 orc의 **character 정체성을 Baldur's Gate 풍 세로 2:3 흉상(bust) portrait**로 패널 **우측**에 표시할 수 있어야 한다. portrait는 **정적 이미지**(애니메이션 없음)이고 character 식별을 돕는 **보조(비-load-bearing) 표현**으로, 어떤 status도 사실로 단언하지 않는다(status는 기존 StatusBadge가 소유). 표시 character는 sprite와 **동일한 결정적 resolve**(sequential `characterKey` → `agentType→character` → mascot 폴백, [[SPEC-300-asset-rendering]] §2.3)로 정하고, prestige tier가 resolved되면([[SPEC-302-mascot-prestige-tiers]]) 그 tier portrait를 쓴다. 장식 frame은 **web UI(CSS)가 소유**(이미지에 미포함)하며, 자산 미가용·manifest 부재 시 **placeholder로 graceful 강등**하고 portrait 유무가 **layout을 흔들지 않는다**(zero-layout-shift). 좁은 화면(mobile sheet)에서는 portrait가 metadata **위로 stack**된다. 런타임/배치 계약 [[SPEC-304-character-avatar-portraits]], 자산 모델·prompt [[17-Character-Avatar-Portraits]], 결정 [[08-Decisions|D-038]]. 자산 *생성*은 deferred(PixelLab 우선 시도 + 외부 image-gen 폴백). (`R-UI-004` inspector 보강의 식별-portrait 축이며, `R-P1-004` agent별 character variant·`R-P2-008` tier와 정합.)

#### Terminal Preview와 Privacy

- **R-PRIV-001**: terminal preview는 기본 line count와 byte size limit을 가져야 한다.
- **R-PRIV-002**: terminal preview는 backend에서 기본 redaction을 적용한 뒤 frontend에 전달해야 한다.
- **R-PRIV-003**: 기본 redaction은 일반적인 token/key/env secret pattern, URL credential, private key block을 가려야 한다.
- **R-PRIV-004**: terminal output 전체 저장은 기본 비활성화해야 한다.
- **R-PRIV-005**: debug log에는 captured terminal output 원문을 기본 저장하지 않아야 한다.
- **R-PRIV-006**: 사용자는 terminal preview 노출 여부와 preview line count를 조정할 수 있어야 한다.

#### Control Action

- **R-CTRL-001**: 사용자는 선택한 orc에게 text input을 전송할 수 있어야 한다.
- **R-CTRL-002**: 사용자는 allowlist key만 전송할 수 있어야 한다.
- **R-CTRL-003**: interrupt action은 확인 modal을 요구해야 한다.
- **R-CTRL-004**: 모든 state-changing control API는 startup token을 요구해야 한다.
- **R-CTRL-005**: backend는 control 실행 직전에 tmux target이 여전히 같은 pane id와 agent metadata에 매핑되는지 재검증해야 한다.
- **R-CTRL-006**: control modal은 agent type, tmux target, working directory, current command를 표시해야 한다.
- **R-CTRL-007**: control action 결과는 activity log에 성공/실패와 함께 기록되어야 한다.
- **R-CTRL-008**: API는 arbitrary shell command execution을 제공하면 안 된다.

#### Realtime Sync와 API

- **R-API-001**: frontend는 REST snapshot으로 초기 상태를 가져오고 WebSocket event로 변경 사항을 받아야 한다.
- **R-API-002**: WebSocket 연결이 끊기면 dashboard는 disconnected 상태를 표시하고 REST snapshot으로 복구할 수 있어야 한다.
- **R-API-003**: event는 snapshot version 또는 sequence id를 포함해야 한다.
- **R-API-004**: dashboard는 manual refresh를 제공해야 한다.
- **R-API-005**: API error는 사용자에게 보이는 event와 local debug log에 분리 기록되어야 한다.

#### Settings와 Local Persistence

- **R-SET-001**: scan interval, preview line count, preview 노출 여부, browser auto-open preference를 local config에 저장할 수 있어야 한다. secret redaction은 사용자 비활성화 대상이 아니라 상시 활성(floor-lock)이며, 조정 가능한 범위는 비-secret 표시 옵션으로 한정한다([[08-Decisions|D-027]], [[SPEC-500-settings-persistence]]).
- **R-SET-002**: local config에는 terminal output 원문을 저장하지 않아야 한다.
- **R-SET-003**: config path는 `doctor` command에서 확인 가능해야 한다.

#### 보안과 네트워크

- **R-SEC-001**: local server는 기본적으로 `127.0.0.1`에만 bind되어야 한다.
- **R-SEC-002**: dashboard URL은 startup token을 포함해야 한다.
- **R-SEC-003**: state-changing API는 token 없는 요청을 거부해야 한다.
- **R-SEC-004**: 외부 bind는 MVP에서 제공하지 않거나, 명시 flag와 warning 없이는 불가능해야 한다.
- **R-SEC-005**: CORS는 dashboard origin과 localhost development origin으로 제한해야 한다.

#### Diagnostics와 Observability

- **R-OBS-001**: activity log는 scanner event, status change, control action, tmux error, reconnect event를 표시해야 한다.
- **R-OBS-002**: local debug log는 scanner/API/control 오류와 timing을 기록해야 한다.
- **R-OBS-003**: local debug log에는 secret redaction을 적용해야 한다.
- **R-OBS-004**: 사용자는 debug log 위치를 `doctor` 결과에서 확인할 수 있어야 한다.

### P1: 제품 사용성/확장성 보강

- **R-P1-001**: 사용자가 camp/orc alias와 current work note를 지정하고 local config에 저장할 수 있다.
- **R-P1-002**: 사용자가 특정 pane을 수동으로 orc로 mark/unmark할 수 있다.
- **R-P1-003**: user-defined redaction rule을 추가할 수 있다.
- **R-P1-004**: agent별 sprite variant와 상태별 animation을 적용한다.
- **R-P1-005**: camp별 background와 asset pack을 변경할 수 있다.
- **R-P1-006**: session history, event history, alias, user preference를 SQLite에 저장할 수 있다.
- **R-P1-007**: 사용자는 dashboard에서 tmux attach command를 복사할 수 있다.
- **R-P1-008**: waiting/error 상태에 대한 desktop notification 또는 dashboard notification을 제공한다.
- **R-P1-009**: keyboard navigation, quick switch, command palette를 제공한다.
- **R-P1-010**: Linux + tmux compatibility를 검증하고 문서화한다.
- **R-P1-011**: agent detector rule을 config 또는 plugin 형태로 확장할 수 있다.
- **R-P1-012**: terminal preview를 live tail mode로 볼 수 있다.
- **R-P1-013**: status 변화 시 orc가 roaming walk-cycle 애니메이션으로 새 위치로 이동하고, 이동 방향을 8방향으로 표현한다.

### P2: 장기 확장

- **R-P2-001**: 새 AI agent session을 dashboard에서 시작한다.
- **R-P2-002**: camp template을 저장하고 재사용한다.
- **R-P2-003**: 여러 machine의 remote camp를 SSH tunnel 기반으로 연결한다.
- **R-P2-004**: team read-only observer mode를 제공한다.
- **R-P2-005**: agent action replay와 timeline 분석을 제공한다.
- **R-P2-006**: workflow automation과 agent handoff를 제공한다.
- **R-P2-007**: enterprise policy pack, audit export, remote access policy를 제공한다.
- **R-P2-008** (proposed, 미승인): delivered character(`orc-high-warchief-mascot`·`orc-claude-storm-shaman`·`orc-codex-field-engineer`·`orc-unknown`·`orc-iron-commander` 5종)가 그 orc의 **누적 LLM token/cost**에 따라 외형 prestige tier(갑옷/의장·장비·`active` 연출 강화)를 단계적으로 바꾼다. `orc-iron-commander`도 pool roaming skin으로 배정된 orc의 usage로 tier를 가지며, 그 control/interrupt 상징 역할은 tier와 무관한 별개 축이다([[SPEC-400-control-actions]]). 자산 모델 [[15-Character-State-Model]], 런타임 계약 [[SPEC-302-mascot-prestige-tiers]], 결정 [[08-Decisions|D-036]]. 데이터 의존(`Orc.usage` 신규 수집)은 forward.

## 비기능 요구사항

| 영역 | 요구사항 |
| --- | --- |
| Local-first | 기본 실행은 local process와 localhost dashboard로 완료되어야 한다. |
| 보안 | control API는 token, target 재검증, action allowlist, confirm modal을 가져야 한다. |
| 개인정보 | terminal output 원문은 기본 저장하지 않고, preview와 log에는 redaction을 적용한다. |
| 성능 | 20개 session, 100개 pane 기준 dashboard 조작이 끊기지 않아야 한다. |
| Scan latency | 일반 환경에서 scan 주기는 1-5초 범위로 설정 가능해야 하며, 단일 scan이 timeout 없이 장시간 block되면 안 된다. |
| 신뢰성 | tmux command 실패, WebSocket 끊김, port 충돌, browser open 실패가 전체 제품 실패로 이어지면 안 된다. |
| 확장성 | agent detector, status parser, control adapter는 agent별 확장을 고려한다. |
| 사용성 | terminal 사용자가 1분 안에 camp list, orc status, control 대상의 의미를 이해할 수 있어야 한다. |
| 접근성 | 색상만으로 상태를 구분하지 않고 icon, label, animation state를 함께 제공한다. keyboard navigation을 보장한다. |
| 관측성 | 사용자가 문제를 신고할 때 terminal 원문 없이도 doctor 결과와 debug log로 원인 파악이 가능해야 한다. |
| 배포 | MVP는 npm global install을 우선 가정하고, uninstall 후 config/log 잔존 정책을 문서화한다. |

## 수용 기준

### Launch

- tmux가 설치된 macOS에서 `orc-camp` 실행 후 10초 이내 dashboard URL이 출력된다.
- browser auto-open이 실패해도 사용자는 출력된 URL로 dashboard에 접속할 수 있다.
- 기본 port가 점유되어 있어도 다른 port로 server가 시작된다.
- `orc-camp doctor`가 tmux, port, config path, log path 점검 결과를 출력한다.

### Discovery

- tmux session이 1개 이상 있을 때 dashboard 첫 화면에 camp card가 표시된다.
- tmux session이 없을 때는 "tmux 미실행" 상태와 session 생성 안내가 표시된다.
- Claude Code 또는 Codex가 실행 중인 pane이 있으면 camp detail에 orc character가 표시된다.
- pane이 종료되면 해당 orc가 `terminated` 또는 `stale` 상태로 표시된 뒤 snapshot에서 정리된다.

### Observation

- 각 orc inspector는 agent type, tmux target, cwd, current command, status, confidence, current work summary를 표시한다.
- current work summary가 추정값이면 UI에 estimated/confidence가 표시된다.
- terminal preview는 설정된 line/byte limit을 넘지 않는다.
- terminal preview와 debug log에는 기본 redaction이 적용된다.

### Control

- dashboard에서 text input을 전송하면 선택한 tmux pane에만 입력된다.
- backend는 control 실행 직전 pane id와 target을 재검증한다.
- interrupt action은 확인 후에만 해당 tmux pane으로 전달된다.
- 실패한 control action은 activity log에 실패 원인과 함께 기록된다.
- token 없는 state-changing API 요청은 거부된다.

### Realtime/Recovery

- dashboard refresh 없이 agent 상태 변경이 반영된다.
- WebSocket 연결이 끊기면 disconnected banner가 표시되고 reconnect 후 REST snapshot으로 복구된다.
- scanner 오류가 발생해도 마지막 정상 snapshot이 stale 표시와 함께 유지된다.

## 상태 모델

| 상태 | 의미 | 표시 |
| --- | --- | --- |
| `unknown` | agent 여부 또는 상태를 확정할 수 없음 | 회색 idle sprite, 낮은 confidence |
| `active` | 최근 output 또는 command activity가 있음 | 작업 animation |
| `waiting` | 사용자 입력 대기 가능성이 높음 | 말풍선/대기 icon |
| `idle` | 일정 시간 activity가 없음 | campfire 주변 idle pose |
| `error` | 오류 pattern, tmux 실패, control 실패와 연결됨 | 경고 icon |
| `terminated` | agent process 또는 pane이 종료됨 | fade-out sprite, 종료 label |
| `stale` | scanner 실패 또는 오래된 snapshot 기반 상태 | clock/stale badge |

## 데이터 보존 정책

| 데이터 | MVP 기본값 | 비고 |
| --- | --- | --- |
| tmux inventory snapshot | memory only | dashboard runtime state |
| terminal preview | memory only, limited lines | backend redaction 후 전달 |
| activity event | memory ring buffer | control 결과 포함 |
| config | local file | output 원문 저장 금지 |
| debug log | local file | terminal output 원문 저장 금지 |
| full session history | disabled | P1 opt-in |

## Requirements Gap Review

이번 보강에서 추가하거나 승격한 항목:

- launch 실패, browser open 실패, port 충돌, tmux 미설치 같은 실제 제품 edge case를 P0에 추가했다.
- `scan`, `serve`, `doctor` command를 P0로 명시했다.
- current work summary, source, confidence를 orc 모델의 P0 필드로 추가했다.
- terminal preview redaction과 output non-persistence를 P0로 승격했다.
- startup token, CORS 제한, state-changing API token 검증을 P0로 명시했다.
- control action의 target 재검증과 audit/activity event 기록을 P0로 추가했다.
- WebSocket reconnect, stale snapshot, terminated/stale status를 P0로 추가했다.
- config/log/diagnostics 요구사항을 제품 운영 관점에서 추가했다.

## Open Questions

- `active`, `waiting`, `idle` 판정 threshold의 기본값은 얼마로 둘 것인가?
- current work summary를 최근 output에서 추출할 때 redaction 전/후 어느 데이터를 기준으로 할 것인가?
- 기본 redaction pattern의 false positive가 작업 이해를 방해하지 않는지 검증이 필요하다.
- dashboard control action을 keyboard shortcut으로 제공할지, click action으로만 제공할지 결정이 필요하다.
- MVP에서 수동 mark/unmark를 P0로 당길지, P1로 유지할지 discovery prototype 결과를 보고 결정한다.

