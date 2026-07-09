# ARC-1 Security Review & Remediation Report — June 2026

A comprehensive record of the June 2026 security hardening program: the threat model, the
review methodology, the work already shipped (with PR references), and a detailed remediation
roadmap for every open finding — with special focus on the recommended next picks.

This is the **narrative + roadmap** companion to [`security-model.md`](security-model.md), which
holds the canonical threat model, the seven security invariants, the per-PR review checklist, and
the terse living risk register. When the two disagree, `security-model.md` is authoritative for the
invariants and `security-model.md` §5 is authoritative for the current register status.

| | |
|---|---|
| **Started** | 2026-06-09 |
| **Last updated** | 2026-07-08 |
| **Status** | Historical narrative + living roadmap; current status is reconciled with `security-model.md` §5 |
| **Findings** | 17 numbered (R1–R17) + 1 partial (R9 gCTS) |
| **Shipped (merged to `main`)** | R8 [#387](https://github.com/arc-mcp/arc-1/pull/387) · R11 [#388](https://github.com/arc-mcp/arc-1/pull/388) · R9-abapGit [#389](https://github.com/arc-mcp/arc-1/pull/389) · R2 [#392](https://github.com/arc-mcp/arc-1/pull/392) · R1/R3/R12 [#393](https://github.com/arc-mcp/arc-1/pull/393) · R4 [#394](https://github.com/arc-mcp/arc-1/pull/394) · R16 [#395](https://github.com/arc-mcp/arc-1/pull/395) · R6 [#488](https://github.com/arc-mcp/arc-1/pull/488) · R10 [#489](https://github.com/arc-mcp/arc-1/pull/489) · R9-gCTS [#490](https://github.com/arc-mcp/arc-1/pull/490) · R7 [#491](https://github.com/arc-mcp/arc-1/pull/491)/[#494](https://github.com/arc-mcp/arc-1/pull/494) · R5/R15 file perms [#493](https://github.com/arc-mcp/arc-1/pull/493)/[#496](https://github.com/arc-mcp/arc-1/pull/496) · R14 [#495](https://github.com/arc-mcp/arc-1/pull/495)/[#552](https://github.com/arc-mcp/arc-1/pull/552) · R17 PR-title [#550](https://github.com/arc-mcp/arc-1/pull/550). **All High findings closed.** |
| **Related** | [`security-model.md`](security-model.md) · [`../docs_page/security-guide.md`](../docs_page/security-guide.md) · [`../SECURITY.md`](../SECURITY.md) |

---

## 1. Executive summary

ARC-1 is a high-stakes security target: an MCP server that lets an LLM **read and write ABAP
objects in live SAP systems**, as a centrally-managed, multi-user service. The distinctive,
load-bearing threat is that ARC-1 is a **confused-deputy engine** — it feeds SAP-resident content
(source, comments, object names, error text) to an LLM, which then issues the next tool calls back
into SAP under a real user's identity. The adversary is therefore not only a malicious user but a
**prompt-injected model** acting through a legitimate token.

The review ran in two waves:

1. **Six-domain code audit** (2026-06-09) — produced the threat model, the seven invariants, and
   the initial register **R1–R7**.
2. **Adversarial deep review** (2026-06-09, six agents, Track A/B) — verified the known findings,
   *challenged the controls previously rated "already-strong,"* and expanded coverage to the
   under-audited surface (git bridges, RAP, BTP plane, MCP-protocol surface, CLI, concurrency,
   supply chain, deployment). Added **R8–R17**.

Headline outcomes:

- **The foundation is strong.** The obvious kill-shots — JWT `alg`/`iss`/`aud`/`exp` validation,
  SSRF via tool args, SQL injection, OAuth auth-code interception, the `withSafety()` clone, XML
  escaping — were found already closed, several with prior-audit provenance and regression tests.
- **One High, confirmed auth bypass.** The deep review's adversarial pass *broke* a control listed
  "already-strong": the XSUAA **redirect-URI allowlist** (R8). It was verified end-to-end,
  including a live regex test against the production globs, and is now fixed ([#387](https://github.com/arc-mcp/arc-1/pull/387)).
- **Remediation continued after the initial wave.** The later hardening PRs closed or mitigated
  R5/R6/R7/R9-gCTS/R10/R14 and two R17 subitems. R15 remains partial because file permissions are
  fixed but SQLite disk cache source remains plaintext by design.
- **The rest of the challenge pass held.** DCR/state HMAC, SSRF containment, undici cross-origin
  credential-stripping, structured-SQL allowlisting, and XML escaping all survived refutation.

What remains is a small residual queue: the R15 plaintext-cache posture decision and the remaining
low R17 hardening subitems. See §6.7.

---

## 2. Threat model & invariants (summary)

Full detail in [`security-model.md`](security-model.md) §1–§3. In brief:

**Trust boundaries**

| # | Boundary | Enforcement |
|---|----------|-------------|
| B1 | MCP client/LLM → ARC-1 HTTP edge | auth chain (XSUAA → OIDC → API key), rate limit, CORS |
| B2 | ARC-1 request handling → ADT client | `handleToolCall` choke point: arg-normalize → scope (`ACTION_POLICY`) → Zod → package check |
| B3 | ARC-1 → SAP | `checkOperation` safety guard + per-user SAP session (PP) + TLS |
| B4 | SAP-native | `S_DEVELOP`, `S_ADT_RES`, package auth (outside ARC-1) |

The load-bearing boundary is **B2/B3**: an authenticated-but-hostile caller (or a prompt-injected
model holding a legitimate token) trying to (a) mutate SAP outside `allowedPackages`/the opt-in
ceiling, or (b) in PP mode, read another user's SAP-authorized content through ARC-1's shared state.

**The seven invariants** (canonical text in `security-model.md` §3):

- **I1** — Two gates before every mutation: scope ∧ safety ∧ resolved-package, fail-closed.
- **I2** — Per-user isolation of anything cached or keyed.
- **I3** — Fail closed, never to a broader identity or scope.
- **I4** — Secrets never leave the process (every sink, every field).
- **I5** — No unbounded work from untrusted input.
- **I6** — ARC-1 is never the injection vector (encode/escape/allowlist at the sink + schema).
- **I7** — The ceiling holds regardless of model intent (read-only by default; capabilities opt-in).

**Deployment-mode scoping.** Several findings only bite under **principal propagation** (per-user
identity); under a single shared service account every user already *is* that identity, so the
cross-user boundary doesn't exist. PP-only findings: R1, R3, R6, R12, R13.

---

## 3. Methodology — how the review was run

The review's distinctive feature was **adversarial verification**: every high-severity claim was
re-verified by hand against the code (not relayed from an agent), and the highest-value outcome was
explicitly defined as *breaking* a control previously believed sound.

**Wave 1 — six-domain parallel audit.** One reviewer per domain: (1) auth/session/OAuth-DCR,
(2) authorization + safety ceiling, (3) injection & input validation, (4) secrets/logging/audit,
(5) network/SSRF/TLS, (6) multi-tenant isolation. Each read the relevant code in full and reported
ranked findings with `file:line`, an exploitability rating, and existing mitigations. Produced
R1–R7 and the "already-strong" list.

**Wave 2 — adversarial deep review.** Driven by a reusable prompt (Appendix B) with two tracks:

- **Track A — deepen & verify the known.** For each open R-item: build the concrete exploit chain,
  confirm/refute with `file:line`, hunt for *sibling* instances of the same bug class, and — the
  key step — **adversarially challenge the "already-strong" controls**, trying to break each.
- **Track B — expand the surface.** Net-new hunting across git bridges (gCTS/abapGit), RAP write
  orchestration, server-driven objects/FLP/transport, the BTP plane (destination/connectivity
  token caching), the MCP-protocol surface (three-file schema sync, hyperfocused re-entry,
  elicitation), the CLI, the probe system, concurrency/TOCTOU on shared state, resource/DoS,
  cache poisoning, the error-disclosure oracle, secrets-at-rest, and supply-chain/deployment.

Six agents ran the clusters; their findings were then **hand-verified**:

- R8 (redirect bypass) was confirmed by copying `redirectPatternToRegExp` verbatim and running it
  against the real `xs-security.json` globs — all three divergence payloads (`\@`, `#@`, `?@`)
  matched the glob while `new URL().host === 'evil.com'` — then tracing the `/oauth/callback` 302
  that carries the OAuth `code` to the parsed host.
- R9, R10, R11, R12, R16 were each confirmed by reading the exact sink/handler/config.

The challenge pass otherwise **held** (with one-line confirmations): JWT validation (jose key-type
binding rejects `none`/HS-RS), DCR/state HMAC (HKDF-separated key, `timingSafeEqual`, length guard),
SSRF (host admin-fixed; `encodeURIComponent` + fixed `/sap/bc/adt/` prefix), undici cross-origin
credential stripping, the `withSafety()` clone, structured-SQL allowlisting, and XML escaping.

---

## 4. Status dashboard

Legend: ✅ merged to `main` · 🟡 partial/accepted conditional risk · ⬜ open.

| ID | Risk | Sev | Scope | Status | PR |
|----|------|-----|-------|--------|----|
| R1 | Cross-user dependency-source leak (dep-graph cache) | High | PP only | ✅ merged | [#393](https://github.com/arc-mcp/arc-1/pull/393) |
| R2 | grep ReDoS (event-loop DoS) | High | all HTTP | ✅ merged | [#392](https://github.com/arc-mcp/arc-1/pull/392) |
| R3 | Inactive-draft list cross-user leak (`username=''`) | High/Med | PP only | ✅ merged | [#393](https://github.com/arc-mcp/arc-1/pull/393) |
| R4 | SRVB publish/unpublish bypass package allowlist | Med | all | ✅ merged | [#394](https://github.com/arc-mcp/arc-1/pull/394) |
| R5 | File/BTP audit sinks do zero redaction | Med | file/btp sink | ✅ merged | [#493](https://github.com/arc-mcp/arc-1/pull/493), [#496](https://github.com/arc-mcp/arc-1/pull/496) |
| R6 | Non-strict PP fallback → shared service account | Med when explicit | PP only | 🟡 default closed; explicit opt-in fallback remains accepted/conditional | [#488](https://github.com/arc-mcp/arc-1/pull/488) |
| R7 | Silent `SAP_INSECURE` + path-encoding gaps | Low/Med | all | ✅ merged | [#491](https://github.com/arc-mcp/arc-1/pull/491), [#494](https://github.com/arc-mcp/arc-1/pull/494) |
| R8 | Redirect-URI allowlist bypass → OAuth code interception | **High** | XSUAA | ✅ merged | [#387](https://github.com/arc-mcp/arc-1/pull/387) |
| R9 | gCTS/abapGit pull/push bypass package allowlist | Med | allowGitWrites | ✅ merged | [#389](https://github.com/arc-mcp/arc-1/pull/389), [#490](https://github.com/arc-mcp/arc-1/pull/490) |
| R10 | `apply_quickfix` arbitrary authenticated POST (read scope) | Med | all | ✅ merged | [#489](https://github.com/arc-mcp/arc-1/pull/489) |
| R11 | Unbounded LLM counts → DoS | Med | all HTTP | ✅ merged | [#388](https://github.com/arc-mcp/arc-1/pull/388) |
| R12 | Reverse-dep (`usages`) index served cross-user | Med | PP + warmup | ✅ merged | [#393](https://github.com/arc-mcp/arc-1/pull/393) |
| R13 | PP destination cache may collapse to tenant-wide isolation | Med (cond.) | PP + OIDC | ✅ mitigated by `tenant-user` destination isolation | `@arc-mcp/xsuaa-auth` >=0.1.2 |
| R14 | Detailed SAP errors recon oracle when explicitly enabled | Low | trusted debug / stdio / explicit opt-out | ✅ mitigated; HTTP defaults minimal | [#495](https://github.com/arc-mcp/arc-1/pull/495), [#552](https://github.com/arc-mcp/arc-1/pull/552) |
| R15 | Cleartext SAP source at rest | Low/Med when explicit | disk cache | ✅ default closed; explicit SQLite remains accepted/operator-controlled | [#496](https://github.com/arc-mcp/arc-1/pull/496) |
| R16 | BTP service-key files not gitignored | Low/Med | repo hygiene | ✅ merged | [#395](https://github.com/arc-mcp/arc-1/pull/395) |
| R17 | Hardening cluster | Low | mixed | 🟡 PR-title and ACTION_POLICY guard closed; API-key timing + `change_package` regex remain open | [#550](https://github.com/arc-mcp/arc-1/pull/550), `npm run validate:policy` |

---

## 5. Completed & in-flight work

The original June PR writeups below are retained as the historical remediation record. For current
status, use the dashboard in §4 and the authoritative register in [`security-model.md`](security-model.md)
§5.

### PR [#387](https://github.com/arc-mcp/arc-1/pull/387) — R8 redirect-URI bypass (High)
- **Branch / commit:** `claude/harden-redirect-uri-canonical` · `dbb018b2`
- **The bug:** `matchesXsuaaRedirectPattern` ([`stateless-client-store.ts:171`](../src/server/stateless-client-store.ts))
  tested the glob against the **raw** URI string and guarded only `@`-userinfo. For `http`/`https`,
  `\`, `#`, `?` are authority terminators the WHATWG parser folds, so
  `https://evil.com\@x.hana.ondemand.com/cb` matches `*.hana.ondemand.com/**` yet parses to
  `host=evil.com`. The `/oauth/callback` 302 ([`http.ts:200`](../src/server/http.ts)) then delivers
  the victim's authorization `code` to the attacker host. This breaks the "auth-code interception
  defense" the code comment at `http.ts:150` claims.
- **The fix:** match the glob against a subject rebuilt from the **parsed** components
  (`${protocol}//${host}${pathname}${search}`) for http/https; keep raw matching for authority-less
  custom schemes (`cursor:`, `vscode:`). Userinfo guard retained.
- **Test:** regression test asserting the `\` / `#` / `?` divergence payloads (which parse to
  `host=evil.com`) are rejected while legitimate SAP hosts and custom-scheme callbacks still pass.
  Full suite 45/45, typecheck clean.
- **Honest caveat:** "code delivered to attacker host" is confirmed; whether the attacker can then
  *exchange* the code depends on client confidentiality / PKCE binding at `/oauth/token`, which was
  not fully traced. The fix is correct regardless. Severity **High** (Critical if exchangeable).

### PR [#388](https://github.com/arc-mcp/arc-1/pull/388) — R11 unbounded counts (Med)
- **Branch / commit:** `claude/clamp-unbounded-result-limits` · `47b4b7d2`
- **The bug:** `maxRows` (TABLE_CONTENTS), `maxResults` (object/source search), and `maxDeps`
  (dependency context) were interpolated/sliced with no `[1, CAP]` clamp — the clamp existed only
  on `runTableQuery`/`getPackageContents`. A single call (`SAPRead TABLE_CONTENTS maxRows=99999999`)
  buffers a huge result set on the shared event loop and amplifies SAP load + audit I/O.
- **The fix:** clamp at the sinks (graceful — over-cap silently clamps, never errors).
  `getTableContents` via the existing `clampPreviewRows` (`[1, 10000]`); search via a new
  `clampSearchResults` (`[1, 1000]`, NaN/<1 → caller default); `maxDeps` bounded to `[1, 100]` in
  the handler.
- **Test:** `clampSearchResults` unit test + URL-level assertions that each sink clamps an oversized
  value and falls back on NaN. Full suite 154/154 (client), typecheck clean.

### PR [#389](https://github.com/arc-mcp/arc-1/pull/389) — R9 abapGit pull/push package gate (Med) 🟡
- **Branch / commit:** `claude/gate-git-pull-package-allowlist` · `a63bb9fd`
- **The bug:** `clone`/`create_branch` are package-gated, but `pull`/`push` checked only the
  `allowGitWrites` flag — no per-package gate. A repo bound (out-of-band) to a package outside
  `allowedPackages` could be **pulled** (deserializing attacker-controlled remote content into that
  package) or **pushed** (exfiltrating its source), with the caller-supplied `package` a decoy
  abapGit ignores for an existing repo.
- **The fix:** resolve the repo's real binding (`loadAbapGitRepo`) and re-validate via a new
  `abapgit.enforceRepoPackageAllowed()` before pull and push, fail-closed when an allowlist is set
  and the package can't be resolved; no-op when unrestricted.
- **Test:** unit tests for `enforceRepoPackageAllowed` (no-op unrestricted; allow on match; refuse
  out-of-allowlist binding; fail-closed on unresolvable). Full unit suite 3570/3570, typecheck clean.
- **Current status (2026-07-08):** the gCTS follow-up shipped in [#490](https://github.com/arc-mcp/arc-1/pull/490).
  The historical note below was true for the original #389 scope, but R9 is now closed in §4.

### PR [#391](https://github.com/arc-mcp/arc-1/pull/391) — deployment-docs hardening (docs)
- **Branch / commit:** `claude/docs-deployment-security-caveats` · `ca203e47` (9 files, +72/−11)
- **Correctness fixes (docs shipped insecure-by-copy-paste):**
  - `btp-cloud-foundry-deployment.md` had two manifest examples with `SAP_ALLOW_WRITES:"true"` /
    `SAP_ALLOW_FREE_SQL:"true"` under a `# read-only, no SQL` comment → set to `"false"` (matching
    the tracked `manifest.yml`/`mta.yaml`) + added `SAP_PP_STRICT:"true"`.
  - `docker.md` Security Note #3 was self-contradictory → fixed.
- **Operator caveats added (MkDocs admonitions), mitigating these register items at the operator
  level (the code fix remains open):**
  - **R6** — `SAP_PP_STRICT` privilege-escalation/audit-misattribution danger (PP docs, deployment, BTP CF).
  - **R7 (TLS half)** — `SAP_INSECURE` disables TLS with no warning; at review time the manifests shipped `"true"`.
  - **R13** — PP per-user token isolation depends on `user_id`/`user_uuid` (OIDC/Entra caveat).
  - **R15** — `ARC1_CACHE=sqlite` stores SAP source cleartext at rest.
  - **R16** — BTP service key is a full credential; `.gitignore` doesn't match `*service-key*.json`.
  - **R5 (historical partial)** — hardening-checklist note that file/BTP sinks contained un-redacted
    source/error snippets before [#493](https://github.com/arc-mcp/arc-1/pull/493) and
    [#496](https://github.com/arc-mcp/arc-1/pull/496).
  - Plus the prompt-injection / safety-ceiling-as-backstop framing in `deployment.md`, and a
    least-privilege role-collection note in `xsuaa-setup.md`.
- **Verified:** `mkdocs build` succeeds, all changed pages render. Docs-only, no behavior change.

---

## 6. Open findings & remediation roadmap

Grouped by theme. Each entry gives the mechanism, scope, location, exploit/impact, the minimal fix,
the test to add, and a rough effort (S = a few hours, M = a day, L = multi-day).

> **Code-location note:** `src/handlers/intent.ts` was split into focused modules (`read.ts`,
> `write.ts`, `write/*`, `context.ts`, `git.ts`, `manage.ts`, `diagnose.ts`, …) in
> [#402](https://github.com/arc-mcp/arc-1/pull/402). `intent.ts:NNNN` locations predate that
> split — find the named symbol (e.g. `enrichWithSapDetails`, `change_package`) in the matching
> `src/handlers/` module.

> **Update (2026-07-08):** the entries below are retained as historical finding writeups. Current
> code has closed R5, R7, R9-gCTS, R10, and R14; R6 is default-closed with explicit non-strict
> fallback remaining as an operator opt-in; R15 is partial because private file permissions are
> fixed but SQLite source remains plaintext; R17 is partial because PR-title injection and the
> ACTION_POLICY guard are closed while two low hardening items remain.

### 6.1 Cross-user isolation cluster (PP-only) — the highest-value confidentiality work

These share one root cause: data is cached or keyed *in front of* SAP's per-user authorization
without a verified identity in the key (or without per-user revalidation on a cache hit). They are
the worst class of finding for the flagship multi-user-PP deployment, and a single coherent
"cache keys carry verified identity / revalidate-on-hit" workstream closes most of them.

⭐ **R1 — Cross-user dependency-source leak — High — PP only**
- **Where:** [`caching-layer.ts:126`](../src/cache/caching-layer.ts) (`getCachedDepGraph`),
  payload [`cache.ts:76`](../src/cache/cache.ts) (`CachedContract.source`/`fullSource`), hit path
  [`intent.ts:7616`](../src/handlers/).
- **Mechanism:** the dep-graph contract cache stores each dependency's `source`/`fullSource` keyed
  **only by the root object's source hash** — no identity. The root read is revalidated per-user,
  but on a cache hit the cached *dependencies'* source is returned with no per-user SAP check.
- **Exploit:** User A runs `SAPContext deps` on `ZCL_ROOT` whose graph pulls in restricted
  `ZCL_SECRET` (A may read it). User B, authorized for `ZCL_ROOT` but **not** `ZCL_SECRET`, gets the
  same cache entry → receives `ZCL_SECRET`'s source. Cross-user source disclosure.
- **Fix:** key the dep graph by `(rootHash, userKey)`; **or** re-run the per-user `getSource`
  (which revalidates) for each cached dependency on a hit; **or** disable the dep-graph read-cache
  when `ppEnabled`. Storing only dependency *names/types* and re-resolving contents per-user on hit
  keeps the discovery savings while restoring the gate.
- **Test:** two clients with divergent `checkPackage`; A seeds the graph for `ZCL_ROOT` with dep
  `ZCL_SECRET`; B (deny `ZCL_SECRET`) must not receive its source on the hit.
- **Effort:** M.

⭐ **R3 — Inactive-draft list cross-user leak — High/Med — PP only**
- **Where:** key [`inactive-list-cache.ts:15`](../src/cache/inactive-list-cache.ts), identity source
  [`server.ts:272`](../src/server/server.ts) (`payload.user_name ?? payload.email`).
- **Mechanism:** the inactive-draft list is keyed by `client.username`, which is best-effort
  `user_name ?? email` and **defaults to `''`** when a JWT carries neither (e.g. a pure-`sub` OIDC
  token). All such users collapse into the `''` bucket and see each other's objects-being-edited.
- **Exploit:** two distinct OIDC-PP users whose tokens lack `user_name`/`email` share the `''`
  bucket; `SAPRead`/`SAPContext` draft-awareness serves A's edit list to B (and A's activate
  invalidates B's entry). A secondary risk: a collided inactive list can steer an inactive *source*
  read whose cache key also omits identity.
- **Fix:** reuse the rate-limiter's `resolveRateLimitUserKey()` (which already includes `sub`) for
  the cache key; never key on `''` (bypass the cache for empty identity). Don't cache `inactive`
  source bodies under PP.
- **Test:** two AuthInfos differing only in `sub` land in distinct buckets; a JWT with neither
  name/email/sub bypasses the cache.
- **Effort:** S–M. *(Cheap, high-value — the fix already exists in-repo as `resolveRateLimitUserKey`.)*

⭐ **R12 — Reverse-dependency (`usages`) index served cross-user — Med — PP + warmup**
- **Where:** serve [`intent.ts:7337`](../src/handlers/), index
  [`caching-layer.ts:191`](../src/cache/caching-layer.ts) (`getUsages` → `getEdgesTo`), populated by
  warmup under the shared service account.
- **Mechanism:** `getUsages` returns the warmup-built reverse-dependency edge index (scanned across
  all `Z*` by the technical user) directly, with no live ADT call — the one user-facing serve path
  that skips the per-user revalidation primitive entirely.
- **Exploit:** User B calls `SAPContext(action="usages", name="ZA_SECRET")` for a package B can't
  read and receives the list of objects referencing it — where-used metadata about objects outside
  B's authorization.
- **Fix:** under PP (or whenever warmup populated the index), gate the serve with a per-user
  authorization probe (`resolveObjectPackage` + `checkPackage`, or a per-user read of the target),
  or fall back to the live `SAPNavigate(references)` path the error message already advertises.
- **Test:** warmup index contains an edge into a denied package; the per-user serve returns
  error/empty, not the cached edge.
- **Effort:** M.

**R13 — PP destination cache may collapse to tenant-wide isolation — Med (conditional) — PP + OIDC** 📄
- **Current status (2026-07-08):** mitigated by `@arc-mcp/xsuaa-auth` >=0.1.2, which pins
  tenant-user destination isolation.
- **Where:** [`btp.ts:331`](../src/adt/btp.ts) (`getDestination({useCache:true})`, no explicit
  `isolationStrategy`).
- **Mechanism:** the SAP Cloud SDK isolates the cached destination/token per user only when the JWT
  carries `user_id`/`user_uuid`. XSUAA tokens do; a generic OIDC/Entra bearer token that lacks them
  can collapse to `tenant` isolation, so for a bearer-token destination one user's exchanged token
  may be reused for another.
- **Fix:** pin `isolationStrategy:'tenant-user'`, and reject a PP token that lacks a usable per-user
  claim (hard-fail in strict mode) before minting the per-user client.
- **Test:** two JWTs with the same tenant but different `user_id` must not produce the same cache
  key; a token with no `user_id`/`user_uuid` is rejected for PP.
- **Status:** mitigated in the extracted auth module; keep the operator caveat for non-standard PP
  deployments and future auth-module upgrades.
- **Effort:** S–M.

### 6.2 Denial of service / unbounded input (all HTTP)

⭐ **R2 — grep ReDoS — High — every HTTP deployment**
- **Where:** [`grep.ts:53`](../src/context/grep.ts) (`new RegExp(pattern, 'gim')`), unbounded schema
  [`schemas.ts:231`](../src/handlers/schemas.ts).
- **Mechanism:** `SAPRead grep` compiles an LLM-supplied regex with no length cap, no timeout, run
  line-by-line over full object source. A catastrophic pattern (`(a+)+$`) against a long line blocks
  Node's single event loop — **every concurrent user stalls.** A zero-match pattern is even compiled
  and run twice (the escaped-literal fallback re-runs over the same lines).
- **Why it's the top pick:** the **broadest blast radius** of any open finding (hits every HTTP
  deployment, not just PP), trivially triggerable by any read-scoped user, and the smallest fix —
  the direct companion to the already-merged R11.
- **Fix:** cap pattern length (e.g. ≤512 chars), cap per-line length before `regex.test`, and run
  the match under a timeout or `re2`.
- **Test:** a pathological pattern returns the invalid-pattern result quickly (under a time bound)
  instead of hanging; a too-long pattern is rejected at the schema.
- **Effort:** S.

### 6.3 Authorization / integrity

⭐ **R4 — SRVB publish/unpublish bypass the package allowlist — Med — all**
- **Where:** [`intent.ts:5931`](../src/handlers/) / [`:5975`](../src/handlers/)
  (`publish_srvb`/`unpublish_srvb`).
- **Mechanism:** both check `allowWrites` but never `enforceAllowedPackageForObjectUrl`. A baseline
  `write` user can expose (or take offline) an OData service whose package is outside the allowlist
  — the one place baseline write crosses the package boundary. Same bug *class* as the merged R9.
- **Fix:** resolve the binding's package via the `servicebinding.v2+xml` `packageRef` and call
  `enforceAllowedPackageForObjectUrl(...)` before publish/unpublish.
- **Test:** publish on an out-of-allowlist binding is refused and never reaches the publish POST.
- **Effort:** S–M. *(Quick sibling of the R9 work; reuses the same gate helper.)*

**R10 — `apply_quickfix` = arbitrary authenticated POST under read scope — Med — all**
- **Current status (2026-07-08):** closed by [#489](https://github.com/arc-mcp/arc-1/pull/489).
- **Where:** [`devtools.ts:698`](../src/adt/devtools.ts) (`http.post(proposal.uri, body)`), policy
  [`policy.ts:124`](../src/authz/policy.ts) (`scope: read`), schema
  [`schemas.ts:819`](../src/handlers/schemas.ts) (`proposalUri: z.string().optional()`).
- **Mechanism:** `proposalUri` is an unconstrained string POSTed verbatim with a caller-controlled
  XML body, gated only by `checkOperation(Read)` — no `/sap/bc/adt/quickfixes/` allowlist (contrast
  `getRevisionSource`, which prefix-guards). Host is fixed by `buildUrl` (not SSRF). A read-only
  token can drive an authenticated POST to any `/sap/bc/adt/*` path; weaponization into a state
  change is theoretical (needs an ADT endpoint that mutates on this exact POST shape).
- **Fix:** prefix-guard `proposalUri` to `/sap/bc/adt/quickfixes/` at the sink + a defense-in-depth
  schema regex (`z.string().max(512).regex(/^\/sap\/bc\/adt\/quickfixes\//)`).
- **Test:** `apply_quickfix` with a non-quickfix `proposalUri` returns an error and sends zero POSTs.
- **Effort:** S.

**R9 (gCTS) — finish the git pull/push gate — Med — allowGitWrites** 🟡
- **Current status (2026-07-08):** closed by [#490](https://github.com/arc-mcp/arc-1/pull/490).
- **Where:** gCTS `pullRepo` [`gcts.ts:206`](../src/adt/gcts.ts) and `commitRepo`; handler
  [`intent.ts:6936`](../src/handlers/).
- **Historical remaining work before [#490](https://github.com/arc-mcp/arc-1/pull/490):** the merged
  R9 ([#389](https://github.com/arc-mcp/arc-1/pull/389)) gated abapGit only. gCTS repos can span
  multiple packages, so the gate needed the per-repo object/package list (`listRepos` → match `rid`
  → gate `.package`, fail-closed under a restricted allowlist when the package can't be resolved).
- **Effort:** M.

### 6.4 Identity / fallback hardening

**R6 — Non-strict PP fallback runs as the shared service account — Med — PP only** 📄
- **Current status (2026-07-08):** default PP mode fails closed after [#488](https://github.com/arc-mcp/arc-1/pull/488);
  explicit `SAP_PP_STRICT=false` remains an operator opt-in fallback posture.
- **Where:** [`server.ts:636`](../src/server/server.ts).
- **Mechanism:** `SAP_PP_STRICT=false` (default) falls through to `defaultClient` on PP failure —
  privilege escalation + wrong SAP-audit identity, inducible by forcing PP failure.
- **Fix options:** make `SAP_PP_STRICT=true` the default for multi-user/HTTP mode; **or** when
  falling back, downgrade the request to read-only and tag the tool-call audit
  `identity=service-account-fallback`.
- **Status:** default fail-closed behavior shipped in [#488](https://github.com/arc-mcp/arc-1/pull/488);
  explicit non-strict fallback remains an operator exception.
- **Effort:** closed for the default behavior; downgrade-on-fallback would be separate optional hardening.

### 6.5 Info-leak & secrets-at-rest

**R5 — File/BTP audit sinks do zero redaction — Med — file/btp sink** 📄
- **Current status (2026-07-08):** closed by [#493](https://github.com/arc-mcp/arc-1/pull/493) and
  private file mode from [#496](https://github.com/arc-mcp/arc-1/pull/496).
- **Where:** [`sinks/file.ts:31`](../src/server/sinks/file.ts) (raw `JSON.stringify(event)`) vs
  [`sinks/stderr.ts`](../src/server/sinks/stderr.ts) (which redacts).
- **Mechanism:** redaction lives only in `StderrSink`. Credentials don't leak (tool args are
  pre-sanitized), but SAP source/error snippets (`resultPreview`, always-on `errorBody`, full bodies
  under `ARC1_LOG_HTTP_DEBUG`) reach disk/BTP verbatim.
- **Fix:** centralize redaction in `Logger.emitAudit()` so every sink is covered; make the redactor
  recurse into nested objects.
- **Effort:** M.

**R14 — Detailed SAP errors recon oracle when explicitly enabled — Low — trusted debug / stdio / explicit opt-out**
- **Current status (2026-07-08):** mitigated by [#495](https://github.com/arc-mcp/arc-1/pull/495);
  HTTP now defaults to minimal errors via [#552](https://github.com/arc-mcp/arc-1/pull/552).
- **Where:** [`errors.ts:308`](../src/adt/errors.ts) (`extractLockOwner`, `classifySapDomainError`),
  [`intent.ts:651`](../src/handlers/) (`enrichWithSapDetails`).
- **Mechanism:** SAP error detail surfaced to the LLM/client includes another user's lock-owner
  **username** + transport id (T100 slots) and auth-object names; no opt-out. Lock-probing →
  valid-user + activity enumeration.
- **Fix:** add an opt-in `ARC1_MINIMAL_ERRORS` that strips identity slots (`details.user`/
  `details.transport`, the T100 variable dump) from client-facing errors while keeping them in the
  audit sink.
- **Effort:** M.

**R15 — Cleartext SAP source at rest — Low/Med — disk cache** 📄
- **Current status (2026-07-09):** file permissions are fixed by [#496](https://github.com/arc-mcp/arc-1/pull/496);
  `ARC1_CACHE=auto` uses memory for every transport; plaintext SQLite source remains the residual
  risk only when an operator explicitly sets `ARC1_CACHE=sqlite`.
- **Where:** [`sqlite.ts:19`](../src/cache/sqlite.ts) (no `mode:0o600`),
  [`file.ts:47`](../src/server/sinks/file.ts).
- **Mechanism:** the SQLite cache stores full ABAP source unencrypted when explicitly enabled. Before
  [#496](https://github.com/arc-mcp/arc-1/pull/496), cache DB and file sink creation also relied on
  default file permissions.
- **Residual mitigation:** private file mode is shipped and SQLite is explicit opt-in; use encrypted
  volumes for persistent SQLite, or keep `ARC1_CACHE=auto`/`memory`/`none` for IP-sensitive
  landscapes that cannot accept plaintext source in the service account's files.
- **Effort:** implemented default-closed posture; explicit persistent cache remains operator hardening.

**R7 — Silent `SAP_INSECURE` + path-encoding gaps — Low/Med — all** 📄
- **Current status (2026-07-08):** closed by [#491](https://github.com/arc-mcp/arc-1/pull/491) and
  [#494](https://github.com/arc-mcp/arc-1/pull/494).
- **Where:** [`http.ts:192`](../src/adt/http.ts) (insecure dispatcher, no warn),
  [`diagnostics.ts:324`](../src/adt/diagnostics.ts) (un-encoded `traceId`/`dumpId`).
- **Mechanism:** `SAP_INSECURE` disables TLS verification with no startup warning; a few diagnostics
  paths interpolate `traceId`/`dumpId` into ADT URLs without `encodeURIComponent` (bounded —
  same-host, read-only, GET-only; SAP 404s most traversals).
- **Fix:** loud `logger.warn` at startup when `insecure` is active (parity with the existing
  `disableSaml2` warning); `encodeURIComponent` the trace/dump path segments. (TLS doc caveat
  shipped in #391.)
- **Effort:** S.

### 6.6 Low hardening cluster

**R17 — four small items — Low — mixed**
- **API-key docs/compare not constant-time** ([`http.ts:273`](../src/server/http.ts)): switch
  `token === entry.key` to a length-checked `crypto.timingSafeEqual` helper (the DCR/state paths
  already do). Inconsistent, marginal over a network.
- **PR-title `${{ }}` into a `run:` shell** (`.github/workflows/test.yml`): move
  `github.event.pull_request.title` into an `env:` var. Low blast radius today (read-only token, no
  secrets in the `gate` job), but a latent foothold if the job ever gains secrets.
- **Unknown action/type skips the scope check**: an action with no `ACTION_POLICY` entry isn't
  scope-gated. Not reachable today, but a CI/lint guard asserting every dispatchable action has a
  policy would prevent a future ungated handler.
- **`change_package` compiles an unbounded `objectType` into a RegExp**
  ([`intent.ts:6884`](../src/handlers/)): escape with a literal matcher or bound the
  length. Impact bounded (matched only against SAP's own search response).
- **Effort:** S total.

### 6.7 Recommended remediation order

The original top picks (R2, R1/R3/R12, R4, R16) shipped in
[#392](https://github.com/arc-mcp/arc-1/pull/392)–[#395](https://github.com/arc-mcp/arc-1/pull/395).
Later hardening also closed R5, R7, R9-gCTS, R10, R14, and two R17 subitems.

Suggested order for the remaining items:

1. **R17 low hardening remainder:** switch API-key comparison in the auth path to a length-checked
   timing-safe comparison if still owned by ARC-1 after auth-module delegation, and bound or literalize
   the `change_package` object-type regex construction.
2. **R6 operational posture:** keep `SAP_PP_STRICT` default-closed for PP, and treat
   `SAP_PP_STRICT=false` as an explicit operator exception that should be documented per landscape
   when used.

---

## 7. What's already strong — do not re-audit

Confirmed closed by the review (full list in [`security-model.md`](security-model.md) §7); touch
only if a change is *in* one of these:

OIDC/XSUAA JWT validation (iss/aud/exp/sig, JWKS kid-match, fails closed, no `none`/HS-RS confusion)
· OAuth DCR `client_id` + state HMAC (HKDF-separated, `timingSafeEqual`, length guard) · SSRF
containment (host admin-fixed; `encodeURIComponent` + fixed prefix) · undici cross-origin
credential stripping · OAuth metadata host-poisoning resistance · structured-SQL allowlisting · XML
escaping in the DDIC/FUGR builders · the `withSafety()` clone (re-attaches all fields) · CORS
(off by default, exact `Set.has` match) · per-user credential stripping (`buildAdtConfig(perUser)`)
· per-instance cookie/CSRF jars · stdout discipline (no `console.log` on the MCP path). Supply
chain: `npm audit` clean, lockfile committed, Dockerfile non-root/multi-stage/selective-COPY, fork
PRs gated off SAP secrets, third-party actions SHA-pinned, OIDC publish scopes minimal,
`xs-security.json` scopes match `ACTION_POLICY` with a drift test.

---

## Appendix A — full register snapshot

The canonical, always-current register lives in [`security-model.md`](security-model.md) §5 (with
per-row `file:line` links). The status dashboard in §4 above mirrors it as of this report's date.

## Appendix B — the reusable deep-review harness

Wave 2 was driven by a reusable, ARC-1-tuned deep-security-review prompt with two tracks — **Track A**
(deepen & verify the known findings, hunt siblings, and *adversarially challenge the
"already-strong" controls*) and **Track B** (expand to the under-audited surface: git bridges, RAP,
BTP plane, MCP-protocol surface, CLI, concurrency/TOCTOU, supply chain, deployment) — plus
cross-cutting lenses (prompt-injection, cross-user, fail-open, TOCTOU, order-of-operations bypass,
resource exhaustion, secret/oracle leakage, supply chain), a strict adversarial-self-refutation
requirement per finding, and a structured per-finding output format. It can be re-run per-PR against
a diff using the §6 per-PR checklist in `security-model.md` as the trigger map, or sharded across
parallel agents for a full sweep. The prompt text is preserved in the project chat history;
re-materialize it there or regenerate from this section's description.

## Appendix C — references

- **PRs:** [#387](https://github.com/arc-mcp/arc-1/pull/387) (R8),
  [#388](https://github.com/arc-mcp/arc-1/pull/388) (R11),
  [#389](https://github.com/arc-mcp/arc-1/pull/389) (R9-abapGit),
  [#391](https://github.com/arc-mcp/arc-1/pull/391) (deployment docs).
- **Branches / commits:** `claude/harden-redirect-uri-canonical` `dbb018b2` ·
  `claude/clamp-unbounded-result-limits` `47b4b7d2` ·
  `claude/gate-git-pull-package-allowlist` `a63bb9fd` ·
  `claude/docs-deployment-security-caveats` `ca203e47`.
- **Docs:** [`security-model.md`](security-model.md) (threat model, invariants, register, checklist)
  · [`../docs_page/security-guide.md`](../docs_page/security-guide.md) (operator hardening) ·
  [`../docs_page/authorization.md`](../docs_page/authorization.md) ·
  [`../docs_page/enterprise-auth.md`](../docs_page/enterprise-auth.md) ·
  [`../SECURITY.md`](../SECURITY.md) (reporting policy).

## Changelog
- **2026-06-10** — Initial report. Documents Wave 1 + Wave 2, PRs #387/#388/#389/#391, and the open
  roadmap (R1–R7, R10, R12–R17, R9-gCTS). Mirrors `security-model.md` register R1–R17.
- **2026-06-11** — Remediation update. R2 ([#392](https://github.com/arc-mcp/arc-1/pull/392)),
  R1/R3/R12 ([#393](https://github.com/arc-mcp/arc-1/pull/393)), R4 ([#394](https://github.com/arc-mcp/arc-1/pull/394)),
  R16 ([#395](https://github.com/arc-mcp/arc-1/pull/395)) merged on top of R8/R9-abapGit/R11 —
  **all High findings closed.** Updated §1/§4/§6 status; open set is now R5, R6, R7, R9-gCTS, R10,
  R13, R14, R15, R17 (all Med/Low). These fixes shipped in **v0.9.14**.
- **2026-07-08** — SEC-03 reconciliation against `origin/main` `4ed0dcf0`. Updated §1/§4/§6 to
  reflect merged fixes for R5/R6/R7/R9-gCTS/R10/R14 and the closed R17 PR-title/ACTION_POLICY
  subitems. Kept R17 partial for API-key timing and `change_package` regex hardening.
- **2026-07-09** — R15 default-closed cache posture. `ARC1_CACHE=auto` now uses memory for every
  transport, and SQLite persistence remains explicit opt-in with source-at-rest warnings and
  encrypted-volume guidance.
