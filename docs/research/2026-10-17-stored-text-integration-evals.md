# Stored SAPscript texts: design and qualification

2026-10-17 · [PR #1012](https://github.com/arc-mcp/arc-1/pull/1012) ·
[Usage guide](../../docs_page/tools.md#stored-sapscript-long-texts) ·
[Reproduction scripts](../../scripts/spikes/stxl/README.md)

## Decision

ARC-1 reads saved classic SAPscript ITF texts through `SAPQuery(action="long_text")`.
Guarded ADT queries retrieve STXH/STXL; a bounded TypeScript decoder returns formatting codes
and lines. The runtime uses no RFC, Python, installed ABAP helper, or free-SQL fallback.
This report consolidates the codec investigation, SAP semantics, use cases, integration plan,
and evaluations. Original machine-readable evidence is retained below.

SAPQuery fits business-data access; SAPRead remains focused on development objects. One action
with `discover`, `read`, and `search` modes reuses one exact-key shape without adding tools or
splitting the workflow. Asking a model to select raw clusters and decode them would duplicate
binary logic and encourage broader SQL access.

This covers the saved-text portion of [#1000](https://github.com/arc-mcp/arc-1/issues/1000),
not SAPscript forms, SmartForm layouts, or STXFCONT. It does not replace the broader
BALDAT/INDX proposal in [#844](https://github.com/arc-mcp/arc-1/pull/844).
[FEAT-86](../../docs_page/roadmap.md#feat-86) tracks additional profiles and persistence.

## Useful workflows and exact keys

Public requests support these use cases. They are demand examples, not measured search volumes.

| Need | Evidence and supported workflow |
|---|---|
| Purchasing header/item text reporting | [Missing PO/PR texts in reports](https://community.sap.com/t5/enterprise-resource-planning-q-a/po-pr-header-texts-amp-amp-item-texts-missing-in-the-standard-reports/qaq-p/14499514): discover verified header/item keys, then read a bounded batch. |
| Material and master-data extraction | [Master-data and purchasing texts](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/report-of-master-data-s-texts-and-purchasing-document-s-text-for-header-and/ba-p/13254657): return text with its exact identity for reports or integrations. |
| Sales-order text for BI/ETL | [Long-text extraction](https://community.sap.com/t5/technology-blog-posts-by-members/long-text-extraction-via-read-text-fm/ba-p/13252074): preserve structured lines and per-input status. |
| SO10 reusable standard text | [Fiori text proposals from SO10](https://community.sap.com/t5/technology-q-a/the-long-text-on-fiori-needs-to-be-proposed-from-so10-standard-text-in-gui/qaq-p/12648627): read the saved source template without expanding INCLUDEs. |
| Phrase search or missing-text diagnosis | [PO text search](https://community.sap.com/t5/supply-chain-management-q-a/how-to-search-for-purchase-orders-by-text-field/qaq-p/14483181), [text visible in ME23N but absent from STXH/STXL](https://community.sap.com/t5/enterprise-resource-planning-q-a/info-record-po-texts-are-present-in-me23n-but-not-in-stxh-stxl/qaq-p/12605497): search supplied keys and distinguish missing classic storage from broader application behavior. |

The identity is `{object, name, id, language}` in the connected client. Preserve name case and
leading/internal spaces; use one-character SAP language keys without fallback. There is no
uniform construction rule for `TDNAME`. Verify object/ID/name in the target's text header and
customizing, or ask for the exact key. Discovery requires a known object and literal name prefix;
it cannot infer a PO item mapping from a document number alone. Return candidate keys for reuse.
[SAP long-text guidance](https://help.sap.com/docs/ABAP_PLATFORM_NEW/f6a2c35cb0dd4900ad16d735f1415331/4dafaf283c31288de10000000a42189e.html?version=202510.002).

Business-object presets, customizing descriptions, and a system-wide text index are not included.
Search is a case-sensitive literal match within individual ITF lines of supplied keys. SAPscript
commands and retrieved instructions remain data; the tool neither executes nor renders them.

## Runtime and safety contract

The action requires `SAP_ALLOW_DATA_PREVIEW=true`, `data` scope for authenticated callers,
and the caller's SAP data access. Table blocklists and lineage checks cover STXH, STXL, TTXOB,
TTXID, and T002. Direct table access has data-authorization semantics, not the application's
complete text-API authorization semantics. Scopes restrict the server ceiling; they never expand it.

Free SQL separately requires `SAP_ALLOW_FREE_SQL` and `sql` scope. Existing SAPQuery calls may
still omit `action` to select SQL. Deployments with preview already enabled gain long-text access
on upgrade; `SAP_DENY_ACTIONS=SAPQuery.long_text` disables that action. Disabled or denied actions
are pruned from standard, hyperfocused, and target-specific listings. BTP ABAP targets hide and
reject it; hosting ARC-1 on BTP with an on-premise target is a different deployment.

| Boundary | Limit |
|---|---|
| Read/search batch | 1–25 exact keys, preserving order and duplicates |
| Discovery | Default 20, maximum 50 headers; narrow the prefix when `more=true` |
| Search output | At most 50 matching lines from supplied keys |
| Session | 60 seconds, 120 table queries, cancellation and shared admission/response accounting |
| References | Eight hops with cycle detection, same client and language throughout |
| Decoded batch | 2 MiB / 10,000 lines; existing response limits may stop it earlier |

Headers and terminal bytes are reread to detect observed changes. This deliberately costs extra
queries; complex 25-key batches can reach the query cap, while tested 10-key retries succeed.
A budget or infrastructure failure stops the request. Per-text semantic errors retain their input
index. Matching rereads are not a transactional snapshot. Keys, phrases, business text, and binary
data are redacted from audit sinks; the requested lines still go to the calling model.

## Stored-text semantics

SAP's [READ_TEXT](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1e8fc1b37e1a25e10000000a42189e.html?version=202510.002)
also handles text memory, archives, and persistence choices. This operation implements only the
qualified classic store and rejects unsupported formats instead of presenting them as empty.

| Stored state | ARC-1 result |
|---|---|
| No STXH header | `NOT_FOUND` in classic storage; orphan STXL does not establish a text |
| Ordinary ITF header without STXL, or a valid zero-row cluster | Successful empty lines, with stored count retained separately |
| One blank TLINE | One preserved row |
| Ordinary ITF cluster | Ordered `{format, text}` lines; only fixed-width trailing ASCII-space padding removed |
| Complete stored reference | Requested alias identity/header, resolved key, reference path and terminal lines |
| Missing target, cycle, excessive depth | Distinct reference errors; no language fallback |
| Nonblank TDTEXTTYPE | `NON_ITF_TEXT`; native SAP may read it through STXB |
| Legacy ITCRF, unsupported container/code page, or custom persistence | Explicit unsupported result |
| Malformed nonempty cluster or observed change | Decoding/consistency error, never successful emptiness |

`TDTXTLINES` is stored metadata, not proof of existence or integrity. Native READ_TEXT can replace
its returned header count with the actual count and retain the stored count separately. ARC-1
does not claim full THEAD normalization. References change object/name/ID while retaining language;
they differ from INCLUDE commands inside a line.
[SAP THEAD](https://help.sap.com/saphelp_snc700_ehp04/helpdata/en/4e/165833b8294181e10000000a15822b/content.htm?no_cache=true),
[text references](https://help.sap.com/docs/ABAP_PLATFORM_NEW/872c7db8e8ad411c8c3364aceed6e2c1/4e1f1333faad1a22e10000000a42189e.html?version=202510.002).

The reader validates object/ID/language against customizing and rejects nondefault persistence
handlers. TTXID handler selection takes precedence over TTXOB. Upgrade overlays, text memory,
archives, non-Unicode conversion, native exception precedence, form rendering, and INCLUDE/symbol
expansion remain outside the contract. A missing classic row cannot prove absence in those stores.

Native READ_TEXT_TABLE was an independent exact-key batch oracle on 758/816; its persisted path
preserved duplicate inputs and reported absent keys. READ_MULTIPLE_TEXTS instead enumerates matches
and does not emit missing-key rows for unselected identities. These APIs were absent from the
inspected 750 catalog; that observation is not a claim about every 750 installation.

## Decoder and extraction boundaries

There is one codec in `src/adt/stored-text/`: `key.ts` validates identity, `source.ts` handles
guarded extraction and budgets, `chunks.ts` assembles chunks, `reader.ts` handles headers/references,
and `decoder.ts` parses the container. Research probes reuse the decoder and chunk assembly;
the raw codec-comparison probe retains its own bounded extraction loop.

The qualified container is FF06, byte-order flag 02, code page 4103 (UTF-16LE), with one TLINE
table. Other versions/code pages are rejected. Observed CLUSTD cells contain all 7,902 bytes;
CLUSTR supplies meaningful length. Chunk assembly checks identity, hex, length, gaps, duplicates,
and intermediate chunks; SRTF2 is limited to 0–255 across eight 32-counter windows.

Compressed containers have a 16-byte header, declared output length at byte 16, algorithm 0x12,
magic 0x1F9D, and payload at byte 24. Removing the first `2 + (payload[0] & 3)` bits allows Node's
`inflateRaw` to decode the tested SAP streams. A 14-bit window, `maxOutputLength`, exact declared
length, and strict table/field/segment/terminator checks bound decoding. Limits are 2 MiB input,
4 MiB decompressed container and 10,000 lines; callers can only narrow them.

SAP's compressor leaves opaque trailer bytes. Valid captured streams had 1, 2, 5 or 6 residual
bytes, sometimes nonzero. The six-byte ceiling is empirical, not a checksum or proven trailer
grammar. Native zlib accepts more streams than a strict SAP decompressor; this is a bounded
parser for the qualified SAP-produced profile, not an authenticity verifier or general CS_LZH
validator. Bytes after the decoded container END marker are rejected.

ABAP CHAR truncation can preserve a lone UTF-16 surrogate. The decoder retains code units,
reports malformed Unicode in its internal result, and uses JSON escaping for lossless exchange.
Kernel fixtures cover lone surrogates, NUL, U+FFFF, trailing tabs, and non-ASCII spaces.

On the tested 816 backend, SQL-line `CONDENSE` alters repeated spaces inside literals. The
stored-text adapter uses the internal `preserveLiteralSpaces` option with `CONCAT_WITH_SPACE`.
Repeated-space prefixes compare `LEFT(TDNAME,n)` and `LENGTH(TDNAME)`; ordinary prefixes use
escaped LIKE. Unqualified space-preserving IN lists are refused. Public `TABLE_QUERY` exposes
literal `STARTS_WITH`. General `TABLE_QUERY` and free-SQL literals with repeated spaces are still
condensed on the tested 816 system and can match different rows. That pre-existing behavior is
outside this stored-text fix and tracked separately as [FEAT-87](../../docs_page/roadmap.md#feat-87).

One research-only expanded-constant SQL case still fails on 816: the oracle applies LEFT/LENGTH
to nested constants rather than to a field. It passed 8/8 cases on 758 and 7/8 on 816. The runtime
field form passed the public probes below, including positive existing spaced-name matches.
The failure is retained as evidence; no generic SQL workaround or runtime free-SQL fallback was added.

## SAP verification

All testing below used authorized test systems on 2026-10-17. Only synthetic fixtures and
sanitized summaries are committed. Existing texts, raw captures and SAP standard source stay private.

| Evidence | Result and qualification |
|---|---|
| Kernel EXPORT/IMPORT on 750, 758, 816 | 18 ordinary + 6 Unicode compressed/plain cases per release: 72 total |
| Initial existing-text corpus | 211 primary comparisons; a research SQL route recovered the 816 spaced-name miss, giving 212 overall. The later guarded adapter fixed that extraction path without free SQL. |
| Large persisted round trips on 758/816 | Two 2,000-line texts, 37 chunks each; SAVE_TEXT → native assertion → ADT decode → delete/absence check |
| Native semantic oracles on 758/816 | Per release: 13 single cases and 14 batch entries, covering languages, blank/empty/header-only texts, references, missing targets, duplicates and non-ITF rejection |
| Public smoke checks at `101ccaa1` | Read, discovery, ordered existing/missing/duplicate batch and phrase search passed on both 758/816 |
| Public corpus rerun at `101ccaa1` | 77 texts / 17,307 lines per release on 758/816: **154 texts / 34,614 lines** matched previously captured native READ_TEXT values |
| Prefix qualification | 26 public calls after the prefix fix; a later rerun passed 12 edge cases plus two positive existing spaced-name matches |
| 750 capability rerun | Discover/read/search correctly returned `UNSUPPORTED_PLATFORM` for the absent preview endpoint |
| BTP ABAP rerun | Live identity read passed; explicit/detected BTP rejection and tool-schema exclusion passed; text extraction remains unsupported |

The public corpus rerun excluded seven pre-existing over-3,000-line oracle cases per newer system;
these are not passes. It used saved native expectations, not fresh native calls. The earlier 750
corpus was extracted by a disposable oracle: it proves decoding, not an installation-free ADT path.
Release numbers alone do not establish support for every installation.

Public reruns used no RFC, helper execution, SAP writes, or free SQL. Earlier fixture generation
used disposable ABAP console classes and local READ_TEXT calls, never RFC. All 50 temporary
classes were deleted and checked absent; large texts and semantic fixture prefixes were removed
and independently checked in STXH/STXL/STXB. No persistent SAP service or transport was installed.

## Model evaluation and release checks

The eval harness uses real tool definitions and the production dispatcher over synthetic
SAP-generated fixtures. It grades ordered multi-turn calls, exact nested keys, forbidden calls,
and final-answer assertions. Unsupported CLI trajectory providers fail explicitly. Private
business texts are never sent to a model by these tests. Regex answer checks need manual review.

| Historical run | Automated result | Qualification |
|---|---:|---|
| Former SAPRead surface, Qwen3.6 MLX | 3/10 | Tool-parser errors and unresolved 8k-loaded versus ~20k-reported context discrepancy |
| Former SAPRead surface, Llama3.1 8B, 32k | 1/10 | The automated pass failed manual review |
| Former SAPRead surface, Qwen3.5 27.8B, 32k, temperature 0 | 6/10 original; 7/10 after a documented grader correction | Invalid extra arguments, guessed mapping and answer inaccuracies remained |
| SAPQuery surface, Qwen3.5 27.8B/Q4_K_M, 32k, temperature 0 | 8/10 raw | One guessed PO mapping; one Markdown-related rejection plus unsupported explanation; additional inaccuracies in automated passes |

These are single runs, not a leaderboard or reliability estimate. The 8/10 payload hash is
`4a70bbc33f4503b9c895ec5e6a44653a46b6639c248bc45947209fc06282701f`; descriptions changed afterward.
It is **not a score for the final payload**. Manual findings include rendering literal `&amp;` as
`&`, misdescribing ITF paragraph markers, and unsupported claims about unsaved text. Original
scores, corrected grades, failures and full traces are retained; none were silently dropped.
Exact-content consumers should use returned line values, not a model's rendering or paraphrase.

Historical local validation at `101ccaa1`: **326 files / 9,229 tests** passed in a fresh two-worker run without
retries. Typecheck, build, lint, policy checks, strict docs build, package inspection and schema/file
budgets passed. GitHub CI, including SAP integration and E2E, was green. The full wire surface was
74,459 bytes under the unchanged 74,500-byte ceiling; SAPRead descriptions were deliberately
shortened, with unique operational hints retained and regression-tested.

Release review also exposed an in-flight timeout being reported as a connectivity failure. The
session check now runs before rethrowing transport errors; public-dispatch tests cover deadlines
and cancellation, while ordinary network errors retain their classification. The query-budget
tradeoff and research-oracle failure remain disclosed above. A finite passing suite does not establish full
READ_TEXT parity or autonomous-model reliability. Qualify the actual deployment model before
making such a claim; contributor trials add landscape coverage without being a separate feature mode.

## Evidence and reproduction

- [SAP evidence and cleanup record](stored-text-evidence/sap.json)
- [Historical SAPRead model traces and grades](stored-text-evidence/model-sapread.json)
- [Historical SAPQuery model traces and grades](stored-text-evidence/model-sapquery.json)
- [Live probe instructions](../../scripts/spikes/stxl/README.md) and synthetic `tests/fixtures/stxl/`

```sh
npx vitest run tests/unit/spikes tests/unit/handlers/long-text.test.ts tests/unit/evals
npm run test:eval -- --provider ollama --model <installed-model-tag> --file stored-text --backend mock
```

Configure sufficient model context, record parameters and tool hash, retain all trajectories, and
inspect passing as well as failing answers. Repeated and held-out tasks are needed for reliability
claims. Broader persistence/profile support needs independent SAP fixtures before changing the contract.

## Research provenance

The starting point was the [SAP Community article](https://community.sap.com/t5/technology-blog-posts-by-members/beyond-read-text-decoding-sapscript-long-texts-stxl-with-sqlscript-in-cds/ba-p/14468331),
retrieved through SAP Docs MCP after direct access returned 403. Its
[MIT reference repository](https://github.com/aamelin1/sap-long-texts/tree/19c8c272b23f0ab481f7d63b6b36c45db15fd095)
was read as a format reference; Python was never executed. MIT attribution remains in distributed
decoder JavaScript and the probe [NOTICE](../../scripts/spikes/stxl/NOTICE). No GPL implementation
or proprietary SAP source was copied. Public open-rfc research yielded no reusable STXL decoder.

Authorized SAP source inspection covered READ_TEXT, READ_TEXT_TABLE, READ_MULTIPLE_TEXTS,
SAVE_TEXT/REFER_TEXT/DELETE_TEXT, persistence/header classes, and ADT preview/class-run handlers.
SAP Help supports the API/storage semantics; Community posts establish examples of user need.
The earlier speculative oracle matrix and superseded routing proposals were consolidated into
the supported contract, executed evidence and remaining limits above.
