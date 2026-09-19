# MERCORA Runtime Security Boundary

## Purpose

This document defines the security boundary that every development and production deployment must preserve. It is a deployment contract, not a claim of anonymity or absolute security.

## Canonical flow

`Tor Onion Service -> edge/reverse proxy -> application -> PostgreSQL/storage`

Only the edge may be reachable by the Onion Service. PostgreSQL and application services must not acquire an independent public listener.

## Required invariants

1. PostgreSQL publishes no host port.
2. The application is reachable from the host only through an explicitly documented edge binding; development may use loopback only.
3. Internal application/database networks are isolated from unintended external access.
4. Production must not expose the application directly to the public network.
5. Administrative interfaces must use a separately controlled path and must not be reachable through the public marketplace path unless explicitly authorized.
6. The Onion Service must terminate at the designated edge. Backend services must not publish their own Onion Service.
7. The application must not emit clearnet absolute URLs, redirects, external trackers, or third-party resources that undermine the intended privacy model.
8. Health checks must not disclose credentials, database details, hostnames, internal addresses, stack traces, or other sensitive topology.
9. Secrets are supplied at runtime and never committed to Git.
10. Payment signing/custody components remain disabled until their production gates are independently verified.

## Verification requirements

Before production, verify these invariants in a deployed environment, not only through static CI checks:

- enumerate listening sockets and container-published ports;
- attempt direct access to the application from every non-edge network path;
- attempt direct PostgreSQL access from the host and public interface;
- test malformed and unexpected `Host` headers;
- inspect redirects and absolute URLs;
- inspect response headers and error pages for origin information;
- inspect browser/network resources for unintended clearnet requests;
- verify the Onion Service can reach the edge while the edge remains unable to expose the origin through an alternate listener;
- verify failure is closed when the edge-to-application path is unavailable.

## Evidence standard

A control is considered **verified** only when its test has executed successfully against the relevant commit/deployment and the evidence is retained. Source code or documentation alone is not evidence of a passed deployment test.

## Privacy limitation

Tor can reduce network-level exposure but does not guarantee anonymity. Application behavior, endpoint content, account behavior, operational mistakes, device compromise, traffic analysis, and external services can still create identifying information. MERCORA must therefore avoid absolute anonymity claims.
