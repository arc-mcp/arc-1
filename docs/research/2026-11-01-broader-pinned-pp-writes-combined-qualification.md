# Combined pinned PP qualification — 1 November 2026

Source `1b234d3a41097e0ae8f17a796ea3ed27faec173b` passed a controlled A4H/001 run:
**482 write/deletion assertions, 262 formatter assertions and 39 initial identity/route assertions**.
All four repository fixtures are absent, preferences are restored, the original app configuration
is running, and temporary destination/IAM/SAP role assignments are removed. This qualifies the
listed local CLAS/INTF and formatter cases; **draft PR #1142 is not ready as a whole**.

The [sanitized machine record](broader-pinned-pp-writes/pp-write-delete-formatter-2026-11-01.json)
binds source, harness, installed auth-module closure, package lock, deployment package/droplet,
artifact hashes, native observations and restoration outcomes. Raw receipts and SAP implementation
bodies remain private. The operator checked 1,127 artifact files and the package/droplet/current-app
relationships separately; the harness does not attest the deployment or every dependency's bytes.
The successful run occurred between 04:04:29 and 04:06:38 UTC, with certificate validation enabled.

## What the live run establishes

Two fresh XSUAA user sessions passed signature, audience, expiry, principal, exact local-scope,
expected-email/origin and exact-write-grant checks. A third session had only `read`. The qualifier
froze these tokens before mutations; it did not refresh or replace identities during the run.

Each writer created a unique `$TMP` class and interface through the pinned PP route, updated them,
exercised stale-hash refusal, edited a class method or interface source, and activated each owner.
Direct native metadata/source reads observed `MARIAN` and `ARC1_WG_RO` as the respective creators
and changers, active version, A4H ownership, `$TMP`, and matching active/editable source hashes.
These receipts also supplied the formatter phase's route/actor source sentinels.

Native setup saved the primary user's full original v5 XML, then seeded all five optional
preferences with nondefault values. The primary PP patch changed indentation; its style was
already `keywordUpper`. The secondary PP patch changed style to `keywordLower`. Native reads as
the primary user observed its indentation change, preserved optional attributes, and unchanged
state after the secondary patch. Both sessions produced the expected differing keyword case.
The run restored both users' exposed settings, verified the primary's seeded XML byte-for-byte,
then separately restored and verified its full original pre-seed XML. The secondary's preferences
and restoration are checked through MCP, without a separate native reader for that user.

Read-scoped, read-only-destination, aggregate and compatibility-route calls were refused before
positive deletion; fixture source hashes remained unchanged. Invalid delete fields were refused.
Both writers deleted their two owners through PP. Every result reported `deleted` at
`absence-readback`, followed by independent typed absence and a final native cleanup check.
The DELETE actor is inferred from the same frozen creator token and strict PP route; DELETE itself
does not return an independently observed actor receipt. There is no TADIR cross-check.

## Review and dispositions

Actual Claude Code `claude-opus-5-5`, effort `max`, CLI 2.1.302 reviewed the immutable snapshot and
native/dependency inputs before the run. Its [verbatim report](broader-pinned-pp-writes/claude-closure-review-20261101.md)
found no High issue and accepted one controlled run with F1's operating rules. It ran 86 focused
tests and all 35 simulations successfully. The author checked all 2,553 snapshot/input hashes
before and after review; Claude did not independently verify them. Its two extra read-only shell
calls and refused out-of-root reads are retained in the report rather than omitted.

| Finding | Disposition |
|---|---|
| F1: broken pipes, terminal/process-group signals | Run used a detached OS session, regular private log files and PID-only SIGTERM. `stopped` reported zero active operations, discarded in-memory sessions, and the process exited. These constraints are now explicit in the harness README; arbitrary crash safety is not claimed. |
| F2: lossy v5 write can block automatic restoration | A manual inspection/restoration plan was prepared before the run and is documented in the README. No loss or manual intervention occurred. Apparent foreign edits remain protected. |
| F3: parent journal missing after a mid-formatter crash | Follow-up bookkeeping accepts an attempted formatter phase and records recovery without manufacturing a completed qualification. A regression covers the actual recovery function and preserves the incomplete parent result. This change happened after the recorded live revision. |
| F4: native `toUpper`/`toLower` styles | Settings reads and patches are refused in these native states; the current four-style API is unchanged. Only `keywordUpper` and `keywordLower` have v5 live evidence. |
| F5: primary style was already uppercase | Recorded accurately above: native primary mutation proof is indentation; secondary style change has MCP evidence. |
| F6: hidden storage and uninspected case-mode helper | Preservation claims are limited to v5 XML attributes. The helper behavior is no longer described as source-inspected. The live keyword-case oracle supplies behavioral evidence for the tested settings. |

## Cleanup and remaining limits

The harness stopped only after qualification cleanup, with no active operations. Operator rollback
verified the original droplet, environment, routes and XSUAA security fields; it removed the exact
temporary IAM role/collection and destination. The one-day secondary SAP role assignment was
removed through SU01. Independent native reads of AGR_USERS and UST04 matched the initial role
and profile lists. The pre-existing temporary role definition was not modified or deleted.
Unused candidate CF package/droplet build artifacts remain available for reproduction.

All preference writes reported `native-unconditional`; same-user concurrent changes can still be
overwritten. V5 XML does not expose dormant backend case mode under style `none`. The native
contract is release-bound; future format preference ordering and conditional ETag enforcement
are not qualified. Historical v2 writes may have reset hidden preferences, and this run cannot
reconstruct those earlier values. The separate legacy single-target v2 writer remains deferred.
Native draft visibility is limited to what the primary reader can see. Missing ownership receipts
or foreign fixture edits still make cleanup refuse rather than overwrite uncertain work.

At `741b31b02`, the post-run recovery-journal correction passed all nine harness safety tests,
all 35 fault simulations, typecheck, lint, strict documentation build and file/schema budgets.
That commit's production `src/` is unchanged from the live revision; its earlier full unit run
passed 394 files / 10,878 tests.

## Evidence follow-up and recovery corrections

The [verbatim follow-up by Claude Code Opus 5.5 max](broader-pinned-pp-writes/claude-evidence-review-20261101.md)
found no High/Medium issue and accepted retaining the delta and continuing development, without
merge approval. Its eight Low findings led to these changes:

- Documentation distinguishes approval to run from review of results, settings-read refusals from
  write refusals, API-accepted styles from live-tested styles, and recovery from forward completion.
  Plan, ADR and inventory now identify the qualified revision and remaining scope.
- Repeated recovery preserves the previous result, including failures, in parent history.
  Restore-only writes `recoveryFinishedAt`; a journal lacking forward completion stays interrupted.
  Baseline-less crashes cannot have changed preferences and need not produce recovery evidence.
- A new offline simulation passes a captured mid-run journal through the real composition wrapper
  and durable files. It preserves a foreign change on the first recovery, then verifies successful
  restoration and retained failed history on the second. It does not simulate an actual process kill.
- The emitter tolerates stdout errors and native workers retain in-flight work on SIGINT. Two real
  subprocess tests exercise broken stdout and SIGINT with the same hooks and `tsx` loader. They do
  not execute SAP cleanup. Detached operation, regular-file logs and PID-only SIGTERM remain required;
  SIGHUP and process-group SIGTERM remain outside the qualified operating contract.

The machine record now includes all 39 sanitized initial assertions and defines the 189 hashed
private evidence files: 103 deletion RPC receipts, 61 formatter RPC receipts, 23 native operation
receipts, and two durable native baseline documents. The extra two are not extra SAP calls.
None of these corrections creates new live evidence or changes the original run/harness binding.

Transportable deletion and the remaining object/include, DDIC/RAP, activation/batch, package/API,
publication, CTS, tracing and classic FLP families need implementation or qualification. Git and
custom plugins remain excluded. FEAT-93 stays open; this result is not merge approval for PR #1142.
