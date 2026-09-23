# Multi-Target 1.0 Release Hardening

## Status

- **State:** implemented and validated
- **Base:** `origin/main` at `299c5dfcfe05900318cd058caedcc77d67072e3c`
- **Scope:** close the final multi-target review findings without changing the existing endpoint,
  authorization, identity, or read-only behavior

## Goals

1. Make the approved `SAPDiagnose` surface explicit and fail closed when general diagnostics evolve.
2. Align the developer guide, normative v1 plan, and ADR lifecycle with the implementation on `main`.
3. Restore a warning-free strict MkDocs build without suppressing validation.
4. Preserve single-target behavior and every currently documented mutation-free multi-target action.

## Non-Goals

- Enabling multi-target writes, activation, Git, or mutating transport actions.
- Adding user-specific target discovery or availability caching.
- Changing destination discovery, route syntax, Principal Propagation, or shared Basic constraints.
- Removing currently documented diagnostic reads from existing deployments.

## Implementation

### 1. Fail-closed diagnostic surface

- Add `SAPDiagnose` to the explicit multi-target action rules in
  `src/server/multi-target-tools.ts`.
- Start from the action enum currently produced on `main` and retain only the reviewed
  mutation-free actions. Continue to let the existing action policy and target safety config apply
  data and SQL gates.
- Replace subset assertions with exact action-enum assertions for both the default and data-enabled
  configurations. A future diagnostic action must require an intentional allowlist and test update.
- Keep direct invocation rejection and schema pruning driven by the same rule.

### 2. Contract and lifecycle alignment

- Correct `docs/dev-guide.md`: ATC and ABAP Unit are workload-producing reads that are available by
  default and can be denied with `SAP_DENY_ACTIONS`.
- Update the normative v1 plan to list the full approved diagnostic surface and remove obsolete
  implementation-branch/live-pending wording.
- Mark ADR-0006 and ADR-0007 as accepted experimental exceptions. Their default-off and
  mutation-free constraints remain normative.

### 3. Strict documentation validation

- Convert links from the public `docs_page` tree to repository-only `docs`, plans, ADRs, and
  `AGENTS.md` into stable GitHub links, because those files are outside MkDocs' `docs_dir`.
- Correct stale same-page and cross-page anchors to the headings MkDocs actually emits.
- Do not use warning suppression, validation downgrades, or ignore lists.
- Add a `docs:build` package script for the strict build so local and CI usage share one command.

## Validation

- Focused multi-target tool, route, policy, registry, runtime, destination, XSUAA/MTA, and error tests.
- Exact tool-surface regression test demonstrating that an unreviewed diagnostic action is omitted.
- `npm run build`, `npm run typecheck`, `npm run lint`, and the full unit suite.
- `npm run docs:build` with zero warnings.
- `npm pack --dry-run --json --ignore-scripts`, confirming the multi-target runtime is packaged.
- Final diff review for accidental changes to single-target `/mcp`, discovery, or identity handling.

## Plan Review

- **Compatibility:** explicit allowlisting uses the currently exposed action set, so existing clients
  do not lose an approved action.
- **Security:** the operation-type safety ceiling remains the final structural mutation guard; the
  new allowlist adds a second, evolution-focused review gate.
- **Documentation:** lifecycle status becomes `Accepted — Experimental`; this acknowledges the
  merged decision without implying feature parity or removing the default-off warning.
- **Scope control:** repository-wide MkDocs warnings are included only because the 1.0 review found
  that strict validation cannot currently pass. Repairs change link destinations, not documentation
  semantics.
