# MERCORA threat model

## Assets

- Account credentials and recovery material.
- Marketplace account state, listings and orders.
- Private messages.
- Payment state and transaction metadata.
- Onion Service identity material.
- Database and backups.
- Administrative credentials.

## Primary threats

### Application
- SQL injection and ORM/query abuse.
- XSS and unsafe rendered content.
- CSRF and session attacks.
- SSRF and unsafe URL fetching.
- Path traversal and unsafe file handling.
- Broken authentication/authorization.
- Account takeover and credential stuffing.
- Resource exhaustion and abusive automation.

### Infrastructure
- Compromise of the host.
- Container escape or excessive container privileges.
- Dependency/supply-chain compromise.
- Secret leakage.
- Database exposure.
- Backup compromise.
- Misconfiguration exposing the origin service.

### Tor-specific
- Accidental publication of the origin address.
- Unsafe external resources causing information leakage.
- Fingerprinting through application behavior, headers, assets, or timing.
- Compromise or loss of Onion Service key material.

### Marketplace abuse
- Spam and malicious listings.
- Malicious uploads.
- Fake reviews and reputation manipulation.
- Payment-state manipulation.
- Race conditions in inventory/order transitions.

## Security controls

Controls are layered. No single control is treated as sufficient.

- Least privilege everywhere.
- Private network boundaries between services.
- Strong authentication and session management.
- Central authorization checks.
- Input/output validation.
- CSP and security headers.
- Rate limits and bounded resource usage.
- Secure file processing.
- Dependency pinning and automated scanning.
- Secret scanning in CI.
- SAST and tests on every change.
- Encrypted backups with restoration tests.
- Security logging that minimizes sensitive data.
- Administrative isolation.
- Regular threat-model updates.

## Acceptance rule

A feature is not production-ready merely because the happy path works. Abuse cases, failure modes, authorization boundaries, privacy implications, and recovery behavior must be tested.
