---
spec: SPEC-006
title: Privacy·redaction·read-only
status: draft
updated: 2026-07-02
requirements: [R-PRIV-001, R-PRIV-002, R-PRIV-003, R-PRIV-004, R-PRIV-005, R-PRIV-008, R-TMUX-001, R-TMUX-004, R-OBS-003]
decisions: [D-003, D-008, D-016, D-019, D-020, D-042]
tags:
  - specs
  - privacy
  - redaction
  - security
  - read-only
  - scan
---

# SPEC-006 — Privacy·redaction·read-only

`orc-camp scan` 슬라이스([[14-MVP-PoC-Scope]], [[08-Decisions]] D-012)의 **P0 cross-cutting 프라이버시/보안 계약**을 고정한다. tmux pane 콘텐츠는 token·key·private path·고객 정보를 포함할 수 있으므로([[05-Backend]] 보안 리스크), 이 spec은 다음 4가지를 검증 가능한 규칙으로 정의한다.

1. **redaction**: 노출 전 가려야 할 secret 패턴 카탈로그와 대체 표기(R-PRIV-002, R-PRIV-003).
2. **limit**: capture line/byte 한계와 preview = redacted tail 제한(R-PRIV-001).
3. **non-persistence**: 원문을 파일·debug log·`--json`에 저장하지 않는다는 데이터 흐름 계약(R-PRIV-004, R-PRIV-005, R-OBS-003).
4. **read-only 강제**: tmux command allowlist와 이를 코드/테스트로 강제하는 wrapper(R-TMUX-001 enforcement, R-TMUX-004 safety).

> **핵심 불변식(redaction chokepoint, [[08-Decisions|D-016]])**: pane 콘텐츠와 환경 자유 텍스트(`cmdline`/`cwd` 포함)는 `sanitize()`/`redact()`라는 **단일 경계**를 통과한 뒤에만 어떤 소비자(detection·status·preview·table·`--json`·log)에게도 전달된다. 즉 [[SPEC-003-agent-detection]]의 `recentOutput`/`paneTitle`/`cmdline`과 [[SPEC-004-status-inference]]의 `currentWorkSummary`는 **모두 redaction 적용 후 데이터**에서만 만들어진다(아래 §3.1 ordering rule). 이 경계 이전의 raw 버퍼는 어떤 출력 경로에도 도달하지 않는다.

> **2026-07-02 개정([[18-Terminal-Workspace]] Terminal Workspace, [[08-Decisions|D-042]])**: scan 슬라이스의 redaction 계약을 **live pane view 채널([[SPEC-103-pane-live-stream]])의 실시간 스트림**으로 확장한다 — (1) **redaction 적용 범위·non-persistence 표를 live view 프레임에 확장**(§2.3/§2.5): 전송되는 모든 프레임 텍스트는 기존 `sanitizeCapture` 단일 chokepoint를 통과한 redacted 값만 싣는다(redaction-before-egress). (2) **ANSI/styled 스트림 redaction 계약** 신설(§2.8): SGR escape가 secret 패턴을 쪼개 미탐을 만드는 것을 막는 tokenize→plain-redact→style-remap 순서를 고정하고, 승인 전에는 styled를 emit하지 않는다(plain fallback, [[08-Decisions|D-042]]). (3) **live view 커서/geometry 조회의 read-only 경로**를 §2.6에 co-own 명시(기존 allowlist `list-panes` format 변수 재사용, 새 항목 미추가). (4) threat model에 **styled-bypass**(High) 행 추가 및 **PF-05(redaction-before-egress)를 live/network 채널로 정식화**(§3.6). 이로써 본 spec은 R-PRIV-008을 소유한다. 기존 불변식 [[08-Decisions|D-016]]/[[08-Decisions|D-019]]/[[08-Decisions|D-027]]과 AC-01~18은 그대로 유지된다. 근거 결정 [[08-Decisions|D-042]]는 **Proposed(미승인)**이므로 상태를 `draft`로 되돌린다.

## 1. Scope

### In scope

- redaction 패턴 카탈로그: secret class별 매칭 기준과 대체 토큰(`[REDACTED:<class>]`) 정의(§2.2, R-PRIV-002/003).
- 어떤 필드가 redaction 대상인지(자유 텍스트) vs 통과인지(구조 식별자) 구분(§2.3).
- sanitize 파이프라인 계약: line cap(N) → byte cap(B) → redact → 소비자(§2.4, §3.1). [[SPEC-002-tmux-discovery]] Q6(capture limit 경계) 해소.
- non-persistence 데이터 흐름표: memory-only vs persisted, log에 허용되는 것(§2.5, R-PRIV-004/005, R-OBS-003).
- read-only tmux command allowlist와 단일 `tmuxExec` wrapper 강제 메커니즘(§2.6, R-TMUX-001 enforcement, [[08-Decisions|D-019]]).
- non-tmux process-introspection subprocess(`pane_pid → ps`)의 read-only 동등 안전 계약과 cmdline redaction 경계(§2.7, [[08-Decisions|D-020]]). 수집은 [[SPEC-002-tmux-discovery]] §2.8 소유.
- false-redaction(과도 마스킹) 측정·완화 규칙과 PoC 지표 연결(§3.5, [[SPEC-007-test-validation]]).
- scan 슬라이스 threat model과, 후속 server/control 슬라이스에서 추가될 위협의 **사전 표시(pre-flag)**(§3.6).
- **live pane view 채널의 redaction 경계(egress)**: 전송 프레임의 redacted-only 강제(§2.3/§2.5 확장), **ANSI/styled 스트림 redaction 계약**(tokenize→plain-redact→style-remap, §2.8), styled-bypass threat + PF-05 정식화(§3.6). 메커니즘은 본 spec 소유, live 채널 적용은 [[SPEC-103-pane-live-stream]] 참조([[08-Decisions|D-042]], R-PRIV-008).
- 다룬 요구사항: R-PRIV-001~005, **R-PRIV-008**(styled/live stream redaction 계약·threat model), R-TMUX-001(enforcement), R-TMUX-004(safety), R-OBS-003.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| capture-pane 호출 형태·line window `N` 수집·`diagnostics.tmuxErrors` 구조 | inventory 수집 계약 | [[SPEC-002-tmux-discovery]] |
| `--json`/`preview` **필드 shape**·`schemaVersion`·직렬화 | 출력 데이터 계약(본 spec은 preview **내용**을 redacted tail로만 제약) | [[SPEC-005-data-contract]] |
| `agentType` 판정·output banner pattern 문자열 | 입력은 redacted; 본 spec은 redaction 후 소비를 강제만 | [[SPEC-003-agent-detection]] |
| `currentWorkSummary`/`summarySource` 추출 로직 | 입력은 redacted; 본 spec은 ordering만 강제 | [[SPEC-004-status-inference]] |
| CLI flag(`--no-preview`, preview line count 조정 = R-PRIV-006), settings 저장 | CLI 표면/설정 | [[SPEC-001-scan-cli]] |
| control-action 인증(startup token·CORS·target 재검증 deep design) | 후속 control 슬라이스. 본 spec은 **pre-flag만** | Slice 2~4 ([[02-Requirements]] R-SEC/R-CTRL) |

## 2. Contract

### 2.1 sanitize 파이프라인 (단일 경계)

pane raw text는 아래 한 함수만 통과해 redacted 산출을 만든다. **이 함수 바깥에서는 raw 버퍼를 참조하지 않는다.**

```ts
// 한계 상수(모두 PoC 검증 가설 — §3.4)
const CAPTURE_LINES = 200;      // N: capture line window (수집 시 tmux -S -N, [[SPEC-002-tmux-discovery]] §2.4)
const BYTE_CAP = 64 * 1024;     // B: 64 KiB, sanitizer가 tail 보존으로 clamp
const PREVIEW_LINES = 12;       // P: preview redacted tail 줄 수 (MVP JSON 예시 preview.lines=12)

interface RedactionResult {
  text: string;        // redacted 텍스트 (raw 아님)
  redacted: boolean;   // 1개 이상 패턴이 매칭됐는가
  matchCount: number;  // 적용된 마스킹 수 — test-harness/debug-log 전용 지표(내용 아님). wire 미직렬화(§3.5 ④)
}

interface SanitizedCapture {
  lines: string[];     // redacted, 오래된→최신 순
  redacted: boolean;
  byteClamped: boolean;
  matchCount: number;  // redaction-stats: test-harness/debug-log 전용, wire 미직렬화(§3.5 ④)
}

// raw capture(메모리, 휘발) → redacted 산출. raw 인자는 반환 후 폐기된다.
function sanitizeCapture(raw: string): SanitizedCapture {
  const clamped = clampBytesTail(raw, BYTE_CAP);    // 1) byte cap (B) — tail 보존
  const { text, redacted, matchCount } = redact(clamped); // 2) redaction chokepoint
  return {
    lines: splitLF(text),
    redacted,
    byteClamped: clamped.length < byteLength(raw),
    matchCount,
  };
}
```

- **line cap `N`은 수집 단계 소유**: [[SPEC-002-tmux-discovery]]가 `capture-pane -p -t <paneId> -S -<N>`로 N줄만 받는다(tmux argument). 본 spec은 N의 **값**을 한계로 공유(§3.4)하되 호출은 SPEC-002가 한다.
- **byte cap `B`는 sanitizer 소유**: 병적으로 긴 줄/대용량 출력에 대비해 메모리에서 tail B바이트로 clamp한다. (line은 작아도 byte가 클 수 있으므로 둘 다 필요.)
- **redaction은 byte cap 이후 1회**: 전체 clamped 버퍼에 redact를 1번 적용한다. 이후 모든 tail slice(detection·preview)는 이 redacted 버퍼에서 잘라낸다 → 단일 chokepoint.

### 2.2 redaction 패턴 카탈로그 (R-PRIV-002, R-PRIV-003)

대체 토큰은 `[REDACTED:<class>]` 고정 형식이다. class 토큰은 **안정**해야 하며(소비자가 의존), 어떤 예시도 실제 secret을 쓰지 않고 **토큰 shape/placeholder만** 쓴다([[SPEC-000-conventions]] 표기 규칙). 매칭은 평문 기준이다(capture는 `-p`로 escape sequence 없음 — [[SPEC-002-tmux-discovery]] §2.1, `-e` 미사용).

적용 **우선순위**(specific → generic): 다중 라인 블록 우선, 그다음 provider-specific, 그다음 env-assignment, **generic long-token은 최후**(specific label이 generic을 이긴다).

| ID | class / 대상 | 매칭 기준(개념) | 대체 토큰 | 비고 |
| --- | --- | --- | --- | --- |
| RP-01 | PEM private key block | `-----BEGIN [A-Z ]*PRIVATE KEY-----` … `-----END [A-Z ]*PRIVATE KEY-----` (multiline, non-greedy) | `[REDACTED:private-key]` | **최우선**. 블록 전체를 한 번에 치환(부분 누출 방지) |
| RP-02 | AWS access key id | `(AKIA\|ASIA\|AGPA\|AIDA\|AROA)[0-9A-Z]{12,}` | `[REDACTED:aws-key]` | secret access key(40 base64)는 RP-08/RP-09로 포착 |
| RP-03 | GitHub token | `(ghp_\|gho_\|ghu_\|ghs_\|ghr_\|github_pat_)[A-Za-z0-9_]{20,}` | `[REDACTED:github-token]` | |
| RP-04 | Slack token | `xox[baprs]-[0-9A-Za-z-]{10,}` | `[REDACTED:slack-token]` | |
| RP-05 | JWT | `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` (base64url 3-segment) | `[REDACTED:jwt]` | header가 `eyJ`로 시작하는 형태 |
| RP-06 | Bearer/Authorization 헤더 | `(?i)(authorization\s*[:=]\s*\|bearer\s+)<token>` | label 유지 + `[REDACTED:bearer]` | 값만 마스킹(예: `Authorization: [REDACTED:bearer]`) |
| RP-07 | URL credential | `<scheme>://<user>:<password>@<host>` 의 userinfo | `<scheme>://[REDACTED:url-cred]@<host>` | host/path는 유지(맥락 보존) |
| RP-08 | env secret 할당 | `(?i)\b(SECRET\|TOKEN\|PASSWORD\|PASSWD\|PWD\|API[_-]?KEY\|ACCESS[_-]?KEY\|PRIVATE[_-]?KEY\|CLIENT[_-]?SECRET\|AUTH\|CREDENTIAL)\s*=\s*<value>` | `KEY=[REDACTED:env-secret]` | key 이름 유지, value(공백/따옴표 전까지) 마스킹 |
| RP-09 | provider api key prefix | `sk-[A-Za-z0-9]{20,}`, `sk-ant-[A-Za-z0-9-]{20,}` 등 알려진 prefix | `[REDACTED:api-key]` | Claude Code/Codex pane이 실제 키를 출력할 수 있어 중요 |
| RP-10 | generic high-entropy token | key-ish 맥락 근처의 base64/hex `≥ 32`자 연속(가설) | `[REDACTED:token]` | **false-positive 최상위 위험.** 보수적·tunable, §3.5로 측정 |
| RP-11 | anchorless PEM key-body base64 (경계 절단 보정, 2026-07-02 리뷰 반영) | PEM 문맥의 **앵커 없는 key-body**: (a) `PRIVATE KEY-----` 뒤 `-----END`가 없는 잔여, 또는 (b) `-----BEGIN`이 없이 시작하는 base64 대량 연속(예: `≥ 3`줄, 각 줄 base64 문자 위주 `≥ 40`자, 가설) | `[REDACTED:private-key]` | capture 창(N줄)이 multiline PEM 블록을 **양분(bisect)**하면 RP-01 앵커가 사라져 미탐 → key-body base64 run을 **보수적으로** 마스킹. false-positive 민감(정상 대량 base64와 구분) → §3.5 코퍼스로 tunable |

- redaction 대상 텍스트라도 **detection이 필요로 하는 banner 식별 토큰**(예: `@anthropic-ai/claude-code`, `codex` CLI 배너)은 secret이 아니므로 위 패턴에 걸리지 않아야 한다. RP-10 generic 규칙이 banner 토큰까지 가려 [[SPEC-003-agent-detection]] G-OUT 미탐을 유발할 위험은 §3.5·§6 / [[SPEC-003-agent-detection]] Q와 공동 검증한다(coherence).
- 각 치환은 `matchCount`를 1 증가시킨다(redaction-stats). class별 카운트는 **test-harness/debug-log 전용 관측 지표**이며 **원문 단편을 남기지 않고 wire 계약에 직렬화하지 않는다**(§3.5 ④, [[SPEC-005-data-contract]]).
- **경계 절단 PEM(RP-11) 주의(2026-07-02 리뷰 반영)**: line window `N`(§3.4)이 multiline PEM 블록을 양분하면 seed/preview에 `-----BEGIN/END` 앵커 없는 key-body base64만 남아 RP-01이 놓친다. 이는 **scan 슬라이스에도 이미 존재하던 잠재 gap**이며 live view seed(§2.3, [[SPEC-103-pane-live-stream]])가 스크롤백 전체를 실시간 전송하므로 **노출 표면이 증폭**된다. RP-11이 앵커 없는 key-body를 보수적으로 마스킹해 이를 닫고, [[SPEC-007-test-validation]] 코퍼스에 **boundary-bisected-PEM 케이스**(블록이 캡처 창 상/하단에서 잘린 3종)를 추가해 `secret-recall = 1.0`을 검증한다(§3.5, AC-21).

### 2.3 redaction 적용 범위 (어떤 필드를 거르나)

| 필드 | redaction | 근거 |
| --- | --- | --- |
| capture 콘텐츠(`recentOutput`) | **적용** | agent가 임의 텍스트 출력 → secret 가능 |
| `paneTitle` | **적용** | 사용자/agent가 임의 설정 가능([[SPEC-003-agent-detection]] §2.1 "redacted") |
| `cmdline`(argv, foreground) | **적용** | argv에 `--token=…` 형태 노출 가능 |
| `processTree[].command`(subtree **각 노드** argv) | **적용(노드별 전수)** | [[SPEC-002-tmux-discovery]] §2.9 process subtree의 **모든** 노드 argv가 대상이다. foreground 한 줄만이 아니라 non-foreground 노드(wrapper/자식)의 argv에도 `--token=…`/`--password=…`이 박힐 수 있으므로 **노드마다** 같은 `redact()`를 통과시킨다(§2.7). 한 노드라도 누락하면 누출 구멍 |
| `diagnostics.tmuxErrors[].message` | **방어적 적용** | tmux stderr만 담되, 만약 콘텐츠 단편이 섞이면 차단(아래 §2.5) |
| `paneId`/`tmuxTarget`/`sessionName`/`windowIndex`/`paneIndex`/`command`(basename)/`lastActivityAt` | 미적용(통과) | tmux token 기반 구조 식별자. 마스킹 시 식별·표시 불능 |
| `cwd`(절대 경로) | **적용(방어적)** | 경로는 사용자 환경의 자유 텍스트라 secret이 박힐 수 있음(예: 경로 내 token). 단일 chokepoint([[08-Decisions|D-016]]) `redact()`를 거쳐 노출하되 비-secret 경로 구성요소는 보존. Q3 해소 → AC-17 |
| live view 프레임 텍스트(`pane_view_seed.lines`/`pane_view.lines` — [[SPEC-103-pane-live-stream]]) | **적용(egress)** | live pane view가 WS로 push하는 모든 프레임의 텍스트는 `sanitizeCapture` 산출(redacted)만 싣는다. capture 콘텐츠와 동일 chokepoint로, raw는 프레임에 도달하지 않는다(redaction-before-egress, PF-05 정식화). Phase 1 plain, Phase 1.5 styled은 §2.8. → AC-19 |

> **단일 문자열 필드의 chokepoint**: `paneTitle`/`cmdline`/`cwd` **및 `processTree`의 각 노드 `command`(argv)**는 multiline capture가 아니므로 line/byte cap을 포함한 `sanitizeCapture` 대신 같은 redaction 함수 `redact()`를 직접 통과한다 — **chokepoint 함수는 동일**하다([[08-Decisions|D-016]]). 즉 §2.1의 `redact()`가 capture·argv(foreground + subtree 전 노드)·title·path 모두의 단일 redaction 경계이며, raw 값은 이 경계 밖으로 나가지 않는다. subtree argv는 노드 수만큼 `redact()`를 **노드별로** 반복 적용한다(§2.7). cwd는 종전 "통과(미적용)"였으나 방어적으로 이 경계에 포함시켜 경로 내 secret 구멍을 닫는다.

### 2.4 preview = redacted tail 제약 (R-PRIV-001)

- preview의 **shape**는 [[SPEC-005-data-contract]] 소유다(MVP 예시: `preview: { "lines": 12, "truncated": true, "redacted": true }` — 메타데이터만). 본 spec은 preview가 노출하는 **내용**을 제약한다:
  - SPEC-005가 텍스트 preview 표면(CLI table preview 또는 선택적 `preview.text`)을 두면, 그 텍스트는 `sanitizeCapture` 산출의 **마지막 `PREVIEW_LINES`줄(redacted tail)**이어야 하며 raw가 절대 포함되지 않는다.
  - `truncated`는 `lines > PREVIEW_LINES` 또는 `byteClamped`일 때 true.
  - `redacted`는 `SanitizedCapture.redacted`를 그대로 노출(매칭이 있었으면 true).
- 현재 MVP JSON 예시처럼 preview를 메타데이터(count/flag)만 두는 선택은 본 제약을 자명하게 만족한다. 텍스트 노출을 추가할 때만 redacted-tail 규칙이 발동한다.

### 2.5 non-persistence 데이터 흐름표 (R-PRIV-004, R-PRIV-005, R-OBS-003)

"메모리에만 머무는 것" vs "파일로 남는 것"과, log에 허용되는 것을 분리한다.

| 데이터 | 보유/도달 위치 | redaction | 파일 저장 | 비고 |
| --- | --- | --- | --- | --- |
| raw capture 버퍼(redaction 이전) | memory only, 휘발 | — | **금지** | `sanitizeCapture` 내부에만 존재, 반환 후 폐기. 어떤 출력에도 미도달 |
| raw `ps` snapshot/argv 버퍼(redaction 이전) | memory only, 휘발 | — | **금지** | process subtree 수집 직후 버퍼([[SPEC-002-tmux-discovery]] §2.9). 각 노드 argv를 `redact()` 통과시키고 raw는 폐기. 어떤 출력에도 미도달 |
| redacted capture 버퍼 | memory(runtime) | 적용됨 | **금지** | detection·status·preview의 단일 소스 |
| `processTree[].command`(redacted argv, 전 노드) | memory(runtime), detection 입력 | 노드별 적용됨 | **금지(원문)** | [[SPEC-003-agent-detection]] G-PROC 입력. wire `Orc`로 직렬화하지 않음(detection-input-only, provenance는 `agentSignals.ruleId`만). raw argv 미도달 |
| `preview`(count/flag, 선택적 redacted tail) | memory → stdout(table/`--json`) | 적용됨 | 금지(원문) | §2.4 |
| live view 프레임 텍스트(`pane_view_seed`/`pane_view`.lines — [[SPEC-103-pane-live-stream]]) | memory → WS(network egress) | 적용됨(egress 전) | **금지(원문)** | 전송 프레임은 `sanitizeCapture` 산출만. raw capture는 프레임·로그·디스크 미도달(§2.3, §2.8, PF-05 정식화). styled은 §2.8 순서 통과분만 |
| `currentWorkSummary` | memory → stdout | redacted 기준 추출 | 금지 | [[SPEC-004-status-inference]], §3.1 |
| `diagnostics.tmuxErrors[].message` | memory → stdout(`--json`) + debug log | tmux stderr/메타만 | 메타데이터로만 | capture 콘텐츠 **불포함**([[SPEC-002-tmux-discovery]] AC-07) |
| debug log entry | persisted file | redacted + metadata-only | **메타데이터만** | timestamp·phase·command·`paneId`·exitCode·durationMs·`matchCount`만. capture 텍스트(raw/redacted) 미기록 |
| config | persisted file | — | output 원문 저장 금지([[02-Requirements]] R-SET-002) | scan 슬라이스는 config를 쓰지 않음 |
| full session output | (disabled) | — | **기본 비활성**(D-008 opt-in) | scan은 전체 output 저장 경로를 만들지 않는다(R-PRIV-004) |

> **debug log 정책 정밀화**: scan 슬라이스의 debug log는 **capture 텍스트를 아예 기록하지 않는다**(raw도 redacted도 아님). R-OBS-003의 "log redaction"은 방어선으로 유지한다 — 로그에 쓰는 어떤 자유 텍스트(예: tmux stderr message)도 기록 직전 `redact()`를 통과시켜, 콘텐츠가 우발적으로 섞여도 secret이 평문으로 남지 않게 한다.

### 2.6 read-only allowlist와 강제 메커니즘 ([[08-Decisions|D-019]]; R-TMUX-001 enforcement, R-TMUX-004 safety)

tmux 바이너리를 spawn하는 **유일한 진입점**은 `tmuxExec` wrapper다([[08-Decisions|D-019]] fail-closed allowlist). scan 코드의 다른 어떤 모듈도 직접 `child_process`로 `tmux`를 부르지 않는다.

```ts
const READONLY_ALLOWLIST = new Set([
  'list-sessions', 'list-windows', 'list-panes', 'capture-pane',
]); // + 버전 probe 형태 `tmux -V` (subcommand 없음)

// defense-in-depth: 명시적으로 거부할 상태변경 subcommand
const STATE_CHANGING_DENYLIST = new Set([
  'send-keys', 'paste-buffer', 'set-buffer', 'load-buffer',
  'run-shell', 'if-shell', 'new-session', 'new-window', 'split-window',
  'kill-session', 'kill-server', 'kill-pane', 'kill-window',
  'respawn-pane', 'respawn-window', 'rename-session', 'set-option',
]);

function tmuxExec(subcommand: string | null, args: string[]): SpawnResult {
  // 0) 바이너리 고정: 정확히 'tmux'. 경로/shell 보간 금지(arg 배열만)
  // 1) version probe: subcommand === null && args === ['-V'] 만 허용
  // 2) fail-closed allowlist: subcommand ∉ READONLY_ALLOWLIST → throw (spawn 안 함)
  // 3) 2차 단언: subcommand ∈ STATE_CHANGING_DENYLIST → throw (명확한 에러)
  // 4) child_process.spawn('tmux', [subcommand, ...args]) — shell:false, timeout T
  //    (timeout/SIGTERM·SIGKILL·error isolation은 [[SPEC-002-tmux-discovery]] §2.6)
}
```

- **fail-closed**: allowlist에 없으면 **거부가 기본**이다. denylist는 보조(더 명확한 에러 + 미래 회귀 방지)이며, allowlist가 권위다.
- **shell 미사용**: `spawn('tmux', argv, { shell: false })`. shell 보간/`run-shell`/`if-shell` 경유 임의 명령 실행 경로를 원천 차단(R-CTRL-008 정신과 정합).
- **테스트 가능성**: (a) `tmuxExec('send-keys', …)`/`'paste-buffer'`는 throw하고 process를 spawn하지 않는다. (b) 전체 scan을 돌렸을 때 실제 spawn된 argv의 subcommand는 allowlist(+`-V`)뿐이다([[SPEC-002-tmux-discovery]] AC-13과 동일 관측, 본 spec은 **강제 메커니즘**을 소유).
- read-only는 [[SPEC-002-tmux-discovery]] R-TMUX-001이 **command set을 정의**하고, 본 spec이 **강제 wrapper를 정의**한다(co-ownership, §5).

> **live view 커서/geometry 조회의 read-only 경로(co-own, 2026-07-02, [[08-Decisions|D-041]]/[[08-Decisions|D-045]])**: [[SPEC-103-pane-live-stream]] live view는 커서 위치·pane geometry를 **이미 READONLY_ALLOWLIST에 있는 `list-panes`의 format 변수**(`#{cursor_x}`/`#{cursor_y}`/`#{pane_width}`/`#{pane_height}`)로 얻는다. 이는 read-only query이며 **새 allowlist 항목·새 subprocess 진입점을 추가하지 않으므로** [[08-Decisions|D-019]] read-only 불변식을 그대로 유지한다. [[18-Terminal-Workspace]]/[[08-Decisions|D-045]]가 예시한 **`display-message -p` 경로는 채택하지 않는다** — `display-message`는 현재 allowlist에 없어 추가 시 노출면이 늘고, `list-panes`로 동일 값을 얻을 수 있기 때문이다. (만약 후속 검토에서 `display-message`를 굳이 도입할 근거가 생기면, 이는 상태 비변경 read/query 명령이므로 READONLY_ALLOWLIST에 read-only query로 추가하는 결정을 별도 확정하고 `STATE_CHANGING_DENYLIST`와 분리해야 한다.) 이 divergence는 §6 C5 및 [[SPEC-103-pane-live-stream]] §6 C1에 기록해 D-045 ratify 시 정합화한다.

### 2.7 non-tmux process-introspection subprocess 안전 계약 ([[08-Decisions|D-019]] 정신, [[08-Decisions|D-020]])

[[SPEC-002-tmux-discovery]] §2.8/§2.9는 agent type 판정(Tier B `cmdline` + **Tier A G-PROC process subtree**)과 process-alive 신호를 위해 pane foreground argv(`cmdline`)·**subtree 전 노드 argv(`processTree[].command`)**·생존 여부를 **tmux가 아닌 별도 subprocess**(§2.9 단일 `ps` process-table snapshot, 또는 OS별 introspection)로 수집한다. §2.6 `tmuxExec` allowlist는 **tmux 바이너리에만** 적용되므로 이 `ps`(또는 OS 동등) subprocess는 그 allowlist **밖**이다. 그러나 read-only 보장([[08-Decisions|D-019]])이 tmux 경계에서 끝나면 안 되므로, 본 spec은 이 subprocess에 **allowlist와 동등한 fail-safe 계약**을 부과한다(수집은 SPEC-002 §2.8/§2.9, 안전·redaction 강화는 본 spec 소유 — co-ownership).

- **read-only**: `ps`(또는 동등 OS 명령)는 프로세스 메타데이터를 **조회만** 한다. 상태를 바꾸는 어떤 명령도 이 경로로 spawn하지 않는다([[08-Decisions|D-019]] read-only 불변식을 non-tmux 경계로 확장).
- **고정 argv + shell 미사용**: subtree 수집은 pane마다 `ps`를 반복하지 않고 scan당 **단일 process-table snapshot**(`spawn('ps', ['-axo', 'pid=,ppid=,command='], { shell: false })`, BSD/macOS; Linux는 `['-eo','pid=,ppid=,args=']`)을 **고정 인자 배열**로 spawn한다([[SPEC-002-tmux-discovery]] §2.9, O(1) spawn). 사용자 텍스트를 인자로 보간하지 않으며(셸 보간·문자열 결합 없음, §2.6 `shell:false` 정신과 동일), subtree는 snapshot 결과를 메모리에서 `pane_pid` 기준 ppid walk로 구성한다(추가 spawn 없음). (종전 단일 pid `ps -o command= -p <pid>`는 §2.9가 supersede한다.)
- **per-call timeout**: tmux 호출과 동일한 per-call timeout `T`(§2.6 / [[SPEC-002-tmux-discovery]] §2.6)와 SIGTERM→SIGKILL 종료를 적용한다. read-only이므로 종료가 시스템 상태를 바꾸지 않는다.
- **fail-closed / degradable**: pid 부재·non-zero·미지원 플랫폼·timeout이면 `cmdline`/process-alive를 `null`로, snapshot 자체가 실패하면 모든 pane `processTree`를 `null`로 둔다(전체 fail-closed, [[SPEC-002-tmux-discovery]] §2.9). allowlist 밖 명령을 임의로 대체 실행하지 않는다.
- **동일 redaction chokepoint(전 노드 전수)**: `ps`가 돌려준 `cmdline`(foreground) **및 `processTree`의 모든 노드 argv**는 capture 텍스트와 **완전히 같은 `redact()` 경계**(§2.1·§2.3, [[08-Decisions|D-016]])를 통과한 뒤에만 소비된다. 단일 `cmdline` 한 줄이 아니라 **subtree 노드 N개 argv 각각**을 redaction한다. 즉 [[SPEC-003-agent-detection]]의 `cmdline`/`processTree` 신호·preview·debug log 어디에도 **redaction 이전 argv**(foreground든 non-foreground 노드든)가 도달하지 않으며, 어느 노드 argv의 `--token=…`/`--password=…`이라도 §2.2 카탈로그(RP-06/RP-08/RP-09/RP-10 등)로 마스킹된다.

> tmux 경계(§2.6, [[08-Decisions|D-019]])와 process-introspection 경계(§2.7, [[08-Decisions|D-020]])는 **두 개의 read-only subprocess 진입점**이며, 둘 다 (a) 고정 argv·`shell:false`, (b) per-call timeout·강제 종료, (c) 출력 자유 텍스트의 redaction-before-use를 공유한다. allowlist 권위(tmux)와 동등 계약(non-tmux)을 분리해 명시하되, 어느 쪽도 raw 자유 텍스트를 chokepoint 밖으로 흘리지 않는다.

### 2.8 ANSI/styled 스트림 redaction (R-PRIV-008, [[08-Decisions|D-042]])

live pane view([[SPEC-103-pane-live-stream]])가 **색(SGR)** 을 재현하려면 `capture-pane -e`(escape sequence 포함) 출력을 다뤄야 한다. 그러나 §2.2 카탈로그는 **평문 기준** 매칭이므로, SGR escape가 secret 리터럴 중간에 끼면(예: 색 변경으로 토큰이 `ghp_` + `\x1b[..m` + 나머지로 쪼개짐) 패턴이 깨져 **미탐(styled-bypass)**이 발생한다. 이는 T-01(secret 평문 노출)의 우회 경로다. 따라서 styled 노출은 아래 순서를 **불변식**으로 고정한다.

- **Phase 1 = plain(확정)**: live view도 기본은 `capture-pane -p`(no `-e`) plain capture다. 기존 `sanitizeCapture` 단일 chokepoint를 그대로 통과하므로 **새 redaction 위험이 0**이다([[08-Decisions|D-042]] (a)). 색은 Phase 1.5로 분리한다.
- **Phase 1.5 styled = 다음 순서만 허용(확정 순서, 값은 forward)**:
  1. **tokenize**: `-e` 출력을 escape 토큰과 텍스트 span으로 분해한다(escape는 상태, 텍스트는 콘텐츠).
  2. **strip → plain(전 escape 제거, 2026-07-02 리뷰 반영)**: 텍스트 span만 이어 붙여 **plain 텍스트**를 만든다. 이때 **SGR(`ESC [ … m`)만이 아니라 모든 ESC/C0/C1 제어 시퀀스**(CSI 전종, OSC `ESC ]…(BEL|ST)`, DCS/SOS/PM/APC `ESC P/X/^/_…ST`, 단독 C0/C1 제어문자)를 제거한다. **이유**: SGR만 벗기면 살아남은 non-SGR escape(예: OSC title·CSI cursor move)가 join된 "plain" 안에서 secret 리터럴을 다시 쪼개 `redact()` 매칭을 깨뜨린다(T-13 재발). 따라서 redact 입력은 **어떤 escape도 없는 순수 평문**이어야 한다.
  3. **redact(plain)**: 그 순수 평문에 §2.1 `redact()`(§2.2 카탈로그)를 **평문 기준 1회** 적용한다 — 기존 chokepoint 재사용.
  4. **style re-map**: redacted 출력 위에 (2)에서 보존한 SGR 스타일 span만 다시 입힌다(비-SGR escape는 재주입하지 않는다). **스타일 span은 `[REDACTED:<class>]` 토큰을 가로지르거나 쪼갤 수 없다** — redacted 토큰은 원자 단위이며, 그 경계에서 스타일을 잘라 맞춘다.
- **금지**: escape가 섞인 텍스트에 카탈로그를 **직접** 적용하는 것(redact-후-escape-재주입 포함)은 금지다([[08-Decisions|D-042]] (b)). 반드시 **모든 escape를 벗겨** redact한 뒤 SGR 스타일만 다시 입힌다.
- **캡(cap) 유지(nit 반영)**: styled 경로가 `redact()`를 직접 호출하더라도 line cap `N`·byte cap `B`(§2.1/§3.3)는 styled 스트림에도 그대로 적용된다 — capture는 `-S -<N>`로 취득하고 sanitizer의 byte tail-clamp(B) 이후 tokenize/redact하므로, styled 입력도 bound된다(무한 버퍼·ReDoS 입력 폭주 방지, T-10 정합).
- **fail-safe 게이트(확정)**: 이 변환과 [[SPEC-007-test-validation]] styled 케이스가 승인되기 전에는 **styled를 소비자/네트워크로 emit하지 않는다**(plain fallback). styled 경로의 `secret-recall`은 plain과 **동일(1.0 목표)**이어야 하며(§3.5), 그렇지 못하면 styled를 비활성한다([[08-Decisions|D-042]] (c)).
- **egress 불변식(PF-05 정식화)**: plain이든 styled든, WS로 나가는 프레임 텍스트는 **redaction chokepoint를 통과한 값만**이다(redaction-before-egress). 이는 §3.6 PF-05(“redacted preview가 browser로 전송될 때 redaction이 풀림”)를 **live/network 경계로 정식화**한 것이다.

## 3. Behavior rules

확정 규칙과 PoC 검증 가설을 구분한다.

### 3.1 ordering rule — redaction-before-consumption (확정, [[08-Decisions|D-016]])

1. pane 콘텐츠·환경 자유 텍스트 소비자(detection `recentOutput`/`paneTitle`/`cmdline`/`processTree[].command`, status `currentWorkSummary`, `cwd`, preview, table, `--json`, log)는 **오직 `sanitizeCapture`/`redact` 산출**만 본다. raw 버퍼(capture · `ps` snapshot/argv)는 sanitize 경계 밖으로 나가지 않는다.
2. 따라서 [[SPEC-003-agent-detection]]의 `PaneSignal`과 [[SPEC-004-status-inference]]의 summary 추출은 **redaction 적용 후** 입력을 받는다. ([[02-Requirements]] Open Question "summary를 redaction 전/후 어느 데이터로 추출하나?"를 **후(after)**로 확정 — [[14-MVP-PoC-Scope]] Current work summary 규칙과 일치.)
3. 이 순서는 검증 가능하다(§4 AC-06/AC-07): summary/preview/detection 어디에도 알려진 secret 샘플이 평문으로 나타나지 않는다.

### 3.2 redaction 적용 규칙 (확정 + 가설)

1. **확정**: §2.2 우선순위대로 적용(블록 → provider → env → generic). 같은 영역에 복수 패턴이 겹치면 더 이른(specific) 규칙이 이긴다.
2. **확정**: redaction은 자유 텍스트 필드(§2.3)에만 적용한다. 구조 식별자는 마스킹하지 않는다(식별·표시 보존).
3. **확정**: 대체 토큰 class는 안정 문자열이다. class를 추가/변경하면 본 spec 카탈로그와 의존 테스트를 함께 갱신한다.
4. **가설**: RP-10 generic 토큰 최소 길이(32자)와 "key-ish 맥락" 정의는 false-positive trade-off로 PoC 보정 대상이다(§3.5).

### 3.3 한계 적용 경계 (확정 — [[SPEC-002-tmux-discovery]] Q6 해소)

- **line cap `N`**: 수집 단계가 `-S -<N>`로 enforced(SPEC-002). 
- **byte cap `B`**: sanitizer가 redaction **이전** tail-clamp로 enforced(SPEC-006).
- **순서**: 수집(N줄) → byte clamp(B) → redact → tail slice(preview P줄, detection tail). 같은 redacted 버퍼에서 잘라 쓰며 raw로 되돌아가지 않는다.

### 3.4 tunable 한계 (모두 PoC 검증 가설)

| 상수 | 초기값(가설) | 소유 | 비고 |
| --- | --- | --- | --- |
| `CAPTURE_LINES` (N) | 200 | 수집: [[SPEC-002-tmux-discovery]] §2.4 | line window |
| `BYTE_CAP` (B) | 64 KiB | SPEC-006 sanitizer | tail 보존 clamp |
| `PREVIEW_LINES` (P) | 12 | SPEC-006(내용)/[[SPEC-005-data-contract]](shape) | preview tail |
| RP-10 generic min length | 32자 | SPEC-006 catalog | false-positive 민감 |

전부 [[SPEC-007-test-validation]] 측정으로 확정한다([[SPEC-000-conventions]] 표기 규칙).

### 3.5 false-redaction(과도 마스킹) 관리

- **위험**: 의미 있는 작업 텍스트(경로·해시·UUID·banner 등)가 secret으로 오인돼 가려지면, 사용자의 작업 이해와 detection의 banner 인식이 모두 저하된다([[02-Requirements]] Open Question, [[14-MVP-PoC-Scope]] PoC 지표 "false redaction").
- **측정**: [[SPEC-007-test-validation]]이 라벨 코퍼스를 둔다 — (a) **반드시 가려야 할 secret 샘플 집합**(placeholder; **secret을 내포한 cwd 경로 케이스 포함** — 예 `/home/u/work/ghp_<token>/repo`, §2.3 cwd redaction 검증, AC-17), (b) **가리면 안 되는 의미 텍스트 집합**(정상 경로·해시·UUID·banner). 지표 2개:
  - `secret-recall` = 가려진 secret / 전체 secret 샘플 = **1.0 목표**(known secret은 빠짐없이 마스킹).
  - `false-redaction-rate` = 잘못 가려진 의미 텍스트 / 전체 의미 텍스트 ≤ 임계(가설, 수동 검토로 허용 가능 — [[14-MVP-PoC-Scope]] 지표).
- **완화**: ① 대체 토큰을 class별로 서술적이게(`[REDACTED:aws-key]`) 유지해 사용자가 *무엇이* 가려졌는지 맥락을 잃지 않게 한다. ② specific 패턴을 generic보다 우선해 generic 발화를 최소화. ③ RP-10을 보수적·tunable로 운영. ④ **redaction-stats**(누적·class별 `matchCount`)를 **test-harness/debug-log 전용 관측 지표**로 유지해 과도 마스킹을 측정 가능하게 한다 — 단 이 counter는 **wire 계약에 직렬화하지 않는다**. [[SPEC-005-data-contract]]가 match count를 `preview`/`diagnostics` 등 출력 필드로 노출하지 않기로 확정했다(match 밀도가 secret-density 신호를 누설할 수 있음). 따라서 redaction-stats는 [[SPEC-007-test-validation]]의 false-redaction 측정과 debug log(§2.5, metadata-only·로컬 전용)에서만 접근하고 `--json`/table/preview 어디에도 싣지 않는다.

### 3.6 threat model (scan 슬라이스)

severity: High = secret 평문 노출/read-only 위반, Medium = 제한적 노출/안정성, Low = 사용성/잔여 리스크.

| ID | 위협 | 표면/벡터 | severity | 본 슬라이스 완화 |
| --- | --- | --- | --- | --- |
| T-01 | capture secret이 stdout으로 누출 | table/`--json` | High | redaction chokepoint(§2.1, §3.1) → AC-01~05 |
| T-02 | secret이 debug log로 누출 | persisted log file | High | capture 텍스트 미기록 + metadata-only + log redaction(§2.5) → AC-11 |
| T-03 | **summary 우회**: `currentWorkSummary`가 raw 기준 추출돼 secret 누출 | [[SPEC-004-status-inference]] | High | ordering rule: summary는 redacted 입력만(§3.1) → AC-07 |
| T-04 | error message가 capture 단편을 echo | `diagnostics.tmuxErrors[].message` | Medium | message = tmux stderr/메타만, 콘텐츠 불포함(§2.5) → AC-13 |
| T-05 | **redaction bypass**: 소비자가 raw 버퍼를 직접 읽음 | detection/preview 코드 경로 | High | 단일 sanitize 경계, raw 미노출(§2.1) → AC-06 |
| T-06 | over-redaction으로 의미 텍스트 손실 | redaction 자체 | Low | 서술적 label·specific 우선·보수적 generic·redaction-stats(test/debug 전용, wire 미직렬화)(§3.5) → AC-15 |
| T-07 | **read-only 위반**: 상태변경 subcommand 호출 | tmux exec 경로 | High | `tmuxExec` fail-closed allowlist + denylist + shell:false(§2.6) → AC-12 |
| T-08 | raw capture가 파일로 영구화 | full output 저장 | High | non-persistence: 저장 경로 미생성, D-008 기본 비활성(§2.5) → AC-10 |
| T-09 | 거대/병적 capture로 메모리 압박 | 긴 줄/대용량 출력 | Low | line cap N + byte cap B(§3.3) → AC-08/09 |
| T-10 | redaction 정규식 ReDoS(catastrophic backtracking) | 적대적 capture 콘텐츠 | Medium | 선형/경계 패턴, 탐욕 한정, 입력은 B로 bound(구현 제약, §6) |
| T-11 | **non-tmux subprocess 오남용**: process-introspection `ps` 경로의 셸 보간/상태 변경 명령 실행, 또는 cmdline argv secret 누출 | `pane_pid → ps` subprocess | High | allowlist 밖이나 동등 fail-safe: 고정 argv·`shell:false`·timeout(읽기 전용) + cmdline은 동일 `redact()` chokepoint 통과(§2.7, [[08-Decisions|D-019]]/[[08-Decisions|D-020]]) → AC-16 |
| T-12 | **cwd 경로 내 secret 누출**: 경로에 박힌 token이 통과돼 stdout/log로 노출 | `cwd` 필드(table/`--json`/log) | High | cwd도 단일 chokepoint `redact()` 통과(방어적, §2.3, [[08-Decisions|D-016]]) → AC-17 |
| T-13 | **styled-bypass**: SGR escape가 secret 리터럴을 중간에서 쪼개 평문 카탈로그 매칭이 깨져 미탐 | live view styled(`-e`) 스트림([[SPEC-103-pane-live-stream]]) | High | Phase 1 plain 고정 + Phase 1.5는 tokenize→strip→plain-redact→style-remap만 허용, escape-섞인 직접 redact 금지, `secret-recall`=plain(1.0) 게이트 전 emit 금지(§2.8, [[08-Decisions|D-042]]) → AC-20 |
| T-14 | **live egress redaction bypass**: raw capture가 redaction 전에 WS 프레임으로 전송(browser 노출) | live view 프레임 egress([[SPEC-103-pane-live-stream]]) | High | 전 프레임 `sanitizeCapture` 통과 redacted-only(§2.3/§2.5), PF-05 정식화(redaction-before-egress, §2.8) → AC-19 |

**pre-flag — 후속 server/control 슬라이스 도입 시 추가될 위협(여기서 spec하지 않음, 표시만)**:

| ID | 위협 | 트리거 슬라이스 | 소유 요구사항 |
| --- | --- | --- | --- |
| PF-01 | network 노출(외부 bind) | Slice 2 server | [[02-Requirements]] R-SEC-001/004 (`127.0.0.1` bind 기본) |
| PF-02 | state-changing API에 startup token 누락/유출 | Slice 2~4 | R-SEC-002/003, R-CTRL-004 |
| PF-03 | CORS 과다 허용 | Slice 2 server | R-SEC-005 |
| PF-04 | control mis-target(잘못된 pane에 send-keys) | Slice 4 control | R-CTRL-005(target 재검증), R-CTRL-008 |
| PF-05 | redacted preview/스트림이 browser로 전송될 때 redaction이 server-side 이전에 풀림 | Slice 2 transport → **정식화됨(2026-07-02)** | R-PRIV-002/**R-PRIV-008** (redaction-before-egress를 live/network 경계로 확장) |

> scan 슬라이스는 server/network/control 표면이 없으므로 PF-01~PF-04는 **본 spec 범위가 아니다**(후속 SPEC 표시). **PF-05는 2026-07-02 개정으로 정식화**되어 더 이상 pre-flag가 아니다 — live view 채널([[SPEC-103-pane-live-stream]])의 egress redaction 불변식으로 §2.3/§2.5/§2.8·T-14로 본 spec이 소유·검증한다(R-PRIV-008).

## 4. Acceptance criteria

> secret 예시는 실제 값 대신 토큰 shape/placeholder를 쓴다. "any output path" = { table stdout, `--json` 출력, debug log }.

```text
SPEC-006-AC-01 (R-PRIV-003, R-PRIV-002)
  Given capture 콘텐츠에 GitHub token 형태 `ghp_<token>`이 포함될 때
  When scan이 출력을 산출하면
  Then 그 token literal 부분문자열은 any output path 어디에도 나타나지 않고,
       sanitized 버퍼의 해당 위치는 `[REDACTED:github-token]`로 대체된다.
```

```text
SPEC-006-AC-02 (R-PRIV-003)
  Given capture에 `-----BEGIN RSA PRIVATE KEY----- … -----END RSA PRIVATE KEY-----` 블록이 있을 때
  When scan이 출력을 산출하면
  Then 블록 본문은 any output path에 나타나지 않고 `[REDACTED:private-key]` 한 토큰으로 대체된다(부분 누출 없음).
```

```text
SPEC-006-AC-03 (R-PRIV-003)
  Given capture에 `https://<user>:<password>@host/path` 형태 URL credential이 있을 때
  When scan이 출력을 산출하면
  Then userinfo(`<user>:<password>`)는 any output path에 나타나지 않고
       `https://[REDACTED:url-cred]@host/path`로 host/path는 보존된다.
```

```text
SPEC-006-AC-04 (R-PRIV-003)
  Given capture에 `API_KEY=<value>`(또는 SECRET=/TOKEN=/PASSWORD=) 할당 라인이 있을 때
  When scan이 출력을 산출하면
  Then `<value>`는 any output path에 나타나지 않고 key 이름은 유지되며 `API_KEY=[REDACTED:env-secret]`이 된다.
```

```text
SPEC-006-AC-05 (R-PRIV-003)
  Given capture에 AWS `AKIA<...>`, Slack `xox<b>-<...>`, JWT `eyJ<...>.<...>.<...>`,
        `Authorization: Bearer <token>`가 각각 포함될 때
  When scan이 출력을 산출하면
  Then 각 token literal은 any output path에 나타나지 않고
       각각 [REDACTED:aws-key]/[REDACTED:slack-token]/[REDACTED:jwt]/[REDACTED:bearer]로 대체된다.
```

```text
SPEC-006-AC-06 (R-PRIV-002)  [coherence — redaction-before-consumption]
  Given 임의의 raw capture가 있을 때
  When detection([[SPEC-003-agent-detection]] recentOutput)와
        status 추론([[SPEC-004-status-inference]] currentWorkSummary)이 pane 콘텐츠를 소비하면
  Then 두 소비자는 sanitizeCapture 산출(redacted 버퍼)만 입력으로 받으며,
       redaction 이전 raw 버퍼를 참조하는 코드 경로가 없다(단일 chokepoint).
```

```text
SPEC-006-AC-07 (R-PRIV-002)  [coherence — summary 우회 차단, T-03]
  Given 유일한 secret이 `ghp_<token>`이고 그 토큰이 summary 후보 텍스트에 포함된 capture에서
  When currentWorkSummary가 생성되면
  Then summary 문자열에 `ghp_<token>` literal이 포함되지 않는다(redacted 기준 추출).
```

```text
SPEC-006-AC-08 (R-PRIV-001)
  Given pane scrollback이 N(=CAPTURE_LINES, 가설 200)줄을 초과할 때
  When capture·sanitize가 수행되면
  Then capture-pane는 `-S -<N>`로 호출되고(line cap), sanitized 버퍼는 최대 N줄이며,
       preview tail은 최대 PREVIEW_LINES(가설 12)줄의 redacted 라인만 노출한다.
```

```text
SPEC-006-AC-09 (R-PRIV-001)
  Given capture가 B(=BYTE_CAP, 가설 64 KiB)바이트를 초과할 때
  When sanitizeCapture가 수행되면
  Then redaction 이전에 메모리 버퍼가 tail 보존으로 ≤ B 바이트로 clamp되고,
       preview의 truncated가 true가 된다.
```

```text
SPEC-006-AC-10 (R-PRIV-004)
  Given 전체 scan 1회 실행 동안
  When 파일시스템 쓰기를 관측하면
  Then capture 텍스트(raw 또는 redacted)를 담은 파일이 생성되지 않는다
       (capture 콘텐츠는 memory-only, full-output 저장은 D-008 기본 비활성).
```

```text
SPEC-006-AC-11 (R-PRIV-005, R-OBS-003)
  Given debug logging이 켜져 있고 capture에 `ghp_<token>`이 있을 때
  When debug log를 검사하면
  Then log에 capture 텍스트가 없고 `ghp_<token>` literal이 나타나지 않으며,
       각 항목은 metadata(timestamp/phase/command/paneId/exitCode/durationMs/matchCount)만 담고
       log에 쓰는 자유 텍스트는 redaction을 통과한다.
```

```text
SPEC-006-AC-12 (R-TMUX-001)  [read-only 강제]
  Given tmuxExec wrapper에 대해
  When 비-allowlist subcommand(`send-keys`/`paste-buffer` 등)로 호출하면
  Then wrapper는 throw/거부하며 process를 spawn하지 않고,
       전체 scan 실행 동안 실제 spawn된 tmux argv subcommand는
       {list-sessions, list-windows, list-panes, capture-pane} 및 `-V` probe뿐이다.
```

```text
SPEC-006-AC-13 (R-TMUX-004)  [error 격리 — privacy 관점]
  Given 어떤 pane의 capture-pane가 실패하고 그 pane의 capture가 `ghp_<token>`을 포함했을 때
  When diagnostics.tmuxErrors가 그 실패를 기록하면
  Then message는 tmux stderr/command 메타데이터만 담고
       `ghp_<token>`이나 다른 capture 콘텐츠를 포함하지 않는다([[SPEC-002-tmux-discovery]] AC-07 정합).
```

```text
SPEC-006-AC-14 (R-TMUX-004)  [timeout — bounded exposure]
  Given 어떤 tmux command가 timeout T를 초과할 때
  When scan이 실행되면
  Then 자식 process가 종료되어 capture 버퍼가 무한 보유되지 않고,
       scan은 예외 없이 결과를 반환한다(콘텐츠 누출 없는 bounded 종료).
```

```text
SPEC-006-AC-15 (R-PRIV-003)  [false-redaction 측정, PoC]
  Given [[SPEC-007-test-validation]]의 라벨 코퍼스(가려야 할 secret 집합 + 가리면 안 되는 의미 텍스트 집합)에서
  When redact를 적용해 측정하면
  Then secret-recall = 1.0(known secret 전부 마스킹)이고,
       false-redaction-rate ≤ 임계(가설, [[14-MVP-PoC-Scope]] 지표)이다.
```

```text
SPEC-006-AC-16 (R-TMUX-001, R-PRIV-002, [[08-Decisions|D-019]], [[08-Decisions|D-020]])  [non-tmux 읽기 전용 subprocess + cmdline redaction]
  Given process-introspection이 pane_pid로 비-tmux subprocess(`ps` 등)를 spawn하고
        그 pane의 cmdline(argv)에 `--token=ghp_<token>` 형태 secret이 포함될 때
  When scan이 실행되어 cmdline 신호를 소비/출력하면
  Then (a) subprocess는 고정 argv·`shell:false`·per-call timeout으로 호출되어
           셸 보간이나 상태 변경 명령이 발생하지 않고(읽기 전용, tmux allowlist 밖이나 동등 fail-safe 계약 §2.7),
       (b) cmdline 원문은 소비(detection/preview/log) 이전에 `redact()` 경계([[08-Decisions|D-016]])를 통과해
           `ghp_<token>` literal이 any output path 어디에도 나타나지 않는다.
```

```text
SPEC-006-AC-18 (R-PRIV-002, R-PRIV-005, [[08-Decisions|D-020]])  [subtree 전 노드 argv redaction — non-foreground 누출 차단]
  Given process subtree([[SPEC-002-tmux-discovery]] §2.9)에서 secret이 pane의 foreground 노드가 아니라
        **non-foreground subtree 노드** argv에 있을 때
        (예: depth≥1 wrapper 노드 `node /run.js --api-key=sk-<token>`; [[SPEC-007-test-validation]] planted-subtree 케이스)
  When scan이 실행되어 processTree(G-PROC) 신호를 소비/출력/log하면
  Then processTree의 **모든** 노드 argv가 노드별 `redact()` 경계([[08-Decisions|D-016]])를 통과하여
       `sk-<token>` literal이 any output path(table/`--json`/preview/debug log) 어디에도 나타나지 않으며,
       foreground 노드만 마스킹하고 non-foreground 노드를 누락하지 않는다.
```

```text
SPEC-006-AC-17 (R-PRIV-002, R-PRIV-003)  [cwd 경로 내 secret 마스킹]
  Given 어떤 pane의 cwd(`#{pane_current_path}`)가 secret을 내포한 경로일 때
        (예: `/home/u/work/ghp_<token>/repo`; [[SPEC-007-test-validation]] 코퍼스의 planted-cwd 케이스)
  When scan이 출력을 산출하면
  Then cwd는 redaction 경계(`redact()`, [[08-Decisions|D-016]])를 통과한 값으로만 노출되어
       그 secret literal이 any output path(table/`--json`/debug log) 어디에도 나타나지 않고,
       경로의 비-secret 구성요소는 보존된다(표시 가능성 유지).
```

```text
SPEC-006-AC-19 (R-PRIV-008, R-PRIV-002, [[08-Decisions|D-042]], [[08-Decisions|D-016]])  [live view egress = redacted-only, PF-05 정식화]
  Given live pane view([[SPEC-103-pane-live-stream]])가 어떤 pane 을 attach 해
        WS 프레임(pane_view_seed/pane_view)을 push 하고, 그 pane capture 에 `ghp_<token>`이 있을 때
  When 전송된 프레임을 관측하면
  Then 모든 프레임의 lines 는 sanitizeCapture 산출(redacted)만 담아
       `ghp_<token>` literal 이 어떤 프레임에도 나타나지 않고 [REDACTED:github-token]로 대체되며,
       raw capture 버퍼는 프레임·debug log·디스크 어디에도 도달하지 않는다(redaction-before-egress).
```

```text
SPEC-006-AC-20 (R-PRIV-008, [[08-Decisions|D-042]])  [styled-bypass 차단 — secret-recall = plain, 전 escape strip]
  Given `-e` capture 에서 secret 리터럴이 escape 로 쪼개진 두 케이스:
        (a) SGR 색 변경(`ESC [ … m`)이 토큰 중간에 삽입된 경우,
        (b) **비-SGR escape**(OSC title `ESC ] 0 ; … BEL` 또는 CSI cursor-move)가 토큰 중간에 낀 경우
        ([[SPEC-007-test-validation]] styled 코퍼스, non-SGR-split 케이스 포함)
  When styled 노출 경로가 tokenize→strip(**모든 ESC/C0/C1 제거**)→plain-redact→style-remap(§2.8)을 수행하면
  Then (a)와 (b) 모두 순수 평문으로 벗겨져 redact 되므로 secret literal 이 마스킹되어 출력에 나타나지 않고
       (styled 의 secret-recall == plain, 목표 1.0; SGR-only strip 으로 비-SGR 잔여가 재-split 하지 않음),
       재주입되는 것은 SGR 스타일 span 뿐이며 [REDACTED:*] 토큰을 가로지르거나 쪼개지 않고,
       이 변환·테스트가 승인되기 전에는 styled 를 emit 하지 않는다(plain fallback).
```

```text
SPEC-006-AC-21 (R-PRIV-002, R-PRIV-003, [[08-Decisions|D-016]])  [경계 절단 PEM — anchorless key-body 마스킹, RP-11]
  Given multiline PEM private key 블록이 line window N 에서 양분되어
        seed/preview 에 `-----BEGIN`/`-----END` 앵커 없이 key-body base64 만 남은 케이스
        (블록이 캡처 창 상단/하단에서 잘린 3종; [[SPEC-007-test-validation]] boundary-bisected-PEM 코퍼스)
  When scan 또는 live view seed([[SPEC-103-pane-live-stream]])가 출력을 산출하면
  Then RP-11 이 앵커 없는 key-body base64 run 을 [REDACTED:private-key]로 보수적으로 마스킹하여
       key-body literal 이 any output path(table/`--json`/preview/live 프레임/debug log) 어디에도 나타나지 않고
       (secret-recall = 1.0), 정상 대량 base64 는 false-redaction 임계 내로 유지된다(§3.5).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-PRIV-001 | capture line cap N(수집)·byte cap B(sanitizer)·preview redacted tail 제한 | SPEC-006-AC-08, SPEC-006-AC-09 |
| R-PRIV-002 | redaction-before-consumption 단일 chokepoint([[08-Decisions\|D-016]]; 출력·detection·summary·cmdline·**subtree 전 노드 argv**·cwd·**경계 절단 PEM** 전 적용) | SPEC-006-AC-01, SPEC-006-AC-06, SPEC-006-AC-07, SPEC-006-AC-16, SPEC-006-AC-17, SPEC-006-AC-18, SPEC-006-AC-21 |
| R-PRIV-003 | redaction 패턴 카탈로그(private key/AWS/GitHub/Slack/JWT/bearer/URL cred/env secret/api key/generic/**anchorless PEM RP-11**)와 cwd 경로 내 secret 마스킹·false-redaction 측정·경계 절단 PEM 보정 | SPEC-006-AC-01~05, SPEC-006-AC-15, SPEC-006-AC-17, SPEC-006-AC-21 |
| R-PRIV-004 | full output 비저장, capture memory-only, 파일 미생성(D-008) | SPEC-006-AC-10 |
| R-PRIV-005 | debug log에 capture 원문·subtree argv 원문 미기록 | SPEC-006-AC-11, SPEC-006-AC-18 |
| R-PRIV-008 | live view 채널 egress redaction(redacted-only 프레임, PF-05 정식화)·ANSI/styled 스트림 redaction(tokenize→plain-redact→style-remap, styled-bypass 차단, secret-recall=plain) — 메커니즘 소유, 채널 적용 [[SPEC-103-pane-live-stream]] | SPEC-006-AC-19, SPEC-006-AC-20 |
| R-OBS-003 | debug log redaction + metadata-only, error message 격리 | SPEC-006-AC-11, SPEC-006-AC-13 |
| R-TMUX-001 (enforcement, co-own) | read-only command set의 강제 wrapper(`tmuxExec` fail-closed allowlist). command set 정의는 [[SPEC-002-tmux-discovery]] | SPEC-006-AC-12 |
| R-TMUX-004 (safety) | error message 격리(privacy)·timeout bounded exposure | SPEC-006-AC-13, SPEC-006-AC-14 |
| [[08-Decisions\|D-019]] / [[08-Decisions\|D-020]] (co-own) | non-tmux process-introspection subprocess(`ps`)의 read-only 동등 안전 계약(고정 argv·`shell:false`·per-call timeout)과 cmdline **+ subtree 전 노드 argv** redaction-before-use(§2.7, 단일 snapshot). 수집은 [[SPEC-002-tmux-discovery]] §2.8/§2.9 | SPEC-006-AC-16, SPEC-006-AC-18 |
| [[08-Decisions\|D-016]] (방어 확장) | cwd 자유 텍스트의 단일 chokepoint redaction(경로 내 secret 구멍 차단, §2.3) | SPEC-006-AC-17 |
| [[08-Decisions\|D-042]] (본 spec 소유) | ANSI/styled 스트림 redaction 계약(tokenize→plain-redact→style-remap, Phase 1 plain fallback)·live egress redaction-before-egress·styled-bypass·PF-05 정식화(§2.3/§2.5/§2.8, §3.6 T-13/T-14). 채널 적용 [[SPEC-103-pane-live-stream]] | SPEC-006-AC-19, SPEC-006-AC-20 |

> R-TMUX-001은 [[SPEC-002-tmux-discovery]]가 **command set·capture 호출**을 1차 소유하고, 본 spec이 **강제 메커니즘(allowlist wrapper)**을 co-own한다. 전체 추적 매트릭스 통합은 [[SPEC-007-test-validation]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진/index 보정 필요)

- **C1 — README index 요구사항 행 보정**: [[README]] Spec 인덱스의 SPEC-006 행은 "R-PRIV-001~005, R-TMUX-004, R-OBS-003"으로 적혀 있다. 본 spec은 read-only **강제 메커니즘**으로 **R-TMUX-001(enforcement)**도 co-own하므로, index에 R-TMUX-001(enforcement) 추가가 필요하다. (index는 orchestrator가 중앙 조정 — 본 spec은 표시만.)
- **C2 — [[SPEC-002-tmux-discovery]] Q6(capture limit 경계) 해소**: 본 spec §2.1/§3.3이 경계를 확정한다 — line cap `N`은 **수집 단계(`-S -N`)**, byte cap `B`는 **sanitizer(redaction 이전 tail-clamp)**, redaction은 byte cap 이후 1회, preview/detection tail은 redacted 버퍼에서 slice. SPEC-002 Q6은 이 합의로 닫힌다.
- **C3 — preview shape vs 내용**: [[SPEC-005-data-contract]]가 `preview` shape를 소유한다. MVP 예시는 메타데이터(count/flag)만 노출한다. SPEC-005가 텍스트 preview를 추가하면 본 spec §2.4(redacted tail, raw 금지)를 따라야 한다. 두 spec 정합 확인 필요.
- **C4 — redaction vs detection banner(coherence)**: RP-10 generic 규칙이 [[SPEC-003-agent-detection]] G-OUT의 banner 식별 토큰을 가려 미탐을 유발할 수 있다. SPEC-003 §6 Q("redaction이 banner 토큰을 가리는지")와 공동으로 PoC 검증한다. banner 토큰은 secret이 아니므로 catalog가 가리지 않도록 보수적으로 운영.
- **C5 — live view 커서 조회 경로 vs [[08-Decisions|D-045]] 문구(2026-07-02)**: [[18-Terminal-Workspace]]/[[08-Decisions|D-045]]는 커서를 `display-message -p`로 조회한다고 예시하나, `display-message`는 현재 READONLY_ALLOWLIST에 없다. 본 spec §2.6은 **이미 allowlist에 있는 `list-panes` format 변수**(`#{cursor_x}`/`#{cursor_y}` 등)로 동일 값을 얻어 **allowlist 확장 없이** read-only 불변식을 유지하기로 co-own 결정했다([[SPEC-103-pane-live-stream]] §2.5/C1과 동일). D-045 ratify 시 문구를 `list-panes`로 정합화하거나, `display-message` 도입 근거가 있으면 read-only query로 allowlist에 추가하는 결정을 별도 확정해야 한다. **tmux-systems / security-privacy 리뷰 필요.**

### Open Questions (PoC 검증 대상)

- **Q1 — generic 토큰 규칙(RP-10) 보정**: 최소 길이(가설 32자)와 "key-ish 맥락" 정의의 false-positive/secret-recall trade-off. [[SPEC-007-test-validation]] 코퍼스로 보정. **검토 필요.**
- **Q2 — 한계값 N/B/P 확정**: `CAPTURE_LINES=200`·`BYTE_CAP=64KiB`·`PREVIEW_LINES=12`는 가설. latency([[14-MVP-PoC-Scope]] p95<1s)·메모리·preview 가독성 측정으로 확정.
- **Q3 — cwd redaction 여부 (해소: 본 spec §2.3 결정)**: `cwd` 절대 경로는 사용자 환경의 자유 텍스트라 secret이 박힐 수 있으므로(예: 경로 내 token), **방어적으로 단일 chokepoint([[08-Decisions|D-016]]) `redact()`를 cwd에도 적용**하기로 확정한다(이전 "통과(미적용)" 구멍을 닫음). 경로의 비-secret 구성요소는 보존돼 표시 가능성은 유지된다. 검증: SPEC-006-AC-17, [[SPEC-007-test-validation]] 코퍼스 planted-cwd 케이스(§3.5). 더 정교한 path-scoped 규칙(예: home 디렉터리 마스킹)은 후속 보정 여지로만 남기고 본 슬라이스의 미결 항목으로 두지 않는다.
- **Q4 — ReDoS 안전성(T-10)**: redaction 정규식이 적대적 입력에서 catastrophic backtracking을 일으키지 않는지(선형 보장/타임아웃)를 구현·테스트에서 검증한다.
- **Q5 — R-PRIV-006(사용자 preview 조정)**: preview 노출 on/off·line count 조정은 본 spec 범위가 아니라 [[SPEC-001-scan-cli]]/settings 소유. preview 끄기는 비저장 계약을 자명 강화한다(노출면 축소). 정합 확인.
- **Q6 — class 토큰 안정성 계약**: `[REDACTED:<class>]` class 집합을 어디까지 공개 계약으로 고정할지(소비자/테스트 의존). 변경 프로토콜은 §3.2-3을 따른다.
- **Q7 — styled(Phase 1.5) tokenizer 범위·성능(2026-07-02)**: §2.8 tokenize→strip→plain-redact→style-remap의 SGR 파서가 어디까지(색·굵기·OSC) 다룰지, 고빈도 live 스트림(250–500ms/프레임)에서 style-remap 비용이 감당되는지, redacted 토큰 경계에서 스타일 분할 규칙의 엣지 케이스를 [[SPEC-007-test-validation]] styled 코퍼스로 검증해야 한다. 승인 전 plain fallback. **검토 필요([[SPEC-103-pane-live-stream]] Q5 공동).**
- **Q8 — live view 프레임 redaction 재적용 비용**: live view는 tick마다(가설 250–500ms) `sanitizeCapture`를 수행하므로 redaction 정규식 성능(T-10 ReDoS 포함)이 실시간 경로에서도 bound돼야 한다. 입력은 여전히 byte cap `B`로 제한되나(§3.3), 고빈도 반복의 누적 비용을 [[SPEC-007-test-validation]]가 측정한다. **검토 필요.**
