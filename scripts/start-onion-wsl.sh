#!/usr/bin/env bash
set -euo pipefail

# Local WSL launcher for the MERCORA Onion Service.
# This path is for development/staging only; it does not replace the
# containerized staging/production deployment.

TOR_USER="debian-tor"
TOR_CONFIG="/etc/tor/torrc.d/mercora.conf"
SERVICE_DIR="/var/lib/tor/mercora"
APP_HOST="127.0.0.1"
APP_PORT="8080"

if ! command -v tor >/dev/null 2>&1; then
  echo "ERROR: Tor is not installed." >&2
  exit 1
fi

if ! id "$TOR_USER" >/dev/null 2>&1; then
  echo "ERROR: Tor service user '$TOR_USER' does not exist." >&2
  exit 1
fi

if ! curl --fail --silent --show-error "http://${APP_HOST}:${APP_PORT}/api/healthz" >/dev/null; then
  echo "ERROR: MERCORA is not responding on http://${APP_HOST}:${APP_PORT}." >&2
  echo "Start the application first (for example: npm start)." >&2
  exit 1
fi

sudo install -d -o "$TOR_USER" -g "$TOR_USER" -m 700 "$SERVICE_DIR"

sudo tee "$TOR_CONFIG" >/dev/null <<EOF
SocksPort 0
ControlPort 0
SafeLogging 1
Log notice stdout

HiddenServiceDir ${SERVICE_DIR}
HiddenServiceVersion 3
HiddenServicePort 80 ${APP_HOST}:${APP_PORT}
EOF

sudo chown "$TOR_USER:$TOR_USER" "$SERVICE_DIR"
sudo chmod 700 "$SERVICE_DIR"

if pgrep -u "$TOR_USER" -x tor >/dev/null 2>&1; then
  echo "ERROR: Tor is already running as $TOR_USER. Stop the existing instance before using this launcher." >&2
  exit 1
fi

echo "Validating Tor configuration..."
sudo tor --verify-config -f "$TOR_CONFIG"

echo "Starting MERCORA Onion Service..."
exec sudo -u "$TOR_USER" tor -f "$TOR_CONFIG"
