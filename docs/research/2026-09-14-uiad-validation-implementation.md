# UIAD validation: implementation evidence and review

Date: 2026-09-14. Base: main `6dd53c14`. Plan:
[UIAD validation](../plans/2026-09-14-uiad-validation.md).

## Evaluation

The customer reports that `SAPWrite type=UIAD` returns only a generic save failure. The repository
confirms the diagnostic gap: the generic SDO writer validates JSON syntax, then creates metadata
and writes the source. It does not request UIAD structural or semantic diagnostics. SAP can reject
the save with SWB_TOOL036 without embedding the actual field errors in that response.

We reproduced that exact generic save failure using an owned, manually created descriptor with
incomplete source. We then proved the editable lifecycle with a complete candidate. This establishes
a useful general fix; it does not establish which field failed on the customer's system. No affected
customer request/response trace was supplied.

The fix remains within the existing UIAD create/update actions. Other feedback items—UI5 generation,
IAM application/catalog provisioning, launchpad layout, and publication recovery—are separate work.

## Primary sources and protocol research

SAP documents two descriptor lifecycles: deployment-generated items follow the UI application's
manifest and deployment, while manually created items can be maintained independently. A manual
item does not provide the whole UI application or its access provisioning.
[SAP Help](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/1d9deef79d7d4936850b2d6343206ec8.html).

SAP publishes versioned UIAD AFF source schemas. The v2 schema requires the header, general
information, navigation, and tiles; it permits a catalog ID up to 40 characters. That structural
constraint is insufficient: the tested SAP checker enforces a 35-character limit and rejects an
empty ID. The test fixture is the public schema, with its MIT license, pinned to
[`7bb8a111760f6d5e597e6d08c31110a7aafc6035`](https://github.com/SAP/abap-file-formats/blob/7bb8a111760f6d5e597e6d08c31110a7aafc6035/file-formats/uiad/uiad-v2.json).
Runtime validation fetches the target schema; it does not use that fixture as a fallback.

The earlier note investigation found UIAD AFF support in the SAP_UI 758 SP07 delivery described
by [SAP Note 3763974](https://me.sap.com/notes/3763974). This is evidence for capability-based
availability, not a claim that the 758 SP02 test target supports the protocol.

Live ADT metadata on SAP_BASIS 816 identifies the following contracts:

| Purpose | Contract | Observation |
|---|---|---|
| Full source schema for create | `GET /sap/bc/adt/fiori/uiad/$schema` | AFF v2 object schema |
| Full source schema for update | `GET …/{encoded-name}/schema` | Same full object schema |
| Readonly/editor configuration | `GET …/{encoded-name}/configuration` | Root `sap.adt.readonly` controls object editability; nested flags are field properties |
| Schema MIME | `application/vnd.sap.adt.serverdriven.schema.v1+json; framework=objectTypes.v1` | Verified with the full source schema |
| Configuration MIME | `application/vnd.sap.adt.serverdriven.configuration.v1+json; framework=objectTypes.v1` | Verified for manual and readonly items |
| Creation wizard | `$new/schema`, framework `newObjectTypes.v1` | Describes wizard inputs, not full source; unsuitable for candidate validation |
| Collection `/validation` | Name/package validation with `packagename` | Not the full-source checker |
| Candidate semantics | `POST /sap/bc/adt/checkruns?reporters=abapCheckRun` | Standard checkObjectList, inline source artifact with `application/json`, exact UTF-8 bytes encoded as base64 |
| Metadata create | Blue v2 XML with explicit `adtcore:abapLanguageVersion="cloudDevelopment"` | Created an editable manual UIAD in `$TMP` on 816 |

The text/plain control check returned unprocessed results expecting BLUE XML. The JSON artifact
check returned field errors, warnings, source positions, codes, and T100 keys, including for an
uncreated object URI. The implementation keeps the ABAP check default unchanged and adds only an
internal JSON artifact option. JSON checks require a valid, matching processed report; empty,
malformed, unrelated, or unprocessed results cannot claim successful validation.

Readonly backend inspection explained why metadata creation and source saving differ, and why
the creation wizard supplies defaults that a minimal metadata POST lacks. No SAP implementation
source, private metadata, credentials, or session/lock tokens are included in this repository.

## Implemented behavior

The existing write ceiling and create-package/update-real-package gates run before preflight.
Valid full JSON is checked against the target's matching format schema, then sent unchanged to SAP's
candidate checker before metadata creation or locking. Structural and semantic errors stop writes.
Warnings remain visible and do not become errors. A root readonly flag stops an update with lifecycle
guidance; field-level readonly annotations do not make an otherwise editable object read-only.

There is no new public tool parameter. The source header's explicit language version is honored on
UIAD creation only. The writer does not switch an existing object's language version, select a
catalog, or invoke wizard side effects. Creation without source remains supported and explicitly
reports that source validation did not run.

Unsupported validation endpoints and unprocessed reports are labeled unavailable. Other preflight
HTTP failures, including authorization and transient server errors, propagate before mutation.
SAP's save operation remains authoritative. Per-call target schemas and configuration are never
cached across users; no external schema resolver is installed. Parsing/compilation has byte and
complexity limits, and diagnostics are capped at 20 messages with errors first. These parsing caps
do not replace the HTTP transport's response-memory controls.

The result records the phase and metadata/source confirmation. A failed source write retains a
confirmed metadata shell; ambiguous network outcomes remain unknown. If PUT succeeds but unlock
fails, the result reports saved source and cleanup failure. If both fail, the original PUT error wins.
After a semantic save rejection, one additional candidate check may recover context-dependent
messages without repeating the mutation. Cache invalidation covers confirmed and possible writes,
using the existing per-user inactive-list key. Minimal-errors mode hides SAP diagnostic details;
authentication/authorization failures are redacted independently of that setting.

## Review findings and corrections

| Finding | Correction and evidence |
|---|---|
| Wrong candidate MIME and false clean results | Ten red regression cases reproduced failures; JSON MIME and strict matching-report checks now pass. Legacy ABAP check tests remain compatible. |
| Unlock masks the save failure | Preserve the original exception; distinguish a confirmed PUT from cleanup failure. Tested both failing together and separately. |
| Prior docs describe on-prem UIAD as universally read-only | Corrected after a complete manual Cloud-language lifecycle on on-prem 816. Readonly generated/Standard items remain protected. |
| Applying the current v2 schema would reject valid AFF v1 input | A live v1 candidate passed SAP, and a v1 update saved successfully and read back as v2. A mismatched schema is now unavailable; SAP validates the original input without client rewriting. |
| Diagnostic truncation could hide an error after many warnings | Errors are prioritized before the 20-message cap; total message count and truncation remain explicit. |
| Fallback error text could include a lock handle | Return the bounded SAP response message or a generic HTTP failure, without the internal request path. Minimal-errors and auth-error tests cover redaction. |
| Unknown/partial write state could leave stale caches | Invalidate after a possible metadata POST or source PUT, including failures; verify the current principal's inactive-list key. |

## Live verification

The maintained probe is `scripts/probe-uiad-validation.ts`. Supply explicit `TEST_SAP_URL`,
`TEST_SAP_USER`, `TEST_SAP_PASSWORD`, and `TEST_SAP_CLIENT`, then run:

```sh
npx tsx scripts/probe-uiad-validation.ts
```

It creates only a random owned `$TMP` fixture, verifies absence first, cleans up in `finally`, and
verifies absence afterward. It uses SAP's default Cloud technical catalog only in the fixture, not
in product code. The optional `TEST_UIAD_READONLY_NAME` is read and validated without any save.
Use the verified HTTPS proxy URL for the target, not a backend SAP port.

| Target / case | Result |
|---|---|
| 758 SP02 discovery | UIAD AFF not advertised; no mutation |
| 816 empty catalog | Schema passed; semantic error `SUI_UIAD_CHECK(101)`; no metadata/source mutation |
| 816 36-character catalog | Schema passed; semantic error `SUI_UIAD_CHECK(118)` plus catalog-type diagnostics; no mutation |
| 816 valid v2 create → source read-back | Saved; target URL matched |
| 816 v2 update → source read-back | Saved; changed URL matched |
| 816 v1 update → source read-back | Saved; URL matched; SAP returned format v2 |
| 816 readonly Standard descriptor | Root readonly recognized; source hash unchanged |
| 816 cleanup | Owned fixture deleted and confirmed absent |

The URL-type fixture produces `SUI_UIAD_CHECK_UI(009)` as a warning on this system but still saves.
The probe validates the repository lifecycle; it does not establish launchpad access or app launchability.
BTP ABAP and the 758 UIAD backport were not live-tested. Availability is discovered, not inferred
from a hardcoded 816 release threshold.

## Local verification

Final local checks completed on 2026-09-15: build, typecheck (source/scripts/tests), lint, action-policy
validation, file-size and MCP-schema budgets, strict documentation build, and all **6,620 tests in 215 files** passed. This includes
41 new regression cases. Five tool-definition snapshots were intentionally refreshed and reviewed
to correct the outdated on-prem readonly claim and describe UIAD validation/creation. No input fields
or enums changed. The focused tests cover no-mutation
failures, readonly interpretation, unavailable checks, authorization/package gates, exact source
bytes, original-error preservation, partial-state reporting, output limits, and cache isolation.

## Review round 2 (2026-09-15)

- Confirmed the suppressed unlock failure and state-independent recovery text. The shared SDO
  engine now logs the object URL and HTTP status without a lock handle or raw error; UIAD records
  the failed unlock and warns about a possible remaining lock. The original save exception still wins.
- Recovery guidance distinguishes confirmed creation, unknown creation outcome, and existing-object
  update. Tests assert the message as well as the structured state.
- Softened BTP tool guidance because its save lifecycle has not been verified live.
- A backend schema containing pattern/format constraints is now explicitly unavailable rather than
  evaluated on the shared event loop or silently weakened. SAP candidate/save checks remain in force.
  The verified UIAD schema has none of those constraints; regressions cover this fallback.
- Clarification to the external review: discovery is a read and can precede the package gate;
  package authorization does precede candidate validation and every mutation.

Round-2 verification: build, typecheck, lint, policy and size/schema budgets passed; all
**6,624 tests in 215 files** passed. The BTP description snapshot changed only as described above.
