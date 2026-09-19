# MERCORA Security Baseline

MERCORA uses secure-by-design principles and OWASP ASVS as the application verification baseline.

Critical invariants:
- client input never authorizes financial state;
- signing material never enters API, admin, database or source control;
- financial movements are idempotent and reconciled;
- high-risk admin actions require step-up and an independent second approver;
- emergency state blocks balance-affecting operations;
- private data is minimized and encrypted;
- untrusted uploads are isolated from executable/public paths.

Production gates include DAST, concurrency testing, container scanning, tested backup restoration, Tor privacy review, custody review and legal review.
