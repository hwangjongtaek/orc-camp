---
spec: SPEC-001
title: orc-camp scan CLI 표면
status: approved
updated: 2026-06-26
requirements: [R-CLI-004]
decisions: [D-001, D-012, D-014, D-015, D-021]
tags:
  - specs
  - cli
  - scan
  - command-surface
---

# SPEC-001 — `orc-camp scan` CLI 표면

이 spec은 `orc-camp scan` 슬라이스([[14-MVP-PoC-Scope]], [[08-Decisions]] D-012)의 **CLI command 표면(command surface)**을 고정한다. 즉 flag 집합, 출력 모드(human table / `--json`), 단발 vs `--watch` 실행 수명주기, stdout/stderr 스트림 계약, exit code, 그리고 사람이 읽는 table 렌더링(confidence·estimated marker·빈 상태·redaction 적용)을 정의한다.

이 spec은 **데이터의 모양(shape)을 정의하지 않는다.** `--json` payload의 필드와 table column 집합은 [[SPEC-005-data-contract]]가 소유하고, 본 spec은 그 계약을 **호출(invoke)·렌더**할 뿐이다. tmux command set은 [[SPEC-002-tmux-discovery]], agent/status 판정 규칙은 [[SPEC-003-agent-detection]]·[[SPEC-004-status-inference]], redaction은 [[SPEC-006-privacy-redaction]]가 소유한다.

> **read-only 불변식(확정)**: `orc-camp scan`은 어떤 flag 조합(`--watch` 포함)에서도 read-only다. tmux 호출은 [[SPEC-006-privacy-redaction]] §2.6의 `tmuxExec` allowlist(`list-sessions`/`list-windows`/`list-panes`/`capture-pane` + `-V`)로 제한되며, scan은 server를 띄우거나 port를 bind하거나 상태 변경 command를 호출하지 않는다([[14-MVP-PoC-Scope]] read-only 보장).

## 1. Scope

### In scope

- command: `orc-camp scan`([[08-Decisions]] D-001) 단일 command의 CLI 표면.
- flag 집합: `--json`, `--watch [interval]`, `--no-color`, `--help`, `--version`(§2.1). `--no-preview`/`--preview-lines`는 **reserved**(preview-rendering 후속 슬라이스로 미룸, [[08-Decisions|D-021]]) — scan-MVP에서 동작하지 않는다(§2.1).
- **단발(single-shot) vs `--watch` 결정**: 반복 상위 Open Question([[14-MVP-PoC-Scope]] Open Questions, [[SPEC-002-tmux-discovery]] Q1, [[SPEC-004-status-inference]] Q1) 해소(§3.1).
- 출력 모드: 기본 human table, `--json` machine-readable. `--watch`에서의 출력 형태(§2.3, §3.2).
- stdout/stderr 스트림 계약(§2.4): 데이터는 stdout, 진단/사람 로그는 stderr(`--json | jq` 청결 보장).
- exit code 집합과 정책(§2.5): 0(완료, 빈 상태·부분 오류 포함) / 1(치명) / 2(usage).
- human table 렌더링(§3.3): [[SPEC-005-data-contract]] column 호출, `statusConfidence`·estimated marker(`~`/`(est)`) 렌더(R-ORC-005), 빈 상태/ no-agent 렌더(R-TMUX-006), redaction 적용(R-PRIV-002/003).
- 다룬 요구사항: **R-CLI-004**(scan이 dashboard 없이 discovery+detection 출력). 일반 CLI 동작(exit code·stream hygiene·`--json`)은 R-CLI-004를 구현·테스트 가능하게 만드는 부분으로 포함한다.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| `--json` payload 필드 shape·`schemaVersion`·table column **정의** | 출력 데이터 계약(본 spec은 호출·렌더만) | [[SPEC-005-data-contract]] |
| tmux command set·`-F` token·timeout·error isolation·빈 상태 **판정** | inventory 수집 계약 | [[SPEC-002-tmux-discovery]] |
| `agentType`/`status`/`statusConfidence`/`summaryIsEstimated` **산출 규칙** | 판정/추론(본 spec은 boolean/enum을 소비해 렌더) | [[SPEC-003-agent-detection]], [[SPEC-004-status-inference]] |
| redaction 패턴·capture limit·원문 비저장 **메커니즘** | privacy 계약(본 spec은 redacted 데이터만 렌더) | [[SPEC-006-privacy-redaction]] |
| `--no-preview`/`--preview-lines`의 **동작**(R-PRIV-006) | scan-MVP의 preview는 metadata-only(text 미렌더)이라 노출/line-count 조정 대상이 없음. preview text를 렌더하는 후속 슬라이스로 미룸([[08-Decisions|D-021]]). scan-MVP는 이 flag 동작을 제공하지 않음(reserved) | preview-rendering 후속 슬라이스 / [[SPEC-006-privacy-redaction]] |
| **R-CLI-002**(browser auto-open 실패 시 dashboard URL을 stdout 출력) | scan에는 dashboard/server/URL이 **없다**. R-CLI-002는 `serve` 슬라이스 소유 | `serve` 슬라이스(후속 SPEC) — §6 C1 |
| `serve`/`doctor` command 표면(R-CLI-001/002/003/005/006/007) | 다른 command/슬라이스 | 후속 SPEC |

> **R-CLI-002 범위 정정(중요)**: [[README]] Spec 인덱스는 SPEC-001을 "R-CLI-004, R-CLI-002(부분)"으로 표기한다. 이는 **mislabel**이다. R-CLI-002(browser open 실패 시 dashboard URL을 stdout에)는 dashboard URL이 존재하는 `serve` 슬라이스의 요구사항이며, read-only stdout-only인 `scan`에는 적용되지 않는다. 본 spec은 R-CLI-002를 다루지 않으며, AC-14가 scan에 URL 표면이 없음을 negative로 검증한다. index 정정은 완료되었다(§6 C1 RESOLVED).

## 2. Contract

### 2.1 flag 집합

| flag | 인자 | 기본값 | 의미 | 비고 |
| --- | --- | --- | --- | --- |
| `--json` | 없음 | off(human table) | machine-readable JSON을 stdout으로 출력 | payload shape은 [[SPEC-005-data-contract]] |
| `--watch` | `[interval]` (초, 선택) | off(단발) | 주기적 재-scan(read-only 유지) | interval 생략 시 기본 interval 사용(§3.1) |
| `--no-preview` | 없음 | — | **reserved — scan-MVP 비활성** | preview가 metadata-only라 억제 대상 없음. 동작은 preview-rendering 후속 슬라이스([[08-Decisions|D-021]], R-PRIV-006) |
| `--preview-lines` | `<n>` | — | **reserved — scan-MVP 비활성** | preview text 미렌더로 조정 대상 없음. 동작은 후속 슬라이스([[08-Decisions|D-021]], R-PRIV-006) |
| `--no-color` | 없음 | 자동(TTY면 color) | ANSI color 비활성 | 접근성: 상태는 색만이 아니라 label로도 표시(§3.3) |
| `--help`, `-h` | 없음 | — | usage(flag·exit code) 출력 후 exit 0, scan 미수행 | |
| `--version`, `-V` | 없음 | — | 버전 출력 후 exit 0 | |

- **결정**: 알 수 없는 flag, `--watch` interval 파싱 실패/범위 밖, 양립 불가 조합은 **usage error(exit 2)**다(§2.5).
- `--json`과 `--no-color`는 직교한다(`--json`은 항상 color 없는 순수 JSON).
- MVP에서 인정하지 않는 flag(`--watch`의 음수/0, 비숫자 interval 등)는 거부한다(§3.1).

### 2.2 입력/출력 한눈에

```text
orc-camp scan [--json] [--watch [interval]] [--no-color]
orc-camp scan (--help | --version)
```

- **입력**: flag만. positional 인자는 없다(MVP). stdin은 사용하지 않는다.
- `--no-preview`/`--preview-lines`는 reserved이며 scan-MVP의 active synopsis에 포함하지 않는다([[08-Decisions|D-021]], §2.1).
- **출력 데이터**: stdout(§2.3, §2.4).
- **진단/로그**: stderr(§2.4).
- **종료 코드**: §2.5.

### 2.3 출력 모드

| 모드 | 단발(default) | `--watch` |
| --- | --- | --- |
| human table(default) | 1회 table을 stdout에 렌더 후 종료 | cycle마다 table을 repaint(§3.2). 사람용 |
| `--json` | **1개** JSON document를 stdout에 출력 후 종료 | cycle당 1개 JSON object를 **NDJSON**(newline-delimited)으로 stream(§3.2) |

- `--json` 단발은 단일 JSON document다(`jq`가 곧장 파싱). `--json --watch`는 cycle당 1개씩 줄바꿈으로 구분된 JSON object stream이다 — `jq`는 공백/줄바꿈으로 구분된 JSON value stream을 그대로 처리한다(`... | jq .`).
- JSON payload의 필드(`schemaVersion`/`tmux`/`camps`/`diagnostics` 등)는 [[SPEC-005-data-contract]] 소유다. 본 spec은 "stdout에 유효 JSON을 낸다"는 **표면**만 보장한다.
- **provenance 기본 노출(결정)**: `agentSignals`/`statusSignals`는 `--json` 기본 출력에 **항상 포함**한다(MVP에서 flag gating 없음). 두 배열은 redaction-safe(`ruleId`만, [[SPEC-005-data-contract]] §3.5)다. 이는 [[SPEC-005-data-contract]] Q1(provenance 노출 정책)을 본 spec 표면 결정으로 닫는다.

### 2.4 stdout / stderr 스트림 계약(확정)

| stream | 담는 것 |
| --- | --- |
| **stdout** | scan 결과 렌더링만. table 모드 = 사람이 읽는 표(빈 상태 메시지 포함). `--json` 모드 = JSON document/stream. `diagnostics.tmuxErrors`는 `--json` payload **안**에 포함되므로 `--json`에서는 stdout으로 나간다. |
| **stderr** | 운영/사람 로그: scan 진행 표시, `--watch` cycle 헤더/타임스탬프, 경고, **사람이 읽는 진단 요약**, usage/error 메시지. |

- **결정(stream hygiene)**: `orc-camp scan --json | jq`가 항상 깨끗하도록, stdout에는 데이터(JSON 또는 table) 외 어떤 텍스트도 쓰지 않는다. 진행/진단 로그는 stderr로 분리한다.
- table 모드에서 per-target tmux 오류 등 진단은 **사람용 요약을 stderr**에 쓴다(stdout table은 1차 렌더만 유지). 구조화된 `diagnostics`는 `--json` payload(stdout)에서만 노출된다.
- catastrophic 실패 시(§2.5 exit 1) stdout은 비우고(부분 JSON 금지) error는 stderr에 쓴다 → consumer의 `jq`가 모호하게 부분 파싱하지 않고 명확히 실패한다.

### 2.5 exit code

| code | 의미 | 조건(예) |
| --- | --- | --- |
| **0** | scan 완료(결과 산출됨) | 정상; tmux 미설치/server 미실행/session 0개(빈 상태); 일부 pane capture 실패; `--watch` 정상 중단(SIGINT/SIGTERM). 이들은 모두 **data/diagnostics로 보고**되는 관측이지 실패가 아니다. |
| **1** | catastrophic 실패(결과를 전혀 산출 못함) | 내부 uncaught 오류, stdout write 실패 등. stdout 비움, error는 stderr. |
| **2** | usage error(scan 미시도) | 알 수 없는 flag, `--watch` interval 파싱 실패/범위 밖, 양립 불가 조합. 메시지는 stderr, stdout 비움. |

- **결정(exit 정책, [[08-Decisions|D-015]])**: "scan이 결과를 산출했는가"가 0/비-0의 경계다. tmux 부재·빈 상태·per-target 오류는 scan이 **성공적으로 관측·보고한 결과**이므로 exit 0이다.
- **결정(`--watch` 정상 중단 = exit 0)**: `--watch`는 무한 loop이며 사용자가 SIGINT(Ctrl-C)/SIGTERM으로 끝낸다. 이를 정상 완료로 보아 exit 0으로 둔다(대안: POSIX 관례 130 = 128+SIGINT — §6 Q5에서 검토 대상).
- **tmux 부재 ⇒ exit 0 정당화(R-TMUX-006 근거)**: R-TMUX-006은 "미설치 / server 미실행 / session 없음"을 **서로 다른 빈 상태**로 *구분해 제공*하라고 요구한다. 즉 tmux 부재는 scan이 **보고해야 할 데이터**이지 scan의 실패가 아니다. 만약 미설치를 비-0 exit로 두면 (a) process 수준에서 진짜 실패와 구분 불가, (b) `orc-camp scan --json | jq` consumer가 `tmux.installed=false` JSON을 받기도 전에 비-0으로 깨지고, (c) "tmux 설치 여부 점검"의 health-check 의미는 `doctor`(R-CLI-005)가 소유한다. 따라서 scan은 exit 0 + `tmux.installed=false` 데이터로 보고한다(AC-03).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다.

### 3.1 단발(single-shot) vs `--watch` 해소(핵심 결정)

- **결정([[08-Decisions|D-014]])**: scan 기본은 **단발(single-shot)**이다. 1회 수집·출력 후 종료한다.
- **결정([[08-Decisions|D-014]])**: 주기 재-scan은 **`--watch [interval]` opt-in**으로 제공한다. read-only는 그대로 유지된다(§read-only 불변식). `--watch`는 cycle마다 [[SPEC-002-tmux-discovery]]의 read-only inventory를 다시 수집할 뿐이다.
- **단발의 의미 저하(확정, 근거 [[SPEC-004-status-inference]])**: `status=active`(직전 대비 내용 변화)와 disappearance 기반 `terminated`(직전 inventory에 있던 paneId가 사라짐)는 **직전 scan(prior)** 비교를 전제한다([[SPEC-004-status-inference]] §2.1 `prior`, §3.6 S-CHG/S-GONE). 단발 scan에는 prior가 없으므로:
  - change 기반 `active`는 입증 불가 → S-RECENT 약신호의 LOW confidence이거나 `unknown`으로 저하된다([[SPEC-004-status-inference]] §3.8 단발 cap).
  - disappearance 기반 `terminated`는 검출 불가다. 단발에서는 scan 시점 `pane_dead==true`인 pane만 1회 `terminated`로 표시된다.
  - `waiting`은 정적(차분) 제약을 검증할 수 없어 MEDIUM 이하로 cap된다.
- **`--watch`가 해소하는 것**: cycle 간 직전 snapshot을 **prior**로 전달하면 [[SPEC-004-status-inference]]가 S-CHG/S-GONE을 사용해 `active`/`terminated`를 더 높은 confidence로 판정할 수 있다. CLI는 **실행 수명주기(loop·prior 전달)**를 소유하고, prior를 어떻게 해석할지는 [[SPEC-004-status-inference]]가 소유한다([[SPEC-002-tmux-discovery]] §2.7 last-good과 정합).
- **`--watch` interval(가설)**: 기본 interval은 **PoC 검증 가설**이며 초기값 `3s`를 쓴다(범위 중앙값). 허용 범위는 [[02-Requirements]] 비기능 요구 "Scan latency = 1–5초"에서 도출한 **확정 경계 `[1, 5]`초**다. 범위 밖/비숫자 interval은 usage error(exit 2). 기본 default 값은 [[14-MVP-PoC-Scope]]·[[SPEC-007-test-validation]] 측정으로 확정한다.
- **단일 scan 비-block(확정)**: `--watch` 여부와 무관하게 단일 scan은 timeout 없이 장시간 block되지 않는다(tmux command timeout은 [[SPEC-002-tmux-discovery]] §2.6 소유, [[02-Requirements]] Scan latency).

### 3.2 `--watch` 출력 동작

- **table 모드(가설)**: cycle마다 화면을 갱신한다. TTY면 화면 clear 후 repaint, 각 cycle 상단에 scan 시각·stale 여부를 표시한다(stderr 헤더 가능). 비-TTY(파이프)로 table을 `--watch`할 때의 동작(append vs 권장 `--json`)은 §6 Q3.
- **`--json` 모드(결정)**: cycle당 1개 JSON object를 NDJSON으로 stdout에 append한다(화면 clear 없음). streaming consumer가 cycle별로 파싱한다.
- 어느 모드든 stderr에는 cycle 진행/오류 로그가 갈 수 있으나 stdout 데이터 청결은 유지한다(§2.4).

### 3.3 human table 렌더링

- **column 집합(호출, owner [[SPEC-005-data-contract]] §2.8)**: table column 집합·매핑·순서는 [[SPEC-005-data-contract]] §2.8이 소유한다. 본 spec은 재정의하지 않고 **렌더 방식**(estimated marker glyph, confidence 표기, redaction 적용)만 소유한다. orc 행은 §2.8 순서 그대로 7개 column을 렌더한다: **TARGET**(`tmuxTarget` + `paneId`, raw target 항상 노출 R-UI-007) → **AGENT**(`agentType` + `agentTypeConfidence`) → **STATUS**(`status` + `statusConfidence`) → **SUMMARY**(`currentWorkSummary` + `summaryIsEstimated` marker) → **CMD**(`command`) → **CWD**(`cwd`) → **ACTIVITY**(`lastActivityAt`). camp는 그룹 헤더(`tmuxSessionName`·window/pane 수·`orcCount`·`statusSummary`·`lastActivityAt`)로 렌더한다. 정렬은 [[SPEC-002-tmux-discovery]] §3 / [[SPEC-005-data-contract]] §3.4 규칙(session→window→pane)을 따른다.
- **confidence 렌더(확정, R-ORC-005)**: 모든 orc 행은 `statusConfidence`(수치 또는 band)를 **함께** 표시한다. status를 confidence 없이 단정 사실처럼 렌더하지 않는다([[SPEC-004-status-inference]] §2.2). 수치 vs band(HIGH/MEDIUM/LOW) vs 막대 표기는 UX-tunable(§6 Q4).
- **estimated marker(확정, R-ORC-005, glyph는 SPEC-001 소유)**: `summaryIsEstimated == true`([[SPEC-004-status-inference]] §3.5)인 `currentWorkSummary`는 **estimated marker**를 붙여 렌더한다. MVP 표기: 요약 앞에 `~ ` 접두(예: `~ Editing src/server.ts`), legend에 `~ = estimated`. `user_label` source(`summaryIsEstimated == false`)는 marker 없이 렌더한다. JSON consumer는 `summaryIsEstimated` boolean을 소비한다(glyph는 table 전용). 정확한 glyph(`~` vs `(est)`)는 UX-tunable이나 **marker 존재는 확정**이다.
- **stale 렌더(확정, 데이터는 SPEC-002/005)**: snapshot이 stale([[SPEC-002-tmux-discovery]] §2.7)이면 stale 배지/`lastGoodAt`를 표시한다. 이 필드의 직렬화 추가는 [[SPEC-005-data-contract]] 소유이며 미정이다(§6 C3).
- **redaction 적용(확정, R-PRIV-002/003)**: table이 렌더하는 모든 콘텐츠(preview·`currentWorkSummary`·title 등)는 [[SPEC-006-privacy-redaction]]의 sanitize 경계를 통과한 **redacted 데이터만**이다. table 렌더러는 raw 버퍼를 직접 읽지 않는다(redaction chokepoint 위반 금지, [[SPEC-006-privacy-redaction]] §3.1).
- **접근성(확정)**: 상태를 색만으로 구분하지 않는다([[02-Requirements]] 접근성 비기능). 각 status는 텍스트 label로 표시하고, color는 보조다. `--no-color`/`NO_COLOR`에서도 정보 손실이 없어야 한다.
- **빈 상태 / no-agent 렌더(확정, R-TMUX-006)**: 아래 4종을 **서로 구분되는 사람 메시지**로 렌더한다([[SPEC-002-tmux-discovery]] §2.5 의미 상태 매핑):
  - `not_installed`(`tmux.installed=false`): "tmux 미설치" + 안내.
  - `server_not_running`(`installed=true, serverRunning=false`): "tmux server 미실행" + 안내.
  - `running_no_session`(`serverRunning=true, camps=[]`): "실행 중 session 없음" + 생성 안내.
  - `no-agent`(camp는 있으나 `orcCount=0`): "탐지된 agent 없음".

### 3.4 결정성

- 같은 inventory 입력에 대한 단발 table/`--json` 렌더는 결정적이다(정렬·필드 순서 안정). 테스트 가능성([[SPEC-002-tmux-discovery]] §3 정렬, [[SPEC-005-data-contract]] 직렬화).

## 4. 예시 (annotated)

### 4.1 human table (단발, 정상)

```text
$ orc-camp scan
tmux: installed · server running · scanned 2026-06-26 10:00:00 +09:00

CAMP work   session "work" · 3 win · 5 pane · 2 orcs · last 09:59:40
  TARGET        AGENT             STATUS        SUMMARY                    CMD   CWD              ACTIVITY
  work:1.0 %12  claude-code 0.95  active 0.80   ~ Editing src/server.ts    node  /Users/me/proj   09:59:40
  work:2.1 %18  codex 0.88        waiting 0.65  ~ Apply this patch? (y/n)   node  /Users/me/proj   09:58:12

legend: ~ = estimated summary · AGENT/STATUS 뒤 수치 = confidence (0–1) · TARGET = tmuxTarget + paneId
```
- column 집합·순서·매핑은 [[SPEC-005-data-contract]] §2.8 소유다(TARGET → AGENT → STATUS → SUMMARY → CMD → CWD → ACTIVITY). 본 spec은 marker(`~`)·confidence 표기·redaction 적용 등 **렌더 방식**만 정한다.
- `~ ` 접두 = 자동 추정 요약(`summaryIsEstimated=true`, R-ORC-005). AGENT/STATUS column 뒤 수치 = `agentTypeConfidence`/`statusConfidence`(단정 금지, status는 항상 confidence 동반).
- 표시 콘텐츠(SUMMARY 등)는 redacted 데이터([[SPEC-006-privacy-redaction]]).

### 4.2 `--json` 호출 (stream hygiene)

```text
$ orc-camp scan --json | jq '.tmux'
{ "installed": true, "serverRunning": true }

$ orc-camp scan --json 2>/dev/null | jq '.camps[0].orcs[0].status'
"active"
```
- stdout은 순수 JSON 1개 document(payload shape = [[SPEC-005-data-contract]], [[14-MVP-PoC-Scope]] 예시). 진단/진행 로그는 stderr이므로 `2>/dev/null`로 버려도 `jq`가 깨끗하다.

### 4.3 빈 상태 (tmux 미설치) — exit 0

```text
$ orc-camp scan
tmux is not installed. Install tmux to discover camps.
(no camps)
$ echo $?
0

$ orc-camp scan --json
{"schemaVersion":1,"scannedAt":"2026-06-26T10:00:00+09:00","tmux":{"installed":false,"serverRunning":false},"camps":[],"diagnostics":{"tmuxErrors":[],"scanDurationMs":3}}
$ echo $?
0
```
- R-TMUX-006: 미설치는 데이터(`tmux.installed=false`)로 보고하고 exit 0(§2.5 정당화).

## 5. Acceptance criteria

> "any output path" = { table stdout, `--json` stdout }. secret 예시는 placeholder(`ghp_<token>`)를 쓴다([[SPEC-000-conventions]]). 임계값(`--watch` interval 등)은 §3.1 가설을 따른다.

- **SPEC-001-AC-01** (R-CLI-004)
  - Given tmux server가 실행 중이고 agent pane이 1개 이상 있을 때
  - When `orc-camp scan`(flag 없음)을 실행하면
  - Then stdout에 camp/orc를 나열하는 human-readable table(discovery+detection 결과)이 렌더되고, server가 시작되지 않으며(어떤 TCP port도 bind되지 않음) dashboard/URL이 출력되지 않는다.

- **SPEC-001-AC-02** (R-CLI-004)
  - Given 임의의 tmux 상태에서
  - When `orc-camp scan --json`을 실행하면
  - Then stdout 전체가 [[SPEC-005-data-contract]]를 만족하는 **단일 유효 JSON document**이며(`jq .`로 파싱 성공), stdout에 JSON 외 텍스트가 섞이지 않는다.

- **SPEC-001-AC-03** (R-CLI-004, R-TMUX-006)
  - Given tmux가 설치되지 않은 환경에서
  - When `orc-camp scan --json`을 실행하면
  - Then exit code가 0이고, stdout은 유효 JSON이며 `tmux.installed == false`이다.

- **SPEC-001-AC-04** (R-CLI-004)
  - Given 진단/진행 로그가 발생하는 scan에서
  - When `orc-camp scan --json 2>/dev/null | jq .`을 실행하면
  - Then 파싱이 성공한다(데이터는 stdout에만, 진단/로그는 stderr에만 — stream hygiene).

- **SPEC-001-AC-05** (R-CLI-004, R-TMUX-004)
  - Given 일부 pane의 capture-pane가 실패하거나 tmux server가 미실행인 환경에서
  - When `orc-camp scan`을 실행하면
  - Then exit code가 0이고, 그 오류/빈 상태는 실패가 아니라 데이터/diagnostics로 보고된다(나머지 결과는 정상 산출).

- **SPEC-001-AC-06** (R-CLI-004)
  - Given 알 수 없는 flag 또는 범위 밖/비숫자 `--watch` interval을 줄 때
  - When `orc-camp scan <bad-flag>` / `orc-camp scan --watch 0`을 실행하면
  - Then exit code가 2이고, 오류 메시지가 stderr에 나오며, stdout에는 (부분) 데이터가 출력되지 않는다.

- **SPEC-001-AC-07** (R-CLI-004)
  - Given scan이 어떤 결과도 산출할 수 없는 내부 치명 오류 상황에서
  - When `orc-camp scan`을 실행하면
  - Then exit code가 비-0(1)이고 error는 stderr에 나오며, `--json` 모드에서 stdout에 부분 JSON을 남기지 않는다.

- **SPEC-001-AC-08** (R-CLI-004, R-ORC-003)
  - Given `orc-camp scan --watch 2`를 실행할 때
  - When 관측하면
  - Then 약 2초 간격으로 재-scan이 반복되고, 전 cycle을 통틀어 spawn된 tmux subcommand는 read-only allowlist(`list-*`/`capture-pane`/`-V`)뿐이며([[SPEC-006-privacy-redaction]] §2.6), 각 cycle은 직전 snapshot을 prior로 [[SPEC-004-status-inference]]에 전달한다.

- **SPEC-001-AC-09** (R-ORC-005)
  - Given prior(직전 scan)가 없는 단발 `orc-camp scan`에서
  - When 출력을 검사하면
  - Then 어떤 orc도 change-diff만으로 HIGH confidence `active`로 단정되지 않고, disappearance 기반 `terminated`가 나타나지 않으며(`pane_dead` 시점 표시는 허용), 해당 신호는 [[SPEC-004-status-inference]]의 단발 저하(LOW/`unknown`/cap)대로 렌더된다.

- **SPEC-001-AC-10** (R-ORC-005)
  - Given `summaryIsEstimated == true`인 orc와 `user_label` source(`summaryIsEstimated == false`)인 orc가 있을 때
  - When table을 렌더하면
  - Then 전자의 `currentWorkSummary`에는 estimated marker(`~`/`(est)`)가 붙고 후자에는 붙지 않는다.

- **SPEC-001-AC-11** (R-ORC-005, R-ORC-003)
  - Given orc가 1개 이상인 table 출력에서
  - When 각 orc 행을 검사하면
  - Then 모든 행이 `statusConfidence`(수치 또는 band)를 status와 함께 표시하며, status가 confidence 없이 렌더되는 행이 없다.

- **SPEC-001-AC-12** (R-PRIV-002, R-PRIV-003)
  - Given 어떤 pane capture에 `ghp_<token>` 형태 secret이 포함될 때
  - When `orc-camp scan`(table) 및 `--json` 출력을 검사하면
  - Then 그 token literal이 any output path 어디에도 나타나지 않는다(table 렌더러도 redacted 데이터만 소비, [[SPEC-006-privacy-redaction]] 정합).

- **SPEC-001-AC-13** (R-TMUX-006, R-CLI-004)
  - Given tmux 미설치 / server 미실행 / running-no-session / camp 있으나 orc 0개의 4개 상황에서
  - When 각각 `orc-camp scan`을 실행하면
  - Then 네 경우가 서로 구분되는 사람 메시지(not_installed / server_not_running / running_no_session / no-agent)로 렌더된다.

- **SPEC-001-AC-14** (R-CLI-004) — 범위 정정(R-CLI-002 negative)
  - Given 임의의 flag 조합으로 `orc-camp scan`을 실행할 때
  - When process와 출력을 관측하면
  - Then scan은 어떤 TCP port도 listen하지 않고 dashboard URL을 출력하지 않는다(scan에는 R-CLI-002의 URL 표면이 없다).

- **SPEC-001-AC-15** (R-PRIV-006) — preview-toggle 부재(negative, [[08-Decisions|D-021]])
  - Given preview 메타데이터(`{lines, truncated, redacted}`)를 가진 orc가 있을 때
  - When `orc-camp scan`을 실행하면(reserved `--no-preview`/`--preview-lines` 유무와 무관)
  - Then 어떤 경우에도 preview **text**가 렌더되지 않으며(preview는 metadata-only), scan-MVP는 preview show/hide·line-count 조정 동작을 노출하지 않는다([[08-Decisions|D-021]]). 실제 preview text 렌더와 R-PRIV-006 동작은 preview-rendering 후속 슬라이스 소유다.

- **SPEC-001-AC-16** (R-CLI-004)
  - Given `orc-camp scan --help`를 실행할 때
  - When 출력을 검사하면
  - Then usage(flag 목록·exit code)가 stdout에 출력되고 exit 0이며, tmux scan이 수행되지 않는다(tmux command가 spawn되지 않음).

## 6. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| **R-CLI-004** (primary) | scan CLI 표면 전반: 기본 table, `--json`, stream hygiene, exit code 정책, `--watch` 수명주기, 빈 상태 렌더, server/URL 부재, `--help` | SPEC-001-AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-13, AC-14, AC-16 |
| R-TMUX-006 (CLI 렌더 co-own; 판정 [[SPEC-002-tmux-discovery]]) | 빈 상태 3종 + no-agent의 사람/JSON 렌더, tmux 부재 exit 0 | SPEC-001-AC-03, AC-13 |
| R-ORC-005 (CLI 렌더 co-own; 추론 [[SPEC-004-status-inference]]) | statusConfidence 렌더, estimated glyph(`~`/`(est)`), 단발 저하 표면 | SPEC-001-AC-09, AC-10, AC-11 |
| R-ORC-003 (CLI 렌더 co-own; 필드 [[SPEC-004-status-inference]]/[[SPEC-005-data-contract]]) | orc 필드 table 렌더, `--watch`로 active/terminated 가용화 | SPEC-001-AC-08, AC-11 |
| R-PRIV-002 / R-PRIV-003 (강제 [[SPEC-006-privacy-redaction]]) | table/preview 출력도 redacted 데이터만 렌더(chokepoint 비우회) | SPEC-001-AC-12 |
| R-PRIV-006 (scan-MVP 범위 밖 — [[08-Decisions|D-021]]) | scan-MVP는 preview text를 렌더하지 않으므로 preview-toggle 동작 없음. `--no-preview`/`--preview-lines`는 reserved. 동작은 preview-rendering 후속 슬라이스 소유 | SPEC-001-AC-15 (negative) |
| R-CLI-002 | **본 spec 범위 아님** — `serve` 슬라이스 소유. scan에는 dashboard/server/URL이 없음(negative 검증) | SPEC-001-AC-14 |

> R-CLI-004는 본 spec이 1차 소유한다. R-TMUX-006/R-ORC-005/R-ORC-003/R-PRIV-002/003은 각 owner spec이 판정/강제를 소유하고 본 spec이 **CLI 표면 렌더**를 co-own한다. R-PRIV-006은 [[08-Decisions|D-021]]에 따라 scan-MVP 범위 밖이다(preview text 미렌더 → toggle 동작 없음, flag reserved). 전체 추적 매트릭스 통합은 [[SPEC-007-test-validation]].

## 7. Open Questions / Conflicts

### Conflicts / Upstream (청사진/index 보정 필요)

- **C1 — README index R-CLI-002 mislabel (RESOLVED)**: [[README]] Spec 인덱스의 SPEC-001 mislabel("R-CLI-004, R-CLI-002(부분)")은 index에서 "R-CLI-004"로 정정 완료되었다. R-CLI-002(browser open 실패 시 dashboard URL stdout)는 dashboard/URL이 있는 `serve` 슬라이스 소유이며 read-only stdout-only `scan`에는 적용되지 않는다(AC-14 negative로 검증). 잔여 조치 없음.
- **C2 — table column 계약 정합 (RESOLVED)**: [[SPEC-005-data-contract]]가 작성(draft)되어 §2.8에 canonical table column 집합·순서를 고정했다. 본 spec §3.3 column 설명과 §4.1 예시 table을 §2.8 순서(TARGET → AGENT → STATUS → SUMMARY → CMD → CWD → ACTIVITY)에 정합화 완료했다. SPEC-005가 column을 소유하고 본 spec은 marker/confidence 표기/redaction 등 렌더 방식만 소유한다. 잔여 조치 없음.
- **C3 — estimated/stale 직렬화 필드 (RESOLVED)**: estimated marker 렌더(AC-10)가 요구하는 `summaryIsEstimated`와 stale 배지가 요구하는 `stale`/`lastGoodAt`는 모두 [[SPEC-005-data-contract]] §2.1/§2.4에 직렬화 필드로 고정됐다. 본 spec 렌더(§3.3)는 해당 필드를 소비한다. 잔여 조치 없음.
- **C4 — 단발/`--watch` Open Question 해소 통지 ([[08-Decisions|D-014]])**: [[14-MVP-PoC-Scope]] Open Questions, [[SPEC-002-tmux-discovery]] Q1, [[SPEC-004-status-inference]] Q1의 "단발 vs `--watch`"를 본 spec §3.1이 **기본 단발 + `--watch` opt-in**으로 해소했고 [[08-Decisions|D-014]]로 확정됐다. 상위 문서 Open Question 닫힘 표기는 orchestrator가 반영한다.
- **C5 — R-PRIV-006 범위 (RESOLVED, [[08-Decisions|D-021]])**: scan-MVP의 preview는 metadata-only(text 미렌더)이므로 노출/line-count 조정 대상이 없다. [[08-Decisions|D-021]]에 따라 R-PRIV-006은 preview text를 렌더하는 후속 슬라이스로 미루고, scan-MVP는 `--no-preview`/`--preview-lines`를 **reserved**(비활성)로 둔다(§2.1, AC-15 negative). 잔여 조치 없음.

### Open Questions (검토 필요 / PoC 검증 대상)

- **Q1 — `--watch` 기본 interval 값**: 초기 가설 `3s`(허용 범위 `[1,5]`초는 [[02-Requirements]] 비기능에서 도출한 확정 경계). default 확정은 [[14-MVP-PoC-Scope]]·[[SPEC-007-test-validation]] latency 측정 후. 범위 밖 값은 usage error로 거부할지(현재) vs clamp할지도 검토. **검토 필요.**
- **Q2 — `--watch --json` 출력 형식**: NDJSON(cycle당 1 object, 현재 결정) vs JSON array(loop 종료 시 닫힘) vs SSE. NDJSON이 streaming `jq` consumer에 적합하다는 가정의 검증 필요. **검토 필요.**
- **Q3 — `--watch` table의 비-TTY 동작**: stdout이 TTY가 아닐 때(파이프/리다이렉트) table `--watch`를 화면 clear 없이 append할지, `--json`을 권장/강제할지 UX 결정 필요.
- **Q4 — confidence/estimated 표시 형식**: `statusConfidence`를 수치(0.80) vs band(HIGH/MEDIUM/LOW) vs 막대로 렌더할지, estimated glyph를 `~` 접두 vs `(est)` suffix로 둘지. [[SPEC-005-data-contract]] column 소유와 함께 UX-tunable. **검토 필요.**
- **Q5 — `--watch` SIGINT exit code**: 정상 중단을 exit 0(현재 결정)으로 둘지 POSIX 관례 130으로 둘지. 또한 모든 cycle이 결과 산출에 실패하면 종료 시 비-0으로 신호할지 검토.
- **Q6 — prior snapshot 보관 소유 경계**: `--watch` cycle 간 prior 전달은 CLI(본 spec 수명주기)가 주도하고, last-good 보관은 [[SPEC-002-tmux-discovery]] §2.7, prior 해석은 [[SPEC-004-status-inference]] §2.1이 소유한다. 세 spec의 prior/last-good 책임 경계 정합 확인 필요.
