#!/usr/bin/env bash
set -euo pipefail

# Controlled WSL Tor process manager for the MERCORA staging Onion Service.
# It never creates or replaces the Onion Service identity keys.

TOR_USER="${MERCORA_TOR_USER:-debian-tor}"
TOR_CONFIG="${MERCORA_TOR_CONFIG:-/etc/tor/torrc.d/mercora.conf}"
PID_FILE="${MERCORA_TOR_PID_FILE:-${HOME}/.mercora/tor.pid}"
LOG_FILE="${MERCORA_TOR_LOG_FILE:-${HOME}/.mercora/tor.log}"

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

validate() {
  command -v tor >/dev/null 2>&1 || { echo "ERROR: tor is not installed." >&2; return 1; }
  id "$TOR_USER" >/dev/null 2>&1 || { echo "ERROR: Tor user '$TOR_USER' does not exist." >&2; return 1; }
  [[ -f "$TOR_CONFIG" ]] || { echo "ERROR: Tor config '$TOR_CONFIG' does not exist." >&2; return 1; }
  sudo tor --verify-config -f "$TOR_CONFIG"
}

start() {
  if is_running; then
    echo "Tor is already running."
    return 0
  fi

  validate
  nohup sudo -u "$TOR_USER" tor -f "$TOR_CONFIG" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    echo "Tor started successfully (PID ${pid})."
    return 0
  fi

  rm -f "$PID_FILE"
  echo "ERROR: Tor exited during startup. See ${LOG_FILE}." >&2
  return 1
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Tor is already stopped."
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill -TERM "$pid"

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Tor stopped."
      return 0
    fi
    sleep 0.5
  done

  echo "ERROR: Tor did not stop gracefully; refusing automatic SIGKILL." >&2
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
  validate) validate ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|validate}" >&2
    exit 2
    ;;
esac
