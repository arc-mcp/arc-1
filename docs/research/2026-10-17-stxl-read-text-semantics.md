# Stored SAPscript texts: READ_TEXT semantics and qualification

Date: 2026-10-17. Related: [codec spike](2026-10-17-stxl-typescript-spike.md),
[FEAT-86](../../docs_page/roadmap.md#feat-86), and draft PR #1012.

This is a sanitized source, documentation, and live-oracle analysis. It contains no SAP standard source,
existing text contents, system identities, or existing text keys. API behavior below is either
documented by SAP, traced through authorized source reads, or identified below as live-verified.
Proposed oracle cases remain separate from executed evidence. The companion spike report remains
the authority for the earlier codec/corpus counts.

The qualified subset is now integrated as [SAPQuery long_text](../../docs_page/tools.md#stored-sapscript-long-texts).
See [integration and model evaluation](2026-10-17-stored-text-integration-evals.md) for public dispatch evidence.

## Decision and proposed contract

Expose a **classic stored ITF text reader**, not a replacement for READ_TEXT. The codec can recover
TLINE, but a complete read also needs the header, reference resolution, and an explicit persistence
boundary. Prefer a result that preserves these distinctions:

| Result element | Meaning |
|---|---|
| Requested key | Exact connected client, object, name, ID, and SAP internal language key |
| Stored header | The requested STXH row, without pretending it is the fully normalized THEAD returned by SAP |
| Resolved key and reference path | The terminal stored text and every visited alias, if references are supported |
| Lines and line count | Decoded TDFORMAT/TDLINE rows and their actual count |
| Stored line count | The original STXH-TDTXTLINES value, retained separately as metadata |
| Persistence profile | Classic STXH/STXL, RELID TX, ITF, with the independently qualified container/code-page profile |
| Missing result | No header in this store; this does not assert absence from memory, archives, or other persistence |

Return a successful empty array for a supported non-reference header with no STXL rows. A missing
header, unsupported format, unsupported legacy reference container, broken reference, cycle,
limit exhaustion, authorization error, extraction failure, and malformed cluster must remain
distinguishable. An unsupported result must never be presented as an empty text.

SAP's public contract requires a complete exact key, validates object/ID/language against
customizing, and resolves references before returning lines. It supports memory and archives in
addition to the database. This is a larger contract than raw stored reads.
[SAP READ_TEXT](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1e8fc1b37e1a25e10000000a42189e.html?version=202510.002).

## Header and content decision rules

These observations come from the inspected 758 READ_TEXT, READ_TEXT_TABLE,
READ_MULTIPLE_TEXTS, CL_RSTXT_PERSISTENCE_MANAGER, CL_RSTXT_DEFAULT_PERSISTENCE, and
CL_RSTX_TABLE_VIEW implementations, with a 750 READ_TEXT/source comparison.

| Stored state | SAP source behavior | Candidate reader behavior |
|---|---|---|
| No STXH header | Default persistence raises not-found; orphan STXL is not enough | Report missing in the classic store; do not decode orphan chunks as a text |
| Non-reference header, TDTEXTTYPE blank, no STXL | Successful empty lines, even if stored TDTXTLINES is positive | Return empty lines, retain stored count, optionally report count mismatch |
| Same header, valid zero-row TLINE cluster | Successful empty lines | Return empty lines; distinguish this storage observation from no chunks if diagnostics need it |
| Same header, one blank TLINE | One line, not zero | Preserve the row; do not filter blank lines |
| Same header, nonempty cluster | Imports TLINE | Strictly decode the qualified profile; preserve order and format codes |
| TDTEXTTYPE nonblank | Reads STXB and applies binary/text conversion | Return unsupported format before attempting STXL or empty classification |
| TDREF is true, complete target fields | Ignores alias line storage and resolves target | Follow target or explicitly return unsupported references |
| TDREF is true, target held in legacy STXL ITCRF | Imports reference metadata rather than TLINE | Return unsupported legacy-reference profile until independently implemented and tested |
| TDREF false but target fields populated | Single default read ignores target fields; batch normalizes them away | Never follow fields solely because they happen to be nonblank; reject inconsistent metadata or follow the documented stored flag contract |
| Valid alias, missing target | Invalid-reference exception, mapped to REFERENCE_CHECK / batch code 5 | Broken-reference result, not successful empty and not root-key missing |
| Valid alias, existing empty terminal | Successful empty terminal lines | Return empty with the full path |

**TDTEXTTYPE controls storage interpretation.** Blank means ITF; nonblank identifies another text
format. The public API can still pass non-ITF contents using TLINE-shaped tables, which does not
make those values SAPscript paragraphs. ITF itself is source for the composer; it is not rendered
output. Returning decoded ITF must not imply INCLUDE expansion, symbol replacement, HTML
conversion, or a printable document.
[SAP Text Lines](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1c2c180b4d1a26e10000000a42189e.html?version=202510.002).

**TDTXTLINES is not a sufficient existence or integrity check.** The 758 manager saves the value
from the stored header for READ_TEXT's separate OLD_LINE_COUNTER output, then replaces the
returned header count with the actual number of lines. The default handler deliberately permits
missing line storage. The 750 routines also count imported lines. References normally have no
own lines and can store zero while READ_TEXT returns the terminal count.
The field's documented purpose is a line count, not a cluster checksum.
[SAP THEAD](https://help.sap.com/saphelp_snc700_ehp04/helpdata/en/4e/165833b8294181e10000000a15822b/content.htm?no_cache=true).

**A raw STXH row is not the full API HEADER.** The inspected modern manager fills missing style,
form, and editor width from TTXOB, using SYSTEM when no form is configured. READ_TEXT additionally
sets the ITF editor width from object customizing. Raw storage metadata should therefore be
named as such. Reproducing every THEAD field would require more customizing reads and a separately
tested compatibility promise.

## References and languages

A reference changes object, name, and ID; it retains the current client and language. There is no
reference-language column. The root key's language is used at every hop. The returned header
belongs to the requested alias while its lines come from the terminal text. Preserve both keys
in an ARC-1 result instead of replacing the requested identity with the terminal identity.

SAP documents same-language references, chains, and REFERENCE_CHECK when a target disappears.
REFER_TEXT prepares a header; SAVE_TEXT must subsequently persist it. References are distinct
from an INCLUDE command inside a TLINE, which this reader should return as source text.
[SAP Referring to Texts](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1f1333faad1a22e10000000a42189e.html?version=202510.002),
[SAP REFER_TEXT](https://help.sap.com/saphelp_scm700_ehp02/helpdata/en/4e/1e90c3b37e1a25e10000000a42189e/content.htm?no_cache=true).

Important source details:

- Modern single read uses STXH-TDREF to decide whether to resolve a reference. If TDREFOBJ is
  blank, it tries the old ITCRF structure stored under the same STXL TX key. ITCRF is not the
  decoder's one-table TLINE profile.
- Modern batch read first repairs/normalizes reference metadata. It tries ITCRF if any target
  component is missing; if recovery fails it clears the reference fields and flag. This means
  malformed reference metadata can produce different single and batch results. A strict new
  operation should report unsupported/inconsistent metadata rather than imitate that accident.
- The 750 legacy-reference path writes recovered reference fields back into its returned alias
  header. The modern single handler uses a local header copy, so exact header normalization can
  differ across releases even when the resolved lines match.
- The inspected modern recursion guard rejects at a counter of 1,000; the 750 iterative path
  guards after 1,000 iterations. A new reader should detect repeated complete keys immediately
  and enforce a smaller explicit hop/request budget. A resource-limit error is not proof that
  SAP itself would reject the same acyclic chain.
- A reference may point across objects and IDs. All hops must receive the same data-policy,
  table-blocklist, identity, and result-budget enforcement as the root request.

The input language should initially be the internal one-character SAP SPRAS value. Do not truncate
EN to E or silently use the connection's logon language. If ISO input is later accepted, map it
through target-system language metadata as a separate, explicit feature. READ_TEXT reads only
the supplied language; neither its public interface nor the inspected stored-read path chooses
an original-language or English fallback. TDOSPRAS is not a general fallback instruction; the
THEAD documentation limits its original-language interpretation to forms and styles.

Names require exact preservation: do not uppercase, trim leading/internal spaces, or normalize
Unicode in a text name. Existing spike evidence already includes leading repeated spaces and
an 816 SQL-normalization issue. Treat SAP key validation and safe query construction separately.
Public name-validation prose and inspected mass-read validation are not identical: the latter
specifically checks doubled commas and permits blank names for update-task objects. Avoid
claiming exact READ_TEXT exception parity from a generic client-side regex; oracle-test the
intended accepted key subset.

## Batch APIs as oracles

The inspected 758 function group exposes both modules. The inspected 750 STXD function catalog
does not contain READ_TEXT_TABLE or READ_MULTIPLE_TEXTS. Their absence there is a capability
finding, not evidence that all 750 systems lack them.

| API | Input selection | Successful output | Missing key behavior |
|---|---|---|---|
| READ_TEXT | One complete object/name/ID/language key, optional client | HEADER THEAD, LINES TLINE, OLD_LINE_COUNTER | NOT_FOUND exception |
| READ_TEXT_TABLE | TEXT_HEADERS table of THEAD key records | TEXT_TABLE of TEXT_LH | Explicit requested absent key appears in ERROR_TABLE with FUNCTION X |
| READ_MULTIPLE_TEXTS | Scalar patterns or per-component ranges; ranges take precedence | TEXT_TABLE of TEXT_LH | A key with no matching header/memory entry is not enumerated, so has no missing error row |

READ_TEXT_TABLE imports CLIENT_SPECIFIED (abap_bool, default blank), ARCHIVE_HANDLE (sy-tabix,
default 0), LOCAL_CAT (abap_bool, default blank), and USE_OLD_PERSISTENCE (abap_bool, default false).
It exports TEXT_TABLE and ERROR_TABLE, both TEXT_LH. Its TABLES parameter TEXT_HEADERS has line
structure THEAD. The only declared function exception is WRONG_ACCESS_TO_ARCHIVE. A blank MANDT
means the current client; another client is an error unless CLIENT_SPECIFIED is enabled.

TEXT_LH entries use structure ITCLH: HEADER THEAD, FUNCTION CHAR1, and LINES TEXT_LINE_TAB.
Error FUNCTION values in the inspected implementation are:

| Value | Meaning |
|---|---|
| 1 | Invalid object |
| 2 | Invalid ID |
| 3 | Invalid name |
| 4 | Invalid language |
| 5 | Unresolvable reference |
| 6 | Inconsistent text / handler failure |
| 7 | Disallowed client in explicit-table mode |
| X | Explicit text not found |

Do not infer an exact validation-precedence contract from that table: database selection,
persistence-handler routing, key validation, and memory merging happen in different orders in
the three APIs. The live explicit-table oracle preserves a repeated successful input in its
normal persisted path; archive handling contains separate deduplication. Match oracle rows by
complete key and verify repeated-input counts separately, not by returned position. A missing-body
header is explicitly allowed in both batch modules.

READ_MULTIPLE_TEXTS additionally accepts NAME_RANGES, OBJECT_RANGES, ID_RANGES, LANGUAGE_RANGES,
ARCHIVE_HANDLE, LOCAL_CAT, WILDCARD_PLUS, and USE_OLD_PERSISTENCE. It is useful for broad oracle
sampling, but an exact-key reader should not inherit its wildcard or enumeration semantics.

## Behavior unavailable from classic table reads

For update-task objects, SAP checks the session's text catalog before the persisted version.
Pending inserts, changes, copies, and deletions can therefore change a READ_TEXT result without
any corresponding committed STXH/STXL change. Archives require an archive handle. Database-only
queries cannot recover another application's ABAP memory or reproduce an archive request.
After NOT_FOUND, public documentation calls HEADER/LINES work areas undefined; an oracle must
clear outputs and compare only the success/error contract, never stale contents.
[SAP Reading Texts](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e168649b84a1a27e10000000a42189e.html?version=202510.002).

Modern persistence adds two further boundaries found in source:

1. TTXID-HANDLER_CLASS takes precedence over TTXOB-HANDLER_CLASS; blank ultimately selects the
   default classic handler. Migration state can temporarily select old storage. Merely finding
   an STXH row does not prove READ_TEXT would choose it, and missing STXH does not prove a custom
   handler has no text. A general production reader needs an explicit supported-persistence
   qualification, not a silent table fallback.
2. CL_RSTX_TABLE_VIEW can read STXH_I/STXL_I and STXH_D overlay information during special
   upgrade conditions. A classic-table-only reader does not implement that merged view. Do not
   infer its safety solely from SAP_BASIS version or presence of STXH.

Non-Unicode persistence has additional language/code-page conversion behavior in the native
IMPORT path. The inspected batch implementation even falls back from an imported cluster to a
database IMPORT for certain legacy code-page/language combinations. This reinforces the spike's
explicit restriction to independently tested FF06/4103; it does not establish support for all
SAP text encodings.

## High-value oracle matrix

Run the fixture-only cases on 758 and 816 with independent READ_TEXT and, where present,
READ_TEXT_TABLE/READ_MULTIPLE_TEXTS results. Use fresh synthetic names, verify cleanup, and
retain only sanitized counts/statuses in the repository. No standard source or existing text
is a public fixture. This table is a test plan, not a claim that the tests have run.

| Case | Setup / observation | Required result |
|---|---|---|
| Missing exact key | Fresh name, no header/body | READ_TEXT missing; explicit batch X; ranges no row; candidate missing-store |
| One blank row | SAVE_TEXT with one initial TLINE | One decoded row, even when displayed text is empty |
| Empty save | SAVE_TEXT with zero rows | New insert becomes no-op; updating an existing ordinary text deletes it; do not use as a header-only fixture |
| Persisted zero-row table | Fixture-only persistence-manager CREATE with empty TLINE | Header plus zero-row cluster; success with zero lines; verify actual storage before concluding |
| Header without body | Fixture-only internal header insert, with body argument omitted | Header exists/no STXL; READ_TEXT succeeds empty; candidate succeeds empty |
| Stored count differs | Explicit fixture metadata, never modify existing texts | Compare stored count, OLD_LINE_COUNTER, returned count; candidate preserves distinct values |
| Direct reference | REFER_TEXT then SAVE_TEXT to ordinary terminal | Alias header, terminal lines, same client/language; alias need not have STXL |
| Two-hop chain | Alias A to B to terminal C | All hops retained; terminal lines equal direct C |
| Reference to empty terminal | Reference to zero-row/header-only fixture | Success with zero lines, not broken reference |
| Broken terminal | Create valid reference then delete fixture terminal | READ_TEXT REFERENCE_CHECK; explicit batch 5; candidate broken reference |
| Missing intermediate | Delete fixture B from A to B to C | Broken-reference result despite C still existing |
| Cycle | Two fixtures prepared without line reading, then linked | Terminating reference error; candidate immediate cycle detection with no partial success |
| Depth budget | Acyclic fixture chain longer than candidate budget | Candidate resource-limit error; do not assert SAP equivalence at this smaller threshold |
| Cross-object/ID target | Reference to a different allowed fixture key type | Correct transitive read, same connected client and language |
| Exact language | Same synthetic name in two languages with distinct lines | Each request returns only its language; absent third language is missing |
| Reference-language miss | Alias language exists but terminal exists only in another language | Broken reference, no fallback |
| ISO language input | Pass EN to a proposed external interface | Explicit rejection/mapping policy; never silent truncation |
| Non-ITF header | Synthetic nonblank TDTEXTTYPE profile | Candidate unsupported before empty/STXL logic; native API uses STXB |
| Legacy reference buffer | Synthetic ITCRF EXPORT buffer and reference metadata | Candidate unsupported profile until separately qualified; never treat as TLINE |
| Memory insertion/update/delete | Same helper session, update-task object, before commit | Native result may differ from committed-store read; document this expected boundary |
| Batch mixed inputs | Existing, missing, blank, broken reference, duplicate keys | Join by full key, assert per-key outcomes and deduplication, no positional assumptions |
| Archive request | Supplied invalid archive handle | Native archive exception; candidate interface should reject archive parameters as unsupported |
| Literal preservation | Quotes, repeated spaces, supported Unicode in exact key | No broadened lookup; extraction errors stay separate from missing text |

Use REFER_TEXT with CHECK_REFERENCE and READ_LINES enabled for ordinary valid fixtures, followed
by SAVE_TEXT. It checks the immediate target and can return terminal lines. To construct a cycle,
both checks must be disabled during preparation; no high-depth SAP loop is needed to prove the
candidate's own cycle handling. Every temporary artifact must have an explicit finally cleanup.

For header-only or inconsistent-metadata tests, normal SAVE_TEXT intentionally does not preserve
the needed state. The inspected internal CL_RSTX_TABLE_VIEW header insertion path leaves body
storage untouched when no text-lines argument is supplied. Such tests require the already
authorized disposable-fixture scope and must never target existing text keys. A pure synthetic
reader fixture can cover the candidate branch without mutating SAP, but it cannot establish
native READ_TEXT behavior by itself.

## Executed semantic evidence

The opt-in [live probe](../../scripts/spikes/stxl/semantics-live.ts) independently created synthetic
texts on 758 and 816. Setup, single READ_TEXT, and READ_TEXT_TABLE used separate disposable console
classes so the oracle could not accidentally read setup's text memory. Every run used a unique
prefix, verified initial absence, and asserted the TEXT/ST default persistence handler before
creating fixtures. No RFC or Python was used.

Both releases returned the following outcomes, which also passed the new TypeScript reader's
single and batch comparisons:

| Case | Native outcome / candidate assertion |
|---|---|
| Same name in English and German | Distinct 2-line and 1-line contents |
| One blank TLINE | One preserved row |
| Persisted empty TLINE cluster | Success, zero lines, physical cluster present |
| Header without line storage | Success, zero lines, physical cluster absent |
| One-hop and two-hop references | Alias header retained; same 2-line terminal contents |
| Reference counters | Stored/OLD_LINE_COUNTER zero; returned TDTXTLINES two |
| Reference whose target was deleted | REFERENCE_CHECK; candidate REFERENCE_ERROR |
| Deleted target, zero-row SAVE_TEXT insert, absent key, absent language | NOT_FOUND; candidate NOT_FOUND |
| Synthetic RTF text | Native success through STXB; candidate NON_ITF_TEXT |
| Repeated ordinary key in explicit batch | Native and candidate preserve the repeated result |

That is 13 native semantic cases and 13 candidate single comparisons per release, plus 14
candidate batch results per release including the repeated input. Native batch output contains
nine successes and five errors. Strict codec comparisons additionally cover the ordinary English,
German, blank-row, and zero-row clusters. The RTF native result is not claimed to be rendered or
general-purpose RTF compatibility.

Live discovery also returns exactly the nine captured synthetic STXH headers on each release,
including references and non-ITF metadata. A prefix ending in a literal underscore finds those
headers, while an otherwise identical prefix ending in a literal percent finds none. These
checks exercise the new literal-preserving, data-gated ADT source with free SQL disabled.

Full raw headers, native captures, and lifecycle records stay in the private local artifact
directory. Sanitized synthetic fixtures commit only whitelisted metadata, normalized synthetic
keys, compressed test bodies, and independent native expected lines/status. Each completed fixture run deletes only its exact generated
keys/languages and verifies absence independently in STXH, STXL, and STXB. The runtime probe's
newest version also keeps immutable per-prefix copies instead of relying only on latest-run
filenames. Early oracle-development failures exposed an OLD_LINE_COUNTER type mismatch and
STXB's differently spelled STRF2 counter; their cleanup completed before rerunning.
The final run uses four temporary classes per release, all deleted through the helper lifecycle.

## Remaining ambiguities and production work

- Extend the executed subset of the semantic matrix where it changes the supported contract.
  Legacy ITCRF, memory, archives, custom handlers, and upgrade overlays remain source/documentation
  boundaries rather than newly qualified native-reader features.
- The candidate supports complete-header references with an eight-hop bound and rejects ITCRF
  legacy storage. Production integration preserves that explicit boundary.
- The candidate warns on stored/decoded line-count mismatch and rejects changed headers/chunks.
  Native SAP is
  permissive about missing/failed body imports; the strict codec should continue to reject
  malformed nonempty clusters rather than disguise corruption as emptiness.
- Set a persistence qualification mechanism. Custom handler selection and upgrade overlays need
  an honest supported-store contract; inspecting every handler or migration at runtime would be
  a separate feature.
- Multiple queries are not a database snapshot. Rechecking unchanged STXH fields before/after is
  useful race detection but cannot prove consistency: timestamps are coarse and SAVE_TEXT does
  not provide a universal monotonically increasing content version. A changed/mixed payload
  must fail instead of returning partial lines; a stronger snapshot promise needs separate proof.
- The full production THEAD-normalization and native validation/exception precedence are outside
  a raw-header contract. Preserve source metadata and explicit operation semantics first.

Roadmap impact: FEAT-86 now covers additional unsupported profiles and persistence; the qualified
classic subset is integrated separately in PR #1012. FEAT-76 remains unrelated to the native codec contract.
