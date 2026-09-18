# MERCORA

Privacy-first second-hand marketplace designed for Tor Onion Services.

## Security directive

Optimize MERCORA for the maximum technically achievable level of security, privacy, availability, attack resistance, and infrastructure protection. Do not sacrifice security for simplicity, cost, or speed.

## Architecture goals

- Tor Onion Service v3 at the edge.
- Application bound to a private/local interface.
- Security-first web application architecture.
- PostgreSQL for persistent data.
- Containerized deployment with Docker.
- Modular payment adapters for BTC, LTC and XMR.
- No secrets, wallet keys, seeds, tokens, or credentials in source control.
- Minimal data collection and minimal application logging.
- Security testing aligned with OWASP ASVS.
- CI/CD with dependency and security checks.

## Initial development scope

1. Secure project foundation.
2. Dark premium marketplace UI.
3. Authentication and pseudonymous accounts.
4. Catalog, search, product pages and seller profiles.
5. Cart and order lifecycle.
6. Payment abstraction layer.
7. Moderation and abuse controls.
8. Tor deployment and hardening.
9. Automated testing and security verification.
10. Production deployment documentation.

## Security notes

The Onion Service private keys are highly sensitive and must never be committed to this repository.

Security claims must be evidence-based. MERCORA does not claim absolute or perfect anonymity/security; controls are designed to minimize attack surface and reduce the impact of failures.
