# Per-instance systemType for embedded servers

> **Priority**: Low
> **Source**: fr0ster v6.4.0 — commit `c726f70` (2026-04-20), issue #69 (closed); supersedes #68
> **ARC-1 component**: `src/server/server.ts`, `src/handlers/tools.ts` (tool listing filter)

## What fr0ster did

Their `BaseMcpServer.registerHandlers()` filtered tools by reading `process.env.SAP_SYSTEM_TYPE` at registration time — a process-global. A host like `cloud-llm-hub` that creates `EmbeddableMcpServer` per request and proxies to a mix of OnPremise (Cloud Connector) and cloud-hosted destinations could not say "this instance is onprem, the next one is cloud" without mutating `process.env`, which is concurrency-hostile once any `await` enters the registration path.

Fix: add `systemType?: 'onprem' | 'cloud' | 'legacy'` to `EmbeddableMcpServerOptions` and `BaseMcpServer` constructor options. Resolution order: `options.systemType` → `process.env.SAP_SYSTEM_TYPE` → `'cloud'`. Backward-compatible default. Integration test verifies onprem-only tools appear/disappear based on the option.

## ARC-1 current state

ARC-1 doesn't expose an `EmbeddableMcpServer`-style API — the server is launched with `bin/arc1` (stdio) or `bin/arc1` HTTP-streamable, and `SAP_SYSTEM_TYPE` is set per-process via env var (`auto` / `btp` / `onprem`). The per-process model fits ARC-1's deployment story: one container/instance per BTP destination, scaled horizontally. Multi-tenant per-request usage is out of scope today.

`SAP_SYSTEM_TYPE` is consumed in:

- `src/handlers/schemas.ts` (different read/write type allowlists for BTP vs onprem)
- `src/handlers/tools.ts` (tool descriptions reference type lists)
- `src/server/server.ts` (feature gates)

…all read once at boot.

## Assessment

**Not applicable today**. ARC-1's design point is "one server instance per SAP system" with admin-controlled config; we don't have an embedded-multi-tenant code path to thread an option through.

**Worth tracking** for two reasons:

1. If we ever ship a Node SDK that lets a host program embed ARC-1 in-process (the way `cloud-llm-hub` embeds fr0ster), we'd hit the same hazard. The fix pattern (constructor option overrides env, falls back to env, falls back to default) is the right shape — file the lesson now so we don't reinvent it.
2. `SAP_PP_ENABLED` already gives us per-user SAP identities under one server instance. If we extend per-user to per-user-system-type (e.g. user A's BTP destination vs user B's onprem destination on the same ARC-1 process), we'd need exactly fr0ster's resolution order, but per-request rather than per-instance.

## Decision

**defer** — track, do not implement. ARC-1's deployment shape (one process per system) means the bug class doesn't exist today. Note in `docs/compare/05-fr0ster-mcp-abap-adt.md` for the lesson; no code change.

**If ARC-1 ever exposes an embed API**: copy fr0ster's resolution order (constructor option → env → default), and don't mutate `process.env` from request handlers.
