# SKTD per-node short texts — contract and implementation

Researched 2026-09-04. This is the deliberately separate follow-up to the exact-ID multi-node
body fix extracted from PR #748. Jaime Rodriguez Capote's original short-text commit is the
implementation source; this branch preserves his authorship while narrowing the design after
independent review.

## Goal and scope

Add structured `SAPWrite.shortTexts=[{node,text}]` support for the short label SAP stores beside a
KTD node's long Markdown documentation. It must work for update and for the post-create follow-up
PUT, including calls with no `source`.

This PR does not add shorthand node names, percent-decoding, fuzzy matching, or another heading
resolver. Both Markdown sections and short-text assignments use the exact node IDs SAPRead shows.
That keeps addressing explainable and leaves the already-tested body parser unchanged.

## Authoritative contract evidence

### SAP Eclipse ADT model

`com.sap.adt.ktd_3.60.3.jar!/model/ktdObject.xsd` defines the wire model:

- each `sktd:element` has an optional, single `sktd:shortText` child;
- `sktd:shortText/@sktd:text` is `xsd:base64Binary`;
- `sktd:shortText/@sktd:obligation` is a server-provided string;
- the child is part of the full KTD document envelope, not a separate endpoint.

The generated EMF model (`IShortText`, `ShortTextImpl`) exposes only `text: byte[]` and
`obligation: string`. Eclipse's `KtdDocumentationSection` binds its text widget directly through
`ELEMENT__SHORT_TEXT / SHORT_TEXT__TEXT`. Its bytecode calls `Text.setTextLimit(60)`.

### ADT discovery and transport

The independent discovery capture in
`~/DEV/mcp-abap-adt-fr0ster/docs/adt-discovery.xml` exposes the v2 collection at
`/sap/bc/adt/documentation/ktd/documents`, media type
`application/vnd.sap.adt.sktdv2+xml`, and one document template carrying lock, transport, version,
and action parameters. There is no short-text-only write endpoint. ARC-1 must therefore retain the
existing GET → lock → full-envelope PUT → unlock lifecycle.

### Live behavior

The contributor's original implementation established the live behavior on SAP_BASIS 7.58 and
8.16: optional short texts can be set and cleared, `forbidden` nodes reject them, 60 UTF-16 units
are accepted, and an over-limit value is refused. This branch reruns that lifecycle with disposable
objects on both releases before publication.

## Design decisions

1. `shortTexts` is a structured array because short labels are metadata, not Markdown body text.
2. `node` is an exact full ID, matched case-insensitively for ABAP spelling. A missing ID returns
   the same known-ID evidence as a body-routing error.
3. ARC-1 only replaces the Base64 value of an existing `sktd:shortText/@sktd:text`. It preserves
   attribute order, obligation, object references, long text, links, and all unrelated nodes.
4. Missing `sktd:shortText` and `obligation="forbidden"` fail closed. ARC-1 does not invent XML the
   SAP server did not provide.
5. `text=""` clears a short text. Non-empty input is normalized to one line, matching Eclipse's
   single-line widget and SAPRead's rendering.
6. The 60-character constraint exists in both the MCP/Zod schema and the XML helper. Runtime
   validation still protects internal callers and records the exact Eclipse limit.
7. Every assignment is resolved and validated before the caller sends a PUT. Duplicate entries for
   the same node are refused rather than made order-dependent.
8. SAPRead lists only populated short texts behind `KTD_META_MARKER`, with the exact ID and current
   obligation. `grep` and `SAPContext` continue to consume only Markdown bodies.
9. Create remains a two-step operation. If the POST succeeds but the read/rewrite/PUT fails, the
   response says the object exists and directs the caller to verify it, then retry `update`.

## Rejected complexity from the original continuation

- A qualified/bare-name resolver with ambiguity handling was removed. It touched body headings,
  undocumented-node indexing, percent-decoding, and errors for a convenience unrelated to the
  short-text wire contract.
- File-size and tool-schema budget increases were not accepted. New tests live in focused files,
  and the tool description is short enough for the current budgets.
- The core multi-node research document is not expanded with another large implementation diary;
  this focused dossier owns the follow-up contract and evidence.

## Implementation and test plan

1. Add `rewriteKtdDocument`, exact-ID assignment validation, Base64 attribute replacement, and
   short-text formatting in `src/adt/ddic-xml.ts`.
2. Route KTD update and post-create writes through it; retain the existing partial-create safety
   response and lock lifecycle.
3. Add `shortTexts` to both on-prem and BTP Zod/tool schemas; restrict it to KTD create/update and
   regenerate only the intentional tool-surface fixtures.
4. Put the read-only short-text listing behind the existing metadata marker.
5. Cover XML preservation, clear, mandatory/forbidden/missing obligations, exact-ID enforcement,
   duplicate and length guards, combined body+metadata writes, handler create/update, schema
   restrictions, read formatting, and no-op refusal.
6. Run focused tests, typecheck, Biome, file/tool-schema budgets, action-policy validation, build,
   strict docs build, and the full unit suite.
7. Extend the disposable slow E2E lifecycle to set, read, clear, reactivate, and clean up a real
   short text on SAP_BASIS 7.58 and 8.16.

## Verification record

The reviewed implementation passed:

- focused KTD/XML/read/write tests: 5 files, 370 tests;
- schema, tool-surface, snapshot, and documentation-parity tests: 8 files, 398 tests;
- complete unit suite: 192 files, 5,739 tests;
- TypeScript checks for source, scripts, and tests; Biome; production build; strict MkDocs build;
- action-policy validation and both file-size and tool-schema ratchets. No budget was raised. The
  closest tool scenario is BTP full Git at 16,791 estimated tokens against a 16,800-token budget.

The final review found and fixed an ordering defect before publication: several short-text
assignments originally spliced in reverse caller order. They now splice by descending XML offset,
so an arbitrary caller order cannot invalidate later offsets when Base64 lengths change. A focused
regression and both live runs submit two nodes in reverse envelope order.

The disposable slow E2E lifecycle passed on both real systems:

- SAP_BASIS 7.58: 1/1, 38.6 seconds;
- SAP_BASIS 8.16: 1/1, 49.1 seconds.

Each run created and activated a table, root view, behavior pool, behavior definition, and KTD;
wrote two long-text nodes and two short texts in reverse order; verified inactive and active reads;
round-tripped the complete SAPRead output through the reserved metadata marker; cleared one short
text without changing either long text or the other short text; reactivated; and deleted every
disposable object in `finally`. Logs are under `/tmp/arc1-e2e-logs/pr748-short-{758,816}`.
