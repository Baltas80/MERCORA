# Authentication security boundary

MERCORA sessions use opaque random bearer tokens. Only a SHA-256 digest of a session token is persisted by the application database.

Browser sessions are intended to use `HttpOnly`, `Secure` and `SameSite=Strict` cookies. Session expiry and revocation are server-side controls.

Password verification uses the repository's scrypt utility with a unique random salt. Authentication endpoints must add login throttling and account-abuse controls before production.

## Privacy boundary

Authentication should not require third-party analytics or tracking. Application logs must not contain passwords, session tokens, authorization headers, recovery secrets or wallet material.

## Production gates

- CSRF strategy selected and tested for every state-changing browser request.
- Login and recovery endpoints rate-limited.
- Session rotation after authentication and privilege changes.
- Revocation on logout and security events.
- Admin authentication separated from ordinary marketplace accounts.
- Sensitive administrative actions require stronger authorization.
- No private wallet material is available to the authentication service.
