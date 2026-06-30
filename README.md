<p align="center">
  <img src="asset-packs/orc-camp-default/brand/orc-camp-logo-transparent.png" alt="Orc Camp" width="480">
</p>

<p align="center">
  <b>command line 기반 AI agent orchestration 도구</b><br>
  실행 중인 tmux session을 <b>camp</b>로, 그 안의 AI agent session(Claude Code · Codex)을 <b>orc</b>로 시각화한다.
</p>

<p align="center">
  <a href="#설치">설치</a> ·
  <a href="#실행">실행</a> ·
  <a href="#명령어">명령어</a> ·
  <a href="#라이선스">라이선스</a>
</p>

---

# Orc Camp

**Orc Camp**는 여러 개의 AI 코딩 에이전트를 한눈에 관찰하기 위한 **local-first CLI 대시보드**다.
사용자가 이미 실행 중인 **tmux session**을 *camp*로, 각 session 안에서 동작하는 **Claude Code · Codex 등 AI agent terminal session**을 *orc 캐릭터*로 시각화해 — 어떤 에이전트가 일하는 중인지, 무엇을 하고 있는지, 멈춰 있는지 — 픽셀 게임풍 화면에서 한 번에 파악하게 해준다.

모든 동작은 **읽기 전용(read-only)** 이고 **로컬에서만** 실행된다. tmux를 절대 변경하지 않으며, 터미널 원문·경로·secret은 표시 전에 한 곳에서 마스킹되고 디스크에 저장되지 않는다.

## 소개

### 핵심 개념

| 개념 | 의미 |
| --- | --- |
| **Camp** | 하나의 tmux session (프로젝트·작업 묶음·실험 환경) |
| **Orc** | pane/window 안에서 실행 중인 AI agent session (Claude Code · Codex · 기타 CLI agent) |
| **Campfire Dashboard** | `orc-camp` 실행 시 열리는 localhost 웹 대시보드 |
| **Prestige Tier** | 누적 LLM 사용량(또는 세션 수명)이 쌓일수록 orc 외형이 T0→T1→T2→T3로 화려해지는 단계 |

### 주요 기능

- 🔎 **읽기 전용 발견 + 상태 추론** — tmux session/window/pane를 훑어 AI agent를 핑거프린팅하고, `active`/`waiting`/`idle`/`stale`/`error`/`terminated` 상태를 confidence와 함께 추론한다 (상태를 단정하지 않는다).
- 🖥️ **로컬 대시보드** — camp 목록과 orc 상태를 픽셀 맵으로 보여주는 localhost SPA. 127.0.0.1 bind + 1회용 startup token으로 보호된다.
- 🛡️ **privacy-first** — 모든 캡처/명령줄/경로는 소비 전에 redaction을 거치고, 원문은 파일·로그·JSON 어디에도 남지 않는다.
- 🏆 **캐릭터 prestige tier** — orc가 더 많이 일할수록(누적 token, 측정 불가 시 프로세스 uptime) 외형이 단계적으로 강화된다.
- 📦 **런타임 의존성 최소** — CLI/서버는 Node 내장 모듈 + `ws`만 사용한다.

## 요구 사항

- **Node.js ≥ 20** (LTS)
- **tmux** (macOS · Linux) — 관찰 대상. 미설치 시 `orc-camp`는 오류 없이 "tmux 없음"으로 보고한다.
- **git** (소스 설치용)

## 설치

> 아직 npm 레지스트리에 게시 전이다. 현재는 소스에서 설치한다.

```bash
git clone https://github.com/hwangjongtaek/orc-camp.git
cd orc-camp
npm install                      # CLI/서버 의존성
```

대시보드까지 보려면 SPA도 한 번 빌드한다:

```bash
cd web && npm install && npm run build && cd ..
```

(선택) 시스템 전역 `orc-camp` 명령으로 설치:

```bash
npm run build                    # dist/main.js 번들
npm install -g .                 # → 어디서나 `orc-camp` 사용 가능
```

## 실행

가장 빠른 방법은 dev 스크립트다 — `tsx`로 TypeScript를 직접 실행하므로 빌드가 필요 없다.

```bash
# 1) 읽기 전용 발견 (대시보드 없이 터미널에서 바로 확인)
npm run scan                     # 사람용 table 출력
npm run scan -- --json | jq .    # machine-readable JSON
npm run scan -- --watch 3        # 3초 주기 재-scan (--json이면 NDJSON)

# 2) 대시보드 (로컬 서버 + 브라우저 자동 열기)
npm run serve                    # 127.0.0.1 + token URL을 stdout에 출력
npm run serve -- --port 4123 --no-open

# 3) 환경 점검
npm run doctor                   # tmux/Node 등 health 5종 (실패 시 exit 1)
```

전역 설치(`npm install -g .`)했다면 `orc-camp [subcommand]`로 동일하게 실행한다:

```bash
orc-camp            # 기본: 서버 시작 + 대시보드 열기
orc-camp scan       # 읽기 전용 발견
orc-camp doctor     # 환경 점검
```

### 대시보드 개발 (Vite)

UI를 개발할 때는 API 서버와 Vite dev 서버를 함께 띄운다:

```bash
npm run serve                    # 터미널 1: 로컬 API 서버
cd web && npm run dev            # 터미널 2: Vite dev 서버 (HMR)
```

## 명령어

```
orc-camp [serve] [--port <n>] [--host <addr> [--allow-external]] [--no-open] [--json]
orc-camp scan    [--json] [--watch [interval]]
orc-camp doctor  [--json] [--report [path]]
```

| 명령 | 설명 |
| --- | --- |
| `orc-camp` (인자 없음) | 로컬 서버를 띄우고 대시보드를 브라우저로 연다 (기본) |
| `orc-camp serve` | 서버만 실행. 기본 `127.0.0.1` bind, token URL을 stdout에 출력. 외부 bind는 `--allow-external` 필수 |
| `orc-camp scan` | 서버 없이 읽기 전용 발견. `--json`(JSON), `--watch [초]`(주기 재-scan) |
| `orc-camp doctor` | 환경 health 점검. `--json`, `--report [경로]` |

종료 코드: `0` 결과 산출(부분 오류는 진단으로 보고) · `1` 치명적 실패 · `2` 사용법 오류.

## 동작 방식 · 보안

- **read-only 불변식** — tmux 호출은 `list-sessions`/`list-windows`/`list-panes`/`capture-pane`(+`-V`) allowlist로만 이뤄지며 상태 변경 명령은 절대 spawn하지 않는다. 프로세스 조회(`ps`)도 고정 argv·`shell:false`.
- **privacy chokepoint** — 캡처·명령줄·cwd·pane 제목은 소비 전 단일 `redact()` 경계를 통과한다. 원문은 파일/로그/`--json`에 저장되지 않는다.
- **local-first** — 서버는 기본 `127.0.0.1`에만 bind하고 1회용 CSPRNG startup token으로 인증한다. 외부 bind는 명시적 `--allow-external` + 경고가 있어야만 가능하며, 자동 텔레메트리/원격 전송은 없다.

자세한 구현 계약은 `docs/specs/`(구현 SSOT)를 참고한다.

## 캐릭터 prestige tier

orc가 누적해서 더 많은 LLM token/cost를 소비할수록(측정이 어려우면 agent 프로세스 **uptime**으로 대체) 캐릭터의 갑옷·장비·`active` 연출이 **T0 base → T1 → T2 → T3**로 단계적으로 강화된다.

- 5종 캐릭터(`orc-high-warchief-mascot`·`orc-claude-storm-shaman`·`orc-codex-field-engineer`·`orc-unknown`·`orc-iron-commander`)의 **T1은 현재 `available`**(8방향 rotation + idle/active/roaming 애니메이션), **T2·T3는 `staged`**(다음 단계).
- 판정 우선순위는 `누적 토큰 → cost → 프로세스 uptime → base`이며, 모호한 경우 절대 추측하지 않는다.
- 설계 SSOT: `docs/assets/15-Character-State-Model.md` · 런타임 계약: `docs/specs/SPEC-302-mascot-prestige-tiers.md`.

## 문서

- **Specs (구현 SSOT)**: [`docs/specs/`](docs/specs/README.md)
- **Product**: [`docs/product/`](docs/product/) — 요구사항·로드맵·[결정 로그](docs/product/08-Decisions.md)
- **Design**: [디자인 시스템 계약](DESIGN.md) · [`docs/design/`](docs/design/)
- **Assets**: [`docs/assets/`](docs/assets/) — PixelLab prompt·레지스트리·캐릭터 상태 모델

## 라이선스

이 저장소에는 **두 개의 서로 다른 라이선스**가 적용된다.

| 대상 | 라이선스 | 파일 |
| --- | --- | --- |
| **런타임 코드** (`src/`, `web/`, `bin/`, `dist/`) | **MIT** | [`LICENSE`](LICENSE) |
| **픽셀 아트 에셋 팩** (`asset-packs/`) | PixelLab.ai 약관 (**상업 사용·재배포·표기 조건 미확인 / TBD**) | [`asset-packs/orc-camp-default/LICENSE.md`](asset-packs/orc-camp-default/LICENSE.md) |

- MIT 라이선스는 **런타임 코드에만** 적용된다.
- `asset-packs/`의 PixelLab.ai 생성 픽셀 아트는 [PixelLab 서비스 약관](https://pixellab.ai/termsofservice)을 따르며, 상업 사용·재배포·표기 조건이 확정될 때까지 **npm 배포 산출물에 포함하지 않는다**(결정 D-009). 라이선스 확정 전에는 에셋 팩을 제품 워크스페이스 밖으로 공개하지 않는다.
- 대시보드는 에셋이 없어도 placeholder로 동일한 레이아웃·인터랙션을 유지한다.

© 2026 Orc Camp contributors. Licensed under the MIT License.
