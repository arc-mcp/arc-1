# ADR 0005 — One SAP System per ARC-1 Instance

**Status:** Accepted; qualified by [ADR-0006](0006-experimental-read-only-multi-target.md)
**Date:** 2026-06-19
**Supersedes:** N/A
**Superseded by:** ADR-0006 only for its explicit, default-off, mutation-free BTP multi-target mode

**Maintenance, 2026-09-15:** Removed retired deployment recommendations. The default single-target
boundary and ADR-0006 exception remain unchanged.

## Context

ARC-1 is asked, repeatedly, to expose **more than one SAP system from a single instance** — via
multiple destinations, a `system`/`target` tool parameter, or a system-routing layer. The request is
reasonable on its face ("I have 10 systems, I don't want 10 servers"), so it keeps coming back.

This ADR records the default standing decision to **decline that inside ARC-1**, the arguments for it,
and the sanctioned alternative. ADR-0006 later proposed one narrow exception: a default-off,
mutation-free, BTP-only multi-target mode with explicit per-call target checks. This ADR continues to
govern writable access, the default deployment model, and use cases requiring stronger isolation.

## Decision

**By default, ARC-1 serves exactly one SAP system per instance/process.** It exposes no `system`/`destination`
selector to the LLM and holds no cross-system routing. For writable access to several systems, deploy
one ARC-1 instance per target and configure a separate MCP connection for each. The only in-process
exception is the experimental read-only contract in ADR-0006; it is not permission to add writes or
an unreviewed selector.

For requirements beyond ADR-0006's exact boundary, use separate instances. Adding a writable system
selector, a new discovery mode, or other cross-system behavior requires a new ADR/security review.

## Why (the arguments)

### 1. The LLM will eventually pick the wrong system — and that's a *write* to the wrong system
If one instance exposes N systems, the model chooses the target at call time (a parameter or a
destination). Given enough calls it routes wrong — a `SAPWrite`/`SAPActivate`/`SAPTransport` meant for
DEV lands on PROD. This is the **confused-deputy / environment-confusion** failure class; the Replit
"thought it was staging" production-database deletion ([AI Incident DB #1152](https://incidentdatabase.ai/cite/1152/))
is an example of this risk. Binding **one system per instance prevents that instance from switching
targets at call time**. A client with several connections can still choose the wrong connection;
independent server ceilings and SAP permissions remain necessary.

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
which reintroduces the routing risk of #1. ADR-0006 permits explicit target selection only under its
mutation-free safety contract; the single-system default keeps this selector out of the tool schema.

### 4. Separation of concerns
ARC-1's default runtime is an ADT client for one system. General cross-system routing and tool
aggregation add responsibilities to that runtime. ADR-0006's separate, mutation-free mode defines
the permitted exception.

### 5. Independent blast radius, config, and lifecycle
Separate instances fail, deploy, scale, and restart independently, and carry different ceilings (DEV
writable; PROD read-only + a read-only SAP user) and different SAP releases. A single multi-system
process forces uniform config and lets one bug/misconfig reach every system.

## Consequences

- **Positive:** each instance has a fixed target and independently auditable safety ceiling;
  the token budget holds; instances are independently deployable.
- **Cost:** N systems = N instances (more processes/deployments). **Accepted** — the isolation is worth
  it. Each instance needs its own MCP connection and authentication configuration.
- **For a future agent:** treat "add multi-system / a `system` param / multiple destinations to ARC-1"
  beyond ADR-0006's exception as **out of scope by this decision**. Cite this ADR and use separate
  instances; changing the boundary requires a new ADR/security review.

## Alternatives considered (all rejected)

- **Multiple destinations in one instance** — the direct request. Rejected by #1 (LLM routes wrong) + #2
  (tangled ceilings).
- **A `system`/`target` parameter on every tool** — rejected: reintroduces #1 and inflates the surface
  (#3). ADR-0006 later accepted explicit selection only for its mutation-free exception.
