# MERCORA owner-only Admin bootstrap

MERCORA does not expose public administrator registration. The Admin Console only authenticates against the loopback Admin Control API, and normal sign-up is disabled.

The first administrator is created only through the local bootstrap command:

```text
npm run admin:auth:create
```

The command requires `MERCORA_OWNER_BOOTSTRAP_TOKEN_HASH` in the MERCORA server environment. The expected value is the SHA-256 hash of a secret token known only to the owner/operator.

## Provision the owner token

Generate a strong random token outside the repository. Then obtain its SHA-256 digest without placing the token in command-line arguments:

```text
npm run admin:auth:hash-token
```

Enter the token when prompted. Store the returned 64-character hexadecimal digest as the server environment variable:

```text
MERCORA_OWNER_BOOTSTRAP_TOKEN_HASH=<sha256 digest>
```

The token itself must never be committed to Git, written to `.env` files that are backed up into the repository, passed as a command-line argument, or printed to logs. GitHub recommends avoiding command-line arguments for secrets because process arguments can be exposed to other users or audit mechanisms. citeturn10search9

## Create the owner administrator

Run:

```text
npm run admin:auth:create
```

The command prompts for the owner token, username, password, and password confirmation. Secret input is not echoed.

The password is handed to Better Auth's server-side `createUser` path, which performs the configured password hashing. Better Auth documents this same server-side path for initial admin creation. citeturn7search0

## One-time protection

After the first administrator is successfully created:

- the bootstrap marker is written inside the private authentication state directory;
- another administrator cannot be created through the bootstrap command;
- the owner token is no longer accepted for bootstrap;
- normal sign-up remains disabled;
- the Admin Control API continues to require an authenticated `admin` session.

If `MERCORA_OWNER_BOOTSTRAP_TOKEN_HASH` is absent or malformed, bootstrap is **disabled**, not opened.

The implementation deliberately does not embed the owner secret in the public repository or Windows console binary. Public source can therefore be distributed without publishing the owner authorization secret.

## Recovery

If the owner administrator is lost, do not add a backdoor or re-enable public registration. Use a separately authenticated recovery procedure on the trusted MERCORA host. Recovery must be explicitly audited and must not weaken the Admin Control API boundary.
