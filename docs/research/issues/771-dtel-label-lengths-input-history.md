# Issue #771 — DTEL label lengths and input-history flag

**Status:** Fixed on `codex/issue-771-dtel-metadata` and verified offline and live on 2026-09-10.

**Issue:** [#771](https://github.com/arc-mcp/arc-1/issues/771), opened by `xXFracXx` on 2026-09-09, labeled enhancement. The reporter did not specify an ARC-1 version, SAP release, object, or request body. No comments or linked fix PRs were present when checked.

**Pull request:** [#774](https://github.com/arc-mcp/arc-1/pull/774)

**Reviewed base revision:** `c55adcb8ca9481421d8f7598e7233e22280d59a3` (package version 1.2.0). Local HEAD matched GitHub `main` when the defect was reproduced. The implementation and its verification evidence are recorded below.

## Findings

At the reviewed base revision, the requested five inputs were absent throughout ARC-1's write pipeline. For nonempty labels the XML builder wrote their text lengths, capped at 10/20/40/55; for empty labels it wrote those maximum lengths. It always emitted `deactivateInputHistory=false`. SAP itself supports independent lengths and both flag values on all three tested releases.

There is a more consequential update defect: the reader discards these fields, and metadata updates reconstruct the entire XML object. A description-only update therefore changes previously stored lengths **10/20/40/55 → 6/12/21/6** and changes **`true → false`**. This was reproduced through the unchanged handler on 758 and 816, and through a fresh-session recovery call on 750.

Two corrections to the report:

- `deactivateInputHistory=false` means the data element **does not suppress** SAP GUI input history. `true` disables it. Actual history availability also depends on frontend settings. Eclipse's “Input History” checkbox is bound through a boolean inversion to the negative XML flag.
- Before the fix, single create/update requests rejected these unknown keys. Nested `batch_create.objects[]` accepted the request and **silently stripped** them. Neither path could express the requested values.

## Implemented resolution

The fix carries `shortLength`, `mediumLength`, `longLength`, `headingLength`, and
`deactivateInputHistory` through the public JSON and Zod schemas, metadata whitelist, DTEL builder,
read model, and parser. It applies explicit lengths with the existing post-create PUT and preserves
the five stored values during unrelated updates. Explicit `0` and `false` use presence/nullish checks.

The four lengths accept integers in ARC-1's canonical ranges 0–10, 0–20, 0–40, and 0–55. Omitted
create values retain the earlier derived defaults. On update, an omitted value is preserved unless
its matching label changes; a new label without a length derives a new reservation from that label.
`deactivateInputHistory=true` retains its negative ADT meaning: disable SAP GUI input history.

Live fix verification used two disposable data elements per release and covered explicit
10/20/40/55 values with history disabled, inactive and active read-back, description-only update,
reactivation, a valid blank-label zero value, rejection of short length 11, and cleanup. The final
evidence is in [750](771-evidence/750/fix-results.json),
[758](771-evidence/758/fix-results.json), and [816](771-evidence/816/fix-results.json); the reusable
runner is [verify-fix.mts](771-evidence/verify-fix.mts).

On 758 and 816 every operation ran through the public `SAPWrite`, `SAPRead`, and `SAPActivate`
handlers. On 750, the public write path exercised the production v2→v1 POST/PUT fallback, while
explicit-version ADT reads, the production parser, activation helper, and the production
merge/builder/update path were used around the separately documented default-read anomaly. The 750
evidence therefore verifies the changed code and legacy MIME fallback, but it is not an
uninterrupted public `SAPRead` flow.

## Live validation

Tests used disposable `Z771_*` data elements in `$TMP`, client 001, language EN, with predefined type CHAR(60). Labels were `ABCDEF`, `ABCDEFGHIJKL`, `ABCDEFGHIJKLMNOPQRSTU`, and `ABCDEF` (6/12/21/6 characters). No application objects or transports were changed.

| Verified system | SAP_BASIS / SP | ARC-1 label create | Direct ADT PUT + activation | Description-only ARC-1 update |
|---|---|---|---|---|
| NPL / NW 7.50 | 750 / 0002 | 6/12/21/6, false | 10/20/40/55, true retained; also 8/18/30/50 | 6/12/21/6, false in saved XML; fresh session required in this test |
| A4H / S/4HANA 2023 | 758 / 0002 | 6/12/21/6, false | 10/20/40/55, true retained; also 8/18/30/50 | 6/12/21/6, false retained through activation |
| A4H / ABAP Platform 2025 | 816 / 0001 | 6/12/21/6, false | 10/20/40/55, true retained; also 8/18/30/50 | 6/12/21/6, false retained through activation |

Evidence is response content, including explicit `version=active` reads after activation, rather than HTTP success alone:

- [758 results](771-evidence/758/results.json), [816 results](771-evidence/816/results.json), [750 results](771-evidence/750/results.json).
- [758 active before ARC-1 update](771-evidence/758/direct-put-active.xml) and [active after description-only update](771-evidence/758/arc-description-only-active.xml).
- [816 active before](771-evidence/816/direct-put-active.xml) and [active after](771-evidence/816/arc-description-only-active.xml).
- [750 fresh-session update](771-evidence/750/recovery-results.json) and [resulting XML](771-evidence/750/recovery-description-update.xml).
- [Cleanup verification](771-evidence/cleanup-verification.json): all 12 generated test objects absent in both active and inactive versions, using fresh read-only sessions.

### POST and PUT have different contracts

A second probe deliberately submitted **8/18/30/50**, not the defaults, to distinguish accepted fields from ignored fields. All three releases behaved identically:

| Step | Requested lengths | Stored lengths | Labels | History flag |
|---|---|---|---|---|
| POST collection | 8/18/30/50 | **10/20/40/55** | Empty | **true retained** |
| Lock + PUT object | 8/18/30/50 | **8/18/30/50** | Supplied text retained | true |
| Activate + GET active | — | **8/18/30/50** | Supplied text retained | true |

See [750 contract results](771-evidence/750/contract-results.json), [758 contract results](771-evidence/758/contract-results.json), and [816 contract results](771-evidence/816/contract-results.json). Key before/after XML captures are linked above. Direct PUT of `false` was also read back successfully on 758 and 816.

This refines the existing comment in `dtelNeedsPostCreateUpdate`: POST ignores labels and custom lengths, but it does **not** ignore every additional property. The history flag was already honored by POST. A fix must trigger the follow-up PUT for a **length-only** create, including in a batch; adding the fields only to the initial POST cannot work.

### Length boundaries: save success is insufficient

Additional tests on 758 used a six-character short label:

| Explicit short length | PUT/save | Activation | Active value |
|---|---|---|---|
| 0 | Accepted | Error: label length 6 exceeds 0 | Previous active version retained |
| 5 | Accepted | Error: label length 6 exceeds 5 | Previous active version retained |
| 6 | Accepted | Success | 6 |
| 10 | Accepted | Success | 10 |
| 11 | Accepted | Success **with warning** about maximum 10 | 11 |
| -1 / 6.5 | HTTP 400 | Not attempted | Deserialization failed in `SBD_DATAELEMENT` |
| 0, with empty short label | Accepted | Success | 0 |

See the [activation outcomes](771-evidence/758/contract-results.json). The other three label limits were not exhaustively boundary-tested. Do not describe 10/20/40/55 as universally enforced backend hard limits: 758 stores 11 for the short label with a warning. Zero is valid for an empty label.

### NW 7.50 qualification

The long product-path probe encountered a separate session-sensitive read problem: default `GET /ddic/dataelements/{name}` returned 404 even after successful activation while explicit active/inactive reads worked. A fresh client read the same object successfully, and its description-only update reproduced the metadata reset. Moving the preexistence check to another client did not eliminate the behavior. Its exact mechanism is **not established**; this is not proof that default GET always selects a missing active version.

The first two attempts and recovery are preserved in `750/initial-results.json`, `750/second-results.json`, and `750/recovery-results.json`. The final product probe still stops at this read. Independent contract tests completed successfully on 750, including custom-length PUT, activation, and explicit active read-back. Cleanup of earlier attempts was completed and independently verified. Do not claim a fully successful uninterrupted 750 `SAPRead`/update/batch sequence from this run.

The 750 v2→v1 Content-Type fallback was exercised. Preserve it. No SAP correction, server restart, or lock enhancement was introduced during this investigation.

## Root cause at the reviewed base revision

| Layer | Evidence at reviewed revision | Consequence |
|---|---|---|
| Advertised input | `src/handlers/tools.ts:766`, `:922` | Both top-level DTEL properties and nested batch properties omit all five inputs. Top-level additional properties are forbidden. |
| Runtime input | `src/handlers/schemas.ts:517`, `:562`, `:643`, `:740` | Both on-prem and BTP schemas omit them; top-level `.strict()` rejects them, nested Zod objects strip them. |
| Metadata extraction | `src/handlers/write-helpers.ts:187` | `getMetadataWriteProperties` has no mapping for them. |
| Typed builder inputs | `src/adt/ddic-xml.ts:35` | `DataElementCreateParams` cannot carry them. |
| Conversion to builder parameters | `src/handlers/write-helpers.ts:625` | `buildCreateXml` does not forward them even if manually supplied internally. |
| XML generation | `src/adt/ddic-xml.ts:216`, `:465` | `formatLabelLength` uses `Math.min(label.length, max)` for nonempty text; four callers use it unconditionally. Line 506 hard-codes the history flag to false. |
| Create follow-up | `src/handlers/write-helpers.ts:133`; `src/handlers/write/create.ts:724`, `:1182` | Existing follow-up PUT detection ignores all five. Explicit lengths need this step because POST discards them. |
| Read model/parser | `src/adt/types.ts:919`; `src/adt/xml-parser.ts:687` | `DataElementInfo` and `parseDataElementMetadata` omit the values already present in SAP XML. |
| Update merge | `src/handlers/write-helpers.ts:277`; `src/handlers/write/update-delete.ts:163` | Full-XML replacement merges recognized metadata only, then rebuilds the missing fields from defaults. |

The primary behavior dates to [`252d0489`, PR #86](https://github.com/arc-mcp/arc-1/pull/86), the original DOMA/DTEL write support. Both `git log -S 'formatLabelLength'` and the hard-coded history-element search point to that commit. It is not already fixed on current main.

Putting custom XML into `SAPWrite.source` is not a supported workaround: the metadata update branch builds its own XML from parsed properties. Similarly, changing only the JSON schema or only the builder would leave other layers dropping the values.

## Independent source checks

1. Read the Eclipse research guide and `api/13-ddic-metadata-domains-dataelements-messages.md` under the read-only `~/DEV/arc-1-eclipse-adt` reference. Resolved **active** bundles from the specified Eclipse installation's `bundles.info`:
   - `com.sap.adt.ddic.dataelement_3.60.0.jar`, `model/dataelements.xsd`: four `*FieldLength` fields are `xsd:int`; `deactivateInputHistory` is `xsd:boolean`. Separate `*FieldMaxLength` fields describe the maxima. Fields occur in an ordered sequence.
   - `IDtelPlugin`: dataelements v1/v2 MIME constants.
   - `com.sap.adt.ddic.dataelement.ui_3.60.0.jar`, `DdicDtelAdditionalPropertiesSection.createBindingInputHistory`: binds the positive UI checkbox to `DATA_ELEMENT__DEACTIVATE_INPUT_HISTORY` using `NotConverter` in both directions. This independently establishes the boolean polarity without running SAP GUI.
2. Checked SAP's language-server bundle at `~/DEV/arc-1-lsp/vendor/adt-ls/linux/gtk/x86_64/plugins/com.sap.adt.ddic.dataelement_3.58.0.jar`: its XSD exposes the same fields and types. This is separate reference-client evidence, not a fabricated test fixture. No proprietary implementation code was copied into ARC-1.
3. Read fr0ster's `src/handlers/data_element/low/handleUpdateDataElement.ts` in the read-only reference checkout. It forwards a properties object to `@mcp-abap-adt/adt-clients`; that dependency is not installed there, so its exact wire implementation was not verified. Do not claim that sibling client fixes this issue based on the wrapper alone. The older `~/DEV/mcp-abap-adt` checkout did not yield these XML fields.
4. SAP's [Field Labels documentation](https://help.sap.com/saphelp_autoid2007/helpdata/EN/90/8d731cb1af11d194f600a0c929b3c3/content.htm?no_cache=true) explains that reserved label lengths allow translations longer than the original text. Its [Creating Data Elements documentation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/ec1c9c8191b74de98feb94001a95dd76/908d7307b1af11d194f600a0c929b3c3.html) describes the flag disabling input history when set. Search-index extracts were available; direct Help rendering was inconsistent. The boolean conclusion is additionally grounded in Eclipse binding and live XML.
5. SAP Notes search `deactivateInputHistory` returned zero results; a broader ADT/data-element/label-length search produced unrelated candidates. No applicable SAP-side correction was established or used.
6. Searched local issue dossiers, live notes, the comparison trackers, and open/closed GitHub issues/PRs using `DTEL` and `"input history"`. No duplicate found. #343 concerns master language, #360 argument normalization, and #293 NW 7.50 locks; they inform regression coverage but do not fix these fields.

### Wire contract relevant to a fix

| Operation | URI / Content-Type |
|---|---|
| Create | `POST /sap/bc/adt/ddic/dataelements?_package=%24TMP` |
| Read | `GET /sap/bc/adt/ddic/dataelements/{name}`; explicit `?version=active` / `inactive` for validation |
| Save | Lock object, then `PUT /sap/bc/adt/ddic/dataelements/{name}?lockHandle=...`, then unlock |
| Metadata type | `application/vnd.sap.adt.dataelements.v2+xml`; current fallback uses v1 on 750's HTTP 415 |
| Envelope | `blue:wbobj`, namespace `http://www.sap.com/wbobj/dictionary/dtel` |
| Content | `dtel:dataElement`, namespace `http://www.sap.com/adt/dictionary/dataelements` |

The raw probes used existing ARC-1 CRUD helpers with their existing Accept/session/CSRF behavior. They changed only test XML field values, not HTTP implementation or safety gates.

## Implemented fix design

The implementation adds the optional inputs through **every** schema/mapping/builder layer and adds corresponding read-back fields:

| Public property | XML element |
|---|---|
| `shortLength` | `dtel:shortFieldLength` |
| `mediumLength` | `dtel:mediumFieldLength` |
| `longLength` | `dtel:longFieldLength` |
| `headingLength` | `dtel:headingFieldLength` |
| `deactivateInputHistory` | `dtel:deactivateInputHistory` |

Use integer length validation and `looseOptionalBoolean` for the history flag. Preserve explicit `0` and `false` with nullish/presence checks, not truthiness or `z.coerce.boolean()`. Do not change the separate `*FieldMaxLength` XML constants to the supplied reservations. Keep XML ordering, escaping, master-language handling, package gates, and the v1 fallback intact.

Implemented semantics:

- **Create, input omitted:** retain the current defaults: nonempty label text length, empty-label maxima, history suppression false.
- **Create, explicit length supplied:** emit it and trigger follow-up PUT even when no label or other existing follow-up field was supplied. Both single and batch creation must share this logic. A history-only create already persists via POST on these releases; routing it through the same PUT is an implementation choice, not an SAP requirement demonstrated here.
- **Update, input omitted:** preserve the stored flag and reservations where labels are unchanged. When a label changes without an explicit reservation, derive the reservation from the new label, capped at its canonical maximum.
- **Update, input supplied:** override the stored value, including explicit false and zero. Validate any supplied reservation against the effective label after merging. Validation cannot establish that all existing translations fit; retain SAP's activation diagnostics.

The issue's request to “keep today's behaviour when absent” distinguishes creation defaults from update preservation. Existing values are preserved for unchanged labels so partial updates no longer lose metadata.

The input bounds are 0..10/20/40/55, with zero allowed for blank labels. This is an ARC-1 contract choice: SAP 758 accepted a larger value with a warning. The implementation rejects out-of-range input and does not silently clamp it.

### Files and regression coverage

| Area | Files / checks |
|---|---|
| Input and mapping | `src/handlers/schemas.ts` (four shapes), `src/handlers/tools.ts` (top-level + batch), `src/handlers/write-helpers.ts` |
| XML and read-back | `src/adt/ddic-xml.ts`, `src/adt/types.ts`, `src/adt/xml-parser.ts` |
| Orchestration review | `src/handlers/write/create.ts`, `src/handlers/write/update-delete.ts`, `src/adt/client.ts`, `src/handlers/read.ts`, `src/adt/crud.ts`; edits only where needed, not automatically to every file |
| Unit cases | `tests/unit/adt/{ddic-xml,xml-parser,client,crud}.test.ts`; `tests/unit/handlers/{write-ddic,write-create-batch,schemas,write-schema-pollution}.test.ts` |
| Schema synchronization | `tests/unit/handlers/{schema-key-sync,zod-jsonschema-parity,tool-definitions-snapshot}.test.ts`, affected `tests/fixtures/tool-definitions/*.json`, schema-budget check |
| Documentation | `docs_page/tools.md` for DTEL parameters/defaults/update semantics; appropriate release notes when shipped |

Required regression cases: all four explicit lengths; each length by itself; history true and false; batch parity; numeric-string handling consistent with other inputs; null/empty normalization; negative/fractional/out-of-policy values; zero with blank/nonblank labels; escape handling; unchanged default create XML; preservation on description-only updates; flag reversal true→false; length-only create triggers PUT; domain and predefined-type paths; active read-back after activation; existing 750 MIME fallback.

The existing tests passed because they cover structure, ordering, defaults, and routing rather than round-trip preservation of these fields. For example, `write-ddic.test.ts:905` checks PUT URL and Content-Type using a generic XML mock, and `xml-parser.test.ts:848` never asserts the missing fields although the fixture contains them. Schema parity tests prove the two schemas agree; they do not prove the schemas expose all SAP capabilities.

## Tests run and reproduction

**Existing baseline:** 8 test files, **808 tests passed**, no skips reported in the focused run:

```sh
npx vitest run tests/unit/adt/ddic-xml.test.ts tests/unit/adt/xml-parser.test.ts \
  tests/unit/handlers/write-ddic.test.ts tests/unit/handlers/write-create-batch.test.ts \
  tests/unit/handlers/schemas.test.ts tests/unit/handlers/schema-key-sync.test.ts \
  tests/unit/handlers/zod-jsonschema-parity.test.ts tests/unit/handlers/write-schema-pollution.test.ts \
  --reporter=default
```

**Issue-specific characterization:** [offline.mts](771-evidence/offline.mts), **13 characterization groups passed** against the reviewed base revision across on-prem and BTP schemas, mapping, builder, parser, and merge. [Results](771-evidence/offline-results.json). These intentionally describe the former bug and are expected to fail against the fixed branch.

```sh
# Run from reviewed base c55adcb8, not from the fixed branch:
node --import tsx docs/research/issues/771-evidence/offline.mts

# This local file supplies credentials in memory; it is not copied into the dossier.
ARC1_RESEARCH_ENV=/path/to/.env.infrastructure \
  node --import tsx docs/research/issues/771-evidence/live.mts 758
ARC1_RESEARCH_ENV=/path/to/.env.infrastructure \
  node --import tsx docs/research/issues/771-evidence/contract.mts 758
# Also executed with 816 and 750; see the explicit 750 qualification above.
```

The characterization scripts invoke `handleToolCall` and existing ADT helpers directly against the
reviewed base source. The fix runner invokes the changed handlers and production ADT helpers. Neither
uses a deployed MCP server or GUI. Raw evidence excludes secrets and authentication headers;
diagnostic lock handles are redacted.

**Fix validation:** the focused adjacent suite passed **1,159 tests** across 12 files. The complete
repository suite passed **5,868 tests in 196 files**. `npm run typecheck`, `npm run lint`,
`npm run build`, `npm run docs:build`, `npm run check:sizes`, and `git diff --check` also passed.
The final schema budgets remain within their enforced ceilings: standard full Git is approximately
17,780/17,800 tokens and BTP full Git is approximately 16,893/16,900 tokens.

## Scope and residual qualification

The implementation fixes #771 across schemas, serialization, read-back, partial-update merge
semantics, single create, and batch create.

Not included: SAP GUI runtime testing, live BTP validation, every SAP release/SP, exhaustive
Unicode/translation tests, or a resolution of the separate 750 session-sensitive default-read
issue. Other omitted DTEL fields (`searchHelpParameter`, `setGetParameter`, `changeDocument`, bidi
flags) deserve a separate preservation audit; this change does not claim to fix them.

## Proposed GitHub resolution note

```markdown
Confirmed and fixed against current main. We reproduced the missing DTEL settings on SAP_BASIS 750 SP02, 758 SP02, and 816 SP01. ADT accepts independent label lengths and `deactivateInputHistory`; ARC-1 now carries them through its schemas, metadata mapping, XML builder, and read parser.

We also found that a description-only ARC-1 update can reset existing reservations from 10/20/40/55 to 6/12/21/6 and change `deactivateInputHistory` from true to false. The reader currently drops those values, so a full XML update cannot preserve them.

One clarification: `deactivateInputHistory=true` disables history; false means that the data element does not suppress it. Eclipse inverts this flag for its positive “Input History” checkbox.

The optional fields are supported for single and batch creation, update, and read-back. Length-only creation triggers a follow-up PUT: on all three tested releases POST ignored custom lengths, while PUT plus activation retained them.

Existing defaults remain for creation, and stored values survive unrelated updates. Changing a label without supplying its reservation derives a new length from that label.

The focused fix suite passed 1,159 tests and the full suite passed 5,868 tests. Live fix verification passed on 758 and 816 through the public handlers. On 750, the public write path and v2→v1 fallback passed; explicit-version reads and production parser/update helpers verified preservation around a separate session-sensitive default-read issue.
```
