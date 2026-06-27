# Orc Camp Claude Code Setup

이 디렉토리는 Orc Camp 저장소의 project-scoped Claude Code 설정을 담는다. `.codex/` 설정을 Claude Code 형식으로 변환한 것이다.

## 구성

- `agents/`: product 기획/설계/리뷰 subagent. `.codex/agents/*.toml`을 Claude Code subagent(`*.md` + YAML frontmatter) 형식으로 변환했다.
- `settings.json`: PixelLab MCP 툴 권한. `agent_help`, `delete_animation`은 실행 전 승인을 요구한다(`.codex` config.toml의 `approval_mode = "approve"`에 대응).
- `SUBAGENTS.md`: product subagent 인덱스.

## MCP 서버

MCP 서버는 Claude Code 관례에 따라 저장소 루트의 `.mcp.json`에 정의한다(Codex의 `.codex/config.toml`에 대응). 토큰은 커밋하지 말고 환경변수로 주입하며, `.mcp.json`은 `${VAR}` 형태로 확장한다.

### pixellab

PixelLab AI 픽셀아트 생성 서버. `mcp-remote`로 `https://api.pixellab.ai/mcp`에 연결한다.

- 실제 PixelLab bearer token은 `PIXELLAB_AUTH_HEADER` 환경변수로 주입한다. Claude Code 실행 전 셸에서 설정한다:

  ```sh
  export PIXELLAB_AUTH_HEADER="Bearer <pixellab-token>"
  ```

### github

GitHub 공식 remote MCP 서버. Claude Code 네이티브 HTTP transport로 `https://api.githubcopilot.com/mcp/`에 연결한다.

- GitHub Personal Access Token(PAT)을 `GITHUB_PERSONAL_ACCESS_TOKEN` 환경변수로 주입한다. Claude Code 실행 전 셸에서 설정한다:

  ```sh
  export GITHUB_PERSONAL_ACCESS_TOKEN="<github-pat>"
  ```

- PAT는 필요한 scope(예: `repo`, `read:org`)만 부여한다. 첫 실행 시 Claude Code가 MCP 서버 신뢰 여부를 묻는다.

## `.codex` ↔ `.claude` 매핑

| Codex | Claude Code |
| --- | --- |
| `.codex/config.toml` (`[mcp_servers.pixellab]`) | 루트 `.mcp.json` (`mcpServers.pixellab`) |
| `[mcp_servers.pixellab.tools.*].approval_mode = "approve"` | `.claude/settings.json` → `permissions.ask` |
| `.codex/agents/*.toml` (`developer_instructions`) | `.claude/agents/*.md` (frontmatter + system prompt) |
| `sandbox_mode = "read-only"` | frontmatter `tools:`에서 Edit/Write 제외 |
| `sandbox_mode = "workspace-write"` | tools 미지정(전체 도구 상속) |
| `model_reasoning_effort = "high"` | 세션 모델 상속(별도 매핑 없음) |
