# Authorization & Roles

This page explains how to decide **who can do what** in ARC-1.

The goal is simple: an admin should be able to answer these questions without reading code:

- Which env var do I set on the server?
- Which role, scope, or API-key profile does the user need?
- Why was a request blocked?

For a flat list of every flag, use [Configuration Reference](configuration-reference.md). For the v0.6 to v0.7 migration table, use [Updating](updating.md#v07-authorization-refactor-breaking-change).

---

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

---

## Defaults

With no safety flags set, ARC-1 starts in the safest useful mode:

| Capability | Default |
| ---------- | ------- |
| Read/search/navigate/lint/diagnose | On, subject to user `read` scope in HTTP auth mode and SAP auth |
| Object writes / activation / package changes / FLP mutations | Off |
| Named table preview | Off |
| Freestyle SQL | Off |
| Transport writes | Off |
| Git writes | Off |
| Write package allowlist | `$TMP` if writes are later enabled |

Important details:

- Reads are not package-gated by ARC-1. Use SAP authorization for read-level restrictions.
- Transport and Git **read** actions are available when the backend feature exists. Transport/Git **write** actions need extra opt-ins.
- `SAP_ALLOW_WRITES=false` blocks every mutation, including activation, transport writes, and Git writes.

---

## SAP API Policy: data preview and free SQL are gated for a reason

The April 2026 [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) and the accompanying [SAP API Policy FAQ](https://www.sap.com/documents/2026/04/e2a0665e-4c7f-0010-bca6-c68f7e60039b.html) endorse ADT-based developer tooling for "internal development automation such as code checks, build processes, and transport management". The same FAQ excludes "programmatic reading of application tables or export of business data" and "SQL execution against SAP backend systems".

ARC-1 is designed to stay within the ADT development-tooling scope described in SAP's API Policy FAQ v1.1. It uses documented ADT / Eclipse SDK capabilities for internal development-related use cases and does not expose ADT Data Preview, SQL execution, table reads, or business-data extraction.

When ARC-1 is used with AI assistants or MCP clients, customers should apply additional governance for AI-driven or automated access patterns, including real user identity, authorization checks, audit logging, rate limits, conservative tool exposure, and customer-side review against SAP documentation and agreements.

Two ARC-1 server flags map directly onto the excluded capabilities, and both default to off:

| Flag | Default | What it enables | FAQ alignment |
| ---- | ------- | --------------- | ----------------- |
| `SAP_ALLOW_DATA_PREVIEW=true` | `false` (off) | `SAPRead(type=TABLE_CONTENTS)` — named table content preview | Outside the endorsed development tooling scope. |
| `SAP_ALLOW_FREE_SQL=true` | `false` (off) | `SAPQuery` — freestyle ABAP SQL | Outside the endorsed development tooling scope. |

With both flags at their defaults, the data/sql rows in the capability matrix below are unreachable, and ARC-1 stays inside the FAQ envelope for endorsed development tooling. Turning either flag on is a customer decision that must be made against the SAP API Policy, the customer's SAP agreement, and the customer's internal data-protection rules — not a default production posture.

The `data` and `sql` user scopes (and the `viewer-data`, `viewer-sql`, `developer-data`, `developer-sql` API-key profiles) only become useful after the matching server flag is on. Granting `data` / `sql` to a user does **not** widen the server ceiling.

---

<a id="capability-matrix"></a>

## Capability requirements

Use this table to answer: "what must be true before this action can run?" For HTTP auth, the user needs the listed scope or `admin`.

| Capability | User needs | Server needs | Notes |
| ---------- | ---------- | ------------ | ----- |
| Read object source / metadata | `read` | Nothing | `SAPRead`, most `SAPContext`, metadata reads |
| Search objects | `read` | Nothing | `SAPSearch` |
| Navigate / code intelligence | `read` | Nothing | Find definition, references, completion. Class hierarchy is the exception below. |
| Class hierarchy (`SAPNavigate.hierarchy`) | `data` or `sql` plus `read` | `SAP_ALLOW_DATA_PREVIEW=true` or `SAP_ALLOW_FREE_SQL=true` | Reads `SEOMETAREL` via table preview or SQL |
| Lint / local format / diagnostics | `read` | Nothing | Unit tests can execute code but do not mutate repository objects |
| Update SAP PrettyPrinter settings | `write` | `SAP_ALLOW_WRITES=true` | `SAPLint.set_formatter_settings` mutates global formatter settings |
| Read transport info | `read` | Nothing | `SAPTransport.list`, `get`, `check`, `history` |
| Read Git info | `read` | Nothing | `SAPGit.list_repos`, `history`, `objects`, etc. when Git feature exists |
| Preview named table contents | `data` | `SAP_ALLOW_DATA_PREVIEW=true` | `sql` implies `data` |
| Run freestyle SQL | `sql` | `SAP_ALLOW_FREE_SQL=true` | High risk on productive systems |
| Create / update / delete objects | `write` | `SAP_ALLOW_WRITES=true` | `SAP_ALLOWED_PACKAGES` applies; supports exact (`ZFOO`), prefix (`Z*`), and DEVCLASS subtree (`ZFOO/**`) patterns. Subtree resolution is fail-closed on SAP errors. |
| Activate objects | `write` | `SAP_ALLOW_WRITES=true` | Activation is a mutation |
| Package / FLP mutations | `write` | `SAP_ALLOW_WRITES=true` | FLP list actions are reads; FLP create/delete actions are writes |
| Create / release / delete transports | `write` + `transports` | `SAP_ALLOW_WRITES=true` + `SAP_ALLOW_TRANSPORT_WRITES=true` | `SAP_ALLOWED_TRANSPORTS` can further restrict CTS IDs |
| Git clone / pull / push / commit | `write` + `git` | `SAP_ALLOW_WRITES=true` + `SAP_ALLOW_GIT_WRITES=true` | Requires backend gCTS/abapGit feature availability |

Why transport and Git rows list `write` plus the specialized scope: ARC-1's safety layer turns off all mutations for users without `write`. The specialized `transports` / `git` scopes decide who may use those write families after general write permission exists.

Transport mutation checklist:

1. User has `write` scope.
2. User has `transports` scope.
3. Server has `SAP_ALLOW_WRITES=true`.
4. Server has `SAP_ALLOW_TRANSPORT_WRITES=true`.
5. `SAP_DENY_ACTIONS` does not deny the concrete action.
6. SAP backend authorization allows the SAP user to create, release, delete, or reassign CTS requests.

Tool schemas are pruned to hide actions that cannot pass ARC-1 gates. Treat schema visibility as a helpful signal, not a separate authorization layer.

---

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

Why not `.env` for BTP? `.env` is mainly the local/dev way to set the same server config. On BTP, use `mta-overrides.mtaext` (preferred — gitignored per-landscape overrides applied at `cf deploy -e ...`; copy from the tracked `mta-overrides.mtaext.example` template), `cf set-env`, `manifest.yml`, or MTA properties instead. Those values are still the **server ceiling** and affect every user of that ARC-1 instance. To change one BTP user's access, change their XSUAA role collection assignment.

Use `arc1 config show` to see the final resolved server policy and where each field came from.

---

## User scopes

Seven scopes exist:

| Scope | Meaning | Implies |
| ----- | ------- | ------- |
| `read` | Read source, search, navigate, lint, diagnose | - |
| `write` | Object/package/activation/FLP mutations | `read` |
| `data` | Named table preview | - |
| `sql` | Freestyle SQL | `data` |
| `transports` | CTS transport mutations | - |
| `git` | abapGit/gCTS mutations | - |
| `admin` | All ARC-1 scopes | all other scopes |

Assigning only `transports` or only `git` is not useful for mutations because transport/Git writes also need `write`. The shipped `developer` profiles and BTP `MCPDeveloper` role include `write`, `transports`, and `git` together.

---

## BTP XSUAA role templates

Start here for BTP deployments. API-key profiles are only for HTTP deployments without XSUAA/OIDC.

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

Want a developer who can write code but cannot transport or use Git? Create a custom role template with just `read` + `write`, then update the XSUAA service. Or leave the shipped role as-is and turn off `SAP_ALLOW_TRANSPORT_WRITES` / `SAP_ALLOW_GIT_WRITES` server-wide.

To grant SQL to one BTP user, assign a role collection that includes `MCPSqlUser` (for example `ARC-1 Viewer + SQL` for read-only SQL or `ARC-1 Developer + SQL` for full developer access) to that user. Do **not** change server env vars for one user. The ARC-1 instance must already have `SAP_ALLOW_FREE_SQL=true`; there is no `SAP_ALLOW_SQL` flag.

See [XSUAA Setup](xsuaa-setup.md) for BTP Cockpit assignment steps.

---

## API-key profiles (non-BTP)

Use API-key profiles when you run HTTP mode without XSUAA/OIDC:

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

Key implications:

- A `developer` key can write only to `$TMP`, even if the server allows `Z*`.
- Because API-key profiles are fixed, there is no `developer-z` profile and no `key:developer:Z*` syntax.
- To give an API key transportable-package write access, use a tightly scoped `admin` key on a server whose `SAP_ALLOWED_PACKAGES` is restricted, or use OIDC/XSUAA for real per-user roles.
- A profile cannot override the server. If `SAP_ALLOW_WRITES=false`, every API key is effectively read-only.

Example: shared sandbox with one viewer and one `$TMP` developer key:

```bash
SAP_TRANSPORT=http-streamable
SAP_ALLOW_WRITES=true
SAP_ALLOW_TRANSPORT_WRITES=true
SAP_ALLOW_GIT_WRITES=false
SAP_ALLOWED_PACKAGES='$TMP,Z*'
ARC1_API_KEYS='viewer-key:viewer,dev-key:developer'
```

In that example, `dev-key:developer` can write `$TMP` only. The server also allows `Z*`, but the profile narrows the key to `$TMP`.

---

## Advanced deny actions

`SAP_DENY_ACTIONS` is the fine-grained deny list. It applies after scope and flag checks, and it always wins.

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

---

## Recipes

### 1. Read and search only

Set nothing. This is the default.

### 2. Read-only with table preview and SQL

```bash
SAP_ALLOW_DATA_PREVIEW=true
SAP_ALLOW_FREE_SQL=true
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
SAP_ALLOW_WRITES=true
SAP_ALLOW_TRANSPORT_WRITES=true
SAP_ALLOWED_PACKAGES='Z*,$TMP'
```

Then assign role collections in BTP Cockpit. The server says what the instance can do; XSUAA says which user can do it.

---

## Common misconfigurations

| Symptom | Why | Fix |
| ------- | --- | --- |
| User has `write`, but writes fail with `allowWrites=false` | Server ceiling is still closed | Set `SAP_ALLOW_WRITES=true` |
| User has `transports`, but transport create fails | Mutations also need `write`, and server needs both write flags | Grant `write` + `transports`; set `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_TRANSPORT_WRITES=true` |
| `SAP_ALLOW_TRANSPORT_WRITES=true`, but transport create fails | `SAP_ALLOW_WRITES=false` still blocks all mutations | Set both flags |
| `developer` API key cannot write to `Z*` | Developer API-key profiles are capped to `$TMP` | Use `$TMP`, use a restricted `admin` key, or use XSUAA/OIDC |
| You want one API key to write `Z*`, but not be full admin | API-key profiles are fixed; per-key custom package caps are not supported | Use an `admin` key on a narrowly configured server, or use XSUAA/OIDC |
| SQL still blocked after `SAP_ALLOW_FREE_SQL=true` | User lacks `sql` scope | Grant `sql` or use `viewer-sql` / `developer-sql` |
| Table preview blocked after `SAP_ALLOW_DATA_PREVIEW=true` | User lacks `data` scope | Grant `data`; `sql` also implies `data` |
| Package allowlist seems ignored for reads | ARC-1 package allowlist is write-only | Enforce read restrictions in SAP roles |
| Action is hidden from tool list | User scope, server flag, backend feature, or `SAP_DENY_ACTIONS` pruned it | Run `arc1 config show` and check startup feature logs |

---

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
| `Operations on package ... are blocked` | Server/profile safety | Adjust `SAP_ALLOWED_PACKAGES` or API-key profile choice |
| `denied by server policy (SAP_DENY_ACTIONS)` | Deny list | Remove or narrow the deny pattern |
| `No authorization for object ...` / SAP 403 | SAP authorization | Fix SAP user roles / PFCG / package auth |
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

### "I changed the user's role but the new scopes don't appear"

XSUAA caches the user's authorities in their browser session. When you change role-collection assignments in BTP Cockpit, **existing JWTs keep the old scopes until they expire** (typically 1 hour) AND the user's SSO session at XSUAA / IAS still references the old authorities.

To force fresh scopes immediately:

1. **Log out of XSUAA** in the same browser the MCP client uses:
   `https://<your-xsuaa-tenant>.authentication.<region>.hana.ondemand.com/logout.do`
2. **Log out of the IAS / business-users IdP** if you use one:
   `https://<your-ias-tenant>.accounts.ondemand.com/logout`
3. In your MCP client (Claude.ai, Cursor, MCP Inspector): **disconnect** the connector and **re-add** it - this triggers a fresh DCR + OAuth flow.
4. Optional: complete the OAuth login in a fresh browser / private window to guarantee no SSO session is reused.

After that, the new JWT will be issued from a fresh session and carry only the user's currently assigned scopes. You can verify by reading the JWT at [jwt.ms](https://jwt.ms) - the `scope` claim should match the role collection's scopes.

### "I have two `marian@example.com` users in BTP and only one shows the role I changed"

BTP can hold multiple identities for the same email - one per IdP origin (`sap.default`, the IAS tenant, custom IdPs). Role assignments are per-identity. The MCP client logs in via one specific IdP, so check that you're updating the role for the **same identity** that the OAuth flow uses.

In BTP Cockpit → Users you can see all identities for a given email and their `Identity-Provider` column. Update the role on the identity whose IdP matches the OAuth login.

---

## References

- [Configuration Reference](configuration-reference.md) - every flag and env var
- [API Key Setup](api-key-setup.md) - non-BTP role-based API keys
- [XSUAA Setup](xsuaa-setup.md) - BTP role collections and OAuth
- [OAuth / JWT Setup](oauth-jwt-setup.md) - external IdP scopes
- [Principal Propagation Setup](principal-propagation-setup.md) - per-user SAP identity
- [Security Guide](security-guide.md) - production hardening
- [Updating](updating.md) - migration from v0.6
