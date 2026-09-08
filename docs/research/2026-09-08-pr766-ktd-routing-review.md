# PR #766: KTD routing review and continuation

Reviewed 2026-09-08. Author head: `267c8009183f1bceaf45e00025e9c44c54bb8681`.
Scope: all 18 changed files, the #748 → #749/#750 history, the Markdown/XML inverse,
short-text targeting, handler mutation boundaries, tool contracts, and regression coverage.

## Conclusion

Continue [#766](https://github.com/arc-mcp/arc-1/pull/766). The author's diagnosis is correct:
the shipped exact-ID writer and the compact node index did not support the same copy/paste
workflow. Accepting unique indexed names through one resolver is a coherent fix. Keep the
byte-preserving XML splice, merge semantics, metadata escapes, and existing write gates.

Two additional correctness issues were reproduced and fixed in this continuation. Neither
requires replacing the author's implementation or rewriting the published commits.

## How the recent changes left this failure possible

1. The original writer replaced only the first `<sktd:text>` and encoded a complete multi-node
   Markdown document into that one element. The author reported and fixed this in #748.
2. [#749](https://github.com/arc-mcp/arc-1/pull/749), merged as `347d83f3`, introduced an inverse
   for exact `## <node id>` sections and protected full SAPRead round trips. Its compact index
   printed the base URI and type once, then node names. It explicitly instructed callers to
   reconstruct `<base>#type=<TYPE>;name=<NAME>`; it did not accept a printed child name alone.
3. [#750](https://github.com/arc-mcp/arc-1/pull/750), merged as `5c36f2a7`, deliberately retained
   that exact-ID contract when adding short texts. The wider name resolver from the contribution
   was removed during review; the short-text dossier records that decision.
4. A caller copying the index's child names naturally creates `## ZBDEF.SetPhoto`. The shipped
   writer recognized `## ZBDEF` as a root route but treated the child heading as root prose.
   Because at least one route matched, the protection against an entirely unaddressed multi-node
   blob never ran. The PUT succeeded while the actual child kept its old text.

Reproduced locally against the merged #750 code and the author's #766 head with the same
two-element envelope and input:

```markdown
## ZBDEF

root v2

## ZBDEF.SetPhoto

photo v2
```

| Code | Stored root body | Stored action body |
|------|------------------|--------------------|
| Merged #750 | `root v2` plus the child heading and `photo v2` | `photo v1` |
| #766 | `root v2` | `photo v2` |

This is ARC-1 routing behavior before SAP receives the envelope. It is not a SAP activation,
cache, Base64, lock, or version-selection defect. Earlier tests covered exact-ID round trips;
they did not exercise a second bulk update using names copied from the index.

## Findings on the author's head

### P2: body and short-text lookups can select different elements

`ktdRoutes` uppercased IDs and retained the first element, while `rewriteKtdShortTexts` built a
second uppercase map that retained the last. For separate elements with IDs ending in
`name=ZBDEF.SetPhoto` and `name=ZBDEF.SETPHOTO`, one combined request put the new body in the first
element and the new short text in the second. Even the exact second ID selected the first body.
The complete SAPRead result then failed to round-trip as a duplicate route.

Evidence: a synthetic envelope, extending the PR's existing `ZX`/`zx` test. This review did not
observe a case-colliding envelope on live SAP. SAP's installed Eclipse schema declares `sktd:id`
as a string; ABAP object-name case insensitivity is not evidence that two returned XML elements
may be collapsed. The PR's own test explicitly admitted this envelope shape.

Fix: exact full IDs select exact elements first. Case-insensitive IDs and node names are aliases
only when unique. The resolver returns the selected element directly to both write paths;
short texts no longer perform a second lookup. Read labels fall back to exact IDs, and writable
empty siblings remain visible even when their IDs differ only by case. Truly duplicate exact
IDs are refused because no reference can distinguish those elements.

### P2: some unmistakable unknown routes still become prose

Resolution was case-insensitive, but unknown-route detection checked `/sap/bc/adt/` and `#type=`
case-sensitively. A full uppercase ADT route with a typo was consequently written into the root.
The last-dot qualifier check also missed `ZBDEF.SetPhoto.extra` despite the known `ZBDEF`
qualifier. These requests succeeded and reported the misrouted heading after writing.

Fix: apply the same case normalization to route-shape checks, and recognize a known qualifier
followed by a dot even when the unknown suffix contains more dots. The same predicate controls
read escaping, so stored prose containing these headings still round-trips exactly. Handler tests
verify refusal before LOCK or PUT. The uppercase-URI gap also existed in the shipped guard;
the additional-dot gap concerns the PR's new qualifier detection.

## What remains intentional

- Body headings and `shortTexts[].node` share exact-ID and unique-name resolution, including raw
  and percent-decoded name spellings. There is no fuzzy matching or bare-last-segment expansion.
- A bare unmatched heading such as `## Update` is still prose; a typo in an unqualified name can
  be indistinguishable from prose. Update results and dry runs report those headings. The fix
  cannot promise to reject every misspelling without rejecting ordinary Markdown.
- A root-only H2 can also be a visible title. The earlier ambiguity guard stays; the index and
  user documentation now explain keeping the complete SAPRead context or using a bare root body
  when only the root is documented.
- Unaddressed XML stays byte-identical. Existing writability/obligation checks, package and scope
  gates, inactive-draft accumulation, and lock → PUT → unlock behavior remain intact. No new SAP
  endpoints or XML elements are introduced. Dry runs finish before locking or writing.
- SAPContext and grep continue to use unescaped stored Markdown without the node index.

## Verification

- Author baseline: 406 focused tests passed.
- New regression file before the fix: 14 failed, 1 passed. All passed after the fix; a further
  91-node test verifies two successive updates by indexed names and complete read/write no-ops.
- Final focused set: 6 files / 423 tests passed.
- Final full unit suite: 195 files / 5,807 tests passed. One intermediate run hit two HTTP
  socket failures (`ECONNRESET` / invalid HTTP response) in the unchanged MCP-era contract suite;
  its 10 tests passed in isolation, then the complete suite passed without further changes.
- Deterministic additional battery: 2,000 byte-identical round trips across single/multi-node
  envelopes, case-colliding IDs, raw/decoded names, reserved prose headings, repeated backslashes,
  exact metadata markers, empty siblings, CRLF, and outer whitespace.
- TypeScript source/scripts/tests, Biome, production build, strict MkDocs build, action policy,
  file-size and tool-schema budgets, and whitespace checks passed.
- Live SAP_BASIS 7.58 at A4H client 001: expanded slow KTD lifecycle passed twice (61.7 and 44.8 seconds),
  with no skipped tests. It created a disposable DDLS KTD and RAP/BDEF KTD, verified name-based
  writes and mixed-case short-text aliases, dry-run non-mutation, uppercase and qualified-typo
  refusal, cumulative inactive drafts, exact-ID read-back/round-trip, short-text clearing,
  activation, and deletion of every disposable object. A fresh local MCP server served the
  reviewed implementation; its feature probe was explicitly completed before the test.

Local reproduction and verification artifacts: `/tmp/pr766-review/`. The lifecycle was rerun
against the final implementation after the index help-text and root-selection review. SAP_BASIS
8.16 and the author's reported repairs of existing customer documents were not independently
rerun here.

## Independent SAP contract references

- [SAP: Editing Knowledge Transfer Documents](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/editing-knowledge-transfer-documents):
  hierarchical per-element documentation, copying an element name, and separate long/short texts.
- Local installed SAP bundle: `~/.p2/pool/plugins/com.sap.adt.ktd_3.60.3.jar!/model/ktdObject.xsd`:
  repeated `element` entries, string IDs, optional Base64 bodies, and optional short-text metadata.
- The original wire captures and Eclipse evidence remain in
  [multi-node research](2026-09-02-sktd-multi-node-write.md) and
  [short-text research](2026-09-04-sktd-short-texts.md).
