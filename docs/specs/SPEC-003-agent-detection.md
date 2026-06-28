---
spec: SPEC-003
title: Agent type 핑거프린팅
status: approved
updated: 2026-06-28
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
  processTree: ProcessNode[] | null;
                             // pane_pid subtree(자신+후손)의 노드별 argv, redacted. SPEC-002 §2.9가 수집.
                             //   null = subtree introspection 미가용/실패(fail-closed). ps 특성상 노드는 모두 '살아있는' 프로세스.
                             //   G-PROC(Tier A) 입력. cmdline은 이 subtree의 foreground 노드에 해당하는 부분집합.
  cwd: string;               // #{pane_current_path} (type 신호 아님, 통과만)
  recentOutput: string[];    // capture-pane redacted tail, 오래된→최신 순. 비어 있을 수 있음
}

interface ProcessNode {
  pid: number;
  ppid: number;
  depth: number;             // pane_pid=0, 직속 자식=1, … (foreground-proximity 정렬용)
  command: string;           // 노드 argv, redacted (SPEC-006 §2.7 chokepoint 통과)
}
```

- detect는 raw `command`에서 `currentCommand = basename(command)`를 **정확히 한 번** 파생한다. 이 파이프라인에서 basename은 SPEC-003만 적용한다 — [[SPEC-002-tmux-discovery]]는 `#{pane_current_command}` 원문(`command`)을 basename 없이 전달하므로 upstream에서 basename되거나 두 번 적용되지 않는다. 이하 규칙(§3.1 G-CMD 등)은 모두 파생된 `currentCommand`를 참조한다.
- 파생된 `currentCommand`와 `paneTitle`/`cmdline`/`processTree`/`recentOutput`만이 type 신호다. `cwd`·`paneId`·`tmuxTarget`은 type 판정에 사용하지 않는다(provenance·하위 spec 전달용).
- **`processTree`는 가장 강한 신호다(G-PROC, Tier A)**: `ps`는 살아있는 프로세스만 나열하므로 subtree argv에 agent signature가 있으면 그 agent 프로세스가 **실제로 살아있다**는 뜻이다. wrapper 체인(`zsh → claude → npm → node`)으로 실행돼 `currentCommand`/`cmdline`(foreground)에는 agent가 안 보여도 subtree에는 보인다 → recall 근본 수정(§3.1 G-PROC, [[SPEC-002-tmux-discovery]] §2.9).
- 입력은 이미 redacted이므로 detect는 raw secret을 다루지 않는다. detect는 `recentOutput`/`paneTitle` 원문을 **저장·로그하지 않으며**, signal provenance에는 매칭된 **rule id만** 남긴다(2.3, [[SPEC-006-privacy-redaction]]).

### 2.2 출력 — `OrcCandidate`

```ts
type AgentType = 'claude-code' | 'codex' | 'unknown';

interface SignalMatch {
  signal: 'command' | 'process' | 'title' | 'cmdline' | 'output';
  tier: 'A' | 'B' | 'C';        // A=direct command OR live subtree process, B=wrapper+signature, C=output 보강
  matchedType: AgentType;       // 이 신호가 가리킨 type ('unknown'=generic agent 신호)
  ruleId: string;               // 매칭된 adapter rule id (원문 아님). 예 "claude-code/cmd.basename", "claude-code/proc.subtree"
}

interface OrcCandidate {
  agentType: AgentType;         // 확정 불가 후보는 'unknown' (R-ORC-002)
  agentTypeConfidence: number;  // [0,1]. status가 아니라 type 확신도
  matchedSignals: SignalMatch[];// 어떤 신호가 기여했는지(calibration·debug·provenance). 비어 있지 않다
  processCorroborated: boolean; // true ⟺ matchedSignals에 signal∈{command, process}가 1개 이상
                                //   = '살아있는 agent 프로세스' 증거 보유(G-CMD foreground OR G-PROC subtree).
                                //   detector가 소유·산출한다. [[SPEC-004-status-inference]] liveness-gate(agentProcessAlive) 파생 입력.
}
```

- `processCorroborated`는 detector(combiner)가 `matchedSignals`에서 **결정적으로** 산출한다(재-탐지 불필요). [[SPEC-004-status-inference]]는 이 값과 `processTree` 가용성만으로 `agentProcessAlive`를 파생한다(§2.1 cross-ref) — status 추론기가 detection을 다시 하지 않게 하는 경계(P1-1 ownership 해소). wire `Orc`로는 직렬화하지 않는다(내부 합성 신호; provenance는 `agentSignals.ruleId`).

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
- `processTree`(subtree argv)도 [[SPEC-002-tmux-discovery]] §2.9가 수집하는 **선택적·degradable 신호**다(단일 ps snapshot→메모리 walk; 실패 시 전체 `null`). SPEC-003은 소비만 한다. `processTree`가 `null`이면 **G-PROC(Tier A)는 발화하지 못하고** 검출은 종전 G-CMD/G-WRAP/G-TITLE/G-OUT로 **저하 동작(degrade)**한다(no regression). cross-platform argv 잘림으로 signature가 잘리면 G-PROC 미탐이 날 수 있다([[SPEC-002-tmux-discovery]] §6 Q7, [[SPEC-007-test-validation]] 측정).
- `paneTitle`은 사용자가 임의로 덮어쓸 수 있어 신뢰도가 중간이다. 단독으로 Tier A를 만들지 않는다. **stale title 주의**: claude가 종료돼도 tmux pane title은 남을 수 있어 `paneTitle`만의 매칭은 **이미 죽은 agent의 잔여(residual) 신호**일 수 있다 → §3.2 residual cap·[[SPEC-004-status-inference]] liveness-gate로 다룬다.

## 3. Behavior rules

### 3.1 신호 분해표

| ID | 신호 | 수집 방법(소비 출처) | tier | 강도 | 단독 판정 |
| --- | --- | --- | --- | --- | --- |
| G-CMD | 파생된 `currentCommand`(= `basename(command)`, §2.1에서 1회 산출)가 알려진 agent binary명(`claude`/`claude-code`/`codex`)과 일치 | SPEC-002 `command`(`#{pane_current_command}` 원문) → SPEC-003가 basename | A | 강(direct, 살아있는 foreground) | type 확정 + 높은 confidence |
| **G-PROC** | **`processTree`(pane subtree)의 한 노드가 agent **exec/module token**으로 실행 중** (§3.1.1 정밀 규칙; **임의 경로 substring 아님**) — wrapper 체인 어느 깊이든 agent 프로세스가 **살아있음**을 의미 | SPEC-002 §2.9 subtree(`pane_pid` 후손) argv (redacted) | **A** | **강(process-corroborated, 살아있는 agent)** | **type 확정 + 높은 confidence (recall 근본 수정)** |
| G-WRAP | `currentCommand`가 generic runtime(`node`/`node.js`/`python`/`python3`/`deno`/`bun`)이고 `cmdline` 또는 `paneTitle`에 adapter signature | `#{pane_current_command}` + `cmdline`/`#{pane_title}` (redacted) | B | 중 | type 추정 + confidence 하향 |
| G-TITLE | `paneTitle`에 adapter signature(generic runtime 여부 무관) | `#{pane_title}` (redacted) | B | 중(가변) | 보강용. 단독 시 wrapper와 동급 처리. **process-uncorroborated → residual cap(§3.2)** |
| G-OUT | `recentOutput` tail에 adapter 고유 banner/prompt pattern | `capture-pane -p` redacted tail | C | 보강 | type 보강만, 단독은 cap 적용. **process-uncorroborated → residual cap(§3.2)** |
| (참고) cwd | `cwd` | `#{pane_current_path}` | — | type 신호 아님 | 미사용 |

- **G-PROC vs G-CMD**: 둘 다 Tier A이고 "살아있는 agent 프로세스" 증거다. G-CMD는 agent가 **foreground**일 때(`pane_current_command`=agent), G-PROC는 agent가 **subtree의 임의 깊이**(wrapper로 가려짐)일 때 발화한다. 실측([[SPEC-007-test-validation]] §6, 101 pane 중 직접 command 0개)상 실제 설치는 거의 전부 wrapper이므로 **G-PROC가 1차 recall 신호**다. `SignalMatch.signal`에 `'process'`를 추가한다(§2.2).
- **process-corroboration의 정의**: 한 candidate의 `matchedSignals`에 `signal:'command'`(G-CMD) 또는 `signal:'process'`(G-PROC)가 1개 이상 있으면 **process-corroborated**(살아있는 agent 프로세스 증거 보유)다. 그렇지 않고 `title`/`cmdline`/`output`만이면 **process-uncorroborated**(잔여 신호일 수 있음)다. 이 구분이 §3.2 residual cap과 [[SPEC-004-status-inference]] liveness-gate의 공통 입력이다.

#### 3.1.1 G-PROC 매칭 정밀 규칙 (exec/module token — precision 확정 구조)

G-PROC은 Tier A HIGH(≥0.85) 신호이므로 **느슨한 substring 매칭을 금지**한다(그게 0.19 precision / G-OUT bare-word FP를 만든 원인 부류다). subtree의 한 노드 `n`(argv 토큰 배열)이 adapter `T`의 G-PROC를 발화시키는 조건은 아래 중 **하나**다(모두 **토큰/경로-세그먼트 단위**, 임의 substring 아님):

1. **exec basename**: `basename(n.argv[0])`(소문자, 확장자 제거)가 `T`의 command 집합(G-CMD와 동일: `claude`/`claude-code`/`codex`)에 속함. → agent를 직접(또는 rename·절대경로로) 실행 중인 노드.
2. **module/package exec token**: `basename(n.argv[0])`가 generic runtime(`node`/`python`/`bun`/`deno`/… §3.1 G-WRAP 집합)이고, `n.argv`의 **어떤 토큰 `t`**가 `T`의 package/entry 식별자와 다음 중 하나로 일치:
   - `t`가 `T`의 package-id와 정확히 같음 (예: `@anthropic-ai/claude-code`, `@openai/codex`, `codex-cli`), **또는**
   - `t`를 경로로 봤을 때 **경로 세그먼트**에 `T`의 package-id가 포함됨 (예: `…/node_modules/@anthropic-ai/claude-code/cli.js`의 `@anthropic-ai/claude-code/` 세그먼트), **또는**
   - `basename(t)`(확장자 제거)가 `T`의 command 집합에 속함 (예: 설치 entry `…/bin/claude`).

**금지(negative, 확정)**: 위 1/2 어디에도 해당하지 않는 **임의 경로/인자 substring**은 G-PROC를 발화시키지 않는다. 특히 generic runtime이 **agent와 무관한 사용자 스크립트**를 실행하는데 경로에 우연히 agent 이름 substring이 든 경우(예: `node ~/claude-notes/build.js`, `python codex_experiment.py`)는 **non-match**다 — `argv[0]`가 agent exec가 아니고(rule 1 ✗), 어떤 argv 토큰도 package-id/entry가 아니라 그냥 경로 substring이기 때문(rule 2 ✗). adapter의 G-WRAP/G-TITLE/G-OUT signature(§3.1)는 이와 별개이며 종전대로 동작한다(단, 그건 Tier B/C이고 process-uncorroborated → residual cap 대상).

- **PoC-deferred(가설)**: `ps` argv **잘림**으로 package-id 토큰이 잘려 rule 2가 미발화할 수 있다 — 잘림 영향만 PoC 측정 대상이다([[SPEC-002-tmux-discovery]] §6 Q7, [[SPEC-007-test-validation]]). 매칭 규칙 자체(토큰/세그먼트 단위, substring 금지)는 확정 구조다.
- **adapter 소유·결정성**: `T`의 command 집합·package-id 집합은 각 adapter가 소유한다(§3.1 signature와 동일 소스). 동일 입력은 동일 G-PROC 결과를 낸다.

- adapter별 signature/banner pattern 집합(예: claude-code는 `claude`/`@anthropic-ai/claude-code`/Claude Code TUI prompt marker, codex는 `codex`/codex CLI prompt marker)은 **각 adapter가 소유**하며 구체 문자열은 가설로, PoC에서 확정한다(§6). 이 spec은 pattern의 정확한 문자열을 고정하지 않는다.

### 3.2 단계적 confidence 모델

각 신호 tier에 base confidence를 부여하고, 동일 type을 가리키는 신호가 복수면 보강한다. **모든 수치는 가설.**

**confidence band 정의(가설, 그러나 구조는 고정)**: band는 `[0,1]` 전체를 **연속(contiguous)·무중첩·무공백**으로 덮는다 — `LOW [0, 0.50)`, `MEDIUM [0.50, 0.85)`, `HIGH [0.85, 1.0]`. 경계값(0.50·0.85)은 PoC로 보정할 가설이지만, 보정 후에도 항상 contiguous 구조를 유지해 [[SPEC-007-test-validation]] M3 calibration bucketing이 in-gap 표본을 조용히 누락하지 못하게 한다. 아래 base/cap/bonus 수치는 가설이다.

| tier | 신호 예 | base confidence (가설) | band |
| --- | --- | --- | --- |
| A | G-CMD (direct command) **/ G-PROC (live subtree process)** | 0.95 | HIGH `[0.85, 1.0]` |
| B | G-WRAP / G-TITLE (wrapper+signature) | 0.70 | MEDIUM `[0.50, 0.85)` |
| C | G-OUT (output 단독) | 0.45 | LOW `[0, 0.50)`, **cap 0.60** |
| residual (process-uncorroborated, subtree 가용) | title/output만 + subtree에 agent 없음 | **cap 0.49** | LOW `[0, 0.50)` |
| 후보 unknown | generic/ambiguous/conflict | 0.30 | LOW `[0, 0.50)` |

결합 규칙(가설):

1. 동일 `matchedType`을 가리키는 신호가 N개면 `confidence = min(0.99, maxBase + 0.03 × (N−1))` (corroboration bonus, 단조 증가 보장 — §3.5).
2. **output-only cap**: 기여 신호가 G-OUT뿐이면 `confidence = min(value, 0.60)`. output 단독은 절대 HIGH band(direct)에 도달하지 못한다(R-ORC-002: 단정 금지).
3. **residual cap(process-corroboration precedence, precision 근본 수정)**: `processTree`가 **가용**(≠ null)인데 candidate가 **process-uncorroborated**(G-CMD/G-PROC 없음, 즉 title/cmdline/output 신호만)이면 `confidence = min(value, 0.49)`로 LOW로 cap한다. 근거: subtree에 살아있는 agent 프로세스가 없는데 title/banner만으로 잡힌 신호는 **이미 종료된 세션의 잔여(stale pane title / scrollback banner)**일 수 있어 살아있는 agent로 단정하면 안 된다(R-ORC-002). 이 candidate는 `null`(non-candidate)로 버리지 않고 **잔여 후보로 유지**해 [[SPEC-004-status-inference]]가 liveness-gate로 `terminated`/비-active로 해소한다(R-ORC-006 짧은 retention). `processTree`가 `null`(미가용)이면 corroboration을 입증할 수 없으므로 residual cap을 적용하지 않고 종전 Tier B/C confidence를 유지한다(degrade, no regression).
4. 서로 다른 concrete type을 가리키는 신호 충돌은 §3.4.

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

**process-corroboration precedence(확정 구조, §3.2-3과 짝)**: combiner는 candidate 합성 후 §3.2-3 residual cap을 적용한다 — `processTree`가 가용한데 합성 결과가 process-uncorroborated이면 confidence를 LOW(≤0.49)로 cap한다. process-corroborated 신호(G-CMD/G-PROC)가 있으면 그 type이 우선하며 corroboration bonus(§3.2-1)를 받는다. 즉 **살아있는 프로세스 증거 > 잔여 title/banner 증거**가 confidence 순서로 보장된다(§3.5 단조성).

**multi-agent in one pane(가설, 검토 필요)**: 한 pane의 subtree가 **서로 다른 두 agent**(예: claude와 codex argv가 동시에 살아있음) 노드를 담으면 두 adapter가 G-PROC(Tier A)로 충돌 주장한다. 결정 규칙:
- subtree `depth`가 **더 작은(=foreground에 더 가까운)** agent 노드를 가진 type을 택한다(사용자가 현재 상호작용 중인 agent가 foreground에 가깝다는 가설).
- depth가 동률이면 위 표 "서로 다른 type, tier 동률" 규칙대로 `unknown`(단정 금지). 구체 tie-break·"한 pane에 정말 2 agent를 별개 orc로 볼지"는 PoC 검토 대상이다(§6).

- 결과는 **결정적(deterministic)**이다: 같은 `PaneSignal`과 같은 `detectors` 순서는 항상 같은 `OrcCandidate`를 만든다(테스트 가능성). `processTree` 노드 순서는 `depth`→`pid` 오름차순으로 안정 정렬돼 결정성을 보장한다([[SPEC-002-tmux-discovery]] §2.9).

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

- **SPEC-003-AC-10** (R-ORC-001) — recall 근본 수정(G-PROC)
  - Given `currentCommand`/`cmdline`(foreground)에는 agent가 보이지 않으나 `processTree` subtree 노드 argv에 claude signature가 있는 wrapper-체인 pane(예: `zsh → claude → npm → node`)에서
  - When `detect`를 실행하면
  - Then `agentType = "claude-code"`, `agentTypeConfidence ≥ 0.85`(HIGH band), `matchedSignals`에 `signal="process"`, `tier="A"` 항목이 있다.

- **SPEC-003-AC-11** (R-ORC-002) — precision 근본 수정(residual cap)
  - Given `processTree`가 **가용**하고 subtree에 어떤 agent 프로세스도 없으며, 신호가 `paneTitle`(또는 output banner) 잔여뿐인 pane(이미 종료된 claude 세션의 stale title)에서
  - When `detect`를 실행하면
  - Then candidate는 생성되되(null 아님) `agentTypeConfidence ≤ 0.49`(LOW, residual cap)이고 `matchedSignals`에 process-corroborated 신호(`command`/`process`)가 없다(살아있는 agent로 단정하지 않음).

- **SPEC-003-AC-12** (R-ORC-001, R-ORC-002) — degrade(no regression)
  - Given `processTree == null`(subtree introspection 미가용)이고 title/cmdline signature가 있는 pane에서
  - When `detect`를 실행하면
  - Then 검출은 종전 Tier(G-WRAP/G-TITLE Tier B 등)로 동작하며 residual cap을 적용하지 않는다(subtree 미가용 시 corroboration 입증 불가 → 종전 confidence 유지).

- **SPEC-003-AC-13** (R-ORC-002, R-ORC-007) — multi-agent in subtree
  - Given 한 pane의 `processTree`에 서로 다른 두 agent(claude·codex) 노드가 모두 살아있을 때
  - When `detectOrc`를 실행하면
  - Then foreground에 더 가까운(`depth` 더 작은) agent type을 택하고, `depth` 동률이면 `agentType = "unknown"`(단정 금지)이며, 결과는 결정적이다.

- **SPEC-003-AC-14** (R-ORC-001, R-ORC-005 / calibration 단조성) — process-corroboration 우선
  - Given 동일 type을 (a) G-PROC(live subtree process)로 잡은 pane과 (b) `paneTitle` 잔여만으로 잡은(subtree 가용·agent 없음) pane에서
  - When 각각 `detect`를 실행하면
  - Then (a)의 `agentTypeConfidence`(HIGH)가 (b)의 `agentTypeConfidence`(residual LOW)보다 크다(살아있는 프로세스 증거 > 잔여 증거, 단조성).

- **SPEC-003-AC-15** (R-ORC-002 / G-PROC precision — exec-token, §3.1.1) — negative
  - Given `processTree`의 한 노드가 generic runtime이 **agent와 무관한 사용자 스크립트**를 실행하며 경로에만 agent 이름 substring이 있는 경우(예: `node ~/claude-notes/build.js`)이고, 그 외 agent 신호가 없을 때
  - When `detectOrc`를 실행하면
  - Then **G-PROC가 발화하지 않고**(argv[0]≠agent exec, package-id/entry 토큰 없음) `signal="process"` 항목이 생기지 않으며, 다른 신호도 없으면 결과는 `null`(non-candidate)이다(임의 경로 substring으로 살아있는 agent를 단정하지 않는다).

- **SPEC-003-AC-16** (R-ORC-001 / G-PROC module-token) — positive
  - Given `processTree`에 generic runtime 노드가 `T`의 package-id/entry 토큰을 인자로 실행 중인 경우(예: `node …/node_modules/@anthropic-ai/claude-code/cli.js`)일 때
  - When `detect`를 실행하면
  - Then `agentType = "claude-code"`, `matchedSignals`에 `signal="process"`,`tier="A"`가 있고 `processCorroborated == true`이다.

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-ORC-001 | Claude Code/Codex 우선 탐지: live subtree process(Tier A, G-PROC, exec/module token §3.1.1) / direct command(Tier A) → wrapper+signature(Tier B) → output 보강(Tier C)의 단계적 판정과 confidence 모델. **wrapper-체인 recall 근본 수정**(G-PROC) | SPEC-003-AC-01, AC-02, AC-03, AC-06, AC-09, AC-10, AC-12, AC-14, AC-16 |
| R-ORC-002 | 확정 불가 AI-agent 후보를 `unknown`+낮은 confidence로 두고, "agent 아님(non-candidate)"과 분리. 충돌 시 단정 금지. **process-uncorroborated 잔여(stale title/banner) → residual cap LOW**(precision), **G-PROC exec-token(임의 substring 금지, §3.1.1)** | SPEC-003-AC-04, AC-05, AC-06, AC-08, AC-11, AC-13, AC-15 |
| R-ORC-007 | `detect(pane): OrcCandidate` adapter 경계와 등록형 combiner로 비-Claude/Codex agent 확장 허용 | SPEC-003-AC-07, AC-08, AC-13 |

> 본 spec은 1차 슬라이스 `R-ORC` 중 type 축(001/002/007)만 다룬다. R-ORC-003/004/005/006(status·summary·lifecycle)은 [[SPEC-004-status-inference]] 책임이다. 전체 매트릭스는 [[SPEC-007-test-validation]]이 통합한다.

## 6. Open Questions / Conflicts

### Resolved / Calibration

- **process-tree recall+precision 근본 수정 (2026-06-28, non-circular live-process-tree oracle)** — [[SPEC-007-test-validation]] §3.3 M1의 **live process-tree oracle**(독립적 ps subtree ground truth) 측정에서 production detector가 oracle 대비 **precision ≈ 0.19 / recall ≈ 0.27**(가설 ≥0.9)임이 확인됐다. 두 패턴: (1) **recall 누락** — `zsh → claude → npm → node`처럼 subtree로 살아있는 claude가 foreground(`pane_current_command`/`cmdline`)에 안 보여 det=none. (2) **precision/active FP** — 살아있는 agent가 subtree에 **없는** `-zsh` pane이 stale pane title의 `claude` 토큰으로 claude-code conf 0.7로 잡힘. 수정: (a) **G-PROC(Tier A)** 추가 — subtree argv 어디든 signature 매칭 = 살아있는 agent = HIGH 검출(recall, §3.1). (b) **residual cap(§3.2-3)** — subtree 가용·agent 없음·process-uncorroborated이면 confidence를 LOW(≤0.49)로 cap(precision). 잔여 후보는 버리지 않고 [[SPEC-004-status-inference]] liveness-gate가 `terminated`/비-active로 해소(R-ORC-006). 수집 계약은 [[SPEC-002-tmux-discovery]] §2.9. (회귀 테스트: SPEC-003-AC-10 wrapper-claude 검출, SPEC-003-AC-11 stale-title residual LOW.)

- **G-OUT bare-word banner FP (2026-06-27, calibration)** — sanctioned §3.1/§6 hypothesis 보정. [[SPEC-007-test-validation]] M1 live 측정(실제 101-pane 환경, read-only·redacted)에서 Tier-C OUTPUT banner가 비-agent pane(`nvim`/`zsh`)을 over-detect함을 확인했다. 원인: OUTPUT pattern이 **단일 bare 토큰**(`\bcodex\b`, 그리고 claude 쪽의 단어 `anthropic`)에 발화 — 이 repo는 orc/codex를 다루므로 해당 단어를 편집·표시하는 일반 pane이 매칭됐다(모두 LOW, output-only cap ≤0.60이나 precision 저하). 보정: **OUTPUT(G-OUT) banner만** distinctive product marker로 tighten한다(codex: `openai codex`/`@openai/codex`/`codex-cli`/approval prompt; claude-code: `welcome to claude`/two-word `claude code`/`@anthropic-ai/claude-code`/permission prompt). **command(G-CMD)·title/cmdline signature(G-WRAP/G-TITLE)는 변경하지 않는다** — title 매칭은 측정상 정확했다(wrapper로 실행돼 `command=zsh`/title=`✳ Claude Code`인 실제 세션). 또한 실측에서 `pane_current_command`가 신뢰 불가임을 확인했다(101 pane 중 0개가 literal `claude`/`codex`를 직접 실행 — 전부 wrapper). 따라서 노이즈 OUTPUT 경로만 **tighten**하고 다른 경로를 loosen하지 않는다. (회귀 테스트: bare `codex`/`claude` + 비-agent command + 무-기타-신호 → `detectOrc(...) === null`.)

### Open Questions (PoC 검증 대상)

- **confidence calibration (핵심)**: §3.2의 base/cap/bonus 수치(0.95 / 0.70 / 0.45 / 0.60 / 0.30 / +0.03)와 band 경계(LOW/MEDIUM 0.50, MEDIUM/HIGH 0.85)가 band별 실제 precision과 단조 증가하는가? [[SPEC-007-test-validation]] 수동 라벨로 보정한다. 경계값은 가설이나 보정 후에도 `[0,1]`을 contiguous·무공백으로 덮어 M3 bucketing 누락을 막는 구조는 불변이다([[14-MVP-PoC-Scope]] confidence calibration 지표).
- **Tier A/B 분포**: claude-code/codex의 실제 설치·실행 방식에서 `pane_current_command`가 직접 binary명으로 보이는 비율 vs `node` shim으로 보이는 비율. Tier A 우세면 정확도가 높고, B 우세면 `cmdline` 수집 안정성이 정확도를 좌우한다.
- **`cmdline` 가용성**: 수집 소유·degradability는 [[08-Decisions|D-020]]로 확정됐다(수집은 SPEC-002, 선택적·degradable, 미가용 시 `null`→Tier B는 `paneTitle` fallback). 잔여 미해소는 `pane_pid`→`ps` 경유 argv 수집의 macOS/Linux **cross-platform 안정성**과, `cmdline` 미가용 비율이 `paneTitle`(신뢰도 중) 단독 의존으로 유발하는 **미탐 증가폭**이다([[05-Backend]] Open Questions). **검토 필요.**
- **generic agent marker 정의**: §3.3 ambiguous candidate를 만드는 marker 집합. 너무 넓으면 일반 `node` 프로세스를 orc로 오탐, 너무 좁으면 미래 agent를 non-candidate로 놓침. 보수적 시작값과 오탐/미탐 측정 필요. **검토 필요.**
- **signature/banner 문자열**: 각 adapter의 G-WRAP/G-TITLE/G-OUT 구체 pattern은 실제 Claude Code/Codex 출력으로 확정해야 한다(이 spec은 문자열을 고정하지 않음). redaction이 banner의 식별 토큰까지 가려 G-OUT 미탐을 유발하는지도 함께 본다([[SPEC-006-privacy-redaction]] 정합).
- **G-PROC subtree signature·cross-platform(§3.1, 검토 필요)**: G-PROC는 subtree 노드 argv에 adapter signature(`claude`/`@anthropic-ai/claude-code` 등)를 매칭한다. (a) `ps` argv 잘림으로 긴 signature가 잘려 미탐될 수 있고([[SPEC-002-tmux-discovery]] §6 Q7), (b) wrapper 노드(`npm`/`node`)의 script 경로에 우연히 `claude`가 들어가 오탐할 수 있다(예: cwd `~/claude-notes/`의 무관 node). signature를 argv의 **실행 토큰**(binary/package id)에 한정할지, 경로 우연 매칭을 어떻게 거를지 PoC 측정 필요. **검토 필요.**
- **multi-agent / depth precedence(§3.4, 검토 필요)**: 한 pane subtree에 2개 agent가 동시에 살아있을 때 foreground-proximity(`depth`) tie-break과 "1 pane = 1 orc vs 2 orc" 정책. **검토 필요.**
- **residual cap 경계(§3.2-3, 검토 필요)**: subtree 가용·agent 없음일 때 잔여 후보를 (a) residual LOW로 유지(현 spec) vs (b) non-candidate로 폐기 중 어느 쪽이 R-ORC-006 retention과 M1 precision을 동시에 만족하는지. [[SPEC-004-status-inference]] liveness-gate(`terminated` retention)와 함께 측정·보정. **검토 필요.**

### Conflicts / Upstream

- **SPEC-005 `AgentSignal.signal` enum에 `process` 추가 필요(NEW, 검토 필요)**: §2.2 `SignalMatch.signal`에 `'process'`(G-PROC)를 추가했다. [[SPEC-005-data-contract]]의 wire `AgentSignal.signal` enum(현재 `command|title|cmdline|output`)이 이를 미러링해 `process`를 포함하도록 정합 필요(직렬화 계약은 SPEC-005 소유, 본 spec write scope 밖). 또한 `PaneSignal.processTree`는 detection **입력**이며 wire `Orc`로 직렬화하지 않는다(provenance는 `agentSignals`의 `ruleId`만). **검토 필요.**
- **`processTree` 수집 mechanism = D-020 확장(NEW, 검토 필요)**: §2.1 `processTree`는 [[SPEC-002-tmux-discovery]] §2.9가 단일 ps snapshot→subtree walk로 수집한다. 이는 D-020(단일 pid `ps -p`)의 mechanism 확장이며 [[08-Decisions]] D-020 갱신 또는 신규 `D-0xx` 표기가 권고된다(orchestrator/user). **검토 필요.**
- **adapter 내장 vs 분리 결정 미해소**: [[05-Backend]] Open Questions의 "Claude Code/Codex 상태 pattern을 제품 코드에 내장할지 adapter package로 분리할지"가 미결정이다. 본 spec은 **인터페이스 형태(R-ORC-007)는 고정**하되 패키징(인라인/외부 plugin)은 열어 둔다. plugin 외부화는 R-P1-011 / [[10-System-Architecture]] Open Question. 결정 시 [[08-Decisions]] `D-0xx`로 남긴다.
- **상위 정합**: [[14-MVP-PoC-Scope]] "Agent type" 표(direct→wrapper→output)와 본 spec §3.1–3.2는 일치한다. 충돌 없음.
