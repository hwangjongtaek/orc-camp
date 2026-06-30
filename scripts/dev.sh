#!/usr/bin/env bash
#
# Orc Camp local dev orchestrator.
#
# Manages the two processes the dashboard needs:
#   - backend  : `tsx src/main.ts serve` on :4123 (token-gated API/WS, prints boot URL)
#   - frontend : Vite dev server on :5173 (the actual dashboard SPA)
#
# The dashboard only renders from Vite (:5173); the backend (:4123) serves a
# placeholder page. So both must be up. Vite reaches the backend via the
# `?api=` override since vite.config has no proxy. The backend mints a fresh
# in-memory token on every start (never persisted), so a restart always yields
# a new boot URL.
#
# Usage:
#   scripts/dev.sh [restart|start|stop|status|url] [--no-open] [--no-web]
#
#   restart   (default) stop then start both, open the dashboard
#   start     start whatever is down, open the dashboard
#   stop      stop both
#   status    show what is listening + current token URL
#   url       print the current dashboard URL (no restart)
#
#   --no-open   do not launch a browser
#   --no-web    only manage the backend (:4123), leave Vite alone
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT=4123
WEB_PORT=5173
API_HOST=127.0.0.1
SERVE_LOG="$ROOT/.orc-serve.log"
WEB_LOG="$ROOT/.orc-web.log"

cmd="${1:-restart}"; [[ "$cmd" == -* ]] && cmd="restart" || shift || true
OPEN=1; WEB=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    --no-web)  WEB=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# --- helpers ---------------------------------------------------------------

listener_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

stop_port() { # kill the listener on $1 plus its parent (tsx/npm wrapper)
  local port="$1" pid par
  pid="$(listener_pid "$port")" || true
  [[ -z "${pid:-}" ]] && { echo "  :$port already free"; return; }
  par="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  kill "$pid" ${par:+"$par"} 2>/dev/null || true
  for _ in $(seq 1 20); do listener_pid "$port" >/dev/null || break; sleep 0.25; done
  if listener_pid "$port" >/dev/null; then
    kill -9 "$pid" ${par:+"$par"} 2>/dev/null || true; sleep 0.5
  fi
  echo "  :$port stopped (was pid $pid)"
}

wait_listen() { # wait up to ~10s for something to listen on $1
  local port="$1"
  for _ in $(seq 1 40); do listener_pid "$port" >/dev/null && return 0; sleep 0.25; done
  return 1
}

token() { grep -oE 'token=[A-Za-z0-9_-]+' "$SERVE_LOG" 2>/dev/null | tail -1 | cut -d= -f2; }

dash_url() {
  local t; t="$(token)"
  [[ -z "$t" ]] && { echo ""; return; }
  echo "http://localhost:${WEB_PORT}/?token=${t}&api=http://${API_HOST}:${API_PORT}"
}

start_backend() {
  if listener_pid "$API_PORT" >/dev/null; then echo "  backend already on :$API_PORT"; return; fi
  echo "  starting backend on :$API_PORT ..."
  : > "$SERVE_LOG"
  nohup npx tsx src/main.ts serve --no-open >"$SERVE_LOG" 2>&1 &
  disown || true
  wait_listen "$API_PORT" || { echo "  ERROR: backend did not start; see $SERVE_LOG" >&2; tail -5 "$SERVE_LOG" >&2; exit 1; }
  echo "  backend up (pid $(listener_pid "$API_PORT"))"
}

start_web() {
  if listener_pid "$WEB_PORT" >/dev/null; then echo "  Vite already on :$WEB_PORT"; return; fi
  echo "  starting Vite on :$WEB_PORT ..."
  : > "$WEB_LOG"
  ( cd "$ROOT/web" && nohup npx vite --port "$WEB_PORT" --strictPort >"$WEB_LOG" 2>&1 & disown || true )
  wait_listen "$WEB_PORT" || { echo "  ERROR: Vite did not start; see $WEB_LOG" >&2; tail -5 "$WEB_LOG" >&2; exit 1; }
  echo "  Vite up (pid $(listener_pid "$WEB_PORT"))"
}

open_dash() {
  local url; url="$(dash_url)"
  [[ -z "$url" ]] && { echo "  no token yet — backend not up?" >&2; return; }
  echo "  dashboard: $url"
  if [[ "$OPEN" == 1 ]]; then open "$url" && echo "  opened in browser"; fi
}

status() {
  local bp wp; bp="$(listener_pid "$API_PORT" || true)"; wp="$(listener_pid "$WEB_PORT" || true)"
  echo "  backend :$API_PORT  -> ${bp:-down}"
  echo "  Vite    :$WEB_PORT  -> ${wp:-down}"
  local url; url="$(dash_url)"
  echo "  token   : $(token || echo none)"
  if [[ -n "$url" ]]; then echo "  url     : $url"; fi
}

# --- commands --------------------------------------------------------------

case "$cmd" in
  stop)
    echo "stopping:"
    [[ "$WEB" == 1 ]] && stop_port "$WEB_PORT"
    stop_port "$API_PORT"
    ;;
  start)
    echo "starting:"
    start_backend
    [[ "$WEB" == 1 ]] && start_web
    open_dash
    ;;
  restart)
    echo "stopping:"
    [[ "$WEB" == 1 ]] && stop_port "$WEB_PORT"
    stop_port "$API_PORT"
    echo "starting:"
    start_backend
    [[ "$WEB" == 1 ]] && start_web
    open_dash
    ;;
  status) echo "status:"; status ;;
  url)    dash_url ;;
  *) echo "usage: scripts/dev.sh [restart|start|stop|status|url] [--no-open] [--no-web]" >&2; exit 2 ;;
esac
