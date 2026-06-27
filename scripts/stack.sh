#!/usr/bin/env bash
# Start/stop the local LIVE stack for the Noita wand-assistant:
#   • the file-watch bridge  — node bridge/watch.mjs        → ws://localhost:8787
#   • the Vite dev server    — VITE_LIVE=1 npm run dev       → http://localhost:5173
#
# Native (not Docker) on purpose: the bridge watches the HOST's Noita snapshot.json
# (chokidar/inotify across a bind mount is flaky), and Vite needs HMR + a real browser
# — both fight a container. Pure-Lua/Node, so this just supervises two processes.
#
#   scripts/stack.sh start | stop | restart | status | logs
#
# Override the watched snapshot per-OS (Proton/Steam paths differ; the bridge has a
# sane Linux default): WAND_SNAPSHOT=/path/to/snapshot.json scripts/stack.sh start
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.stack" # pidfiles + logs (gitignored)
mkdir -p "$RUN_DIR"

declare -A LOG=( [bridge]="$RUN_DIR/bridge.log" [dev]="$RUN_DIR/dev.log" )
declare -A PID=( [bridge]="$RUN_DIR/bridge.pid" [dev]="$RUN_DIR/dev.pid" )
declare -A PORT=( [bridge]="${WAND_BRIDGE_PORT:-8787}" [dev]=5173 )
# Unique process-command patterns — the robust fallback for stop().
declare -A PAT=( [bridge]="bridge/watch.mjs" [dev]="node_modules/.bin/vite" )

alive() { [ -f "${PID[$1]}" ] && kill -0 "$(cat "${PID[$1]}" 2>/dev/null)" 2>/dev/null; }
port_up() { command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":${PORT[$1]}\b"; }

start_one() { # name  cmd...
  local n="$1"; shift
  if alive "$n"; then echo "•  $n already running (pid $(cat "${PID[$n]}"))"; return; fi
  # setsid → own process group, so stop can nuke npm AND its node child in one shot.
  ( cd "$ROOT" && setsid "$@" >"${LOG[$n]}" 2>&1 & echo $! >"${PID[$n]}" )
  sleep 0.4
  if alive "$n"; then echo "✓  $n started (pid $(cat "${PID[$n]}")) → ${LOG[$n]}"
  else echo "✗  $n failed — last log lines:"; tail -n 6 "${LOG[$n]}" 2>/dev/null; fi
}

stop_one() { # name
  local n="$1" pid
  if [ -f "${PID[$n]}" ]; then
    pid="$(cat "${PID[$n]}" 2>/dev/null || true)"
    [ -n "${pid:-}" ] && { kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; }
    rm -f "${PID[$n]}"
  fi
  pkill -f "${PAT[$n]}" 2>/dev/null || true # fallback: catch any stray child
  echo "✓  $n stopped"
}

case "${1:-}" in
  start)
    start_one bridge npm run bridge
    start_one dev env VITE_LIVE=1 npm run dev
    echo "→  bridge ws://localhost:${PORT[bridge]}   app http://localhost:${PORT[dev]}"
    ;;
  stop)
    stop_one dev; stop_one bridge
    ;;
  restart)
    "$0" stop; sleep 0.5; "$0" start
    ;;
  status)
    for n in bridge dev; do
      printf '%-7s ' "$n:"
      if alive "$n"; then printf 'running (pid %s)' "$(cat "${PID[$n]}")"; else printf 'stopped'; fi
      port_up "$n" && printf '  · port %s UP\n' "${PORT[$n]}" || printf '  · port %s free\n' "${PORT[$n]}"
    done
    ;;
  logs)
    echo "tailing ${LOG[bridge]} + ${LOG[dev]} (Ctrl-C to stop)"; tail -n 20 -f "${LOG[bridge]}" "${LOG[dev]}"
    ;;
  *)
    echo "usage: scripts/stack.sh {start|stop|restart|status|logs}"; exit 2
    ;;
esac
