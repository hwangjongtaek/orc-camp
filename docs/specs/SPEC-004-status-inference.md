---
spec: SPEC-004
title: Status·confidence 추론
status: approved
updated: 2026-06-28
requirements: [R-ORC-003, R-ORC-004, R-ORC-005, R-ORC-006]
decisions: [D-012, D-020]
tags:
  - specs
  - detection
  - status-inference
  - confidence
---

# SPEC-004 — Status·confidence 추론

이 spec은 `orc-camp scan` 슬라이스([[14-MVP-PoC-Scope]], [[08-Decisions]] D-012)에서 **하나의 orc 후보로부터 실행 상태(status)·확신도(statusConfidence)·현재 작업 추정(currentWorkSummary / summarySource)을 추론**하는 규칙을 고정한다. 입력은 [[SPEC-002-tmux-discovery]]가 수집한 raw 신호와 [[SPEC-003-agent-detection]]가 만든 `OrcCandidate`(type 축)이며, 본 spec은 그 위에 **status 축**을 더한다. type 판정은 다시 하지 않는다.

판정 결과는 `status ∈ {active, waiting, idle, stale, error, unknown, terminated}`와 `statusConfidence ∈ [0,1]`, 그리고 `currentWorkSummary`/`summarySource`다. 제품 최대 미검증 리스크인 "AI agent 상태 추론 정확도(특히 `waiting`)"를 정밀 신호 규칙과 confidence 모델로 다룬다([[07-Roadmap]] 리스크, [[14-MVP-PoC-Scope]] PoC 지표).

> 이 문서의 모든 임계값·confidence 수치·pattern은 **확정 사양이 아니라 PoC로 측정·보정할 초기 가설**이다([[SPEC-000-conventions]] 표기 규칙). "가설:" 표시가 있는 값은 [[SPEC-007-test-validation]]의 측정으로 확정한다. 확정 규칙(불변식)은 본문에서 "확정"으로 명시한다.

> **read-only / privacy 불변식(확정)**: status 추론은 어떤 tmux command도 직접 호출하지 않는다. 입력 신호는 모두 [[SPEC-002-tmux-discovery]]가 read-only(`list-*`/`capture-pane`)로 수집하고 [[SPEC-006-privacy-redaction]]가 **redaction을 적용한 후**의 데이터다. 추론기는 capture 원문·`paneTitle` 원문을 저장·로그하지 않으며, signal provenance에는 매칭된 **rule id만** 남긴다([[02-Requirements]] R-PRIV-004, R-PRIV-005).

## 1. Scope

### In scope

- 단일 orc 후보의 신호 집합으로 `status`와 `statusConfidence`를 산출하는 결정 규칙과 상태 우선순위(precedence).
- 신호 분해: 직전 scan 대비 capture 내용 변화(line-hash/region compare), 입력 대기 prompt pattern, 비활동 지속 시간 임계, error/traceback pattern, process-alive / `pane_dead` / exit state, snapshot staleness.
- `active` "내용 변화"의 노이즈(스피너/타임스탬프) 억제 규칙과 `waiting` 오탐/미탐 억제 규칙.
- single 신호 → 낮음, 다중 일치 신호 → 높음의 confidence 모델과 band별 단조성 요구.
- `currentWorkSummary` 추출 규칙과 `summarySource ∈ {pane_title, recent_output, recent_prompt, user_label, unknown}` 선택 규칙, 추정값 단정 표시(estimated).
- `terminated` vs `stale` 표현과 짧은 retention(즉시 제거 금지) lifecycle 규칙(R-ORC-006).
- 다룬 요구사항: R-ORC-003, R-ORC-004, R-ORC-005, R-ORC-006.

### Out of scope (다른 spec으로)

| 항목 | 이유 | 소유 spec |
| --- | --- | --- |
| `agentType` / `agentTypeConfidence` 판정 | type 축은 별도 | [[SPEC-003-agent-detection]] |
| pane raw 수집(`list-panes`/`capture-pane` 호출, `pane_activity`/`pane_dead` token, last-good snapshot 보관) | 추론기는 **이미 수집된** 신호를 소비만 한다 | [[SPEC-002-tmux-discovery]] |
| `--json`/table 출력 shape, 필드 직렬화·estimated 표시 glyph(`~`/`(est)`) | 데이터 계약·CLI 표면 | [[SPEC-005-data-contract]], [[SPEC-001-scan-cli]] |
| redaction pattern·capture line/byte limit·원문 비저장 정책 | 추론 입력은 **redaction 적용 후** 데이터 | [[SPEC-006-privacy-redaction]] |
| 단발 scan vs `--watch` 반복 실행 결정, scan 주기 default | CLI 실행 수명주기 | [[SPEC-001-scan-cli]] (Open Question §6) |
| status별 sprite/animation·overlay 매핑 | 시각 렌더 | [[14-MVP-PoC-Scope]] 런타임 Asset 계약 |

> `roaming`은 [[14-MVP-PoC-Scope]] asset 매핑의 **시각 상태**일 뿐 status enum 값이 아니다. 본 spec의 status는 7종(`active`/`waiting`/`idle`/`stale`/`error`/`unknown`/`terminated`)으로 고정하며 [[02-Requirements]] "상태 모델" 표와 일치한다.

## 2. Contract — `inferStatus(input): StatusInference`

### 2.1 입력 — `StatusInput`

추론기는 [[SPEC-003-agent-detection]]의 `OrcCandidate`(type 축)와, [[SPEC-002-tmux-discovery]]가 수집한 lifecycle/시간 신호, redaction 적용 후 `PaneSignal`, 그리고(가능하면) 직전 scan의 orc 상태를 받는다.

```ts
type OrcStatus =
  | 'active' | 'waiting' | 'idle'
  | 'stale' | 'error' | 'unknown' | 'terminated';

type SummarySource =
  | 'pane_title' | 'recent_output' | 'recent_prompt' | 'user_label' | 'unknown';

interface StatusInput {
  candidate: OrcCandidate;     // [[SPEC-003-agent-detection]] 결과(type 축). non-candidate(null)는 애초에 여기 오지 않는다
  pane: PaneSignal;            // redacted 신호: recentOutput[], paneTitle, currentCommand 등(SPEC-003 §2.1)

  lifecycle: {                 // [[SPEC-002-tmux-discovery]] raw metadata(§2.3 보조 신호)
    paneId: string;            // 권위 식별자 "%12" — orc identity (tmuxTarget은 표시 전용)
    paneDead: boolean;         // #{pane_dead}
    panePid: number | null;    // #{pane_pid} (process-alive 보조; null=미가용)
    processAlive: boolean | null; // #{pane_pid}(=pane top, 보통 shell) 생존. SPEC-002 §2.8. null=미가용
    agentProcessAlive: boolean | null;
                               // 탐지된 agent 프로세스가 pane subtree에 '살아있는가'(liveness-gate 핵심 입력)
                               //   파생식(확정): processTree == null  → null   (subtree 미가용, 생존 입증 불가)
                               //               else (candidate.processCorroborated ? true : false)
                               //   true  = SPEC-003 OrcCandidate.processCorroborated (G-CMD foreground=agent OR G-PROC subtree에 agent)
                               //   false = processTree 가용한데 process-corroborated 아님 (탐지가 stale title/banner 잔여뿐)
                               //   null  = subtree introspection 미가용(SPEC-002 §2.9 fail-closed)
    lastActivityAt: string;    // ISO 8601, #{pane_activity} 변환값
  };

  scannedAt: string;           // 현재 scan 시각 (ISO 8601). lastActivityAt와의 차이가 비활동 시간
  snapshotStale: boolean;      // [[SPEC-002-tmux-discovery]] §2.7: 이번 데이터가 last-good fallback인가
  captureUnavailable: boolean; // 이 pane의 capture-pane이 target별로 실패했는가(SPEC-002 §2.6 격리)

  prior?: PriorOrcState | null;// 직전 scan에서 같은 paneId의 상태(차분/active·terminated 판정용). 단발 scan이면 null
  userLabel?: string | null;   // 사용자 alias/note(R-P1-001). scan 슬라이스 MVP에선 보통 null
}

interface PriorOrcState {
  paneId: string;
  captureFingerprint: string[]; // 직전 capture의 정규화 line-hash(원문 아님, §3.2). privacy 안전
  status: OrcStatus;
  lastActivityAt: string;
  observedAt: string;           // 직전 snapshot 수집 시각(terminated grace TTL 계산용)
}
```

- type 판정에 쓰는 `currentCommand`/`cmdline` 등은 [[SPEC-003-agent-detection]] 소유이며, 본 추론기는 `lifecycle`·시간·`recentOutput`·`paneTitle`만을 status 신호로 쓴다.
- `prior`는 **직전 scan 결과가 있을 때만** 채워진다(반복/`--watch`). 단발 scan 첫 실행이면 `null`이며, 이때 차분 기반 신호(`active`·"disappeared" `terminated`)는 사용 불가다(§3.6, Open Question Q1).
- 입력은 이미 redacted이므로 추론기는 raw secret을 다루지 않는다. `captureFingerprint`는 **해시 배열**이라 원문을 보존하지 않는다(privacy 불변식 충족).

### 2.2 출력 — `StatusInference`

```ts
interface StatusSignalMatch {
  signal: 'change' | 'prompt' | 'idle_time' | 'error' | 'lifecycle' | 'stale';
  status: OrcStatus;        // 이 신호가 가리킨 status
  ruleId: string;           // 매칭된 rule id(원문 아님). 예 "waiting/prompt.yn", "active/change.region"
  strength: 'A' | 'B' | 'C';// A=강(차분 일치/명시 신호), B=중, C=보강/단일
}

interface StatusInference {
  status: OrcStatus;            // 7종 enum
  statusConfidence: number;     // [0,1]. 항상 함께 반환(확정)
  statusSignals: StatusSignalMatch[]; // 기여 신호 provenance(calibration·debug). rule id만, 원문 없음
  currentWorkSummary: string | null;  // redaction 후 데이터에서 추출(§3.5). 없으면 null
  summarySource: SummarySource;       // 선택된 source(없으면 'unknown')
  summaryIsEstimated: boolean;        // 자동 추정이면 true(R-ORC-005). user_label만 false 가능
}
```

- `statusConfidence`는 **항상** 반환한다(확정). status를 확정 사실처럼 단정하지 않으며, 불확실하면 `unknown` 또는 낮은 confidence로 둔다([[02-Requirements]] R-ORC-005).
- 직렬화 필드명·estimated 표시 glyph는 [[SPEC-005-data-contract]]/[[SPEC-001-scan-cli]] 소유다. 본 spec은 의미와 boolean/enum 계약만 고정한다.
- 결과는 **결정적(deterministic)**이다(확정): 같은 `StatusInput`은 항상 같은 `StatusInference`를 만든다(테스트 가능성, §3.8).

### 2.3 confidence band(확정 경계, 수치는 가설)

| band | 범위(가설) | 의미 |
| --- | --- | --- |
| HIGH | 0.80 – 1.00 | 다중 신호 일치 또는 명시 신호(예: `pane_dead`) |
| MEDIUM | 0.50 – 0.79 | 단일 강신호 또는 부분 일치 |
| LOW | 0.00 – 0.49 | 단일 약신호, 충돌, 또는 `unknown` |

band 경계 자체는 고정하되 구간 수치와 status별 base는 [[SPEC-007-test-validation]] 측정으로 보정한다.

## 3. Behavior rules

### 3.1 status precedence (확정 순서, 임계값은 가설)

추론기는 아래 ladder를 **위에서 아래로** 평가하고, **처음 만족하는 status로 확정**한다(deterministic). 이는 "데이터 신뢰도 → lifecycle → tail 상태 → 시간"의 우선순위다.

1. **`stale`** — `snapshotStale == true`(이번 데이터가 last-good fallback). 데이터 자체가 fresh가 아니므로 per-pane live 상태를 단정하지 않는다. → `stale`.
2. **`terminated`** — `lifecycle.paneDead == true`, **또는** `prior`에 있던 `paneId`가 이번 fresh inventory에서 사라짐, **또는** `panePid`가 더 이상 살아있지 않음(보조). → `terminated`(retention 규칙 §3.7).
2b. **`terminated` (agent gone — liveness-gate, NEW)** — `lifecycle.agentProcessAlive == false`(subtree는 가용한데 **탐지된 agent 프로세스가 subtree에 없음**: 탐지가 stale pane title/scrollback banner 잔여뿐). pane/shell은 살아있어도 **그 agent의 lifecycle은 끝났다**. → `terminated`(S-AGONE, retention §3.7). 이 gate가 §3에서 **tail 상태(3)보다 먼저**여서, 이미 죽은 세션의 scrollback에 남은 error/prompt/변화로 `error`/`waiting`/`active`를 **잘못 단정하지 않는다**(precision/active FP 근본 수정).
3. **tail 상태** — `recentOutput`이 있을 때, tail(말단 의미 영역)을 검사한다. **단, `agentProcessAlive == false`면 이 단계 전체를 건너뛴다(2b에서 이미 `terminated`)**:
   - tail이 error/traceback/exception pattern이거나 비정상 exit → **`error`**.
   - tail이 입력 대기 prompt pattern이고(차분 모드면) 내용 변화 없음 → **`waiting`**.
   - 직전 대비 "의미 있는 내용 변화"가 있고 최근 활동 ≤ `T_active` → **`active`**. **`active` liveness-gate(확정)**: `active`는 `agentProcessAlive == true`일 때만 HIGH/일반 confidence로 확정한다. `agentProcessAlive == null`(subtree 미가용, 생존 입증 불가)이면 `active`를 **HIGH로 단정하지 않고** 약신호로만(≤ MEDIUM, §3.8 degrade) 둔다. `agentProcessAlive == false`는 2b에서 이미 걸러진다.
4. **시간 기반** — 위에서 미확정이면:
   - 비활동(`scannedAt − lastActivityAt`)이 `T_idle` 초과, 변화·prompt·error 없음 → **`idle`**.
5. **`unknown`** — 위 어느 것도 확정 불가(capture 미가용, 신호 충돌, 단발 scan에서 active를 입증 불가 등). → **`unknown`**.

> `error`를 `active`보다 먼저 보되, error pattern은 **tail(가장 최근 영역)**에서만 발화한다. error 줄 이후에 더 새로운 비-error 출력이 있으면 그 pane은 error로 보지 않는다(스트림 중간의 일시적 error 줄 오탐 방지, §3.4).

> **liveness-gate 요지(R-ORC-005 단정 금지)**: `active`(및 tail의 `error`/`waiting` live 해석)는 **살아있는 agent 프로세스 없이는 단정하지 않는다.** 종전 `processAlive`(=`pane_pid`, 보통 shell)는 shell이 살아있는 한 항상 `true`라 agent 생존을 대변하지 못한다 — 그래서 `agentProcessAlive`(subtree의 agent 노드 생존, [[SPEC-002-tmux-discovery]] §2.9 + [[SPEC-003-agent-detection]] process-corroboration 파생)를 1차 gate로 쓴다.

### 3.2 `active` 내용 변화 — line-hash + region compare (노이즈 억제)

문제 (a): naive raw-diff는 하단 시계/스피너가 1초마다 바뀌어도 "변함"으로 봐 `idle`/`waiting` pane을 `active`로 오탐한다([[14-MVP-PoC-Scope]] Open Question).

규칙(확정 구조, token 집합·임계는 가설):

1. **정규화(normalize)**: 각 capture 줄에서 휘발성 토큰을 마스킹한다 — 가설 집합:
   - 스피너 글리프(`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, `|/-\`, `◐◓◑◒`, block bar 등),
   - 시각/경과(`\d{1,2}:\d{2}(:\d{2})?`, ISO timestamp, `\(\d+s\)`, `\d+ms`),
   - 카운터/진행률(`\d+%`, `\d+/\d+`, `\d+ tokens`, `\d+(\.\d+)?\s?[KMGT]i?B`),
   - 커서 잔여물·trailing whitespace.
2. **fingerprint**: 정규화된 **말단 K줄**(가설 `K=40`)을 각각 해시해 `captureFingerprint`(해시 배열)를 만든다. 해시만 보관하므로 원문을 저장하지 않는다(privacy).
3. **변화 판정**: `prior.captureFingerprint`와 현재 fingerprint를 region(말단 K줄) 단위로 비교한다.
   - **의미 있는 변화** = 마스킹 후에도 내용이 다른 줄이 1개 이상(완전 마스킹/빈 줄 제외). → `active` 후보, HIGH 가능.
   - **휘발성 전용 변화** = 마스킹 전엔 달랐으나 마스킹 후 동일(시계/스피너만 변함). → 단정적 `active` 신호 아님. `active` 후보 LOW(≤0.49)로만 두거나, adapter가 제공한 "working spinner" pattern이 매칭되면 MEDIUM으로 승급(가설).
   - **변화 없음** = fingerprint 동일. → `active` 아님(§3.3/§3.4로 진행).

> region compare는 scrollback 상단 변화(이전 출력이 위로 밀림)로 인한 오탐도 줄인다. K는 PoC로 보정한다.

### 3.3 `waiting` — 입력 대기 prompt pattern (오탐/미탐 억제)

문제 (b): prompt 모양은 Claude Code/Codex별로 다르고, redaction이 prompt 토큰을 가릴 수 있어 미탐/오탐이 모두 난다([[14-MVP-PoC-Scope]] Open Question).

규칙(확정 구조, pattern은 가설·adapter 소유):

1. **위치 제약(오탐 억제, 확정)**: prompt pattern은 `recentOutput`의 **말단 1~2개 비어있지 않은 줄**에서만 인정한다. 출력 중간에 `(y/n)`이 흘러간 것은 waiting이 아니다.
2. **정적 제약(오탐 억제, 차분 모드, 확정)**: 차분 모드(`prior` 존재)에서는 prompt가 tail에 있고 **내용 변화가 없을 때만** `waiting`이다(§3.2 변화 없음). 변화가 진행 중이면 `active`로 본다. 단발 scan(prior 없음)에서는 정적 제약을 검증할 수 없어 confidence를 MEDIUM 이하로 cap한다.
3. **generic prompt pattern(가설)**: 줄이 `(y/n)`/`[Y/n]`/`[y/N]`로 끝남, `?`로 끝나는 질문, 빈 `> `/`❯ ` 프롬프트, `Press Enter`/`Continue?`/`Do you want to …`, 번호 선택지(`1)`/`2)`/`1.`/`2.`) 메뉴.
4. **adapter-specific prompt(가설, 미탐 억제)**: 각 agent adapter([[SPEC-003-agent-detection]])가 자기 고유 권한/승인 prompt 모양을 소유한다(예: Claude Code permission prompt, Codex approval prompt). adapter-specific 매칭은 generic보다 강하며 HIGH로 승급할 수 있다.
5. **redaction 상호작용(검토 필요)**: redaction이 prompt의 식별 토큰까지 가려 미탐이 나는지 [[SPEC-006-privacy-redaction]]와 정합 검증한다(§6).

confidence(가설):
- adapter-specific prompt + 정적(차분) → HIGH(0.85).
- generic prompt + 정적(차분) → MEDIUM(0.65).
- generic prompt + 단발(정적 미검증) → MEDIUM cap(≤0.60).
- generic prompt + 내용 변화 진행 → `waiting` 아님(active 우선).

### 3.4 `error` — error/traceback/exit 신호

규칙(확정 구조, pattern은 가설):

- **tail 제약(확정)**: error pattern은 말단 의미 영역에 있을 때만 발화한다. error 줄 뒤에 더 새로운 비-error 출력이 있으면 error로 보지 않는다(§3.1 note).
- **generic error pattern(가설)**: `Traceback (most recent call last)`, `Error:`/`Exception`/`panic:`/`fatal:`, `command not found`, stack frame 줄, 비정상 종료 메시지.
- **exit 신호(가설)**: command가 종료되며 비정상 exit를 시사하는 출력. (정밀 exit code는 scan 슬라이스에서 일반적으로 미가용 — `pane_dead`/process 신호와 결합.)

confidence(가설):
- 명시적 traceback(다중 줄) 또는 (비정상 exit + error 줄) → HIGH(0.85).
- 단일 error keyword만 → MEDIUM(≤0.60). keyword가 정상 출력의 일부일 수 있어 단정하지 않는다.

### 3.5 `currentWorkSummary` / `summarySource` (redaction 후 데이터)

**source 선택 우선순위(확정 순서)** — 가능한 첫 source를 택한다:

1. **`user_label`** — `userLabel`이 있으면 사용. 사람이 단 라벨이므로 신뢰 가능 → `summaryIsEstimated = false`. (scan 슬라이스 MVP에선 보통 없음; enum 값은 예약.)
2. **`recent_prompt`** — `status == waiting`이고 prompt 줄을 추출할 수 있으면, 대기 중인 질문을 요약 → estimated.
3. **`pane_title`** — `paneTitle`이 비어있지 않고 **descriptive**할 때(아래 제외 규칙) → estimated.
4. **`recent_output`** — `recentOutput`의 의미 있는 말단 줄 → estimated.
5. **`unknown`** — 위 어느 것도 없으면 `summarySource='unknown'`, `currentWorkSummary=null`, `summaryIsEstimated=true`.

**추출 규칙(확정)**:
- 입력은 **redaction 적용 후** `PaneSignal`만 사용한다([[02-Requirements]] Open Question 해소 방향: redaction 후 기준). 원문을 재구성하지 않는다.
- 후보 줄이 **전부 redaction placeholder**(`[REDACTED:...]`)이면 그 줄을 요약으로 쓰지 않고 다음 source로 넘어간다(secret을 요약으로 노출 금지).
- 단일 줄로 정규화하고 최대 길이 가설 `L=80`자로 truncate한다(초과 시 말미 생략). 제어문자는 capture 단계(`-e` 미사용)에서 이미 평문.
- `pane_title` **제외 규칙(가설)**: title이 `currentCommand`와 동일, 빈 문자열, 또는 generic(호스트명/`cwd` basename/shell 기본 타이틀) pattern이면 descriptive로 보지 않고 건너뛴다.

**estimated 표시(확정, R-ORC-005)**: `summarySource ∈ {pane_title, recent_output, recent_prompt}` 또는 `unknown`이면 `summaryIsEstimated = true`. `user_label`만 `false`일 수 있다. CLI/JSON의 `~`/`(est)` 표기는 [[SPEC-001-scan-cli]]/[[SPEC-005-data-contract]]가 이 boolean을 소비해 렌더한다.

### 3.6 신호 분해표

| ID | 신호 | 소비 출처(redaction 후) | 가리키는 status | strength | 단발 scan 가용 |
| --- | --- | --- | --- | --- | --- |
| S-STALE | `snapshotStale == true` | [[SPEC-002-tmux-discovery]] §2.7 | `stale` | A | O |
| S-DEAD | `pane_dead == true` | `#{pane_dead}` | `terminated` | A | O |
| S-GONE | `prior` paneId가 fresh inventory에서 사라짐 | prior snapshot diff | `terminated` | A | **X (prior 필요)** |
| S-PID | `panePid`(=pane top, 보통 shell) 미생존 | `#{pane_pid}`+OS 확인 | `terminated` | B | O(부분) |
| **S-AGONE** | **`agentProcessAlive == false`**: subtree 가용한데 탐지된 agent 프로세스 없음(shell은 살아있음) | [[SPEC-002-tmux-discovery]] §2.9 subtree + [[SPEC-003-agent-detection]] process-corroboration 파생 | `terminated` | **B** | **O** |
| S-ERR | tail error/traceback/exit pattern (**agent-alive gated**) | `recentOutput` tail | `error` | A/C | O |
| S-PROMPT-A | adapter-specific 대기 prompt (**agent-alive gated**) | `recentOutput` tail | `waiting` | A | O |
| S-PROMPT-G | generic 대기 prompt (**agent-alive gated**) | `recentOutput` tail | `waiting` | B/C | O |
| S-CHG | 의미 있는 region 변화 + 최근 활동 (**agent-alive gated**) | fingerprint diff(§3.2) | `active` | A | **X (prior 필요)** |
| S-CHG-V | 휘발성 전용 변화 | fingerprint diff(§3.2) | `active`(약) | C | **X (prior 필요)** |
| S-IDLE | 비활동 > `T_idle` | `scannedAt − lastActivityAt` | `idle` | B | O |
| S-RECENT | 최근 활동 ≤ `T_active`(변화 미입증, **agent-alive/null gated**) | `lastActivityAt` | `active`(약, 단발) | C | O |

- **"agent-alive gated"**: 해당 신호는 `agentProcessAlive == false`면 발화하지 않는다(2b에서 `terminated`로 선점). `agentProcessAlive == null`(subtree 미가용)이면 발화하되 `active`는 HIGH로 승급하지 않는다(§3.8 degrade). `agentProcessAlive == true`면 종전대로 평가한다.

### 3.7 `terminated` vs `stale` lifecycle (R-ORC-006, 확정 규칙)

- **즉시 제거 금지(확정)**: pane/process가 사라지거나 죽어도 orc를 snapshot에서 즉시 빼지 않는다. `terminated`로 **짧게 남겨** 사용자가 변화를 인지하게 한다([[02-Requirements]] R-ORC-006, "상태 모델" 표 fade-out).
- **두 상태의 의미 구분(확정)**:
  - `terminated` = **그 pane/process가 끝남**(해당 orc의 lifecycle 종료). 출처: `pane_dead`/사라짐/process 미생존/**agent 프로세스 부재(S-AGONE)**.
  - `stale` = **snapshot 전체가 오래됨**(scanner가 refresh 실패해 last-good 재사용). 출처: [[SPEC-002-tmux-discovery]] §2.7. pane은 살아있을 수 있고, 단지 fresh 데이터가 없는 것이다.
  - 그래서 precedence는 `stale`(§3.1-1)이 먼저다: inventory를 refresh하지 못하면 현재 `pane_dead`를 알 수 없으므로 `terminated`를 단정할 수 없다.
- **agent-gone vs pane-dead 구분(확정, NEW)**: `pane_dead`(S-DEAD)는 **pane 자체**가 죽은 것이고, S-AGONE은 **pane/shell은 살아있으나 그 안에서 돌던 agent가 종료**된 것이다(예: claude를 끝내고 shell 프롬프트로 돌아온 `-zsh` pane, 그러나 pane title/scrollback에 claude 잔여). 둘 다 "해당 orc의 agent lifecycle 종료"이므로 `terminated`로 수렴하되, S-AGONE은 agent 동일성 추정을 포함하므로 confidence가 낮다(아래).
- **retention 윈도우(가설)**: `terminated` orc는 사라진 뒤 grace TTL `T_term`(가설: 약 10s 또는 2 scan cycle) 동안 snapshot에 `terminated`로 유지되고, 이후 scan부터 생략될 수 있다. 단발 scan에서는 scan 시점 `pane_dead==true`인 pane 또는 `agentProcessAlive==false`인 pane만 1회 `terminated`로 표시된다("사라짐" 차분은 prior가 필요 — Q1). S-AGONE의 retention 정리(잔여 후보를 몇 cycle 뒤 생략) 역시 [[SPEC-003-agent-detection]] §3.2-3 residual cap과 함께 §6 Q7에서 보정한다.
- confidence(가설): `pane_dead==true` → HIGH(0.95). prior 대비 사라짐 → HIGH(0.90). `panePid` 미생존만 → MEDIUM(0.65, 다른 child로 인한 오판 여지). **S-AGONE(agent 프로세스 부재)** → MEDIUM(가설 0.65): subtree로 agent 부재는 객관적이나, 탐지가 stale title/banner 잔여라는 추정이 섞여 HIGH로 단정하지 않는다(R-ORC-005).

### 3.8 confidence 결합·calibration (단조성)

- **단일 신호 = 낮음, 다중 일치 = 높음(확정 원칙)**: 같은 status를 가리키는 신호가 N개면 base에서 corroboration으로 가산한다 — `confidence = min(cap, maxBase + 0.05 × (N−1))`(가설). 보강은 더하기만 하고 빼지 않는다.
- **충돌 처리(확정)**: 서로 다른 status를 강하게 가리키는 신호가 충돌하면 precedence(§3.1)로 status를 정하되 confidence를 MEDIUM 이하로 cap하고 충돌을 `statusSignals`에 남긴다. 충돌이 본질적으로 해소 불가면 `unknown` + LOW.
- **단발 scan cap(확정)**: `prior`가 없으면 차분 의존 status(`active`)는 입증 불가다. 이때 `active`는 S-RECENT(약신호)로만 LOW(≤0.49) 후보가 되거나 `unknown`으로 둔다. `waiting`은 정적 제약 미검증으로 MEDIUM cap.
- **liveness-gate degrade(확정, NEW)**: `agentProcessAlive == false`면 `active`/live-`error`/live-`waiting`을 단정하지 않고 `terminated`(S-AGONE, §3.7)로 수렴한다. `agentProcessAlive == null`(subtree 미가용)이면 agent 생존을 입증할 수 없으므로 `active`를 **HIGH로 승급하지 않는다**(≤ MEDIUM, fail-closed toward 비-active). `agentProcessAlive == true`면 종전 ladder를 그대로 따른다. 이 gate는 종전 `processAlive`(=`pane_pid`/shell, 항상 alive)로는 막지 못한 "죽은 세션의 scrollback을 live active로 오판"을 차단한다(precision 근본 수정).
- **단조성 요구(확정, 측정은 SPEC-007)**: confidence band와 실제 정답률은 단조 증가해야 한다(HIGH 정답률 ≥ MEDIUM ≥ LOW). band별 precision은 [[SPEC-007-test-validation]]의 수동 라벨로 측정·보정한다([[14-MVP-PoC-Scope]] confidence calibration 지표).

### 3.9 임계값 — PoC 검증 가설 표

[[14-MVP-PoC-Scope]] "Status (초기 threshold 제안)"을 본 spec의 초기 가설로 채택한다. **모두 확정 사양이 아니라 PoC 측정 대상**이다([[SPEC-007-test-validation]]).

| 기호 | 의미 | 초기값(가설) | 출처/비고 |
| --- | --- | --- | --- |
| `T_active` | `active` 최근 활동 상한 | 5s | [[14-MVP-PoC-Scope]] |
| `T_idle` | `idle` 비활동 하한 | 30s | [[14-MVP-PoC-Scope]] |
| `T_term` | `terminated` retention grace | ~10s / 2 cycle | R-ORC-006 |
| S-AGONE conf | agent 프로세스 부재(subtree)→`terminated` | 0.65(MEDIUM) | §3.7, liveness-gate |
| `K` | region compare 말단 줄 수 | 40 | §3.2 |
| `L` | summary 최대 길이 | 80자 | §3.5 |
| 휘발성 토큰 집합 | spinner/clock/counter 마스킹 | §3.2 목록 | 노이즈 억제 |
| prompt pattern 집합 | generic/adapter 대기 prompt | §3.3 | adapter 소유 |
| error pattern 집합 | traceback/exception/exit | §3.4 | adapter 보강 |

> `idle`의 상한: 본 spec에서 `stale`은 **scanner 실패 provenance**이지 시간 임계가 아니다(§3.7). 따라서 매우 오래된 비활동도 `idle`로 둔다(필요 시 `unknown`). [[14-MVP-PoC-Scope]]의 "idle = 30s 초과 ~ stale 임계 미만" 문구 중 "stale 임계"는 시간 임계가 아님을 §6 C1에서 정합화한다.

## 4. Acceptance criteria

> 임계값은 §3.9 가설을 따른다. PoC 보정 시 본 AC의 수치도 함께 갱신한다([[SPEC-000-conventions]] 변경 규약). 각 AC는 고정 capture/메타 fixture(Given) → `inferStatus`(When) → status+confidence band(Then)로 검증하며, [[SPEC-007-test-validation]]이 fixture를 보관한다.

- **SPEC-004-AC-01** (R-ORC-003)
  - Given 임의의 orc 후보 fixture에서
  - When `inferStatus`를 실행하면
  - Then 출력은 `status`(7종 enum), `statusConfidence ∈ [0,1]`, `currentWorkSummary`, `summarySource`(5종 enum), `summaryIsEstimated`를 모두 가진다.

- **SPEC-004-AC-02** (R-ORC-003, R-ORC-005)
  - Given capture가 비었고 `prior`가 없으며 prompt/error/idle 신호가 없는 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "unknown"`이고 `statusConfidence ≤ 0.49`(LOW band)이며, status는 statusConfidence 없이 산출되지 않는다.

- **SPEC-004-AC-03** (R-ORC-003)
  - Given `prior`와 현재 fixture가 휘발성이 아닌 줄에서 1개 이상 다르고 `lastActivityAt`가 `scannedAt` 기준 `T_active` 이내인 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "active"`, `statusConfidence ≥ 0.80`(HIGH), `statusSignals`에 S-CHG(`signal="change"`) 항목이 있다.

- **SPEC-004-AC-04** (R-ORC-003, R-ORC-005) — `active` 노이즈 억제(문제 a)
  - Given `prior`와 현재 fixture가 **휘발성 영역(스피너/시계)에서만** 다르고 정규화 후 fingerprint가 동일한 fixture에서
  - When `inferStatus`를 실행하면
  - Then 결과는 `active` HIGH가 아니다(즉 `active`라면 `statusConfidence ≤ 0.49`이거나 status가 `active`가 아니다). 휘발성 전용 churn만으로 HIGH `active`를 단정하지 않는다.

- **SPEC-004-AC-05** (R-ORC-003) — `waiting` 미탐 억제(문제 b)
  - Given `recentOutput` 말단 줄이 입력 대기 prompt(adapter-specific 또는 generic)이고 `prior` 대비 내용 변화가 없는 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "waiting"`, `statusConfidence ≥ 0.50`(MEDIUM 이상); adapter-specific prompt이면 `≥ 0.80`(HIGH).

- **SPEC-004-AC-06** (R-ORC-005) — `waiting` 오탐 억제(문제 b)
  - Given 출력 **중간**에 `(y/n)`이 있으나 말단은 streaming(prior 대비 내용 변화 진행) fixture에서
  - When `inferStatus`를 실행하면
  - Then `status ≠ "waiting"`이다(prompt가 tail이 아니거나 변화 진행 중이면 waiting을 단정하지 않는다).

- **SPEC-004-AC-07** (R-ORC-003)
  - Given 비활동(`scannedAt − lastActivityAt`)이 `T_idle` 초과이고 내용 변화·prompt·error·terminated·stale 신호가 모두 없는 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "idle"`이다.

- **SPEC-004-AC-08** (R-ORC-003)
  - Given `recentOutput` 말단이 다중 줄 traceback pattern인 fixture와, 단일 error keyword만 있는 fixture에서
  - When 각각 `inferStatus`를 실행하면
  - Then 둘 다 `status = "error"`이되, traceback fixture는 `statusConfidence ≥ 0.80`(HIGH), 단일 keyword fixture는 `≤ 0.60`(MEDIUM 이하)이다.

- **SPEC-004-AC-09** (R-ORC-006)
  - Given `lifecycle.paneDead == true`인 pane fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "terminated"`, `statusConfidence ≥ 0.80`(HIGH)이고, 그 orc는 출력에서 즉시 제거되지 않고 `terminated`로 **유지**된다(retention, §3.7).

- **SPEC-004-AC-10** (R-ORC-006, R-TMUX-005)
  - Given `snapshotStale == true`(이번 데이터가 last-good fallback)이고 pane이 직전엔 살아있던 fixture에서
  - When `inferStatus`를 실행하면
  - Then 그 orc의 `status = "stale"`이며 `terminated`와 구분된다(살아있을 수 있는 pane을 종료로 단정하지 않는다).

- **SPEC-004-AC-11** (R-ORC-004)
  - Given source별 가용성을 달리한 fixture 집합(각각 user_label만/waiting prompt만/descriptive title만/recent output만/모두 없음)에서
  - When `inferStatus`를 실행하면
  - Then `summarySource`는 각각 `user_label`/`recent_prompt`/`pane_title`/`recent_output`/`unknown`으로, §3.5 우선순위의 최상위 가용 source와 일치한다.

- **SPEC-004-AC-12** (R-ORC-005)
  - Given source가 `pane_title`/`recent_output`/`recent_prompt` 중 하나인 fixture와, `user_label`인 fixture에서
  - When `inferStatus`를 실행하면
  - Then 자동 추정 source는 `summaryIsEstimated == true`, `user_label` source는 `false`이며, 어떤 경우에도 status는 `statusConfidence`와 함께 반환된다.

- **SPEC-004-AC-13** (R-ORC-004) — privacy 경계
  - Given 요약 후보 줄이 전부 `[REDACTED:...]` placeholder인 fixture에서
  - When `inferStatus`를 실행하면
  - Then 그 줄을 요약으로 쓰지 않고 다음 source로 넘어가며, `statusSignals`에는 rule id만 있고 capture 원문 텍스트가 포함되지 않는다([[SPEC-006-privacy-redaction]]).

- **SPEC-004-AC-14** (R-ORC-005) — calibration 단조성(측정형)
  - Given [[SPEC-007-test-validation]]의 라벨된 fixture 집합에서
  - When band별 정답률을 측정하면
  - Then HIGH band 정답률 ≥ MEDIUM ≥ LOW로 단조 증가한다([[14-MVP-PoC-Scope]] confidence calibration 지표; `waiting` recall ≥ 0.7 목표와 함께 측정).

- **SPEC-004-AC-15** (R-ORC-003) — 결정성
  - Given 동일한 `StatusInput`(같은 `prior` 포함)에서
  - When `inferStatus`를 2회 실행하면
  - Then `status`/`statusConfidence`/`currentWorkSummary`/`summarySource`/`summaryIsEstimated`가 모두 동일하다.

- **SPEC-004-AC-16** (R-ORC-003, R-ORC-005) — `active` liveness-gate(FP-active 근본 수정)
  - Given `lifecycle.agentProcessAlive == false`(subtree 가용·agent 프로세스 없음)이고 `recentOutput`에 직전 대비 변화/최근 활동이 있는(stale scrollback) fixture에서
  - When `inferStatus`를 실행하면
  - Then `status ≠ "active"`이다(살아있는 agent 프로세스 없이 `active`를 단정하지 않는다).

- **SPEC-004-AC-17** (R-ORC-006) — agent-gone → terminated(retention)
  - Given `lifecycle.paneDead == false`이지만 `agentProcessAlive == false`이고 candidate가 stale pane title/banner 잔여로 탐지된 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "terminated"`(S-AGONE), `statusConfidence`는 MEDIUM(가설 ~0.65)이며 그 orc는 즉시 제거되지 않고 retention(§3.7)으로 유지되고, `stale`과 구분된다.

- **SPEC-004-AC-18** (R-ORC-005) — subtree 미가용 degrade
  - Given `agentProcessAlive == null`(subtree introspection 미가용)이고 그 외에는 `active`로 볼 만한 최근 활동만 있는 fixture에서
  - When `inferStatus`를 실행하면
  - Then `active`로 보더라도 `statusConfidence`가 HIGH(≥0.80)에 도달하지 않는다(생존 입증 불가 → 단정 금지, ≤ MEDIUM degrade).

- **SPEC-004-AC-19** (R-ORC-003) — agent alive → 정상 ladder
  - Given `agentProcessAlive == true`(G-CMD foreground 또는 G-PROC subtree로 살아있는 agent)이고 `prior` 대비 비휘발성 변화 + 최근 활동이 있는 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status = "active"`, `statusConfidence ≥ 0.80`(HIGH)이다(liveness-gate가 정상 `active`를 막지 않는다).

- **SPEC-004-AC-20** (R-ORC-005, R-ORC-006) — 죽은 세션 scrollback의 error/waiting 오탐 차단
  - Given `agentProcessAlive == false`이고 `recentOutput` tail이 (a) error/traceback이거나 (b) `(y/n)` 대기 prompt인 fixture에서
  - When `inferStatus`를 실행하면
  - Then `status`는 `error`/`waiting`이 아니라 `terminated`다(liveness-gate가 tail 상태보다 먼저 선점, §3.1-2b).

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-ORC-003 | orc별 `status`(7종)+`statusConfidence`+요약 필드 산출, precedence·신호 규칙·결정성. **`active` liveness-gate(agentProcessAlive)** | SPEC-004-AC-01, AC-03, AC-05, AC-07, AC-08, AC-15, AC-16, AC-19 |
| R-ORC-004 | `currentWorkSummary` 추출과 `summarySource`(pane_title/recent_output/recent_prompt/user_label/unknown) 선택, redaction 후 데이터 기준 | SPEC-004-AC-11, AC-13 |
| R-ORC-005 | 추정값·status를 단정하지 않음: 항상 statusConfidence, estimated 표시, 노이즈/오탐 억제, calibration 단조성. **subtree 미가용 degrade·죽은 세션 scrollback 오탐 차단** | SPEC-004-AC-02, AC-04, AC-06, AC-12, AC-14, AC-16, AC-18, AC-20 |
| R-ORC-006 | `terminated` vs `stale` 구분과 즉시 제거 금지(짧은 retention) lifecycle. **agent-gone(S-AGONE, 살아있는 shell·죽은 agent) → terminated retention** | SPEC-004-AC-09, AC-10, AC-17, AC-20 |

> 본 spec은 1차 슬라이스 `R-ORC` 중 status 축(003/004/005/006)을 다룬다. type 축(R-ORC-001/002/007)은 [[SPEC-003-agent-detection]]. R-TMUX-005(stale)는 [[SPEC-002-tmux-discovery]] 소유이며 본 spec은 그 stale 신호를 소비(AC-10 공동). privacy(R-PRIV-004/005)는 [[SPEC-006-privacy-redaction]] 소유이며 본 spec은 경계(AC-13)에서 정합한다. 전체 매트릭스 통합은 [[SPEC-007-test-validation]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진 보정 필요)

- **C1 — `idle` 상한과 시간 기반 `stale` 혼동**: [[14-MVP-PoC-Scope]]의 status 표는 `idle`을 "30s 초과 ~ stale 임계 미만"으로, `stale`을 "scan 실패 또는 last-good"으로 동시에 쓴다. 본 spec은 [[SPEC-002-tmux-discovery]] §2.7과 정합해 `stale`을 **scanner 실패 provenance**로만 정의하고 시간 임계로 두지 않는다(§3.7). 따라서 `idle`에는 시간 상한이 없다. [[14-MVP-PoC-Scope]] 문구 정정 필요(또는 "오래된 비활동"용 별도 상태 도입 여부 결정).
- **C2 — status 입력에 lifecycle/시간 token이 SPEC-003 `PaneSignal`에 없음**: `pane_dead`/`pane_pid`/`lastActivityAt`는 [[SPEC-003-agent-detection]]의 `PaneSignal`에 없고 [[SPEC-002-tmux-discovery]] §2.3 보조 신호다. 본 spec은 `StatusInput.lifecycle`로 따로 받는다(§2.1). [[SPEC-005-data-contract]] 조립 단계가 이 신호를 추론기로 전달하도록 정합화 필요.
- **C3 — `summaryIsEstimated`/`statusSignals` 직렬화 미정**: [[14-MVP-PoC-Scope]] 예시 JSON에는 estimated 표시·status 신호 provenance 필드가 없다. [[SPEC-005-data-contract]]가 `summaryIsEstimated`(또는 동등 표기)와 선택적 `statusSignals` 직렬화를 추가해야 R-ORC-005의 "단정 금지"를 출력에서 보장한다. CLI glyph(`~`/`(est)`)는 [[SPEC-001-scan-cli]] 소유.

### Open Questions (PoC 검증 대상)

- **Q1 — 단발 scan vs `--watch` (핵심)**: `active`(내용 변화)와 `terminated`(prior 대비 사라짐)는 **직전 scan 비교**를 전제한다. scan 슬라이스가 단발만 지원하면 `active`는 S-RECENT 약신호로만 LOW가 되고 "사라짐" terminated는 검출 불가다(§3.6, §3.8 단발 cap). `--watch`(read-only 유지) 채택 여부와 prior snapshot 보관 정책을 [[SPEC-001-scan-cli]]·[[SPEC-002-tmux-discovery]] §2.7과 함께 결정해야 한다([[14-MVP-PoC-Scope]] Open Question). **검토 필요.**
- **Q2 — `active` 변화 판정 노이즈(문제 a)**: line-hash + region compare(§3.2)의 휘발성 토큰 집합·`K`·"working spinner를 active로 볼지"가 PoC 측정 대상이다. 스피너 자체가 작업 신호인 경우(LOW→MEDIUM 승급)와 단순 시계 틱(active 아님)을 어떻게 안정 구분할지 라벨로 보정한다([[14-MVP-PoC-Scope]] Open Question). **검토 필요.**
- **Q3 — `waiting` prompt pattern 특화도(문제 b)**: generic vs adapter-specific prompt 집합을 Claude Code/Codex별로 얼마나 특화해야 false negative가 [[14-MVP-PoC-Scope]] 목표(`waiting` recall ≥ 0.7)를 만족하는가. tail/정적 제약(§3.3)의 오탐/미탐 trade-off와 redaction의 prompt 토큰 마스킹 영향(C와 별개로 §3.3-5)을 함께 측정한다. **검토 필요.**
- **Q4 — `terminated` retention TTL과 cleanup**: `T_term` grace와 "몇 cycle 뒤 생략"은 반복 scan에서만 의미가 있다(Q1 의존). 단발 scan에선 `pane_dead` 시점 1회 표시로 충분한지, [[10-System-Architecture]]의 "terminated pane retention/cleanup"과 정합화 필요.
- **Q5 — `panePid` 기반 process-alive(S-PID)**: `#{pane_pid}`로 얻은 pid의 생존/agent 동일성 확인은 cross-platform 안정성이 미검증이다([[05-Backend]] Open Questions). 미가용/불안정 시 S-PID를 보조(MEDIUM)로만 쓰고 `pane_dead`를 1차 신호로 둔다. **검토 필요.**
- **Q7 — agent-gone(S-AGONE) retention·confidence(NEW, 검토 필요)**: `agentProcessAlive == false`로 `terminated`가 된 잔여 후보를 (a) 몇 cycle/`T_term` 동안 보였다가 생략할지, (b) prior가 없는 단발 scan에서 "방금 종료" vs "오래된 stale title"을 구분할 수 없을 때 confidence(가설 0.65)를 어떻게 둘지([[SPEC-003-agent-detection]] §3.2-3 residual cap과 공동). [[SPEC-007-test-validation]] live-process-tree oracle로 over-terminated/over-active를 함께 측정·보정. **검토 필요.**
- **Q8 — `agentProcessAlive` 파생 위치 (해소)**: [[SPEC-003-agent-detection]] §2.2 `OrcCandidate.processCorroborated`(detector 소유, `matchedSignals`에 `command`/`process` 있으면 true)를 추가해 해소했다. `agentProcessAlive` 파생식(§2.1): `processTree == null → null; else processCorroborated ? true : false`. 조립 단계([[SPEC-005-data-contract]] StatusInput 구성)가 `StatusInput.lifecycle.agentProcessAlive`로 채워 전달하며, 본 추론기는 재-탐지하지 않는다(C2와 동류, ownership dangling 제거).
- **Q6 — `pane_title` descriptive 판정**: §3.5의 "generic title 제외" 규칙(호스트명/cwd basename/shell 기본 타이틀)이 실제 환경에서 유용 요약을 과도하게 버리지 않는지(false skip) PoC 검토 필요.
