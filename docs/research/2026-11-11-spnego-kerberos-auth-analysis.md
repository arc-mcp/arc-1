# SPNEGO / Kerberos authentication toward SAP — feasibility analysis

**Date:** 2026-11-11
**Status:** Analysis only. No source file was modified, no dependency installed, no call made to a real SAP system.
**Scope:** ARC-1 → SAP (Layer B). MCP client → ARC-1 (Layer A) is unchanged by every option below.

---

## 0. Driving scenario (restated, as supplied by the requester — not independently verified here)

- On-premise SAP that only accepts SNC/Kerberos logon; the user's SAP account has no usable password.
- The ICM accepts SPNEGO over HTTPS: `Invoke-WebRequest -UseDefaultCredentials` against
  `/sap/bc/adt/discovery` returns 200, the ICM issues `MYSAPSSO2` and `SAP_SESSIONID_<SID>_<MANDT>`,
  and `klist` shows a service ticket `HTTP/<fqdn>`.
- Client host: Windows, domain-joined, valid TGT. Node managed by Volta.
- ARC-1 today cannot do this; the only workaround is `SAP_COOKIE_FILE` with an externally produced
  `MYSAPSSO2`.

The ICM evidence above is the single most important input to the design: **the system already
converts a SPNEGO logon into an SAP session cookie**. That is what makes option (b) below cheap.

---

## 1. Conventions and the Layer A / Layer B split

`AGENTS.md` and `docs_page/enterprise-auth.md` split authentication into two independent layers:

- **Layer A — MCP client → ARC-1:** API key, OIDC/JWT, XSUAA. `src/server/http.ts`.
- **Layer B — ARC-1 → SAP:** Basic, cookie, BTP bearer (service key), BTP Destination,
  principal propagation (`SAP-Connectivity-Authentication` / `Proxy-Authorization` / `SAMLAssertion`).
  `docs_page/enterprise-auth.md:137-233`, request flow in `AGENTS.md` ("Architecture: Request Flow").

SPNEGO is unambiguously a **Layer B, shared-identity** mechanism: the token is minted from the
*process owner's* OS credential cache, so every MCP user of that ARC-1 instance reaches SAP as the
one Windows account the process runs under. This matters for design principles 2 and 7 in
`AGENTS.md` ("per-user SAP identity by default", "single target by default") — SPNEGO must be
declared shared and must be fail-fast incompatible with principal propagation.

Relevant invariant: `docs/security-model.md:137` **I4 — Secrets never leave the process**, and
`docs/security-model.md:125` **I3 — Fail closed, never fail to a broader identity or scope**.

---

## 2. Map of the outbound HTTP stack (file:line)

### 2.1 HTTP client, dispatcher, TLS

| Concern | Location | Note |
|---|---|---|
| Library | `src/adt/http.ts:10` | `import { Agent, Client, type Dispatcher } from 'undici'` — undici 8.x (`package.json` `"undici": "^8.12.4"`), **not** global `fetch` |
| Why not global fetch | `src/adt/http.ts:1356-1360` | Node 22's embedded undici is dispatcher-incompatible with npm `undici@8` |
| TLS / insecure | `src/adt/http.ts:212-218` | `new Agent({ connect: { rejectUnauthorized: false }, … })` only when `insecure && !btpProxy` |
| Long-operation dispatcher | `src/adt/http.ts:1420-1424` | lazily created `Agent` with disabled header/body timeouts |
| Outbound choke point | `src/adt/http.ts:1401-1441` (`sendRequest`) | explicitly documented as "the single outbound choke point"; `User-Agent` and W3C `traceparent` are injected here |
| Wrapper | `src/adt/http.ts:1362-1397` (`doFetch`) | security-session gate, cookie store, CSRF capture, 401 session reset |
| BTP proxy branch | `src/adt/http.ts:1459+` (`doProxyRequest`) | `undici.Client`, standard HTTP proxy (not CONNECT) |

**Consequence:** a SPNEGO implementation has exactly one place to add a request header
(`applyAuthHeader`) and exactly one place to observe a response challenge (`requestInner`'s
401 branch). No per-call-site changes are required.

### 2.2 Where Basic auth and cookies are applied

| Concern | Location |
|---|---|
| `applyAuthHeader` | `src/adt/http.ts:1328-1348` — SAMLAssertion verbatim (+ `x-sap-security-session: create`), else Basic from `username`/`password`, suppressed when `bearerTokenProvider` / `sapConnectivityAuth` / `ppProxyAuth` is set |
| Bearer (BTP ABAP) | `src/adt/http.ts:499-503` and again on retry `src/adt/http.ts:743-747` |
| Cookie config fields | `src/adt/http.ts:119-122` (`cookieFile`, `cookieString`) |
| Cookie jar | `src/adt/http.ts:193` (`Map<name,value>`), merged by `composeCookieHeader` (`src/adt/http.ts:1273`), jar wins over config |
| Cookie hot-reload | `src/adt/http.ts:1214-1230` (`reloadCookiesFromSource`) — file only; `cookieString` cannot hot-reload |
| Hot-reload triggers | `src/adt/http.ts:505-510` (lazy, after `cookiesCleared`), `:736-739` (inside the 401 retry), `:1064` (before CSRF bootstrap outside a live stateful context) |
| Cookie-mode detection | `src/adt/http.ts:1182-1184` (`isCookieAuthMode`) |
| Stale-cookie clearing | `src/adt/http.ts:777-783` — only when the 401 *persists after* the retry and mode is cookie |

### 2.3 Startup auth preflight and 401/403 blocking

| Concern | Location |
|---|---|
| Endpoint | `src/server/server.ts:539` — `/sap/bc/adt/core/discovery` |
| Skip conditions | `src/server/server.ts:541-546` — PP enabled, or no `SAP_URL` |
| Runner | `src/server/server.ts:592` (`runStartupAuthPreflight`), `:605` (`…WithClient`) |
| Failure text | `src/server/server.ts:557-588` — 401/403 **block** shared tool calls; other failures are non-blocking |
| Tool-facing error | `src/server/server.ts:651-659` (`formatStartupAuthPreflightToolError`) |
| Ordering | `src/server/server.ts:1352` — preflight before feature probe |

### 2.4 Session handling: CSRF, stateful sessions, locks, retries

| Concern | Location | Note |
|---|---|---|
| CSRF fetch | `src/adt/http.ts:1028` (`fetchCsrfToken`) | `X-CSRF-Token: Fetch`; token is **bound to the session cookie** — see the torn-pair warning at `src/adt/http.ts:509-513` |
| CSRF on modifying requests | `src/adt/http.ts:449`, `:515`, `:1292` | |
| 403 CSRF refresh | `src/adt/http.ts:787-800` | one refresh, then replay |
| 401 retry | `src/adt/http.ts:711-784` | **one** retry per logical request, guarded by a per-request `authRetried` flag, `retryUnauthorized !== false`, and `noReplay !== true`. It re-applies auth, re-reads the cookie file, re-fetches CSRF, rebuilds the Cookie header, and replays |
| Stateful sessions | `src/adt/http.ts:297-333` (`withStatefulSession`) | clones the client, **shares `csrfToken`, a copy of the cookie jar and the `authenticationAttemptState`**, drops `sap-contextid`, closes the backend context in `finally` |
| Lock discipline | `AGENTS.md` / ADR-0006 | lock→modify→unlock must complete inside one synchronous tool call; nothing interactive may happen inside a lock |
| Shared-Basic serialization | `src/adt/http.ts:403-434` | when `retryUnauthorized === false`, auth attempts are serialized and a rejection short-circuits further requests |
| Session reset | `src/adt/http.ts:1250-1256` | clears CSRF token (and session state) |
| Debug-header redaction | `src/adt/http.ts:50-59` | `authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `sap-contextid`, `sap-connectivity-authentication`, `proxy-authorization`, `password` |

**Critical for SPNEGO:** `Authorization` is already in the redaction set, so a `Negotiate <token>`
header would never reach a sink *through the HTTP debug path*. `www-authenticate` is **not** in the
set (it is a response header, and the ICM's mutual-auth reply token travels in it) — it must be
added.

### 2.5 Coexistence matrix and fail-fast validations

| Rule | Location |
|---|---|
| PP + shared cookies → throw unless `SAP_PP_ALLOW_SHARED_COOKIES` | `src/server/config.ts:1226-1232` |
| BTP service key + cookies → throw | `src/server/config.ts:1233-1237` |
| BTP service key + PP → throw | `src/server/config.ts:1238-1243` |
| Multi-target + cookies / shared cookies → throw | `src/server/config.ts:1153-1157` |
| Multi-target + `SAP_URL`/user/password → throw | `src/server/config.ts:1161-1165` |
| Per-user config strips shared credentials | `src/server/server.ts:261-271` (`buildAdtConfig(..., { perUser: true })`) |
| Startup summary line | `src/server/auth-summary.ts:6-50` → `auth: MCP=[…] SAP=<method> (<scope>)` |

`logAuthSummary` currently derives `sapMethod` from a fixed if-chain
(`multi-target → pp → bearer → destination → basic+cookie → cookie → basic → none`,
`src/server/auth-summary.ts:20-37`) and `scope` from PP/multi-target state (`:40-48`).

---

## 3. Confirmation: no prior SPNEGO support

Searched `src/`, `tests/`, `docs/`, `docs_page/`, `scripts/`, `package.json` for
`negotiate|www-authenticate|kerberos|sspi|gssapi|spnego|gss-api`.

**Nothing in the runtime path.** All hits are unrelated or historical:

- `src/adt/http.ts:178, 311, 457, 469, 867-876, 961-965` — `negotiatedHeaders`: **MIME content
  negotiation** (Accept/Content-Type per resource), not HTTP auth negotiation. Easy to confuse;
  worth a naming note in any PR.
- `src/server/http.ts:547, 586` and `src/server/multi-target-bearer-auth.ts:11` — ARC-1 **emitting**
  `WWW-Authenticate` for its own OAuth/PRM challenge (Layer A). Opposite direction.
- `docs/plans/completed/2026-03-24-002-enterprise-bridge-gap-analysis.md:105-114, 375, 388` — a
  2026-03 gap analysis that already sketched this exact flow (`kerberos.initializeClient("HTTP/host@REALM")`
  → `step("")` → `Authorization: Negotiate …`). Historical, from the Go era; never implemented.
- `docs/compare/05-fr0ster-mcp-abap-adt.md:216` and `docs/compare/00-feature-matrix.md:340` — the
  competitor tracker records that `fr0ster/mcp-abap-adt` v6.9 added cert + Kerberos/SPNEGO auth, and
  classifies it for ARC-1 as a **deferred low/medium GAP**: *"`applyAuthHeader` is Basic-only …
  Defer unless a customer needs direct-to-SAP cert auth."* This request is exactly that customer.

No roadmap item covers it: `docs_page/roadmap.md` has no `kerberos|spnego|negotiate` entry (the
`cert`/TLS hits at lines 1358, 1389-1395 are about plugin signing and inbound TLS termination).

---

## 4. The `kerberos` npm package — verified facts

Verified against `kerberos@7.0.0`'s published README and `package.json`, and the GitHub release
asset list (fetched 2026-11-11):

- **SSPI on Windows is confirmed, not assumed:** *"a C++ extension for Node.js that provides
  cross-platform support for kerberos authentication using GSSAPI on linux/osx, and SSPI on windows."*
- **Passwordless works:** `initializeClient(service, [options])` takes `options.user` / `options.pass`
  documented as *"Only used on Windows"* and **optional**. Omitting them makes SSPI use the ambient
  logon session / credential cache — exactly the requester's scenario. `options.mechOID` accepts
  `GSS_MECH_OID_SPNEGO`.
- **API shape:** `initializeClient(spn)` → `client.step('')` → base64 token → send as
  `Authorization: Negotiate <token>`; feed the server's reply token back through `client.step(…)` for
  mutual auth.
- **Install:** `"install": "prebuild-install --runtime napi || node-gyp rebuild"`, deps
  `node-addon-api` + `prebuild-install`. `engines.node >= 20.19.0` (compatible with ARC-1's `>=22.19`).
- **Prebuilt binaries (N-API v9), from the v7.0.0 release assets:**
  `darwin-arm64`, `darwin-x64`, `freebsd-arm64`, `freebsd-x64`, `linux-arm64`, `linux-s390x`,
  `linux-x64`, `win32-x64`.
  **Absent: `win32-arm64` and any musl/Alpine build.** The README's Linux prebuild line says
  "Linux GLIBC 2.28 or later".

**Implications, stated plainly:**

- Windows x64 (the requester's case) installs a prebuilt binary — no node-gyp, no Visual Studio.
  The README's "Requirements → Windows → windows-build-tools / VS 2015 / Python 2.7" section is the
  *source-build* path and is stale; it only applies when no prebuild matches.
- **Windows arm64 has no prebuild** → node-gyp + VS Build Tools. Given the memory note that
  `npm ci` already broke `better-sqlite3` on this machine until VS 2022 Build Tools were installed,
  this is a realistic failure mode, not a theoretical one.
- **Alpine Docker has no prebuild** and musl + MIT krb5 would have to be compiled:
  `Dockerfile:10` builder is `node:22-alpine` with `python3 make g++` (`Dockerfile:13`), runtime is
  a separate `node:22-alpine` stage (`Dockerfile:30`). A hard dependency would need `krb5-dev` in the
  builder and `krb5-libs` in the runtime stage.
- **`.mcpb` (Claude Desktop) cannot carry it.** `.github/workflows/release.yml:274-275` runs
  `npm ci --omit=dev --ignore-scripts` and then **`rm -rf mcpb-bundle/node_modules/better-sqlite3`**.
  `--ignore-scripts` skips `prebuild-install` entirely, so a `kerberos` directory in the bundle would
  contain no `.node` binary. Any native auth module must be **optional and lazily required**, or the
  `.mcpb` smoke test at `release.yml:279-288` breaks.

*Assumption (not verified):* that `kerberos` exposes no API for TLS **channel bindings**. The
README's `initializeClient` options list (`principal`, `flags`, `mechOID`, `user`, `pass`) shows no
channel-binding parameter, but I did not read the C++ sources. If SAP/IIS-style *Extended Protection
for Authentication* is enforced in front of the ICM, SPNEGO from Node may fail where PowerShell
succeeds. Treat as an open risk to validate live.

---

## 5. Option comparison

### (a) Native per-request SPNEGO

Respond to every `401 WWW-Authenticate: Negotiate` by minting a token in `applyAuthHeader` /
the 401 branch and replaying.

### (b) SPNEGO bootstrap → reuse the cookie path  ← **recommended**

Negotiate **once** against a cheap endpoint (`/sap/bc/adt/core/discovery`), let the ICM issue
`MYSAPSSO2` + `SAP_SESSIONID_*`, store them in the existing cookie jar, and let every subsequent
request use the cookie path unchanged. Re-negotiate automatically on a 401 (ticket expiry, session
timeout), reusing the existing single-retry slot.

### (c) No change in ARC-1

Local SSPI proxy, or an external script that writes the cookie file consumed by `SAP_COOKIE_FILE`
(the `arc1-cli extract-cookies` path, `src/extract-sap-cookies.ts`).

| Criterion | (a) Per-request | (b) Bootstrap ← rec. | (c) No change |
|---|---|---|---|
| Code touched | `applyAuthHeader`, 401 branch, retry loop, stateful clone, proxy branch | one provider + one 401 hook; cookie path untouched | none |
| Native dependency | required on every call | required only at (re)negotiation | none in ARC-1 |
| Windows x64 | prebuild, fine | prebuild, fine | fine |
| Windows arm64 | node-gyp build | node-gyp build | fine |
| Docker Alpine | source build + `krb5-*` | same, but **skippable** — feature off by default | fine |
| `.mcpb` bundle | breaks unless optional+lazy | **works** (optional+lazy; feature simply unavailable) | fine |
| CSRF interaction | token/cookie pair can be torn across a re-negotiation mid-flight (`http.ts:509-513`) | none — CSRF is fetched after the session exists, exactly as today | none |
| Stateful sessions / locks | re-negotiation could land **inside** a lock window; ADR-0006 forbids interactive work there | negotiation happens before the lock; the clone inherits a valid cookie jar (`http.ts:305-307`) | none |
| Cache | per-user cache isolation (`src/handlers/cache-security.ts`) unaffected — identity is shared and constant | same | same |
| PP / multi-target | incompatible either way (process-ambient identity) | incompatible, enforced fail-fast | n/a |
| Secret exposure | one more secret class in the hot path | one secret class, used rarely | cookie file on disk (today's risk) |
| Latency | SSPI call per 401 only, but more code paths can hit it | one SSPI call per session | none |
| Ops cost for the user | none | none | **high** — external proxy/script, scheduled re-extraction, 8-hour-ish ticket lifetime |
| Matches observed ICM behavior | yes | **yes, and exploits it** | yes |

### Recommendation

**Option (b), with (a) kept as an explicitly documented fallback mode only if a live system turns
out not to issue a session cookie on SPNEGO logon.**

Why:

1. The requester's own evidence shows the ICM converts SPNEGO into `MYSAPSSO2` + `SAP_SESSIONID_*`.
   Option (b) is therefore a *credential-acquisition* feature bolted onto a transport path that is
   already production-hardened (cookie jar, hot-reload, 401 retry, CSRF binding, stateful clones).
   Option (a) rebuilds auth inside that machinery and must then be proven not to break the
   CSRF-token/session-cookie pairing and the lock window.
2. It keeps the native module off the hot path, which is what makes "optional dependency, lazily
   required, feature-flagged off by default" honest rather than cosmetic — Docker/Alpine and `.mcpb`
   keep working untouched.
3. It reuses the one 401 retry slot that already exists (`src/adt/http.ts:711-784`) instead of
   adding a second retry dimension.

Option (c) is a reasonable *interim* answer today and should stay documented, but it leaves the
user with a scheduled task refreshing a cookie file and a secret at rest — strictly worse than (b)
once (b) exists.

---

## 6. Proposed configuration design

Naming follows the existing `SAP_*` (SAP-facing) vs `ARC1_*` (server-facing) split and the
`CLI_CONFIG_OPTION_SPECS` registry (`src/server/config.ts:65+`).

| Flag | Env | Type | Default | Meaning |
|---|---|---|---|---|
| `--spnego` | `SAP_SPNEGO` | boolean | `false` | Enable SPNEGO/Kerberos logon to SAP (shared, process identity) |
| `--spnego-spn` | `SAP_SPNEGO_SPN` | string | derived | SPN override, e.g. `HTTP/sapdev.corp.example.com`. Default is `HTTP/<host of SAP_URL>` |
| `--spnego-mode` | `SAP_SPNEGO_MODE` | `bootstrap` \| `per-request` | `bootstrap` | Escape hatch for systems that do not issue a session cookie |

Deliberately **not** added: a principal/realm override (SSPI picks the logon session; a wrong
principal fails confusingly), and any password option (that is Basic auth, which already exists).

### Fail-fast rules (to add in `validateConfig`, `src/server/config.ts` near `:1223-1243`)

| Combination | Behavior |
|---|---|
| `SAP_SPNEGO=true` + `SAP_PP_ENABLED=true` | **throw** — SPNEGO is a single process-wide identity; PP promises per-user SAP identity |
| `SAP_SPNEGO=true` + `ARC1_MULTI_TARGET_ENDPOINTS=true` | **throw** — multi-target already rejects `SAP_URL`/user/password (`:1161`); one ambient ticket cannot serve N destinations |
| `SAP_SPNEGO=true` + `SAP_BTP_SERVICE_KEY[_FILE]` | **throw** — pick one SAP auth method (mirrors `:1233`) |
| `SAP_SPNEGO=true` + `SAP_USER`/`SAP_PASSWORD` | **throw** — ambiguous; `applyAuthHeader` would have to pick |
| `SAP_SPNEGO=true` + `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` | **throw** — SPNEGO *produces* the cookies; a second source is a silent-override trap |
| `SAP_SPNEGO=true` without `SAP_URL` | **throw** — the SPN is derived from it |
| `SAP_SPNEGO=true` + `SAP_BTP_DESTINATION` | **throw** — destination supplies its own credential |
| `SAP_SPNEGO_SPN` set without `SAP_SPNEGO=true` | `[warn]`, ignored (mirrors the `SAP_PP_STRICT` warning at `:1199-1202`) |
| `SAP_SPNEGO=true` on a non-domain / no-module host | startup **error** naming the missing module and the platform, not a silent fallback to anonymous (**I3**) |

### Startup summary line

In `logAuthSummary` (`src/server/auth-summary.ts:19-37`), insert a branch **before** `hasBasic`,
after the `bearer`/`destination` branches:

```
auth: MCP=[api-keys] SAP=spnego (shared)
```

`scope` stays `shared` by construction, since PP is rejected. If `SAP_SPNEGO_SPN` was overridden,
append a secret-free marker — `spn=override`, never the SPN value itself (it embeds the host and,
in some layouts, an account name).

### Preflight

`runStartupAuthPreflight` needs **no new skip rule**: `SAP_URL` is set and PP is off, so SPNEGO is
exercised by the existing `/sap/bc/adt/core/discovery` probe — which is also exactly where the
bootstrap negotiation happens. A 401 there must produce a SPNEGO-specific message in
`buildStartupAuthFailureReason` (`src/server/server.ts:557-588`): check `klist` for a TGT, check the
SPN matches the host in `SAP_URL`, check the ICM SPNEGO profile — **not** the current
"check SAP_USER/SAP_PASSWORD" text.

---

## 7. Implementation plan (ordered)

1. **Optional dependency + loader.** Add `kerberos` to `optionalDependencies` (never `dependencies`).
   New `src/adt/spnego.ts` with a lazy `await import('kerberos')` behind a single
   `acquireSpnegoToken(spn): Promise<string>`; a module-load failure produces a typed, actionable
   error naming the platform and the prebuild gap. Keep the module import out of any top-level path
   so `.mcpb` and Alpine are unaffected when the feature is off.
2. **Config + validation.** `CLI_CONFIG_OPTION_SPECS` (`src/server/config.ts:65+`), `ServerConfig`
   fields (`src/server/types.ts`), resolution next to `cookieFile`/`cookieString`
   (`src/server/config.ts:606-607`), and the fail-fast block of §6.
3. **Transport hook.** Add `spnegoSessionProvider?: () => Promise<void>` to `AdtHttpConfig`
   (`src/adt/http.ts:107-157`), mirroring `bearerTokenProvider`. The provider performs
   `initializeClient(spn)` → `step('')` → one request carrying `Authorization: Negotiate <token>`
   → `storeCookies(response)`. Call sites: before the first request when the jar holds no SAP
   session cookie, and inside the existing 401 retry branch (`src/adt/http.ts:736-747`), next to the
   cookie-file reload. Single-flight the provider so concurrent requests negotiate once (the
   `securitySessionGate` / `authenticationAttemptState` patterns at `src/adt/http.ts:205-207, 403-434`
   are the precedent).
4. **`applyAuthHeader`** (`src/adt/http.ts:1328`): in `per-request` mode only, set
   `Authorization: Negotiate <token>`; in `bootstrap` mode it stays untouched — cookies carry the session.
5. **Stateful clones** (`src/adt/http.ts:297-333`): verify the clone inherits a *valid* jar and
   never triggers a negotiation inside a lock window; if the jar is empty, negotiate **before**
   entering `withStatefulSession` (ADR-0006).
6. **Redaction:** add `www-authenticate` to `HTTP_DEBUG_REDACT_HEADERS` (`src/adt/http.ts:50-59`);
   confirm no audit event carries the SPN or a token (`src/server/audit.ts` typed event union).
7. **Server wiring:** build the provider in `buildAdtConfig` (`src/server/server.ts:221-273`),
   strictly inside the `if (!opts?.perUser)` block (`:261`) so a per-user path can never inherit it
   (the "per-user auth never inherits shared credentials" invariant in `AGENTS.md`).
8. **Summary + preflight messages** per §6.
9. **Docs + roadmap** per §9.

Each step keeps `npm test && npm run typecheck && npm run lint && npm run validate:policy &&
npm run build && npm run check:sizes` green, per the Engineering Playbook §2.

**Tool-surface impact:** none. No `tools.ts` / `schemas.ts` change, so the frozen
`tests/fixtures/tool-definitions/*.json` snapshots must stay byte-identical — a useful guard that
the change is confined to Layer B.

---

## 8. Test plan

### Unit (no SAP, no Kerberos)

Location: `tests/unit/adt/` alongside `http.test.ts`, `http-cookie-rotation.test.ts`,
`http-csrf-stateful.test.ts`; config tests in `tests/unit/server/config.test.ts`.

Mock pattern already in the repo: `vi.mock('undici', …)` + `mockResponse` from
`tests/helpers/mock-fetch.ts`. Add `vi.mock('kerberos', …)` returning a fake
`initializeClient` → `{ step: async () => 'FAKE_TOKEN_B64' }`.

1. **Challenge → token.** First request answers `401` with
   `WWW-Authenticate: Negotiate`; assert exactly one `initializeClient` call with the derived SPN
   `HTTP/<host>`, and a follow-up request carrying `Authorization: Negotiate FAKE_TOKEN_B64`.
2. **Bootstrap stores cookies.** The negotiated response carries
   `Set-Cookie: MYSAPSSO2=…; SAP_SESSIONID_X_100=…`; assert the next request sends them as `Cookie`
   and carries **no** `Authorization` header (bootstrap mode).
3. **Single re-negotiation.** A later 401 re-negotiates exactly once; a second consecutive 401 is
   returned to the caller (reuses the `authRetried` guard, `src/adt/http.ts:712-719`).
4. **Single flight.** Ten concurrent requests on a cold client produce one negotiation.
5. **`noReplay` honored.** A pinned/no-replay request never triggers a re-negotiation
   (`src/adt/http.ts:719`).
6. **CSRF pairing.** After re-negotiation, a modifying request carries a CSRF token fetched *after*
   the new session cookie, not before (guards the torn-pair hazard at `src/adt/http.ts:509-513`).
7. **Stateful clone.** `withStatefulSession` inherits the jar and performs no negotiation inside the
   session.
8. **No leakage.** With `ARC1_LOG_HTTP_DEBUG=true`, assert the captured audit event contains neither
   `FAKE_TOKEN_B64` nor any `Set-Cookie` value, and that `www-authenticate` is `[REDACTED]`.
9. **Config matrix.** Each row of §6 throws with its documented message; summary line renders
   `SAP=spnego (shared)`.
10. **Module missing.** `vi.mock('kerberos')` throwing `ERR_MODULE_NOT_FOUND` yields the actionable
    startup error and **no** unauthenticated request.

If a test spins an HTTP server, use `tests/helpers/supertest-loopback.ts` — the documented
IPv4/IPv6 bind-family hazard applies.

### Manual validation against the real system (operator steps, not run here)

1. **Baseline:** `klist` shows a TGT; `Invoke-WebRequest -UseDefaultCredentials https://<fqdn>/sap/bc/adt/discovery`
   returns 200 and `Set-Cookie: MYSAPSSO2`. Record the exact `HTTP/<fqdn>` service ticket name — that
   is the SPN ARC-1 must use.
2. **ARC-1 stdio:** `SAP_URL=https://<fqdn> SAP_CLIENT=<mandt> SAP_SPNEGO=true` → the startup line
   must read `SAP=spnego (shared)` and the preflight must pass.
3. **Read path:** `SAPRead` on a known object; **write path** (if `SAP_ALLOW_WRITES=true` on a test
   package): a full lock→modify→unlock to prove CSRF + stateful session survive.
4. **Expiry:** `klist purge`, then a tool call → expect one clean re-negotiation failure with an
   actionable message; `kinit`/re-logon, then success without restarting ARC-1.
5. **SPN mismatch:** set `SAP_SPNEGO_SPN=HTTP/wrong.example.com` and confirm the failure is a clear
   SPNEGO error, not a generic 401.
6. **Load-balanced / alias host:** if `SAP_URL` is a CNAME or a message-server alias, verify whether
   the SPN must be the physical host — this is the single most likely real-world failure.
7. **Record in the PR template:** build, release (e.g. 7.58 / 8.16), deployment route (stdio,
   Windows domain-joined), observed result, and explicitly the untested gaps (Linux/GSSAPI, Docker,
   Extended Protection).

---

## 9. Documentation to update

| File | Change |
|---|---|
| `docs_page/enterprise-auth.md` | New "SPNEGO / Kerberos (Windows SSO)" section under *SAP Authentication*, a row in the Quick Decision Guide (`:28-40`), and a numbered entry in the Detailed Reference |
| `docs_page/configuration-reference.md` | `SAP_SPNEGO`, `SAP_SPNEGO_SPN`, `SAP_SPNEGO_MODE` with defaults, clamps and the incompatibility list |
| `AGENTS.md` | One row per variable in the Configuration table (terse, per the file's own rule) |
| `docs/dev-guide.md` | A "SPNEGO auth" row: platform prebuild matrix, the `.mcpb`/Alpine constraint, the lock-window rule |
| `docs_page/local-development.md` | Windows domain-joined quickstart |
| `.env.example` | The three keys, commented out, default-off |
| `docs_page/security-guide.md` / `docs/security-model.md` | Shared-identity statement, redaction of `www-authenticate`, why PP is rejected (**I3**, **I4**) |
| `docs_page/docker.md` | Explicit: SPNEGO is not supported in the published Alpine image unless rebuilt with `krb5` |
| `docs_page/agent-plugin.md` | Explicit: unavailable in the `.mcpb` bundle (no native binary) |
| `docs_page/auth-test-process.md` | The §8 manual checklist |
| `docs_page/roadmap.md` | New entry (see below) if the PR ships only a subset |
| `docs/compare/05-fr0ster-mcp-abap-adt.md:216` | Narrow the "cert/Kerberos = GAP" line to the remaining cert/mTLS half |

**Roadmap entry** (per the Roadmap Discipline section — add on acceptance, remove/narrow on merge):

```
| [COMPAT-08](#compat-08) | SPNEGO / Kerberos SAP logon | P2 | M | Needs research | Auth / Compatibility |
```

with a detail block naming the open items: non-Windows GSSAPI validation, Alpine image, `.mcpb`
unavailability, Extended Protection / channel binding.

---

## 10. Draft upstream issue (English)

> **Title:** Support SPNEGO / Kerberos authentication to SAP (Windows SSO, passwordless SNC systems)
>
> **Problem**
>
> On SAP systems configured for SNC/Kerberos-only logon, developer accounts often have no usable
> password — password logon is disabled outright. ARC-1 currently offers Basic auth, a cookie file,
> BTP bearer/destination, and principal propagation (`src/adt/http.ts:1328-1348`). None of these
> works for a domain-joined workstation whose only credential is a Kerberos TGT.
>
> The ICM on such a system *does* accept SPNEGO over HTTPS. On a domain-joined Windows host:
>
> ```powershell
> Invoke-WebRequest -UseDefaultCredentials https://<fqdn>/sap/bc/adt/discovery
> ```
>
> returns `200`, the ICM issues `MYSAPSSO2` and `SAP_SESSIONID_<SID>_<MANDT>`, and `klist` shows a
> `HTTP/<fqdn>` service ticket. ARC-1's undici-based client does not respond to
> `401 WWW-Authenticate: Negotiate`, so the only workaround today is producing `MYSAPSSO2`
> externally and feeding it through `SAP_COOKIE_FILE` — which means a scheduled refresh job and a
> session secret at rest.
>
> **Proposal — SPNEGO bootstrap, not per-request SPNEGO**
>
> Because the ICM already converts a SPNEGO logon into an SAP session cookie, ARC-1 only needs to
> negotiate **once** and then reuse its existing cookie path:
>
> 1. On the first request (or when the jar holds no SAP session cookie), acquire a SPNEGO token
>    for `HTTP/<host of SAP_URL>` and send it as `Authorization: Negotiate <token>` to
>    `/sap/bc/adt/core/discovery`.
> 2. Store the resulting `MYSAPSSO2` / `SAP_SESSIONID_*` in the existing cookie jar.
> 3. Every later request takes the unchanged cookie path — CSRF binding, stateful lock sessions and
>    the existing single 401 retry all keep working as they do for `SAP_COOKIE_FILE` today.
> 4. On a 401, re-negotiate once inside the existing retry slot (`src/adt/http.ts:711-784`).
>
> Token acquisition uses the `kerberos` npm package (SSPI on Windows, GSSAPI on Linux/macOS), added
> as an **optional** dependency and `await import`-ed lazily, so nothing changes when the feature is
> off.
>
> **Configuration**
>
> | Flag | Env | Default |
> |---|---|---|
> | `--spnego` | `SAP_SPNEGO` | `false` |
> | `--spnego-spn` | `SAP_SPNEGO_SPN` | derived from `SAP_URL` |
> | `--spnego-mode` | `SAP_SPNEGO_MODE` | `bootstrap` (`per-request` as a fallback) |
>
> Startup summary: `auth: MCP=[…] SAP=spnego (shared)`.
>
> Fail-fast (consistent with `src/server/config.ts:1223-1243`): rejected together with
> `SAP_PP_ENABLED`, `ARC1_MULTI_TARGET_ENDPOINTS`, `SAP_BTP_SERVICE_KEY`, `SAP_BTP_DESTINATION`,
> `SAP_USER`/`SAP_PASSWORD` and `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING`. SPNEGO is a single
> process-ambient identity and must never be presented as a per-user one.
>
> **Known limitations (to be stated in the docs, not discovered by users)**
>
> - `kerberos@7` publishes prebuilt N-API binaries for `win32-x64`, `linux-{x64,arm64,s390x}`
>   (glibc ≥ 2.28), `darwin-{x64,arm64}` and FreeBSD. **No `win32-arm64` and no musl build**, so
>   Windows-on-ARM and the Alpine Docker image need a source build (`krb5-dev`).
> - The `.mcpb` Claude Desktop bundle is built with `npm ci --ignore-scripts`
>   (`.github/workflows/release.yml:274`), so no native binary ships there — the feature must degrade
>   to a clear "unavailable in this packaging" error.
> - Unverified: whether `kerberos` can supply TLS channel bindings. If *Extended Protection for
>   Authentication* is enforced in front of the ICM, SPNEGO from Node may fail where PowerShell succeeds.
>
> **Security**
>
> The SPNEGO token and the resulting cookies are secrets. `Authorization` and `Set-Cookie` are
> already redacted in the HTTP debug path (`src/adt/http.ts:50-59`); `www-authenticate` would be
> added. No token, cookie or SPN value enters an audit event.
>
> **Prior art in this repo**
>
> `docs/plans/completed/2026-03-24-002-enterprise-bridge-gap-analysis.md:105-114` sketched this flow
> during the Go era, and `docs/compare/05-fr0ster-mcp-abap-adt.md:216` tracks it as a deferred gap
> versus `fr0ster/mcp-abap-adt` v6.9.
>
> I can prepare the PR. I have a real Kerberos-only SAP system to validate against (Windows,
> domain-joined, ADT over HTTPS); Linux/GSSAPI and Docker would need someone else's environment.

---

## 11. Explicit assumptions and unverified points

| # | Claim | Status |
|---|---|---|
| 1 | The ICM issues `MYSAPSSO2` on SPNEGO logon on *this* system | Reported by the requester; **not verified here** (no SAP call made). The whole recommendation for option (b) rests on it |
| 2 | `kerberos` exposes no TLS channel-binding API | Inferred from the published `initializeClient` option list; C++ sources not read |
| 3 | Omitting `user`/`pass` on Windows makes SSPI use the ambient logon session | Strongly implied by *"Only used on Windows"* on optional params; **not empirically tested** |
| 4 | `prebuild-install` resolves `win32-x64` on a Volta-managed Node 22 without a toolchain | Expected (N-API v9 asset exists); not tested on this machine |
| 5 | SPNEGO survives ARC-1's stateful lock sessions unchanged in bootstrap mode | Reasoned from `src/adt/http.ts:297-333`; needs live write-path validation |
| 6 | The published Alpine image cannot load `kerberos` without `krb5-*` packages | Inferred from musl + the absent musl prebuild; not built |
| 7 | No ADR is required | My reading: this adds a shared Layer-B credential source and does not touch the multi-target/PP boundary. If a reviewer disagrees, an ADR belongs before code |
