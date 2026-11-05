# ENHO/SKTD independent delta review 3

2026-11-03. Root Codex reviewer; I authored neither candidate source nor its committed regressions. Candidate **ba32e31cd45511a95f4b39e591bc290248a56204**, base **30580655f06d0948b2038bb452e7e8fa55bf77f6**. Scope: eight-file correction delta plus shared/private KTD consumers. The preceding independent review2 covers unchanged ordinary reads, activation, ownership and lifecycle integration; I reused that evidence explicitly rather than repeating the full combined audit.

**Changes requested: one P2 remains.** F3 root identity and F4 long-text eligibility are corrected. All unchanged 22 review2 probes pass, and the new namespace-derived root identity and per-element long-text decision are consumed by routing/fallbacks without rebuilding XML. Count mismatches fail closed; structural restrictions prevent nested elements from changing the document-order proof. Missing-flag compatibility and the legacy default profile remain as documented. This is not native, PP, public-admission or whole-PR approval.

## F5 — P2: opaque attribute text can override native short-text eligibility

The new native profile only carries long-text writability. `src/adt/ddic-xml.ts`'s `rewriteKtdShortTexts` still derives short-text obligation by searching the complete lexical tag with `KTD_SHORT_TEXT_OBLIGATION`. In `src/adt/pinned-ktd-document.ts`, the preservation guard permits changes to every qualified native short-text value, so it cannot establish whether the selected value is writable.

A valid native short-text element can contain a foreign attribute `x:note='sktd:obligation="optional"'` before its actual native `sktd:obligation="forbidden"`. The regex reads the quoted text in the foreign attribute first. Through the actual private write handler and mocked HTTP adapter, a shortTexts-only root edit sends **one PUT**, changes the forbidden native short text and reports **saved-inactive**. Equivalent native alias and single-quoted forbidden spellings reproduce the same result. The root/hash/namespace/owning lifecycle controls otherwise remain satisfied, and the foreign attribute is preserved. This demonstrates client eligibility failure, not real SAP acceptance of a forbidden save.

Conversely, foreign note text containing a forbidden obligation makes an actually optional native short-text slot fail before PUT. Both directions come from the same incorrect attribute source. Carry the parsed native short-text obligation into the explicit rewrite profile and consume it for eligibility, as for long text. Do not merely reject foreign metadata or only guard the three negative spellings. Preserve foreign values, actual optional/mandatory semantics and the separate supported serialization contract; foreign attribute text must neither authorize nor veto the selected native slot. Check the remaining short-text lexical reads/replacement against decoys as well.

Reproductions are in `codex-probes.test.ts`; `root-probes.log` records **26 probes: 22 pass, four fail**. The three negative probes expect refusal/zero PUT but observe saved-inactive/one PUT. The fourth expects an optional native edit to succeed while preserving a foreign forbidden note, but observes refusal. The first 22 probes are the preceding independent suite with import paths changed only. No snapshot source was edited.

## Verification and limits

- First verifier: exact candidate, **4,667 files unchanged**.
- Nine affected private/read/legacy/decoder suites: **231 tests pass**, `root-focused.log`.
- All three TypeScript projects pass, `root-typecheck.log`.
- Changed TypeScript Biome checks pass without fixes, `root-lint.log`.
- Final source action: verifier confirms **4,667 files unchanged**, `root-snapshot-final.log`.

Author reports all 530 files / 15,034 tests and build/policy/budgets/docs passing at this exact candidate. I did not repeat those complete gates; the meaningful adversarial probes above expose an issue not covered by them. Two early attempts to read a guessed diff filename failed harmlessly; the actual bound `review-input/followup.diff` was then read. Review probe files and logs were kept outside the immutable source; checks used existing dependencies and Node22.21.1. No installation, manual Git command, source fix, SAP/native operation, credential access or browser action was performed during this review. No source action followed the final verifier; this report was written outside afterward.
