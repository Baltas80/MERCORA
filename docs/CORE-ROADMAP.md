# MERCORA Core Roadmap

## Current foundation

- Secure repository baseline.
- Threat model and security invariants.
- Custodial ledger design for BTC, XMR and LTC.
- Executable custody contracts for payment adapters, blockchain observers and signing boundary.
- Withdrawal and confirmation state machines.
- Deposit-address and reconciliation operational schema.
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
7. Payment policy engine and limits.
8. Production payment adapters behind the isolated custody boundary.
9. Blockchain observer services and redundancy.
10. Custody reconciliation and audit automation.
11. Emergency freeze/reconciliation workflow.
12. Tor deployment hardening and operational runbook.
13. Automated security regression suite.

Real production wallet integration remains disabled until custody invariants, reconciliation, recovery and security review are validated.
