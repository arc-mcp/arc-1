# SKTD/KTD multi-node writes — wire format, root cause, and fix

Researched 2026-09-02; independently rechecked 2026-09-04 on SAP_BASIS 7.58 and 8.16.

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

### Independent contract witnesses `[V]`

The live shape was rechecked against SAP's Eclipse ADT implementation, not inferred from ARC-1:

- `~/DEV/arc-1-eclipse-adt/api/18-ktd-documentation.md` records workbench type `SKTD/TYP`, the
  `/sap/bc/adt/documentation/ktd/documents` collection, and v2 media type.
- `~/.p2/pool/plugins/com.sap.adt.ktd_3.60.3.jar` defines the document/element model and the same
  element child ordering used by the byte-preserving splice.
- `~/DEV/mcp-abap-adt-fr0ster/docs/adt-discovery.xml` independently records the v2 collection,
  lock/version/action templates, and KTD element-info endpoints.

No reference implementation exposes a different multi-node writer. The safe operation is therefore
to update only text fields inside the complete envelope returned by SAP, never to synthesize nodes.

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

## 4. The fix

`rewriteKtdText` consumes the exact-ID section format emitted by `decodeKtdText`:

- A line is a node boundary **only** when it is `## ` followed by the *exact* id of an element in
  this envelope (case-insensitive ABAP spelling). That exact heading form is reserved routing
  syntax; other Markdown headings inside a node's text survive untouched.
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

### Safety decisions

- **Node ids match case-insensitively**, resolving to the envelope's own spelling. The root id is
  upper-cased on the wire (`ZI_TRAVELTP`) while every other id spells the object
  `ZI_TravelTP`; a heading in the second spelling used to be folded silently into the previous
  node's text. Case collisions keep the first spelling, never the other element.
- **Empty bodies are refused** regardless of node count — a bodyless `update` used to erase a
  single-node KTD. Clearing one node stays possible by addressing it with an empty section.
- **`create` + `source` reports partial success honestly.** The POST runs before the body is
  validated, so a refused body now says the KTD exists and points at `action="update"`, instead of
  inviting a create retry that 409s.
- **Every unknown ADT-shaped heading is listed**, not only the first; the preamble refusal names
  the node the stray text would have joined.
- The write-side GET intentionally does not force `version: 'active'`: SAP then returns the current
  working-area envelope and consecutive pre-activation writes accumulate instead of reverting to
  the last active version.
- `SAPRead` puts its empty-node index and version/cache annotations after the exact reserved
  `KTD_META_MARKER`. `SAPWrite` strips that context and refuses a heading appended below it, so
  read-only text cannot be folded into the last node body or silently discard a new section.

## 5. Verification status

| Check | Result |
|-------|--------|
| `npx vitest run tests/unit/adt/ddic-xml.test.ts tests/unit/handlers/read.test.ts tests/unit/handlers/write-ddic.test.ts` | 356 passed `[E]` |
| …of which, against the verbatim wire capture | passed, including line-wrapped Base64 and self-closing text `[E]` |
| `npm test` | 190 files, 5,725 tests passed `[E]` |
| `typecheck`, Biome, size/schema budget, action policy, build, strict docs build | green `[E]` |

The first full-suite run had one unrelated IPv6 rate-limit test receive a transient 404. The same
file passed twice in isolation (36/36 each), and the complete suite then passed on a clean rerun.

### Live end-to-end verification `[E]`

`tests/e2e/sktd-write.slow.e2e.test.ts` was run independently against both supported test releases
on 2026-09-04. Each run created a disposable `$TMP` table, root DDLS, behavior pool, managed BDEF,
and five-node KTD, then deleted every object in reverse dependency order.

| Check | SAP_BASIS 7.58 | SAP_BASIS 8.16 |
|---|---:|---:|
| Create and activate RAP/BDEF/KTD stack | passed | passed |
| Write `create` and `update` KTD nodes in separate calls | passed | passed |
| Preserve root and the earlier draft across the second call | passed | passed |
| Read the inactive multi-node document and its empty-node index | passed | passed |
| Paste that exact read result back; strip marker/index | passed | passed |
| Activate and read all three bodies from the active version | passed | passed |
| Delete SKTD, BDEF, class, DDLS, and table | passed | passed |

The 7.58 run completed in 38.5 seconds and the 8.16 run in 42.6 seconds. These runs exercise the
real GET/lock/PUT/unlock/activate path, not only the XML helper. KTD is unavailable on 7.50, where
the existing read path returns the established soft “No Knowledge Transfer Document” result.

## 6. Discovering undocumented nodes (follow-up, resolved)

`decodeKtdText` drops elements whose `<sktd:text>` is empty, so on its own `SAPRead(type="SKTD")`
showed only the documented nodes — on `ZI_TravelTP` that hid ~68 of ~80 writable nodes, and
the only way to learn an id was to provoke the write's refusal error.

Resolved in `read.ts`: `formatKtdUndocumentedIndex` appends a compact index after the reserved
`KTD_META_MARKER`, only on `SAPRead` (not on the KTD block `SAPContext` prepends, and not in `grep`
results). Draft/cache annotations use the same read-only area. Listing ~68 full ids would cost
~10 KB, so the index exploits the id shape instead — the root id is the object name and every other id is
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
