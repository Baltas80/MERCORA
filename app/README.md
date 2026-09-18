# MERCORA application

This directory is the application boundary referenced by the development Compose stack.

## Current status

The application runtime is intentionally minimal at this stage. Business functionality is not implemented yet.

The service contract is:

- listen on `0.0.0.0:8080` inside the container;
- expose a non-sensitive health endpoint at `/healthz`;
- return a deterministic readiness response at `/readyz`;
- do not expose database credentials, secrets, filesystem paths, or infrastructure details through HTTP responses.

The implementation language/framework will be selected together with the backend contract before marketplace functionality is added. No framework is being introduced merely to make the container build pass.
