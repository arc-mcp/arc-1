# Fixed text tail after the current PP fixture refusal

This qualification-only candidate corrects the fixed PROG symbols payload and continues only the
unfinished tail. No production writer, transport/MIME policy, SAP permission or public admission
changes. Exact-source review and fresh operator execution remain required.

## Preserved execution facts

The separately claimed `4d2724fc5849375a5e7a6b391eb1484cf5437600` continuation
`adc9869a-07d3-4923-af84-7bd18f42d206` verified all three OAuth identities/scopes and completed the
PROG create, update, expected stale refusal and activation. Its fifth mutation-intent RPC returned
`text-save-unknown`, HTTP 406, with owning session closed. No denial or DELETE followed. The failed
result remains `c5967814cf86158ded9154f1c1a3d062242532b67baa395f76058d27790b273c`.
The first run's two classes and include, plus the newly created PROG, remain owned residuals.
The original run/claims and unsuccessful text outcome are never rewritten as success.

The fixture omitted the per-row `@MaxLength` annotation required by the existing native contract.
`tests/integration/text-elements.integration.test.ts` already covers annotated writes and missing-length
406 rejection. The corrected fixed row has 27 ASCII characters and now requests `@MaxLength:27`.
The readback verifier preserves the complete value and annotation; only CRLF, empty lines and spaces
after the annotation colon may differ. It does not normalize arbitrary source or relax production code.

Sixteen separately retained GET responses returned HTTP 200. Native metadata identifies the actual
PROG and text pool as active; all queried source views have the same updated 241-byte source,
`228b716d93df8b5a129db782a27594528a1e25e41877f0343c98660ca5764643`. Symbols and selections are empty;
headings remain their stored 81-byte value. Querying `version=inactive` does not prove a draft.
PROG `createdBy` is absent. Its successful actor-bound PP CREATE receipt establishes owned provenance,
not a fabricated native creator. All three fresh post-run SM12 images show zero entries with the
exact suffix and two SAP-user filters; timestamps are operator capture evidence.

The independent private audit JSON is bound by
`2cd92da57b517010dfef601da52d86249899bf817b3b5f8f189cbf7f03e2c369`. It preserves the operator's
pre-claim correction from a raw deployment-file digest to the required canonical JSON receipt digest,
including both prepared-manifest versions. The earlier failed binding check sent no RPC and created
no execution claim. The audit's 141 entries include one FIFO and one private credential file. The
audit checksummed credentials only; the new history loader never opens credentials or the FIFO.
It validates every other historical file's bytes/mode/owner, exact membership and both consumed
run histories, including the successful PP creation receipts and separate INCL/PROG native reads.

## Fixed graph and execution

The same four owners are selected; no caller-selected resume offset or owner graph exists:

| Owner | PP actor / package | Remaining mutation |
| --- | --- | --- |
| `ZARC1_PP_CA_C0F4DEE08D0A` | writerA / ZARC1_DEMO | Denial sentinel, final PP delete |
| `ZARC1_PP_CB_C0F4DEE08D0A` | writerB / $TMP | PP delete through writerB |
| `ZARC1_PP_I_C0F4DEE08D0A` | writerA / ZARC1_DEMO | PP delete after the PROG |
| `ZARC1_PP_P_C0F4DEE08D0A` | writerA / ZARC1_DEMO | Corrected text save/readback, then PP delete |

Recording remains exactly MARIAN's request `A4HK906605` and task `A4HK906606`. The recording-only
profile keeps transport management disabled and exact request policies. It does not create or release
a CTS request or expand package/role permissions. Secondary access remains the operator-authorized,
limited existing role; this source change neither grants nor extends it.

The fixed new root is
`/Users/marianzeis/.local/state/arc1-qualification/pr1142-current-pp-text-tail-v1`.
The shared manifest retains `current-pp-workflows-v1`; its new immutable descriptor, claim and result
identify `current-pp-text-tail-v1`. Normal preparation refuses both reserved retained roots.
The old retained profile remains source-compatible, but its consumed real claim cannot be replayed.

After independent source review the operator must:

1. Freeze the exact candidate, bind the actual source/deployment artifact and canonical deployment
   receipt, and establish a drained, non-overlapping CI/native window with the host awake.
2. Set the existing non-secret actor configuration and `ARC1_QUALIFICATION_STATE_DIR` to the exact new
   root. Run once: `node scripts/qualification/pr1142/prepare-current-text-tail.mjs PRIVATE_BINDINGS.json`.
   This offline preparation loads no credentials, performs no HTTP request and makes no execution claim.
3. Use the existing GET-only reader with `identity NAME FRESH_UUID` for each of the four exact owners:
   `node --import tsx scripts/qualification/pr1142/current-workflow-native.mts identity NAME FRESH_UUID`.
   Inspect actual source/state/package, creation provenance and recording. Initial PROG pool metadata
   and all three part hashes must match the sealed active empty-symbol baseline. No absent-owner
   preflight or new PROG creation is permitted. The worker observes; it never cleans up.
4. Capture/inspect genuinely fresh post-prepare raw JPEG controls for suffix `*C0F4DEE08D0A*`, MARIAN
   and ARC1_WG_RO, client 001/table `*`, using the unchanged baseline schema. Obtain fresh writerA,
   writerB and readerA OAuth sessions through the named scope profiles and existing callback flow.
5. Start the unchanged `live-harness.mjs` with reviewed private runtime paths. Submit exactly once:
   `{"command":"qualify","plan":"current-pp-text-tail-v1"}`. The permanent claim precedes mutations.
   The runner repeats all four native baseline checks, source/catalog/scope and recording checks;
   skips every completed create/update/stale/activate step; saves only the corrected symbols; verifies
   active native readback and unchanged selections/headings; then performs the four denial routes,
   recording checks and reverse PP deletion: PROG → INCL → writerB CLAS → writerA CLAS.
6. Stop/drain, discard sessions, obtain actual fresh post-SM12 controls, independently audit every
   result and restore the app/IAM configuration through the operator ledger. No success is assumed here.

Every MCP handoff retains the final synchronous source/history/deployment/control proof after async
work, followed by stop/deadline/freshness checks. The eight-minute request window and initial
five-minute control freshness remain unchanged. Native observations and public deletion are separate
operations, not an atomic hash-conditional native DELETE. The non-overlap condition remains necessary.
Any changed owner, source, text part, context, recording or unconfirmed outcome stops and retains
exact residuals. There is no catch cleanup, rollback or replay. Confirmed deletions survive later errors.

This does not qualify Basic-route denial, every accepted resource group, publication cleanup or the
whole PR. Historical writerB creation is retained as historical evidence, not newly claimed on the
4d build. Current-build acceptance, independent execution audit, remaining family workflows and final
CI/review remain FEAT-93 work.
