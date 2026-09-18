# MERCORA architecture

## Security-first baseline

MERCORA is designed as a privacy-preserving marketplace exposed through a Tor Onion Service. The public web application must not directly expose the application process or database.

```text
Tor Onion Service
        |
        v
  local reverse proxy
        |
        +--> frontend
        +--> backend API
                 |
          +------+------+
          |             |
      PostgreSQL     isolated services
                        |
                 payment adapters
```

## Trust boundaries

1. Tor terminates the public Onion Service boundary.
2. The reverse proxy is the only component allowed to accept web traffic from Tor.
3. The application API is bound to a private interface/network only.
4. PostgreSQL is never exposed to Tor or the public network.
5. Payment integrations are isolated behind adapters; private keys and seeds never belong in application source code.
6. Administrative interfaces are separate from the public marketplace and require stronger authentication.

## Privacy baseline

- No third-party analytics, tracking pixels, remote fonts, or unnecessary external resources.
- Collect the minimum data required for marketplace functionality.
- Use random internal identifiers rather than sequential identifiers.
- Minimize application logging and explicitly review every logged field.
- Store secrets only through the deployment secret mechanism/environment, never in Git.

## Availability and abuse resistance

The application must implement layered controls rather than relying on Tor alone:

- request size limits;
- strict timeouts;
- per-operation rate limits;
- concurrency/resource limits;
- authentication throttling;
- upload validation;
- bounded database queries;
- health checks and graceful degradation;
- isolated background jobs;
- encrypted backups and tested restoration.

No design can guarantee immunity from every denial-of-service or infrastructure failure. The target is controlled resource consumption, isolation, rapid detection, and recoverability.

## Development rule

Security-sensitive functionality is not considered complete until it has tests, negative-path tests, and an explicit threat-model review.
