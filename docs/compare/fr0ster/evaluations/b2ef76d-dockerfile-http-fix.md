# Dockerfile HTTP-mode + header-based connections

> **Priority**: Low
> **Source**: fr0ster v6.4.1 — commit `b2ef76d` (2026-04-21), issue #71
> **ARC-1 component**: `Dockerfile` (root)

## What fr0ster did

Their Docker image was broken for HTTP mode out of the box:

1. `MCP_TRANSPORT` defaulted to `stdio` — wrong for a server image.
2. Launcher path was wrong (`dist/server/v2/launcher.js` didn't exist).
3. No `--allow-destination-header` flag, so callers couldn't pass per-request connection params via headers.
4. Healthcheck pointed at `/health`, but the route is `/mcp/health`.
5. Build used full `npm run build` which fails inside the image because `.dockerignore` excludes `.gitignore` (Biome needs it).

Fix: switch defaults to HTTP, correct paths, enable header-based connection, fix healthcheck, swap to `npm run build:fast` (skip Biome). Verified end-to-end with `docker build` + `curl /mcp/health`.

## ARC-1 current state

ARC-1's `Dockerfile` is already correctly wired for HTTP-streamable mode. From `Dockerfile`:

```dockerfile
ENV SAP_TRANSPORT="http-streamable"
ENV SAP_HTTP_ADDR="0.0.0.0:8080"
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
```

- HTTP transport is the default (line 67).
- Bind address `0.0.0.0:8080` matches fr0ster's healthy run.
- Entry point uses `dist/index.js` — the actual TS-compiled output, not a launcher path that drifts.
- `npm run build` is used (full TypeScript + AFF schema copy); we don't have a Biome-in-Docker problem because Biome runs as a husky pre-commit hook on the host, not in the image.
- No healthcheck endpoint configured in the Dockerfile — ARC-1 doesn't ship a `HEALTHCHECK` directive (relies on platform-level health probes via the `/health` HTTP endpoint).

## Assessment

ARC-1 is mostly fine. The two specific lessons worth taking from fr0ster's fix:

1. **Header-based connection parameters.** fr0ster's `--allow-destination-header` lets clients pass connection details per-request via HTTP headers (so the image stays stateless and ships with no baked-in SAP connection). ARC-1 today requires `SAP_URL` / `SAP_USER` / `SAP_PASSWORD` baked into env at boot, OR a BTP destination resolved at startup. We don't support per-request connection switching via headers (closest analogue is principal propagation, which switches identity but not destination).

   This is a **multi-tenant gateway** feature — irrelevant for ARC-1's per-system-instance deployment, but interesting if we ever build a "one ARC-1 instance routes to many SAP systems via headers" mode (related to the per-instance `systemType` evaluation in [`c726f70-per-instance-systemtype.md`](c726f70-per-instance-systemtype.md)).

2. **Add a Docker `HEALTHCHECK` directive.** Currently absent from ARC-1's Dockerfile. A minimal `HEALTHCHECK CMD wget --quiet --spider http://localhost:8080/health || exit 1` would let `docker inspect --format '{{.State.Health.Status}}'` work on local runs without pushing to a platform that runs its own probe. Trivial polish, not user-visible from MCP.

## Decision

**no-action** for the HTTP-mode fix — ARC-1 already has it.

**consider-future** for the Docker `HEALTHCHECK` directive — small DX polish for local Docker runs. File but don't schedule.

**defer** for header-based per-request connection switching — only relevant if ARC-1 grows a multi-system gateway mode.
