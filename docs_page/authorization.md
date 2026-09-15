# Authorization and roles

<a id="authorization-roles"></a>

A request needs permission from the ARC-1 server, the caller's role and SAP.
Use [Capability requirements](#capability-requirements) to enable an action or
[troubleshooting](#troubleshooting-which-layer-blocked-me) to find why it was denied.

## The model in one picture

ARC-1 has three independent gates. A request succeeds only if all relevant gates allow it.

| Gate | Question | Set by | Example |
| ---- | -------- | ------ | ------- |
| **1. Server ceiling** | Is this capability enabled on this ARC-1 instance? | ARC-1 admin, env vars / CLI | `SAP_ALLOW_WRITES=true` |
| **2. User permission** | Is this user allowed to use the capability? | XSUAA role, OIDC scope, or API-key profile | `write` scope, `developer` key |
| **3. SAP authorization** | Does the SAP user have backend authorization? | SAP Basis / role admin | `S_DEVELOP`, `S_ADT_RES`, package auth |

Think of it as **AND**, never OR:

```text
Effective permission = server ceiling AND user permission AND SAP authorization
```

A user scope can never widen the server. SAP auth can still block a request after ARC-1 allows it.


## SAP permissions for read access

Ask Basis to derive the SAP user's permissions from the display role for that release and the required ADT resources. `S_ADT_RES` restricts resource paths through its **`URI` field**; SAP's standard definition does not list an `ACTVT` field. Other objects, such as `S_DEVELOP`, separately govern display or modification. See [SAP's ADT role and authorization concept](https://help.sap.com/docs/SAP_NETWEAVER_750/c238d694b825421f940829321ffa326a/4ec2c02e6e391014adc9fffe4e204223.html?version=7.5.25).

Some read operations use HTTP `POST`, including search and diagnostics. A gateway that allows only `GET` can break them; allow the required method/resource pairs while keeping SAP modification authorizations restricted. An HTTP method alone does not determine an ARC-1 action's permission.

## Defaults

With no safety flags set, ARC-1 starts in the safest useful mode:

| Capability | Default |
| ---------- | ------- |
| Source reads/search/navigation and read-only lint/diagnostics | On, subject to user `read` scope in HTTP auth mode and SAP auth |
| Object writes / activation / package changes / FLP mutations | Off |
| Named table preview | Off |
| Freestyle SQL | Off |
| Transport writes | Off |
| Git writes | Off |
| Write package allowlist | `$TMP` if writes are later enabled |

Important details:

- Reads are not package-gated by ARC-1. Use SAP authorization for read-level restrictions.
- The `SAP_ALLOWED_PACKAGES` ceiling applies to **every** mutating operation against the object's **real** package (resolved from ADT metadata, fail-closed): create/update/delete/method-surgery, **activation** (`SAPActivate`, single and batch), and **`change_package`** (gated by the move's real source package, never the caller-supplied `oldPackage`). Activating a draft, or moving an object, in a package outside the allowlist is refused even when `SAP_ALLOW_WRITES=true`. Service-binding publish and unpublish also check the binding's real package.
- Transport and Git **read** actions are available when the backend feature exists. Transport/Git **write** actions need extra opt-ins.
- `SAP_ALLOW_WRITES=false` blocks every mutation, including activation, transport writes, and Git writes.


<a id="sap-api-policy-data-preview-and-free-sql-are-gated-for-a-reason"></a>

## Data-access gates

Table preview and freestyle SQL are off by default. Enable the matching server flag only for the required use case; the caller still needs `data` or `sql` scope.
For productive use, review [SAP API Policy & Architecture Alignment](sap-api-policy-and-architecture.md).

<a id="capability-matrix"></a>

## Capability requirements

Use this table to answer: "what must be true before this action can run?" For HTTP auth, the user needs the listed scope or `admin`.

| Capability | User needs | Server needs | Notes |
| ---------- | ---------- | ------------ | ----- |
| Read object source / metadata | `read` | Nothing | `SAPRead`, most `SAPContext`, metadata reads |
| Search objects | `read` | Nothing | `SAPSearch` |
| Navigate / code intelligence | `read` | Nothing | Find definition, references, completion. Class hierarchy is the exception below. |
| Class hierarchy (`SAPNavigate.hierarchy`) | `data` or `sql` plus `read` | `SAP_ALLOW_DATA_PREVIEW=true` or `SAP_ALLOW_FREE_SQL=true` | Reads `SEOMETAREL` via table preview or SQL |
| Read-only lint / local format / diagnostics | `read` | Nothing | Unit/ATC checks produce SAP workload; unit tests execute code and can have side effects |
| Start/cancel runtime traces, change SQL trace state, apply quickfix | `write` | `SAP_ALLOW_WRITES=true` | `SAPDiagnose.trace_start`, `trace_cancel`, `set_sql_trace_state`, `apply_quickfix` |
| Update SAP PrettyPrinter settings | `write` | `SAP_ALLOW_WRITES=true` | `SAPLint.set_formatter_settings` mutates global formatter settings |
| Read transport info | `read` | Nothing | `SAPTransport.list`, `get`, `diff`, `check`, `history` |
| Read Git info | `read` | Nothing | `SAPGit.list_repos`, `history`, `objects`, etc. when Git feature exists |
| Preview named table contents | `data` | `SAP_ALLOW_DATA_PREVIEW=true` | `sql` implies `data` |
| Authorization trace (`SUAUTHVALTRC`) | `data` | `SAP_ALLOW_DATA_PREVIEW=true` | `SAPDiagnose action=authorization_trace`; on-prem STUSERTRACE read only |
| Run freestyle SQL | `sql` | `SAP_ALLOW_FREE_SQL=true` | High risk on productive systems |
| Apply exact source blocklist (experimental) | Existing `data`/`sql` scope | `SAP_BLOCKED_DATA_SOURCES=...` | Further restricts all three data paths; cannot enable access, and unresolved lineage is denied |
| Create / update / delete objects | `write` | `SAP_ALLOW_WRITES=true` | `SAP_ALLOWED_PACKAGES` applies; supports exact (`ZFOO`), prefix (`Z*`), and DEVCLASS subtree (`ZFOO/**`) patterns. Subtree resolution is fail-closed on SAP errors. |
| Activate objects | `write` | `SAP_ALLOW_WRITES=true` | Activation is a mutation |
| Package / FLP mutations | `write` | `SAP_ALLOW_WRITES=true` | FLP list actions are reads; FLP create/delete actions are writes |
| Create / release / delete transports | `write` + `transports` | `SAP_ALLOW_WRITES=true` + `SAP_ALLOW_TRANSPORT_WRITES=true` | `SAP_ALLOWED_TRANSPORTS` can further restrict CTS IDs |
| Gated abapGit mutation / SAP-side Git egress | `write` + `git` | `SAP_ALLOW_WRITES=true` + `SAP_ALLOW_GIT_WRITES=true` | Package-bound actions also need subtree authorization. Accepted push/branch operations can return incomplete; inspect before retrying. Every gCTS mutation is currently quarantined before HTTP. |

Transport/Git mutations require both `write` and the specialized scope. Tool schemas hide unavailable actions; runtime checks still enforce every gate.

## Where to set things

| You want to change... | Change this | Do not change this |
| --------------------- | ----------- | ------------------ |
| What this ARC-1 instance can ever do | Server env / CLI flags (`SAP_ALLOW_*`, `SAP_ALLOWED_PACKAGES`, `SAP_DENY_ACTIONS`). On BTP, set these with `mta-overrides.mtaext`, `cf set-env`, `manifest.yml`, or MTA properties. | User JWT scopes |
| What one BTP user can do | XSUAA role collection assignment | Server env vars; they change the whole ARC-1 instance, not one user |
| What a specific API key can do | `ARC1_API_KEYS="key:profile"` | Server flags only |
| What an OIDC user can do | `scope` / `scp` claim in the JWT | MCP client JSON |
| What SAP ultimately allows | SAP roles / authorization objects | ARC-1 scopes |

Precedence for server config is:

```text
CLI flag > environment variable > .env file > built-in default
```

On BTP, keep durable settings in your landscape `.mtaext`. A `cf set-env` change needs the appropriate restart and must be reconciled into that descriptor.
Use `arc1 config show` to inspect resolved policy; see [Configuration precedence](configuration-precedence.md).

## User scopes

Seven scopes exist:

| Scope | Meaning | Implies |
| ----- | ------- | ------- |
| `read` | Read source, search, navigate, lint, diagnose | - |
| `write` | Object/package/activation/FLP mutations | `read` |
| `data` | Named table preview | - |
| `sql` | Freestyle SQL | `data` |
| `transports` | CTS transport mutations | - |
| `git` | Gated abapGit mutations, SAP-side Git egress, and the reserved authorization boundary for currently quarantined gCTS mutations | - |
| `admin` | All ARC-1 scopes | all other scopes |

Assigning only `transports` or only `git` is not useful for mutations because transport/Git writes also need `write`. The shipped `developer` profiles and BTP `MCPDeveloper` role include `write`, `transports`, and `git` together.


## BTP XSUAA role templates

Start here for BTP deployments. API-key profiles can also coexist with XSUAA/OIDC on supported single-target HTTP deployments.

BTP users receive scopes through role collections. The shipped `xs-security.json` contains these role templates:

| Role template | Scopes |
| ------------- | ------ |
| `MCPViewer` | `read` |
| `MCPDataViewer` | `data` |
| `MCPSqlUser` | `data`, `sql` |
| `MCPDeveloper` | `read`, `write`, `transports`, `git` |
| `MCPAdmin` | all 7 |

Common role collections:

| Role collection | Effective scopes |
| --------------- | ---------------- |
| `ARC-1 Viewer` | `read` |
| `ARC-1 Data Viewer` | `read`, `data` |
| `ARC-1 Viewer + SQL` | `read`, `data`, `sql` |
| `ARC-1 Developer` | `read`, `write`, `transports`, `git` |
| `ARC-1 Developer + Data` | `read`, `write`, `data`, `transports`, `git` |
| `ARC-1 Developer + SQL` | `read`, `write`, `data`, `sql`, `transports`, `git` |
| `ARC-1 Admin` | all 7 |

> Deployed collection names carry the CF space as a suffix — e.g. `ARC-1 Developer (dev)` — because `mta.yaml` derives them from the `${space}` placeholder so the same mtar can run in several spaces of one subaccount. Assign the one matching your space. See [XSUAA Setup](xsuaa-setup.md).

Want a developer who can write code but cannot transport or use Git? Create a custom role template with just `read` + `write`, then update the XSUAA service. Or leave the shipped role as-is and turn off `SAP_ALLOW_TRANSPORT_WRITES` / `SAP_ALLOW_GIT_WRITES` server-wide.

To grant SQL to one BTP user, assign a role collection that includes `MCPSqlUser` (for example `ARC-1 Viewer + SQL` for read-only SQL or `ARC-1 Developer + SQL` for full developer access) to that user. Do **not** change server env vars for one user. The ARC-1 instance must already have `SAP_ALLOW_FREE_SQL=true`; there is no `SAP_ALLOW_SQL` flag.

See [XSUAA Setup](xsuaa-setup.md) for BTP Cockpit assignment steps.


## API-key profiles (non-BTP)

Use API-key profiles for API-key authentication, either alone or alongside configured XSUAA/OIDC authentication:

```bash
ARC1_API_KEYS="viewer-key:viewer,dev-key:developer,admin-key:admin"
```

Each profile grants scopes and, for developer profiles, an additional safety cap. The final result is still intersected with the server ceiling.

Profiles are fixed names built into ARC-1. `ARC1_API_KEYS` only selects one of the profiles below; it does **not** let you attach custom scopes or custom package allowlists to one key.

| Profile | Scopes | Extra profile safety |
| ------- | ------ | -------------------- |
| `viewer` | `read` | No writes, no data preview, no SQL, no transports, no Git |
| `viewer-data` | `read`, `data` | No writes, no SQL, no transports, no Git |
| `viewer-sql` | `read`, `data`, `sql` | No writes, no transports, no Git |
| `developer` | `read`, `write`, `transports`, `git` | Writes capped to `$TMP`, no data preview, no SQL |
| `developer-data` | `read`, `write`, `data`, `transports`, `git` | Writes capped to `$TMP`, no SQL |
| `developer-sql` | `read`, `write`, `data`, `sql`, `transports`, `git` | Writes capped to `$TMP` |
| `admin` | all 7 scopes | No profile package cap; server ceiling still applies |

A `developer*` key is capped to `$TMP` even when the server allows `Z*`. Profiles do not accept custom per-key scopes or package lists: there is no `developer-z` or `key:developer:Z*` syntax.
For transportable-package writes, use OIDC/XSUAA or an `admin` key on a server with a narrow package ceiling.

## Experimental data-source blocklist

`SAP_BLOCKED_DATA_SOURCES` denies exact table/CDS names and sources that depend on them.
It is experimental and off by default. The list narrows enabled data access; unlisted sources remain eligible.
Only the administrator can set it, through this variable or `--blocked-data-sources`.

```bash
SAP_BLOCKED_DATA_SOURCES=USR02,PA0002
```

### Value grammar

| Value | Meaning |
|---|---|
| unset | off |
| `""` | off |
| ASCII whitespace only | off |
| `USR02,PA0002` | active with two entries |
| `,` · `,,,` · `,USR02` · `USR02,` · `USR02,,PA0002` | **startup error** |
| `SCARR*` · `TABL:SCARR` · `!SCARR` · `'SCARR'` · `US R02` | **startup error** |

Entries allow ASCII letters, digits, `_ / $`, at least one letter or digit, and at most 128 characters.
ARC-1 trims ASCII whitespace, uppercases and deduplicates entries. Empty CSV fields and non-ASCII input fail startup; invalid characters are never stripped.
Restart after changing the list. Startup errors identify the invalid token position.

### How a request is decided

Order matters and does not change:

1. **Capability gate** — `checkOperation(Query|FreeSQL)`, i.e. `SAP_ALLOW_DATA_PREVIEW` /
   `SAP_ALLOW_FREE_SQL`, plus the caller's `data`/`sql` scope.
2. **Blocklist policy** — this feature. It can only ever *narrow* an already-enabled capability; it
   can never enable or widen data access.
3. **SAP request.**

Because the capability gate runs first, turning both data flags off means no governed data request is
reachable at all — external *or* internal — and startup says so.

With an active list, one logical request is decided exactly once:

- direct exact matches are denied with **zero SAP calls**;
- otherwise free SQL is parsed locally, each direct source is resolved through exact ADT search, CDS
  roots are expanded through SAP's active SQL dependency graph, and DDIC
  `@AbapCatalog.replacementObject` chains are followed;
- every repository/entity/database alias of every node is compared against the list;
- IN-list chunking does **not** re-decide: the union of all chunks is authorized once and the
  already-authorized statements are then executed.

### Failure codes

| Code | Meaning |
|---|---|
| `DATA_SOURCE_BLOCKED` | An exact configured rule matched, directly or transitively. |
| `DATA_LINEAGE_UNRESOLVED` | Identity, dependency-graph or replacement lineage could not be proven. |
| `DATA_SQL_UNSUPPORTED` | The statement is outside the strict accepted SQL grammar. |

All three mean the SAP data request was **not executed**. Each carries `executed=false` and an opaque
`decisionId` that also appears in the audit log.

### What is deliberately unsupported

While the list is active, these are refused rather than guessed at:

- ABAP comments (`"` to end of line, `*` in column one) — the parser strips them, so what is checked
  would not be what SAP receives;
- host expressions and host variables (`@`, `@( … )`), `FOR ALL ENTRIES`;
- dynamic sources `FROM (name)`, `WITH PRIVILEGED ACCESS`, `CLIENT SPECIFIED`/`USING CLIENT`,
  `CONNECTION …`, provider syntax;
- CDS association and column paths;
- `SELECT SINGLE`, caller-supplied `INTO`/`APPENDING`, multiple statements, DML;
- CDS table functions — live SAP does not expose their AMDP `USING` lineage in the graph;
- classic/generated DDIC views, where complete lineage cannot be proven;
- `TABLE_CONTENTS` with a `sqlFilter` — use the structured `TABLE_QUERY` `where`/`columns` instead.

Joins, unions, nested subqueries, CTEs, parameterized CDS roots, hierarchy sources and aggregates
**are** supported.

### Impact on ARC-1's own features

ARC-1 reads six metadata tables for its own features. These reads are governed like any other, so
blocking one really does disable the feature that reads it:

| Blocked source | Affected feature | Behaviour |
|---|---|---|
| `TADIR` | `SAPSearch(tadir_lookup, source="db"\|"both")` | Denied; retry with `source="adt"` (which cannot see orphan/ghost TADIR rows) |
| `SEOMETAREL` | `SAPNavigate(action="hierarchy")` | Denied; use `SAPRead(type="CLAS", grep="INHERITING FROM")` on MAIN; this reads the declared parent, not a list of subclasses |
| `SEOMETAREL` | Interface-implementer where-used augmentation | Returns native results **with an explicit incompleteness warning** |
| `TSTC` | `SAPRead(type="TRAN")` program name | Returns metadata **with a warning**, without the program name |
| `SWOTLV` | `SAPRead(type="SOBJ")` | Denied; no alternative in ARC-1 |
| `SUAUTHVALTRC` + `TOBJ` | `SAPDiagnose(authorization_trace)` | Denied — both are required; positional values without decoded field names would be misleading |

Optional enrichment always warns rather than silently returning less.

### Cost, and what this is not

**Blocklist mode performs additional SAP metadata requests and is slower by design.** There is no
cross-request cache in v1: every request revalidates live lineage, so a CDS activation is checked on the next request.
Changing the configured blocklist requires an ARC-1 restart. No stale authorization decision is reused. Directly blocked sources
stay cheap and local. The check and the query are separate SAP requests, so the pair is not
transactionally atomic (a TOCTOU window remains).

Under principal propagation the metadata reads run as the calling SAP user, so a user who lacks read
authorization on a DDL source can get `DATA_LINEAGE_UNRESOLVED` for a query SAP itself would have
authorized. That is fail-closed and intended.

Out of scope in v1: generic extension `ctx.http.get()` calls are **not** governed by this policy, so a
plugin can read a blocked source. Object source, dumps and traces are likewise outside the boundary.
Do not enable untrusted plugins if you need this to be a complete data boundary.

This does not replace CDS DCL and does not assume DCL is transitive — SAP evaluates access control at
the entity used as the SQL entry point, not inherited from wrapped entities. It also does not
remediate **SAP Note 3772411**: a default-off feature fixes nothing, and `SAP_ALLOW_WRITES=false` does
not neutralize a database-side mutation reached through a vulnerable SQL Console host expression.
Patch or apply SAP's workaround independently.

### Seeing the effective policy

Exact names appear only on administrator surfaces: `arc1 config show`, the local operator UI, and the
authenticated admin-scoped web UI. Ordinary startup logs and the unauthenticated `/health` endpoint
show no names — startup logs carry enabled, count and a deterministic fingerprint. That fingerprint is
a **configuration-drift and correlation signal only**: it is unsalted by design, the candidate name
space is small and guessable, and it must not be treated as protecting the contents of the list.



## Advanced deny actions

`SAP_DENY_ACTIONS` is the fine-grained deny list. A matching denial blocks the action even when scopes and capability flags allow it. It accepts built-in SAP tool names only; to disable a `Custom_*` plugin, remove its path from `ARC1_PLUGINS` and restart.

Use it for rules like "developers can write, but cannot delete".

| Form | Meaning | Example |
| ---- | ------- | ------- |
| `Tool` | Deny every action of this tool | `SAPGit` |
| `Tool.action` | Deny exactly this action | `SAPWrite.delete` |
| `Tool.glob*` | Glob inside one tool | `SAPManage.flp_*` |

Cross-tool wildcards like `*.delete` are rejected at startup.

```bash
# Inline CSV
SAP_DENY_ACTIONS='SAPWrite.delete,SAPManage.flp_*'

# Or a JSON file path
SAP_DENY_ACTIONS='./deny-actions.json'  # ["SAPWrite.delete", "SAPManage.flp_*"]
```

ARC-1 fails fast if a deny entry references an unknown tool/action, has invalid grammar, or points to an unreadable file. That is intentional: typoed security config should not silently start.


## Recipes

### 1. Read and search only

Set nothing. This is the default.

### 2. Read-only with table preview and SQL

```bash
SAP_ALLOW_DATA_PREVIEW=true
SAP_ALLOW_FREE_SQL=true
# Optional defense in depth; exact names, no wildcards:
SAP_BLOCKED_DATA_SOURCES=USR02,PA0002
```

Users still need `data` / `sql` scopes in HTTP auth mode.

### 3. Local developer on a sandbox

```bash
SAP_ALLOW_WRITES=true
SAP_ALLOWED_PACKAGES='$TMP,Z*'
```

Add only if needed:

```bash
SAP_ALLOW_TRANSPORT_WRITES=true
SAP_ALLOW_GIT_WRITES=true
SAP_ALLOW_DATA_PREVIEW=true
SAP_ALLOW_FREE_SQL=true
```

### 4. Team server with API keys

```bash
SAP_TRANSPORT=http-streamable
SAP_ALLOW_WRITES=true
SAP_ALLOWED_PACKAGES='$TMP,Z*'
ARC1_API_KEYS='viewer-key:viewer,dev-key:developer,admin-key:admin'
```

Use `viewer` for read-only users, `developer` for `$TMP` sandbox writes, and `admin` only for trusted operators. If `admin-key` should write only to Z-packages, keep the server ceiling narrow with `SAP_ALLOWED_PACKAGES='Z*,$TMP'`.

### 5. BTP/XSUAA with per-user identity

```bash
SAP_XSUAA_AUTH=true
SAP_PP_ENABLED=true
SAP_PP_STRICT=true
SAP_ALLOW_WRITES=true
SAP_ALLOW_TRANSPORT_WRITES=true
SAP_ALLOWED_PACKAGES='Z*,$TMP'
```

Then assign role collections in BTP Cockpit. The server says what the instance can do; XSUAA says which user can do it.


## Common misconfigurations

- A scope cannot open a closed server flag.
- Transport and Git writes each need general write permission as well as their specialized scope and flag.
- API-key `developer*` profiles are capped to `$TMP`.
- `SAP_ALLOWED_PACKAGES` restricts writes; SAP roles restrict source reads.

## Troubleshooting: which layer blocked me?

| Error fragment | Layer | What to change |
| -------------- | ----- | -------------- |
| `Insufficient scope: 'write' required` | User permission | Grant `write` scope / profile / role collection |
| `Insufficient scope: 'data' required` | User permission | Grant `data` scope or `viewer-data` profile |
| `Insufficient scope: 'sql' required` | User permission | Grant `sql` scope or `viewer-sql` / `developer-sql` profile |
| `Insufficient scope: 'transports' required` | User permission | Grant role/profile with `transports` |
| `Insufficient scope: 'git' required` | User permission | Grant role/profile with `git` |
| `allowWrites=false blocks mutations` | Server ceiling | Set `SAP_ALLOW_WRITES=true` |
| `allowTransportWrites=false` | Server ceiling | Set `SAP_ALLOW_TRANSPORT_WRITES=true` and `SAP_ALLOW_WRITES=true` |
| `allowGitWrites=false` | Server ceiling | Set `SAP_ALLOW_GIT_WRITES=true` and `SAP_ALLOW_WRITES=true` |
| `allowDataPreview=false` | Server ceiling | Set `SAP_ALLOW_DATA_PREVIEW=true` |
| `allowFreeSQL=false` | Server ceiling | Set `SAP_ALLOW_FREE_SQL=true` |
| `DATA_SOURCE_BLOCKED` / `DATA_LINEAGE_UNRESOLVED` / `DATA_SQL_UNSUPPORTED` | Experimental source policy | Follow the returned path/reason; do not disable the list merely to make an unsupported query run |
| `Operations on package ... are blocked` | Server/profile safety | Adjust `SAP_ALLOWED_PACKAGES` or API-key profile choice |
| `denied by server policy (SAP_DENY_ACTIONS)` | Deny list | Remove or narrow the deny pattern |
| `No authorization for object ...` / SAP 403 | SAP authorization | Fix SAP user roles / PFCG / package auth |
| Bare 403 only for `SAPQuery` / `TABLE_QUERY`, while unfiltered `TABLE_CONTENTS` works | Possibly an upstream WAF/body-inspection false positive | Inspect the gateway audit log and matched rule. Prefer a narrowly scoped WAF rule exclusion; if the security owner approves compressed bodies, use `SAP_GZIP_DATAPREVIEW_BODY=true` as the default-off fallback. |
| `Legacy authorization config detected` | Migration | Replace old v0.6 env vars per [Updating](updating.md#v07-authorization-refactor-breaking-change) |

Debug commands:

```bash
arc1 config show
arc1 config show --format=json
```

Also read startup logs for:

- `effective safety: ...` - final server ceiling
- `config contradiction: ...` - flags that cannot take effect, such as transport writes without writes
- `auth: MCP=[...] SAP=[...]` - active auth methods

The WAF row is a fingerprint, not a diagnosis by status code alone. `SAPQuery` and structured
`TABLE_QUERY` both POST SQL text to `/sap/bc/adt/datapreview/freestyle`; unfiltered
`TABLE_CONTENTS` normally POSTs no filter body to `/sap/bc/adt/datapreview/ddic`. If the same SAP
identity succeeds directly or for the bodyless control but receives a bare gateway-style 403 for
the SQL-bearing call, compare the gateway and SAP access logs to establish where the request
stopped. Do not enable gzip merely to make an unexplained authorization failure disappear.

### MCP sign-in fails or changed roles do not appear

<a id="mcp-sign-in-ends-on-a-blank-page-this-site-cant-be-reached-missing-required-parameters-code-state-nonce"></a><a id="i-changed-the-users-role-but-the-new-scopes-dont-appear"></a><a id="i-have-two-marianexamplecom-users-in-btp-and-only-one-shows-the-role-i-changed"></a>

Use the [XSUAA diagnosis table](xsuaa-setup.md#insufficient-scope-invalid_scope) to distinguish an invalid scope, a missing assignment and a stale token.
Role changes do not rewrite issued JWTs. Verify the collection's current application roles and the signed-in identity-provider origin before refreshing access.

The same email can exist under several BTP IdP origins; assignments must match the origin used for application sign-in.
See [XSUAA role assignment](xsuaa-setup.md#step-3-assign-role-collections).

## References

- [Configuration Reference](configuration-reference.md) - every flag and env var
- [API Key Setup](api-key-setup.md) - non-BTP role-based API keys
- [XSUAA Setup](xsuaa-setup.md) - BTP role collections and OAuth
- [OAuth / JWT Setup](oauth-jwt-setup.md) - external IdP scopes
- [Principal Propagation Setup](principal-propagation-setup.md) - per-user SAP identity
- [Security Guide](security-guide.md) - production hardening
- [Updating](updating.md) - migration from v0.6
- [Cloud Foundry UAA: Session Management](https://docs.cloudfoundry.org/api/uaa/index.html#session-management) - `/logout.do` parameters and behavior
- [SAP: Configure Redirect URLs for Browser Logout](https://help.sap.com/docs/btp/sap-business-technology-platform/configure-redirect-urls-for-browser-logout) - logout redirect allowlisting
