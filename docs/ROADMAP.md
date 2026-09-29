# MERCORA roadmap

## Phase 0 — Foundation
- [x] Secure repository baseline
- [x] Security-first architecture
- [x] Initial threat model
- [x] Initial CI security gates
- [x] Initial dependency policy/documentation

## Phase 1 — Application core
- [x] Frontend shell and dark marketplace UI
- [x] Backend API skeleton
- [x] PostgreSQL schema and migrations foundation
- [x] Password hashing utility
- [ ] Authentication and sessions
- [ ] Authorization model

## Phase 2 — Marketplace
- [x] Initial marketplace domain schema
- [ ] Seller profiles
- [ ] Listings and categories API
- [ ] Search and filtering API
- [ ] Cart and checkout backend
- [ ] Orders and inventory state machine
- [ ] Ratings/reputation
- [ ] Moderation and reporting
- [ ] Messaging

## Phase 3 — Payments
- [x] Custody architecture and ledger design
- [x] Emergency custody model
- [x] Payment adapter interface and validation contracts
- [x] Blockchain observer contract
- [x] Withdrawal/confirmation state machine
- [x] Deposit-address and reconciliation schema
- [x] Withdrawal policy and limits contract
- [ ] Bitcoin integration
- [ ] Litecoin integration
- [ ] Monero integration
- [ ] Confirmation/reconciliation automation
- [ ] Independent custody security review

## Phase 4 — Tor and infrastructure
- [x] Initial Onion Service configuration template
- [x] Application loopback binding
- [x] Initial non-root container image
- [ ] Hardened Onion Service deployment
- [ ] Reverse proxy isolation
- [ ] Resource limits
- [ ] Backup/restore procedure
- [ ] Monitoring and health checks

## Phase 5 — Security validation
- [x] Basic secret-material CI gate
- [x] Basic syntax CI gate
- [x] Unit-test CI hook
- [ ] SAST expansion
- [ ] Dependency scanning
- [ ] Secret scanning expansion
- [ ] DAST
- [ ] Authentication/authorization abuse tests
- [ ] Resource exhaustion tests
- [ ] Tor-specific privacy review
- [ ] Custody security review
- [ ] Production readiness review

## Current priority

Finish authentication/authorization and the custody policy boundary before connecting real blockchain wallets or production funds.
