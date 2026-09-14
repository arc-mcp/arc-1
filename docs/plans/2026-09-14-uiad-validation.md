# UIAD write validation and editable creation

## Problem and evidence

Customer B-3 reports a generic UIAD save error. The current SDO writer only parses JSON,
creates metadata before semantic validation, and can mask a failed PUT with an unlock failure.
On SAP_BASIS 816 we reproduced SWB_TOOL036, then successfully created a manual Cloud-language
UIAD, checked a complete candidate, saved it, read the target URL back, and deleted the fixture.
The separate 758 SP02 target does not advertise this UIAD AFF endpoint.

The existing text/plain inline check protocol is wrong for UIAD: application/json is required.
An empty technical catalog and an overlong catalog can pass JSON schema but fail SAP's candidate
check. Generated/read-only items have a distinct lifecycle; the root configuration readonly flag
must be respected. Nested readonly properties do not make the whole descriptor readonly.

## Implementation plan

1. Add an internal JSON artifact MIME option to the existing syntax-check client. Keep ABAP's
   default unchanged. Preserve SAP message code and T100 identity. Require a recognized processed
   report for JSON candidate checks; malformed, missing, or unprocessed reports are not clean.
2. Add a UIAD-only preflight under the existing SAPWrite create/update actions and authorization
   gates. Parse the complete source, fetch the target's full object schema (`$schema` for create,
   object `/schema` for update), validate with a request-local validator, and run the exact submitted
   bytes through SAP's JSON candidate check before metadata POST or lock. Do not use `$new/schema`
   or the collection's name-validation endpoint for full source validation.
3. Preserve explicit unsupported validation as unavailable; it must never be described as passed.
   SAP remains the final save authority. Authorization and transport failures propagate before
   mutation. Bound parsing and diagnostic output; no remote schema references or shared user cache.
4. For updates, reject only an explicit root readonly flag. For new UIADs, copy an explicitly
   supplied source header language version into creation metadata. Never rewrite an existing
   object's language version, choose a catalog, or invoke server-driven side effects automatically.
5. Preserve the original save error if unlock also fails. Track metadata/source confirmation and
   invalidate caches after possible writes, including ambiguous failures. Return bounded diagnostics
   with honest partial-state and recovery guidance; minimal-errors mode hides SAP diagnostic text.
   UIAD saves are immediately active on the verified target, so omit the generic activation advice.
6. Update documentation and add a focused reproducible live probe with owned fixtures and cleanup.

## Plan review / acceptance tests

- Red regressions first: JSON artifact MIME, semantic message identity, invalid/unprocessed response,
  original PUT error when unlock also fails, explicit UIAD creation language version.
- Schema-invalid and schema-valid/SAP-invalid candidates must make zero mutation calls.
- Positive create/update; create without source remains compatible; JSON is transmitted unchanged.
- Warnings do not block; unavailable checks remain visible. Readonly root blocks, nested flag does not.
- Real package, write ceiling, denied action, namespaced URI, principal-propagation cache isolation,
  minimal errors, partial create, ambiguous PUT, successful PUT followed by failed unlock.
- Live 816: valid lifecycle, negative catalog checks, readonly standard descriptor unchanged,
  own fixture absent before/after. 758: capability refusal without mutation.
- Build, typecheck, lint, policy, size/schema budgets, focused tests, full unit suite; inspect final diff
  and resolve findings before creating a separate PR against main.

## Review decisions

The fix is limited to UIAD create/update plus the small shared syntax/SDO corrections they require.
There is no new tool action or arbitrary endpoint input. Generated UIADs remain controlled by app
deployment. IAM/catalog/launchpad provisioning and publication retries remain separate work.
No affected-customer trace has been supplied, so a matching reproduced symptom does not prove
the customer's exact invalid field or system configuration.

## Final review

Completed the implementation and test/review loop. Live verification additionally found AFF v1
compatibility: the target exposes a v2 schema but accepts and normalizes v1. Applying a mismatched
schema is therefore reported unavailable and SAP checks the original candidate. Message output
prioritizes errors before truncation. Corrected both public docs and model-facing type guidance.
The implementation dossier records the passing gates, 6,620 tests, and owned-fixture live lifecycle.
