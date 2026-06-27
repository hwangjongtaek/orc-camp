---
spec: SPEC-002
title: tmux inventory 수집
status: approved
updated: 2026-06-26
requirements: [R-TMUX-001, R-TMUX-002, R-TMUX-004, R-TMUX-005, R-TMUX-006]
decisions: [D-004, D-012, D-014, D-020]
tags:
  - specs
  - tmux
  - discovery
  - backend
  - scan
---

# SPEC-002 — tmux inventory 수집

`orc-camp scan` 슬라이스([[14-MVP-PoC-Scope]], [[08-Decisions]] D-012)에서 **tmux로부터 raw inventory를 수집하는 단계**의 계약을 고정한다. 어떤 tmux command를 어떤 `-F` format token으로 호출하는지, pane별로 어떤 raw metadata를 어떤 token에서 얻는지, timeout·target별 error isolation·stale 처리·빈 상태 3종 구분을 정의한다.

이 단계의 산출물은 "pane별 raw record 집합 + 수집 진단(diagnostics) + tmux 가용성 상태"이며, 이를 소비하는 출력 스키마·agent 판정·status 추론·redaction은 모두 다른 spec이 소유한다(아래 Out of scope).

> **read-only 불변식**: 이 단계는 어떤 경우에도 `tmux send-keys`/`paste-buffer` 등 상태 변경 command를 호출하지 않는다. tmux 호출은 `list-sessions`, `list-windows`, `list-panes`, `capture-pane`로 제한한다([[14-MVP-PoC-Scope]] read-only 보장, [[SPEC-006-privacy-redaction]]).

## 1. Scope

### In scope

- tmux inventory 수집 command set과 각 command의 `-F` format token 집합([[02-Requirements]] R-TMUX-001).
- pane별 raw metadata 필드(`tmuxTarget`, `paneId`, `sessionName`, `windowIndex`, `paneIndex`, `command`, `paneTitle`, `cwd`, `lastActivityAt`)의 **출처 token과 타입** 정의(R-TMUX-002). `command`는 raw `#{pane_current_command}`를 그대로 보관하며 basename 가공은 소비자 소유다(§2.3).
- pane foreground의 `cmdline`(argv)·process-alive 신호의 **선택적·degradable 수집**(`pane_pid → ps` 등 non-tmux subprocess; [[08-Decisions|D-020]], §2.8). [[SPEC-003-agent-detection]] §2.1/§2.4가 소비한다.
- `capture-pane`의 line window(몇 줄을 capture할지)와 호출 형태. 단, line/byte **limit 값**과 redaction 규칙은 [[SPEC-006-privacy-redaction]] 소유.
- 단일 tmux command별 timeout, target별 error isolation, `diagnostics.tmuxErrors` 구조와 의미(R-TMUX-004).
- 마지막 정상 snapshot(last-good) vs 현재 stale 상태의 구분 규칙(R-TMUX-005).
- 빈 상태 3종 구분 탐지: tmux 미설치 / tmux 설치됐으나 server 미실행 / server 실행 중이나 session 없음(R-TMUX-006).

### Out of scope (다른 spec으로 미룸)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| 최종 JSON 출력 shape·`schemaVersion`·필드 직렬화 | 출력 계약은 별도 SSOT | [[SPEC-005-data-contract]] |
| `agentType` 판정(핑거프린팅) | 수집된 raw에서 agent를 추론하는 단계 | [[SPEC-003-agent-detection]] |
| `status`·`statusConfidence`·`currentWorkSummary`·`summarySource` 추론 | capture/메타데이터 해석 단계 | [[SPEC-004-status-inference]] |
| capture 내용의 redaction 규칙·line/byte limit 값·원문 비저장 정책 | privacy 계약 | [[SPEC-006-privacy-redaction]] |
| CLI flag·table/JSON 출력 포맷·exit code | CLI 표면 | [[SPEC-001-scan-cli]] |

> 본 spec은 capture된 raw text를 **사용 전 [[SPEC-006-privacy-redaction]]에 넘긴다**는 경계만 명시한다. capture 원문을 직접 출력·저장·로깅하지 않는다.

## 2. Contract

### 2.1 tmux command set (read-only)

수집은 아래 read-only command만 사용한다. 모든 호출은 `child_process` spawn 기반이며([[05-Backend]] 기술 가정, [[08-Decisions]] D-004) shell 보간 없이 인자 배열로 전달한다.

| # | 단계(phase) | command | 호출 횟수 | 역할 |
| --- | --- | --- | --- | --- |
| 0 | `probe` | `tmux -V` | scan당 1회 | tmux 설치 여부 판별(spawn 성공 = 설치됨) |
| 1 | `inventory` | `tmux list-sessions -F <FMT_S>` | scan당 1회 | server 실행 여부 판별 + session-level 집계 |
| 2 | `inventory` | `tmux list-panes -a -F <FMT_P>` | scan당 1회 | **pane별 raw metadata의 권위 소스** |
| 3 | `inventory` | `tmux list-windows -a -F <FMT_W>` | scan당 0~1회 (선택) | `window_name` 등 window-level 보조 메타 |
| 4 | `capture` | `tmux capture-pane -p -t <paneId> -S -<N>` | pane당 1회 | pane 출력 raw text(→ redaction) |

- **#2 `list-panes -a`가 pane inventory의 단일 권위 소스**다. `-a`로 모든 session/window의 pane을 1회에 가져와 spawn 수를 최소화한다(latency 목표 [[14-MVP-PoC-Scope]] p95 < 1s).
- **#3 `list-windows -a`는 선택(optional)**이다. `windowCount`/`paneCount`는 #2 결과에서 파생 가능하므로 PoC에서는 생략할 수 있다. window 이름이 필요해지면 활성화한다(검토 필요).
- **#4 `capture-pane`은 pane별 1회**이며 target은 안정 식별자인 `pane_id`(`%12`)를 쓴다. `-S -<N>`으로 하단에서 `N`줄 위부터 capture한다. escape sequence를 포함하지 않도록 `-e`를 쓰지 않는다(평문 capture).

### 2.2 `-F` format token

field 구분자는 충돌을 피하기 위해 **US(0x1F, unit separator)** 단일 문자를 쓴다(session 이름·경로에 공백/`:`/탭이 포함될 수 있음). 아래 표기에서 `<US>`는 0x1F 리터럴이다.

`FMT_S` (`list-sessions`):
```text
#{session_id}<US>#{session_name}<US>#{session_windows}<US>#{session_attached}<US>#{session_activity}
```

`FMT_P` (`list-panes -a`, 권위 소스):
```text
#{session_name}<US>#{window_index}<US>#{pane_index}<US>#{pane_id}<US>#{pane_current_command}<US>#{pane_title}<US>#{pane_current_path}<US>#{pane_activity}<US>#{pane_pid}<US>#{pane_dead}<US>#{pane_active}
```

`FMT_W` (`list-windows -a`, 선택):
```text
#{session_id}<US>#{session_name}<US>#{window_id}<US>#{window_index}<US>#{window_name}<US>#{window_panes}<US>#{window_active}<US>#{window_activity}
```

### 2.3 pane별 raw metadata 필드(R-TMUX-002)

`list-panes -a` 한 줄을 `<US>`로 split해 pane raw record를 만든다. 본 슬라이스가 보장하는 필드와 출처:

| 필드 | 타입 | 출처 token | 비고 |
| --- | --- | --- | --- |
| `tmuxTarget` | string | 파생: `#{session_name}:#{window_index}.#{pane_index}` | 사람이 읽는 target. **표시 전용**(rename/reindex로 가변). 제어/재검증 식별자는 `paneId`. |
| `paneId` | string | `#{pane_id}` | 안정 식별자. 형식 `^%[0-9]+$` (예: `%12`). |
| `sessionName` | string | `#{session_name}` | |
| `windowIndex` | integer | `#{window_index}` | 정수 파싱. |
| `paneIndex` | integer | `#{pane_index}` | 정수 파싱. |
| `command` | string | `#{pane_current_command}` | pane의 현재 foreground command. **raw 그대로 보관**(basename 가공 없음). |
| `paneTitle` | string | `#{pane_title}` | 빈 문자열 가능. |
| `cwd` | string | `#{pane_current_path}` | 절대 경로. |
| `lastActivityAt` | string (ISO 8601) | `#{pane_activity}` | epoch seconds → ISO 8601(local offset) 변환. tmux 버전 의존(아래 가설). |

> **`command` 소유 경계(이중 basename 방지)**: 본 spec은 `command`를 raw `#{pane_current_command}` 그대로만 보관하고 basename으로 가공하지 않는다(직렬화도 raw 통과 — [[SPEC-005-data-contract]]). basename 파생은 **소비자 소유**다: [[SPEC-003-agent-detection]]가 `currentCommand = basename(command)`를 **한 번만** 도출한다(§2.1 `PaneSignal`). SPEC-002에서 basename을 만들면 소비자에서 다시 basename을 취하는 이중 가공이 되므로 금지한다.

보조 신호 토큰(`pane_pid`, `pane_dead`, `pane_active`, `session_activity`, `window_*`)도 같은 호출로 함께 수집하지만, 이들을 소비하는 의미 해석(예: `pane_dead`/`pane_pid` 기반 `terminated` 판정, camp 단위 집계, `lastActivityAt` rollup)은 [[SPEC-004-status-inference]]·[[SPEC-005-data-contract]] 소유다. 본 spec은 **수집과 타입까지만** 책임진다. 단, `pane_pid`를 입력으로 하는 `cmdline`/process-alive 수집은 본 spec이 소유한다(§2.8).

### 2.4 `capture-pane` line window

- 호출 형태: `tmux capture-pane -p -t <paneId> -S -<N>`.
- `N`(capture할 줄 수) 기본값은 **PoC 검증 가설**이며 초기값 `200`([[14-MVP-PoC-Scope]])을 사용한다. 실제 line/byte limit·잘림 표시·redaction은 [[SPEC-006-privacy-redaction]]가 소유한다.
- capture된 raw text는 메모리에만 두고, 사용 전 [[SPEC-006-privacy-redaction]]에 전달한다. 본 단계는 원문을 stdout/파일/debug log에 남기지 않는다([[02-Requirements]] R-PRIV-004, R-PRIV-005).

### 2.5 빈 상태 / 가용성 상태(R-TMUX-006)

수집 결과에 tmux 가용성 상태를 포함한다. 3종을 구분한다(직렬화 필드명은 [[SPEC-005-data-contract]]; 여기서는 의미 상태를 정의).

| 상태 | 판정 신호 | 의미 |
| --- | --- | --- |
| `not_installed` | phase 0 `tmux -V` spawn 실패(`ENOENT`) 또는 PATH에 tmux 없음 | `installed=false`. 이후 단계 중단. |
| `server_not_running` | `installed=true`, phase 1 `list-sessions`가 non-zero exit + stderr가 `no server running`/`error connecting`(No such file or directory) 패턴 | `installed=true`, `serverRunning=false`, camps 없음. |
| `running_no_session` | `installed=true`, phase 1 exit 0 + stdout가 비어 있음 | `installed=true`, `serverRunning=true`, session/camps 빈 목록. |

정상(session 존재)은 phase 1 exit 0 + stdout 비어있지 않음이며 phase 2로 진행한다.

### 2.6 timeout·error isolation·`diagnostics.tmuxErrors`(R-TMUX-004)

- 모든 tmux command는 **단일 command timeout** `T`를 가진다. `T` 기본값은 **PoC 검증 가설**(초기 제안: command당 `2000ms`). 추가로 scan 전체 시간 예산이 필요한지는 Open Question.
- timeout 초과 시 자식 process를 종료(SIGTERM, 미종료 시 SIGKILL)한다. 대상 command는 read-only이므로 종료가 tmux 상태를 바꾸지 않는다.
- **error isolation 모델**:
  - `probe` 단계(`tmux -V`) 실패는 §2.5 가용성 판정에 쓰인다. `ENOENT`(미설치)는 `not_installed`로 분기하고, 그 외 실패(timeout 등 binary는 있으나 probe 비정상)는 `diagnostics.tmuxErrors`에 phase=`probe`, command=`version`으로 기록한다.
  - `inventory` 단계(`list-sessions`/`list-panes`) 실패·timeout = **scan 수준 실패**. 예외를 던지지 않고 `diagnostics.tmuxErrors`에 기록하며, last-good snapshot이 있으면 stale로 fallback한다(§2.7).
  - `capture` 단계(`capture-pane`) 실패·timeout = **target별 격리**. 해당 pane만 preview 없이 두고 `diagnostics.tmuxErrors`에 target과 함께 기록하며, **다른 pane 수집은 계속**한다. 단일 pane 오류가 전체 scan을 중단시키지 않는다.
- `diagnostics.tmuxErrors[]` 각 항목 필드(직렬화 envelope는 [[SPEC-005-data-contract]] 소유, 내용·의미는 본 spec 소유):

  | 필드 | 타입 | 의미 |
  | --- | --- | --- |
  | `phase` | enum `probe`/`inventory`/`capture` | 실패 단계 |
  | `command` | enum `version`/`list-sessions`/`list-windows`/`list-panes`/`capture-pane` | 실패한 command. probe(`tmux -V`) 실패는 `version`. [[SPEC-005-data-contract]] §2.1 `TmuxError.command` enum과 일치. |
  | `target` | string \| null | capture 오류는 `paneId`, bulk 오류는 `null` |
  | `kind` | enum `spawn_error`/`timeout`/`exit_nonzero`/`parse_error` | 실패 유형 |
  | `exitCode` | integer \| null | 비정상 종료 코드(없으면 null) |
  | `message` | string | tmux stderr 요약. **capture된 pane 원문을 포함하지 않는다.** |

### 2.7 last-good vs stale snapshot(R-TMUX-005)

- scanner는 process 수명 동안 **마지막으로 성공한 inventory snapshot**(last-good)과 그 수집 시각(`lastGoodAt`)을 메모리에 보관한다. (반복/`--watch` scan에서 의미를 가진다.)
- 각 산출 snapshot은 staleness 의미값을 가진다(직렬화 필드는 [[SPEC-005-data-contract]]):
  - 현재 scan의 inventory 수집 성공 → `stale=false`, 데이터 = 이번 scan 결과.
  - 현재 scan의 inventory 수집 실패 + last-good 존재 → `stale=true`, 데이터 = last-good, `lastGoodAt` 포함, 실패는 `diagnostics.tmuxErrors`.
  - 현재 scan 실패 + last-good 없음(예: 단발 scan 첫 실행) → 데이터를 위조하지 않는다. 빈 inventory + `stale=false` + `diagnostics`에 실패 기록.

### 2.8 process introspection 수집(`cmdline`/process-alive) — 선택적·degradable([[08-Decisions|D-020]])

[[SPEC-003-agent-detection]] §2.1/§2.4는 agent type 판정 Tier B(generic runtime wrapper `node`/`python` + adapter signature)와 process-alive 신호를 위해 pane foreground 프로세스의 **argv 문자열(`cmdline`)**과 **생존 여부(process-alive)**를 소비한다. 이 두 신호는 tmux가 직접 주지 않으므로 **본 spec이 수집을 소유**한다([[08-Decisions|D-020]]). 청사진의 "process command line cross-platform 안정성" Open Question([[05-Backend]])을 부분 해소한다.

- **수집 경로**: §2.2 `FMT_P`가 이미 가져온 `#{pane_pid}`를 입력으로, `pane_pid → ps`(또는 OS별 introspection; 예 `ps -o command= -p <pid>`)로 foreground argv와 생존 여부를 얻는다. tmux subcommand가 아니므로 [[SPEC-006-privacy-redaction]] §2.6의 `tmuxExec` allowlist **밖의 별도 subprocess**다(allowlist는 tmux 바이너리에만 적용).
- **non-tmux지만 동등 안전 계약(READ-ONLY)**: 이 subprocess는 상태를 바꾸지 않는 **읽기 전용**이며 tmux 호출과 동등한 안전 계약을 따른다 — **고정 argv**(사용자 입력 비보간), `shell:false`, per-call timeout `T`(§2.6과 동일), **target(pid)별 error isolation**, 실패 시 해당 필드 **`null` 반환**. 상세 subprocess 강화(spawn 강제·인자 고정·timeout/SIGTERM·SIGKILL 처리)는 [[SPEC-006-privacy-redaction]] §2.6의 강제 메커니즘과 정합하며 그 spec이 강화를 소유한다(본 spec은 수집 계약만 정의).
- **선택적·degradable**: 수집은 best-effort다. pid 없음/`ps` 실패(non-zero)/timeout/미지원 플랫폼이면 `cmdline`=`null`, process-alive=`null`(또는 tmux의 `#{pane_dead}` fallback)로 두고 **그 pane에 격리**해 다른 pane·전체 scan을 중단하지 않는다. 획득 불가 시 [[SPEC-003-agent-detection]] Tier B는 `paneTitle`(신뢰도 중)로 fallback한다(§2.4 cross-ref).
- **cross-platform 안정성(가설)**: macOS/Linux `ps`의 출력 형식·플래그·argv 잘림 차이로 cmdline 파싱이 달라질 수 있다. cmdline 수집의 cross-platform 안정성은 **PoC 검증 가설**이며 [[SPEC-007-test-validation]]에서 측정·보정한다([[08-Decisions|D-020]]).
- **redaction 경계**: `cmdline` 원문(예: argv의 `--token=…`)은 사용 전 [[SPEC-006-privacy-redaction]] redaction을 거친다([[02-Requirements]] R-PRIV-004/R-PRIV-005). capture 원문과 동일하게 stdout/파일/debug log에 raw로 남기지 않는다.

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다.

1. **read-only 불변식(확정)**: 수집은 §2.1의 4개 read-only subcommand만 호출한다. `send-keys`/`paste-buffer` 등은 어떤 경로로도 호출하지 않는다.
2. **probe → inventory → capture 순서(확정)**: phase 0이 미설치를 판정하면 이후 단계를 중단한다. phase 1이 server 미실행/무session을 판정하면 phase 2/4를 건너뛴다.
3. **단일 bulk inventory(확정)**: pane 메타데이터는 `list-panes -a` 1회 호출에서만 얻는다. pane마다 `list-panes`를 반복 호출하지 않는다.
4. **capture 격리(확정)**: capture는 pane별 독립 호출이며 한 pane 실패가 다른 pane·전체 scan에 전파되지 않는다.
5. **필드 파싱(확정)**: `<US>`로 split한다. 빈 필드는 빈 문자열/`null`로 허용하고 throw하지 않는다. 줄 split은 LF 기준. 필드 수가 format token 수와 불일치하면 그 pane을 `parse_error`로 `diagnostics`에 기록하고 건너뛴다.
6. **정렬 결정성(확정)**: camp/orc 출력 순서는 `sessionName` → `windowIndex` → `paneIndex` 오름차순으로 안정 정렬한다(테스트 가능성).
7. **`lastActivityAt` 변환(가설)**: `pane_activity`를 epoch seconds로 간주해 ISO 8601로 변환한다. tmux 버전에 따라 token 출력 형식이 다를 수 있어(아래 Open Questions) 최소 지원 tmux 버전 검증이 필요하다.
8. **timeout `T` = command당 `2000ms`(가설)**, **capture line window `N` = `200`(가설)**. 둘 다 [[14-MVP-PoC-Scope]]·[[SPEC-007-test-validation]] 측정으로 보정한다.
9. **capture 원문 비노출(확정)**: capture text는 redaction 전 어떤 출력·파일·로그에도 노출하지 않는다(경계만; 규칙은 [[SPEC-006-privacy-redaction]]).

## 4. Acceptance criteria

```text
SPEC-002-AC-01 (R-TMUX-001)
  Given tmux server가 실행 중이고 session/window/pane이 각 1개 이상 있을 때
  When scan이 inventory를 수집하면
  Then `tmux list-sessions`와 `tmux list-panes -a -F <FMT_P>`가 호출되고,
       살아있는 pane 1개당 정확히 1개의 pane raw record가 해당 session 아래에 생성된다.
```

```text
SPEC-002-AC-02 (R-TMUX-002)
  Given 임의의 살아있는 pane이 있을 때
  When 그 pane의 raw record가 만들어지면
  Then record는 tmuxTarget, paneId, sessionName, windowIndex, paneIndex, command,
       paneTitle, cwd, lastActivityAt 9개 필드를 모두 가지며,
       각 필드는 §2.3의 지정 token에서 채워지고 타입(string/integer/ISO 8601)이 일치한다.
```

```text
SPEC-002-AC-03 (R-TMUX-002)
  Given 한 pane raw record가 있을 때
  When 식별자/타임스탬프 필드를 검사하면
  Then paneId는 정규식 `^%[0-9]+$`를 만족하고,
       tmuxTarget == `${sessionName}:${windowIndex}.${paneIndex}` 이며,
       lastActivityAt는 `#{pane_activity}`(epoch초)에서 변환된 유효한 ISO 8601 문자열이다.
```

```text
SPEC-002-AC-04 (R-TMUX-004)
  Given 각 tmux command가 timeout T로 실행될 때
  When 어떤 command가 T를 초과하면
  Then 그 자식 process는 종료되고,
       diagnostics.tmuxErrors에 kind="timeout" 항목이 기록되며,
       scan은 예외 없이 결과를 반환한다(무한 block 없음).
```

```text
SPEC-002-AC-05 (R-TMUX-004)
  Given 여러 pane 중 한 pane의 capture-pane가 실패(non-zero 또는 timeout)할 때
  When scan이 실행되면
  Then 그 실패는 diagnostics.tmuxErrors에 phase="capture", target=<paneId>로 기록되고,
       나머지 모든 pane은 정상적으로 inventory에 포함되어 반환된다(전체 scan 미중단).
```

```text
SPEC-002-AC-06 (R-TMUX-004)
  Given inventory 단계의 list-panes 호출이 실패할 때
  When scan이 실행되면
  Then uncaught exception 없이 종료되고,
       diagnostics.tmuxErrors에 phase="inventory" 항목이 기록된다.
```

```text
SPEC-002-AC-07 (R-TMUX-004)
  Given diagnostics.tmuxErrors에 capture 실패 항목이 있을 때
  When 그 항목의 message를 검사하면
  Then message는 tmux stderr/command 메타데이터만 포함하고,
       capture된 pane 원문 텍스트를 포함하지 않는다([[SPEC-006-privacy-redaction]]).
```

```text
SPEC-002-AC-08 (R-TMUX-006)
  Given tmux 바이너리가 PATH에 없는 환경에서
  When scan을 실행하면
  Then 가용성 상태가 not_installed(installed=false)로 판정되고,
       이후 inventory/capture 단계는 호출되지 않으며 scan은 정상 종료한다.
```

```text
SPEC-002-AC-09 (R-TMUX-006)
  Given tmux는 설치됐으나 server가 실행 중이 아닌 환경에서(list-sessions stderr가 no-server 패턴)
  When scan을 실행하면
  Then 가용성 상태가 server_not_running(installed=true, serverRunning=false)로 판정되고,
       camps가 비며, not_installed와 구분되는 상태가 산출된다.
```

```text
SPEC-002-AC-10 (R-TMUX-006)
  Given tmux server가 실행 중이지만 session이 0개일 때(list-sessions exit 0 + 빈 stdout)
  When scan을 실행하면
  Then 가용성 상태가 running_no_session(installed=true, serverRunning=true, camps=[])로 판정되고,
       not_installed 및 server_not_running과 모두 구분되는 세 번째 빈 상태가 산출된다.
```

```text
SPEC-002-AC-11 (R-TMUX-005)
  Given 직전 scan의 last-good snapshot이 메모리에 있고(반복/--watch),
        현재 scan의 inventory 수집이 실패할 때
  When scan이 결과를 산출하면
  Then 데이터는 last-good 내용으로 채워지고 stale=true 로 표시되며,
       lastGoodAt가 직전 성공 snapshot의 수집 시각으로 설정되고,
       fresh 결과(stale=false)와 구분된다.
```

```text
SPEC-002-AC-12 (R-TMUX-005)
  Given last-good snapshot이 없는 첫 단발 scan에서 inventory 수집이 실패할 때
  When scan이 결과를 산출하면
  Then stale 데이터를 위조하지 않고 빈 inventory(stale=false)를 내며,
       실패는 diagnostics.tmuxErrors에 기록된다.
```

```text
SPEC-002-AC-13 (R-TMUX-001)
  Given 어떤 tmux 상태에서든 scan 전체 실행 중
  When 실제로 spawn된 tmux argv를 관측하면
  Then 호출된 subcommand는 list-sessions/list-windows/list-panes/capture-pane 및 `-V`뿐이고,
       send-keys/paste-buffer 등 상태 변경 subcommand는 한 번도 호출되지 않는다
       (read-only 보장, [[14-MVP-PoC-Scope]]).
```

```text
SPEC-002-AC-14 (R-TMUX-001)
  Given 한 pane의 출력 일부를 capture할 때
  When scan이 capture-pane을 호출하면
  Then 형태가 `capture-pane -p -t <paneId> -S -<N>`이고(`-e` 미사용),
       capture된 raw text는 사용 전 redaction 경계로 전달되며
       stdout/파일/debug log에 원문으로 남지 않는다([[SPEC-006-privacy-redaction]]).
```

```text
SPEC-002-AC-15 (D-020)
  Given pane raw record의 #{pane_pid}가 유효한 프로세스를 가리킬 때
  When 본 단계가 process introspection(`pane_pid → ps`)을 수행하면
  Then 해당 pane의 cmdline(redaction 경계로 전달되는 foreground argv 문자열)과
       process-alive 신호가 채워지고, 이 신호가 [[SPEC-003-agent-detection]] Tier B 입력으로 제공된다.
```

```text
SPEC-002-AC-16 (D-020, R-TMUX-004)
  Given 어떤 pane의 ps 조회가 실패(non-zero/미지원 플랫폼/pid 없음)하거나 timeout일 때
  When scan이 실행되면
  Then 그 pane의 cmdline은 null이 되고(process-alive는 null 또는 #{pane_dead} fallback),
       실패는 그 pane에 격리되어 다른 pane 수집과 전체 scan을 중단시키지 않으며,
       [[SPEC-003-agent-detection]] Tier B는 paneTitle로 fallback한다.
```

```text
SPEC-002-AC-17 (D-020, R-TMUX-001)
  Given process introspection이 비-tmux subprocess(`ps` 등)를 spawn할 때
  When 실제로 spawn된 argv를 관측하면
  Then 호출은 읽기 전용이고 인자가 고정(고정 argv·shell:false, 사용자 입력 비보간)이며 per-call timeout을 가지고,
       어떤 상태 변경 명령도 호출되지 않는다(강화 메커니즘 [[SPEC-006-privacy-redaction]] §2.6).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-TMUX-001 | read-only command set으로 session/window/pane inventory 수집, capture line window | SPEC-002-AC-01, SPEC-002-AC-13, SPEC-002-AC-14 |
| R-TMUX-002 | pane별 9개 raw 필드와 출처 token·타입 정의 | SPEC-002-AC-02, SPEC-002-AC-03 |
| R-TMUX-004 | command timeout, inventory(scan 수준)/capture(target 수준) error isolation, diagnostics.tmuxErrors 구조·privacy | SPEC-002-AC-04, SPEC-002-AC-05, SPEC-002-AC-06, SPEC-002-AC-07 |
| R-TMUX-005 | last-good vs stale 구분, 위조 금지 | SPEC-002-AC-11, SPEC-002-AC-12 |
| R-TMUX-006 | 빈 상태 3종(not_installed / server_not_running / running_no_session) 구분 | SPEC-002-AC-08, SPEC-002-AC-09, SPEC-002-AC-10 |
| [[08-Decisions\|D-020]] | `cmdline`/process-alive의 선택적·degradable 수집(`pane_pid → ps`), non-tmux read-only 동등 안전 계약, 실패 시 null·격리(§2.8) | SPEC-002-AC-15, SPEC-002-AC-16, SPEC-002-AC-17 |

> 전체 추적 매트릭스 통합은 [[SPEC-007-test-validation]]. 직렬화·camp 집계 검증은 [[SPEC-005-data-contract]]와 공동.

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진 보정 필요)

- **C1 — 데이터 계약에 staleness 표현 누락**: [[14-MVP-PoC-Scope]]의 `orc-camp scan --json` 예시 JSON에는 R-TMUX-005가 요구하는 stale/last-good 표현(`stale`, `lastGoodAt` 등)이 없다. [[SPEC-005-data-contract]]가 top-level에 staleness 필드를 추가해야 한다. (본 spec은 의미 상태만 정의, 직렬화는 SPEC-005 소유.)
- **C2 — `tmuxTarget`은 표시 전용**: `tmuxTarget`(`session:window.pane`)은 rename/reindex로 가변이므로 안정 식별·재검증의 기준이 될 수 없다. [[SPEC-001-scan-cli]]·[[SPEC-005-data-contract]] 및 후속 control 슬라이스에서 식별자는 `paneId`를 권위로 두도록 정합화 필요.

### Open Questions

- **Q1 — 단발 scan vs `--watch` (해소: [[08-Decisions|D-014]])**: scan 실행 모델은 **기본 single-shot + `--watch [interval]` opt-in**으로 확정됐다([[08-Decisions|D-014]], [[SPEC-001-scan-cli]] §3.1). R-TMUX-005(last-good vs stale, §2.7)는 `--watch`/반복 실행에서 의미를 가지며, 단발 첫 실행에서 prior-의존 신호가 저하되는 것은 의도된 동작이다. last-good은 §2.7대로 process 수명 동안 메모리에 보관한다. read-only 불변식은 `--watch`에서도 유지된다.
- **Q2 — `pane_activity` 형식의 tmux 버전 의존성**: `#{pane_activity}`가 epoch seconds로 출력되는지는 tmux 버전에 따라 다를 수 있다. 최소 지원 tmux 버전과 변환 규칙(ISO 8601) 검증 필요(PoC).
- **Q3 — `running_no_session` 관측 가능성**: tmux server는 마지막 session이 닫히면 종료되는 경향이 있어 "server 실행 + session 0개"가 실제로 재현 가능한지 검증 필요. 재현 불가하면 3종 구분 중 이 상태는 사실상 도달 불가일 수 있다(R-TMUX-006 구분 신뢰도).
- **Q4 — timeout 값과 scan 시간 예산**: command당 `T=2000ms`(가설) 외에 scan 전체 시간 예산이 별도로 필요한가? 20 pane 기준 capture pane당 1 spawn × N이 latency 목표(p95 < 1s, [[14-MVP-PoC-Scope]])를 넘을 수 있어 [[SPEC-007-test-validation]] 측정 필요.
- **Q5 — `list-windows -a` 필요성**: `windowCount`/`paneCount`/`window_name`을 `list-panes -a` 파생으로 충분히 얻을 수 있다면 #3 호출을 생략해 spawn을 줄인다(검토 필요). window 이름 표시 요구가 생기면 활성화.
- **Q6 — capture 줄 수 `N`과 redaction 경계**: line window `N`은 [[SPEC-006-privacy-redaction]]의 line/byte limit과 정합해야 한다. capture 단계에서 `N`줄을 받고 limit을 redaction 단계에서 다시 자르는지, 수집 단계에서 한 번에 제한하는지 경계 합의 필요.
