# 14 MVP PoC Scope

이 문서는 design-handoff 상태의 blueprint를 "지금 바로 착수 가능한 최소 구현 단위"로 좁힌다. blueprint 문서(`01`~`13`)가 *무엇을 만들지*를 정의한다면, 이 문서는 *가장 먼저 어디까지만 만들지*를 고정한다.

- **1차 슬라이스**: `orc-camp scan` CLI (tmux 발견 + agent 탐지 + 상태 추론, 출력만).
- **상위 연결**: [[07-Roadmap]] Milestone 0(Discovery Prototype), [[09-Reviews]] Design Handoff Gate의 "구현 전 필수 검증".
- **비범위**: local server, dashboard, WebSocket, control action, asset 렌더링은 이 슬라이스에 포함하지 않는다.

## 왜 scan 슬라이스가 먼저인가

- 제품 핵심 가치는 tmux/agent orchestration이고, 가장 큰 미검증 리스크는 **AI agent 상태 추론 정확도**다([[07-Roadmap]] 리스크, [[09-Reviews]] Final Gate).
- dashboard polish와 PixelLab asset 렌더링은 detection이 신뢰 가능할 때만 가치가 있다. detection이 부정확하면 잘못된 상태를 더 그럴듯하게 보여줄 뿐이다.
- scan은 UI/asset/server 없이 핵심 가설을 검증하는 가장 얇은 수직 슬라이스다. `child_process`로 `tmux`를 호출하고 결과를 stdout으로 내보내는 단일 경로만 필요하다.
- 이 슬라이스의 산출물(camp/orc 데이터 + confidence)은 이후 모든 슬라이스(snapshot API, dashboard, control)가 그대로 재사용하는 도메인 모델이다([[05-Backend]] 도메인 모델).

## 범위

### In scope

- `orc-camp scan` 단일 command (다른 command/서버는 만들지 않는다).
- tmux inventory 수집: sessions / windows / panes ([[02-Requirements]] R-TMUX-001, R-TMUX-002).
- pane metadata: tmux target, pane id, session/window/pane index, current command, pane title, working directory, last activity timestamp.
- agent 탐지: Claude Code / Codex / `unknown` ([[02-Requirements]] R-ORC-001, R-ORC-002).
- 상태 추론: `status` + `statusConfidence` + `currentWorkSummary` + `summarySource` ([[02-Requirements]] R-ORC-003 ~ R-ORC-005).
- 출력: 사람이 읽는 table 기본, `--json`으로 machine-readable 출력.
- 안전/프라이버시 최소선: capture line/byte limit, 기본 redaction, output 원문 비저장, tmux command timeout, target별 error isolation.

### Out of scope (이 슬라이스에서 제외)

| 항목 | 이유 | 어느 슬라이스로 |
| --- | --- | --- |
| local HTTP/WebSocket server | scan은 stdout만으로 가설 검증 가능 | Slice 2 |
| web dashboard / camp scene | detection 검증이 선행 | Slice 2~3 |
| asset 렌더링 (sprite/effect) | 시각 품질은 후순위, asset 계약만 본 문서에서 고정 | Slice 3 |
| control action (send-keys/interrupt) | scan은 **read-only**여야 한다 | Slice 4 |
| persistence (config/SQLite) | runtime in-memory로 충분 | P1 |
| 사용자 alias / manual mark | detection 정확도 측정 후 P0 승격 여부 결정 | P1 ([[09-Reviews]] Issue Register) |

> **read-only 보장**: scan slice는 어떤 경우에도 `tmux send-keys`/`paste-buffer` 등 상태 변경 command를 호출하지 않는다. tmux 호출은 `list-sessions`, `list-windows`, `list-panes`, `capture-pane`로 제한한다.

## 최소 데이터 계약 (`orc-camp scan --json`)

> **SSOT는 [[SPEC-005-data-contract]]다([[08-Decisions|D-018]]).** 아래 예시는 설명용 subset이며, 충돌 시 SPEC-005를 따른다. id 권위는 `paneId`/`sessionId`이고 `tmuxTarget`/`sessionName`은 표시 전용이다([[08-Decisions|D-017]]). `preview`는 기본 metadata-only(text 미렌더)다.

[[05-Backend]] 도메인 모델의 subset이다. 이 슬라이스에서는 `preview`를 redacted metadata로만 포함하고, control 관련 필드는 두지 않는다.

```json
{
  "schemaVersion": 1,
  "scannedAt": "2026-06-26T10:00:00+09:00",
  "stale": false,
  "lastGoodAt": "2026-06-26T10:00:00+09:00",
  "tmux": { "installed": true, "serverRunning": true, "version": "3.4" },
  "statusSummary": { "active": 1, "waiting": 1, "idle": 0, "error": 0, "stale": 0, "terminated": 0, "unknown": 0 },
  "camps": [
    {
      "id": "session:$0",
      "sessionId": "$0",
      "tmuxSessionName": "work",
      "windowCount": 3,
      "paneCount": 5,
      "orcCount": 2,
      "statusSummary": { "active": 1, "waiting": 1, "idle": 0, "error": 0, "stale": 0, "terminated": 0, "unknown": 0 },
      "lastActivityAt": "2026-06-26T09:59:40+09:00",
      "orcs": [
        {
          "id": "pane:%12",
          "paneId": "%12",
          "agentType": "claude-code",
          "agentTypeConfidence": 0.95,
          "tmuxTarget": "work:1.0",
          "sessionName": "work",
          "windowIndex": 1,
          "paneIndex": 0,
          "cwd": "/Users/me/proj",
          "command": "node",
          "status": "active",
          "statusConfidence": 0.8,
          "currentWorkSummary": "Editing src/server.ts",
          "summarySource": "recent_output",
          "summaryIsEstimated": true,
          "lastActivityAt": "2026-06-26T09:59:40+09:00",
          "preview": { "lines": 12, "truncated": true, "redacted": true }
        }
      ]
    }
  ],
  "diagnostics": { "tmuxErrors": [], "scanDurationMs": 180 }
}
```

> 위 예시는 SPEC-005의 필드 일부만 보인다(`agentSignals`/`statusSignals` 등은 생략). 전체 필드·타입·enum은 [[SPEC-005-data-contract]] 참조.

빈 상태는 `(tmux.installed, tmux.serverRunning, camps)` 조합으로 구분한다([[02-Requirements]] R-TMUX-006, [[SPEC-005-data-contract]]):

- tmux 미설치: `installed=false, serverRunning=false, camps=[]`.
- tmux 설치, server 미실행: `installed=true, serverRunning=false, camps=[]`.
- server 실행, session 없음: `installed=true, serverRunning=true, camps=[]`.
- session은 있으나 agent 없음: `camps` 비어있지 않고 모든 camp `orcCount=0`.

## 탐지 규칙 (초기값, 검증 대상)

아래 값은 *고정 사양이 아니라 PoC로 측정·보정할 초기 가설*이다. 이 슬라이스의 핵심 목적이 이 값들의 검증이다.

### Agent type

| 신호 | 판정 | 비고 |
| --- | --- | --- |
| pane current command이 `claude`/`claude-code` | `claude-code` | 가장 강한 신호 |
| pane current command이 `codex` | `codex` | |
| command가 `node`/`python` 등 generic이고 title/cmdline에 agent signature | 해당 agent, confidence 하향 | wrapper 실행 케이스 |
| 최근 output에 agent 고유 prompt/배너 pattern | 해당 agent, confidence 보강 | adapter parser |
| AI agent 후보지만 확정 불가 | `unknown` | 단정 금지([[02-Requirements]] R-ORC-002) |

agent detector는 Claude Code/Codex 외 agent를 추가할 수 있는 adapter boundary를 가진다([[02-Requirements]] R-ORC-007). PoC에서는 인라인 함수로 시작하되 `detect(pane): OrcCandidate` 인터페이스 형태를 유지한다.

### Status (초기 threshold 제안 — Open Question 해소)

[[02-Requirements]] / [[10-System-Architecture]]의 미해결 항목이던 기본 threshold를 PoC 측정용 초기값으로 제안한다.

| status | 판정 규칙 (초기 가설) |
| --- | --- |
| `active` | 직전 scan 대비 capture 내용이 변했고, 최근 활동 ≤ 5s |
| `waiting` | output이 입력 대기 pattern(프롬프트/질문/`(y/n)` 등)으로 끝나고 변화 없음 |
| `idle` | 활동 없음이 idle 임계(초기 가설 30s) 초과. **상한 시간 임계는 없다** — `stale`은 시간 임계가 아니라 별도 축이다([[SPEC-004-status-inference]]) |
| `stale` | scanner가 inventory를 갱신하지 못해 마지막 정상 snapshot을 fallback으로 제공하는 상태(provenance 축). 시간 경과가 아니라 수집 실패 기준 ([[02-Requirements]] R-TMUX-005) |
| `error` | output에 error/exception/traceback pattern, 또는 비정상 exit |
| `unknown` | 위 신호로 확정 불가 |

- `statusConfidence`는 항상 함께 반환한다. 단일 신호만 있으면 낮은 confidence, 다중 신호가 일치하면 높은 confidence.
- scan 주기 기본값은 [[02-Requirements]] 비기능 요구의 1~5초 범위를 따르며, PoC 측정 후 default를 확정한다.

### Current work summary

- `summarySource` ∈ `pane_title` | `recent_output` | `recent_prompt` | `user_label` | `unknown` ([[05-Backend]] Agent Detection).
- summary는 redaction **적용 후** 데이터에서 추출한다([[02-Requirements]] Open Question 해소 방향: redaction 후 기준).
- 추정값은 단정하지 않는다. CLI 출력에서 `~`/`(est)` 접두 등으로 추정 표시한다([[02-Requirements]] R-ORC-005).

## 안전/프라이버시 (scan 슬라이스에서도 강제)

[[02-Requirements]] R-PRIV / R-TMUX 요구를 PoC 단계부터 적용한다.

- `capture-pane`는 기본 line count(예: 200)와 byte size limit을 넘기지 않는다(R-PRIV-001).
- 출력 전 기본 redaction을 적용한다: token/key/env secret pattern, URL credential, private key block(R-PRIV-002, R-PRIV-003).
- terminal output 원문을 파일로 저장하지 않는다(R-PRIV-004). `--json` 출력의 `preview`도 redacted tail로 제한한다.
- 모든 tmux command에 timeout을 둔다. 특정 target 실패가 전체 scan 실패로 전파되지 않게 하고 `diagnostics.tmuxErrors`에 target별로 기록한다(R-TMUX-004).
- debug 출력에 captured output 원문을 남기지 않는다(R-PRIV-005, R-OBS-003).

## 검증 시나리오와 수용 기준

[[07-Roadmap]] 검증 실험과 직접 연결한다.

- 실제 Claude Code/Codex pane 5개 이상을 실행하고 `orc-camp scan`의 agent type/상태 판정을 수동 라벨과 비교한다.
- pane 20개 이상에서 단일 scan latency를 측정한다.
- 입력 대기(`waiting`) pane을 사람이 출력만 보고 맞히는 결과와 PoC 판정을 비교한다.

수용 기준:

- [ ] macOS + tmux에서 `orc-camp scan`이 session/window/pane inventory를 출력한다.
- [ ] tmux 미설치 / session 없음 / agent 없음을 서로 다른 빈 상태로 출력한다.
- [ ] Claude Code/Codex pane이 각각 올바른 `agentType`으로 분류된다.
- [ ] 확정 불가 후보가 `unknown`으로 표시되고 낮은 confidence를 가진다.
- [ ] 모든 orc가 `status` + `statusConfidence` + `currentWorkSummary` + `summarySource`를 가진다.
- [ ] `preview`/출력에 기본 redaction이 적용되고 원문이 파일로 저장되지 않는다.
- [ ] 특정 pane의 tmux 오류가 전체 scan을 중단시키지 않고 `diagnostics`에 기록된다.
- [ ] scan이 timeout 없이 장시간 block되지 않는다.

## PoC 성공 판정 지표

| 지표 | 측정 방법 | 1차 기준(가설) |
| --- | --- | --- |
| agent detection 정확도 | 수동 라벨 대비 precision/recall | precision ≥ 0.9 |
| status 정확도 | 수동 라벨 대비 (특히 `waiting`) | `waiting` recall ≥ 0.7 |
| confidence calibration | 고/저 confidence 구간의 실제 정답률 차이 | 단조 증가 |
| scan latency | 20 pane 기준 p50/p95 | p95 < 1s |
| false redaction | 의미 있는 텍스트가 과도하게 가려지는 비율 | 수동 검토로 허용 가능 |

판정이 낮으면([[09-Reviews]] Final Gate) dashboard polish보다 manual labeling/confidence 표시와 detection 보정을 우선한다.

## 이후 슬라이스 (참고, 본 문서 범위 아님)

1. **Slice 2 — Snapshot + 최소 dashboard**: `GET /api/snapshot` + camp list 화면 + localhost token guard. scan 도메인 모델 재사용.
2. **Slice 3 — Camp detail + asset 렌더**: 아래 "런타임 Asset 계약"으로 실제 asset pack을 화면에 그린다. south/idle 정적 프레임부터 시작.
3. **Slice 4 — Control**: text input / interrupt. target 재검증, confirm modal, activity audit([[02-Requirements]] R-CTRL-*).

## 런타임 Asset 계약

Slice 3을 미리 unblock하고 blueprint 문서를 실제 산출물과 정합화하기 위해, runtime이 asset pack을 어떻게 소비하는지 최소 계약을 여기서 고정한다. **실제 전달본 기준이며, [[11-PixelLab-Asset-Setup]]의 옛 64×64 spritesheet 가정은 폐기한다(D-013 참조).**

### Source of truth와 실제 사양

- source of truth: `asset-packs/orc-camp-default/manifest.json`.
- 캐릭터 sprite 실제 사양: `frame_size` `[232, 232]`, `anchor` `[116, 208]`, `scale` 1, **8방향**(south 기준), 개별 frame PNG 시퀀스(`frame_%03d.png`), state·direction별 폴더 구조. spritesheet가 아니다.
- background: `backgrounds/warbase-sunset-dashboard.png`, `1672×941`, `safe_area [390, 520, 890, 330]`.
- terrain tiles: `tiles/orc-camp-terrain-square-topdown` (32px, 16 tiles), warbase variant 별도.
- status/UI 아이콘: `objects/status-ui` (64px 16종), selection markers `ui/selection-markers`, frames `ui/frames`(9-slice 후보), buttons `ui/buttons`.

### agentType → character 매핑

| agentType | character key | 비고 |
| --- | --- | --- |
| `claude-code` | `orc-claude-storm-shaman` | |
| `codex` | `orc-codex-field-engineer` | |
| mascot / selected camp leader | `orc-high-warchief-mascot` | README/empty state/대표 |
| `unknown` | `orc-unknown` (delivered) | mascot은 character fallback. 전용 sprite 생성 완료([[08-Decisions|D-030]]) |

### status → animation state 매핑

manifest의 3개 캐릭터 모두 `idle` / `roaming` / `active` / `waiting` / `error` / `stale` 애니메이션이 8방향(일부는 south)으로 존재한다.

> 주의: `roaming`은 **시각(애니메이션) 상태**이지 orc status enum 값이 아니다. status enum은 [[SPEC-004-status-inference]]의 7종(`active`/`waiting`/`idle`/`stale`/`error`/`unknown`/`terminated`)이다. 아래 표는 status→sprite 매핑이며, `roaming`/`terminated` 행은 시각 표현 항목으로 status enum과 구분해 읽는다.

| Orc status | sprite state | status 효과 overlay (`objects/status-ui`) |
| --- | --- | --- |
| `active` | `active` | `active-spark` |
| `waiting` | `waiting` | `waiting-bubble` |
| `idle` | `idle` | `idle-glow` |
| `error` | `error` | `error-burst` |
| `stale` | `stale` | `stale-clock` |
| `unknown` | `idle` | `unknown-charm` |
| `terminated` | **정적 fallback frame** + `terminated-ghost` overlay | death/fall 애니메이션 사용 금지 (manifest 명시) |
| `roaming` | `roaming` | 없음 또는 미세 dust |

### PoC 렌더 최소 subset

Slice 3을 다시 최소화하기 위한 렌더 우선순위:

1. `direction = south`, `state = idle`의 **첫 프레임(`reduced_motion.fallback_frame`)** 정적 렌더부터 시작한다.
2. 그다음 state별 frame 시퀀스를 manifest의 `fps`로 재생한다(idle 4 / active 8 / waiting 4 / error 6 / stale 3).
3. `prefers-reduced-motion`에서는 각 캐릭터 `reduced_motion.fallback_frame`(south/idle frame_000)으로 고정한다([[03-UX-UI]] 접근성).
4. 8방향·roaming은 P1 movement 도입 시 확장한다.

### Fallback 정책

- asset 미탑재/누락 시 CSS pixel placeholder를 쓰되 layout size는 manifest `frame_size` 기준으로 고정한다([[08-Decisions]] D-007, [[DESIGN]] Asset Rules). PoC asset이 없어도 동일 layout/interaction이 동작해야 한다([[02-Requirements]] R-UI-006).

### 패키징 게이트 (미해소)

- `asset-packs/orc-camp-default/LICENSE.md` 기준 PixelLab.ai commercial use / redistribution / attribution 조건은 **미확인(TBD)** 상태다. 조건이 명시 확인되기 전에는 asset pack을 npm package 등 외부로 재배포하지 않는다([[06-Infra]], [[08-Decisions]] D-009, [[09-Reviews]] Issue Register P2).
- 즉 런타임 코드 구현과 asset 패키징 배포는 분리한다. 로컬 개발/PoC에서는 asset pack을 직접 참조하되, 배포 산출물 포함 여부는 license 확인 후 결정한다.

## 문서 정합화 요약

이번 정리에서 실제 delivered asset pack(`manifest.json`)을 기준으로 정합화한 항목:

- [[11-PixelLab-Asset-Setup]]: 옛 `64×64` row-based spritesheet 가정·예시 manifest·design token·최소 asset set·character 우선순위를 실제 `232×232` folder-frame 기준으로 갱신했다. 초기에 미생성으로 표기했던 `orc-unknown`·`orc-iron-commander`는 이후 생성 완료되어 manifest에 delivered 상태다(총 5 character, [[08-Decisions|D-030]]). runtime은 `unknown → orc-unknown`을 1차 매핑한다.
- [[DESIGN]]: asset filename 예시와 "asset 미준비 전제" 표현을 실제 구조/현황 기준으로 정리했다.
- [[02-Requirements]] R-UI-006 등 "PixelLab asset이 없어도"의 프레이밍을 "asset pack은 준비되었고 미탑재 시 placeholder fallback"으로 정렬했다.
- [[08-Decisions]]: D-012(scan-first PoC), D-013(런타임 asset 사양 = delivered manifest) 추가.

[[13-PixelLab-Asset-Registry]]는 생성 이력 ledger로 현행 유지한다(상단 `orc-warchief` 항목은 archived 표기).

## Open Questions (이 슬라이스 한정)

- `waiting` 판정의 입력 대기 pattern을 Claude Code/Codex별로 얼마나 특화해야 false negative가 줄어드는가?
- `active` 판정에서 "capture 내용 변화"를 라인 해시로 볼지, 특정 영역만 비교할지(스피너/타임스탬프로 인한 노이즈 방지).
- scan을 1회 실행으로 둘지, `--watch`로 주기 실행해 변화 기반 status를 더 정확히 잡을지(주기 실행은 read-only 유지 가능).
