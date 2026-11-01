# Claude Code Opus 5.5 max — qualification harness review

Source: `5d8e8a79cc816f39e6386e806521ffed42fe4370`. Actual CLI review; 129 tool calls, including the offline simulation command. The verifier dependency was outside the restricted reader boundary and was not reviewed; the next snapshot must place it inside that boundary. No live run was performed.

The report below is preserved verbatim. Fixes and later acceptance must be recorded separately.

---

# PR #1142 harness review at `5d8e8a79c`: fit for the next controlled PP run, with conditions

**Decision:** the harness is fit for one controlled PP run, but its verifier dependency is unreviewed. I found no High defect, no secret disclosure in harness code, and no way for command input to inject test hooks. This does not approve the PR.

- **Fix before the run:** Medium findings 1–3 are small, and the harness has not run live yet.
- **If you run without those fixes:** run only from a real checkout root, and don't start the cloud or SAP rollback until the harness process has exited. Expect little diagnostic detail if a native check fails.

## What I ran and could not read
- **Offline test:** I ran `npm run test:qualification:pr1142` once. All 15 formatter and 14 deletion scenarios printed `passed:true`, and both scripts ran to the end. These are mocked simulations, not SAP or CF evidence.
- **Verifier not reviewed:** `--restricted` refused `../dependency/xsuaa-auth` in both Glob and Read.
  - I also tried the installed copy through the `node_modules` symlink, and that was refused too. Your shell rule ruled out any other route.
  - `requireUserToken` behaviour, attribute extraction, default scope handling and library logging remain open, for both the verifier and `@sap/xssec`.
  - I could only confirm the calling side: the harness uses the same attribute and user-token options as production (`src/server/http.ts:504-509`), without its `expandScopes` and logger.
- **Not performed:** hashes, build, typecheck, the unit suite and any live check. The 10,846 test count is reported only. The snapshot's `tests/` holds just two files, so I couldn't check the other tests cited in earlier reports.

## Findings

### Medium
**1. Source binding is empty when the workspace isn't the Git top level** (`scripts/qualification/pr1142/run-manifest.mjs:34,42-46,56-58`)
- This applies from a snapshot under an ignored path, which is this cwd's layout. `rev-parse HEAD` returns the enclosing worktree's commit, `git status` can't see the snapshot, and `git diff -- src` matches nothing and exits 0.
- Edited `src/` would pass, and `sourceRevision` could name the wrong commit. Harness and verifier bytes are still hashed.
- I reasoned this from Git behaviour and did not execute it.
- **Fix:** in `prepareRun` and `verifyRunManifest`, refuse unless the realpath of `git rev-parse --show-toplevel` equals the workspace.

**2. A signal reports `stopped` while the qualifier keeps mutating** (`scripts/qualification/pr1142/live-harness.mjs:440-453`)
- `stop()` emits `inMemorySessionsDiscarded:true`, but the running `qualify` keeps its frozen tokens and never checks `stopping`. A second signal does nothing.
- An operator could start rollback mid-run. Formatter restore runs through the PP route, so removing that route would strand changed preferences.
- **Fix:** check an abort flag in `step()` and throw into the existing restore and cleanup paths. Emit `stopped` only after the command queue drains.

**3. Native fixture failures lose the cause and the observed author** (`scripts/qualification/pr1142/native-fixtures.mts:65-71,76,172-178`)
- `identity()` asserts before returning, and the catch keeps only `NATIVE_CHECK_FAILED`. A wrong-author failure therefore records no SAP user, and that is the run's key check.
- The mock hides this by returning the wrong author (`scripts/qualification/pr1142/deletion-regression.mjs:202-216`). Exclusive receipts (`native-fixtures.mts:101-102`) block a rerun of that mode.
- **Fix:** record observed fields before asserting, and save the assertion message in the owner-only report.

### Low
1. **`/tmp` is not refused on macOS** (`scripts/qualification/pr1142/run-manifest.mjs:62-65`, `scripts/qualification/pr1142/README.md:22`). `os.tmpdir()` is the per-user `$TMPDIR`, so `/tmp/x` passes. FMT-7 raised this exact case. **Fix:** also refuse the realpaths of `/tmp` and `/var/tmp`.
2. **Disabled TLS is not refused** (`scripts/qualification/pr1142/safe-io.mjs:20-30`). `NODE_TLS_REJECT_UNAUTHORIZED=0`, from the shell or from dotenv (`tests/integration/helpers.ts:24`), would affect bearer tokens (`safe-io.mjs:103`) and native Basic credentials (`src/adt/http.ts:216-217`), despite `TEST_SAP_INSECURE=false`. **Fix:** add it to the guard.
3. **`qualification_complete` fires twice** (`scripts/qualification/pr1142/formatter-qualification.mjs:390-397`, `scripts/qualification/pr1142/deletion-qualification.mjs:413-421`). The first has no `plan` and arrives while fixtures still exist. **Fix:** add `plan`, or use a separate formatter event.
4. **Cleanup can't be retried** (`native-fixtures.mts:101-102`, `README.md:55`). After a transient 5xx, only manual SAP deletion remains, without the guarded recheck. **Fix:** use UUID-suffixed cleanup reports, still requiring the receipt.
5. **Another user's draft may be invisible to cleanup** (`native-fixtures.mts:28-29,76`, `README.md:51`). All native reads run as the primary user. If SAP hides the secondary user's inactive draft from them (unverified), the draft guard protects only primary-owned fixtures. **Fix:** state this limit.
6. **Evidence gaps:**
   - `initialize` and `tools/list` get no raw receipts (`deletion-qualification.mjs:75-88`).
   - Receipts drop non-JSON bodies (`deletion-qualification.mjs:59`).
   - Restore-only leaves `restored:false` in the deletion journal (`deletion-qualification.mjs:284`).
   - `restored:false` also means "never attempted" (`formatter-qualification.mjs:112,129`).
7. **Simulation gaps:**
   - `qualification.mjs`, `live-harness.mjs`, `native-check.mjs`, both native scripts and `verifyRunManifest` are never executed offline.
   - Ownership refusals are asserted against a mock reimplementation (`deletion-regression.mjs:227-239`), so the real cleanup branch is still untested and `docs/research/2026-11-01-broader-pinned-pp-writes-deletion.md:99-101` reads stronger than that.
   - No scenario covers restore-only binding refusal, cleanup after a formatter failure, `SAPWrite` visible on a denied route, or wrong-case format output.
8. **README omits limits:**
   - Refusal probes use only the primary identity (`deletion-qualification.mjs:293-298`).
   - Forward patches send both fields (`formatter-qualification.mjs:295-300,319`).
   - The deleting actor is inferred, and one refusal code covers every gate.
   - Nothing refuses a run that has no deployment record.
   - The SAP roles needed, including secondary delete rights, are not listed.

## Traced and accepted at source level
- **Token freezing:** tokens are copied synchronously (`deletion-qualification.mjs:102-106`), and only those frozen tokens reach the formatter (`:281-284`).
- **Identity, scopes and grants:** all checked before any journal or SAP call (`deletion-qualification.mjs:107-128`, `formatter-qualification.mjs:166-191`).
  - Email, origin, exact raw scopes, exact write grants and at least 10 minutes of token life are all required.
  - Read grants may be `*`, and that isn't recorded.
- **Wrapper order:** the formatter runs after the native receipts and before deletion (`deletion-qualification.mjs:257,277-292,336`). The live command passes six fixed keys (`live-harness.mjs:316`), so test injections can't arrive from input.
- **Authors and sentinels:** the same token creates each fixture, and the native receipt must match its author, version and source hash (`native-fixtures.mts:59-91`). The formatter then re-reads the hash through that token's route (`formatter-qualification.mjs:238-251`). I confirmed the composed path by trace only.
- **Primary native proof:** native state must equal the baseline before the write, then the expected value during both patches, comparing the whole parsed document (`native-formatter.mts:52-68`). This closes FMT-1 for the primary user.
- **Secondary limit:** there is no native preference read. Support comes from `createdBy`, lowercase format output and the unchanged primary record. Restoration is two fields through MCP, as `README.md:47-49` says.
- **Writes and format:** writes always differ from the baseline and between users, and `updated` is required (`formatter-qualification.mjs:103-107,271-278`). Format checks are case-sensitive and reject an echo (`:336-341`).
- **Negative checks:** all four denied routes and the five hidden fields reach `MULTI_TARGET_OPERATION_FORBIDDEN` in production (`src/server/multi-target-server.ts:617-639`, `src/server/multi-target-runtime.ts:107-116`). A stale hash gives `PINNED_WRITE_REFUSED` with state `unchanged`.
- **Journals:**
  - Creation is exclusive, with fsync plus directory fsync (`scripts/qualification/pr1142/durable-journal.mjs:5-19`).
  - `JOURNAL_EXISTS` blocks all cleanup and mutation.
  - UUID receipts are written before parsing and contain only response JSON (`deletion-qualification.mjs:55-62`).
- **Restore-only:**
  - It binds target, plan, run ID, revision, harness hash and attempt file (`formatter-qualification.mjs:116-124,199-211`), and sends only changed fields (`:18-19`).
  - The same-user overwrite limit is documented, and the concurrency mode is recorded.
- **Cleanup:**
  - Isolation holds per user and per fixture (`formatter-qualification.mjs:110-158`, `deletion-qualification.mjs:376-398`).
  - Deletion needs preflight absence, a complete receipt and identical identity before and under lock (`native-fixtures.mts:125-135,147-157`).
- **Hashes versus deployment:**
  - Harness bytes, the verifier's `.js` files and the lockfile are bound (`run-manifest.mjs:16-28`).
  - `@sap/xssec`, `tsx` and `ajv` are not.
  - The deployed build is not bound, as `README.md:30-33` states; only `delete_schema` gives a coarse in-band hint.
- **Secrets:** emitted output carries codes only, tokens never reach child processes, redirects are refused, and there is no token-import command. Owner-only `process-error` files may contain SAP user names and response bodies.

**Earlier findings:** FMT-3 to FMT-6, FMT-8 to FMT-10, DEL-1 and DEL-3 are closed. FMT-2 and DEL-2 are now stated limits. FMT-7 is closed except Low 1. FMT-11 is closed except the in-band build check.

## Documentation and provenance
The requested corrections are present in the deletion, formatter and qualification records, the JSON limits and provenance labels, the ADR, the plan, the inventory and the public guide. The `SAPWrite` source description (`src/server/multi-target-tools.ts:158`) and the three missing-source cases (`tests/unit/handlers/pinned-writes.test.ts:225-237`) are also there; I read those tests but did not run them.

Three Low items remain:
- `docs_page/roadmap.md:224` still says evidence wording is outstanding, which contradicts `docs/research/2026-11-01-broader-pinned-pp-writes-deletion.md:92-93`.
- `docs/research/broader-pinned-pp-writes/formatter-native-2026-11-01.json:60` still says `pending-session-limit-reset`, next to the new `reviewStatus` at `:73`.
- `docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:158` has a sentence starting in lowercase.

## What only the live run can answer
Preflight precedes any create, and the first failure stops further creates, so these should all fail safely:
- **A4H's 404 type:** the typed absence check needs a real response. A mismatch stops the run at preflight with no mutation.
- **Marker comment:** whether the leading comment survives exact read-back (`scripts/qualification/pr1142/fixture-contract.mjs:11-12`, `src/handlers/write/pinned.ts:186`). If not, one `$TMP` fixture stays behind with no receipt.
- **INTF over PP:** its create, activation and metadata attributes have not run through a live PP route.
- **Native scripts under `tsx`:** their first real execution happens here, including `import.meta.resolve`. An import failure in `native-fixtures.mts` stops at preflight; in `native-formatter.mts` it stops before any preference write.
- **Secondary delete rights:** first exercised at the very end of the run.
- **Stored style in `format`:** if SAP ignores it, positive deletion is skipped (`deletion-qualification.mjs:286-291`). Preferences are restored and fixtures cleaned, but the whole run must be repeated.
