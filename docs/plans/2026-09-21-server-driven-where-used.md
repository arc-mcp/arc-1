# Server-driven where-used routing — #809

## Root cause

`SAPNavigate(references, type, name)` resolves the object URI in `resolveWhereUsedUri` before
calling the shared where-used engine. Server-driven objects are registered in
`src/adt/server-driven.ts`, but `objectBasePath()` has no case for them, so its deliberate
unknown-type arm maps them to `/sap/bc/adt/programs/programs/<name>`. That URI is syntactically
valid, so SAP answers HTTP 200 with an empty reference list and the routing error reads as "this
object has no references". Explicit `uri` navigation and search-resolved `SAPContext` usages do not
take that path.

Options considered:

- Search the object before navigating — extra SAP round trips and ambiguity when the registered
  collection is already known.
- Teach `objectBasePath()` the registry hrefs — the right long-term shape, but it changes URL
  resolution for `SAPTransport`, `SAPDiagnose` and the ATC batch resolver too, each of which needs
  its own live verification. Deferred as roadmap **ARCH-02**; this PR stays on the reported defect.
- Dispatch on the existing registry inside `resolveWhereUsedUri` — one guard, one return, the same
  encoded URL builder that server-driven reads, writes and activation already use. Chosen; it
  mirrors the guards already present in `write.ts` and `activate.ts`.

## Change

Four lines in `src/handlers/where-used.ts`, plus a registry-derived regression in
`tests/unit/handlers/search-navigate.test.ts` that drives the public `SAPNavigate` dispatch for
every `SDO_TYPES` entry and one mixed-case namespaced name (encoding + normalization).

## Validation

- **Live, SAP S/4HANA 2023, SAP_BASIS 758 SP02, client 001, Basic over HTTPS, read-only.**
  `findWhereUsed` on the two existing scalar functions:

  | Object | `/programs/programs/<name>` | `/ddic/dsfd/sources/<name>` |
  |---|---|---|
  | `CALENDAR_OPERATION` | 0 entries | 5 entries |
  | `RATIO_OF` | 0 entries | 5 entries |

  Neither lookup used the old-endpoint fallback. The real handler
  (`SAPNavigate {action: references, type: DSFD, name: CALENDAR_OPERATION}`, built CLI) returns the
  same five. Those five are **reference entries**, not five code callers: one `DSFI/SFI`
  implementation, one `SKTD/TYP` documentation node and three `DEVC/K` package nodes.
  The earlier contributor evidence on 816 remains valid for that release; this turn tested 758.
- The ten regression cases fail against `origin/main`'s resolver and pass with the fix. Full
  `npm test`, typecheck, build, lint (two pre-existing informational notices), `validate:policy`,
  `check:sizes` and strict MkDocs pass.
- No SAP object was created or modified. This is live handler/ADT evidence, not an installed MCP
  client session.

## Roadmap

Adds **ARCH-02** (P2 / S / Ready): the same fallback still mis-routes server-driven types in
`SAPTransport` (`check`, `history`) and single-object `SAPDiagnose` (`syntax`, `atc`, `unittest`).
The ATC batch resolver uses the same helper, but the public `ATC_BATCH_TYPES` allowlist rejects
server-driven types before dispatch; a direct `SAPDiagnoseSchema.safeParse` check with a DSFD
batch confirms rejection. It is not a currently exposed batch-routing defect.
Confirmed live on 758 — `SAPTransport(history, DSFD, CALENDAR_OPERATION)` returns an
empty result whose echoed `uri` is the program path, and `SAPDiagnose(syntax, DSFD, …)` reports
"The REPORT/PROGRAM statement is missing". Does not implement ARCH-01's general discovery resolver.
