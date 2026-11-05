# Fixed native RAP and managed-BDEF documentation qualification

This source-only candidate extends the separate six-owner RAP/publication experiment with its own
managed-BDEF SKTD document. The new fixed protocol/root is `pr1142-native-rap-documents-v1`;
`native-rap-documents-entry.ts` exposes only prepare, GET-only preflight, nonclaiming check, and
once-only execute. The original six-owner protocol is preserved. Neither this document nor offline
mock tests grant native execution, PP qualification, public admission, or merge approval.

## One graph and one remaining document contract

The six RAP owners and their existing stages remain: transparent table (including separately tracked
implicit technical settings), root CDS entity, behavior-pool class, managed behavior definition,
service definition, and V4 service binding. The seventh owner is SKTD with the BDEF's exact name and
native `BDEF/BDO` reference. It is created after explicit pool/BDEF activation, before the service and
binding stages. This reuses the native generated create/update documentation nodes instead of creating
another RAP graph. The separate ENHO lifecycle still needs its own owned implementing class and spot
contract; it is not covered here. `batch_create` and general RAP parity also remain outside this slice.

The fixed SKTD sequence creates the native envelope, writes a root marker through the actual document
create helper, activates it, saves create-node prose, saves update-node prose and both operation short
texts, then activates the document again. Each partial save reads the default developer view and
proves the earlier root/create prose remains. Its previous active counterpart must retain the prior
complete content while the edits remain drafts. The complete native document, including opaque nodes,
is compared after each save and activation. The selected root/create/update nodes, their native IDs,
long-text eligibility, short-text eligibility, UTF-8/base64 values, creator, actual package, and BDEF
reference are checked independently. A missing/ambiguous/unsupported native node stops the run.

Document deletion precedes generated-binding/service/BDEF/pool/view/table cleanup, so the reference is
removed before its BDEF owner. Every deletion still needs exact native absence; later present or
uncertain observations remain residual inspection facts even after an earlier confirmed deletion.
There is no automatic catch cleanup, arbitrary resume, or retry of an ambiguous mutation.

## Evidence and limits

The source contract is grounded in `2026-09-02-sktd-multi-node-write.md`,
`2026-09-04-sktd-short-texts.md`, the retained managed-BDEF KTD slow lifecycle test, and the current
private document parsers/writers. The A4H/001 read-only capture of `ZARC1SKTDMO1FSEY21IL3` has the same
2,339-byte active SKTD representation for default/active/inactive requests (SHA256
`630404bbafb49dda19087dc2b68736234429dc65378a0d31c4afd0ed30c67d82`). It proves the metadata/read shape,
not ownership or the new graph's multi-node write outcome. Requested inactive does not establish an
actual draft; native state and complementary links control every assertion.

The experiment uses the current private production context, document create/update/delete and
activation functions, real client factory and shared lifecycle. No production schema, permission,
public capability or adapter is changed. Tests use guarded synthetic HTTP with all native dispatchers
mocked, including direct/proxy auth waits and actual entry-to-client composition. They do not establish
native acceptance of the fresh graph.

The existing source/runtime/intent binding, immutable fresh post-prepare raw-JPEG SM12 evidence,
original deadline, final-dispatch checks, one consumed claim, and separately bounded owning cleanup
remain. The additional graph uses a fixed 768-call ceiling (the six-owner graph retains 640), the same
four-minute window and 2 MiB aggregate response ceiling. The qualification-only response adapter also
clamps document mutation response allowances to that ceiling before observer admission; it does not
raise production limits. If the real native graph exceeds any bound, it stops and preserves evidence.

Publication remains native-governed/unverified for recording, and generated binding cleanup remains
accepted/unverified where independent generated-resource absence is unavailable. There is no claim
that this Basic-native experiment proves PP identity, transport recording, or full public availability.

## Exact phase chain for a separately reviewed candidate

Use the independently reviewed full revision, a clean frozen execution checkout, the verified
Node 22.21.1 binary, and the existing fixed native runtime constraints. The fixed entry accepts:

```text
native-rap-documents-entry.ts --prepare-reviewed-rap-documents-v1 <full-revision>
native-rap-documents-entry.ts --preflight-reviewed-rap-documents-v1 <full-revision>
native-rap-documents-entry.ts --check-reviewed-rap-documents-v1 <full-revision> <fresh-preflight-id>
native-rap-documents-entry.ts --execute-reviewed-rap-documents-v1 <full-revision> <fresh-preflight-id>
```

Prepare does not load credentials or create a native client; check is read-only and does not claim an
attempt. Preflight is bounded GET-only. Fresh operator baseline receipts must follow preparation and
preflight. Execute repeats every prerequisite and claims permanently before native work. Exact
execution commands, environment exclusions and independent native GO belong to the later reviewed
operator handoff; no phase has been run during authoring.
