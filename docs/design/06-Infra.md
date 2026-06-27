# 06 Infra

## 운영 모델

Orc Camp MVP는 local-first desktop developer tool이다. 별도 cloud infrastructure 없이 사용자의 machine에서 CLI process, local server, web dashboard가 함께 동작한다.

```text
User Shell
  orc-camp CLI
    Local HTTP/WebSocket Server
    Tmux Scanner
    Static Dashboard Assets
  tmux server
    sessions/windows/panes
```

## 실행 방식

- `orc-camp`: local server를 시작하고 browser를 연다.
- `orc-camp serve`: browser open 없이 server만 시작한다.
- `orc-camp scan`: tmux detection 결과를 CLI에 출력한다.
- `orc-camp doctor`: tmux 설치, 권한, port, config 상태를 점검한다.

## 네트워크

- 기본 bind address: `127.0.0.1`
- port: 기본 preferred port를 시도하고 충돌 시 ephemeral port 사용
- dashboard URL은 startup token을 포함한다.
- remote access는 MVP 비목표이며, 향후 SSH tunnel 기반 opt-in으로 검토한다.

## 배포

### MVP 후보

- npm package: `npm install -g orc-camp`
- standalone binary는 P1에서 검토

### Asset 배포

- dashboard static bundle에 placeholder pixel asset 포함
- PixelLab.ai asset은 license 확인 후 package asset으로 포함
- asset pack은 versioned manifest를 가진다.
- PixelLab.ai 산출물은 [[11-PixelLab-Asset-Setup]] 기준의 `manifest.json`, `palette.json`, license/attribution, generation metadata와 함께 보관한다.
- license 또는 redistribution 조건이 불명확한 asset은 npm package에 포함하지 않는다.

## 관측성

- local log file: scanner error, API error, control action result
- dashboard activity log: 사용자에게 보여줄 수 있는 event 중심
- debug mode: tmux raw command와 timing 출력
- sensitive output은 debug log에 기본 저장하지 않는다.

## 신뢰성

- tmux command는 timeout과 retry 제한을 둔다.
- scanner failure는 마지막 정상 snapshot을 유지하되 stale 표시를 한다.
- WebSocket 끊김 시 frontend는 REST snapshot으로 복구한다.
- process 종료 시 port와 token은 폐기된다.

## 보안

- local token required for state-changing APIs
- external bind는 warning과 explicit flag 필요
- terminal preview redaction 기본 활성화
- control action audit event를 local memory에 기록
- destructive action에는 confirm modal required
- control action 직전 tmux target 재검증

## 비용

- MVP 운영 비용은 사용자 local machine resource로 제한된다.
- cloud backend가 없으므로 서버 비용은 없다.
- 비용 리스크는 PixelLab.ai asset 생성/라이선스와 packaging/signing에 있다.

## 호환성

- macOS + tmux를 우선 지원한다.
- Linux는 tmux command 호환성 기준으로 P1에 검증한다.
- Windows native는 비목표이며 WSL + tmux 조합을 문서화할 수 있다.

## Open Questions

- npm package만으로 충분한지, Homebrew formula가 early adopter에게 더 나은지 검증이 필요하다.
- browser auto-open은 CLI 환경마다 다르므로 fallback URL 출력이 필요하다.
- local config path를 XDG 기준으로 둘지 OS별 app config directory로 둘지 결정해야 한다.
