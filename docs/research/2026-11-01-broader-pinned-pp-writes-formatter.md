# Pinned PP formatter adapter and qualification — 1 November 2026

This record began as the native-adapter checkpoint at `70ab1f7b4` for draft PR #1142. The subsequent
integration admits `SAPLint.set_formatter_settings`, `format` and `get_formatter_settings` only on
writable pinned PP connections. The normal single-target implementation is unchanged apart from
correcting its scope description. The integrated build at `69b28b22e509517b268981ce0538220aea49db3c`
passed the two-user PP qualification below. Claude review is still pending; this is not a completed
release acceptance.

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
replay/transient retries. The helper patches only explicit supported fields into the native v2 XML.
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
that check. No additional native request was needed to establish a different endpoint contract.

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
for settings, `read` for companions), and refuses to enter the legacy handler when multi-target state
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

All three tokens stayed in the local harness process. Before any SAP request the harness verified
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

Cleanup restored and independently compared the original SAP role, validity and profile; the
temporary role definition remains unassigned. The original app droplet, full user environment,
route and XSUAA descriptor were restored. Temporary IAM role/collection and destination were
deleted and absence verified; `/health` returned 200. Tokens were discarded and test tabs closed.
The [PP evidence record](broader-pinned-pp-writes/formatter-pp-2026-11-01.json) contains the source
revision, source/harness hashes, assertions and restoration facts without credentials.

### Limits

The actual Claude Code Opus 5.5 max [closing review](broader-pinned-pp-writes/claude-qualification-review-20261101.md)
accepted the token, exact-refusal, differing-write and replay checks at source level. **It did not
accept same-backend/same-actor mutation proof (FMT-1).** This run establishes MCP-visible state on
the configured route. Both SAP mappings rely on earlier class evidence and reported configuration;
there was no native sentinel or during-write native preference read in this run. The secondary
role change turning a refusal into success supports its mapping, but does not replace that proof.
Only the primary has native byte-level restoration evidence; secondary restoration checks two
fields through the candidate route. The six simulations did not test every negative oracle or
actual restore-only recovery. A strengthened current-revision run remains required. Same-user
concurrent updates still have the documented native-unconditional risk when no strong ETag exists.
Basic/global-readonly/deny-rule boundaries have unit coverage but were not new live fixtures here.
This formatter result does not qualify CTS, traces, FLP, broad CRUD or whole PR #1142 for merging.
