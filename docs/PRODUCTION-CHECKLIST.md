# MERCORA production checklist

- [ ] Canonical FastAPI stack is the only application backend.
- [ ] Database migrations run from versioned files and are backed up.
- [ ] Application, worker, proxy, Tor, storage and custody trust boundaries are isolated.
- [ ] Production secrets come from a secret manager, never Git.
- [ ] Admin bootstrap is performed once and recorded.
- [ ] Admin high-risk actions use step-up and an independent approver.
- [ ] MFA/passkeys are enabled for administrators before financial activation.
- [ ] BTC/LTC/XMR adapters are independently verified and reconciliation is green.
- [ ] Payment observers cannot directly sign transactions.
- [ ] Escrow decisions cannot directly mutate balances.
- [ ] DAST, concurrency and abuse tests pass.
- [ ] Backups have been restored successfully in a clean environment.
- [ ] Tor origin leakage and application fingerprinting review passes.
- [ ] Privacy retention matrix and legal documentation are approved.
- [ ] Real funds remain disabled until the custody/security review is signed off.
