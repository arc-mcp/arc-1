# STXL long-text retrieval: use cases and demand signals

Date: 2026-10-17. This note informs the stored-text reader follow-up to the
[TypeScript feasibility spike](2026-10-17-stxl-typescript-spike.md). It records observed public
SAP Community requests and official technical semantics. It does not claim measured search volume:
we have no search-volume dataset, and community search ranking/counts are not demand metrics.

## What users are trying to do

The strongest initial product case is retrieving business-document or master-data long texts by
their business key, with enough context to report or pass the text to another system. Community
examples include:

| Observed scenario | Evidence and implication |
|---|---|
| **PO/PR header and item text reporting** | A report request says standard PO/PR reports omit header and item texts ([SAP Community question](https://community.sap.com/t5/enterprise-resource-planning-q-a/po-pr-header-texts-amp-amp-item-texts-missing-in-the-standard-reports/qaq-p/14499514)). A separate S/4 post walks through PO header vs item texts and a replicated plain-text table ([PO header/item example](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/tables-to-read-po-header-and-item-texts-in-s4-hana/ba-p/13581334)). Support header and item levels independently and return document/item identifiers alongside text. |
| **Material and other master-data text extraction** | A report author asks how to list which materials have a text and export the corresponding long text; the same post discusses purchasing documents, contracts, scheduling agreements, info records, vendors, and service-entry sheets ([master-data/report example](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/report-of-master-data-s-texts-and-purchasing-document-s-text-for-header-and/ba-p/13254657)). A later CDS example specifically wants material basic text shown in a Fiori app ([material display example](https://community.sap.com/t5/technology-blog-posts-by-members/read-material-basic-data-text-long-text-without-using-function-module-read/ba-p/13480045)). This supports a bounded key-list batch and an export-friendly result. |
| **Sales-order text for downstream reporting/ETL** | A BW extraction post describes loading sales-order long texts from ECC into Informatica and MicroStrategy ([BW extraction example](https://community.sap.com/t5/technology-blog-posts-by-members/long-text-extraction-via-read-text-fm/ba-p/13252074)). A sales-order header-note CDS example and a general long-text OData request show demand for service/API exposure ([header note in CDS](https://community.sap.com/t5/application-development-and-automation-blog-posts/read-long-texts-using-read-text-in-cds-views/ba-p/13424464), [OData long-text question](https://community.sap.com/t5/technology-q-a/odata-service-for-long-texts-read-text/qaq-p/12485598)). |
| **Operational texts in PM/QM and service** | Community searches surface work-order header comparisons and read-before-save requirements ([work-order comparison](https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-compare-work-order-header-saved-long-text-and-the-current-text/qaq-p/14443467), [PM order read request](https://community.sap.com/t5/enterprise-resource-planning-q-a/read-the-order-long-text-before-save-in-iw31-creation/qaq-p/14423560)), plus a quality-notification question asking how to decode STXL ([QM text question](https://community.sap.com/t5/application-development-and-automation-discussions/long-texts-quality-notification-table-stxl/td-p/12500133)). Treat PM/QM/service as a useful follow-on family, but require discovered keys and object-specific evidence before offering presets. |
| **SO10 standard text lookup and reuse** | SO10 is SAPscript Standard Texts in SAP Help's transaction list ([SAP Help transaction list](https://help.sap.com/docs/SUPPORT_CONTENT/basis/3362959736.html?locale=en-US&state=PRODUCTION&version=1.0)). Community examples use SO10 texts as templates in PM task lists, dialogs, Fiori long-text proposals, and print output ([PM task-list include](https://community.sap.com/t5/enterprise-resource-planning-q-a/how-to-display-print-so10-standard-text-within-sap-pm-task-list-operation/qaq-p/12746895), [Fiori proposal](https://community.sap.com/t5/technology-q-a/the-long-text-on-fiori-needs-to-be-proposed-from-so10-standard-text-in-gui/qaq-p/12648627), [S/4 API question](https://community.sap.com/t5/enterprise-resource-planning-q-a/is-there-a-standard-s4-hana-api-available-for-reading-creating-deleting/qaq-p/13739971)). This is distinct from a document's copied text: users may need the reusable source template itself. |
| **Find text by phrase / diagnose missing text** | A user asks to search POs by item-text contents ([PO text search question](https://community.sap.com/t5/supply-chain-management-q-a/how-to-search-for-purchase-orders-by-text-field/qaq-p/14483181)). Other posts report text visible in a transaction but absent from STXH/STXL or a READ_TEXT miss ([PO text missing from tables](https://community.sap.com/t5/enterprise-resource-planning-q-a/info-record-po-texts-are-present-in-me23n-but-not-in-stxh-stxl/qaq-p/12605497), [READ_TEXT PO miss](https://community.sap.com/t5/enterprise-resource-planning-q-a/read-text-not-reading-text-in-purchase-order/qaq-p/14487268)). This argues for explicit `not_found`/unsupported/selection-error statuses and an optional bounded content-search workflow, never a claim that raw STXL alone is the complete application view. |

These are observed examples, not a statistical ranking of market demand. The prioritization below
is a product inference from the breadth and recurrence of these examples, not a measured frequency.

## Recommended priorities

1. **First: exact-key read and bounded batch read** for document/master-data texts, with PO header
   and item as the first guided examples. The asks are concrete, and the same API supports reporting,
   integrations, and agent context retrieval.
2. **Next: discover/list text headers by business-object key or text category**, then let the caller
   select IDs/languages. This addresses the observed “which records have text?” and “why is it
   missing?” work without asking an LLM to guess a key.
3. **Then: SO10 lookup** as a separately named standard-text operation or preset. Preserve the
   language and the source key because templates, includes, and copies have different semantics.
4. **Later: PM/QM/service presets and content search/export conveniences**, after per-object key
   patterns are verified against the target system's TTXOB/TTXID/customizing and READ_TEXT behavior.

## Key discovery: do not guess a universal mapping

SAP Help defines a text by the complete tuple `CLIENT, OBJECT, NAME, ID, LANGUAGE`; `NAME` may be up
to 70 characters and its internal construction depends on `OBJECT`. It explicitly says there is no
uniform rule for `NAME` and recommends inspecting the required text type's header in its editor to
determine OBJECT, ID, and NAME structure. Valid objects are described by
TTXOB/TTXOT; IDs and their descriptions are in TTXID/TTXIT. The language key must exist in T002.
SAP's `SELECT_TEXT` API can select text headers (`THEAD`) using generic OBJECT/NAME/ID/LANGUAGE
criteria; it searches text file and memory by default, can be restricted to database or memory, and
supports archives when given an archive handle. `READ_TEXT` reads one fully specified tuple and can
resolve text memory, reference chains, and archives. These APIs are useful discovery/read models,
but direct stored-row decoding is not equivalent to full `READ_TEXT` behavior ([SELECT_TEXT](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e204331027b1a23e10000000a42189e.html?locale=en-US&state=PRODUCTION&version=202510.002), [READ_TEXT](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1e8fc1b37e1a25e10000000a42189e.html?locale=en-US&state=PRODUCTION&version=202510.002), [SAPscript control tables](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1f13513c181a24e10000000a42189e.html?locale=en-US&state=PRODUCTION&version=202510.002)).

This gives agents a practical, metadata-first way to identify candidates: ask the system for
available text headers by a narrow verified name/key pattern, join returned IDs to TTXIT and
objects to TTXOT for descriptions in the requested language, then present exact tuples for
selection. On a classic ABAP implementation, use `SELECT_TEXT` for enumeration and `READ_TEXT` for
semantic reads. For an ARC-1 direct stored reader, use equivalent bounded STXH metadata discovery
and label it as stored rows; do not claim it searched memory or archives. Business-key-to-name
construction and text determination still need object-specific metadata/customizing or an observed
candidate; neither SELECT_TEXT nor the control tables makes that mapping universal.
([SAP Help: Long Texts](https://help.sap.com/docs/ABAP_PLATFORM_NEW/f6a2c35cb0dd4900ad16d735f1415331/4dafaf283c31288de10000000a42189e.html?locale=en-US&state=PRODUCTION&version=202510.002))

Useful **examples only**, drawn from SAP Community: PO header is shown with object `EKKO`, PO item
with `EKPO`; the post lists `VBBK`/`VBBP` for sales-order header/item; `EBANH`/`EBAN` for PR
header/item; and `EINA`/`EINE` for info-record texts ([example mapping list](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/report-of-master-data-s-texts-and-purchasing-document-s-text-for-header-and/ba-p/13254657)).
Another PO post reports header name as the PO number and item text name as PO number plus item
number, with IDs such as `F01`/`F02`; it explicitly notes that text types are configured
([PO example](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/tables-to-read-po-header-and-item-texts-in-s4-hana/ba-p/13581334)). These values can vary by
release, application configuration, document category, text determination, and customer changes.
Material text IDs such as `BEST` are likewise examples, not defaults to bake into tool behavior.

Recommended discovery sequence:

- If the user supplies the full tuple, read that tuple exactly and report its normalized key.
- If the user supplies a business object (for example PO `<PO_NUMBER>`), first find candidate text headers
  scoped to that exact object key and requested level; return available `ID`, `LANGUAGE`, and
  name variants. Do not automatically read every text ID.
- If the user names a text category (“PO item text”, “material purchasing text”), inspect the
  target's TTXOB/TTXID and relevant text-determination configuration, then show candidate mappings
  and ask the model/caller to select or apply a clearly labeled system-local match.
- Build composite `TDNAME` only from verified object-specific rules and correctly padded component
  keys. Keep the original SAP key alongside any display-formatted business key.
- Offer language selection explicitly. An omitted language may use a documented caller default,
  but do not silently imply fallback or translation. Report each attempted language.

## Text shape and batch/export needs

Official SAP Help describes STXH/STXL as the logical SAPscript text-file header/line store: STXL
holds compressed ITF payload and is accessed through SAPscript text handling. That legacy
description of cluster-style storage is separate from a system's physical DDIC/database table
category. In ARC-1's live DDIC checks for SAP_BASIS 758 and 816, STXL is classified as transparent
with a `compressedbinarypayload` field; the payload still contains the SAPscript logical
cluster/container serialized by the SAP kernel. “Transparent” describes the physical table
category in these checked systems; “cluster” here describes the logical payload/text-file format
and access semantics. Neither label should be generalized to every release without checking that
system's DDIC. SAP Help advises using SAPscript function modules for consistency ([Storing Text
Components](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1c2a130b4d1a26e10000000a42189e.html?locale=en-US&state=PRODUCTION&version=202510.002)).

TLINE represents each line with a format field and content field; the content can be text or a
SAPscript control/command line. The spike's returned text preserves observed characters and line
content after removing trailing ASCII padding from fixed-width fields. It is content-faithful for
the tested profile, but does not preserve raw fixed-width bytes or prove SAPscript rendering
semantics. Returning ITF commands does not mean ARC-1 can resolve INCLUDEs, execute commands, or
reproduce form output ([TLINE structure](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1c2ae30b4d1a26e10000000a42189e.html?locale=en-US&state=PRODUCTION&version=202510.002)). Thus output should distinguish:

- **ITF line content**: `{format, text}` per TLINE, with trailing ASCII padding removed from the
  fixed-width text field. This retains tested line content and command markers, not raw bytes or a
  ready-to-render document.
- **Plain text convenience**: derived text with an explicitly stated policy for format commands,
  INCLUDE commands, blank lines, and trailing padding. Never silently discard command lines or
  imply that plain text reproduces rendered SAPscript output. No SAPscript composer/renderer is part
  of the current spike.
- **Header/provenance**: client (redacted or omitted as policy requires), object, exact name, ID,
  language, text format/profile, line count, and per-item status.

For batch extraction, community examples explicitly want reporting/Excel export, BI/ETL loads, and
API delivery. An LLM-friendly API should therefore accept a bounded list of business keys or exact
text tuples, optional object/ID/language filters, and a max-items/byte budget; return one structured
record per input with `found`, `not_found`, `unsupported_format`, `key_ambiguous`, or `error` status;
and support JSONL/CSV-friendly compact fields. Preserve input order and include a stable key for
each result. For phrase search, scan only an explicitly bounded candidate set, return matching
lines plus keys and small context windows, and make truncation/coverage visible. Do not promise a
system-wide full-text index from a single read call.

## ARC-1 workflow recommendation

The integrated [SAPQuery long_text](../../docs_page/tools.md#stored-sapscript-long-texts) implements
discovery, ordered reads, and bounded phrase search. The broader business-oriented prompt
examples use placeholders deliberately; they do not assume a customer PO text ID or universal
TDNAME layout:

1. **Discover**: “For PO `<PO_NUMBER>`, list available header text categories in `<LANGUAGE>`;
   show object, exact name, ID, and language, but do not read contents yet.” Use documented
   `SELECT_TEXT` semantics or bounded STXH metadata discovery for candidate headers, then join IDs
   to TTXIT and objects to TTXOT for descriptions. If header/item mapping or business-key-to-name
   construction is unknown, return candidates or ask the user to select; do not invent an ID or
   append a guessed item number.
2. **Read**: “Read the selected text for PO `<PO_NUMBER>` item `<ITEM_NUMBER>` in `<LANGUAGE>`.”
   Pass the exact discovered tuple to
   `SAPQuery(action="long_text", longText={mode:"read",keys:[{object,name,id,language}]})`. Require the exact tuple;
   return an explicit unsupported profile/format status. Label it as stored text, not
   READ_TEXT-equivalent.
3. **Batch**: “For these `<N>` PO keys, discover item text candidates in `<LANGUAGE>`, then read
   only ID `<ID_SELECTED_FROM_DISCOVERY>`; cap at `<MAX_ITEMS>` texts and `<MAX_BYTES>` total, and
   return one status per input key.” Preserve input order and return one exact key/provenance record
   per request. Enforce one cumulative time/byte budget across discovery, fetch, decode, and
   serialization; never return raw binary.
4. **Bounded phrase search**: “Within these `<N>` previously identified text tuples, search for
   `<PHRASE>`; return at most `<MAX_MATCHES>` matching lines with one-line context and stop at
   `<MAX_BYTES>` decoded text.” Search only that candidate set, show coverage/truncation, and do
   not suggest this is a system-wide index.

For a classic ABAP caller, `SELECT_TEXT` returns matching `THEAD` headers and `READ_TEXT` reads a
selected tuple with SAP's broader semantics. ARC-1's native stored reader can mirror the staged
workflow over its guarded data path. The final MCP contract uses `SAPQuery action=long_text` with `discover`,
`read`, or `search` modes; the earlier `TEXT_HEADERS`/`STORED_TEXT` names were proposals only.
Target-specific business-key presets, customizing descriptions, and search context windows remain
proposals; the current search returns matching ITF lines and exact keys.

The discovery step and stored read should remain data-authorized, audited, and tied to the current
SAP identity. Scope results to caller-provided document keys/filters, enforce result and cumulative
response budgets, and preserve missing vs unsupported vs failed distinctions. The spike documents
the remaining compatibility limits: stored-row snapshot consistency, older endpoint capability,
legacy references/text memory/archives, non-SAPscript formats, and unqualified
BTP/ABAP Cloud behavior. Continue to describe SO10 support as stored source text only; resolving
INCLUDEs or rendering form output requires SAPscript semantics beyond the decoder.
Stored STXH references and the 816 repeated-space literal issue are now qualified on 758/816;
see the [semantic evidence](2026-10-17-stxl-read-text-semantics.md).

## Source and method notes

SAP Community results were searched through SAP Docs MCP on 2026-10-17 for READ_TEXT/STXL and
specific business contexts (PO, sales, material, SO10, PM, QM). The tool exposes returned posts,
not query-volume statistics. SAP Help Portal pages support the storage/API/format claims; Community
posts are used only as evidence that a particular problem or workflow has been asked about. The
observed SAP Community items include unanswered or zero-kudos questions, so they establish an
example of user need, not prevalence or resolution quality.
