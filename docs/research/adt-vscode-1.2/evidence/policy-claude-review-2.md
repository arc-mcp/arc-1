# Claude review 2 — final policy review of arc-mcp/arc-1 PR #1010

| | |
|---|---|
| Reviewed commit | **`83d021467993e5802a15ec1e737c45a080290518`** (`fix: align policy explanations with dispatch and disclosure gates`) |
| Parent | `2c468957678c54f0945651b17bea01eefe35eb6f`: a normal merge of the notebook fix `2f8c6600` into `6a964ad5`. Its delta has the same `git patch-id --stable` (`3714d53a…`) as `ce1537fc..2f8c6600`, so it contains only the notebook fix and is excluded here, as requested. |
| Compared with | `6a964ad5f3a3a1a9e160818e57e879b56bcbca1b` (reviewed in [review 1](claude-review-1.md)) |
| Worktree | `/Users/marianzeis/.codex/worktrees/policy-explanations/arc-1`, clean at `83d02146` on `codex/policy-explanations` |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only. Policy delta `2c468957..83d02146`: 8 files (`policy-explanation.ts`, `hyperfocused.ts`, two sync comments in `read.ts`/`navigate.ts`, tests, `authorization.md`, the validation log and the archived review 1). I tested a `git archive` export with HTTP stubbed offline. No shared edits, SAP calls, credentials, publishing or merging. |

Line numbers refer to `83d02146`.

## Verdict

**Approve. There are no must-fix items.** M1, M2 and M3 are fixed, and through the real dispatcher
each explanation now matches the actual gate outcome. R1's contract is implemented as agreed, and
R2–R5 are covered.

I found one low-severity residual (N1): an explicit `SAP` proposal on a multi-target connection is
explained as `allowed`, although that connection refuses the `SAP` tool. A validated one-line fix is
attached; I recommend it but do not consider it blocking.

## Review-1 findings: verification

All checks run through `handleToolCall`, comparing each explanation with the real call
(`claude-review-2-checks/zz-policy-final.test.ts`).

### M1 — handler-level data prerequisites: fixed

`policy-explanation.ts:125-140` adds a `handlerData` check. SOBJ requires FreeSQL; hierarchy
requires FreeSQL or Query. It reuses `isOperationAllowed` on both the ceiling and the effective
safety, and it keeps `dataSources: unresolved`. There is no `ACTION_POLICY` change.

| Safety | `SAPRead SOBJ` explanation / real | `SAPNavigate hierarchy` explanation / real |
|---|---|---|
| none | `denied` / denied (`allowFreeSQL=false`), no SAP call | `denied` / denied (“requires data access permissions”), no SAP call |
| free SQL | `unresolved` / reaches SAP | `unresolved` / executes |
| data preview only | `denied` / denied | `unresolved` / executes |

Every combination matches the handlers. A read never becomes an unconditional `allowed`, because
lineage stays uncertain.

### M2 — hyperfocused delegator layer: fixed

How the delegator layer is applied:

- **Explicit `SAP` proposals** validate against `SAPHyperfocusedSchema`, then expand with the
  dispatcher's own `expandHyperfocusedArgs` (`:35-45`).
- **Scope:** the delegator scope must pass before the intent scope applies (`:55-64`).
- **Deny rules:** `delegatorDenyRule` uses `isActionDenied('SAP', action)` (`:72-75`).
- **Intent proposals on a hyperfocused connection** get the same layer through the new
  `resolveHyperfocusedAction` (`hyperfocused.ts:49-52`).

With `SAP_DENY_ACTIONS=SAP.read`:

| Case | Explanation | Real |
|---|---|---|
| Hyperfocused connection, intent `SAPRead` | `denied` | `SAP {action:"read"}` denied by `SAP.read` |
| Hyperfocused connection, explicit `SAP` | `denied` | same |
| Explanation requested through `SAP {action:"diagnose", params:{action:"explain_policy",…}}` | `denied` | same |
| Standard connection, intent `SAPRead` | `allowed` | `SAPRead` executes; `SAP.read` does not apply to the intent path |
| Standard connection, explicit `SAP` | `denied` | `SAP` route denied |
| Unknown hyperfocused action / unknown extra field | clear errors | — |

Combined scope also matches the recursive dispatch:

- a `read`-only caller proposing `SAP {action:"transport", params:{action:"create"}}` sees only
  `scope: denied, Requires transports.`, matching the real `Insufficient scope: 'transports'`;
- `read`+`write` proposing `SAP {action:"query"}` sees `Requires sql.`, matching the real
  `Insufficient scope: 'sql' required for SAP(action="query")`.

### M3 — disclosure before scope: fixed

`:64` returns the report immediately after a scope denial. A `read` caller asking about
`SAPWrite delete`, in intent or `SAP` form, now receives only `{scope: denied, "Requires write."}`.
No deny-rule, ceiling or feature state is reported, and no metadata is read.

### R1–R5

- **R1 (configured versus effective ceilings):** shown only to callers who pass the scope check.
  A write-scoped caller with a write-blocking profile still sees `serverCeiling: allowed` and
  `effectiveSafety: denied`, as the agreed troubleshooting contract intends.
- **R2:** an unknown field is named in the note (`Invalid proposed fields: target.`), and
  `authorization.md` says to omit `target` from `proposedArgs`.
- **R3:** the hyperfocused call form and `proposedTool:"SAP"` are documented.
- **R4:** regression tests were added; the policy test file now covers M1–M3.
- **R5:** the Git capability caveat is documented.

### Unchanged guarantees, re-verified

- A fully allowed `SAPWrite delete` still performs exactly one metadata
  `GET /sap/bc/adt/programs/programs/ZX`, after which the actual package `ZPKG` is denied. There is
  no POST, PUT, DELETE or lock.
- The proposal is never executed, and the output never echoes the proposal, tokens, scopes, grants
  or backend bodies.
- The archived `evidence/policy-claude-review-1.md` is byte-identical to my report.

## Residual finding (recommended, not blocking)

### N1 — An explicit `SAP` proposal on a multi-target connection is explained as `allowed` (Low)

**Where.** `policy-explanation.ts:84-90`. For an explicit `SAP` proposal, `targetCeiling` is
evaluated on the expanded intent tool. The multi-target route gate evaluates the tool actually
called. Because `MULTI_TARGET_TOOLS` does not contain `SAP`, that gate returns `forbidden`, and a
real `SAP` call on a pinned or aggregate endpoint is refused with
`MULTI_TARGET_OPERATION_FORBIDDEN` before any SAP access.

**Reproduction** (`claude-review-2-checks/zz-policy-mt-sap.test.ts`): with `targetId` set, the
explicit `SAP {action:"read"}` proposal returns `decision: "allowed"` with `targetCeiling: allowed`,
while `multiTargetInvocationDecision('SAP', …)` returns `forbidden`. The intent `SAPRead` proposal is
correctly `allowed`.

**Impact.** The input is contrived: multi-target connections never list the `SAP` tool, and the
real call fails closed. The explanation is still inaccurate for the route the proposal names.

**Fix (validated):** `claude-review-2-checks/suggested-multi-target-sap.diff`:

```diff
-      : multiTargetInvocationDecision(tool, args, config) === 'allowed'
+      : input.proposedTool !== 'SAP' && multiTargetInvocationDecision(tool, args, config) === 'allowed'
```

With it, the `SAP` proposal on a multi-target target becomes `denied`, intent proposals are
unchanged, and 45/45 tests pass: the PR's policy and multi-target suites plus my checks.

## Out-of-scope observation (pre-existing, not part of this PR)

In hyperfocused mode, built-in intent tools remain directly invocable (`dispatch.ts:1013-1016`
excludes only plugin tools). A `SAP.<action>` deny rule therefore stops the delegator path but not a
direct `SAPRead` call from a client that knows the intent names. Intent-level rules such as
`SAPRead` or `SAPRead.PROG` cover both paths, because the delegator re-dispatches through them.

This predates the PR, and the explainer's conservative choice (adding the delegator layer on
hyperfocused connections) is safe. It may deserve a sentence in the `SAP_DENY_ACTIONS` docs, or a
separate decision on whether a hyperfocused server should accept unlisted intent tools.

## Checks run (scratch export of `83d02146`, Node 22.21.1)

| Check | Result |
|---|---|
| Full unit suite, `--maxWorkers=4` | First run: 9,004 passed, 1 failed (`tests/unit/server/shutdown.test.ts`, real-SIGTERM audit delivery, 5,048 ms, a known load-sensitive test unchanged by this PR). That file then passed alone twice (12/12). Clean rerun: **320 files / 9,005 tests passed**, 99.4 s. |
| `npm run typecheck` | pass |
| `biome check .` | pass |
| `npm run build` | pass |
| `npm run validate:policy` | pass |
| `npm run docs:build` (strict) | pass |
| `npm run check:sizes` | pass (file-size ratchet in a throwaway `git init` inside scratch, deleted afterwards: 672 files within budget; tool schema budget within limits) |
| Parity checks `zz-policy-final.test.ts` (5 tests) | pass, with the results above |
| Multi-target `SAP` check `zz-policy-mt-sap.test.ts` | reproduces N1; with the suggested diff, 45/45 relevant tests pass |

Files: `/Users/marianzeis/.codex/reviews/arc1-policy-review-20261017/claude-review-2-checks/`.

## Limitations

- No live SAP; the A4H explanation evidence is Codex's record. HTTP, XSUAA, multi-target and PP
  behavior is verified locally with the real dispatcher and stubbed transport only.
- Node 22.21.1; Codex used Node 24.
- The merged notebook changes were not re-reviewed here; see notebook review 2.

## Final verdict

**Approve PR #1010 at `83d021467993e5802a15ec1e737c45a080290518`. There are no must-fix items.**
I recommend the one-line N1 fix with a regression test before merge. The hyperfocused deny-rule
observation is pre-existing and belongs in a separate follow-up, if any.
