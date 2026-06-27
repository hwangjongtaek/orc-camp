---
spec: SPEC-100
title: Local server 수명주기·CLI·보안 경계
status: approved
updated: 2026-06-27
requirements: [R-CLI-001, R-CLI-002, R-CLI-003, R-CLI-005, R-CLI-006, R-CLI-007, R-SEC-001, R-SEC-002, R-SEC-003, R-SEC-004, R-SEC-005]
decisions: [D-003, D-015, D-022, D-023, D-024, D-034]
tags:
  - specs
  - cli
  - server
  - lifecycle
  - security
  - command-surface
---

# SPEC-100 — Local server 수명주기·CLI·보안 경계

이 spec은 Orc Camp **전체 제품**(scan PoC 이후)의 **local server 수명주기**, **CLI command 표면**(`orc-camp` default / `orc-camp serve` / `orc-camp doctor`), 그리고 **보안 경계**(loopback bind, startup token, CORS, 외부 bind opt-in)를 고정한다. 즉 server가 어떻게 뜨고(launch), URL/token이 어떻게 만들어져 전달되고(transport), 요청이 어떻게 인증되며(validation), process 종료 시 무엇이 폐기되는가(disposal)를 정의한다. 이 spec은 Epic 2(Local Server & API)의 진입 계약이며, [[SPEC-101-snapshot-api]]·[[SPEC-102-realtime-sync]]·[[SPEC-400-control-actions]]가 본 spec이 제공하는 **server·token·CORS gate** 위에 올라간다([[README]] Epic 2).

이 spec은 **API payload의 모양(shape)을 정의하지 않는다.** REST snapshot/`settings` payload는 [[SPEC-101-snapshot-api]], WebSocket event는 [[SPEC-102-realtime-sync]], control action의 인가 심화 흐름·target 재검증은 [[SPEC-400-control-actions]], settings 저장은 [[SPEC-500-settings-persistence]]가 소유한다. 본 spec은 그 위의 **공통 인증 미들웨어·수명주기·process 표면**만 소유한다.

> **local-first 불변식(확정, [[08-Decisions|D-003]])**: server·dashboard·scanner는 모두 사용자 local process로 실행되며 cloud backend를 사용하지 않는다. 기본 bind는 `127.0.0.1`이고(R-SEC-001), 외부 노출은 명시적 opt-in + warning 없이는 불가능하다(R-SEC-004). startup token은 **메모리에만** 존재하고 disk에 저장되지 않는다(R-CLI-007).

> **scan과의 경계(확정)**: `orc-camp scan`은 read-only이며 **server를 띄우지 않고 어떤 port도 bind하지 않는다**([[SPEC-001-scan-cli]] read-only 불변식, AC-14). 본 spec의 server lifecycle은 default command·`serve`에만 적용된다. scan command 표면은 [[SPEC-001-scan-cli]] 소유이며 본 spec은 이를 **dispatch(R-CLI-003)** 할 뿐 재정의하지 않는다.

## 1. Scope

### In scope

- **CLI command 표면**: `orc-camp`(default = server 시작 + dashboard 자동 open), `orc-camp serve`(open 없이 server만), `orc-camp doctor`(진단 command **계약**, `--report` 포함), `orc-camp purge`(config/state 제거 command **표면**; 동작·invariant는 [[SPEC-700-packaging-release]] 소유). 공통 flag(`--debug` 포함)·exit code·stdout/stderr 계약(§2.1~2.3, §2.9).
- **Launch 수명주기**(§2.4): server start → dashboard URL 생성(startup token 포함) → browser 자동 open 시도 → open 실패 시 접속 가능한 URL을 stdout 출력(R-CLI-002). startup ≤ 10s 수용(§3.1).
- **Port 선택**(§2.5): preferred default port 시도 → 충돌 시 사용 가능한 port로 fallback → 실제 URL 출력(R-CLI-006).
- **Startup token**(§2.6): 생성(generation)·전달(transport)·검증(validation) 메커니즘. [[SPEC-400-control-actions]]가 소비할 token gate.
- **보안 경계**(§2.7): loopback bind(R-SEC-001), URL의 token 포함(R-SEC-002), state-changing API의 token 요구(R-SEC-003), 외부 bind opt-in + warning(R-SEC-004), CORS 제한(R-SEC-005), Host-header 검증(DNS rebinding 방어).
- **Shutdown 수명주기**(§2.8): process 종료 시 startup token·runtime state 폐기, port 반환(R-CLI-007).
- **doctor command 계약**(§2.3, §3.5): tmux 설치/server 도달, port 가용, config dir 접근, log path 점검(R-CLI-005). 진단 **출력 계약·exit semantics**를 소유하고 심화 진단은 reference.
- **exit code / stream hygiene**(§2.9): [[08-Decisions|D-015]] 철학을 `serve`에 맞게 적응.
- 다룬 요구사항: **R-CLI-001/002/003/005/006/007, R-SEC-001~005**.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| REST endpoint **payload**(`/api/snapshot`·`/api/camps/:id`·`/api/settings` shape, `schemaVersion`) | 본 spec은 그 위 인증 gate·수명주기만 소유 | [[SPEC-101-snapshot-api]] |
| WebSocket **event** schema·reconnect·sequence | 본 spec은 `/api/events` handshake 인증·Origin 검증만 소유 | [[SPEC-102-realtime-sync]] |
| control action **인가 심화**(text/key/interrupt, target 재검증, audit, confirm flow) | 본 spec은 token gate **메커니즘**만 제공, action 의미는 별도 | [[SPEC-400-control-actions]] |
| settings **저장**(local config file, P1 SQLite, schema) | 본 spec은 `--no-open`/`--port` CLI 표면만, 영속 storage는 별도 | [[SPEC-500-settings-persistence]] |
| doctor **진단 내부**(packaging/smoke/version, debug log 내용, install-health 값) | 본 spec은 command·flag 표면(check·출력·exit·`--debug`/`--report`/`purge`)만 소유, 내용은 우측 | [[SPEC-600-observability]], [[SPEC-700-packaging-release]] |
| `orc-camp scan` command 표면(flag·table·`--json`·watch) | 다른 command/슬라이스, 본 spec은 dispatch만 | [[SPEC-001-scan-cli]] |
| tmux inventory 수집·`tmuxExec` allowlist 강제 | scan/runtime 공유 read-only 경계 | [[SPEC-002-tmux-discovery]], [[SPEC-006-privacy-redaction]] |

## 2. Contract

### 2.1 command dispatch와 공통 표면 (R-CLI-003)

```text
orc-camp [serve|scan|doctor|purge] [flags]
orc-camp (--help | --version)
```

- **결정(R-CLI-003)**: `orc-camp`는 5개의 진입을 dispatch한다 — `orc-camp`(default, subcommand 생략 시 = `serve` + browser open), `orc-camp serve`, `orc-camp scan`([[SPEC-001-scan-cli]]), `orc-camp doctor`, `orc-camp purge`. 알 수 없는 subcommand는 **usage error(exit 2)**다(§2.9).
- **결정(`purge` 표면, P1 흡수)**: `orc-camp purge`는 config/state 디렉터리(잔존 user data)를 제거하는 maintenance command다. scan과 같이 server lifecycle을 시작하지 않으며 server 실행 중이 아닐 때 동작한다. 제거 **대상·순서·잔존 invariant**는 [[SPEC-700-packaging-release]] §2.6 소유이고, 본 spec은 이 command가 dispatch 표면의 1급 진입임만 고정한다(`doctor --purge` 대신 top-level `purge`로 확정 — SPEC-700 §6 C2 종결).
- **공통 flag**(default·serve 공유; doctor/scan/purge는 자기 flag 집합):

  | flag | 인자 | 기본값 | 적용 | 의미 |
  | --- | --- | --- | --- | --- |
  | `--port` | `<n>` | preferred default(§2.5) | default·serve | bind할 TCP port 지정 |
  | `--host` | `<addr>` | `127.0.0.1` | default·serve | bind 주소. 비-loopback은 `--allow-external` 동반 필수(§2.7) |
  | `--allow-external` | 없음 | off | default·serve | 비-loopback bind opt-in. warning 동반(R-SEC-004, §2.7) |
  | `--no-open` | 없음 | off(default는 open) | default | browser 자동 open 비활성(default를 `serve`처럼 동작) |
  | `--json` | 없음 | off | default·serve·doctor | 기계 판독 출력(startup record 또는 doctor 결과) |
  | `--no-color` | 없음 | 자동(TTY면 color) | 전부 | ANSI color 비활성([[SPEC-001-scan-cli]] §2.1과 정합) |
  | `--debug` | 없음 | off(level=info) | default·serve | debug log level을 `debug`로 상향(env `ORC_CAMP_LOG_LEVEL` 대안). level·내용 계약은 [[SPEC-600-observability]] §2.6 소유(P1 흡수) |
  | `--help`, `-h` | 없음 | — | 전부 | usage 출력 후 exit 0, server 미시작 |
  | `--version`, `-V` | 없음 | — | 전부 | 버전 출력 후 exit 0 |

- **결정**: 알 수 없는 flag, 비숫자/범위 밖 `--port`, 비-loopback `--host` + `--allow-external` 부재 등 양립 불가 조합은 **usage error(exit 2)**다(§2.9). 이때 server를 시작하지 않는다.
- `serve` = default에서 browser open만 제거한 것이다(즉 default + 강제 `--no-open`). 두 command는 동일 server lifecycle을 공유한다.

### 2.2 `orc-camp` (default) / `orc-camp serve` 표면 (R-CLI-001, R-CLI-002, R-CLI-006)

```text
orc-camp        [--port <n>] [--host <addr> [--allow-external]] [--no-open] [--json] [--no-color]
orc-camp serve  [--port <n>] [--host <addr> [--allow-external]] [--json] [--no-color]
```

- **입력**: flag만. positional 인자·stdin 없음.
- **출력(stdout)**: dashboard URL **한 줄**(token 포함, §2.6). `--json`이면 단일 startup record JSON object(§2.9).
- **진단/로그(stderr)**: startup 진행, port-fallback 통지, browser open 성공/실패 통지, 외부 bind warning, runtime log, shutdown 통지(§2.9 hygiene).
- **수명주기**: long-running. SIGINT(Ctrl-C)/SIGTERM까지 listen하며, 종료 시 §2.8 disposal을 수행하고 exit 0.
- **종료 코드**: §2.9.

### 2.3 `orc-camp doctor` 표면 (R-CLI-005)

```text
orc-camp doctor [--json] [--no-color] [--report [path]]
```

- **목적**: 실행 환경 health를 점검하고 사람/스크립트가 판정 가능한 결과를 낸다. server를 **시작하지 않는다**(port를 일시 probe할 수는 있으나 listen 상태로 두지 않는다).
- **점검 항목(계약, R-CLI-005)** — 각 항목은 `{ id, label, status, detail }`로 보고한다. `status ∈ {pass, warn, fail}`(§3.5 분류):

  | check id | 점검 | pass / warn / fail 기준(§3.5) |
  | --- | --- | --- |
  | `tmux.installed` | tmux 바이너리 존재(`tmux -V`) | 설치=pass / 미설치=**fail** |
  | `tmux.serverReachable` | tmux server 도달(`list-sessions` 성공 여부, read-only) | 도달=pass / 미실행=**warn**(정상; camp 0개) |
  | `port.available` | preferred default port bind 가능 여부 | 가능=pass / 점유(=fallback 예정)=**warn** / 어떤 port도 불가=**fail** |
  | `config.dirAccess` | config directory 존재·읽기/쓰기 권한 | 가능=pass / 불가=**fail** |
  | `log.path` | debug log path 해석·쓰기 가능, 경로 표기 | 가능=pass(경로 표기) / 불가=**fail** |

- **출력(stdout)**: 사람용 점검 표(default) 또는 `--json` 시 `{ checks: [...], summary: {pass, warn, fail}, ok: boolean }`. 진행/사람 로그는 stderr.
- **exit code(§3.5)**: `fail` 0개 = **exit 0**, `fail` ≥ 1개 = **exit 1**(`warn`은 비-0으로 만들지 않는다).
- **`--report [path]`(확정 surface, P1 흡수 — [[SPEC-600-observability]] §2.10)**: doctor 결과 + diagnostics + redacted debug log tail을 묶은 **problem report 번들**을 파일(path 생략 시 stateDir 하위 기본 경로)로 출력한다(terminal 원문 없는 신고용). 번들 **내용·redaction invariant**는 [[SPEC-600-observability]] 소유이고, 본 spec은 **flag 표면**만 고정한다(SPEC-600 §6 C2 종결). report 생성은 server를 시작하지 않으며 exit는 §3.5(health 기반)를 따른다.
- **install-health check 분류 결정(P1 흡수 — [[SPEC-700-packaging-release]] §2.4 C1 종결)**: node-version floor·install 무결성(bin 해석·dashboard 자산 존재·asset-pack 탑재)은 MVP에서 **exit-bearing check에 추가하지 않고 advisory diagnostics로 둔다**. 즉 위 5개 basic check만 exit code(§3.5)에 기여하고, install-health 값은 [[SPEC-600-observability]] `DoctorDiagnostics`에 비-exit 정보로 표기한다(값 산출은 [[SPEC-700-packaging-release]] 소유). 근거: doctor 실행 자체가 bin 해석을 전제하고 node floor 미달은 npm `EBADENGINE`/런타임 guard로 별도 표면화되므로 exit 판정 중복을 피한다. install 무결성의 exit 승격은 post-MVP 재검토(검토 필요).
- **경계**: config path **해석 규칙**은 [[SPEC-500-settings-persistence]] 소유(doctor는 그 경로를 점검·표기만). log 내용·redaction은 [[SPEC-600-observability]], packaging/smoke/version 심화 진단은 [[SPEC-700-packaging-release]] 소유. 본 spec은 위 5개 check의 **계약(존재·상태·exit semantics)**만 고정한다.

### 2.4 Launch 수명주기 (R-CLI-001, R-CLI-002, R-CLI-006)

`orc-camp`(default) 실행 시 순서(확정 단계, 임계값은 가설 표기):

1. **flag 파싱·검증** → 실패 시 usage error(exit 2), server 미시작.
2. **startup token 생성**(§2.6) — CSPRNG, 메모리 보관.
3. **bind 주소·port 결정**(§2.5, §2.7) — 기본 `127.0.0.1` + preferred port, 충돌 시 fallback.
4. **HTTP/WS server listen** 시작 — 실패 시 catastrophic(exit 1, §2.9).
5. **dashboard URL 조립**: `http://<host>:<actualPort>/?token=<token>`(§2.6 transport).
6. **stdout에 URL 출력**(R-CLI-002의 핵심 — open 성공/실패와 **무관하게 항상** stdout에 URL을 낸다).
7. **browser 자동 open 시도**(default만; `serve`/`--no-open`은 건너뜀).
   - 성공: stderr에 "opened in browser" 통지. server 계속 실행.
   - **실패**(headless·`$DISPLAY` 없음·open 명령 실패): **crash하지 않고** stderr에 실패 사유 + "아래 URL로 접속" 안내. URL은 이미 6단계에서 stdout에 있음(R-CLI-002 충족). server 계속 실행.
8. listen 유지 → 종료 신호까지 대기(§2.8).

- **결정(R-CLI-002 위치)**: browser open 실패 시 접속 가능 URL을 stdout에 출력하는 책임은 **본 spec 소유**다(scan에는 URL이 없으므로 [[SPEC-001-scan-cli]] AC-14가 negative로 분리). URL을 6단계에서 항상 먼저 출력하므로 open이 어느 시점에 실패해도 URL 가용성이 보장된다.
- **신뢰성(확정, 비기능 "신뢰성")**: port 충돌·browser open 실패는 전체 제품 실패가 아니다. 각각 fallback·stdout URL로 degrade하며 process는 살아있다.

### 2.5 Port 선택 (R-CLI-006)

- **결정**: bind는 `(host, port)` 쌍에 대해 수행한다. host 기본 `127.0.0.1`(§2.7).
- **preferred default port(가설)**: `P_pref = 4123`. 이 값은 **PoC 검증 가설**이며 충돌률·관례를 보고 확정한다(검토 필요).
- **fallback 규칙(확정)**:
  - `--port` **미지정**: `P_pref` bind 시도 → `EADDRINUSE`면 **OS 할당 ephemeral port(`port 0` bind)**로 재시도 → 성공하면 그 actual port 사용. 어떤 port도 bind 불가하면 catastrophic(exit 1).
  - `--port <n>` **명시 지정**: 그 port만 시도한다. 점유면 **silent fallback하지 않고** 명확한 오류를 stderr에 내고 exit 1(사용자가 특정 port를 의도했으므로 다른 port로 바꾸면 혼란). 이는 [[08-Decisions|D-034]] (b)로 **accepted**다(명시 `--port`만 no-fallback; 비명시 기본 port는 위 ephemeral fallback을 유지).
- **실제 URL 출력(확정, R-CLI-006)**: 어떤 경로로든 bind된 **actual port**를 dashboard URL에 담아 stdout에 출력한다(6단계). fallback이 일어나면 stderr에 "preferred port busy, using `<actualPort>`" 통지.

### 2.6 Startup token: 생성·전달·검증 (R-SEC-002, R-SEC-003, R-CLI-007)

이 §은 [[SPEC-400-control-actions]]·[[SPEC-101-snapshot-api]]·[[SPEC-102-realtime-sync]]가 공유하는 **token 메커니즘**을 고정한다.

- **생성(generation)**:
  - **확정**: CSPRNG로 생성한다(`crypto.randomBytes`). 엔트로피 **≥ 128 bit floor**(확정), 구현 기본값 256 bit(`randomBytes(32)` → base64url, 약 43자)는 가설.
  - **확정**: process 시작 시 1회 생성, **process 수명 동안 불변**, **메모리에만** 존재한다. config·log·temp·`--json` payload 어디에도 **기록하지 않는다**(R-CLI-007, [[SPEC-006-privacy-redaction]] non-persistence 정신과 정합).
- **전달(transport)**:
  - **확정**: dashboard URL의 **query param** `?token=<token>`으로 최초 전달한다(launch 6단계). dashboard SPA는 부트스트랩 시 token을 읽어 **메모리(in-page)**에 보관하고(부트스트랩 직후 `history.replaceState`로 URL의 `?token=` 잔여를 제거 — [[08-Decisions|D-034]] (d); client 구현은 [[SPEC-200-frontend-architecture]] 소유), 이후 모든 REST API 요청에 **HTTP header `Authorization: Bearer <token>`**([[08-Decisions|D-023]] 확정)로 실어 보낸다.
  - **확정(CSRF 내성)**: token을 **cookie가 아닌 custom/Authorization header**로 운반한다. 브라우저는 cross-site 요청에 이 header를 자동 부착하지 못하므로(그리고 비-simple header라 CORS preflight 필요) cross-site CSRF로 state-changing API를 호출할 수 없다.
  - **WebSocket([[08-Decisions|D-023]] 확정)**: 브라우저 WS handshake는 custom header(Authorization)를 못 싣는다. 따라서 `/api/events` 연결은 token을 **`Sec-WebSocket-Protocol` subprotocol token**(`orc-camp.v1, token.<token>`)으로 1차 전달하고, subprotocol을 못 쓰는 환경에서는 **handshake URL query param**(`/api/events?token=<token>`)을 fallback으로 허용한다(둘 다 허용). handshake 시 token을 검증하고 Origin 검증을 동반한다(§2.7). 검증 실패는 handshake 거부(close `4401`). event schema·close code는 [[SPEC-102-realtime-sync]] 소유.
- **검증(validation)**:
  - **확정**: 공통 **auth 미들웨어**가 보호 대상 route 앞에 mount된다. 제출 token과 server token을 **상수 시간 비교**(`crypto.timingSafeEqual`, 길이 불일치 시도 차단)로 검증한다.
  - **보호 범위(확정, [[08-Decisions|D-024]])**: `/api/health`(liveness, 민감 데이터 없음)와 `/api/events` WS handshake(자체 token 검증 — 위 WebSocket 항)를 **제외한** 모든 `/api/*`는 valid token을 요구한다. 공통 REST auth 미들웨어는 `Authorization: Bearer <token>`(D-023)를 검증한다. R-SEC-003의 **state-changing(POST/PATCH/DELETE) 요구는 hard floor**이고, [[08-Decisions|D-024]]가 이를 강화해 snapshot/preview/summary 등 terminal 파생 민감 데이터를 담는 read(GET)에도 token을 요구한다(다른 local process·cross-origin read로부터 보호). 이 강화는 초기엔 강화 제안이었으나 D-024로 **accepted**다(Open Question Q1 종결).
  - **거부 응답(확정)**: token 부재/불일치면 `401 Unauthorized`(WS `/api/events`는 handshake 거부, close `4401` — [[SPEC-102-realtime-sync]]), 처리 전 reject. 에러 본문은 민감 정보를 담지 않으며, 사용자에게 보이는 event와 debug log는 분리 기록한다([[SPEC-600-observability]] R-API-005 정합).

### 2.7 보안 경계: bind·외부 노출·CORS·Host (R-SEC-001, R-SEC-004, R-SEC-005)

- **loopback bind(확정, R-SEC-001)**: 기본 bind 주소는 `127.0.0.1`이다. server는 비-loopback interface에서 도달 불가하다(LAN IP로 접속 거부).
- **외부 bind opt-in(확정, R-SEC-004)**:
  - `--host`를 **비-loopback 주소**(예: `0.0.0.0`, LAN IP)로 지정하려면 `--allow-external`을 **동반**해야 한다. 동반하지 않으면 **usage error(exit 2)**로 거부하고 server를 시작하지 않는다.
  - `--allow-external`로 외부 bind할 때는 **stderr에 명시 warning**을 출력한다(예: "WARNING: binding to `<addr>` exposes terminal control surface to your network. Anyone with the token-bearing URL can control your tmux."). 이로써 R-SEC-004의 "명시 flag + warning 없이는 불가능"을 충족한다.
  - `127.0.0.1` / `localhost` / `::1` 등 loopback 주소는 warning 없이 허용한다.
- **CORS(확정, R-SEC-005)**:
  - 허용 origin allowlist = { **dashboard own origin** = `http://127.0.0.1:<actualPort>` 및 동치 `http://localhost:<actualPort>`, **localhost dev origin**(FE dev server; 가설 `http://localhost:5173`, 정확 값은 [[SPEC-200-frontend-architecture]] 정합 후 확정 — 검토 필요) }.
  - allowlist 밖 origin에는 `Access-Control-Allow-Origin`을 부여하지 않고 preflight(`OPTIONS`)를 거부한다. credentials 모드는 사용하지 않는다(token은 header 운반이므로 `Access-Control-Allow-Credentials` 불필요).
- **Host-header 검증(확정, DNS rebinding 방어; R-SEC-001/005 강화)**: 들어오는 요청의 `Host` header가 기대 값(`127.0.0.1:<port>` / `localhost:<port>`, 외부 bind 시 허용된 host)과 일치하지 않으면 거부한다. 이는 악성 웹사이트가 hostname을 `127.0.0.1`로 rebinding해 same-origin처럼 위장하는 공격을 차단한다. 이 방어는 [[08-Decisions|D-034]] (a)로 **accepted**다.

### 2.8 Shutdown 수명주기 (R-CLI-007)

- **트리거(확정)**: SIGINT(Ctrl-C), SIGTERM, 그리고 정상 process 종료 경로.
- **disposal 순서(확정)**:
  1. 신규 connection 수락 중단, HTTP/WS server를 graceful close(in-flight 요청 마감, **graceful timeout 가설 5s** 후 force-close).
  2. **startup token 폐기**: 메모리의 token 참조를 제거/덮어쓴다. token은 애초에 disk에 없으므로(§2.6) process 종료로 완전히 사라진다.
  3. **runtime state 폐기**: in-memory snapshot, activity ring buffer, tmux scanner timer/handle 정리(상태 객체 소유 spec은 [[SPEC-101-snapshot-api]]·[[SPEC-600-observability]]이나, 본 spec이 종료 시 **dispose 호출 책임**을 가진다).
  4. **port 반환**: listener close로 OS에 port 반납.
  5. exit 0(정상 종료).
- **결정(R-CLI-007)**: token·runtime state는 process 종료와 함께 폐기되며 **재시작은 새 token을 발급**한다(token 재사용 없음). 종료 후 동일 port로 즉시 재bind 가능해야 한다(listener가 깨끗이 닫혔는지 검증 가능).
- **single-instance 비보장(확정, [[08-Decisions|D-034]] (c))**: MVP는 instance lock을 두지 않는다(독립 실행 허용). 두 번째 `orc-camp`는 자기 token으로 fallback port에서 독립 실행된다(공유 상태 없음). lock file 도입은 post-MVP 검토로 미룬다(Open Question Q4 종결).

### 2.9 exit code / stream hygiene ([[08-Decisions|D-015]] 적응)

`serve`/default(long-running)에 맞춘 exit 정책. [[08-Decisions|D-015]]의 "결과를 산출했는가" 철학을 "server를 정상 운영·종료했는가"로 적응한다.

| code | 의미 | 조건(예) |
| --- | --- | --- |
| **0** | server가 정상 시작·운영 후 정상 종료 | SIGINT/SIGTERM에 의한 graceful shutdown. browser open 실패·port fallback은 **degrade이지 실패가 아니다** → 여전히 exit 0(server는 살아 운영됨). |
| **1** | catastrophic(server를 시작/운영하지 못함) | 어떤 port도 bind 불가, 명시 `--port` 점유, config dir 쓰기 불가(필수 시), 내부 uncaught 오류. error는 stderr, stdout에 부분 URL 금지. |
| **2** | usage error(server 미시도) | 알 수 없는 subcommand/flag, 비숫자·범위 밖 `--port`, 비-loopback `--host` + `--allow-external` 부재, 양립 불가 조합. 메시지는 stderr. |

- doctor의 exit는 §2.3/§3.5(health 기반: fail 있으면 1)을 따른다 — `serve`와 별개 의미다.
- **stream hygiene(확정, [[SPEC-001-scan-cli]] §2.4 정합)**:
  - **stdout**: dashboard URL **한 줄**(default·serve)만. `--json` 모드면 단일 startup record(예: `{"url":"...","host":"127.0.0.1","port":4123,"pid":12345}`; `url`은 token 포함) 1개 object만. doctor는 점검 표/`--json` 결과만.
  - **stderr**: 진행/통지/warning/runtime log 전부. 따라서 `URL=$(orc-camp serve 2>/dev/null | head -1)`이 깨끗한 token-bearing URL을 준다.
  - catastrophic(exit 1) 시 stdout을 비우고 error는 stderr에 쓴다(부분 URL/JSON 금지).
- **token 노출 주의(확정, accepted risk)**: dashboard URL은 token을 포함하므로 stdout 출력 시 terminal scrollback·shell history·로그 리다이렉트에 token이 남을 수 있다(R-SEC-002가 요구하는 transport의 본질적 trade-off). **브라우저 측**에서는 dashboard가 부트스트랩 직후 `history.replaceState`로 URL의 `?token=` 잔여를 제거해 in-browser history·server access log 노출을 줄인다([[08-Decisions|D-034]] (d); client 구현은 [[SPEC-200-frontend-architecture]] 소유). 남는 **stdout/terminal scrollback** 잔존은 transport 본질상 수용된 리스크로 두며, 공유 tmux/녹화 환경 추가 완화는 Open Question Q5로 추적한다(부분 종결).

## 3. Behavior rules

확정 규칙과 PoC 검증 가설(임계값)을 구분한다.

### 3.1 startup 시간 예산 (R-CLI-001, 비기능 "Launch")

- **확정(수용 기준 근거, [[02-Requirements]] Launch)**: tmux가 설치된 macOS에서 `orc-camp` 호출부터 **stdout에 dashboard URL이 출력**되기까지 **≤ 10s**여야 한다. 측정은 [[SPEC-007-test-validation]] 측정 절차에 통합한다(검토 필요: 통합 시점).
- URL 출력(launch 6단계)은 browser open(7단계) **이전**이므로, browser open 지연/실패가 10s 예산을 침범하지 않는다.

### 3.2 token 수명·재발급 (R-CLI-007, R-SEC-002)

- token은 process당 1개, 수명 = process 수명. rotation·만료는 MVP에 없다(단명 local process 가정). 재시작 = 새 token. 이전 URL의 token은 process가 죽는 순간 무효다.
- token은 어떤 영속 경로(config/log/SQLite/temp)에도 기록되지 않는다(§2.6, [[SPEC-500-settings-persistence]]도 token을 저장하지 않는다 — cross-spec 불변식).

### 3.3 인증 enforcement 모델 (R-SEC-003)

- **확정([[08-Decisions|D-024]])**: 공통 REST auth 미들웨어(`Authorization: Bearer`)는 `/api/health`와 `/api/events` WS handshake를 제외한 모든 `/api/*`(read 포함)에 mount된다. `/api/events`는 handshake에서 subprotocol/query token을 자체 검증한다(§2.6, [[SPEC-102-realtime-sync]]). 미들웨어 통과 = valid token. 미통과 = 401(WS는 handshake reject, close `4401`).
- state-changing(POST/PATCH/DELETE)은 **반드시** token을 요구한다(R-SEC-003 hard floor). [[SPEC-400-control-actions]]의 control endpoint는 이 미들웨어 뒤에 위치하며, **추가로** target 재검증(R-CTRL-005) 등 자기 안전장치를 얹는다 — 본 spec은 token gate까지만 책임진다.
- **결정성**: 같은 token으로 같은 보호 route에 접근하면 항상 동일하게 인가/거부된다(상태 의존 없음, 테스트 가능).

### 3.4 bind·CORS·Host 일관성 (R-SEC-001/004/005)

- **확정**: 실제 bind된 `(host, actualPort)`이 CORS own-origin·Host 허용 값·dashboard URL을 **단일 source**로 결정한다. fallback으로 port가 바뀌면 세 값(URL·CORS origin·Host 기대값)이 함께 그 port로 정합된다(불일치 금지).
- 외부 bind(`--allow-external`)에서는 own-origin·Host 허용에 해당 외부 host를 포함하되, warning은 변함없이 출력한다.

### 3.5 doctor check 분류·exit (R-CLI-005)

- **확정**: §2.3 표의 pass/warn/fail 분류를 따른다. **fail = 제품이 정상 동작 불가**(tmux 미설치, config dir 쓰기 불가, 모든 port 불가, log path 불가). **warn = 동작은 가능하나 주의**(tmux server 미실행, preferred port 점유→fallback 예정).
- **확정**: `fail` 1개 이상이면 exit 1, 아니면 exit 0. `warn`은 exit 0(스크립트가 warn을 차단으로 보지 않도록). 이 분류는 [[08-Decisions|D-015]]의 "tmux 미설치 health 판정은 doctor 소관" 위임과 정합한다(scan은 exit 0 데이터로 보고, doctor는 exit code로 health 판정).
- check **항목 집합**은 본 spec 소유(고정)이나, 각 check의 **임계/표현 세부**(예: log path redaction)는 [[SPEC-600-observability]]·[[SPEC-700-packaging-release]]가 심화한다.

## 4. 예시 (annotated)

### 4.1 default launch (정상, browser open 성공)

```text
$ orc-camp
http://127.0.0.1:4123/?token=ZmFrZS10b2tlbi1wbGFjZWhvbGRlcg          # stdout: URL 한 줄
[stderr] orc-camp v1.0.0 · listening on 127.0.0.1:4123
[stderr] opened dashboard in your default browser
[stderr] press Ctrl-C to stop
```
- stdout은 token-bearing URL 1줄(token은 placeholder). 모든 진단/통지는 stderr → `orc-camp 2>/dev/null | head -1`이 URL만 준다.

### 4.2 browser open 실패 → URL fallback (R-CLI-002)

```text
$ orc-camp           # headless / no $DISPLAY
http://127.0.0.1:4123/?token=ZmFrZS10b2tlbi1wbGFjZWhvbGRlcg          # stdout
[stderr] WARNING: could not open a browser automatically (no display detected)
[stderr] open this URL manually: http://127.0.0.1:4123/?token=ZmFrZS10b2tlbi1wbGFjZWhvbGRlcg
[stderr] press Ctrl-C to stop
```
- open 실패해도 process는 살아있고 URL은 이미 stdout에 있다(R-CLI-002 충족).

### 4.3 port fallback (R-CLI-006)

```text
$ orc-camp           # 4123 점유 중
http://127.0.0.1:51877/?token=...                                    # stdout: actual port
[stderr] preferred port 4123 is in use; using 51877
```

### 4.4 외부 bind opt-in (R-SEC-004)

```text
$ orc-camp --host 0.0.0.0
[stderr] error: binding to a non-loopback host requires --allow-external
$ echo $?
2

$ orc-camp --host 0.0.0.0 --allow-external
http://0.0.0.0:4123/?token=...                                       # stdout
[stderr] WARNING: bound to 0.0.0.0 — anyone on your network with the URL can control your tmux
```

### 4.5 doctor

```text
$ orc-camp doctor
tmux installed ............ pass (tmux 3.4)
tmux server reachable ..... warn (no server running)
port 4123 available ....... pass
config dir access ......... pass (~/.config/orc-camp)
debug log path ............ pass (~/.local/state/orc-camp/debug.log)
$ echo $?
0
```
- config/log 경로 표기는 [[SPEC-500-settings-persistence]]/[[SPEC-600-observability]] 소유 값을 점검·표기. `warn`은 exit 0 유지.

## 5. Acceptance criteria

> secret/token 예시는 placeholder를 쓴다([[SPEC-000-conventions]]). 임계값(`P_pref`·token 길이·graceful timeout·dev origin)은 §2~§3 가설 표기를 따른다. "보호 route" = `/api/health`와 `/api/events` handshake를 제외한 모든 `/api/*`(read 포함, §3.3); WS endpoint는 `/api/events`이며 handshake에서 token을 자체 검증한다([[08-Decisions|D-022]]/[[08-Decisions|D-023]]/[[08-Decisions|D-024]]).

- **SPEC-100-AC-01** (R-CLI-001)
  - Given tmux가 설치된 환경에서
  - When `orc-camp`(또는 `orc-camp serve`)를 실행하면
  - Then loopback(`127.0.0.1`)에 TCP listener가 떠 있고, token을 포함한 dashboard URL이 생성되어 stdout에 출력된다.

- **SPEC-100-AC-02** (R-CLI-002)
  - Given browser 자동 open이 불가능한 환경(예: `$DISPLAY` 없음 / open 명령 실패)에서
  - When `orc-camp`를 실행하면
  - Then process는 crash하지 않고 계속 listen하며, 접속 가능한 dashboard URL이 stdout에 출력되고 실패 사유 안내가 stderr에 나온다.

- **SPEC-100-AC-03** (R-CLI-006)
  - Given preferred default port(`P_pref`)가 다른 process에 점유된 상태에서
  - When `--port` 없이 `orc-camp`를 실행하면
  - Then server는 다른 사용 가능한 port에 bind되고, stdout의 URL은 그 **actual port**를 담으며 그 URL로 접속이 가능하다.

- **SPEC-100-AC-04** (R-CLI-001)
  - Given tmux가 설치된 macOS에서
  - When `orc-camp`를 실행하고 시간을 측정하면
  - Then process 호출부터 stdout에 dashboard URL이 출력되기까지 ≤ 10s이다([[SPEC-007-test-validation]] 측정 절차 기준).

- **SPEC-100-AC-05** (R-CLI-003)
  - Given `orc-camp`, `orc-camp serve`, `orc-camp scan`, `orc-camp doctor`, `orc-camp <unknown>`를 각각 실행할 때
  - When 결과를 관측하면
  - Then 앞의 4개는 각 command로 dispatch되고(스캔은 [[SPEC-001-scan-cli]] 표면), unknown subcommand는 exit 2(usage error)로 stderr에 오류를 낸다.

- **SPEC-100-AC-06** (R-CLI-003)
  - Given `orc-camp serve`를 실행할 때
  - When process와 출력을 관측하면
  - Then server가 시작되고 dashboard URL이 stdout에 출력되며, browser 자동 open을 **시도하지 않는다**(default와의 차이).

- **SPEC-100-AC-07** (R-CLI-005)
  - Given 임의의 환경에서
  - When `orc-camp doctor`(또는 `--json`)를 실행하면
  - Then 출력에 `tmux.installed`, `tmux.serverReachable`, `port.available`, `config.dirAccess`, `log.path` 5개 check 결과가 각각 status와 함께 포함된다.

- **SPEC-100-AC-08** (R-CLI-005)
  - Given tmux 미설치 또는 config dir 쓰기 불가 등 `fail` 분류 조건이 1개 이상인 환경과, `fail`이 0개인 환경에서
  - When `orc-camp doctor`를 실행하면
  - Then 전자는 exit 1, 후자는 exit 0이며, `warn`만 있는 경우(예: tmux server 미실행)는 exit 0이다.

- **SPEC-100-AC-09** (R-CLI-007)
  - Given `orc-camp`가 실행 중일 때
  - When SIGINT/SIGTERM으로 종료하면
  - Then server가 listen을 멈춰 bind했던 port가 반환되고(동일 port 재bind 가능), process가 exit 0으로 종료한다.

- **SPEC-100-AC-10** (R-CLI-007, R-SEC-002)
  - Given `orc-camp`가 실행되어 token을 발급한 동안과 종료 후에
  - When config directory·debug log·temp 경로를 token literal로 검사하면
  - Then 어디에서도 token이 발견되지 않으며(메모리 전용), 재시작 시 이전과 다른 새 token이 발급된다.

- **SPEC-100-AC-11** (R-SEC-001)
  - Given `--host`/`--allow-external` 없이 `orc-camp`를 실행했을 때
  - When loopback 주소와 비-loopback(LAN) 주소로 각각 접속을 시도하면
  - Then loopback 접속만 성공하고 비-loopback interface로는 server에 도달할 수 없다.

- **SPEC-100-AC-12** (R-SEC-002)
  - Given `orc-camp`가 생성한 dashboard URL에서
  - When URL을 검사하면
  - Then URL은 startup token을 포함하며(`?token=<token>`), 그 token은 CSPRNG로 생성된 ≥ 128 bit 값이다.

- **SPEC-100-AC-13** (R-SEC-003, [[08-Decisions|D-023]])
  - Given server가 실행 중일 때
  - When 보호 route에 대해 token 없는/잘못된 state-changing 요청(POST/PATCH)과 valid `Authorization: Bearer <token>` 요청을 각각 보내면
  - Then 전자는 401로 거부되어 어떤 상태 변경도 일어나지 않고, 후자는 auth 미들웨어를 통과한다(이후 처리는 [[SPEC-400-control-actions]]/[[SPEC-101-snapshot-api]]).

- **SPEC-100-AC-14** (R-SEC-004)
  - Given 비-loopback `--host`(예: `0.0.0.0`)를 줄 때
  - When `--allow-external` 없이/있이 각각 `orc-camp`를 실행하면
  - Then 전자는 exit 2(usage error)로 server를 시작하지 않고, 후자는 외부 host에 bind하되 stderr에 명시 warning을 출력한다.

- **SPEC-100-AC-15** (R-SEC-005)
  - Given server가 실행 중일 때
  - When 허용 origin(dashboard own origin / 허용된 localhost dev origin)과 비허용 origin에서 각각 CORS preflight(`OPTIONS`)·요청을 보내면
  - Then 허용 origin에만 `Access-Control-Allow-Origin`이 부여되고, 비허용 origin은 permissive CORS header를 받지 못한다(preflight 거부).

- **SPEC-100-AC-16** (R-SEC-003, R-SEC-002)
  - Given auth 미들웨어가 token을 검증할 때
  - When 길이가 다른 token과 한 글자만 다른 token으로 검증을 시도하면
  - Then 비교는 상수 시간(`timingSafeEqual` 동등)으로 수행되어 길이/내용 불일치가 동일하게 거부되며, 비교 시간으로 token을 추정할 수 없다.

- **SPEC-100-AC-17** (R-CLI-002)
  - Given `orc-camp serve`(또는 default)를 실행할 때
  - When `orc-camp serve 2>/dev/null | head -1`로 stdout만 캡처하면
  - Then 첫 줄이 token-bearing dashboard URL(`--json`이면 단일 startup JSON object)이며, 진행/통지/warning 로그가 stdout에 섞이지 않는다(stream hygiene).

- **SPEC-100-AC-18** (R-CLI-006)
  - Given `--port <n>`로 특정 port를 명시 지정하고 그 port가 점유된 상태에서
  - When `orc-camp --port <n>`을 실행하면
  - Then server는 다른 port로 **silent fallback하지 않고** exit 1로 종료하며 점유 사실을 stderr에 보고한다.

- **SPEC-100-AC-19** (R-SEC-001, R-SEC-005) — DNS rebinding 방어
  - Given server가 실행 중일 때
  - When 기대하지 않은 `Host` header(허용 host 집합 밖)를 가진 요청을 보내면
  - Then 요청은 거부된다(rebinding으로 위장한 same-origin 요청 차단).

- **SPEC-100-AC-20** (R-SEC-003, [[08-Decisions|D-024]]) — read endpoint token gating
  - Given server가 실행 중일 때
  - When `/api/health`를 제외한 read endpoint(예: `GET /api/snapshot`)에 token 없는 요청과 valid `Authorization: Bearer <token>` 요청을 각각 보내면
  - Then 전자는 401로 거부되어 어떤 데이터도 반환되지 않고(terminal 파생 민감 데이터 비노출), 후자만 auth 미들웨어를 통과한다(payload는 [[SPEC-101-snapshot-api]] 소유).

## 6. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| **R-CLI-001** | default/serve launch: server 시작 + token URL 생성, ≤10s 예산 | SPEC-100-AC-01, AC-04 |
| **R-CLI-002** | browser open 실패 시 stdout URL fallback, stream hygiene(URL만 stdout) | SPEC-100-AC-02, AC-17 |
| **R-CLI-003** | `orc-camp`/`serve`/`scan`/`doctor` dispatch, unknown=exit 2, serve=no-open | SPEC-100-AC-05, AC-06 |
| **R-CLI-005** | doctor 5개 check 계약 + fail 기반 exit | SPEC-100-AC-07, AC-08 |
| **R-CLI-006** | preferred port fallback + actual URL, 명시 port no-fallback | SPEC-100-AC-03, AC-18 |
| **R-CLI-007** | 종료 시 token·runtime state·port 폐기, token 비영속 | SPEC-100-AC-09, AC-10 |
| **R-SEC-001** | `127.0.0.1` 기본 bind, 비-loopback 도달 불가, Host 검증 | SPEC-100-AC-11, AC-19 |
| **R-SEC-002** | dashboard URL의 token 포함, CSPRNG ≥128bit, 비영속 | SPEC-100-AC-12, AC-10 |
| **R-SEC-003** | state-changing + read(D-024) token 요구, REST `Bearer`/WS subprotocol 운반(D-023), 상수시간 검증 | SPEC-100-AC-13, AC-16, AC-20 |
| **R-SEC-004** | 외부 bind는 `--allow-external` + warning 필수, 없으면 거부 | SPEC-100-AC-14 |
| **R-SEC-005** | CORS allowlist(own origin + dev origin), Host 검증 | SPEC-100-AC-15, AC-19 |

> 본 spec이 R-CLI-001/002/003/005/006/007·R-SEC-001~005를 1차 소유한다. token gate(§2.6)는 [[SPEC-400-control-actions]]·[[SPEC-101-snapshot-api]]·[[SPEC-102-realtime-sync]]가 소비하고(payload는 그들 소유), doctor check 심화는 [[SPEC-600-observability]]·[[SPEC-700-packaging-release]], config/log path 해석은 [[SPEC-500-settings-persistence]]·[[SPEC-600-observability]]가 소유한다. 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 7. Open Questions / Conflicts

### Conflicts / Upstream (청사진/index 보정 필요)

- **C1 — R-CLI-002 ownership 정정(RESOLVED)**: [[SPEC-001-scan-cli]] §6 C1은 R-CLI-002를 "`serve` 슬라이스 소유"로 pre-flag했다. 본 spec이 R-CLI-002를 §2.4(launch 6~7단계)·AC-02/AC-17로 정식 소유한다. scan은 AC-14(negative)로 URL 부재를 검증하므로 충돌 없음. README index의 SPEC-100 R-* 라인과 정합(orchestrator가 index 반영).
- **C2 — exit-code 철학 적응([[08-Decisions|D-015]])**: D-015는 scan(단발/`--watch`) 대상이다. 본 spec §2.9는 long-running server에 맞춰 "0=정상 운영·종료 / 1=catastrophic / 2=usage"로 적응하고, doctor는 health 기반(fail→1)으로 분리했다. D-015 위임("tmux 미설치 health 판정은 doctor 소관")과 정합. serve용 exit 정책을 별도 결정으로 승격할지는 orchestrator 판단(후보 D-0xx).
- **C3 — 신규 결정 후보(RESOLVED)**: 아래 design 결정이 full-product 게이트(spec-reviewer + product-architect)에서 [[08-Decisions]]로 승격·확정됐다 — read(GET) token 강화 → [[08-Decisions|D-024]](§2.6 보호 범위·§3.3), 명시 `--port` 점유 시 no-fallback → [[08-Decisions|D-034]] (b)(§2.5), Host-header 검증으로 DNS rebinding 방어 → [[08-Decisions|D-034]] (a)(§2.7), single-instance lock 미도입 → [[08-Decisions|D-034]] (c)(§2.8). 더불어 WS endpoint `/ws`→`/api/events` → [[08-Decisions|D-022]], token 운반(REST `Authorization: Bearer` / WS `Sec-WebSocket-Protocol` subprotocol + query fallback) → [[08-Decisions|D-023]]도 확정. 본 spec은 이를 §2.5~2.8·§2.6·§3.3에 반영하고 Q1/Q2/Q3/Q4를 종결했다.
- **C4 — doctor flag surface 흡수(RESOLVED)**: 타 spec이 필요로 한 doctor/CLI 표면 확장을 본 spec이 흡수했다 — `--debug`/log-level(§2.1, [[SPEC-600-observability]] §2.6), `doctor --report`(§2.3, [[SPEC-600-observability]] §2.10 C2), top-level `orc-camp purge`(§2.1, [[SPEC-700-packaging-release]] §2.6 C2). 내용·invariant는 SPEC-600/700 소유로 유지. install-health(node-version·무결성)는 exit-bearing이 아닌 advisory diagnostics로 결정([[SPEC-700-packaging-release]] §2.4 C1 종결, §2.3).

### Open Questions (검토 필요 / PoC·정합 대상)

- **Q1 — read endpoint token 강화 범위(RESOLVED, [[08-Decisions|D-024]])**: `/api/health`와 `/api/events` handshake를 제외한 모든 `/api/*`(read 포함)가 token을 요구하도록 확정. 부트스트랩 token 주입 순서는 [[SPEC-200-frontend-architecture]]/[[SPEC-101-snapshot-api]]가 `Authorization: Bearer`로 정합(D-023). **종결.**
- **Q2 — token transport(RESOLVED, [[08-Decisions|D-023]])**: REST = `Authorization: Bearer <token>`, WebSocket = `Sec-WebSocket-Protocol` subprotocol token(query param fallback)으로 확정. cookie 미사용으로 CSRF 내성·proxy 호환을 확보. **종결.**
- **Q3 — 명시 `--port` 점유 정책(RESOLVED, [[08-Decisions|D-034]] (b))**: no-fallback + exit 1로 확정(비명시 기본 port만 ephemeral fallback). **종결.**
- **Q4 — single-instance lock(MVP RESOLVED, [[08-Decisions|D-034]] (c))**: MVP는 lock 미도입(독립 실행 허용). lock file·기존 URL 재출력은 post-MVP 재검토로 남긴다. **MVP 종결.**
- **Q5 — token-in-URL 잔존 리스크(부분 RESOLVED, [[08-Decisions|D-034]] (d))**: **브라우저** URL 잔여는 부트스트랩 후 `history.replaceState`로 제거해 in-browser history·access log 노출을 완화한다(client 구현 [[SPEC-200-frontend-architecture]]). 남는 **stdout/terminal scrollback·shell history** 잔존은 transport 본질상 수용된 리스크다. URL fragment(`#`)·일회용 exchange 같은 추가 완화는 post-MVP 후보. **부분 종결.**
- **Q6 — preferred default port·dev origin·graceful timeout 값**: `P_pref=4123`, dev origin `http://localhost:5173`, graceful timeout 5s, token 256bit는 모두 **가설**이다. [[SPEC-200-frontend-architecture]](dev port)·[[SPEC-700-packaging-release]](port 관례)·[[SPEC-007-test-validation]](timing) 정합 및 PoC로 확정. **검토 필요.**
- **Q7 — config/log path 해석**: doctor가 점검할 config/log 경로의 OS별 규칙(XDG vs macOS app dir)은 [[06-Infra]] Open Question이며 [[SPEC-500-settings-persistence]]/[[SPEC-600-observability]]가 소유한다. 본 spec doctor check는 그 경로 계약에 의존하므로 두 spec 확정 후 표기를 정합한다. **검토 필요.**
