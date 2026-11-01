# Claude Code review 1

Candidate: `996f49d56197`; base: `c1fc0684`. Claude Code 2.1.308, configured default model, restricted Read/Grep/Glob only, empty MCP config, hooks disabled, no session persistence. Immutable snapshot; diff SHA256 `0b99e605a5ce823808c79c3eace451ebf9b02ef49744bca0a13409534c704db6`. Duration: 335.8 seconds; 47 turns. Static review only.

# Review of the class-enhancement discovery change (candidate `996f49d5`)

I found five actionable findings: three P2 and two P3. None of them returns wrong-owner source, follows an arbitrary URI or bypasses a deny rule. This is from reading the code and recorded evidence only; I ran nothing.

## Findings

### P2: Public ENHO fallback rejects the 500s it is documented to handle
**Location:** `src/adt/enhancements.ts:229`, also `src/handlers/read.ts:701`

- **Trigger:** `SAPRead type=ENHO` on `CL_OO_ADT_ENHANCED_CLASS1` on 758, or on an ENHO/XH that returns the unsupported-technology 500 on 750.
- **Consequence:** the caller gets the raw 500 instead of the active include revision. `docs_page/tools.md:479` and `docs/research/abap-types/types/enho.md:72` promise that fallback. The latter says any 400/404/500 qualifies, which contradicts the tightened guard.
- **Evidence:**
  - Both calls use `enhancementSourceUnavailable(error)` with no release, so the 750 and 758 branches can never match.
  - Without a release, only a 404 or `ExceptionResourceReadFailure` qualifies.
  - Only the discovery path passes a release.
  - The public fallback tests mock only `ExceptionResourceReadFailure` (`tests/unit/handlers/read-enho-include-fallback.test.ts:49`), while the class tests use the real bodies (`class-extensions.test.ts:20`, `read-class-extensions.test.ts:44`).
- **Status:**
  - Observed in code: the guard behaviour for ENHO.
  - Inference: that SAP returns these bodies on the public ENHO route, based on the candidate's own fixtures.
  - Inference: the same failure for `INCL`, because no direct-include 500 body is recorded.
- **Missing test:** public ENHO and INCL fallback using the 750 and 758 bodies, with the release cached.

### P2: A discovered `EIMP` include is dropped without being reported
**Location:** `src/adt/enhancement-include.ts:111`, consumed at `src/adt/class-extensions.ts:319`

- **Trigger:** `extensions=sources` falls back to a generated parent containing `INCLUDE <name>=…=EIMP.`
- **Consequence:** the include is not read, and `omissions.sources` is not incremented. The provider stays `returned`. The plan requires an explicit sources request to report any missing source. The reason text `generated_method_includes_only` states a general limit, not that this reference was skipped.
- **Evidence:**
  - The scanner only substitutes `<parent>M\d{3}`, so `EIMP` never maps to a child.
  - `readEnhancementIncludeRevision` would also refuse that name.
  - The diff's own `enho.md:37-38` and `45-46` record `EIMP` references on customer 750 and 758 systems. `enho.md:47-48` says reading them is unverified.
- **Status:** the code path is observed. The `EIMP` wire shape comes from recorded notes only; the repo has no fixture for it.
- **Missing test:** a generated parent naming `EIMP`, asserting a visible omission and no child request.

### P2: Native nodes discard hook switch metadata
**Location:** `src/adt/class-extensions.ts:192`, with dedupe at `src/adt/extension-discovery.ts:179` and `src/adt/source-plugin-discovery.ts:235`

- **Trigger:** any class where the native and hook providers report the same implementation.
- **Consequence in sources mode:** the hook node is dropped because its key already exists. The bodies of a switched-off implementation are rendered with no switch state, although the plan requires observed switch metadata.
- **Consequence in summary mode:** the versions differ (`active` and `provider_current`), so the same implementation appears twice and uses up the eight-identity cap.
- **Evidence (observed live):**
  - `a4h-public.json:282-295`: the summary lists `..._CLASS_1` twice, with `switch: SEEF_ADT_TEST_SWITCH_01:off` on the hook row, and omits one node.
  - `a4h-public.json:344-393`: the sources run shows seven identities and no switch at all.
  - `tests/fixtures/extensions/source/class-758.xml:16` shows the input carried the switch.
- **Missing test:** a combined native and hook read asserting that switch state survives and each implementation appears once.

### P3: Mixed-case `include` selects the wrong hook section
**Location:** `src/handlers/extension-read.ts:60`

- **Trigger:** `SAPRead CLAS include=DEFINITIONS` or `include=MAIN`, with an explicit `extensions` mode. `schemas.ts:165-178` accepts these, and the base read lowercases them.
- **Consequence:** the section's advertised hook relation is never read.
  - Sources mode reports `incomplete`, with `enhancement_relation_not_advertised`.
  - Summary mode keeps `status: returned`, because of the early return at `source-plugin-discovery.ts:159`.
  - `include=MAIN` also skips the main identity list. The base block is unaffected.
- **Evidence:** the raw `args.include` reaches `sourcePluginResources`, which matches `includeType` case-sensitively (`source-plugin-resources.ts:68`).
- **Status:** observed in code, not exercised live.
- **Missing test:** uppercase `DEFINITIONS` and `MAIN` should match the lowercase provider results and requests.

### P3: INCL revision fallback loses the draft warning and base source
**Location:** `src/handlers/read.ts:708-711`

- **Trigger 1:** an active read of an enhancement include where the user has an unactivated draft.
- **Consequence 1:** `note` replaces `versionWarning`, so the "LAST ACTIVATED version" warning disappears.
- **Trigger 2:** `extensions=sources` with `enhancementContext` on the same fallback path.
- **Consequence 2:** `extensionBase.source` is never set, so discovery re-reads the `/source/main` route that just failed. The provider becomes `incomplete` and the include scan is skipped, even though the source is already in hand.
- **Status:** observed in code.
- **Missing test:** the fallback with a draft present, and with a context-bound sources request, asserting the warning stays and no second `/source/main` request is sent.

## Reviewed with no finding
I found no defect in these areas:
- `EXTED_OBJ` context, root and identity validation, and traversal direction and bounds
- ENV/WUL compatibility
- feed and content URI binding, and 1970 sentinel handling
- terminal failure handling
- shared budgets and cancellation
- none-mode and first-block preservation

## Residual qualification gaps
- **Interfaces:** there is no positive coverage. 758 and 920 return ENV, and 750 has no qualified provider.
- **BTP 920:** generated-source and authored structural or local source retrieval are unqualified after the 403s. Principal propagation and multi-target live routes are also untested.
- **Not claimed:** runtime switch applicability, atomic cross-provider snapshots, and other releases.
- **Namespaced classes and ENHOs:** the native source path has no live evidence. The owner check at `src/adt/enhancements.ts:72` is an exact-case URI comparison. By inference, lowercase `%2f` escapes in metadata would stop the optional phase with `invalid_provider_response`, which fails closed but loses coverage.
- **Full test suite:** the audit records no clean pass at the final state. The runs ended 10,804/10,805 and 10,803/10,805 on timing-sensitive tests, which then passed in an isolated one-worker run.
