# MERCORA canonical architecture

## Decision

MERCORA uses FastAPI/Python as the application core. PostgreSQL is the transactional source of truth. The browser is a static web client. Nginx is the only HTTP component directly behind the Onion Service.

## Trust boundaries

Tor -> Nginx -> FastAPI -> PostgreSQL
                         -> Worker
                         -> isolated payment/observer services
                         -> private object storage

Wallet/node RPC and signing authority are never exposed to FastAPI or the browser.

## State and accounting

Orders, payments, escrow, disputes, payouts and withdrawals use explicit state transitions. Money-like values use integer atomic units. The accounting layer is append-only double-entry and corrections are compensating entries.

## Failure rules

Unknown financial state blocks new balance-affecting operations. Reconciliation mismatches block financial reopening. Missing recovery, backup or key material never causes the application to fabricate a successful result.

## Privacy

Marketplace accounts are pseudonymous by default. Shipping and message contents are stored encrypted. Logs must avoid credentials, session tokens, private keys and unnecessary metadata. No third-party trackers or remote resources are used by default.

## Production gates

Production requires successful migration smoke tests, unit/integration tests, concurrency tests, DAST, dependency/container scanning, backup restoration tests, Tor origin-leak testing, custody review and legal review.
