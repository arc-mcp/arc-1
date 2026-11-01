# Stored-text research probes

The production entry point is [SAPQuery `long_text`](../../../docs_page/tools.md#stored-sapscript-long-texts).
These manual probes reuse the production decoder and chunk assembly in `src/adt/stored-text/`.
`reader.ts` retains a raw codec-comparison loop; `texts.ts` and public probes use production sessions.
See the [design and qualification report](../../../docs/research/2026-10-17-stored-text-integration-evals.md)
for supported profiles, SAP semantics, evidence, and remaining limits. MIT attribution is in [NOTICE](NOTICE).

## Offline checks

Use the repository's supported Node version (the investigation used Node 24.19.0):

```sh
npm ci
npx vitest run tests/unit/spikes tests/unit/handlers/long-text.test.ts
npm run typecheck
```

`tests/fixtures/stxl/` contains synthetic SAP EXPORT data and independent native expectations from
750/758/816. No existing business texts or SAP standard source are committed.

## Live setup

Supply `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, and `TEST_SAP_CLIENT` through your
approved secret loader. HTTPS with certificate verification is required. Set a label and private
output directory:

```sh
export STXL_SYSTEM_LABEL=758
export STXL_OUTPUT_DIR="$(mktemp -d /tmp/arc1-stxl-XXXXXX)"
npx tsx scripts/spikes/stxl/probe.ts
```

Files use mode 0600 and newly created directories use 0700. Keep captures private. These scripts
create an isolated client with data preview enabled; they do not change a deployed server's settings.
The default has helper execution, writes, and free SQL disabled.

## Read-only probes

| Script | Purpose / prerequisite |
|---|---|
| `probe.ts` | Check ADT extraction; `STXL_PREVIEW_MODE=ddic` checks the alternative preview route. |
| `texts.ts` | Discover, read, batch, or search saved texts; examples below. |
| `integration-live.ts` | Public MCP read/discover/batch/search. Needs the private English corpus oracle on 758/816; checks unsupported capability on 750. |
| `prefix-live.ts` | Public prefix edge cases. Empty matches prove accepted syntax, not positive matching. |
| `prefix-existing-live.ts` | Positive spaced-name match using the private corpus oracle. |
| `corpus.ts` with `STXL_REUSE_ORACLE=true` | Compare current reads with a previously captured native oracle. |

```sh
npx tsx scripts/spikes/stxl/texts.ts discover --object TEXT --prefix Z_ --language E
npx tsx scripts/spikes/stxl/texts.ts read --object TEXT --name Z_EXAMPLE --id ST --language E
npx tsx scripts/spikes/stxl/texts.ts batch --keys /private/text-keys.json
npx tsx scripts/spikes/stxl/texts.ts search --keys /private/text-keys.json --phrase 'delivery instructions'
```

The key file is an array such as `[{"TDOBJECT":"TEXT","TDNAME":"Z_EXAMPLE","TDID":"ST","TDSPRAS":"E"}]`.
Use exact discovered keys; preserve case/spaces and one-character SAP languages. Outputs are saved
privately as `<label>-texts-<command>.json`; the terminal shows status. Production key/batch/search
limits also apply here. Header and byte rereads detect observed changes, not a transaction snapshot.

## Native oracles — disposable test systems only

`STXL_ALLOW_HELPERS=true` explicitly enables creating, activating, executing, and deleting unique
`$TMP` classes. `roundtrip.ts` and `semantics-live.ts` also create synthetic texts and verify cleanup.
This test setup is separate from the read-only production feature.

```sh
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/kernel-fixtures.ts
npx tsx scripts/spikes/stxl/check-kernel-fixtures.ts "$STXL_OUTPUT_DIR/$STXL_SYSTEM_LABEL-kernel-fixtures-output.txt"
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/unicode-edges.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/corpus.ts
STXL_ALLOW_HELPERS=true STXL_CORPUS_LANGUAGE=E npx tsx scripts/spikes/stxl/corpus.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/roundtrip.ts
STXL_ALLOW_HELPERS=true npx tsx scripts/spikes/stxl/semantics-live.ts
```

The tested 750 system lacks the preview endpoint. Its kernel/legacy-corpus oracles additionally
need `STXL_LEGACY_GET_CLASSRUN=true`. GET still executes ABAP and remains write-gated; it is not a
production fallback. On interruption or cleanup failure, inspect saved lifecycle records and remove
only the identified disposable objects/texts. Never use existing business keys as writable fixtures.

## Historical SQL probes

`read-text.ts` reads a low-level cluster identified by the `STXL_TEXT_KEY` JSON environment value;
prefer `texts.ts` for header/reference semantics. Its historical alternative needs
`STXL_ALLOW_FREE_SQL=true STXL_QUERY_ROUTE=sql`. `prefix-expressions-live.ts` also requires explicit
free-SQL opt-in and compares synthetic constants; one expanded case fails on 816, as recorded in
the report. Neither SQL probe is used by the production reader.
