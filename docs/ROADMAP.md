# MERCORA roadmap

## Canonical implementation status

### Application core
- [x] FastAPI/Python canonical backend
- [x] PostgreSQL versioned migration runner
- [x] Password hashing and opaque sessions
- [x] Recovery codes
- [x] CSRF protection
- [x] RBAC foundation and high-risk approval model
- [x] Pseudonymous accounts
- [x] Listings, categories, search, cart and checkout
- [x] Inventory row-lock reservation
- [x] Buyer/seller fees with immutable order snapshots
- [x] Seller stores and promotion codes
- [x] Favorites
- [x] Reviews and reports
- [x] Encrypted shipping records
- [x] Encrypted messaging and notifications

### Payments / financial controls
- [x] Payment-intent state machine
- [x] Server-authenticated payment event ingress
- [x] Escrow state foundation
- [x] Append-only double-entry ledger
- [x] Withdrawal request + ledger reservation
- [x] Seller payout request and risk gate
- [x] Reconciliation records and fail-closed emergency mode
- [x] Emergency freeze / guarded clear
- [ ] Real BTC/LTC/XMR blockchain adapters
- [ ] Isolated signing service / HSM or KMS
- [ ] Automated on-chain observer reconciliation
- [ ] Production custody authorization

### Disputes / moderation
- [x] Dispute state machine
- [x] Evidence storage quarantine
- [x] Encrypted dispute messages
- [x] Decisions and appeals
- [x] Moderation actions and reporting
- [ ] Production malware scanning service
- [ ] Full moderation queue UI
- [ ] Automated abuse scoring and anti-collusion

### Infrastructure
- [x] Nginx reverse proxy
- [x] Docker non-root application
- [x] Container hardening baseline
- [x] Tor v3 configuration template
- [x] Background worker
- [x] Outbox/job foundation
- [ ] Production Tor deployment + origin-leak test
- [ ] Centralized monitoring/alerting
- [ ] Tested encrypted backups and restore
- [ ] Resource/load limits validated under load

### Security validation
- [x] Secret scan baseline
- [x] CodeQL baseline
- [x] Dependency audit
- [x] Migration smoke tests
- [x] HTTP security smoke test
- [x] Inventory concurrency test
- [ ] DAST
- [ ] Container vulnerability scan
- [ ] Full ASVS verification
- [ ] Independent custody/security review
- [ ] Independent legal review

Real funds remain disabled until every financial production gate is satisfied.
