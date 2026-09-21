#!/usr/bin/env bash
set -euo pipefail

# MERCORA local/staging service manager for WSL.
# This script intentionally exposes only fixed, allow-listed operations.
# It is not a replacement for production orchestration.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${MERCORA_PID_FILE:-${ROOT}/.runtime/mercora.pid}"
LOG_FILE="${MERCORA_LOG_FILE:-${ROOT}/.runtime/mercora.log}"
HOST="${MERCORA_HOST:-127.0.0.1}"
PORT="${MERCORA_PORT:-8080}"
HEALTH_URL="http://${HOST}:${PORT}/api/healthz"

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

status() {
  if is_running; then
    echo "running"
    return 0
  fi
  echo "stopped"
  return 1
}

health() {
  curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null
}

start() {
  if is_running; then
    echo "MERCORA is already running."
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is not installed or not on PATH." >&2
    return 1
  fi

  if [[ ! -f "${ROOT}/server/server.js" ]]; then
    echo "ERROR: MERCORA server entrypoint is missing." >&2
    return 1
  fi

  nohup env HOST="$HOST" PORT="$PORT" node "${ROOT}/server/server.js" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"

  for _ in {1..20}; do
    if health; then
      echo "MERCORA started successfully (PID ${pid})."
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "ERROR: MERCORA exited during startup. See ${LOG_FILE}." >&2
      return 1
    fi
    sleep 0.5
  done

  echo "ERROR: MERCORA did not become healthy within the startup window." >&2
  return 1
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "MERCORA is already stopped."
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill -TERM "$pid"

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "MERCORA stopped."
      return 0
    fi
    sleep 0.5
  done

  echo "ERROR: MERCORA did not stop gracefully; refusing automatic SIGKILL." >&2
  return 1
}

restart() {
  stop
  start
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) restart ;;
  status) status ;;
  health) health ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|health}" >&2
    exit 2
    ;;
esac
