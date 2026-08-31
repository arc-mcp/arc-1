# ARC-1 CLI/CI API audit — A4H/758 live evidence and primary-source research

Date: 2026-08-17

Target: `a4h.marianzeis.de`, client 001, S/4HANA 2023 / SAP_BASIS 758

Companion implementation plan:
[2026-08-17-cli-ci-hardening.md](../plans/2026-08-17-cli-ci-hardening.md)

This dossier re-checks the ARC-1 interfaces proposed for a deterministic Node/TypeScript SAP CI
lane: the direct CLI, SAPWrite, SAPActivate, SAPRead diff, SAPTransport, SAPDiagnose ABAP Unit and
ATC, SAPLint, and SAPGit. It combines source inspection, automated-test review, live A4H execution,
and immutable upstream contracts. Credentials are not reproduced here.

## 1. Executive result

ARC-1 already has a real CLI. The npm bins `arc1`, `arc-1`, and `arc1-cli` all load the same CLI
entry point; `arc1` remains the canonical human-facing spelling, while `arc-1` makes
`npx arc-1@<version>` select the expected package bin. The CLI reuses the same Zod schemas, safety
gates, handlers, and audit pipeline as MCP mode.

The pre-hardening direct-command path was not yet dependable as a CI contract:

1. documented configuration flags do not reach direct commands;
2. misspelled commands/options can silently start the default stdio MCP server;
3. one-shot calls skip discovery, release, and feature initialization;
4. generic MCP success is confused with domain success for tests, ATC, and lint findings;
5. ABAP Unit requests dangerous and critical tests through a read-scoped operation;
6. transport release can report success before CTS reaches terminal status;
7. gCTS requests and response parsers do not match SAP's wire contract;
8. abapGit's empty result wrapper is treated as proof of an import it cannot prove; and
9. current subprocess/live automation misses these discrepancies.

SAPWrite, SAPActivate, the structured table-query path, transport lifecycle operations, and most
read APIs performed well in controlled live use. The recommended PR therefore hardens the CLI and
the CI-facing boundaries instead of replacing the existing handler architecture.

## 2. Test method and safety boundary

- Every one-shot command used a fresh Node process and environment-based credentials.
- Write gates and package allowlists were explicit for controlled mutations.
- Temporary names were isolated and checked after cleanup.
- No credential was written to a command transcript or this document.
- Known critical ABAP Unit classes were not deliberately executed after the risk defect was found.
- gCTS write research used read-only endpoint probes and upstream source; no uncontrolled remote
  repository is an acceptable mutation fixture.
- Transport releases are irreversible. Dedicated empty requests were used where terminal release
  behavior had to be observed.

One audit-harness incident occurred before the environment isolation was corrected: a subprocess
inherited a writes-enabled local `.env`, created scratch program `Z_DO_NOT_CREATE_CLI_AUDIT`, and
reactivated already-active standard program `RSHOWTIM`. The scratch program was immediately deleted
and verified 404. `RSHOWTIM` source was never changed; its activation was a no-op. No artifact from
that incident remains.

The broader live audit also created and cleaned disposable programs, classes, DDIC objects,
RAP/CDS objects, packages, FLP content, Git links/repositories, and modifiable transports. A few
dedicated transport requests were released to verify the irreversible release paths; their released
CTS audit records are expected. Final object searches found no temporary active or inactive object.

## 3. CLI executable and argv behavior

### 3.1 Verified package surface

`package.json` maps all three bins to wrappers which import `dist/cli.js`. Therefore these are valid:

```bash
arc1 version
arc-1 version
arc1-cli version
npx -y arc-1@1.0.2 version
```

The `1.0.2` command above records the then-published baseline; that release does not contain the new
dedicated CI commands implemented by this change set. Documentation should prefer `arc1` for installed
use and an explicitly reviewed version for ephemeral CI. Until the next release exists, test this
working tree through its built wrapper or packed tarball rather than telling users to install 1.0.2.

### 3.2 Pre-hardening: global configuration flags were broken for direct commands

Observed behavior before this change set:

| Invocation shape | Pre-hardening result |
|---|---|
| `arc1 --url ... version` | enters default `serve`; can exit 0 after stdin EOF |
| `arc1 version --url ...` | unknown option, exit 1 |
| `arc1 serach Z*` | enters default `serve`, exit 0 on EOF |
| `arc1 --urll ...` | enters default `serve`, exit 0 on EOF |
| `arc1 call ... --allow-writes true` | option rejected |

The old root/default command permitted unknown options and excess arguments. Direct context creation
then called `parseArgs([])`, discarding command-line configuration entirely. This contradicted both the CLI
guide and the stated CLI > environment > `.env` precedence.

The implementation now registers configuration options on the Commander root command, parses user
argv once, removes permissive root parsing, and passes one resolved configuration into the action.
Commander supports registered root options before and after a subcommand. Only the explicit
cookie-extraction passthrough retains a narrow exception.

### 3.3 Pre-hardening: immediate process exit was unsuitable for report-producing CI commands

The old async action handlers used immediate `process.exit(...)`. Node documents `process.exitCode` as
the safe way to let pending stdout/stderr writes finish. The implementation now exports an async
`main(argv)` / `createCliProgram()` seam, uses `parseAsync` and returned exit codes, awaits logger
flush, and makes one top-level assignment to `process.exitCode`.

### 3.4 Pre-hardening: one-shot calls did not initialize features

Server startup probes ADT discovery, feature availability, and the ABAP release, installs the
discovery MIME map on its HTTP client, and caches feature evidence. The old direct CLI constructed a
client and immediately dispatched the tool.

Observed pre-hardening consequences on the same 758 system:

- `SAPManage probe` reports release 758 and both abapGit and gCTS available.
- a subsequent one-shot `SAPGit` process reports neither backend available because the cache is
  process-local;
- `SAPLint list_rules` reports release `unknown` and syntax `v702` unless
  `SAP_ABAP_RELEASE=758` is forced;
- source search reaches a raw unsupported endpoint rather than using discovery evidence; and
- structured read/version warnings differ from server mode because direct CLI context omits the
  caching layer.

The implementation now uses one shared, same-client bootstrap for server and direct CLI and installs
both cached feature evidence and `AdtHttpClient` discovery routing. Failure degrades to unknown
evidence and permits a direct operation attempt where the server does so; a probe is never reused
from another target or process.

### 3.5 Generic `call` is an MCP transport contract, not a CI assertion contract

`call` appropriately exits nonzero when the handler returns `isError`, such as write/activation
errors or safety denials. Findings returned as data are not handler errors:

- a failed ABAP Unit assertion exits 0;
- zero executed tests exits 0;
- lint errors returned by `SAPLint` exit 0;
- ATC findings exit 0; and
- a source diff with hunks exits 0.

Changing generic `call` would break MCP parity. Dedicated `unittest`, `atc`, and `diff --check`
commands should turn domain results into stable CI exit codes and reports.

The old direct CLI also compared a requested tool against the advertised tool list. With writes
hidden by configuration, a known `SAPWrite` or `SAPActivate` call was labeled “unknown tool” rather
than reaching the dispatcher and returning the correct safety denial. The implementation now
distinguishes known tool identity from current advertisement.

## 4. API-by-API live findings (pre-hardening baseline unless noted)

### 4.1 SAPWrite and SAPActivate

Controlled fresh-process lifecycles passed for:

- program create/update/surgery/activation/delete;
- class method, signature, visibility, definition, include, and text-symbol surgery;
- function groups, functions, and includes;
- batch create and batch activation;
- domains, data elements, table types, message classes, tables, and structures;
- CDS, BDEF, DCL, metadata extension, behavior pool, service definition/binding, publish/unpublish;
- knowledge-transfer documents; and
- negative write/package gates.

Handler-level write and activation errors already become `isError`. The main CLI need is reliable
argv/config parsing, bootstrap parity, exit/output completion, and real subprocess coverage.

Significant lifecycle findings outside the narrow CLI plumbing:

- metadata shell POST followed by source PUT is non-atomic; an invalid initial structure source
  left an inactive placeholder until explicitly corrected and cleaned;
- a generated `U01` function include can be created through the generic structural-include path but
  SAP refuses its direct deletion as a Function Builder-owned include;
- a valid user `F01` include could be read and activated but was not wired into the expanded group
  source; and
- metadata-heavy create responses dump noisy raw XML.

These deserve targeted follow-ups; they are not prerequisites for making the proposed CI lane
truthful.

### 4.2 SAPRead and SAPQuery

- Active/inactive/revision source reads and revision diffs work.
- A diff is data, so default exit 0 is correct; `--check` should opt into failure on hunks.
- `TABLE_QUERY` works with a data-preview gate but without free SQL, including projection,
  predicates, `LIKE`, `IN`, null checks, joins, grouping, metrics, ordering, hints, and large IN-list
  chunking.
- The advertised `!=` predicate emits syntax rejected by 758; ABAP SQL needs `<>`.
- `TABLE_CONTENTS maxRows=N` returns N+1 rows live; the integration test only asserts at least one.
- Documented condition-only `sqlFilter` is sent to a backend expecting a SELECT and is unusable on
  this system.
- The CLI SQL example contains forbidden target clauses (`INTO @DATA`) and the shortcut exposes no
  replacement `maxRows` option.
- `read --flat` is currently a no-op because raw text is already the shortcut default.
- `format=structured, version=active` for a class silently returned the developer/inactive view;
  structured class retrieval does not accept the requested version.
- grep branches can discard source-version warnings.

The plan fixes the misleading documentation. The query operator/limit behavior, structured-version
semantics, and TABLE_CONTENTS filter contract remain separate focused handler/API follow-ups.

### 4.3 SAPTransport

Live transport operations passed for create, get, diff, check, delete, remove object, reassign,
release, recursive release, package transport metadata, and object/package cleanup.

Release is not terminal when ARC-1 says it is. On 758, a clean recursive release report returned
before the parent request reached status `R`; an immediate read still saw `O`, with terminal state
appearing about seven seconds later. Current code polls only on one failure path and otherwise treats
the POST report as completion.

For CI, release success must mean every intended request/task is actually `R`. The client should
bounded-poll, retain the original release report, and return pending/unknown as an error on timeout or
read failure. A clean HTTP/report response alone is insufficient because SAP can continue work
asynchronously.

Other confirmed issues:

- the E2E test named “type W creates Customizing transport” never verifies the type; implementation
  intentionally always creates Workbench `K` requests;
- domain-form FLP catalog deletion is documented but fails; full catalog ID works; and
- transport GET 404 bypasses the handler's intended friendly not-found path.

### 4.4 ABAP Unit and coverage

#### Safety defect

The legacy request currently enables harmless, dangerous, and critical tests and all duration
categories. `SAPDiagnose.unittest` is authorized as a read. SAP defines dangerous tests as capable of
changing persistent application data and critical tests as capable of changing system settings or
Customizing. This violates ARC-1's read-only default and mutation-free multi-target contract.

The immediate fail-closed correction is a harmless ceiling. Supporting higher risk later requires a
dedicated administrator ceiling and execute/write authorization, not an ordinary caller parameter.

#### Live correctness matrix

| Fixture | Current ARC-1 result | Current CLI exit |
|---|---|---:|
| `ZCL_ABAPGIT_HASH` | four passed tests | 0 |
| `ZCL_SSI_UNIT_TPL` | five passed, one failed assertion, one false synthetic skip | 0 |
| `ZCL_ARC1_TEST_UT` | empty array / no tests | 0 |
| known critical test class under current request | empty array | 0 |

Coverage for `ZCL_ABAPGIT_HASH` was statement 30/49 (61.22%), branch 5/14 (35.71%), and procedure
3/8 (37.5%). An empty test run can still have measurable production code with zero execution, so
an empty result is not equivalent to “nothing coverable.” Metrics with total zero are not measurable,
not a meaningful 0% gate.

#### Parser defect

The live failing fixture contains a tolerable class warning and six executed methods. ARC-1 turns
the class alert into a synthetic skipped test; SAP's native JUnit correctly reports six tests, one
failure, zero skipped. Alerts must be separate from executable test cases. Only method executions
count as tests, and warning severity alone cannot mean “skipped.”

#### Public async API, empirically available on 758

A4H/758 supports the API documented by SAP for ABAP Environment even though neither local discovery
document advertises it. This is empirical on-premise evidence with a required feature probe/fallback,
not a normative promise that every 7.58 system exposes the ABAP Environment contract:

1. `POST /sap/bc/adt/api/abapunit/runs` with harmless-only options returned 201 and a run URI;
2. bounded polling moved from RUNNING to FINISHED; and
3. the run relation led to `/sap/bc/adt/api/abapunit/results/...`, which returned native JUnit.

The public API is the preferred JUnit path. Legacy execution remains necessary for current coverage
support and for systems without the public endpoint. A harmless zero-UUID GET is sufficient to
feature-probe the endpoint directly.

Recommended semantic outcome:

- `passed`: at least one test executed, no failures/errors, gates satisfied;
- `failed`: assertion/error or coverage gate failure;
- `no_tests`: no executable methods and no explicit refusal diagnostic;
- `incomplete`: risk refusal, all skipped, timeout, or required coverage unavailable.

Generic `call` can retain MCP transport semantics; the dedicated CLI maps these outcomes to CI exit
codes and writes JUnit before returning.

#### Package-scope follow-up (2026-08-18)

SAP documents package execution as an OSL `packageSet`, not as a flat `DEVC` object:
<https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/xml-representations-of-object-sets>.
The public AUnit run contract accepts that object set directly and carries an explicit
`includeSubpackages` flag:
<https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/executing-abap-unit-test-runs>.

A read-only A4H/758 spike against `$ABAPGIT_GIT` established the release-specific behavior needed
for ARC-1's implementation:

| Selection | Public package set | Legacy corroboration |
|---|---:|---:|
| exact package | 118 passed | 118 passed from 14 exact-package class URIs |
| package + subpackages | 142 passed | 142 passed from 18 subtree class URIs |

Passing `/sap/bc/adt/packages/$ABAPGIT_GIT` as one legacy object reference produced 142 tests even
for the intended exact-package case, so the legacy package URI is implicitly recursive on this
system and cannot corroborate `includeSubpackages=false`. Repository quick search returned actual
`packageName` values for every row: 14 classes belonged to `$ABAPGIT_GIT`, one to
`$ABAPGIT_GIT_V2`, and three to `$ABAPGIT_GIT_ZLIB`. Filtering those rows by the returned package,
then submitting their canonical ADT URIs as one legacy flat object set, matched both public scopes.

The implementation must therefore keep the public package set and legacy flat corroboration as two
different wire shapes. It must also re-read package membership and active source after the run:
source stability alone cannot prove a whole-package result if an object was added, removed, or moved
during execution. A full 1,000-row repository-search response is ambiguous because that endpoint is
bounded; ARC-1 must return incomplete evidence instead of claiming it enumerated the whole scope.
Duplicate local test-class names are normal across programs, so package source evidence must key a
declaration by program plus test class rather than test class alone.

### 4.5 ATC and SAPLint

- A bounded ATC call on the passing fixture completed and returned no findings.
- Generic ATC and SAPLint findings intentionally return normal tool data and exit 0.
- The existing local `lint` command does fail on error findings, but lacks JSON/Checkstyle output and
  inherits `v702` if release is not supplied.

Dedicated report-producing commands need explicit domain exit policies. Checkstyle is a better
semantic fit for ATC/lint than inventing fake unit tests; JUnit may remain a compatibility option
only if a consumer requires it.

### 4.6 SAPGit — one-shot CLI, gCTS, and abapGit

#### One-shot CLI

Every direct SAPGit invocation fails before HTTP because the per-process feature cache is empty. A
separate `SAPManage probe` process cannot initialize the next command. The shared direct bootstrap is
a prerequisite for any CLI Git use.

#### gCTS wire contract

Current implementation and fixtures disagree with SAP's API:

| Operation | Current ARC-1 assumption | SAP / live contract |
|---|---|---|
| config | array or `{result}` | `{config:[...]}` |
| branches | array or `{result}` | `{branches:[...]}` |
| history | array or `{result}` | `{commits:[...]}` |
| create/clone | one flat POST | nested create POST, then separate clone POST |
| pull | POST plus JSON body | GET `pullByCommit?request=<commit>` |
| switch | POST `/checkout/<branch>` | GET `branches/<current>/switch?branch=<target>` |

Live ARC-1 returned an empty config array even though the raw A4H response contains 53 entries. The
integration test accepts any array—including empty—and is therefore a false green. Existing fixtures
also invent a repository `package` property that is not part of SAP's create/repository contract.

A gCTS repository can import multiple packages during clone, pull, and switch. Caller-provided or
fixture-provided `package` cannot enforce `SAP_ALLOWED_PACKAGES`. Until ARC-1 implements a staged
`VCS_NO_IMPORT` fetch, affected-object inventory, authorization preflight, explicit deploy, polling,
and rollback, import-capable gCTS operations must fail closed whenever package policy is restrictive.

#### abapGit success semantics and package scope

The reference ADT backend serializes an unfilled result table after clone and pull. A well-formed
empty `<abapObjects/>` therefore means “the bridge did not throw,” not “objects were imported and
activated.” ARC-1 currently reports it as success. The immediate truthful contract is:

- reject explicit E/A/X messages;
- read back repository identity/package/url/branch;
- return `verified:false` when the bridge gives no object reconciliation evidence; and
- require explicit expected-object verification for a deterministic CI success claim.

abapGit repositories also create subpackages automatically and do not store the SAP package name in
Git. Authorizing only the root package is insufficient. Mutating repository actions must require an
explicit subtree grant (`ZROOT/**`) or `*`; an exact root and a broad sibling prefix such as `Z*` do
not prove that every future subpackage is authorized. The same rule must consistently gate pull,
switch, create branch, push/stage, and unlink.

#### Credential and egress boundary

- URL userinfo and credential-like query parameters can escape keyed redaction because the field is
  named `url`.
- gCTS configuration results can contain credential-like key/value pairs and are returned verbatim.
- abapGit `external_info` makes the SAP host contact a caller URL while currently read-scoped.

The immediate boundary is HTTPS-only, no URL userinfo, redacted sensitive query/config values, and a
Git authorization gate. A full DNS-aware allowed-host policy and secure-secret provider are follow-up
architecture work.

### 4.7 Remaining intent tools and parameter surface

The request expanded from the CI APIs to all 12 intent tools. The same A4H/758 session therefore ran
a broader live matrix. This was not a claim that every destructive combination is safe to repeat:
irreversible actions used dedicated disposable records, and operations with no leak-free inverse were
left as explicit gaps.

| Tool | Live coverage | Result / important limitation |
|---|---|---|
| `SAPRead` | Program/class source, active/inactive/auto, includes, package contents, system/components, inactive worklist, table preview/query, grep and diff | Core reads passed. `TABLE_CONTENTS` returns `maxRows + 1`; its condition-only filter is rejected on 758. Structured class reads ignore `version`, and grep can discard version-fallback warnings. |
| `SAPSearch` | Object search, type filtering where defined, TADIR lookup, source-search negative path | Object/TADIR paths passed. 758 does not expose source search; the old one-shot CLI missed discovery evidence and reached a raw 500 instead of the permanent unsupported result. |
| `SAPWrite` | PROG/CLAS/INTF/FUGR/FUNC/INCL, class and method surgery, text symbols, batch create, DDIC, RAP/CDS/service binding, KTD | Controlled create/update/read-back/activate/delete lifecycles passed. Multi-step create is not atomic: a failed initial structure source can leave a shell. Reserved generated FM includes and unwired user includes need focused follow-ups. |
| `SAPActivate` | Single, array/batch, preaudit true/false, DDIC subtypes, RAP stack, service publish/unpublish | Passed with SAP read-back. Cosmetic subtype collapse remains for `TABL/DS`; activation of unchanged standard source was not used as a test fixture. |
| `SAPNavigate` | Definition/references/hierarchy/completion probes | Definition/reference paths were usable. Completion is broken on 758 because ARC-1 calls plural `/proposals` while discovery/live SAP exposes singular `/proposal`. Hierarchy's data-preview-only fallback sends a SQL-style filter to the broken `TABLE_CONTENTS` path. |
| `SAPQuery` | Projection, predicates, `LIKE`/`IN`/nulls, joins, grouping/metrics, ordering, hints, chunked large IN lists, error hints | Passed. Advertised `where.op="!="` is emitted unchanged and rejected by 758; use `<>` until normalized. |
| `SAPTransport` | List/get/check/history/diff, target/layer value help, create, reassign, remove object, delete, single/recursive release | Operations passed, but release returned before terminal `R`; this PR adds bounded terminal confirmation. The old type-`W` E2E was a false positive because create intentionally always makes Workbench `K`. |
| `SAPGit` | Feature selection, both repo lists, gCTS whoami/config/system wrappers, abapGit external info/check/stage plus controlled clone/pull/switch/unlink lifecycle | Reads exposed wrapper and bootstrap defects. gCTS mutation contracts were wrong and package safety unprovable, so this PR quarantines them. abapGit's bridge can return an empty object wrapper after accepting a request; that is now incomplete, never verified import. |
| `SAPContext` | Dependencies/usages/impact and structure probes | Dependency-oriented paths were useful. Structure could not resolve common DDIC structures consistently: `MARA` failed and `BAPIRET2` fell through a table path to an empty result. |
| `SAPLint` | Local lint/list rules/format/settings and live-release bootstrap | Local actions passed. The old one-shot CLI fell back to unknown/v702 on a 758 system; dedicated lint is intentionally offline while generic live calls now initialize target release evidence. |
| `SAPDiagnose` | Syntax, harmless AUnit + coverage, ATC variants/run, object state, CDS test-case gate, quickfix paths, dumps/messages/gateway errors, authorization and SQL diagnostics | The relevant paths were exercised. `TABL/DS` syntax routing loses the subtype. CDS test cases correctly require 8.16+, but the old cold CLI leaked a raw 404. AUnit risk/completeness and ATC completeness were the CI-critical fixes in this PR. |
| `SAPManage` | Feature probe/cache, package lifecycle/move, API release state, FLP catalog/tile lifecycle, transport helpers | Controlled lifecycles passed and were cleaned. Domain-form FLP catalog deletion fails while the full technical catalog ID succeeds. Group/tile-group mutation was not run because ARC-1 exposes no inverse cleanup action. |

The live matrix deliberately did not run gCTS import/deploy against an uncontrolled remote, create an
FLP group that ARC-1 cannot delete, execute higher-risk AUnit classes, or mutate existing business
objects merely to cover a branch. Those are safety boundaries, not hidden passes.

## 5. Automated-test assessment

Focused unit suites are broadly green but frequently prove only the mocked contract:

- 577 focused write/activation/DDIC/RAP/schema tests passed;
- 315 transport/manage tests passed;
- 260 gCTS/abapGit/transport tests passed; and
- 162 AUnit/devtools tests passed.

High-signal gaps and false positives:

1. no test launches `arc1 call` as a real subprocess;
2. package smoke tests only `--help`;
3. CLI tests do not cover config flags, unknown commands, exit completion, probe parity, write safety,
   or stdout/stderr separation;
4. gCTS fixtures encode the wrong routes, bodies, wrappers, and invented package;
5. gCTS integration allows empty configured results;
6. the AUnit fixture explicitly asserts the false “tolerable alert = skipped test” behavior;
7. live AUnit covers only a passing class;
8. TABLE_CONTENTS row-limit test asserts only `rows.length >= 1`;
9. transport release E2E checks ID text rather than terminal state;
10. stale transport type-W test never asserts request type;
11. full RAP/SRVB slow E2E is excluded from the default CI job; and
12. cleanup helpers often swallow failures, so passing live tests can leak objects.

The implementation plan adds pure formatter/parser tests, real built-bin subprocess tests, exact
wire-contract fixtures, and controlled live assertions with fail-closed cleanup.

## 6. Primary sources

### Node/CLI

- Node process exit behavior:
  <https://nodejs.org/api/process.html#processexitcode>
- Commander async parsing and root options: the pinned dependency's `Readme.md` sections for
  `parseAsync` and global options.

### ABAP Unit

- SAP ABAP Environment AUnit REST/JUnit flow:
  <https://help.sap.com/docs/btp/sap-business-technology-platform/executing-abap-unit-test-runs>
- SAP risk-level definitions:
  <https://help.sap.com/docs/ABAP_PLATFORM_NEW/ba879a6e2ea04d9bb94c7ccd7cdac446/4925667929ac16b7e10000000a42189d.html>
- SAP client execution ceilings:
  <https://help.sap.com/docs/ABAP_PLATFORM/ba879a6e2ea04d9bb94c7ccd7cdac446/dcbbcaa38b374362b627b20044c0804a.html?version=1709.008>
- SAP Project Piper native JUnit handling, pinned to
  `6b1bc6f209721bd6bed04c700b768e1ea8294539`:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/abapEnvironmentRunAUnitTest.go>
- SAP Learning, omitted `RISK LEVEL` defaults to `CRITICAL`:
  <https://learning.sap.com/courses/deepening-your-abap-programming-knowledge/implementing-code-tests-with-abap-unit_b23c7a00-c2e8-406d-8969-b00db3f1fd87>

### gCTS

Evidence is pinned to SAP Project Piper commit
`6b1bc6f209721bd6bed04c700b768e1ea8294539`:

- nested repository create:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsCreateRepository.go#L50-L94>
- separate clone:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsCloneRepository.go#L42-L56>
- switch:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsDeploy.go#L306-L341>
- pull:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsDeploy.go#L506-L564>
- `VCS_NO_IMPORT` staging and explicit deploy:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsDeploy.go#L209-L304>
  and
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsDeploy.go#L344-L389>
- commit wrapper:
  <https://github.com/SAP/jenkins-library/blob/6b1bc6f209721bd6bed04c700b768e1ea8294539/cmd/gctsRollback.go#L184-L234>

SAP Help:

- repository create fields (no ABAP package):
  <https://help.sap.com/docs/ABAP_PLATFORM_NEW/4a368c163b08418890a406d413933ba7/4ca031d6cbee4569873e9b85a4aeb4a0.html>
- import behavior:
  <https://help.sap.com/docs/ABAP_PLATFORM_NEW/4a368c163b08418890a406d413933ba7/24723d6d03284b019ebd21fbeae8026d.html>
- user-specific authentication:
  <https://help.sap.com/docs/ABAP_PLATFORM_NEW/4a368c163b08418890a406d413933ba7/3431ebd6fbf241778cd60587e7b5dc3e.html>

### abapGit

Evidence is pinned to ADT Backend commit
`da0c291257f53e88cc821e9d60992525f682cc41`:

- clone response table is TODO/unfilled:
  <https://github.com/abapGit/ADT_Backend/blob/da0c291257f53e88cc821e9d60992525f682cc41/src/zcl_abapgit_res_repos.clas.abap#L320-L374>
- pull response table is unfilled:
  <https://github.com/abapGit/ADT_Backend/blob/da0c291257f53e88cc821e9d60992525f682cc41/src/zcl_abapgit_res_repo_pull.clas.abap#L137-L195>
- package/subpackage behavior:
  <https://docs.abapgit.org/user-guide/reference/packages.html>

## 7. Scope decision

The independently reviewed companion PR should deliver:

- strict, testable CLI argv/config/exit behavior;
- same-client one-shot feature/discovery initialization;
- harmless-only AUnit execution, corrected structured outcomes, native JUnit when available, coverage
  gates, and a domain-aware CLI;
- ATC/lint/diff CI reporting where the underlying result is already available;
- terminal CTS release confirmation;
- corrected/redacted gCTS read wrappers and quarantine every gCTS mutation before HTTP until the
  staged deployment design exists;
- honest/incomplete abapGit verification and whole-subtree package semantics;
- minimal URL/config credential hardening;
- corrected CLI documentation; and
- subprocess, unit, integration, and controlled live coverage.

The following require separate ADRs or focused follow-ups:

- transactional gCTS staging/inventory/deploy/rollback;
- administrator-trusted Git host/repository/ref policy with DNS/private-range resolution;
- SAP Secure Storage or external secret-provider integration;
- all gCTS create/clone/pull/switch/branch/unlink mutations, even though their correct SAP
  wire shapes are recorded above;
- full abapGit object-manifest/activation reconciliation;
- higher-risk AUnit authorization and multi-user execution policy;
- atomic rollback for all multi-step object creates; and
- JUnit/check reporting aggregation across multiple SAP targets.

## 8. Post-implementation A4H/758 evidence ledger

The post-implementation tree was rebuilt and exercised repeatedly through fresh `bin/arc1-cli.js`
processes using ignored environment credentials, including a final rerun after security and
documentation freeze. Secrets were never passed in argv or printed.
Read-only invocations kept mutation/data/SQL gates off. Controlled object writes used
`SAP_ALLOW_WRITES` with `SAP_ALLOWED_PACKAGES=$TMP`; transport and Git negative-path checks enabled
their subsystem gates only where explicitly stated below.

### Dedicated CLI and read checks

- `SAPRead TABLE_QUERY` on `T000`, projected to `MANDT,MTEXT` and filtered to client `001`, returned
  exactly one row. Free SQL remained disabled.
- `unittest CLAS ZCL_ABAPGIT_HASH --format json` returned exit 0 with four passed methods and verified
  harmless source-selection evidence.
- The same class with `--coverage` returned exit 0 and measurable statement `30/49` (61.22%), branch
  `5/14` (35.71%), and procedure `3/8` (37.50%) coverage.
- Native JUnit for that class reported four tests and zero failures/errors/skips.
- `unittest CLAS ZCL_SSI_UNIT_TPL` returned exit 1 with five passes and one real failure; no synthetic
  skipped test was manufactured from an alert.
- `unittest CLAS ZCL_ARC1_TEST_UT` returned sound `no_tests`, exit 3; `--allow-empty` alone changed it
  to exit 0.
- Bounded ATC on `ZCL_ABAPGIT_HASH` returned complete evidence, one processed object, zero findings,
  and worklists `9241B616527E1FE1A6CC7953F97DF8A2` (intermediate) and
  `9241B616527E1FE1A6CE85AEE44578A2` (final frozen-tree rerun).
- Active-to-inactive diff for `ZCL_ARC1_DEMO_CALC --check` returned exit 1 and the exact removed line
  `rv_diff = iv_a.`.
- A forced gCTS clone with both write gates enabled and `allowedPackages=*` was quarantined before
  network mutation; repository read-back stayed empty. Live gCTS config parsed all 53 metadata rows
  and sensitive-shaped fields were redacted.
- Live abapGit list returned nine contract-valid links. Controlled HTTPS `external_info` exercised the
  Git-scoped, write-gated SAP-side egress path; it is not a read-scoped operation. No Git repository
  mutation was sent in that pass.
- A traversal-shaped `VERSION_SOURCE` URI was rejected as non-canonical before the requested SAP path
  could be sent. A recursive release under exact `SAP_ALLOWED_TRANSPORTS=A4HK906428` was likewise
  rejected before CTS mutation, confirming the documented explicit-`*` requirement for live subtrees.

### Risk-capped AUnit regression

A first disposable program proved the motivating false green: SAP executed the HARMLESS class and
silently omitted its DANGEROUS sibling without an alert, while the pre-fix CLI exited 0. That program
was immediately deleted and leak-checked. The fix therefore does not depend on SAP returning a
risk-refusal message: it reconciles SAP results with a stable active-source declaration inventory.

Final rebuilt lifecycle object `ZC1_CLI_B817` contained one passing HARMLESS test and one failing
DANGEROUS test. Create and activation succeeded. SAP executed only the harmless test, while ARC-1:

- returned `outcome=incomplete`, exit 3;
- reported verified declarations for `LTC_HARMLESS` and `LTC_DANGEROUS`;
- identified the omitted dangerous class with `sourceRiskSelection` evidence; and
- emitted JUnit with two tests and one `ARC1IncompleteEvidence` error, so the report UI cannot be
  green while the process is incomplete.

The program was deleted in `finally`. Active read returned 404, the inactive worklist contained no
`ZC1_CLI_B817`, and `TABLE_QUERY TADIR` returned `rows:[]` for its `R3TR/PROG` key.

### Transport convergence ledger

- `A4HK906428`: created for the terminal-release rerun; release returned verified only after state
  `R`. It is an irreversible empty released audit record.
- `A4HK906430` with child task `A4HK906431`: recursive release reached parent `R`, but the frozen
  child first remained `D` and then disappeared from the parent tree; direct child read returned
  404. ARC-1 returned exit 1 with `outcome=unknown` after the bounded deadline instead of claiming
  success. The parent is an irreversible released record; the vanished child is retained here as
  evidence of the fail-closed edge.
- Earlier broad live-audit released records remain `A4HK906391`, `A4HK906393`, `A4HK906395`,
  `A4HK906399`, and `A4HK906401`, with released tasks `A4HK906396`, `A4HK906400`, and
  `A4HK906402`. The isolated Git transport `A4HK906397` and its task were deleted; the task's exact
  transient ID was not retained.

All other disposable object, package, FLP, abapGit, and gCTS artifacts from the audit were removed;
the final gCTS repository list was empty. SAP transport release records are intentionally permanent
and enumerated above rather than described as cleanup failures.

### Exact retained identifiers and historical gaps

Every exact identifier still present in the audit/agent evidence is listed here:

| Kind | Exact identifier(s) | Status / use |
|---|---|---|
| Accidental scratch program | `Z_DO_NOT_CREATE_CLI_AUDIT` | Deleted immediately; active read verified 404. |
| Standard program touched by the incident | `RSHOWTIM` | Re-activation only; source was not changed. |
| Read-only system/data fixtures | `T000`, `MARA`, `BAPIRET2` | Pre-existing objects; never mutation targets. |
| Read-only test/diff fixtures | `ZCL_ABAPGIT_HASH`, `ZCL_SSI_UNIT_TPL`, `ZCL_ARC1_TEST_UT`, `ZCL_ARC1_DEMO_CALC` | Pre-existing fixtures used for AUnit, ATC, coverage, or diff evidence; not created/deleted by this pass. |
| Retained AUnit lifecycle program | `ZC1_CLI_B817` (`LTC_HARMLESS`, `LTC_DANGEROUS`) | Created/activated, proved omitted-risk exit 3, then deleted; active/inactive/TADIR absence verified. |
| ATC worklists | `9241B616527E1FE1A6CC7953F97DF8A2`, `9241B616527E1FE1A6CE85AEE44578A2` | Complete one-object intermediate and final runs on `ZCL_ABAPGIT_HASH`. |
| Terminal single release | `A4HK906428` | Permanent released CTS record, terminal `R`. |
| Recursive fail-closed edge | parent `A4HK906430`, task `A4HK906431` | Parent released; task disappeared/read 404; ARC-1 returned unknown/error. |
| Earlier permanent releases | requests `A4HK906391`, `A4HK906393`, `A4HK906395`, `A4HK906399`, `A4HK906401`; tasks `A4HK906396`, `A4HK906400`, `A4HK906402` | Permanent released CTS audit records. |
| Deleted Git transport | `A4HK906397` | Request deleted; its deleted child task's exact ID was not retained. |

The following earlier transient identifiers were not retained and are therefore not reconstructed or
silently presented as exact evidence: the first disposable risk-regression program; the other broad
program/class/function-group/function/include, DDIC, CDS/RAP/service/KTD, and package lifecycle names;
the classic FLP catalog/tile IDs; abapGit link/repository keys and any transient gCTS repository key;
and the deleted child task under `A4HK906397`. FLP group/tile-group mutation was deliberately not run,
so there is no missing group artifact ID. Cleanup/leak searches were recorded as successful, but for
these historical operations they are aggregate evidence, not an exact per-artifact ledger.

The later accepted-but-incomplete `push`, `switch_branch`, `create_branch`, and uncertain-`unlink`
postconditions were added after this live pass. They have adversarial automated coverage, but no final
Git mutation was sent against A4H; this dossier therefore does not claim those paths are live-verified.

### Intermediate automated evidence

- 5,116 unit tests across 175 files passed after the then-current adversarial AUnit fixes.
- TypeScript typecheck, Biome, schema/file-size budgets, policy validation, strict MkDocs build,
  `git diff --check`, built-bin smoke, and packed `npx` smoke passed.
- The AUnit-focused adversarial suite passed 127/127, and its independent reviewer returned scoped GO
  with no remaining concrete AUnit false-green path at that point.

These numbers predate the formal security remediation and documentation reconciliation below. They are
not the final PR receipt; the final frozen-tree count and complete validation matrix remain pending.

## 9. Formal security-review addendum

The later diff review found and remediated additional boundaries that were absent from the intermediate
receipt:

- canonical host-relative path enforcement for caller- and SAP-response-provided ADT URIs;
- authoritative ATC worklist/object-set completeness and legacy AUnit source-omission evidence;
- recursive transport release refusal under restrictive allowlists, because a concurrent child makes
  the live subtree impossible to authorize atomically;
- accepted-but-unverifiable abapGit push/branch/unlink postconditions, returned as incomplete with a
  do-not-retry-blindly warning; and
- depth/size/key-aware central audit and Git-output redaction, including escaped credential material.

Focused post-fix security reviews returned GO for their reviewed hashes and automated adversarial
scopes. They performed no live SAP/Git mutation.

## 10. Pre-simplification frozen-tree receipt

The post-documentation tree before the later deletion-first simplification passed:

- 5,217 unit tests across 176 files;
- all three TypeScript typechecks;
- full Biome lint (two existing configuration information notices only);
- file-size and every MCP schema budget;
- 126-entry/14-schema authorization-policy validation;
- strict MkDocs build (existing release-note anchor information and upstream ecosystem warning only);
- tool-schema/public-documentation action and parameter parity;
- built `arc1`/`arc1-cli` tests plus packed-`npx` help, version, tools, and offline lint; and
- `git diff --check`.

The final A4H/758 rerun reproduced the exact TABLE_QUERY row, four-test AUnit pass, measurable
`30/49` statement, `5/14` branch, and `3/8` procedure coverage, real six-test failure, sound
no-tests/allow-empty exits, complete ATC worklist `9241B616527E1FE1A6CE85AEE44578A2`, and the
active/inactive diff. gCTS configuration returned 53 redacted metadata rows; gCTS repository lists
remained empty before and after the quarantined clone; abapGit returned nine contract-valid links and
controlled public external metadata without repository mutation.

Disposable `ZC1_CLI_B817` again proved the central false-green case on the frozen tree: SAP returned
only `LTC_HARMLESS/PASSES`, ARC-1 reconciled the omitted `LTC_DANGEROUS`, structured and JUnit modes
both exited 3, JUnit reported two tests with one `ARC1IncompleteEvidence` error, and legacy generic
mode returned `isError`. Deletion then produced active 404, no inactive-worklist match, and no
`R3TR/PROG` TADIR row. No new transport or Git mutation was sent during this final rerun. With the
documented deferred work and historical exact-ID gaps retained above, the implementation and final
review verdict is **GO**.

## 11. Ponytail simplification receipt

A final deletion-first review removed 390 implementation/test lines from the reviewed PR commit,
including 360 production lines. The 53-line evidence/documentation addition leaves the complete
working-tree change at net -337. The main reductions were one canonical AUnit parser/model, one-pass
authoritative ATC parsing, explicit transport-release phases, removal of unreachable gCTS mutation
wrappers, one final Git output sanitizer, one bounded audit traversal, and co-located CLI report/JSON
plumbing.

The review did not remove controls backed by live or adversarial evidence. In particular, the 758
mixed-risk AUnit source audit, bounded redaction, HTTP deadlines, strict abapGit response/postcondition
handling, gCTS mutation quarantine, and exact CTS convergence remain. gCTS and audit sanitizers were
not merged: their output and trust-boundary contracts differ enough that a parameterized common
abstraction would be larger and harder to review.

The review also found that VERSION_SOURCE's generic `/sap/bc/adt/` check still authorized unrelated
same-host ADT reads. The final implementation accepts only known source/revision shapes, permits raw
encoded namespace slashes in object-name segments, and rejects nested encodings, encoded revision-ID
separators, queries, traversal, and unrelated endpoints before dispatch.

The simplified final tree passed 5,215 tests across 176 files, all TypeScript typechecks, full Biome
lint, file and schema budgets, authorization-policy validation, strict MkDocs, documentation/schema
parity, built and packed npm smoke, and `git diff --check`. An independent focused cross-review passed
603/603 security/transport/path tests and returned GO. No additional SAP or Git mutation was sent for
this code-only simplification pass.

The subsequent current-`main` integration combined its opt-in data-preview gzip body with this PR's
deadline propagation as `wireBody, options` on every send and retry. The strict registry also gained
the new gzip CLI flag. The integrated tree passed 5,246 tests across 177 files, with `http.ts` at
1,494 lines after isolating the 20-line wire-body transformation.

## 12. External three-session review and final live mutation receipt

Three independent Claude review sessions re-read the integrated PR. Their distinct claims were
normalized before changes so repeated observations were fixed once. The accepted corrections were:

- five-minute default and explicit per-call budgets for public AUnit and CTS convergence;
- AUnit support and source-selection verification for CLAS, PROG, and FUGR;
- evaluation before ATC/diff formatting, with non-evaluable evidence returning exit `3` and no report;
- bounded preprocessing before audit/Git credential regexes, without truncating ordinary gCTS lists;
- hierarchy-aware ancestor subtree authorization for abapGit repositories;
- CTS status support for modifiable `D`/`L`, in-flight `O`/`P`, and terminal `R`/`N`;
- clear do-not-retry guidance for accepted but unverifiable abapGit mutations; and
- removal of the advertised but unimplemented `SAPGit.commit` action.

Claims rejected after source/live review were also retained as decisions: ARC-1 must not treat a
failed CTS submission report as immediately terminal because A4H can subsequently release it; private
Git destinations remain valid for explicitly authorized enterprise clone/pull operations; the outer
startup preflight is required to avoid authentication fan-out; and audit-event versus gCTS-output
redaction remain separate because their field, collision, and result-preservation contracts differ.
The exact gCTS branches wrapper could not be re-probed because the clean A4H repository list is empty;
the strict `{branches:[...]}` contract remains based on the pinned SAP-authored client evidence and
fails unknown nonempty shapes closed.

### Live A4H/758 results added by this review

- `unittest FUGR ZCR1_FG_R817 --timeout 120` executed one harmless test with verified active source
  evidence. The function group was deleted; TADIR and inactive-object searches returned no match.
- Single request `A4HK906432` reached terminal `R` before ARC-1 returned success (7.512 seconds,
  three convergence polls).
- Recursive request/task pairs `A4HK906440`/`A4HK906441` and
  `A4HK906442`/`A4HK906443` each returned only after both frozen nodes were terminal `R`
  (7.389 and 6.708 seconds respectively).
- Temporary unused request/task `A4HK906438`/`A4HK906439` was deleted and is absent from E070.
- A controlled abapGit clone of `https://github.com/abapGit-tests/CLAS.git` into package
  `ZCR1G_R817` demonstrated the bridge's real empty-result contract: clone and pull were accepted by
  SAP but ARC-1 returned error/incomplete rather than false success. `ZCL_AG_UNIT_TEST` and the repo
  link were verified after clone; same-branch switch was accepted/incomplete; an empty selected push
  was a verified no-op; unlink succeeded only after absence readback.
- The imported class was deleted, its CTS deletion released recursively, the package was deleted and
  its deletion released recursively. Final TDEVC/TADIR/inactive/repository checks returned no matching
  class, package, function group, or abapGit link. The gCTS repository list remained empty.
- Focused credential-backed gCTS/abapGit integration finished with 11 passes and one intentional
  remote-mutation skip.

The new permanent CTS records are intentional audit evidence, not leaked mutable artifacts:
`A4HK906432`, `A4HK906440`, `A4HK906441`, `A4HK906442`, and `A4HK906443`, all status `R`.
No gCTS write was attempted: mutations remain quarantined until the staged import/inventory/deploy/
rollback contract can be tested against a controlled remote.

Final frozen-tree validation passed 5,262 tests across 177 files, all TypeScript typechecks, full
Biome lint, file/schema budgets, authorization-policy validation, strict documentation, built and
packed npm smoke, and `git diff --check`.

## 13. Post-review live wire corrections (2026-08-18)

An independent live review at commit `247000d0` disproved two fixture assumptions:

1. A4H/758 sets worklist `objectSetIsComplete="true"` before ATC findings finish populating. The run
   POST already carries `FINDING_STATS` as three comma-separated priority totals. Worklist
   `9241B616527E1FE1A6D8E5A8AF08B8A2` was initially 23 findings/two objects and later 73/ten; the old
   result could therefore false-green while omitting 50 findings. The implementation now polls to
   the run total, validates zero-finding processed-object evidence, and fails closed on absent or
   contradictory statistics. `maximumVerdicts` is retained only for wire compatibility because 758
   ignored values 3, 5, and 100 in live calls.
2. Released CTS tasks disappear from the parent organizer tree and their own endpoint returns 404.
   Recursive request `A4HK906448`/task `A4HK906449` released correctly but the old verifier waited
   for a task row that could never reappear. A disappeared frozen task is now terminal only after an
   accepted own submission or an observed-terminal frozen parent. New/unexpected children,
   submission ambiguity, missing parents, and restrictive recursive allowlists still fail closed.

Applicable static findings were also fixed: AUnit verdict-before-format ordering, direct-target
configuration exit codes, diagnostics for suppressed ATC/diff reports, audit fidelity for
`includeSignature`, bounded escape-regex quantifiers, canonical abapGit follow-up links, migration
documentation for `SAPGit.description`, and stale authorization/smoke expectations. The default
Commander typo wording remains a low-risk follow-up because changing default-command dispatch would
risk documented flag-only server startup for a cosmetic message.

Post-fix A4H/758 verification used shipped CLI code rebuilt from the working tree. Worklist
`9241B616527E1FE1A6D9892E81DC38A2` settled at the exact run total of 73 findings/ten objects before
exit 0. Both generic live ATC variant tests passed without synthesizing clean evidence for excluded
objects. Recursive pair `A4HK906450`/`A4HK906451` returned verified in 7.693 seconds with task
confirmation from the terminal parent; slow integration request `A4HK906452` also returned verified
and was read back as `R` after SAP removed its task row. All were purpose-created empty transports;
no ABAP, package, abapGit, or gCTS artifact was created in this correction pass.

Final local validation: 5,274/5,274 unit tests across 177 files; two live ATC integration tests; one
live slow recursive-release test; typecheck, Biome, file/schema budgets, policy validation, strict
MkDocs, rebuilt/packed npm CLI smoke, HTTP/API-key profile smoke, and `git diff --check` all passed.

## 14. Final review and live correction receipt (2026-08-18)

The last external review added three material corrections. ATC processed-object validation now
accepts canonical raw-encoded slashes in the object-name segment, which SAP uses for namespace
objects. Package ATC receives a configurable total budget and an explicit per-fetch budget; a lazy
undici dispatcher removes the library's independent 300-second response-header ceiling while the
ARC-1 AbortSignal remains authoritative. CTS convergence now returns immediately after a definitive
failed report plus one coherent non-in-flight refresh, while retaining the live-verified rule that a
failed child report can still be folded into a later successful parent release.

Live results from the rebuilt working tree:

- `atc CLAS /1BCDWB/WSC0040615164730935892 --timeout 120` returned exit 0, `complete:true`,
  `processedObjectCount:1`, and matching zero finding totals (worklist
  `9241B616527E1FE1A6DB0870781418A2`).
- `atc DEVC '$ABAPGIT' --timeout 600` completed after 179.4 seconds and emitted a complete
  structured report of approximately 962 KB; this crossed the original 120-second client ceiling.
- Task `A4HK906463` in disposable request `A4HK906462` returned `blocked`, `verified:false`, and
  `polls:1` in about four seconds under a 300-second budget. The request/task were recursively
  deleted and the request endpoint was verified 404 afterward.

The redaction review retained bounded preprocessing and only widened the already-bounded quoted
escape prefix from eight to 64 characters; it did not reintroduce the super-linear unbounded regexes
reported against an earlier revision. Lower-value requests for merged sanitizer abstractions,
cosmetic default-command wording, and unrelated export cleanup were intentionally not taken.

Final local gates after rebasing package-scoped ABAP Unit support: 5,299/5,299 unit tests across 178
files, focused HTTP/ATC/CTS and schema tests,
typecheck, Biome, size/schema budgets, action-policy validation, strict MkDocs, tool-schema parity and
snapshots, packed npm smoke, and `git diff --check`. No SAP object/package/Git artifact remains from
this pass; the only CTS pair created here was deleted.
