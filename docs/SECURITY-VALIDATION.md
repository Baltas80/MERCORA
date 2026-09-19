# Security validation

The repository's CI runs migration smoke tests, Python and JavaScript syntax checks, unit/integration tests, an HTTP security smoke test and a lightweight DAST smoke suite.

Before production:
- run a full DAST scanner against a staging deployment;
- scan the built image for known vulnerabilities;
- run authenticated authorization tests;
- run concurrency tests against checkout/payment/withdrawal/payout/dispute paths;
- execute the ASVS 5.0 verification checklist;
- test Tor origin leakage and application fingerprinting;
- restore encrypted backups in a clean environment;
- perform an independent custody/security review.
