# ADT adoption: pilot and remaining implementation stages

Authorized follow-up to draft PR #1008. Keep each stage independently reviewable, with tests,
short user documentation, live evidence and a Claude Code Opus 5.5 Max GUI review. No merge,
deployment, SAP mutation or permission change is part of this work.

## Current baseline

- Transport implementation: `f7598c33`; final documentation: `56c1d518` (PR #1008).
- Main `041a9e48` includes #1006, #1007 and release #970. Version 1.6.0 was published on
  October 17 at 11:21 UTC. These stages remain separate post-release drafts.
- Reuse the reviewed workflow primitives by stacking the follow-up drafts on #1008. Recheck main
  and open PRs before each stage; avoid incidental changes to source search or legacy responses.
- The original 67-file prototype in worktree `b945` is reference material only. Preserve its
  hashes; review copied code against current enforcement and fixtures before adopting it.

## Delivery and acceptance

| Stage | Deliverable | Required evidence |
|---|---|---|
| Pilot | Eight existing test-system requests, released and active modes; source, DDIC, text, FUGR, RAP and empty scope | Per-request status, gaps, calls/bytes/time; inspect every complete label; no invented time-saving estimate |
| Notebook / NB-01 | Pure `.abapsql` import, versioned Markdown/SQL document, explicit run over existing SAPQuery, optional row export and scalar checks | Import never connects; invalid mappings reject before SQL; exact strings; saturated/malformed results stay incomplete; allowed/denied demo runs |
| Policy / POL-01 | Explain the current caller's proposed operation using existing enforcement evaluators | Scope, ceiling, deny rule, target, feature, real package and SAP authority reported separately; unknown prerequisites never become permission; no mutation |
| Syntax / SYN-01 | Bounded native multi-object syntax check | Per-object deterministic outcomes; missing, duplicated or unattributed reports cannot pass; observed release contracts |
| Feeds / FEED-01 | Target-specific dump schema and typed filters | Discovered attributes/operators, grammar validation, old user/date inputs retained, no broadened result/page/time limits |
| Dictionary / DDIC-01 | Advertised activation-log GET with bounded hierarchy | Canonical same-target link, unsupported/denied states, retrieval time separate from unknown activation time; no claim of latest-attempt correlation |
| Historical research | Investigate the most frequent pilot coverage gaps | Capture existing historical pairs and ownership if available; otherwise document exact gaps and resume conditions, with no guessed adapter |

## Notebook plan review

| Question | Decision |
|---|---|
| Another query or authentication engine? | No. Call the existing dispatcher via the configured CLI runtime; SQL/data gates remain authoritative. |
| Full editor or parameter substitution? | Neither is needed. Import and explicit execution deliver the useful workflow without either contract. |
| Can a capped detail result prove a whole-data assertion? | No. Use a separate scalar aggregate query and keep its outcome separate from detail completeness. |
| Is the prototype's regex sufficient to establish aggregate semantics? | Revalidate it; reject uncertain projections, comments, grouping, subqueries and paging rather than falsely certifying a scalar assertion. |
| Are arbitrary imported fields executable? | No. Preserve unknown JSON as document data; execute only validated SQL cells, never destination URLs or stored results. |
| Are successful rows enough? | No. Validate row counts, column correspondence, totals and response bounds. Preserve exact returned strings. |
| Are results saved by default? | No. Save execution metadata; require explicit result export. HTML escapes SQL, Markdown, messages and data. |
| Can one notebook produce unbounded work? | Bound document/cell/row/response/output sizes, sequential calls and total run duration; cancellation must reach in-flight requests. |
| Do imports or runs overwrite evidence? | No. Reserve new private output paths before execution; bound reads before parsing. |

## Policy and diagnostic plan review

Reuse shared decisions and resolve only supported prerequisites. The explanation must not enumerate
another user's grants, expose credentials or resolve a denied target. Creation, structural ownership,
SQL lineage and complex actions need explicit unresolved states unless the real enforcement path
can be reused safely. An ARC-1 allowance never certifies SAP authorization or future execution.

For diagnostics, first replay the existing captures and re-probe the advertised contracts. Keep
syntax separate from ATC/Unit, feed metadata separate from incident content, and old DDIC logs
separate from a current activation attempt. Prefer a small focused module for each contract.

## Validation loop

1. Write regression tests for the prototype's actual gaps before correcting them.
2. Run focused tests, then the full unit suite, typecheck, build, Biome, policy/schema/file budgets
   and strict documentation build on stable files.
3. Run bounded read-only checks on authorized SAP test systems; record exact source revision,
   release, route, result and missing scenarios. Never manufacture fixtures through SAP writes.
4. Review the complete diff and roadmap, create a draft PR, then request the exact-revision Claude
   GUI review. Evaluate each finding, fix valid issues, retest and obtain a final review when changed.
5. Record independent checks honestly. Pending CI and skipped live tests are not passing coverage.

## Progress

- [x] Transport pilot: eight existing requests; Dictionary and non-source text scope prioritized.
- [x] Bounded historical investigation: no verified pair; keep adapters deferred (FEAT-86).
  See diagnostic draft #1011 for the 15-request probe and exact stop condition.
- [x] Notebook runner, tests, docs, live run and three independent review rounds (#1009).
- [ ] Policy explanations, parity tests, docs, live read-only check and independent review.
- [ ] Verified syntax/feed/DDIC diagnostics, tests, docs, live checks and independent review.
- [ ] Final preservation check and links to all draft PRs and evidence.
