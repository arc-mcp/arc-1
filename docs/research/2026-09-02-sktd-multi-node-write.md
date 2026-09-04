# SKTD/KTD multi-node writes — wire format, root cause, and fix

Date: 2026-09-02. Systems referenced: an S/4HANA PCE 2025.1 system and an on-prem A4H trial system (SAP_BASIS 816).

Confidence markers used throughout:

- `[V]` verified against SAP documentation or an authoritative in-repo capture
- `[E]` verified empirically in this session against a live system
- `[I]` inference, not yet confirmed — do not build on it without evidence

## 1. Symptom

`SAPWrite(type="SKTD", action="update", name="<parent>", source="<markdown>")` against an object
whose KTD documents several nodes updates **only one node**, regardless of the Markdown structure
supplied. Reported against BDEF `ZI_TravelTP`.

## 2. The envelope `[E]`

`GET /sap/bc/adt/documentation/ktd/documents/<name-lowercased>` with
`Accept: application/vnd.sap.adt.sktdv2+xml` returns a single `<sktd:docu>` document. Full raw
capture of `ZI_TravelTP` taken 2026-09-02; the shape below is verbatim, not reconstructed.

```xml
<sktd:docu adtcore:responsible="DEVELOPER" adtcore:masterLanguage="EN" adtcore:masterSystem="S4H"
           adtcore:abapLanguageVersion="cloudDevelopment" adtcore:name="ZI_TRAVELTP"
           adtcore:type="SKTD/TYP" adtcore:version="active" …
           xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core">
  <atom:link href="versions" …/>
  <adtcore:packageRef adtcore:uri="…" adtcore:type="DEVC/K" adtcore:name="ZTRAVEL"/>
  <sktd:refObject adtcore:uri="…" adtcore:type="BDEF/BDO" adtcore:name="ZI_TRAVELTP"/>

  <sktd:element sktd:canHaveDocumentation="true" sktd:notAssigned="false"
                sktd:longTextObligation="optional|mandatory" sktd:displayName="finalize"
                sktd:collapseNode="false">
    <sktd:id>…</sktd:id>
    <sktd:text>BASE64, line-wrapped at 76 chars</sktd:text>   <!-- or <sktd:text/> when undocumented -->
    <adtcore:objectReference adtcore:uri="…" adtcore:type="BDEF/BSO" adtcore:name="finalize"/>
    <sktd:parent>…</sktd:parent>                              <!-- <sktd:parent/> on the root -->
    <sktd:shortText sktd:text="BASE64" sktd:obligation="optional|forbidden"/>
    <atom:link rel="…/elementinfo" …/>
  </sktd:element>
  …
  <sktd:instruction sktd:instructionId="bo" sktd:instructionText="Describe important aspects …"/>
  <sktd:instruction sktd:instructionId="shorttext" sktd:instructionText="Provide a meaningful short text with 60 characters max."/>
</sktd:docu>
```

Settled by the capture — these were open questions before it:

- **Child order inside `<sktd:element>`** is `id → text → objectReference → parent → shortText → link`.
- **`shortText` is an attribute, not element text**: `<sktd:shortText sktd:text="BASE64"
  sktd:obligation="…"/>`, self-closing. The 60-character limit is stated by the `shorttext`
  `<sktd:instruction>` at the end of the document, not by a schema facet.
- **`<sktd:text>` Base64 is line-wrapped at 76 characters.** Decoding is unaffected (Node's
  `Buffer.from(s, 'base64')` ignores the newlines) and re-encoding unwrapped is accepted — that is
  what ARC-1's single-node write has always produced.
- **SAP pre-creates one `<sktd:element>` per documentable element**, with an empty self-closing
  `<sktd:text/>` until someone documents it. `ZI_TravelTP` carries ~80 elements of which 12
  hold text. **Nothing ever needs to synthesize an `<sktd:element>`.**
- **How many elements SAP pre-creates is per object type.** A BDEF gets the full behaviour tree
  (verified twice: ~80 on `ZI_TravelTP`, and 5 — root + `BAE` + `BSO` create/update/delete — on
  a freshly built managed BDEF on 816). A `DDLS/DF` view entity gets **only the root node**; its
  fields are not documentable nodes. The POST response to a KTD *create* carries no `<sktd:element>`
  at all — the elements appear on the subsequent GET.

### Node ids

| Node | `<sktd:id>` shape |
|------|-------------------|
| Object root | the object name — `ZI_TRAVELTP` |
| Every other node | the ADT fragment URI — `/sap/bc/adt/…/source/main#type=BDEF/BAT;name=%25_OWN` |

### BDEF node subtypes present

`BAT` authorization context · `BAE` entity · `BSO` savers **and** standard operations
(`create`/`update`/`delete`) · `BAF` **functions** · `BAC` **actions** · `BAS` associations ·
`BSA` create-by-association.

> **Two corrections to earlier statements in this investigation.** An intermediate finding, taken
> from `SAPRead` output rather than the raw envelope, claimed that the functions bucket is `BAF`
> "not `BAC`", and that `BAC`/`BAS`/`BSA` were absent. The capture shows both halves were wrong:
> `BAC` is a real, distinct subtype used for **actions** (`SetPhoto`, `PriorityTop`, `RankUp`, …),
> and `BAS`/`BSA` are present too. They looked absent only because every one of those nodes is
> undocumented and `decodeKtdText` hides empty nodes (see §6). `BAF` is correct for functions, so
> `ReadTravelSummaryHTML` is `BDEF/BAF` — but not because `BAC` does not exist.

## 3. Root cause `[E]`

`rewriteKtdText` in `src/adt/ddic-xml.ts` was single-target by construction, in two ways:

1. **Non-global regex.** `const textPattern = /(<sktd:text[^>]*>)([\s\S]*?)(<\/sktd:text>)/;` has no
   `g` flag, and `String.prototype.replace` with a non-global RegExp replaces only the **first**
   match. In an N-element envelope only element #1 was ever written.
2. **No inverse of the reader.** `decodeKtdText` renders a multi-node KTD as `## <node id>` sections,
   but nothing parsed those sections back apart. The *entire* multi-section Markdown blob — headings
   included — was Base64-encoded into that one element.

So the observed behaviour was not merely "the other nodes are ignored": a read → edit → write
round-trip **overwrote the root node with the whole document** and silently discarded every other
node's edit. The write path is otherwise correct — `safeUpdateObject` (`src/adt/crud.ts:335`) already
does `lock → PUT → unlock` in a `try/finally` inside a stateful session, so locks are released even
when the PUT fails.

Reproduced by unit test before the fix: 6 failing assertions in
`tests/unit/adt/ddic-xml.test.ts > SKTD helpers`, 11 pre-existing single-node assertions still green.

### What the Bruno collection actually shows `[E]`

A Bruno collection kept in the maintainer's workspace, outside this repo, is **not** a verified working
multi-node write. Its own `README.md` and request docs state:

- it is a *reconstruction*, not a wire capture;
- `/source/main`, the PUT verb, and the `Content-Type`/`Accept` on the write are
  **"INFERRED, NOT CONFIRMED"**;
- the write landing on the root node only was **"VERIFIED (this session, reproduced 3x)"**.

That collection therefore documents the bug, not a fix. It also disagrees with what ARC-1 really
sends: Bruno PUTs `text/plain` to `<ktdPath>/source/main`, whereas ARC-1 PUTs the full
`<sktd:docu>` envelope as `application/vnd.sap.adt.sktdv2+xml` to `<ktdPath>` with no sub-path.
Treat the Bruno requests as a hypothesis log, not as the contract.

## 4. The fix

`rewriteKtdText` is now the exact inverse of `decodeKtdText`:

- A line is a node boundary **only** when it is `## ` followed by the *exact* id of an element in
  this envelope. Ordinary Markdown headings inside a node's text survive untouched.
- Each addressed section is Base64-encoded and spliced into that element's `<sktd:text>`, including
  the self-closing `<sktd:text/>` of a node nobody has documented yet. Elements the body does not
  address stay byte-identical, so a partial update is safe.
- A body that addresses no node is written to the single documented node when there is exactly one
  (this is precisely what the reader rendered), or to the root node when nothing is documented yet
  (fresh `create`). With **more than one** documented node it is refused with an error listing the
  valid ids, instead of silently overwriting the root.
- A heading that is unmistakably an ADT node id (`/sap/bc/adt/…`, or containing `#type=`) but names
  no element in the envelope is refused, naming the node and listing the valid ids. The test is
  narrow so a path-shaped prose heading like `## /notes/package layout` stays body content.

ARC-1 still never constructs an `<sktd:element>`; it only rewrites `<sktd:text>` inside elements SAP
returned. Given §2, nothing more is needed. `<sktd:shortText>` is left untouched — writing it would
need a separate parameter, since it is an attribute and not part of the Markdown body.

No tool-schema change: nodes are addressed through the Markdown the reader already produces, so
`SAPRead → edit → SAPWrite` round-trips and the single-node call sites are untouched. The
`tests/fixtures/tool-definitions/*.json` LLM surface is unchanged.

### Hardening from the adversarial review (2026-09-02)

A 7-dimension review with 3-lens adversarial verification (120 agents) upheld 13 of 37 findings.
Applied:

- **Node ids match case-insensitively**, resolving to the envelope's own spelling. The root id is
  upper-cased on the wire (`ZI_TRAVELTP`) while every other id spells the object
  `ZI_TravelTP`; a heading in the second spelling used to be folded silently into the previous
  node's text. Case collisions keep the first spelling, never the other element.
- **Empty bodies are refused** regardless of node count — a bodyless `update` used to erase a
  single-node KTD. Clearing one node stays possible by addressing it with an empty section.
- **`create` + `source` reports partial success honestly.** The POST runs before the body is
  validated, so a refused body now says the KTD exists and points at `action="update"`, instead of
  inviting a create retry that 409s.
- **Every unknown heading is listed**, not only the first; the preamble refusal names the node the
  stray text would have joined; the `<sktd:text>` splice is one helper shared by both paths.
- Tests: the headline regression now asserts `decodeKtdText(rewritten) === markdown` (a
  body-rotation mutant passed every previous assertion); the three guard branches and the
  mixed valid+unknown heading case are covered; and `tests/unit/handlers/write-ddic.test.ts`
  gained a two-node handler test plus the create-with-source refusal — a mutant writing every
  body into `elements[0]` (the original bug verbatim) had left the handler suite green.

Rejected after verification, with the reason recorded: forcing the write's `getKtd()` to
`version: 'active'` so it matches `SAPRead`'s default — that would make consecutive draft writes
revert to the active version and lose the earlier draft (the accumulate behaviour is
live-verified and desirable); the code comment at the call site now states this. Also rejected:
capping the id list in errors (it is the only discovery channel for undocumented nodes), a
quote-aware element regex (unreachable input, and the proposal swallowed the next element),
duplicate-`<sktd:id>` handling (ADT's own addressing scheme forbids it), and making `source`
required in the Zod schema (touches the frozen tool surface for a case the runtime guard covers).

## 5. Verification status

| Check | Result |
|-------|--------|
| `npx vitest run tests/unit/adt/ddic-xml.test.ts -t "SKTD"` | 23 passed `[E]` |
| …of which, against the verbatim wire capture | 3 passed, **no code change needed** `[E]` |
| `npm test` | 5387 passed; 9 failures in 5 files, all pre-existing and environment-caused `[E]` |
| `typecheck`, `biome`, `check:sizes`, tool-schema budget, `validate:policy`, `build` | all green `[E]` |

The 9 pre-existing failures (`cache/sqlite`, `server/sinks/file`, `server/deny-actions`,
`helpers/skip-discipline`, `cli/runtime`) were confirmed failing on a clean `git stash` of this
change; they stem from POSIX file-mode assertions on Windows and from installing with
`--ignore-scripts` (no `better-sqlite3` native binary). None touch KTD code.

### Live end-to-end verification `[E]`

Run 2026-09-02 against the on-prem trial system (A4H, SAP_BASIS 816) through an MCP server
repointed at this working tree. Test bed built in `$TMP`: table `ZARC1_KTD_TAB`, root view
`ZARC1_KTD_ROOT`, behaviour pool `ZBP_ARC1_KTD_ROOT`, BDEF `ZARC1_KTD_ROOT` (5-node KTD), plus
`ZARC1_KTD_TEST` (DDLS, 1-node KTD).

| # | Check | Result |
|---|-------|--------|
| 1 | Running build is this tree, not the installed one — probed by addressing a bogus node id, which the new code refuses **before** taking a lock | new error returned ✓ |
| 2 | Single-node KTD, body with no heading (back-compat) | written and read back verbatim ✓ |
| 3 | `## <root id>` consumed as an address, while a following `## Not a node id` stayed body prose | ✓ |
| 4 | **Three nodes written in one call**, each with its own text | all three distinct on read-back ✓ |
| 5 | **A fourth node written in a separate call** | the earlier three survived untouched ✓ |
| 6 | Unaddressed blob over a 4-node KTD | refused, listing the 4 valid ids ✓ |

Checks 4–6 are the reported bug and its guard. Under the old code, check 4 would have Base64'd the
whole three-section document into node #1 and check 6 would have silently overwritten the root.

### The production scenario, rehearsed on the real object `[E]`

The on-prem trial system also carries `ZI_TravelTP`, with the same 13-node KTD as the PCE system, so
the actual target case was run end to end there rather than only on a synthetic BO:

- Wrote **only** the previously undocumented `…#type=BDEF/BAF;name=ZI_TravelTP.ReadTravelSummaryHTML`
  node, addressed by id, under an open transport request.
- Read back: **14 nodes** — the 13 pre-existing ones unchanged, plus the new one.
- Activated; the **active** version confirms all 14.

Incidental findings, none of them caused by this change and none fixed here:

1. The merge base returned by `client.getKtd()` already includes the pending inactive draft, so
   consecutive writes without an intervening activation accumulate rather than reverting to active.
2. `SAPWrite` rejects a mixed-case object name (`ZI_TravelTP`) that `SAPRead` accepts, so the
   same name string cannot be reused between the two calls.
3. A KTD in a transportable package needs an explicit `transport`: the ADT lock returns no `corrNr`,
   so the PUT fails with "Parameter corrNr could not be found" until one is passed.

The `$TMP` test objects (`ZARC1_KTD_TAB`, `ZARC1_KTD_ROOT` view/BDEF/behaviour pool, `ZARC1_KTD_TEST`)
were left in place for inspection; they are disposable.

## 6. Discovering undocumented nodes (follow-up, resolved)

`decodeKtdText` drops elements whose `<sktd:text>` is empty, so on its own `SAPRead(type="SKTD")`
showed only the documented nodes — on `ZI_TravelTP` that hid ~68 of ~80 writable nodes, and
the only way to learn an id was to provoke the write's refusal error.

Resolved in `read.ts` without touching the reader/writer inverse pair: `formatKtdUndocumentedIndex`
appends a compact index after the Markdown, only on `SAPRead` (not on the KTD block `SAPContext`
prepends, and not in `grep` results). Listing ~68 full ids would cost ~10 KB, so the index exploits
the id shape instead — the root id is the object name and every other id is
`<base>#type=<TYPE>;name=<NAME>` with one `<base>` per document — and groups the names under their
base and type:

```
Undocumented nodes: 68. SAP pre-created them with empty text; document one by adding a "## <id>" …
base: /sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main
BDEF/BAE (9): ZI_TravelBookingTP, ZI_TravelSupplementTP, …
BDEF/BAC (14): ZI_TravelTP.SetPhoto, ZI_TravelTP.DeletePhoto, …
```

Every id is reconstructible exactly (the index is produced by splitting real ids on the first
`#type=` and `;name=`, never by synthesis). Roughly 2–3 KB on the largest live object, and nothing at
all when every node is documented.

Found along the way, but pre-existing and unrelated to KTDs, so fixed on its own branch:
`SAPRead(type="CLAS", method="lhc_x~method")` never found class-local methods because the method
path read only `source/main` — see `docs/research/2026-09-02-sapread-method-local-class-include.md`.
