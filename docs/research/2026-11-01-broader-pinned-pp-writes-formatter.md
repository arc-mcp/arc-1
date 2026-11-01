# Pinned PP formatter adapter candidate — 1 November 2026

This record began as the native-adapter checkpoint at `70ab1f7b4` for draft PR #1142. The subsequent
integration admits `SAPLint.set_formatter_settings`, `format` and `get_formatter_settings` only on
writable pinned PP connections. The normal single-target implementation is unchanged apart from
correcting its scope description. The integration is still awaiting Claude review and live PP
qualification; it is not a completed release acceptance.

## Scope correction

SAP's [Defining ABAP Formatting Options](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/81717979de0243658237fbe2be5a2c6e.html)
documents these preferences as user-specific, stored for the selected system connection and shared
with that user's ABAP Workbench settings. The former "global/system-wide formatter settings" wording
in current tool descriptions and operator documentation was incorrect and is corrected here. Older
research/planning records retain the assumption they originally made; this evidence supersedes it.

This documentation establishes the intended native scope. It does not independently prove that two
different PP users retain separate preferences on the configured route; that remains a live admission
check. Repository package/transport allowlists are not ownership evidence for formatter preferences.

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

## Verification and remaining admission work

The focused suite has 42 tests, including raw field/type rejection, strict XML preservation,
registered context ownership, write gates, deadline/cancellation propagation, native status handling,
ETag behavior, no-op handling and read-back mismatches. They exercise the native adapter; they do not
prove functional scope enforcement or the HTTP multi-target route, which must be tested when wired.

The full suite passed **388 files / 10,726 tests**, with typecheck, build, lint, file/schema budgets
and strict documentation build. Its first run identified the decoder's explicit importer allowlist;
the new raw-XML boundary was added without permitting general output double-decoding, then the full
suite passed. Seven public tool snapshots changed only the corrected formatter scope description.

Before admission, integrate the partial-patch handler without using the legacy parser's fallback
defaults; add only the reviewed formatter companions to writable pinned catalogs; retain all existing
reader/aggregate/Basic surfaces; qualify the two-user PP behavior; and complete the requested actual
Claude Code Opus 5.5 max review. This checkpoint is not parity or merge acceptance.

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
The native candidate evidence above remains valid for its protocol, but does not substitute for the
new handler's upcoming two-identity PP qualification or the pending Claude review.
