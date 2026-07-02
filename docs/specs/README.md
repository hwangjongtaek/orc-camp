---
title: Orc Camp 구현 Spec SSOT
status: active
updated: 2026-06-27
tags:
  - specs
  - ssot
  - orc-camp
---

# Orc Camp Specs — 구현 단일 진실 공급원 (SSOT)

이 폴더(`docs/specs/`)는 Orc Camp **구현의 단일 진실 공급원(SSOT)**이다. 청사진 문서(`docs/product/`, `docs/design/`, `docs/assets/`)가 *무엇을·왜·어떻게 설계할지*를 정의한다면, 여기 spec은 *개발자가 바로 티켓으로 분해해 구현하고 테스트로 검증할 수 있는 계약*을 고정한다.

> **규칙**: 코드를 작성/수정하기 전 해당 영역 spec을 확인한다. 구현이 spec과 달라지면 **spec을 먼저 갱신**한다. 청사진과 spec이 충돌하면 spec의 `Conflicts / Upstream` 섹션에 기록하고 [[08-Decisions]]로 해소한다.

## 범위: 전체 제품 목표

이 spec 세트의 대상은 **Orc Camp 제품 목표 전체**다([[01-Planning]], [[02-Requirements]], [[07-Roadmap]]): tmux camp 발견 → AI agent orc 상태/confidence 시각화 → terminal preview(privacy) → 안전한 control(text/interrupt) → realtime sync → settings/persistence → npm 배포. PoC(`orc-camp scan`)는 이 목표의 첫 수직 슬라이스(Epic 1)이며 이미 완료됐다.

Epic은 [[07-Roadmap]] Milestone과 [[02-Requirements]] `R-*`를 따라 분해한다. Epic별 담당은 [.claude/ORG.md](../../.claude/ORG.md)의 squad/RACI를 따른다.

## Spec 인덱스 (Epic별)

> `status`는 각 spec header가 SSOT이며 이 표는 요약이다. `planned`는 다음 wave에서 작성 예정. 담당은 ORG.md role.

### Epic 1 — Scan / Discovery (완료, read-only PoC)

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-000-conventions]] | Spec 작성 규약 | (meta) | spec-author | draft |
| [[SPEC-001-scan-cli]] | `orc-camp scan` CLI 표면 | R-CLI-004 | spec-author | approved |
| [[SPEC-002-tmux-discovery]] | tmux inventory 수집 | R-TMUX-001/002/004/005/006 | tmux-systems-eng | approved |
| [[SPEC-003-agent-detection]] | Agent type 핑거프린팅 | R-ORC-001/002/007 | detection-engineer | approved |
| [[SPEC-004-status-inference]] | Status·confidence 추론 | R-ORC-003/004/005/006 | detection-engineer | approved |
| [[SPEC-005-data-contract]] | scan 출력 데이터 계약 | R-CLI-004, R-TMUX-005/006, R-ORC-003/004/005 | spec-author + backend | approved |
| [[SPEC-006-privacy-redaction]] | Privacy·redaction·read-only (+ANSI stream redaction) | R-PRIV-001~005/008, R-TMUX-001(enforce)/004, R-OBS-003 | security-privacy-eng | approved |
| [[SPEC-007-test-validation]] | 테스트 전략·PoC 측정 | (slice 수용 기준 + PoC 지표) | qa-test-strategist | approved |
| [[SPEC-008-usage-collection]] | 세션 로그 usage 수집 privacy 계약(token/cost 집계, SPEC-006 자매·확장; R-P2-008 forward 게이트) | R-PRIV-007(proposed), R-PRIV-002/004/005, R-OBS-003, R-P2-008 | security-privacy-eng | draft |

### Epic 2 — Local Server & API

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-100-server-lifecycle]] | server 수명주기·CLI·보안 경계 | R-CLI-001/002/003/005/006/007, R-SEC-001~005 | Backend Lead + Security | approved |
| [[SPEC-101-snapshot-api]] | snapshot runtime·REST API | R-API-003/004/005 | Backend Lead | approved |
| [[SPEC-102-realtime-sync]] | WebSocket event·reconnect (+live-view frame catalog) | R-API-001/002/003/006 | Backend Lead + Frontend | approved |
| [[SPEC-103-pane-live-stream]] | live pane view 채널(attach/detach·폴링·부하 한도·`pane_view` 프레임·redaction egress·커서/스크롤백 seed) | R-API-006, R-PRIV-008, R-UI-012 | Backend Lead + Security | approved |

### Epic 3 — Dashboard (Frontend)

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-200-frontend-architecture]] | FE 아키텍처·라우팅·상태·데이터흐름 (+`layoutMode`·xterm code-split) | R-UI-001, R-API-001, R-UI-012 | Frontend Lead | approved |
| [[SPEC-201-dashboard-screens]] | camp list/detail/inspector/preview·상태 (+dock↔terminal 공존) | R-UI-001~005/007/012 | Frontend Lead + UI/UX | approved |
| [[SPEC-202-design-accessibility]] | 디자인 시스템 적용·접근성 (+terminal mode indicator token) | R-UI-006/012, 접근성 비기능 | UI/UX Designer | approved |
| [[SPEC-203-terminal-workspace]] | terminal 모드 화면/레이아웃·orc rail·스위칭/퀵스위처·xterm 통합·관전/조종 표시·a11y | R-UI-012/005/007/008, R-PRIV-006 | Frontend Lead + UI/UX | approved |

### Epic 4 — Camp Visual (Asset render)

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-300-asset-rendering]] | 런타임 asset 소비·sprite 상태머신·fallback | R-UI-003/006, R-P1-004 | Asset/Realtime Eng | approved |
| [[SPEC-301-camp-map-movement]] | camp 공간 맵·결정적 배치·roaming movement | R-UI-008, R-P1-013 | Asset/Realtime Eng | approved |
| [[SPEC-302-mascot-prestige-tiers]] | character 누적 token/cost 기반 외형 tier resolution (delivered 5종: mascot·shaman·codex·unknown·iron-commander) | R-P2-008(proposed), R-P1-004/005 | Asset/Realtime Eng | draft |
| [[SPEC-303-epic-monster-npc]] | 배경별 epic 보스 몬스터 ambient NPC(full-polygon roaming·dwell/error FSM·비-상호작용·비-load-bearing) + 자산 [[16-Epic-Monster-NPC]] | R-UI-010(proposed), R-P1-004, R-UI-008 | Scene Placement Eng | draft |
| [[SPEC-304-character-avatar-portraits]] | character avatar portraits — Detail panel 우측 BG식 2:3 흉상(정적·비-load-bearing·CSS frame·결정적 resolve·placeholder parity, 5 base + 15 tier) + 자산 [[17-Character-Avatar-Portraits]] | R-UI-011(proposed), R-UI-004, R-P1-004, R-P2-008(proposed), R-UI-006 | Asset/Realtime Eng + UI/UX | draft |

### Epic 5 — Control Actions

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-400-control-actions]] | text/key/interrupt·안전장치·audit·UI flow (+passthrough 접점·control-byte 필터) | R-CTRL-001~009, R-UI-004 | Backend Lead + Security + UI/UX | approved |
| [[SPEC-401-interactive-input]] | keyboard passthrough·관전/조종 arm/disarm·확장 allowlist·rate limit·batch audit | R-CTRL-009/001/002/005/007 | Backend Lead + Security | approved |

### Epic 6 — Settings & Persistence

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-500-settings-persistence]] | local config·settings API·P1 SQLite | R-SET-001~003, R-PRIV-006, R-P1-001/002/006 | Backend Lead + Security | approved |

### Epic 7 — Observability & Diagnostics

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-600-observability]] | activity log·debug log·doctor 진단 | R-OBS-001~004 | Infra Architect + Backend | approved |

### Epic 8 — Packaging & Distribution

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-700-packaging-release]] | npm 패키징·doctor·smoke·설치/제거·license 게이트 | 배포 비기능, R-P1-010, D-009 | Release/DevOps Eng | approved |

### Epic 9 — Extensibility (forward)

| Spec | 제목 | 다루는 요구사항 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-800-extensibility]] | detector adapter/plugin·config rule·P2 pre-flag | R-ORC-007, R-P1-011, R-P2-* | Detection Eng | approved |

### Cross-cutting — 추적성 롤업

| Spec | 제목 | 내용 | 담당 | status |
| --- | --- | --- | --- | --- |
| [[SPEC-900-traceability-rollup]] | 전체 제품 추적성 롤업 | 전 P0 `R-*`(58)·비기능(11)·채택 P1(6) → spec/AC 매핑, P2 pre-flag ledger, orphan-0 확증 | qa-test-strategist | approved |

> Epic 1 주석: SPEC-001 요구사항에서 `R-CLI-002`는 `serve` 슬라이스(SPEC-100) 소관으로 이관했다. SPEC-006의 `R-TMUX-001`은 read-only 강제 wrapper 공동 소유분이다.

## Status 범례

| status | 의미 |
| --- | --- |
| `planned` | 작성 예정(파일/뼈대 없음 또는 stub) |
| `draft` | 초안 작성됨, 미검토 |
| `review` | spec-reviewer / product-architect 게이트 진행 중 |
| `approved` | 게이트 통과, 구현 착수 가능 |
| `superseded` | 후속 spec/결정으로 대체됨(상단에 후속 링크) |

## 작성·검토 워크플로

1. **작성**: 영역별 담당 subagent가 [[SPEC-000-conventions]] 형식으로 spec을 쓴다.
2. **추적성**: 모든 spec 진술을 `R-*`/`D-*`에 연결하고, 각 수용 기준에 안정 ID(`SPEC-NNN-AC-NN`)를 부여한다.
3. **게이트**: spec-reviewer(추적성·테스트 가능성·정합성·제약 준수)와 product-architect(end-to-end 정합)가 검토한다.
4. **해소**: P0/P1 발견은 담당 subagent가 재작성한다. 결정 변경은 [[08-Decisions]]에 `D-0xx`로 남긴다.
5. **승격**: 게이트 통과 시 `approved`로 올리고 구현 착수.

## 추적성 원칙

- **제품 목표 전체**의 모든 P0 `R-*`(및 채택된 P1)는 최소 하나의 spec 수용 기준에 매핑된다(누락 = P0 gap).
- 수용 기준 없는 spec 진술(orphan)과 spec 없는 요구사항(orphan requirement)은 게이트에서 검출한다.
- Epic 1(scan) 추적 매트릭스는 [[SPEC-007-test-validation]]이 통합한다. **전체 제품 추적 롤업**은 [[SPEC-900-traceability-rollup]](전 epic 게이트 후 작성)이 통합한다.
- P2(remote/team/agent-start 등)는 비목표 또는 forward pre-flag로 명시 표기하며 P0 커버리지 대상이 아니다.

## 변경 프로토콜

- spec은 append/refine 우선. 의미를 바꾸면 header의 `updated`와 status를 갱신한다.
- 대체가 필요하면 옛 spec을 `superseded`로 두고 상단에 후속 spec을 링크한다(삭제하지 않는다).
- 확정 사양과 "PoC로 검증할 가설"을 항상 구분 표기한다(특히 status threshold).

## 게이트 이력 (Gate log)

### 2026-06-26 — 1차 게이트 (spec-reviewer + product-architect)

- **판정**: 보강 필요 → P1 보강 후 **approved**. P0 blocker 없음. 1차 슬라이스 범위 P0 `R-*` 전부 추적 커버(orphan requirement 0). 두 리뷰어가 독립적으로 동일 결론.
- **해소된 P1**: process-introspection(`cmdline`) 수집 ownership 공백([[SPEC-002-tmux-discovery]] §2.8), `agentSignals` emptiness 모순·internal→wire 매핑([[SPEC-005-data-contract]] §3.2), single-shot vs `--watch` 미결정([[08-Decisions|D-014]]), R-PRIV-006 범위([[08-Decisions|D-021]]), CLI 표 컬럼 계약 불일치([[SPEC-001-scan-cli]] §4), PoC 측정의 `--watch` 모드 반영([[SPEC-007-test-validation]] M2/M4).
- **확정 결정**: [[08-Decisions|D-014]]~[[08-Decisions|D-021]].
- **남은 항목(비-blocker)**: 각 spec의 Open Questions는 대부분 **PoC로 보정할 임계값/가설**(confidence band·threshold·interval·false-redaction τ 등)이며 구현 착수를 막지 않는다. `R-CLI-002`(serve 슬라이스)·`R-TMUX-003`(serve/dashboard, `--watch` 부분 충족)은 의도적으로 후속 슬라이스로 pre-flag.

### 2026-06-27 — 전체 제품 게이트 (spec-reviewer + product-architect)

- **범위**: Epic 2~9(SPEC-100~800) 전체 제품 spec. Epic 1은 기존 통과분.
- **판정**: 보강 필요 → P1 보강 후 **approved**. 두 리뷰어 모두 **P0 architecture blocker 0 · P0 추적 gap 0**(58개 P0 `R-*` 전부 covering AC 보유, [[SPEC-900-traceability-rollup]] 확증).
- **해소된 항목**: preview-text 전달 endpoint 공백(P0-1) → `GET /api/orcs/:orcId/preview`([[08-Decisions|D-026]], SPEC-101-AC-17/18); WS endpoint 모순 `/ws`→`/api/events`([[08-Decisions|D-022]]); control audit envelope 통일(SPEC-400↔600, [[08-Decisions|D-028]]); token 운반·read 게이팅([[08-Decisions|D-023]]/[[08-Decisions|D-024]]); redaction floor-lock([[08-Decisions|D-027]]); control write-path 분리([[08-Decisions|D-028]]); config dir([[08-Decisions|D-029]]); 자산 매핑([[08-Decisions|D-030]]); detector 확장([[08-Decisions|D-031]]); license gate([[08-Decisions|D-032]]).
- **확정 결정**: [[08-Decisions|D-022]]~[[08-Decisions|D-034]].
- **남은 항목(비-blocker)**: 다수 임계값(token 길이·port·heartbeat·rate-limit·KEY_ALLOWLIST·대비비율 등)은 PoC/디자인 QA로 보정할 가설. 일부 청사진 design 문서(05-Backend REST 표·06-Infra path 예시)는 spec(SSOT)이 우선하며 점진 정합 대상. P2(remote/team/agent-start)는 [[SPEC-800-extensibility]] §4에 pre-flag.

### 2026-07-02 — Terminal Workspace 게이트 (도메인 리뷰 + spec-reviewer)

- **범위**: [[18-Terminal-Workspace]] 설계안 §7 위임. 신규 [[SPEC-103-pane-live-stream]]·[[SPEC-203-terminal-workspace]]·[[SPEC-401-interactive-input]], 개정 [[SPEC-006-privacy-redaction]]·[[SPEC-102-realtime-sync]]·[[SPEC-201-dashboard-screens]], 접점 정합 [[SPEC-400-control-actions]]·[[SPEC-600-observability]]·[[SPEC-200-frontend-architecture]]·[[SPEC-202-design-accessibility]]. 결정 [[08-Decisions|D-041]]~[[08-Decisions|D-046]], 요구사항 R-UI-012/R-API-006/R-PRIV-008/R-CTRL-009.
- **파이프라인**: spec-author 3-cluster 병렬 초안 → 병렬 도메인 리뷰(tmux-systems / security-privacy / product-ui) → 저자 수정 → spec-reviewer 최종 게이트.
- **판정**: **CONDITIONAL → P1 보강 후 통과. P0 architecture blocker 0 · P0 추적 gap 0**(4개 신규 `R-*` 전부 covering AC 보유). 도메인 리뷰가 검출한 2개 P0를 저자 수정으로 해소: (1) **seq 채널 혼선** — live view(`version:null`) 프레임을 연결 `seq`-gap resync에서 제외해 dropped `pane_view`가 snapshot resync storm을 유발하지 않도록 고정([[SPEC-102-realtime-sync]] §2.2/§2.3/§3.5 AC-15, [[SPEC-103-pane-live-stream]] AC-13); (2) **literal control-byte 우회** — `/input` literal `text`의 제어바이트(`0x00–0x1F`/`0x7F`)를 controlExec 이전 `422`로 거부해 `/interrupt` confirm 게이트 우회를 폐쇄([[SPEC-400-control-actions]] §2.3.1 AC-20, [[SPEC-401-interactive-input]] AC-13).
- **확정 결정**: [[08-Decisions|D-041]]~[[08-Decisions|D-046]] — **2026-07-02 제품 오너 Accepted 승인**. 관련 spec(신규 SPEC-103/203/401 + 개정 SPEC-006/102/201/400/600/200/202) 전부 `approved` 승격.
- **남은 항목(비-blocker)**: 다수 임계값(폴링 주기·부하 한도·`PASSTHROUGH_IDLE_MS`·키스트로크 rate·RP-10/11 min-length·번들 예산 등)은 [[SPEC-007-test-validation]]/사용성 QA로 보정할 가설. Phase 1.5 styled(ANSI) redaction·Phase 2 `tmux -C` 브리지(제안 [[SPEC-103-pane-live-stream]] §6 후속 `SPEC-104-control-mode-bridge`)는 forward pre-flag. 블루프린트 [[18-Terminal-Workspace]] §4 `display-message`→`list-panes` 문구는 정합화 완료.

> 다음 게이트는 구현 중 spec 변경이 생기거나 P2 forward epic을 착수할 때 수행한다. 구현 시 전 epic이 `docs/specs/`를 SSOT로 따른다. Terminal Workspace 결정(D-041~046)은 **2026-07-02 제품 오너 승인 완료**로 관련 spec이 `approved`이며 구현 착수됐다(Phase 1 백엔드 SPEC-103/401).
