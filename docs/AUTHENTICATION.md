# MERCORA authentication model

## Account identity

- Accounts use a pseudonym rather than requiring an email address by default.
- Pseudonyms are syntactically constrained and compared case-insensitively for uniqueness/login.
- Internal account identifiers are UUIDs and must not be exposed as authorization credentials.

## Passwords

- Passwords are hashed with Argon2id through the central password module.
- Passwords are never logged, returned by APIs, or stored in reversible form.
- The application bounds password input length to limit resource-exhaustion attacks during password hashing.

## Sessions

- Session credentials are random opaque tokens.
- Only a SHA-256 digest of the session token is persisted in PostgreSQL.
- The raw token exists only at the authentication boundary and is never written to the database.
- Sessions have an absolute expiration and an explicit revocation field.
- The database does not store client IP addresses or user-agent strings in the session record.

## HTTP boundary requirements

The eventual browser-facing API must add, at minimum:

- 'HttpOnly' session cookies;
- 'Secure' cookies in production;
- 'SameSite=Strict' where compatible with the application flow;
- CSRF protection for every cookie-authenticated state change;
- generic login failure responses;
- account/login rate limiting outside the database transaction;
- session rotation after authentication and privilege changes;
- forced revocation for password reset and security events;
- no authentication secrets in URLs.

These controls are requirements, not claims about the current prototype server.

## Authorization

Authentication proves which account holds a session. Authorization remains a separate decision and must check role plus resource ownership on every privileged operation.

Seller actions must be scoped to listings owned by that seller. Moderator/admin access is explicit and deny-by-default.
