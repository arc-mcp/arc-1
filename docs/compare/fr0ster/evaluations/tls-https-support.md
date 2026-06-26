# TLS/HTTPS Support for HTTP Streamable Transport

> **Priority**: High (Critical #5 in feature matrix)
> **Source**: fr0ster v4.6.0 — issue #26, commits cdf89b6..0a962bc (2026-03-31)
> **Status**: Pending implementation in ARC-1

## What fr0ster did

Added native HTTPS/TLS support for their HTTP Streamable and SSE transports via 7 commits:

1. `cdf89b6` — `TlsConfig` interface: `{ cert: string, key: string, ca?: string }`
2. `7ce3b18` — CLI args: `--tls-cert`, `--tls-key`, `--tls-ca`
3. `ab8da66` — YAML config section (not relevant — ARC-1 uses env vars)
4. `2da9761` — Wires config from CLI args to server config
5. `96eef32` — `createServerListener()` helper: creates `https.createServer()` with TLS options, falls back to `http.createServer()` without. Includes tests.
6. `54aa2bf` — Integrates TLS into `StreamableHttpServer`
7. `0a962bc` — Passes TLS config through launcher to all servers

## Key design decisions

- TLS is opt-in: no cert/key = plain HTTP (backward compatible)
- Single helper function (`createServerListener`) abstracts HTTP vs HTTPS
- CA file is optional (for self-signed certs)
- No TLS termination proxy dependency — server handles TLS directly

## What ARC-1 needs

ARC-1's HTTP Streamable transport is in `src/server/http.ts`. Implementation plan:

1. Add `TLS_CERT`, `TLS_KEY`, `TLS_CA` env vars + `--tls-cert/--tls-key/--tls-ca` CLI flags
2. Add to `ServerConfig` type in `src/server/types.ts`
3. In `src/server/http.ts`, use `https.createServer()` when cert+key provided
4. Update `src/server/config.ts` and `src/cli.ts`

**Effort estimate**: 1 day (straightforward Node.js TLS, no SAP-side changes)

## Decision

**Implement** — required for enterprise deployments without reverse proxy. fr0ster's approach is clean and can be adapted directly.
