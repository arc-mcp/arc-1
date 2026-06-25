# SEC-14: DNS-Rebinding / Host-Header Validation for HTTP Transport

> ID note: this is **SEC-14**, not SEC-13 — `docs/plans/dependency-security-tier3-defense.md`
> already reserves SEC-13 (Socket.dev supply-chain defense). Use SEC-14 everywhere.

## Overview

ARC-1's HTTP Streamable transport validates the `Origin` header (CORS, opt-in via
`ARC1_ALLOWED_ORIGINS`) and OAuth redirect/issuer hosts, but it never validates the **`Host`**
header. That leaves the `/mcp` endpoint open to **DNS-rebinding**: a malicious web page can rebind
its DNS to `127.0.0.1` and POST to a locally-running MCP server from the victim's browser. CORS does
not stop this — the attacker's page sends no `Origin`, or a same-origin-looking one, and the request
still reaches the handler. The MCP specification recommends a Host-header allowlist for local servers;
`docs/security-model.md` already names this threat (A4) but ships no control.

This plan adds a small Express middleware that checks the `Host` header against an allowlist, gated by
a new `ARC1_ALLOWED_HOSTS` config. It mirrors the existing `cors_rejected` audit pattern with a new
`host_rejected` event and rejects disallowed hosts with `403` + a JSON-RPC error body.

Key design decisions (each verified, see Verified Evidence):
- **Hand-rolled Express middleware, NOT the SDK transport option.** The MCP SDK *does* expose
  `enableDnsRebindingProtection`/`allowedHosts`/`allowedOrigins`, but as of the installed
  `@modelcontextprotocol/sdk@1.29.0` **all three are `@deprecated` with the guidance "Use external
  middleware for host validation instead."** Using them invites removal-on-upgrade breakage and fights
  the SDK's own direction. fr0ster reached the same conclusion in their v7.2.0 implementation.
- **Auto-protect default.** Empty `ARC1_ALLOWED_HOSTS` (the default) protects every concrete bind:
  the loopback Host values (`127.0.0.0/8`/`localhost`/`::1` — a rebind attacker cannot forge them, so
  local dev works even on `0.0.0.0`) plus the advertised public host derived from
  `ARC1_PUBLIC_URL` / `VCAP_APPLICATION` (so reverse-proxy / BTP deploys, reached via that exact host,
  work no-config) are accepted, and arbitrary Hosts — the rebind payload — rejected. A non-loopback
  bind with no public host or explicit allowlist logs a warning and accepts loopback Hosts only.
  `ARC1_ALLOWED_HOSTS=*` disables validation entirely.

Success criteria (plain bullets, not checkboxes):
- A bad `Host` to a loopback-bound server returns `403` + a `host_rejected` audit event; a good `Host`
  passes through.
- The default `0.0.0.0:8080` bind with no `ARC1_ALLOWED_HOSTS` rejects arbitrary Host values.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all green.

Scope: HTTP transport only (stdio has no network surface). `Origin` validation already exists in the
CORS layer and is out of scope — this plan is Host-only to avoid duplicating that logic.

## Context

### Current State

- `applySecurityMiddleware(app, allowedOrigins)` in `src/server/http.ts` (~line 90) installs helmet
  (unconditional) + opt-in CORS (when `allowedOrigins` is non-empty), including a `cors_rejected`
  audit hook (the `app.use((req,_res,next) => ...)` block at ~`:135`, which emits
  `logger.emitAudit({ timestamp, level:'warn', event:'cors_rejected', origin, method:req.method, path:req.path })`).
  It does **not** touch the `Host` header.
- `startHttpServer()` in `src/server/http.ts` (~line 195) computes `bindHost`/`port` from
  `config.httpAddr` (default `0.0.0.0:8080`) and calls `applySecurityMiddleware(app, config.allowedOrigins)`
  (~line 208) before mounting the rate limiter, OAuth router, and `/mcp` handler.
- The `/mcp` handler (`createMcpHandler`, ~line 160) constructs a stateless
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request and calls
  `transport.handleRequest(req, res, req.body)`.
- Config: `ServerConfig.allowedOrigins: string[]` (`src/server/types.ts:211`, default `[]` at `:270`),
  parsed from `--allowed-origins` / `ARC1_ALLOWED_ORIGINS` in `src/server/config.ts:647`.
- Audit: `AuditEventBase` (`src/server/audit.ts:13-21`) has **required** `timestamp`, `level: LogLevel`,
  `event`, plus optional `requestId`/`user`/`clientId`. `CorsRejectedEvent` (`:185-193`,
  `event:'cors_rejected'` + required `origin`, `method`, `path`) is a member of the `AuditEvent` union
  (`:224-240`).

### Target State

- New `ARC1_ALLOWED_HOSTS` config (`ServerConfig.allowedHosts: string[]`, default `[]`) parsed like
  `allowedOrigins`.
- New `HostRejectedEvent` in the audit union, mirroring `CorsRejectedEvent`.
- Pure helpers `isLoopbackBind`, `resolveAllowedHosts`, `checkHostAllowed` (unit-tested), plus a
  Host-validation middleware installed in `applySecurityMiddleware`, before `/mcp`. Disallowed `Host`
  → `403` + `{ jsonrpc:'2.0', error:{ code:-32000, message:'Invalid Host header' }, id:null }` and a
  `host_rejected` audit event. Allowed/disabled → `next()`.
- A4 in `docs/security-model.md` moved from open threat to a documented control.

### Key Files

| File | Role |
|------|------|
| `src/server/http.ts` | `applySecurityMiddleware` (extend), `startHttpServer` (pass allowedHosts + bindHost + port), new host-check middleware + pure helpers |
| `src/server/types.ts` | `ServerConfig.allowedHosts` field + default (mirror `allowedOrigins` `:211`/`:270`) |
| `src/server/config.ts` | parse `--allowed-hosts` / `ARC1_ALLOWED_HOSTS` (mirror `allowedOrigins` block at `:647`) |
| `src/server/audit.ts` | `HostRejectedEvent` interface (mirror `CorsRejectedEvent` `:185`) + add to `AuditEvent` union (`:224-240`) |
| `tests/unit/server/http-security-headers.test.ts` | **existing** harness (builds an express app via `applySecurityMiddleware` + spies on `logger.emitAudit` for `cors_rejected`) — add the middleware + audit-spy + pure-function tests HERE |
| `tests/unit/server/config.test.ts` | config-parsing tests for `ARC1_ALLOWED_HOSTS` (via `parseArgs(...).allowedHosts`) |
| `docs_page/security-guide.md`, `docs_page/configuration-reference.md`, `.env.example`, `AGENTS.md`, `docs_page/roadmap.md`, `docs/security-model.md` | docs |

### Verified Live Evidence

- **2026-06-24 — SDK DNS-rebinding fields are deprecated.** `@modelcontextprotocol/sdk@1.29.0`
  (the version `^1.28.0` resolves to; `npm view` shows 1.28.0 and 1.29.0 are the only ≥1.28 publishes)
  declares `allowedHosts`, `allowedOrigins`, `enableDnsRebindingProtection` on
  `WebStandardStreamableHTTPServerTransportOptions` (which `StreamableHTTPServerTransportOptions`
  aliases), each annotated `@deprecated Use external middleware for ... validation instead.` Source:
  `https://unpkg.com/@modelcontextprotocol/sdk@1.29.0/dist/esm/server/webStandardStreamableHttp.d.ts`
  lines 82–96. → **Decision: external middleware, not the SDK option.** (Re-confirm with that `curl` if
  the SDK is bumped before implementation.)
- **2026-06-24 — fr0ster v7.2.0 (`d1688c9`) prior art.** Their `src/server/dnsRebindingProtection.ts`
  is a pure `checkDnsRebinding(headers, opts)` returning a 403 descriptor + a `withDnsRebindingProtection()`
  Express wrapper; exact Host match including port; Origin checked only when present. Same shape this
  plan adopts, adapted to ARC-1's `applySecurityMiddleware` + audit conventions.
- **No SAP surface.** This feature touches only the Node/Express HTTP layer — there is **no ADT
  endpoint, no DDIC object, no release-dependent behavior**. The 7.50/758/816 live-system matrix does
  NOT apply; verification is unit + a local curl smoke (see Final verification). Do not add a phantom
  3-system check.

### Design Principles

1. **External middleware over the deprecated SDK flag** (verified above). Do NOT pass `allowedHosts`/
   `enableDnsRebindingProtection` to `new StreamableHTTPServerTransport({...})`.
2. **Auto-protect by default.** Default `ARC1_ALLOWED_HOSTS=[]`: every concrete bind accepts loopback
   Host values plus the `ARC1_PUBLIC_URL`/VCAP-derived public host, and rejects arbitrary Hosts. No
   legit deploy (local dev, reverse proxy, BTP) needs extra config; `*` disables validation.
3. **Host-only.** `Origin`/CORS already exists; do not duplicate it. One concern per layer.
4. **Mirror existing patterns exactly.** The audit event/emit, config parse, and middleware placement
   copy the established `cors_rejected` / `allowedOrigins` code — including the **required `level:'warn'`**
   on the emit (`AuditEventBase.level` is required; an emit without it fails `npm run typecheck`).
5. **Canonical host match.** Hostnames compare case-insensitively after stripping ports, IPv6 brackets,
   and trailing dots. `X-Forwarded-Host` / `Forwarded` are not trusted for this decision.
6. No new dependency — `express`/`helmet` are already present. This is a config/env var, **not** a tool
   parameter, so the `tools.ts`/`schemas.ts`/handler three-file sync does NOT apply.

## Development Approach

TDD: write the pure-function tests first (red), implement `isLoopbackBind` + `resolveAllowedHosts` +
`checkHostAllowed` (green), then wire the middleware and add an app-level assertion. The pure functions
carry the logic and are trivially testable; the middleware is a thin adapter (read `req.headers.host`,
call the predicate, 403-or-next).

Use the **existing** harness in `tests/unit/server/http-security-headers.test.ts`: it already builds a
real express app through `applySecurityMiddleware` and spies on `logger.emitAudit` to assert
`cors_rejected`. Add the host-validation tests there (build an app with a loopback bindHost, fire
requests with `supertest` or the file's existing request helper, assert 403 + `host_rejected`). Do NOT
rebuild a parallel harness in `http.test.ts` (that file only covers `createStandardVerifier`).

Failure/negative paths are the point: tests MUST cover missing `Host`, foreign-host `Host`, the `*`
disable escape hatch, canonical host matching, forwarded-header spoofing, and — the critical
regression guard — a non-loopback bind (`0.0.0.0`) with empty config that MUST reject arbitrary hosts.

No integration/E2E tier and no live SAP run — there is no SAP surface. State this in the docs task so
the next agent doesn't add a phantom 3-system check.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `allowedHosts` config + `HostRejectedEvent` audit type

**Files:**
- Modify: `src/server/types.ts` (`ServerConfig` near `allowedOrigins` `:211`; default near `:270`)
- Modify: `src/server/config.ts` (parse near the `allowedOrigins` block at `:647`)
- Modify: `src/server/audit.ts` (new `HostRejectedEvent` near `CorsRejectedEvent` `:185`; add to `AuditEvent` union `:224-240`)
- Modify: `tests/unit/server/config.test.ts`

Foundation task: introduce the config surface and audit type the later tasks consume. Mirror the
`allowedOrigins` plumbing and the `CorsRejectedEvent` shape exactly — both are proven patterns.

- [ ] Add `allowedHosts: string[]` to the `ServerConfig` interface in `src/server/types.ts`, adjacent
      to `allowedOrigins`; add `allowedHosts: []` to the defaults object next to `allowedOrigins: []`.
- [ ] In `src/server/config.ts`, mirror the `allowedOrigins` parse (`:647`): read
      `getFlag('allowed-hosts') ?? process.env.ARC1_ALLOWED_HOSTS`, split on `,`, `.map(s => s.trim())`,
      drop empties; set `config.allowedHosts` and `sources.allowedHosts`
      (`{ flag:'--allowed-hosts' }` / `{ env:'ARC1_ALLOWED_HOSTS' }` / `'default'`). Keep `*` as a literal
      element (the middleware interprets it; the parser does not special-case it).
- [ ] In `src/server/audit.ts`, define `HostRejectedEvent extends AuditEventBase` mirroring
      `CorsRejectedEvent` (`:185`) EXACTLY but for Host:
      `interface HostRejectedEvent extends AuditEventBase { event:'host_rejected'; host: string; method: string; path: string }`
      Then add `| HostRejectedEvent` to the `AuditEvent` union (`:224-240`, alongside `| CorsRejectedEvent`).
      Note: `AuditEventBase` already supplies the required `level`/`timestamp`/`event` — do NOT redeclare them.
- [ ] Add unit tests (~5 tests) in `tests/unit/server/config.test.ts` for host parsing via
      `parseArgs([...]).allowedHosts` (and process.env): unset → `[]`; single value; CSV with whitespace
      → trimmed; trailing comma / empty segments dropped; `ARC1_ALLOWED_HOSTS=*` → `['*']`. (There is no
      existing `allowedOrigins` test to copy — write these fresh following the file's `parseArgs` style.)
- [ ] Run `npm test` — all tests pass.

### Task 2: Implement Host-validation middleware in `applySecurityMiddleware`

**Files:**
- Modify: `src/server/http.ts` (`applySecurityMiddleware` ~`:90`; `startHttpServer` call site ~`:208`)
- Modify: `tests/unit/server/http-security-headers.test.ts`

The core task. Add three pure helpers + one middleware. Mirror fr0ster's `checkDnsRebinding` logic
(verified prior art) and ARC-1's `cors_rejected` audit hook/emit (`http.ts:~135`).

- [ ] Add an exported pure helper `isLoopbackBind(bindHost: string): boolean` — true for
      `localhost`, `127.0.0.0/8`, `::1`, `[::1]`; `0.0.0.0`, `::`, empty, and real hostname/IP → false.
- [ ] Add an exported pure helper
      `resolveAllowedHosts(configuredHosts: string[], bindHost: string, port: number): string[] | null`.
      Rules: contains `'*'` → return `null` ("disabled, allow all"). Non-empty → return it canonicalized.
      Empty AND `isLoopbackBind(bindHost)` → return
      `['localhost', '127.0.0.1', '::1']`. Empty AND concrete non-loopback → `[]` (fail closed).
- [ ] Add an exported pure predicate
      `checkHostAllowed(hostHeader: string | undefined, allowList: string[] | null): boolean` —
      `allowList === null` → true (disabled). Otherwise canonicalize `hostHeader` and return
      `allowList.includes(it)`; missing/empty `Host` → false (reject).
- [ ] Extend `applySecurityMiddleware` to
      `applySecurityMiddleware(app, allowedOrigins: string[], allowedHosts: string[] = [], bindHost = '', port = 0)`.
      After helmet and before CORS, compute `const hostAllowList = resolveAllowedHosts(allowedHosts, bindHost, port)`
      and, ONLY when `hostAllowList !== null`, `app.use((req,res,next) => {...})` that: reads
      `req.headers.host`; if `!checkHostAllowed(host, hostAllowList)` → emit audit by COPYING the
      `cors_rejected` emit at `http.ts:~138` exactly, swapping fields:
      `logger.emitAudit({ timestamp:new Date().toISOString(), level:'warn', event:'host_rejected', host: host ?? '', method:req.method, path:req.path })`,
      then `res.status(403).json({ jsonrpc:'2.0', error:{ code:-32000, message:'Invalid Host header' }, id:null })`;
      else `next()`. Mount it inside `applySecurityMiddleware` (after CORS), so it runs before the rate
      limiter / OAuth / `/mcp`.
- [ ] Update the `startHttpServer` call site (~`:208`) to
      `applySecurityMiddleware(app, config.allowedOrigins, config.allowedHosts, bindHost, port)`
      (`bindHost`/`port` are computed just above, ~`:195`).
- [ ] Regression guard: concrete non-loopback bind + empty config mounts host middleware and rejects
      arbitrary Host values. `*` remains the explicit disable path.
- [ ] Add unit tests (~10 tests) in `tests/unit/server/http-security-headers.test.ts`:
      - `isLoopbackBind`: true for localhost/127.0.0.0/8/::1; false for 0.0.0.0, `::`, and routable hosts.
      - `resolveAllowedHosts`: loopback+empty → localhost list; non-loopback+empty → `[]`; explicit list
        canonicalized; `['*']` → null.
      - `checkHostAllowed`: case-insensitive match, port/IPv6-bracket/trailing-dot normalization,
        foreign host rejected, missing Host rejected, `null` allowList → always true.
      - Middleware (reuse the file's app-builder + `emitAudit` spy): app built with
        `applySecurityMiddleware(app, [], [], '127.0.0.1', 8080)`; request `Host: evil.com` → 403 +
        JSON-RPC `-32000` body + a `host_rejected` audit event; request `Host: localhost:8080` → reaches
        a probe route (not 403). One test: `applySecurityMiddleware(app, [], [], '0.0.0.0', 8080)` +
        `Host: anything` → 403 (fail-closed regression guard).
- [ ] Run `npm test` — all tests pass.

### Task 3: Documentation + roadmap + security-model

**Files:**
- Modify: `docs_page/security-guide.md` (new "DNS-rebinding / Host validation" subsection)
- Modify: `docs_page/configuration-reference.md` (new `ARC1_ALLOWED_HOSTS` row)
- Modify: `.env.example` (commented `ARC1_ALLOWED_HOSTS=` with one-line guidance)
- Modify: `AGENTS.md` (config table — add `ARC1_ALLOWED_HOSTS` row next to `ARC1_ALLOWED_ORIGINS`)
- Modify: `docs_page/roadmap.md` (add a **SEC-14** completed entry — the roadmap currently has no SEC-14;
  do NOT reuse SEC-13, which `dependency-security-tier3-defense.md` reserves)
- Modify: `docs/security-model.md` (move A4 DNS-rebinding from open threat to a documented control)

Docs run last so they describe what shipped. Document the as-shipped behavior precisely, including the
fail-closed default and the explicit `*` escape hatch.

- [ ] `configuration-reference.md`: add `ARC1_ALLOWED_HOSTS` — "Comma-separated Host-header allowlist
      for the HTTP transport (DNS-rebinding defense). Default empty = auto-protect loopback binds and
      fail closed on concrete non-loopback binds; set explicitly for self-hosted non-loopback HTTP;
      `*` disables."
- [ ] `security-guide.md`: short subsection — what DNS-rebinding is, when it applies (localhost / HTTP
      bridge), why CORS doesn't cover it, and the `ARC1_ALLOWED_HOSTS` knob + default behavior.
- [ ] `.env.example` + `AGENTS.md` config table rows.
- [ ] `security-model.md`: A4 now mitigated by the Host allowlist (note the loopback-default caveat).
- [ ] `roadmap.md`: add a completed SEC-14 entry under the security section. State explicitly: Node HTTP
      layer only — no SAP / no 3-release verification.
- [ ] Run `npm test` — all tests pass (docs-only task, but keep the gate green).

### Task 4: Final verification

- [ ] `npm test` — all pass.
- [ ] `npm run typecheck` — no errors (the `host_rejected` emit MUST include `level` or this fails).
- [ ] `npm run lint` — no errors.
- [ ] `npm run build` — succeeds (the HTTP server is in the shipped bundle).
- [ ] Manual smoke (no SAP needed): bind loopback and prove the gate. Start with
      `SAP_TRANSPORT=http-streamable ARC1_HTTP_ADDR=127.0.0.1:8080` (SAP creds can be dummy — the Host
      check runs before any SAP call), then
      `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.com' http://127.0.0.1:8080/mcp` → `403`;
      `curl ... -H 'Host: localhost:8080' .../mcp` → NOT 403 (401/400/200 from the auth/MCP layer is
      fine — the Host gate let it through). Do not commit the smoke script.
- [ ] Confirm concrete non-loopback fails closed: `ARC1_HTTP_ADDR=0.0.0.0:8080` with no
      `ARC1_ALLOWED_HOSTS` → `curl -H 'Host: anything' .../mcp` is 403.
- [ ] Move this plan to `docs/plans/completed/` and fix any relative links (one level deeper → `../`
      paths gain a level).
