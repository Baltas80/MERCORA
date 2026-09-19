# MERCORA Tor deployment boundary

## Canonical security invariant

The public path is:

Tor Onion Service -> edge/reverse proxy -> API -> data services

The Tor process must not have network reachability to PostgreSQL, the worker, storage, or administrative-only services.

## Current torrc template

`tor/torrc.example` uses:

`HiddenServicePort 80 127.0.0.1:8080`

This is intentionally a **host/namespace-local deployment template**. It assumes the Tor daemon and the reverse proxy share the same network namespace or that the proxy is bound only to the host loopback.

Do not copy this setting unchanged into a separate Tor container. In that topology, `127.0.0.1` means the Tor container itself.

## Containerized Tor

A future containerized deployment must use a dedicated `onion_edge` network containing only:

- Tor
- reverse proxy

The reverse proxy may additionally join the private `frontend` network to reach the API. The API may additionally join `data` to reach PostgreSQL.

The Tor container must not join `frontend` or `data`.

The Tor-to-edge destination should then be the proxy's private service address/port on `onion_edge`, not localhost.

## Runtime acceptance tests

Before production, verify from the Tor namespace:

1. The Onion Service reaches the edge successfully.
2. Tor cannot resolve or connect to PostgreSQL.
3. Tor cannot resolve or connect to the API directly.
4. The public listener is only the edge listener.
5. Requests with an unexpected Host fail closed.
6. Direct origin access from a separate test network fails.
7. No response contains the origin address, internal hostname, or private network metadata.
8. `/readyz` and `/internal/*` are unreachable through the public Onion Service.

## Tor version

As of 2026-09-19, the supported production baseline should use the current 0.4.9.x stable series and must not deploy the EOL 0.4.8.x series.

Revalidate the exact current Tor release immediately before production rollout.
