# Editable native read companions — independent Codex review

## Verdict

**ACCEPT for integration of the read-companion delta. No confirmed findings.** This verdict covers commit `e01b481686418bf9c925d834b6c79b089e3b8fe8` against `6fa67b75e0c721a29d15a325c11f56679a33881b`. It does not qualify any native mutation, admit any additional public write capability, approve a native experiment, or give whole-PR merge approval.

Reviewer: Codex `/root/trace_fixes`, using the authorized fallback after the actual Claude session limit. I did not author this read-companion delta or its tests. Review used only the immutable supplied source snapshot and its evidence. The first and final source actions ran `review-input/verify-snapshot.py`; both verified all 4,614 files unchanged at the reviewed revision. Final evidence is `codex-final-verifier.log`.

## Scope and assessment

- Read AGENTS, FEAT-93 at the start and finish, relevant developer guidance, the accepted plan's freshness contract, ADR-0011, security-model guidance, author report and research. Reviewed the supplied complete diff, new reader, affected owner helpers, existing corresponding private writer paths, SDK/CLI dispatch boundaries, tests and description/snapshot changes.
- `readDdicEvidence` and `readBindingDocument` retain fresh native identity/content validation without requiring write-package authorization. `readPinnedDdicEvidence` and `readPinnedBinding` unconditionally call the existing real-package check, including inherited parent-package evidence where applicable. Mutation callers retain those wrappers. No caller bypass flag or capability admission was added.
- Metadata and source snapshots use the same canonical metadata projection or exact source bytes as their corresponding private writer preconditions. Reads distinguish the requested metadata/source view from the native version reported in metadata, including active fallback. Source-backed reads bracket the source GET with full namespace-bound owner comparison; package, identity, version, state-alternative and other native metadata drift fail the call. Documentation correctly states that this is neither an atomic snapshot nor independent proof of source version.
- Native reads bypass caches and carry a shared 60-second deadline, caller cancellation, 16-attempt allowance and cumulative 8 MiB response budget through subtype search, owner, parent and source GETs. XML and source bounds remain 1 MiB and 4 MiB. No mutation request is introduced by the reader. Unknown identity/version, malformed metadata, absent resources and stale snapshots fail rather than yield a usable precondition.
- The public metadata guard examines raw `SAPWrite`/`SAPActivate` arguments before tool-schema stripping. The SDK's `CallToolRequestSchema` preserves its arguments object; the server forwards it to dispatch. The CLI builds its arguments and forwards them to the same dispatcher. Independent probes additionally passed raw SDK-envelope and actual CLI argument-parser results to the real dispatcher; null, blank, boolean, numeric, array, object and syntactically valid hash values were all refused without HTTP access. This probe exercises parsing plus dispatch, not a live SDK transport or real CLI authentication.
- Seven schema fixtures change only the editable-format description. Public mutation support and its input schemas stay closed; the descriptions explicitly avoid treating a hash as write permission. Existing text-source behavior remains intact.

## Independent validation

All checks used Node 22.21.1 with its explicit PATH. No source edits, dependency installation, manual Git commands, native SAP execution, credential access, browser use or delegation were performed. The repository's verifier and size script perform their own read-only Git inspection. The unit suite uses mocked SAP transport and existing local loopback server tests.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused new reads/private-writer round trips | 6 files, 354 tests passed | `codex-focused.log` |
| Full unit suite | 521 files, 14,401 tests passed | `codex-full-unit.log` |
| Independent raw argument probes | 28 refusals, zero HTTP accesses | `codex-raw-guard-probes.log` |
| Source/scripts/tests typecheck | Passed | `codex-typecheck.log` |
| Build | Passed | `codex-build.log` |
| Full Biome lint | Passed; 3 existing informational suggestions, no fixes | `codex-lint.log` |
| Action policy | 135 entries / 14 schemas passed | `codex-policy.log` |
| Tracked-file and schema budgets | Passed | `codex-sizes.log` |
| Standalone schema budget | All scenarios passed | `codex-schema-budget.log` |
| Final immutable verifier | 4,614 files unchanged | `codex-final-verifier.log` |

Strict MkDocs was reported passing by the author; I did not rerun it. No other verification deviation affected the integration verdict.

## Import regression and remaining qualification

The author's initial full-suite run attempted DNS resolution of synthetic host `sap` after a new static import initialized native HTTP before undici mocks. Those attempts and the failed run remain part of the evidence; they are not rewritten as “no network attempts.” The final reader is loaded dynamically only when an editable invocation selects a non-text profile. Schema/source-precondition imports no longer eagerly import the native reader. Independently, the final full suite passed the previously affected `api-release-visibility` (21), `cloud-class-text-symbols` (14) and `diagnose-ci` (39) tests, as well as the new reader's 34 tests. The final full log has no `ENOTFOUND` failure; existing loopback/auth-preflight test diagnostics include controlled `ECONNREFUSED` cases.

Native saved/draft behavior across users and releases, native source-view versus metadata-view consistency, SRVB version coverage and fresh two-user PP qualification remain open. Under-lock revalidation remains required even after a successful editable read. Public metadata preconditions must continue refusing until their corresponding public write contract actually enforces them. These limits are already recorded in the candidate and are not findings against integrating this read-only companion implementation.
