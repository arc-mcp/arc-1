# Claude Code follow-up review

Reviewed source fixes at f5b926c63d03dee32828f7adbcf81c97dde66532 against c282043d.
Same restricted read-only tool configuration as the first review. Completed successfully.

**No actionable findings remain.** All ten original findings are fixed in the current code, and I found no concrete regressions from the fixes. This was a static review only, and I ran nothing. The patch's source hunks match the current `src/` files I read.

I checked each area you listed: U01 binding, the header scan, diagnostic compaction and metadata fallback, traversal cases, statuses, FUNC labels and context, the parser parent check, and graph endpoints. The two extra query-separator cases (`?…?unexpected` and `??context=wrong`) are rejected at `src/adt/source-plugin-parser.ts:152`, and both would have passed without that check.

**Not raised as a finding:** the metadata fallback no longer has a hard byte limit (`src/adt/extension-discovery.ts:331`). It stops shrinking once `providers` is empty, so an extremely long `root.name` could exceed 2,048 bytes. The schema doesn't limit that name, but it would take about 1.7 KB, and a name that long can't get through the successful base read needed to reach the renderer. `enhancementContext.name` is capped at 80 characters.

The noted library boundary is additionally guarded after the review: fallback identities that
exceed their serialized allowance have an explicit omitted-field marker, including escaped
control characters. The subsequent DDIC prerequisite 13009e616 was integrated, with source
edges adopting its observationVersion qualification. These final changes are covered by
regressions, full repository gates, and refreshed live BTP/MCP checks.
