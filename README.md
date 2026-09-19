# MERCORA

Privacy-first legal second-hand marketplace designed for Tor Onion Services.

## Canonical architecture

Python/FastAPI application core, PostgreSQL, static web frontend, Nginx local reverse proxy, background workers, and isolated payment/custody services.

The public Onion Service reaches only the reverse proxy. PostgreSQL, wallet/node RPC, storage internals, workers and administrative control paths are not public.

## Security and privacy

- No production wallet keys or signing material in Git, browser, API or admin.
- Pseudonymous accounts with minimized identity data.
- CSRF protection for browser state changes.
- Financial operations fail closed during custody/emergency freezes.
- Append-only double-entry ledger is the accounting source of truth.
- Escrow, disputes, appeals and admin actions are state-machine driven.
- User uploads remain outside the web root.
- Sensitive shipping and messages are encrypted at rest.
- No third-party analytics, trackers or remote fonts by default.

## Development

Run: PYTHONPATH=app python app/migrate.py
Then: uvicorn app.server:app --reload

Real custody activation remains disabled until adapter integration, reconciliation, recovery testing and independent security review.
