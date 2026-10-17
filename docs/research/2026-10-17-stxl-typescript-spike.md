# STXL long texts in TypeScript: feasibility spike

Date: 2026-10-17. Base: ARC-1 1.6.0, `041a9e48`. Status: integrated as `SAPQuery long_text` in
PR #1012; see the [production contract](../../docs_page/tools.md#stored-sapscript-long-texts).
Runtime implementation: TypeScript and Node's built-in zlib;
no RFC, Python, SAP SDK, or ABAP companion is required by the candidate reader.

## Decision

**A bounded select-and-decode path is feasible for the tested stored-TLINE profile.** Guarded
ADT queries return complete STXL binary cells on the tested 758 and 816 systems. After a small
SAP bit-framing adjustment, native `inflateRaw` decompresses those streams. A strict container
parser recovers formatting codes and text lines exactly against independent SAP oracles.

The follow-up provides a **discover → read → batch → bounded phrase search**
workflow. It validates configured keys/default persistence, handles stored STXH references and
empty texts, preserves duplicate batch requests, and detects observed header/chunk changes.
Both 758 and 816 pass integrated comparisons with native READ_TEXT and READ_TEXT_TABLE.

A classic stored-text reader is
narrower than `READ_TEXT`: SAP's API also handles text memory, archives, legacy references, and
other persistence modes. Decoding whichever STXL row happens to exist is insufficient.
[SAP READ_TEXT documentation](https://help.sap.com/saphelp_snc70/helpdata/EN/d6/0db8c8494511d182b70000e829fbfe/content.htm?no_cache=true).

This can address the stored SO10/text portion of
[#1000](https://github.com/arc-mcp/arc-1/issues/1000), which proposes a GET-only companion for
SO10, SAPscript forms, and SmartForms. It does not decode form layouts or establish an STXFCONT
contract. FEAT-76 concerns parameterized extension services; it is not already a native STXL
decoder plan. FEAT-86 tracks broader persistence/profile qualification separately.
The detailed [semantic investigation](2026-10-17-stxl-read-text-semantics.md) explains the API
differences. [Use-case research](2026-10-17-stxl-use-cases.md) recommends business-document/master-data
text reads first, followed by metadata discovery, SO10 lookup, and bounded phrase search. These
priorities are inferred from public requests, not measured search volumes.

## Sources and method

- User-supplied [SAP Community article](https://community.sap.com/t5/technology-blog-posts-by-members/beyond-read-text-decoding-sapscript-long-texts-stxl-with-sqlscript-in-cds/ba-p/14468331).
  Direct fetch returned 403; SAP Docs MCP `fetch(community-14468331)` supplied its contents.
- Author's [MIT reference repository](https://github.com/aamelin1/sap-long-texts/tree/19c8c272b23f0ab481f7d63b6b36c45db15fd095),
  pinned at `19c8c272b23f0ab481f7d63b6b36c45db15fd095`. Its Python file was read as a format
  reference, never executed. The TypeScript marker traversal retains MIT attribution.
- SAP source read through authorized ADT: `READ_TEXT`, `READ_TEXT_TABLE`, `READ_MULTIPLE_TEXTS`,
  `SAVE_TEXT`, `REFER_TEXT`, `DELETE_TEXT`, persistence/header classes,
  `CL_OO_ADT_RES_CLASSRUN`, `CL_ADT_DP_FREESTYLE_RES`, and `CL_ADT_FREESTYLE_SQL_HANDLER`.
  No SAP standard source is committed in this change.
- Disposable ABAP oracle classes generated `EXPORT ... TO DATA BUFFER` with compression on/off,
  asserted kernel `IMPORT` equality, and returned the independent original TLINE table.
  Existing texts were compared with `READ_TEXT`. These are local function calls within ABAP,
  not remote RFC calls. No RFC calls were needed even during this investigation.
- The public open-rfc repository was checked for reusable compression work; no STXL/LZH decoder
  was found. It is not a dependency. No private open-rfc research or captures are copied here.

The implementation is in `src/adt/stored-text/`; runnable research probes remain in
[`scripts/spikes/stxl`](../../scripts/spikes/stxl/README.md). Only synthetic fixtures are committed.
Existing text bytes, standard source, identities, and raw live responses remain in private local
artifacts. An independent Claude Code Opus 5.5 Max research/review was completed through the GUI.
The [sanitized evidence summary](2026-10-17-stxl-evidence.json) records counts, releases, and cleanup
without existing text content or keys.

## Live evidence

Three on-prem test targets used client 001, verified HTTPS, and their configured SAP identities.
All evidence below was obtained on 2026-10-17. Native execution used Node 24.19.0.

| Check | SAP_BASIS 750 SP02 | SAP_BASIS 758 SP02 | SAP_BASIS 816 SP01 |
|---|---:|---:|---:|
| Synthetic EXPORT cases, compressed + plain | 18/18 | 18/18 | 18/18 |
| Raw Unicode edge cases, compressed + plain | 6/6 | 6/6 | 6/6 |
| Existing stored-text comparisons passing | 58 | 77 | 76 |
| Existing selections excluded by 3,000-line oracle budget | 2 | 5 | 5 |
| Exact-key ADT query miss before decoding | n/a | 0 | 1 |
| Direct ADT STXL extraction | 404 on both tested preview routes | yes | yes |
| Persisted 2,000-line, 37-chunk synthetic round trip | not attempted without preview | pass | pass |

That is **211 passing primary existing system/text comparisons**, plus 72 synthetic compressed/plain
comparisons and two persisted round trips. A separate, explicit SQL compatibility route also
recovered the 816 text missed above, yielding 212 successfully decoded system/text pairs overall.
These counts include the same standard texts on
different systems; they are not 211 distinct business scenarios. Existing 758/816 samples cover
German and English TEXT objects, up to 1,596 lines and nine chunks. The 750 stored samples were
extracted by the temporary oracle; they prove decoding, not an installation-free ADT data path.

Synthetic cases cover an empty table, an empty line, ASCII, SAPscript formatting codes, leading
and internal spaces, tabs, literal `&amp;`/`<tag>`, Greek/Cyrillic/CJK/Arabic, supplementary Unicode,
500 repetitive rows, and seeded random 70/500/2,000-row tables. Each line uses TLINE's fixed
2-character format and 132-character text layout. Comparison removes only trailing ASCII space
padding; tabs, leading spaces, entities, and Unicode are preserved.

The persisted round trip is `SAVE_TEXT -> COMMIT -> READ_TEXT assertion -> ADT STXL queries ->
TypeScript comparison -> DELETE_TEXT -> absence verification`. Both targets returned 37 chunks,
292,119 meaningful compressed bytes, 548,081 decompressed bytes, and 2,000 matching lines. This
exercises the reader's second 32-row window against real SAP storage. The synthetic normalized
line-array SHA-256 is `f0634bd8f9c3d542b633e3179ed544b634c2b36f7a24e38b515be00fef253d7d`.

The semantic follow-up added 13 single-read cases and 14 batch entries per system on 758/816:
English/German variants, blank line, zero-row cluster, header without cluster, one/two-hop
references, broken reference, deleted target, missing key/language, empty SAVE_TEXT, and non-ITF.
Native SAP can read the non-ITF case; the candidate explicitly rejects it because it lives in STXB.
All candidate results match the declared contract, including that deliberate restriction. Native
READ_TEXT_TABLE preserves duplicate inputs on the tested persisted path. Prefix discovery found
exactly nine fixture headers; literal underscore/percent checks also pass.

All four actual CLI commands passed on each newer system against existing data, with helper
writes and free SQL disabled. The repeated-space key also passes the new data-gated reader on
both systems. Synthetic semantic fixtures preserve independent native expected lines for offline
regression; existing business text remains private.

Across both phases and intermediate oracle corrections, **all 50 temporary classes** were deleted
and subsequent source reads verified absence (750: 6; 758: 22; 816: 22). Both large round-trip texts
were deleted and checked absent in STXH/STXL. All four semantic fixture prefixes on each newer
system were independently checked absent in STXH/STXL/STXB, including unsuccessful probe attempts.
No deployed MCP configuration, persistent service, or transport was changed.

## What the wire data established

1. ADT returns CLUSTD as 15,804 hex characters: the complete 7,902-byte field. CLUSTR gives the
   meaningful byte count. Numeric preview cells include trailing blanks; they need validated
   decimal parsing. Never parse malformed hex with permissive `Buffer.from` alone.
2. All observed containers were **FF06, byte-order flag 02, code page 4103**. The decoder explicitly
   rejects FF03–FF05 and other code pages until there is independent evidence. The reference's
   treatment of both 4102 and 4103 as little-endian was not inherited.
3. Compressed data has a 16-byte container header, declared little-endian output length at byte
   16, algorithm 0x12, magic 0x1F9D, and payload beginning at byte 24. Removing the first
   `2 + (payload[0] & 3)` bits lets `inflateRaw` decode every tested compressed stream.
4. Native decompression uses a 14-bit window and `maxOutputLength`, then requires exact declared
   output length. The parser requires one named TLINE table, exact fields, complete structure,
   row/table terminators, matching row count, segment metadata, and UTF-16LE code-unit fidelity.
5. zlib stops at the final compressed block. SAP samples include extra compressor trailer bytes,
   sometimes nonzero. Their complete meaning is not established here. This is **not** a checksum
   or authenticity verifier. Bounds and structural validation do not detect every valid mutation.
   The consumed-input check rejects more than six residual bytes; six is an empirical profile
   limit, not a fully reverse-engineered trailer grammar. Results expose the residual count.

The implementation limits input to 2 MiB, output to 4 MiB, lines to 10,000, and requests to eight
32-counter windows. Per-window ordering is irrelevant; the assembler sorts and rejects gaps,
duplicates, mixed client/key/RELID identities, invalid lengths, and short intermediate chunks.
SRTF2 is SYBIN1 (INT1), so valid counters are 0–255. Limits can only be narrowed, including at
the JavaScript runtime boundary.

## Independent review and counterexamples

The independent review supported the SAP bit-prefix removal plus native-zlib approach and found
useful edge cases. Its earlier snapshot also raised version/code-page and nested-container issues
already addressed by narrowing support to FF06/4103 and enforcing a single-table state machine.

The final follow-up added consumed-input accounting, a six-byte compressed-tail ceiling, initial
block-type rejection, segment-header checks, and the 256-chunk bound. Native zlib accepts a broader
set of streams than SAP's historical decompressor; a 14-bit window is not proof of strict SAP
distance/block conformance on arbitrary malformed input. This remains a bounded parser for the
tested SAP-produced profile, not a strict general-purpose CS_LZH validator.

The review proposed allowing only one or two zero trailer bytes. **Live counterexamples rejected
that proposal:** among 238 compressed buffers (211 corpus + 27 synthetic), residual lengths were
1, 2, 5, or 6, with nonzero tails in valid kernel-produced streams. The six-byte ceiling preserves
all these cases and rejects an appended 7,902-byte stale chunk. Trailer semantics remain open.

All three kernels also confirmed that truncating `131 * 'A' + emoji` to CHAR132 leaves a lone high
surrogate which EXPORT and IMPORT preserve. A manually introduced lone low surrogate also survives.
Fatal TextDecoder handling was therefore lossy by rejection for valid ABAP data. The decoder now
preserves UTF-16 code units, reports `wellFormedUnicode: false`, and relies on JSON escaping for
lossless interchange. Independent raw 268-byte TLINE oracles additionally verify embedded NUL,
U+FFFF, and trailing tab/NBSP/ideographic space. All 18 added comparisons pass.

The semantic follow-up separates key validation, guarded ADT extraction, stored-text orchestration,
binary parsing, and CLI handling into small modules with typed errors. Independent Sol review
found no remaining blockers after fixing diagnostic leakage and exact batch JSON accounting.
The parser now also rejects any bytes after the decoded container END marker; all earlier valid
corpus/kernel fixtures still pass. No GPL source or fixtures from the review were copied.

## Compatibility findings

### 816 quoted keys with repeated spaces

One selected German TEXT name starts with two spaces. The same exact-key query succeeds on 758
and returns no row on 816; a diagnostic suffix-LIKE query finds the row on 816. Inspected 816
`CL_ADT_DP_FREESTYLE_RES` applies `CONDENSE` to each incoming SQL line before parsing. That
changes repeated spaces inside literals as well as outside them. Long names with repeated
internal spaces have the same risk.

This is an extraction failure, not a decoder mismatch. The first investigation qualified an
explicit `readStoredTextSql` alternative using `CONCAT_WITH_SPACE`. For the affected leading-space key,
`concat_with_space( ' ', 'TEXTNAME', 2 )` illustrates the tested encoding on both 758 and 816. Its result exactly
matches READ_TEXT. Ordinary CONCAT and REPLACE did not preserve this value in the live probe.

The newer adapter now uses this encoding through an opt-in `preserveLiteralSpaces` argument on
the existing guarded `runTableQuery`. It passes both live systems with **free SQL disabled**,
without widening selection. Existing query callers keep their default SQL shape. A validated
`STARTS_WITH` operator quotes SQL and escapes `#`, `%`, and `_` before emitting LIKE/ESCAPE, allowing
literal prefix discovery. These are the only core runtime changes; the reader remains under scripts.

### 750 test-oracle and preview routes

Both tested STXL preview endpoints returned 404. Do not generalize this to every 750 installation.
The SAP console interface exists, but `CL_OO_ADT_RES_CLASSRUN` implements GET, and dynamic class
creation requires the uppercase name. POST returns 405; a lowercase name returns the handler's
"class does not implement" message. The test helper's explicit legacy switch remains write-gated.

The old JSON writer emitted unescaped line breaks when directly serializing large XSTRING values.
Encoding them explicitly as base64 strings avoids that issue. On newer systems, returning raw
JSON through the ADT console escaped XML entities. Encoding the complete oracle JSON as base64
preserves the comparison values. Literal-entity tests prevent accepting a lossy fix.

### Scope and authorization

Direct table reads have table-data authorization semantics, not the full application's text API
semantics. Inspected modern `READ_TEXT` also delegates persistence through
`CL_RSTXT_PERSISTENCE_MANAGER`; STXL should not be assumed to hold every text or storage mode.
The adapter validates TTXOB/TTXID/T002 and rejects nondefault persistence handlers. Stored STXH
references are supported; legacy ITCRF references, archives, text memory, non-ITF formats, exits,
and alternate/upgrade persistence remain outside the contract. No ABAP Cloud / BTP system was
qualified for this classic-table path.

## Production integration

The tested classic stored-text reader is exposed as `SAPQuery(action="long_text")`, with discovery,
ordered batch reads, and bounded phrase search. It requires `data` scope and `allowDataPreview`,
checks every table against existing blocklists, uses the current SAP identity and cumulative
request budgets, and redacts business content/keys from audit sinks. It is hidden when data preview is
disabled or BTP is selected/discovered; authenticated listings also prune denied/scopeless actions. The implementation remains
strict about its qualified profile and never falls back to RFC, free SQL, or helper installation.

The manual adapter already shares the caller's cumulative response/admission scope, cancellation,
and identity, checks every table through existing safety gates, and caps each session at 120
queries/60 seconds. Batches cap keys at 25 and decoded results at 2 MiB/10,000 lines. Discovery caps
headers at 50 and search caps matches at 50. Large inputs can exhaust the existing response allowance
before reaching these counts. Tests cover blocked tables, disabled data preview, cancellation,
inherited scope, request limits, semantic failures, and response accounting.

Public dispatch passed discovery/read/batch/search on 758 and 816 with writes/free SQL disabled;
750 returned an explicit unsupported-platform error for the missing preview endpoint. Preserve honest
consistency and integrity claims: matching rereads are change detection, not a transaction snapshot;
compressor trailers are bounded but not authenticated. Get independent fixtures before expanding
versions/code pages or persistence. Keep the companion option in #1000 for broader form/API semantics.

## Earlier spike validation

The stored-text focused suites have 128 tests: SAP golden fixtures, fixed-width text fidelity, malformed headers,
unsupported profiles, truncation, output/line/input limits, decompression expansion, lone UTF-16
surrogate preservation, structural state errors, trailer bounds, 1,000 deterministic corruption
probes, chunk-window boundaries, identity/sequence validation, literal quoting, and the existing
data-preview/free-SQL safety gates, header/reference semantics, discovery, cumulative budgets, and
sanitized semantic goldens. Three additional core tests cover opt-in literal encoding and prefix
escaping. The stricter final parser was also replayed against all 211 successful private corpus captures.

At the manual-spike checkpoint, typecheck, build, lint, policy validation, and size/schema-budget checks passed. The full suite passed
with four workers: **317 files / 9,054 tests**. The initial phase's unconstrained run had four timing failures
in existing CLI/shutdown subprocess tests; all 54 tests in those two files passed when rerun alone,
and the subsequent full runs passed. That checkpoint changed no MCP tool-schema snapshot and registered
no new operation. The later production `long_text` integration changes the exposed schema; its final
validation and model evidence are recorded in the [integration report](2026-10-17-stored-text-integration-evals.md).
