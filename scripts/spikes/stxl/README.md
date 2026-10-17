# STXL TypeScript spike

Research scripts and compatibility exports for the production reader in `src/adt/stored-text/`.
The MCP entry point is [SAPQuery `action="long_text"`](../../../docs_page/tools.md#sapquery).
The reader uses guarded ADT table queries, then a bounded TypeScript parser and Node's built-in
zlib. It requires no RFC, SAP SDK, Python, AMDP, or installed ABAP companion.

Verified profile: **FF06 / code page 4103 / little-endian / flat TLINE**, compressed CS_LZH or
uncompressed EXPORT data. Other versions/code pages are rejected. It reads stored text lines;
it does not implement the full semantics of `READ_TEXT` or render SAPscript/SmartForms.

See [research and live evidence](../../../docs/research/2026-10-17-stxl-typescript-spike.md),
[READ_TEXT semantics](../../../docs/research/2026-10-17-stxl-read-text-semantics.md), and
[use cases and discovery guidance](../../../docs/research/2026-10-17-stxl-use-cases.md).

## Usable stored-text workflow

`texts.ts` provides discovery, single reads, ordered batches, and phrase search over supplied keys.
It uses the existing **data-preview gate with free SQL disabled**. It checks the configured object,
ID, language, and default persistence handler; distinguishes missing headers from valid empty texts;
and follows up to eight same-language references stored in STXH. Results contain the requested and
resolved keys, root stored header, reference path, ITF lines, and explicit warnings/errors.

After configuring the environment described below:

```sh
npx tsx scripts/spikes/stxl/texts.ts discover --object TEXT --prefix Z_ --language E
npx tsx scripts/spikes/stxl/texts.ts read --object TEXT --name Z_EXAMPLE --id ST --language E
npx tsx scripts/spikes/stxl/texts.ts batch --keys /private/text-keys.json
npx tsx scripts/spikes/stxl/texts.ts search --keys /private/text-keys.json --phrase 'delivery instructions'
```

The key file is a JSON array, for example:

```json
[{"TDOBJECT":"TEXT","TDNAME":"Z_EXAMPLE","TDID":"ST","TDSPRAS":"E"}]
```

Use exact keys discovered in your system. `E`/`D` are internal SAP language keys; `EN`/`DE` are
rejected. Leading/internal spaces matter. Prefixes are literal, including `%`, `_`, and `#`.
Discovery returns at most 50 headers and a `more` flag; narrow the prefix when it is true. It does
not provide stable pagination. Batches accept 1–25 keys and preserve order and duplicates. Search
is case-sensitive, scans only that supplied batch, and returns at most 50 matching lines.

Outputs are saved privately as `<label>-texts-<command>.json`; terminal output contains status only.
The session shares the caller's response/admission budget, uses a 60-second timeout and a 120-query
cap, and keeps the default 2 MiB cumulative response allowance. Those bounds may stop a batch before
25 keys, particularly for large texts. Decoded batch output is also limited to 2 MiB/10,000 lines.
Header and cluster rereads detect observed changes; `snapshotGuaranteed: false` remains explicit.

The manual CLI remains useful for research; production MCP calls use `SAPQuery(action="long_text")`.
Both reject custom persistence,
legacy ITCRF reference containers, and non-ITF/STXB text. Memory, archives, upgrade stores,
SAPscript INCLUDE expansion, and rendering remain outside the contract.

Production entry points are deliberately separate: `src/adt/stored-text/key.ts` validates identities,
`source.ts` handles guarded extraction/session budgets, `reader.ts` handles semantics, and
`decoder.ts` parses binary containers. The spike files re-export these modules; `texts.ts` handles
the manual CLI. `integration-live.ts` verifies the public dispatch path with read-only requests.
No reader executes ABAP.

## Offline validation

Use the repository's supported Node version; this investigation used Node 24.19.0.

```sh
npm ci
npx vitest run tests/unit/spikes
npm run typecheck
```

`tests/fixtures/stxl/` contains only synthetic SAP-generated EXPORT data from releases
750, 758, and 816. Expected SHA-256 values come from the independently returned ABAP TLINE
table, normalized by removing fixed-width ASCII space padding. Small plain fixtures are also
included. The ABAP generator asserts kernel IMPORT round-trip equality before returning data.
The semantic fixtures separately preserve synthetic native READ_TEXT results on 758/816 for
normal, blank, empty, missing, referenced, and non-ITF texts.

## Live reproduction

Provide `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, and `TEST_SAP_CLIENT` through
the environment or your approved secret loader. TLS verification is required. Never commit
credentials, existing text captures, or SAP standard source code.

```sh
export STXL_SYSTEM_LABEL=758
export STXL_OUTPUT_DIR="$(mktemp -d /tmp/arc1-stxl-XXXXXX)"
npx tsx scripts/spikes/stxl/probe.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/kernel-fixtures.ts
npx tsx scripts/spikes/stxl/check-kernel-fixtures.ts "$STXL_OUTPUT_DIR/$STXL_SYSTEM_LABEL-kernel-fixtures-output.txt"
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/unicode-edges.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/corpus.ts
STXL_ALLOW_HELPERS=true STXL_CORPUS_LANGUAGE=E npx tsx scripts/spikes/stxl/corpus.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/roundtrip.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/semantics-live.ts
```

`probe.ts` reads STXL through ADT. Set `STXL_PREVIEW_MODE=ddic` to check the alternative DDIC
preview endpoint. The isolated client enables data preview; it does not change a deployed MCP
server's settings. `reader.ts` itself never changes a caller's safety configuration.

The original low-level decoder probe remains available for exact STXL extraction without header
semantics. Prefer `texts.ts` above for a complete classic stored-text read:

```sh
export STXL_TEXT_KEY='{"TDOBJECT":"TEXT","TDNAME":"YOUR_TEXT","TDID":"ST","TDSPRAS":"E"}'
npx tsx scripts/spikes/stxl/read-text.ts
# Historical research alternative; the newer texts.ts handles these keys through the data gate:
STXL_ALLOW_FREE_SQL=true STXL_QUERY_ROUTE=sql npx tsx scripts/spikes/stxl/read-text.ts
```

Decoded lines are saved privately as `<label>-read-text.json`, not printed to the terminal.

The oracle scripts require a non-production system and explicit `STXL_ALLOW_HELPERS=true`.
They create, activate, execute, and delete uniquely named `$TMP` classes. `roundtrip.ts` also
creates one unique synthetic standard text, compares its 37 STXL chunks with the oracle, then
deletes it and verifies absence from STXH/STXL. This write capability belongs only to test
setup/cleanup. The candidate reader is read-only.
`semantics-live.ts` creates unique synthetic texts, compares native READ_TEXT/READ_TEXT_TABLE with
the TypeScript pipeline, then deletes its fixture keys and verifies absence from STXH/STXL/STXB.

On the tested 750 system the data-preview endpoints returned 404. Kernel validation still works:

```sh
STXL_ALLOW_HELPERS=true STXL_LEGACY_GET_CLASSRUN=true npx tsx scripts/spikes/stxl/kernel-fixtures.ts
STXL_ALLOW_HELPERS=true STXL_LEGACY_GET_CLASSRUN=true npx tsx scripts/spikes/stxl/legacy-corpus.ts
```

That explicit legacy switch follows the inspected SAP 750 `CL_OO_ADT_RES_CLASSRUN~GET` contract.
GET still executes ABAP and retains the helper opt-in and mutation safety gate. It is not a
read-only fallback. The class name must be uppercase on this backend.

Artifacts use mode 0600 in a directory created with mode 0700. Keep the output directory private.
If a process is terminated or cleanup fails, consult the saved helper source/lifecycle files and
remove only the identified disposable class/text after checking its identity. Reusing a cached
oracle (`STXL_REUSE_ORACLE=true`) is an explicit test convenience, not a production cache.

## Limits and unresolved integration work

- 2 MiB compressed input, 4 MiB decompressed container, 10,000 lines; callers can only narrow limits.
- At most eight bounded SRTF2 windows (INT1 counters 0–255); each read preserves the ARC-1 table data safety gate.
- Requires full 7,902-byte CLUSTD hex cells and uses CLUSTR for meaningful lengths. Rejects mixed
  identities, missing/duplicate chunk numbers, malformed hex, and partial intermediate chunks.
- Multiple requests do not establish a transactional snapshot. Compression has no verified
  integrity check; valid mutations or opaque trailing compressor bytes are not authenticated.
  The decoder rejects compressed tails over six bytes, the maximum observed in this corpus;
  shorter opaque tails are reported as `compressedTrailingBytes`, not semantically validated.
- ABAP CHAR truncation can leave lone UTF-16 surrogates. Code units are preserved and reported
  with `wellFormedUnicode: false`. Use JSON serialization to retain these units; ordinary UTF-8
  encoding of the raw string would replace them. `unicode-edges.ts` checks raw TLINE bytes against
  kernel IMPORT, including NUL, U+FFFF, trailing tabs and non-ASCII spaces.
- SAP 816's SQL-line CONDENSE changes repeated spaces inside ordinary quoted keys. The new adapter
  opts into a literal-preserving `CONCAT_WITH_SPACE` encoding in the guarded table-query builder;
  both 758 and 816 pass with free SQL disabled. Existing callers retain their default SQL shape.
- Production integration must retain data scope, table blocklists, per-user identity, shared
  response/time budgets, and audit behavior. The public extension facade currently does not
  expose the guarded `runTableQuery` method.

The MIT container reference is attributed in [NOTICE](NOTICE). No GPL implementation was copied.
