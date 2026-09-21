# MCP 2026-07-28 forward-compat — verified plan, 2026-07-20

Every claim below was live-verified on 2026-07-20 against a running ARC-1 build (fake SAP backend,
API-key auth, `ARC1_ALLOWED_ORIGINS` set) or against installed `node_modules` sources. Evidence and
the full spec analysis live in
[docs/research/2026-07-20-mcp-2026-07-28-spec-impact.md](../../research/2026-07-20-mcp-2026-07-28-spec-impact.md).

## The decision that shapes the whole plan

**ARC-1 stays legacy-era (TS SDK v1 = 1.29.0, protocol ≤ 2025-11-25) through 2026.** The
2026-07-28 spec's own backward-compat design makes this the *correct* posture, not a compromise:
dual-era clients probe a modern request first, classify a `400` + JSON-RPC `-32000` body as
"legacy server", and fall back to `initialize`. ARC-1's real HTTP chain produces exactly that
discriminator today (F3 below). The PR therefore ships **zero protocol-path changes** — it fixes
one real CORS gap, freezes the era contract in regression tests so no dependency bump can silently
break it, and records the migration decision as ADR-0006.

## Verified facts (F1–F9)

| # | Fact | How verified |
|---|------|--------------|
| F1 | SDK v1 line is frozen at **1.29.0** (npm `latest`; ARC-1's lock already resolves it). v2 = *new* packages (`@modelcontextprotocol/server` etc.) at 2.0.0-beta.4, whose `latest` dist-tag ALSO points at the beta; even the beta still pins `LATEST_PROTOCOL_VERSION='2025-11-25'` | npm view + GitHub tags |
| F2 | ARC-1 answers `initialize` proposing `2025-11-25` with `2025-11-25` — already the current stable revision, what VS Code 1.107 / Claude clients propose | live probe |
| F3 | **Era discriminator works end-to-end**: `POST /mcp` with `MCP-Protocol-Version: 2026-07-28` through express+bearerAuth+per-request stateless transport → HTTP 400, body `{"code":-32000,"message":"Bad Request: Unsupported protocol version…"}`. `-32000` is *not* one of the modern codes (-32020/-32021/-32022), so dual-era clients classify ARC-1 as legacy and fall back to `initialize` per the spec's compat matrix | live probe + spec draft versioning page |
| F4 | Absent `MCP-Protocol-Version` header → request accepted (assume 2025-03-26). The VS Code [#308766](https://github.com/microsoft/vscode/issues/308766) failure class (strict servers rejecting header-less clients) does not apply to ARC-1 | live probe |
| F5 | **The one real gap**: CORS preflight answers 204 *unauthenticated* (cors middleware runs before bearerAuth — good), but `Access-Control-Allow-Headers: Content-Type,Authorization,mcp-session-id` omits `mcp-protocol-version`, which every SDK-based client MUST send on every post-initialize request since spec 2025-06-18. Browser clients fail preflight whenever `ARC1_ALLOWED_ORIGINS` is enabled | live probe of `OPTIONS /mcp` |
| F6 | `GET /mcp` → 200 (SSE stream), `DELETE /mcp` → 200 in stateless mode — no sharp edges for VS Code's SSE-fallback probe or Copilot Studio's session teardown | live probe |
| F7 | Client matrix: all six named clients (Claude Code/Desktop/claude.ai, VS Code Copilot ≥1.107, Eclipse Copilot, Copilot Studio, Cursor, Gemini CLI) negotiate ≤ 2025-11-25 via `initialize`; none has announced 2026-07-28 adoption; Copilot Studio is Streamable-only and its community-recommended server shape is exactly ARC-1's (stateless, no session id); SDK v2 clients default to `versionNegotiation: 'legacy'` and `'auto'` mode falls back cleanly | research workflow, cited in dossier |
| F8 | `@arc-mcp/xsuaa-auth` peer-depends on `@modelcontextprotocol/sdk >=1.18.2 <2` and confines all SDK imports to a one-file insulation layer (`dist/internal/sdk.js`, "SDK v2 monorepo split relocates these paths… one-file change") — v2 migration requires a coordinated release of that package | node_modules inspection |
| F9 | DCR tolerates 2026-era client metadata: the SDK register handler uses Zod `safeParse` (strip mode), so a future `application_type` field is ignored, not rejected | node_modules inspection |

## P1 — ship in this PR

### P1-a `fix(server):` CORS allow-list for MCP protocol headers ★ the only runtime change

[src/server/http.ts](../../../src/server/http.ts) (`applySecurityMiddleware`, the cors `allowedHeaders` list): += `'mcp-protocol-version'`, `'last-event-id'`.

- **Verified problem:** F5. `last-event-id` is sent by SDK clients on SSE reconnect attempts (fetch-based, not EventSource, so it IS preflighted); harmless for ARC-1 (stateless = no resumption) but its absence fails the whole reconnect GET at preflight.
- **Deliberate omission (recorded as a code comment):** the 2026-07-28 headers `Mcp-Method` / `Mcp-Name` / `Mcp-Param-*` are **not** added. Grounds (per plan review — the earlier "preflight failure = legacy signal" framing was wrong; a failed preflight surfaces as an opaque fetch TypeError, not a classifiable 400): (a) SDK v2 clients default to `versionNegotiation: 'legacy'`, and their legacy-mode browser requests need exactly `mcp-protocol-version` — P1-a is necessary AND sufficient for that path; (b) `Mcp-Param-*` is dynamically named and cannot be statically allow-listed under `credentials: true` (ACAH wildcard is literal in credentials mode), so modern-era CORS cannot be completed by allow-listing anyway; (c) no target client is a browser-resident v2 auto-mode client today.
- **Risk:** none — ACAH additions are unobservable by non-preflighting clients, and no-Origin requests get zero CORS headers (F10).

### P1-b Era-contract regression tests

Export `createMcpHandler` from `src/server/http.ts` (currently module-private; export is
behavior-preserving) and freeze F2/F3/F4/F5 as tests:

| Test | Asserts | File |
|------|---------|------|
| T1 | `POST /mcp` + `MCP-Protocol-Version: 2026-07-28` → 400, body `error.code === -32000` | new `tests/unit/server/mcp-era-contract.test.ts` (supertest + exported `createMcpHandler` with a stub server factory) |
| T2 | `POST /mcp` `initialize` with **no** version header → 200 | same |
| T3 | `initialize` proposing `2025-11-25` → response `protocolVersion === '2025-11-25'` | same |
| T4 | unauthenticated `OPTIONS` preflight requesting `mcp-protocol-version, last-event-id` → 204 with both in `Access-Control-Allow-Headers` | existing `tests/unit/server/http-security-headers.test.ts` ("CORS opt-in" describe, buildApp+supertest pattern) |
| T5 | `POST /mcp` with `Content-Type: application/json; charset=utf-8` → accepted (the shape .NET/Power Platform stacks send — the behavior unreleased SDK #2444 rewrites; Copilot Studio depends on it) | `mcp-era-contract.test.ts` |
| T6 | `POST /mcp` with `Accept: application/json` only (missing `text/event-stream`) → 406, body `error.code === -32000` (freezes the dual-Accept requirement) | same |
| T7 | stateless `GET /mcp` (Accept `text/event-stream`) → 200 SSE; `DELETE /mcp` → 200 (VS Code SSE-fallback probe / Copilot Studio teardown, F6) | same |

- **Test wiring** (per plan review): `app.use(express.json()); app.post('/mcp', createMcpHandler(factory))`
  mirroring the `buildApp` pattern in `http-security-headers.test.ts`; one-line comment that
  bearerAuth is intentionally out of scope — auth is orthogonal to the era discriminator, which
  lives in `StreamableHTTPServerTransport`.
- **Benefit:** the entire "do nothing, fallback works" posture rests on F3/F4 — SDK behaviors, not
  ARC-1 code. The v1.x branch has 6 unreleased commits (notably #2444, Content-Type validation by
  parsed media type) that a future dependabot `1.29.x` bump would auto-install under `^1.28.0`.
  These tests turn a silent contract change into a CI failure; that lets us keep the caret range.

### P1-c `docs:` decisions on the record

1. **ADR-0006** — *Stay legacy-era MCP (≤2025-11-25) until defined triggers*: records the decision,
   the migration triggers (SDK v2 stable + tasks suite green; a major target client flipping its
   default away from legacy / announcing 2026-07-28; claude.ai or Copilot deprecation signals), the
   xsuaa-auth coordination requirement (F8), and the explicit non-goals below.
2. **AGENTS.md invariant bullet** (one line, house style): **ADT locks never cross an MCP
   round-trip** — `lock→modify→unlock` completes inside one synchronous tool call; never elicit
   inside a lock block; never expose writes as async Tasks that hold a lock across a poll window.
3. **Commit the research dossier** + extend it with the client matrix, the F-table (incl. F10:
   ACAH additions unobservable by non-preflighting clients / no-Origin requests get zero CORS
   headers; F11: `last-event-id` inert without an eventStore), the Origin-403 residual-risk record,
   and a post-publication recheck checklist. **Reconcile the dossier with this plan** (it predates
   the review): fix its §3 CORS row + §6 step 2 to the shipped header set, mark §6 steps 2/6 as
   shipped by this PR, and point when-to-migrate at ADR-0006 as the single owner of the triggers.
4. **docs_page/configuration-reference.md** `ARC1_ALLOWED_ORIGINS` row: mention that preflight
   allows the MCP protocol headers (half-sentence).

## P2 — explicitly out of this PR (tracked as follow-ups)

- **Post-publication recheck** (after 2026-07-28): re-verify draft-cited details — modern error
  codes -32020/-32021/-32022, `Mcp-*` header names, fallback-algorithm wording — and swap
  `/specification/draft/` URLs for dated ones. Also verify whether the SDK v2 auto-mode probe
  attaches `Mcp-Method`/`Mcp-Name` in browser builds and how the client reacts to a
  preflight/network failure (the open fork from the plan review). Checklist lives in the dossier.
  *Nothing in this PR depends on draft-only details* — the -32000 discriminator is shipped SDK v1
  behavior.
- **Elicitation doc drift**: `src/server/elicit.ts` is production-dead (test-only importers) while
  roadmap/dev-guide/compare docs advertise it as shipped; plugins have a separate *live* path via
  `server.elicitInput` (plugin-loader.ts:62). Separate cleanup task.
- **SDK v2 dual-era migration**: 2027 planning item per ADR-0006 triggers.

## Explicitly rejected for this PR

| Rejected | Why |
|----------|-----|
| Origin-mismatch → 403 (2025-11-25 conformance wording) | Desktop/Electron clients may send unexpected `Origin` values we have no on-the-wire data for; ARC-1 already has real auth on `/mcp` + SEC-14 Host-header validation against DNS rebinding; semantics for the empty-allowlist default are undefined. Revisit only with live client Origin captures. Recorded as residual in the dossier. |
| Adopting SDK v2 / new packages | Beta (`latest` tag *is* the beta); still speaks 2025-11-25; would need coordinated xsuaa-auth release (F8) for zero protocol gain. |
| Adding `Mcp-Method`/`Mcp-Name` handling or CORS entries | v2 clients default to legacy mode (fully served by P1-a); `Mcp-Param-*` can't be statically allow-listed under `credentials: true`; no target client is a browser-resident v2 auto-mode client (see P1-a grounds + P2 recheck). |
| Deleting `src/server/elicit.ts` | Plugin `ctx.elicit` is a separate live path; deletion is unrelated cleanup with its own test fallout. |

## Commit & release strategy

One PR, squash-merged (repo convention) as
`fix(server): allow MCP protocol headers in CORS preflight; freeze era contract, record legacy-era posture (ADR-0006)`
→ release-please patch release. Docs ride in the same squash — docs files inside a `fix` commit do
not affect release-please's changelog typing.

**Merge timing:** safe to merge immediately. All four named client families are unaffected
(non-browser clients never preflight; the protocol path is untouched). The PR does not depend on
the RC finalizing — the post-publication recheck is a documentation follow-up, not a gate.
