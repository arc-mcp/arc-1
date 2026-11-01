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
IDs are refused for writes because no reference can distinguish those elements. Reads remain
available, as corrected in the Claude follow-up below.

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

## Initial verification

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

## Claude follow-up on `2da95694`

Both findings in the supplied review were independently reproduced and accepted:

- **F1 — duplicate-ID reads:** the previous refusal lived in the shared route builder, so it
  affected SAPRead, grep, SAPContext, and short-text display. Route collection now records exact
  duplicates without throwing. Both body and short-text writers explicitly refuse the envelope
  before locking. Read surfaces retain every body and short text, and the metadata explains that
  writes are unavailable instead of advertising ambiguous IDs as usable routes. No live duplicate
  envelope was observed; the regression uses controlled XML matching the schema's repeated
  elements/string IDs.
- **F2 — successful-write feedback:** a newly authored heading matching a node name is a route,
  including an ordinary word such as `Description`. Successful writes now report the nodes whose
  bodies or short texts actually changed, the untouched count, and headings retained as prose.
  This makes routing visible; it does not infer whether the caller intended a matching heading
  as prose. The reversible read escape and explicit `dryRun` remain the pre-write mechanisms.

Checking related paths found two reporting gaps worth fixing in the same change: post-create
writes did not collect any prose feedback, and the legacy envelope-level text fallback could
report zero changed nodes after changing its sole body. One formatter now serves create, update,
and preview responses, and the legacy fallback counts its document body as one target. No-op
updates report zero changes without a dangling list.

The review's two informational notes need no behavior change. A dry run intentionally remains
available under the read-only server ceiling (with write scope and the package gate still
required): it returns before any mutation, matching the existing RAP preview precedent. A code
comment now records that `displayName` is a presentation label; routing continues to use the wire
ID's `;name=` component.

No other actionable finding remained in the reviewed KTD read/write/create/reporting paths or
in the PR's discussion at the time of this follow-up. This does not validate the author's
customer-document repairs or add SAP_BASIS 8.16 coverage.

Follow-up validation:

- Twelve added regression cases cover duplicate-ID reads and write refusals, successful create/update
  feedback, no-op updates, SAPContext, and the legacy envelope body. The first eleven failed against
  the previous implementation; the SAPContext case was added after the fix.
- Focused checks: 7 files / 502 tests passed. Final full unit suite: 195 files / 5,819 tests passed.
  An earlier full run timed out in the unchanged HTTP multi-target routing test. Its first isolated
  retry returned an unexpected 401 instead of 404; a second isolated run and the final complete
  suite passed without code changes. The source of this intermittent HTTP-test failure remains
  unconfirmed and is outside the KTD changes.
- The additional deterministic battery again passed all 2,000 byte-identical round trips.
- TypeScript source/scripts/tests, Biome, production build, strict MkDocs build, action policy,
  file-size and tool-schema budgets, and whitespace checks passed.
- Live A4H SAP_BASIS 7.58 client 001: the expanded KTD lifecycle passed in 42.5 seconds with no
  skips, including successful-write target feedback and a zero-change round trip. Every disposable
  object was deleted. The run used a fresh local MCP server with the final implementation.

Local logs and reproduction artifacts: `/tmp/pr766-followup/`.

## Complexity review after `32e3068d`

The useful simplifications are internal; removing routing checks or changing the Markdown
format would undo the behavior verified in the earlier reviews.

- Reuse the existing route map for section parsing and unknown-node errors. A body rewrite
  previously built it twice, or three times on an unknown route. The object name now travels
  with that map, avoiding repeated envelope parsing and XML arguments in display/error helpers.
- Separate candidate lookup from write validation. Labels now inspect candidates directly
  instead of throwing and catching an ambiguity error to choose a full-ID label. Both paths
  still use the same exact-ID, case-insensitive-ID, then name precedence.
- Consolidate decoded/raw node-name extraction and reuse the existing text-slot decoder in
  both SAPRead branches. This removes duplicated Base64 decoding and redundant catches while
  preserving the legacy body fallback and the existing element-boundary parser.
- Shorten the AGENTS.md row to file routing, the inactive-draft gotcha, and contract references.
  Trim stale comments about documented-node addresses and dry-run-only reporting.

The source delta is 43 fewer lines, with no tool-schema, response-text, or accepted-input change.
The three route indexes retain distinct purposes: exact IDs must win, case-insensitive IDs
must remain ambiguous when appropriate, and names must not override IDs. The reversible escapes,
duplicate-ID write guard, root-title refusal, dry run, and successful-write reports all protect
tested behavior and remain. The create handler's catch boundary also remains: widening it merely
to remove one local variable would weaken its distinction between a failed PUT and later work.

Before editing, a deterministic matrix recorded 8,480 read, write, report, and error results
from `32e3068d`. After simplification, all results are identical, including exact XML, error
messages, labels, previews, and successful-write summaries. All 2,000 additional byte-identical
round trips pass. Focused tests: 7 files / 418 tests passed, including the unchanged tool-definition
snapshots. The final full suite passed all 195 files / 5,819 tests. An earlier run hit an HTTP
parse error in the unchanged OIDC metadata test; that file passed all seven tests in isolation,
then the complete suite passed without further runtime changes.

Typecheck, Biome, policy validation, file/tool budgets, production build, strict MkDocs, and
whitespace checks passed. The live A4H 7.58 lifecycle passed in 45.4 seconds with no skips against
a fresh server running the simplified implementation; every disposable object was deleted.

Local comparison script, baseline, and logs: `/tmp/pr766-simplify/`.

## Independent SAP contract references

- [SAP: Editing Knowledge Transfer Documents](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/editing-knowledge-transfer-documents):
  hierarchical per-element documentation, copying an element name, and separate long/short texts.
- Local installed SAP bundle: `~/.p2/pool/plugins/com.sap.adt.ktd_3.60.3.jar!/model/ktdObject.xsd`:
  repeated `element` entries, string IDs, optional Base64 bodies, and optional short-text metadata.
- The original wire captures and Eclipse evidence remain in
  [multi-node research](2026-09-02-sktd-multi-node-write.md) and
  [short-text research](2026-09-04-sktd-short-texts.md).
