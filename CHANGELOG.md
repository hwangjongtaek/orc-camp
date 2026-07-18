# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를
따르며, 버전 체계는 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.

> **범위**: 이 CHANGELOG는 **런타임 코드**(`src/`, `web/`, `bin/`, `dist/`; MIT)의 릴리스를 기록한다.
> `asset-packs/`의 픽셀 아트는 별도 라이선스(PixelLab.ai 약관)이며 published npm 산출물에 포함되지 않는다(D-009).

## [Unreleased]

## [0.1.0] - 2026-07-18

첫 공개 릴리스. 실행 중인 tmux session을 *camp*로, 그 안의 AI agent session(Claude Code · Codex)을
*orc*로 시각화하는 **read-only · local-first CLI 대시보드**.

### Added

- **읽기 전용 발견 (`orc-camp scan`)** — tmux session/window/pane inventory를 allowlist 명령
  (`list-sessions`/`list-windows`/`list-panes`/`capture-pane`)으로만 훑고, Claude Code · Codex agent를
  Tier A→B→C로 핑거프린팅한다. `--json`(machine-readable) · `--watch [초]`(주기 재-scan) 지원.
- **상태 추론** — `active`/`waiting`/`idle`/`stale`/`error`/`terminated`를 confidence와 함께 추론하고,
  모호하면 단정하지 않는다. `active`는 agent 프로세스 liveness로 게이트한다.
- **로컬 대시보드 서버 (`orc-camp serve` / 기본 실행)** — 기본 `127.0.0.1` bind + 1회용 CSPRNG startup
  token URL. snapshot REST API + WebSocket 실시간 델타 + 라이브 pane 스트림, 외부 bind는 `--allow-external`
  opt-in(+경고), Host-header(DNS rebinding) 방어 · timing-safe 인증.
- **Campfire 대시보드 SPA** — camp 목록/상세, 픽셀 게임풍 camp 맵(공간 배치·drag-pan), orc sprite
  상태 애니메이션 · prestige tier, reduced-motion 대응. 에셋이 없어도 placeholder로 동일 layout/interaction 유지.
- **Terminal Workspace** — camp 상세의 map ↔ terminal 모드 전환, xterm 라이브 스트림(styled SGR 재조립),
  orc rail · 퀵스위처, 관전/조종(arm/disarm) · composed input(Enter 전송).
- **제어 액션** — text input(`/input`) · key(`KEY_ALLOWLIST`) · interrupt(이중 confirm 게이트). 실행 직전
  fresh read-only 재검증, `controlExec` single-writer(`shell:false`), 모든 endpoint startup token 인증.
- **command broadcast** — 단일 camp 내 다중 orc에 composed-input을 단일 confirm으로 순차 전송(중복 de-dup ·
  best-effort 집계).
- **저지연 control-mode bridge** (opt-in, 기본 off) — tmux control-mode `%output` dirty-signal 기반 저지연
  트리거. 미지원/실패 시 SPEC-103 폴링으로 투명하게 fallback.
- **privacy-first redaction** — 모든 캡처/명령줄/경로/pane 제목은 소비 전 단일 `redact()` 경계를 통과하며,
  원문은 파일 · 로그 · `--json` 어디에도 저장하지 않는다. 라이브/styled 스트림도 egress 전에 redaction.
- **설정 지속화 (`orc-camp` config)** — scan interval · preview 노출 토글 · redaction floor-lock 등 preference를
  XDG 경로에 atomic write. secret/output/summary는 비저장.
- **관측성 · 진단 (`orc-camp doctor`)** — tmux/포트/config·log 경로 등 환경 health 5종 + install-health
  (node floor · bin 해석 · dashboard 자산 · asset-pack 탑재 여부) · bridge capability. `--json` · `--report`.
- **패키징 — 단일 self-contained installable** — `npm run build`가 CLI · 로컬 서버(`dist/main.js`)와
  대시보드 SPA(`dist/dashboard/`)를 하나의 산출물로 만들고, 서버가 대시보드를 직접 serve한다. 전역 설치 후
  추가 네트워크 fetch 없이 동작.
- **`orc-camp purge`** — 로컬 config · log 데이터 제거(기본 dry-run, `--yes`로 삭제, HOME/root 안전가드).
  uninstall은 user data를 보존하므로 완전 제거 시 uninstall 전에 실행한다.
- **release 게이트** — `prepublishOnly`가 build + tarball 게이트를 강제한다: asset-pack license가 확정되기
  전(D-009)까지 tarball에 asset(PNG/zip) 0개, `files` allowlist 위반(`src`/`tests`/`docs`/secret) 0개.

### Security

- 기본값 secure-by-default: loopback bind · 1회용 token · 외부 bind opt-in. 자동 텔레메트리/원격 전송 없음.
- read-only 불변식: 상태 변경 tmux 명령을 spawn하지 않으며, 프로세스 조회도 고정 argv·`shell:false`.
- 비-영속 잔존 없음: startup token은 메모리 전용, terminal 원문은 비저장 — uninstall 잔존물에 secret/원문 없음.

[Unreleased]: https://github.com/hwangjongtaek/orc-camp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hwangjongtaek/orc-camp/releases/tag/v0.1.0
