# Native partial SHLP metadata

## Contract

Add on-prem `SAPRead(type="SHLP")` and, after the reader is tested, `SAPContext(type="SHLP")`
(default or deps). Both return the same active-only partial interface metadata. One native
Element Info GET supplies description, optional package and parameters with import/export flags.
Missing headers, collective assignments, positions/defaults and appends stay explicitly unknown.
An unnamed 200 becomes an MCP error, never a successful empty definition.

Reject inactive/auto and source-only options before network access. Normalize SHLP/DH with cited
native evidence, refuse generic source URLs for SHLP, and leave SHLP/DHF unsupported. No writes,
SQL/data fallback, extra enrichment requests, new cache, configuration switch or execution helper.

## Sequence and acceptance

1. Baseline existing discovery/registry/alias tests. Add failing fixture-backed parser and real
   transport/handler tests before implementation.
2. Implement a focused typed reader and exact discovery-presence accessor. Reuse existing caller
   identity, read safety, streaming byte budget, attempt budget and cancellation. Bound calls to
   2 MiB decoded bytes, four HTTP sends and 15 seconds (or an earlier caller deadline).
3. Integrate SAPRead registry/schema/handler, descriptions and reviewed snapshots. Validate options
   before editable/diff/draft routing. Known absent discovery refuses; unknown tries the fixed GET.
4. Reuse the tested reader for SAPContext without source compression, KTD reads or dependency fanout.
5. Run focused and full unit tests, typecheck, lint, policy validation, build and size/schema budgets.
   Smoke-test the actual dispatcher on SAP 750 and 758 with existing identities and all data/write
   gates closed. Review the final diff for semantic accuracy, identity isolation and unsafe fallbacks.

## Research inputs

Live research on 750/758 established named SCUSTOM/SFLIGHT/SFLIGHT_COMPLEX and namespaced helps,
presence-only discovery (no Accept entries), false import flags, absent package on 750, French
requests returning English-identical content, and unnamed 200 responses. Curated XML fixtures and
the SHLP type evidence retain the relevant inputs; large exploratory source captures remain local.
The prior spike passed 39 tests and 116 existing transport tests; production tests remain required.

## Remaining qualification

No claim of complete definitions, effective appends, inactive content, BTP, or live restricted-user/
principal-propagation qualification. Local proxy/identity tests cover ARC-1 behavior, not SAP role
configuration. Roadmap work must retain these gaps rather than mark the whole research idea done.

## Execution

- Started from refreshed main `5530aca00` in an isolated `codex/shlp-native-metadata` worktree.
- Research artifacts and unrelated changes in the original checkout are preserved.

- Added failing production fixture/parser and real HTTP handler tests before implementing the reader.
- Rebased onto `90abdfc3`; preserved both adjacent AGENTS task rows when resolving the sole conflict.
- Full unit suite after rebase: **383 files, 10,621 tests passed**. The first full run caught an import-order
  regression: schema validation imported transport code. Pure name/input validation now lives in
  separate modules; all affected tests and the complete suite pass.
- `typecheck`, `lint`, `validate:policy`, `build`, `check:sizes` passed. Lint retains two existing
  informational diagnostics outside this change. No tool wire/token budget increased: largest
  standard schema is 74,946 / 75,000 bytes. Five on-prem snapshots reviewed; BTP snapshots unchanged.
- Durable `tests/integration/shlp.integration.test.ts`: **7/7 passed separately on SAP 750 and 758**,
  with write/data/SQL gates closed. Positive SCUSTOM and SFLIGHT_COMPLEX, unavailable names through
  both tools, and pre-network inactive refusal. One initial discovery connection timed out;
  subsequent runs passed, and that failed attempt is not counted as successful coverage.
- Separate compiled-dispatcher smoke: **7/7 on each system**, including positive namespaced helps,
  exact one-metadata-GET counts, read scope and zero requests for rejected inactive reads.
- Review checked strict name/identity validation, unknown-vs-false flags, explicit missing fields,
  unavailable-vs-error semantics, discovery without Accept entries, no fallback/cache/fanout,
  existing caller transport and cancellation, source-URL refusal and on-prem-only registration.
- Live checks are read-only. No SAP objects or business data were changed. Full definitions/appends
  remain FEAT-97 research work, rather than being implied by this partial metadata support.

To rerun the durable live suite with existing `TEST_SAP_*` credentials:

```sh
npx vitest run --config vitest.integration.config.ts tests/integration/shlp.integration.test.ts
```
