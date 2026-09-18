# MERCORA Security Baseline

## Security objectives

MERCORA is developed under a security-first model. Security, privacy, integrity and availability take precedence over implementation speed.

## Baseline controls

- Threat modeling before exposing new trust boundaries.
- Strong authentication and authorization separation.
- Server-side input validation.
- Parameterized database access.
- CSRF protection where applicable.
- Output encoding and XSS defenses.
- SSRF protections for any server-side fetch functionality.
- Strict upload validation and resource limits.
- Rate limiting and abuse controls.
- Secure session lifecycle.
- Security headers and restrictive Content Security Policy.
- Dependency pinning and vulnerability scanning.
- Secret scanning.
- Automated tests and security regression tests.
- Minimal sensitive logging.
- Encrypted backups.
- Administrative access isolated from public marketplace functions.

## Tor

The production service should use a Tor v3 Onion Service. Onion service private keys must remain outside source control and outside application containers where possible. Tor documentation notes that leaked service keys can allow impersonation/compromise of the Onion Service.

## Verification

Use OWASP ASVS as the application-security verification baseline and track requirements as implementation progresses.

## Incident response

Every production component must have a defined failure mode, monitoring signal, containment action, recovery procedure and rollback path.
