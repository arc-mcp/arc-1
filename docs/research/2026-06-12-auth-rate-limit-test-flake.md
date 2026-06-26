# Research: `auth-rate-limit.test.ts` full-suite flake

**Date:** 2026-06-12
**Status:** Implemented — churn removed (one server per test) + diagnosability added; see
`docs/plans/completed/2026-06-12-fix-auth-rate-limit-test-flake.md`. Post-fix protocol (main @ `c646c68a`):
25/25 isolated runs pass; 3/3 full `npm test` (3,764 tests) pass — same all-green as the pre-fix
baseline, so the claim is **"mechanism removed + no regression"**, NOT "flake proven gone" (H1
remains unproven-but-structurally-removed). Any future occurrence now names its path, request index,
and syscall instead of failing bare.

## The observation (one occurrence, 2026-06-12, during PR #406 verification)

One full `npm test` run failed exactly two tests; both passed in isolation (16/16) and on an
immediate full-suite re-run (3722/3722):

```
❯ tests/unit/server/auth-rate-limit.test.ts (16 tests | 2 failed) 82ms
  × regression (bug_006): POST /authorize with falsy jsonrpc still uses the OAuth cap  13ms
  × JSON-RPC /authorize and /mcp use independent stores (separate caps each)  2ms
```

Notable: **fast failures** (13ms / 2ms — a passing bug_006 run does 16 HTTP round-trips and takes
far longer), the failure text was not captured (log truncation), and the two failing tests are
exactly the two heaviest users of the `fireJsonPost` helper.

## Reproduction attempts (main @ 0855e2c6, this machine)

- 25× sequential isolated runs of the file: **0 failures**.
- 3× full `npm test` (3,754 tests each): **0 failures**.

→ Rare flake (≲1 in ~6+ full-suite runs historically; not on demand). The plan therefore cannot rest
on a reproduced root cause; it must (a) remove the structural defect that best explains the
signature and (b) make any future occurrence self-diagnosing.

## Code analysis — the structural defect

`tests/unit/server/auth-rate-limit.test.ts` has two HTTP helpers with **divergent lifecycles**:

- `fireRequests` (line 34): creates **one** `http.Server` (`listen(0)`), fires N requests through
  it, closes once. Used by the basic limiter tests — none of which flaked.
- `fireJsonPost` (line 192): creates a **new server per request** — `listen(0)` → one request →
  `server.close()` — inside the per-request promise; `req.on('error', reject)` turns any transient
  socket error into a test failure with no context.

The two flaky tests hammer that per-request lifecycle hardest:
- bug_006 (line 268): 4 IP variants × 4 requests = **16 listen/connect/close cycles** in one test.
- independent-stores (line 294): 7 cycles.

### Hypotheses, ranked

| # | Mechanism | Fits the signature? | Verdict |
|---|---|---|---|
| **H1** | Per-request server churn: under full-suite load (parallel vitest workers, heavy socket traffic), a transient `connect`/`listen` error (ECONNRESET/ECONNREFUSED/EADDRNOTAVAIL during ephemeral-port pressure) rejects the bare promise → instant test failure | **Yes** — explains fast-fail (2ms/13ms), full-suite-only occurrence, and why only the per-request-server tests failed | **Front-runner** |
| H2 | express-rate-limit window timing (60s fixed window resets mid-test) | No — each test builds a fresh app/store; tests run <1s; a fresh store's reset fires 60s after creation | Implausible |
| H3 | Cross-test bucket pollution (shared IP keys) | No — vitest isolates module registries per file; within the file each test builds a fresh app; bug_006 uses distinct IPs per variant | Implausible |
| H4 | `captureAuditEvents` sink leak (sinks registered per test, never removed — line 17) | No — neither flaky test registers a capture sink; the leak only costs wasted writes | Non-cause (hygiene note only) |

Supporting H1: Node's `server.close()` is awaited per request, so each cycle also races socket
teardown (`TIME_WAIT` accumulation across 3,754-test runs); and an `Error: connect ECONNRESET`
rejection produces precisely an assertion-less fast failure that a truncated reporter line (`× …
2ms`) would show.

## Fix direction (for the plan)

1. **Remove the churn:** rewrite `fireJsonPost` to the `fireRequests` lifecycle — one server per
   test (helper returns `{ post(path, body, ip), close() }` or takes a request list), eliminating
   15 of 16 listen/close cycles in bug_006. This is also a pure consistency fix with the
   neighboring helper, worth doing even if H1 were wrong.
2. **Make failures diagnosable:** wrap request errors with context (`path`, iteration, `err.code`)
   so the NEXT occurrence — if any — names its syscall instead of failing bare. Optionally retry
   once on the known-transient codes (ECONNRESET/ECONNREFUSED) *at the helper level* with a logged
   warning; do NOT use vitest retry (it would mask real limiter regressions).
3. **No assertion changes** — the tests' rate-limit semantics stay byte-identical.
4. **Validation protocol** (proving a negative): 25× isolated loop + 3× full suite (the harness used
   above, commands recorded here), plus reading the helper diff for lifecycle equivalence. State
   plainly in the PR that the flake was not reproduced and the fix targets the best-evidenced
   structural mechanism.

**Commit type:** `test(server):` — test-infrastructure only, no production change, no release.

## Non-goals

- `captureAuditEvents` sink-leak cleanup (H4) — harmless; note only.
- Touching `src/server/auth-rate-limit.ts` — nothing implicates production code.
