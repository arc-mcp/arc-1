# ARC-1 CLI Guide

`arc1` is both a direct SAP command-line client and the launcher for the ARC-1 MCP server. Direct
commands use the same schemas, dispatcher, safety policy, feature evidence, and audit path as MCP
tool calls.

The npm package installs three equivalent executable names: `arc1`, `arc-1`, and `arc1-cli`. This
guide uses `arc1`.

## Install reproducibly

Pin the package to a reviewed version in CI. Do not use `@latest` in a reproducible pipeline.

```bash
# Replace x.y.z with the release your project reviewed. On an unreleased branch,
# use its packed tarball or source checkout instead of an older registry version.
export ARC1_VERSION=x.y.z

# Global installation
npm install --global "arc-1@$ARC1_VERSION"
arc1 version

# No installation; npx downloads the exact version
npx --yes "arc-1@$ARC1_VERSION" version
```

Replace `x.y.z` with the exact version your project has approved. A package lock or pinned container
digest is preferable for a longer-lived pipeline.

## Configure the SAP connection

Use environment variables or a protected `.env` file for credentials:

```bash
export SAP_URL=https://sap.example.com
export SAP_CLIENT=001
export SAP_USER=ci_adt_user
export SAP_PASSWORD='use-your-secret-store-here'

arc1 search 'ZCL_ORDER*'
```

Do not put passwords, API keys, cookie strings, service-key JSON, or Git tokens on the command line.
Although compatibility flags such as `--password` still exist, argv can be retained in shell history,
process listings, and CI logs. Prefer `SAP_PASSWORD`, `ARC1_API_KEYS`, `SAP_COOKIE_FILE`, and the other
environment/file forms in the [configuration reference](configuration-reference.md).

Configuration precedence is:

1. CLI flags
2. environment variables
3. `.env`
4. defaults

Registered global flags work before or after a direct subcommand:

```bash
arc1 --client 001 search 'ZCL_*'
arc1 search 'ZCL_*' --client 001
```

Boolean configuration flags take an explicit value, for example `--allow-writes=true`. Parsing is
strict: unknown commands, unknown options, missing values, and excess positional arguments are usage
errors (exit `2`). With no subcommand, valid global options still select the default `serve` command;
a misspelled command never falls back to server mode. The one intentional passthrough is everything
after `extract-cookies`, which that helper parses independently.

### Direct-mode authentication boundary

Direct SAP commands currently support one `SAP_URL` target authenticated with Basic credentials or a
cookie file/string. Before a SAP call, ARC-1 checks authentication and then collects target-local ADT
feature evidence using the same client session.

Direct commands do not bootstrap these server-only modes:

- BTP service-key OAuth or Destination Service
- principal propagation
- experimental multi-target routing

Use the HTTP MCP server for those modes. Local help, version, config/tool-schema inspection, and `lint`
need no SAP connection; `lint` never performs SAP I/O even when `SAP_URL` is configured.

## Output and exit codes

The generic `call` command preserves MCP semantics. Its `--output json` value is the outer MCP
`ToolResult` envelope (`content`, optional `isError`); handler JSON may itself be a string in
`content[0].text`. A successful tool call exits `0` even if its domain payload contains test failures,
ATC findings, or a non-empty diff.

Use the dedicated `unittest`, `atc`, `diff`, and `lint` commands in CI. They still invoke the normal MCP
dispatcher, but interpret the structured result and apply domain-aware exit rules.

| Exit | Meaning |
|---:|---|
| `0` | Invocation and domain check succeeded. |
| `1` | SAP/tool/transport failure, report-write failure, or a completed domain check failed its gate. |
| `2` | CLI/configuration/option usage error, including an unknown tool or unsupported direct auth mode. |
| `3` | Dedicated check is incomplete or non-evaluable; never treat this as green. |

`--report-file <path>` writes the selected report to that file instead of stdout and waits until the
file is closed before returning. Omit it, or pass `--report-file -`, to write the report to stdout.
The destination's parent directory must already exist. Diagnostics and audit logs remain on stderr. A
report-write error exits `1`.
For `unittest --format junit`, ARC-1 adds one diagnostic testcase when a nonzero CI policy verdict is
not already represented by SAP's JUnit counters, so the published report cannot appear green.

## General commands

### `serve` (default)

Start the MCP server. `arc1 serve` and `arc1` are equivalent.

```bash
# stdio transport (default)
arc1

# HTTP Streamable transport; keep the API key in the environment
export SAP_TRANSPORT=http-streamable
export ARC1_HTTP_ADDR=0.0.0.0:3000
export ARC1_API_KEYS='replace-with-secret:viewer'
arc1 serve
```

See [configuration-reference.md](configuration-reference.md) for all server flags and environment
variables.

### `call`

Call any registered MCP tool directly. Repeat `--arg key=value`, or provide a JSON object inline, from
a file, or from stdin. `--arg` values recognize booleans, numbers, `null`, objects, and arrays.

```bash
arc1 call SAPRead --arg type=CLAS --arg name=ZCL_ORDER

arc1 call SAPRead \
  --json '{"type":"CLAS","name":"ZCL_ORDER","version":"inactive"}'
arc1 call SAPRead --json args.json
printf '%s\n' '{"type":"PROG","name":"ZARC1_FOO"}' | arc1 call SAPRead --json -

# Outer MCP ToolResult envelope
arc1 call SAPManage --arg action=cache_stats --output json
```

An `--arg` with the same key as a JSON property overrides that property. Known tools reach the normal
safety policy even when a configuration hides them from the advertised tool list; for example, a
disabled `SAPWrite` returns the normal write-gate error rather than “unknown tool.”

### `tools`

List the tools advertised under the effective configuration, or inspect one advertised schema:

```bash
arc1 tools
arc1 tools SAPRead
```

### `read` and `source`

`read` is a shortcut for `SAPRead`:

```bash
arc1 read PROG ZTEST_REPORT
arc1 read CLAS ZCL_MY_CLASS --source-version inactive
arc1 read PROG ZARC1_FOO --source-version auto --output json
```

`--source-version` accepts `active` (default), `inactive`, or `auto`. See [SAPRead active vs inactive
source](tools.md#active-vs-inactive-source).

`--flat` is a legacy compatibility flag that passes `format="text"`. Ordinary source reads already
default to text, so it usually has no visible effect; it does not convert metadata-shaped object types
into source. Use the generic tool call with `format=structured` when you intentionally need the larger
structured class result.

`source` is the legacy alias of `read --flat`:

```bash
arc1 source PROG ZTEST_REPORT
arc1 source CLAS ZCL_MY_CLASS
```

### `activate` and `syntax`

```bash
# SAPActivate; requires SAP_ALLOW_WRITES=true and an allowed package
export SAP_ALLOW_WRITES=true
export SAP_ALLOWED_PACKAGES='$TMP,ZCI/**'
arc1 activate CLAS ZCL_FOO

# Remote SAP syntax check (read-scoped)
arc1 syntax PROG ZTEST
```

For batch activation and less common options, use `call SAPActivate`.

### `search`

```bash
arc1 search 'ZCL_ORDER*'
arc1 search 'Z*TEST*' --max 20 --output json
```

`--max` defaults to `50`.

### `sql`

Run an ADT freestyle ABAP SQL query. This needs `SAP_ALLOW_FREE_SQL=true` and suitable authorization.
The endpoint accepts a single `SELECT`, not an ABAP host-program statement: omit target clauses such as
`INTO`, `APPENDING`, `PACKAGE SIZE`, and `UP TO ... ROWS`. ARC-1 limits rows separately.

```bash
export SAP_ALLOW_FREE_SQL=true
arc1 sql "SELECT mandt, matnr FROM mara WHERE mandt = '001'"

# Set maxRows through the generic tool surface
arc1 call SAPQuery \
  --arg "sql=SELECT carrid, connid FROM sflight ORDER BY carrid ASCENDING" \
  --arg maxRows=10
```

Use ABAP SQL spelling such as `alias~field` and `ASCENDING`/`DESCENDING`, not `alias.field`, `ASC`,
`DESC`, or `LIMIT`. Keep free SQL off unless its data-access use case is explicitly approved.

With `SAP_ALLOW_DATA_PREVIEW=true`, prefer `SAPRead(type="TABLE_QUERY")` with structured `columns`,
`where`, and `maxRows`. The legacy `TABLE_CONTENTS` path is suitable for an unfiltered sample, but on
758 its requested limit returns `N+1` rows and its documented condition-only filter is not accepted by
the backend. Do not use that legacy filter/limit as a CI data boundary; use TABLE_QUERY or enforce the
final cap in your caller. On 758, spell inequality as `<>`; the currently accepted `!=` input is sent
unchanged and SAP rejects it.

## CI check commands

### `unittest`

Run ABAP Unit with a fixed **harmless-only** ceiling:

```bash
arc1 unittest CLAS ZCL_ORDER_TEST
arc1 unittest CLAS ZCL_ORDER_TEST --format json
arc1 unittest CLAS ZCL_ORDER_TEST --format junit --report-file reports/aunit.xml

# Exact package only (the default)
arc1 unittest DEVC ZORDER --format junit --report-file reports/aunit.xml

# Package plus its subpackages
arc1 unittest DEVC ZORDER --include-subpackages --format json

arc1 unittest CLAS ZCL_ORDER_TEST --coverage \
  --min-statement 80 --min-branch 60 --min-procedure 80 \
  --format junit --report-file reports/aunit.xml
```

Options:

| Option | Meaning |
|---|---|
| `--include-subpackages` | For `DEVC` only, include the package subtree. Without it, package scope is exact. |
| `--coverage` | Require measurable statement, branch, and procedure coverage. Missing/zero-total metrics make the check incomplete (exit `3`), even without a percentage threshold. |
| `--min-statement <0..100>` | Imply coverage and fail below the statement percentage. |
| `--min-branch <0..100>` | Imply coverage and fail below the branch percentage. |
| `--min-procedure <0..100>` | Imply coverage and fail below the procedure percentage. |
| `--format text\|json\|junit` | Report format; default `text`. JSON is the structured domain result, not a `ToolResult`. |
| `--report-file <path\|->` | File destination, or `-` for stdout. |
| `--timeout <seconds>` | End-to-end AUnit selection, execution, and verification budget; default `300`, range `1..3600`. |
| `--allow-empty` | Let a sound `no_tests` result pass; it never turns `incomplete` into success. |
| `--fail-on-skipped` | Exit `1` when any test method is reported skipped. |

Both the legacy and public async ABAP Unit requests enable harmless tests and explicitly disable
dangerous and critical tests. There is no CLI parameter that can broaden that risk ceiling. Short,
medium, and long harmless tests remain eligible.

For `DEVC`, native JUnit uses SAP's package object set; legacy, coverage, and corroboration runs use
the resolved package `CLAS`, `PROG`, and `FUGR` roots. Package membership and active source are read
both before and after the run. A changed selection, an unreadable source tree, an invalid object URI,
or a package search that reaches the 1,000-row bound is reported as incomplete evidence (exit `3`),
never as a pass. Exact scope uses each object's actual package; `--include-subpackages` is the
explicit recursive mode.

For JUnit without coverage, ARC-1 prefers SAP's native async JUnit result when that endpoint is
available and falls back to a generated JUnit report. Coverage uses the legacy coverage-capable path
and generates JUnit from the corrected structured result. Non-method alerts remain diagnostic
evidence rather than fabricated test cases.

Domain exits are:

- `0`: tests passed; `no_tests` also passes only with `--allow-empty`; requested measurable coverage
  met its thresholds.
- `1`: assertion/error, `--fail-on-skipped` violation, or measurable coverage below a threshold.
- `3`: incomplete run, disallowed-risk/refusal evidence, non-evaluable empty run, all tests skipped,
  or a requested coverage threshold whose metric is unavailable/non-measurable (`total=0`).

`--coverage` without a minimum adds no percentage threshold, but it is still a measurability gate: all
three metrics must be present, structurally sound, and have a non-zero total or the command exits `3`.

### `atc`

```bash
# Default: fail on priority 1 findings
arc1 atc CLAS ZCL_ORDER

# Fail on priorities 1 or 2, emit Checkstyle
arc1 atc CLAS ZCL_ORDER --variant DEFAULT --max-priority 2 \
  --timeout 600 --format checkstyle --report-file reports/atc.xml
```

Options:

| Option | Meaning |
|---|---|
| `--variant <name>` | Bind a specific ATC check variant; omit for the system default. |
| `--max-priority <1\|2\|3>` | Fail if a finding has priority less than or equal to this value; default `1`. |
| `--timeout <seconds>` | Total ATC execution and worklist verification budget; default `300`, range `1..3600`. |
| `--format text\|json\|checkstyle` | Report format; default `text`. |
| `--report-file <path\|->` | File destination, or `-` for stdout. |

Checkstyle maps priority `1` to `error`, `2` to `warning`, and `3+` to `info`. Exit `1` means the ATC
run completed and crossed the chosen threshold. Exit `3` means ARC-1 cannot prove completeness: SAP
omitted or denied the object-set completeness marker, reported no processed object, returned a
malformed priority, or the asynchronously populated worklist did not reach the finding total reported
by the completed run before the timeout. ARC-1 emits no report
for exit `3`, because a partial Checkstyle/JSON/text report could be mistaken for a complete result.

### `diff`

Compare SAP source versions through `SAPRead(action="diff")`:

```bash
# Informational: exits 0 whether or not differences exist
arc1 diff CLAS ZCL_ORDER --from active --to inactive

# CI gate: exits 1 when differences exist
arc1 diff CLAS ZCL_ORDER --check --format json --report-file reports/diff.json
```

Options:

| Option | Meaning |
|---|---|
| `--from <version>` | Old side: `active`, `inactive`, revision id, or canonical source/revision URI returned by VERSIONS; default `active`. Unrelated ADT endpoints, absolute URLs, traversal/dot segments, queries, fragments, and ambiguous encodings are rejected. |
| `--to <version>` | New side; default `inactive`. |
| `--from-label`, `--to-label` | Display labels only; they do not change resolution. |
| `--include <name>` | Class include to compare. |
| `--group <name>` | Function group required for relevant `FUNC` revisions. |
| `--check` | Exit `1` when the structured result contains differences. |
| `--fail-on-diff` | Alias of `--check`. |
| `--format text\|json` | Report format; default `text`. |
| `--report-file <path\|->` | File destination, or `-` for stdout. |

Without `--check`/`--fail-on-diff`, a non-empty diff is informational and exits `0`. JSON includes
`hasDifferences`, `identical`, added/removed counts, labels, and the unified diff. Malformed or
internally contradictory structured evidence exits `3` and emits no report.

### `lint`

Lint a local ABAP source file through `SAPLint`, without SAP I/O:

```bash
arc1 lint zcl_order.clas.abap
arc1 lint zcl_order.clas.abap --fail-on warning --format json
arc1 lint zcl_order.clas.abap --format checkstyle --report-file reports/abaplint.xml
```

Options:

| Option | Meaning |
|---|---|
| `--format text\|json\|checkstyle` | Report format; default `text`. |
| `--report-file <path\|->` | File destination, or `-` for stdout. |
| `--fail-on error\|warning\|info\|none` | Severity threshold; default `error`. `none` never fails for findings. |

Exit `1` means at least one finding met the threshold. A normal completed lint run has no backend
incomplete state; malformed/non-evaluable structured evidence is nevertheless fail-closed as exit `3`
and emits no report. Configure the local parser with `SAP_ABAP_RELEASE` and, if needed,
`SAP_ABAPLINT_CONFIG`/`--abaplint-config`.

## Git and transport calls

There are no dedicated `git` or `transport` subcommands; use their MCP tools directly:

```bash
# Read-only examples
arc1 call SAPTransport --arg action=list --arg summary=true --output json
arc1 call SAPTransport --arg action=get --arg id=A4HK900123 --output json
arc1 call SAPGit --arg action=list_repos --output json
arc1 call SAPGit --arg action=history --arg backend=gcts --arg repoId=ZARC1 --output json

# Mutations require the master switch plus the subsystem switch
export SAP_ALLOW_WRITES=true
export SAP_ALLOW_TRANSPORT_WRITES=true
export SAP_ALLOWED_TRANSPORTS=A4HK900123
arc1 call SAPTransport --arg action=release --arg id=A4HK900123 --output json

# Machine-readable terminal evidence for one release
arc1 call SAPTransport --json \
  '{"action":"release","id":"A4HK900123","resultFormat":"structured"}' --output json
```

Transport release succeeds only with terminal CTS evidence for every selected ID. Requests are read
back in `R` or `N`; on SAP releases that fold released tasks out of the organizer tree, a task is also
confirmed by its accepted release report or by the parent reaching terminal state. `release_recursive`
freezes the original parent/task tree. An unexplained disappearance, timeout, or unknown state is an
error rather than optimistic success. `resultFormat="structured"` returns the confirmation evidence,
poll count, and SAP reports; the default `legacy` format remains text-compatible.

The verification budget defaults to five minutes. Override it per call with `timeoutSeconds`, for
example `{"action":"release","id":"A4HK900123","timeoutSeconds":120}`.

`release_recursive` is deliberately refused when `SAP_ALLOWED_TRANSPORTS` contains restrictive exact
or prefix entries. SAP can attach/fold a concurrent child into the live subtree, so such a list cannot
atomically authorize every released ID. Recursive release is available only with the legacy empty
allowlist (no per-transport restriction) or an explicit `*`, and only when the administrator intends to
authorize the parent plus every current or concurrently attached child. A restrictive list continues
to work for single `release`.

gCTS **read** actions are available, but all gCTS mutations currently fail closed before sending an
HTTP mutation. Safe gCTS mutation needs staged no-import fetch, affected-object inventory,
authorization preflight, explicit deployment, terminal confirmation, and rollback; that work is
deferred. abapGit mutations remain separately gated by `SAP_ALLOW_WRITES`, `SAP_ALLOW_GIT_WRITES`,
and caller scope; package-affecting repository actions additionally enforce the real server-side
package allowlist. Subtree-wide actions require the exact `<ROOT>/**` pattern or `*`; an exact root or
broad prefix such as `Z*` is insufficient.

abapGit mutation results are intentionally conservative:

- `clone`/`pull` with non-empty bridge rows return `verified:false`: the rows and repository readback
  are evidence, not complete import/activation reconciliation. An empty wrapper is an error/incomplete
  result.
- `push` with no selected local changes is a verified no-op. A selected push is accepted by the bridge
  but returns error/incomplete because ARC-1 has no authoritative remote-commit postcondition.
- `switch_branch` and `create_branch` return error/incomplete after acceptance because repository
  readback does not prove the imported objects or activation state.
- `unlink` succeeds only when repository absence is confirmed; failed or still-present readback is
  error/incomplete.

An incomplete Git result can mean the mutation already happened. Do not retry blindly: inspect the
remote/repository state first. The latest postcondition hardening is covered by adversarial automated
tests; the final A4H pass did not send a Git mutation, so it is not claimed as final live verification.

`SAPGit.external_info` performs SAP-side outbound access to a caller-selected URL. It therefore needs
the `git` scope plus both write opt-ins even though it returns remote metadata. Git remotes must be
absolute HTTPS URLs without userinfo; `external_info` also rejects localhost and literal
private/link-local addresses. DNS-aware resolution/hostname allowlisting is not yet provided. Supply
remote credentials through protected JSON on stdin/from a file, never as literal argv values.

## `extract-cookies`, `config`, and `version`

```bash
arc1 extract-cookies --help
arc1 config show
arc1 config show --format json
arc1 version
```

`extract-cookies` launches a browser and writes a Netscape-format cookie file for `SAP_COOKIE_FILE`.
The running process hot-reloads that file after authentication failure; `SAP_COOKIE_STRING` is read
only at startup and cannot hot-reload.

`config show` prints the effective safety policy and each value's source. Its output intentionally
omits credential values.

## Safety and API policy

ARC-1 starts read-only. SQL, data preview, object writes, transport writes, and Git writes are separate
positive opt-ins. Per-user scopes can restrict the server ceiling but cannot expand it. Keep package
and transport allowlists narrow, and use `SAP_DENY_ACTIONS` for action-level exclusions.

ARC-1 primarily uses ADT REST endpoints under `/sap/bc/adt/*`. SAP does not list that complete surface
as published APIs in SAP Business Accelerator Hub. Before production or agentic use, review the
[SAP API Policy and architecture alignment](sap-api-policy-and-architecture.md), verify the relevant
endpoint status with SAP for your deployment, and apply your organization's data-egress and automation
controls. Using the deterministic CLI does not change the endpoint's publication status.
