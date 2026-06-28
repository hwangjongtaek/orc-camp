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
