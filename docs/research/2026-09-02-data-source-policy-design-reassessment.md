# Experimental data-source policy: design reassessment

**Date:** 2026-09-02

**Status:** Normative v1 specification. Independently reviewed 2026-09-02; corrections applied below.
Implementation is authorized against this document.

**Supersedes:** `docs/plans/completed/2026-09-02-experimental-data-source-blocklist.md` and the design
sections of `docs/research/2026-09-02-data-source-allowlist-and-cds-lineage.md`. Where those documents
disagree with this one, this one wins. The earlier dossier remains valid as the endpoint/live-evidence
history.

**Prototype revision inspected:** `9c00ace8` (`feat: add experimental data-source blocklist`)

**Scope:** ARC-1 SQL and data-read policy for `SAPQuery`, `SAPRead(TABLE_QUERY)`,
`SAPRead(TABLE_CONTENTS)`, CDS transitive dependencies, DDIC replacement objects, fixed internal
queries, and multi-target deployments

## Executive recommendation

Keep the feature **experimental, administrator-controlled, opt-in, and off by default**. An inactive
policy (unset or blank) must preserve the current execution path with no SQL parsing, repository lookups,
dependency graph calls, or added latency. The LLM must not be able to enable, weaken, or bypass it in a
tool argument.

Design deny and allow semantics together, but do **not** ship both at the same time in the first
version:

1. Rework the first release as an exact-name, transitive **blocklist emergency brake**.
2. Collect policy latency and compatibility evidence before enabling caching or adding an allowlist.
3. Add an allowlist only after root-versus-dependency semantics and target scoping are represented in
   a versioned policy file. A flat allowlist is not an adequate high-assurance boundary.

Blocklist v1 has exactly one public policy field: `SAP_BLOCKED_DATA_SOURCES`. The environment variable
is the canonical deployment name; `--blocked-data-sources` is only the normal CLI spelling of the same
field, not a second mode or capability. A non-empty valid value activates enforcement. Do not add an
enable flag, mode flag, cache flag, allowlist variable, destination property, per-request override, or
LLM-visible switch in this release.

The current prototype is useful evidence, not yet the design baseline. Its secure fail-closed behavior
also rejects a normal SAP standard CDS view because the SAP response mixes SQL dependency nodes with
auxiliary DCL metadata. It also repeats the complete authorization work for every generated IN-list
chunk. These must be resolved before release.

### Configuration-contract re-research result

The second configuration review changed one earlier recommendation. **Unset, empty, and whitespace-only
values must all mean off.** The Docker image and the base MTA descriptor already materialize
`SAP_BLOCKED_DATA_SOURCES=""`. Docker documents that `ENV` values persist into containers, while SAP MTA
module properties become application environment variables and extension descriptors overwrite scalar
properties. Treating an empty value as a startup error would therefore break the default image and MTA
deployment, and it would leave no clean one-setting way to disable a previously configured MTA override.

This does not justify lenient CSV parsing. Once the trimmed value is non-empty, every comma-separated
field must be non-empty and valid. `USR02,,PA0002`, `,USR02`, `USR02,`, and separator-only values are
configuration errors. The current prototype silently drops those empty fields; that is an implementation
gap to fix after the specification is approved.

The alternatives were considered fairly:

| Activation design | Benefit | Cost / residual risk | Decision |
|---|---|---|---|
| Unset or blank is off; valid non-empty list is on | One field, compatible with Docker/MTA and reversible through scalar override | Cannot distinguish an intentionally cleared field from failed interpolation; operators must verify effective config | **Use for v1** |
| Blank is invalid; special value such as `off` disables | Detects accidental blank | Pollutes exact-name grammar, can collide with a real technical name, and creates a second spelling of “no entries” | Reject |
| Only absence disables | Pure list grammar | Existing deployment values persist and MTA/manifest removal is not a reliable rollback mechanism | Reject |
| Add `SAP_DATA_SOURCE_POLICY_ENABLED` | Separates activation from content | Creates mismatched states (enabled + blank, disabled + populated), more documentation, and a second permanent field | Reject |

The one-field design is proportionate for an experimental, default-off emergency brake. A future
high-assurance allow policy should use a versioned policy object with explicit mode/version validation
rather than stretching this CSV contract.

### Corrections applied after independent review

An independent security review of the prototype was folded in on 2026-09-02. Nine corrections changed
this document; three of them corrected the **reviewer**, not the prototype, and are recorded here so the
mistakes are not reintroduced:

| # | Correction | Direction |
|---|---|---|
| 1 | Keep `SAP_BLOCKED_DATA_SOURCES` as the permanent public name | Confirmed |
| 2 | Add no enable flag, allowlist, cache option, destination property, policy mode, or LLM-visible override | Confirmed |
| 3 | Unset, empty, and whitespace-only all mean off | Confirmed |
| 4 | **Keep** the explicit empty defaults in `Dockerfile`, `mta.yaml`, `manifest.yml`, `manifest-btp-abap.yml`. The review recommended removing them; that was wrong. `.mtaext` is durable desired state and `cf set-env` is temporary, so the base empty value is what makes one-field rollback reliable | **Reviewer corrected** |
| 5 | The "no governed data request is reachable" startup warning is **correct** and stays. Capability gates run before the guard, and internal fixed reads use the same gated methods | Prototype confirmed |
| 6 | The SQL-comment behaviour is **not** a demonstrated exploit. Live 758 returned HTTP 400 for an inline quote comment and ignored a column-one asterisk comment. Reject comments anyway, as parser-surface reduction | **Reviewer corrected** |
| 7 | DCL is **not** represented only by `AC_STATE`. Live `I_BUSINESSPARTNER` carries a real auxiliary `RELATED_OBJECTS_TREE → RELATED_OBJECTS_ENTRY → DCLS_OBJECT_LIST → DCLS/DL` branch, and the prototype refuses that standard view | **Reviewer corrected** |
| 8 | `TYPE=CDS_TABLE_FUNCTION` is the real live value; replace the fabricated test constant with a captured sanitized fixture | Prototype gap |
| 9 | SAP Note 3772411 stays independent. A default-off feature remediates nothing, and `SAP_ALLOW_WRITES=false` does not neutralize a database-side mutation reached through a vulnerable SQL Console host expression | Confirmed |

### Evidence classification

- **Observed:** current repository configuration and call paths at `9c00ace8`, focused local resolver
  outputs, official deployment semantics, SAP Note content, prior live A4H timings, and captured SQL
  Dependency Graph responses.
- **Inferred:** where a distributed control can drift, which deployment mistakes are plausible, and which
  unsupported SAP graph/SQL constructs could create a bypass if accepted without proof.
- **Proposed/normative:** the v1 public name and grammar, enforcement invariants, error/audit contract,
  cache prohibition, rollout posture, and acceptance criteria below. None of those statements claims the
  prototype already conforms.

## Security boundary and non-goals

The policy answers one question immediately before ARC-1 submits a caller-controlled data request:

> May this caller-accessible query use this direct root and all data-contributing sources reachable
> from it under the active SAP definition?

The boundary is the three governed data methods on `AdtClient` (`getTableContents`, `runTableQuery`,
`runQuery`/`runQueryWithMetrics`) plus the declared internal fixed reads that share them. Everything
reached by another route is **outside** the v1 boundary and must be documented as such. In particular,
**generic extension `ctx.http.get()` calls are not governed by this policy.** The FEAT-61 plugin contract
deliberately exposes a generic SAP GET, and a plugin can therefore read SAP data — including from a
blocked source — without passing the blocklist. That is an accepted, documented v1 scope limit, not an
oversight: closing it needs a separate design for the plugin HTTP surface. Operators who require the
blocklist to be a complete data boundary must not enable untrusted plugins. Other data-bearing responses
that remain outside scope for the same reason include object source, dumps, and traces.

It is an ARC-1 object-level defense-in-depth control. It does not replace:

- SAP roles, table authorizations, CDS DCL, or least-privilege SAP identities;
- SAP Security Note 3772411 and its related corrections;
- row- or column-level data-loss prevention;
- a transactionally atomic database authorization decision;
- curated APIs or SQL services for the highest-assurance production data plane.

SAP documents an important reason not to treat DCL as transitive authorization: access control is
evaluated for the CDS entity used as the ABAP SQL entry point, not automatically inherited from CDS
entities it wraps. `WITH PRIVILEGED ACCESS` can suppress that entry-level access control. The ARC-1
policy therefore needs its own complete, server-side decision.

## Recommended configuration surface

### Experimental blocklist v1

Use one exact-name CSV policy field. The canonical environment form is:

```dotenv
SAP_BLOCKED_DATA_SOURCES=USR02,PA0002,ZPRIVATE_TABLE
```

The CLI mirror is:

```text
--blocked-data-sources USR02,PA0002,ZPRIVATE_TABLE
```

#### Permanent public name

Keep `SAP_BLOCKED_DATA_SOURCES` as the permanent name rather than introducing a temporary experimental
name and migrating it later.

| Candidate | Decision | Reason |
|---|---|---|
| `SAP_BLOCKED_DATA_SOURCES` | **Use** | Matches ARC-1's existing `SAP_*` safety ceiling, covers tables and CDS entities, and describes the administrator's intended outcome without promising a specific resolver implementation |
| `SAP_BLOCKED_TABLES` | Reject | Too narrow: the configured root or matched dependency may be a CDS entity/view or generated alias rather than a transparent table |
| `SAP_DENY_DATA_SOURCES` | Reject | Technically valid and similar to `SAP_DENY_ACTIONS`, but less natural as a noun-list setting and needlessly renames the already documented prototype |
| `ARC1_BLOCKED_DATA_SOURCES` | Reject | ARC-1 uses `ARC1_*` primarily for server/runtime behavior and `SAP_*` for the SAP capability/safety ceiling; changing families would make this policy harder to discover beside the data gates |
| `SAP_BLOCKED_DATA_SOURCES_EXPERIMENTAL` | Reject | Experimental maturity is documentation and release metadata, not durable configuration semantics; the suffix would force a future migration |
| `SAP_DATA_POLICY` / `SAP_DATA_POLICY_MODE` | Defer | Too broad for one CSV deny set; reserve a distinct policy-file setting for a later target-scoped allow model |

“Data source” is intentionally broader than “table.” In v1 an entry may name the caller-visible CDS
entity, its DDLS source/generated SQL alias, or a table. Matching remains exact after normalization, but
all canonical aliases established for the same resolved object are checked. If object identity or alias
resolution is ambiguous, the active policy denies rather than guessing.

#### Normative value grammar

- Unset, `""`, or whitespace-only: feature is off; current behavior and performance are unchanged.
- Any other value activates enforcement and is parsed as CSV.
- Trim surrounding whitespace from each token, validate the **raw trimmed token as ASCII before case
  conversion**, convert only ASCII `a-z` to `A-Z`, preserve first occurrence order, and deduplicate exact
  normalized duplicates. Do not use Unicode case folding for policy identity.
- Every token in a non-empty CSV must be present. Leading, trailing, repeated, or separator-only commas
  are startup errors; never silently remove empty fields.
- Each raw trimmed token must be 1–128 ASCII characters, contain at least one ASCII letter or digit, and
  use only `A-Z`, `a-z`, `0-9`, `_`, `/`, or `$`; its normalized stored form is uppercase ASCII.
- The same canonicalizer must be used for caller roots, decoded repository identities, dependency-graph
  names/aliases, and replacement annotations. A value from SAP metadata is evidence, not trusted input;
  if it cannot be canonicalized without Unicode folding or lossy rewriting, lineage is unresolved.
- Exact names only in v1. Do not add glob, prefix, regex, negation, type-prefix, quoting, escaping, or
  policy-file syntax until their matching behavior is separately designed and tested.
- Invalid configuration aborts startup with the variable name and invalid token/position, but never
  prints credentials or unrelated environment values.
- Configuration is startup-bound. Changing it requires a process/container restart or BTP application
  restart; there is no hot reload in v1.

The empty value is an intentional off value, not an attempt to distinguish operator intent. A single
default-off setting cannot tell an intentionally cleared value from failed deployment-variable
interpolation. Administrators who require that assurance must validate the effective policy in their
deployment pipeline; ARC-1 should make that verification easy rather than invent a second enable flag.
A blank higher-precedence CLI/process value therefore explicitly overrides a lower-precedence non-empty
value to off and must be visible in config inspection.

#### Precedence and deployment forms

The existing ARC-1 precedence remains normative:

```text
CLI flag > process environment > .env > built-in default
```

Examples. Local `.env` or a stdio process environment:

```dotenv
SAP_BLOCKED_DATA_SOURCES=USR02,PA0002
```

Docker:

```bash
docker run -e SAP_BLOCKED_DATA_SOURCES='USR02,PA0002' ghcr.io/arc-mcp/arc-1
```

Durable BTP override in a customer `.mtaext` extension descriptor:

```yaml
_schema-version: "3.1"
ID: arc1.landscape
extends: arc1
modules:
  - name: arc1-mcp-server
    properties:
      SAP_BLOCKED_DATA_SOURCES: "USR02,PA0002"
```

Explicitly disabling an earlier Docker or MTA value uses the same single field:

```dotenv
SAP_BLOCKED_DATA_SOURCES=""
```

#### Why the base descriptors keep an empty value

The base `Dockerfile`, `mta.yaml`, `manifest.yml`, and `manifest-btp-abap.yml` deliberately keep
`SAP_BLOCKED_DATA_SOURCES=""` as a visible safe default. This is a normative decision, not an oversight,
and it must not be "fixed" by deleting those lines.

ARC-1 treats a customer `.mtaext` as the **durable desired state** for a BTP landscape. Every
`cf deploy` reconciles the application environment toward the descriptor plus its extension. A direct
`cf set-env SAP_BLOCKED_DATA_SOURCES ...` is therefore a **temporary** operator action: it takes effect
immediately, but the next MTA deployment reconciles the property back to whatever the descriptor chain
declares. The same asymmetry already applies to every other `SAP_*` safety field, and AGENTS.md records
it as a standing BTP trap.

The consequences an operator must plan for:

- To enable the blocklist durably on BTP, set the value in the landscape `.mtaext`, not with `cf set-env`.
- `cf set-env` is appropriate only for a deliberately temporary change, such as an incident-response
  brake that the operator intends to promote into the `.mtaext` afterwards.
- Removing the line from an `.mtaext` does **not** unset the variable on an already-deployed
  application; an MTA extension can add or override a property but never remove one. Write the explicit
  empty value `""` to disable.
- Keeping the empty value in the base descriptors is what makes that one-field rollback reliable. If the
  base omitted the key, a previously deployed non-empty value could survive a deployment that was
  intended to clear it.

No `arc1.*` destination property is part of v1.

#### Effective-policy visibility

- Startup info logs: show `enabled`, entry count, and a deterministic policy fingerprint; do not log the
  complete blocklist at ordinary info level.
- `arc1 config show`: show normalized names and source attribution because this is an explicit local
  administrator action. Report the observable source as flag, environment, or default; the current dotenv
  load turns `.env` entries into process environment before resolution, so it cannot honestly distinguish
  shell environment from `.env` without separate loader instrumentation.
- Read-only admin UI: show normalized names only on the existing local operator UI or authenticated
  admin-scoped web UI.
- Unauthenticated `/health`: never expose policy names.
- Audit decisions: record the matched source/path according to normal-versus-minimal error rules, plus a
  policy fingerprint so operators can correlate a request with the effective deployment configuration.
- If the list is active while both public data gates are off, startup diagnostics must say that **no
  governed data request is reachable**, and that statement is correct. `checkOperation(Query)` and
  `checkOperation(FreeSQL)` run *before* the blocklist guard on every data path, and every declared
  internal fixed read reaches SAP through `getTableContents`, `runTableQuery`, or `runQuery` — each of
  which is gated by `SAP_ALLOW_DATA_PREVIEW` or `SAP_ALLOW_FREE_SQL` first. With both flags false there
  is therefore no reachable external *or* internal data request for the blocklist to govern. Retain the
  existing startup contradiction warning unchanged.
- The blocklist only ever **narrows** an already-enabled capability. It can never enable, widen, or
  re-open a data path that the capability gates have closed.

The names are not credentials, but they can disclose sensitive schema/security posture. Count plus a
fingerprint is sufficient for ordinary startup logs; exact values belong on administrator-only inspection
surfaces.

Use one canonical fingerprint algorithm so order and duplicate spelling do not change the apparent policy:
SHA-256 over `data-source-blocklist:v1\n` followed by the sorted, normalized, unique names joined with
`\n`. A shortened prefix may be displayed to humans, while the complete digest can remain in structured
audit data.

The fingerprint is a **configuration-drift and correlation identifier only**. It is explicitly *not* a
confidentiality control, a MAC, or a secret. It is unsalted by design so that two independently deployed
instances with the same policy produce the same value, which is the whole point of using it to correlate
a request with an effective deployment configuration. The candidate name space is small and highly
guessable — a few thousand well-known SAP tables plus customer `Z*` names — so anyone holding the digest
can confirm a guessed list offline. Do not document or rely on the fingerprint as protection against
offline guessing; it answers "did the policy change?" and "which policy decided this request?", nothing
more. Exact values remain on administrator-only inspection surfaces because that, not the fingerprint,
is the confidentiality boundary.

The name “blocked data sources” should mean **deny anywhere**: a match on the directly named source,
an alias, a CDS dependency, or a DDIC replacement-object path denies the request. Deny rules always win.
A direct-name-only implementation would need a different, explicitly weaker name because a CDS wrapper
would otherwise bypass the stated control.

### Future allowlist

Do not initially add `SAP_ALLOWED_DATA_SOURCES` as a symmetric comma-separated list. “Allowed as a
direct query root” and “allowed only as a dependency of an approved view” are different permissions.
A flat list either over-authorizes direct table access or incorrectly rejects valid view dependencies.

The minimum useful future model is:

- `allowedRoots`: objects a user request may select directly;
- `denyAnywhere`: objects forbidden both directly and transitively;
- optional `approvedDependencies` or a definition digest for installations that require a CDS view's
  dependency closure to remain unchanged;
- target and client scope, because the same SAP object name can have different definitions on different
  systems.

For a convenient, lower-assurance root allowlist, a second CSV can be offered later:

```dotenv
SAP_ALLOWED_DATA_ROOTS=ZC_SAFE_ORDERS,SCARR
SAP_BLOCKED_DATA_SOURCES=USR02,PA0002
```

Its semantics must be explicit: every direct SQL source must be in `SAP_ALLOWED_DATA_ROOTS`; allowing a
CDS root does not allow direct selection from its underlying tables; transitive deny rules still win.
This mode trusts future changes to an allowed root unless a deny rule catches the new dependency.

For a high-assurance allowlist, use a versioned YAML or JSON policy file rather than increasingly complex
CSV variables. A conceptual shape is:

```yaml
version: 1
default: deny
targets:
  A4H/001:
    denyAnywhere:
      - TABL:USR02
    roots:
      - source: DDLS:ZC_SAFE_ORDERS
        approvedDependencies:
          - TABL:ZORDER
          - TABL:ZORDER_ITEM
        definitionDigest: optional-active-definition-digest
```

The file path can later be exposed as `SAP_DATA_POLICY_FILE`. Missing target policy, ambiguous aliases,
conflicting entries, or an invalid file should fail closed. This is intentionally not part of blocklist
v1.

## Decision pipeline

When the blocklist is off, the guard returns before parsing or performing any SAP request.

When it is on, one logical caller request should follow this pipeline exactly once:

1. Classify the operation as caller-controlled SQL/data access or a declared fixed internal query.
2. Parse the entire caller SQL statement locally and extract every direct source. Refuse unsupported or
   incomplete grammar; do not use string or regex extraction.
3. Match direct source names and known aliases against `denyAnywhere`. A direct match denies with no SAP
   lookup.
4. Resolve unblocked roots through exact repository metadata.
5. For CDS roots, request SAP's active SQL Dependency Graph without metrics and traverse only the SQL
   dependency portion of the response.
6. For transparent tables, inspect `@AbapCatalog.replacementObject` and recursively evaluate the
   replacement lineage.
7. Deduplicate all roots and dependencies, enforce depth/node/body limits, and deny on incomplete,
   unknown, cyclic, ambiguous, or unsupported lineage.
8. Record the decision and only then submit the original query.

The first raw-SQL grammar should remain narrow: one completely parsed static `SELECT` or `WITH`; no host
expressions, dynamic sources, secondary database connections, client override, privileged access,
provider syntax, multiple statements, or association-path navigation. These restrictions apply only
when the experimental blocklist is active and must be documented as compatibility constraints.

#### Strict-subset support matrix

The following was measured against the pinned `@abaplint/core` grammar used by the analyzer. It is the
normative compatibility contract for v1 and must be kept in step with the negative corpus.

**Accepted (source extraction proven):**

| Form | Extracted sources |
|---|---|
| Plain `SELECT ... FROM t` (any ASCII case) | `T` |
| Namespaced names, e.g. `/DMO/I_FLIGHT` | `/DMO/I_FLIGHT` |
| Inner/left/cross joins with aliases | every joined source |
| `UNION` | every branch source |
| Nested subqueries in `WHERE` | outer and inner sources |
| Common table expressions (`WITH +cte AS (...)`) | inner sources only; the CTE alias is correctly not treated as a source |
| Parameterized CDS roots, e.g. `DEMO_CDS_PARAM( P_X = 1 )` | `DEMO_CDS_PARAM` |
| `HIERARCHY( SOURCE h CHILD TO PARENT ASSOCIATION _rel ... )` | `H`, the hierarchy source entity |
| Aggregates, `GROUP BY`, `HAVING`, `ORDER BY`, `UP TO n ROWS` | unchanged source extraction |

**Refused — legal ABAP SQL that v1 deliberately does not support.** These are compatibility limits, not
security findings, and each must return `DATA_SQL_UNSUPPORTED`:

| Form | Reason |
|---|---|
| `SELECT SINGLE` | The analyzer proves completeness by appending a synthetic `INTO TABLE @DATA(...)` target, which is invalid after `SINGLE`. Supporting it needs a second wrapper shape and its own proof. |
| Caller-supplied `INTO` / `APPENDING` target | The synthetic-target check is how "one complete statement" is proven; a caller target defeats it. |
| ABAP comments (`"` to end of line, `*` in column one) | See below — rejected to keep the checked text identical to the submitted text. |
| Multiple statements, `.`/`;` tails, DML tails | Only one statement may be authorized. |
| Host expressions and host variables (`@`, `@( ... )`), `FOR ALL ENTRIES` | Values are not statically provable; also the SAP Note 3772411 construct. |
| Dynamic sources `FROM (name)` | Runtime value is unknowable from the submitted string. |
| `WITH PRIVILEGED ACCESS` | Explicitly suppresses CDS access control. |
| `CLIENT SPECIFIED` / `USING CLIENT` | Client override changes the data actually read. |
| `CONNECTION ...` | Secondary database connections leave the governed target. |
| CDS association paths (`\_assoc`) and column paths | Path compilation implicitly inserts joins whose targets are absent from the root closure; accepting the parser node without resolving each segment would be a bypass. |
| `PROVIDED BY` / external provider syntax | Source is outside the resolvable repository model. |
| CDS table functions as a root or dependency | AMDP `USING` lineage is not expanded in v1. |
| Classic/generated DDIC views where complete lineage is unavailable | `VIEW/DV` base tables cannot be proven through the current ADT surface. |
| Any statement the pinned grammar cannot parse completely | Never downgrade a parser error to a warning; that is the opposite of the lint path's behaviour and would be an authorization hole. |

#### Why comments are rejected

The prototype silently accepted ABAP comments: `SELECT * FROM SCARR " UNION SELECT * FROM USR02` parsed
to `["SCARR"]` because `@abaplint/core` strips comments during lexing, while the **original, unmodified
string** — comment included — is what is posted to `/sap/bc/adt/datapreview/freestyle`.

This must be stated precisely, because an earlier review overstated it. Live SAP_BASIS 758 checks show:

- an inline `"` comment made SAP return **HTTP 400**; the statement did not execute;
- a column-one `*` comment was **ignored by SAP**, matching ordinary ABAP comment semantics.

So there is **no demonstrated exploit** here, and none should be claimed. The reason to reject comments
anyway is narrower and purely defensive: while comments are accepted, the text the security parser
inspects is not the text SAP receives, and that difference is only safe because of an assumption about a
second parser that ARC-1 does not control. Rejecting comments removes the assumption, shrinks the parser
surface, and costs nothing — ADT documents comments as unsupported in this console. The corresponding
tests are **grammar-hardening tests and must not be labelled exploit proofs.**

The rejection must be lexically precise. A double quote *inside* a single-quoted literal is legitimate
and must still be accepted, and doubled single quotes (`'it''s'`) must be tracked correctly:

| Input | Required outcome |
|---|---|
| `SELECT * FROM SCARR " comment` | `DATA_SQL_UNSUPPORTED` |
| `SELECT * FROM SCARR` + newline + `* comment` | `DATA_SQL_UNSUPPORTED` |
| `SELECT * FROM SCARR WHERE X = 'a"b'` | accepted — the quote is inside a literal |
| `SELECT * FROM SCARR WHERE X = 'it''s'` | accepted — doubled quote is an escaped quote |

## SAP graph interpretation

The relevant SAP ADT service is the **SQL Dependency Graph** (also presented in ADT as the SQL Dependency
Tree). On A4H SAP_BASIS 758 it is available at:

```text
GET /sap/bc/adt/ddic/ddl/dependencies/graphdata
    ?ddlsourceName=<DDLS>&addMetrics=false
Accept: application/vnd.sap.adt.ddl.SQLDependencyModel.v3+xml
```

The older SAP_BASIS 750 contract uses the same resource without metrics and returns the element-info
media type. Exact entity-to-DDLS resolution still requires repository metadata because CDS entity,
DDLS source, generated SQL view, and replacement-object names need not be identical.

`addMetrics=true` is unnecessary for authorization. On the sampled A4H responses it added roughly 40%
to the XML size without changing topology. The policy request should omit metrics or request
`addMetrics=false`.

### Live compatibility finding

Live SAP_BASIS 758 (A4H, client 001) returned this exact shape for `I_BUSINESSPARTNER`:

| Node | `TYPE` | Role |
|---|---|---|
| `I_BUSINESSPARTNER` (root) | `CDS_VIEW`, with `AC_STATE=DEFINED` | SQL dependency root |
| `BUT000` | `TABLE` | SQL data-contributing terminal source |
| `RELATED_OBJECTS_TREE` | auxiliary | container for non-SQL related objects |
| ↳ `RELATED_OBJECTS_ENTRY` | auxiliary | one related-object entry |
| ↳ `DCLS_OBJECT_LIST` | auxiliary | access-control object list |
| ↳ `DCLS/DL` leaf | auxiliary | the DCL object itself |

Two consequences follow, and both correct earlier assumptions:

1. **`AC_STATE` is not the only representation of DCL in the graph.** An earlier reading of the
   `DEMO_CDS_SUMDIST` fixtures concluded that access control appears only as a node *property*. That is
   false. A standard view carries `AC_STATE` on the root **and** a separate auxiliary
   `RELATED_OBJECTS_TREE → RELATED_OBJECTS_ENTRY → DCLS_OBJECT_LIST → DCLS/DL` branch. Any implementation
   that assumes "DCL is only a property" will mis-handle the auxiliary branch.
2. **The current prototype refuses a normal SAP standard view.** It treats every `elementInfo` as a SQL
   source, so the auxiliary leaf — which carries no SQL source `TYPE` — is classified as an unsupported
   kind and denies the request. `I_BUSINESSPARTNER` is an ordinary released SAP view; refusing it is a
   compatibility defect, not a security property.

Live 758 also confirms `TYPE=CDS_TABLE_FUNCTION` for the table-function nodes beneath
`CDS_WITH_TABLE_FUNCTION_3`. The prototype's fail-closed test for table functions used a **fabricated**
type string and therefore proved nothing about the live contract. The implementation must classify the
real `CDS_TABLE_FUNCTION` value explicitly and must be covered by a captured, sanitized live fixture
rather than an invented node.

The parser must distinguish known auxiliary metadata branches from the SQL dependency branch:

- follow and validate every SQL data-contributing branch;
- ignore explicitly recognized DCL/related-object metadata branches for data-lineage purposes;
- fail closed on unknown nodes inside a SQL dependency branch;
- retain access-control presence as optional audit context, not as a substitute authorization decision.

The intended meaning of “blocked source” should be a source that can contribute application data to the
query result. Treating authorization-helper dependencies as application data lineage would make normal
DCL-protected views operationally unusable and would conflate two different security questions.

## Live performance findings

Safe read-only measurements were taken on A4H client 001. No vulnerability payload or write was used.
Discovery setup was excluded from the focused per-call timing.

| Case | Median | SAP calls made by guarded operation | Observed effect |
|---|---:|---:|---|
| Policy off, table query | 398 ms | 0 GET + 1 POST | Baseline |
| Policy on, allowed table | 710 ms | 2 GET + 1 POST | About +312 ms |
| Policy on, allowed simple CDS | 1,216 ms | 4 GET + 1 POST | About +818 ms |
| Direct blocked source | 6 ms | 0 | Cheap local deny |
| Transitively blocked CDS | 487 ms | 2 GET, no POST | Denied before query |
| Policy off, multi-level CDS | 712 ms | 0 GET + 1 POST | Baseline |
| Policy on, multi-level CDS with three table leaves | 1,563 ms | 5 GET + 1 POST | About +851 ms median; one 2.6 s run |

The concern about cost is therefore justified. Strict lineage is not a harmless default. Its cost grows
with repository resolution, dependency graph size, terminal table replacement checks, network latency,
and generated query chunking.

### Performance design

For experimental v1:

- Keep the feature off by default and add no work in the off path.
- Do not add a cross-request positive cache yet. This avoids stale policy decisions while behavior and
  graph compatibility are still being established.
- Deduplicate roots and lineage within the request.
- Authorize once per logical top-level request. Internally generated IN-list chunks must reuse a private,
  request-scoped authorization result rather than re-running graph analysis for every chunk.
- Do not request graph metrics.
- Emit policy duration, metadata-call count, graph-node count, and cache state in the audit record so a
  later cache decision is evidence-based.

If a cache is added later, cache only complete successful lineage. Its key must include target, client,
canonical root identity, active-definition/version signal, graph media version, and policy version. Use a
bounded short TTL and single-flight resolution, invalidate entries after ARC-1 writes/activation, and deny
after expiry if a fresh resolution fails. Cross-principal sharing should not be assumed safe because
repository visibility can differ by SAP identity.

## Fixed internal reads

ARC-1 also executes fixed queries for implementation features such as table/object lookup, class
hierarchy, transaction enrichment, authorization-trace decoding, and error enrichment. A global guard can
otherwise make unrelated tools slow or unusable.

These must be represented as a small private registry of server-owned operations with declared exact
sources and bounded result shapes:

- there is no caller/LLM `internal=true` bypass;
- fixed operations do not need caller SQL parsing or public-root allowlisting;
- an explicit blocklist entry still denies the internal operation;
- future public allowlisting of a metadata table is not implied merely because ARC-1 uses it internally;
- each internal operation is independently audited.

This separation preserves central enforcement while avoiding accidental privilege expansion and repeated
parsing of SQL that the server itself generated.

## Failure behavior and audit

Security-relevant uncertainty should deny only when the feature is enabled. Stable client-facing reasons
should distinguish at least:

- `DATA_SOURCE_BLOCKED`: a configured name matched; query was not sent;
- `DATA_LINEAGE_UNRESOLVED`: ARC-1 could not establish complete supported lineage; query was not sent;
- `DATA_SQL_UNSUPPORTED`: the statement falls outside the strict parser subset; query was not sent.

Detailed SAP/network text belongs in operator logs, not in the LLM-visible error. Under
`ARC1_MINIMAL_ERRORS`, return a correlation/decision ID and a generic explanation. Otherwise return the
first safe source path and policy reason, without query literals or row values.

`ARC1_MINIMAL_ERRORS` is a **client-disclosure control only**. It changes what the MCP client and the
model are told; it must never change what is decided, and it must never reduce what is recorded. The
protected operator audit event always retains the complete normalized policy decision — canonical direct
roots, matched rule, full deterministic dependency path, decision ID, policy fingerprint, timing, and
call/node counts — regardless of the flag. An operator investigating a denial must be able to reconstruct
it fully from the audit trail even when the model was told almost nothing.

One honest limitation must be documented rather than overstated: minimal mode redacts **names and paths**,
but the three stable codes remain distinct on purpose, because a model that cannot tell "blocked by
policy" from "SQL unsupported" cannot self-correct. Retaining a distinguishable `DATA_SOURCE_BLOCKED`
therefore still permits coarse membership inference by probing. That is a deliberate, documented trade in
favour of useful model feedback. Do not claim minimal mode eliminates membership inference.

Every model-facing denial must carry these conceptual fields even if the MCP result is rendered as text:

| Field | Normal errors | `ARC1_MINIMAL_ERRORS` |
|---|---|---|
| Stable `code` | Yes | Yes |
| `decisionId` | Yes | Yes |
| `executed` | Always `false` for a pre-submit policy denial | Always `false` |
| Operation/tool action | Yes | Yes, when not itself sensitive |
| Direct root and matched rule | Yes | Redacted |
| Dependency path | Complete first proven path from requested root to blocked source | Redacted |
| Safe alternative | Yes when one exists, for example `tadir_lookup source="adt"` | Yes when it does not reveal policy-sensitive names |
| Raw SQL, literals, row data, SAP body/stack | Never | Never |

Example normal response:

```text
DATA_SOURCE_BLOCKED: SAPRead(TABLE_QUERY) was denied before SAP data execution.
Path: ZC_EMPLOYEE -> ZI_EMPLOYEE -> PA0002. Matched SAP_BLOCKED_DATA_SOURCES entry PA0002.
executed=false decisionId=dsp_...
```

Example minimal response:

```text
DATA_SOURCE_BLOCKED: the request was denied by the administrator's data-source policy before SAP data execution.
executed=false decisionId=dsp_...
```

The identifier must be opaque, non-secret, bounded, and common to the client response and operator audit.
The implementation should return the first deterministic matched path so tests and model behavior do not
depend on graph response order.

An audit decision should include principal, target/client, policy mode/version, canonical direct roots,
closure hash, matched rule, decision, decision ID, policy latency, metadata request count, graph node count,
and cache status. It should not contain SQL literals, credentials, data rows, or backend bodies.

## SAP Note 3772411 remains independent

SAP Note 3772411 describes a high-severity SQL Console host-expression issue affecting SAP_BASIS 750–816,
918, and 920. On an affected system, method calls in host expressions can reach ADBC and execute native
database statements. A non-empty prototype blocklist happens to reject host expressions; the default-off
feature does not remediate the vulnerable SAP endpoint and must not be documented as doing so.

Patch or apply SAP's official workaround independently. For restricted deployments, keep
`SAP_ALLOW_FREE_SQL=false` until the target is corrected. `SAP_ALLOW_WRITES=false` does not neutralize a
database-side mutation reached through the vulnerable SQL Console path.

## Multi-target semantics

A global blocklist is conservative across targets: a name denied for one system is denied everywhere, so
it only removes access. That is acceptable for the minimal experiment if documented.

An allowlist is different. The same name may represent different active definitions or dependencies on
two systems. A production allowlist must therefore be target/client-scoped. A missing, stale, or ambiguous
target policy should deny or hide data tools; it must never fall back to another target's permission.

## Documentation and rollout

The feature documentation should state prominently:

- experimental, opt-in, default off, and administrator-controlled;
- exactly one public policy field in v1: `SAP_BLOCKED_DATA_SOURCES`, with no separate mode or allowlist;
- exact config syntax: unset/blank means off, while an activated non-empty CSV containing an empty or
  invalid field fails startup;
- configuration precedence, restart requirements, and durable Docker/BTP enable-and-disable examples;
- supported direct roots and refused source kinds/SQL constructs;
- transitive CDS and replacement-object behavior;
- measured latency and the number of metadata calls involved;
- fail-closed behavior and stable error codes;
- DCL non-inheritance and the distinction between SQL lineage and auxiliary access-control metadata;
- non-atomic check/query timing and the resulting TOCTOU limitation;
- multi-target scope;
- the independent requirement to apply SAP security corrections;
- rollback: set the value to `""` and restart/redeploy (or truly unset it where the deployment method
  supports reliable removal) to restore previous behavior.

Rollout recommendation:

1. Experimental blocklist behind explicit config; no cache; metrics and audit enabled.
2. Compatibility soak against representative customer CDS graphs and all supported releases.
3. Optimize request-scoped reuse and graph interpretation; establish latency budgets.
4. Add a simple root allowlist only if customers want that operational model.
5. Add the target-scoped manifest with approved dependency closure/digest for high-assurance use.

Do not change the existing general defaults merely because this feature exists. If a future major release
wants a secure-by-default data plane, the cleaner change is to keep data tools disabled without explicit
policy rather than silently activating expensive dependency analysis for current users.

## Normative v1 decisions for independent review

| Decision | Recommendation | Why |
|---|---|---|
| Public configuration | One field: `SAP_BLOCKED_DATA_SOURCES`; CLI mirror only | Keeps the experiment understandable and leaves no LLM-controlled or interacting mode switch |
| Permanent name | Keep `SAP_BLOCKED_DATA_SOURCES` | “Data sources” correctly spans tables/CDS/aliases; the existing `SAP_*` safety family is the discoverable location |
| First deliverable | Blocklist only; design allowlist now, implement later | Keeps the experiment small while avoiding premature flat-list semantics |
| Blocklist strength | Direct and transitive, including replacement objects | Matches the security claim and prevents wrapper bypass |
| Meaning of lineage | Application data-contributing SQL branches, not DCL helper metadata | Preserves normal protected CDS use while keeping data lineage complete |
| Default and control plane | Unset/off; server admin config only | No surprise cost and no LLM-controlled weakening |
| Empty explicit value | Off, same as unset; malformed non-empty CSV fails startup | Required by the shipped Docker/MTA defaults and gives one-setting deployments a durable disable value; strict token validation still catches comma/list errors |
| Wildcards | None in v1 | Avoids ambiguous alias and matching behavior |
| Caching | No cross-request cache in v1 | Prefer correctness until compatibility and latency telemetry are known |
| Raw `SAPQuery` | Support only the strict, fully parsed subset; recommend leaving free SQL disabled on sensitive systems | Raw SQL creates the largest parser and SAP Note exposure |
| Internal fixed queries | Private declared registry; blocklist still applies | Avoids a caller-controlled bypass and keeps future allow roots separate |
| Future allowlist | Direct roots plus deny-anywhere; target-scoped policy file for strong mode | Avoids granting direct access to implementation tables and cross-target confusion |
| Client errors | Stable safe reason plus decision ID; detail in audit | Useful denial without leaking SQL/backend details |

## Follow-up decision refinement

The product owner accepted the overall design decisions on 2026-09-02. The following refinements capture
the remaining implementation boundary. The later configuration-contract review above supersedes the
earlier “explicit empty is an error” recommendation; no other accepted security semantic changed.

### Cost of deeper SQL and lineage analysis

“Deeper parsing” separates into materially different levels:

| Level | Additional behavior | Relative implementation risk | Runtime effect |
|---|---|---:|---:|
| Conservative static-source extraction | Static joins, unions, subqueries, CTEs, parameterized CDS roots and hierarchy roots; reject risky constructs | Existing baseline | Warm local parse measured about 0.9 ms/query |
| More static grammar and release calibration | Select-list/condition variants and release-specific syntax while preserving exact source extraction | Moderate | Normally a few local milliseconds; no necessary SAP call |
| ABAP SQL association-path resolution | Resolve each path segment, exposed CDS/CTE association, parameters and redirects, then authorize target lineage | High | Additional metadata reads per unique path; network cost dominates |
| CDS table-function expansion | Resolve `implemented by method`, read the AMDP method, parse `USING`, and recurse | High | Multiple extra ADT reads per unique implementation chain |
| Field-sensitive lineage | Decide whether only selected columns can reach a source through projections, expressions, unions and functions | Very high | More source/metadata reads and release-dependent semantic analysis |
| Dynamic data-source proof | Determine the runtime value of `(source_syntax)` from only a submitted SQL string | Not safely available with the current tool contract | Must remain denied unless the API is redesigned to provide and verify a fixed source |

The current `@abaplint/core` AST already extracts static sources from joins, unions, subqueries, CTEs,
parameterized CDS roots and hierarchy roots. The local parser is therefore not the latency problem. A
focused warm benchmark averaged roughly 0.9 ms for the sampled queries. The larger cost begins when ARC-1
must call SAP to resolve aliases and semantic paths.

Association-path support is specifically nontrivial. SAP documents that compiling a path expression
implicitly inserts joins and that path segments may carry parameters, filters, cardinality and join type.
The live graph also showed that a merely exposed association is absent from the ordinary root dependency
closure, while an association dereferenced inside the CDS projection is present. Supporting caller path
navigation therefore needs query-path-aware metadata resolution; merely accepting the parser node would
create a bypass.

Table functions are feasible but are a separate feature. SAP requires managed database objects used by
an AMDP implementation to appear in its `USING` list. ARC-1 would still need to resolve the implementing
method, recursively follow nested AMDP/CDS entries, and reject external schema, missing source, unsupported
object and cycle cases.

Recommendation: keep association paths, table functions, field-sensitive rules and dynamic sources out of
blocklist v1. Supporting more completely parsed static `SELECT` syntax is reasonable when driven by real
compatibility failures because it adds little runtime cost. Never broaden syntax merely by removing a
rejection; every new construct needs a proven source-resolution rule and negative bypass tests.

### Recommended free-SQL deployment profile

The recommended security-focused pairing is:

```dotenv
SAP_ALLOW_DATA_PREVIEW=true
SAP_ALLOW_FREE_SQL=false
SAP_BLOCKED_DATA_SOURCES=USR02,PA0002
```

This keeps structured `TABLE_QUERY` and supported `TABLE_CONTENTS` reads while removing caller-authored
freestyle SQL. It materially reduces parser and SAP SQL Console attack surface. A blocklist plus free SQL
may remain an explicitly supported advanced configuration so that the policy still protects installations
that genuinely require `SAPQuery`, but startup and documentation should label it as the less restrictive
profile and require the strict static-SQL subset.

Do not make the settings technically mutually exclusive in v1. Both are already explicit administrator
choices, and forcing an error would remove the primary reason the SQL analyzer exists. Instead:

- show a prominent startup warning when blocklist and free SQL are both active;
- recommend free SQL off in the security guide and examples;
- state that unsupported SQL will be denied before submission;
- require SAP Note 3772411 remediation independently.

The product owner confirmed this choice: ARC-1 should support as much caller-authored static SQL as it can
prove safe, while sensitive deployments should disable free SQL and expose only structured data access.
“Support as much as possible” is a compatibility objective, not a best-effort authorization mode: malformed,
ambiguous, dynamic, incompletely parsed or unsupported SQL must still be denied before submission.

### Fixed-table impact and model feedback

Blocking a table used by ARC-1 must not fail silently. The intended behavior by current consumer is:

| Blocked source | Affected feature | Recommended behavior and LLM guidance |
|---|---|---|
| `TADIR` | `SAPSearch(tadir_lookup, source="db"|"both")` | Deny the DB-backed/combined lookup and tell the model to retry with `source="adt"`; explain that the ADT alternative cannot see orphan/ghost TADIR rows |
| `TSTC` | Optional program-name enrichment for `SAPRead(type="TRAN")` | Return the transaction metadata without the program enrichment and add a warning that TSTC was blocked |
| `SEOMETAREL` | `SAPNavigate(hierarchy)` and interface-implementer augmentation of where-used | Hierarchy fails with a named reason; native where-used may return without augmentation but must warn that implementers can be incomplete |
| `SWOTLV` | `SAPRead(type="SOBJ")` BOR method catalog/implementation lookup | Deny the SOBJ operation and explain that BOR method resolution requires SWOTLV |
| `SUAUTHVALTRC` | `SAPDiagnose(authorization_trace)` trace rows | Deny and explain that the trace data source is blocked |
| `TOBJ` | Authorization-trace field-name decoding | Deny the action rather than silently return potentially ambiguous positional authorization fields; explain that both SUA... and TOBJ are required |

This matrix should be generated from or kept adjacent to the private internal-operation registry so code,
tests and documentation do not drift. Optional enrichments should return partial data with an explicit
warning; core operations should fail with an actionable alternative. The LLM must never infer success from
a silently swallowed policy error.

The product owner confirmed this degradation model. Normal model-facing policy errors should also expose the
exact safe dependency path and affected operation. Under `ARC1_MINIMAL_ERRORS`, the stable code, decision ID,
whether SAP execution occurred, and safe alternative remain visible while policy-sensitive source names and
backend details are omitted.

### No-cache operating contract

The first release intentionally trades speed for current SAP truth:

- no cross-request positive decision or lineage cache;
- request-local deduplication and authorization-result reuse are still required;
- every independent request revalidates active source lineage;
- direct exact blocks remain local and cheap;
- SAP metadata timeout or incomplete lineage denies while the feature is active.

Documentation should use direct language: “Blocklist mode performs additional SAP metadata requests and is
slower by design.” The live A4H examples added roughly 0.3 seconds for an allowed table and 0.8–0.9 seconds
for the tested CDS paths, with a 2.6-second deeper-view outlier. These are observations, not a customer SLA.

### Deferred BTP destination design

No destination field should be added in blocklist v1. Current multi-target discovery quarantines unknown
`arc1.*` properties and supports only a deliberately small field contract, so a speculative property would
prematurely become part of that contract.

When multi-target policy is designed, the safest compositional rule is:

```text
effective deny set = instance-wide SAP_BLOCKED_DATA_SOURCES
                   union destination-local additional denies
```

A destination may narrow the instance policy but never remove a global deny. A small exact list could be an
additional property such as `arc1.blocked_data_sources`. A large or versioned allowlist should use a stable
policy reference rather than an inline destination value. SAP supports application-defined additional
destination properties, but no authoritative custom-property value-size contract was found during this
review; that is another reason not to place a large policy document in a destination.

Policy fields must be included in the destination fingerprint, malformed entries must quarantine that
target, and changes should require the existing multi-target restart/snapshot workflow. The destination
administrator is thereby a data-policy administrator and must be documented and audited as such.

## Prototype-to-spec delta ledger

This ledger is descriptive only. No implementation change is authorized until the specification review
is complete.

| Surface | Prototype observed on 2026-09-02 | Required by this specification |
|---|---|---|
| Public settings | `SAP_BLOCKED_DATA_SOURCES` plus its CLI mirror | Keep exactly these spellings; add no mode, allowlist, cache, or destination setting |
| Empty value | Empty is off | Keep this behavior because Docker/MTA deliberately supply `""` |
| Empty CSV fields | `.filter(Boolean)` silently accepts `USR02,,PA0002,` | Reject every empty field once the overall trimmed value is non-empty |
| Normalization | Trim, Unicode-uppercase, then validate/deduplicate | Validate raw ASCII first, fold only ASCII case, and preserve first occurrence order; Unicode inputs must not normalize into a different allowed name |
| Startup visibility | Structured info log contains the full normalized list and a count | Info log should contain enabled/count/fingerprint only; exact names stay on explicit admin inspection surfaces |
| “Unreachable policy” warning | Warns that no governed data request is reachable when data preview and free SQL are both off | **Keep unchanged — the warning is correct.** `checkOperation(Query/FreeSQL)` runs before the guard, and internal fixed reads use the same gated client methods, so both flags false means nothing is reachable. An earlier draft of this ledger claimed internal reads stay reachable; that was wrong and is corrected here |
| Admin inspection | `arc1 config show` and admin UI show exact names/source | Keep; web UI remains authenticated with `admin` scope and `/health` remains policy-name-free |
| Default manifests | Dockerfile and base MTA set an empty value | Keep as an explicit off default; document the non-empty MTA override and `""` rollback |
| Security-first recipe | Shipped docs emphasize a blocklist + free-SQL combination | Lead with data preview on, free SQL off; retain free SQL + blocklist only as an advanced compatibility profile |
| CDS graph parsing | Auxiliary DCL/related-object nodes can be treated as unknown data nodes | Classify only proven SQL data branches as lineage; fail closed on unknown SQL nodes |
| Dependency graph request | SQL Dependency Model request sets `addMetrics=true` | Request `addMetrics=false`; metrics add payload but no authorization topology |
| Chunked SQL | Authorization can be repeated for generated IN-list chunks | Authorize once per logical request and reuse only within that request |
| Internal table reads | No complete declared-consumer registry yet | Central private registry; blocklist still applies; optional enrichment warns, core dependency denies clearly |
| Policy cache | No dedicated cross-request policy cache required | Keep none in v1; do not accidentally reuse the general ARC-1 object cache for authorization decisions |
| Error contract | `DATA_SOURCE_UNRESOLVED` combines parser and lineage failure and has no complete decision envelope | Split stable blocked/lineage/SQL codes; add decision ID + executed/not-executed; exact path normally, redacted path under minimal errors |

### Configuration checks reproduced locally

The current resolver was exercised without changing files:

```text
SAP_BLOCKED_DATA_SOURCES=''                 -> []
SAP_BLOCKED_DATA_SOURCES='USR02,,PA0002,'   -> ["USR02","PA0002"]
SAP_BLOCKED_DATA_SOURCES='USR02,SCARR*'      -> startup error
SAP_BLOCKED_DATA_SOURCES='ß'                 -> ["SS"]
SAP_BLOCKED_DATA_SOURCES='ſ'                 -> ["S"]
```

The first and third results are consistent with this specification. The second is the empty-field parser
gap; the fourth and fifth demonstrate why raw ASCII validation must happen before normalization. This pass
did not change or retest SAP dependency endpoints because the revised question is the deployment/configuration
contract; the live 750/758 endpoint and 758 behavior evidence in this dossier and the linked earlier dossier
remains the SAP baseline.

## Open validation work before code changes

- Obtain an independent review of the permanent name, blank/off contract, strict non-empty CSV grammar,
  admin-only exact-value visibility, and one-setting activation model.
- Add a deployment-matrix test plan for unset, blank, whitespace, separator-only, leading/trailing/repeated
  separators, duplicates, raw non-ASCII/case-folding inputs, invalid characters, CLI precedence, Docker
  override, and MTA enable/disable.
- Confirm the auxiliary-node taxonomy on SAP_BASIS 750 and 816 as well as 758.
- Build fixtures for standard views with DCL, associations, parameters, table functions, generated SQL
  aliases, replacement objects, cycles, and unsupported node types.
- Decide and document whether associations that are present in a CDS model but not used by the submitted
  SQL count as dependencies. The conservative initial recommendation is to include every SQL dependency
  edge returned by SAP while association-path SQL remains refused.
- Inventory and classify every fixed internal query before central enforcement is changed.
- Establish a latency budget and acceptable metadata-call ceiling from representative customer systems.
- Keep the SAP Note 3772411 hardening/patch status as a separate deployment prerequisite.

## V1 release acceptance criteria

Implementation may be called conformant only when all of the following are demonstrated:

- **Public contract:** `SAP_BLOCKED_DATA_SOURCES` is the only new semantic policy field; the CLI flag is
  a precedence-equivalent mirror. No tool schema lets a caller modify it.
- **Inactive path:** unset, blank, and whitespace-only values add no parser work, SAP metadata request,
  cache access, or data-path latency beyond a constant empty-list check.
- **Strict startup parsing:** the complete configuration matrix above is covered, including raw Unicode
  case-folding attacks and empty CSV fields; invalid active input prevents server startup.
- **Central pre-submit enforcement:** every governed caller-controlled and declared internal data path is
  checked before its SAP data POST. Negative tests prove there is no sibling method that bypasses the
  guard.
- **Complete supported lineage:** direct names, canonical aliases, CDS transitive SQL branches, and DDIC
  replacement chains are denied on any match; unknown or incomplete supported lineage denies.
- **Direct-deny fast path:** all direct roots are normalized and checked before any one root is resolved;
  if any direct root is blocked, zero SAP metadata/data calls are made.
- **Safe compatibility boundary:** auxiliary DCL/related-object metadata is not mistaken for application
  data lineage; unsupported SQL/source kinds fail with `DATA_SQL_UNSUPPORTED` or
  `DATA_LINEAGE_UNRESOLVED`, never fall through to SAP.
- **One decision per logical request:** generated IN-list chunks reuse only an in-memory request-scoped
  authorization result; a later request performs fresh lineage resolution.
- **No authorization cache:** no positive/negative lineage decision is stored in memory, SQLite, the
  general object cache, or a process-global map after the request ends.
- **Errors and audit:** denials prove the SAP data request was not sent, carry a stable code and decision
  ID, and follow exact-path versus minimal-error redaction. Audit contains timing/call/node evidence and
  no SQL literals, row values, credentials, or backend bodies.
- **Internal-read behavior:** every fixed-table consumer is inventoried and tested; optional enrichment
  returns an explicit warning, while a blocked core dependency fails with the documented alternative.
- **Deployment behavior:** `.env`, CLI, Docker, base MTA, `.mtaext`, config-show, startup log, admin UI,
  and rollback examples agree on the same normalized effective value and source precedence.
- **Multi-target v1:** the instance-wide deny set is copied into every target runtime and cannot be
  weakened by a destination or caller. No destination-local policy is advertised.
- **Independent SAP hardening:** documentation does not claim this feature fixes SAP Note 3772411 and
  recommends `SAP_ALLOW_FREE_SQL=false` for sensitive deployments regardless of the blocklist.
- **Verification:** focused unit/property/negative tests, complete repository test/lint/typecheck, and
  read-only live tests on the supported 750/758/816 graph variants pass before release.

## ARC-1 impact map

No implementation files were changed in this pass. A later rework would affect these existing surfaces:

- Configuration and propagation: `src/server/config.ts`, `src/server/types.ts`, `src/cli-args.ts`,
  `src/index.ts`, `src/server/server.ts`, `src/server/multi-target-runtime.ts`.
- Central safety and query entry points: `src/adt/safety.ts`, `src/adt/client.ts`,
  `src/handlers/query.ts`, `src/handlers/read.ts`, `src/handlers/query-errors.ts`.
- Prototype policy/parser: `src/adt/data-source-policy.ts`, `src/adt/sql-source-analyzer.ts`,
  `src/adt/codeintel.ts`, `src/adt/xml-parser.ts`.
- Audit/errors: `src/server/audit.ts`, `src/server/logger.ts`, `src/handlers/dispatch.ts`,
  `src/adt/errors.ts`.
- Unit and integration tests under `tests/unit/adt`, `tests/unit/handlers`, `tests/unit/server`, and
  `tests/integration`; tool-definition snapshots only if the model-facing schema changes.
- Operator and security documentation: `.env.example`, `docs_page/configuration-reference.md`,
  `docs_page/security-guide.md`, `docs_page/authorization.md`, deployment examples, and release notes.

The complete earlier code-path inventory and endpoint history remain in
`docs/research/2026-09-02-data-source-allowlist-and-cds-lineage.md`.

## Evidence and sources

- SAP Help, **SQL Dependency Graph**:
  <https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/942785eb9fe64ca9876918e752d6432b.html>
- SAP ABAP Keyword Documentation, **CDS Access Control**:
  <https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_ACCESS_CONTROL.html>
- SAP Notes 3772411, 3776714, and 3790544:
  <https://me.sap.com/notes/3772411>, <https://me.sap.com/notes/3776714>,
  <https://me.sap.com/notes/3790544>
- SAP Help, **Defining MTA Extension Descriptors** (module properties can be added/overwritten):
  <https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/50df803465324d36851c79fd07e8972c.html>
- SAP Help, **Parameters and Properties** (MTA module properties become application environment
  variables):
  <https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/490c8f71e2b74bc0a59302cada66117c.html>
- Docker, **Dockerfile `ENV`** and **`docker run --env`** (image values persist and runtime values
  override them): <https://docs.docker.com/reference/dockerfile/#env>,
  <https://docs.docker.com/reference/cli/docker/container/run/#env>
- Cloud Foundry, **App manifest attribute reference** (manifest environment values persist; removing a
  manifest line does not unset an existing environment variable):
  <https://docs.cloudfoundry.org/devguide/deploy-apps/manifest-attributes.html#env-block>
- OWASP, **Authorization Cheat Sheet**:
  <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
- NIST, **Least Privilege**:
  <https://csrc.nist.gov/glossary/term/least_privilege>
- NIST SP 800-160, secure defaults and authorization principles:
  <https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-160.pdf>
- Open Policy Agent, **Decision Logs**:
  <https://www.openpolicyagent.org/docs/management-decision-logs>
- SAP Eclipse ADT reference checkout:
  `~/DEV/arc-1-eclipse-adt/api/21-data-preview-and-query.md` and ADT dependency-service code.
- Reference implementations checked read-only: `~/DEV/arc-1-lsp`,
  `~/DEV/mcp-abap-adt-fr0ster`, and `~/DEV/mcp-abap-adt`.
- Live A4H client 001 tests on SAP_BASIS 758: repository search, SQL dependency graph content,
  table-source replacement metadata, safe structured data reads, and focused timing measurements.
- Local configuration/deployment inspection: `src/server/config.ts`, `src/server/effective-policy-log.ts`,
  `src/server/ui.ts`, `src/server/ui-state.ts`, `src/cli.ts`, `Dockerfile`, `mta.yaml`, and their focused
  tests. The current resolver outputs reproduced in the delta ledger were run with `npx tsx`.

## Research limitations

- The new auxiliary-DCL graph finding and focused latency measurements were live-verified on A4H 758.
  The graph endpoint shape was previously verified on 750, but the DCL-node taxonomy still needs a fresh
  750 and 816 comparison before implementation resumes.
- The configuration-contract re-review used official Docker, Cloud Foundry, and SAP MTA documentation.
  It did not require an additional SAP-system call because environment-name and deployment precedence are
  ARC-1/platform behavior, not an ABAP runtime contract.
- No exploit, write, destructive statement, or customer data extraction was attempted.
- Measurements are directional, not a universal SLA; customer network, repository size, authorization,
  CDS complexity, and SAP load will vary.
