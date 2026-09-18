# MERCORA application

This directory is the application boundary referenced by the development Compose stack.

## Current status

The runtime contains a minimal HTTP health service plus security-sensitive domain/authentication building blocks. Marketplace HTTP endpoints are not implemented yet.

The service contract is:

- listen on 0.0.0.0:8080 inside the container;
- expose a non-sensitive health endpoint at /healthz;
- return a deterministic readiness response at /readyz;
- do not expose database credentials, secrets, filesystem paths, or infrastructure details through HTTP responses.

Authentication primitives live outside the transport layer so they can be tested independently before cookie/session endpoints are exposed. HTTP authentication endpoints must implement the requirements in docs/AUTHENTICATION.md before being considered production-ready.
