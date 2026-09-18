# MERCORA Core Security Model

## Trust boundaries

1. Tor Onion Service boundary
2. Web/application boundary
3. Authentication boundary
4. Marketplace domain boundary
5. Custody boundary
6. Database boundary
7. Administrative boundary

## Security invariants

- Public traffic must not directly reach database, queue, node RPC, storage internals or administrative interfaces.
- Secrets are supplied at runtime, never committed.
- Authentication and authorization are separate checks.
- Every privileged action is deny-by-default.
- User-controlled files are hostile input.
- Payment state is verified server-side and never trusted from the browser.
- Emergency freeze is fail-closed: if its state is uncertain, balance-affecting operations remain blocked.

## Application controls

- Secure session cookies.
- CSRF protection for cookie-authenticated state changes.
- Strict input validation.
- Parameterized database queries/ORM.
- Output encoding and CSP.
- SSRF protections with explicit destination allowlists.
- Upload size/type limits and isolated storage.
- Rate limiting and abuse controls.
- Generic authentication error messages.
- Brute-force and credential-stuffing defenses.
- Audit events for security-sensitive operations.

## Privacy controls

- No third-party analytics or tracking by default.
- Minimal retained application telemetry.
- No unnecessary external resources.
- Random internal identifiers.
- Explicit retention policy for each data class.

A feature is not production-ready until its failure modes, logging behavior, authorization path, dependency risk and recovery procedure have been reviewed.
