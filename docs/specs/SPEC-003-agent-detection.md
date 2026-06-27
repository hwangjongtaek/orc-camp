---
spec: SPEC-003
title: Agent type 핑거프린팅
status: approved
updated: 2026-06-26
requirements: [R-ORC-001, R-ORC-002, R-ORC-007]
decisions: [D-012, D-020]
tags:
  - specs
  - detection
  - agent-detection
---

# SPEC-003 — Agent type 핑거프린팅

이 spec은 `orc-camp scan` 슬라이스에서 **하나의 tmux pane 신호로부터 agent type을 판정**하는 규칙을 고정한다. 판정 결과는 `agentType ∈ {claude-code, codex, unknown}`과 `agentTypeConfidence ∈ [0,1]`이다. 제품 최대 리스크인 "AI agent 탐지 정확도"의 type 축을 단계적 신호·confidence 모델과 확장 가능한 adapter 경계로 다룬다([[14-MVP-PoC-Scope]] 탐지 규칙, [[05-Backend]] Agent Detection).

> 이 문서의 모든 임계값·confidence 수치·signature pattern은 **확정 사양이 아니라 PoC로 측정·보정할 초기 가설**이다([[SPEC-000-conventions]] 표기 규칙). "가설:" 표시가 있는 값은 [[SPEC-007-test-validation]]의 측정으로 확정한다.

## 1. Scope

### In scope

- 단일 pane의 신호 집합으로 `agentType`과 `agentTypeConfidence`를 산출하는 결정 규칙.
- 신호 분해: pane current command, pane title/cmdline, recent output banner/prompt pattern, generic runtime wrapper(`node`/`python` 등) + agent signature 케이스.
- 단계적 confidence 모델(direct command = 최강, wrapper + signature = 중간, output-pattern = 보강).
- "AI agent 후보(candidate)" vs "agent 아님(non-candidate)"의 구분 규칙과, 확정 불가 후보의 `unknown` + 낮은 confidence 처리(R-ORC-002).
- `detect(pane): OrcCandidate` adapter 경계 계약(R-ORC-007). MVP는 인라인 구현이라도 이 인터페이스 형태를 유지한다.
- 다룬 요구사항: R-ORC-001, R-ORC-002, R-ORC-007.

### Out of scope (다른 spec으로)

| 항목 | 이유 | 어느 spec |
| --- | --- | --- |
| `status` / `statusConfidence` / `currentWorkSummary` / `summarySource` 추론 | type 축과 분리 | [[SPEC-004-status-inference]] |
| pane raw field 수집(`list-panes`/`capture-pane` 호출, target/index 등) | detect는 **이미 수집된** 신호를 소비만 한다 | [[SPEC-002-tmux-discovery]] |
| `--json`/table 출력 shape, `Orc` 최종 조립 | 데이터 계약 | [[SPEC-005-data-contract]] |
| redaction pattern과 capture line/byte limit | detect 입력은 **redaction 적용 후** 데이터다 | [[SPEC-006-privacy-redaction]] |

## 2. Contract — `detect(pane): OrcCandidate` adapter 경계

### 2.1 입력 — `PaneSignal`

detect의 입력은 [[SPEC-002-tmux-discovery]]가 수집하고 [[SPEC-006-privacy-redaction]]가 **redaction을 적용한 후**의 read-only 신호 묶음이다. detect는 어떤 tmux command도 직접 호출하지 않으며 원문 output을 보지 않는다.

```ts
interface PaneSignal {
  paneId: string;            // 예 "%12" (provenance용, type 판정에는 미사용)
  tmuxTarget: string;        // 예 "work:1.0" (provenance용)
  command: string;           // #{pane_current_command} 원문 (basename 미적용). SPEC-002가 수집
  paneTitle: string | null;  // #{pane_title}, redacted. 사용자가 임의 설정 가능 → 신뢰도 중
  cmdline: string | null;    // pane foreground 프로세스 argv 문자열, redacted.
                             //   D-020: SPEC-002가 pane_pid→ps로 수집하는 선택적·degradable 신호. 미가용 시 null (2.4)
  cwd: string;               // #{pane_current_path} (type 신호 아님, 통과만)
  recentOutput: string[];    // capture-pane redacted tail, 오래된→최신 순. 비어 있을 수 있음
}
```

- detect는 raw `command`에서 `currentCommand = basename(command)`를 **정확히 한 번** 파생한다. 이 파이프라인에서 basename은 SPEC-003만 적용한다 — [[SPEC-002-tmux-discovery]]는 `#{pane_current_command}` 원문(`command`)을 basename 없이 전달하므로 upstream에서 basename되거나 두 번 적용되지 않는다. 이하 규칙(§3.1 G-CMD 등)은 모두 파생된 `currentCommand`를 참조한다.
- 파생된 `currentCommand`와 `paneTitle`/`cmdline`/`recentOutput`만이 type 신호다. `cwd`·`paneId`·`tmuxTarget`은 type 판정에 사용하지 않는다(provenance·하위 spec 전달용).
- 입력은 이미 redacted이므로 detect는 raw secret을 다루지 않는다. detect는 `recentOutput`/`paneTitle` 원문을 **저장·로그하지 않으며**, signal provenance에는 매칭된 **rule id만** 남긴다(2.3, [[SPEC-006-privacy-redaction]]).

### 2.2 출력 — `OrcCandidate`

```ts
type AgentType = 'claude-code' | 'codex' | 'unknown';

interface SignalMatch {
  signal: 'command' | 'title' | 'cmdline' | 'output';
  tier: 'A' | 'B' | 'C';        // A=direct, B=wrapper+signature, C=output 보강
  matchedType: AgentType;       // 이 신호가 가리킨 type ('unknown'=generic agent 신호)
  ruleId: string;               // 매칭된 adapter rule id (원문 아님). 예 "claude-code/cmd.basename"
}

interface OrcCandidate {
  agentType: AgentType;         // 확정 불가 후보는 'unknown' (R-ORC-002)
  agentTypeConfidence: number;  // [0,1]. status가 아니라 type 확신도
  matchedSignals: SignalMatch[];// 어떤 신호가 기여했는지(calibration·debug·provenance). 비어 있지 않다
}
```

- `detect`는 **type 축만** 책임진다. `status`/summary 필드는 이 인터페이스에 없으며 [[SPEC-004-status-inference]]가 `OrcCandidate`를 받아 채운다. 최종 `Orc`(SPEC-005)는 `detect` 결과 + status 추론의 합성이다.
- `matchedSignals`는 항상 1개 이상이다(후보가 아니면 애초에 `OrcCandidate`를 만들지 않는다 — 2.3). [[SPEC-005-data-contract]]는 이 보장을 `agentSignals` `minItems: 1`로 미러링한다(이 불변식은 약화하지 않는다).

### 2.3 Adapter 인터페이스와 combiner

```ts
interface AgentDetector {
  readonly id: AgentType;                       // 'claude-code' | 'codex' (MVP 2종)
  // 이 adapter가 pane을 자기 type으로 "주장"하면 OrcCandidate, 아니면 null
  detect(pane: PaneSignal): OrcCandidate | null;
}
```

- 각 adapter의 `detect`는 자기 type 신호만 검사한다. **주장 없음 = null**(다른 agent/비-agent를 침범하지 않는다).
- 최상위 `detectOrc(pane, detectors[]): OrcCandidate | null`가 등록된 모든 adapter를 **등록 순서대로** 실행해 결과를 결합(combine)한다. 결합 규칙은 §3.4.
- **null의 의미**: `detectOrc`가 `null`을 반환하면 그 pane은 orc가 아니며 scan 출력에 orc로 등장하지 않는다(non-candidate, §3.3). 즉 "agent 아님"과 "agent지만 확정 불가(`unknown` 후보)"는 다른 결과다.
- **R-ORC-007 (확장 경계)**: 새 agent 지원은 새 `AgentDetector`를 등록 목록에 추가하는 것으로 끝난다. 기존 adapter·combiner 코드를 수정하지 않는다(open-for-extension). MVP는 `detectors` 배열을 인라인 구성해도 되지만 이 형태를 유지한다. adapter rule을 config/plugin으로 외부화하는 것은 P1이다([[02-Requirements]] R-P1-011).

### 2.4 가용성·신뢰도 가정 (가설)

- `currentCommand`는 tmux foreground 프로세스명만 준다. claude-code/codex가 `node` shim으로 실행되면 `currentCommand`가 `node`로 보일 수 있다 → wrapper 케이스(Tier B)의 근거. 설치 방식에 따라 Tier A/B 분기가 갈리므로 PoC에서 실제 분포를 측정한다.
- `cmdline`(argv)은 tmux가 직접 주지 않는다. [[08-Decisions|D-020]]에 따라 **[[SPEC-002-tmux-discovery]]가** `pane_pid` → `ps`(또는 OS별 introspection)로 수집하는 **선택적·degradable 신호**다(수집 소유·timeout·target별 error isolation·실패 시 `null`은 SPEC-002 책임). SPEC-003은 이를 수집하지 않고 소비만 한다. **cross-platform 안정성은 미검증**이다([[05-Backend]] Open Questions). `cmdline`이 `null`이면 Tier B(G-WRAP)는 `paneTitle`로만 fallback해 동작한다.
- `paneTitle`은 사용자가 임의로 덮어쓸 수 있어 신뢰도가 중간이다. 단독으로 Tier A를 만들지 않는다.

## 3. Behavior rules

### 3.1 신호 분해표

| ID | 신호 | 수집 방법(소비 출처) | tier | 강도 | 단독 판정 |
| --- | --- | --- | --- | --- | --- |
| G-CMD | 파생된 `currentCommand`(= `basename(command)`, §2.1에서 1회 산출)가 알려진 agent binary명(`claude`/`claude-code`/`codex`)과 일치 | SPEC-002 `command`(`#{pane_current_command}` 원문) → SPEC-003가 basename | A | 강(direct) | type 확정 + 높은 confidence |
| G-WRAP | `currentCommand`가 generic runtime(`node`/`node.js`/`python`/`python3`/`deno`/`bun`)이고 `cmdline` 또는 `paneTitle`에 adapter signature | `#{pane_current_command}` + `cmdline`/`#{pane_title}` (redacted) | B | 중 | type 추정 + confidence 하향 |
| G-TITLE | `paneTitle`에 adapter signature(generic runtime 여부 무관) | `#{pane_title}` (redacted) | B | 중(가변) | 보강용. 단독 시 wrapper와 동급 처리 |
| G-OUT | `recentOutput` tail에 adapter 고유 banner/prompt pattern | `capture-pane -p` redacted tail | C | 보강 | type 보강만, 단독은 cap 적용 |
| (참고) cwd | `cwd` | `#{pane_current_path}` | — | type 신호 아님 | 미사용 |

- adapter별 signature/banner pattern 집합(예: claude-code는 `claude`/`@anthropic-ai/claude-code`/Claude Code TUI prompt marker, codex는 `codex`/codex CLI prompt marker)은 **각 adapter가 소유**하며 구체 문자열은 가설로, PoC에서 확정한다(§6). 이 spec은 pattern의 정확한 문자열을 고정하지 않는다.

### 3.2 단계적 confidence 모델

각 신호 tier에 base confidence를 부여하고, 동일 type을 가리키는 신호가 복수면 보강한다. **모든 수치는 가설.**

**confidence band 정의(가설, 그러나 구조는 고정)**: band는 `[0,1]` 전체를 **연속(contiguous)·무중첩·무공백**으로 덮는다 — `LOW [0, 0.50)`, `MEDIUM [0.50, 0.85)`, `HIGH [0.85, 1.0]`. 경계값(0.50·0.85)은 PoC로 보정할 가설이지만, 보정 후에도 항상 contiguous 구조를 유지해 [[SPEC-007-test-validation]] M3 calibration bucketing이 in-gap 표본을 조용히 누락하지 못하게 한다. 아래 base/cap/bonus 수치는 가설이다.

| tier | 신호 예 | base confidence (가설) | band |
| --- | --- | --- | --- |
| A | G-CMD (direct command) | 0.95 | HIGH `[0.85, 1.0]` |
| B | G-WRAP / G-TITLE (wrapper+signature) | 0.70 | MEDIUM `[0.50, 0.85)` |
| C | G-OUT (output 단독) | 0.45 | LOW `[0, 0.50)`, **cap 0.60** |
| 후보 unknown | generic/ambiguous/conflict | 0.30 | LOW `[0, 0.50)` |

결합 규칙(가설):

1. 동일 `matchedType`을 가리키는 신호가 N개면 `confidence = min(0.99, maxBase + 0.03 × (N−1))` (corroboration bonus, 단조 증가 보장 — §3.5).
2. **output-only cap**: 기여 신호가 G-OUT뿐이면 `confidence = min(value, 0.60)`. output 단독은 절대 HIGH band(direct)에 도달하지 못한다(R-ORC-002: 단정 금지).
3. 서로 다른 concrete type을 가리키는 신호 충돌은 §3.4.

### 3.3 후보(candidate) vs 비후보(non-candidate)

R-ORC-002의 핵심: "agent 아님"과 "agent지만 type 확정 불가"를 분리한다.

- **non-candidate** (→ `detectOrc` = `null`, orc 미생성): 어떤 adapter도 주장하지 않고 generic agent 신호도 없는 경우. 전형 예: `currentCommand`가 interactive shell(`zsh`/`bash`/`fish`/`sh`/login shell) 또는 명백한 비-agent 앱(`vim`/`nvim`/`emacs`/`less`/`ssh`/`git`)이고, title/cmdline에 signature 없고, output에 banner 없음.
- **candidate** (→ `OrcCandidate` 생성): 최소 1개의 agent 신호가 발화한 경우.
  - concrete 신호(G-CMD/G-WRAP/G-TITLE/G-OUT 중 특정 type 매칭) → 해당 `agentType` + 해당 band confidence.
  - **ambiguous candidate** → `agentType = unknown`, LOW confidence(가설 0.30). 다음 중 하나일 때:
    - generic runtime + "AI agent 같은" 신호는 있으나 어떤 adapter의 고유 signature와도 일치하지 않음(generic agent marker만 발화).
    - 신호 충돌로 단일 concrete type을 고를 수 없음(§3.4).
  - generic agent marker 집합(무엇이 "agent지만 unknown"을 만드는가)은 **보수적으로** 운영한다. 명시적 agent marker(가설 예: argv/title의 `--agent`·`assistant`·`llm` 류, AI prompt 형태)가 있을 때만 unknown 후보로 올리고, 그 외 generic `node` 프로세스(웹서버 등)는 non-candidate로 둔다. marker 집합의 정확한 정의는 오탐/미탐 trade-off로 PoC 검증 대상이다(§6).

### 3.4 충돌 해소(combiner)

`detectOrc`가 adapter 결과를 결합할 때:

| 상황 | 결과 |
| --- | --- |
| concrete 주장 0 + agent marker 없음 | `null` (non-candidate) |
| concrete 주장 0 + generic agent marker 있음 | `unknown` 후보, LOW conf |
| concrete 주장 1 | 그 후보 그대로 |
| concrete 주장 ≥2, **모두 동일 type** | 해당 type, corroboration 보강(§3.2-1) |
| concrete 주장 ≥2, **서로 다른 type** | tier가 유일 최고인 신호가 있으면 그 type을 택하되 confidence를 MEDIUM 상한 이하로 cap하고 conflict를 `matchedSignals`에 남긴다. tier가 동률이면 `unknown` 후보(단정 금지) |

- 결과는 **결정적(deterministic)**이다: 같은 `PaneSignal`과 같은 `detectors` 순서는 항상 같은 `OrcCandidate`를 만든다(테스트 가능성).

### 3.5 calibration 단조성(가설)

confidence band와 실제 정답률은 단조 증가해야 한다([[14-MVP-PoC-Scope]] PoC 지표). 결합 confidence는 항상 기여 신호 base의 max 이상이다(보강은 더하기만, 빼지 않는다). 충돌로 인한 cap은 예외로 명시적으로 낮춘다. 실제 band별 precision은 [[SPEC-007-test-validation]]에서 측정한다.

## 4. Acceptance criteria

> 임계값은 §3 가설을 따른다. PoC 보정 시 본 AC의 수치도 함께 갱신한다([[SPEC-000-conventions]] 변경 규약).

- **SPEC-003-AC-01** (R-ORC-001)
  - Given raw `command`의 basename(= `currentCommand`)이 `claude` 또는 `claude-code`인 pane에서
  - When `detect`를 실행하면
  - Then `agentType = "claude-code"`, `agentTypeConfidence ≥ 0.85`(HIGH band 하한), `matchedSignals`에 `tier="A"` 항목이 1개 이상 있다.

- **SPEC-003-AC-02** (R-ORC-001)
  - Given raw `command`의 basename(= `currentCommand`)이 `codex`인 pane에서
  - When `detect`를 실행하면
  - Then `agentType = "codex"`, `agentTypeConfidence ≥ 0.85`(HIGH band 하한), `matchedSignals`에 `tier="A"` 항목이 있다.

- **SPEC-003-AC-03** (R-ORC-001)
  - Given `currentCommand`가 generic runtime(예 `node`)이고 `cmdline` 또는 `paneTitle`에 claude-code signature가 있는 pane에서
  - When `detect`를 실행하면
  - Then `agentType = "claude-code"`, `0.50 ≤ agentTypeConfidence < 0.85`(MEDIUM band), `matchedSignals`에 `tier="B"` 항목이 있다.

- **SPEC-003-AC-04** (R-ORC-002)
  - Given agent 신호는 발화하나 어떤 adapter의 고유 signature와도 일치하지 않는 ambiguous candidate pane에서
  - When `detect`를 실행하면
  - Then `agentType = "unknown"`, `agentTypeConfidence < 0.50`(LOW band), 그리고 `OrcCandidate`는 생성된다(null 아님).

- **SPEC-003-AC-05** (R-ORC-002)
  - Given `currentCommand`가 shell(`zsh`/`bash` 등)이고 title/cmdline signature·output banner가 모두 없는 pane에서
  - When `detectOrc`를 실행하면
  - Then 결과는 `null`이며 그 pane은 orc로 출력되지 않는다(non-candidate).

- **SPEC-003-AC-06** (R-ORC-001, R-ORC-002)
  - Given output banner만 매칭되고 command·wrapper 신호가 없는 pane에서
  - When `detect`를 실행하면
  - Then `agentType`은 concrete type이되 `agentTypeConfidence ≤ 0.60`(output-only cap)이며 HIGH band(≥0.85)에 도달하지 않는다.

- **SPEC-003-AC-07** (R-ORC-007)
  - Given 기존 adapter·combiner 코드를 수정하지 않고 새 `AgentDetector`(새 `id`)를 `detectors` 목록에 추가했을 때
  - When 그 adapter가 주장하는 pane에 `detectOrc`를 실행하면
  - Then `agentType`은 그 adapter의 `id`로 해석되어, 인터페이스가 확장에 열려 있음을 보인다.

- **SPEC-003-AC-08** (R-ORC-007, R-ORC-002)
  - Given 두 adapter가 같은 pane을 **동률 tier**의 서로 다른 concrete type으로 주장할 때
  - When `detectOrc`를 실행하면
  - Then `agentType = "unknown"`이고(거짓 단정 금지) 충돌이 `matchedSignals`에 기록되며 `agentTypeConfidence < 0.50`(LOW band)이다.

- **SPEC-003-AC-09** (R-ORC-001)
  - Given direct command(Tier A)와 output banner(Tier C)가 **동일 type**을 가리키는 pane에서
  - When `detect`를 실행하면
  - Then `agentTypeConfidence`는 단일 Tier A 결과의 base 이상이고(단조성), `matchedSignals`에 두 신호가 모두 기록된다.

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-ORC-001 | Claude Code/Codex 우선 탐지: direct command(Tier A) → wrapper+signature(Tier B) → output 보강(Tier C)의 단계적 판정과 confidence 모델 | SPEC-003-AC-01, AC-02, AC-03, AC-06, AC-09 |
| R-ORC-002 | 확정 불가 AI-agent 후보를 `unknown`+낮은 confidence로 두고, "agent 아님(non-candidate)"과 분리. 충돌 시 단정 금지 | SPEC-003-AC-04, AC-05, AC-06, AC-08 |
| R-ORC-007 | `detect(pane): OrcCandidate` adapter 경계와 등록형 combiner로 비-Claude/Codex agent 확장 허용 | SPEC-003-AC-07, AC-08 |

> 본 spec은 1차 슬라이스 `R-ORC` 중 type 축(001/002/007)만 다룬다. R-ORC-003/004/005/006(status·summary·lifecycle)은 [[SPEC-004-status-inference]] 책임이다. 전체 매트릭스는 [[SPEC-007-test-validation]]이 통합한다.

## 6. Open Questions / Conflicts

### Open Questions (PoC 검증 대상)

- **confidence calibration (핵심)**: §3.2의 base/cap/bonus 수치(0.95 / 0.70 / 0.45 / 0.60 / 0.30 / +0.03)와 band 경계(LOW/MEDIUM 0.50, MEDIUM/HIGH 0.85)가 band별 실제 precision과 단조 증가하는가? [[SPEC-007-test-validation]] 수동 라벨로 보정한다. 경계값은 가설이나 보정 후에도 `[0,1]`을 contiguous·무공백으로 덮어 M3 bucketing 누락을 막는 구조는 불변이다([[14-MVP-PoC-Scope]] confidence calibration 지표).
- **Tier A/B 분포**: claude-code/codex의 실제 설치·실행 방식에서 `pane_current_command`가 직접 binary명으로 보이는 비율 vs `node` shim으로 보이는 비율. Tier A 우세면 정확도가 높고, B 우세면 `cmdline` 수집 안정성이 정확도를 좌우한다.
- **`cmdline` 가용성**: 수집 소유·degradability는 [[08-Decisions|D-020]]로 확정됐다(수집은 SPEC-002, 선택적·degradable, 미가용 시 `null`→Tier B는 `paneTitle` fallback). 잔여 미해소는 `pane_pid`→`ps` 경유 argv 수집의 macOS/Linux **cross-platform 안정성**과, `cmdline` 미가용 비율이 `paneTitle`(신뢰도 중) 단독 의존으로 유발하는 **미탐 증가폭**이다([[05-Backend]] Open Questions). **검토 필요.**
- **generic agent marker 정의**: §3.3 ambiguous candidate를 만드는 marker 집합. 너무 넓으면 일반 `node` 프로세스를 orc로 오탐, 너무 좁으면 미래 agent를 non-candidate로 놓침. 보수적 시작값과 오탐/미탐 측정 필요. **검토 필요.**
- **signature/banner 문자열**: 각 adapter의 G-WRAP/G-TITLE/G-OUT 구체 pattern은 실제 Claude Code/Codex 출력으로 확정해야 한다(이 spec은 문자열을 고정하지 않음). redaction이 banner의 식별 토큰까지 가려 G-OUT 미탐을 유발하는지도 함께 본다([[SPEC-006-privacy-redaction]] 정합).

### Conflicts / Upstream

- **adapter 내장 vs 분리 결정 미해소**: [[05-Backend]] Open Questions의 "Claude Code/Codex 상태 pattern을 제품 코드에 내장할지 adapter package로 분리할지"가 미결정이다. 본 spec은 **인터페이스 형태(R-ORC-007)는 고정**하되 패키징(인라인/외부 plugin)은 열어 둔다. plugin 외부화는 R-P1-011 / [[10-System-Architecture]] Open Question. 결정 시 [[08-Decisions]] `D-0xx`로 남긴다.
- **상위 정합**: [[14-MVP-PoC-Scope]] "Agent type" 표(direct→wrapper→output)와 본 spec §3.1–3.2는 일치한다. 충돌 없음.
