# 08 Decisions

## D-001: 제품명은 Orc Camp로 한다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **맥락**: 제품은 tmux session 기반 AI agent orchestration을 게임형 camp metaphor로 설명한다.
- **결정**: UI와 문서의 제품명은 Orc Camp로 표기하고, CLI command는 `orc-camp`로 둔다.
- **근거**: tmux session을 camp, agent session을 orc로 설명하는 제품 구조가 이름에 직접 반영된다.

## D-002: tmux session을 Camp의 1급 단위로 둔다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **결정**: camp는 tmux session에 매핑한다. window/pane은 camp 내부 구조로 표현한다.
- **대안**: pane 단위 flat list, project directory 단위 grouping.
- **근거**: 사용자가 tmux로 이미 작업 context를 나누고 있으므로 session 단위가 mental model과 가장 가깝다.

## D-003: MVP는 local-first dashboard로 제한한다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **결정**: CLI가 local server를 띄우고 localhost dashboard를 연다. cloud backend와 remote observer는 MVP에서 제외한다.
- **근거**: terminal output과 workspace 정보는 민감할 수 있어 local-first가 초기 신뢰 확보에 유리하다.

## D-004: TypeScript monorepo를 초기 가정으로 둔다

- **상태**: Proposed
- **결정일**: 2026-06-25
- **결정**: CLI/server/dashboard를 TypeScript monorepo로 시작하는 것을 가정한다.
- **근거**: web dashboard와 API type 공유가 쉽고 초기 구현 속도가 빠르다.
- **재검토 조건**: tmux control 안정성, 배포 단일 binary, performance 요구가 커지면 Rust를 검토한다.

## D-005: snapshot + WebSocket event 구조를 사용한다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **결정**: REST snapshot으로 초기 상태를 가져오고 WebSocket event로 변경을 반영한다.
- **근거**: tmux polling과 UI state update를 분리하고, reconnect 시 복구가 쉽다.

## D-006: control action은 안전 장치를 기본값으로 둔다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **결정**: text input은 명시 선택된 target에만 보내고, interrupt는 confirm modal을 요구한다.
- **근거**: 잘못된 pane에 command를 보내면 실제 workspace에 영향을 줄 수 있다.

## D-007: PixelLab.ai asset은 MVP 기능 blocker가 아니다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **결정**: PixelLab.ai asset을 최종 visual asset 후보로 두되, MVP는 placeholder pixel asset으로 구현 가능해야 한다.
- **근거**: 핵심 가치는 tmux/agent orchestration이며 asset pipeline은 시각 품질을 높이는 요소다.

## D-008: terminal output 저장은 opt-in으로 둔다

- **상태**: Proposed
- **결정일**: 2026-06-25
- **결정**: dashboard preview는 memory 기반 짧은 window로 시작하고, history 저장은 사용자가 명시적으로 켤 때만 한다.
- **근거**: terminal output에는 token, private path, 고객 정보가 포함될 수 있다.

## D-009: PixelLab.ai asset은 manifest 기반 asset pack으로 받는다

- **상태**: Proposed
- **결정일**: 2026-06-25
- **결정**: PixelLab.ai 산출물은 이미지 파일만 받지 않고 `manifest.json`, `palette.json`, prompt/seed/tool/options, license/attribution 문서를 포함한 asset pack으로 받는다.
- **근거**: Orc Camp dashboard는 상태별 sprite, effect, background를 runtime에 매핑해야 하므로 frame size, anchor, FPS, state mapping, reduced-motion fallback 같은 metadata가 필요하다.
- **재검토 조건**: PixelLab.ai API 기반 생성 pipeline을 도입하면 manifest 일부를 자동 생성하도록 바꾼다.

## D-010: WoW 오크 캐릭터는 내부 레퍼런스로만 사용한다

- **상태**: Accepted
- **결정일**: 2026-06-25
- **결정**: Grom Hellscream, Orgrim Doomhammer, Thrall 등 World of Warcraft의 주요 오크 캐릭터는 character mood와 archetype을 잡기 위한 내부 레퍼런스로만 사용한다. 실제 제품 asset, PixelLab.ai prompt, manifest key, 파일명, UI label은 Orc Camp 고유 캐릭터명과 generic descriptor를 사용한다.
- **근거**: Orc Camp는 공개 배포 가능성을 고려하므로 기존 게임 IP와 혼동될 수 있는 이름, 외형, 문양, 장비를 직접 사용하는 것은 피해야 한다.
- **적용**: `orc-warchief`, `orc-iron-commander`, `orc-storm-shaman`, `orc-grunt`, `orc-seer` 같은 original archetype을 사용한다.
- **Prompt source**: [[12-PixelLab-Prompts]]

## D-011: 초기 설계 산출물을 구현 저장소로 이관한다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **결정**: OrcVault의 `40-Products/OrcCamp` 산출물을 `/Users/jongtaek.hwang/Projects/orc-camp` 저장소로 복사해 구현 착수 기준 자료로 사용한다. Vault 원본은 삭제하지 않는다.
- **근거**: 제품 설계와 asset pack이 구현에 필요한 수준으로 정리되었고, 이후 변경은 구현 저장소에서 코드와 함께 추적해야 한다.
- **이관 범위**: product docs, `asset-packs/orc-camp-default`, project-scoped product subagents, PixelLab MCP 설정 템플릿.

## D-012: 첫 구현 슬라이스는 `orc-camp scan` CLI PoC로 한다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **맥락**: design-handoff 이후 가장 큰 미검증 리스크는 AI agent 상태 추론 정확도이고, dashboard/asset polish는 detection 신뢰 확보 이후에 가치가 있다.
- **결정**: MVP 구현은 server/dashboard/asset 없이 read-only `orc-camp scan` CLI(tmux 발견 + agent 탐지 + status/confidence 산출 + stdout/JSON 출력)부터 착수한다. 이 슬라이스로 [[09-Reviews]] Design Handoff Gate의 "구현 전 필수 검증"을 충족한다.
- **근거**: 가장 얇은 수직 슬라이스로 핵심 가설을 검증하고, 산출 도메인 모델을 이후 모든 슬라이스가 재사용한다.
- **범위/지표/수용 기준**: [[14-MVP-PoC-Scope]].

## D-013: 런타임 asset 사양은 실제 delivered manifest를 source of truth로 한다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **맥락**: 초기 셋업 문서([[11-PixelLab-Asset-Setup]])는 `64×64` row-based spritesheet와 `orc-codex`/`orc-claude`/`orc-unknown`/`orc-iron-commander` 가정을 담았으나, 실제 전달본은 `232×232` 개별 frame PNG·8방향·state/direction 폴더 구조이고 캐릭터는 mascot/claude/codex 3종이다.
- **결정**: 런타임 asset 사양은 `asset-packs/orc-camp-default/manifest.json`을 source of truth로 한다. 문서의 옛 `64×64` spritesheet 가정과 평면 파일명(`orc-codex-active.png` 등)은 폐기하고, 미생성 캐릭터(`orc-unknown`, `orc-iron-commander`)는 gap으로 추적한다.
- **근거**: 문서-산출물 불일치가 구현 시 혼선을 만든다. 실제 전달본이 단일 진실원이어야 한다.
- **적용**: [[14-MVP-PoC-Scope]] "런타임 Asset 계약", [[11-PixelLab-Asset-Setup]] 현행 정합화 배너, [[13-PixelLab-Asset-Registry]] ledger.

---

> D-014 ~ D-021은 2026-06-26 `docs/specs/` 구현 spec 작성 및 spec-reviewer/product-architect 게이트에서 확정된 결정이다. 근거 spec은 `docs/specs/SPEC-*.md`.

## D-014: scan 실행 모델은 기본 single-shot + `--watch` opt-in으로 한다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **맥락**: `status=active`(직전 scan 대비 내용 변화)와 사라짐 기반 `terminated`는 직전 snapshot이 있어야 판정 가능하다. 단발 실행만으로는 이 신호가 저하된다.
- **결정**: `orc-camp scan`은 기본 단발 실행, `--watch [interval]`로 주기 재-scan을 opt-in 한다. read-only 불변식은 유지한다. interval 허용 경계는 `[1,5]s`(비기능 요구), default 3s는 PoC로 보정할 가설이다. 단발 모드에서 prior 의존 status(`active`, 사라짐-`terminated`)는 LOW/`unknown`으로 저하된다.
- **해소**: [[14-MVP-PoC-Scope]] / SPEC-002 / SPEC-004의 "single-shot vs watch" Open Question을 닫는다.
- **근거 spec**: [[SPEC-001-scan-cli]] §3.1.

## D-015: scan exit-code 정책

- **상태**: Accepted
- **결정일**: 2026-06-26
- **결정**: `0` = scan이 결과를 산출함(tmux 부재·빈 상태·target별 부분 오류 포함 — 이는 실패가 아니라 data/diagnostics로 보고). `1` = catastrophic(결과 산출 불가, stdout 비움). `2` = usage error(잘못된 flag/`--watch` interval). tmux 미설치는 `exit 0` + `tmux.installed=false` data로 보고하며, 설치 여부 health 판정은 `doctor`(R-CLI-005) 소관이다.
- **근거 spec**: [[SPEC-001-scan-cli]] §2.5. R-TMUX-006와 정합.

## D-016: redaction은 추출 이전 단일 chokepoint에서 적용한다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **결정**: terminal 원문은 단일 `sanitize` chokepoint에서 redaction된 뒤에만 소비된다. detection 신호(SPEC-003), status·currentWorkSummary 추출(SPEC-004), preview, debug log 모두 **redaction 적용 후 데이터**만 본다. 원문은 파일·log·`--json`에 저장하지 않는다.
- **해소**: [[02-Requirements]] "summary를 redaction 전/후 어느 데이터에서 추출하는가" Open Question을 "후"로 닫는다.
- **근거 spec**: [[SPEC-006-privacy-redaction]] §3.1.

## D-017: 식별자 권위는 paneId/sessionId, target/name은 표시 전용

- **상태**: Accepted
- **결정일**: 2026-06-26
- **결정**: orc 정체성의 권위는 `paneId`(`#{pane_id}`), camp 정체성의 권위는 `sessionId`(`#{session_id}`)다. `tmuxTarget`(`session:window.pane`)과 `tmuxSessionName`은 rename/reindex로 변하므로 표시 전용이다. 직렬화 id는 `orc.id = "pane:"+paneId`, `camp.id = "session:"+sessionId`.
- **근거 spec**: [[SPEC-005-data-contract]] 불변식, SPEC-002.

## D-018: scan 출력 데이터 계약 SSOT는 SPEC-005다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **맥락**: [[14-MVP-PoC-Scope]]의 `--json` 예시는 staleness, session-id 기반 camp id, `terminated` 포함 7-key statusSummary, `summaryIsEstimated`, redacted preview를 누락했다.
- **결정**: scan 출력 데이터 계약의 SSOT는 [[SPEC-005-data-contract]](schemaVersion=1)다. 14-MVP 예시는 superseded이며 설명용 subset으로만 둔다. 충돌 시 SPEC-005를 따른다.
- **근거 spec**: [[SPEC-005-data-contract]] §6 C1~C6.

## D-019: read-only는 fail-closed allowlist wrapper로 강제한다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **결정**: tmux 호출은 단일 `tmuxExec` wrapper를 통해서만 한다. allowlist(`list-sessions`/`list-windows`/`list-panes`/`capture-pane`/`-V`) 외 subcommand는 fail-closed로 거부하고 spawn하지 않는다. `shell:false`로 호출해 셸 보간을 차단한다. read-only는 문서가 아니라 테스트로 강제된다.
- **근거 spec**: [[SPEC-006-privacy-redaction]] §2.6. R-TMUX-001(enforcement) 공동 소유.

## D-020: process introspection(`cmdline`/alive)은 scan-MVP의 선택적 degradable 신호다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **맥락**: agent type Tier B(wrapper: `node`/`python` + signature) 판정과 process-alive 신호는 pane foreground argv(`cmdline`)를 필요로 하나, 이는 tmux가 아니라 `pane_pid → ps`/OS introspection으로 얻는다.
- **결정**: `cmdline`/process-alive 수집은 scan-MVP에 포함하되 **선택적·degradable**로 둔다. 수집 단계는 SPEC-002가 소유한다(timeout, target별 error isolation, 실패 시 null). 획득 불가 시 SPEC-003 Tier B는 `paneTitle`로 fallback한다. 이 비-tmux subprocess는 `tmuxExec` allowlist 밖이지만 read-only이며 동등한 안전 계약(고정 인자, `shell:false`, timeout)을 따른다(SPEC-006).
- **근거 spec**: [[SPEC-002-tmux-discovery]], [[SPEC-003-agent-detection]] §2.4, [[SPEC-006-privacy-redaction]]. [[05-Backend]] "process command line cross-platform 안정성" Open Question을 부분 해소.

## D-021: R-PRIV-006(preview 노출/line-count 조정)은 scan-MVP 범위 밖이다

- **상태**: Accepted
- **결정일**: 2026-06-26
- **맥락**: scan-MVP의 `preview`는 기본적으로 metadata-only(`{lines, truncated, redacted}`, text 미렌더)다. 따라서 노출/line-count 조정 대상 자체가 scan 슬라이스에는 없다.
- **결정**: R-PRIV-006은 preview text를 실제 렌더하는 후속 슬라이스(dashboard/preview rendering)로 미룬다. scan-MVP는 `--no-preview`/`--preview-lines` 동작을 제공하지 않는다(flag 미노출 또는 reserved 표기). 관련 수용 기준은 flag 파싱 수준으로만 한정한다.
- **근거 spec**: [[SPEC-001-scan-cli]], [[SPEC-005-data-contract]] preview 기본형, [[SPEC-006-privacy-redaction]].

---

> D-022 ~ D-034는 2026-06-27 전체 제품(Epic 2~9) spec 작성 및 full-product 게이트(spec-reviewer + product-architect)에서 확정된 결정이다. 두 리뷰어 모두 P0 architecture blocker 없음·P0 추적 gap 0으로 판정했다. 근거 spec은 `docs/specs/SPEC-1xx~8xx`.

## D-022: WebSocket endpoint는 `/api/events`로 통일한다

- **상태**: Accepted
- **결정일**: 2026-06-27
- **맥락**: SPEC-100은 `/ws`, SPEC-102/200과 청사진 [[04-Frontend]]는 `/api/events`로 불일치했다.
- **결정**: realtime SSOT([[SPEC-102-realtime-sync]])와 frontend 계약을 권위로 삼아 WS endpoint를 `/api/events`로 통일한다. SPEC-100의 `/ws` 표기를 정정한다.
- **근거 spec**: [[SPEC-100-server-lifecycle]], [[SPEC-102-realtime-sync]].

## D-023: auth token 운반 방식

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: REST는 `Authorization: Bearer <token>`, WebSocket은 `Sec-WebSocket-Protocol` subprotocol token(query param fallback)으로 startup token을 운반한다. cookie를 쓰지 않아 CSRF 내성과 proxy 호환을 확보한다.
- **근거 spec**: [[SPEC-100-server-lifecycle]], [[SPEC-200-frontend-architecture]].

## D-024: read API도 startup token으로 보호한다

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: R-SEC-003(state-changing token 요구)을 강화해 `/api/health`와 `/api/events` handshake를 제외한 모든 `/api/*`(snapshot/camps/settings 등 read 포함)가 startup token을 요구한다. terminal 파생 민감 데이터(preview/summary)가 read 표면으로 새지 않게 한다.
- **근거 spec**: [[SPEC-100-server-lifecycle]] §2.6.

## D-025: snapshot version 계약

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: `snapshotVersion`은 단조 증가 정수, 변경 tick당 +1(변경 없으면 미증가), atomic-commit으로 직렬화한다(partial batch 직렬화 금지). version↔diff-batch는 1:1. version은 non-durable이며 재시작은 `runtimeEpoch`로 식별하고 복구는 full re-snapshot으로 한다(MVP replay buffer 없음).
- **근거 spec**: [[SPEC-101-snapshot-api]], [[SPEC-102-realtime-sync]].

## D-026: terminal preview text 전달

- **상태**: Accepted
- **결정일**: 2026-06-27
- **맥락**: snapshot은 metadata-only(D-021)라 preview 텍스트를 받을 endpoint가 없어 R-UI-004 inspector preview·R-PRIV-006이 데이터 경로를 잃었다(게이트 P0-1).
- **결정**: 선택된 orc 한정 lazy endpoint `GET /api/orcs/:orcId/preview`를 둔다. token + exposure(R-PRIV-006) gated이며 redaction된 tail(≤ `PREVIEW_LINES`)만 반환한다. snapshot은 metadata-only를 유지해 노출면을 최소화한다.
- **근거 spec**: [[SPEC-101-snapshot-api]], [[SPEC-201-dashboard-screens]], [[SPEC-006-privacy-redaction]].

## D-027: redaction은 floor-lock한다

- **상태**: Accepted
- **결정일**: 2026-06-27
- **맥락**: R-SET-001은 redaction을 사용자 조정 항목으로 열거했으나 [[SPEC-006-privacy-redaction]]/D-016은 redaction을 상시 chokepoint로 강제한다.
- **결정**: `redactionEnabled`를 `true`로 floor-lock한다. secret redaction은 비-negotiable이며 `PATCH`로 false 설정 시 `422`로 거부한다. R-SET-001 문구는 "secret redaction 상시 활성, 조정은 비-secret cosmetic 범위"로 정정한다.
- **근거 spec**: [[SPEC-500-settings-persistence]], [[SPEC-006-privacy-redaction]].

## D-028: control은 분리된 write-path(`controlExec`)로만 수행한다

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: D-019(read-only)를 확장한다. scanner의 read `tmuxExec`(allowlist, send-keys denylist)는 불변으로 유지하고, control은 별도 `controlExec`로만 `send-keys`를 수행한다(고정 3 템플릿, `-t <paneId>` 단일 target, `-l --` literal, `shell:false`). server 전체에서 send-keys spawn은 `controlExec` 하나로 단일화(single-writer)하며 테스트로 강제한다. R-CTRL-008(임의 shell 실행 금지)을 구조적으로 보장한다.
- **근거 spec**: [[SPEC-400-control-actions]], [[SPEC-006-privacy-redaction]].

## D-029: config/state 디렉터리는 XDG 규약을 따른다

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: configDir = `$ORC_CAMP_CONFIG_DIR` > `$XDG_CONFIG_HOME/orc-camp` > `~/.config/orc-camp`(macOS도 `~/Library` 아님), stateDir = `~/.local/state/orc-camp`. doctor가 경로를 노출한다(R-SET-003).
- **근거 spec**: [[SPEC-500-settings-persistence]], [[SPEC-700-packaging-release]].

## D-030: 자산 매핑 — orc-unknown/iron-commander는 delivered

- **상태**: Accepted
- **결정일**: 2026-06-27
- **맥락**: [[14-MVP-PoC-Scope]]·[[11-PixelLab-Asset-Setup]]은 `orc-unknown`/`orc-iron-commander`를 "미생성 gap"으로 기술했으나 manifest(D-013 SSOT)는 5 character를 모두 delivery 완료했다(`generation_status.state="closed"`).
- **결정**: 두 character는 delivered이며 gap이 아니다. runtime은 `unknown → orc-unknown`을 1차 매핑하고 mascot은 character fallback으로 둔다. `orc-iron-commander`는 control/interrupt 상징이다. 청사진의 "gap" 문구를 정정한다(D-013 amendment).
- **근거 spec**: [[SPEC-300-asset-rendering]], `asset-packs/orc-camp-default/manifest.json`.

## D-031: detector 확장성은 config-rule-first, code-plugin-deferred

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: agent detector 확장은 MVP inline builtin → P1 선언적 config rule(데이터-only, confidence calibration은 SPEC-003 소유 유지) → P1+ trust-gated code plugin 순으로 단계화한다. `AgentDetector` 단일 계약으로 packaging 결정을 인터페이스와 분리한다. [[05-Backend]]/[[10-System-Architecture]]의 inline-vs-package open question을 해소한다.
- **근거 spec**: [[SPEC-800-extensibility]], [[SPEC-003-agent-detection]].

## D-032: 자산 license gate를 배포에서 운영화한다 (D-009 운영화)

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: manifest `license` 필드(commercial_use/redistribution/attribution)가 하나라도 `"unknown"`인 동안 asset pack을 published npm artifact에서 제외한다(`bundleAssets=false`). 코드는 placeholder fallback으로 출시되고, tarball에 asset PNG 0개를 testable release gate로 강제한다. 3필드가 허용값으로 확정되고 attribution을 충족할 때만 번들을 활성화한다.
- **근거 spec**: [[SPEC-700-packaging-release]], [[SPEC-300-asset-rendering]]. (D-009 운영화)

## D-033: manual refresh 경로

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: dashboard manual refresh(R-API-004)는 `POST /api/refresh`(out-of-cycle 강제 scan, tmux read-only 유지, coalesce + rate-limit)를 1차로, 실패 시 `GET /api/snapshot` 재요청을 fallback으로 둔다.
- **근거 spec**: [[SPEC-101-snapshot-api]], [[SPEC-200-frontend-architecture]].

## D-034: local server hardening 묶음

- **상태**: Accepted
- **결정일**: 2026-06-27
- **결정**: (a) Host-header 검증으로 DNS-rebinding을 방어한다. (b) 명시적 `--port`가 점유 중이면 silent fallback하지 않고 exit 1(비명시 기본 port만 가용 port로 fallback). (c) MVP는 single-instance lock을 두지 않는다(독립 실행 허용). (d) URL token 잔존(scrollback/history)은 `history.replaceState`로 완화한다.
- **근거 spec**: [[SPEC-100-server-lifecycle]], [[SPEC-200-frontend-architecture]].

## D-035: camp 공간 맵·movement는 client-derived이며 서버 좌표를 추가하지 않는다

- **상태**: Accepted
- **결정일**: 2026-06-28
- **결정**: camp detail을 zone(window)=공간, station(status)=위치, slot(paneId)=fan-out으로 구성하는 공간 맵으로 한다. orc 위치는 client에서 기존 Orc 필드의 결정적 함수로 계산하고, Orc/Camp/ScanResult/snapshot/WS에 좌표(x/y/position) 필드를 추가하지 않는다([[SPEC-005-data-contract]] 데이터 계약 불변, [[08-Decisions|D-018]]). roaming은 status enum이 아니라 target 위치 변화 시 진입하는 시각 전이다.
- **근거**: read-only·privacy·data-contract SSOT 보존, web-only 변경으로 backend 영향 0.
- **영향**: R-UI-008/R-P1-013 신설, [[SPEC-301-camp-map-movement]] 소유(scene 배치), [[SPEC-300-asset-rendering]] §3.7 Q4 해소·[[SPEC-201-dashboard-screens]] AC-03 scene 배치 supersede.
- **근거 spec**: [[SPEC-301-camp-map-movement]], [[SPEC-300-asset-rendering]], [[SPEC-201-dashboard-screens]], [[SPEC-005-data-contract]].

## D-036: character prestige tier는 누적 token/cost 기반 외형 단계이며 자산은 단조 폴백한다

- **상태**: Proposed (미승인)
- **결정일**: 2026-06-29 (확장 이력: mascot 단독 → usage-driven 4종 → **delivered 5종 전체**(iron-commander 포함))
- **결정**: **delivered character 5종**(`orc-high-warchief-mascot`·`orc-claude-storm-shaman`·`orc-codex-field-engineer`·`orc-unknown`·`orc-iron-commander`)에 각각 4단계(base + 3) prestige tier를 둔다. `orc-iron-commander`도 포함된다 — `CHARACTER_POOL`로 실제 orc(pane)에 roaming skin으로 배정되면 그 orc의 usage로 tier가 정해지므로 다른 character와 동일하다(이전 "control 상징이라 제외" 판단을 정정; control/interrupt 상징 역할은 tier와 무관한 별개 축으로 [[SPEC-400-control-actions]] 소관). tier는 PixelLab `create_character_state`로 만든 **외형 variant**(각 archetype 정체성 유지하며 갑옷/의장·장비·`active` 외형을 점층 강화, animation은 미생성)이고, 런타임은 그 orc 자신의 **누적 token/cost**(1차 tokens, 보조 cost USD; 모든 character 공통 임계)로 tier를 고른다. 임계값 **100k/500k/2M tokens(또는 $3/$15/$60)** — 2026-06-30 실측(라이브 per-session ~45k–116k tok) 정렬로 초기 1M/5M/20M·$5/$25/$100에서 하향(axis는 per-session-file 누적; SPEC-302 §3.1 canonical). tier는 세션 동안 **단조 비감소(latch, (orc id, characterKey) 복합 키·소멸/character 변경 시 리셋)**, 자산 미가용 tier는 **하향 폴백**(다음 가용 tier → base, placeholder로 강등 안 함). effect overlay 세트는 tier와 무관(중복 방지). **animation 미생성 정책(variant 외형 우선)**: tier variant가 animation을 미보유하면 **variant 정지 rotation**을 표시하고 base animation으로 대체하지 않는다(그래야 강화 외형이 항상 보임; 모션은 보류, variant animation 생기면 자동 승급).
- **근거**: "더 많이 일한 warchief일수록 전설적으로 보인다"는 게임화 보상. schema-first로 고정하면 자산 생성 전에도 항상 base로 안전 동작 → 점진 도입 가능. 누적 token/cost는 현재 데이터 계약에 없으므로 신규 수집을 **forward**로 분리해 read-only/privacy 불변식과 충돌하지 않게 둔다.
- **영향**: R-P2-008(proposed) 신설. [[SPEC-302-mascot-prestige-tiers]] 신규(런타임 resolution 소유), [[15-Character-State-Model]] 신규(자산 모델·생성 prompt), [[SPEC-005-data-contract]] `Orc.usage` 추가 제안(forward, 미반영), [[13-PixelLab-Asset-Registry]] Deferred 항목 추가. asset pack **v0.2.0**에서 tier 자산·manifest `prestige` 반영(인증 `PIXELLAB_AUTH_HEADER` 선행).
- **근거 spec**: [[SPEC-302-mascot-prestige-tiers]], [[15-Character-State-Model]], [[SPEC-300-asset-rendering]], [[SPEC-005-data-contract]], [[13-PixelLab-Asset-Registry]].

## D-037: epic monster는 배경별 비-상호작용 ambient NPC이며 full-polygon roaming·error-on-intersection·비-load-bearing이다

- **상태**: Proposed (미승인)
- **결정일**: 2026-06-29
- **결정**: camp scene에 활성 배경에 어울리는 **epic 보스 몬스터 1마리**를 ambient NPC로 둔다. 6 variant ↔ 6 배경(roster FROZEN: default→Mosshide Behemoth, froststeel→Frostfang Colossus, emberforge→Magma Colossus, mirebog→Bog Leviathan, sunscorch→Duneplate Scourge, necropolis→Bonewraith Revenant), 크기 512×512, 애니메이션 {active, waiting, idle, roaming, error}. 핵심 선택: ① **비-상호작용**(pointer-events none·tab/selection/inspector/overlay/label/bubble 없음), ② **full-`ground.polygon` roaming**(orc는 내접 `safe_area`에 clamp되지만 몬스터는 polygon 전체를 roaming; 발자국 footprint만 polygon clamp), ③ 도착 시 **무작위(seeded) dwell 애니메이션**(active/waiting/idle), ④ **orc와 footprint 교차 시 `error`로 래치**(halt·nearest-orc facing·min-duration debounce·해소+경과 후 resume), ⑤ **비-load-bearing**(데이터 비운반 → 자산 미가용 시 placeholder 없이 미렌더; orc placeholder parity에서 유일 면제), ⑥ 좌표·상태는 client-derived 결정적(`monster id + 공유 clock + polygon`, `Math.random`/`Date.now`/서버 좌표 금지·INV-1), reduced-motion 정지, orc 배치/zero-layout-shift 비교란. 자산 *생성*은 `PIXELLAB_AUTH_HEADER` 보류로 **deferred**(schema-first, 미가용 시 안전 통과).
- **근거**: "살아있는 camp" 분위기 강화 + 배경 테마 몰입. 비-상호작용·비-load-bearing·client-derived로 두면 read-only·privacy·data-contract·zero-layout-shift 불변식을 전혀 건드리지 않고 점진 도입(자산 생성 전에도 안전) 가능하다. 최소 polygon인 necropolis는 scale 0.65로 축소해 feasibility를 확보한다.
- **영향**: R-UI-010(proposed) 신설. [[SPEC-303-epic-monster-npc]] 신규(런타임 거동·controller·footprint·error·z-order·feasibility 소유), [[16-Epic-Monster-NPC]] 신규(512 base contract·5 애니메이션 prompt·생성 runbook·manifest `monsters` 스키마), [[background-tile-merge-guide]] §6 배경별 art concept 추가, [[SPEC-300-asset-rendering]] monster render contract 추가(asset-runtime), manifest `monsters`+`backgrounds.<bg>.epic_monster` 링크(asset pack v0.2.x, `PIXELLAB_AUTH_HEADER` 선행). `R-UI-009`(image-ground 정식 승격)와 id 충돌을 피해 R-UI-010 사용([[SPEC-301-camp-map-movement]] §6 C5).
- **근거 spec**: [[SPEC-303-epic-monster-npc]], [[16-Epic-Monster-NPC]], [[SPEC-300-asset-rendering]], [[SPEC-301-camp-map-movement]], [[background-tile-merge-guide]].

## D-038: character avatar는 detail 우측 BG식 세로 2:3 흉상 portrait이며 정적·비-load-bearing·CSS-frame·PixelLab-우선/외부-폴백 생성이다

- **상태**: Proposed (미승인)
- **결정일**: 2026-06-29
- **결정**: orc inspector(Details) 우측에 선택 orc의 **character 정체성 portrait**(Baldur's Gate 풍 흉상/bust)를 표시한다. 핵심 선택: ① **신규 asset class `portraits`** — 기존 top-down 8방향 sprite와 별개의 **정적 정면/약3-4 흉상**(머리→가슴), **세로 2:3**, canonical source **512×768** transparent(실측값을 manifest `source_size`에 기록). ② **frame은 web UI(CSS) 소유** — 장식 테두리를 이미지에 굽지 않고 dashboard가 CSS/panel-frame asset으로 렌더(상태색·교체·재사용 용이; portrait art는 ~6–10% safe padding). ③ **resolve는 sprite와 동일 결정적 함수** — sequential `characterKey` → `agentType→character` → mascot 폴백([[SPEC-300-asset-rendering]] §2.3) 후 [[SPEC-302-mascot-prestige-tiers]] resolved tier 적용; 폴백 체인 = resolved-tier portrait → base-character portrait → agentType base portrait → mascot base portrait → CSS placeholder. ④ **비-load-bearing·정적** — status를 사실로 단언하지 않고(StatusBadge가 소유), reduced-motion no-op, 자산/manifest 미가용 시 placeholder로 graceful 강등하며 portrait 유무가 **zero-layout-shift**. ⑤ **roster = 20**(5 base + 5×3 prestige tier; key는 `characters`와 1:1, suffix는 D-036/doc 13/15와 동일). ⑥ **반응형** — 데스크톱 우측 컬럼, mobile sheet에서는 metadata 위로 stack. ⑦ **생성 deferred** — PixelLab `create_character`는 top-down 전용이라 흉상 미보장 → backgrounds/logo와 동일하게 **PixelLab 우선 시도 + 외부 image-gen 폴백**(schema-first, 미생성 동안 placeholder로 안전 통과). license는 [[08-Decisions|D-009]] 게이트 상속(미확정 시 배포 미번들).
- **근거**: orc를 "캐릭터"로 각인시켜 dashboard 몰입·식별성을 높인다. 흉상은 작은 sprite보다 정체성·prestige 변화를 또렷이 전달한다. schema-first + CSS-frame + 결정적 resolve로 두면 read-only·privacy·data-contract·zero-layout-shift 불변식을 건드리지 않고 자산 생성 전에도 안전 동작 → 점진 도입 가능. CSS-frame ownership은 상태색·테마·접근성 처리를 web가 갖게 해 자산 재생성 비용을 줄인다.
- **영향**: R-UI-011(proposed) 신설. [[SPEC-304-character-avatar-portraits]] 신규(런타임 resolve·배치·placeholder·AC 소유), [[17-Character-Avatar-Portraits]] 신규(흉상 framing 계약·character별 prompt·tier delta·생성 runbook·manifest `portraits` 스키마), [[SPEC-201-dashboard-screens]] §2.4 inspector 우측 portrait slot 추가, [[12-PixelLab-Prompts]]·[[13-PixelLab-Asset-Registry]] cross-link/Deferred 추가. manifest top-level `portraits` 블록(asset pack 버전업에서 실값 반영; PixelLab/외부 생성 선행). tier 선택은 R-P2-008(proposed)/[[SPEC-302-mascot-prestige-tiers]] resolution을 재사용(중복 신설 안 함).
- **근거 spec**: [[SPEC-304-character-avatar-portraits]], [[17-Character-Avatar-Portraits]], [[SPEC-300-asset-rendering]], [[SPEC-302-mascot-prestige-tiers]], [[SPEC-201-dashboard-screens]].

## D-039: 세션 로그 usage 수집은 집계 스칼라만 추출하는 data-minimization 계약으로 게이트한다 (CONDITIONAL GO)

- **상태**: Proposed (미승인)
- **결정일**: 2026-06-30
- **맥락**: [[SPEC-302-mascot-prestige-tiers]](R-P2-008, proposed)의 prestige tier는 orc별 누적 token/cost(`Orc.usage`)를 요구하고, 그 유일한 출처는 agent 세션 transcript/usage 로그 파일(Claude Code `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`, Codex `~/.codex/sessions/.../rollout-*.jsonl`)이다. 이는 tmux capture를 넘어서는 **새 read surface**로, 전체 대화 텍스트·코드·secret·절대 경로·tool 입출력을 담는다([[SPEC-302-mascot-prestige-tiers]] §2.2가 security-privacy 사전 리뷰로 격리·게이트함). 또한 Codex는 `~/.codex/` 안에 `auth.json`·`.env`·`config.toml`(secret 자체)을 세션 로그의 형제로 둔다.
- **결정**: security-privacy-engineer 리뷰 결과 **CONDITIONAL GO**. usage 수집의 binding privacy/security 계약을 신규 [[SPEC-008-usage-collection]](privacy/security 소유, [[SPEC-006-privacy-redaction]]의 자매 계약)으로 고정한다. 핵심 불변식(data-minimization chokepoint): 세션 로그에서 parser 밖으로 나갈 수 있는 것은 **닫힌 집합의 집계 스칼라**(`cumulativeTokens`/`cumulativeCostUsd`/`source`/`measuredAt`)뿐이며, parser는 transcript content(message body·tool I/O·코드·경로·secret)를 **구조적으로 건너뛴다**(읽지도 보유도 않음 — provider가 emit하는 line별 `usage` 객체의 숫자 키만 발췌). 구현은 SPEC-008 §1.1의 **G1~G9**(스칼라만·content skip / non-leak / 비저장(파일·캐시·debug log) / root confinement+ownership+symlink-escape 거부+no-follow·TOCTOU-safe·read-only / byte·line·time bounded read / 부재·불가·모호→`usage=null` degradable·per-orc 격리 / misattribution 금지(명시 session-id 우선, 모호→null·**mtime 추측 금지**) / provider-pluggable·unknown→null·사용자 지정 임의 경로 read 금지 / **open-handle(fd) 상관은 read-only·fixed-argv·numeric-pid로 pane 자신 subtree pid만 조회·in-root+ext만 발췌·나머지 fd 비보유**)를 **전부** 충족할 때만 착수 가능하다. transcript 원문/경로/secret을 저장·log·직렬화·반환·캐시하거나, 디스크를 광범위 스캔하거나, root 밖 symlink/타 사용자 파일을 읽거나, 모호한 세션을 추측하거나, fd 목록을 보유·log하거나, 4개 스칼라 외를 출력/network로 내보내면 **NO-GO**(머지 차단)다.
- **Amendment(2026-06-30, 구현 후속 2건)**: (1) **correlation coverage = GO** — 복수 세션 파일로 대부분 orc가 `null`이 되는 문제를 **agent 프로세스의 실제 open file descriptor**(macOS `lsof -n -P`/Linux `/proc/<pid>/fd`)를 보는 **결정적** 상관으로 해소하도록 승인. mtime '최근' tie-break은 추측이므로 **여전히 금지**. 신규 게이트 **G9**, AC-12/AC-13, 위협 T-U10(fd over-disclosure)/T-U11(pid 재사용), hint `agentPids` 추가([[SPEC-008-usage-collection]] §4.2a). (2) **Codex provider = CONDITIONAL GO** — file-access/confinement 계약은 승인(root가 이미 `~/.codex/sessions/`로 고정돼 secret 형제 `auth.json`/`.env`/`config.toml`은 구조적으로 root 밖). 단 usage key 경로가 실측 미확정이라 schema를 ConfinedReader로 확인 + SPEC-007 fixture 추가 전까지 Codex는 `null` 유지([[SPEC-008-usage-collection]] §4.4, Q1).
- **근거**: 필요한 데이터는 순수 집계 숫자뿐이고 그것을 얻는 데 content 보유가 불필요하다(provider가 usage를 이미 emit). 따라서 content 누출 표면을 **구조적으로 제거**할 수 있고, 본 계약이 그 구조를 강제한다. schema-first로 두면 자산/데이터 미구현 동안 `usage=null`→tier 0으로 안전 동작([[SPEC-302-mascot-prestige-tiers]] §3.2)하며 read-only/privacy/비저장 불변식을 건드리지 않는다.
- **영향**: R-PRIV-007(proposed) 신설([[02-Requirements]] privacy 절). [[SPEC-008-usage-collection]] 신규(수집 privacy 계약·threat model·file-access 경계·provider·AC 소유), [[SPEC-302-mascot-prestige-tiers]] §2.2·[[SPEC-005-data-contract]] `Orc.usage` forward note가 본 계약·판정을 참조. server 직렬화 경계는 후속 Epic 2([[SPEC-101-snapshot-api]], [[08-Decisions|D-024]])에서 PF-U01로 pre-flag. 구현은 R-P2-008 채택 시 착수.
- **근거 spec**: [[SPEC-008-usage-collection]], [[SPEC-302-mascot-prestige-tiers]], [[SPEC-005-data-contract]], [[SPEC-006-privacy-redaction]].

## D-040: tier 판정은 토큰 우선·프로세스 uptime 폴백의 다중 신호로 한다

- **상태**: Proposed (미승인)
- **결정일**: 2026-06-30
- **맥락**: [[SPEC-008-usage-collection]] 구현 후 라이브 측정 결과 누적 토큰은 28 orc 중 **3개만** 상관됨(대부분 프로젝트 디렉터리에 세션 `.jsonl`이 여럿이라 명시 session-id/open-fd 없이는 모호→`null`; misattribution 금지로 추측 불가). 토큰은 또한 transcript read surface(SPEC-008 게이트) 부담이 있다. 더 넓게·안전하게 측정 가능한 **폴백 신호**가 필요하다.
- **결정**: tier 판정 axis를 **다중 신호 우선순위 폴백**으로 확장한다 — `usage.cumulativeTokens`(있으면) → `usage.cumulativeCostUsd`(있으면) → **agent 프로세스 uptime(초)**(있으면) → 0. uptime은 pane subtree의 **agent 런타임 프로세스 경과시간**으로, 기존 [[SPEC-002-tmux-discovery]] ps 스냅샷에 `etimes` 컬럼을 더해 측정한다(**비민감** — transcript가 아니므로 SPEC-008 게이트 무관). 임계(초, 튜닝 대상): **T1 86,400(1d) / T2 259,200(3d) / T3 604,800(7d)** — 라이브 세션이 수일 지속해 1h/4h/12h 시드는 alive orc 거의 전원을 T3로 포화시켰기에 일 단위로 보정(2026-06-30). uptime은 *강도*가 아닌 **수명(longevity) proxy**(idle 포함)임을 명시한다. terminated orc는 프로세스가 없어 uptime=`null`(단 세션 로그가 남아 있으면 토큰으로 커버). 단조 latch·하향 폴백·게이트(prestige 블록 유무)·합성은 불변. Details 표기는 tier **근거(basis: tokens or uptime)**를 함께 보인다.
- **근거**: 토큰은 정밀하나 커버리지 3/28. uptime은 **alive 16/28을 즉시·비민감·저비용**(ps 한 컬럼)으로 커버해 "더 오래 캠핑한 orc일수록 전설적"이라는 게임화 의도에 부합한다. 신호 혼합으로 "T1의 의미"가 composite가 되는 trade-off(coverage↔precision)는 coverage 우선으로 수용하고, 근거를 UI에 노출해 모호함을 보완한다.
- **영향**: [[SPEC-302-mascot-prestige-tiers]] §3.7(uptime 폴백 axis) 신규 + §3.1 uptime 임계 + §3.2 precedence + AC, [[SPEC-005-data-contract]] `Orc.uptimeSec` 추가, [[SPEC-002-tmux-discovery]] ps `etimes` 캡처. privacy: uptime은 비민감(프로세스 시작시각)이라 SPEC-008/SPEC-006 transcript 게이트와 무관. R-P2-008 범위 확장.
- **근거 spec**: [[SPEC-302-mascot-prestige-tiers]], [[SPEC-005-data-contract]], [[SPEC-002-tmux-discovery]].

---

> D-041 ~ D-046은 2026-07-02 [[18-Terminal-Workspace]] 설계안(§5 P0 결정 항목)을 구현 spec으로 고정하며 확정한 결정이다. 근거 spec은 신규 [[SPEC-103-pane-live-stream]]·[[SPEC-203-terminal-workspace]]·[[SPEC-401-interactive-input]] 및 개정 [[SPEC-006-privacy-redaction]]·[[SPEC-102-realtime-sync]]·[[SPEC-201-dashboard-screens]]. spec-reviewer + 도메인 리뷰(tmux-systems / security-privacy / product-ui) 게이트 통과 후 **2026-07-02 제품 오너가 D-041~D-046 전부 Accepted 승인**했다(관련 spec `approved` 승격).

## D-041: live pane view는 read-only 고빈도 capture 채널이며 부하 한도를 계약으로 명문화한다

- **상태**: Accepted
- **결정일**: 2026-07-02 (승인 2026-07-02)
- **맥락**: [[18-Terminal-Workspace]] §4 Phase 1은 focused pane 1개를 sub-second로 갱신하기 위해 `capture-pane`을 고빈도(250–500ms) 폴링한다. 이는 스캔 루프(1–5s)와 독립된 새 채널이며 "tmux를 절대 변경하지 않는다"는 read-only 불변식([[08-Decisions|D-019]])과 부하 관점에서 충돌 가능성이 제기됐다(§5.2).
- **결정**: (a) live view의 `capture-pane`은 기존 [[SPEC-006-privacy-redaction]] §2.6 `tmuxExec` **READONLY_ALLOWLIST 안에서만** 수행한다(`capture-pane`은 이미 allowlist에 있음) — read-only 불변식은 그대로 유지되고 새 write 경로를 만들지 않는다. (b) 부하 한도를 **계약**으로 고정한다: **연결당 동시 attach 1 pane**(MVP), 폴링 주기 `PANE_VIEW_INTERVAL_MS` **250–500ms(가설)**, 폴링은 **exposure on([[08-Decisions|D-044]]) + 탭 활성 + attach 유지 중**일 때만 수행하고 `view.detach`/연결 종료/exposure off/탭 hidden 시 **즉시 중단**한다. (c) Phase 2 `tmux -C`(control mode) 브리지는 tmux 바이너리를 상주 attach하는 **새 subprocess 진입점**이라 `tmuxExec` allowlist 밖이므로, 브리지가 발행하는 명령을 **read-only allowlist(attach·refresh-client·subscribe류, send-keys 금지)로 별도 고정**하는 sub-계약을 요구하며 **forward**로 pre-flag한다.
- **근거**: capture-pane은 정의상 pane을 변경하지 않으므로 빈도만 오를 뿐 read-only 성질은 불변이다. 위험은 tmux 서버 부하이므로 이를 문서가 아니라 **측정 가능한 상한 계약**(동시 수·Hz·게이트)으로 강제한다. control mode는 임의 명령 실행이 가능한 채널이라 도입 전 별도 게이트가 필요하다.
- **영향**: R-API-006(accepted 2026-07-02) 신설. [[SPEC-103-pane-live-stream]] 신규(attach/detach·폴링·부하 한도·프레임 소유), [[SPEC-102-realtime-sync]] 프레임 카탈로그 확장, [[SPEC-002-tmux-discovery]]/[[SPEC-006-privacy-redaction]] read-only 경계 참조. 실측 방법은 [[SPEC-007-test-validation]] 하니스.
- **근거 spec**: [[SPEC-103-pane-live-stream]], [[SPEC-006-privacy-redaction]], [[SPEC-102-realtime-sync]].

## D-042: styled(ANSI) 스트림은 tokenize→plain-redact→style-remap로만 노출하고 Phase 1은 plain을 유지한다

- **상태**: Accepted
- **결정일**: 2026-07-02 (승인 2026-07-02)
- **맥락**: [[18-Terminal-Workspace]] §5.1 — SGR escape가 secret 패턴을 중간에서 쪼개면 redaction 미탐(§3.6 T-01 우회)이 발생한다. 현 capture는 `capture-pane -p`(plain, `-e` 미사용)라 redaction 카탈로그가 평문 기준으로 안전하다([[SPEC-006-privacy-redaction]] §2.2).
- **결정**: (a) **Phase 1 = plain 유지** — live view도 `-p`(no `-e`) capture를 기존 `sanitizeCapture` 단일 chokepoint로 통과시켜 노출한다. 새 redaction 위험 0. 색은 Phase 1.5로 분리한다. (b) **Phase 1.5 styled 계약** — `-e`(SGR 포함) capture를 도입하려면 반드시 ① SGR 토큰화 → ② plain 텍스트로 분리 → ③ **plain에 대해 redact**(기존 카탈로그) → ④ 스타일 span을 redacted 출력 위에 **re-map**(스타일 span은 redacted 토큰을 가로지르거나 쪼갤 수 없음)한다. redact-후-escape-재주입(카탈로그를 escape 섞인 텍스트에 직접 적용)은 **금지**다. (c) styled 경로의 `secret-recall`은 plain과 **동일(1.0 목표)**이어야 하며, 이 변환+테스트([[SPEC-007-test-validation]])가 승인되기 전에는 styled capture를 소비자에게 emit하지 않는다(fail-safe: plain fallback).
- **근거**: 색은 부가가치지만 redaction은 비-negotiable([[08-Decisions|D-027]] floor-lock 정신). 스타일과 secret 마스킹을 동시에 지키는 유일한 안전 순서는 "스타일을 벗겨 redact한 뒤 스타일을 다시 입히는" 것이다. Phase 분리로 색 없이도 즉시 가치를 내고 위험은 게이트 뒤로 둔다.
- **영향**: R-PRIV-008(accepted 2026-07-02) 신설. [[SPEC-006-privacy-redaction]] ANSI stream redaction 절 신설(카탈로그·chokepoint를 styled에 확장), [[SPEC-103-pane-live-stream]] 프레임이 이 계약을 참조, threat model에 styled-bypass 위협 + PF-05(redaction-before-egress) 확장. 측정은 [[SPEC-007-test-validation]] 라벨 코퍼스에 styled 케이스 추가.
- **근거 spec**: [[SPEC-006-privacy-redaction]], [[SPEC-103-pane-live-stream]], [[SPEC-007-test-validation]].

## D-043: 키보드 passthrough는 기존 write-path(`controlExec`) 위 arm/disarm 2단계 모델로만 수행한다

- **상태**: Accepted
- **결정일**: 2026-07-02 (승인 2026-07-02)
- **맥락**: [[18-Terminal-Workspace]] §3.3/§5.3 — 터미널에 직접 타이핑(passthrough)을 원하나, KEY_ALLOWLIST 확장·rate limit·감사 볼륨(키스트로크 단위 audit은 과다)의 보안 모델이 필요하다.
- **결정**: (a) **새 write 경로를 만들지 않는다** — passthrough는 [[SPEC-400-control-actions]] §2.1 `controlExec`(single-writer, 고정 `send-keys` 3 템플릿)로만 나간다. literal 문자는 `literal` 템플릿(`-l --`), 키는 확장 allowlist로 전송한다. (b) **관전(Observe, 기본) / 조종(Control, armed) 2단계** — 명시 arm 없이는 키가 절대 나가지 않고, arm은 뚜렷한 상태 표시를 동반하며 무입력 N분(가설 3–5m) 후 **auto-disarm**한다. (c) **allowlist 확장**은 상호작용용 curated superset로 두되 파괴적 chord(`C-c`/`C-d`/`C-z`/`C-\` 등)는 **여전히 confirm 게이트/전용 endpoint**를 거친다([[SPEC-400-control-actions]] §2.4 정신 유지). (d) **rate limit**은 SPEC-400 §2.10 per-pane 직렬화 + 키스트로크 rate cap을 적용한다. (e) **audit는 배치/요약** — arm 세션 단위로 keystroke count·duration·redacted-flag만 남기고 **키스트로크 원문·literal 텍스트는 어떤 필드에도 직렬화하지 않는다**([[SPEC-400-control-actions]] §2.8 non-persistence를 passthrough로 확장). expected-target 재검증([[08-Decisions|D-006]] R-CTRL-005)은 arm 시점/드리프트 시 재적용한다.
- **근거**: 이미 검증된 안전 write 경로를 재사용하면 injection·mis-target·임의 셸 실행 방어(R-CTRL-005/008, [[08-Decisions|D-028]])를 그대로 상속한다. arm/disarm은 "실수로 키가 나가는" 사고를 구조적으로 막고, 배치 audit은 non-persistence를 지키며 로그 폭주를 피한다.
- **영향**: R-CTRL-009(accepted 2026-07-02) 신설. [[SPEC-401-interactive-input]] 신규(passthrough·arm/disarm 수명주기·allowlist 확장·rate·batch audit 소유), [[SPEC-400-control-actions]] 개정(controlExec 재사용·allowlist 확장 접점·audit 확장 note), [[SPEC-006-privacy-redaction]] non-persistence 정합.
- **근거 spec**: [[SPEC-401-interactive-input]], [[SPEC-400-control-actions]], [[SPEC-006-privacy-redaction]].

## D-044: live view/preview exposure gate는 MVP에서 글로벌 단위를 유지하고 per-pane 승격은 forward다

- **상태**: Accepted
- **결정일**: 2026-07-02 (승인 2026-07-02)
- **맥락**: [[18-Terminal-Workspace]] §5.4 — 현 exposure gate는 글로벌 설정 1개([[08-Decisions|D-026]] preview exposure, R-PRIV-006). workspace에서 pane별/세션별 gate 또는 "이 orc만 노출" 승격이 필요한지 물음.
- **결정**: MVP는 **글로벌 exposure 단위를 유지**한다 — live view attach는 preview와 **동일한 글로벌 exposure 설정**(R-PRIV-006, [[08-Decisions|D-026]] `GET /api/orcs/:orcId/preview` gate)을 상속하고, 여기에 **명시적 per-attach 사용자 행위(focus/attach)**를 요구한다. exposure off인 orc에 attach하면 거부한다(프레임 `pane_view_end reason=exposure_off` 또는 4-code). **per-pane 지속 gate("이 orc만 노출" 승격)는 forward**로 pre-flag한다(persistent per-orc 노출 상태를 새로 저장하는 것은 privacy 표면 증가라 별도 판정 필요).
- **근거**: 글로벌 floor + 명시 attach 행위 조합이 최소 노출면으로 목표 UX를 만족한다. per-pane 승격은 새 저장 상태·UI를 요구하므로 MVP 범위 밖으로 둔다.
- **영향**: [[SPEC-103-pane-live-stream]] attach gate, [[SPEC-203-terminal-workspace]] 노출 UX, [[SPEC-500-settings-persistence]] exposure 설정 재사용(신규 필드 없음), [[SPEC-006-privacy-redaction]] egress 경계.
- **근거 spec**: [[SPEC-103-pane-live-stream]], [[SPEC-201-dashboard-screens]], [[SPEC-500-settings-persistence]].

## D-045: 화면 재현 수준은 capture-pane 기반으로 한정하고 그 한계를 명시한다

- **상태**: Accepted
- **결정일**: 2026-07-02 (승인 2026-07-02)
- **맥락**: [[18-Terminal-Workspace]] §5.5 — alternate screen/커서/스크롤 영역을 어디까지 재현할지, capture-pane 기반의 한계 명시가 필요하다.
- **결정**: Phase 1 재현 수준은 **capture-pane 산출로 표현 가능한 범위**로 한정한다 — (a) 스크롤백 seed(현 `CAPTURE_LINES`=200에서 시작, 상향은 [[SPEC-006-privacy-redaction]] `CAPTURE_LINES`/§3.4 tunable로 조정), (b) 커서 위치·geometry는 **이미 read-only allowlist에 있는 `list-panes`의 format 변수**(`#{cursor_x}`/`#{cursor_y}`/`#{pane_width}`/`#{pane_height}`)로 취득한다 — `display-message`를 allowlist에 새로 추가하지 않아 새 subprocess 진입점 없이 [[08-Decisions|D-019]] read-only 불변식을 유지한다([[SPEC-103-pane-live-stream]] §2.5, [[SPEC-006-privacy-redaction]] §2.6 co-owned). (c) 현재 보이는 화면(alternate-screen 콘텐츠 포함, capture된 그대로)을 xterm.js에 반영. **비목표(한계)**: 진짜 cell-diff 실시간 emulation, scroll-region/mouse-tracking/OSC 완전 재현은 capture-pane으로 불가하므로 재현하지 않는다. 이 한계는 spec에 명시하고, 저지연·고충실은 Phase 2 control mode([[08-Decisions|D-041]] (c))로 개선한다.
- **근거**: capture-pane은 스냅샷 텍스트라 실시간 TUI를 완벽 재현할 수 없다. "읽히는 화면 + 커서 + 스크롤백"이면 Phase 1 가치("TUI가 읽힌다")를 달성하므로 과도한 emulation을 피하고 한계를 정직하게 문서화한다.
- **영향**: [[SPEC-103-pane-live-stream]] seed/cursor 계약, [[SPEC-203-terminal-workspace]] xterm.js 통합·재현 한계 표기, [[SPEC-006-privacy-redaction]] `CAPTURE_LINES` 상향 검토(§3.4).
- **근거 spec**: [[SPEC-103-pane-live-stream]], [[SPEC-203-terminal-workspace]].

## D-046: 터미널 렌더는 xterm.js(MIT)를 web-only 의존으로 채택한다

- **상태**: Accepted
- **결정일**: 2026-07-02 (승인 2026-07-02)
- **맥락**: [[18-Terminal-Workspace]] 오픈 퀘스천 — xterm.js 도입 시 번들 크기·라이선스(MIT)와 "런타임 의존성 최소" 원칙의 조율.
- **결정**: 터미널 뷰포트 렌더는 **xterm.js(MIT 라이선스)**를 채택한다. 이는 **web SPA(dashboard) 측 의존**이며 CLI 배포 아티팩트의 "런타임 의존성 최소" 원칙([[SPEC-700-packaging-release]])과는 **별개 축**임을 명시한다(CLI 바이너리/npm 아티팩트 의존이 아니라 web 번들 의존). 번들 크기 부담은 **terminal 모드 진입 시 lazy-load(code-split)**로 완화하고, 라이선스는 MIT로 [[08-Decisions|D-032]] asset license gate와 무관(코드 의존).
- **근거**: ANSI·커서·스크롤백을 신뢰성 있게 렌더하는 성숙한 표준 라이브러리를 자체 구현보다 채택하는 편이 안전하고 빠르다. web-only + lazy-load면 CLI 원칙과 초기 로드에 영향이 없다.
- **영향**: [[SPEC-203-terminal-workspace]] xterm.js 통합 계약, [[SPEC-200-frontend-architecture]] 의존/코드-스플릿 note, [[SPEC-700-packaging-release]] "web 의존 ≠ CLI 의존" 명시.
- **근거 spec**: [[SPEC-203-terminal-workspace]], [[SPEC-200-frontend-architecture]].
