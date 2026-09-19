# MERCORA privacy data map

| Data | Purpose | Retention | Access |
|---|---|---|---|
| Pseudonym | Account identity | Account lifetime | Account/auth |
| Password verifier | Authentication | Account lifetime | Auth only |
| Recovery-code hashes | Account recovery | Until used/rotated | Auth only |
| Messages | Marketplace communication | Policy-defined | Participants |
| Shipping ciphertext | Delivery | Order lifecycle + policy | Buyer/seller ops as required |
| Payment tx metadata | Accounting/reconciliation | Legal/financial policy | Finance |
| Audit events | Security/accountability | Security policy | Authorized admins |
| Logs | Reliability/security | Minimum necessary | Operators |

IP addresses are not stored by application code as a business identity field. Any infrastructure-level logging must have a documented purpose and retention limit.
