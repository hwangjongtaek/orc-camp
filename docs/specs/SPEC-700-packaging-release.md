---
spec: SPEC-700
title: 패키징·배포·릴리스 운영
status: approved
updated: 2026-06-27
requirements: [R-P1-010]
decisions: [D-001, D-003, D-004, D-009, D-013]
tags:
  - specs
  - packaging
  - release
  - distribution
  - ci
  - license-gate
  - doctor
  - epic-8
---

# SPEC-700 — 패키징·배포·릴리스 운영

이 spec은 Orc Camp **전체 제품**을 사용자가 설치해 매일 쓸 수 있는 형태로 **패키징·배포·릴리스**하는 계약을 고정한다. Epic 8([[README]])의 진입 spec이며 다섯 기둥을 소유한다:

1. **published artifact 모양(§2.1~2.3)**: npm global install을 1차 배포로 가정한다. `orc-camp` bin, TS monorepo(CLI + local server + dashboard 정적 자산) build → 단일 installable, `package.json`의 `bin`/`engines`/`files` allowlist 계약.
2. **doctor install-health depth(§2.4)**: node 버전·install 무결성·asset-pack 탑재 여부·버전 등 **설치 관점 진단의 내용**. command surface·exit semantics는 [[SPEC-100-server-lifecycle]], diagnostics block 배치는 [[SPEC-600-observability]] 소유이고, 본 spec은 그 **값**을 채운다.
3. **CI/release 파이프라인(§2.5)**: 결정적 unit+integration을 merge gate로(라이브 tmux 없이, [[SPEC-007-test-validation]] 계층 재사용), e2e/smoke를 macOS+tmux(및 P1 Linux, R-P1-010) 별도 job으로 분리. 버전/릴리스 흐름과 **무엇이 릴리스를 막는가**.
4. **install/uninstall 수명주기(§2.6)**: uninstall 후 config/log 잔존(제거) 정책(배포 비기능), runtime state/token 종료 시 폐기 참조(R-CLI-007), first-run 산출물.
5. **license 게이트(§2.7, 가장 중요한 릴리스 규칙)**: asset pack의 license가 `"unknown"`인 동안([[08-Decisions|D-009]]) asset pack을 published npm artifact에 **포함하지 않는다**. 런타임 코드 배포와 asset 번들을 분리하는 **테스트 가능한 release gate**.

> **불변식 ① — 코드 배포와 asset 번들 분리(확정, [[08-Decisions|D-009]])**: published package는 런타임 코드(CLI + server + dashboard 정적 자산)만 담는다. `asset-packs/`의 어떤 PNG·manifest도 license 확정 전까지 published artifact에 들어가지 않는다. asset 없이도 dashboard는 placeholder로 동일 layout/interaction을 유지한다([[SPEC-300-asset-rendering]] §3.6/§3.8). 따라서 기능 검증은 license 확정과 **독립적**이다.

> **불변식 ② — secure-by-default 배포(확정, [[08-Decisions|D-003]])**: published build의 기본값은 `127.0.0.1` bind(R-SEC-001), startup token URL(R-SEC-002), 외부 bind는 명시 opt-in + warning(R-SEC-004)이다. 어떤 build/release 단계도 이 기본값을 뒤집지 않으며, 자동 텔레메트리/원격 전송을 추가하지 않는다([[SPEC-600-observability]] 불변식 ②). 보안 경계의 **정의·강제**는 [[SPEC-100-server-lifecycle]] 소유이고, 본 spec은 그것이 **배포본에서 변형 없이 유지됨**을 보증한다.

> **불변식 ③ — 비-영속 잔존 없음(확정, R-CLI-007 / [[02-Requirements]] 데이터 보존 정책)**: startup token은 메모리 전용([[SPEC-100-server-lifecycle]] §2.6), terminal output 원문은 비저장([[SPEC-006-privacy-redaction]] §2.5)이므로 uninstall 잔존물에는 어떤 secret/터미널 원문도 없다. 잔존은 preference scalar config와 redacted debug log뿐이다(§2.6).

## 1. Scope

### In scope

- **published artifact 계약**(§2.1~2.3): 배포 채널(npm global install 1차), `orc-camp` bin 엔트리, `package.json`의 `bin`/`engines`/`files` allowlist·`type`, TS monorepo build → 단일 self-contained installable(CLI+server bundle + dashboard 정적 build 포함), dist 레이아웃.
- **doctor install-health depth**(§2.4): `nodeVersion` vs `engines` floor, `appVersion`, install 무결성(bin 해석·dashboard 정적 자산 존재·asset-pack 탑재 여부), `os`/`arch`/`tmuxVersion` 값 — [[SPEC-600-observability]] `DoctorDiagnostics.environment`를 채우는 **내용**.
- **CI/release 파이프라인**(§2.5): merge gate(결정적 U+I+fixture-M, [[SPEC-007-test-validation]]) + build/license-gate/artifact-allowlist 검사, 별도 비-게이트 job(e2e/smoke macOS+tmux, P1 Linux), 버전/릴리스 흐름, release blocker 목록.
- **install/uninstall 수명주기**(§2.6): first-run 산출물, uninstall 후 config/log 잔존 정책(무엇이 남고 어떻게 purge하는가), runtime state/token 폐기 참조.
- **license 게이트**(§2.7): manifest `license` 판독 → asset 번들 차단, "published tarball에 asset PNG 0개" testable gate, license 확정 시 asset 번들 활성 전환 계약.
- **secure-deploy 기본값 보존**(§2.8): 배포본이 loopback bind·startup token·외부 bind opt-in을 변형 없이 유지·텔레메트리 없음.
- 다룬 요구사항: **R-P1-010**(Linux 검증·문서화), **배포 비기능**(npm global install·uninstall 잔존 정책), **[[08-Decisions|D-009]]**(license 게이트). 참조: R-CLI-005(doctor depth)·R-CLI-007·R-SEC-001/002/004·R-UI-006(소유는 타 spec).

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 |
| --- | --- | --- |
| doctor **command surface**(flag·5개 basic check 집합·exit code semantics) | CLI 표면 | [[SPEC-100-server-lifecycle]] §2.3 |
| doctor **diagnostics block struct·problem report 번들** | observability | [[SPEC-600-observability]] §2.9~2.10 |
| 테스트 **케이스 설계·계층 정의·fixture·측정 절차** | 본 spec은 그 계층을 **CI 단계로 배치**만 | [[SPEC-007-test-validation]] |
| asset **render fallback·placeholder 메커니즘** | 런타임 소비 | [[SPEC-300-asset-rendering]] §3.6 |
| config/log **path 해석 규칙**(configDir/stateDir) | settings/persistence | [[SPEC-500-settings-persistence]] §2.1 |
| server launch·port·token **메커니즘 정의** | server 수명주기·보안 경계 | [[SPEC-100-server-lifecycle]] |
| asset **생성**(PixelLab prompt/seed) | 생성 종료 | [[13-PixelLab-Asset-Registry]] (closed) |
| standalone binary·Homebrew formula | MVP 비목표(P1 검토, [[06-Infra]] Open Question) | 본 spec §6 pre-flag |

## 2. Contract

### 2.1 배포 채널과 published artifact 정체성 (배포 비기능, [[08-Decisions|D-001]])

- **1차 배포 채널(확정 가정, [[06-Infra]] 배포)**: npm global install — `npm install -g orc-camp`. standalone binary·Homebrew는 P1 검토 대상이며 본 spec MVP 범위 밖이다(§6).
- **bin 엔트리(확정, [[08-Decisions|D-001]])**: 단일 실행 파일 command는 `orc-camp`다. `package.json#bin`에 `{ "orc-camp": "<dist CLI entry>" }`로 노출하고, entry 파일은 `#!/usr/bin/env node` shebang을 가진다. 이 command가 [[SPEC-100-server-lifecycle]] §2.1의 dispatch(`orc-camp`/`serve`/`scan`/`doctor`)를 실행한다.
- **registry 패키지명(가설)**: published 패키지명은 `orc-camp`로 가정한다. npm registry에서의 가용성·scope(`@<org>/orc-camp`) 여부는 미확정이다(검토 필요, §6 Q1). CLI command 이름(`orc-camp`, 확정)과 registry 패키지명은 별개 결정이다.
- **단일 installable 원칙(확정 의도, [[08-Decisions|D-004]])**: TS monorepo의 여러 workspace(CLI·server·dashboard)를 빌드하더라도 사용자가 받는 것은 **하나의 self-contained 패키지**여야 한다(`npm i -g` 한 번으로 동작). 권장 구현은 workspace 산출물을 bundler로 dist에 vendoring해 런타임 외부 의존을 최소화하는 것이다(§2.3). monorepo 내부 패키지를 별도 published 의존성으로 둘지 bundling할지는 build 결정(가설: bundling 권장, §6 Q2).

### 2.2 `package.json` shape 계약 (배포 비기능, [[08-Decisions|D-004]])

published 패키지의 manifest는 아래 키를 **반드시** 정의한다(값 일부는 가설 표기):

```jsonc
{
  "name": "orc-camp",                         // 가설(registry 가용성 미확정, §6 Q1)
  "version": "0.1.0",                          // SemVer (§2.5 release 흐름)
  "description": "Local-first tmux AI-agent orc-camp dashboard",
  "bin": { "orc-camp": "dist/cli/index.js" }, // 확정: command=orc-camp (D-001). 경로는 dist 레이아웃 가설
  "type": "module",                            // 가설(ESM, §6 Q2)
  "engines": { "node": ">=20" },               // 가설: Node 20 LTS floor (§2.4, §6 Q3 — 검토 필요)
  "files": [                                   // 확정 의도: allowlist (§2.3, 불변식 ①)
    "dist/",                                   // bundled CLI+server + dashboard 정적 자산
    "README.md",
    "LICENSE"                                  // 제품 코드 license (asset license와 별개)
  ],
  "scripts": {
    "build": "…",                              // §2.3 build 파이프라인
    "prepublishOnly": "…"                      // §2.7 license 게이트 + §2.3 build 강제
  }
}
```

- **`files` allowlist(확정 의도)**: npm은 `files`에 **명시된 것만** 패킹한다(`package.json`·`README`·top-level `LICENSE`는 npm이 항상 포함). 따라서 `src/`·`tests/`·`docs/`·`.env`·`.mcp.json`·`generation/`·**`asset-packs/`는 published tarball에 들어가지 않는다**. 이 allowlist가 license 게이트(§2.7)의 1차 방어선이다.
- **`engines.node`(가설)**: native `fetch`·modern `crypto`(`timingSafeEqual`, [[SPEC-100-server-lifecycle]] §2.6)·ESM 안정성을 근거로 **Node ≥ 20 LTS**를 floor로 가정한다. 정확한 floor는 의존성 호환·LTS 일정으로 확정한다(검토 필요, §6 Q3). engine floor 미만에서는 install 시 npm `EBADENGINE` warn 또는 런타임 guard가 명확한 메시지를 낸다(§2.4).
- **`type`/bundler(가설)**: ESM(`"type": "module"`)을 가정하되, bundler(예: `tsup`/`esbuild`)·CommonJS interop은 build 결정이다(§6 Q2). dashboard는 Vite([[AGENTS]] 스택)로 정적 build한다.

### 2.3 build → 단일 installable 파이프라인 (배포 비기능, [[08-Decisions|D-004]])

`npm run build`는 monorepo 산출물을 dist 단일 트리로 합친다(확정 단계, 도구·경로는 가설):

1. **type-check**: 전 workspace `tsc --noEmit`(빌드 차단 오류 검출).
2. **dashboard 정적 build**: React + Vite([[AGENTS]]) → 해시된 정적 자산(html/js/css). **placeholder 렌더가 asset pack·network 없이 순수 CSS로 동작**해야 한다([[SPEC-300-asset-rendering]] §3.6-4).
3. **CLI+server bundle**: bundler로 `dist/cli/`·서버 런타임 산출. 1번 dashboard 정적 자산을 `dist/dashboard/`(가설 경로)로 복사. 서버는 이 경로에서 dashboard를 serve한다([[SPEC-100-server-lifecycle]] launch).
4. **artifact 검증**: `npm pack --dry-run`(또는 `--json`)으로 tarball 내용 목록을 산출해 §2.2 allowlist·§2.7 license 게이트를 검사한다.

dist 레이아웃(가설):

```text
dist/
  cli/index.js        # bin 엔트리(shebang). orc-camp dispatch
  server/…            # local HTTP/WS server (bundled)
  dashboard/…         # Vite 정적 build (html/js/css) — asset PNG 없음
```

- **자급성(확정 의도)**: 런타임 외부 의존을 bundling으로 최소화해 `npm i -g` 직후 추가 네트워크 fetch 없이 동작하게 한다(local-first, [[08-Decisions|D-003]]).
- **asset 부재 정상 동작(확정, 불변식 ①)**: dist에는 asset PNG가 없다. dashboard는 `manifest == null` 경로([[SPEC-300-asset-rendering]] L2 placeholder)로 부팅한다.

### 2.4 doctor install-health depth (R-CLI-005 depth, R-OBS-004)

[[SPEC-100-server-lifecycle]] §2.3이 doctor **command surface**(5개 basic check `tmux.installed`/`tmux.serverReachable`/`port.available`/`config.dirAccess`/`log.path`·exit semantics)를 소유하고, [[SPEC-600-observability]] §2.9가 **diagnostics block struct**를 소유한다. 본 spec은 그 위에서 **설치 관점 진단의 값**을 채운다 — 즉 [[SPEC-600-observability]] `DoctorDiagnostics.environment`와 install 무결성:

```ts
// SPEC-700이 값을 채우는 install-health 내용 (struct는 SPEC-600 DoctorDiagnostics 소유)
interface InstallHealth {
  appVersion: string;            // published package.json#version
  nodeVersion: string;           // process.version
  nodeFloor: string;             // package.json#engines.node (가설 ">=20")
  nodeFloorSatisfied: boolean;   // 현재 node가 floor 충족?
  os: string; arch: string;      // 'darwin'|'linux' / 'arm64'|'x64'
  tmuxVersion: string | null;    // 'tmux -V' 파싱(없으면 null)
  install: {
    binResolved: boolean;        // orc-camp bin이 PATH에서 해석되는가
    dashboardAssetsPresent: boolean; // dist/dashboard 정적 자산 존재
    assetPackBundled: boolean;   // asset pack PNG 탑재 여부(license 게이트 하에서 정상값 false)
  };
}
```

- **node floor 진단(확정 내용)**: `nodeFloorSatisfied == false`(현재 node < `engines` floor)면 doctor diagnostics에 **명시 경고**를 표기한다. 이 신호를 [[SPEC-100-server-lifecycle]]의 **exit-bearing check 집합에 추가**할지(예: `node.version` warn/fail)는 cross-spec 조정 대상이다(§6 C1). 본 spec은 **값·경고 내용**을 소유하고 exit 기여 여부는 SPEC-100 확정에 위임한다.
- **asset-pack 탑재 진단(확정 내용, license 게이트 정합)**: `install.assetPackBundled`는 license `"unknown"` 하의 정상 배포에서 **false**이며, 이는 fail이 아니다(placeholder 정상 동작). doctor는 "asset pack not bundled — placeholder rendering active"를 informational로 표기한다(혼동 방지). license 확정 후 번들이 켜지면 true로 바뀐다(§2.7).
- **install 무결성(확정 내용)**: `binResolved`·`dashboardAssetsPresent`가 false면 손상/불완전 설치 신호다. 표기·exit 기여 분류는 SPEC-100 doctor surface와 정합한다(§6 C1).

### 2.5 CI / release 파이프라인 (배포 비기능, [[SPEC-007-test-validation]] 정합)

**(A) merge gate(PR CI — 결정적, 라이브 tmux 없음)** — 아래가 **모두** 통과해야 merge한다:

| gate 단계 | 내용 | 근거 |
| --- | --- | --- |
| `test:unit` | [[SPEC-007-test-validation]] **U** 계층(순수 함수) | SPEC-007 §2.1, AC-10 |
| `test:integration` | SPEC-007 **I** 계층(mock tmux, fixture) | SPEC-007 §2.1~2.2 |
| `measure:fixture` | SPEC-007 **fixture 기반 M**(detection/redaction 지표 재현) | SPEC-007 §3.1-1 |
| `build` | §2.3 type-check + bundle + dashboard build 성공 | 본 spec §2.3 |
| `gate:license` | §2.7 license 게이트(tarball에 asset 0개) | [[08-Decisions|D-009]] |
| `gate:artifact` | §2.2 `files` allowlist(disallowed path 0개) | 본 spec §2.2 |

- **결정적 경계(확정, [[SPEC-007-test-validation]] §3.1)**: merge gate는 **라이브 tmux server·머신 tmux 상태·실시간 clock에 의존하지 않는다**. SPEC-007의 결정적 계층(U+I+fixture-M)을 그대로 게이트로 배치한다.

**(B) 비-게이트 job(머신 의존 — 회귀 신호, PR 차단 안 함)**:

| job | 내용 | 환경 | 근거 |
| --- | --- | --- | --- |
| `smoke:macos` | SPEC-007 **E** 계층 + 설치 패키지 smoke(`scan`/`serve`/`doctor`) | macOS + tmux(보장) | SPEC-007 §3.1-2 |
| `measure:latency` | SPEC-007 **M-LATENCY**(`--watch` cycle p95) | macOS + tmux | SPEC-007 §3.3 M4 |
| `smoke:linux` (R-P1-010) | 설치 패키지 smoke + tmux 호환성 검증·문서화 | Linux + tmux | R-P1-010, [[06-Infra]] 호환성 |

- **R-P1-010 위치(확정)**: Linux + tmux 호환성은 `smoke:linux` job으로 검증하고 결과를 문서화한다. MVP 1차 타깃은 macOS이므로 Linux smoke 실패는 **P1 회귀 신호**(advisory)이며 MVP(macOS) 릴리스를 **hard-block 하지 않는다**. Linux를 지원 플랫폼으로 승격하는 시점에 게이트로 올린다(§6 Q4).

**(C) release 흐름(확정 단계, 도구 가설)**:

1. 버전 bump — **SemVer**(가설; CalVer 대안은 §6 Q5). tag는 `package.json#version`과 일치(`v<version>`).
2. (A) merge gate green + (B) `smoke:macos` green 확인.
3. `npm run build` → `npm pack`으로 tarball 산출.
4. **release gate 재검증**: §2.7 license 게이트 + §2.2 artifact allowlist를 **packed tarball 실물**에 대해 다시 실행(`prepublishOnly`가 강제).
5. `npm publish`(필요 시 `--access`/`provenance`). publish 후 install smoke(설치→`orc-camp --version`/`doctor`)로 sanity.

**release blocker(확정 — 아래 중 하나라도면 릴리스 금지)**:
- (A) merge gate 실패(unit/integration/fixture-M/build).
- **license 게이트 실패**: tarball에 asset-pack 파일/PNG 존재(§2.7).
- artifact allowlist 위반: tarball에 `src/`·`tests/`·`docs/`·`.env`·secret·`asset-packs/` 등 disallowed path 존재.
- `bin`/`engines` 누락 또는 bin 미해석.
- 선언한 `engines` floor에서의 설치/실행 smoke 실패(`smoke:macos`).

### 2.6 install / uninstall 수명주기 · 잔존 정책 (배포 비기능, R-CLI-007 참조)

**install / first-run(확정 + 참조)**:
- `npm install -g orc-camp`이 `orc-camp` bin을 PATH에 둔다.
- **first-run 산출물**: 최초 실행 시 configDir(`config.json` 기본값)와 stateDir(debug log)을 생성한다. **schema·기본값·path 해석**은 본 spec이 소유하지 않는다 — config는 [[SPEC-500-settings-persistence]] §2.1~2.2, debug log는 [[SPEC-600-observability]] §2.8, path 해석(`$ORC_CAMP_CONFIG_DIR` > `$XDG_CONFIG_HOME` > `~/.config/orc-camp`)은 [[SPEC-500-settings-persistence]] 소유다. 본 spec은 first-run 생성이 **idempotent**(이미 있으면 보존)이고 **asset pack 없이 동작**함을 보증한다.
- runtime token·snapshot·activity는 종료 시 폐기된다(R-CLI-007 — [[SPEC-100-server-lifecycle]] §2.8 disposal 참조).

**uninstall 잔존 정책(확정 — 배포 비기능 "uninstall 후 config/log 잔존 정책")**:

| 대상 | uninstall(`npm uninstall -g`) 후 | 사유 |
| --- | --- | --- |
| 패키지 파일(dist/bin) | **제거됨**(npm이 패키지 트리 삭제) | 코드 산출물 |
| configDir(`config.json`) | **남음**(npm은 user data 미삭제) | preference 보존(재설치 시 복원) |
| stateDir(debug log·P1 SQLite) | **남음** | 진단 이력 보존 |
| startup token·terminal 원문 | **애초에 디스크에 없음 → 잔존 0** | 메모리 전용/비저장(불변식 ③) |

- **정책(확정)**: npm uninstall은 코드만 지우고 **user data(config/log)는 의도적으로 보존**한다(재설치 시 설정 복원). 잔존물에는 어떤 secret/터미널 원문도 없다(불변식 ③ — token은 메모리 전용 [[SPEC-100-server-lifecycle]] §2.6, output 비저장 [[SPEC-006-privacy-redaction]] §2.5). 남는 것은 preference scalar config와 redacted debug log뿐이다.
- **명시 purge 경로(확정 의도, 이름 가설)**: 완전 제거를 원하는 사용자를 위해 **설치 상태에서 실행하는 purge command**를 제공한다 — `orc-camp purge`(또는 `doctor --purge`; 정확한 surface는 [[SPEC-100-server-lifecycle]] §2.3·[[SPEC-600-observability]] §2.10 flag 집합과 조정, §6 C2). purge는 configDir + stateDir(config·debug log·P1 db)를 제거하며, server 실행 중이 아닐 때 동작한다. purge → uninstall 순서를 문서로 안내한다. CLI 부재(이미 uninstall) 상황을 위해 **수동 제거 경로**(해당 디렉터리 `rm`)도 문서화한다(path는 SPEC-500 표기·doctor 출력에서 확인 가능, R-SET-003).

### 2.7 license 게이트 — 코드 배포 ⊥ asset 번들 (가장 중요한 릴리스 규칙, [[08-Decisions|D-009]])

asset pack의 `manifest.json#license`는 현재 `commercial_use`/`redistribution`/`attribution_required` = **`"unknown"`**이고, `asset-packs/orc-camp-default/LICENSE.md`는 "license 확정 전 외부 배포 금지"를 명시한다([[13-PixelLab-Asset-Registry]] / [[09-Reviews]] Issue Register). 본 게이트는 이 규칙을 **빌드/릴리스에서 강제**한다.

**게이트 정의(확정)**:

1. **license 판독**: 빌드/릴리스 시 `asset-packs/orc-camp-default/manifest.json#license`를 읽는다. `commercial_use`·`redistribution`·`attribution_required` 중 **하나라도 `"unknown"`**이면 **`bundleAssets = false`**(차단 상태).
2. **차단 상태에서의 published artifact**: tarball은 `asset-packs/` 하위 **어떤 파일도(특히 `*.png`·`manifest.json`·`*.zip`) 포함하지 않는다**. §2.2 `files` allowlist가 1차 차단이고, 본 게이트가 packed tarball 실물을 재검사하는 2차 강제다.
3. **testable release gate(확정)**:
   - **G1**: `npm pack`으로 산출한 tarball 파일 목록에 `asset-packs/` 경로·asset 확장자(`.png`/`.zip`) 파일이 **0개**여야 한다(license `"unknown"`인 동안). 위반 시 `gate:license` FAIL → 릴리스 차단.
   - **G2**: `files` allowlist(§2.2)에 `asset-packs/`가 포함되지 않음을 lint한다.
   - **G3**: 설치 패키지의 dashboard가 `manifest == null` placeholder로 부팅·렌더됨을 smoke로 확인한다([[SPEC-300-asset-rendering]] §3.8 / SPEC-300-AC-13 연계).
4. **license 확정 시 전환(확정 계약)**: PixelLab.ai의 commercial-use·redistribution·attribution 조건이 명시 확인되어 manifest `license` 세 필드가 **모두 `"unknown"`이 아닌 허용 값**으로 바뀌고 attribution 의무가 `ATTRIBUTION.md`로 충족되면, 그때 비로소 `bundleAssets = true`를 켜 asset pack을 published artifact에 포함할 수 있다. 이 전환은 [[08-Decisions]]에 결정으로 남기고 본 spec과 [[SPEC-300-asset-rendering]] §3.8을 함께 갱신한다(§6 Q6).

- **핵심 분리(확정)**: 런타임 코드 배포는 license와 **무관하게** 진행된다(placeholder로 완전 기능). asset 번들만 license에 종속된다. 따라서 license 미해소가 제품 출시를 막지 않는다([[08-Decisions|D-007]] "asset은 MVP blocker 아님" 정합).

### 2.8 secure-deploy 기본값 보존 (불변식 ②, R-SEC-001/002/004 참조, [[08-Decisions|D-003]])

- **확정(보증 항목)**: published build의 기본 launch는 `127.0.0.1` bind + startup-token URL이며, 외부 bind는 `--allow-external` + warning 없이는 불가능하다. 이 동작의 **정의·강제**는 [[SPEC-100-server-lifecycle]] §2.7 소유이고, 본 spec은 **배포 과정에서 그 기본값이 변형되지 않음**(build flag·env 주입으로 loopback을 끄거나 외부 bind를 기본화하지 않음)을 보증한다.
- **텔레메트리 없음(확정, [[SPEC-600-observability]] 불변식 ②)**: published 패키지는 launch 시 어떤 자동 outbound 네트워크 egress도 하지 않는다(local-only). update check·analytics 같은 자동 원격 호출을 기본 포함하지 않는다.

## 3. Behavior rules

확정 규칙과 가설(미확정 버전/도구)을 구분한다([[SPEC-000-conventions]] 표기).

### 3.1 published artifact 구성 (확정)
1. published 패키지는 런타임 코드(`dist/`)·`package.json`·`README`·top-level `LICENSE`만 담는다. `asset-packs/`·`src/`·`tests/`·`docs/`·`.env`·`generation/`는 제외된다(§2.2, §2.7).
2. bin command는 `orc-camp` 하나이며 [[SPEC-100-server-lifecycle]] dispatch를 실행한다([[08-Decisions|D-001]]).
3. 단일 `npm i -g`로 추가 네트워크 fetch 없이 동작한다(bundling 자급성, §2.3).

### 3.2 버전/엔진 (가설 — 검토 필요)
1. `engines.node` floor는 **Node ≥ 20 LTS**로 가정한다(§2.2, §6 Q3). 미만 환경은 install warn 또는 런타임 guard로 명확히 거부/경고한다(§2.4).
2. 버전 체계는 **SemVer**로 가정한다(§2.5, §6 Q5). tag = `v<package.json#version>`.
3. `type`/bundler/dist 경로는 build 결정(가설, §6 Q2).

### 3.3 license 게이트 (확정)
1. manifest `license` 세 필드 중 하나라도 `"unknown"`이면 asset 번들 금지(`bundleAssets=false`).
2. 차단 상태의 tarball에는 asset 파일이 0개여야 한다(G1) — release blocker.
3. 코드 배포는 license와 독립적으로 진행되며 placeholder로 완전 기능한다(§2.7, [[SPEC-300-asset-rendering]] §3.8).

### 3.4 CI 게이트 경계 (확정, [[SPEC-007-test-validation]] §3.1 정합)
1. merge gate는 결정적 U+I+fixture-M + build/license/artifact 검사로 구성되며 라이브 tmux에 의존하지 않는다.
2. e2e/smoke(macOS+tmux)·latency·Linux smoke(P1)는 별도 비-게이트 job이다(머신 의존).
3. Linux smoke 실패는 P1 회귀 신호이며 MVP(macOS) 릴리스를 hard-block 하지 않는다(§6 Q4).

### 3.5 uninstall 잔존 (확정)
1. npm uninstall은 코드만 제거하고 user data(config/log)는 보존한다(§2.6).
2. 잔존물에 secret/터미널 원문은 없다(불변식 ③).
3. 완전 제거는 설치 상태의 `purge` command(이름 가설) 또는 문서화된 수동 경로로 한다(§2.6).

## 4. Acceptance criteria

> 각 AC는 통과/실패가 객관 판정 가능하다. 버전/엔진/도구 가설은 §2~§3 표기를 따른다. 출처 `R-*`/결정/비기능 영역을 괄호로 표기한다. "tarball" = `npm pack` 산출물.

- **SPEC-700-AC-01** (배포 비기능, [[08-Decisions|D-001]]) — bin 노출·실행
  - Given published 패키지를 전역 설치(`npm install -g`/`npm link`)한 환경에서
  - When `orc-camp --version`과 `orc-camp --help`를 실행하면
  - Then `orc-camp` bin이 PATH에서 해석되어 버전/usage를 출력하고 exit 0이다.

- **SPEC-700-AC-02** (배포 비기능) — `files` allowlist
  - Given `npm pack`으로 tarball을 산출했을 때
  - When tarball 파일 목록을 검사하면
  - Then `dist/`·`package.json`·`README`·top-level `LICENSE`만 포함되고, `src/`·`tests/`·`docs/`·`.env`·`.mcp.json`·`generation/`·`asset-packs/`는 **하나도 포함되지 않는다**.

- **SPEC-700-AC-03** (배포 비기능, [[08-Decisions|D-004]]) — 단일 installable
  - Given TS monorepo에서 `npm run build`를 실행했을 때
  - When dist를 검사하고 설치 패키지로 `orc-camp serve`(또는 default)를 띄우면
  - Then dashboard 정적 자산이 dist에 포함되어 서버가 이를 serve하고, 추가 네트워크 fetch 없이 dashboard가 로드된다(단일 self-contained 패키지).

- **SPEC-700-AC-04** (배포 비기능) — engine floor 신호
  - Given `engines.node` floor 미만의 Node 버전 환경에서
  - When 패키지를 install 또는 실행하면
  - Then engine 불일치가 명확히 표면화된다(npm `EBADENGINE` warn 또는 런타임 guard 메시지). (floor 값은 가설 — §6 Q3.)

- **SPEC-700-AC-05** (D-009 license 게이트) — tarball에 asset 0개
  - Given manifest `license`의 한 필드 이상이 `"unknown"`인 상태에서
  - When `npm pack`으로 tarball을 산출해 검사하면(`gate:license`)
  - Then tarball에 `asset-packs/` 경로 파일·`.png`/`.zip` asset이 **0개**이고, 위반 시 게이트가 FAIL이 되어 릴리스가 차단된다.

- **SPEC-700-AC-06** (D-009, R-UI-006) — asset 없이 placeholder 부팅
  - Given asset pack이 번들되지 않은 설치 패키지(`manifest == null`)에서
  - When dashboard가 camp detail을 렌더하면
  - Then 모든 orc가 placeholder로 동일 layout/interaction을 유지하며 렌더된다([[SPEC-300-asset-rendering]] §3.8 / SPEC-300-AC-13 연계).

- **SPEC-700-AC-07** (D-009) — 번들 활성은 license 확정에 종속
  - Given manifest `license` 세 필드가 모두 `"unknown"`이 아닌 허용 값으로 확정되기 전에
  - When asset를 published artifact에 포함하려는 build를 시도하면
  - Then 게이트가 이를 거부한다(`bundleAssets=false` 강제). 세 필드가 허용 값으로 확정된 뒤에만 `bundleAssets=true`로 포함이 가능하다(§2.7).

- **SPEC-700-AC-08** (R-CLI-005 depth, R-OBS-004) — install-health 값
  - Given 임의의 설치 환경에서
  - When `orc-camp doctor --json`을 실행하면
  - Then 진단 결과에 `appVersion`·`nodeVersion`·`nodeFloor`·`os`·`arch`·`tmuxVersion`과 install 무결성(`binResolved`·`dashboardAssetsPresent`·`assetPackBundled`) 값이 포함된다(command surface/exit은 [[SPEC-100-server-lifecycle]], block struct는 [[SPEC-600-observability]] 소유).

- **SPEC-700-AC-09** (R-CLI-005 depth) — node floor 경고
  - Given 현재 Node 버전이 선언된 `engines` floor 미만인 환경에서
  - When `orc-camp doctor`를 실행하면
  - Then `nodeFloorSatisfied == false`가 산출되고 명시 경고가 표기된다(exit 기여 여부는 SPEC-100 doctor surface와 조정, §6 C1).

- **SPEC-700-AC-10** (배포 비기능) — uninstall 잔존 정책
  - Given 설치·실행으로 configDir/stateDir가 생성된 상태에서
  - When `npm uninstall -g`로 패키지를 제거하면
  - Then 패키지 dist/bin은 제거되지만 configDir(`config.json`)와 stateDir(debug log)는 보존된다(의도된 정책, §2.6).

- **SPEC-700-AC-11** (배포 비기능) — 명시 purge
  - Given configDir/stateDir에 user data가 있는 설치 상태에서
  - When purge command(이름 가설 `orc-camp purge`)를 실행하면
  - Then configDir + stateDir(config·debug log·P1 db)가 제거되어 잔존물이 없으며(검증 가능), purge→uninstall 순서가 문서화돼 있다.

- **SPEC-700-AC-12** (R-CLI-007 참조, [[SPEC-006-privacy-redaction]]) — 잔존물에 secret 없음
  - Given 설치 패키지가 실행되어 token을 발급하고 debug log를 남긴 뒤 uninstall한 환경에서
  - When configDir·stateDir·설치 경로를 startup token literal과 terminal 원문 패턴으로 검사하면
  - Then 어디에서도 token·terminal 원문이 발견되지 않는다(token 메모리 전용·output 비저장, 불변식 ③).

- **SPEC-700-AC-13** (R-SEC-001/002/004, [[08-Decisions|D-003]]) — secure-default 보존
  - Given published build를 설치해 `orc-camp`(default)를 실행했을 때
  - When 기본 launch를 관측하면
  - Then 서버는 `127.0.0.1`에 bind되고 startup token을 포함한 URL을 출력하며, 비-loopback bind는 `--allow-external` + warning 없이는 불가능하다(배포본이 기본값을 변형하지 않음, [[SPEC-100-server-lifecycle]] 정의 준수).

- **SPEC-700-AC-14** (R-P1-010) — Linux 검증·문서화
  - Given Linux + tmux 환경의 `smoke:linux` job에서
  - When 설치 패키지로 `scan`/`serve`/`doctor`를 실행하면
  - Then 핵심 경로가 동작·기록되고 tmux 호환성 결과가 문서화된다. (MVP에서 Linux smoke 실패는 P1 회귀 신호이며 macOS 릴리스를 hard-block 하지 않는다, §3.4-3.)

- **SPEC-700-AC-15** (배포 비기능, [[SPEC-007-test-validation]]) — CI 게이트 경계
  - Given CI 구성에서
  - When PR merge gate를 평가하면
  - Then merge gate는 [[SPEC-007-test-validation]] U+I+fixture-M(결정적, 라이브 tmux 없음) + `build`/`gate:license`/`gate:artifact`로 구성되고, e2e/smoke(macOS+tmux)·latency·Linux(P1)는 별도 비-게이트 job으로 분리된다.

- **SPEC-700-AC-16** (배포 비기능, [[08-Decisions|D-009]]) — release blocker
  - Given 릴리스를 시도할 때
  - When (a) merge gate 실패, (b) license 게이트 실패(tarball에 asset 존재), (c) artifact allowlist 위반(disallowed path), (d) `bin`/`engines` 누락 중 하나가 발생하면
  - Then 릴리스가 차단된다(어느 하나라도 hard blocker, §2.5).

- **SPEC-700-AC-17** (배포 비기능) — 버전/태그 정합
  - Given 릴리스 시점에
  - When tag와 published `package.json#version`을 비교하면
  - Then tag(`v<version>`)가 published 버전과 일치하고 build 산출물이 그 tag에서 재현된다(버전 체계는 SemVer 가설, §6 Q5).

- **SPEC-700-AC-18** (배포 비기능, [[08-Decisions|D-003]]) — 텔레메트리 없음
  - Given published 패키지를 설치해 launch했을 때
  - When 네트워크 활동을 관측하면
  - Then loopback server 외 어떤 자동 outbound egress(analytics·update check 등)도 발생하지 않는다(local-only, [[SPEC-600-observability]] 불변식 ②).

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| **R-P1-010** (Linux + tmux 검증·문서화) | `smoke:linux` job으로 설치 패키지 검증·tmux 호환성 문서화(P1 advisory) | SPEC-700-AC-14 |
| **배포 비기능** (npm global install 우선) | bin 노출·`files` allowlist·단일 installable build·engine floor·버전/태그·CI 게이트·release blocker | SPEC-700-AC-01, AC-02, AC-03, AC-04, AC-15, AC-16, AC-17 |
| **배포 비기능** (uninstall 후 config/log 잔존 정책) | 잔존 정책 + 명시 purge + secret 무잔존 | SPEC-700-AC-10, AC-11, AC-12 |
| **[[08-Decisions\|D-009]]** (license 게이트) | manifest license 판독 → asset 번들 차단, tarball asset 0개 testable gate, 확정 시 전환 | SPEC-700-AC-05, AC-06, AC-07, AC-16 |
| R-CLI-005 (doctor depth — 소유 [[SPEC-100-server-lifecycle]]) | install-health 값(version/엔진/무결성/asset 탑재) | SPEC-700-AC-08, AC-09 |
| R-CLI-007 (종료 폐기 — 소유 [[SPEC-100-server-lifecycle]]) | 잔존물에 token·원문 없음 보증 | SPEC-700-AC-12 |
| R-SEC-001/002/004 (보안 경계 — 소유 [[SPEC-100-server-lifecycle]]) | 배포본이 loopback·token·외부 bind opt-in 기본값 유지 | SPEC-700-AC-13 |
| R-UI-006 (placeholder parity — 소유 [[SPEC-300-asset-rendering]]) | asset 미번들 배포본에서 placeholder 동작 | SPEC-700-AC-06 |
| [[08-Decisions\|D-003]] (local-first) | secure-default 보존·텔레메트리 없음 | SPEC-700-AC-13, AC-18 |
| [[08-Decisions\|D-004]] (TS monorepo) | monorepo build → 단일 installable | SPEC-700-AC-03 |

> 본 spec이 **R-P1-010**·**배포 비기능**·**[[08-Decisions|D-009]] license 게이트**·**uninstall 잔존 정책**을 1차 소유한다. R-CLI-005/007·R-SEC-001/002/004·R-UI-006은 타 spec(SPEC-100/300/006) 소유이며 본 spec은 배포 관점 depth/보증으로 **참조**한다. 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진/cross-spec 조정 필요)

- **C1 — doctor check 집합 확장 조정**: 본 spec §2.4의 node-floor·install 무결성 신호를 [[SPEC-100-server-lifecycle]]의 **exit-bearing check 집합(현재 5개 고정)**에 추가할지, [[SPEC-600-observability]] `DoctorDiagnostics`의 비-exit diagnostics로만 둘지 조정 필요. SPEC-100 §3.5는 check 항목 집합을 자기 소유로 고정했으므로, 추가 시 SPEC-100 결정으로 승격해야 한다. **검토 필요.**
- **C2 — purge/report flag surface 조정**: §2.6 purge command 이름·surface(`orc-camp purge` vs `doctor --purge`)는 [[SPEC-100-server-lifecycle]] §2.3 flag 집합과 [[SPEC-600-observability]] §2.10 problem-report flag(`--report`)와 함께 정해야 한다. 본 spec은 **동작·잔존 invariant**를 소유하고 정확한 flag 이름은 SPEC-100 확정에 위임한다. **검토 필요.**
- **C3 — [[06-Infra]] 배포/잔존 갱신**: [[SPEC-500-settings-persistence]] §6 C3/Q4가 macOS config path를 XDG-style(`~/.config/orc-camp`)로 결정하며 본 spec(uninstall 잔존)·[[06-Infra]] 갱신을 요청했다. 본 spec §2.6 잔존 정책은 그 경로를 전제로 작성됐으며, [[06-Infra]] "npm only vs Homebrew" Open Question과 함께 orchestrator가 청사진을 정합해야 한다. **검토 필요.**

### Open Questions (가설·정합 대상)

- **Q1 — registry 패키지명**: CLI command는 `orc-camp`(확정, D-001)이나 npm registry 패키지명(`orc-camp` vs `@<org>/orc-camp`)은 가용성 미확인. **검토 필요.**
- **Q2 — bundler·module 시스템·dist 레이아웃**: `tsup`/`esbuild`/Vite-SSR 등 bundler, ESM vs CJS, `dist/` 구조는 가설. monorepo workspace를 bundling vendoring할지 sibling published 의존성으로 둘지 결정 필요. **검토 필요.**
- **Q3 — `engines.node` floor**: Node ≥ 20 LTS는 가설. 의존성 호환·LTS 일정으로 확정. [[SPEC-100-server-lifecycle]] §2.6 `crypto`/`fetch` 요구와 정합. **검토 필요.**
- **Q4 — Linux 지원 승격 시점**: R-P1-010은 검증·문서화(P1 advisory)를 요구한다. Linux를 1급 지원으로 올려 `smoke:linux`를 게이트로 승격할 시점·기준 미정. **검토 필요.**
- **Q5 — 버전 체계**: SemVer(가설) vs CalVer. CHANGELOG/release 자동화 도구 선택과 함께 확정. **검토 필요.**
- **Q6 — license 확정 의존(중요)**: §2.7 `bundleAssets=true` 전환은 PixelLab.ai의 commercial-use·redistribution·attribution 조건 명시 확인에 종속된다(현재 `manifest.json#license`·`LICENSE.md` 모두 TBD/`"unknown"`). 확정 시 [[08-Decisions]] 결정 추가 + 본 spec §2.7 + [[SPEC-300-asset-rendering]] §3.8 + `ATTRIBUTION.md` 갱신이 필요하다. license 미해소가 코드 릴리스를 막지는 않는다(분리, [[08-Decisions|D-007]]). **검토 필요.**
- **Q7 — provenance/signing**: npm `--provenance`·패키지 서명·SBOM 등 공급망 보안은 MVP 범위 밖 후보. standalone binary signing은 [[06-Infra]] 비용 리스크로 pre-flag. **검토 필요.**
