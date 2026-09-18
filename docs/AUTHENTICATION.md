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

## HTTP boundary

The current API exposes `/auth/register`, `/auth/login`, `/auth/me` and `/auth/logout` through FastAPI.

- Session cookies are `HttpOnly`, `Secure` and `SameSite=Strict`.
- State-changing cookie-authenticated requests require a double-submit CSRF token.
- Login failures use a generic response to avoid account-existence disclosure through the authentication result.
- Login attempts are rate-limited outside the database transaction.
- A valid pre-existing session is revoked when a new successful login is established for that account, preventing session fixation through reuse of an old credential.
- Authentication secrets are never accepted through URLs.
- OpenAPI/interactive documentation is disabled on the deployed application boundary.

The prototype rate limiter is process-local. Production deployment must replace it with shared, bounded state (for example Redis) so limits remain effective across replicas and restarts.

## Authorization

Authentication proves which account holds a session. Authorization remains a separate decision and must check role plus resource ownership on every privileged operation.

Seller actions must be scoped to listings owned by that seller. Moderator/admin access is explicit and deny-by-default.
