---
spec: SPEC-008
title: Usage collection privacy contract — 세션 로그 read surface (token/cost 집계)
status: draft
updated: 2026-06-30
requirements: [R-P2-008, R-PRIV-007, R-PRIV-002, R-PRIV-004, R-PRIV-005, R-OBS-003]
decisions: [D-039, D-036, D-016, D-008]
tags:
  - specs
  - privacy
  - security
  - usage
  - redaction
  - read-only
  - forward
  - prestige
---

# SPEC-008 — Usage collection privacy contract (세션 로그 read surface)

[[SPEC-302-mascot-prestige-tiers]]의 prestige tier(R-P2-008, proposed)는 orc별 **누적 LLM token/cost**(`Orc.usage`, [[SPEC-005-data-contract]] §2.1 forward)를 요구한다. 그 유일한 현실적 출처는 각 agent 세션의 **transcript/usage 로그 파일**이다 — Claude Code 세션 JSONL(`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`), Codex 세션 로그(`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`) 등. 이는 tmux `capture-pane`를 넘어서는 **새로운 read surface**이며, 이 파일들은 **전체 대화 텍스트·소스코드·secret·절대 경로·tool 입출력**을 담는다([[SPEC-302-mascot-prestige-tiers]] §2.2가 이 spec으로 격리·게이트함).

이 spec은 그 새 read surface의 **구속력 있는 privacy/security 계약(binding contract)**이며, [[SPEC-006-privacy-redaction]]의 단일 redaction chokepoint·비저장·read-only 불변식을 이 surface로 **확장**한다. 본 spec은 후속 구현 단계가 **무엇을 해도 되고 무엇을 절대 하면 안 되는지**를 검증 가능한 규칙으로 고정하고, 구현 착수의 **GO / NO-GO 판정**(§1.1)을 내린다.

> **핵심 불변식(data-minimization chokepoint, [[08-Decisions|D-039]])**: 세션 로그에서 parser 밖으로 나갈 수 있는 것은 **닫힌 집합의 집계 스칼라**(`cumulativeTokens` / `cumulativeCostUsd` / `source` / `measuredAt`)뿐이다. transcript 원문(message body·tool I/O·코드·경로·secret)은 **저장·log·직렬화·반환·캐시되지 않으며**, parser는 그 필드를 **구조적으로 건너뛴다**(읽지도 보유하지도 않는다). 이는 [[SPEC-006-privacy-redaction]] §3.1 redaction-before-consumption 불변식의 자매 규칙이다 — 그쪽이 "노출 전 redaction"이라면 본 surface는 한 단계 더 강하게 "**애초에 숫자만 추출**"이다.

> **상태(draft·gated)**: 본 기능 데이터 의존성은 R-P2-008(proposed) forward다. 본 spec은 schema-first 계약을 고정하되, 구현은 §1.1 GO 조건을 **전부** 충족할 때만 착수 가능하다. 미구현 동안 `Orc.usage=null`→tier 0이 정상 동작이다([[SPEC-302-mascot-prestige-tiers]] §3.2).

## 1. Scope

### In scope

- 세션 로그 read surface의 **threat model**(§3): 무엇을 읽고, 어디 있고, 어떤 민감 내용을 담고, 구체적 risk가 무엇인가.
- **data-minimization 계약**(§4.1): parser 밖으로 나가는 것은 `OrcUsage` 4개 스칼라뿐. 원문 비저장·비직렬화·비log·비반환. provider-emitted usage 요약을 message body 스캔보다 우선.
- **file-access 경계**(§4.2): 디스크 전수 스캔 없이 pane→세션 파일 locate, root 확정(confinement), ownership/permission 검사, symlink escape 거부, bounded/incremental read(size·time·line cap), 부재·불가·모호 시 `null`(best-effort·degradable·단정 금지).
- **open-handle(fd) 상관**(§4.2a, amended): agent 프로세스의 **실제 열린 파일**로 세션 로그를 결정적으로 지목(mtime 추측 대체) — read-only·fixed-argv·numeric-pid·in-root+ext만 발췌, over-disclosure 차단.
- **identity mapping**(§4.3): usage가 어느 orc(`paneId`)에 귀속되는가, 모호하면 어떻게(misattribution 금지).
- **provider 계약**(§4.4): Claude Code JSONL usage 필드, Codex usage, generic/unknown fallback(`null`). provider-pluggable.
- **비저장 데이터 흐름표**(§4.5, [[SPEC-006-privacy-redaction]] §2.5 확장)와 **redaction chokepoint 확장**(§4.6, defense-in-depth).
- **GO/NO-GO 판정**(§1.1)과 P0/P1 finding·mitigation(§5), 측정 가능한 수용 기준(§6, 비-누출 테스트 포함).
- 다룬 요구사항: R-PRIV-007(신규 proposed, 본 spec 1차 소유), R-PRIV-002/004/005·R-OBS-003(기존 불변식의 본 surface 확장), R-P2-008(feature driver).

### Out of scope (다른 spec/슬라이스로)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| `usage`→tier index 판정·latch·variant resolution | tier 소비 | [[SPEC-302-mascot-prestige-tiers]] |
| `Orc.usage` **wire shape**·직렬화·envelope | 출력 데이터 계약 | [[SPEC-005-data-contract]] §2.1(forward) |
| tmux capture 콘텐츠 redaction·read-only allowlist·cmdline/subtree argv 경계 | 기존 scan surface | [[SPEC-006-privacy-redaction]] |
| 정확한 model→price 표·cost 추정 정밀도 | 도메인 데이터(검토 필요 Q3) | 본 spec은 `source='estimated'` 표시만 강제 |
| usage가 server/API로 직렬화될 때의 network 경계 | 후속 server 슬라이스 | Epic 2([[SPEC-101-snapshot-api]]); 본 spec은 **pre-flag만**(§3.2 PF-U01, [[08-Decisions|D-024]]) |

### 1.1 판정 — GO / NO-GO (구현 게이트, [[08-Decisions|D-039]])

> **판정: CONDITIONAL GO.** 세션 로그에서 **집계 스칼라만** 추출하는 usage collector의 구현을 **조건부 승인**한다. 아래 G1~G9 게이트를 **전부** 충족하는 구현만 허용되며, "금지" 목록 중 **하나라도** 위반하면 즉시 **NO-GO**(머지 차단)다. 게이트는 각 수용 기준(§6)으로 테스트 가능하다.

> **Amendment(2026-06-30) — 2건 판정**:
> - **A1 (correlation coverage) = GO**: 복수 세션 파일로 대부분 orc가 `null`이 되는 문제(현 as-built ~3/28 해소)를, **mtime 추측이 아니라** agent 프로세스의 **실제 open file descriptor**를 보는 **결정적** 상관(§4.2a, macOS `lsof`/Linux `/proc/<pid>/fd`)으로 해소하도록 **승인**한다. 새 게이트 **G9**·새 AC **AC-12/AC-13**·새 위협 **T-U10/T-U11**·`UsageLocateHint.agentPids` hint 계약을 추가했다. mtime tie-break은 **여전히 금지**(§4.2 (3), §4.3).
> - **A2 (Codex provider) = CONDITIONAL GO**: file-access/confinement 계약은 **승인**(root가 이미 `~/.codex/sessions/`로 고정돼 secret 형제 파일은 구조적으로 root 밖). 단 usage **key 경로 실측 미확정**(Q1)이므로 schema를 §4.4 (a)~(e)로 **ConfinedReader 실측 확인 + SPEC-007 fixture 추가** 전까지 Codex provider는 **`null` 유지**(현 stub이 정답). 자세한 제약은 §4.4.

**GO 조건(전부 충족 필수):**

| # | 조건 | 검증 AC |
| --- | --- | --- |
| G1 | parser는 `OrcUsage` 4개 스칼라만 산출하고 transcript content 필드(message body·tool I/O·code·경로)를 **구조적으로 건너뛴다**(읽지도 보유도 안 함) | SPEC-008-AC-01 |
| G2 | transcript content가 **어떤 출력 경로**(table·`--json`·preview·debug log)에도 도달하지 않는다(non-leak 입증) | SPEC-008-AC-02 |
| G3 | 원문이 **파일·캐시·debug log**로 영구화되지 않는다(debug log는 metadata-only) | SPEC-008-AC-03 |
| G4 | 파일 접근은 allowlist root에 **confine**되고 symlink escape 거부·ownership 검사·no-follow/TOCTOU-safe·read-only다 | SPEC-008-AC-04, AC-05, AC-11 |
| G5 | 읽기는 byte·line·time으로 **bounded**(whole-file 적재 금지) — DoS 불가 | SPEC-008-AC-06 |
| G6 | 부재·불가·모호·parse 실패·한계 초과 → `usage=null`, degradable·per-orc 격리, **예외로 scan 중단 금지** | SPEC-008-AC-07, AC-10 |
| G7 | identity 상관(correlation)이 **모호하면 null** — 다른 orc로 misattribute 금지. 모호 해소는 **결정적 신호**(명시 session-id, **process의 실제 open-handle**(§4.2a))만 쓰고 **mtime '최근' tie-break은 금지** | SPEC-008-AC-08, AC-12 |
| G8 | provider-pluggable, unknown→`null`, **사용자 지정 임의 경로 read 금지**(root는 고정) | SPEC-008-AC-09 |
| G9 | open-handle(fd) 상관은 **read-only·fixed-argv·numeric-pid**로 pane **자신의 subtree pid**만 조회하고(타 pid 스캔 금지·`-n -P`로 network/DNS 부작용 없음), open file 목록 중 **고정 root 아래 + 기대 확장자**만 후보로 쓰며 나머지 fd 경로는 **읽지도 보유도 log도 안 함**(over-disclosure 차단) | SPEC-008-AC-12, AC-13 |

**금지(위반 시 NO-GO):**

- transcript의 message body·tool 입출력·코드·**파일 경로**·secret을 읽기/파싱하여 **반환·저장·log·캐시**하는 것.
- 로그를 찾기 위해 `$HOME`/디스크를 **광범위 스캔**(glob/walk)하는 것 — 고정 root 밖 탐색 금지.
- allowlist root 밖으로 향하는 **symlink를 따라가는** 것, **다른 사용자 소유** 파일을 읽는 것.
- transcript 원문 또는 **raw usage JSON 객체/메시지별 분해값**을 직렬화·노출하는 것.
- 상관이 모호한데 세션을 **추측**해 귀속시키는 것(특히 **mtime '가장 최근' tie-break**은 추측이므로 금지 — 모호 해소는 §4.2a open-handle 같은 **결정적** 신호만).
- open-handle 조회로 얻은 **fd 목록(다른 파일 경로·secret·socket)** 을 **보유·log·반환**하거나, pane **자신의 subtree 밖** pid를 조회하는 것.
- usage 수집이 scan을 **중단·block**하게 두는 것(bounded·isolated 아님).
- 4개 스칼라 외 어떤 값이라도 출력/network 경계 밖으로 내보내는 것([[SPEC-101-snapshot-api]] 후속, PF-U01).

> 근거: 필요한 데이터는 **순수 집계 숫자**뿐이고, 그것을 얻는 데 transcript content를 보유할 이유가 없다(provider가 line별 `usage` 객체를 이미 emit). 따라서 위험 표면(content 누출)은 **구조적으로 제거 가능**하며, 본 계약은 그 구조를 강제한다. content를 다루는 어떤 경로도 본 기능에 **불필요**하므로 금지로 둔다.

## 2. 산출 계약 (parser 밖으로 나가는 유일한 것)

[[SPEC-302-mascot-prestige-tiers]] §2.2 / [[SPEC-005-data-contract]] §2.1(forward)가 정의하는 `OrcUsage`가 **전부**다. 본 spec은 이 4개 필드 외 어떤 것도 parser 경계를 넘지 못함을 강제한다.

```ts
interface OrcUsage {
  cumulativeTokens: number | null;   // 세션 누적 billable tokens(input+output[+cache, Q4]). 불가 시 null
  cumulativeCostUsd: number | null;  // 누적 추정 cost(USD). 불가 시 null
  source: 'transcript' | 'estimated' | 'unknown';  // 출처/신뢰 표시
  measuredAt: string | null;         // ISO 8601. 측정 시각(=file mtime 또는 마지막 event ts). 경로/내용 아님
}
// Orc.usage: OrcUsage | null   // null = 미측정/수집 불가(단정 금지)
```

- 이 객체는 **숫자·enum·timestamp**만 담는다. **string 자유 텍스트(경로/모델명/라벨/메시지)를 절대 담지 않는다.** `source`는 닫힌 enum이고 `measuredAt`은 timestamp다.
- `measuredAt`은 timestamp이므로 content가 아니다. 단, transcript 내 임의 문자열(예: `gitBranch`/`cwd`)을 여기에 넣어선 안 된다(형식 검증으로 ISO 8601만 허용).
- 값(토큰 수·cost)은 **저민감 집계**다. 그러나 그 값을 얻는 경로가 content를 메모리에 보유(line 단위 폐기 초과)하거나 content를 log해선 안 된다(§4.1).

## 3. Threat model — 새 read surface

severity: High = content/secret 평문 누출·read-only/경계 위반·타 사용자 파일 접근, Medium = 제한적 노출·misattribution·안정성, Low = 잔여/저민감.

### 3.1 읽는 대상과 민감 내용

| provider | 위치(root) | 형식 | 담긴 민감 내용 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` | JSONL(event/line) | line마다 `cwd`·`gitBranch`·`sessionId` + `message.content`(전체 대화)·`message.model`·`message.usage`. tool 입출력·코드·secret 포함 가능 |
| Codex | `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` | JSONL(`{type,timestamp,payload}`) | `payload`에 대화/명령/출력. **형제 경로 `~/.codex/{auth.json,.env,config.toml}`은 secret 자체** — root는 `sessions/`로 한정 |
| unknown / 기타 | (없음) | — | provider 미상 → parser 없음 → `usage=null` |

> ⚠️ Claude JSONL은 **usage가 든 줄에도 `cwd`/`gitBranch`/`message.content`가 함께** 있다(실측 키: top=`cwd,gitBranch,sessionId,message,timestamp,type,…`; `message`=`content,model,role,usage,…`; `usage`=`input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens,…`). 즉 "메타데이터 줄"이라도 content·경로를 품으므로, parser는 **`message.usage` 하위의 숫자 키와 `timestamp`만** 키-주소로 꺼내고 나머지(특히 `content`/`cwd`/`gitBranch`)는 **건드리지 않는다**.

### 3.2 위협표

| ID | 위협 | 표면/벡터 | severity | 본 spec 완화 |
| --- | --- | --- | --- | --- |
| T-U01 | transcript content가 출력으로 누출 | parser가 content를 반환→`--json`/preview/table/summary/snapshot | High | data-minimization: 스칼라만 산출, content 구조적 skip(§4.1) → AC-01, AC-02 |
| T-U02 | content 우발 영구화 | transcript 캐시·offset에 content 동반·debug log에 line 기록 | High | 비저장 데이터 흐름표: line 즉시 폐기, offset+합계만, log metadata-only(§4.5) → AC-03 |
| T-U03 | **타 사용자 파일 읽기** | path가 `/Users/<other>/.claude/…`로 해석, 다른 uid 소유 | High | root confinement + `st_uid==getuid()` ownership 검사(§4.2) → AC-05 |
| T-U04 | **symlink/path traversal** | `<session>.jsonl`이 `/etc/…`·`../../other`로의 symlink, encoded-cwd에 `..` | High | realpath 후 root prefix 단언, escape 거부, 최종 컴포넌트 `O_NOFOLLOW`(§4.2) → AC-04 |
| T-U05 | huge-file DoS / memory blowup | 다 GB JSONL·병적으로 긴 줄·무한 줄 수 | Medium | byte/line/time cap, streaming 폐기, whole-file 적재 금지(§4.2) → AC-06 |
| T-U06 | **misattribution** | 잘못된 세션 파일을 pane에 귀속 → 다른 agent usage 노출/오염 | Medium | 명시 session-id 상관 우선, 모호→null, 추측 금지(§4.3) → AC-08 |
| T-U07 | TOCTOU(검사-후-치환) | ownership/symlink 검사 후 파일이 교체됨 | Medium | stat-then-open 아닌 open-then-fstat(열린 fd 기준 검증)(§4.2) → AC-11 |
| T-U08 | 적대적 JSONL로 parser 남용(ReDoS/폭주) | 악의적 content가 든 줄 | Medium | content를 정규식 스캔하지 않음(키-주소 추출), size로 bound, JSON.parse 실패는 그 줄 skip(§4.4) |
| T-U09 | 집계 숫자로 세션 존재/규모 누설 | `usage` 값 자체 | Low | 값은 저민감 집계. content 비포함. 후속 server 노출은 token-gated([[08-Decisions|D-024]]) |
| T-U10 | **open-handle 조회의 over-disclosure** | `lsof -p`/`/proc/<pid>/fd`는 그 프로세스의 **모든** open file(타 프로젝트 경로·secret 파일·socket)을 노출 | Medium | §4.2a: **고정 root + 기대 확장자**만 후보로 발췌, 나머지 경로는 **즉시 폐기·미보유·미log**, raw 출력 비저장, `-n -P`로 reverse-DNS(network) 부작용 차단 → AC-13 |
| T-U11 | **pid 재사용/오-pid misattribution** | ps snapshot의 pid가 lsof 시점에 재사용돼 무관 프로세스 open file을 채택 | Medium | pid는 동일 scan의 ps snapshot(그 시점 alive) 출처·pane **자신의 subtree 한정**, snapshot 직후 조회. 채택 파일은 여전히 in-root+ownership+`.jsonl` 통과해야 하고 후보가 정확히 1개일 때만 채택(복수/0→null). 잔여 위험은 자기 소유 데이터 한정·창 무시가능 | AC-12, AC-08 |

**pre-flag — 후속 server/control 슬라이스 도입 시 추가될 위협(여기서 spec하지 않음, 표시만):**

| ID | 위협 | 트리거 | 소유 |
| --- | --- | --- | --- |
| PF-U01 | `Orc.usage`가 API로 직렬화될 때 4개 스칼라 외가 새거나 read 표면이 무토큰 노출 | Slice 2 server | [[SPEC-101-snapshot-api]], [[08-Decisions|D-024]](read도 token-gated). 본 spec G-금지 §1.1을 network 경계로 확장 |
| PF-U02 | user-defined usage source/경로(plugin)로 임의 파일 read | 확장 | [[SPEC-800-extensibility]]; root 고정 원칙(§4.2)을 plugin 경계로 확장(trust-gated) |

## 4. Contract

### 4.1 data-minimization (parser 경계, [[08-Decisions|D-039]])

- **유일 산출**: parser는 `OrcUsage`(§2)만 반환한다. 그 외 어떤 필드/문자열도 반환·전역상태·캐시에 남기지 않는다.
- **구조적 content skip**: usage는 **키 주소**로 꺼낸다 — Claude는 `message.usage.{input_tokens,output_tokens,cache_*}`와 top-level `timestamp`, Codex는 해당 usage payload의 숫자 필드. `message.content`/`cwd`/`gitBranch`/`tool_*`/`payload`의 비-usage 부분은 **읽어서 변수에 담지 않는다**(JSON.parse 결과에서 해당 key만 즉시 발췌하고 나머지 참조를 폐기). 전체 줄 문자열은 발췌 직후 폐기한다.
- **provider 요약 우선**: provider가 line별 `usage` 객체를 이미 emit하므로 **message body를 스캔하지 않는다**(R-PRIV-007). cost는 provider가 명시 cost를 주면 `source='transcript'`, 토큰에서 model→price로 추정하면 `source='estimated'`, 둘 다 불가면 `source='unknown'`+`null`.
- **defense-in-depth(§4.6)**: 만에 하나 자유 텍스트가 산출 경계에 닿으면(설계상 없어야 함) [[SPEC-006-privacy-redaction]] `redact()`를 통과시키는 floor를 둔다. 단 1차 방어는 **구조적 비-추출**이지 redaction이 아니다(content를 애초에 안 들고 옴).

### 4.2 file-access 경계 (R-PRIV-007, [[08-Decisions|D-039]])

- **디스크 전수 스캔 금지·deterministic locate**: pane→세션 파일은 다음 순서로 **좁게** 찾는다. 각 단계는 모두 **결정적**이며(추측 없음), 위 단계가 확정하지 못하면 다음으로 넘어간다.
  1) pane의 process argv(이미 redaction 경계를 통과한 [[SPEC-002-tmux-discovery]] §2.9 `processTree`)에 **명시 session-id**(예 `--session-id`/`--resume <id>`)가 있으면 그 id로 파일을 직접 지목(가장 강함).
  2) **(신규) open-handle(fd) 상관(§4.2a)**: pane **자신의** agent process(및 그 subtree 노드)가 **현재 열어 둔** 파일 중, **고정 root 아래 + 기대 확장자(`.jsonl`)** 인 것이 **정확히 하나**면 그 파일을 채택한다 — 이는 그 프로세스의 **실제 open handle**이므로 휴리스틱이 아니라 결정적이다. 0개 또는 복수 → 다음 단계.
  3) orc `cwd`(이미 수집됨)로 provider별 디렉터리를 **1단계만** 결정(Claude: `cwd`를 encoded-dir 규칙으로 변환해 그 **한 디렉터리** 안의 `*.jsonl`만 나열). 그 안에 `*.jsonl`이 **정확히 하나**일 때만 채택한다. **복수면 mtime '가장 최근' 같은 tie-break을 쓰지 않는다**(추측 = misattribution, T-U06) → null.
  4) 위로 확정 불가(후보 0 또는 복수 모호) → `usage=null`(§4.3).
  - `$HOME`/디스크 전역 glob·walk·`find`는 **금지**. 항상 고정 provider root 아래의 **단일 디렉터리 나열**(3)과 **pane 자신 프로세스의 open-handle 조회**(2)만 허용한다.
  - **mtime 정정**: 이전 초안의 "단일·최근(mtime 정합)" 문구는 폐기한다 — as-built는 **정확히 1개일 때만** 채택하며 mtime tie-break은 하지 않는다. 복수 후보의 모호성은 (2) open-handle 상관으로 **결정적으로** 푼다.
- **root confinement(고정 allowlist)**: 후보 경로는 **realpath로 정규화한 뒤** allowlist root prefix에 속함을 단언한다. root는 코드 고정이며 사용자 입력으로 바뀌지 않는다.
  - Claude: `~/.claude/projects/` 하위.
  - Codex: **`~/.codex/sessions/` 하위만**(형제 `~/.codex/auth.json`·`.env`·`config.toml`은 secret이므로 root 밖 — 절대 접근 안 함).
  - realpath 결과가 root prefix를 벗어나면(symlink escape 포함) **거부→null**.
- **ownership/permission**: 열린 파일의 `fstat`로 `st_uid === process.getuid()` 확인(타 사용자 소유 거부), 정규 파일(regular file)만 허용(디바이스/FIFO/디렉터리 거부).
- **symlink/TOCTOU 안전**: 최종 컴포넌트는 가능하면 `O_NOFOLLOW`로 열고, **stat-then-open이 아니라 open-then-fstat**로 열린 fd 기준 검증한다(검사 후 치환 차단, T-U07). dir 나열 단계도 realpath 후 root 재확인.
- **bounded/incremental read**:
  - byte cap `U_BYTES`(가설, §5.1)·line cap `U_LINES`·per-file wall-clock `U_TIME`을 둔다. 초과 시 거기서 멈추고 best-effort 합계 또는 null.
  - **streaming**: 줄 단위로 읽어 usage 발췌 후 줄 폐기. whole-file을 메모리에 적재하지 않는다.
  - `--watch`/반복 scan: 파일별 **byte offset + 누적 합계**만 메모리에 보관하고 다음 scan은 tail(신규 줄)만 읽는다. **content는 보관하지 않는다**(offset+숫자만).
- **degradable / fail-to-null**: 부재·권한 거부·parse 실패·플랫폼 미지원·한계 초과·모호 → `usage=null`. usage 수집 실패는 **에러가 아니라** 그 orc의 `null`이며, 다른 orc·전체 scan을 중단시키지 않는다(per-orc 격리, 예외 미전파).

### 4.2a open-handle(fd) 상관 — 세 번째 read-only subprocess 경계 (R-PRIV-007, [[08-Decisions|D-039]] 확장)

**근거**: agent 프로세스는 자기 세션 JSONL에 **append 중이므로 그 파일을 OPEN한 채로 보유**한다. 따라서 "그 프로세스가 무엇을 열고 있는가"를 보면 세션 파일을 **추측이 아니라 사실로** 지목할 수 있다. 이는 §4.2 (3)의 "디렉터리에 파일이 하나뿐일 때만"이 풀지 못하는 **복수 세션 파일** 케이스(현 as-built에서 대부분 orc가 `null`이 되는 원인)를 결정적으로 해소한다. mtime '최근값' 추측과 달리 **misattribution을 만들지 않는다**(AC-08).

이 조회는 tmux도 `ps`도 아닌 **세 번째 read-only 진입점**이며, [[SPEC-006-privacy-redaction]] §2.7의 non-tmux subprocess fail-safe 계약(고정 argv·`shell:false`·per-call timeout·read-only)을 **그대로 따른다**. 본 surface의 소유는 SPEC-008이다(SPEC-006 §2.7 패턴이 governing precedent; allowlist는 tmux 바이너리에만 적용되므로 이 명령은 그 밖이나 동등 fail-safe다).

**입력(pid)**: 조회 대상 pid는 **pane 자신의** `processTree`(§2.9, 이미 수집·alive) 노드 pid뿐이다 — agent runtime 노드를 우선하되 그 **subtree 후손**까지(파일을 실제로 연 것이 wrapper 체인의 자식일 수 있음). pid는 **숫자**이므로 redaction과 무관하고, 양의 정수임을 검증한다. **이 pane subtree 밖의 pid는 절대 조회하지 않는다**(T-U11, 타 orc·시스템 프로세스 금지).

> **구현 계약(hint)**: `UsageLocateHint`에 pane 자신의 subtree pid 집합 `agentPids: number[]`(processTree 노드 pid; agent runtime 노드 우선)을 추가한다. 숫자만 담고, 이 pane subtree 밖 pid를 담지 않는다. `processTree=null`이면 빈 배열 → fd 상관은 **skip**(→ §4.2 (3)으로). (현 `UsageLocateHint`는 `processTreeCommands`만 갖고 pid를 갖지 않으므로 이 필드 추가가 본 amendment의 유일한 hint 계약 변경이다.)

**명령 계약(플랫폼별, 고정 argv)**:

- **darwin(macOS)** — `lsof`:
  - 고정 argv: `lsof -n -P -b -w -F n -p <pid>`. `<pid>`는 검증된 양의 정수 하나(또는 per-pid 반복). `-n`(host 미해석)·`-P`(port 미해석)로 **reverse-DNS 등 network 부작용을 차단**(T-U10), `-b -w`로 blocking/경고 억제, `-F n`로 **name 필드만** machine-parseable 출력. `shell:false`, 사용자 텍스트 비보간.
  - per-call timeout `T`([[SPEC-006-privacy-redaction]] §2.6 / [[SPEC-002-tmux-discovery]] §2.6와 동일)와 SIGTERM→SIGKILL. 출력은 byte/line cap으로 bound.
  - `lsof` 부재(미설치)·non-zero·denied·timeout → 이 단계 **skip**(→ §4.2 (3) or null). 절대 throw 안 함.
- **linux** — `/proc/<pid>/fd/`:
  - **subprocess 없이** `/proc/<pid>/fd/` 항목을 (개수 cap 하에) 나열하고 각 fd 심볼릭링크를 **`readlink`로 target 경로 문자열만** 얻는다(대상 파일을 **open/follow하지 않는다**). 타 uid 프로세스의 `/proc/<pid>/fd`는 커널이 거부 → **fail-closed → skip**.
  - fd 개수가 비정상적으로 많으면(병적 프로세스) cap에서 멈춘다.

**채택 규칙(data-minimization, over-disclosure 차단 — T-U10)**:

- 얻은 경로 각각을 `realpath` 후 **고정 provider root 아래인지 + 기대 확장자(`.jsonl`)인지** 검사하고, **그 조건을 만족하는 것만** 후보로 발췌한다. **나머지 fd 경로(타 프로젝트 파일·secret·socket·pipe)는 읽지도, 변수로 보유하지도, log하지도 않는다** — 전체 목록을 retain하지 않고 스트리밍 발췌 직후 폐기한다.
- 후보가 **정확히 하나**면 그 경로를 §4.2 reader로 넘긴다(여전히 G4: realpath-under-root·`O_NOFOLLOW`·open-then-fstat·`st_uid==getuid()`를 **통과해야** open — fd 상관은 **후보를 제안만** 하고 confinement 게이트는 그대로 적용된다, defense-in-depth).
- 후보가 **0개 또는 복수**면 이 단계는 **확정 실패**(→ §4.2 (3) or null). 추측해서 하나를 고르지 않는다(AC-12).
- raw `lsof`/`readlink` 출력·비매칭 경로는 debug log에 **절대 기록하지 않는다**(§4.5; debug log는 metadata-only 유지).

**coverage 주의(검토 필요)**: 이 방법은 agent가 그 시점 파일을 **열어 둔** 경우에만 후보를 준다(보통 active/최근 기록 중인 세션). agent가 write 사이에 fd를 닫는 구현이면 idle orc는 후보 0 → §4.2 (3) fallback(복수 파일이면 null)로 떨어진다. 그래도 현 as-built보다 **엄격히 더 많이** 결정적으로 해소하며 misattribution은 0이다. claude/codex가 idle 동안 fd를 유지하는지, 실제 해소율은 [[SPEC-007-test-validation]] live-orc oracle로 **측정**한다(Q2).

### 4.3 identity mapping (misattribution 금지, [[08-Decisions|D-017]])

- usage는 `paneId` 권위로 특정 orc에 귀속한다(D-017). 상관 체인은 §4.2 locate 순서(**명시 session-id → open-handle(fd) 상관(§4.2a) → cwd 디렉터리 단일 `.jsonl` → null**)와 동일하다. 세 신호 모두 **결정적**이다(추측 없음).
- **모호하면 null**: 명시 id가 없고, fd 상관 후보가 0/복수이며, 디렉터리에 `.jsonl`이 복수면(또는 cwd↔encoded-dir 정합이 깨지면) **추측하지 않고 `usage=null`**. **mtime '최근' 등 임의 선택은 T-U06 misattribution이므로 금지**. 복수 후보의 정상적 해소 수단은 (1) 명시 id 또는 (2) 실제 open-handle뿐이다.
- **`orc-unknown`/provider 미상**: agent type을 모르면 provider parser가 없으므로 `usage=null`(§4.4 fallback). [[SPEC-302-mascot-prestige-tiers]] §3.2에서 정상적으로 tier 0이 된다.
- 어떤 경우에도 한 세션의 usage를 **다른 pane**에 붙이지 않는다.

### 4.4 provider 계약 (pluggable)

provider 경계는 [[08-Decisions|D-031]] detector-adapter 정신을 따른다: code-first `UsageProvider` 인터페이스, root는 **고정**(사용자 지정 경로 금지, PF-U02).

```ts
interface UsageProvider {
  id: 'claude-code' | 'codex' | string;
  // pane 힌트(redaction 경계를 통과한 cwd·processTree session-id·agentType)로
  // §4.2 bounded·confined reader를 통해서만 읽고, OrcUsage|null을 반환한다.
  collect(hint: UsageLocateHint, reader: ConfinedReader): OrcUsage | null;
}
```

- **claude-code**: JSONL line별 `message.usage.{input_tokens,output_tokens}`(+cache는 Q4) 합산 = `cumulativeTokens`. cost는 `message.model`별 price 표로 추정 시 `source='estimated'`(model명은 산출에 넣지 않고 추정에만 내부 사용). `measuredAt`=마지막 줄 `timestamp` 또는 file mtime. **`message.content`·`cwd`·`gitBranch`는 읽지 않는다.**
- **codex** (CONDITIONAL GO — file-access 계약은 승인, schema 미확정으로 출력은 게이트): root는 **`~/.codex/sessions/` 하위로 고정**되어 있고(as-built `defaultCodexRoot`), 형제 secret 파일(`~/.codex/{auth.json,.env,config.toml}`)은 **`sessions/` root 밖이라 ConfinedReader가 구조적으로 거부**한다 — 따라서 **privacy/security 측면의 read surface는 claude provider와 동일하게 안전**하고, Codex를 켜는 것이 secret 노출 위험을 **올리지 않는다**(잘못된 key를 읽어도 reader는 confined·content-skip이므로 누출이 아니라 **숫자 오집계**일 뿐 — F-08류 correctness 문제). 다만 usage-payload **key 경로가 실측 미확정**(Q1)이므로, 확정 전에는 **추측 대신 `null` 반환**(현 stub이 정답)이다.
  - **확정 절차(누가·무엇을)**: 구현 엔지니어(필요 시 detection-engineer와 공동, SPEC-003 provider 핑거프린팅 정합)가 **자기 머신의 실제 Codex 세션 1개**를 **§4.2 ConfinedReader로(=key-addressed·content-skip, 파일 dump 금지)** 들여다보고 다음을 §4.4에 **고정 문서화**한 뒤에만 stub을 해제한다: (a) usage event의 판별자(`type` 값), (b) input/output token의 정확한 **숫자 key 경로**, (c) 누적인지 per-event인지(합산 vs 마지막값), (d) cost용 model id 필드(있으면), (e) `timestamp` 필드. 그리고 [[SPEC-007-test-validation]]에 합성 Codex fixture(대화 텍스트 + 알려진 secret 샘플 포함)를 추가해 AC-01~03·09를 Codex에도 적용한다.
  - **검증 전 가설(검토 필요, 그대로 ship 금지)**: Codex rollout line은 `{type,timestamp,payload}` 형태로 관찰되며 token 집계는 `token_count`류 event의 payload(예: `info.total_token_usage.{input_tokens,output_tokens}` 또는 `usage` 객체)에 있을 **가능성**이 있다. 이는 **확인 대상**일 뿐 확정값이 아니다 — (a)~(e)를 실측으로 못 박기 전에는 `null`을 유지한다.
  - **cost**: Codex는 OpenAI 계열 모델이라 현 `PRICE_TABLE`(claude만)에는 매칭이 없다 → cost는 `null`, tokens만 있으면 `cumulativeTokens`만 산출(`source` 표기는 model id 확정 후 결정; OpenAI price 표는 본 spec 범위 밖, Q3).
- **generic/unknown**: provider 미상 → parser 없음 → `null`.
- 새 provider 추가는 본 §4.4 인터페이스를 구현하고 §4.2 reader만 쓰면 된다(root 고정 유지). 코드 변경 없는 user-config 경로 주입은 금지(PF-U02, trust-gated 후속).

### 4.5 비저장 데이터 흐름표 ([[SPEC-006-privacy-redaction]] §2.5 확장, R-PRIV-004/005, R-OBS-003)

| 데이터 | 보유/도달 위치 | content 포함 | 파일 저장 | 비고 |
| --- | --- | --- | --- | --- |
| transcript raw line buffer(발췌 전) | memory only, **줄 단위 휘발** | (일시) | **금지** | usage 발췌 직후 폐기. whole-file 미적재. 어떤 출력에도 미도달 |
| 추출 usage 스칼라(`OrcUsage`) | memory → `Orc.usage` → stdout/`--json` | **없음(숫자)** | 금지(원문) | §2의 4개 필드만 |
| 세션 파일 경로 | memory only(locate) | (경로=식별자) | **금지** | 경로는 **직렬화/log 안 함**(cwd/identity 내포). 표시용 `cwd`는 [[SPEC-006-privacy-redaction]] §2.3에서 별도 redaction |
| open-fd 목록(`lsof`/`/proc/<pid>/fd` 출력) | memory only, **스트리밍 휘발** | (경로·socket·secret 파일명 포함 가능) | **금지** | §4.2a: in-root+`.jsonl` 매칭 1개만 발췌해 reader로 넘기고 **나머지 경로는 즉시 폐기·미보유·미log**. 전체 목록 retain 금지. raw 출력 비저장(over-disclosure 차단 T-U10) |
| read offset / 누적 합계(`--watch`) | memory | 없음 | 금지(원문) | offset+숫자만, content 미보관 |
| debug log entry | persisted file | **metadata only** | metadata만 | phase·provider id·`paneId`·durationMs·bytesRead·lineCount·outcome(`ok`/`null`/`denied`/`timeout`/`ambiguous`)만. **transcript 텍스트·경로·secret 미기록**. 기록 전 자유 텍스트는 `redact()` 통과(§4.6) |
| transcript 캐시 | (없음) | — | **금지** | parser는 content 캐시를 만들지 않는다(offset+합계 외) |

### 4.6 redaction chokepoint 확장 (defense-in-depth, [[SPEC-006-privacy-redaction]] §2.1/§3.1, [[08-Decisions|D-016]])

- 1차 방어는 §4.1 **구조적 비-추출**이다(content를 안 들고 옴). redaction은 그 위의 **floor**다: usage surface가 만든 어떤 자유 텍스트(설계상 `OrcUsage`에는 없음)나 debug log에 쓰는 메타 문자열(예: provider id 외 우발 텍스트)은 기록·노출 전 [[SPEC-006-privacy-redaction]] `redact()`를 통과한다.
- `OrcUsage`는 숫자·enum·ISO timestamp만이라 redaction 대상 자유 텍스트가 없다 — 이 사실 자체가 surface가 닫혀 있음을 증명한다(AC-01).

## 5. P0/P1 findings & mitigations

### 5.1 findings (severity → 필수 mitigation)

| ID | finding | severity | 필수 mitigation(구현 조건) | AC |
| --- | --- | --- | --- | --- |
| F-01 | transcript content가 `usage` 산출 경로로 새어 출력/스냅샷에 노출 | P0 | data-minimization: 스칼라만, content 구조적 skip(§4.1), non-leak 테스트 | AC-01, AC-02 |
| F-02 | content/경로/secret이 debug log·캐시로 영구화 | P0 | 비저장 흐름표(§4.5): line 폐기, metadata-only log, 캐시 금지 | AC-03 |
| F-03 | 타 사용자 파일·root 밖 파일 read | P0 | root confinement + ownership(`st_uid`) + symlink escape 거부(§4.2) | AC-04, AC-05 |
| F-04 | huge-file/긴 줄 DoS | P0 | byte/line/time cap + streaming(§4.2) | AC-06 |
| F-05 | 모호 세션 misattribution | P0 | 명시 id 우선·모호→null·추측 금지(§4.3) | AC-07, AC-08 |
| F-06 | 수집 실패가 scan 전체를 깨뜨림 | P0 | per-orc 격리·예외 미전파·degradable null(§4.2) | AC-10 |
| F-07 | TOCTOU로 검사 우회 | P1 | open-then-fstat·`O_NOFOLLOW`(§4.2) | AC-11 |
| F-08 | cost 추정 표 drift로 잘못된 cost 단정 | P1 | `source='estimated'` 표시·tier 1차 축은 tokens(§2, [[SPEC-302-mascot-prestige-tiers]] §3.2) | AC-09 |
| F-09 | bounded read가 cumulative를 과소집계 | P1 | offset+running-total 누적(§4.2)·`source` 표시; 정확도는 Q5로 보정 | (Q5) |
| F-10 | open-handle 조회의 fd 목록 over-disclosure(타 파일·secret 경로 노출) | P0 | §4.2a: in-root+`.jsonl`만 발췌·나머지 즉시 폐기·미log, `-n -P` network 차단, fixed-argv·numeric-pid | AC-13 |
| F-11 | open-handle 상관의 pid 재사용/오-pid misattribution | P1 | 동일 scan snapshot의 alive pid·pane 자신 subtree 한정·정확히 1개일 때만·confinement 재검증(§4.2a) | AC-12, AC-08 |

### 5.2 tunable 한계 (PoC/구현 검증 가설)

| 상수 | 초기값(가설) | 비고 |
| --- | --- | --- |
| `U_BYTES`(파일당 read 상한) | 검토 필요(예: tail 기반 incremental + 세션당 누적) | DoS 방지 vs cumulative 정확도(Q5) |
| `U_LINES`(파싱 줄 상한) | 검토 필요 | streaming 폐기 전제 |
| `U_TIME`(파일당 wall-clock) | tmux `T`와 정합(예: 수백 ms~) | per-orc 격리, 초과→null |

## 6. Acceptance criteria

> secret/transcript 예시는 실제 값 대신 placeholder를 쓴다. "any output path" = { table stdout, `--json`, preview, debug log }. fixture는 합성 세션 로그(대화 텍스트 + 알려진 secret 샘플 포함)다([[SPEC-007-test-validation]] 코퍼스 확장).

```text
SPEC-008-AC-01 (R-PRIV-007, [[08-Decisions|D-039]])  [data-minimization]
  Given 대화 텍스트·코드·secret·경로가 든 합성 세션 JSONL이 한 orc에 매핑될 때
  When usage collector가 실행되면
  Then 반환 객체는 정확히 {cumulativeTokens, cumulativeCostUsd, source, measuredAt}만 가지며
       (그 외 키 없음), 어떤 필드도 message body·tool I/O·코드·파일 경로·secret 문자열을 담지 않고,
       measuredAt은 ISO 8601 timestamp 형식만 만족한다(자유 텍스트 아님).
```

```text
SPEC-008-AC-02 (R-PRIV-002, R-PRIV-007)  [non-leak — 필수 누출 테스트]
  Given 세션 transcript에 알려진 secret 샘플과 고유 마커 텍스트가 포함될 때
  When scan이 usage를 수집하고 출력을 산출하면
  Then 그 secret literal과 마커 텍스트가 any output path 어디에도 나타나지 않는다
       (table·--json·preview·debug log 전수 검사).
```

```text
SPEC-008-AC-03 (R-PRIV-004, R-PRIV-005, R-OBS-003)  [non-storage]
  Given 전체 scan 1회(usage 수집 포함) 실행 동안
  When 파일시스템 쓰기를 관측하면
  Then transcript 텍스트/경로를 담은 파일·캐시가 생성되지 않고,
       debug log 항목은 metadata(phase/provider/paneId/durationMs/bytesRead/lineCount/outcome)만 담으며
       transcript content·secret·세션 파일 경로를 포함하지 않는다.
```

```text
SPEC-008-AC-04 (R-PRIV-007, [[08-Decisions|D-039]])  [symlink/traversal 거부]
  Given 세션 파일(또는 그 상위 디렉터리)이 allowlist root 밖으로 해석되는 symlink일 때
        (예: <session>.jsonl → /etc/…, 또는 encoded-dir에 ../ 포함)
  When collector가 그 경로를 평가하면
  Then realpath가 root prefix를 벗어남을 탐지해 거부하고 usage=null이며,
       symlink 대상 파일을 읽지 않는다.
```

```text
SPEC-008-AC-05 (R-PRIV-007)  [ownership]
  Given 후보 세션 파일이 현재 uid가 아닌 다른 사용자 소유일 때
  When collector가 파일을 평가하면
  Then 열린 fd의 fstat로 st_uid != getuid()를 탐지해 거부하고 usage=null이며,
       파일 내용을 읽지 않는다(정규 파일이 아니어도 거부).
```

```text
SPEC-008-AC-06 (R-PRIV-007)  [bounded read — DoS 방지]
  Given 매우 큰(수백 MB) 또는 병적으로 긴 줄을 가진 세션 JSONL일 때
  When collector가 읽으면
  Then byte/line/time cap에서 멈추고 whole-file을 메모리에 적재하지 않으며,
       best-effort 합계(또는 null)를 반환하고 scan은 무한 block 없이 완료된다.
```

```text
SPEC-008-AC-07 (R-PRIV-007)  [absent/unreadable/ambiguous → null]
  Given (a) 세션 파일 부재, (b) 권한 거부/parse 실패,
        (c) 명시 session-id도 open-handle(fd) 상관(§4.2a)도 후보를 확정하지 못한 채 디렉터리에 복수 `.jsonl`이 있을 때
  When collector가 실행되면
  Then 세 경우 모두 usage=null을 반환하고(추측·단정 없음),
       (c)에서 mtime '최근' 등으로 임의의 한 세션을 선택하지 않는다.
```

```text
SPEC-008-AC-08 (R-PRIV-007, [[08-Decisions|D-017]])  [identity — misattribution 금지]
  Given orc A의 pane argv에 명시 session-id가 있어 정확한 파일로 상관될 때,
        그리고 같은 디렉터리에 orc B의 다른 세션 파일이 있을 때
  When collector가 A의 usage를 수집하면
  Then A의 usage는 A의 세션 파일에서만 나오고 B의 세션 값이 A에 섞이지 않으며,
       상관이 모호한 orc는 usage=null이다(다른 orc로 귀속하지 않음).
```

```text
SPEC-008-AC-09 (R-PRIV-007, R-P2-008)  [provider-pluggable + fallback]
  Given (a) Claude Code JSONL fixture, (b) 형식 미상 Codex 로그, (c) agentType=unknown pane에 대해
  When 각 provider가 collect하면
  Then (a) usage 필드(input/output tokens)만 합산해 cumulativeTokens를 산출하고
           cost 추정 시 source='estimated', (b)/(c)는 추측 없이 usage=null을 반환하며,
       어떤 provider도 사용자 지정 임의 경로를 읽지 않는다(root 고정).
```

```text
SPEC-008-AC-10 (R-PRIV-007, R-TMUX-004 정신)  [degradable 격리]
  Given 한 orc의 usage 수집이 실패(권한/timeout/parse)할 때
  When scan이 실행되면
  Then 그 orc는 usage=null이 되고, 다른 orc의 usage 수집과 전체 scan은
       예외 없이 정상 완료된다(실패가 전파되지 않음).
```

```text
SPEC-008-AC-11 (R-PRIV-007)  [read-only + TOCTOU-safe]
  Given collector가 세션 파일에 접근할 때
  When 실제 파일 연산을 관측하면
  Then 파일을 읽기 전용으로 열고 어떤 쓰기/변경도 하지 않으며(read-only),
       경로 검증은 stat-then-open이 아니라 open-then-fstat(열린 fd 기준)로 수행되어
       검사-후-치환(TOCTOU)으로 root 밖 파일을 읽을 수 없다.
```

```text
SPEC-008-AC-12 (R-PRIV-007, [[08-Decisions|D-039]])  [open-handle 상관 — 결정적·confined]
  Given orc의 project 디렉터리에 *.jsonl이 여러 개 있고 argv에 명시 session-id가 없으며,
        그 pane 자신의 agent process가 그중 정확히 하나를 고정 root 아래에서 열어 둔(open fd) 상태일 때
  When collector가 §4.2a open-handle 상관을 수행하면
  Then 그 '실제 열린' 파일을 결정적으로 채택하고(추측 아님), 그 경로도 여전히
       confinement(realpath-under-root)·ownership(st_uid==getuid())·O_NOFOLLOW·open-then-fstat을 통과한 뒤에만 열리며,
       agent가 in-root .jsonl을 0개 또는 2개 이상 열고 있으면 usage=null이다(임의 선택 금지).
       lsof 부재/denied/timeout 또는 processTree=null이면 이 단계를 skip하고(디렉터리 단일 .jsonl fallback 또는 null),
       어떤 경우에도 scan은 예외 없이 완료된다(degradable).
```

```text
SPEC-008-AC-13 (R-PRIV-007, R-PRIV-004/005)  [open-handle 비-과노출 + read-only]
  Given pane의 agent process가 세션 .jsonl 외에 다른 파일(타 프로젝트 경로·secret 파일·socket)도 열고 있을 때
  When collector가 open fd를 조회하면
  Then 고정 root 아래 + 기대 확장자(.jsonl) 경로만 후보로 발췌되고,
       그 외 fd 경로는 읽히지도·변수로 보유되지도·debug log에 기록되지도 않으며(전체 목록 미retain),
       조회는 read-only·고정 argv(macOS lsof는 -n -P 포함으로 reverse-DNS/network 부작용 없음)·검증된 양의 정수 pid로만 수행되고,
       조회 대상 pid는 그 pane 자신의 subtree 노드뿐이다(타 pid 스캔 없음).
```

## 7. Traceability

| 요구사항/결정 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-PRIV-007(신규 proposed, 1차 소유) | 세션 로그 surface의 data-minimization·file-access 경계·비저장·degradable·identity·**open-handle 상관** 계약 | SPEC-008-AC-01·03·04·05·06·07·08·09·10·11·**12·13** |
| R-PRIV-002 | redaction-before-egress 정신을 surface로 확장(구조적 비-추출 + redaction floor) | SPEC-008-AC-01, AC-02 |
| R-PRIV-004 | transcript 원문·캐시 비저장(memory-only, 줄 폐기) | SPEC-008-AC-03 |
| R-PRIV-005 | debug log에 transcript 원문·경로 미기록(metadata-only) | SPEC-008-AC-03 |
| R-OBS-003 | log 자유 텍스트 redaction floor(§4.6) | SPEC-008-AC-03 |
| R-P2-008(feature driver) | tier가 요구하는 `Orc.usage`를 privacy-안전하게 산출(스칼라만) | SPEC-008-AC-09 |
| [[08-Decisions|D-039]](신규·amended) | data-minimization chokepoint·root confinement·GO 조건(G1~**G9**)·open-handle 상관 승인·Codex 게이트 | §1.1, SPEC-008-AC-01~13 |
| [[08-Decisions|D-016]](확장) | redaction chokepoint를 본 surface로 확장(defense-in-depth) | SPEC-008-AC-02 |
| [[08-Decisions|D-017]](재사용) | usage 귀속의 권위는 `paneId`·결정적 상관(명시 id·open-handle) | SPEC-008-AC-08, AC-12 |
| [[SPEC-006-privacy-redaction]] §2.7(확장 패턴) | open-handle 조회는 tmux/`ps`에 이은 세 번째 read-only subprocess — 동등 fail-safe(고정 argv·shell:false·timeout·read-only), 소유는 SPEC-008(§4.2a) | SPEC-008-AC-13 |

> 전체 추적 매트릭스 통합은 [[SPEC-007-test-validation]](usage 코퍼스·non-leak 테스트 추가). R-PRIV-007의 [[02-Requirements]] index 등재와 README spec-index 행은 orchestrator 중앙 조정(아래 C1).

## 8. Open Questions / Conflicts

### Conflicts / Upstream (orchestrator 조정)

- **C1 — index/requirements 등재**: 본 spec은 신규 `R-PRIV-007`(proposed)을 1차 소유하고 신규 `D-039`를 근거로 둔다. [[02-Requirements]]에 R-PRIV-007(proposed) 추가와 [[README]] spec-index에 SPEC-008 행 추가가 필요하다(본 작업에서 함께 반영; index 권위는 orchestrator).
- **C2 — [[SPEC-302-mascot-prestige-tiers]] §2.2 / [[SPEC-005-data-contract]] forward note**: 두 forward note가 본 spec과 §1.1 GO/NO-GO를 참조하도록 갱신했다(정합 확인 필요).
- **C3 — [[SPEC-006-privacy-redaction]] 관계**: 본 spec은 SPEC-006의 자매 계약이다(다른 surface). SPEC-006 §2.5 비저장표·§2.1 chokepoint를 본 §4.5/§4.6이 **확장**하되 중복 소유하지 않는다(capture surface는 SPEC-006, 세션 로그 surface는 SPEC-008).

### Open Questions (검토 필요)

- **Q1 — Codex 로그 형식/위치 미확정**(§4.4 amended): file-access 계약은 **승인(CONDITIONAL GO)**되었으나 usage payload **key 경로가 실측 미확정**이라 출력은 게이트된다. 확정 전 Codex provider는 `null`(현 stub이 정답). 해제 조건 = §4.4 (a)~(e) key 경로를 **ConfinedReader로 실측 확인** + SPEC-007 Codex fixture 추가. 해제 주체 = 구현 엔지니어(+detection-engineer 정합). **검토 필요(해제 전 ship 금지).**
- **Q2 — 세션↔pane 상관 신뢰도**: 기존 cwd+단일파일 fallback은 복수 세션 시 대부분 `null`(현 as-built ~3/28). **§4.2a open-handle(fd) 상관**으로 mtime 추측 없이 **결정적**으로 보강했다(amended). 잔여 리스크 = (a) idle agent가 fd를 닫으면 후보 0(coverage 한계, 여전히 null·misattribution 0), (b) pid 재사용 창(T-U11, 무시가능). 실제 해소율·fd 유지 여부는 [[SPEC-007-test-validation]] live-orc oracle로 **측정**한다. **검토 필요.**
- **Q7 — open-handle을 쥔 정확한 노드**: wrapper 체인(`zsh→claude→node`)에서 JSONL을 실제로 연 pid가 agent runtime 노드인지 그 자식인지 미확정 → §4.2a는 pane subtree 노드를 모두 후보 pid로 두되 **in-root .jsonl이 정확히 1개일 때만** 채택. 정확한 노드는 [[SPEC-007-test-validation]]에서 측정해 좁힐 수 있다. **검토 필요.**
- **Q3 — cost 추정 표**: model→price 표의 출처·drift 관리와 `source='estimated'` 라벨링. tier 1차 축은 tokens라 cost 부정확이 tier에 미치는 영향은 제한적([[SPEC-302-mascot-prestige-tiers]] §3.2). **검토 필요.**
- **Q4 — cumulativeTokens의 billable 정의**: `cache_creation_input_tokens`/`cache_read_input_tokens`를 합산에 포함할지(과금 모델 의존). 초기엔 input+output만, cache는 옵션. **검토 필요.**
- **Q5 — bounded read vs cumulative 정확도**: byte cap으로 tail만 읽으면 append-only 누적이 과소집계될 수 있다(F-09). offset+running-total 누적(`--watch`)으로 신규 줄만 합산하는 설계가 정확도-안전 절충의 1안. 단발 scan의 정확도 한계는 `source`로 표시. **검토 필요.**
- **Q6 — encoded-cwd 규칙 안정성**: Claude의 `<encoded-cwd>`(경로 `/`→`-` 치환 관찰)는 provider 내부 규칙이라 버전에 따라 바뀔 수 있다. provider 모듈에 격리하고 불일치 시 null. **검토 필요.**
