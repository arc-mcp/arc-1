# Issue #293 — Release-Aware 423 Lock-Handle Guidance (abapfs_extensions)

## Overview

ARC-1 issue #293 reports that **every ADT write fails with `423 ExceptionResourceInvalidLockHandle`** on NetWeaver < 7.51 / ECC, while S/4HANA works. ARC-1's current error hint blames **SAP Note 2727890**, but that note is a *red herring*: it fixes a narrow bug for lock handles containing `+` characters. The reporter (`@acmebcn`) has that note applied on SAP_BASIS 7.40 SP33 and still fails.

The real root cause (researched and **validated live**): on SAP_BASIS < 7.51 the ADT REST handler `CL_REST_HTTP_HANDLER` does **not** honor the `X-sap-adt-sessiontype: stateful` HTTP header (the 7.51+ mechanism `CONFIGURE_SESSION_STATE` in `CL_ADT_WB_RES_APP` does not exist on older releases). So the LOCK succeeds but the session silently reverts to stateless, and the subsequent PUT can't see the enqueue lock → 423. The fix is a **server-side ABAP enhancement** — `marcellourbani/abapfs_extensions` (an implicit enhancement `ZABAPFILESYSTEM_SESSION` on `CL_REST_HTTP_HANDLER->HANDLE_REQUEST` that back-ports the header read). This was reproduced on NPL 7.50 (423), the enhancement installed, and the identical ARC-1 write then returned 200. a4h (kernel 7.58) works natively.

This plan makes the failure **easy for users to fix themselves** by: (1) replacing the misleading 423 hint with **release-aware** guidance that points to `abapfs_extensions` when the detected SAP_BASIS is < 7.51; (2) emitting a proactive startup warning when writes are enabled on a < 7.51 system; (3) adding a user-facing troubleshooting section (abapGit + manual SE19/SE24 install recipes); (4) cleaning up stale "apply Note 2727890" framing across docs; (5) adding a regression test pinning the stateful header on include-write paths; (6) updating the issue research doc with the validated conclusion. No new tool parameters; no MCP-protocol changes.

## Context

### Current State
- `classifySapDomainError()` in `src/adt/errors.ts` (lines ~384-394) returns the 423 `enqueue-error` hint that cites **only** SAP Note 2727890. It takes `(statusCode, responseBody?, path?)` — no awareness of the detected SAP_BASIS release.
- The hint is surfaced via `buildBaseErrorMessage()` in `src/handlers/intent.ts` (line ~429), which already has `config: ServerConfig` in scope and lives in the same module as the module-level `cachedFeatures` variable (defined line ~7069; `getCachedFeatures()`/`setCachedFeatures()` exported ~7484-7490).
- ARC-1 **already detects** the SAP_BASIS release at startup: `runStartupProbe()` in `src/server/server.ts` calls `probeFeatures()` and `setCachedFeatures(features)` (line ~356). `features.abapRelease` is a string like `"750"`/`"758"`. `src/adt/features.ts` already maps releases (`releaseToVersion`, `if (num >= 751) ...` at line ~204) and exposes `abapRelease` on the resolved features (line ~216, ~239).
- ARC-1 is **architecturally immune** to the two client-side causes of the same 423: (b) it sets `X-sap-adt-sessiontype: stateful` at the *session-client* level in `src/adt/http.ts` (line ~326) so every in-session request carries it — there is no per-call flag to forget; (c) `checkPackage()` and `runPreWriteLint()` run *before* the lock cycle in `handleSAPWrite` (intent.ts ~3633/~3805), never interleaved between LOCK and PUT. All source writes go through `safeUpdateSource`/`safeUpdateObject` → `withStatefulSession` (`src/adt/crud.ts` ~219/~243).
- Docs that frame Note 2727890 as the primary fix: `docs/integration-test-skips.md` (lines ~83, ~91, ~95, ~97) and `docs_page/tools.md` (line ~511).
- Existing tests asserting the note text: `tests/unit/adt/errors.test.ts` (line ~425, `toContain('2727890')`) and `tests/unit/handlers/intent.test.ts` (line ~6373, `toContain('2727890')`).
- `INFRASTRUCTURE.md` (gitignored) is already updated with the validated root cause + the manual SE24 install recipe. The prior research doc `docs/research/issues/293-ecc-423-invalid-lock-handle.md` exists only on branch `claude/review-issue-293-rm0tK` and predates the validation (it still ranks Note 2727890 / a duplicate-cookie theory).

### Target State
- The 423 hint is **release-aware**:
  - **release < 751** → leads with `abapfs_extensions` as the fix, explains the stateful-session root cause, mentions Note 2727890 only as a separate narrow possibility.
  - **release ≥ 751** → transient/real-lock guidance (retry, check SM12); abapfs_extensions not mentioned.
  - **release unknown** → retry first; if persistent on a < 7.51 system install abapfs_extensions; Note 2727890 noted as a separate narrow bug.
- A one-line startup `logger.warn` fires when `allowWrites && abapRelease < 751`, pointing operators to abapfs_extensions before they hit the first cryptic 423.
- A user-facing troubleshooting section documents the symptom and both install paths (abapGit import + manual SE19/SE24 enhancement).
- Stale "apply Note 2727890" framing is corrected to "install abapfs_extensions (Note 2727890 is a separate narrow bug)".
- A regression test asserts the stateful header on a class-include write path (mirrors vibing-steampunk #98 guard).
- `docs/research/issues/293-ecc-423-invalid-lock-handle.md` exists on the PR branch with the validated conclusion, and a drafted issue comment is ready for the maintainer to post.

### Key Files

| File | Role |
|------|------|
| `src/adt/release.ts` | NEW — tiny pure helper `parseReleaseNumber(release?: string): number \| undefined` (no imports, no cycles). Used by the hint and the startup warning to compare against 751. |
| `src/adt/errors.ts` | `classifySapDomainError()` — add optional `abapRelease` param; rewrite the 423 branch to be release-aware. |
| `src/handlers/intent.ts` | `buildBaseErrorMessage()` — pass `cachedFeatures?.abapRelease ?? config.abapRelease` into `classifySapDomainError()`. |
| `src/server/server.ts` | `runStartupProbe()` — after `setCachedFeatures(features)`, emit a warn when `allowWrites && release < 751`. |
| `tests/unit/adt/release.test.ts` | NEW — unit tests for `parseReleaseNumber`. |
| `tests/unit/adt/errors.test.ts` | Update the existing 423 test (~line 418-425); add release-branch tests. |
| `tests/unit/handlers/intent.test.ts` | Update the existing 423 handler test (~line 6357-6373) to be release-aware. |
| `tests/unit/adt/http.test.ts` | Add a regression test: in-session class-include PUT sends `X-sap-adt-sessiontype: stateful` (real client + mocked undici). |
| `docs_page/sap-trial-setup.md` | Add the "423 invalid lock handle on NW < 7.51" troubleshooting section. |
| `docs_page/tools.md` | Demote Note 2727890 (line ~511); add a short pointer to the troubleshooting section. |
| `docs/integration-test-skips.md` | Demote Note 2727890 to secondary; abapfs_extensions is the fix (lines ~83/~91/~95/~97). |
| `docs/research/issues/293-ecc-423-invalid-lock-handle.md` | NEW on PR branch — validated conclusion + drafted issue comment. |
| `CLAUDE.md` | Add `src/adt/release.ts` to the codebase structure tree and a Key Files row for the release-aware hint. |

### Design Principles
1. **Release-aware, fail-soft.** When the release is unknown (detection failed), the hint must still be useful — mention both retry and the < 7.51 abapfs_extensions path. Never hide guidance behind a detection that may not have run.
2. **abapfs_extensions is the primary fix for < 7.51; Note 2727890 is a separate narrow bug.** Keep a brief mention of the note (some users will have the `+`-handle variant) but never present it as THE fix.
3. **No new tool parameters / no MCP-protocol change.** This is an error-message + docs + startup-log change. The three-file tool-schema sync rule does not apply.
4. **Pure, testable release parsing.** Put release-number parsing in one tiny dependency-free module (`src/adt/release.ts`) and unit-test it, rather than duplicating `parseInt` logic or risking an import cycle by importing `features.ts` into `errors.ts`.
5. **Preserve the existing classification contract.** `classifySapDomainError` keeps returning `SapErrorClassification | undefined` with `category: 'enqueue-error'` for 423 so downstream behavior (audit `errorClass`, transaction hints) is unchanged.
6. **Don't rewrite history.** Historical/competitor-analysis references to Note 2727890 in `docs/compare/00-feature-matrix.md` and `docs_page/roadmap.md` are records of past decisions — leave them; only fix forward-looking guidance docs.

## Development Approach

- Foundation first (`release.ts` helper + tests), then the hint (`errors.ts`), then wiring (`intent.ts`), then the startup warning (`server.ts`), then the regression test, then docs, then the research/issue artifact, then final verification.
- Every code task ends by running `npm test`. Two existing tests assert `'2727890'` and MUST be updated in the same task that changes the hint text, or the suite breaks.
- Code-only changes here → unit tests are sufficient (no new ADT endpoint, no new tool op). Live validation against NPL/a4h is a manual verification step in the final task, not a CI gate.
- Biome auto-fixes formatting on commit; still run `npm run lint` and `npm run typecheck` before finishing.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add pure release-number helper

**Files:**
- Create: `src/adt/release.ts`
- Create: `tests/unit/adt/release.test.ts`

A single dependency-free helper for comparing SAP_BASIS release strings against the 7.51 threshold, used by both the release-aware hint (Task 2) and the startup warning (Task 4). Kept separate to avoid importing `features.ts` into `errors.ts` (which would risk a circular dependency).

- [ ] Create `src/adt/release.ts` exporting `parseReleaseNumber(release?: string): number | undefined`. Behavior: trim the input; take the leading digit run (e.g. `"750"`, `"758"`, `"7.50"`→handle the dot by stripping non-digits OR documenting that SAP_BASIS feeds are dotless like `"750"`); return the integer, or `undefined` if no digits / empty / undefined. Keep it pure — no imports.
- [ ] Add a JSDoc note that SAP_BASIS release strings from `/sap/bc/adt/system/components` are dotless 3-digit codes (`"700"`, `"740"`, `"750"`, `"758"`), and that values < 751 lack native stateful-session support over HTTP.
- [ ] Add unit tests (~8 tests): `"750"`→750, `"758"`→758, `"700"`→700, `"751"`→751, `undefined`→undefined, `""`→undefined, `"abc"`→undefined, and one dotted/whitespace edge case (e.g. `" 750 "`→750). Assert the < 751 / ≥ 751 boundary with `parseReleaseNumber("750")! < 751` and `parseReleaseNumber("751")! >= 751`.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Make the 423 hint release-aware in errors.ts

**Files:**
- Modify: `src/adt/errors.ts`
- Modify: `tests/unit/adt/errors.test.ts`

`classifySapDomainError()` (lines ~344-395) currently returns a 423 `enqueue-error` hint that cites only SAP Note 2727890. Make it release-aware so < 7.51 systems get pointed at `abapfs_extensions` (the real fix), while keeping the function's return contract.

- [ ] Add an optional 4th parameter `abapRelease?: string` to `classifySapDomainError(statusCode, responseBody?, path?, abapRelease?)`.
- [ ] Import `parseReleaseNumber` from `./release.js` and compute `const releaseNum = parseReleaseNumber(abapRelease);` inside the function.
- [ ] Rewrite the `423 / ExceptionResourceInvalidLockHandle` branch (lines ~384-394) to choose the hint by release. Keep `category: 'enqueue-error'` and the `details: { exceptionType }` shape unchanged. Three variants:
  - **`releaseNum !== undefined && releaseNum < 751`**: lead with the real fix — e.g. *"Your SAP_BASIS (<release>) does not honor stateful ADT HTTP sessions, so the lock is released before the write. Install the abapfs_extensions enhancement (https://github.com/marcellourbani/abapfs_extensions) via abapGit — it back-ports the 7.51 stateful-session handling to CL_REST_HTTP_HANDLER. (SAP Note 2727890 is a separate, narrow bug for lock handles containing '+' and is NOT this issue.)"*
  - **`releaseNum !== undefined && releaseNum >= 751`**: transient/real-lock guidance — *"Lock handle is invalid or expired. Retry first (transient expiry is common). If it persists, check SM12 for stale locks; ensure no other editor holds the object."* (no abapfs mention). Set `transaction: 'SM12'`.
  - **`releaseNum === undefined`** (unknown): combined — *"Lock handle is invalid or expired. Retry first. If 423 persists on the first PUT after LOCK and your SAP_BASIS is < 7.51, install abapfs_extensions (https://github.com/marcellourbani/abapfs_extensions) — older releases ignore the stateful-session header over HTTP. (SAP Note 2727890 is a separate narrow '+'-handle bug.)"*
- [ ] Keep the link text exactly `https://github.com/marcellourbani/abapfs_extensions` so docs and hint agree.
- [ ] Update the existing test at `tests/unit/adt/errors.test.ts` ~line 418-425 ("classifies enqueue errors for 423"): it calls `classifySapDomainError(423, 'Lock handle invalid')` (no release → unknown branch). Change the assertion from `toContain('2727890')` to assert the unknown-branch hint mentions `abapfs_extensions` AND still mentions `2727890` as secondary.
- [ ] Add new tests (~4 tests): (a) `classifySapDomainError(423, 'x', undefined, '750')` → hint contains `abapfs_extensions`, category `enqueue-error`; (b) `(423, 'x', undefined, '700')` → contains `abapfs_extensions`; (c) `(423, 'x', undefined, '758')` → does NOT contain `abapfs_extensions`, mentions retry/SM12; (d) `(423, 'x', undefined, '751')` → does NOT contain `abapfs_extensions` (boundary).
- [ ] Run `npm test` — all tests must pass.

### Task 3: Wire the detected release into the hint from intent.ts

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`buildBaseErrorMessage()` (line ~418-434) calls `classifySapDomainError(err.statusCode, err.responseBody, err.path)`. Pass the detected release so the hint can specialize. The release is available as the module-level `cachedFeatures?.abapRelease` (set by the startup probe) with `config.abapRelease` (manual `SAP_ABAP_RELEASE` override) as fallback.

- [ ] In `buildBaseErrorMessage()` compute `const abapRelease = cachedFeatures?.abapRelease ?? config.abapRelease;` and pass it as the 4th argument: `classifySapDomainError(err.statusCode, err.responseBody, err.path, abapRelease)` (line ~429).
- [ ] Confirm no import is needed (`cachedFeatures` is module-level in this file; `config` is a function parameter).
- [ ] Update the existing handler test at `tests/unit/handlers/intent.test.ts` ~line 6357-6373 ("423 lock handle error returns enqueue hint"): currently asserts `toContain('2727890')` with no release set. Because no `cachedFeatures` release is set in that test, it exercises the unknown branch — update the assertion to expect `abapfs_extensions` (and keep a `2727890` mention if the unknown-branch hint retains it).
- [ ] Add a release-specific handler test (~2 tests): build a valid `ResolvedFeatures` via `resolveWithoutProbing(defaultFeatureConfig())` (from `src/adt/features.js`), override `.abapRelease = '750'`, and call `setCachedFeatures(...)` (both `setCachedFeatures` and `getCachedFeatures` are exported from the handler module, intent.ts ~7483/~7488). Trigger a 423 and assert the tool error text contains `abapfs_extensions`; then repeat with `.abapRelease = '758'` asserting it does NOT. Reset with `setCachedFeatures(undefined)` in `afterEach` to avoid cross-test leakage. (Do NOT hand-build a partial features object — `resolveWithoutProbing` yields the correct shape.)
- [ ] Run `npm test` — all tests must pass.

### Task 4: Startup warning when writes are enabled on a < 7.51 system

**Files:**
- Modify: `src/server/server.ts`
- Modify: `tests/unit/server/` (add or extend the relevant server test file; create `tests/unit/server/startup-warning.test.ts` if no suitable file exists)

Proactively warn operators at startup — before they hit the first cryptic 423 — when the system can't honor stateful writes and writes are enabled. Keep the network-dependent `runStartupProbe` thin by extracting a pure decision helper that can be unit-tested.

- [ ] Add a pure exported helper (e.g. in `src/adt/release.ts` from Task 1) `function shouldWarnPreStatefulRelease(allowWrites: boolean, abapRelease?: string): boolean` → returns `true` iff `allowWrites === true` and `parseReleaseNumber(abapRelease)` is defined and `< 751`.
- [ ] In `src/server/server.ts` `runStartupProbe()`, immediately after `setCachedFeatures(features)` (line ~356), call the helper with `config.allowWrites` and `features.abapRelease`; when `true`, emit a single `logger.warn(...)` such as: *"SAP_BASIS <release> is below 7.51 and does not honor stateful ADT HTTP sessions — object writes will fail with 423 'invalid lock handle'. Install abapfs_extensions (https://github.com/marcellourbani/abapfs_extensions) on the SAP system. See docs/sap-trial-setup troubleshooting."* Include the detected release in the message.
- [ ] Add unit tests (~5 tests) for `shouldWarnPreStatefulRelease`: `(true,'750')`→true, `(true,'700')`→true, `(true,'758')`→false, `(false,'750')`→false (writes disabled), `(true,undefined)`→false (unknown release: don't cry wolf). Place them in the same test file as the `release.test.ts` helper tests OR the new server test file — but the pure-helper tests belong with the helper in `tests/unit/adt/release.test.ts`.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Regression test — stateful header on include-write path

**Files:**
- Modify: `tests/unit/adt/http.test.ts`

ARC-1 is currently immune to the vibing-steampunk #98 class of 423 (a write leaf that forgets the stateful flag) because the header is set at the *session-client* level in `AdtHttpClient.request()` (`src/adt/http.ts` ~line 326), not per call. Lock that guarantee in with a URL-specific regression test so a future refactor can't silently regress it for class-include writes.

- [ ] IMPORTANT — put this in `tests/unit/adt/http.test.ts`, NOT `crud.test.ts`. `crud.test.ts` mocks `withStatefulSession` with a fake `{post, put}` session, so it bypasses the real header-setting code and would assert nothing. `http.test.ts` uses the **real** `AdtHttpClient` with `undici.fetch` mocked, which exercises the actual `request()` header logic (see existing tests at ~line 517-560 and ~line 866-871 that assert `X-sap-adt-sessiontype: stateful`).
- [ ] Add a test that, inside `client.withStatefulSession(async (session) => { ... })`, issues a `session.put('/sap/bc/adt/oo/classes/ZCL_X/includes/implementations?lockHandle=...', 'source', 'text/plain')` against the mocked `undici.fetch`, and asserts the captured PUT request carries header `X-sap-adt-sessiontype: stateful`. Mirror the header-reading helper used by the existing stateful-session tests in the same file.
- [ ] Add a short comment citing vibing-steampunk #98 as the regression this guards (every in-session write — including class-include PUTs — must carry the stateful header).
- [ ] Run `npm test` — all tests must pass.

### Task 6: User-facing troubleshooting doc

**Files:**
- Modify: `docs_page/sap-trial-setup.md`
- Modify: `docs_page/tools.md`

Give users a self-serve fix. The NW 7.50 trial audience documented in `sap-trial-setup.md` is exactly the affected population.

- [ ] In `docs_page/sap-trial-setup.md`, add a new `###` subsection (under "SAP System Configuration", e.g. after "Session Timeout Tuning" ~line 264, or in a Troubleshooting area near "Known Test Failures") titled e.g. **"Writes fail with 423 'invalid lock handle' (NW < 7.51)"**. Cover: symptom (every SAPWrite/edit/delete returns 423 `ExceptionResourceInvalidLockHandle`; reads work); root cause (CL_REST_HTTP_HANDLER doesn't honor `X-sap-adt-sessiontype: stateful` before 7.51; the 7.51 mechanism `CONFIGURE_SESSION_STATE` in `CL_ADT_WB_RES_APP` is missing); that **SAP Note 2727890 is NOT the fix** (it's a narrow `+`-handle bug); the fix = install **abapfs_extensions**.
- [ ] Document **both** install paths: (1) **abapGit** — import https://github.com/marcellourbani/abapfs_extensions into the dev system; (2) **Manual SE19/SE24** (for systems without abapGit, like the NPL trial): create an implicit enhancement implementation `ZABAPFILESYSTEM_SESSION` at the *begin* of `CL_REST_HTTP_HANDLER->IF_HTTP_EXTENSION~HANDLE_REQUEST`, package `$TMP`, activate. Include the exact ABAP snippet (reproduce it from `INFRASTRUCTURE.md` — the `__abapfs_stateful = server->request->get_header_field( 'X-sap-adt-sessiontype' )` block setting `gv_stateful`). Note no ICM restart is needed and that it's safe/no-op on ≥ 7.51.
- [ ] In `docs_page/tools.md`, under the SAPWrite section, add a short note: writes on NW < 7.51 require the abapfs_extensions enhancement, linking to the new troubleshooting section.
- [ ] No code/tests in this task. Run `npm run lint` (markdown is not linted by biome, but run it to confirm nothing else broke) — optional; primary check is the next task's `npm test`.

### Task 7: Demote Note 2727890 in guidance docs + update research doc/issue

**Files:**
- Modify: `docs/integration-test-skips.md`
- Modify: `docs_page/tools.md`
- Create: `docs/research/issues/293-ecc-423-invalid-lock-handle.md`
- Modify: `CLAUDE.md`

Correct forward-looking guidance and capture the validated conclusion. Do NOT touch historical references in `docs/compare/00-feature-matrix.md` or `docs_page/roadmap.md` (records of past decisions).

- [ ] `docs/integration-test-skips.md` (lines ~83, ~91, ~95, ~97): change the framing so **abapfs_extensions is the primary fix** for the lock-handle 423 on < 7.51; keep Note 2727890 only as a secondary "separate narrow bug" mention. Update the line "now cites the note directly" (~97) to reflect that the hint is now release-aware and points at abapfs_extensions for < 7.51. Note that NPL (with the enhancement installed) now passes these writes, so the relevant skips no longer fire on that specific instance.
- [ ] `docs_page/tools.md` (~line 511, class-section cross-release note): change "Writes ... can trip SAP Note 2727890 ... ARC-1 detects the 423 and emits a hint" to reference the real cause (stateful-session header not honored < 7.51) and that the hint points at abapfs_extensions. (This may already be partly edited in Task 6 — ensure the two edits are consistent.)
- [ ] Create `docs/research/issues/293-ecc-423-invalid-lock-handle.md` on this branch with the **validated** conclusion: three root-cause classes (server stateless < 7.51 [the #293 cause, validated on NPL]; client missing stateful flag [ARC-1 immune]; stateless hop between LOCK/PUT [ARC-1 immune]); Note 2727890 is a red herring; abapfs_extensions is the fix (with the manual SE24 recipe); the live before/after evidence (NPL 423 → 200 after install; a4h native). Include a ready-to-post **drafted GitHub issue comment** (a fenced block) the maintainer can paste into #293.
- [ ] `CLAUDE.md`: add `release.ts # SAP_BASIS release parsing (release-aware hints/warnings)` to the `src/adt/` section of the codebase structure tree, and add a Key Files row: "Add release-aware SAP error hint | `src/adt/errors.ts` (`classifySapDomainError` abapRelease param), `src/adt/release.ts`, `src/handlers/intent.ts` (`buildBaseErrorMessage`), `tests/unit/adt/{errors,release}.test.ts`".
- [ ] No automated tests in this task (docs only). Run `npm test` afterward to confirm nothing referencing changed strings broke.

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Grep for stray primary-fix references to the note: `grep -rn "2727890" src/ docs/ docs_page/` — confirm remaining mentions are either secondary "separate narrow bug" framing or historical (feature-matrix/roadmap), not "apply this to fix writes".
- [ ] Confirm hint wiring end-to-end with a focused run: `npx vitest run tests/unit/adt/errors.test.ts tests/unit/adt/release.test.ts tests/unit/handlers/intent.test.ts tests/unit/adt/crud.test.ts`.
- [ ] (Live, optional — requires SAP creds) Validate against a4h (≥7.51): a 423 is unlikely, but confirm the build runs and `SAPRead` works. Validate against NPL (now has abapfs_extensions): confirm a `SAPWrite update` **succeeds** (regression-proves the fix is in place) — e.g. `SAP_URL=https://npl.marianzeis.de SAP_USER=DEVELOPER SAP_PASSWORD=Appl1ance SAP_CLIENT=001 SAP_INSECURE=true SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='*' node dist/cli.js call SAPWrite --arg action=update --arg type=PROG --arg name=ZARC1_E2E_WRITE --arg 'source=REPORT zarc1_e2e_write.'`.
- [ ] (Optional, maintainer decision) Post the drafted comment from the research doc to GitHub issue #293 via `gh issue comment 293 --repo arc-mcp/arc-1 --body-file <draft>`. Leave as a manual step — do not auto-post from an autonomous session.
- [ ] File follow-up issues for the out-of-scope findings (do NOT implement here): (1) abap-adt-api#42 — verify `SAPQuery`/`/datapreview/freestyle` sends `Content-Type: text/plain` for `LIKE '%'` queries; (2) vscode_abap_remote_fs#293 — guard `fast-xml-parser` paths against non-XML 4xx/5xx bodies (BASIS 731 `mainprograms` 500); (3) vibing-steampunk#114 — `/system/components` 406 on kernel 758 release detection (has a syntax-config fallback today; verify it still detects release).
- [ ] Move this plan to `docs/plans/completed/`.
