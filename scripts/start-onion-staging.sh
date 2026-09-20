#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "ERROR: set POSTGRES_PASSWORD in the shell before starting MERCORA." >&2
  exit 1
fi

docker compose -f docker-compose.yml -f docker-compose.onion.yml up -d --build

echo "Waiting for the application..."
for _ in {1..30}; do
  if curl --fail --silent http://127.0.0.1:8080/api/healthz >/dev/null; then
    break
  fi
  sleep 2
done

echo "Waiting for Tor..."
for _ in {1..60}; do
  hostname="$(docker compose -f docker-compose.yml -f docker-compose.onion.yml exec -T tor sh -c 'cat /data/mercora/hostname 2>/dev/null || true' | tr -d '\r\n')"
  if [[ "$hostname" == *.onion ]]; then
    echo
    echo "MERCORA Onion staging: $hostname"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Tor did not generate the Onion hostname in the expected time." >&2
docker compose -f docker-compose.yml -f docker-compose.onion.yml logs --tail=100 tor >&2
exit 1
