# KTD short texts — design

Date: 2026-09-03. Status: approved for implementation. Builds on the multi-node KTD write
(`fix/sktd-multi-node-write`, PR #2) and its research note
`docs/research/2026-09-02-sktd-multi-node-write.md`.

## 1. Goal

Read and write the **short text** of any node of a Knowledge Transfer Document (SKTD) through
`SAPRead` and `SAPWrite`, without changing the Markdown-body semantics established by the
multi-node write: `## <node id>` sections address nodes, unaddressed nodes stay byte-identical,
fail closed on anything ambiguous.

Out of scope: parsing the length limit from the document's `<sktd:instruction>`; short texts on
any object type other than SKTD nodes; writes against production systems.

## 2. Wire facts

Per `<sktd:element>` (verbatim capture, S/4HANA PCE 2025.1, confirmed on-prem 816):

```xml
<sktd:element sktd:longTextObligation="optional|mandatory" …>
  <sktd:id>…</sktd:id>
  <sktd:text>BASE64</sktd:text>                       <!-- or <sktd:text/> -->
  <adtcore:objectReference … adtcore:description="Default-values factory for creating an Identifier"/>
  <sktd:parent>…</sktd:parent>
  <sktd:shortText sktd:text="RGVmYXVsdC12YWx1ZXMg…" sktd:obligation="optional"/>
  <atom:link …/>
</sktd:element>
```

- `sktd:shortText/@sktd:text` is Base64 of the UTF-8 short text; empty when none.
- `sktd:shortText/@sktd:obligation` is `optional` on most nodes and **`forbidden`** on the object
  root and on entity (`BAE`) nodes.
- `adtcore:objectReference/@adtcore:description` carries the same value in clear text, and is
  absent on nodes without a short text.
- The document ends with `<sktd:instruction sktd:instructionId="shorttext"
  sktd:instructionText="Provide a meaningful short text with 60 characters max."/>`.

**Open point, to be settled empirically before the write is finalised `[I]`:** which of the two
attributes SAP treats as the source of truth on PUT. Procedure, on the `$TMP` test bed
(`ZARC1_KTD_ROOT`): PUT changing only `sktd:shortText/@sktd:text`, GET, inspect whether
`adtcore:description` followed. If it did not, the write sets **both** attributes consistently.
The outcome is recorded in the research note with an `[E]` mark.

## 3. Interface

### 3.1 `SAPWrite` (type `SKTD`, actions `update` and `create`)

New optional parameter:

```
shortTexts: [{ node: string, text: string }]
```

- `node` — a node reference resolved by the shared resolver (§4): the full node id, or the name
  `SAPRead`'s trailer lists before ` [` (e.g. `GetPhoto`); the tool description says so, closing
  the producer/consumer loop with §3.2.
- `text` — the new short text, normalised onto one line (whitespace runs collapsed, ends trimmed) so
  the stored value equals what `SAPRead` shows; at most 60 characters counted as UTF-16 units, the way
  an ABAP CHAR60 field counts; `""` clears it.
- `source` becomes **optional** when `shortTexts` is present. A call may change bodies only,
  short texts only, or both.
- `create` accepts `shortTexts` alongside `source`; it runs through the same envelope rewrite
  after the POST, and keeps the existing partial-success error wording if the rewrite refuses.

### 3.2 `SAPRead` (type `SKTD`)

After the decoded Markdown, a **metadata trailer** introduced by a marker line:

```
<!-- arc1:ktd-meta — read-only context below; SAPWrite ignores it -->
Short texts (SAPWrite shortTexts=[{node,text}]; node = the name before " ["):
  ZI_TravelTP.finalize [BDEF/BSO]: Saver: FINALIZE — last determinations before save
  ZI_TravelTP.GetPhoto [BDEF/BAF]: Read the stored photo

Undocumented nodes: 68. …                     ← existing index; names spelled like above
```

- The marker is an HTML comment: invisible when the Markdown is rendered, unambiguous to parse.
  The writer matches it by its stable prefix `<!-- arc1:ktd-meta`, so a retyped prose tail still
  strips.
- Short texts list every node that has one, as `<qualified name> [<TYPE>]: <text>` (the root node
  renders as `<name> [root]`, so every line is bracketed). The name comes first and is spelled exactly as the resolver accepts it, so a
  label can be copied back as `shortTexts[].node` or as a `## ` heading. Nodes without a short text
  are not listed; a stored value is normalised onto one line.
- The undocumented-node index moves inside the trailer, separated by a blank line; it spells names
  the same way (percent-decoded, entity-qualified) and teaches the same addressing rule — add a
  `## <name>` section using a listed name — so the two blocks never contradict each other. `[root]`
  is derived from the document's own name; any other type-less id renders `[node]`.
- The trailer is emitted only when it has content (some short text, or some undocumented node).
- `grep` and the KTD block `SAPContext` prepends stay on the bare Markdown, as today.

### 3.3 Writer ignores the trailer

`rewriteKtdText` cuts the body at the first line that starts with the marker, before any other
parsing. Pasting a whole `SAPRead` result back into `SAPWrite` therefore never folds the trailer
into the last node's body — this also fixes the same hazard the undocumented-node index has today.

## 4. Node resolver (shared)

One function resolves a node reference against the envelope's elements, used by `## <heading>`
parsing and by `shortTexts[].node`:

1. exact id match;
2. case-insensitive id match (root id is upper-cased on the wire while other ids spell the object
   in mixed case);
3. **node name**: the value after `;name=` in a fragment id, or the root's own id, compared
   case-insensitively — accepted only when exactly one element matches. Four spellings of the
   reference are tried because the wire carries names entity-qualified and percent-encoded
   (`ZI_TravelTP.GetPhoto`, `%25_OWN`): the qualified name and its last dot-segment, each
   percent-decoded and as encoded on the wire — so `GetPhoto`, `ZI_TravelTP.GetPhoto`, `%_OWN`
   and `%25_OWN` all resolve for `shortTexts[].node` (grew during implementation, see the research
   note §8). `## ` headings accept only the qualified spellings: every BDEF carries
   `<Entity>.create/update/delete` nodes, so a bare `## Update` must stay prose (release review,
   2026-09-03);
4. otherwise an error: unknown (lists valid ids) or ambiguous (lists the candidates with full ids,
   e.g. `update` exists once per entity).

Heading resolution keeps its current narrow "ADT-shaped but unknown" refusal; short-name
resolution never makes a prose heading a node unless it matches a node name exactly, so the
`## /notes/package layout` style of prose stays prose.

## 5. Validation and errors

All validation completes before any lock is taken. Refusals list what the caller needs to fix:

| Condition | Result |
|-----------|--------|
| `node` unknown | error listing valid ids (existing wording) |
| `node` ambiguous | error listing candidate full ids |
| node's `obligation="forbidden"` | error: this node (root/entity) does not take a short text |
| `text` longer than 60 characters | error stating the length and the limit |
| same node twice in `shortTexts` | error |
| `source` supplied but empty/whitespace (with or without `shortTexts`) | existing empty-body refusal, which explains how to clear one node — enforced in `rewriteKtdDocument`; at the MCP tool boundary an empty `source` never arrives, because the LLM-argument normaliser (`stripLlmEmptyValues`, issue #360) drops empty strings for every tool before Zod, so there it is indistinguishable from "not supplied" |
| neither `source` nor `shortTexts` supplied | "nothing to write" refusal naming both parameters |
| element lacks `<sktd:shortText>` | error; ARC-1 does not synthesize the element |

## 6. Write flow

```
GET envelope
→ strip trailer from source (if any), apply body sections      (existing logic)
→ apply shortTexts: per node, splice sktd:shortText/@sktd:text (Base64, unwrapped)
   and — if §2 shows SAP does not derive it — adtcore:objectReference/@adtcore:description
→ one lock → PUT → unlock cycle                                 (existing safeUpdateObject)
```

Splices are byte-preserving string edits inside the located `<sktd:element>` block, in the same
style as the body splice; nothing outside the addressed attributes changes.

## 7. Schema and LLM surface

Three-file sync: `tools.ts` (JSON Schema), `schemas.ts` (Zod; `source` optional for SKTD when
`shortTexts` present), handler. This changes the frozen LLM-visible surface: regenerate
`tests/fixtures/tool-definitions/*.json` with `vitest -u`, review the diff, and re-run the
tool-schema budget check. The parameter description stays short.

## 8. Tests

Unit (`tests/unit/adt/ddic-xml.test.ts`): short-text splice (paired attribute present, empty,
clearing, `forbidden`), resolver (exact / case / short name / ambiguous / unknown), trailer strip,
trailer formatting, and a round trip `SAPRead` output → `SAPWrite` body that is a byte-level
no-op on the envelope.

Handler (`write-ddic.test.ts`, `read.test.ts`): `shortTexts` alone, with `source`, on a
`forbidden` node, ambiguous short name, 61 characters, whole read pasted back does not contaminate
any body, create with `shortTexts`.

Live: the §2 experiment on `ZARC1_KTD_ROOT`; then short texts on the 17-node trial KTD.

## 9. Documentation

`docs_page/tools.md` (SAPRead SKTD row and SAPWrite parameter table), `AGENTS.md` SKTD row,
addendum to `docs/research/2026-09-02-sktd-multi-node-write.md` with the `[E]` outcome of §2.
