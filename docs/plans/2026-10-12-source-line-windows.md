# SAPRead source line windows (#585)

Reading around an ATC finding or grep hit should not require the whole source.
Continue the contributor PR with its history; update it against current main.

The proposed implementation duplicated class reading, silently ignored ranges on
some types/modes, and discarded draft warnings. Regression tests reproduced those
gaps before the follow-up. Its shortened grep guidance is restored.

## Plan and review

- Require both positive, 1-based inclusive bounds. Clamp end to source end; refuse
  a start beyond it. Slice raw source before adding context or numbering.
- Reuse the existing source-result formatter and cache/version resolution. Class
  sub-includes require the raw include reader because the ordinary reader adds a
  banner; `include=main` follows the main source path.
- Accept only documented single-source types and plain text. Reject competing
  modes before SAP access. FUGR expansion and multi-node KTD need a separate
  numbering contract, so they are outside this change.
- Keep draft/version warnings and cache indicators outside the numbered source.
  Keep schemas, descriptions, examples and snapshot fixtures aligned.

Review: a small pure formatter plus early validation avoids a new source-loading
framework. No changes to source caches, authorization, write behavior or model
guidance are needed. Tests cover bounds, includes, versions/warnings, unsupported
combinations and cache reuse; live windows must equal raw source on available
releases. Record exact live coverage in the PR. Roadmap: no roadmap impact.
