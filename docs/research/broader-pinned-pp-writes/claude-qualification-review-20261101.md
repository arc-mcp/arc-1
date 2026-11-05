Actual Claude Code review; model `claude-opus-5-5`, effort `max`, read-only frozen snapshot.

Reading is finished, so here is the review.

**This is a source review only. I ran nothing, computed no hashes and contacted no system.**

| Packet | Decision | Highest open defect |
|---|---|---|
| Class closure | F1–F9 are closed and accepted at source level. The public evidence needs one correction, no rerun. | Medium |
| Formatter qualification | Accepted at source level for tokens, refusals, differing writes and replay refusal. **Not accepted** as proof of same-backend or same-actor native writes; that needs a rerun with FMT-1. | High |
| Direct-native deletion harness | Accepted as a direct-MARIAN happy-path fixture test. Not PP evidence. | Low |

## Evidence basis

- **Source reviewed:** I read all 35 files. I compared the manifest and evidence hash strings as text, and they agree. I read the eight shared `formatter/` modules and saw no differences from their `class/` copies, but that was not a byte comparison.
- **Hand-traced, still reported output:**
  - Class counts match the hashed source for `readonlyA` (23), `writerAneg` (57), `writerB2` (16+2) and `writerB3` (104).
  - The formatter's 241 entries also match. Of those, 59 are cache-header checks and 12 are exact refusals.
  - The six simulations follow from the code as traced, but I did not run them.
- **Reported only:** all run results, deployed revisions, unit-test totals, memory-only tokens, and cloud, IAM and role restoration. The harness cannot attest token handling itself: `tokensPersisted:false` is a constant (`formatter/live-harness.mjs:449`), and an `import-token` path exists (`:341`), though `qualify` writes no tokens.
- **Outside the packet:** `src/adt/pinned-formatter.ts`, `src/adt/pinned-delete.ts`, `src/adt/crud.ts`, the `--auth-module`, `@sap/xssec` and the private state files. Candidate behaviour is therefore not reviewed.
- **Reviewer identity:** I ran as `claude-opus-5-5`. I can't see the effort setting or CLI version, so record those from the invocation.

## Class closure

| Finding | Status | Source |
|---|---|---|
| F1 | Closed | `class/qualification.mjs:34-48` requires the exact code; denied payloads differ from current source (`:66`, `:112`, `:124`) |
| F2 | Closed | `class/native-fixture-evidence.mts:12,47,54-56` |
| F3 | Closed | `class/cleanup-fixtures.mts:19-24,42,62` |
| F4 | Closed | `class/qualification.mjs:16,103` |
| F5 | Closed | `class/qualification.mjs:10` |
| F6 | Closed, not fsynced | `class/qualification.mjs:26-27` |
| F7 | Closed | `class/qualification.mjs:122-123`, `class/harness-regression.mjs:18` |
| F8 | Closed | `class/qualification.mjs:115` |
| F9 | Closed in `class/`, reintroduced in `formatter/` (FMT-6) | `class/cleanup-fixtures.mts:9-13` |

Every relative import in `class/` now resolves inside the packet. `backend-checks.mjs` and `schema-projection.mjs` only run through `runMcpChecks`, which `qualify` never calls.

The public disclaimers on audit actors, the destination switch, concurrency, INTF, pending e2e and missing approval all match the source. The gaps are below.

**CLS-1 · Medium · The hash block does not cover every run** (`class/public-evidence.json:13-17,28-43,116-126`; `class/evidence-notes.md:11-13,47`)
- The hashed source gives 103 assertions on the `writerA` path, not the reported 79.
- `backend_basis_758` is unreachable for `writerB` in the hashed source (`class/qualification.mjs:77-81`).
- So the primary positive lifecycle ran on an earlier harness with no recorded hash, and which of F4–F6 applied to it can't be established. The notes disclaim only its negative assertions.
- **Repair:** add a harness revision per run, mark `writerA` and `writerB` as "earlier harness, hash not retained", and widen the disclaimer. Alternatively, rerun the primary lifecycle.

**Low**
- **CLS-2** `class/public-evidence.json:98-109` mixes script-backed cleanup claims with unscripted cloud claims. No packet source writes `backendSentinel`, `preflightAbsent` (class), `sapObjects`, `beforeRoles`, `beforeProfiles` or `cloudRestored`, so `class/qualification.mjs:76,84` check operator-entered values. **Repair:** add `verifiedBy` per claim and include or label the producers.
- **CLS-3** `masterSystem` is recorded but not gated (`class/native-fixture-evidence.mts:41,47`), while the notes claim it (`class/evidence-notes.md:8`). **Repair:** add it to `passed`.
- **CLS-4** Cleanup rechecks metadata only (`class/cleanup-fixtures.mts:29`). This backend reports `createdAt` at midnight (`deletion/public-evidence.json:21`); if `changedAt` matches, same-day same-user edits are invisible. "Expected final source" (`class/evidence-notes.md:44`) is only a regex (`class/native-fixture-evidence.mts:46`). **Repair:** compare a source hash as `deletion/qualification.mts:47-49` does.
- **CLS-5** Under the hashed source, `writerB3` can't reuse `writerB2`'s fixture without clearing the attempt file (`class/qualification.mjs:27`). The record doesn't say what happened (`class/public-evidence.json:72-76`). **Repair:** record it.
- **CLS-6** The public hash lists omit four class modules and three formatter modules, plus the auth module. The harness also lives in `node_modules/.cache`, so repository readers can't check the hashes. **Repair:** list the full closure and archive it, parameterising the emails hard-coded at `formatter/qualification.mjs:11-13`.

**Remaining limit:** `class/qualification.mjs:111` expects delete to be refused, and HEAD `96dfc4e6b` admits deletion. A rerun at HEAD fails by design, so this evidence stays pinned to `2d160378`.

## Formatter qualification

**What holds at source level:**
- **Token preconditions:** tokens are frozen synchronously (`formatter/qualification.mjs:86-90`). Identity, scope, grants and lifetime are checked before the journal or any backend call (`:91-100`), and restore-only rechecks them.
- **Differing writes:** forward writes differ from baseline and must return `updated`, with both fields read back (`:126-139`). Isolation is checked in both directions (`:134`, `:140`).
- **Refusals:** denied writes carry a value that differs from current state, so a leak is visible (`:157`, `:161`). All 12 refusals need the exact code (`:44`). The destination group holds a valid write scope and grant.
- **Journals:** the journal and attempt files are exclusive, and the baseline is saved before any write (`:107`, `:128`, `:130`, `:136`). Replay leaves `journalOwned` false, so nothing is restored from stale state.
- **Foreign changes:** a change visible at the restore read is refused (`:73-74`).

**FMT-1 · High · Same backend and same actor are not proven in this run** (`formatter/native-readback.mts:7`; `formatter/qualification.mjs:110-163`; `formatter/evidence-notes.md:102,147`)
- Native reads exist only before and after the run. Identical bytes are what you'd see if the PP writes reached MARIAN's record and were restored, and also if they never reached it.
- The harness makes no backend-identifying read, unlike the class sentinel (`class/qualification.mjs:82-86`).
- The class mapping evidence comes from an earlier revision and a destination that was deleted and recreated. The limits disclose only the secondary mapping.
- A partial mitigation is uncited: granting the role changed the secondary route from denied to working (`formatter/evidence-notes.md:112-115`). That links the secondary route to `ARC1_WG_RO` on A4H, but it is reported only.
- **Repair:**
  - Add a `during` native read after `formatter/qualification.mjs:134`, and fail unless MARIAN's XML shows the patched value with unrelated attributes unchanged.
  - Add a native-hash sentinel read before the first write, cite the role flip, and rerun.
  - Until then, reword the claim to "MCP-visible state on the configured route".

**FMT-2 · Medium · Secondary restoration is only two fields through the candidate route** (`formatter/qualification.mjs:78`; `formatter/public-evidence.json:321-326`)
- Byte-level evidence covers the primary only, and the limits don't say so.
- **Repair:** capture native XML as `ARC1_WG_RO` before removing the temporary role, or add the limit.

**FMT-3 · Medium · Restore can overwrite a concurrent change without any signal** (`formatter/qualification.mjs:16,72-78`)
- Restore sends both fields although only one changed. A foreign change to the other field after the read is overwritten, and `:78` then passes.
- `same()` can't see other attributes. The backend sent no ETag in the direct test (`formatter/evidence-notes.md:47`), and the harness doesn't record the concurrency mode.
- "Restored only the original or its own expected state" (`formatter/evidence-notes.md:133-134`) holds only for changes visible at that read.
- **Repair:** send only the differing field, persist the result's concurrency mode, and reword.

**FMT-4 · Medium · The format check passes on an echo** (`formatter/qualification.mjs:143-144`)
- The regex only finds the program name in the output.
- The users held different styles at that moment, so this could have been a per-user behaviour check.
- "Without creating or saving a repository object" (`formatter/evidence-notes.md:125`) is not asserted anywhere.
- **Repair:** assert the keyword case each style implies, or record a limit if the backend doesn't apply stored settings here. Add a native 404 check on the probe program, or drop that claim.

**FMT-5 · Medium · The simulations skip the negative oracle and real recovery** (`formatter/formatter-regression.mjs:13,69`)
- No scenario covers a wrong refusal code, a formatter action visible on a denied route, a denied write that succeeds, or `state:'unchanged'` on a forward write.
- Restore-only runs only as a no-op, so the sole crash-recovery path has never restored anything in simulation or in the reported live run.
- **Repair:** add those scenarios, and rerun restore-only after `cleanup-read-failure`.

**Low**
- **FMT-6** F9 is reintroduced: raw `JSON.parse` at `formatter/sap-access.mts:10,21` and `formatter/native-readback.mts:18`, which feeds `originalBytesRestored`. **Repair:** use `privateJson`, and create the root exclusively as `deletion/qualification.mts:19` does.
- **FMT-7** `formatter/qualification.mjs:18-23` has no parent-directory fsync, unlike `deletion/qualification.mts:32`. `/tmp` is typically cleared at boot on Darwin, so the journal survives a process crash but not a host crash. **Repair:** sync the directory and use an owner-only path outside `/tmp`.
- **FMT-8** `formatter/qualification.mjs:69,81` sit outside the per-user try, so a journal I/O failure after restoring writerB stops writerA's restore and `:176`. `:79-80` never clear an earlier `restored=true`. `:75` spreads unvalidated journal values over `action`. **Repair:** guard these per user, reset the flag and validate the baseline shape.
- **FMT-9** Scopes aren't exact (`formatter/qualification.mjs:95`), yet the notes say "only the read scope" (`formatter/evidence-notes.md:109`). **Repair:** compare `verification.scopes` as `formatter/live-harness.mjs:110` does.
- **FMT-10** `formatter/qualification.mjs:43-44` don't record the actual code, unlike `class/qualification.mjs:39,43`, so the stated preflight cause isn't derivable from this source. Replay's `EEXIST` also surfaces as `UNEXPECTED_FAILURE`. **Repair:** record expected and actual codes, and add a `JOURNAL_EXISTS` code.
- **FMT-11** The journal holds no run ID, harness hash or revision (`formatter/qualification.mjs:106`), and nothing checks the deployed build in-band. **Repair:** record these at start, and assert a build ID if the server exposes one.
- **FMT-12** Wording: "before each mutation" (`formatter/evidence-notes.md:133`) is true only for the forward writes. "`read` for companions" (`:81-82`) conflicts with the read-only token being refused them (`:126-128`). **Repair:** correct both.

**Remaining limits after these fixes:**
- There is one backend and client, and same-user concurrency stays unprotected without a strong ETag.
- Refusal probes used only the primary identity.
- One refusal code serves every gate, so "isolates the destination ceiling" is an inference from a reported config value.
- The live run never exercised the `unchanged` path.

## Direct-native deletion harness

**What holds at source level:**
- **Ownership:** a preflight 404, a 64-bit nonce in the source, `$TMP`, SAP-side `createdBy` and a source hash (`deletion/qualification.mts:21,40-50,54-55`). Cleanup deletes only with a receipt and unchanged identity (`:85-86`).
- **Absence:** a no-cache GET outside the candidate code, where only an `AdtApiError` 404 counts (`:36-39`). The earlier 200 on the same URL acts as a positive control, and absence is rechecked at `:90`.
- **Attempts:** creation, deletion and cleanup are journalled before they run (`:65`, `:74`, `:87`), with fsync, rename and directory fsync (`:27-33`). The exclusive `mkdirSync` refuses replay (`:19`).
- **Failure handling:** each fixture is handled separately, and the run exits non-zero on failure (`:92`, `:99`). Both independent absence and the candidate's `ok` must hold (`:77-78`).

**Low**
- **DEL-1** The receipt omits `version` and `changedBy`, and `createdAt` is date-only (`deletion/public-evidence.json:21,39`). Activation is trusted from `isError` alone, so the harness can't show the object was active at delete (`deletion/qualification.mts:70-73`). **Repair:** assert `@_version === 'active'` after activation and add `changedBy`.
- **DEL-2** "Independent" means independent of the candidate only: it is the same endpoint, account and client stack. **Repair:** add a `TADIR` read, or state this bound.
- **DEL-3** `deletion/qualification.mts:67,71` parse tool text before saving it, so a plain-text error loses the outcome. A created object then has no receipt and stays in place, which is safe but undiagnosed. Activation has no attempt flag. **Repair:** save the raw text first and add `activationAttempted`.

**Remaining limits:**
- The public record shows no `cleanup*` fields and no fault simulation exists, so the cleanup branch is source-reviewed only.
- `deletePinnedOwner` isn't in the packet, so its under-lock checks are unreviewed.
- `deletion/qualification.mts:24` sets `ppEnabled` and `ppStrict` on a direct client, so nothing here qualifies route gates.
- The evidence binds to candidate hashes at base `1c05fda69`. I did not check whether later commits changed those files, so it doesn't support the deletion admission at HEAD.
