# MERCORA Core Roadmap

## Current foundation

- Secure repository baseline.
- Threat model and security invariants.
- Custodial ledger design for BTC, XMR and LTC.
- Emergency custody design.
- Static dark marketplace shell.
- Local Node web server bound to `127.0.0.1:8080`.
- Initial non-root container image.
- CI syntax and secret-material checks.

## Next implementation sequence

1. PostgreSQL connection layer and migrations runner.
2. Authentication service with password hashing and session rotation.
3. Account authorization and admin separation.
4. Listing/catalog persistence.
5. Cart/order state machine.
6. Marketplace abuse controls.
7. Payment adapter contracts.
8. Blockchain observer interfaces.
9. Custody service isolation and signing boundary.
10. Emergency freeze/reconciliation workflow.
11. Tor deployment hardening and operational runbook.
12. Automated security regression suite.

Real production wallet integration remains disabled until custody invariants, reconciliation, recovery and security review are validated.
