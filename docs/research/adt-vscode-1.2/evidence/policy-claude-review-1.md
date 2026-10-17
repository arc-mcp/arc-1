# Claude review 1 — arc-mcp/arc-1 PR #1010 (current-caller policy explanations)

| | |
|---|---|
| PR | Draft PR #1010, stacked on #1009 |
| Reviewed commit | **`6a964ad5f3a3a1a9e160818e57e879b56bcbca1b`** (`feat: explain current caller policy without executing proposals`; single commit) |
| Base | `ce1537fcab0b3d786a2b13ad1923378ec2beb111` (PR #1009 head) |
| Worktree | `/Users/marianzeis/.codex/worktrees/policy-explanations/arc-1`, clean at `6a964ad5` on `codex/policy-explanations`. Only the commit was reviewed; no uncommitted notebook files were read. |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Read-only. I read the 26-file diff and the real gates: `handleToolCall` scope/deny/validation order, the hyperfocused delegator, multi-target request preparation and invocation decisions, safety evaluators, the package-enforcement path, tool-list pruning, and handlers that run internal SQL. I tested `git archive` exports in scratch space; the lockfile is unchanged, so I reused installed dependencies. HTTP was stubbed offline. I did not modify the worktree or the b945 prototype, did not call SAP or use credentials, and published or merged nothing. |
| Read | `AGENTS.md`, `docs/dev-guide.md` (auth/scope rows), `docs/security-model.md`, `docs_page/roadmap.md`, `docs/plans/2026-10-17-policy-explanations.md`, `docs/research/2026-10-17-policy-explanation-validation.md`, `docs_page/authorization.md` (new section), multi-target docs and plan diff |

Line numbers refer to `6a964ad5`.

## Verdict

**Request changes. There are three must-fix findings.** Two produce a false `allowed`, the most
harmful result for a policy explainer: the proposal is described as passing every ARC-1 check, but
executing it would be refused by ARC-1. The third reveals admin policy details to under-scoped
callers beyond what execution or `tools/list` reveals. All three have small, local fixes.

The rest of the design is sound:

- no proposed handler is ever invoked;
- the only SAP access is one gated metadata GET;
- scope, deny, target-grant, multi-target ceiling, transport/Git and package decisions reuse the
  real evaluators with the same normalization and action key;
- there is no grant enumeration;
- the three schema surfaces are in sync;
- the code is compact.

| # | Type | Severity | Finding |
|---|---|---|---|
| M1 | **Must-fix** | Medium | False `allowed` for reads whose handlers require free SQL or data preview beyond their `ACTION_POLICY` operation type (`SAPRead type=SOBJ`, `SAPNavigate action=hierarchy`) |
| M2 | **Must-fix** | Medium | False `allowed` in hyperfocused mode: the explanation ignores the delegator's own `SAP.<action>` deny keys and refuses `proposedTool: "SAP"` |
| M3 | **Must-fix** | Low-Medium | Under-scoped callers learn deny-rule membership and server safety flags for actions outside their scope, which execution and `tools/list` hide |
| R1–R5 | Recommendations | Low | Ceiling-versus-profile exposure, `target` inside proposals, unrecognized-key note, hyperfocused docs, regression tests |

---

## Must-fix findings

### M1 — False `allowed` for reads that run internal SQL (Medium)

**Behavior.** With the default safety ceiling (`allowFreeSQL=false`, `allowDataPreview=false`):

| Proposal | Explanation | Real execution through `handleToolCall` |
|---|---|---|
| `SAPRead {type:"SOBJ", name:"BUS2032"}` | `decision: "allowed"` | `Operation 'RunQuery' (type F) is blocked by safety configuration (reason: allowFreeSQL=false)` |
| `SAPNavigate {action:"hierarchy", name:"ZCL_DEMO"}` | `decision: "allowed"` | `Class hierarchy requires data access permissions. Enable free SQL … or table preview …` |

Neither real call reached SAP (the stubbed HTTP log is empty), so these are pure ARC-1 refusals
the explanation should predict.

**Cause.**

- `policy-explanation.ts:90-91` and `:135-140` evaluate safety, and add the `dataSources` caveat,
  only for the action's `ACTION_POLICY` operation type.
- `SAPRead.SOBJ` has no policy entry and falls back to `SAPRead: Read` (`policy.ts:59`), yet
  `read.ts:879-916` always calls `client.runQuery` (FreeSQL) on `SWOTLV`.
- `SAPNavigate.hierarchy` is `Intelligence` (`policy.ts:131`), yet `navigate.ts:164-171` refuses
  unless FreeSQL or Query is allowed.

The explanation therefore turns a known execution-time prerequisite into “allowed”. That
contradicts the plan (“unknown prerequisites never become permission”) and the acceptance criterion
of SQL/data parity. Optional enrichments (TRAN program name, where-used interface implementers)
degrade gracefully and are not affected.

**Reproduction:** `claude-review-1-checks/zz-policy-sql-reads.test.ts` (P6).

**Suggested fix (small, no policy-matrix change).** Keep the runtime scope matrix untouched. In the
explainer, list the handler-level SQL prerequisites next to the existing SQL caveat. For example,
`SAPRead.SOBJ` needs FreeSQL, and `SAPNavigate.hierarchy` needs FreeSQL or Query. Evaluate them with
`isOperationAllowed(client.safety, …)` as the handlers do, report `denied` when neither is allowed,
and add the `dataSources` caveat otherwise. A one-line comment in each handler pointing back to that
list keeps them in sync. (Changing `ACTION_POLICY` instead would alter scope enforcement and tool
pruning; do not do that here.)

### M2 — False `allowed` under hyperfocused delegator deny rules (Medium)

**Behavior.** With `SAP_DENY_ACTIONS=SAP.read` (a valid key; `ACTION_POLICY` defines `SAP.read`,
`SAP.write` and so on at `policy.ts:238-252`):

| Call | Result |
|---|---|
| Real hyperfocused call `SAP {action:"read", type:"PROG", name:"ZREPORT"}` | `Action 'SAP.read' is denied by server policy (SAP_DENY_ACTIONS).` |
| `explain_policy` for `SAPRead {type:"PROG", name:"ZREPORT"}` | `decision: "allowed"` |
| The same explanation requested through the hyperfocused tool (`SAP {action:"diagnose", params:{action:"explain_policy", …}}`) | `decision: "allowed"` |
| `explain_policy` with `proposedTool:"SAP"` | refused: `Propose one built-in intent tool and its arguments.` |

**Cause.** Dispatch evaluates a hyperfocused call in two layers. First comes scope and deny for the
delegator key `SAP.<action>`. Then `dispatch.ts:667-681` re-dispatches the expanded intent call
through `handleToolCall` with its own gates. The explainer refuses `SAP` (`policy-explanation.ts:25`)
and evaluates only the intent key (`:44`), so a delegator-level deny is invisible. Scope happens to
match today (`SAP.query` and `SAPQuery` both need `sql`, for example); deny rules do not.

**Reproduction:** `claude-review-1-checks/zz-policy-review.test.ts` (P1).

**Suggested fix.** Accept `proposedTool:"SAP"` by expanding it with `expandHyperfocusedArgs`, the
same function dispatch uses. Evaluate `SAP.<action>` scope and deny first, then explain the
expanded intent call. When `config.toolMode === 'hyperfocused'` and an intent-form proposal
arrives, also apply the delegator key for the matching hyperfocused action, since that is the only
path the caller has. Add one regression for each form.

### M3 — Policy details revealed to under-scoped callers (Low-Medium)

**Behavior.** Take a `read`-scoped caller, a server with `allowWrites=true` and
`SAP_DENY_ACTIONS=SAPWrite.delete`:

- **Real `SAPWrite delete`:** `Insufficient scope: 'write' required for SAPWrite(action="delete").
  Your scopes: [read]`. Dispatch checks scope first (`dispatch.ts:903-934`, deny follows at `:937`)
  and stops; the deny list and safety flags are never mentioned.
- **The same caller's `explain_policy`:** `scope: denied`, plus `denyRule: denied`,
  `serverCeiling: allowed` and `effectiveSafety: allowed`.

For this caller the explanation reveals that the administrator denies `SAPWrite.delete` and that the
server permits writes. `tools/list` hides both: `server.ts:770-782` prunes by scope before deny
rules, so a read-only caller never sees SAPWrite actions. The plan asks for no policy leaks, and
dispatch already orders scope first so details don't reach unauthorized callers (see its comment at
`dispatch.ts:903`).

**Reproduction:** `zz-policy-review.test.ts` (P2).

**Suggested fix.** Mirror the real order for disclosure. When `scope` is `denied`, report the
remaining checks as `not-evaluated` (or omit them), and skip the metadata read as today. Callers who
hold the scope keep the full per-gate explanation the plan intends.

---

## Recommendations (not must-fix)

**R1 — Server ceiling versus profile restriction.** A write-scoped caller whose API-key profile
blocks writes sees `serverCeiling: allowed` and `effectiveSafety: denied` (P3). Real execution
reports only the effective reason. This exposure is deliberate in the plan (“separate configured
ceiling and effective caller safety”) and helps administrators. Consider showing `serverCeiling`
only to `admin` or local callers, and summarising it as “restricted for this caller” otherwise.

**R2 — `target` inside a proposal.** On aggregate endpoints, callers naturally copy their call,
including `target`. The strict schema then yields `arguments: unresolved` with the note
`Invalid proposed fields: (proposal).` (P5). The note shows `(proposal)` because Zod reports an
unrecognized key at the object level. Suggestions:

- list `issue.keys` for `unrecognized_keys` issues;
- either ignore a `target` equal to the selected target, or say in `authorization.md` that
  `proposedArgs` must omit `target`.

**R3 — Hyperfocused discoverability.** The `SAP` tool description does not mention
`explain_policy`, and `authorization.md` doesn't describe the hyperfocused form. After M2, add one
sentence to the docs.

**R4 — Tests.** Add regressions for M1–M3. The current parity tests cover scope, slash types, deny
patterns, SQL/data via `opType`, transport/Git and multi-target ceilings well. They don't cover
handler-level SQL gates or the hyperfocused delegator, which is where the false `allowed` results
come from.

**R5 — Feature gate wording.** `git` is always `unresolved`, as is any feature without cached
evidence. That is honest, but it means a SAPGit read can never be `allowed`. Worth one sentence in
`authorization.md`.

---

## Verified as correct

- **No execution, narrow reads.** For a fully allowed `SAPWrite delete PROG ZX` (`allowWrites`,
  write scope, packages `$TMP`), the only SAP call is `GET /sap/bc/adt/programs/programs/ZX`. The
  actual package `ZPKG` is denied, and there is no POST, PUT, DELETE or lock (P4). The read happens
  only after every local gate passes and only when a package list is configured. That matches
  `enforceAllowedPackageForObjectUrl` (`write-helpers.ts:934-950`), which also reads before
  `checkPackage`. Hierarchy rules stay `unresolved`. A supplied `package` is never trusted.
  Creation, includes, groups and `objectUrl` stay unresolved.
- **Same normalization and key as dispatch.**
  - `normalizeTypeArgsForValidation` (which already includes `stripLlmEmptyValues`) then
    `invocationPolicyKey`.
  - `tadir_lookup` with `source:"db"` correctly requires `sql`; the explanation agrees with the real
    `Insufficient scope: 'sql'` (P5).
  - Scope uses the same `policy.hasRequiredScope` with scope implications.
  - Deny uses the same `isActionDenied`.
  - The multi-target ceiling uses the same `multiTargetInvocationDecision` the aggregate route calls
    after deleting `target` (`multi-target-server.ts:527-575`).
- **Transport and Git gates.** `checkTransport` skips the allowlist for an empty ID, so `list`
  matches. The explainer's transport/Git notes are generic and never echo `allowedTransports`.
- **No identity or grant leakage.** The output never echoes the proposal, scopes, tokens, user
  names, grant lists or backend bodies. `targetGrant` reports only the current target.
  Package-resolution failures produce a generic note.
- **Bounds and validation.**
  - The 64 KiB cap is enforced in both the Zod schema and the helper.
  - Extra fields are rejected for `explain_policy`, and `proposed*` fields are rejected for other
    actions.
  - Plugin and unknown tools are refused (P5).
- **Schema sync.**
  - `tools.ts`, `schemas.ts` and the handler agree.
  - Seven tool snapshots were updated.
  - The multi-target derived `SAPDiagnose` keeps `explain_policy`, `proposedTool` and
    `proposedArgs` (`mt-schema.mts`).
  - Hyperfocused mode reaches the action through `params`.
  - The schema budget passes.
- **Docs and roadmap.**
  - `authorization.md` states that the proposal is never executed and SAP authority is not
    certified.
  - The multi-target table, plan and routing rows are updated.
  - FEAT-88 is narrowed consistently (P3 / M / Needs research in the overview and details).

## Checks run (scratch export of `6a964ad5`, Node 22.21.1)

| Check | Result |
|---|---|
| Full unit suite, `--maxWorkers=4` | **320 files / 8,990 tests passed**, 95.2 s |
| `npm run typecheck` | pass |
| `biome check .` | pass |
| `npm run build` | pass |
| `npm run validate:policy` | pass |
| `npm run docs:build` (strict) | pass |
| `npm run check:sizes` | pass (file-size ratchet ran in a throwaway `git init` inside scratch, deleted afterwards: 672 files within budget; tool schema budget within limits) |
| Reviewer checks `zz-policy-review.test.ts` (P1–P5), `zz-policy-sql-reads.test.ts` (P6), `mt-schema.mts` | reproduce the behavior described above |

Files: `/Users/marianzeis/.codex/reviews/arc1-policy-review-20261017/claude-review-1-checks/`.
Put the tests under `tests/unit/`; run `npx tsx mt-schema.mts <checkout-root>`.

## Limitations

- No SAP calls; the four live A4H explanations are Codex's records. HTTP and XSUAA behavior is
  exercised with local tests and stubs only.
- Node 22.21.1; Codex used Node 24.
- I did not attempt an exhaustive audit of every handler-level prerequisite. M1 lists the two
  refusal paths I found by tracing every internal `runQuery`/`runTableQuery`/`getTableContents`
  call site; the others are policy-typed `Query` actions or optional enrichments.
- The uncommitted notebook follow-up files were not reviewed, as instructed.

## Final verdict

**Request changes for PR #1010 at `6a964ad5f3a3a1a9e160818e57e879b56bcbca1b`.** Fix:

- **M1:** handler-level SQL/data prerequisites must not produce `allowed`;
- **M2:** hyperfocused delegator deny keys must be evaluated, and `SAP` proposals expanded;
- **M3:** do not reveal deny rules or server ceiling flags to callers who lack the action's scope.

Each fix is a few lines in `policy-explanation.ts` plus a regression test. R1–R5 are optional.
