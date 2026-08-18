# Plan: deterministic and fail-closed ARC-1 CLI/CI APIs

Status: implementation, repeated live A4H/758 validation, simplification, and independent review
complete — **GO**; draft PR [#703](https://github.com/arc-mcp/arc-1/pull/703)

Companion evidence:
[2026-08-17-cli-ci-api-audit.md](../research/2026-08-17-cli-ci-api-audit.md)

Independent review outcome: the first draft was **NO-GO** because it combined too many mutable Git,
reporting, CLI, and asynchronous-state contracts in one PR. The reviewed plan below incorporates the
P0 changes: compatible flag-only server startup, same-client auth preflight before feature fan-out,
dispatcher-backed check commands, deadline-aware polling, pre-audit URL redaction, explicit legacy
defaults, exact `*` Git authorization semantics, and a reduced Git scope. Full gCTS mutation and
deterministic abapGit import verification are follow-ups, not claims of this PR.

## 1. Goal and acceptance boundary

Make the existing Node/TypeScript CLI a truthful, reproducible CI interface for SAPWrite,
SAPActivate, SAPRead diff, SAPTransport, SAPDiagnose ABAP Unit/ATC, SAPLint, and SAPGit on the same
handler/safety implementation used by MCP mode.

The PR is accepted only when:

1. documented configuration flags work before and after direct subcommands;
2. unknown commands/options fail as usage errors and never enter stdio server mode;
3. a one-shot SAP call has the same discovery/release/feature evidence as server mode;
4. output is fully flushed, stdout remains machine-parseable, and exit codes are deterministic;
5. known write tools reach safety policy even when hidden from advertised tool lists;
6. AUnit cannot execute dangerous or critical tests through the read-scoped API;
7. dedicated CI commands distinguish pass, finding/failure, usage/transport error, and incomplete run;
8. transport release returns success only with terminal CTS evidence (`R`/`N` requests, or a
   released task's accepted-disappearance/terminal-parent evidence);
9. gCTS read wrappers match live/pinned SAP-authored client evidence, while every currently unsafe
   gCTS mutation fails closed with no HTTP mutation;
10. Git actions have an explicit per-action authorization/package matrix and no implicit
    `allowedPackages=[]` escalation;
11. abapGit never presents an empty bridge wrapper or repository linkage as verified object import;
12. credential-like URL/config material is absent from tool and audit output;
13. the built CLI has subprocess tests, and the named live A4H matrix passes with cleanup; and
14. docs show exact-version CI installation, environment-based secrets, exit codes, and report
    formats.

This plan does not claim safe transactional gCTS deployment. That needs staging, affected-object
inventory, authorization preflight, explicit deploy, terminal confirmation, and rollback. It is an
ADR-sized follow-up; gCTS mutations remain unavailable in this PR. Correcting the mutable routes
without that transaction would make the client more capable without making it safe.

## 2. Invariants

### CLI

- `arc1`, `arc-1`, and `arc1-cli` remain aliases of the same entry point; docs prefer `arc1`.
- `serve` remains the no-subcommand default after any valid registered root options are removed, so
  documented `arc1 --url ...` and Docker flag-only startup remain compatible. Unknown tokens never
  select it.
- one authoritative option table drives config parsing and Commander registration.
- CLI precedence remains CLI > environment > `.env` > defaults.
- generic `call` preserves MCP ToolResult semantics.
- domain-aware commands own domain-aware exit policies.
- no immediate `process.exit` occurs inside an async action.
- JSON/report stdout contains no log or audit bytes.

### SAP and safety

- feature evidence is target-local and installed on the exact client used for the operation.
- shared-credential auth preflight runs once on that client before parallel feature probing; a
  blocking 401/403 stops the invocation to avoid account lockout.
- probe failure never fabricates availability.
- AUnit read scope is harmless-only.
- request parameters may narrow a safety ceiling, never expand it.
- success for an asynchronous SAP mutation requires a verified terminal/read-back postcondition.
- every bounded poll propagates a remaining deadline/abort signal to the HTTP request itself; an
  outer loop timer alone is not called a deterministic budget.
- a caller-declared package is not evidence of the packages a Git import will touch.
- empty/missing backend evidence is `unverified` or `incomplete`, never success by implication.
- existing defaults remain read-only and `$TMP`-scoped.

## 3. Phase A — CLI foundation

Primary files:

- `src/cli.ts`
- `src/cli-args.ts`
- `src/server/config.ts`
- `src/server/types.ts`
- a small new CLI runtime/report module if needed
- `bin/arc1.js`, `bin/arc1-cli.js` comments only where stale

### A1. Authoritative root option registration

Create a typed `CLI_CONFIG_OPTION_SPECS` table containing every active long name and its arity/value
kind. It is parse metadata only; `resolveConfig()` remains the single source of defaults,
environment mapping, precedence, validation, and `ServerConfig`. Add a development/test invariant
that every name requested by `getFlag`/`getOptionalFlagValue` is registered, so future config flags
cannot silently become unavailable to Commander.

Registered root options must work on either side of a subcommand. Password/token values remain
accepted for compatibility but are marked unsafe for shell history; CI documentation uses env vars.

Remove permissive `allowUnknownOption`/`allowExcessArguments` from root and default serve. Preserve
only the exact passthrough required by `extract-cookies`. After registered root options are parsed,
zero positional tokens select default serve; a misspelled command or excess positional token is a
usage error. Preserve actionable removed/legacy-flag diagnostics before strict Commander rejection.

### A2. Async entry and exit contract

Export a testable `createCliProgram(deps?)` and `main(argv, deps?) => Promise<number>`. Use
`exitOverride()` plus `parseAsync`; `parseAsync` alone still lets Commander terminate the process.
Actions return/set a result rather than calling `process.exit`. The bin wrapper awaits `main`, while
`main` awaits logger flushing in `finally`, and the wrapper sets `process.exitCode` once.

Base exit codes:

| Code | Meaning |
|---:|---|
| 0 | invocation/domain check succeeded |
| 1 | SAP/tool failure or completed domain check failed |
| 2 | Commander/config/dedicated-command option usage error |
| 3 | domain execution incomplete/non-evaluable (dedicated checks only) |

Commander/config errors map to 2. Generic dispatcher/Zod ToolResult `isError` maps to 1. Report files
are closed before the code is returned. Help/version return 0 without resolving an invalid SAP
configuration.

### A3. Known tools versus advertised tools

Validate tool names against the static registry, not the configuration-filtered advertised list.
Unknown names fail with code 2 without SAP I/O. Known tools always reach dispatcher
authorization/safety; a disabled SAPWrite therefore returns the normal write-gate denial and code 1.

### A4. Direct context parity

Build a real direct context once per invocation for the currently supported single-target
Basic/cookie modes:

- resolved config and safety;
- one `AdtClient`;
- caching layer where enabled, matching server version-warning semantics;
- audit logger and request correlation; and
- target-local feature/discovery evidence.

Extract a same-client auth helper from the existing startup preflight and export the existing feature
probe. Direct bootstrap order is: resolve config -> construct one client -> reject unknown tool ->
run auth preflight -> on success/non-blocking outcome probe features -> install discovery/cache on
that same client -> dispatch. A blocking 401/403 stops before feature fan-out. `SAPManage probe` may
perform its own feature refresh after preflight; local help/version/config/offline lint skip SAP I/O.

On a non-auth probe failure, install empty/unknown evidence and allow the requested operation's
normal fallback where server mode already does so. Authentication/config failures remain errors.
Direct BTP service-key/destination, principal-propagation, and multi-target modes are not silently
treated as Basic parity: either the existing full bootstrap is safely extracted during implementation
review or the CLI returns a clear unsupported-direct-mode error and docs state the limitation.

### A5. Generic output contract

Keep text and current outer ToolResult JSON modes for compatibility, but document that `--output
json` is an MCP envelope and handler JSON may live in `content[0].text`. Dedicated commands still
invoke `handleToolCall`; they request an explicit opt-in structured handler mode and parse that
dispatcher result. They never call ADT helpers directly, so Zod, ACTION_POLICY, SAP_DENY_ACTIONS,
safety, rate/audit hooks, and terminal audit events remain in force.

## 4. Phase B — deadline-aware HTTP requests

Primary files:

- `src/adt/http.ts`
- `src/adt/config.ts` / request option types as needed
- focused HTTP timeout/abort tests

Extend request options with an optional caller `AbortSignal` and/or absolute deadline. Compose it
with the existing per-request timeout without dropping either cancellation source. Before each
network attempt/retry, derive the remaining time; if no budget remains, raise a typed timeout before
sending another request. Retry/backoff must also respect cancellation.

This is a prerequisite for both public AUnit and transport polling. A loop that stops scheduling at
30 seconds is not a 30-second budget if its last HTTP call can independently run past that deadline.
Tests cover pre-aborted signal, abort during fetch, deadline during retry/backoff, existing timeout
compatibility, and preservation of normal callers that omit a signal.

## 5. Phase C — AUnit safety, correctness, and CI reports

Primary files:

- `src/adt/devtools.ts`
- `src/adt/types.ts`
- `src/handlers/diagnose.ts`
- `src/handlers/schemas.ts`
- `src/handlers/tools.ts`
- `src/authz/policy.ts` where the harmless ceiling needs an explicit invariant
- new `src/cli/reports.ts` / `src/cli/checks.ts` or equivalent

### C1. Harmless-only execution ceiling

Change both legacy and public AUnit requests to enable harmless tests and disable dangerous/critical
tests. The public handler does not expose a parameter that can expand this ceiling. Higher-risk test
execution is explicitly deferred until ARC-1 has a dedicated server opt-in plus execute/write
authorization and a reviewed multi-target rule.

Duration remains all categories for compatibility in this PR; duration is workload policy, not the
mutation boundary. The dedicated CLI may narrow it when the selected backend supports it.

### C2. Correct internal result model

Introduce a structured result alongside a temporary legacy adapter:

```ts
type UnitRunOutcome = "passed" | "failed" | "no_tests" | "incomplete";

interface UnitRunResult {
  outcome: UnitRunOutcome;
  summary: {
    tests: number;
    passed: number;
    failures: number;
    errors: number;
    skipped: number;
    warnings: number;
  };
  selection: { maxRisk: "harmless"; durations: string[] };
  tests: UnitTestCase[];
  alerts: UnitAlert[];
  coverage?: UnitCoverage;
}
```

Only method execution elements become test cases. Preserve run/program/class/method alerts with
kind, severity, title/details, stack/location, risk, duration category, and normalized duration.
Class warnings coexist with executed tests and never become synthetic skipped cases. Assertion
alerts map to failures; infrastructure/setup/generation exceptions map to errors; explicit method
abortions may map to skipped only when SAP actually reports a skipped/aborted method.

Outcome rules:

- tests > 0 and failure/error = 0 => passed;
- any assertion/error => failed;
- no tests plus explicit risk/refusal/abortion evidence => incomplete;
- no tests and no diagnostic => no_tests;
- all executable tests skipped => incomplete.

Coverage metrics with `total === 0` are non-measurable. Preserve coverage read errors as structured
evidence rather than silently swallowing them.

### C3. Public async API with bounded polling

Add client operations for:

- harmless endpoint probe;
- create run;
- bounded poll of run status;
- follow the run-result relation; and
- fetch native JUnit bytes.

Prefer this path for JUnit output when available and coverage is not requested. Use the legacy API
for structured coverage and as a release-compatible fallback. Do not infer availability from ADT
discovery because 758 omits it; cache the direct probe as target-local feature evidence.

Polling must have an explicit attempt/time budget, pass the remaining deadline through Phase B, and
return a distinct timeout/incomplete result. Accept only host-relative links under the exact known
`/sap/bc/adt/api/abapunit/runs/` and `/sap/bc/adt/api/abapunit/results/` prefixes; reject absolute
URLs, traversal, and cross-prefix links.

SAP Help documents this API for ABAP Environment. ARC-1 treats on-premise 758 support as empirical
live evidence with a feature probe and legacy fallback, not as a normative cross-release guarantee.

### C4. Dispatcher-backed structured mode and `unittest` command

Add an opt-in `resultFormat: "structured"` to `SAPDiagnose(action="unittest")`; the default remains
the historical array/object payload. The CLI invokes this action through `handleToolCall` and
extracts the structured JSON only after dispatcher success. Native JUnit selection also lives behind
the handler/client path so deny-actions and audit events cannot be bypassed.

Proposed interface:

```bash
arc1 unittest CLAS ZCL_FOO \
  --coverage \
  --min-statement 80 \
  --min-branch 70 \
  --min-procedure 60 \
  --format junit \
  --report-file reports/aunit.xml
```

Formats: `text`, `json`, `junit`. `--report-file -` means stdout. `--allow-empty` may convert only a
genuine `no_tests` to success; it never suppresses refusal/incomplete. `--fail-on-skipped` is opt-in.

Exit policy:

- 0: tests ran, no failure/error, measurable requested gates satisfied;
- 1: assertion/error, breached coverage gate, or dispatcher/SAP/auth/transport/tool failure;
- 2: Commander/config/dedicated-command option validation error;
- 3: no tests (unless `--allow-empty`), all skipped, explicit risk refusal, timeout, or required
  coverage unavailable/non-measurable.

Write/flush JUnit before returning any nonzero code. Native SAP JUnit is passed through only after
its counters are parsed for exit policy; legacy JUnit is generated from the corrected internal
model. Escape all XML data and validate report XML in tests.

### C5. Whole-package AUnit scope

Extend the existing command without adding a second execution path:

```bash
arc1 unittest DEVC ZMY_PACKAGE
arc1 unittest DEVC ZMY_PACKAGE --include-subpackages
```

`DEVC` selects an OSL `packageSet`; exact-package scope is the default and recursion is explicit.
The dispatcher, `OperationType.Test` ceiling, harmless-only risk selection, report formats, coverage
gates, timeouts, and exit codes remain unchanged. `includeSubpackages` is valid only for
`SAPDiagnose(action="unittest", type="DEVC")`; it uses the loose optional-boolean schema so strict
LLM clients cannot turn the string `"false"` into true.

Before execution, resolve repository quick-search rows at the endpoint's hard 1,000-row bound and
retain each row's actual `packageName`. Exact scope filters to the requested package; recursive scope
keeps the returned subtree. Only CLAS, PROG, and FUGR roots feed AUnit because their static includes
and class test include already expand through the source-audit path. Missing canonical URIs, a full
1,000-row response, an unreadable package/source, or a source/include cap makes the evidence
incomplete. Do not silently run a verified-looking subset.

Use two aligned execution contracts:

1. public JUnit: submit SAP's native `osl:packageSet` with the requested recursion flag;
2. legacy/coverage/corroboration: submit one flat object-reference set built from the exact resolved
   CLAS/PROG/FUGR URIs, never the legacy package URI (which is implicitly recursive on A4H/758).

Read the package inventory and every active source tree before the run, then repeat both after it.
Membership, type/name/URI/package, source, absence markers, and ETags must remain stable. Reconcile
the aggregate legacy result against source declarations keyed by program plus test class so common
names such as `LTCL_TEST` in multiple classes cannot satisfy one another. Native/legacy count or
outcome contradictions remain failure/incomplete evidence under the existing rules.

Implementation surfaces:

- `src/adt/aunit.ts`: object-set builder and program-qualified source evidence;
- `src/adt/devtools.ts`: one-or-many legacy object references and aligned coverage query;
- new `src/adt/aunit-package.ts`: bounded detailed package search retaining `packageName` (kept out
  of the near-budget `client.ts` facade);
- `src/handlers/diagnose.ts`: stable package snapshot, bounded source reads, aggregate reconciliation;
- `src/handlers/{schemas,tools}.ts`, `src/cli.ts`, `src/cli-checks.ts`: DEVC option and evidence validation;
- focused AUnit/client/handler/CLI/schema/tool/multi-target tests plus docs and live exact/recursive
  validation.

Plan-review exclusions: do not execute dangerous/critical tests, infer success from native JUnit
alone, use per-object public runs, broaden multi-target write semantics, or claim completeness above
the repository enumeration bound. Those alternatives either break PR 703's safety contract, change
scope semantics, or create avoidable SAP load.

## 6. Phase D — ATC, lint, and diff CI checks

Primary files:

- `src/cli.ts` and new report/check helpers
- `src/handlers/diagnose.ts`, `src/adt/devtools.ts` only if structured ATC extraction is missing
- `src/handlers/lint.ts`
- `src/handlers/read.ts` / diff parser only if a stable structured result is missing

### D1. `atc`

Before adding incomplete exit semantics, extend the structured ATC result to preserve worklist/run
status, processed-object counts, and truncation evidence from SAP. The current request caps verdicts
at 100, so exactly hitting the cap without completeness evidence is incomplete, never clean.

Add a dedicated command that invokes `SAPDiagnose action=atc` through the dispatcher, exposes inputs
already supported by the handler, and emits `text`, `json`, or Checkstyle. Define threshold as
numeric ATC priority: fail when a finding priority is less than or equal to `--max-priority`.
Document and test the Checkstyle severity mapping. Exit 3 for SAP-incomplete/truncated/non-evaluable
runs. Preserve the current generic payload unless `resultFormat: "structured"` is explicitly used.

### D2. `lint`

Keep local lint offline. Add `text`, `json`, and Checkstyle output; explicit/resolved ABAP release;
and a warning failure threshold. With a configured live target, generic `call SAPLint` gains release
parity from Phase A but remains MCP data semantics.

### D3. `diff`

Add:

```bash
arc1 diff PROG ZFOO --from active --to inactive --check
```

Default diff exits 0 whether or not hunks exist. `--check`/`--fail-on-diff` exits 1 on a non-empty
diff. Support revision IDs/URIs already accepted by SAPRead; avoid a second diff engine. Add an
opt-in structured SAPRead result for machine evaluation while preserving current text by default,
and invoke it through `handleToolCall`.

## 7. Phase E — terminal transport release

Primary files:

- `src/adt/transport.ts`
- `src/handlers/transport.ts`
- transport unit/integration/E2E suites

Add a flat parent/task state parser because current `getTransport(taskId)` matches only top-level
request IDs. Read the parent tree once before mutation and freeze the parent plus exactly the original
child task IDs; do not add children discovered later. Preflight `checkTransport`/allowlist
authorization for the parent and every frozen nonterminal child before the first release POST, preventing a
partial release when a later child is denied.

Submit the required task/parent release operations, then bounded-poll one coherent parent-tree GET
and index every frozen ID until all have terminal CTS evidence, passing the remaining Phase-B deadline to every read.
The flat parser must also handle SAP returning a standalone task root for single-task operations. Use
a small capped backoff and a five-minute default budget, configurable per call and internally for tests.
Final terminal evidence is authoritative; release reports remain diagnostics because SAP may fold released
tasks out of the tree or contradict intermediate state. Retain contradictions as conflict evidence. Treat
observed `O`/`P` as in progress, `D`/`L` as modifiable, and `R`/`N` as terminal. These six statuses
are live-confirmed from A4H/758 domain values; other statuses remain unknown and fail closed.

Preserve the current text contract by default. An opt-in structured confirmation contains intended
IDs, last observed statuses, elapsed/poll attempts, and raw reports. A clean report plus deadline and
any nonterminal state is `pending`/`incomplete` with `isError`; it must never say “Released.” An
already-released parent is idempotent only after every intended child is also confirmed terminal.

Unit cases:

- immediate R/N;
- D -> D -> R and P -> L -> N;
- clean report but child remains D until timeout;
- report error followed by terminal R/N;
- GET/read failure;
- unexpected/nonterminal child state at deadline;
- recursive parent and task convergence; and
- already released.

Slow live test asserts parent/tasks are R before the API returns, not several seconds later. Remove
or correct the stale type-W pseudo-test.

## 8. Phase F — Git read contract, fail-closed mutations, and truthful verification

Primary files:

- `src/adt/gcts.ts`
- `src/adt/abapgit.ts`
- `src/handlers/git.ts`
- `src/handlers/schemas.ts`
- `src/handlers/tools.ts`
- `src/authz/policy.ts`
- Git fixtures and unit/integration suites

### F1. Pre-audit and terminal redaction

Extend central `sanitizeArgs` before any handler or `tool_call_start` event: URL values are parsed
best-effort, userinfo is removed, and credential-like query values are redacted. Apply the same
sanitizer to Git success output, response-derived configuration, error messages, response bodies,
and terminal audit previews. Tests prove a sentinel secret is absent from every sink/stdout/stderr
surface, not merely absent from the handler return.

Handler validation still rejects userinfo and non-HTTPS Git URLs. Redaction is defense in depth, not
authorization.

### F2. Exact per-action policy

Document and enforce this initial matrix:

| Backend/action | Scope and server ceiling | Package rule | This PR |
|---|---|---|---|
| gCTS list/config/whoami/branches/history/objects | read | none | enabled, redacted |
| gCTS clone/pull/switch/create_branch/unlink | git + writes + Git writes | explicit `*` would be necessary but is not sufficient | fail closed before mutation |
| abapGit list/check/stage | existing read/git contract, reviewed per action | real repo where applicable | enabled |
| abapGit external_info | git + writes + Git writes (SAP-host egress) | n/a | HTTPS/no-userinfo/literal-private guard |
| abapGit clone/pull/switch/create_branch | git + writes + Git writes | root `/**` or `*`; exact root/`Z*` is not subtree proof | enabled only with honest result semantics |
| abapGit push/unlink | git + writes + Git writes | real repo subtree grant or `*` | enabled with existing operation checks |

`allowedPackages=[]` is retained only for low-level backward compatibility; it never authorizes a
gCTS mutation. gCTS would require an explicit configured `*` even after the transactional design is
implemented. `external_info` is reclassified as egress/mutation-capable because SAP, not the local
Node process, contacts the remote and can follow behavior beyond syntax validation.

### F3. gCTS read contract and mutation quarantine

- parse `{config}`, `{branches}`, and `{commits}` wrappers;
- map live commit fields (`id`, author/mail, message/description, date);
- parse repository list live shapes and reject unknown non-empty wrappers instead of returning `[]`;
- redact sensitive config/repository fields; and
- parse any `log[]` and fail on ERROR severity.

Replace fabricated read fixtures with pinned SAP-authored Project Piper/live wrappers. Treat those as
strong implementation evidence, not a frozen official API specification.

Every gCTS mutation is denied before HTTP with a structured message naming the staged
`VCS_NO_IMPORT`/inventory/deploy ADR requirement. This removes reachability of the currently wrong
flat create, POST pull, and checkout contracts without pretending that merely correcting their URLs
makes package-safe imports. Full create -> clone cleanup, current-branch switch readback, query
contract, and deploy rollback move to the dedicated follow-up PR.

### F4. abapGit honest postcondition

Reject E/A/X response messages. Empty clone/pull `<abapObjects/>` plus repository readback is an
`incomplete` ToolResult with `isError`, not exit-0 `{verified:false}`: linkage proves only the link,
not imported objects. Nonempty S/W rows may be returned as bridge evidence, carefully labeled; they
still do not prove complete repository import or activation. Preserve legacy payloads for read
actions, while mutation responses gain explicit `verified`/`incomplete` evidence because the prior
success claim was unsafe.

Require a package grant covering the entire repository subtree for mutation-capable clone/pull/
switch/create-branch operations: exact `ROOT/**` or global `*`. An exact root or broad sibling prefix
such as `Z*` is not proof of descendant authorization. Load the actual repo before existing-repo
actions and apply the matrix consistently to unlink.

Deterministic expected-object manifest/activation verification is a follow-up. Live abapGit mutation
is not rerun in this PR unless a controlled remote and expected inventory are configured; otherwise
tests use captured contract fixtures and the earlier live evidence is explicitly labeled historical.

### F5. Bounded egress hardening

- reject remote URLs containing userinfo;
- require HTTPS for external Git URLs;
- reject localhost and literal loopback/private/link-local addresses for `external_info`; and
- place `external_info` behind Git authorization and reject HTTP, userinfo, localhost, and literal
  private/link-local IP addresses.

DNS-aware resolution and an administrator hostname allowlist are follow-up work, documented as such;
do not present the literal-address check as complete SSRF protection.

## 9. Phase G — documentation and deliberately small corrections

The query/runtime defects found during the audit are recorded in research but deferred from this
already cross-cutting PR. This phase changes documentation and only implementation details required
by the reviewed CLI contract:

- replace SQL examples containing `INTO @DATA`/target clauses;
- document TABLE_CONTENTS filter/version limitations rather than promising broken behavior;
- clarify that `read` already returns raw text and remove/repurpose the no-op `--flat` flag without
  breaking compatibility;
- explain the outer ToolResult JSON envelope;
- remove duplicate cookie-extraction documentation;
- document exact-version npm CI installation, env-based credentials, gates, exit codes, reports,
  cleanup, and the ADT/API-policy review boundary; and
- update roadmap entries so shipped CLI/report work and deferred gCTS/AUnit-risk work are accurate.

TABLE_QUERY `!=`, TABLE_CONTENTS maxRows/filter, structured-class versioning, and grep-warning
propagation get separate focused follow-ups. They are not opportunistically mixed into this PR.

## 10. Automated-test matrix

### Pure/unit

- argv options before/after command and precedence;
- unknown command/flag, no-command serve, and cookie passthrough;
- no immediate exit / logger and report flush;
- known-hidden tool reaches safety denial;
- feature bootstrap installs release, features, discovery, and cache on the same client;
- bootstrap failure degradation and auth failure;
- HTTP signal/deadline composition and retry cancellation;
- AUnit warning plus methods, assertions, errors, aborts, empty, risk refusal, all skipped;
- coverage measurable/non-measurable and threshold pass/fail;
- public AUnit create/poll/relation/JUnit/timeout/fallback;
- valid escaped JUnit and Checkstyle;
- transport terminal poll matrix;
- exact gCTS read wrappers and rejection of unknown nonempty shapes;
- every gCTS mutation denied before HTTP, including with internal `allowedPackages=[]`;
- abapGit empty wrapper incomplete/error, error messages, readback limits, subtree authorization; and
- URL/config redaction across start/end audit, tool output, stderr, and external-info egress checks.

### Built/packed process smoke

Run `npm run build` in the subprocess-suite setup so ignored `dist/` can never be stale, then run both
canonical `bin/arc1.js` and compatibility `bin/arc1-cli.js` where relevant:

- help/version/tools;
- global options before and after subcommand;
- typo command/flag returns 2 and no MCP JSON;
- generic schema error;
- writes-disabled known-tool denial;
- JSON-only stdout/audit-only stderr;
- large output is complete;
- offline lint and its structured output; and
- packed-tarball resolution through real `npx` for help, version, tools, and offline lint.

The accepted evidence model is deliberately complementary rather than duplicative: dependency-injected
in-process tests own the full AUnit/ATC/diff/lint domain and exit-code matrices; built and packed process
smoke proves the published wrappers, npm bin selection, strict argv, safety denial, stdout/report
behavior, and offline execution; the credential-gated 758 pass below proves same-client bootstrap and
real SAP result semantics. A second fake-SAP subprocess copy of the already dependency-injected domain
matrices is not required for this PR.

### Credential-gated A4H/758 live

Read/safe checks:

- config flag/env precedence without printing secrets;
- feature probe followed by same-process SAPGit read, SAPLint release, and discovery-gated action;
- SAPRead active/inactive/revision/diff;
- TABLE_QUERY predicates/limits;
- harmless AUnit pass, failure, no-tests/risk-filtered result, native JUnit, and coverage;
- bounded ATC and lint; and
- gCTS config wrapper/list reads with redaction.

Controlled mutation lifecycle:

- random `$TMP` program create -> inactive read -> update -> activate -> active read/diff -> delete ->
  verify 404;
- one isolated transport create/release test only when the suite explicitly enables irreversible
  tests, asserting terminal R/N before return;
- abapGit mutation only against a controlled fixture with expected-object assertions and `finally`
  cleanup;
- no gCTS import mutation in this PR;
- no abapGit mutation unless a controlled remote and expected inventory are explicitly configured;
  otherwise the test is intentionally skipped with the reviewed reason, not presented as proof.

Every live test registers exact artifacts before its first mutation, cleans in `finally`, fails if
cleanup fails, and runs a final active/inactive/TADIR/link/repository leak check. Maintain an evidence
ledger of exact object/package/repository/transport IDs, AUnit/ATC run IDs, outcome, and cleanup
status. Released transports are reported as permanent audit records, not treated as deletable
artifacts. Standard SAP objects are not mutation fixtures.

## 11. Implementation sequencing and ownership

1. land CLI runtime seams and bootstrap tests;
2. land same-client auth preflight then feature/discovery bootstrap;
3. land opt-in dispatcher-backed structured handler modes;
4. land HTTP deadline/abort support;
5. land AUnit harmless ceiling/model/public API and report command;
6. land ATC/lint/diff commands;
7. land transport convergence independently;
8. land central URL redaction, exact Git policy, gCTS read fixes/mutation quarantine, and abapGit
   incomplete semantics independently;
9. land documentation corrections;
10. run focused tests after each phase;
11. build, then run full unit/type/lint/subprocess/pack matrix;
12. run credential-gated live reads, then explicitly controlled mutation tests;
13. compare implementation against every acceptance and deferred item;
14. perform security/diff review; and
15. commit, push, and open a draft PR with live evidence, irreversible records, and follow-ups.

Parallel implementation is safe only with explicit file ownership: the CLI/AUnit owner controls
`src/cli.ts`, shared schemas/tools, and docs; transport owns only transport files/tests; Git owns only
Git files/tests. Shared schema/tool edits are integrated by the CLI owner to prevent lost changes.

## 12. Final review checklist

- [x] No command typo can start server mode.
- [x] No config flag is accepted but ignored.
- [x] No direct call uses stale/missing target feature evidence when probing succeeds.
- [x] No async action exits before output/report/audit flush.
- [x] Generic `call` compatibility is preserved and documented.
- [x] AUnit requests only harmless tests through read scope.
- [x] Alerts are not counted as tests.
- [x] Failed/empty/incomplete AUnit cannot false-green a dedicated CI command.
- [x] Native and generated JUnit are valid and counters match exit policy.
- [x] Transport success implies terminal evidence for every frozen ID; unexplained task disappearance is an error.
- [x] gCTS read tests match live/pinned wrappers and reject unknown nonempty shapes.
- [x] Every gCTS mutation is blocked before HTTP in this PR.
- [x] abapGit empty import result is an incomplete/error outcome, not exit-0 unverified success.
- [x] Git URL/config secrets are redacted and unsafe URL forms rejected.
- [x] Dependency-injected tests cover the dedicated-command domain/exit matrices; built-bin smoke covers representative stdout/exit, strict usage, schema, safety, and large-output behavior; packed `npx` covers help/version/tools/offline lint; live 758 checks cover target bootstrap and real result semantics.
- [x] The companion evidence ledger enumerates every retained exact object/worklist/transport identifier and explicitly names historical transient-ID gaps; it does not claim a reconstructed complete ledger.
- [x] Documentation recommends pinned npm versions and env/secret-store credentials.
- [x] Deferred ADR work is not described as implemented safety.

## 13. Post-implementation review record

The implementation followed the reviewed phase order. Focused reviews initially found and blocked
several false-green paths: non-terminal public AUnit runs, contradictory native/legacy evidence,
malformed structured CLI payloads, queued HTTP work outliving its deadline, partial CTS release,
unsafe Git output, and source-declared higher-risk tests silently omitted by SAP. Each received a
targeted regression before the focused AUnit reviewer returned GO for that scope. That scoped result
was not a final PR-wide GO.

The final AUnit source-selection check is intentionally conservative. It reads only active source,
follows a bounded static program-include closure, scans class main/testclass includes, treats omitted
`RISK LEVEL` as critical, requests `foreignTests=false`, and verifies source identity/content/ETag
before and after both SAP result paths. Unresolved external inheritance or unstable source evidence
is incomplete, never green.

### Security-review addendum

The later formal diff review found additional boundaries that the earlier “final” count did not
contain: canonical host-relative ADT URI enforcement; authoritative ATC worklist/completeness checks;
legacy AUnit source-omission reconciliation; recursive CTS allowlist/TOCTOU refusal; accepted-but-
unverifiable Git mutation postconditions; and depth/size/escaped-credential audit redaction. Each was
remediated with adversarial tests, and the focused post-fix security shards returned GO for their
reviewed hashes/scopes. They did not perform live SAP or Git mutations.

The previously recorded 5,116-test/175-file run is therefore intermediate evidence, not the completed
tree's final receipt. The pre-simplification frozen-tree rerun passed 5,217 tests across 176 files after
an older handler test was corrected to assert the new accepted-but-unverified abapGit push result. Typecheck, Biome,
file/schema budgets, policy validation, strict docs, docs/schema parity, built/packed smoke, and
`git diff --check` all passed. The final A4H/758 rerun repeated TABLE_QUERY, pass/fail/no-tests AUnit,
coverage, ATC, diff, Git reads/quarantine, canonical-path rejection, restrictive recursive-release
rejection, and the disposable mixed-risk lifecycle with active/inactive/TADIR cleanup evidence. The
companion audit records the exact results and explicit live-test/ledger gaps. Final plan verdict:
**GO**.

## 14. Ponytail simplification and final freeze

The implementation received a deletion-first review using the Ponytail method after the security
fixes landed. Relative to the reviewed PR commit, the pass removed 390 implementation/test lines,
including 360 production lines. The evidence/documentation update adds 53 lines, leaving the complete
working-tree change at net -337. It replaced the duplicate ABAP Unit XML model with one canonical
result plus a legacy adapter, parsed ATC XML once, reduced transport convergence to explicit
task/pre-parent/poll phases, deleted six unreachable gCTS mutation wrappers, consolidated Git output
and audit traversal,
and removed small CLI/report helpers whose only use was adjacent to their caller.

The review deliberately retained the larger controls that close reproduced failures: the ABAP Unit
source-selection lexer and stable-source recheck, authoritative ATC completeness evidence, bounded
audit/Git redaction, HTTP deadline propagation, strict abapGit mutation postconditions, gCTS mutation
quarantine, and CTS terminal-state reconciliation. Similar-looking gCTS and audit sanitizers remain
separate because their key, config-row, payload-body, URL, size, and collision contracts differ; a
configurable shared abstraction would make those security boundaries harder to audit.

The same review tightened VERSION_SOURCE from a generic same-host ADT GET to known source/revision
endpoint shapes while retaining raw encoded slashes for namespaced ABAP object names. Double-encoded
slashes, encoded separators in revision IDs, traversal, queries, and unrelated ADT endpoints are
rejected before HTTP.

The final simplified tree passed 5,215 tests across 176 files, all three TypeScript typechecks, full
Biome lint, file/schema budgets, policy validation, strict documentation, built and packed npm smoke,
documentation/schema parity, and `git diff --check`. Independent Ponytail cross-review returned GO.

After this review, current `main` was merged without weakening either side: data-preview gzip wire
bodies retain the CLI request deadline on every initial/retry/proxy path, and the new gzip option is
registered in the strict CLI option table. The integrated tree passed 5,246 tests across 177 files;
`http.ts` remains below its ratchet at 1,494 lines after extracting the 20-line wire-body policy.

## 15. Three-session external review closure

Three independent Claude sessions then reviewed the integrated PR by different surfaces. Applicable
findings were implemented and regression-tested: CLI AUnit/transport timeout overrides and five-minute
defaults; CLAS/PROG/FUGR AUnit scope; fail-closed ATC/diff formatting; complete gCTS list redaction;
bounded audit/Git string preprocessing; hierarchy-aware abapGit subtree grants; terminal CTS statuses;
and removal of the unimplemented `SAPGit.commit` action. Findings that would weaken a reproduced
control were rejected with evidence: incomplete CTS reports may still converge to a released state,
private Git hosts are valid for administrator-authorized clone/pull, and separate audit/gCTS
sanitizers have different contracts.

The post-review live pass added a real harmless FUGR AUnit lifecycle, a verified single CTS release,
two verified recursive releases, and a controlled abapGit clone/pull/switch/push/unlink lifecycle.
All disposable repository, package, class, and function-group artifacts were removed and leak-checked.
The companion audit records the exact irreversible CTS identifiers and the empty final Git/object
state. Full mutable gCTS remains quarantined because no controlled remote/deploy transaction exists.

The frozen post-review tree passed 5,262 tests across 177 files, all TypeScript typechecks, full
Biome lint, file/schema budgets, authorization-policy validation, strict documentation, built and
packed npm smoke, focused credential-backed Git integration, and `git diff --check`.

## 16. Independent live re-review correction (2026-08-18)

A later three-session review found two live wire assumptions that the preceding mock fixtures had
encoded incorrectly. On A4H/758, the ATC run POST's `FINDING_STATS` reported 73 findings while the
first worklist GET exposed only 23 findings across two objects with `objectSetIsComplete="true"`;
the same worklist later contained all 73 findings across ten objects. ARC-1 now parses that run
total, polls the worklist to agreement, and treats missing/malformed/mismatched count evidence as
incomplete. The ignored `maximumVerdicts=100` request is no longer used as a truncation inference.

CTS organizer responses also remove released tasks. Requiring every frozen task to remain visible
made a correct recursive release time out. Verification now accepts a disappeared frozen task only
when its own submission was accepted or the frozen parent is observed terminal; unknown/new child
IDs and ambiguous submissions remain fail-closed. Unit fixtures now model task disappearance, and
single-task 404 after accepted release is covered.

The same review corrected smaller contract issues: malformed AUnit evidence is evaluated before
formatting; missing/invalid `SAP_URL` is exit 2; incomplete ATC/diff prints a diagnostic; ordinary
`includeSignature` remains visible in audit records; adversarial escape matching is bounded; and
abapGit HATEOAS links are canonicalized to the bridge prefix. The PR title must use `feat!:` before
squash merge because the public SAPGit surface changes.

Post-fix live evidence:

- CLI ATC worklist `9241B616527E1FE1A6D9892E81DC38A2` returned only after the authoritative 73
  findings and ten processed objects were present; the strengthened live variant tests both passed.
- Recursive request/task `A4HK906450`/`A4HK906451` returned verified in 7.693 seconds although SAP
  folded the task from the organizer tree. Slow integration request `A4HK906452` also returned
  verified and remains `R`; its SAP-generated task identifier was not retained before SAP removed
  the task row, so the evidence ledger does not invent it.
- Reviewer-created empty pairs `A4HK906444`/`A4HK906445`, `A4HK906446`/`A4HK906447`, and
  `A4HK906448`/`A4HK906449` are intentionally permanent released audit records with zero objects.

The corrected tree passed 5,274 tests across 177 files, all TypeScript typechecks, full Biome lint,
file/schema budgets, policy validation, strict documentation, rebuilt and packed npm smoke, the
live HTTP/API-key manifest matrix, and `git diff --check`. Final implementation verdict: **GO**.

## 17. Final external-review closure (2026-08-18)

The final review was applied selectively: high-impact CI and live-contract findings were fixed;
cosmetic Commander wording, redundant sanitizer abstractions, and export/test churn were deferred.
ATC now accepts canonical namespaced-object evidence, gives package runs an explicit `--timeout`
budget, maps execution/first-snapshot deadlines to incomplete evidence, and uses a long-operation
undici dispatcher so its caller budget—not undici's 300-second header default—is authoritative.
Definitively failed CTS release reports now terminate after one coherent refresh rather than burning
the whole convergence budget. Missing SAP targets remain usage/configuration errors even when the
requested write tool is disabled.

Live A4H/758 evidence from the rebuilt CLI:

- namespaced class `/1BCDWB/WSC0040615164730935892` returned `complete:true`, one processed object,
  and exact zero-finding agreement in worklist `9241B616527E1FE1A6DB0870781418A2`;
- a `$ABAPGIT` package run completed after 179.4 seconds under `--timeout 600`, beyond the old
  120-second client ceiling, and emitted a complete structured report;
- disposable request/task `A4HK906462`/`A4HK906463` reproduced SAP's unclassified-task release
  rejection and returned `blocked` after one poll in about four seconds. Recursive cleanup succeeded
  and a final GET returned 404 for the request.

Final validation after rebasing the concurrent package-scoped ABAP Unit work passed 5,299 tests across
178 files, focused HTTP/ATC/CTS
regressions, all TypeScript typechecks, full Biome lint, file/schema budgets, policy validation,
strict documentation, tool-definition parity/snapshots, rebuilt/packed npm smoke, and
`git diff --check`. Final implementation verdict remains **GO**.
