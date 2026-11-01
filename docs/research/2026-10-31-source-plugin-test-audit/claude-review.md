# Claude Code independent review

Reviewed commit: c282043d32fcd754d7e31c4a5e924c83a035bcbd. Base: c16ab455a.
CLI 2.1.308 completed successfully with Read/Grep/Glob only, restricted mode, no MCP servers,
and no shell, writes, network tools or delegated agents. The review did not run tests.

# Review: stage-2 source plug-in discovery

I found no Critical or High issues, but there are 3 Medium and 7 Low findings. Caller identity, deny actions, send/wire/time caps and first-block preservation showed no defects.

I traced everything by reading the code and fixtures, as instructed, so I ran no tests. The reproductions below are deterministic from the code unless marked otherwise.

## Medium

**1. Default summary rejects valid SAP evidence for structural function includes**
- **Location:** `src/adt/source-plugin-discovery.ts:100`, with the rejection at `src/adt/source-plugin-parser.ts:158-172`
- **Failure:** The FUNCTION-header binding only runs when `session.mode === 'sources'`. Take `SAPRead(type="INCL", name="LSEEF_ADT_TEST_AUNIT_FUGR1U01", enhancementContext={type:"FUGR", name:"SEEF_ADT_TEST_AUNIT_FUGR1"})` in default or explicit summary mode. The position in `fugr-u01-758.xml` points to `/fmodules/.../source/main`, which isn't in the allowed set.
- **Impact:** The session stops with `incomplete` / `invalid_provider_response` and no identities, while sources mode on the same object succeeds. The failure wrongly blames SAP's response.
- **Fix:** Bind the header in summary too, using the captured base source, or one bounded source read if none was captured. Do this after fixing finding 2.
- **Test:** Extend the U01 case at `tests/unit/adt/source-plugin-discovery.test.ts:171` to summary mode, for both matching and mismatched headers.

**2. Quadratic regex runs synchronously on untrusted ABAP**
- **Location:** `src/adt/source-plugin-discovery.ts:105`
- **Failure:** `^\s*"` under `/gm` backtracks across newlines from every line start. A function-group include with up to 256 KiB of blank lines costs about N² steps. My estimate is tens of seconds; this is analysis, not a measurement.
- **Impact:** The event loop blocks, and neither the deadline nor cancellation can interrupt it, so every user of a shared HTTP server stalls. Anyone able to author such an include can set this up, and it triggers on an `extensions=sources` read.
- **Related:** Sources over 256 KiB skip binding entirely (`first=''`). A valid function location in such a source then stops the whole traversal as a protocol error, instead of reporting the scan limit.
- **Fix:** Scan line by line for the first non-blank, non-comment line. This needs no whole-source regex and can also work on oversized sources.
- **Test:** Use `'\n'.repeat(256 * 1024)` with a time bound, plus an oversized include whose header matches.

**3. Unbounded issues can destroy the summary block**
- **Location:** `src/adt/source-plugin-discovery.ts:188`, rendered by `src/adt/extension-discovery.ts:293-298`
- **Failure:** Every skipped occurrence pushes `include_ownership_skipped:<name>`, with no deduplication, up to 200 times. About 40 SAP includes in `ZROOT` under `extensions=sources` pushes the summary past 2,048 bytes.
- **Impact:** The renderer first drops every found identity, then cuts the text mid-`issues`. `omissions` and `consumed` serialize after `issues`, so they are lost and the JSON no longer parses. This also defeats the promise that omissions stay visible.
- **Fix:** Deduplicate and cap the issues with a count, and serialize `omissions`/`consumed` before `issues`.
- **Test:** Use 60 SAP includes and assert that the summary parses, identities survive and omissions are present.

## Low

**4. Ownership and limit branches have no tests**
- **Location:** `src/adt/source-plugin-discovery.ts:187-192`, `:174-178`, `:75-79`
- **Failure:** Every traversal test uses `Z*` includes, which are always expandable. `include_ownership_skipped`, `include_occurrence_limit` and `source_unit_node_limit` are never asserted; the last appears only in a BTP allowlist.
- **Impact:** Passing `unit.name` instead of the inherited `mainUnit.name` to `expandsInclude` would still pass every test.
- **Test:** Cover a SAP include under a customer root, another namespace, and an inherited INCL context. Also cover 201 occurrences, and reaching the node limit with mocked routes.

**5. Scope label hides the filter and the include context**
- **Location:** `src/handlers/extension-read.ts:49`
- **Failure:** The FUNC branch runs before the partial check, so an explicit `grep` or line-window FUNC read says "selected function" without "base filtered". This contradicts `docs_page/tools.md`. Separately, a contextual INCL says "full root source", and the renderer omits `context` altogether.
- **Impact:** Include plug-in results depend on context, but the result doesn't say which context was used.
- **Fix and test:** Add the filter marker and `context=<type> <name>` to the scope, and assert both.
- **Speculation:** ARC-1 doesn't check that the supplied context really contains the include. SAP's response to a wrong context is unobserved, so an empty `returned` result could be misleading.

**6. `not_advertised` overwrites `incomplete`**
- **Location:** `src/adt/source-plugin-discovery.ts:212-222`
- **Failure:** Take a root and child with no enhancement relation, where the root repeats `INCLUDE ZCHILD.` 201 times. Line 176 sets `incomplete`, but `missingOnly` stays true, so lines 212-220 replace it with `not_advertised`. A depth-limited chain of unadvertised units also reports plain `not_advertised`.
- **Fix and test:** Set `missingOnly = false` on the occurrence, node and depth limits, and assert the final status.

**7. One unusual include name stops the whole phase**
- **Location:** `src/adt/source-plugin-resources.ts:23` compared with `src/adt/include-expansion.ts:141`
- **Failure:** `expandsInclude` accepts `%` and `#`, but `sourcePluginObjectUri` rejects them. Under a SAP or same-namespace root, that include raises a protocol error inside `session.read`, which sets `stopped`.
- **Impact:** Remaining units go unread and the result blames the provider response.
- **Fix and test:** Check the name before queueing, record a per-include issue and mark the run `incomplete` without stopping. Test `INCLUDE %_X.` under a SAP root followed by a readable sibling.

**8. `nested: not_expanded` contradicts the returned nested identities**
- **Location:** `src/adt/source-plugin-discovery.ts:43`
- **Failure:** A summary that uses the elements provider returns the whole nested graph. For example, `nested-750.xml` gives 4 identities, 3 of them nested, while the label says `not_expanded`.
- **Fix and test:** Use `not_expanded` only for `direct_identities`, and assert the label in the 750 summary test.

**9. Parser ownership check passes on a missing parent**
- **Location:** `src/adt/source-plugin-parser.ts:112`
- **Failure:** Without `selectedObjectUri`, `same('', '')` is true. An implementation with no `enhancedObject` then passes the owner, name and type checks, since all are empty.
- **Impact:** `discoverSourcePlugins` always passes the option, so the exposure is the documented reusable parser API rather than current SAPRead traffic.
- **Fix and test:** Compare only when the option is set, and add a case with `enhancedObject` removed.

**10. Graph edges mix two ID formats**
- **Location:** `src/adt/source-plugin-discovery.ts:290-291`, from `src/adt/source-plugin-parser.ts:226`
- **Failure:** Parent edges to the root object, or to a truncated implementation, keep the raw name (`SEEF_ADT_TEST_AUNIT_FUGR1`). Attachment and include edges use `FUGR:...:active`.
- **Impact:** A consumer can't join a parent chain back to its root by ID.
- **Fix and test:** Carry the parent type through and build keys for root and truncated targets. Assert that a nested chain connects from implementation to root.

## Remaining qualification limits
- **BTP:** There is still no positive plug-in observation. FUGR `SRFC` sources mode used all 20 sends with every checked unit unadvertised.
- **758 FUGR:** Sources mode can run out of sends before later includes, as with `SEEF_ADT_TEST_AUNIT_INCLUDE_3` in the final bounded run.
- **Live INCL:** The only positive case uses PROG context, so finding 1 had no live test that could expose it.
- **Not qualified:** The 750 PROG case was not replayed over MCP, and live principal propagation has not been tested for source plug-ins.
