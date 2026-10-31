# Claude Code final focused review

Candidate `11dcfea5d7b107742e8337b631435c1e6e417599`; base `af58c1957506`. Same restricted read-only CLI configuration. Diff SHA256 `84c3b144cb7b86e43300384d37e01a7978a3d631721aa625e220d10aa657d9b5`; 136.8 seconds, 30 turns. Static review only.

**Both P3 findings are resolved, and I found no actionable regression in this patch.** This was a static review and I ran nothing. The test counts, gates, replays and parser result (`[]` for the plain parser, both names for the scanner) come from your message and `test-gap-audit.md:111-118`. `@abaplint/core` isn't in the snapshot, so I couldn't check its grammar myself.

## Findings

| Finding | Status | Evidence from the code |
|---|---|---|
| **False `returned` on standalone generated INCL** | Resolved | `source-plugin-discovery.ts:169-177` now scans with the qualified helper. Any reference adds to `omissions.sources`, sets `unavailable` (which gives `incomplete` at `:215-216`) and adds an issue. `continue` then skips the traversal, so no child can be queued. |
| **Foreign padded references not counted** | Resolved | The parent-prefix filter is gone from `enhancement-include.ts:117`, so every padded name is tokenized. `class-extensions.ts:319-328` still limits children to the exact owner's `Mnnn` names and counts the rest as omissions. |

**Regression tests:**
- **Standalone fallback:** `read-enho-include-fallback.test.ts:239-254` uses a source with a real `INCLUDE` and asserts `incomplete`, one omission and the issue. Its no-child check is meaningful because `encodedInclude` matches the encoded form in `URL.pathname`, and the mock throws on any unexpected path.
- **Foreign owner:** `class-extensions.test.ts:138-146` uses the padded `OTHER=…=EM001` shape that the old `ZOTHER` case missed, and expects 3 omissions and one revision feed read.

## Requirements you listed

- **Comments and literals stay excluded:** tokenization never consumes `*`, `"`, `'`, `` ` ``, `|`, `{`, `}`, `.` or a newline. The state machine at `include-expansion.ts:169-218` therefore sees the same comment, literal and statement boundaries, and line numbers don't move. `INCLUDE TYPE` statements still fail the `Statements.Include` check (`:258`).
- **Source bytes are unchanged:** `scanned` is a local copy. `sourceCache` and `result.sources` keep the original string.
- **Method includes API:** `enhancementMethodIncludes` still filters by owner (`enhancement-include.ts:105-107`), and its test at `enhancement-include.test.ts:78-83` covers comment, literal and foreign-owner input. Its only caller in the snapshot is that test.
- **Token mapping:** the collision check uses uppercase source and lookups are uppercase, so an existing `ZARC1_GENERATED_CHILD_n` in the source can't be mistaken for a token.

## Reviewed, not defects

These are all inferred from reading the code:

- **Plain children no longer traversed:** `INCLUDE ZCHILD.` inside a standalone generated INCL used to be followed if owned, and now it's only counted. This matches your stated design and is reported as `incomplete`, so nothing is hidden.
- **Slower regex on pathological input:** the new pattern at `enhancement-include.ts:117` has no literal anchor, so it is quadratic on one long unbroken run of word characters.
  - **Worst case:** about 7×10¹⁰ steps for a 256 KB run (not measured). That would block synchronously, and the session deadline couldn't interrupt it.
  - **Why it isn't a blocker:** it needs SAP to return non-ABAP content, because as far as I know ABAP lines are limited to 255 characters. I found no source in the snapshot confirming that limit.
  - **Size bound:** `source-plugin-discovery.ts:163` caps the standalone path at 256 KB. I didn't trace the class path's cap beyond the shared response budget.
  - **Possible hardening:** adding `(?<![A-Z0-9_])` at the start should make it linear, though I haven't tested that.
- **Malformed padded names:** forms like `Z%X==E` or `NS/ABC==E` get counted under a garbled name and never fetched, which is safe. A form like `A==B==C` leaves `==C` in the statement, so I'd expect it to go uncounted, but that depends on the parser. None of these are valid include names.

## Outside this patch

The standalone guard only matches the 31-character parent form. If a directly selected `…EM001` or `…EIMP` unit contained a padded `INCLUDE`, it would still get the plain parser and no omission. This predates the patch and is outside both findings. I found no recorded source with that shape.

Live coverage is unchanged: as you said, both P3 paths are qualified only by mocked fixtures.
