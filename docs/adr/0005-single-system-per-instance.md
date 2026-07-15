# ADR 0005 — One SAP System per ARC-1 Instance (multi-system access is the hub's job, not ARC-1's)

**Status:** Accepted
**Date:** 2026-06-19
**Related:** the MCP hub — [`arc-mcp/mcp-hub`](https://github.com/arc-mcp/mcp-hub); full journey in [docs/research/mcp-hub-multi-system.md](../research/mcp-hub-multi-system.md)
**Supersedes:** N/A
**Superseded by:** N/A

## Context

ARC-1 is asked, repeatedly, to expose **more than one SAP system from a single instance** — via
multiple destinations, a `system`/`target` tool parameter, or a system-routing layer. The request is
reasonable on its face ("I have 10 systems, I don't want 10 servers"), so it keeps coming back.

This ADR records the standing decision to **decline that inside ARC-1**, the arguments for it, and the
sanctioned alternative — so the recurring request can be answered by citation instead of re-litigated,
and so a future agent working in this repo treats it as out of scope by decision rather than an
improvement to make.

## Decision

**ARC-1 serves exactly one SAP system per instance/process.** It exposes no `system`/`destination`
selector to the LLM and holds no cross-system routing. Multi-system access is provided *outside* ARC-1
by a thin multiplexer — the MCP hub ([`arc-mcp/mcp-hub`](https://github.com/arc-mcp/mcp-hub)) — never by
adding multi-destination/multi-system support to ARC-1.

When someone asks to "add multiple systems / a `system` parameter / multiple destinations to ARC-1":
**decline, cite this ADR, and route them to the hub** — path-scoped routes for safe
one-system-per-connection, or the opt-in `/all` endpoint for one-URL-all-systems; a local (stdio)
edition covers non-BTP setups. Do **not** add a system selector to any tool, accept multiple
destinations in one config, or build cross-system routing into ARC-1.

## Why (the arguments)

### 1. The LLM will eventually pick the wrong system — and that's a *write* to the wrong system
If one instance exposes N systems, the model chooses the target at call time (a parameter or a
destination). Given enough calls it routes wrong — a `SAPWrite`/`SAPActivate`/`SAPTransport` meant for
DEV lands on PROD. This is the **confused-deputy / environment-confusion** failure class; the Replit
"thought it was staging" production-database deletion ([AI Incident DB #1152](https://incidentdatabase.ai/cite/1152/))
is the canonical example. Binding **one system per instance makes cross-environment mistakes
structurally impossible** — the system is fixed by *which instance you connected to*, not by a runtime
decision the model can get wrong (poka-yoke / capability security). Belief must not matter; the
connection must be *incapable* of touching the wrong system.

### 2. The safety ceiling and identity are per-system by design
ARC-1's entire safety model — `allowWrites`, package allowlists, transport/data/SQL gates, deny
actions, the per-user scope ceiling, principal propagation, cookies/XSUAA — is scoped to **one** SAP
system (Design Principle 1; `src/adt/safety.ts`). Multiplexing systems in one instance tangles it: a
write allowance or package allowlist for system A must not leak to system B; a PROD instance wants a
read-only ceiling a DEV instance doesn't. One-system-per-instance keeps each ceiling clean and
independently auditable.

### 3. Token efficiency breaks
The 12-tool surface is deliberately budgeted for one system (~24K tokens, guarded by CI). Multi-system
-in-one forces either **N×12 tools** (≈N× the budget) or a `system` parameter on **every** tool —
which reintroduces exactly the routing risk of #1. Aggregation, *when explicitly wanted*, belongs in
the hub (opt-in, homogeneous-backend `system` param) — not imposed on the single-system default.

### 4. Separation of concerns
ARC-1 is an ADT client for one system. Cross-system routing, per-user token exchange, and tool
aggregation are a *different* responsibility — a multiplexer. Folding them into ARC-1 couples unrelated
logic, bloats the surface, and blurs the security boundary. One tool, one job.

### 5. Independent blast radius, config, and lifecycle
Separate instances fail, deploy, scale, and restart independently, and carry different ceilings (DEV
writable; PROD read-only + a read-only SAP user) and different SAP releases. A single multi-system
process forces uniform config and lets one bug/misconfig reach every system.

### 6. The need is already met — outside ARC-1
Multi-system access exists today via the MCP hub: per-user identity preserved (`OAuth2JWTBearer`
principal propagation), path-scoped routing (one system per connection = safe), or an opt-in aggregated
`/all` endpoint (12 tools + a `system` param, for homogeneous backends, with structural PROD-read-only
as the real guard). There is **no capability gap** to close inside ARC-1 — putting it there would only
*remove* the isolation that makes ARC-1 safe.

## Consequences

- **Positive:** cross-environment mistakes are structurally impossible; per-system safety ceilings stay
  clean and auditable; the token budget holds; the security boundary is crisp; instances are
  independently deployable.
- **Cost:** N systems = N instances (more processes/deployments). **Accepted** — the isolation is worth
  it, and the hub provides a single front door + one login over N instances when that ergonomics matters.
- **For a future agent:** treat "add multi-system / a `system` param / multiple destinations to ARC-1"
  as **out of scope by this decision**. Decline, cite this ADR, and point the requester to the hub.

## Alternatives considered (all rejected)

- **Multiple destinations in one instance** — the direct request. Rejected by #1 (LLM routes wrong) + #2
  (tangled ceilings).
- **A `system`/`target` parameter on every tool** — rejected: reintroduces #1 and inflates the surface
  (#3). The hub's `/all` uses this pattern *only* for homogeneous backends, behind an explicit opt-in,
  with structural PROD-read-only as the real guard — not in the always-on single-system default.
- **A server-side LLM that routes across systems** — a different product (a generative hub); rejected for
  the dev-tool use case (data-through-LLM precision loss, model lock-in). See
  [docs/research/mcp-hub-multi-system.md](../research/mcp-hub-multi-system.md) §3.5.
