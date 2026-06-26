# Fix the `auth-rate-limit.test.ts` full-suite flake (per-request server churn)

## Overview

One full-suite run (2026-06-12, during PR #406 verification) failed exactly two tests in
`tests/unit/server/auth-rate-limit.test.ts` — both passed in isolation and on re-run, both failed
*fast* (13ms/2ms vs a normal multi-request runtime), and both are the heaviest users of the
`fireJsonPost` helper, which creates a **new HTTP server per request** (`listen(0)` → 1 request →
`close()`; the bug_006 test alone churns 16 server lifecycles). The sibling helper `fireRequests`
in the same file already uses the correct one-server-for-N-requests lifecycle and none of its tests
flaked. This plan removes the churn (one server per test), adds error context + a bounded
transport-level retry so any future occurrence is self-diagnosing instead of a bare reject, and
records the validation protocol. Evidence and hypothesis ranking:
[docs/research/2026-06-12-auth-rate-limit-test-flake.md](../../research/2026-06-12-auth-rate-limit-test-flake.md) — cite it,
don't re-derive.

Honest framing baked into this plan: the flake was **not reproduced** (0/25 isolated, 0/3 full
suites); the fix targets the best-evidenced structural mechanism (H1: transient socket error under
full-suite load rejecting the bare per-request promise) and is a pure consistency win with
`fireRequests` even if H1 were wrong. No production code changes; rate-limit assertions stay
byte-identical.

## Context

### Current State

- `tests/unit/server/auth-rate-limit.test.ts` (352 lines, 16 tests) has two HTTP helpers with
  divergent lifecycles: `fireRequests` (~line 34) — ONE `http.createServer(app)` + `listen(0)` for
  N requests, close once; `fireJsonPost` (~line 192) — a NEW server per call, closed in `finally`,
  with `req.on('error', reject)` rejecting bare (no path/iteration/syscall context).
- The two historically-flaky tests both live in `describe('/authorize JSON-RPC dispatch (Copilot
  Studio MCP fix via skip())')` and call `fireJsonPost` in loops:
  `it('regression (bug_006): POST /authorize with falsy jsonrpc still uses the OAuth cap')`
  (~line 268; 4 IPs × 4 requests = 16 server lifecycles) and
  `it('JSON-RPC /authorize and /mcp use independent stores (separate caps each)')` (~line 294;
  7 lifecycles). Two more tests in that describe use the helper with fewer calls — the dispatch
  describe has 4 tests total and FIVE textual `fireJsonPost` call sites (~249, ~261, ~284, ~306,
  ~311; the independent-stores test calls from two sites).
- Hypotheses H2 (60s-window timing) and H3 (cross-test bucket pollution) are ruled out in the
  dossier — fresh app+store per test, distinct IPs, <1s runtimes vs a 60s fixed window.
- `src/server/auth-rate-limit.ts` is NOT implicated; nothing in this plan touches `src/`.

### Target State

`fireJsonPost`'s per-request server churn is gone: each test obtains one listening server and a
`post()` closure, fires its requests through it, and closes once. Transport-level errors (no HTTP
response at all) are retried once for known-transient syscalls and otherwise rejected with a
message naming the path, request index, and `err.code`. The flake's most plausible mechanism is
structurally removed; if anything ever fails there again, the failure text says exactly what broke.

### Key Files

| File | Role |
|------|------|
| `tests/unit/server/auth-rate-limit.test.ts` | The only file changed: helpers + the 5 call sites in the dispatch describe |
| `tests/unit/server/mcp-rate-limit.test.ts` | Verify-only: confirmed it has NO references to this file or its helpers (its header points at dispatch-rate-limit.test.ts); unaffected |
| `src/server/auth-rate-limit.ts` | Verify-only: must NOT change |
| `docs/research/2026-06-12-auth-rate-limit-test-flake.md` | Dossier — status flipped when this lands |

### Verified Live Evidence

Not SAP-touching (test infrastructure only). Reproduction attempts on main @ `0855e2c6`
(2026-06-12, recorded in the dossier): 25× isolated `npx vitest run
tests/unit/server/auth-rate-limit.test.ts` → 0 failures; 3× full `npm test` (3,754 tests) →
0 failures. The single observed occurrence (PR #406 gate run) failed the two named tests in
13ms/2ms with truncated failure text.

### Design Principles

1. **Remove the mechanism, don't mask the symptom** — no `test.retry()`/vitest retries (they would
   hide real limiter regressions). The only retry permitted is at the HTTP-transport level (request
   errored before ANY response), once, for `ECONNRESET`/`ECONNREFUSED`/`EADDRNOTAVAIL`, with a
   `console.warn` so it is visible in output. A 429 (or any HTTP response) is NEVER retried — that
   is the behavior under test.
2. **Assertions stay byte-identical** — the rate-limit semantics of all 16 tests are untouched;
   only the transport plumbing changes.
3. **Mirror the in-file prior art** — `fireRequests` is the lifecycle template; the refactored
   helper should make the two visibly consistent.
4. **Test-only change** — `test(server):` commit, no release, no production diff. Release-invariant
   by construction (no SAP interaction).

## Development Approach

Mechanical refactor with the suite as the harness: restructure the helper, update the five call
sites in the dispatch describe one test at a time, run the file after each. The "failure path" here
is the helper's own error path — covered by asserting the new error message shape via a request to
a deliberately-closed server (one new unit test). Then run the flake-hunt protocol (Task 3) to
demonstrate stability under the same conditions used for the baseline. Scope guard: do NOT touch
`fireRequests`' lifecycle (already correct) beyond adopting the same error-context wrapper, and do
NOT modify `src/`.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Replace `fireJsonPost`'s per-request server with a one-server-per-test helper

**Files:**
- Modify: `tests/unit/server/auth-rate-limit.test.ts` (helper at ~192 + 5 call sites in
  `describe('/authorize JSON-RPC dispatch (Copilot Studio MCP fix via skip())')` at ~172–313)

`fireJsonPost` creates and tears down an `http.Server` for every request (16 lifecycles in the
bug_006 test) — the front-runner mechanism for the one observed full-suite flake (dossier H1) and
inconsistent with the in-file `fireRequests` template. Replace it with a one-server closure API.

- [ ] Replace `fireJsonPost(app, path, body, ip)` with a `withJsonServer` helper directly above the
      dispatch describe. Shape (embed exactly; adjust only if compilation requires):

      async function withJsonServer(app: express.Express): Promise<{
        post: (path: string, body: object, ip?: string) => Promise<{ status: number; headers: Record<string, string> }>;
        close: () => Promise<void>;
      }> { /* one http.createServer(app) + listen(0); post() reuses the port; close() once */ }

      `post()` keeps the exact request shape of today's `fireJsonPost` (JSON body, Content-Type,
      Content-Length, `X-Forwarded-For: ip` defaulting to `'10.7.7.1'`).
- [ ] Update the five call sites in the dispatch describe to
      `const srv = await withJsonServer(app); try { ... await srv.post(path, body, ip) ... } finally { await srv.close(); }` —
      assertions and request sequences byte-identical (e.g. bug_006 still fires 4×4 across its four
      IPs; independent-stores still fires its 6-request sequence + the 7th expecting 429).
- [ ] Internal request counter: `post()` tracks an incrementing index per server for error messages
      (Task 2 uses it).
- [ ] Run `npx vitest run tests/unit/server/auth-rate-limit.test.ts` — 16/16 green, then
      `npm test` — all green.

### Task 2: Error context + bounded transport-level retry in both helpers

**Files:**
- Modify: `tests/unit/server/auth-rate-limit.test.ts` (`withJsonServer.post` from Task 1, and
  `fireRequests` at ~34)

The observed flake failed with truncated, context-free output. Make any future transport failure
name itself, and absorb the known-transient syscalls once (transport errors only — an HTTP response,
including 429, is the system under test and must never be retried).

- [ ] In `withJsonServer.post`: on `req.on('error', err)`, if `err.code` is one of
      `ECONNRESET | ECONNREFUSED | EADDRNOTAVAIL` AND this is the first attempt for this request,
      `console.warn(\`auth-rate-limit test: transient \${err.code} on \${path} request #\${i}, retrying once\`)`
      and retry the same request once; otherwise reject with
      `new Error(\`POST \${path} request #\${i} failed: \${err.code ?? err.message}\`)`.
- [ ] Apply the same error-context wrapper (context message; retry optional but consistent) to
      `fireRequests`' inner `req.on('error', reject)` (~line 73) — its lifecycle is already correct,
      only the bare reject changes.
- [ ] Add one failure-path unit test (~1 test) in a new `describe('test helpers')`:
      create `withJsonServer`, `await close()` it, then `post()` → expect the rejection message to
      match `/POST \/authorize request #\d+ failed/` — no trailing `: ` since the retry path's
      message is "failed after retry: <code>" (proves the context wrapper; the retry path is
      exercised implicitly since ECONNREFUSED to a closed server retries once then rejects).
- [ ] Run `npx vitest run tests/unit/server/auth-rate-limit.test.ts` — 17/17 green, then
      `npm test` — all green.

### Task 3: Flake-hunt validation + dossier closeout

**Files:**
- Modify: `docs/research/2026-06-12-auth-rate-limit-test-flake.md` (status + results)

Stability can't be proven, but the baseline protocol from the dossier can be re-run on the fixed
code and recorded. This is the plan's acceptance evidence.

- [ ] Run the isolation loop: `for i in $(seq 1 25); do npx vitest run
      tests/unit/server/auth-rate-limit.test.ts 2>&1 | grep -E "Tests  "; done` — expect 25× all-pass.
- [ ] Run 3× full `npm test` — expect 3× all-pass (this matches the pre-fix baseline; the claim is
      "no regression + mechanism removed", not "flake proven gone" — say so honestly).
- [ ] Update the dossier: Status → "Implemented — churn removed + diagnosability added; see
      docs/plans/completed/2026-06-12-fix-auth-rate-limit-test-flake.md", append the post-fix protocol results,
      and note that H1 remains unproven-but-removed.
- [ ] Run `npm run typecheck` and `npm run lint` — clean.

### Task 4: Final verification

- [ ] Run full test suite: `npm test` — all tests pass (count unchanged +1: the new helper
      failure-path test).
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] `git diff src/` is EMPTY — test-only change (the plan's core constraint).
- [ ] Grep the file for `fireJsonPost` — zero residual references (helper fully replaced).
- [ ] Commit message: `test(server): one server per test in auth-rate-limit (de-flake) + diagnosable
      transport errors` — no release.
- [ ] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed
      plans sit one directory deeper — the dossier link at the top becomes `../../research/...`).
