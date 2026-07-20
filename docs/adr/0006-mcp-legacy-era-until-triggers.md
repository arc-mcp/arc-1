# ADR 0006 — Stay legacy-era MCP (protocol ≤ 2025-11-25, TS SDK v1) until defined triggers

**Status:** Accepted
**Date:** 2026-07-20
**Related:** [docs/research/2026-07-20-mcp-2026-07-28-spec-impact.md](../research/2026-07-20-mcp-2026-07-28-spec-impact.md) (spec analysis + client matrix), [docs/plans/completed/2026-07-20-mcp-2026-07-28-forward-compat-plan.md](../plans/completed/2026-07-20-mcp-2026-07-28-forward-compat-plan.md) (live-verified evidence F1–F9; F10–F11 in the research dossier §7)
**Supersedes:** N/A
**Superseded by:** N/A

## Context

The MCP 2026-07-28 spec (final publication 2026-07-28) removes the `initialize` handshake and
`Mcp-Session-Id` sessions, adds `server/discover`, and moves protocol version/capabilities into
per-request `_meta`. The TypeScript SDK v2 that implements it ships as **new packages**
(`@modelcontextprotocol/server` etc.), is beta (`latest` dist-tag *is* the beta), and even the
beta still pins `LATEST_PROTOCOL_VERSION='2025-11-25'`. Meanwhile every client ARC-1 targets —
Claude (Code/Desktop/claude.ai), VS Code GitHub Copilot, GitHub Copilot for Eclipse, Microsoft
Copilot Studio, Cursor, Gemini CLI — negotiates ≤ 2025-11-25 via `initialize` today, and none has
announced a 2026-07-28 ship date.

The spec's own backward-compat design makes a legacy server safe: a dual-era client probes a
modern request first, and a `400` + JSON-RPC `-32000` body (NOT the modern codes -32020..-32022)
means "legacy server → fall back to `initialize`". ARC-1's real HTTP chain produces exactly that
discriminator (live-verified 2026-07-20; frozen in `tests/unit/server/mcp-era-contract.test.ts`).

## Decision

**ARC-1 stays on TS SDK v1 (protocol ≤ 2025-11-25) and does not adopt the 2026-07-28 era until a
trigger below fires.** Until then:

- Do **not** migrate to the v2 packages, implement `server/discover`, or emit/handle
  `Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` headers.
- Do **not** add those modern headers to the CORS allow-list: v2 clients default to
  `versionNegotiation: 'legacy'` (fully served by allowing `mcp-protocol-version`), and
  `Mcp-Param-*` is dynamically named — it cannot be statically allow-listed under
  `credentials: true` at all.
- Keep the era contract frozen in `tests/unit/server/mcp-era-contract.test.ts` — any dependency
  bump that changes the `-32000` discriminator, header leniency, Content-Type/Accept validation,
  or stateless GET/DELETE behavior must fail CI, not ship silently.
- **ADT locks never cross an MCP round-trip** (AGENTS.md invariant): `lock→modify→unlock`
  completes inside one synchronous tool call. Never move elicitation/sampling inside a lock block
  and never expose writes as async Tasks that hold a lock across a poll window — under the
  stateless protocol a later poll can land on an instance that does not hold the lock.

### Migration triggers (any one starts the v2 dual-era migration plan)

1. SDK v2 goes stable **and** its tasks/conformance suite is green.
2. A major target client flips its default away from legacy mode or announces 2026-07-28 support.
3. A target client becomes browser-resident with v2 auto-mode negotiation (the one path our CORS
   posture cannot serve).
4. claude.ai / Copilot deprecation signals for `initialize`-era servers (watch the spec's
   12-month feature-lifecycle windows).

### Migration prerequisites (record now, so the future PR is scoped)

- `@arc-mcp/xsuaa-auth` peer-depends on `@modelcontextprotocol/sdk >=1.18.2 <2` and confines SDK
  imports to `internal/sdk.js` — the migration needs a coordinated release of that package
  (designed as a one-file change).
- Use the SDK v2 dual-era server pattern (answer legacy `initialize` alongside `server/discover`
  on the same endpoint) — Copilot Studio and Eclipse are historically the slowest movers.
- After the spec publishes (2026-07-28), re-verify draft-cited details (modern error codes,
  `Mcp-*` header names, fallback wording) per the dossier's recheck checklist.

## Why

1. **Zero client pressure**: all six target clients speak ≤ 2025-11-25; ARC-1 already answers
   `2025-11-25` to the newest ones.
2. **The fallback is verified, not assumed**: the `-32000` era discriminator works through ARC-1's
   real express+auth+stateless-transport chain and is now a regression test.
3. **v2 is beta with nothing to gain**: it still speaks 2025-11-25; adopting it buys protocol risk
   plus a coordinated xsuaa-auth release for zero functional gain.
4. **ARC-1 is already stateless** (`sessionIdGenerator: undefined`, fresh Server per request) —
   the hard half of the eventual migration is already done, so waiting costs little.
