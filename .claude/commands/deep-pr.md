# Deep PR — review an external pull request against real sources & ARC-1's invariants

Deeply review a community pull request on **`marianfoo/arc-1`** before it merges. The whole point: **verify the PR is correct, safe, and actually does what it claims — from your own evidence, not the PR description.** External PRs touch the most dangerous surfaces (write paths, schemas, the safety system); a PR body that says "verified live on 8.16" is a claim to check, not a fact to trust. ARC-1's worst regressions come from accepting ADT behavior on faith.

Use this for any non-trivial external PR (bug fix, new ADT op, schema change, safety change). For a dependency bump or a one-line doc fix, a normal read is enough.

The output is a **review verdict + paste-able review comments + a dossier** — not a commit. You **never push to the contributor's branch, never approve via `gh`, never post automatically** (per repo policy: hand back paste-able markdown; the user acts on origin = `marianfoo`).

---

## Input

A PR number or URL (e.g. `380` or `https://github.com/marianfoo/arc-1/pull/380`).

---

## The prime directive

**No verdict until you have verified the PR's correctness independently.** That means: the diff does what the title/body says; every SAP/ADT fact the PR asserts is confirmed against the contract and (for behavior changes) live; the security & architectural invariants below all still hold; and the tests actually cover the new paths. Until then you are still reviewing, not concluding.

A `200 OK` in the PR author's transcript does **not** mean the parameter was honored — re-run it yourself. "All tests pass" is something you confirm by running them, not by reading it. **For any object-write change, a successful live `SAPActivate` is the definitive correctness check** (RAP CCDEF/CCIMP placement, DDIC table class, behavior-pool rules surface only there).

---

## Research Sources (same sources `/deep-feature` uses)

All `~/DEV/*` repos are **read-only references** — never modify them.

| Source | Where | Use it for |
|--------|-------|------------|
| **The PR itself** | `gh pr view <n> --json ...,isCrossRepository,headRepositoryOwner,files,reviews,comments`; `gh pr diff <n>` | The diff, the author, cross-repo fork?, the linked issue, the author's claims to verify |
| **The linked issue** | `gh issue view <linked>` + its dossier in `research/issues/` (run `/deep-issue` first if none exists) | What problem the PR *should* solve — judge the diff against the real need, not the PR's framing |
| **ARC-1 project guide** | `CLAUDE.md` (esp. **Security & Architectural Invariants**, **Authorization & Safety System**, **three-file schema sync**), `INFRASTRUCTURE.md` | The invariant checklist below; conventions; the 3 live systems |
| **Current HEAD code** | the files the diff touches + their neighbors (`grep -a` for `intent.ts`) | Does the change fit existing patterns? Does it break an adjacent path (create/update/delete/activate, the `withSafety()` clone)? |
| **ARC-1 live research notes** | `docs/research/`, `research/abap-types/` | Has the PR's SAP assumption already been proven/disproven here? |
| **Eclipse ADT — apidoc + contracts** | `~/DEV/arc-1-eclipse-adt/` (`api/01..20-*.md`, apidoc) | **The real ADT contract** the PR must match — URIs, media types, request/response shapes. The deciding source when the PR's claim and the contract disagree |
| **SAP ADT language server** | `~/DEV/arc-1-lsp/` (`vendor/adt-ls`, `docs/adt-ls-*`) | How SAP's own server calls it — second witness |
| **Reference ADT-over-MCP impls** | `~/DEV/mcp-abap-adt/`, `~/DEV/mcp-abap-adt-fr0ster/` | How others implement the same op; whether the PR reinvents or contradicts a known-good approach |
| **ABAP language reference** | `~/DEV/abap-docs/docs/` | ABAP semantics when the diff touches language constructs |
| **SAP docs / Notes (MCP)** | `sap-docs` MCP (`search`, `fetch`, `sap_community_search`, `abap_feature_matrix`) + `sap-notes` MCP (`search`, `fetch`) | Confirm SAP-side facts / Note numbers the PR cites |
| **Live SAP systems** | `arc1-cli call <Tool> ...`, `npm run probe`, `npm run test:integration`. Systems: **NW 7.50** (`npl`), **758** (`a4h`), **816** (`a4h-2025`) — `INFRASTRUCTURE.md` | **Ground truth.** Re-run the PR's own verification; confirm it on the releases it claims (and the oldest one if release-sensitive) |

---

## Phase 1: Frame & fetch

1. **Read the PR** — `gh pr view <n>` for title/body/author/`isCrossRepository`/files/reviews/comments, `gh pr diff <n>` for the full diff. Note whether it's a **cross-repo fork** PR (most external ones are) and **what it claims** (the "verified live" table, "all tests pass", etc.) — these become your verification checklist.
2. **Understand the goal** — read the linked issue and its `research/issues/` dossier (if none, run **`/deep-issue`** on it first; you can't judge a fix without knowing the real bug). Judge the diff against the actual need.
3. **Scope the review** — code change vs. docs/skills-only (a large skills-only PR like #283 is reviewed for accuracy & sources, not for ADT correctness/tests). Set the depth accordingly.

## Phase 2: Get the diff locally & run the gates

4. **Check out in isolation.** The DEV tree accumulates other WIP — don't switch branches in place. Prefer a worktree:
   ```bash
   git worktree add ../arc-1-pr-<n> && cd ../arc-1-pr-<n> && gh pr checkout <n>
   ```
   (or just `gh pr diff <n>` for a read-only pass). Cross-repo PRs check out fine via `gh pr checkout`.
5. **Run the gates yourself** — don't trust "all green":
   ```bash
   npm ci && npm run typecheck && npm run lint && npm test
   ```
   Record what actually passed/failed.

## Phase 3: Correctness review (independent of the PR's claims)

6. **Diff does what it says** — walk every hunk. Does it match the title/body? Any scope creep, dead code, leftover debug, `console.log` (forbidden — corrupts MCP stdout), `any` types, commented-out code?
7. **Verify every SAP/ADT fact** the PR asserts against `~/DEV/arc-1-eclipse-adt` + a reference repo. If the PR changes an endpoint URI, media type, or payload, confirm the contract — the most common external-PR error is a plausible-but-wrong ADT assumption.
8. **Re-run the PR's live verification.** Don't read the author's table — reproduce it via `arc1-cli call ...` on the release(s) it names. **For object-write changes, perform a real `SAPActivate` on a live system** and read the object back. Verify response *content*, not just `200`. Check the oldest release (7.50) too when the area is release-sensitive (DDIC routing, locks, activation, lint, release detection).
9. **Adjacent paths** — does the change break a sibling op? Create/update/delete/activate, read/write, and especially the **`withSafety()` clone** (it bypasses the constructor — every new instance field must be re-attached, cf. #333).

## Phase 4: Security & architectural invariants (the part external PRs get wrong)

Check each — these are `CLAUDE.md` invariants, and the reason this server can be trusted:

- [ ] **Every new ADT endpoint goes through `checkOperation(this.safety, OperationType.X, ...)`** — no unguarded `http.{get,post,put,delete}`. Mutations require `allowWrites`; transport/git writes their extra flag.
- [ ] **Scope policy** — any new tool/action is in `ACTION_POLICY` (`src/authz/policy.ts`) with the right scope, and pruned from the tool list when the scope is absent.
- [ ] **Package gating** — every mutating op resolves the object's **real** package and calls `enforceAllowedPackageForObjectUrl` (create/update/delete/surgery, activation, `change_package`), fail-closed.
- [ ] **Three-file schema sync** — any tool surface change touches all of `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod), `intent.ts` (handler); `batch_create` items updated separately. A field missing from `tools.ts` is invisible to LLMs.
- [ ] **Per-user auth never inherits shared creds** — new Layer B fields respect the `perUser` strip in `buildAdtConfig`.
- [ ] **stdout is sacred** (stderr-only logging), **no secrets committed** (`.env`/cookies), sensitive fields redacted.
- [ ] **Typed errors** (`AdtApiError`/`AdtSafetyError`/`AdtNetworkError`) with **LLM-friendly hints**, not raw stack traces.

Consider running **`/security-review`** on the checked-out diff for an independent pass, and **`/code-review`** for correctness/cleanup findings — then fold their results into your verdict.

## Phase 5: Test adequacy

10. **Every new path tested?** Unit tests mirror source structure and mock undici; integration/e2e added when SAP interaction changes. Skip policy honored (`tests/helpers/skip-policy.ts` — no bare `if (!x) return;` / empty catches). Tests assert the *right* thing (not written to match buggy code). For the `withSafety()` clone, a test asserts the new field is the same instance on the clone.

### Phase 2–5 exit gate — do not write the verdict until all are YES:
- [ ] I ran typecheck + lint + test myself and recorded the result
- [ ] I verified the PR's SAP facts against the ADT contract, and re-ran its live verification (a real `SAPActivate` for write changes)
- [ ] I walked every hunk for correctness, scope creep, and adjacent-path breakage
- [ ] I checked every security/architectural invariant above
- [ ] I confirmed the tests genuinely cover the new paths

## Phase 6: Verdict, review comments & dossier

1. **Write the dossier** — **`research/pull-requests/<n>-<short-slug>.md`** (mirrors `research/issues/`): the verdict, what you ran and observed (gate output + live `arc1-cli` results), invariant findings, and each issue with `file:line`.
2. **Verdict** — one of **APPROVE** / **REQUEST CHANGES** / **COMMENT**, with a one-paragraph rationale grounded in the evidence above.
3. **Paste-able review** — a fenced markdown block the user can paste into the GitHub review: a summary, then findings as `**file:line** — finding + suggested change`, ordered blocking-first. Be specific and kind to the external contributor; cite the contract / Note / release that backs each point.
4. **Hand back, don't act** — present the verdict + the paste-able review. **Do not `gh pr review`/approve/merge, do not push to the fork branch, do not post comments.** If the fix is small and the user asks, you may prepare a diff suggestion in the block — but the user pushes it (to origin, `marianfoo`), not you. Clean up the worktree (`git worktree remove ../arc-1-pr-<n>`) when done.

---

## Guardrails & notes

- **Verify-first is non-negotiable** — re-run the PR's claims; never accept "verified live" or "tests pass" on faith.
- **Never push, approve, post, or merge** — return paste-able review markdown; the user acts on origin (`marianfoo`). No force-push, no commits onto a contributor's PR branch.
- Work on a **worktree or `gh pr diff`**, never switch branches in the shared DEV tree; stage explicitly, never `git add -A`.
- `~/DEV/arc-1-eclipse-adt`, `~/DEV/arc-1-lsp`, `~/DEV/mcp-abap-adt*`, `~/DEV/abap-docs` are **read-only**.
- If a live system is unreachable, see `INFRASTRUCTURE.md` before concluding the PR's behavior is wrong.
- **Related:** `/deep-issue` (validate the bug the PR targets), `/code-review` + `/security-review` (focused passes to fold in), `/verify` (drive the app to confirm a fix), `/deep-feature` (if the PR needs substantial rework you take over).
