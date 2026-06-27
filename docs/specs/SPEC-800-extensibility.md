---
spec: SPEC-800
title: Detector 확장성·forward scope
status: approved
updated: 2026-06-27
requirements: [R-ORC-007, R-P1-011]
decisions: [D-012, D-016, D-019, D-020]
tags:
  - specs
  - extensibility
  - detection
  - forward-scope
---

# SPEC-800 — Detector 확장성·forward scope

이 spec은 Orc Camp의 **agent detector 확장 계약(extension point)**을 고정한다. [[SPEC-003-agent-detection]]가 정의한 `AgentDetector { id; detect(pane): OrcCandidate | null }` 경계를 **안정적(stable)·버전 관리되는 확장점**으로 승격하고, 그 위에 (a) open/closed 등록 규칙, (b) config-driven 선언적 detector rule(R-P1-011), (c) 선택적 plugin/package 경계와 그 권고안을 더한다. 또한 P2 long-term 항목(remote/team/agent-start/automation/enterprise)을 **명시적으로 비-MVP forward pre-flag**로만 framing한다(설계하지 않는다).

> 본 spec은 **확장 계약과 forward framing**만 다룬다. 탐지 규칙·confidence 수치·status 추론 자체는 [[SPEC-003-agent-detection]]/[[SPEC-004-status-inference]]가 SSOT다. 본 문서는 그 모델을 재정의하지 않고 **참조·재사용**한다.

> **불변식 상속(확정)**: 모든 확장(builtin/config/plugin)은 [[02-Requirements]] R-PRIV-*·R-TMUX-001의 불변식을 **약화할 수 없다**. detector 입력은 [[SPEC-002-tmux-discovery]]가 read-only로 수집하고 [[SPEC-006-privacy-redaction]]가 **redaction을 적용한 후**의 `PaneSignal`이며([[08-Decisions|D-016]]), 어떤 detector도 tmux command·filesystem·network를 호출하지 않는다([[08-Decisions|D-019]]). 확장은 **신호(signal)를 추가**할 수 있을 뿐, 수집·redaction·combiner·calibration 모델을 바꾸지 못한다.

## 1. Scope

### In scope

- `AgentDetector` 확장점의 **안정 계약화**: 등록(registration) 모델, 등록 순서·결정성, 인터페이스 버전·호환성(R-ORC-007).
- **open/closed**: 새 agent type을 기존 detector·combiner 코드 수정 없이 추가하는 규칙(R-ORC-007).
- **config-driven detector rule**(R-P1-011): 코드 없이 config의 선언적 rule로 command/title/output 신호를 추가하는 schema·제약·검증·실패 처리.
- **plugin/package 경계**: [[05-Backend]]·[[10-System-Architecture]]의 "내장(inline) vs adapter package/plugin" Open Question에 대한 **권고안**과, 두 선택지를 모두 열어 두는 인터페이스 계약(R-P1-011).
- 확장이 상속해야 하는 **불변식 보존 계약**(read-only / privacy / calibration ownership / 결정성).
- P2 항목(R-P2-001/003/004/006/007)의 **forward pre-flag**(framing only, §4).
- 다룬 요구사항: R-ORC-007, R-P1-011. (R-P2-*는 forward pre-flag로만 framing — P0 커버리지 대상 아님.)

### Out of scope (다른 spec / 미래 epic으로)

| 항목 | 이유 | 어디로 |
| --- | --- | --- |
| 탐지 신호 분해·tier·confidence base/cap/bonus·combiner 충돌 규칙 | 본 spec은 이를 **재사용**만 함 | [[SPEC-003-agent-detection]] §3 |
| status·summary 추론과 그 신호/임계값 | type 축 확장만 다룸 | [[SPEC-004-status-inference]] |
| pane raw 수집·`cmdline`/process-alive introspection 소유 | detector는 **이미 수집·redact된** 신호만 소비 | [[SPEC-002-tmux-discovery]], [[08-Decisions|D-020]] |
| redaction pattern·원문 비저장·read-only wrapper 강제 | 확장은 이 chokepoint 뒤에서 동작 | [[SPEC-006-privacy-redaction]], [[08-Decisions|D-016]]/[[08-Decisions|D-019]] |
| `--json`/table 출력 shape, `agentType` enum 직렬화 | 데이터 계약 | [[SPEC-005-data-contract]] |
| P2 항목의 실제 설계(remote/team/agent-start/automation/enterprise) | 미래 epic, **framing만** | §4 (pre-flag), 후속 SPEC |

> **MVP 적용 범위**: scan 슬라이스([[08-Decisions|D-012]])는 §2의 `AgentDetector` **인터페이스 형태와 등록 모델**만 인라인으로 충족하면 된다(builtin 2종: `claude-code`/`codex`). config-rule loading(§3.2)과 plugin loading(§3.3)은 **P1 능력**이며, 본 spec은 그 계약을 **미리 고정**해 후속 구현이 인터페이스를 깨지 않게 한다.

## 2. Contract — 확장점과 등록 모델

### 2.1 안정 확장점 — `AgentDetector` (SSOT: SPEC-003 §2.3)

확장점은 [[SPEC-003-agent-detection]] §2.3의 인터페이스를 **그대로** 사용한다. 본 spec은 재정의하지 않고 **안정(stable) 계약으로 승격**한다.

```ts
// SSOT: [[SPEC-003-agent-detection]] §2.3. 본 spec은 이 형태를 안정 계약으로 고정한다.
interface AgentDetector {
  readonly id: AgentType;                       // 이 detector가 주장하는 type ('claude-code' | 'codex' | 확장 id)
  detect(pane: PaneSignal): OrcCandidate | null; // 자기 type 신호만 검사. 주장 없음 = null
}
```

- `detect`는 **순수(pure)·결정적(deterministic)**이다: 같은 `PaneSignal`은 항상 같은 결과를 낸다([[SPEC-003-agent-detection]] §3.4).
- `detect`의 입력 `PaneSignal`은 redaction 적용 후 read-only 신호다([[SPEC-003-agent-detection]] §2.1, [[08-Decisions|D-016]]). detector는 tmux/fs/network에 접근할 수 없다.
- `detect`의 출력 `OrcCandidate`는 **type 축만** 채운다. status/summary는 [[SPEC-004-status-inference]] 소관이다(확장 detector도 동일).

### 2.2 등록 메타데이터 — `RegisteredDetector`

확장점을 안정화하려면 detector의 **출처(origin)와 선언 버전**을 추적해야 한다. registry는 detector를 다음 메타데이터와 함께 보관한다.

```ts
type DetectorOrigin = 'builtin' | 'config' | 'plugin';

interface RegisteredDetector {
  detector: AgentDetector;
  origin: DetectorOrigin;        // provenance·doctor 진단·trust 판정용
  interfaceVersion: string;      // 이 detector가 구현한다고 선언한 DETECTOR_API_VERSION (semver)
  sourceRef: string;             // 'builtin:claude-code' | 'config:<id>' | 'plugin:<pkg>@<ver>' (원문 아님, 식별용)
}
```

- `origin`은 신뢰 경계(§3.3)와 doctor 진단에 쓰인다. `builtin`은 제품 코드, `config`는 사용자 선언 rule(§3.2), `plugin`은 외부 코드(§3.3).
- `sourceRef`는 식별자이며 **terminal 원문·secret을 포함하지 않는다**([[SPEC-006-privacy-redaction]] 비저장 정책).

### 2.3 등록·결합 계약 — `DetectorRegistry`

```ts
const DETECTOR_API_VERSION = '1.0.0'; // semver. 호환성 판정 기준(§3.4)

interface DetectorRegistry {
  // 등록 순서를 보존하는 ordered list. 등록 순서가 combiner tie-break의 결정성을 보장한다.
  register(d: RegisteredDetector): void; // 중복 id는 거부(§3.1). 비호환 버전은 거부(§3.4)
  list(): readonly RegisteredDetector[]; // 등록 순서대로
}

// 결합은 SPEC-003이 SSOT. 본 spec은 registry → detectOrc 입력 계약만 고정한다.
function detectOrc(pane: PaneSignal, registry: DetectorRegistry): OrcCandidate | null;
```

- `detectOrc`의 **결합(combine)·충돌·confidence 규칙은 [[SPEC-003-agent-detection]] §3.2/§3.4가 SSOT**다. 본 spec은 그것을 재정의하지 않는다. registry는 `detectOrc`에 **등록 순서가 보존된 detector 목록**을 공급할 책임만 진다.
- 등록 순서 = 호출 순서(append). [[SPEC-003-agent-detection]] §3.4의 동률-tier 처리와 결정성은 이 순서 안정성에 의존한다(같은 입력+같은 등록 순서 → 같은 출력).
- registry 구성은 **builtin → config → plugin** 순서로 채운다(builtin이 동률 상황에서 우선). 이 순서는 결정성을 위한 확정 규칙이다.

## 3. Behavior rules

### 3.1 Open/closed — 새 agent type 추가 (R-ORC-007, 확정)

- 새 agent type 지원 = **새 `RegisteredDetector`를 registry에 등록**하는 것으로 끝난다. 기존 detector·combiner·`detectOrc` 코드를 **수정하지 않는다**(open for extension, closed for modification).
- 등록된 detector는 자기 type 신호만 검사하고, 주장 없으면 `null`을 반환한다([[SPEC-003-agent-detection]] §2.3). 따라서 새 detector 추가가 기존 type 판정을 **회귀(regress)시키지 않는다**(다른 type을 침범하지 않음).
- **중복 id 처리(확정)**: registry 내 `id`(AgentType)는 유일해야 한다. 이미 등록된 `id`로 다시 등록하면 **load-time error로 거부**하고 doctor에 진단을 남긴다(조용한 shadow 금지 — builtin pattern을 외부 rule이 몰래 덮어쓰지 못하게). 명시적 override 의미론은 §6 Open Question.
- 결합 결과의 결정성은 등록 순서로 보장된다(§2.3). 새 detector 추가 후에도 `detectOrc`는 **결정적**이어야 한다([[SPEC-003-agent-detection]] §3.4).

### 3.2 Config-driven detector rule (R-P1-011, P1 — 계약 고정)

코드 없이 **config의 선언적 rule**로 command/title/output 신호를 추가한다. config rule은 **compile 단계에서 `AgentDetector`로 변환**되어, builtin과 **동일한 `OrcCandidate`/`SignalMatch` 형태**를 내고 동일한 combiner를 통과한다.

**선언 schema(확정 형태, 값은 사용자 입력):**

```jsonc
{
  "schemaVersion": 1,
  "detectors": [
    {
      "id": "my-agent",                 // AgentType 확장. registry에서 유일해야 함(§3.1)
      "interfaceVersion": "1.x",        // DETECTOR_API_VERSION 호환 선언(§3.4)
      "signals": [
        { "signal": "command", "tier": "A", "matchedType": "my-agent",
          "match": { "equals": ["my-agent", "myagent"] } },   // currentCommand(basename) 정확 일치
        { "signal": "title",   "tier": "B", "matchedType": "my-agent",
          "match": { "regex": "MyAgent v\\d+" } },
        { "signal": "output",  "tier": "C", "matchedType": "my-agent",
          "match": { "contains": ["MyAgent session ready"] } }
      ]
    }
  ]
}
```

**제약(확정 — calibration·privacy·read-only 보존):**

1. **신호 추가만 가능**. config rule은 `signal ∈ {command,title,cmdline,output}`과 `tier ∈ {A,B,C}`(또는 ambiguous→`unknown`)만 지정한다. **confidence 수치는 직접 설정할 수 없다.** tier가 [[SPEC-003-agent-detection]] §3.2의 base/cap/bonus로 매핑되므로, output-only(Tier C) 신호는 **여전히 cap(가설 0.60)** 이하이고 HIGH band에 도달하지 못한다(R-ORC-002 단정 금지). calibration 모델의 소유권은 SPEC-003/SPEC-004에 남는다.
2. **match operator allowlist**: `equals`(정확 일치, command basename 용), `contains`(substring), `regex`(bounded). **코드 실행·임의 함수·외부 호출 금지.** regex는 길이·실행시간 상한으로 ReDoS를 방어한다(상한값은 §6, 보안 검토는 [[SPEC-006-privacy-redaction]]).
3. **입력은 redacted `PaneSignal`만**. config matcher는 원문 output을 보지 못하며 tmux/fs/network를 호출할 수 없다([[08-Decisions|D-016]]/[[08-Decisions|D-019]]). matcher는 데이터-only다.
4. **provenance**: config 신호가 매칭되면 `SignalMatch.ruleId = "config:<id>/<signalIndex>"`로 남기고, 매칭된 **원문은 저장·로그하지 않는다**([[SPEC-006-privacy-redaction]]).
5. **검증·실패 처리(fail-soft per rule, fail-closed per invalid rule)**: load 시 각 rule을 검증한다. 잘못된 rule(unknown tier/operator, 컴파일 불가 regex, 중복 id, 비호환 interfaceVersion)은 **개별적으로 거부**하고 doctor에 진단을 남긴다. **나머지 registry는 정상 load**되며 scan은 crash하지 않는다. config 전체가 깨져도 builtin detector는 동작한다(fail-soft).

> config rule은 R-P1-011의 "config 형태 확장"을 충족한다. **plugin 형태**(코드)는 §3.3.

### 3.3 Plugin/package 경계와 권고안 (R-P1-011 — 계약 고정 + 권고)

[[05-Backend]] Open Question("Claude Code/Codex 상태 pattern을 제품 코드에 내장할지 adapter package로 분리할지")과 [[10-System-Architecture]] Open Question("agent detector adapter API를 plugin 형태로 열 것인가")에 대한 **권고안**:

**권고(검토 필요 → [[08-Decisions]] `D-0xx`로 확정 대상):** **config-rule-first, code-plugin-deferred(hybrid/phased).**

| 단계 | 메커니즘 | 근거 |
| --- | --- | --- |
| MVP(scan) | **inline builtin** detector(claude-code/codex), loader 없음 | [[08-Decisions|D-012]] 슬라이스 최소화. 신뢰 경계 단순 |
| P1 (1순위 확장) | **config 선언 rule**(§3.2, 데이터-only) | read-only/privacy/calibration 불변식을 **구조적으로 보존**(코드 실행 없음). 대부분의 "agent 추가" 요구를 안전하게 충족 |
| P1+ (2순위, 선택·연기) | **code plugin**(별도 npm package가 `AgentDetector` 구현) | config로 표현 못 하는 복잡 신호용. **trust-gated** |

**핵심 권고 요지**: detector 신호 추가의 **기본 경로는 코드가 아니라 데이터(config rule)**로 둔다. code plugin은 **startup token을 쥐고(후속 슬라이스에서) control action까지 발행할 수 있는 local process에 제3자 코드를 적재**하는 신뢰 상승(trust escalation)이므로, **명시적 opt-in + 신뢰 경계 + doctor 가시성**을 갖춘 **연기된 선택 능력**으로 둔다.

**두 선택지를 모두 여는 인터페이스 계약(확정):**

- **`AgentDetector`는 origin과 무관하게 단일 계약**이다(§2.1). inline builtin·config-compiled·code-plugin이 **같은 인터페이스**를 구현하므로, "inline vs package"는 **패키징 결정**일 뿐 **인터페이스 변경이 아니다**. 따라서 결정을 미뤄도 후속 구현이 깨지지 않는다.
- code plugin은 factory를 export한다: `createDetectors(ctx: DetectorHostContext): AgentDetector[]`. host는 plugin의 `interfaceVersion`을 **등록 전에** 검증한다(§3.4).
- **plugin sandbox 계약(확정 의도, enforcement는 forward)**: plugin detector는 (1) **redacted `PaneSignal`만** 입력으로 받고, (2) **`OrcCandidate`만** 반환하며, (3) tmux exec·filesystem·network·startup token에 **접근하지 못한다**. host는 frozen·data-only 입력을 전달한다. (in-process JS는 완전 격리가 어려움 → 강한 enforcement는 §6/§4-enterprise pre-flag, worker/subprocess 격리 여부 미결.)
- **trust gating(확정)**: code plugin은 **명시적 사용자 config 경로 + explicit opt-in**에서만 load한다(외부 bind opt-in과 동일 패턴, [[02-Requirements]] R-SEC-004 정합). load된 plugin 목록·버전·경로는 doctor에 노출한다.

### 3.4 인터페이스 버전·호환성 (R-ORC-007, 확정)

- `DETECTOR_API_VERSION`(semver, §2.3)이 확장점 버전이다. 모든 등록 detector(builtin/config/plugin)는 `interfaceVersion`을 선언한다.
- **호환성 규칙**: host는 **같은 major version**의 detector만 등록한다. major 불일치 detector는 **거부**하고 doctor에 진단을 남기며, **나머지 호환 detector로 scan을 계속**한다(fail-soft).
- **버전 변경 규칙**: `PaneSignal`/`OrcCandidate`에 **optional 필드 추가**는 backward-compatible(minor bump). 필드 제거·타입 변경·의미 변경은 major bump. config schema는 별도 `schemaVersion`(§3.2)을 가진다.
- 이로써 미래에 신호가 늘어도(예: 새 introspection 신호) 기존 config/plugin detector가 조용히 깨지지 않는다.

### 3.5 불변식 보존 계약 (확정 — 확장이 약화 불가)

확장 메커니즘이 무엇이든(builtin/config/plugin) 아래 불변식은 **상속·보존**된다. 이는 본 spec의 핵심 안전 계약이다.

| 불변식 | 소유 spec | 확장에 대한 강제 |
| --- | --- | --- |
| read-only(tmux command allowlist, fail-closed) | [[SPEC-006-privacy-redaction]] §2.6 / [[08-Decisions|D-019]] | detector는 tmux/shell을 호출하지 않음. 입력은 이미 수집된 `PaneSignal`뿐 |
| redaction-before-consume | [[SPEC-006-privacy-redaction]] §3.1 / [[08-Decisions|D-016]] | 모든 detector 입력은 redaction 후 데이터. 원문 비가시·비저장 |
| calibration ownership(band/cap/단조성) | [[SPEC-003-agent-detection]] §3.2 / [[SPEC-004-status-inference]] | config/plugin은 tier만 선택, confidence 수치 직접 설정 불가 |
| 결정성(deterministic combine) | [[SPEC-003-agent-detection]] §3.4 | 등록 순서 보존(§2.3), 순수 `detect` |
| 단정 금지(unknown fallback) | [[SPEC-003-agent-detection]] §3.3, R-ORC-002 | 확장 신호도 충돌 시 `unknown`, output-only cap 적용 |

## 4. Forward scope — P2 pre-flags (framing only, NOT specified)

> 아래는 **미래 epic의 pre-flag**다. 본 spec은 이를 **설계하지 않으며 P0 커버리지 대상이 아니다**([[docs/specs/README|README]] 추적성 원칙: P2는 forward pre-flag 표기). 각 항목은 1문단 forward note + 핵심 제약/리스크 + **스트레스하는 기존 불변식**만 적는다. 실제 설계는 별도 SPEC(미작성)에서 한다. 모두 **검토 필요**.

### 4.1 R-P2-003 — Remote camps (SSH tunnel)

여러 machine의 tmux를 SSH tunnel로 연결해 원격 camp를 본다. **스트레스 불변식: local-first([[08-Decisions|D-003]]) + read-only + privacy.** 원격 pane 신호를 가져오는 순간 "terminal output을 local machine 밖으로 보내지 않는다"는 전제가 흔들리고, read-only allowlist([[08-Decisions|D-019]])·redaction chokepoint([[08-Decisions|D-016]])를 **원격 hop에서도 동등하게** 보장해야 한다. 핵심 리스크: 신뢰 경계가 단일 localhost에서 network로 확장되며 token/transport 보안 모델 전면 재설계 필요. 확장점 관점: 원격은 **transport 계층** 변경이지 `AgentDetector` 변경이 아니다(detector는 여전히 redacted `PaneSignal`만 소비) — 이 분리를 유지하면 detector 확장 계약은 재사용 가능.

### 4.2 R-P2-004 — Team read-only observer

여러 사용자가 한 camp를 read-only로 관망한다. **스트레스 불변식: privacy + token(single-user startup token).** terminal preview·summary가 **타인에게** 노출되므로 redaction이 "충분"에서 "다자 공유 안전" 기준으로 격상되고, 단일 startup token([[02-Requirements]] R-SEC-002) 모델이 per-user 인증/권한으로 바뀌어야 한다. 핵심 리스크: "read-only"가 control 부재를 보장해도 **관측 자체의 정보 노출**이 새 위협면. 비목표 명시([[02-Requirements]] 비목표: team observer는 MVP 제외)와 정합.

### 4.3 R-P2-001 — Dashboard에서 새 agent session 시작

dashboard에서 새 AI agent session을 spawn한다. **스트레스 불변식: read-only(가장 강하게).** 이는 [[08-Decisions|D-019]] read-only allowlist를 **정면으로 위반**한다(session/process 생성은 state-changing). control action 슬라이스([[SPEC-400-control-actions]])의 token·target 재검증·confirm 안전장치를 **process 생성**까지 확장해야 하며, arbitrary command 실행 금지([[02-Requirements]] R-CTRL-008)와의 경계가 매우 민감. 핵심 리스크: 잘못된 spawn이 사용자 workspace에 부작용. 확장점 무관(detector 계약과 직교).

### 4.4 R-P2-006 — Workflow automation / agent handoff

agent 간 작업 자동 전달·workflow 자동화. **스트레스 불변식: read-only + 단정 금지(confidence 모델).** 자동 handoff는 status/summary **추론을 신뢰해 행동(act)**하므로, 추론 정확도 리스크([[07-Roadmap]])가 "표시 오류"에서 "자동 행동 오류"로 격상된다 — confidence calibration([[SPEC-003-agent-detection]] §3.5)이 자동화 게이트의 임계가 되어야 한다. 또한 자동 control은 R-CTRL 안전장치(confirm/allowlist)와 충돌하므로 "사람 확인 없는 action" 정책 재설계 필요. 핵심 리스크: 낮은 confidence 위에 쌓는 자동화는 신뢰 붕괴를 증폭.

### 4.5 R-P2-007 — Enterprise policy / audit export / remote access policy

정책 pack·감사 export·원격 접근 정책. **스트레스 불변식: privacy(비저장) + local-first.** audit export는 [[02-Requirements]] R-PRIV-004/005·데이터 보존 정책("원문 비저장")과 직접 충돌하므로 **무엇을 보존·반출하는가**의 정책 계층이 필요하고, remote access policy는 §4.1/§4.2의 신뢰 경계 확장을 조직 정책으로 강제한다. 확장점 관점: code plugin sandbox enforcement(§3.3)의 강한 격리가 여기서 요구된다(제3자 detector를 정책·감사 하에 운영). 핵심 리스크: 감사/보존과 privacy 기본값의 trade-off를 조직 단위로 노출.

> 위 P2 항목은 **확장점(`AgentDetector`)을 대부분 직교(orthogonal)하게 두고** transport·auth·policy·control 계층에서 해소된다. 본 spec의 detector 확장 계약(§2/§3)은 이들 미래 작업에서 **재사용 가능**하도록 설계됐다(신호 소비기는 그대로, 둘레만 확장).

## 5. Acceptance criteria

> 확장 계약(§2/§3)에 대한 검증 가능한 기준. confidence 수치는 [[SPEC-003-agent-detection]] §3 가설을 따른다. P2 forward pre-flag(§4)는 **AC 대상이 아니다**.

- **SPEC-800-AC-01** (R-ORC-007)
  - Given 기존 detector·combiner·`detectOrc` 코드를 **수정하지 않고** 새 `AgentDetector`(신규 유일 `id`)를 registry에 `register`했을 때
  - When 그 detector가 주장하는 pane에 `detectOrc`를 실행하면
  - Then `agentType`이 그 detector의 `id`로 해석되고, 기존 type pane들의 판정 결과는 **변하지 않는다**(회귀 없음, open/closed).

- **SPEC-800-AC-02** (R-ORC-007)
  - Given 이미 등록된 `id`와 같은 `id`의 detector를 다시 `register`할 때
  - When registry가 이를 처리하면
  - Then 두 번째 등록은 **거부**되고 doctor 진단에 충돌이 기록되며, scan은 crash하지 않고 기존 detector로 계속된다.

- **SPEC-800-AC-03** (R-P1-011)
  - Given 코드를 작성하지 않고 config의 선언적 rule만으로 새 `id`와 command/title/output 신호를 정의했을 때
  - When 그 신호에 부합하는 pane에 `detectOrc`를 실행하면
  - Then `agentType`이 config의 `id`로 판정되고, `matchedSignals[].ruleId`가 `"config:<id>/..."` 형태이며, confidence가 해당 tier의 [[SPEC-003-agent-detection]] base로 산출된다(코드 변경 0).

- **SPEC-800-AC-04** (R-P1-011, R-ORC-002)
  - Given config rule이 output 신호(Tier C)만 정의하고 confidence 수치를 직접 지정할 수 없는 상태에서
  - When 그 pane을 판정하면
  - Then `agentTypeConfidence ≤ 0.60`(output-only cap, [[SPEC-003-agent-detection]] §3.2-2)이고 HIGH band(≥0.85)에 도달하지 않는다(config가 calibration을 우회할 수 없음).

- **SPEC-800-AC-05** (R-P1-011)
  - Given config의 detector rule 중 하나가 invalid(unknown tier/operator, 컴파일 불가 regex, 중복 id, 비호환 interfaceVersion)할 때
  - When config를 load하면
  - Then 그 invalid rule만 거부되어 doctor 진단에 기록되고, **나머지 rule과 builtin detector는 정상 등록**되며 scan은 정상 산출한다(fail-soft).

- **SPEC-800-AC-06** (R-P1-011, R-ORC-007)
  - Given config 또는 plugin으로 추가된 detector가 동작할 때
  - When 그 detector가 입력을 받으면
  - Then 입력은 redaction 적용 후 `PaneSignal`뿐이고([[08-Decisions|D-016]]), 그 detector는 tmux command·filesystem·network를 **호출하지 않으며**([[08-Decisions|D-019]]), 매칭 원문은 저장·로그되지 않는다([[SPEC-006-privacy-redaction]]).

- **SPEC-800-AC-07** (R-ORC-007)
  - Given 등록하려는 detector의 `interfaceVersion` major가 `DETECTOR_API_VERSION` major와 불일치할 때
  - When registry가 이를 처리하면
  - Then 해당 detector는 **거부**되어 doctor 진단에 남고, 호환되는 나머지 detector로 `detectOrc`가 계속 동작한다.

- **SPEC-800-AC-08** (R-ORC-007, R-P1-011)
  - Given 동일한 `AgentDetector` 인터페이스를 (a) inline builtin 객체와 (b) plugin factory(`createDetectors`)가 만든 객체로 각각 구현해 같은 registry에 등록했을 때
  - When 동일 pane에 `detectOrc`를 실행하면
  - Then 두 경로의 detector는 **동일한 등록·결합 계약**을 통과해 결과가 origin에 의존하지 않는다(packaging-agnostic — inline/package 선택지가 인터페이스를 바꾸지 않음).

## 6. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-ORC-007 | `AgentDetector` 확장점의 안정 계약화, open/closed 등록(중복 id 거부), 인터페이스 버전·호환성, packaging-agnostic 인터페이스 | SPEC-800-AC-01, AC-02, AC-07, AC-08 |
| R-P1-011 | config-driven 선언적 detector rule(코드 없이 신호 추가)·tier 기반 calibration 재사용·fail-soft 검증, plugin 경계 권고와 불변식 보존 | SPEC-800-AC-03, AC-04, AC-05, AC-06, AC-08 |
| R-P2-001 | dashboard agent-start: forward pre-flag만(§4.3), 설계 안 함 | — (forward scope, AC 없음) |
| R-P2-003 | remote camp(SSH): forward pre-flag만(§4.1) | — (forward scope, AC 없음) |
| R-P2-004 | team observer: forward pre-flag만(§4.2) | — (forward scope, AC 없음) |
| R-P2-006 | workflow automation/handoff: forward pre-flag만(§4.4) | — (forward scope, AC 없음) |
| R-P2-007 | enterprise policy/audit/remote-access: forward pre-flag만(§4.5) | — (forward scope, AC 없음) |

> 본 spec은 확장점(R-ORC-007)과 config/plugin detector(R-P1-011)를 covered로, R-P2-*를 **forward pre-flag**로 명시한다(P0 커버리지 대상 아님). 탐지/status 모델 자체는 [[SPEC-003-agent-detection]]/[[SPEC-004-status-inference]] 책임이며 본 spec은 그것을 재사용한다. 전체 매트릭스 롤업은 [[docs/specs/README|README]]가 가리키는 SPEC-900-traceability-rollup이 통합한다.

## 7. Open Questions / Conflicts

### Open Questions

- **inline vs package 최종 결정(검토 필요)**: §3.3은 "config-rule-first, code-plugin-deferred(hybrid)"를 **권고**하나 확정 결정이 아니다. code plugin을 실제로 열지/언제 열지는 [[08-Decisions]] `D-0xx`로 확정해야 한다([[05-Backend]]·[[10-System-Architecture]] Open Question 해소 후보).
- **config regex 안전 한계(검토 필요)**: §3.2-2의 regex 길이·실행시간 상한 구체값과 ReDoS 방어 기법은 미정. 사용자 입력 pattern을 redacted 데이터에 적용하므로 보안 검토가 필요하다([[SPEC-006-privacy-redaction]] 보안 게이트 연계).
- **code plugin in-process 격리(검토 필요)**: §3.3 sandbox 계약은 "의도"이며 in-process JS는 완전 격리가 어렵다. worker thread/subprocess 격리를 강제할지, trust-gated in-process 적재로 둘지 미결(§4.5 enterprise pre-flag와 연계).
- **중복 id override 의미론**: §3.1은 충돌을 **거부**로 시작한다. 사용자가 builtin pattern을 의도적으로 보강/대체하려는 정당한 요구가 측정되면 explicit override(예: `override: true` + 진단)를 도입할지 재검토.
- **status 신호의 config 확장 여부**: 본 spec의 config rule은 **type 축**만 확장한다. [[SPEC-004-status-inference]]의 status/summary 신호(예: 새 agent의 waiting prompt pattern)도 선언적으로 확장할지는 forward 질문(현재는 type-only로 한정).

### Conflicts / Upstream

- **Upstream Open Question 해소 제안**: [[05-Backend]]("내장 vs adapter package")와 [[10-System-Architecture]]("adapter API를 plugin으로 열 것인가")를 본 spec이 **권고안(§3.3)으로 수렴**시킨다 — 단, 최종 결정은 `D-0xx` 필요(위 Open Question).
- **SPEC-003 정합**: 본 spec은 [[SPEC-003-agent-detection]] §2.3의 `AgentDetector`·combiner·confidence 모델을 **재정의하지 않고 참조·재사용**한다. SPEC-003 §6 Conflicts의 "adapter 내장 vs 분리 미해소"를 본 spec이 이어받아 권고로 framing한다. 충돌 없음(확장·구체화 관계).
- **README 정합**: [[docs/specs/README|README]] Epic 9가 본 spec을 R-ORC-007/R-P1-011/R-P2-*로 매핑한 것과 일치한다(R-P2-*는 forward pre-flag).
