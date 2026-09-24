# MERCORA Admin Console authentication

The Admin Console no longer implements password hashing or session management itself.

Authentication is delegated to **Better Auth** with its username plugin and admin plugin. Passwords are stored using **Argon2id** through `@node-rs/argon2`, and Better Auth owns the server-side sessions and rate limiting.

## Storage

Admin authentication is deliberately isolated from the marketplace PostgreSQL database. Better Auth uses a local SQLite database managed by `better-sqlite3`.

Default location:

- Windows: `%LOCALAPPDATA%\\MERCORA\\Admin\\admin-auth.db`
- Linux/macOS: `$XDG_STATE_HOME/mercora/admin/admin-auth.db` or `~/.local/state/mercora/admin/admin-auth.db`

Override with `MERCORA_ADMIN_AUTH_DB` when required.

## Required secret

Set `BETTER_AUTH_SECRET` to a random value of at least 32 characters. Never commit it to the repository.

Optional:

- `BETTER_AUTH_URL` — local Admin Control API URL; defaults to `http://127.0.0.1:8787`.
- `MERCORA_ADMIN_PORT` — Admin Control API port; defaults to `8787`.

## Initial administrator

After installing dependencies and configuring the secret:

```text
npm run admin:auth:migrate
npm run admin:auth:create -- --email admin@example.invalid --password "<strong-random-password>" --name "MERCORA Admin" --role admin --data '{"username":"<admin-username>"}' --yes
```

Better Auth's CLI performs the initial administrator creation through its supported server-side path. MERCORA does not generate, persist, or manage the administrator password itself.

The username plugin is the console's login mechanism. Usernames are immutable once provisioned, and public sign-up is disabled.

## Session and rate limiting

- Server-side session lifetime: 30 minutes.
- Session update age: 5 minutes.
- Idle timeout enforced by the desktop console: 15 minutes.
- Username login is rate-limited to 5 attempts per minute.
- The Admin Control API supplies the loopback client address to Better Auth for rate-limit accounting.
- The session cookie is `HttpOnly`, `SameSite=Strict`, and never persisted by the console.

## Runtime flow

```text
Admin Console
    ↓ username + password
Tauri session bridge
    ↓ short-lived session cookie held in memory
Admin Control API
    ↓ Better Auth session + admin role verification
Allow-listed control operations
    ↓
START / STOP / RESTART / STATUS / HEALTH CHECK / RECOVER
```

The console never receives or stores a password after login. It does not persist the Better Auth session cookie to Windows Credential Manager; the session exists only in process memory and is cleared on lock/logout.

The Admin Control API remains loopback-only. Authentication failure does not expose diagnostic details or secrets.
