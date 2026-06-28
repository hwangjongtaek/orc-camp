---
spec: SPEC-900
title: 전체 제품 추적성 롤업
status: approved
updated: 2026-06-27
requirements: []
decisions: []
tags:
  - specs
  - traceability
  - rollup
  - coverage
  - orphan-zero
---

# SPEC-900 — 전체 제품 추적성 롤업

이 spec은 **Orc Camp 제품 목표 전체**(Epic 1~9)에 대해 모든 P0 요구사항(및 채택된 P1)이 **최소 하나의 검증 가능한 수용 기준(AC)으로 커버**됨을 단일 문서로 증명한다. [[docs/specs/README|README]] "추적성 원칙"이 요구하는 **전체 제품 추적 롤업**의 산출물이며, full-product 게이트가 "orphan-0 confirmation"의 누락 artifact로 지목한 항목을 채운다.

> **메타 spec**: 본 문서는 새 `R-*`/`D-*`/계약을 만들지 않는다(frontmatter `requirements`/`decisions`는 의도적으로 비움). 각 요구사항의 **1차 소유·AC·동작 정의**는 해당 owner spec이 SSOT다. 본 문서는 그 매핑을 **집계·교차검증**할 뿐이며, 충돌 시 owner spec을 따른다.

> **스코프 경계**: Epic 1(scan) 슬라이스의 상세 테스트 케이스(`TC-*`)·PoC 측정 절차·fixture 카탈로그는 [[SPEC-007-test-validation]]이 소유한다. 본 롤업은 그 위에 **전 epic AC 커버리지**를 얹는다. 전 제품 테스트 계층 설계(Epic 2~9의 `TC-*`)는 **forward**(미작성)이며, 본 문서는 각 요구사항을 검증할 **테스트 계층(layer)만 명명**한다.

## 1. Scope

### In scope

- **전체 제품 P0 커버리지 매트릭스**(§2): R-CLI / R-TMUX / R-ORC / R-UI / R-PRIV / R-CTRL / R-API / R-SET / R-SEC / R-OBS 전 그룹의 각 P0 `R-*` → 1차 소유 spec → 대표 AC id → 검증 계층. **무커버 R-\*는 P0 GAP 행으로 명시**한다.
- **비기능 커버리지**(§3.1): local-first·보안·개인정보·성능·scan latency·신뢰성·확장성·사용성·접근성·관측성·배포 11개 영역 → 소유 spec/AC.
- **채택 P1 커버리지**(§3.2): R-P1-001/002/004/006/010/011 → spec/AC.
- **P2 pre-flag ledger**(§3.3): R-P2-001~007 → forward pre-flag + 스트레스 불변식.
- **롤업 자체의 수용 기준**(§4): 완결성 기준(`SPEC-900-AC-NN`) — "모든 P0가 ≥1 AC에 매핑된다" 등.
- **Epic→spec→status 개요 + no-silent-truncation 명세**(§5): 의도적으로 후속 슬라이스로 미룬 항목을 빠짐없이 명시.

### Out of scope

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| 각 `R-*`의 동작 규칙·AC 본문 | 본 문서는 **집계**한다 | 각 owner SPEC-001~800 |
| scan 슬라이스 `TC-*`/PoC 측정 절차·fixture | 본 문서는 layer만 명명 | [[SPEC-007-test-validation]] |
| Epic 2~9 테스트 케이스 상세 설계 | forward(미작성) | 후속 test spec |
| 청사진(`R-*`/`D-*`) 변경 | 본 문서는 표시만 | [[02-Requirements]] / [[08-Decisions]] |

### 검증 계층(layer) 범례

[[SPEC-007-test-validation]] §2.1 계층을 전 제품으로 확장해 명명한다(Epic 2~9는 forward):

| 약칭 | 계층 | 결정성/CI | 비고 |
| --- | --- | --- | --- |
| **U** | unit(순수 함수) | 결정적·CI 게이트 | detection/status/redaction/schema/render |
| **I** | integration(mock 경계) | 결정적·CI 게이트 | tmux exec mock / HTTP·WS handler / fs spy |
| **C** | component(FE, forward) | 결정적·CI 게이트 | 화면·store·렌더(Epic 3 test spec 미작성) |
| **M** | measurement(라벨 데이터셋) | detection/redaction=결정적, latency=e2e | PoC 지표 — [[SPEC-007-test-validation]] §3.3 |
| **E** | e2e(live tmux/browser) | 비-게이트(별도 job) | 머신 의존 실증 |

## 2. 전체 제품 P0 커버리지 매트릭스

> 규칙: 각 P0 `R-*`는 **≥1 대표 AC**에 매핑돼야 한다(누락 = **P0 GAP**). "1차 소유"는 owner spec, 괄호 spec은 공동/부수 충족. AC id는 owner spec의 `## 5/Traceability`에서 인용. 전 행 검증 결과 **P0 GAP 0**(§4 SPEC-900-AC-01).

### 2.1 R-CLI — CLI·실행 수명주기 (1차 [[SPEC-100-server-lifecycle]], scan은 [[SPEC-001-scan-cli]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-CLI-001 | SPEC-100 | SPEC-100-AC-01, AC-04 | I·E | server 기동·token URL·≤10s |
| R-CLI-002 | SPEC-100 | SPEC-100-AC-02, AC-17 | I·E | browser open 실패 시 URL stdout·stream hygiene. scan에는 부재(SPEC-001-AC-14 negative) |
| R-CLI-003 | SPEC-100 | SPEC-100-AC-05, AC-06 | I | subcommand dispatch(scan/serve/doctor/unknown) |
| R-CLI-004 | **SPEC-001** | SPEC-001-AC-01~08, AC-13/14/16; SPEC-005-AC-01/02 | U·I·E | scan CLI 표면(table/`--json`/exit/`--watch`/빈상태). [[SPEC-007-test-validation]] `TC-U-CLI-*`/`TC-I-SCAN-NORMAL` |
| R-CLI-005 | SPEC-100 | SPEC-100-AC-07, AC-08 (depth SPEC-700-AC-08/09, log.path SPEC-600-AC-10) | I | doctor 5-check·exit 정책 |
| R-CLI-006 | SPEC-100 | SPEC-100-AC-03, AC-18 | I | port fallback / 명시 `--port` 점유 시 exit 1([[08-Decisions|D-034]]) |
| R-CLI-007 | SPEC-100 | SPEC-100-AC-09, AC-10 (SPEC-102-AC-13 epoch, SPEC-700-AC-12 잔존물) | I·E | 종료 시 token/state 폐기·재시작 새 token |

### 2.2 R-TMUX — Discovery (1차 [[SPEC-002-tmux-discovery]], 강제 [[SPEC-006-privacy-redaction]], serve [[SPEC-101-snapshot-api]]/[[SPEC-102-realtime-sync]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-TMUX-001 | SPEC-002 (강제 SPEC-006) | SPEC-002-AC-01/13/14; SPEC-006-AC-12 | U·I·E | read-only inventory + fail-closed allowlist `tmuxExec`. `TC-I-READONLY` |
| R-TMUX-002 | SPEC-002 | SPEC-002-AC-02, AC-03 | U | pane 9필드·타입·출처 token. `TC-U-INV-PARSE` |
| R-TMUX-003 | **serve-slice** (SPEC-101 diff + SPEC-102) | SPEC-102-AC-11; SPEC-101-AC-03/04/12 | I | **의도적 후속(serve)**: 구조 변화→diff→event 반영. scan은 `--watch`로 부분 충족([[08-Decisions|D-014]]). §5 truncation ledger |
| R-TMUX-004 | SPEC-002 (SPEC-006) | SPEC-002-AC-04/05/06/07; SPEC-006-AC-13/14 | I | timeout·target error isolation·diagnostics privacy. `TC-I-CAPFAIL`/`TC-I-TIMEOUT`/`TC-I-DIAG-PRIVACY` |
| R-TMUX-005 | SPEC-002 (직렬화 SPEC-005, serve SPEC-101) | SPEC-002-AC-11/12; SPEC-005-AC-07; SPEC-101-AC-11 | U·I | last-good vs stale, 위조 금지. `TC-U-INV-STALE`/`TC-I-INVFAIL` |
| R-TMUX-006 | SPEC-002 (직렬화 SPEC-005, 렌더 SPEC-001/201) | SPEC-002-AC-08/09/10; SPEC-005-AC-05/06; SPEC-001-AC-03/13 | U·I·C | 빈 상태 3종 + no-agent 구분. `TC-U-INV-EMPTY`/`TC-I-EMPTY` |

### 2.3 R-ORC — Agent detection·Orc 모델 (type [[SPEC-003-agent-detection]], status [[SPEC-004-status-inference]], 직렬화 [[SPEC-005-data-contract]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-ORC-001 | SPEC-003 | SPEC-003-AC-01/02/03/06/09 (지표 SPEC-007-AC-01) | U·M | Claude/Codex Tier A→B→C. precision ≥0.9 가설 `TC-M-PRECISION` |
| R-ORC-002 | SPEC-003 | SPEC-003-AC-04/05/06/08 | U | `unknown`≠non-candidate, 충돌 시 단정 금지 |
| R-ORC-003 | SPEC-004 (직렬화 SPEC-005) | SPEC-004-AC-01/03/05/07/08/15; SPEC-005-AC-03/04/12 | U | status 7종·confidence·요약 필드·집계 |
| R-ORC-004 | SPEC-004 (직렬화 SPEC-005) | SPEC-004-AC-11/13; SPEC-005-AC-09 | U | `currentWorkSummary`·`summarySource` 5종 |
| R-ORC-005 | SPEC-004 (직렬화 SPEC-005, 렌더 SPEC-001/201/202/301) | SPEC-004-AC-02/04/06/12/14; SPEC-005-AC-08/14; SPEC-201-AC-04; SPEC-301-AC-06 (지표 SPEC-007-AC-03) | U·C·M | estimated/confidence 단정 금지·calibration 단조성 `TC-M-CALIB-*`·맵 activity bubble |
| R-ORC-006 | SPEC-004 (렌더 SPEC-202) | SPEC-004-AC-09, AC-10; SPEC-202-AC-03 | U·C | `terminated` vs `stale` 짧은 retention. `TC-U-STAT-TERM/STALE` |
| R-ORC-007 | SPEC-003 / [[SPEC-800-extensibility]] | SPEC-003-AC-07/08; SPEC-800-AC-01/02/07/08 | U | `AgentDetector` adapter boundary·open/closed 확장 |

### 2.4 R-UI — Dashboard·UX (1차 [[SPEC-201-dashboard-screens]], 아키텍처 [[SPEC-200-frontend-architecture]], 접근성 [[SPEC-202-design-accessibility]], asset [[SPEC-300-asset-rendering]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-UI-001 | SPEC-201 (route SPEC-200) | SPEC-201-AC-01/02; SPEC-200-AC-01/15; SPEC-202-AC-18 | C | 첫 화면 = camp list |
| R-UI-002 | SPEC-201 | SPEC-201-AC-01, AC-02 | C | CampCard 콘텐츠 매핑 |
| R-UI-003 | SPEC-201 (sprite SPEC-300, 공간 맵 SPEC-301) | SPEC-201-AC-03/14; SPEC-300-AC-05/06/09/12; SPEC-301-AC-01/02/03/08/09/12/14 | C | camp scene·orc sprite·공간 배치 맵(zone/station/slot, SPEC-301이 scene 배치 supersede) |
| R-UI-004 | SPEC-201 (control SPEC-400, preview text SPEC-101) | SPEC-201-AC-04/11/13; SPEC-400-AC-14; SPEC-202-AC-07; SPEC-101-AC-17/18 | C·I | inspector 4영역. preview text 경로 = `GET /api/orcs/:orcId/preview`([[08-Decisions|D-026]]) |
| R-UI-005 | SPEC-201 (신호 SPEC-102, store SPEC-200) | SPEC-201-AC-05/06/07/12; SPEC-200-AC-11/14; SPEC-102-AC-07/08 | C | 7+상태 구분(no-agent≠no-session, disconnected≠stale) |
| R-UI-006 | SPEC-300 / SPEC-202 (배포 SPEC-700, 맵 SPEC-301) | SPEC-202-AC-16/17; SPEC-300-AC-08/09/10/13; SPEC-301-AC-08/10/14; SPEC-700-AC-06 | C·I | placeholder parity·동일 layout/interaction·맵 uniform scale parity |
| R-UI-007 | SPEC-201 (deep-link SPEC-200, 데이터 SPEC-005) | SPEC-201-AC-08; SPEC-200-AC-02; SPEC-202-AC-21; SPEC-005-AC-02/03 | C·U | raw tmux target 상시 노출 |
| R-UI-008 | SPEC-301 (sprite SPEC-300, 데이터 불변 SPEC-005) | SPEC-301-AC-01/02/03/12/14 | C | 활동을 공간 표현(위치=기존 필드 결정적 함수, 서버 좌표 불추가; [[08-Decisions|D-035]]) |

### 2.5 R-PRIV — Terminal preview·Privacy (1차 [[SPEC-006-privacy-redaction]], R-PRIV-006은 [[SPEC-201-dashboard-screens]]/[[SPEC-500-settings-persistence]]/[[SPEC-101-snapshot-api]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-PRIV-001 | SPEC-006 | SPEC-006-AC-08, AC-09 | U | line cap N·byte cap B·preview tail P. `TC-U-RED-LIMITS` |
| R-PRIV-002 | SPEC-006 (렌더 SPEC-201) | SPEC-006-AC-01/06/07/16/17; SPEC-201-AC-10; SPEC-001-AC-12 | U·I·C | redaction-before-consumption 단일 chokepoint([[08-Decisions|D-016]]) |
| R-PRIV-003 | SPEC-006 | SPEC-006-AC-01~05/15/17 (지표 SPEC-007-AC-04) | U·M | 패턴 카탈로그·false-redaction. `TC-U-RED-PATTERNS`/`TC-M-FALSERED` |
| R-PRIV-004 | SPEC-006 (설정 SPEC-500, serve SPEC-101) | SPEC-006-AC-10; SPEC-500-AC-06/12; SPEC-101-AC-16 | I | full output 비저장·memory only. `TC-I-NONPERSIST` |
| R-PRIV-005 | SPEC-006 (log SPEC-600/101) | SPEC-006-AC-11; SPEC-101-AC-10; SPEC-600-AC-06/07 | I | debug log 원문 미기록 |
| R-PRIV-006 | SPEC-201 + SPEC-500 (text 경로 SPEC-101) | SPEC-201-AC-09/10; SPEC-500-AC-04/12; SPEC-101-AC-17/18 | C·I | preview 노출 toggle·line-count 저장·floor-lock. end-to-end 경로 = `GET /api/orcs/:orcId/preview` |

### 2.6 R-CTRL — Control action (1차 [[SPEC-400-control-actions]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-CTRL-001 | SPEC-400 | SPEC-400-AC-01, AC-02 | U·I | `/input` literal `-l --`·단일 paneId target |
| R-CTRL-002 | SPEC-400 | SPEC-400-AC-03 | U | `KEY_ALLOWLIST` 강제 |
| R-CTRL-003 | SPEC-400 (a11y SPEC-202) | SPEC-400-AC-04, AC-11; SPEC-202-AC-09/20 | I·C | interrupt UI modal + `confirmed:true` 이중 게이트 |
| R-CTRL-004 | SPEC-400 (token SPEC-100) | SPEC-400-AC-05; SPEC-100-AC-13 | I | 모든 endpoint startup token auth |
| R-CTRL-005 | SPEC-400 | SPEC-400-AC-06/07/08/16/17 | I | 실행 직전 fresh read-only 재검증·abort+audit |
| R-CTRL-006 | SPEC-400 | SPEC-400-AC-11 | C | control context 4필드(agentType/target/cwd/command) |
| R-CTRL-007 | SPEC-400 (모델 SPEC-600) | SPEC-400-AC-12/13; SPEC-600-AC-02/16 | I | 결과 = canonical `control.result` ActivityEvent([[08-Decisions|D-028]]) |
| R-CTRL-008 | SPEC-400 | SPEC-400-AC-09, AC-10 | U·I | `controlExec` single-writer·shell:false·임의 shell 구조적 불가 |

### 2.7 R-API — Realtime sync·API (1차 [[SPEC-101-snapshot-api]]/[[SPEC-102-realtime-sync]], client [[SPEC-200-frontend-architecture]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-API-001 | SPEC-101 (REST) + SPEC-102 (WS) | SPEC-101-AC-01/02/14/15; SPEC-102-AC-01/02; SPEC-200-AC-03~06/14 | I·C | REST snapshot base + WS delta |
| R-API-002 | SPEC-102 | SPEC-102-AC-06~10/12/13; SPEC-101-AC-05; SPEC-200-AC-07/08 | I·C | reconnect·disconnected·re-snapshot 복구 |
| R-API-003 | SPEC-101 + SPEC-102 | SPEC-101-AC-03/04/12/16; SPEC-102-AC-03/04/05/11 | U·I | `snapshotVersion` 단조·ordering·idempotency([[08-Decisions|D-025]]) |
| R-API-004 | SPEC-101 (client SPEC-200) | SPEC-101-AC-06/07/08/13; SPEC-200-AC-10 | I·C | manual refresh `POST /api/refresh`→GET fallback([[08-Decisions|D-033]]) |
| R-API-005 | SPEC-101 (client SPEC-200) | SPEC-101-AC-09/10/11; SPEC-200-AC-12 | I·C | API error 사용자 envelope vs debug log 분리 |

### 2.8 R-SET — Settings·Local persistence (1차 [[SPEC-500-settings-persistence]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-SET-001 | SPEC-500 | SPEC-500-AC-01/02/03/05/09/10/13 | U·I | config schema·GET/PATCH·live-reload. redaction은 floor-lock([[08-Decisions|D-027]]) |
| R-SET-002 | SPEC-500 | SPEC-500-AC-06/07/11 | I | output/summary/token/secret 비저장·atomic write |
| R-SET-003 | SPEC-500 (doctor SPEC-100) | SPEC-500-AC-08; SPEC-100-AC-07 | I | configDir XDG 해석([[08-Decisions|D-029]])·doctor 노출 |

### 2.9 R-SEC — 보안·네트워크 (1차 [[SPEC-100-server-lifecycle]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-SEC-001 | SPEC-100 | SPEC-100-AC-11, AC-19 | I | loopback bind + Host-header(DNS rebinding) 방어([[08-Decisions|D-034]]) |
| R-SEC-002 | SPEC-100 | SPEC-100-AC-12/16/10 | I | token in URL·CSPRNG ≥128bit·timing-safe |
| R-SEC-003 | SPEC-100 (read gating D-024) | SPEC-100-AC-13/20; SPEC-101-AC-13; SPEC-400-AC-05 | I | state-changing + read token 요구([[08-Decisions|D-024]]) |
| R-SEC-004 | SPEC-100 | SPEC-100-AC-14 | I | 외부 bind는 `--allow-external` opt-in + warning |
| R-SEC-005 | SPEC-100 | SPEC-100-AC-15, AC-19 | I | CORS allowlist origin |

### 2.10 R-OBS — Diagnostics·Observability (1차 [[SPEC-600-observability]])

| R-* | 1차 소유 | 대표 AC | layer | 비고 |
| --- | --- | --- | --- | --- |
| R-OBS-001 | SPEC-600 | SPEC-600-AC-01/02/03/04/13/16 | U·I | ActivityEvent 5 taxonomy + canonical `control.result`([[08-Decisions|D-028]]) |
| R-OBS-002 | SPEC-600 | SPEC-600-AC-05/09/12 | I | debug log JSON Lines·오류+timing·rotation |
| R-OBS-003 | SPEC-600 (강제 SPEC-006) | SPEC-600-AC-06/07/08/14; SPEC-006-AC-11/13 | I | log redaction·metadata-only. `TC-I-DIAG-PRIVACY` |
| R-OBS-004 | SPEC-600 | SPEC-600-AC-10 | I | doctor log.path detail(discoverability) |

> **P0 GAP 행: 없음.** 위 10개 그룹 58개 P0 `R-*`(CLI 7·TMUX 6·ORC 7·UI 7·PRIV 6·CTRL 8·API 5·SET 3·SEC 5·OBS 4)가 모두 ≥1 대표 AC에 매핑된다(full-product 게이트 결론과 정합: P0 추적 gap 0). 무커버 R-*가 발견되면 이 표에 `**P0 GAP**` 행으로 추가하고 [[08-Decisions]]로 해소한다.

## 3. 비기능·P1·P2 커버리지

### 3.1 비기능 커버리지([[02-Requirements]] 비기능 표 11영역)

| 영역 | 소유 spec | 대표 AC | 비고 |
| --- | --- | --- | --- |
| Local-first | SPEC-100 / SPEC-700 ([[08-Decisions|D-003]]) | SPEC-100-AC-11; SPEC-700-AC-13, AC-18 | loopback 기본·텔레메트리 없음 |
| 보안 | SPEC-400 / SPEC-100 | SPEC-400-AC-03/04/05/06; SPEC-100-AC-13/15/19 | token·target 재검증·allowlist·confirm |
| 개인정보 | SPEC-006 | SPEC-006-AC-01~05/10/11; SPEC-007-AC-04 | redaction·원문 비저장·false-redaction ≤τ |
| 성능 | SPEC-200 | SPEC-200-AC-06, AC-13 | 20 session/100 pane 정규화·windowing |
| Scan latency | SPEC-007 / SPEC-001 | SPEC-007-AC-05; SPEC-001 `--watch` interval `[1,5]s` | p95 < 1s 가설·timeout bound |
| 신뢰성 | SPEC-002 / SPEC-102 / SPEC-100 | SPEC-002-AC-04/05/06; SPEC-102-AC-06~10; SPEC-100-AC-02/03/18 | tmux 실패·WS 끊김·port·browser 실패 비전파 |
| 확장성 | SPEC-800 / SPEC-003 | SPEC-800-AC-01/03/08; SPEC-003-AC-07 | detector adapter·config rule·packaging-agnostic |
| 사용성 | SPEC-202 | SPEC-202-AC-21 | 1분 이해·density·raw target+label |
| 접근성 | SPEC-202 | SPEC-202-AC-03/04/06/07~15 | 비색상 redundant encoding·키보드·reduced-motion·대비 |
| 관측성 | SPEC-600 | SPEC-600-AC-11, AC-15 | doctor diagnostics·problem report 번들(원문 없이 triage) |
| 배포 | SPEC-700 | SPEC-700-AC-01~04/10/11/12/15/16/17 | npm global·uninstall 잔존 정책·license 게이트([[08-Decisions|D-009]]/[[08-Decisions|D-032]]) |

> 비기능 11영역 모두 ≥1 AC 커버(§4 SPEC-900-AC-03). 일부 임계값(접근성 대비·latency·false-redaction τ)은 **PoC 가설**이며 [[SPEC-007-test-validation]]·후속 측정으로 보정한다.

### 3.2 채택 P1 커버리지

| R-P1-* | 소유 spec | 대표 AC | 비고 |
| --- | --- | --- | --- |
| R-P1-001 (camp/orc alias·note) | SPEC-500 | SPEC-500-AC-P1-01 | SQLite `alias` table(stable id 키) |
| R-P1-002 (수동 mark/unmark) | SPEC-500 | SPEC-500-AC-P1-02 | SQLite `manual_mark`(paneId 키) |
| R-P1-004 (sprite variant·animation) | SPEC-300 (정합 SPEC-202, movement SPEC-301) | SPEC-300-AC-01~07/11; SPEC-202-AC-06/11; SPEC-301-AC-04/05/07/13 | agentType별 variant·status animation·reduced-motion·roaming movement(8방향) |
| R-P1-006 (SQLite history) | SPEC-500 | SPEC-500-AC-P1-03/04/05 | session/event history·redacted·retention·output opt-in |
| R-P1-010 (Linux 검증·문서화) | SPEC-700 | SPEC-700-AC-14 | `smoke:linux` job(P1 advisory) |
| R-P1-011 (detector config/plugin 확장) | SPEC-800 | SPEC-800-AC-03/04/05/06/08 | config-rule-first([[08-Decisions|D-031]])·calibration 우회 불가 |
| R-P1-013 (status 변화 roaming 이동·8방향) | SPEC-301 (sprite SPEC-300) | SPEC-301-AC-04/05 | roaming walk-cycle 진입·8방향 quantize([[08-Decisions|D-035]]) |

> 미채택 P1(R-P1-003/005/007/008/009/012)은 owner spec에서 **forward 제약**으로만 보존된다(예: SPEC-202-AC R-P1-009 forward focus backbone). P0 커버리지 대상 아님.

### 3.3 P2 pre-flag ledger — forward, NOT a P0 gap

> P2는 [[docs/specs/README|README]] 추적성 원칙대로 **forward pre-flag**이며 P0 커버리지 대상이 아니다. 5개 항목은 [[SPEC-800-extensibility]] §4가 스트레스 불변식과 함께 명시한다. 아래 표는 **gap이 아님을 증명**한다.

| R-P2-* | 소재 | 스트레스 불변식 |
| --- | --- | --- |
| R-P2-001 (dashboard agent spawn) | [[SPEC-800-extensibility]] §4.3 | **read-only**([[08-Decisions|D-019]]) 정면 위반 — process 생성은 state-changing |
| R-P2-002 (camp template 저장/재사용) | [[02-Requirements]] P2 (저-압력) | 핵심 불변식 비-스트레스(설정 persistence 확장) — §6 Q2 |
| R-P2-003 (remote camps SSH) | [[SPEC-800-extensibility]] §4.1 | **local-first([[08-Decisions|D-003]]) + read-only + privacy** — 신뢰 경계 network 확장 |
| R-P2-004 (team read-only observer) | [[SPEC-800-extensibility]] §4.2 | **privacy + single-user token** — 다자 공유 안전·per-user 인증 |
| R-P2-005 (action replay·timeline) | [[02-Requirements]] P2 (저-압력) | 보존 정책 충돌 가능(원문 비저장) — §6 Q2 |
| R-P2-006 (workflow automation·handoff) | [[SPEC-800-extensibility]] §4.4 | **read-only + 단정 금지(confidence)** — 추론 오류가 행동 오류로 격상 |
| R-P2-007 (enterprise policy·audit export) | [[SPEC-800-extensibility]] §4.5 | **privacy(비저장) + local-first** — audit export가 R-PRIV-004/005와 충돌 |

> 7개 중 5개(001/003/004/006/007)는 [[SPEC-800-extensibility]] §4에 스트레스 불변식과 함께 정식 pre-flag. R-P2-002/005는 핵심 불변식 압력이 낮아 §4 stress-flag에 미포함(§6 Q2 — 보완 권고). **어느 것도 P0 gap이 아니다**(§4 SPEC-900-AC-04).

## 4. Acceptance criteria

> 롤업의 AC는 **완결성(completeness)**을 검증한다. 각 항은 본 문서 또는 owner spec 집합에 대해 객관적으로 판정 가능하다.

- **SPEC-900-AC-01** (orphan-0 / P0 커버리지)
  - Given §2의 전체 제품 P0 매트릭스가 주어졌을 때
  - When 10개 그룹의 모든 P0 `R-*`(R-CLI-001~007·R-TMUX-001~006·R-ORC-001~007·R-UI-001~007·R-PRIV-001~006·R-CTRL-001~008·R-API-001~005·R-SET-001~003·R-SEC-001~005·R-OBS-001~004)를 순회하면
  - Then 각 `R-*`가 ≥1 owner-spec AC id에 매핑되고 **`P0 GAP` 행이 0개**이며, 매핑된 AC id가 해당 owner spec의 `## 5/Traceability`에 실재한다.

- **SPEC-900-AC-02** (AC 실재성·교차검증)
  - Given §2가 인용한 모든 대표 AC id가 있을 때
  - When 각 id를 owner spec의 `SPEC-NNN-AC-NN` 정의와 대조하면
  - Then 인용된 모든 AC id가 owner spec에 정의돼 있고(dangling 참조 0), 각 AC가 출처 `R-*`를 괄호로 표기한다([[SPEC-000-conventions]] 수용 기준 형식).

- **SPEC-900-AC-03** (비기능 완결성)
  - Given [[02-Requirements]] 비기능 11영역이 주어졌을 때
  - When §3.1을 순회하면
  - Then 각 영역이 ≥1 소유 spec/AC에 매핑되고, 미매핑 영역이 0개다.

- **SPEC-900-AC-04** (P1 채택분 + P2 pre-flag 정합)
  - Given 채택 P1(R-P1-001/002/004/006/010/011)과 P2(R-P2-001~007)가 주어졌을 때
  - When §3.2/§3.3을 순회하면
  - Then 채택 P1은 각각 ≥1 AC에 매핑되고, P2 7개는 모두 forward pre-flag로 표기되어 **어느 것도 P0 GAP으로 분류되지 않는다**(P2는 P0 커버리지 비대상).

- **SPEC-900-AC-05** (no silent truncation)
  - Given §5의 의도적 후속(deferred) 항목 ledger가 주어졌을 때
  - When 각 deferred 항목(R-CLI-002 scan-negative, R-TMUX-003 serve-via-events, R-PRIV-006 dashboard preview 등)을 검사하면
  - Then 각 항목이 **어느 슬라이스/spec으로 미뤄졌는지와 미충족이 아니라 deferred임**이 명시되며, "조용히 누락"된 요구사항이 0개다.

- **SPEC-900-AC-06** (gate-fix 반영)
  - Given full-product 게이트 수정([[08-Decisions|D-022]] WS `/api/events`, [[08-Decisions|D-026]] preview endpoint, [[08-Decisions|D-028]] `control.result` envelope)이 있을 때
  - When R-UI-004 preview·R-PRIV-006·R-CTRL-007·R-API-001/002의 매핑을 검사하면
  - Then 세 수정이 각 요구사항 행에 반영돼 있고, 해당 데이터 경로가 owner spec AC로 연결된다(preview text 경로는 SPEC-101-AC-17/18로 검증).

## 5. Epic→spec→status 개요 + no silent truncation

### 5.1 Epic→spec→status 개요

| Epic | spec | status(헤더 SSOT) | 게이트 |
| --- | --- | --- | --- |
| 1 Scan | SPEC-001~007 | **approved** | 1차 게이트 통과(2026-06-26), P0 gap 0 |
| 2 Server·API | SPEC-100/101/102 | draft | full-product 게이트(2026-06-27) 통과, 미승격 |
| 3 Dashboard | SPEC-200/201/202 | draft | 동일 |
| 4 Camp Visual | SPEC-300 / SPEC-301 | SPEC-300 draft · SPEC-301 draft | SPEC-301(camp 맵·movement·roaming) 신규, spec-reviewer 게이트 대기 |
| 5 Control | SPEC-400 | draft | 동일 |
| 6 Settings | SPEC-500 | draft | 동일 |
| 7 Observability | SPEC-600 | draft | 동일 |
| 8 Packaging | SPEC-700 | draft | 동일 |
| 9 Extensibility | SPEC-800 | draft | 동일(P2 forward) |

> Epic 2~9 spec은 full-product 게이트(두 리뷰어 P0 blocker 0·P0 추적 gap 0)를 통과했으나 헤더 status는 `draft`다. 구현 착수 전 `approved` 승격은 orchestrator 소관이며, 본 롤업이 그 승격의 추적성 근거(orphan-0)를 제공한다.

### 5.2 No silent truncation ledger (의도적 deferred 명시)

> 아래는 **미충족이 아니라 의도적으로 후속 슬라이스로 미룬** 항목이다. 각 항목은 owner/대상 슬라이스와 근거 결정을 명시한다(§4 SPEC-900-AC-05).

| 항목 | 미룬 곳 | 근거 | 현재 슬라이스 처리 |
| --- | --- | --- | --- |
| R-CLI-002 (browser open 실패→URL stdout) | serve(SPEC-100) | scan엔 server/URL 부재 | SPEC-001-AC-14 **negative**(어떤 port도 listen 안 함)로 검증 |
| R-TMUX-003 (구조 변화 dashboard 반영) | serve(SPEC-101 diff + SPEC-102 event) | 실시간 반영은 server-runtime 필요 | scan `--watch` cycle로 **부분 충족**([[08-Decisions|D-014]]); 전체는 SPEC-102-AC-11 |
| R-PRIV-006 (preview 노출/line-count 조정) | dashboard(SPEC-201) + settings(SPEC-500) | scan preview는 metadata-only | scan-MVP는 flag **reserved**(SPEC-001-AC-15 negative, [[08-Decisions|D-021]]); 본체는 SPEC-201-AC-09/10 + SPEC-500-AC-04/12 |
| preview text 전달 endpoint | SPEC-101 `GET /api/orcs/:orcId/preview` | snapshot은 metadata-only 유지 | [[08-Decisions|D-026]] 경로 확정, **SPEC-101-AC-17/18**로 검증 |
| 미채택 P1(R-P1-003/005/007/008/009/012) | 후속 P1 wave | MVP 비필수 | owner spec에 forward 제약으로 보존(예: SPEC-202 R-P1-009 focus backbone) |
| P2(R-P2-001~007) | 미래 epic | 비목표/forward | [[SPEC-800-extensibility]] §4 pre-flag(§3.3) |

> 위 6행 외에 "조용히 누락"된 P0/채택-P1 요구사항은 없다(§4 SPEC-900-AC-05). scan 슬라이스 정합 정정(D-014~D-021)과 full-product 정정(D-022~D-034)은 모두 [[08-Decisions]]에 기록됐고 본 매트릭스에 반영됐다.

## 6. Open Questions / Conflicts

### Conflicts / Upstream

- **C1 — README index status 요약 ↔ 헤더 status(정보성)**: [[docs/specs/README|README]] Epic 2~9 인덱스 표는 spec을 `planned`로 표기하나, 실제 헤더 status는 `draft`이고 full-product 게이트를 통과했다. README는 "표는 요약, 헤더가 SSOT"라고 명시하므로 충돌은 아니나, orchestrator가 인덱스 표를 `draft`로 갱신하면 정합이 명확해진다. **표시만**(본 spec은 README를 수정하지 않음).

### Open Questions (검토 필요)

- **U1 — SPEC-101 preview-endpoint AC (해소)**: [[08-Decisions|D-026]]의 `GET /api/orcs/:orcId/preview`(token + exposure gated, redacted tail)가 [[SPEC-101-snapshot-api]]에 **SPEC-101-AC-17/AC-18**로 추가되어 R-UI-004 preview·R-PRIV-006의 end-to-end 검증 경로가 닫혔다([[SPEC-201-dashboard-screens]] U1도 이 endpoint 소비로 해소). 잔여 없음.
- **Q2 — R-P2-002/005 stress-flag 보완 (검토 필요)**: R-P2-002(camp template)·R-P2-005(action replay·timeline)는 [[02-Requirements]] P2에 있으나 [[SPEC-800-extensibility]] §4 stress ledger(001/003/004/006/007)에 미포함이다. 두 항목은 핵심 불변식 압력이 낮지만(template=설정 확장, replay=보존 정책), **replay는 "원문 비저장"(R-PRIV-004/005)과 잠재 충돌**하므로 §4에 1줄 pre-flag를 추가하면 P2 ledger가 7/7 완결된다. P0 비대상이므로 비-blocker. **검토 필요.**
- **Q3 — Epic 2~9 테스트 계층 forward (검토 필요)**: 본 롤업은 각 P0를 검증할 layer(U/I/C/M/E)를 **명명**했으나, Epic 2~9의 구체 `TC-*`·fixture·mock 경계는 [[SPEC-007-test-validation]]에 준하는 후속 test spec(미작성)이 소유해야 한다. 특히 HTTP/WS handler mock 경계, FE component 결정성(store reducer), control write-path(`controlExec`) 격리 테스트는 scan 슬라이스의 `tmuxExec` mock 패턴을 재사용 가능하다. 후속 test spec 작성 시 본 매트릭스를 입력으로 쓴다. **검토 필요.**

> 위 Open Question은 모두 **비-blocker**다. P0 추적 커버리지(orphan-0)는 충족됐고(SPEC-900-AC-01), 잔여는 P2 ledger 완결(Q2)·후속 test spec(Q3) 수준이다(U1은 SPEC-101-AC-17/18로 해소).
