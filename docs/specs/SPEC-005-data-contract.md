---
spec: SPEC-005
title: scan 출력 데이터 계약
status: approved
updated: 2026-06-28
requirements: [R-CLI-004, R-TMUX-005, R-TMUX-006, R-ORC-003, R-ORC-004, R-ORC-005]
decisions: [D-002, D-012, D-017, D-018]
tags:
  - specs
  - data-contract
  - schema
  - scan
  - backend
---

# SPEC-005 — scan 출력 데이터 계약

`orc-camp scan` 슬라이스([[14-MVP-PoC-Scope]], [[08-Decisions]] D-012)가 **stdout으로 내보내는 출력 데이터의 계약(aggregator)**을 고정한다. 이 spec은 상류 spec이 산출한 결과를 **직렬화(serialize)·조립(assemble)**하는 단일 진실 공급원이다:

- [[SPEC-002-tmux-discovery]]: pane raw inventory + `diagnostics.tmuxErrors` 의미 + staleness 의미 상태.
- [[SPEC-003-agent-detection]]: `agentType` / `agentTypeConfidence` (+ type 신호 provenance).
- [[SPEC-004-status-inference]]: `status` / `statusConfidence` / `currentWorkSummary` / `summarySource` / `summaryIsEstimated` (+ status 신호 provenance).
- [[SPEC-006-privacy-redaction]]: `preview`는 redacted tail만, 원문 비직렬화 불변식.

> **소유 경계**: 본 spec은 **데이터(shape·필드·타입·nullability·enum)**를 소유한다. CLI flag·exit code·stdout/stderr 분리·`--watch`·estimated glyph 렌더링은 [[SPEC-001-scan-cli]] 소유다. 탐지/추론 **규칙**은 본 spec이 만들지 않고 결과만 직렬화한다.

> **불변식(확정)**: ① 모든 출력은 `schemaVersion = 1`을 갖는다. ② orc identity는 `paneId`에서 파생한다(`tmuxTarget`은 표시 전용 — [[SPEC-002-tmux-discovery]] C2). ③ capture 원문은 어떤 필드에도 직렬화되지 않는다(`preview`는 redacted tail/메타데이터뿐 — [[SPEC-006-privacy-redaction]] §2.4, §3.1). ④ 추정값은 `summaryIsEstimated`로 표시하고, `status`는 항상 `statusConfidence`와 함께 직렬화한다(사실 단정 금지 — R-ORC-005).

## 1. Scope

### In scope

- `orc-camp scan --json`의 **최상위 envelope**: `schemaVersion`, `scannedAt`, `stale`, `lastGoodAt`, `tmux`, `statusSummary`, `camps[]`, `diagnostics`(R-CLI-004).
- `Camp`(= tmux session, [[08-Decisions]] D-002)와 `Orc`(= 탐지된 agent pane) 객체의 전체 필드·타입·nullability·enum과 **출처 spec**.
- staleness 직렬화: 최상위 `stale` / `lastGoodAt`([[SPEC-002-tmux-discovery]] §2.7, R-TMUX-005, C1 해소).
- 빈 상태 3종(+ "agent 없음") 직렬화 인코딩(R-TMUX-006).
- camp 단위 집계 규칙(`windowCount`/`paneCount`/`orcCount`/`statusSummary`/`lastActivityAt` rollup)과 정렬 결정성.
- `preview` shape(메타데이터 + 선택적 redacted tail) 및 `diagnostics.tmuxErrors[]` 직렬화 envelope.
- 사람이 읽는 **table 컬럼 집합·의미·순서**(어떤 필드를 어떤 컬럼에 두는지). 정확한 glyph/스타일/색은 [[SPEC-001-scan-cli]].

### Out of scope (다른 spec으로)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| CLI flag(`--json`/`--no-preview`/`--watch`), exit code, stdout/stderr 분리, glyph(`~`/`(est)`) | 명령 표면 | [[SPEC-001-scan-cli]] |
| pane raw 수집 command·token·timeout·error isolation **규칙** | inventory 계약 | [[SPEC-002-tmux-discovery]] |
| `agentType` 판정 **규칙**·confidence 모델 | 핑거프린팅 | [[SPEC-003-agent-detection]] |
| `status`/summary 추론 **규칙**·precedence·threshold | 상태 추론 | [[SPEC-004-status-inference]] |
| redaction 패턴 카탈로그·line/byte limit 값·원문 비저장 메커니즘 | privacy 계약 | [[SPEC-006-privacy-redaction]] |
| 누적 token/cost(`Orc.usage`) **수집·직렬화** 및 mascot tier 소비 | forward(미반영) — 제안 필드 | [[SPEC-302-mascot-prestige-tiers]] §2.2 (R-P2-008 proposed), 수집 privacy 계약 [[SPEC-008-usage-collection]] |

> **forward(R-P2-008, 미반영)**: [[SPEC-302-mascot-prestige-tiers]]가 prestige tier 판정을 위해 `Orc`에 `usage: OrcUsage | null`(누적 tokens/cost) 추가를 **제안**한다. 본 spec의 현행 `Orc`에는 미포함이며, 채택 시 §2.1 인터페이스·envelope 예시를 함께 갱신한다(read-only/비저장 원칙 유지, best-effort·`null` 허용). `usage`의 출처는 **세션 로그 파일을 직접 읽는 새 read surface**이므로, 그 수집은 [[SPEC-008-usage-collection]]([[08-Decisions|D-039]], security-privacy 소유)이 **CONDITIONAL GO**로 게이트한다 — 직렬화되는 것은 그 계약이 산출한 **4개 집계 스칼라**(`cumulativeTokens`/`cumulativeCostUsd`/`source`/`measuredAt`)뿐이고 transcript 원문·경로·secret은 어떤 필드로도 직렬화되지 않는다(§3.5 privacy 불변식이 본 surface에도 적용). 채택 시 `usage`도 그 4개 스칼라만 wire에 싣는다.

## 2. Contract

### 2.1 타입 정의 (TypeScript 표기)

직렬화 키는 camelCase다. 모든 enum 값은 영문 리터럴 그대로 직렬화한다. `number`는 별도 표기 없으면 `[0,1]` 범위 confidence가 아니라 일반 수치다.

```ts
type SchemaVersion = 1;

type AgentType = 'claude-code' | 'codex' | 'unknown';            // [[SPEC-003-agent-detection]]
type OrcStatus =                                                  // [[SPEC-004-status-inference]] (7종)
  | 'active' | 'waiting' | 'idle' | 'stale' | 'error' | 'unknown' | 'terminated';
type SummarySource =                                             // [[SPEC-004-status-inference]]
  | 'pane_title' | 'recent_output' | 'recent_prompt' | 'user_label' | 'unknown';

interface ScanResult {
  schemaVersion: SchemaVersion;     // 항상 1
  scannedAt: string;                // ISO 8601. 이 scan이 실행된 시각
  stale: boolean;                   // true=이번 데이터가 last-good fallback (R-TMUX-005)
  lastGoodAt: string | null;        // 현재 직렬화된 inventory가 실제 수집된 시각. fresh면 == scannedAt, 데이터 없음이면 null
  tmux: TmuxAvailability;
  statusSummary: StatusSummary;     // 모든 camp의 orc status 집계(최상위)
  camps: Camp[];                    // 빈 상태면 []
  diagnostics: Diagnostics;
}

interface TmuxAvailability {
  installed: boolean;               // phase 0 `tmux -V` 성공 여부
  serverRunning: boolean;           // phase 1 `list-sessions` 성공 여부. installed=false면 항상 false
  version: string | null;           // `tmux -V` 파싱값. 미가용/미설치면 null
}

interface StatusSummary {           // 7종 status 카운트. 키 7개 항상 존재(0 포함)
  active: number; waiting: number; idle: number;
  stale: number; error: number; unknown: number; terminated: number;
}

interface Camp {                    // = tmux session (D-002)
  id: string;                       // "session:" + sessionId. 안정 식별자. 예 "session:$0"
  sessionId: string;                // #{session_id} (안정, 예 "$0")
  tmuxSessionName: string;          // #{session_name} (표시 전용, rename 가변)
  windowCount: number;              // session 내 distinct window 수
  paneCount: number;                // session 내 전체 pane 수(비-orc 포함)
  orcCount: number;                 // orcs.length
  statusSummary: StatusSummary;     // 이 camp의 orc status 집계
  lastActivityAt: string | null;    // session 내 pane lastActivityAt의 최대값(rollup). 없으면 null
  orcs: Orc[];                      // 탐지된 agent pane만. 비-candidate는 제외(아래 §3.2)
}

interface Orc {
  // --- identity (paneId 권위, tmuxTarget 표시 전용) ---
  id: string;                       // "pane:" + paneId. 정규식 ^pane:%[0-9]+$
  paneId: string;                   // #{pane_id} 안정 식별자, 예 "%12"  [[SPEC-002-tmux-discovery]]
  tmuxTarget: string;               // "session:window.pane" 표시 전용(가변)  [[SPEC-002-tmux-discovery]]
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  cwd: string;                      // #{pane_current_path} (redaction 적용, SPEC-006 §2.3/AC-17)
  command: string;                  // #{pane_current_command} (통과, 미redaction)

  // --- agent type 축 ([[SPEC-003-agent-detection]]) ---
  agentType: AgentType;
  agentTypeConfidence: number;      // [0,1]
  agentSignals: AgentSignal[];      // redaction-safe provenance(ruleId만). ≥1 보장(SPEC-003 §2.2 matchedSignals)

  // --- status 축 ([[SPEC-004-status-inference]]) ---
  status: OrcStatus;
  statusConfidence: number;         // [0,1]. status와 항상 함께(확정)
  statusSignals: StatusSignal[];    // redaction-safe provenance(ruleId만). 비어있을 수 있음
  currentWorkSummary: string | null;// redaction 후 추출. 없으면 null
  summarySource: SummarySource;     // 없으면 'unknown'
  summaryIsEstimated: boolean;      // 자동 추정=true, user_label만 false 가능 (R-ORC-005)

  // --- 시간·미리보기 ---
  lastActivityAt: string;           // ISO 8601, #{pane_activity} 변환값
  preview: Preview | null;          // capture 실패 시 null. raw 텍스트 비포함
}

interface AgentSignal {             // [[SPEC-003-agent-detection]] SignalMatch 직렬화
  signal: 'command' | 'process' | 'title' | 'cmdline' | 'output';
  tier: 'A' | 'B' | 'C';            // 'process'(G-PROC, live subtree)는 Tier A — recall 1차 신호
  matchedType: AgentType;
  ruleId: string;                   // 매칭 rule id (원문 아님). 예 "claude-code/proc.subtree"
}

interface StatusSignal {            // [[SPEC-004-status-inference]] StatusSignalMatch 직렬화
  signal: 'change' | 'prompt' | 'idle_time' | 'error' | 'lifecycle' | 'stale';
  status: OrcStatus;
  strength: 'A' | 'B' | 'C';
  ruleId: string;                   // 매칭 rule id (원문 아님)
}

interface Preview {                 // shape는 본 spec, 내용 제약은 [[SPEC-006-privacy-redaction]] §2.4
  lines: number;                    // redacted tail 줄 수(노출 또는 잠재 노출 가능 줄 수)
  truncated: boolean;               // lines > PREVIEW_LINES 또는 byteClamped
  redacted: boolean;               // 1개 이상 redaction 매칭이 있었는가
  text?: string[];                  // 선택. 있으면 redacted tail(≤ PREVIEW_LINES). 기본은 미포함(메타데이터만)
}

interface Diagnostics {
  tmuxErrors: TmuxError[];          // [[SPEC-002-tmux-discovery]] §2.6 의미, 본 spec이 envelope 소유
  scanDurationMs: number;           // scan 전체 소요(ms), ≥ 0
}

interface TmuxError {
  phase: 'probe' | 'inventory' | 'capture';
  command: 'list-sessions' | 'list-windows' | 'list-panes' | 'capture-pane' | 'version';
  target: string | null;           // capture 오류는 paneId, bulk 오류는 null
  kind: 'spawn_error' | 'timeout' | 'exit_nonzero' | 'parse_error';
  exitCode: number | null;
  message: string;                  // tmux stderr/메타 요약. capture 원문 절대 불포함(R-PRIV-005)
}
```

### 2.2 정규(canonical) JSON 예시 — 정상(fresh)

```json
{
  "schemaVersion": 1,
  "scannedAt": "2026-06-26T10:00:00+09:00",
  "stale": false,
  "lastGoodAt": "2026-06-26T10:00:00+09:00",
  "tmux": { "installed": true, "serverRunning": true, "version": "3.4" },
  "statusSummary": { "active": 1, "waiting": 0, "idle": 1, "stale": 0, "error": 0, "unknown": 0, "terminated": 0 },
  "camps": [
    {
      "id": "session:$0",
      "sessionId": "$0",
      "tmuxSessionName": "work",
      "windowCount": 3,
      "paneCount": 5,
      "orcCount": 2,
      "statusSummary": { "active": 1, "waiting": 0, "idle": 1, "stale": 0, "error": 0, "unknown": 0, "terminated": 0 },
      "lastActivityAt": "2026-06-26T09:59:40+09:00",
      "orcs": [
        {
          "id": "pane:%12",
          "paneId": "%12",
          "tmuxTarget": "work:1.0",
          "sessionName": "work",
          "windowIndex": 1,
          "paneIndex": 0,
          "cwd": "/Users/me/proj",
          "command": "node",
          "agentType": "claude-code",
          "agentTypeConfidence": 0.95,
          "agentSignals": [
            { "signal": "process", "tier": "A", "matchedType": "claude-code", "ruleId": "claude-code/proc.subtree" }
          ],
          "status": "active",
          "statusConfidence": 0.82,
          "statusSignals": [
            { "signal": "change", "status": "active", "strength": "A", "ruleId": "active/change.region" }
          ],
          "currentWorkSummary": "Editing src/server.ts",
          "summarySource": "recent_output",
          "summaryIsEstimated": true,
          "lastActivityAt": "2026-06-26T09:59:40+09:00",
          "preview": { "lines": 12, "truncated": true, "redacted": true }
        },
        {
          "id": "pane:%17",
          "paneId": "%17",
          "tmuxTarget": "work:2.0",
          "sessionName": "work",
          "windowIndex": 2,
          "paneIndex": 0,
          "cwd": "/Users/me/proj",
          "command": "node",
          "agentType": "unknown",
          "agentTypeConfidence": 0.30,
          "agentSignals": [
            { "signal": "title", "tier": "B", "matchedType": "unknown", "ruleId": "generic/agent.marker" }
          ],
          "status": "idle",
          "statusConfidence": 0.55,
          "statusSignals": [
            { "signal": "idle_time", "status": "idle", "strength": "B", "ruleId": "idle/inactivity" }
          ],
          "currentWorkSummary": null,
          "summarySource": "unknown",
          "summaryIsEstimated": true,
          "lastActivityAt": "2026-06-26T09:58:10+09:00",
          "preview": { "lines": 0, "truncated": false, "redacted": false }
        }
      ]
    }
  ],
  "diagnostics": { "tmuxErrors": [], "scanDurationMs": 180 }
}
```

### 2.3 빈 상태 / staleness 예시

**not_installed** (R-TMUX-006):
```json
{ "schemaVersion": 1, "scannedAt": "...", "stale": false, "lastGoodAt": null,
  "tmux": { "installed": false, "serverRunning": false, "version": null },
  "statusSummary": { "active": 0, "waiting": 0, "idle": 0, "stale": 0, "error": 0, "unknown": 0, "terminated": 0 },
  "camps": [], "diagnostics": { "tmuxErrors": [], "scanDurationMs": 5 } }
```

**server_not_running**: `tmux.installed=true`, `tmux.serverRunning=false`, `camps=[]`.
**running_no_session**: `tmux.installed=true`, `tmux.serverRunning=true`, `camps=[]`.

**stale fallback** (R-TMUX-005, last-good 재사용): `stale=true`, `lastGoodAt` < `scannedAt`, `camps`는 last-good 데이터, 실패는 `diagnostics.tmuxErrors`. 이 경우 영향받는 orc의 `status`는 [[SPEC-004-status-inference]] §3.1 precedence에 따라 `"stale"`일 수 있다.
```json
{ "schemaVersion": 1, "scannedAt": "2026-06-26T10:05:00+09:00",
  "stale": true, "lastGoodAt": "2026-06-26T10:00:00+09:00",
  "tmux": { "installed": true, "serverRunning": false, "version": "3.4" },
  "statusSummary": { "active": 0, "waiting": 0, "idle": 0, "stale": 2, "error": 0, "unknown": 0, "terminated": 0 },
  "camps": [ "...(last-good 내용, orc.status=stale)..." ],
  "diagnostics": { "tmuxErrors": [ { "phase": "inventory", "command": "list-sessions", "target": null, "kind": "timeout", "exitCode": null, "message": "list-sessions timed out after 2000ms" } ], "scanDurationMs": 2010 } }
```

### 2.4 최상위 필드 표

| 필드 | 타입 | nullable | enum/제약 | 출처 spec |
| --- | --- | --- | --- | --- |
| `schemaVersion` | number | 아니오 | `=1` (확정) | 본 spec |
| `scannedAt` | string | 아니오 | ISO 8601 | [[SPEC-002-tmux-discovery]] |
| `stale` | boolean | 아니오 | — | [[SPEC-002-tmux-discovery]] §2.7 (R-TMUX-005) |
| `lastGoodAt` | string | 예(null) | ISO 8601; fresh면 `scannedAt`와 동일, 데이터 없음이면 null | [[SPEC-002-tmux-discovery]] §2.7 |
| `tmux.installed` | boolean | 아니오 | — | [[SPEC-002-tmux-discovery]] §2.5 |
| `tmux.serverRunning` | boolean | 아니오 | `installed=false`면 항상 false | [[SPEC-002-tmux-discovery]] §2.5 |
| `tmux.version` | string | 예(null) | `tmux -V` 파싱 | [[SPEC-002-tmux-discovery]] phase 0 |
| `statusSummary` | object | 아니오 | 7 키 정수, ≥0 | 본 spec(집계) / [[SPEC-004-status-inference]] enum |
| `camps` | array<Camp> | 아니오 | 빈 상태면 `[]` | 본 spec(조립) |
| `diagnostics` | object | 아니오 | — | 본 spec(envelope) |

### 2.5 Camp 필드 표

| 필드 | 타입 | nullable | 제약 | 출처/집계 |
| --- | --- | --- | --- | --- |
| `id` | string | 아니오 | `^session:\$[0-9]+$` (sessionId 파생, 안정) | 본 spec(D-002) |
| `sessionId` | string | 아니오 | `#{session_id}`, 예 `$0` | [[SPEC-002-tmux-discovery]] FMT_S |
| `tmuxSessionName` | string | 아니오 | 표시 전용(가변) | [[SPEC-002-tmux-discovery]] |
| `windowCount` | number | 아니오 | ≥0 | 본 spec(집계) |
| `paneCount` | number | 아니오 | ≥0, 비-orc 포함 | 본 spec(집계) |
| `orcCount` | number | 아니오 | `= orcs.length` | 본 spec(집계) |
| `statusSummary` | object | 아니오 | 7 키 정수 | 본 spec(집계) |
| `lastActivityAt` | string | 예(null) | ISO 8601, pane rollup max | 본 spec(집계) |
| `orcs` | array<Orc> | 아니오 | candidate만 | 본 spec(조립) |

### 2.6 Orc 필드 표 (R-ORC-003 충족)

| 필드 | 타입 | nullable | enum/제약 | 출처 spec |
| --- | --- | --- | --- | --- |
| `id` | string | 아니오 | `^pane:%[0-9]+$`, `= "pane:"+paneId` | 본 spec(파생) |
| `paneId` | string | 아니오 | `^%[0-9]+$` (권위 식별자) | [[SPEC-002-tmux-discovery]] |
| `tmuxTarget` | string | 아니오 | 표시 전용(가변) | [[SPEC-002-tmux-discovery]] |
| `sessionName` | string | 아니오 | — | [[SPEC-002-tmux-discovery]] |
| `windowIndex` | number | 아니오 | 정수 | [[SPEC-002-tmux-discovery]] |
| `paneIndex` | number | 아니오 | 정수 | [[SPEC-002-tmux-discovery]] |
| `cwd` | string | 아니오 | 절대 경로(redaction 적용 — 경로 내 secret 마스킹, 비-secret 구성요소 보존) | [[SPEC-002-tmux-discovery]] / [[SPEC-006-privacy-redaction]] §2.3/AC-17 |
| `command` | string | 아니오 | `#{pane_current_command}` | [[SPEC-002-tmux-discovery]] |
| `agentType` | string | 아니오 | `claude-code\|codex\|unknown` | [[SPEC-003-agent-detection]] |
| `agentTypeConfidence` | number | 아니오 | `[0,1]` | [[SPEC-003-agent-detection]] |
| `agentSignals` | array | 아니오 | redaction-safe(ruleId만), 항목 `signal ∈ {command, process, title, cmdline, output}`(`process`=G-PROC Tier A), **≥1 (minItems 1, SPEC-003 §2.2 matchedSignals 보장)** | [[SPEC-003-agent-detection]] §2.2 |
| `status` | string | 아니오 | 7종 enum | [[SPEC-004-status-inference]] |
| `statusConfidence` | number | 아니오 | `[0,1]`, status와 항상 동반 | [[SPEC-004-status-inference]] |
| `statusSignals` | array | 아니오 | redaction-safe(ruleId만), 빈 배열 허용 | [[SPEC-004-status-inference]] §2.2 |
| `currentWorkSummary` | string | 예(null) | redaction 후 추출 | [[SPEC-004-status-inference]] §3.5 |
| `summarySource` | string | 아니오 | 5종 enum, 없으면 `unknown` | [[SPEC-004-status-inference]] |
| `summaryIsEstimated` | boolean | 아니오 | 자동추정=true, `user_label`만 false 가능 | [[SPEC-004-status-inference]] (R-ORC-005) |
| `lastActivityAt` | string | 아니오 | ISO 8601 | [[SPEC-002-tmux-discovery]] |
| `preview` | object | 예(null) | capture 실패=null, 원문 비포함 | 본 spec(shape) / [[SPEC-006-privacy-redaction]](내용) |

### 2.7 Preview 필드 표

| 필드 | 타입 | nullable | 제약 | 출처 |
| --- | --- | --- | --- | --- |
| `lines` | number | 아니오 | ≥0 | 본 spec |
| `truncated` | boolean | 아니오 | `lines > PREVIEW_LINES` 또는 byteClamped | [[SPEC-006-privacy-redaction]] §2.4 |
| `redacted` | boolean | 아니오 | redaction 매칭 존재 여부 | [[SPEC-006-privacy-redaction]] |
| `text` | array<string> | 예(부재) | 있으면 redacted tail ≤ `PREVIEW_LINES`, raw 금지 | [[SPEC-006-privacy-redaction]] §2.4 |

- 기본(MVP)은 **메타데이터만**(`text` 부재)이다. 텍스트 노출은 [[SPEC-001-scan-cli]] flag(R-PRIV-006) gating 대상이며, 노출 시에도 redacted tail 규칙을 따른다.
- capture 단계(`capture-pane`)가 그 pane에서 실패하면 `preview = null`이고 실패는 `diagnostics.tmuxErrors`(target=paneId)에 남는다.

### 2.8 사람이 읽는 table 컬럼 계약

기본 출력은 table이다. 본 spec은 **컬럼 집합·매핑 필드·순서·표시 의무**를 고정한다. 색·박스 문자·정확한 estimated glyph·열 너비·생략 규칙은 [[SPEC-001-scan-cli]] 소유다.

camp는 그룹 헤더로 렌더한다: `tmuxSessionName` + `tmuxTarget`류 식별 + 집계(`orcCount`, `statusSummary`, `lastActivityAt`). orc는 그 아래 행으로 렌더한다.

| # | 컬럼 | 매핑 필드 | 의미/표시 의무 |
| --- | --- | --- | --- |
| 1 | TARGET | `tmuxTarget` (+ `paneId`) | raw tmux target을 **항상** 노출(R-UI-007). 식별 권위는 `paneId`. |
| 2 | AGENT | `agentType` + `agentTypeConfidence` | type과 confidence를 함께 표시(단정 금지). |
| 3 | STATUS | `status` + `statusConfidence` | status는 **항상 confidence와 함께**(R-ORC-005). |
| 4 | SUMMARY | `currentWorkSummary` + `summaryIsEstimated` | 추정값은 estimated로 시각 표시(glyph는 SPEC-001). null이면 빈/`-`. |
| 5 | CMD | `command` | foreground command. |
| 6 | CWD | `cwd` | working directory. |
| 7 | ACTIVITY | `lastActivityAt` | 최근 활동(상대/절대 표기는 SPEC-001). |

- **권위(authority)**: 본 §2.8 컬럼 계약 — 집합·매핑 필드·순서·표시 의무(`TARGET` · `AGENT`(+conf) · `STATUS`(+conf) · `SUMMARY` · `CMD` · `CWD` · `ACTIVITY`) — 이 사람이 읽는 출력의 단일 권위다. [[SPEC-001-scan-cli]]는 색·박스 문자·estimated glyph·열 너비·생략 규칙만 정하며 이 컬럼 집합·순서·표시 의무를 **반드시 따라야 한다(이탈 금지)**.
- `preview` 텍스트는 **기본 table에 포함하지 않는다**(노출면 축소, [[SPEC-006-privacy-redaction]]). preview는 `--json` 메타데이터 또는 SPEC-001이 정의하는 별도 표면에서만 노출한다.
- 빈 상태(§3.3)는 표 대신 상태 메시지로 렌더하되, 어떤 빈 상태인지(미설치/server 미실행/session 0/agent 0)를 구분해 표시한다(R-TMUX-006). 정확한 문구는 SPEC-001.
- 정렬은 §3.4 결정성 규칙을 따른다.

## 3. Behavior rules

확정 규칙과 상류 의존(가설은 상류 소유)을 구분한다. 본 spec 규칙은 **조립·직렬화 결정성**이 핵심이며 대부분 확정이다.

### 3.1 staleness 직렬화 (확정, R-TMUX-005)

1. `stale`/`lastGoodAt`은 [[SPEC-002-tmux-discovery]] §2.7 의미 상태를 그대로 직렬화한다.
2. `scannedAt`은 **이 scan이 실행된 시각**이고, `lastGoodAt`은 **현재 직렬화된 inventory가 실제 수집된 시각**이다. fresh면 둘이 같다(`stale=false`, `lastGoodAt == scannedAt`). last-good fallback이면 `stale=true`이고 `lastGoodAt < scannedAt`이다.
3. last-good이 없는 첫 단발 scan 실패는 데이터를 위조하지 않는다: `stale=false`, `lastGoodAt=null`, `camps=[]`, 실패는 `diagnostics`(SPEC-002 §2.7, AC-12와 정합).

### 3.2 camp/orc 조립 규칙 (확정)

1. **camp = tmux session**(D-002). pane raw record를 `sessionName`으로 묶되, camp의 `id`/`sessionId`는 매칭되는 `list-sessions` record의 `#{session_id}`(안정)에서 채운다. `tmuxSessionName`은 가변 표시값이다 → orc의 `paneId`/`tmuxTarget` 분리와 동일 원칙.
2. **orc = candidate pane만**. [[SPEC-003-agent-detection]] `detectOrc`가 `null`(non-candidate)인 pane은 `orcs[]`에 넣지 않는다. 단, 그 pane도 `paneCount`에는 포함한다.
3. **`orc.id = "pane:" + paneId`**. `tmuxTarget`은 id로 쓰지 않는다([[SPEC-002-tmux-discovery]] C2).
4. **집계**: `windowCount`=session 내 distinct `windowIndex` 수, `paneCount`=session 내 전체 pane 수, `orcCount`=`orcs.length`, `statusSummary`=orc status 분포(7키), `lastActivityAt`=session 내 pane `lastActivityAt`의 최대(없으면 null).
5. **최상위 `statusSummary`**=모든 camp orc의 status 분포 합. 빈 상태면 전부 0.
6. **terminated retention**: [[SPEC-004-status-inference]] §3.7로 `terminated`로 유지되는 orc는 즉시 제외하지 않고 그대로 직렬화한다(`orcCount`·`statusSummary`에 포함).
7. **signals 조립 매핑(internal→wire)**: `Orc.agentSignals`는 [[SPEC-003-agent-detection]] §2.2 `OrcCandidate.matchedSignals`(`SignalMatch[]`)의 직렬화다 — 내부 필드명 `matchedSignals`를 wire 필드명 `agentSignals`로 rename하며, 각 항목은 `signal`/`tier`/`matchedType`/`ruleId`(enum·rule-id만)를 그대로 옮긴다. `signal` enum은 `command|process|title|cmdline|output` 5종으로, wrapper-체인 검출의 주경로인 `process`(G-PROC, Tier A)를 포함한다(§2.1; 미포함 시 주경로 orc 직렬화가 enum 위반). 원문 텍스트·title·output은 옮기지 않는다(redaction-safe, §3.5-3). 모든 orc는 candidate이고 SPEC-003 §2.2가 `matchedSignals`를 항상 ≥1로 보장하므로 `agentSignals`는 **non-empty(minItems 1)**다. 마찬가지로 `Orc.statusSignals`는 [[SPEC-004-status-inference]] §2.2 `StatusSignalMatch[]`의 직렬화이며 emptiness는 SPEC-004를 따른다(본 spec은 빈 배열을 허용).

### 3.3 빈 상태 인코딩 (확정, R-TMUX-006)

네 가지 빈/축소 상태를 필드 조합으로 구분한다(SPEC-002 §2.5 의미 상태 직렬화):

| 상태 | `tmux.installed` | `tmux.serverRunning` | `camps` | orc |
| --- | --- | --- | --- | --- |
| not_installed | `false` | `false` | `[]` | — |
| server_not_running | `true` | `false` | `[]` | — |
| running_no_session | `true` | `true` | `[]` | — |
| sessions but no agent | `true` | `true` | 비어있지 않음 | 모든 camp `orcCount=0` |
| normal | `true` | `true` | 비어있지 않음 | ≥1 orc |

- 앞 3종은 `(installed, serverRunning, camps==[])` 조합으로 **상호 구분**된다. "agent 없음"은 session(camp)은 있으나 모든 camp의 `orcCount=0`으로 표현해 위 3종과 구분된다([[14-MVP-PoC-Scope]] "tmux 미설치 / session 없음 / agent 없음" 3구분 충족).

### 3.4 정렬·결정성 (확정)

1. `camps`는 `tmuxSessionName` 오름차순 정렬한다.
2. 각 camp의 `orcs`는 `windowIndex` → `paneIndex` 오름차순 정렬한다([[SPEC-002-tmux-discovery]] §3.6과 정합).
3. `statusSummary` 키 순서·`tmuxErrors` 순서를 안정화한다(동일 입력 → byte 동일 직렬화). `agentSignals`/`statusSignals`는 상류가 준 순서를 보존한다.

### 3.5 privacy 직렬화 불변식 (확정, [[SPEC-006-privacy-redaction]])

1. capture 원문은 어떤 필드에도 직렬화되지 않는다. `preview.text`(노출 시)는 redacted tail뿐이다.
2. `diagnostics.tmuxErrors[].message`는 tmux stderr/command 메타만 담고 capture 콘텐츠를 포함하지 않는다(SPEC-002 AC-07, SPEC-006 AC-13 정합).
3. `agentSignals`/`statusSignals`는 `ruleId`(매칭 규칙 식별자)만 담고 매칭된 원문 텍스트·title·output을 담지 않는다.
4. `currentWorkSummary`는 [[SPEC-004-status-inference]]가 redaction 후 데이터에서 만든 값만 직렬화한다(원문 재구성 금지).
5. **provenance 기본 노출(Q1 해소)**: `agentSignals`/`statusSignals`는 rule-id·enum만 담고 원문 output을 포함하지 않으므로(위 3) `--json` 출력에 **기본 포함**한다. 노출면을 더 줄이는 `--signals`류 gating flag는 [[SPEC-001-scan-cli]]가 후속으로 추가할 수 있으나 MVP 필수는 아니다.
6. **redaction match count 비직렬화**: per-pane redaction **match count**(매칭 횟수)는 wire contract에 직렬화하지 않는다. count는 secret 밀도/존재 여부에 대한 신호를 누설할 수 있으므로 `Preview`(노출은 `redacted` boolean까지만)·`Diagnostics` 어디에도 넣지 않는다. over-redaction 관측용 match count는 **test-harness/debug-log 전용 metric**이며 출력 계약의 일부가 아니다([[SPEC-006-privacy-redaction]]가 자기 쪽 정의를 재기술).

### 3.6 confidence·estimated 직렬화 불변식 (확정, R-ORC-005)

1. `status`는 항상 `statusConfidence ∈ [0,1]`와 함께 직렬화한다. confidence 없는 status를 내보내지 않는다.
2. `agentType`은 항상 `agentTypeConfidence ∈ [0,1]`와 함께 직렬화한다.
3. `summaryIsEstimated`는 모든 orc에 존재한다. 자동 추정 source(`pane_title`/`recent_output`/`recent_prompt`/`unknown`)는 `true`, `user_label`만 `false`일 수 있다.
4. confidence 수치 직렬화 정밀도(소수 자릿수)는 구현 세부이며 값 자체는 상류 산출을 변형하지 않는다.

## 4. Acceptance criteria

```text
SPEC-005-AC-01 (R-CLI-004)
  Given 임의 tmux 상태에서 `orc-camp scan --json`을 실행할 때
  When 출력을 파싱하면
  Then 최상위는 schemaVersion=1, scannedAt(ISO 8601), stale(boolean),
       lastGoodAt(string|null), tmux{installed,serverRunning,version},
       statusSummary(7키 정수), camps(array), diagnostics{tmuxErrors[],scanDurationMs}를
       가지며 각 필드 타입이 §2.4 표와 일치한다(schema validation 통과).
```

```text
SPEC-005-AC-02 (R-CLI-004)
  Given 동일 inventory에 대해
  When `--json`과 기본 table을 각각 출력하면
  Then `--json`은 §2.1 schema에 validate되고,
       기본 table은 §2.8의 컬럼(TARGET/AGENT/STATUS/SUMMARY/CMD/CWD/ACTIVITY)을
       §3.4 순서로 렌더하며, TARGET 컬럼에 raw tmuxTarget이 항상 포함된다(R-UI-007).
```

```text
SPEC-005-AC-03 (R-ORC-003)
  Given 출력의 임의 orc 객체에 대해
  When 필드를 검사하면
  Then id, paneId, tmuxTarget, sessionName, windowIndex, paneIndex, cwd, command,
       agentType, agentTypeConfidence, agentSignals, status, statusConfidence,
       statusSignals, currentWorkSummary, summarySource, summaryIsEstimated,
       lastActivityAt, preview 필드를 모두 가지며 §2.6 타입/enum과 일치하고,
       agentSignals는 ≥1 항목을 가진다(minItems 1, [[SPEC-003-agent-detection]] §2.2 matchedSignals 보장).
```

```text
SPEC-005-AC-04 (R-ORC-003)
  Given 출력의 임의 orc에 대해
  When 식별자를 검사하면
  Then id == "pane:" + paneId 이고 id가 ^pane:%[0-9]+$ 를 만족하며,
       tmuxTarget은 존재하되 id 파생에 쓰이지 않는다(paneId 권위, [[SPEC-002-tmux-discovery]] C2).
       또한 camp.id == "session:" + sessionId 이고 ^session:\$[0-9]+$ 를 만족한다.
```

```text
SPEC-005-AC-05 (R-TMUX-006)
  Given (a) tmux 미설치, (b) 설치+server 미실행, (c) server 실행+session 0개 환경에서
  When 각각 `scan --json`을 실행하면
  Then (a) installed=false, serverRunning=false, camps=[];
       (b) installed=true, serverRunning=false, camps=[];
       (c) installed=true, serverRunning=true, camps=[] 로
       세 빈 상태가 서로 다른 필드 조합으로 구분된다.
```

```text
SPEC-005-AC-06 (R-TMUX-006)
  Given session은 있으나 어떤 pane도 agent로 탐지되지 않은 환경에서
  When `scan --json`을 실행하면
  Then camps는 비어있지 않고(installed=true, serverRunning=true) 모든 camp의 orcCount=0 이며,
       이는 §3.3의 not_installed/server_not_running/running_no_session 3종과 구분되는 "agent 없음" 상태다.
```

```text
SPEC-005-AC-07 (R-TMUX-005)
  Given inventory 수집이 실패하고 last-good snapshot이 존재할 때
  When `scan --json`을 실행하면
  Then stale=true, lastGoodAt < scannedAt 이고 camps는 last-good 내용으로 채워지며,
       fresh 결과(stale=false, lastGoodAt==scannedAt)와 구분된다.
       last-good이 없는 첫 실패는 stale=false, lastGoodAt=null, camps=[] 이다.
```

```text
SPEC-005-AC-08 (R-ORC-005)
  Given summarySource가 자동 추정(pane_title/recent_output/recent_prompt/unknown)인 orc와
        user_label인 orc에 대해
  When 출력을 검사하면
  Then 자동 추정 orc는 summaryIsEstimated=true, user_label orc만 false 가능하며,
       모든 orc는 statusConfidence∈[0,1] 및 agentTypeConfidence∈[0,1]를 status/agentType와 함께 가진다
       (confidence 없는 status/type을 사실로 직렬화하지 않는다).
```

```text
SPEC-005-AC-09 (R-ORC-004)
  Given 출력의 임의 orc에 대해
  When summarySource를 검사하면
  Then 값은 {pane_title, recent_output, recent_prompt, user_label, unknown} 중 하나이고
       모든 orc에 존재하며, summary가 없으면 summarySource="unknown", currentWorkSummary=null 이다.
```

```text
SPEC-005-AC-10 (R-CLI-004)  [preview 직렬화 — [[SPEC-006-privacy-redaction]] 정합]
  Given capture에 알려진 secret 샘플이 포함된 pane과, capture가 실패한 pane이 있을 때
  When `scan --json`을 출력하면
  Then 정상 pane의 preview는 {lines,truncated,redacted} 메타데이터를 가지고(기본 text 부재),
       어떤 필드에도 capture 원문/secret literal이 나타나지 않으며,
       capture 실패 pane은 preview=null 이고 그 실패가 diagnostics.tmuxErrors(target=paneId)에 있다.
       preview.text가 노출되는 모드에서도 그 값은 redacted tail(≤ PREVIEW_LINES)뿐이다.
```

```text
SPEC-005-AC-11 (R-CLI-004)  [diagnostics envelope — [[SPEC-002-tmux-discovery]] 정합]
  Given tmux 오류가 1개 이상 발생한 scan에서
  When diagnostics를 검사하면
  Then diagnostics.scanDurationMs는 number(≥0)이고,
       각 tmuxErrors 항목은 {phase,command,target,kind,exitCode,message}를 §2.1 enum대로 가지며,
       message에는 capture 원문이 포함되지 않는다(R-PRIV-005).
```

```text
SPEC-005-AC-12 (R-ORC-003)
  Given 임의 camp에 대해
  When 집계 필드를 검사하면
  Then orcCount == orcs.length 이고,
       camp.statusSummary의 각 status 카운트 합 == orcCount,
       최상위 statusSummary == 모든 camp statusSummary의 합이며,
       paneCount ≥ orcCount (비-candidate pane 포함)이다.
```

```text
SPEC-005-AC-13 (R-CLI-004)  [결정성]
  Given 동일한 inventory/탐지 결과에 대해
  When `scan --json`을 2회 직렬화하면
  Then camps는 tmuxSessionName, orcs는 windowIndex→paneIndex로 정렬되어
       두 출력이 byte 단위로 동일하다(안정 직렬화).
```

```text
SPEC-005-AC-14 (R-ORC-005)  [signals redaction-safe — [[SPEC-006-privacy-redaction]] 정합]
  Given capture/title에 알려진 secret 샘플이 있던 pane의 orc에 대해
  When agentSignals/statusSignals를 검사하면
  Then 각 항목은 ruleId(및 signal/tier|strength/matchedType|status enum)만 담고,
       매칭된 원문 텍스트·secret literal을 포함하지 않는다.
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-CLI-004 | `--json` 최상위 schema + 기본 table 컬럼 계약(machine + human), preview/diagnostics 직렬화, 결정성 | SPEC-005-AC-01, AC-02, AC-10, AC-11, AC-13 |
| R-TMUX-005 | 최상위 `stale`/`lastGoodAt` 직렬화(last-good fallback 구분, 위조 금지) — 의미는 [[SPEC-002-tmux-discovery]] | SPEC-005-AC-07 |
| R-TMUX-006 | 빈 상태 3종(+agent 없음) 필드 조합 인코딩 — 의미는 [[SPEC-002-tmux-discovery]] | SPEC-005-AC-05, AC-06 |
| R-ORC-003 | orc 전체 필드 직렬화 + `paneId` 파생 id + camp 집계/statusSummary | SPEC-005-AC-03, AC-04, AC-12 |
| R-ORC-004 | `summarySource`(5종 enum) 직렬화 — 추출은 [[SPEC-004-status-inference]] | SPEC-005-AC-09 |
| R-ORC-005 | `summaryIsEstimated` + 항상 동반 confidence + signals redaction-safe 직렬화(사실 단정 금지) — 추론은 [[SPEC-004-status-inference]] | SPEC-005-AC-08, AC-14 |

> 부수 충족(공동 소유, 1차 소유는 타 spec): R-UI-007(raw tmux target 노출, table TARGET 컬럼·AC-02/AC-03), R-PRIV-001/R-PRIV-004(preview redacted tail·원문 비직렬화, AC-10 — 1차 [[SPEC-006-privacy-redaction]]), R-TMUX-004(diagnostics envelope, AC-11 — 1차 [[SPEC-002-tmux-discovery]]/[[SPEC-006-privacy-redaction]]). 전체 추적 매트릭스 통합은 [[SPEC-007-test-validation]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream ([[14-MVP-PoC-Scope]] 예시 보정 필요 — orchestrator 조정)

본 spec의 풍부한 계약이 [[14-MVP-PoC-Scope]] §"최소 데이터 계약"의 예시 JSON을 보강·대체한다. 아래를 14-MVP에서 정합화해야 한다(본 spec은 표시만; index/청사진은 직접 수정하지 않음).

- **C1 — staleness 필드 누락**: 14-MVP 예시에 `stale`/`lastGoodAt`이 없다. 본 spec이 최상위에 추가했다(R-TMUX-005, [[SPEC-002-tmux-discovery]] C1 해소). → 14-MVP 예시에 두 필드 추가.
- **C2 — camp id가 가변 name 기반**: 14-MVP 예시는 `"id": "session:work"`(session_name 파생). 본 spec은 안정 `#{session_id}` 파생(`"session:$0"`)으로 두고 `tmuxSessionName`을 표시 전용으로 분리했다(orc `paneId`/`tmuxTarget` 분리와 동일 원칙, [[SPEC-002-tmux-discovery]] C2 확장). → 14-MVP 예시 camp id 보정.
- **C3 — statusSummary에 `terminated` 누락**: 14-MVP 예시 `statusSummary`는 6키(active/waiting/idle/error/stale/unknown)다. status enum은 7종이므로 본 spec은 `terminated`를 포함한 7키로 고정했다. → 14-MVP 예시 7키화.
- **C4 — estimated/provenance 직렬화 누락**: 14-MVP 예시 orc에 `summaryIsEstimated`·`statusSignals`(및 `agentSignals`)가 없다. 본 spec이 추가했다([[SPEC-004-status-inference]] C3 해소, R-ORC-005 출력 보장). → 14-MVP 예시 orc에 추가.
- **C5 — 빈 상태 인코딩 모호**: 14-MVP는 "session 없음"을 `serverRunning=false` **또는** `camps:[]`로 적어 server_not_running과 running_no_session을 합쳤다. 본 spec §3.3은 `(installed, serverRunning, camps)` 조합으로 3종(+agent 없음)을 명확히 구분한다. → 14-MVP 문구 정정.
- **C6 — preview null/`text` 미정의**: 14-MVP는 preview를 메타데이터로만 예시한다. 본 spec은 capture 실패 시 `preview=null`, 선택적 `preview.text`(redacted tail) shape를 추가 정의했다([[SPEC-006-privacy-redaction]] §2.4 C3 정합). → 보강(충돌 아님, 명시 필요).

### Open Questions (검토 필요)

- **Q1 (해소·CLOSED) — provenance 직렬화 기본 노출**: `agentSignals`/`statusSignals`는 redaction-safe rule-id·enum만 담고 원문 output을 포함하지 않으므로(§3.5-3) `--json` 출력에 **기본 포함**한다(§3.5-5). 노출면을 더 줄이는 `--signals`류 gating flag는 [[SPEC-001-scan-cli]]가 후속으로 추가할 수 있으나 MVP 필수는 아니다. → 본 Open Question을 닫는다.
- **Q2 — 최상위 `statusSummary` 중복**: camp별 `statusSummary`가 있는데 최상위 집계도 둘지(빠른 요약 vs 중복). 현재 둘 다 둔다(table 요약 라인·doctor 친화). 불필요로 판명되면 최상위를 파생 계산으로 남기고 직렬화 생략 검토. **검토 필요.**
- **Q3 — 단발 scan vs `--watch` 의존**: `stale`/`lastGoodAt`과 prior 의존 status(`active`/사라짐 `terminated`)는 반복 scan에서만 실질 의미를 가진다([[SPEC-002-tmux-discovery]] Q1, [[SPEC-004-status-inference]] Q1). 단발만 지원하면 stale/terminated retention 직렬화가 사실상 공허하다. [[SPEC-001-scan-cli]]의 `--watch` 결정과 정합 필요.
- **Q4 — `sessionId` 안정성 한계**: tmux `#{session_id}`(`$N`)는 server 재시작 시 재할당된다. 단발 scan 내 식별엔 충분하나 server 재시작 across-run 안정성은 보장되지 않는다. camp id를 long-lived 식별자로 쓰는 후속 슬라이스가 생기면 보강 필요.
- **Q5 — `tmux.version` 포함 가치**: 최상위 `tmux.version`은 doctor/디버그 친화로 추가했으나 scan 데이터 본질은 아니다. SPEC-001 `doctor`와 역할 중복 시 scan 출력에서 생략 검토. **검토 필요.**
- **Q6 — `cwd` 직렬화 redaction (해소)**: `cwd`는 경로에 token이 섞일 수 있어 redaction을 적용하기로 확정했다([[SPEC-006-privacy-redaction]] §2.3/AC-17, [[08-Decisions|D-016]]). 본 계약의 `cwd`는 redaction 경계를 통과한 값이며 비-secret 경로 구성요소는 보존된다.
