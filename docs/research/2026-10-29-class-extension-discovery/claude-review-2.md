# Claude Code follow-up review

Candidate `af58c19575065371ab5227ad43cfa04559646b24`; base `996f49d56197`. Same restricted read-only CLI configuration as review 1. Diff SHA256 `4c58461099b984260a0f37fe72bffd3736c1b6faa5344ee30a1b86c8e9cfd9dc`; 253.8 seconds, 58 turns. Static review only.

# Follow-up review of `af58c195` (base `996f49d5`)

**All five original findings are fixed, and the summary subpoint in finding 3 is not a defect. Two new P3 coverage issues remain.** In both, an explicit `sources` read can report `returned` with no omission when a generated include reference was skipped. Neither reads the wrong source or bypasses a deny rule.

This was a static review, and I ran nothing. I took the 10,814 pass and gate results from your message and the audit text. `@abaplint/core` isn't in the snapshot, so its grammar is inferred below.

## Original findings

| # | Status | Basis |
|---|---|---|
| 1. Public ENHO/INCL 500s | Fixed | The release reaches both guards (`read.ts:704`, `read.ts:886`, `enhancements.ts:230`). Tests use the exact bodies and reject them for 920. A4H and NPL legacy evidence shows ENHO and INCL returning with provenance. |
| 2. EIMP dropped silently | Fixed for EIMP | `class-extensions.ts:319-328` counts the reference, marks the provider `incomplete` and doesn't fetch it. Other-owner names still have a gap (Finding B). |
| 3. Switch metadata, sources mode | Fixed | `extension-discovery.ts:183` enriches the existing node. `review-fixed-a4h-public.json:346-386` shows the switch on all six rendered active identities. |
| 3. Summary subpoint | Not a defect | See below. |
| 4. Section case | Fixed | `extension-read.ts:60-62` normalizes the section, and a test compares upper- and lowercase providers and requests. The `scope` text still echoes the raw case, which is cosmetic. |
| 5. Draft warning and fallback source | Fixed as specified | `read.ts:713-714` keeps the warning and passes the source on, with no second `/source/main` request. Reusing that source exposes Finding A. |

**Summary subpoint, checked against the plan:** your position holds.
- **Identity:** line 41 of the plan keys objects by type, name and version.
- **Version labels:** line 31 keeps `provider_current` as a separate, non-atomic observation.
- **Cap:** line 28 requires omitted identities to be reported, and `review-fixed-a4h-public.json:288-290` reports `nodes: 1`. The extra row uses a slot in the eight-identity cap, but that is visible and allowed. The original review's "appears twice" objection assumed the two versions were interchangeable.

## New findings

### P3: INCL fallback can now report a false `returned` (regression from the finding 5 fix)
**Location:** `src/handlers/read.ts:713`, consumed at `src/adt/source-plugin-discovery.ts:160` and `:168`

- **Trigger:** `SAPRead type=INCL name=<X>=====E extensions=sources enhancementContext=…`, where:
  - the direct read falls back to the revision feed;
  - the include's metadata and elements routes succeed;
  - the source contains `INCLUDE <X>=====EM001.` or `…EIMP.`
- **Consequence:** the provider reports `returned` with `omissions.sources` at 0, and no child edge or source appears. The only hint is the generic "unread deeper units may exist". Before this change, the re-read failed and the provider was honestly `incomplete`. The plan (line 54) requires an explicit sources request to report any missing source. The harm is limited because the `INCLUDE` line is visible in the base block.
- **Facts:**
  - The fallback source now reaches the plain `findIncludeStatements` scan, not the token-substituting scanner.
  - `tests/fixtures/class-extensions/class-generated.abap:18` has this reference shape.
  - The new regression test's source contains no `INCLUDE`, and it never asserts provider status.
  - Its `not.toContain('provider_read_failed')` check can't catch a re-read, because a re-read failure renders as `http_500`. Only the call count guards that.
  - The legacy evidence files have no `enhancementContext` case, so this path has only mocked coverage.
- **Inference:**
  - abaplint doesn't parse `=` names. The comment at `enhancement-include.ts:113` says so, and the token substitution exists because of it.
  - Live reachability is unproven. If the metadata or elements route fails on a real system, the provider stays `incomplete`, and the source reuse has no effect there.
- **Fix:** when the unit is a generated enhancement include, also scan it with `enhancementIncludeReferences`. Count each reference as a missing source, mark the provider `incomplete`, and don't fetch it.
- **Test:** use a fallback source containing `INCLUDE ${include}M001.`, and assert `incomplete`, `omissions.sources: 1` and no child request.

### P3: Padded references to other owners are still not counted
**Location:** `src/adt/enhancement-include.ts:119`, consumed at `src/adt/class-extensions.ts:319-328`

- **Trigger:** a generated parent contains a padded name that doesn't start with that parent, such as `INCLUDE OTHER=========================EM001.`
- **Consequence:** nothing is fetched, which is the safe part, but nothing is counted either. The provider stays `returned` with no omission. The stated correction, and the comment at line 110 ("All real references"), both cover this case.
- **Facts:**
  - Only names with the parent as prefix are tokenized.
  - The new test's `ZOTHER` has no `=`, so it can't catch this.
  - `tests/unit/adt/enhancement-include.test.ts:80` already uses this exact shape, but only through the filtered `enhancementMethodIncludes`, so it asserts nothing about counting.
- **Inference:** the parser skips the statement, as in Finding A. I found no recorded SAP source with this shape, so real-world frequency is unknown.
- **Fix:** tokenize any `=`-padded name, not just the parent's. Only INCLUDE statements yield references, so substituting elsewhere is harmless. The child filter still limits reads to the same owner's `EMnnn` includes.

A single test that passes `=` names through `findIncludeStatements` would confirm or refute the parser inference behind both findings.

## Fails closed, no change needed
ENHO/INCL fallback for the 750 and 758 500 bodies needs a probed release. Single-target tool calls don't wait for the startup probe, and `SAP_ABAP_RELEASE` isn't consulted here. A read before the probe finishes, or after it fails, returns the original 500 and serves no source. This matches the `enho.md` wording ("when the matching release is probed").

## Evidence coverage
- **Read directly:** both legacy files and the relevant A4H section.
- **Searched only:** the NPL public and BTP files, so I didn't check the BTP cases line by line.
- **Not verified:** the source hashes in the evidence against the candidate.
