# SEC-14 — DNS-Rebinding / Host-Header Validation (HTTP transport)

**Status: DEFERRED (2026-06-25).** Fully implemented + reviewed on branch
`feat/sec-14-dns-rebinding` (PR #500, closed-deferred), then parked by product decision. This doc is
the decision record + resume guide. Nothing from it is on `main`; the code lives on the branch.

## TL;DR decision

We built, hardened, and live-verified Host-header validation for the HTTP transport, then **decided
not to merge it** — not for code reasons, but because it adds operator setup surface
(`ARC1_ALLOWED_HOSTS`) for a threat that ARC-1's **mandatory HTTP auth already mitigates**. Keeping it
out makes ARC-1 simpler to deploy correctly. The branch is preserved; reopen PR #500 to resume.

## Why deferred (the reasoning, so we don't re-litigate it)

The deciding fact: **the HTTP transport already refuses to start without MCP auth**
(`src/server/config.ts` — requires `ARC1_API_KEYS` / `SAP_OIDC_ISSUER` / `SAP_XSUAA_AUTH`, unless the
operator explicitly sets `allowHttpNoAuth`). That mandatory auth is the *primary* DNS-rebind control:
a rebind attacker reaching the server is rejected with `401` before any tool call.

So Host validation is only load-bearing in the **no-auth HTTP mode** (`allowHttpNoAuth`), which a real
deployment should never use. For every supported deployment it is redundant defense-in-depth:

| Deployment | DNS-rebind already mitigated by | SEC-14 marginal value |
|------------|---------------------------------|-----------------------|
| **stdio** (default, most usage) | no HTTP server exists | none |
| **BTP / CF** (the known remote deploy) | gorouter Host-filters unregistered routes **+** mandatory XSUAA | ~none (redundant) |
| **self-hosted HTTP** | mandatory MCP auth (`401`) | thin defense-in-depth |
| **`allowHttpNoAuth` + local/exposed bind** | nothing else | this is the only real value |

The honest cost is **setup surface**, not code: `ARC1_ALLOWED_HOSTS` is one more knob to learn and
potentially misconfigure (e.g. a multi-route BTP app or a Host-rewriting proxy would 403 until set).
Since mandatory auth covers the threat, omitting it keeps the deploy story shorter. **No regression
from deferring — the primary control (mandatory HTTP auth) is unaffected and stays in place.**

## What was built (on `feat/sec-14-dns-rebinding`, PR #500)

A complete, reviewed, CodeQL-clean implementation — resume from here:

- **Middleware** in `applySecurityMiddleware` (`src/server/http.ts`), mounted before CORS/OAuth/MCP,
  emitting a `host_rejected` audit event (`level:'warn'`, host/method/path).
- **Auto-protect default:** with `ARC1_ALLOWED_HOSTS` unset, every concrete bind accepts the loopback
  Host values (a rebind attacker cannot forge them) **plus** the advertised public host derived from
  `ARC1_PUBLIC_URL` / `VCAP_APPLICATION` (so reverse-proxy / BTP work no-config); arbitrary Hosts are
  rejected; `*` disables. (This replaced an interim fail-closed `[]` that 403'd localhost dev and the
  BTP gorouter.)
- **Header canonicalization** (port / IPv6 brackets / case / trailing dot) in one place;
  `isLoopbackBind` covers all of `127.0.0.0/8` + `::1` (via `node:net` `isIP`).
- **`/health` exempt** — infra probes (CF Diego, k8s `httpGet` liveness which defaults the Host to the
  pod IP, load balancers) hit it directly with a non-loopback Host; it returns only `{status:ok}`.
- **ReDoS-safe** trailing-dot stripping (backward index walk, not `/\.+$/`) — cleared CodeQL
  `js/polynomial-redos`.
- **Config:** `ARC1_ALLOWED_HOSTS` in `src/server/{config,types}.ts`; `host_rejected` in
  `src/server/audit.ts`.
- **Tests:** `tests/unit/server/http-security-headers.test.ts` (28); **docs:** security-guide §11,
  configuration-reference, security-model (A4 residual risk), `.env.example`, AGENTS.

### Commits (newest first)
- `361c7dec` fix: remove polynomial-ReDoS regex in Host normalization (CodeQL)
- `87f8d550` fix: exempt `/health` from Host validation (infra probes send a non-loopback Host)
- `be42c99c` fix: auto-protect default + header canonicalization (adversarial-review fixes)
- `896e693e` feat: initial DNS-rebinding / Host-header validation
- `9ddd440f` docs(plan): SEC-14 ralphex plan (on-branch, `docs/plans/completed/`)

### Adversarial review journey (Codex + live verification)
Review found: fail-open on `0.0.0.0`; `isLoopbackBind` missing `127/8`; CORS answered preflight before
the Host check; `ARC1_PUBLIC_URL` not folded into the allowlist; `host_rejected` emitted before any
rate-limiter. **FALSE-POSITIVE:** X-Forwarded-Host trust (middleware uses `req.headers.host` only).
All real findings fixed; verified live on a real `0.0.0.0` listener (`localhost`→200, `evil.com`→403,
`ARC1_PUBLIC_URL` host→200, `/health` exempt). Final: CodeQL 0 alerts, CI green.

## To resume later
1. Reopen PR #500, or `git rebase main` the `feat/sec-14-dns-rebinding` branch (it has all of the
   above incl. the on-branch plan at `docs/plans/completed/sec-14-dns-rebinding-host-validation.md`).
2. Re-confirm the merge rationale still holds (is a no-auth HTTP deployment mode now real? If yes,
   SEC-14 becomes worth merging).
3. Open follow-ups if picked up — both have the `ARC1_ALLOWED_HOSTS` workaround, both deferred:
   - **Multi-route BTP:** fold *all* `VCAP application_uris` (not just `[0]`) into the allowlist so a
     >1-route app doesn't 403 its non-advertised route.
   - **`host_rejected` flood:** the audit emits before any rate-limiter — throttle/sample it for the
     self-hosted directly-exposed case (on BTP the gorouter filters bad Hosts first, so it ~never
     fires there).
4. Decide whether `/health` should be the only exempt route (it is today) — fine as-is.
