---
spec: SPEC-007
title: 테스트 전략·PoC 측정·수용 매트릭스
status: approved
updated: 2026-06-27
requirements: [R-CLI-004, R-TMUX-001, R-TMUX-002, R-TMUX-004, R-TMUX-005, R-TMUX-006, R-ORC-001, R-ORC-002, R-ORC-003, R-ORC-004, R-ORC-005, R-ORC-006, R-ORC-007, R-PRIV-001, R-PRIV-002, R-PRIV-003, R-PRIV-004, R-PRIV-005, R-PRIV-006, R-OBS-003, R-UI-007]
decisions: [D-012, D-014, D-020, D-021]
tags:
  - specs
  - test
  - validation
  - poc
  - traceability
  - scan
---

# SPEC-007 — 테스트 전략·PoC 측정·수용 매트릭스

이 spec은 `orc-camp scan` 슬라이스([[14-MVP-PoC-Scope]], [[08-Decisions]] D-012)가 **어떻게 검증되는가**를 고정한다. 즉 테스트 계층 분리, fixture 전략, PoC 측정 하니스, privacy/read-only 강제 테스트, 그리고 **모든 슬라이스 `R-*` → SPEC → `SPEC-NNN-AC-NN` → 테스트 케이스/계층**을 잇는 **통합 수용·추적 매트릭스**를 정의한다. 이 문서는 [[SPEC-000-conventions]]의 추적성 규약을 슬라이스 전체로 통합하는 지점이다.

> **소유 경계**: 본 spec은 detection/status/redaction **규칙** 자체나 출력 **스키마**를 정의하지 않는다(그것들은 각각 [[SPEC-003-agent-detection]]·[[SPEC-004-status-inference]]·[[SPEC-006-privacy-redaction]]·[[SPEC-005-data-contract]] 소유다). 본 spec은 그 규칙·스키마를 **재현 가능하게 검증·측정하는 방법**과, 슬라이스 전체의 추적성 완결성을 소유한다. 새 product `R-*`를 만들지 않는다.

> **확정 스택**: 단위·통합·측정 테스트는 **Vitest**로 작성한다([[AGENTS]] 계획된 기술 스택). e2e는 실제 tmux session 위에서 CLI를 spawn해 관측한다.

> **임계값 표기**: 본 문서의 PoC 통과 임계값(precision ≥ 0.9, `waiting` recall ≥ 0.7, p95 < 1s, false-redaction-rate ≤ τ 등)은 **확정 사양이 아니라 프로젝트의 성공 가설(success hypotheses)**이다([[SPEC-000-conventions]] 표기 규칙, [[14-MVP-PoC-Scope]] PoC 성공 판정 지표). 측정 결과로 가설을 채택/기각/보정한다.

## 1. Scope

### In scope

- **테스트 계층 분리**: unit(순수 함수) / integration(`tmux` exec 경계 — fixture·mock 기반) / e2e(실제 tmux). CI에서 **live tmux·머신 상태 없이 결정적으로** 도는 경계 명시(§2.1, §3.1).
- **fixture 전략**: captured `-F` inventory 출력과 `capture-pane` 텍스트 샘플을 placeholder(secret 포함)로 고정해 detection/status/redaction을 재현 가능하게 만드는 저장 규칙과 fixture 집합 카탈로그(§2.3).
- **PoC 측정 하니스**: 수동 라벨 데이터셋의 shape(§2.4)와 각 PoC 지표(agent precision/recall, status accuracy·`waiting` recall, confidence calibration 단조성, scan latency p50/p95, false-redaction)를 **input·method·formula·pass threshold**까지 절차로 정의(§3.3).
- **privacy 검증**: planted secret이 모든 출력 경로(table·`--json`·preview·debug log)에서 마스킹되는지, 원문이 비저장되는지, read-only allowlist 위반 spawn이 없는지 강제(§3.4–3.6).
- **통합 수용·추적 매트릭스**: 슬라이스 `R-*` ↔ SPEC ↔ AC ↔ 테스트 케이스/계층, 그리고 [[14-MVP-PoC-Scope]] 수용 체크박스 ↔ 테스트 케이스 매핑. **무커버 `R-*`는 P0 GAP 행으로 명시**(§5).
- 테스트 케이스 카탈로그(§2.5)와 측정 하니스 자체의 수용 기준(`SPEC-007-AC-NN`, §4).

### Out of scope (다른 spec/슬라이스로)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| detection/status/redaction **규칙·pattern·threshold 정의** | 본 spec은 그것을 **테스트**한다 | [[SPEC-003-agent-detection]], [[SPEC-004-status-inference]], [[SPEC-006-privacy-redaction]] |
| `--json`/table **스키마·필드 shape** | 본 spec은 스키마에 **validate**한다 | [[SPEC-005-data-contract]] |
| CLI flag·exit code·stream **계약 정의** | 본 spec은 그 계약을 **검증**한다 | [[SPEC-001-scan-cli]] |
| tmux command set·timeout·error isolation **정의** | 본 spec은 그 강제를 **관측**한다 | [[SPEC-002-tmux-discovery]], [[SPEC-006-privacy-redaction]] |
| server/dashboard/control 테스트 | 후속 슬라이스 | Slice 2~4 SPEC |

## 2. Contract — test harness 계약

### 2.1 테스트 계층과 결정적 경계

| 계층 | 대상 | 의존 | 결정적 | CI 게이트 | 비고 |
| --- | --- | --- | --- | --- | --- |
| **unit (U)** | 순수 함수: detection rule(`detect`/`detectOrc`), status 추론(`inferStatus`), redaction(`sanitizeCapture`/`redact`), schema 조립·직렬화, CLI 렌더(table/exit/flag), inventory 파싱(`-F` split·빈상태 분류·error isolation 로직) | 없음(입력은 메모리 객체/문자열). tmux·fs·실시간 clock 미사용(시각은 주입) | **예** | **예** | live tmux 불필요. detection/status/redaction/schema가 모두 순수 함수로 분리됨을 전제 |
| **integration (I)** | scanner 전체 파이프라인을 **주입된 `tmuxExec`/spawn mock**(fixture 백엔드)으로 구동. exec 경계, error isolation, 빈 상태, stream hygiene, exit code, 비저장(fs spy), read-only argv, `--json` validity | fixture(§2.3) + fake timers(timeout). **live tmux 없음**, fs는 spy/temp | **예** | **예** | "tmux 호출 경계"를 mock으로 고정 — 실제 server에 의존하지 않음 |
| **e2e (E)** | 실제 tmux session 위에서 `orc-camp scan`을 spawn해 stdout/exit/부작용 관측. 실 Claude Code/Codex pane smoke, read-only 실증, latency 측정 substrate | **live tmux + 머신 상태** | 아니오 | **아니오(별도 job)** | macOS+tmux 보장 job에서만. 머신 의존이므로 CI 게이트 불가 |
| **measurement (M)** | 라벨 데이터셋(§2.4)에 detection/status/redaction을 적용해 PoC 지표 산출 | detection/status/redaction은 **fixture만**(CI 게이트). latency만 e2e | precision/recall/calibration/false-redaction = **예**; latency = 아니오 | 지표별 분기 | **핵심**: detection 정확도 지표는 live tmux 없이 fixture에서 재현된다(SPEC-007-AC-01) |

- **결정적 경계(확정)**: unit·integration·fixture 기반 measurement는 **live tmux server나 머신의 tmux 상태에 의존하지 않고 CI에서 끝까지 돈다**(SPEC-007-AC-10). live tmux에 의존하는 것은 **e2e와 latency 측정뿐**이며, 별도 job(macOS+tmux 보장)에서 비-게이트로 돌린다.
- **시간 결정성(확정)**: timeout·idle·active·terminated TTL 검증은 fake timers와 주입된 `scannedAt`/`lastActivityAt`/`prior.observedAt`로 고정한다(실시간 의존 금지).
- **순수 함수 분리 전제**: detection/status/redaction/schema 로직은 tmux I/O와 분리된 순수 함수로 구현돼야 unit·measurement가 결정적이 된다. 이 분리는 [[SPEC-003-agent-detection]] `detect(pane)`, [[SPEC-004-status-inference]] `inferStatus(input)`, [[SPEC-006-privacy-redaction]] `sanitizeCapture(raw)`의 인터페이스가 이미 보장한다.

### 2.2 mock tmux 경계(integration)

- `tmuxExec`(또는 `child_process.spawn`)를 **단일 주입 지점**으로 두고, integration에서 fixture 백엔드로 대체한다. mock은 `(subcommand, args) → { stdout, stderr, exitCode, delayMs?, spawnError? }`를 fixture에서 resolve한다.
- mock은 호출된 모든 `(subcommand, args)`를 **spawn 기록부(argv log)**에 적재한다 → read-only allowlist 관측(§3.5)·호출 횟수 검증의 근거.
- `delayMs`/fake timers로 timeout·SIGTERM 경로를 결정적으로 재현한다. `spawnError=ENOENT`로 `not_installed`를 재현한다.
- mock은 **실제 tmux를 절대 spawn하지 않는다** → CI 결정성.

### 2.3 fixture 전략과 fixture 집합

- **저장 형식**: fixture는 `tests/fixtures/` 아래 텍스트/JSON 파일로 보관한다. 각 fixture는 (a) inventory 응답군(`list-sessions`/`list-panes -a`/`list-windows -a`의 `-F` 출력 — `<US>`(0x1F) 구분자 그대로), (b) pane별 `capture-pane` 텍스트, (c) 기대 메타(있으면 gold 라벨)를 담는다.
- **secret placeholder 규칙(확정)**: 어떤 fixture도 **실제 secret을 담지 않는다**. token shape/placeholder만 쓴다([[SPEC-000-conventions]], [[SPEC-006-privacy-redaction]] §2.2) — 예: `ghp_<token>`, `AKIA<placeholder>`, `-----BEGIN RSA PRIVATE KEY-----<body>-----END RSA PRIVATE KEY-----`, `Authorization: Bearer <token>`, `API_KEY=<value>`. 테스트는 **이 placeholder literal**이 출력에 나타나는지로 마스킹 실패를 판정한다.
- **재현성(확정)**: 같은 fixture + 주입 clock은 항상 같은 산출을 만든다([[SPEC-001-scan-cli]] §3.4, [[SPEC-004-status-inference]] §3.8, [[SPEC-005-data-contract]] §3.4 결정성과 정합).

**필수 fixture 집합 카탈로그**(각 항목은 sibling AC가 요구하는 상태를 1:1 이상 백킹):

| Fixture ID | 종류 | 내용/의도 | 주 소비 AC |
| --- | --- | --- | --- |
| `INV-NORMAL` | inventory | server 실행 + 다중 session/window/pane(아래 capture와 결합) | SPEC-002-AC-01/02/03, SPEC-005-AC-02/03/12 |
| `INV-NOT-INSTALLED` | inventory | `tmux -V` spawn `ENOENT` | SPEC-002-AC-08, SPEC-005-AC-05, SPEC-001-AC-03/13 |
| `INV-NO-SERVER` | inventory | `list-sessions` non-zero + `no server running` stderr | SPEC-002-AC-09, SPEC-005-AC-05 |
| `INV-NO-SESSION` | inventory | `list-sessions` exit 0 + 빈 stdout | SPEC-002-AC-10, SPEC-005-AC-05 |
| `INV-NO-AGENT` | inventory | session/pane 있으나 모두 비-candidate | SPEC-003-AC-05, SPEC-005-AC-06, SPEC-001-AC-13 |
| `INV-PARSE-ERR` | inventory | `-F` 필드 수 불일치 줄 1개 | SPEC-002-AC(파싱 §3.5 parse_error skip) |
| `INV-DEAD-PANE` | inventory | `#{pane_dead}=1` pane | SPEC-004-AC-09 |
| `INV-STALE` | inventory | prior good 후 `list-panes` 실패(→ last-good fallback) | SPEC-002-AC-11, SPEC-005-AC-07, SPEC-004-AC-10 |
| `INV-FIRST-FAIL` | inventory | prior 없는 첫 실패(위조 금지) | SPEC-002-AC-12, SPEC-005-AC-07 |
| `PROC-CMDLINE` | process | `pane_pid → ps`가 wrapper argv(`node`/`python` + signature)와 process-alive를 반환(Tier B 입력) — [[08-Decisions\|D-020]] | SPEC-002-AC-15, SPEC-003-AC-03 |
| `PROC-FAIL` | process | `ps` non-zero/미지원 플랫폼/pid 없음/timeout → `cmdline=null` (격리, Tier B는 `paneTitle` fallback) | SPEC-002-AC-16 |
| `PROC-SECRET` | process | `cmdline` argv에 `--token=<value>` placeholder + `cwd` 경로 민감 구간(home/username) — cmdline/cwd redaction 경계 | SPEC-002-AC-17 동반, SPEC-006 cmdline/cwd-redaction AC(SPEC-006 소유) |
| `CAP-CLAUDE` | capture | claude-code pane(command/banner/prompt) | SPEC-003-AC-01/03 |
| `CAP-CODEX` | capture | codex pane | SPEC-003-AC-02 |
| `CAP-UNKNOWN` | capture | generic agent marker, concrete signature 없음 | SPEC-003-AC-04 |
| `CAP-SHELL` | capture | 비-agent shell(`zsh`/`vim` 등) | SPEC-003-AC-05 |
| `CAP-WAIT-STATIC` | capture | tail 대기 prompt + 변화 없음(prior 동봉) | SPEC-004-AC-05 |
| `CAP-WAIT-MIDSTREAM` | capture | `(y/n)`이 중간에 있고 tail은 streaming(prior 동봉) | SPEC-004-AC-06 |
| `CAP-ACTIVE-CHANGE` | capture | prior 대비 비휘발성 줄 변화 | SPEC-004-AC-03 |
| `CAP-ACTIVE-VOLATILE` | capture | prior 대비 스피너/시계만 변함(노이즈) | SPEC-004-AC-04 |
| `CAP-ERROR-TRACE` | capture | 다중 줄 traceback tail | SPEC-004-AC-08(HIGH) |
| `CAP-ERROR-KEYWORD` | capture | 단일 error keyword | SPEC-004-AC-08(MEDIUM 이하) |
| `CAP-IDLE` | capture | 비활동 > `T_idle`, 신호 없음 | SPEC-004-AC-07 |
| `CAP-EMPTY` | capture | 빈 capture + prior 없음 | SPEC-004-AC-02 |
| `CAP-FAIL` | capture | 해당 pane `capture-pane` 실패(non-zero/timeout) | SPEC-002-AC-05, SPEC-001-AC-05, SPEC-005-AC-10 |
| `CAP-SECRETS` | capture | planted secret 집합(ghp_/AKIA/PEM/Bearer/JWT/slack/URL-cred/`API_KEY=`/`sk-ant-`) — placeholder | SPEC-006-AC-01~05/07/11/13, SPEC-001-AC-12, SPEC-005-AC-10/14 |
| `CAP-BIG-LINES` | capture | N(=`CAPTURE_LINES`) 초과 scrollback | SPEC-006-AC-08 |
| `CAP-BIG-BYTES` | capture | B(=`BYTE_CAP`) 초과 단일 거대 줄 | SPEC-006-AC-09 |
| `CORPUS-SECRET` | 라벨 코퍼스 | "반드시 가려야 할" secret 샘플 집합(placeholder) | SPEC-006-AC-15, SPEC-007-AC-04 |
| `CORPUS-KEEP` | 라벨 코퍼스 | "가리면 안 되는" 의미 텍스트(경로/hash/UUID/agent banner 토큰) | SPEC-006-AC-15, SPEC-007-AC-04, SPEC-003 banner coherence |
| `CORPUS-CWD` | 라벨 코퍼스 | `cwd`/`cmdline` 샘플: 마스킹 대상(home/username·argv token) vs 보존 대상(프로젝트 경로) 혼합 — cwd/cmdline redaction 판정용. 정확한 마스킹 규칙·AC는 [[SPEC-006-privacy-redaction]] 소유([[SPEC-006-privacy-redaction]] §6 Q3) | SPEC-006 cwd/cmdline-redaction AC(SPEC-006 소유), SPEC-007-AC-04 |
| `LABELED-DETECT` | 라벨 데이터셋 | agent type gold 라벨 pane 샘플(§2.4) | SPEC-007-AC-01/03 |
| `LABELED-STATUS` | 라벨 데이터셋 | status gold 라벨 pane 샘플(prior 포함, §2.4) | SPEC-007-AC-02/03, SPEC-004-AC-14 |

### 2.4 라벨 데이터셋 shape(measurement)

수동 라벨된 pane 샘플의 레코드 형태(영문 식별자, 값은 placeholder 가능):

```ts
interface LabeledPaneSample {
  id: string;                       // 샘플 고유 id
  source: 'fixture' | 'captured';   // 합성 fixture vs 실 pane 캡처(secret placeholder화 후)
  // --- scanner가 보는 입력 재현 ---
  rawCapture: string;               // capture-pane 원문(placeholder secret 포함 가능). harness가 sanitizeCapture를 적용
  paneMeta: {
    currentCommand: string;
    paneTitle: string | null;
    cmdline: string | null;
    cwd: string;
    paneId: string;
    tmuxTarget: string;
    lastActivityAt: string;         // ISO 8601
    paneDead: boolean;
    panePid: number | null;
  };
  prior: PriorOrcState | null;      // status 차분용. detect 전용 샘플은 null
  scannedAt: string;                // ISO 8601(비활동/active 판정 기준)
  // --- 사람 gold 라벨 ---
  gold: {
    isAgent: boolean;               // agent pane 여부(non-candidate 구분)
    agentType: 'claude-code' | 'codex' | 'unknown' | null; // null = 비-agent
    status: 'active'|'waiting'|'idle'|'stale'|'error'|'unknown'|'terminated';
    waiting: boolean;               // waiting recall 별도 집계용(편의 플래그)
  };
}
```

- harness는 각 샘플의 `rawCapture`에 **[[SPEC-006-privacy-redaction]] `sanitizeCapture`를 먼저 적용**해 redacted `PaneSignal`을 만든 뒤 `detectOrc`/`inferStatus`를 호출한다(redaction-before-consumption과 동일 경로 — §3.4). 마찬가지로 `paneMeta.cmdline`과 `cwd`도 소비 전 [[SPEC-006-privacy-redaction]] redaction 경계를 통과한다(cmdline은 적용, cwd 정책은 SPEC-006 소유 — [[SPEC-006-privacy-redaction]] §6 Q3).
- `paneMeta.cmdline`/`panePid`는 [[SPEC-002-tmux-discovery]] §2.8의 `pane_pid → ps` process introspection(선택적·degradable, [[08-Decisions|D-020]])에서 채워져 [[SPEC-003-agent-detection]] Tier B 입력으로 쓰인다. 획득 불가 샘플은 `cmdline=null`로 두고 Tier B `paneTitle` fallback을 재현한다.
- 데이터셋은 [[07-Roadmap]] 검증 실험("실 Claude Code/Codex pane 5개 이상", "입력 대기 pane 사람 판정 비교")과 [[14-MVP-PoC-Scope]] 검증 시나리오를 라벨 소스로 채운다. 실 pane 캡처는 secret을 placeholder로 치환한 뒤 fixture로 승격한다.
- **최소 규모(가설)**: 지표 안정성을 위해 type 라벨 ≥ 50 pane, status 라벨 ≥ 50 pane(그중 `waiting` gold ≥ 15)을 1차 목표로 한다. 규모 부족 band는 §3.3 M3에서 "표본 부족"으로 보고하고 단조성 판정에서 제외한다. (규모는 PoC 운영 가설.)

### 2.5 테스트 케이스 카탈로그

테스트 케이스 ID는 안정적이며 매트릭스(§5)가 이를 참조한다. `TC-<U|I|E|M>-<group>-<n>`.

**Unit (U) — 결정적, CI 게이트**

| TC | 검증 내용 | 소비 AC |
| --- | --- | --- |
| `TC-U-DET-CMD` | direct command → claude-code/codex, tier A, conf ≥ 0.90 | SPEC-003-AC-01, AC-02 |
| `TC-U-DET-WRAP` | wrapper+signature → MEDIUM band, tier B | SPEC-003-AC-03 |
| `TC-U-DET-UNKNOWN` | ambiguous candidate → `unknown` LOW, null 아님 | SPEC-003-AC-04 |
| `TC-U-DET-NONCAND` | shell/비-agent → `detectOrc=null` | SPEC-003-AC-05 |
| `TC-U-DET-OUTCAP` | output-only → cap ≤ 0.60 | SPEC-003-AC-06 |
| `TC-U-DET-EXT` | 새 adapter 추가만으로 확장 | SPEC-003-AC-07 |
| `TC-U-DET-CONFLICT` | 동률 tier 충돌 → `unknown` | SPEC-003-AC-08 |
| `TC-U-DET-CORROB` | 동일 type 다중 신호 단조 보강 | SPEC-003-AC-09 |
| `TC-U-STAT-SHAPE` | `inferStatus` 출력 필드 6종 | SPEC-004-AC-01 |
| `TC-U-STAT-UNKNOWN` | 신호 없음 → `unknown` LOW | SPEC-004-AC-02 |
| `TC-U-STAT-ACTIVE` | 비휘발성 변화 → `active` HIGH | SPEC-004-AC-03 |
| `TC-U-STAT-NOISE` | 휘발성 전용 변화 → `active` HIGH 아님 | SPEC-004-AC-04 |
| `TC-U-STAT-WAIT` | tail prompt 정적 → `waiting`(adapter HIGH/generic MEDIUM) | SPEC-004-AC-05 |
| `TC-U-STAT-WAIT-NEG` | 중간 `(y/n)`+streaming → `waiting` 아님 | SPEC-004-AC-06 |
| `TC-U-STAT-IDLE` | 비활동 > `T_idle` → `idle` | SPEC-004-AC-07 |
| `TC-U-STAT-ERR` | traceback HIGH vs keyword MEDIUM | SPEC-004-AC-08 |
| `TC-U-STAT-TERM` | `pane_dead` → `terminated` + retention | SPEC-004-AC-09 |
| `TC-U-STAT-STALE` | `snapshotStale` → `stale`(≠terminated) | SPEC-004-AC-10 |
| `TC-U-STAT-SRC` | `summarySource` 우선순위 5종 | SPEC-004-AC-11 |
| `TC-U-STAT-EST` | `summaryIsEstimated`(user_label만 false) | SPEC-004-AC-12 |
| `TC-U-STAT-REDSUM` | 전부 redacted 요약 후보 → skip, rule id만 | SPEC-004-AC-13 |
| `TC-U-STAT-DET` | 동일 입력 2회 동일 산출 | SPEC-004-AC-15 |
| `TC-U-RED-PATTERNS` | ghp/PEM/URL-cred/env-secret/AWS/slack/JWT/bearer 마스킹 | SPEC-006-AC-01~05 |
| `TC-U-RED-LIMITS` | line cap N · byte cap B(tail 보존) · preview tail P | SPEC-006-AC-08, AC-09 |
| `TC-U-RED-EXEC` | `tmuxExec` 비-allowlist → throw, spawn 안 함 | SPEC-006-AC-12(a) |
| `TC-U-RED-CMDLINE` | `cmdline` argv의 `--token=<value>`/`cwd` 민감 구간 redaction(보존 대상 경로는 통과) — `CORPUS-CWD` | SPEC-006 cmdline/cwd-redaction AC(SPEC-006 소유) |
| `TC-U-SCHEMA-VALID` | envelope/orc 필드·타입 schema validate | SPEC-005-AC-01, AC-03 |
| `TC-U-SCHEMA-ID` | `id` paneId/sessionId 파생·정규식 | SPEC-005-AC-04 |
| `TC-U-SCHEMA-EMPTY` | 빈 상태 3종 + no-agent 필드 조합 | SPEC-005-AC-05, AC-06 |
| `TC-U-SCHEMA-STALE` | `stale`/`lastGoodAt` 직렬화·위조 금지 | SPEC-005-AC-07 |
| `TC-U-SCHEMA-EST` | estimated/confidence/summarySource 직렬화 | SPEC-005-AC-08, AC-09 |
| `TC-U-SCHEMA-AGG` | orcCount/statusSummary/paneCount 집계 | SPEC-005-AC-12 |
| `TC-U-SCHEMA-DET` | 동일 입력 → byte 동일 `--json` | SPEC-005-AC-13 |
| `TC-U-SCHEMA-SIG` | agent/statusSignals = ruleId만(원문 없음) | SPEC-005-AC-14 |
| `TC-U-INV-PARSE` | `-F` split, 9필드·타입, parse_error skip | SPEC-002-AC-02, AC-03 |
| `TC-U-INV-EMPTY` | probe/list-sessions 출력 → 빈상태 분류 | SPEC-002-AC-08, AC-09, AC-10 |
| `TC-U-INV-STALE` | last-good vs stale·첫 실패 위조 금지 | SPEC-002-AC-11, AC-12 |
| `TC-U-CLI-EXIT` | exit 0/1/2 매핑·flag 파싱·`--help` | SPEC-001-AC-06, AC-07, AC-16 |
| `TC-U-CLI-TABLE` | confidence/estimated marker/빈상태 렌더 | SPEC-001-AC-09, AC-10, AC-11, AC-13 |
| `TC-U-CLI-PREVIEWFLAG` | reserved `--no-preview`/`--preview-lines` parse-only(동작 없음) + preview text 미렌더(metadata-only) negative — [[08-Decisions\|D-021]] | SPEC-001-AC-15 |

**Integration (I) — mock tmux, 결정적, CI 게이트**

| TC | 검증 내용 | 소비 AC |
| --- | --- | --- |
| `TC-I-SCAN-NORMAL` | 정상 fixture → table + `--json` 산출 | SPEC-001-AC-01, SPEC-002-AC-01, SPEC-005-AC-02 |
| `TC-I-JSON-HYGIENE` | `--json` 단일 유효 document, stdout 청결(`2>/dev/null|jq`) | SPEC-001-AC-02, AC-04 |
| `TC-I-EMPTY` | not_installed/no-server/no-session/no-agent end-to-end 구분 | SPEC-001-AC-03/13, SPEC-002-AC-08/09/10, SPEC-005-AC-05/06 |
| `TC-I-CAPFAIL` | capture 실패 격리, 나머지 정상, exit 0 | SPEC-001-AC-05, SPEC-002-AC-05 |
| `TC-I-INVFAIL` | inventory 실패 → diagnostics + stale fallback → orc `stale` | SPEC-002-AC-06/11, SPEC-005-AC-07, SPEC-004-AC-10 |
| `TC-I-TIMEOUT` | command timeout(fake timer) → 종료·예외 없음 | SPEC-002-AC-04, SPEC-006-AC-14 |
| `TC-I-READONLY` | 전체 scan spawn argv ⊆ allowlist ∪ `-V`; 상태변경 0 | SPEC-002-AC-13, SPEC-006-AC-12(b) |
| `TC-I-CAPTURE-FORM` | `capture-pane -p -t <id> -S -N`(`-e` 미사용) | SPEC-002-AC-14 |
| `TC-I-PROC-CMDLINE` | `pane_pid → ps`로 `cmdline`/process-alive 수집 → Tier B 입력 제공 | SPEC-002-AC-15 |
| `TC-I-PROC-ISOLATE` | `ps` 실패/미지원/timeout → `cmdline=null` 격리, 전체 scan 미중단, Tier B `paneTitle` fallback | SPEC-002-AC-16 |
| `TC-I-PROC-READONLY` | process-introspection subprocess(`ps`) argv: 읽기 전용·고정 argv·`shell:false`·per-call timeout, 상태변경 명령 0 | SPEC-002-AC-17, SPEC-006 subprocess-safety AC(SPEC-006 §2.6 소유) |
| `TC-I-SECRET-ALLPATHS` | planted secret이 table/`--json`/preview/log 어디에도 없음 | SPEC-006-AC-01~05/07/11, SPEC-001-AC-12, SPEC-005-AC-10/14 |
| `TC-I-NONPERSIST` | fs-write spy: capture 텍스트 담은 파일 미생성 | SPEC-006-AC-10 |
| `TC-I-DIAG-PRIVACY` | `tmuxErrors[].message`에 capture 원문 없음 | SPEC-002-AC-07, SPEC-006-AC-13, SPEC-005-AC-11 |
| `TC-I-WATCH` | `--watch` prior 전달·read-only 유지(cycle 전체) | SPEC-001-AC-08 |
| `TC-I-SINGLESHOT` | 단발 저하(change-active HIGH/사라짐-terminated 없음) | SPEC-001-AC-09 |
| `TC-I-NOURL` | 어떤 TCP port도 listen 안 함·URL 없음 | SPEC-001-AC-14 |

**E2E (E) — live tmux, 비-게이트(별도 job)**

| TC | 검증 내용 | 소비 |
| --- | --- | --- |
| `TC-E-SMOKE` | 실 tmux에서 session/window/pane inventory 출력 | 14-MVP 체크박스 1 |
| `TC-E-AGENT` | 실 claude-code/codex pane 분류(라벨 소스 겸용) | 14-MVP 체크박스 3, SPEC-003-AC-01/02 |
| `TC-E-READONLY` | 실행 후 tmux 상태 불변(read-only 실증) | SPEC-006-AC-12 보강 |
| `TC-E-WATCH` | 실 tmux에서 `--watch` cycle-to-cycle prior로 `active`/사라짐-`terminated`/status transition을 **live cycle 데이터**로 관측(→ M2 prior 의존 부분집합 실측, [[08-Decisions\|D-014]] 근거) | SPEC-007-AC-02(live), SPEC-004-AC-03/09 |
| `TC-E-LATENCY` | ≥20 실 pane `--watch` cycle 반복(→ M-LATENCY) | 14-MVP latency |

**Measurement (M) — 라벨 데이터셋, latency만 e2e**

| TC | 검증 내용 | 소비 |
| --- | --- | --- |
| `TC-M-PRECISION` | agent precision/recall(§3.3 M1) | SPEC-007-AC-01 |
| `TC-M-STATUS` | status accuracy·`waiting` recall(M2). prior 의존 신호(`active`/transition/사라짐-`terminated`)는 합성 prior fixture(결정성) + `TC-E-WATCH` live cycle(실측) 양쪽으로 평가 | SPEC-007-AC-02, SPEC-004-AC-14 |
| `TC-M-CALIB-TYPE` | agentTypeConfidence band 단조성(M3) | SPEC-007-AC-03 |
| `TC-M-CALIB-STATUS` | statusConfidence band 단조성(M3) | SPEC-007-AC-03, SPEC-004-AC-14 |
| `TC-M-FALSERED` | secret-recall=1.0 · false-redaction-rate ≤ τ(M5) | SPEC-007-AC-04, SPEC-006-AC-15 |
| `TC-M-BANNER` | banner 토큰 비-redaction + redacted 출력에서 G-OUT 발화(coherence) | SPEC-006 C4 / SPEC-003 Q |
| `TC-M-LATENCY` | 20 pane p50/p95 — `--watch` cycle-to-cycle latency(e2e, M4) | SPEC-007-AC-05 |

### 2.6 e2e 실행 메커니즘 (구현 노트, 2026-06-27)

§2.5 `TC-E-*`(live tmux)의 실제 실행 방식을 고정한다. e2e는 **비-게이트**(§3.1-2)이며 CI 기본 `npm test`에서 제외된다.

- **위치/실행**: `tests/e2e/*.e2e.ts`, `npm run test:e2e`(`vitest.e2e.config.ts`). 기본 `npm test`의 include(`tests/**/*.test.ts`)는 `*.e2e.ts`를 매칭하지 않아 게이트와 분리된다.
- **gating**: 파일 최상단에서 `tmux -V` 가용성을 확인(top-level await)하고 `describe.skipIf(!AVAILABLE)`로 미설치 환경에서 깨끗이 skip한다(머신 의존, §3.1-2).
- **격리**: 기본 tmux server에 **고유 이름의 일회용 session**(`orccampE2E_<pid>_<ts>`)을 만들고 정적 pane(`sleep`) + Tier-B title 시그니처(`select-pane -T`)를 부여해 claude-code orc로 탐지시킨다. `afterAll`에서 항상 `kill-session`으로 정리한다. scan은 read-only이므로 server의 다른 session은 건드리지 않으며, session 생성/종료(new-session/kill-session)는 **harness의 setup/teardown**이지 CLI의 행위가 아니다.
- **CLI spawn**: 사용자와 동일하게 실제 CLI를 spawn해 stdout/exit를 관측한다(`npx tsx src/cli.ts …`; bin과 동일 소스).
- **현재 구현 케이스**: `TC-E-SMOKE`(exit 0 + header, `--json` 단일 유효 document), `TC-E-AGENT`(일회용 session이 camp로 발견 + claude-code orc 탐지), `TC-E-READONLY`(scan 전후 해당 session pane state 불변), `TC-E-LATENCY`(sanity: `scanDurationMs` 보고·bound; 정식 p95<1s는 M4 e2e job 소유).
- **미구현(후속)**: `TC-E-WATCH`(cycle-to-cycle prior 실측 calibration)는 별도 후속 작업이다.

### 2.7 측정 하니스 구현 + 측정 스냅샷 (구현 노트, 2026-06-27)

§3.3 M1~M5 측정 하니스가 구현됐다.

- **위치**: `tests/measurement/harness.ts`(metric 함수: detection P/R, status accuracy/waiting recall, calibration band bucketing+monotonicity, false-redaction/secret-recall + redaction-before-consumption builders), `tests/measurement/dataset.ts`(curated `LABELED-DETECT`/`LABELED-STATUS` + `CORPUS-SECRET`/`CORPUS-KEEP`), `tests/measurement/metrics.test.ts`(`TC-M-*`). fixture 기반이라 **CI 게이트**(§3.1-1)에 포함된다. M4(live latency)는 `scripts/measure-latency.mts`(`npm run measure:latency`, 비-게이트).
- **데이터셋 provenance(중요)**: 현재 `LABELED-*` 샘플은 **문서화된 신호 케이스 + 적대적 hard 케이스(node webserver 비-candidate, 스피너 전용 churn, mid-stream `(y/n)`)를 손수 라벨링한 대표 커버리지**이며 **실 pane 캡처가 아니다**. 즉 metric이 spec 의도와 엔진의 일치를 확인(self-confirming + regression gate)하는 단계다. §2.4의 규모(type ≥50, status ≥50, waiting ≥15)를 실 캡처(secret placeholder화)로 채워 **비-self-confirming 측정**으로 가는 것이 PoC 성공 판정을 닫는 잔여 단계다(현재 detect 20 / status 19 / waiting 8).
- **측정 스냅샷 (2026-06-27, 현재 데이터셋·엔진)**:
  - **M1 detection**: micro precision 100% · recall 100% (n=20; node webserver 등 비-agent 0 오탐).
  - **M2 status**: accuracy 100% · `waiting` recall 100% (waiting gold 8) — 가설 ≥0.7 충족(데이터셋 기준).
  - **M3 calibration**: agentType·status 모두 band별 정답률 비감소(monotonic) 충족.
  - **M5 redaction**: secret-recall 1.0 (확정 목표) · false-redaction-rate 0% (≤ τ 0.05) · banner 토큰 비-redaction + redacted 출력에서 detection 발화(coherence).
  - **M4 latency (live tmux, 실측)**: **101 pane**(20 pane 목표의 5배)에서 p50 **730ms** · p95 **807ms** · mean 768ms (24 cycle, warmup 2 제외). 가설 p95<1s를 5배 규모에서도 충족.

> 주의: M1~M3·M5의 100%는 **curated 데이터셋 기준**이며 가설을 "기각하지 않음"을 의미할 뿐 실증이 아니다. 실 pane 라벨링 후 수치가 가설을 실제로 검증/보정한다. M4만 실 환경 비-circular 실측이다.

## 3. Behavior rules

### 3.1 결정적 CI 경계(확정)

1. **CI 게이트 = U + I + fixture 기반 M**. 이들은 live tmux server·머신 tmux 상태·실시간 clock에 의존하지 않는다(SPEC-007-AC-10). 모든 시각은 주입, 모든 tmux I/O는 fixture/mock.
2. **비-게이트 = E + M-LATENCY**. macOS+tmux 보장 job에서 돈다. 실패는 회귀 신호로 보고하되 PR 게이트를 막지 않는다(머신 의존). latency 가설 판정은 이 job 결과로 한다.
3. fixture 기반 M은 detection/status/redaction 지표를 **CI에서 재현**한다 → PoC 정확도 가설을 코드 변경마다 추적 가능(detection regression 조기 검출).

### 3.2 fixture 적용 규칙(확정)

1. 모든 capture fixture는 `sanitizeCapture`를 거친 뒤에만 detection/status에 입력된다(real 파이프라인과 동일 경계, §3.4).
2. prior 의존 status(`active`·status transition·사라짐 기반 `terminated`)의 **결정적 unit/integration** 검증은 fixture가 `prior`(직전 fingerprint 등)를 동봉(합성 prior)해야 성립한다. 단발 전용 fixture는 `prior=null`로 두고 저하 규칙을 검증한다([[SPEC-004-status-inference]] §3.8).
   - **live `--watch` 측정 추가(확정, [[08-Decisions|D-014]])**: prior 의존 신호의 **REAL-PANE 정확도/calibration**은 합성 prior fixture만으로는 분포가 제한되므로, [[08-Decisions|D-014]]가 확정한 `--watch`(기본 single-shot + opt-in) 모드를 사용해 **cycle-to-cycle prior**(직전 cycle snapshot)로 실 pane에서 측정한다(`TC-E-WATCH`, e2e). 즉 결정성은 합성 prior fixture가, 실측 분포는 live `--watch` cycle이 각각 백킹한다(둘 다 read-only 불변식 유지). 단발(prior 없음) 샘플은 종전대로 저하 규칙으로 채점한다.
3. fixture는 placeholder secret만 담는다(§2.3). 테스트는 placeholder literal 부재로 마스킹을 판정한다.

### 3.3 PoC 측정 절차(각 지표: input·method·formula·threshold)

> 모든 임계값은 [[14-MVP-PoC-Scope]] "PoC 성공 판정 지표"에서 인용한 **프로젝트 성공 가설**이다.

**M1 — agent detection precision/recall** (지표: agent detection 정확도, [[14-MVP-PoC-Scope]] precision ≥ 0.9)
- **Input**: `LABELED-DETECT` 데이터셋. 각 샘플의 `paneMeta`+`rawCapture`(→sanitize)→`PaneSignal`, gold `isAgent`/`agentType`.
- **Method**: 샘플마다 `detectOrc(paneSignal, detectors)` 실행. 예측을 `{claude-code, codex, unknown, non-candidate(null)}` 분류로 본다. concrete type `T∈{claude-code,codex}`별 혼동 집계:
  - `TP_T` = 예측 T ∧ gold T
  - `FP_T` = 예측 T ∧ gold ≠ T (비-agent를 T로 오탐 포함 → over-detection 페널티)
  - `FN_T` = gold T ∧ 예측 ≠ T (`unknown`/null/타 type)
- **Formula**: `precision_T = TP_T/(TP_T+FP_T)`, `recall_T = TP_T/(TP_T+FN_T)`. 집계는 micro-average: `precision = ΣTP_T/Σ(TP_T+FP_T)`, `recall = ΣTP_T/Σ(TP_T+FN_T)`. per-type과 집계를 모두 보고.
- **Pass**: 집계 `precision ≥ 0.9`(가설). recall은 보고·검토(14-MVP는 precision 가설만 고정). `unknown`을 concrete로 단정한 over-detection이 precision을 낮추도록 설계됨(R-ORC-002 정신).

**M2 — status accuracy / `waiting` recall** (지표: status 정확도, [[14-MVP-PoC-Scope]] `waiting` recall ≥ 0.7)
- **Input**: `LABELED-STATUS`(가능하면 `prior` 포함). gold `status`/`waiting`.
- **Method**: 샘플마다 `inferStatus(input)` 실행(prior 있으면 차분 모드). 예측 status와 gold 비교.
- **Formula**:
  - `accuracy = #(예측==gold)/N`.
  - `waiting_recall = #(gold.waiting ∧ 예측=="waiting") / #(gold.waiting)`.
  - `waiting_precision = #(gold.waiting ∧ 예측 waiting) / #(예측 waiting)` (보고).
- **Pass**: `waiting_recall ≥ 0.7`(가설). overall accuracy·waiting precision은 보고·검토. prior 의존 status(`active`·`waiting` 정적 transition·사라짐 기반 `terminated`)는 prior 있는 부분집합으로만 평가하고, 단발 샘플은 저하 규칙대로 채점한다(§3.2-2).
- **live cycle 측정(확정, [[08-Decisions|D-014]])**: 위 prior 의존 부분집합의 **REAL-PANE** accuracy/`waiting` transition recall은 합성 prior fixture에만 의존하지 않고 `--watch` 모드의 **cycle-to-cycle prior**로 실 pane에서도 산출한다(`TC-E-WATCH`, e2e job). live cycle 측정은 latency 가설과 함께 e2e job 소유이며 CI 게이트와 분리된다(§3.1-2). 합성 prior fixture 평가는 CI 게이트로 유지해 결정성을 보장한다.

**M3 — confidence calibration 단조성** (지표: confidence calibration, [[14-MVP-PoC-Scope]] 단조 증가). **agentTypeConfidence·statusConfidence 둘 다** 측정.
- **Input**: M1/M2와 동일 데이터셋의 예측 + confidence.
- **"monotonic" 운영 정의**: confidence를 소유 spec의 band로 버킷한다 — agentType은 [[SPEC-003-agent-detection]] §3.2 band(LOW ≤0.50 / MEDIUM 0.55–0.85 / HIGH 0.90–0.99), status는 [[SPEC-004-status-inference]] §2.3 band(LOW 0.00–0.49 / MEDIUM 0.50–0.79 / HIGH 0.80–1.00). 각 band의 **경험적 정답률** `acc(band) = #(band 내 정답)/#(band 내 표본)`.
  - 정답 정의: agentType은 `예측 agentType == gold.agentType`, status는 `예측 status == gold.status`.
  - 최소 버킷 크기 `n_min`(가설 10) 미만 band는 "표본 부족"으로 표시하고 단조 판정에서 제외.
- **Formula/Pass**: 표본 충분한 band를 confidence 오름차순으로 정렬했을 때 `acc`가 **비감소(non-decreasing)** = `acc(HIGH) ≥ acc(MEDIUM) ≥ acc(LOW)`. 두 confidence 모두 만족해야 통과(가설). calibration 표(band·n·acc)를 산출물로 남긴다. 위반 band는 해당 spec의 base/cap/bonus 보정 신호다([[SPEC-003-agent-detection]] §6, [[SPEC-004-status-inference]] §3.8).

**M4 — scan latency p50/p95** (지표: scan latency, [[14-MVP-PoC-Scope]] 20 pane p95 < 1s)
- **Input**: 실제 tmux에 **≥ 20 pane**(혼합 agent/비-agent) 구성. (live 필요 → e2e `TC-E-LATENCY`/`TC-M-LATENCY`.)
- **Method(확정, [[08-Decisions|D-014]])**: 실제 repeated 경로인 `orc-camp scan --watch <interval>`을 실행해 **≥ R cycle**(가설 R=30)을 돌리고, 각 cycle의 `diagnostics.scanDurationMs`(또는 wall-clock)를 수집한다 — cycle-to-cycle prior(직전 snapshot 비교)를 포함한 실 watch cycle latency. warm-up cycle 1~2 제외. (단발 1회 latency는 보조 baseline으로만 보고; 가설 판정은 watch cycle 분포로 한다.)
- **Formula**: 정렬된 표본 `d[1..R]`에서 nearest-rank — `p50 = d[⌈0.50R⌉]`, `p95 = d[⌈0.95R⌉]`.
- **Pass**: `p95 < 1000ms`(가설). p50 보고. **CI 보조(비-게이트)**: integration에서 pane 수를 늘린 mock으로 알고리즘 스케일링(예: spawn 수가 O(pane) 유지, O(pane²) 회귀 없음)을 결정적으로 점검하되, 실제 latency 가설 판정은 e2e job이 소유한다.

**M5 — false-redaction rate(+ secret-recall)** (지표: false redaction, [[14-MVP-PoC-Scope]] 수동 검토 허용)
- **Input**: `CORPUS-SECRET`(가려야 할 secret placeholder), `CORPUS-KEEP`(가리면 안 되는 의미 텍스트: 경로/hash/UUID/agent banner 토큰).
- **Method**: 각 샘플에 `redact()` 적용.
- **Formula**:
  - `secret_recall = #(secret placeholder literal이 산출에서 완전 부재) / #(CORPUS-SECRET)`.
  - `false_redaction_rate = #(CORPUS-KEEP 중 redaction 매칭이 발생한 샘플) / #(CORPUS-KEEP)`.
- **Pass**: `secret_recall == 1.0`(known secret 전부 마스킹, 확정 목표) 그리고 `false_redaction_rate ≤ τ`(가설 초기값 0.05, 수동 검토로 허용 가능 — [[14-MVP-PoC-Scope]]). banner 토큰이 가려지면 detection coherence(`TC-M-BANNER`)와 함께 RP-10 보정([[SPEC-006-privacy-redaction]] §3.5, Q1).

### 3.4 privacy 검증 접근(모든 출력 경로)

- **planted secret 마스킹(모든 경로·모든 콘텐츠 소스)**: `CAP-SECRETS`(capture)와 `PROC-SECRET`(`cmdline` argv token·`cwd` 민감 구간)로 구동한 scan에서 placeholder secret literal이 **table stdout · `--json` stdout · preview(text 노출 모드) · debug log** 어디에도 부분문자열로 등장하지 않아야 한다(`TC-I-SECRET-ALLPATHS`). preview는 redacted tail 모드까지 포함해 검사한다([[SPEC-006-privacy-redaction]] §2.4). `cmdline`은 capture와 동일하게 redaction 경계를 통과하며([[SPEC-002-tmux-discovery]] §2.8, [[08-Decisions|D-020]]), `cwd` 마스킹 정책·AC는 [[SPEC-006-privacy-redaction]]가 소유한다(§6 Q3) — SPEC-007은 `TC-U-RED-CMDLINE`/`CORPUS-CWD`로 백킹한다.
- **summary 우회 차단(T-03)**: 유일 secret이 summary 후보 줄에 있어도 `currentWorkSummary`에 literal이 없어야 한다(redaction-before-consumption, [[SPEC-006-privacy-redaction]] AC-07). measurement harness가 sanitize→infer 순서를 강제하므로 동일 경로로 검증된다.
- **비저장(T-08)**: 전체 scan 1회 동안 fs write를 spy해 capture 텍스트(raw/redacted)를 담은 파일이 생성되지 않음을 확인(`TC-I-NONPERSIST`, [[SPEC-006-privacy-redaction]] AC-10). debug log는 metadata-only임을 함께 검사([[SPEC-006-privacy-redaction]] AC-11).
- **error message 격리(T-04)**: capture 실패 pane의 secret이 `diagnostics.tmuxErrors[].message`로 새지 않음(`TC-I-DIAG-PRIVACY`).

### 3.5 read-only 강제 검증(확정)

- **단위(거부)**: `tmuxExec`에 비-allowlist subcommand(`send-keys`/`paste-buffer`/`kill-*` 등)를 주면 throw하고 **process를 spawn하지 않는다**(`TC-U-RED-EXEC`, [[SPEC-006-privacy-redaction]] AC-12(a)).
- **통합(관측)**: 어떤 fixture 상태에서든 전체 scan 1회를 돌린 뒤 spawn 기록부의 **tmux** subcommand가 `{list-sessions, list-windows, list-panes, capture-pane}` ∪ `-V` probe뿐임을 단언한다(`TC-I-READONLY`, [[SPEC-002-tmux-discovery]] AC-13 / [[SPEC-006-privacy-redaction]] AC-12(b)). 상태변경 subcommand가 **한 번도** 나타나지 않음을 negative로 검증.
- **non-tmux subprocess(관측, [[08-Decisions|D-020]])**: process introspection은 tmux allowlist **밖의 별도 subprocess**(`pane_pid → ps` 등)이지만 읽기 전용이며 동등 안전 계약을 따른다. 전체 scan 중 spawn된 비-tmux argv가 **고정 argv·`shell:false`·per-call timeout**을 가지고 어떤 상태변경 명령도 포함하지 않음을 단언한다(`TC-I-PROC-READONLY`, [[SPEC-002-tmux-discovery]] AC-17 / [[SPEC-006-privacy-redaction]] §2.6 subprocess-safety). 즉 read-only negative 검증은 **tmux allowlist ∪ `-V` + 안전 계약을 만족하는 process-introspection subprocess** 합집합을 기준으로 한다.
- **e2e(실증)**: 실 tmux에서 scan 전후 session/window/pane 구성이 불변임을 확인(`TC-E-READONLY`).

### 3.6 비저장·timeout bounded exposure(확정)

- timeout 초과 시 자식 process가 종료돼 capture 버퍼가 무한 보유되지 않고 scan이 예외 없이 반환됨을 fake timer로 검증(`TC-I-TIMEOUT`, [[SPEC-006-privacy-redaction]] AC-14, [[SPEC-002-tmux-discovery]] AC-04).

## 4. Acceptance criteria

> 각 항목은 측정 하니스/테스트 의무를 검증 가능한 문장으로 둔다. 임계값은 §3.3 가설을 따른다. 출처 `R-*`/PoC 지표를 괄호로 표기한다.

- **SPEC-007-AC-01** (R-ORC-001, R-ORC-002, R-ORC-007 / PoC agent precision)
  - Given `LABELED-DETECT` fixture 데이터셋이 주어졌을 때
  - When live tmux 없이 각 샘플의 redacted `PaneSignal`에 `detectOrc`를 적용해 M1 절차로 precision/recall을 계산하면
  - Then 집계 precision이 산출·보고되고, CI에서 재현되며(머신 tmux 불필요), precision ≥ 0.9(프로젝트 가설) 충족 여부가 판정된다.

- **SPEC-007-AC-02** (R-ORC-003, R-ORC-004, R-ORC-005 / PoC status·waiting)
  - Given `LABELED-STATUS` 데이터셋(필요 시 `prior` 포함)과, prior 의존 신호용 `--watch` cycle-to-cycle 데이터([[08-Decisions|D-014]])에서
  - When 각 샘플에 `inferStatus`를 적용해 M2 절차로 accuracy와 `waiting` recall을 계산하면(prior 의존 `active`/transition/사라짐-`terminated`는 합성 prior fixture와 `--watch` live cycle 양쪽으로 평가)
  - Then `waiting` recall이 산출되고 ≥ 0.7(가설) 여부가 판정되며, overall accuracy·waiting precision이 함께 보고되고, prior 의존 신호의 live cycle 측정은 e2e job 소유로 CI 게이트(합성 prior fixture 평가)와 분리된다.

- **SPEC-007-AC-03** (R-ORC-005 / PoC confidence calibration)
  - Given M1/M2 예측과 confidence가 있을 때
  - When `agentTypeConfidence`와 `statusConfidence`를 각 소유 spec의 band로 버킷해 band별 경험적 정답률을 M3 절차로 계산하면
  - Then 두 confidence 모두에 대해 표본 충분 band의 정답률이 confidence 오름차순으로 비감소(monotonic)인지 판정되고, calibration 표(band·n·acc)가 산출된다.

- **SPEC-007-AC-04** (R-PRIV-003 / PoC false redaction)
  - Given `CORPUS-SECRET`와 `CORPUS-KEEP` 라벨 코퍼스에서
  - When `redact()`를 적용해 M5 절차로 측정하면
  - Then secret-recall == 1.0(모든 known secret 마스킹)이고 false-redaction-rate가 산출돼 ≤ τ(가설) 여부가 판정된다.

- **SPEC-007-AC-05** (R-CLI-004 비기능/Scan latency / PoC latency)
  - Given 실제 tmux에 ≥ 20 pane이 있을 때
  - When `orc-camp scan --watch <interval>`로 R cycle을 돌려 M4 절차로 cycle별 `scanDurationMs`의 p50/p95를 계산하면([[08-Decisions|D-014]] 실 repeated 경로)
  - Then p95 < 1s(가설) 여부가 판정되고 p50이 보고되며, 이 측정은 e2e job 소유로 CI 게이트와 분리된다.

- **SPEC-007-AC-06** (R-PRIV-001, R-PRIV-002, R-PRIV-003, R-PRIV-005, R-OBS-003)
  - Given `CAP-SECRETS`(planted placeholder secret) fixture로 scan을 구동할 때
  - When table stdout · `--json` stdout · preview(text 모드) · debug log를 검사하면
  - Then 어떤 secret placeholder literal도 네 경로 어디에도 부분문자열로 나타나지 않는다(every output path 마스킹).

- **SPEC-007-AC-07** (R-PRIV-004)
  - Given 전체 scan 1회 실행 동안 fs write를 spy할 때
  - When 생성된 파일을 검사하면
  - Then capture 텍스트(raw/redacted)를 담은 파일이 생성되지 않고, debug log는 metadata-only다.

- **SPEC-007-AC-08** (R-TMUX-001 enforcement, R-TMUX-004 safety; process-introspection 안전 [[08-Decisions|D-020]])
  - Given `tmuxExec`와 fixture 구동 scan에서
  - When 비-allowlist subcommand 호출과 전체 scan의 spawn argv(tmux + non-tmux)를 관측하면
  - Then 비-allowlist tmux 호출은 spawn 없이 거부되고, 전체 scan이 spawn한 **tmux** subcommand는 read-only allowlist ∪ `-V`뿐이며, **non-tmux process-introspection subprocess(`ps` 등)**는 읽기 전용·고정 argv·`shell:false`·per-call timeout 안전 계약을 만족하고([[SPEC-002-tmux-discovery]] AC-17, [[SPEC-006-privacy-redaction]] §2.6), 어떤 경로로도 상태변경 명령은 한 번도 spawn되지 않는다.

- **SPEC-007-AC-09** (R-CLI-004, R-ORC-003)
  - Given 고정 inventory/capture fixture에서
  - When integration scan을 주입 clock으로 2회 실행해 `--json`을 비교하면
  - Then 두 출력이 byte 단위로 동일하다(결정성 — live tmux 없이 [[SPEC-005-data-contract]]/[[SPEC-001-scan-cli]] 결정성 재현).

- **SPEC-007-AC-10** (R-CLI-004 / 결정적 경계)
  - Given CI 환경(머신에 tmux server·session 없음 가정)에서
  - When unit + integration + fixture 기반 measurement 스위트를 실행하면
  - Then 전 스위트가 live tmux server·머신 tmux 상태 의존 없이 끝까지 실행·판정되고, live tmux 의존은 e2e/latency job으로 격리된다.

- **SPEC-007-AC-11** (메타 / 추적성 — SPEC-000-AC-03 통합)
  - Given §5 통합 매트릭스에서
  - When 1차 슬라이스 in-scope `R-*`를 검사하면
  - Then 모든 in-scope `R-*`가 ≥1 sibling AC와 ≥1 테스트 케이스에 매핑되며, 매핑 없는 `R-*`는 P0 GAP 행으로 명시된다(누락 = 게이트 실패).

- **SPEC-007-AC-12** (메타 / 14-MVP 수용 기준)
  - Given [[14-MVP-PoC-Scope]] "검증 시나리오와 수용 기준" 체크박스에서
  - When §5.2 매핑을 검사하면
  - Then 각 체크박스가 ≥1 테스트 케이스에 매핑된다.

- **SPEC-007-AC-13** (메타 / fixture 완결성)
  - Given §2.3 fixture 카탈로그에서
  - When sibling spec의 detection/status/redaction/schema/inventory AC를 검사하면
  - Then 각 AC가 최소 1개 fixture로 백킹되고, 카탈로그의 필수 상태(빈 상태 4종·capture 실패·planted secret·noise/static prompt·traceback·dead pane·stale 등)가 모두 존재한다.

## 5. Traceability

> 본 spec은 1차 소유 product `R-*`가 없다(검증·측정·통합 지점). 아래는 **슬라이스 전체 통합 매트릭스**다. AC ID는 sibling spec에서 그대로 인용했다.

### 5.1 통합 수용·추적 매트릭스 (R-* → SPEC → AC → 테스트)

| 요구사항 | 다루는 SPEC | 검증 AC (sibling) | 테스트 케이스 / 계층 |
| --- | --- | --- | --- |
| **R-CLI-004** | [[SPEC-001-scan-cli]], [[SPEC-005-data-contract]] | SPEC-001-AC-01,02,03,04,05,06,07,08,13,14,16; SPEC-005-AC-01,02,10,11,13 | `TC-I-SCAN-NORMAL`, `TC-I-JSON-HYGIENE`, `TC-I-EMPTY`, `TC-I-CAPFAIL`, `TC-I-NOURL`, `TC-U-CLI-EXIT`, `TC-U-SCHEMA-VALID/DET` (U,I) |
| **R-TMUX-001** | [[SPEC-002-tmux-discovery]] (set), [[SPEC-006-privacy-redaction]] (enforcement) | SPEC-002-AC-01,13,14,17; SPEC-006-AC-12 | `TC-U-INV-PARSE`, `TC-I-READONLY`, `TC-I-CAPTURE-FORM`, `TC-I-PROC-READONLY`, `TC-U-RED-EXEC`, `TC-E-READONLY` (U,I,E) |
| **R-TMUX-002** | [[SPEC-002-tmux-discovery]] | SPEC-002-AC-02,03 | `TC-U-INV-PARSE` (U) |
| **R-TMUX-004** | [[SPEC-002-tmux-discovery]], [[SPEC-006-privacy-redaction]], [[SPEC-001-scan-cli]] | SPEC-002-AC-04,05,06,07,16; SPEC-006-AC-13,14; SPEC-001-AC-05 | `TC-I-TIMEOUT`, `TC-I-CAPFAIL`, `TC-I-INVFAIL`, `TC-I-PROC-ISOLATE`, `TC-I-DIAG-PRIVACY` (I) |
| **R-TMUX-005** | [[SPEC-002-tmux-discovery]], [[SPEC-005-data-contract]], [[SPEC-004-status-inference]] | SPEC-002-AC-11,12; SPEC-005-AC-07; SPEC-004-AC-10 | `TC-U-INV-STALE`, `TC-U-SCHEMA-STALE`, `TC-U-STAT-STALE`, `TC-I-INVFAIL` (U,I) |
| **R-TMUX-006** | [[SPEC-002-tmux-discovery]], [[SPEC-005-data-contract]], [[SPEC-001-scan-cli]] | SPEC-002-AC-08,09,10; SPEC-005-AC-05,06; SPEC-001-AC-03,13 | `TC-U-INV-EMPTY`, `TC-U-SCHEMA-EMPTY`, `TC-I-EMPTY` (U,I) |
| **R-ORC-001** | [[SPEC-003-agent-detection]], [[SPEC-002-tmux-discovery]] (Tier B `cmdline` 수집 [[08-Decisions\|D-020]]) | SPEC-003-AC-01,02,03,06,09; SPEC-002-AC-15 | `TC-U-DET-CMD/WRAP/OUTCAP/CORROB`, `TC-I-PROC-CMDLINE`, `TC-M-PRECISION`, `TC-E-AGENT` (U,I,M,E) |
| **R-ORC-002** | [[SPEC-003-agent-detection]] | SPEC-003-AC-04,05,06,08 | `TC-U-DET-UNKNOWN/NONCAND/OUTCAP/CONFLICT`, `TC-M-PRECISION` (U,M) |
| **R-ORC-003** | [[SPEC-004-status-inference]], [[SPEC-005-data-contract]], [[SPEC-001-scan-cli]] | SPEC-004-AC-01,03,05,07,08,15; SPEC-005-AC-03,04,12; SPEC-001-AC-08,11 | `TC-U-STAT-*`, `TC-U-SCHEMA-VALID/ID/AGG`, `TC-M-STATUS` (U,M) |
| **R-ORC-004** | [[SPEC-004-status-inference]], [[SPEC-005-data-contract]] | SPEC-004-AC-11,13; SPEC-005-AC-09 | `TC-U-STAT-SRC/REDSUM`, `TC-U-SCHEMA-EST` (U) |
| **R-ORC-005** | [[SPEC-004-status-inference]], [[SPEC-005-data-contract]], [[SPEC-001-scan-cli]] | SPEC-004-AC-02,04,06,12,14; SPEC-005-AC-08,14; SPEC-001-AC-09,10,11 | `TC-U-STAT-UNKNOWN/NOISE/WAIT-NEG/EST`, `TC-U-SCHEMA-EST/SIG`, `TC-U-CLI-TABLE`, `TC-M-CALIB-TYPE/STATUS` (U,M) |
| **R-ORC-006** | [[SPEC-004-status-inference]] | SPEC-004-AC-09,10 | `TC-U-STAT-TERM/STALE` (U) |
| **R-ORC-007** | [[SPEC-003-agent-detection]] | SPEC-003-AC-07,08 | `TC-U-DET-EXT/CONFLICT` (U) |
| **R-PRIV-001** | [[SPEC-006-privacy-redaction]] | SPEC-006-AC-08,09 | `TC-U-RED-LIMITS` (U) |
| **R-PRIV-002** | [[SPEC-006-privacy-redaction]], [[SPEC-001-scan-cli]] | SPEC-006-AC-01,06,07 + cmdline/cwd-redaction AC(SPEC-006 소유); SPEC-001-AC-12 | `TC-U-RED-PATTERNS`, `TC-U-RED-CMDLINE`, `TC-I-SECRET-ALLPATHS` (U,I) |
| **R-PRIV-003** | [[SPEC-006-privacy-redaction]], [[SPEC-001-scan-cli]] | SPEC-006-AC-01~05,15 + cmdline/cwd-redaction AC(SPEC-006 소유); SPEC-001-AC-12 | `TC-U-RED-PATTERNS`, `TC-U-RED-CMDLINE`, `TC-M-FALSERED`, `TC-I-SECRET-ALLPATHS` (U,I,M) |
| **R-PRIV-004** | [[SPEC-006-privacy-redaction]] | SPEC-006-AC-10 | `TC-I-NONPERSIST` (I) |
| **R-PRIV-005** | [[SPEC-006-privacy-redaction]] | SPEC-006-AC-11 | `TC-I-SECRET-ALLPATHS`(log 경로) (I) |
| R-PRIV-006 | [[SPEC-001-scan-cli]] (preview-toggle 부재 negative) | SPEC-001-AC-15 (parse-only/negative) | `TC-U-CLI-PREVIEWFLAG` (U) — **DEFERRED-BY-DECISION ([[08-Decisions\|D-021]]), §5.4** |
| **R-OBS-003** | [[SPEC-006-privacy-redaction]] | SPEC-006-AC-11,13 | `TC-I-SECRET-ALLPATHS`, `TC-I-DIAG-PRIVACY` (I) |
| **R-UI-007** | [[SPEC-005-data-contract]] (table TARGET) | SPEC-005-AC-02,03 | `TC-I-SCAN-NORMAL`, `TC-U-SCHEMA-VALID` (U,I) — table 표면 한정 |
| R-CLI-002 | — (scan 범위 아님; `serve` 슬라이스) | SPEC-001-AC-14 (negative) | `TC-I-NOURL` (I) — **§5.4 NOT-IN-SCOPE** |
| R-TMUX-003 | — (serve/dashboard 슬라이스 소유; scan-MVP 아님) | — (sibling AC 없음; `--watch` 재-scan이 현재 inventory 반영) | `TC-I-WATCH`, `TC-E-WATCH` (부분) — **§5.4 PRE-FLAG(의도된 사전 표기, GAP 아님)** |

### 5.2 14-MVP 수용 체크박스 → 테스트 케이스

| [[14-MVP-PoC-Scope]] 수용 기준 | 테스트 케이스 |
| --- | --- |
| macOS+tmux에서 session/window/pane inventory 출력 | `TC-E-SMOKE`, `TC-I-SCAN-NORMAL`, `TC-U-INV-PARSE` |
| 미설치/session 없음/agent 없음 빈 상태 구분 | `TC-I-EMPTY`, `TC-U-INV-EMPTY`, `TC-U-SCHEMA-EMPTY` |
| Claude Code/Codex 올바른 agentType 분류 | `TC-U-DET-CMD`, `TC-M-PRECISION`, `TC-E-AGENT` |
| 확정 불가 후보 `unknown` + 낮은 confidence | `TC-U-DET-UNKNOWN` |
| 모든 orc가 status+confidence+summary+source | `TC-U-STAT-SHAPE`, `TC-U-SCHEMA-VALID` |
| preview/출력 redaction + 원문 비저장 | `TC-I-SECRET-ALLPATHS`, `TC-I-NONPERSIST` |
| pane tmux 오류가 전체 scan 미중단 + diagnostics 기록 | `TC-I-CAPFAIL`, `TC-I-INVFAIL` |
| scan이 timeout 없이 장시간 block 안 됨 | `TC-I-TIMEOUT`, `TC-M-LATENCY` |

### 5.3 PoC 지표 → 측정 절차/테스트

| [[14-MVP-PoC-Scope]] 지표 | 1차 기준(가설) | 절차 | 테스트 |
| --- | --- | --- | --- |
| agent detection precision | ≥ 0.9 | §3.3 M1 | `TC-M-PRECISION` (SPEC-007-AC-01) |
| status 정확도(`waiting` recall) | ≥ 0.7 | §3.3 M2 | `TC-M-STATUS` (SPEC-007-AC-02, SPEC-004-AC-14) |
| confidence calibration(type+status) | 단조 증가 | §3.3 M3 | `TC-M-CALIB-TYPE`, `TC-M-CALIB-STATUS` (SPEC-007-AC-03) |
| scan latency | 20 pane p95 < 1s | §3.3 M4 | `TC-M-LATENCY` (SPEC-007-AC-05) |
| false redaction | 수동 검토 허용(τ 가설) | §3.3 M5 | `TC-M-FALSERED` (SPEC-007-AC-04, SPEC-006-AC-15) |

### 5.4 커버리지 결과와 P0 GAP

**완전 커버(in-scope P0 R-*)**: R-CLI-004, R-TMUX-001/002/004/005/006, R-ORC-001/002/003/004/005/006/007, R-PRIV-001/002/003/004/005, R-OBS-003 — 모두 ≥1 sibling AC + ≥1 테스트 케이스로 매핑됨. **무커버(zero-coverage) P0 GAP 없음(재확인, post-gate).** 신규 [[SPEC-002-tmux-discovery]] process-introspection AC(SPEC-002-AC-15/16/17, [[08-Decisions|D-020]])는 각각 R-ORC-001(cmdline→Tier B), R-TMUX-004(ps 실패 격리), R-TMUX-001(non-tmux subprocess read-only 안전) 행에 흡수돼 추가 커버를 보강한다.

다만 아래는 명시적으로 surface한다(silent 금지):

- **DEFERRED-BY-DECISION — R-PRIV-006 ([[08-Decisions|D-021]])**: scan-MVP는 preview를 **metadata-only**(`{lines, truncated, redacted}`, text 미렌더)로 제공하므로 "preview 노출 여부·line count 조정" 대상 자체가 scan 슬라이스에 **없다**. [[08-Decisions|D-021]]에 따라 `--no-preview`/`--preview-lines`는 **reserved(비활성)**이고 SPEC-001-AC-15는 **parse-only/negative**(preview text 미렌더·toggle 동작 부재) 기준이다. 따라서 R-PRIV-006은 **결정에 의해 후속 preview-rendering 슬라이스로 명시 이연**된 것이지 scan 슬라이스의 **커버리지 GAP이 아니다**(zero-coverage 아님, WATCH 아님). 행위 AC는 preview text를 렌더하는 후속 슬라이스가 소유한다.
- **OUT-OF-SCOPE — R-CLI-002 (RESOLVED)**: [[README]] specs index의 SPEC-001 mislabel("R-CLI-002(부분)")은 index에서 정정 완료됐고(SPEC-001을 R-CLI-004로 표기), 같은 index 노트가 SPEC-006의 `R-TMUX-001`을 **read-only 강제 wrapper 공동 소유분**(command-set 정의는 SPEC-002)으로 명확화했다. R-CLI-002(browser open 실패 시 dashboard URL stdout)는 `serve` 슬라이스 소유이며 read-only stdout-only `scan`에는 적용되지 않는다([[SPEC-001-scan-cli]] §6 C1 RESOLVED). 본 매트릭스는 scan에 URL 표면이 없음을 negative(SPEC-001-AC-14)로 검증한다. **잔여 조치 없음.**
- **PRE-FLAG — R-TMUX-003 (GAP 아님, 의도된 사전 표기)**: R-TMUX-003(tmux session/window/pane 생성·삭제·rename·종료가 dashboard에 반영)은 **serve/dashboard 슬라이스 소유**이며 scan-MVP 범위가 아니다(sibling AC 없음). 다만 scan은 `--watch` 재-scan이 **현재 inventory를 다시 반영**하므로(새 scan = 현재 시점 inventory) **PARTIALLY 충족**한다(`TC-I-WATCH`/`TC-E-WATCH`가 cycle별 현재 inventory 반영을 관측). scan-MVP가 소유하지 않는 요구사항을 silent 누락하지 않도록 **의도된 pre-flag**로 표기하며, 실시간 mutation 반영(event-driven)은 후속 슬라이스가 소유한다. **scan-MVP의 P0 GAP이 아니다.**
- **R-UI-007(부분 표면)**: scan 슬라이스는 table TARGET 컬럼이 raw `tmuxTarget`을 항상 노출(SPEC-005-AC-02/03)하는 범위에서 충족한다. inspector 등 dashboard UI 표면은 Slice 2~3 소유(본 슬라이스 GAP 아님).
- **측정 의존성(갱신, [[08-Decisions|D-014]])**: prior 의존 status(`active`, status transition, 사라짐 기반 `terminated`)의 정확도/calibration은 (a) `prior`를 동봉한 합성 fixture/라벨 샘플(결정적 CI 게이트)과 (b) [[08-Decisions|D-014]]가 확정한 `--watch` cycle-to-cycle prior 기반 **live pane 측정**(`TC-E-WATCH`, e2e job) 양쪽으로 측정된다. 즉 종전의 "fixture 동봉 prior에만 의존" 제한은 D-014로 해소돼, live cycle 데이터에서도 검증된다. latency 가설(M4)도 `--watch` cycle 분포로 e2e job이 소유하며 CI 게이트가 아니다(§3.1-2).

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진/index 보정 — orchestrator 조정)

- **C1 — 14-MVP 예시 JSON과 [[SPEC-005-data-contract]] 정합**: measurement/integration의 schema validate 대상은 [[SPEC-005-data-contract]](7키 statusSummary·`stale`/`lastGoodAt`·`summaryIsEstimated`·`agentSignals`/`statusSignals`·안정 camp id)다. [[14-MVP-PoC-Scope]] 예시 JSON은 이를 아직 반영하지 않았다(SPEC-005 C1~C6). 테스트는 SPEC-005를 SSOT로 따른다. 14-MVP 예시 보정은 orchestrator가 반영.
- **C2 — `--watch` 결정 의존 (RESOLVED, [[08-Decisions|D-014]])**: `active`/status transition/사라짐 `terminated`의 정확도·calibration·latency(반복 cycle) 측정이 `--watch` 채택과 prior 보관 정책에 의존하던 부분은 **[[08-Decisions|D-014]](기본 single-shot + `--watch` opt-in)로 확정**됐다. 이에 따라 본 spec의 측정 절차를 갱신했다: prior 의존 신호는 합성 prior fixture(결정적 CI 게이트)와 `--watch` cycle-to-cycle prior 기반 **live pane 측정**(`TC-E-WATCH`/`TC-M-LATENCY`, e2e job, §3.2-2·§3.3 M2/M4) 양쪽으로 측정한다. last-good/prior 보관은 [[SPEC-002-tmux-discovery]] §2.7, prior 해석은 [[SPEC-004-status-inference]] §2.1이 소유한다. **잔여 조치 없음.**
- **C3 — banner vs redaction coherence**: RP-10 generic redaction이 [[SPEC-003-agent-detection]] G-OUT banner 토큰을 가리면 detection recall과 false-redaction이 동시에 영향받는다([[SPEC-006-privacy-redaction]] C4, SPEC-003 §6 Q). `TC-M-BANNER`가 두 spec 공동 검증을 소유한다.

### Open Questions (검토 필요 / PoC 운영)

- **Q1 — 라벨 데이터셋 규모·다양성**: §2.4 최소 규모(type ≥50, status ≥50, waiting gold ≥15)와 환경 다양성(설치 방식별 Tier A/B 분포, [[SPEC-003-agent-detection]] §6)이 지표를 통계적으로 신뢰 가능하게 하는지. 표본 부족 시 calibration band 판정 제외 규칙(§3.3 M3)의 `n_min` 보정. **검토 필요.**
- **Q2 — calibration band 경계 출처**: agentTypeConfidence([[SPEC-003-agent-detection]] §3.2)와 statusConfidence([[SPEC-004-status-inference]] §2.3) band 경계가 서로 다르다. 본 spec은 각 소유 spec band를 그대로 쓴다. 측정 후 band 경계 자체를 재보정하면 두 spec과 본 §3.3을 함께 갱신.
- **Q3 — false-redaction 임계 τ**: 초기 가설 0.05는 14-MVP "수동 검토로 허용 가능"을 수치화한 것이다. 의미 텍스트 손실의 사용성 영향으로 τ를 조정([[SPEC-006-privacy-redaction]] §3.5). **검토 필요.**
- **Q4 — latency 측정 환경 표준화**: p95 < 1s 판정의 머신/부하 기준(pane 구성, agent 실행 여부, 동시 부하)을 어떻게 표준화해 재현 가능하게 둘지. CI 보조 스케일링 점검(O(pane))과 e2e 실측의 역할 분담 확정. **검토 필요.**
- **Q5 — e2e 자동화 vs 수동 라벨**: `TC-E-AGENT`가 라벨 소스를 겸하면 라벨 편향이 생길 수 있다. 라벨링 주체(사람)와 측정 실행(자동)을 분리해 [[07-Roadmap]] "사람이 출력만 보고 waiting 판정" 비교 실험과 정합화. **검토 필요.**
- **Q6 — ReDoS 안전성 측정**: redaction 정규식의 적대적 입력 내성([[SPEC-006-privacy-redaction]] T-10/Q4)을 측정 하니스에 포함할지(입력은 `BYTE_CAP`으로 bound). 별도 fuzz 케이스 추가 검토.
