# MERCORA roadmap

## Phase 0 — Foundation
- [x] Secure repository baseline
- [x] Security-first architecture
- [x] Initial threat model
- [x] Initial CI security/repository gates
- [x] Dependency policy

## Phase 1 — Application core
- [ ] Frontend shell and dark marketplace UI
- [x] Backend API skeleton
- [x] PostgreSQL schema and migrations
- [x] Authentication and sessions
- [x] Initial authorization model

## Phase 2 — Marketplace
- [ ] Seller profiles
- [ ] Listings and categories
- [ ] Search and filtering
- [ ] Cart and checkout
- [x] Orders and inventory foundation
- [ ] Ratings/reputation
- [ ] Moderation and reporting
- [ ] Messaging

## Phase 3 — Payments and settlement
- [x] Payment adapter interface
- [ ] Bitcoin integration
- [ ] Litecoin integration
- [ ] Monero integration
- [ ] Lightning integration
- [x] Payment confirmation/state-machine foundation
- [x] Seller escrow policy and ledger foundation
- [ ] Transactional payment-confirmed -> escrow creation flow
- [ ] Reconciliation and audit controls
- [ ] Seller balance ledger and payout service

## Phase 4 — Tor and infrastructure
- [ ] Hardened Onion Service deployment
- [ ] Reverse proxy isolation
- [ ] Container hardening
- [ ] Resource limits
- [ ] Backup/restore procedure
- [ ] Monitoring and health checks

## Phase 5 — Security validation
- [ ] SAST
- [ ] Dependency scanning
- [ ] Secret scanning
- [ ] DAST
- [ ] Authentication/authorization abuse tests
- [ ] Resource exhaustion tests
- [ ] Escrow concurrency/idempotency tests
- [ ] Tor-specific privacy review
- [ ] Production readiness review
