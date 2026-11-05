# Pinned PP formatter adapter and qualification — 1 November 2026

The latest [combined qualification](2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
at `1b234d3a4` passed all 262 formatter assertions, including nondefault v5 preference preservation
and full primary-user pre-seed restoration. Its limits and the actual Claude review are recorded
there. The earlier checkpoints below remain historical evidence, not current readiness claims.

This record began as the native-adapter checkpoint at `70ab1f7b4` for draft PR #1142. The subsequent
integration admits `SAPLint.set_formatter_settings`, `format` and `get_formatter_settings` only on
writable pinned PP connections. The normal single-target implementation is unchanged apart from
correcting its scope description. The integrated build at `69b28b22e509517b268981ce0538220aea49db3c`
produced the 241-assertion MCP-visible result below. Claude reviewed it and did not accept
in-run SAP actor/backend proof; that finding led to the stronger run linked above.

## Scope correction

SAP's [Defining ABAP Formatting Options](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/81717979de0243658237fbe2be5a2c6e.html)
documents these preferences as user-specific, stored for the selected system connection and shared
with that user's ABAP Workbench settings. The former "global/system-wide formatter settings" wording
in current tool descriptions and operator documentation was incorrect and is corrected here. Older
research/planning records retain the assumption they originally made; this evidence supersedes it.

This documentation establishes the intended native scope. The separate two-user test below checks
that scope on the configured PP route. Repository package/transport allowlists are not ownership
evidence for formatter preferences.

## Candidate protocol

`src/adt/pinned-formatter.ts` requires a registered pinned mutation context and enabled write policy.
All GET/PUT calls use the scoped HTTP facade, one finite deadline and cancellation signal, and disabled
replay/transient retries. The current helper patches only explicit supported fields into native v5 XML.
Earlier revisions used v2; the read-only investigation below found that representation insufficient
to preserve newer preferences. Older representations are now refused without a PUT or fallback.
It retains other attributes and comments, resolves XML entities exactly once, handles attribute
whitespace correctly, and rejects missing/duplicate fields, unknown styles/shapes, foreign namespaces,
unsupported declarations and invalid entity references. Parsing is bounded to 16 KiB after the HTTP
response has been buffered; this is not a streaming response-size limit.

The outgoing document is validated before PUT. Read-back must confirm both requested settings and
unchanged unrelated attribute values. An already-matching request performs no PUT. A strong native
ETag becomes `If-Match`; without one the result explicitly says `native-unconditional`. This is a
read/merge/write operation without atomic conflict protection on backends that omit strong ETags.
Read-back cannot prevent a concurrent same-user preference update from being overwritten.

Results distinguish unchanged, updated, rejected and unconfirmed outcomes. A timeout/network failure,
429 or 5xx after submission does not imply rollback or safe retry. Native diagnostics are not copied
into the result. No fictitious repository owner or package check is introduced.

### Complete representation correction

Read-only source and endpoint inspection on A4H/001 on 1 November found an additional native
contract defect after the earlier production source review. `CL_SEDI_ADT_RES_PP_SETTINGS` exposes
`keepIdentifier` and `formatMethodCalls` only from v3, `condenseMethodCalls` and `defaultAutoStyle`
from v4, and `formatValue` from v5. Its PUT passes all of these fields to
`CL_SEDI_PRETTY_PRINTER.SET_WB_SETTINGS`, including initial values for omitted fields; that method
saves them. The `SEDI_ADT_PP_SETTINGS` transformation omits default values when serializing and
does not merge missing values from the user's stored preferences. Consequently, merging a v2
GET document cannot preserve nondefault preferences that were omitted from that representation.

The current pinned adapter requests SAP's preferred representation with `Accept: */*` and requires
v5 for initial GET, PUT and read-back. It does not force an older response if SAP prefers a future
version. It preserves all unrelated native attributes and refuses other response types before submission. No compatibility
fallback is claimed for older SAP services. The independent native qualification reader also uses
v5. Unit regression coverage includes all five newer preferences with nondefault values and each
older representation's rejection plus an unknown future version. Current-revision mutation/PP qualification and review are still
required; these read-only checks are not a successful live v5 write test.

The preferred read returned v5. The read-only v2 and v5 responses for the primary user were byte-identical and contained no optional
preferences at the time of inspection. This does not reconstruct either user's earlier preferences.
The historical v2 restoration checks below establish only the fields visible in v2, not preservation
of the hidden newer fields. The legacy single-target adapter remains separate and still uses v2;
its version/preservation fix needs separate compatibility review as required by the plan.

Source inspection confirms that the formatter POST uses Workbench settings and does not save source.
The case-mode helper itself was not supplied to the reviewer, so its behavior was an expectation,
not an inspected contract. The later PP run directly tested distinct upper/lower keyword output.

The [read-only contract record](broader-pinned-pp-writes/formatter-v5-contract-2026-11-01.json)
contains endpoint results and source hashes; SAP implementation bodies remain outside the repository.
The v5 correction passes the full unit suite (391 files / 10,852 tests), typecheck, build, lint and
strict documentation build. The 29 harness fault simulations also pass. A focused actual Claude
review of this correction and the stronger live run remain pending.

## Direct native test and restoration

The qualified URL was `https://a4h.marianzeis.de`, client `001`, with certificate validation enabled.
The acting direct-authentication account was `MARIAN`; this was **not an XSUAA/PP test**.

1. GET returned the v2 representation, indentation `true`, style `keywordUpper`, and no ETag.
2. A partial patch changed indentation to `false` while preserving the style.
3. The adapter and a separate GET both confirmed the change.
4. A fresh bounded context restored the original settings.
5. A final independent GET confirmed the settings and returned byte-identical original XML.

Cleanup first checked whether the current document matched the test's expected state or the original.
It would refuse to overwrite an unexpected concurrent preference change. No SAP roles, destinations,
XSUAA configuration, transport requests or repository objects were changed by this test.

The machine-readable [evidence record](broader-pinned-pp-writes/formatter-native-2026-11-01.json)
contains the timing, outcomes and hashes, without credentials. The live run preceded addition of one
extra outgoing-document equality check for unrelated attributes; the subsequent unit run includes
that check. This was the historical v2 checkpoint; later v5 contract research and qualification are separate.

## Native-candidate verification

The focused suite has 42 tests, including raw field/type rejection, strict XML preservation,
registered context ownership, write gates, deadline/cancellation propagation, native status handling,
ETag behavior, no-op handling and read-back mismatches. They exercise the native adapter; they do not
prove functional scope enforcement or the HTTP multi-target route, which must be tested when wired.

The full suite passed **388 files / 10,726 tests**, with typecheck, build, lint, file/schema budgets
and strict documentation build. Its first run identified the decoder's explicit importer allowlist;
the new raw-XML boundary was added without permitting general output double-decoding, then the full
suite passed. Seven public tool snapshots changed only the corrected formatter scope description.

At this native-candidate checkpoint, handler integration, companion projection, two-user PP behavior
and actual Claude Code Opus 5.5 max review were still outstanding. The following sections record the
subsequent work without treating the earlier direct-authentication test as PP evidence.

### Handler and companion integration

The following delta routes all three SAP-backed formatter actions through an explicit pinned handler.
It rechecks selected-target identity and effective write policy, preserves the normal scopes (`write`
for settings, `read` for companions on an otherwise writable pinned connection), and refuses to enter the legacy handler when multi-target state
is present but incomplete. Raw fields and input validation are checked before PP preparation. The
existing Zod schema remains authoritative for loose boolean normalization, including `"false"` and `0`.

The capability matrix now contains five mutations. The two formatter companions have a separate
explicit read table, bounded to normal read/intelligence policies and writable pinned exposure.
Catalog action projection does not simulate a fully populated invocation; required mutation inputs
can therefore be rejected early without accidentally hiding the action. Annotations are finalized
after functional scopes and deny actions. Reader, writes-off destination, global-readonly, aggregate
and Basic route tests keep their original formatter action lists and refuse direct hidden calls.

This integration adds 32 tests across route preparation and the real dispatch/native-HTTP boundary.
The full suite passed **389 files / 10,758 tests**, plus typecheck, build, lint and file/schema budgets.
The native candidate evidence above remains valid for its protocol; the following live run covers
the new handler. The subsequent review and evidence limits are recorded below.

## Two-user pinned PP qualification

The exact `69b28b22e` build was staged and selected on the existing isolated CF test app. Package
staging and droplet selection preserved its route. The temporary destination `PR1142/001` and the
existing read-only `A4H/001` both resolved to A4H/client 001. Both test identities received exact
write grants for **both** target IDs. The original A4H destination's omitted `arc1.allow_writes`
remained false, so its refusal supports the destination ceiling based on the reported configuration; the refusal code
itself does not identify which gate applied.

Operator handling records report that all three tokens stayed in the local harness process;
this is not an exhaustive persistence attestation. Before any SAP request the harness verified
signature/audience/expiry, expected email and IdP origin, read/write scope, exact write grants, read
grants and remaining lifetime. The two writers used the identities previously mapped to `MARIAN`
and `ARC1_WG_RO`; the third token belonged to the primary identity with a read scope and no write scope.

An initial browser sign-in reused the secondary identity and was refused before backend calls.
After explicit sign-in, the first qualification reached SAP but the secondary user's original
display-only role could not read preferences. The run stopped before any mutation. Its failed
preflight is retained separately. The previously configured `Z_ARC1_PR2_TEST` role was temporarily
assigned through WebGUI, with validity limited to 1 November, and its generated profile verified.
This was not a minimum-permission experiment; the role also permits the earlier class test work.

The fresh qualification completed **241 assertions, zero failures**:

1. Both users began with indentation `true` and style `keywordUpper`, verified by repeated reads.
2. Primary indentation changed to `false` using the string input `"false"`; its style stayed intact.
   The secondary user's settings remained unchanged.
3. Secondary style changed to `none`; its indentation stayed intact. The primary settings retained
   their distinct expected value.
4. Both identities received formatter output containing the submitted program name. Keyword-case
   behavior and repository absence were not independently asserted.
5. A read-only token, the read-only destination with a valid write grant, `/multi/mcp` and
   `/authorize` hid all three formatter actions and refused each direct invocation with the exact
   `MULTI_TARGET_OPERATION_FORBIDDEN` code. Both settings were read back unchanged after each group.
6. Secondary then primary preferences were restored and read back. A separate direct-authenticated
   native GET as MARIAN returned **byte-identical original XML**.

Every response was checked for private/no-store caching. The harness saved an exclusive attempt
record before each forward mutation and refused blind replay. Restore checked that the two exposed
fields matched the original or expected state before its PUT; this does not protect against an
intervening concurrent change. Six simulated scenarios additionally checked replay protection, shared preferences,
a response lost after a secondary update, an unrelated concurrent change, a cleanup-read failure
and incorrect login identity. These simulations are harness checks, not native SAP evidence.

Separate operator-run controls restored and compared the original SAP role, validity and profile; the
temporary role definition remains unassigned. The original app droplet, full user environment,
route and XSUAA descriptor were restored. Temporary IAM role/collection and destination were
deleted and absence verified; `/health` returned 200. The operator recorded token disposal and closed the test tabs.
The [PP evidence record](broader-pinned-pp-writes/formatter-pp-2026-11-01.json) contains the source
revision, source/harness hashes, assertions and restoration facts without credentials.

### Limits

The actual Claude Code Opus 5.5 max [closing review](broader-pinned-pp-writes/claude-qualification-review-20261101.md)
accepted the token, exact-refusal, differing-write and replay checks at source level. **It did not
accept same-backend/same-actor mutation proof (FMT-1).** This run establishes MCP-visible state on
the configured route. Both SAP mappings rely on earlier class evidence and reported configuration;
there was no native sentinel or during-write native preference read in this run. The secondary
role change turning a refusal into success supports its mapping, but does not replace that proof.
Only the primary ended byte-identical to its pre-run native XML; this alone does not show that
the pinned writes reached that record. Secondary restoration checks two
fields through the candidate route. The six simulations did not test every negative oracle or
actual restore-only recovery. A strengthened current-revision run remains required. Same-user
concurrent updates still have the documented native-unconditional risk when no strong ETag exists.
Basic/global-readonly/deny-rule boundaries have unit coverage but were not new live fixtures here.
This formatter result does not qualify CTS, traces, FLP, broad CRUD or whole PR #1142 for merging.

These historical writes and byte comparisons used v2. Those PUTs may themselves have reset hidden
preferences for both test users; their pre-run values were not captured and cannot be reconstructed
from today's empty optional fields. No live v5 write or full v5 restoration has been verified yet.

### Follow-up review and nondefault fixture

The actual [v5 review](broader-pinned-pp-writes/claude-formatter-v5-review-20261101.md) found no adapter
bug in the readable source, but could not inspect native proof outside its restricted directory.
It also identified an evidence blocker: an empty optional-field baseline would let the old lossy
writer pass the proposed native comparisons. The revised fixture saves the full pre-seed XML before
any PUT, seeds all five optional preferences, and requires their nondefault values before PP writes.
During-write checks compare the complete document. After the two-field PP restoration, native
cleanup compares the current state with the original or owned seeded state, restores the saved
original XML, and verifies it byte-for-byte. Unknown/foreign state is preserved and reported incomplete.
This adds direct-native primary fixture setup; it does not add independent native preference proof
for the secondary user. Its source review and live run remain pending.
