# Existing pinned-write PP qualification — 1 November 2026

PR [#1142](https://github.com/arc-mcp/arc-1/pull/1142), deployed revision
`2d160378504119902f700edfdeb11195498fd05e`, exercised the existing CLAS main-source lifecycle
through actual XSUAA-authenticated pinned Principal Propagation routes. Two different mapped SAP
users successfully created, updated, edited and activated separate disposable `$TMP` classes.
Independent native reads confirmed each expected creator and final changer, active source, and
master system A4H. This qualifies those observed paths; **it does not enable or qualify broader
PR 2 mutations, every intermediate mutation's audit actor, or the complete CLAS/INTF matrix**.

The [machine-readable evidence](broader-pinned-pp-writes/pp-qualification-2026-11-01.json) records
the source revision, assertions, failed attempts, limitations, cleanup and final local harness
snapshot hashes. These hashes are not per-run attestations: the primary positive and first secondary
probe used earlier harness versions whose hashes were not retained. Final-snapshot safeguards cannot
be retroactively attributed to those runs. Credentials and native XML remain outside the repository.

## Setup and execution

The isolated CF test application temporarily ran the candidate artifact with its global write
switch enabled. A dedicated temporary destination cloned the existing A4H 7.58/client-001 strict-PP
destination, with alias `PR1142/001`, writes enabled and package `$TMP`; the original destination
remained unchanged. A temporary XSUAA role granted read access to `PR1142/001` and `A4H/001`, and
an exact write grant only to `PR1142/001`, to the two owner-provided test identities. Aggregate,
Basic, Git, transport, data-preview, free-SQL and plugin policies were not broadened.
The candidate push's `--no-route` option removed the existing route mapping; the original mapping
was restored before qualification and verified again after rollback.

The secondary SAP account initially had display-only permissions. With the owner's authorization,
a temporary PFCG role restricted development to `ZARC1*`, CLAS/INTF and `$TMP`. A create attempt
then received native SAP 403. SU53 identified the missing `S_ABPLNGVS` authorization. Adding
Standard ABAP with activities 01/02/03/07 and regenerating the temporary profile allowed the
second writer to complete the lifecycle. No transport permission or execution permission was added.
The failed create was independently confirmed absent before an inspected retry.

The secondary account did not return the expected component inventory. The failed probe stopped
before mutation. Its subsequent run established target continuity by reading the primary actor's
unique class and matching a source hash captured directly from A4H/001. Native post-write metadata
independently established both new objects' system and authorship.

| Evidence | Result |
| --- | --- |
| Primary writer | Create, update, method edit, activation and active-source readback completed; native creator/final changer matched the expected SAP user. |
| Strengthened primary refusal checks | 57 assertions passed, including hidden catalogs and exact refusal codes on `/multi/mcp`, `/authorize`, and the original read-only destination; final source unchanged. |
| Primary token requesting only `read` | 23 assertions passed: raw write scope absent, write/activation tools hidden, direct update refused with the expected gate code, source unchanged. |
| Secondary writer after permission correction | 104 assertions passed, including a genuine stale-source-hash refusal, changed method hash, activation, aggregate/alias/destination refusals and final source readback. |
| Independent native metadata | Two distinct expected creators and final changers; both objects active with the expected final source. |
| Local harness regression | Wrong refusal code and invalid catalog fail; valid refusal responses pass. |

The original primary run's negative assertions accepted any tool error. They are superseded by
the stricter rerun, not counted as independent negative evidence. The two public aliases in this
test refer to the same backend. The original destination also lacked a caller write-target grant;
this combined refusal does **not** independently isolate its destination write switch.

## Review and remaining qualification

Actual Claude Code `claude-opus-5-5`, effort `max` (CLI 2.1.302), reviewed the local harness.
Its blocking finding was the weak negative oracle. Follow-ups tightened exact refusal codes,
meaningfully different denied payloads, catalog validation, source/hash assertions, captured-token
use, durable attempt/output reservation, paired native author verification and fixture cleanup.
Cleanup now verifies the captured owner metadata again under its owning lock before deletion.

The resumed actual Claude Code Opus 5.5 max [closing review](broader-pinned-pp-writes/claude-qualification-review-20261101.md)
accepted F1–F9 at final-snapshot source level. It identified historical evidence limits CLS-1–6:
per-run harness hashes were not retained, master-system evidence was observed rather than an automated
gate, and cleanup checked metadata without an exact source hash under lock. Failed secondary attempt
reservations were preserved as backend-probe-failed and create-403 records before the inspected retry.
Cloud/access restoration was verified by separate operator controls, not by the qualification module.
The machine-readable record labels the separate operator controls and their limits. The new deletion-capable candidate
requires fresh qualification; this older harness deliberately refuses deletion.

Concurrent writers, shared-owner inactive drafts, INTF and broader object families, transport
management, tracing/settings, classic FLP and final expanded catalogs remain outside this live run.
These results do not satisfy the complete PR 2 release gate. FEAT-93 remains open and the PR stays
draft.

## Cleanup verified

- Both disposable classes were deleted after native evidence capture; independent GETs returned 404.
- The secondary SAP user's original role, validity dates and generated profile were restored exactly.
  Full user comparison completed. The temporary role definition/profile remain **unassigned** for reuse.
- The CF application's original droplet, full user environment, process sizing and route were restored;
  the original application was started and its health endpoint returned HTTP 200.
- The original XSUAA security descriptor was restored. The temporary IAM role and collection were
  deleted and subsequently reported absent; the temporary destination was deleted and verified absent.
- Operator handling records report that the local OAuth harness stopped and discarded its in-memory
  sessions; no exhaustive token-persistence attestation was performed.

CI on the deployed revision had passed the Node 22/24 suites, native integration, docs, policy/build
gates, platform builds and security checks at this checkpoint. Its separate e2e status was still
pending; it is not reported as passed here.
