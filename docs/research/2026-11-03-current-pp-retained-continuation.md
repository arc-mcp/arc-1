# Fixed continuation of the retained current PP workflow

This is a source candidate for independent review, not a native execution approval or PR qualification.
The observer correction was independently approved at `1c6418deff5f9830dfbe10a65de3f1fef6fc31f2`.
Its missing-creator contract and limitations are in
[current PP creator evidence](2026-11-03-current-pp-native-creator-evidence.md).

## Preserved failure and scope

The original `9e947c0bbfbfd2d03d572787589d8f2c693ceb3a` run
`01e3783c-ddbd-4353-b71b-af213f4417a7` permanently failed at the INCL native observer.
Its result hash remains
`f1a4085d1c34565e4fc8c2a0c295ed4a531906fc869d7c0d9a50f39a298be964`.
All fourteen mutation-intent MCP requests received responses: eleven successful write/activation
responses and three expected stale-hash refusals. No DELETE was submitted. Both classes completed
native active/creator/source verification. The INCL activation response succeeded; the observer
incorrectly required a native `createdBy` attribute absent from that representation. PROG was
unattempted. None of those completed writes, edits, stale probes or activations is replayed.

The fixed continuation owns only these previously planned names:

| Owner | Principal / context | Remaining work |
| --- | --- | --- |
| `ZARC1_PP_CA_C0F4DEE08D0A` | writerA / MARIAN / ZARC1_DEMO | Fresh immutable identity/source proof, denial sentinel, PP deletion |
| `ZARC1_PP_CB_C0F4DEE08D0A` | writerB / ARC1_WG_RO / $TMP | Fresh immutable identity/source proof, deletion through writerB PP |
| `ZARC1_PP_I_C0F4DEE08D0A` | writerA / MARIAN / ZARC1_DEMO | Fresh active source/provenance proof, PP deletion after PROG |
| `ZARC1_PP_P_C0F4DEE08D0A` | writerA / MARIAN / ZARC1_DEMO | Fresh typed absence, remaining create/edit/stale/activate/text workflow and PP deletion |

Recording stays exactly request `A4HK906605`, own task `A4HK906606`, owner MARIAN.
The 84-file original audit ledger is hash-bound by
`bf1bddd3590402186e853bb998c7e1c71085ede2955bb875f1661395c4b030f6`.
The separately captured five INCL GETs and their summary are individually hash-bound. They show
unchanged metadata `233c1574592fa69c594061d3b476d1ff773e24303e6738937a746c30487950d8`
and source `75ad788eaa766d38ee29ba94b33f018e8dddf4fcf02ff58d18947d982b879b3a`.
An inactive-version query returning the same source is not evidence of an inactive state: the
native metadata establishes active state. Every retained owner is reread before any new mutation.

## Fixed source and phase chain

`current-retained-history.mjs` binds the one failed run, all original file hashes/modes/owners,
its successful create RPC receipts, the same actors' independently observed native class creators,
and the separate INCL read packet. It never changes original records or invents a `verifiedActors`
field in the old journal. The fresh continuation records its own verified actors. Native CLAS creator
remains mandatory. Missing INCL/PROG creator remains explicitly unknown and needs the successful,
actor-bound PP-create provenance; a present wrong creator is refused. `responsible` is never a substitute.

The new root is fixed to
`/Users/marianzeis/.local/state/arc1-qualification/pr1142-current-pp-retained-v1`.
There is no arbitrary resume/root/owner flag. Ordinary fresh-run preparation/qualification refuses
this reserved root. `prepare-current-retained.mjs` accepts only the fresh deployment/recording
bindings file. It checks history and the exact old graph before exclusively creating a new run.
Its shared fixture-manifest format stays `current-pp-workflows-v1`; the run has the immutable
`retained` descriptor, and the execution claim/result use `current-pp-retained-workflows-v1`.

After independent exact-source review, the operator must:

1. Freeze the committed checkout and bind its actual deployment artifact/droplet. Retain original
   artifact provenance; byte equivalence permits reuse only after an actual comparison and a new
   deployment receipt. Confirm drained operations/CI and coordinate a non-overlapping SAP window.
2. Configure the same five non-secret actor fields (`ARC1_TEST_PRIMARY_EMAIL`,
   `ARC1_TEST_PRIMARY_SAP_USER`, `ARC1_TEST_SECONDARY_EMAIL`, `ARC1_TEST_SECONDARY_SAP_USER`, and
   `ARC1_QUALIFICATION_STATE_DIR` set to the fixed new root), then invoke preparation once:
   `node scripts/qualification/pr1142/prepare-current-retained.mjs PRIVATE_BINDINGS.json`.
   Preparation loads no credentials, calls no endpoint and claims no mutation attempt.
3. Capture fresh GET-only preflight evidence through the existing native reader: three `identity`
   invocations for the exact retained names and one `absence` for the exact PROG, each with its own
   fresh UUID. The invocation is `node --import tsx scripts/qualification/pr1142/current-workflow-native.mts MODE NAME UUID`.
   The native reader is GET-only; its normal operator-authorized native credentials are required.
   This profile refuses the old all-absent `preflight all` mode.
4. Capture three genuinely fresh post-prepare raw JPEG SM12 controls (suffix, MARIAN and ARC1_WG_RO)
   under the existing exact baseline contract. Inspect the actual filter/result pixels. Obtain three
   fresh OAuth sessions through the unchanged callback/profile flow; no prior bearer is reused.
5. Start the existing `live-harness.mjs` with its reviewed private credential/auth-module paths and
   existing approved callback configuration. Submit exactly once:
   `{"command":"qualify","plan":"current-pp-retained-workflows-v1"}`.
   The new exclusive claim is permanent even on failure. Execution repeats all native prerequisites,
   current catalog/recording checks and source/control proofs before the remaining program work.
6. Stop/drain the harness, discard sessions, take fresh post-controls, audit all receipts and restore
   the app/access configuration under the existing operator ledger. No result here completes those steps.

The shared loop performs the remaining PROG/text workflow, four denial routes, recording checks and
reverse PP deletion: PROG → INCL → writerB CLAS → writerA CLAS. It does not execute ABAP/test methods,
create CTS requests, expand roles, or use Basic native cleanup. The native worker only observes.
Any failure stops immediately with explicit retained/current residuals; there is no catch cleanup,
rollback, claim reset, new fixture family or retry after uncertain submission.

## Boundaries and evidence limits

Before every MCP send, this profile synchronously rechecks Git/source, the harness and auth closure,
lockfile, original history, fixture/deployment records and raw control hashes after asynchronous
proof work. Stop, the eight-minute deadline and initial five-minute baseline freshness are checked
**after** that synchronous work. Terminal proof is repeated after the final awaited evidence read;
confirmed deletion facts survive a terminal binding failure. This is the client MCP dispatch
boundary, not a new server-side native dispatch trace. Other installed dependency bytes remain
outside the existing attested JavaScript closure. Deployment and visual control receipts are
operator evidence, not automatic CF attestation or a universal lock assertion.

Fresh native identity/source equality precedes public DELETE. Public deletion is not an atomic
hash-conditional native operation; the required non-overlapping operator window remains explicit.
Typed absence is recorded after each acknowledged deletion. A missing native creator stays unknown;
create provenance does not manufacture it. Basic destination denial, other accepted operation groups,
final current-code PP evidence and whole-PR merge readiness remain separate gates.

No current owned A4H standalone PROG metadata packet exists yet: the original PROG was unattempted,
and the separately observed procedural graph contains FUGR/FUNC/structural INCL only. The NPL program
fixture is not A4H evidence. This candidate keeps every other native identity/state/source check
strict and requires actual fresh PROG verification; a new representation mismatch stops with residuals.
