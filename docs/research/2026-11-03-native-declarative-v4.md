# Declarative lifecycle v4: consumed historical protocol

Status: **the one reviewed v4 attempt was executed and failed on 3 November 2026; never replay it**.
[Exact-source review](2026-11-03-native-declarative-v4-review2-verbatim.md) preceded the
[recorded run, failure audit and fresh inspection](2026-11-03-native-declarative-v4-failure.md).
The [separate reviewed cleanup](2026-11-03-native-declarative-v4-recovery.md) removed both retained
owners and passed independent evidence audit. The protocol design below is
historical; its commands and successful preflight are not a new execution grant.
This is one bounded Basic-native A4H/001 experiment as MARIAN in `$TMP`; it does not qualify PP,
transportable packages, public admission, other releases, service publication or PR merge readiness.

## Historical outcomes remain separate

The [v1 failure and recovery](2026-11-02-native-declarative-failure-and-recovery.md) remain consumed.
V1 stopped after its first DDLS save, and its separately reviewed cleanup removed that owner. V2
consumed its attempt at the PNG prerequisite: the captures were raw JPEGs with `.png` filenames.
It stopped before credential loading, client construction or native mutation. Neither attempt resumes.

The [v3 attempt](2026-11-03-native-declarative-v3-recovery.md) created, activated and comment-updated
one view DDLS, then refused the observed exact owned relative state link. Its failure result is
`3b448b37cd7fbfeaf6aa6710fdae756f1af90bc15c156738ca1182f0d5a9408d`; its other five owners were never created.
The separate v3 recovery at `9c103ab74852d75db5f518e4d0f93e777d5cf8ca` succeeded: one DELETE 200,
own UNLOCK 200 and closed session, typed independent absence for all six original owners, clean
suffix inventory and fresh external zero-lock controls. The retained DDLS is removed. The failed v3
claim and the successful recovery claim are both permanently consumed; no v3 lifecycle pass is implied.

V4 binds the fixed failure/recovery manifests and results, 241 ordered rows across five journals,
the v3 original/recovery prerequisites, the independent cleanup audit and post-control receipts.
There are 24 explicitly selected proof files plus those journal rows. The independent audit's hashes
are `8ddaf3eab883c2ceca028f0901f04ab016b389b27bb1dc56453868ad1850cf9f` (Markdown) and
`e1e81cf8686dfeeef5e34b19e83631284da079f3c71481827cc64dbcbc06bb13` (JSON).
Only hashes and fixed historical facts enter the repository and new saved intent. Raw private
journals, images, unrelated inactive inventory and proprietary SAP source do not. Identical result
bytes for the two successful recoveries are distinguished by their different fixed manifests,
paths and journals. Historical screenshots never satisfy v4 freshness.

## Fixed fixtures and unchanged native scope

`native-declarative-v4.ts` owns only `~/.local/state/arc1-qualification/pr1142-native-declarative-v4`.
There is no caller-selected root, profile, suffix, owner, source, package, transport or operation.
Preparation creates a fresh random 16-hex suffix, refuses the three historical suffixes, and saves
exact source, dependency, target, runtime/source binding and historical-proof facts once. The new
family is `ZARC1_V4{V,A,D,X,S}_<suffix>`. BDEF and abstract DDLS share a name but have distinct owner URIs.

The six-owner graph and SAP syntax retain the [v2 fixture review](2026-11-02-native-declarative-v2.md#fixture-and-dependency-review).
The view uses `ConnectionId`, not the rejected reserved alias `Connection`. The v3 native evidence
proved the original view's create, activation and comment update; v4 is still a new name/revision.
The abstract DDLS contains only `Item : abap.char(10)`. Its abstract BDEF uses the existing
`abstract; strict ( 2 ); with hierarchy;` header and mandatory-execute field, without an implementation
class. The recorded SAP primary references are `ABENBDL_BDEF_ABSTRACT_HEADER` and
`ABENBDL_DEFINE_BEH_ABSTRACT`; this authoring did not fetch them again. DCLS grants only the new view;
DDLX annotates only its existing Carrier field after `@Metadata.allowExtensions: true`; SRVD exposes
only that view as Flights. Existing repository DCL and RAP E2E source forms support these spellings.

Local DDLS parsing, narrow BDEF/DDLX rules and declaration/dependency tests are useful checks, not
native compilation. Abstract DDLS, DCLS, DDLX, BDEF and SRVD syntax/activation on this exact backend
remain unqualified. Their first-draft metadata/state links and source normalization may still refuse.
The shared exact-link helper recognizes `./<same-owned-leaf>?version=active|inactive` for all five
already supported declarative families. This is literal identity recognition after native type/owner
validation, not link following or inferred new native behavior. Only the original view DDLS spelling
has been observed natively; DCLS/DDLX/BDEF/SRVD controls are synthetic compatibility regressions.
The [first independent review and correction](2026-11-03-native-declarative-v4-state-link-correction.md)
retain the evidence distinction. Missing version (including `./<name>/source/main`), foreign owner,
traversal, extra query data, duplicate alternatives and active verification with an inactive alternative
still refuse. No URL normalization, source repair, hidden activation or cleanup bypass has been added.

The single shared driver/workflow still completes create/save → activate → comment update → activate
for each owner, then deletes in reverse dependency order: SRVD, BDEF, DDLX, DCLS, abstract DDLS, view DDLS.
Native metadata and exact source bytes must match at every save/activation and before deletion.
An uncertain child preserves its dependency closure. Deletion rechecks the owned receipt and native
absence of direct children while holding its own lock. Own UNLOCK and bounded session closure keep
their narrow exception after a binding/stop refusal; foreign locks are never removed.

The existing 12-minute outer deadline, eight-minute forward allocation, four-minute cleanup reserve,
per-phase bounds, no-replay HTTP policy, stop handling and explicit partial results remain intact.
The workflow now rechecks binding after its final absence await, and the runner checks again before
persisting any result, including an already failed workflow. Late drift preserves confirmed deletions
and earlier native observations while marking failure, unconfirmed cleanup and required inspection.
Preflight and execution also recheck around credential/client initialization. The source binding
includes the immutable saved intent, prerequisite bytes and selected historical proof on each check.
Baseline age is enforced until the first native mutation; afterward only age is exempt so existing
cleanup time is not cut short. Source/proof immutability continues through cleanup and terminal reads.

## Proposed separately reviewed phase chain

Run only after an independent reviewer binds the exact clean execution checkout and full commit.
Use its actual Node **22.21.1** and `--import tsx`; unset HTTP debug and retain all existing loader,
trust-root, diagnostic and source guards. A historical review does not transfer to another revision.
The commands below are documentation, not execution approval. No phase was invoked while authoring.

1. Offline preparation, once:

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v4.ts --prepare-reviewed-declarative-v4 <FULL_REVIEWED_SHA>
   ```

   This verifies the fixed historical proof, saves the new intent and creates the private preflight
   parent, without native or credential dependencies. Inspect the saved six-owner graph and sources.

2. Separately approved fresh GET-only preflight:

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v4.ts --preflight-reviewed-declarative-v4 <FULL_REVIEWED_SHA>
   ```

   Only typed native absence of the six exact new owners and a valid suffix-free inactive inventory
   can pass. The 60-second read sample retains per-request bounds. Its saved result must postdate the
   intent. Samples may be refreshed only before an attempt; the concurrent preflight sentinel and
   every older sample remain protected. A crashed sentinel is inspected, never removed to force reuse.

3. Fresh external SM12 controls, after the successful sample: client 001, table `*`, user `*`,
   argument `*<NEW_SUFFIX>*`; and client 001, table `*`, user MARIAN, argument `*`. Both must show zero.
   Save the unmodified raw JPEG bytes with owner-only permissions in that sample directory as
   `sm12-suffix.jpg` and `sm12-user.jpg`. Do not convert, relabel or reuse old captures. Save this
   owner-only `sm12-baseline.json`, using actual observations and byte digests:

   ```json
   {
     "protocol": "pr1142-native-declarative-v4",
     "revision": "<FULL_REVIEWED_SHA>",
     "intentHash": "<SHA256_OF_SAVED_INTENT>",
     "preflightId": "<PREFLIGHT_ID>",
     "suffixSearch": {
       "observedAt": "<UTC_ISO_TIMESTAMP>", "client": "001", "user": "*",
       "table": "*", "argument": "*<NEW_SUFFIX>*", "lockCount": 0,
       "evidenceSha256": "<RAW_SUFFIX_JPEG_SHA256>"
     },
     "userSearch": {
       "observedAt": "<UTC_ISO_TIMESTAMP>", "client": "001", "user": "MARIAN",
       "table": "*", "argument": "*", "lockCount": 0,
       "evidenceSha256": "<RAW_USER_JPEG_SHA256>"
     }
   }
   ```

   The harness validates bounded JPEG signatures, raw digests, identity/filter/count fields and
   chronological freshness. It does not interpret screenshots. The operator and independent
   reviewer must verify the actual images and capture circumstances. Both observations and the
   entire preflight must remain within five minutes through the first native mutation.

4. Offline read-only prerequisite check:

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v4.ts --check-reviewed-declarative-v4 <FULL_REVIEWED_SHA> <PREFLIGHT_ID>
   ```

   No state directory, attempt, credential/native module, client or network call is created. It
   rechecks source, intent, history, all receipt/image bytes and freshness. This is not an execution
   grant: execute independently rereads every prerequisite after claiming its one attempt.

5. Exactly one separately approved attempt:

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v4.ts --execute-reviewed-declarative-v4 <FULL_REVIEWED_SHA> <PREFLIGHT_ID>
   ```

   The exclusive attempt claim precedes prerequisite/credential loading. A refusal, configuration
   failure, interruption, uncertain result or success permanently consumes it. No second prepare,
   preflight, check or execute can reopen it; another revision cannot bypass the fixed root.

After exit, obtain new suffix and all-MARIAN SM12 controls. A pass needs all six complete lifecycles,
six confirmed reverse deletions, workflow and independent terminal native absence, clean suffix
inventory, confirmed owning-session cleanup and both external zero-lock observations. Any uncertainty
requires inspection and, if needed, a separately reviewed bounded recovery. Never retry v4, repair
its source, force activation/DELETE, clear SM12 locks or remove a claim.

The author report records offline checks and the final source SHA. Independent review, actual phase
execution, current-code successful two-writer PP tests, public admission and whole-PR acceptance remain open.
