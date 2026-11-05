# Declarative lifecycle v2: fixed offline candidate

Status: **corrected offline implementation awaiting fresh exact-source review; no native execution approval**.
The [first independent review](broader-pinned-pp-writes/native-declarative-v2-review1.md)
rejected `5884adc72` before any phase ran. Its source/evidence revalidation and HTTP-debug
findings are addressed in the [review follow-up](2026-11-02-native-declarative-v2-review-followup.md);
the fixed intent remains unprepared until a new revision is independently approved.
The [original v1 experiment and separate recovery](2026-11-02-native-declarative-failure-and-recovery.md)
remain failed and successfully cleaned up, respectively. Both old claims are consumed. Their
receipts and historical rejected `Connection` source are unchanged. The proposed v2 protocol
has its own fixed name family and state directory; it cannot resume either experiment.

This is one direct HTTPS Basic-native sample on A4H/001 as MARIAN in `$TMP`. It is not PP,
transportable-package, other-release or public-admission qualification. It creates no service
binding, implementation class, table data, ABAP helper or execution endpoint. No application,
destination, identity or SAP permission changes are part of it.

## Fixture and dependency review

The existing six-owner set spans five families. V2 preserves its dependency graph and sources
apart from a distinct `ZARC1_V2{V,A,D,X,S}_<16-hex>` name family and `ARC1 declarative v2` marker.
The view uses the already corrected `ConnectionId` alias in both versions. Updates add only the
fixed review comment. Sources and dependencies are frozen and saved in the intent before native
access. No caller-selected source, object type, target, package or profile flag exists.

| Owner | Dependency and evidence checked | Remaining uncertainty |
| --- | --- | --- |
| Root view DDLS (`V2V`) | Selects only SFLIGHT `carrid`, `connid`, `fldate`; aliases are Carrier, ConnectionId, FlightDate. Repository DDLS parser and the recorded v1 DT205 failure support the alias correction. `@Metadata.allowExtensions: true` precedes DDLX. | Local parsing does not compile against the A4H dictionary or confirm native activation. |
| Root abstract DDLS (`V2A`) | Separate abstract entity with `Item : abap.char(10)`; no persistent table or class. Existing [fixture research and SAP references](2026-11-02-pinned-declarative-sources.md#review-21-and-the-next-native-fixture-plan) distinguish it from the selectable view. | Root abstract entity behavior on this exact release still needs native proof. |
| DCLS (`V2D`) | Grants select only on the newly active V2V. The role/declaration form matches `tests/fixtures/abap/zarc1_e2e_dcl.abap` and recorded SAP P_USER002 DCL source; the unrestricted grant is an existing E2E fixture form. | The exact new role has not been natively compiled. `#NOT_REQUIRED` does not establish a tested access-control effect. |
| DDLX (`V2X`) | Annotates only V2V's existing `Carrier`, uses CUSTOMER layer and an allowed UI annotation; its base explicitly allows extensions. Both versions pass the existing narrow RAP rules. | These rules are not a full DDLX grammar; annotation activation/canonicalization remains unproven. |
| Abstract BDEF (`V2A`, different owner URI) | Depends only on the active abstract DDLS, with `abstract`, `strict (2)`, `with hierarchy` and the existing mandatory-execute field. The repository research cites SAP's abstract BDEF header/entity reference. No managed/unmanaged implementation is introduced. | Those reference links are recorded research, not a new fetch or 758 compilation. First-draft metadata may expose a relative state link; the existing evidence contract refuses an unrecognized link and preserves the dependency. |
| SRVD (`V2S`) | Exposes only active V2V as Flights. The declaration/expose form is also used by `tests/e2e/rap-write.slow.e2e.test.ts`. There is no SRVB or publication. | E2E source text is not native v2 evidence; save/activation and deletion remain to be observed. |

Recorded [A4H metadata](../../tests/fixtures/declarative-owners/native-metadata.json) supports the
five owner selectors and native type/namespace identity, not these new source definitions.
The two DDLS definitions reach a local parser; BDEF/DDLX have narrow rules and DCLS/SRVD have
declaration/dependency assertions. No network, credential or native access was used for this
review. A grammar or metadata uncertainty causes a stopped, unconfirmed experiment; it never
authorizes source repair or a retry under v2.

The common workflow still completes create → activate → comment update → activate for each owner
before creating the next. Reverse deletion is SRVD, BDEF, DDLX, DCLS, abstract DDLS, view DDLS.
Deletion rechecks the owned receipt while locked and proves every direct child absent. Any
uncertain child preserves its full dependency closure. A validated own UNLOCK and bounded close
remain available after source/receipt drift or stop; no foreign lock is deleted. V1 and v2 use
the same driver and workflow, with entry orchestration extracted into `native-declarative-runner.ts`.

## Fixed protocol and proposed reviewed commands

Do not run these merely because they are documented. A separate immutable review must approve
the exact final source revision and each native phase. Use a real clean, frozen checkout at that
revision with Node **22.21.1**, its existing real dependencies and exactly the TSX loader below.
Existing runtime refusals apply, including `NODE_OPTIONS`, `GIT_*`, TLS bypass, HTTP debug,
`NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `NODE_PATH` and `TSX_*` overrides. The lockfile and
tracked source are bound; installed third-party dependency bytes are not attested. Keep the host
awake and prevent other fixture or repository activity throughout the proposed native run.

The fixed root is `~/.local/state/arc1-qualification/pr1142-native-declarative-v2`, owner-only.
It must not already exist when preparing a new intent. Do not remove or rename it to prepare again.

1. **Offline preparation:**

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v2.ts --prepare-reviewed-declarative-v2 <FULL_REVIEWED_SHA>
   ```

   This creates `intent.json` once, with the reviewed binding, exact six fixtures and fresh suffix.
   It does not read credentials or contact SAP. Inspect its output and saved sources before moving on.

2. **Separately approved GET-only preflight on those exact names:**

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v2.ts --preflight-reviewed-declarative-v2 <FULL_REVIEWED_SHA>
   ```

   This creates a new private `preflight/<PREFLIGHT_ID>` sample. It accepts only typed absence for
   all six owners and a valid inactive inventory without the suffix. Reads share a 60-second
   deadline, with the existing per-request 30-second/no-replay/2-MiB bounds. It has only a GET
   interface and read-only client safety. A failed sample remains failed. A separately authorized
   fresh read-only sample can be taken before the mutation attempt, preserving every older sample.
   A `preflight-running` sentinel prevents overlap with an attempt; a crash leaves it for inspection,
   with no automatic lease expiry or restart. Never remove it to force progress.

3. **Fresh external SM12 baseline:** after that sample completes, capture both all-table searches
   in client 001: suffix argument `*<intent suffix>*` across users (`*`), and user MARIAN with all
   arguments (`*`). Both must show zero locks. Copy the unmodified PNG captures as
   `sm12-suffix.png` and `sm12-user.png` into the selected sample directory, with owner-only mode.
   Save `sm12-baseline.json` there, also owner-only, using this exact shape:

   ```json
   {
     "protocol": "pr1142-native-declarative-v2",
     "revision": "<FULL_REVIEWED_SHA>",
     "intentHash": "<SHA256_OF_SAVED_INTENT_JSON>",
     "preflightId": "<PREFLIGHT_ID>",
     "suffixSearch": {
       "observedAt": "<UTC_ISO_TIMESTAMP>", "client": "001", "user": "*",
       "table": "*", "argument": "*<INTENT_SUFFIX>*", "lockCount": 0,
       "evidenceSha256": "<SHA256_OF_SM12_SUFFIX_PNG>"
     },
     "userSearch": {
       "observedAt": "<UTC_ISO_TIMESTAMP>", "client": "001", "user": "MARIAN",
       "table": "*", "argument": "*", "lockCount": 0,
       "evidenceSha256": "<SHA256_OF_SM12_USER_PNG>"
     }
   }
   ```

   These are operator observations. The harness checks identity/filter/count fields, time order,
   PNG signatures and digests; it does not interpret screenshots or independently read SM12.
   The operator and reviewer must verify their contents. Both captures and the entire successful
   preflight must be at most five minutes old, including immediately before the first mutation.

4. **Exactly one separately approved attempt:**

   ```sh
   node --import tsx scripts/qualification/pr1142/native-declarative-v2.ts --execute-reviewed-declarative-v2 <FULL_REVIEWED_SHA> <PREFLIGHT_ID>
   ```

   The exclusive `attempt` directory consumes v2 before prerequisites or credentials are read.
   Missing, stale, altered or incomplete proof therefore refuses without native access but still
   consumes the attempt. The saved intent and proof files are rechecked during execution; no old
   v1 or cleanup receipt can satisfy them. Native typed absence is repeated immediately by the
   common driver before forward work. Once the first mutation starts, baseline age does not shrink
   the existing 12-minute workflow/four-minute cleanup reserve. Proof immutability and source
   checks remain active. Never replay after success, failure, configuration refusal or interruption,
   even with another revision. An unexpected exception retains an explicitly unknown mutation result.

After exit, capture fresh suffix and user-wide SM12 controls again. A pass needs all six completed
owners, confirmed reverse deletions, the workflow's final absence, independent entry absence,
confirmed owning-session cleanup and both external zero-lock controls. Preserve any uncertainty,
do not repair source, repeat activation, force DELETE, delete SM12 locks or rerun v2. A separately
reviewed cleanup may be needed. Success still would not close PP/public or whole-PR acceptance.

## Offline checks and remaining review

V1 and v2 both run through the existing real-adapter mock lifecycle matrix, including uncertain
saves, metadata/source drift, live-child deletion guards, budget/stop behavior and secret sweeps.
New isolated entry tests cover intent/claim separation, fixed runtime, exact GET-only preflight,
SM12 evidence/freshness, drift during execution, concurrent phase refusal, failures and replay.
Fixture tests exercise both source versions and exact dependencies for both families.

The final author report records the exact local check results and source commit. This document is
an offline candidate description, not an independent review verdict or native-run GO. Public
read companions/admission, two successful PP writers, transportable flows and other families
remain separate work under FEAT-93.
