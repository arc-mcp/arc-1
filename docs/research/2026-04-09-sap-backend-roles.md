# SAP Backend Roles for On-Premise ARC-1

**Date:** 2026-04-09
**Author:** marianfoo
**Status:** Research Complete

---

## 1. The Idea

When ARC-1 is deployed on-premise (not BTP), allow SAP admins to manage MCP access scopes via SAP's native role management (PFCG/SU01) instead of requiring an external IdP (OIDC) or API key profiles. ARC-1 queries the SAP system at login time to determine what a user is allowed to do.

```
MCP Client → ARC-1 HTTP endpoint (user identified via OIDC/API key)
  │
  ├─ Map HTTP user identity → SAP username
  │
  ├─ Query SAP backend: "What ARC-1 scopes does this SAP user have?"
  │
  ├─ Build AuthInfo { scopes: ['read', 'write'] } from SAP response
  │
  └─ Proceed with normal scope enforcement (TOOL_SCOPES, deriveUserSafety)
```

### Why This Matters

| Benefit | Detail |
|---------|--------|
| Single source of truth | SAP admins manage ARC-1 access in PFCG alongside other SAP roles — no separate IdP or API key spreadsheet |
| Familiar tooling | SU01, PFCG, SU53 — tools every Basis admin already knows |
| Transport-governed | Role changes go through CTS transports — audit trail, 4-eyes, landscape promotion |
| Consistent with BTP model | Same 5 scopes (read/write/data/sql/admin), same role hierarchy — just stored in SAP instead of XSUAA |
| No external IdP required | On-prem customers without Entra ID/Keycloak/Auth0 can still get per-user scoping |

---

## 2. Available SAP HTTP Endpoints for Auth Queries

Research identified these endpoints that could serve role/auth data:

| Endpoint | What It Does | Already in ARC-1? | Custom ABAP Needed? |
|----------|-------------|-------------------|---------------------|
| `/sap/bc/adt/datapreview/freestyle` | ABAP SQL SELECT on any table | Yes (`runQuery()`) | No |
| `/sap/bc/adt/datapreview/ddic` | Named table preview with filter | Yes (`getTableContents()`) | No |
| `/sap/bc/soap/rfc` | Generic SOAP gateway — call ANY RFC-enabled FM | No | No (but SICF activation) |
| Custom ICF handler | Purpose-built REST endpoint | No | Yes (~80 lines ABAP) |
| `/sap/bc/adt/oo/classrun/{class}` | Execute ABAP class (IF_OO_ADT_CLASSRUN) | No | Yes (~40 lines ABAP) |

**Key finding:** `/sap/bc/adt/datapreview/freestyle` (already in ARC-1) can query `AGR_USERS` directly — no new SAP-side code needed.

---

## 3. All Viable Approaches — Deep Analysis

### Approach 1: ADT SQL Query on AGR_USERS — "Roles as Tags" (RECOMMENDED)

**Concept:** Create empty SAP roles in PFCG that serve as "MCP scope tags." ARC-1 queries `AGR_USERS` at login time to see which tags a user has.

**SAP side (15 min setup, zero ABAP code):**

```
PFCG → Create roles (empty, no auth values):
  ZARC1_READ    → maps to scope: read
  ZARC1_WRITE   → maps to scope: write
  ZARC1_DATA    → maps to scope: data
  ZARC1_SQL     → maps to scope: sql
  ZARC1_ADMIN   → maps to scope: admin

SU01 → Assign to users:
  JSMITH  → ZARC1_READ, ZARC1_WRITE
  MJONES  → ZARC1_READ, ZARC1_DATA
```

**ARC-1 side — the SQL query:**

```sql
SELECT AGR_NAME FROM AGR_USERS
WHERE UNAME = 'JSMITH'
  AND AGR_NAME LIKE 'ZARC1_%'
  AND FROM_DAT <= '20260409'
  AND TO_DAT   >= '20260409'
```

Returns: `ZARC1_READ`, `ZARC1_WRITE` → scopes: `['read', 'write']`

**Implementation sketch:**

```typescript
const SAP_USERNAME_RE = /^[A-Z0-9_]{1,12}$/;

function validateSapUsername(raw: string): string {
  const upper = raw.toUpperCase();
  if (!SAP_USERNAME_RE.test(upper)) {
    throw new Error(`Invalid SAP username format: ${raw}`);
  }
  return upper;
}

// New internal method — uses unrestricted safety to bypass blockData/blockFreeSQL
async resolveUserScopes(rawUsername: string, rolePrefix = 'ZARC1_', viewName = 'AGR_USERS'): Promise<string[]> {
  const sapUser = validateSapUsername(rawUsername);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Use ddic endpoint (fixed table/view) — safer than freestyle SQL
  const internalClient = this.client.withSafety(unrestrictedSafetyConfig());
  const result = await internalClient.getTableContents(
    viewName,  // AGR_USERS or custom CDS view (from --sap-role-view)
    10,
    `UNAME = '${sapUser}' AND AGR_NAME LIKE '${rolePrefix}%' AND FROM_DAT <= '${today}' AND TO_DAT >= '${today}'`
  );
  // sapUser validated to [A-Z0-9_] only — injection impossible
  // rolePrefix from server config, not user input

  return result.rows
    .map(r => r.AGR_NAME?.replace(rolePrefix, '').toLowerCase())
    .filter(s => ['read', 'write', 'data', 'sql', 'admin'].includes(s));
}
```

**Key technical details:**
- `withSafety()` (src/adt/client.ts:80-86) creates a lightweight client clone sharing the same HTTP connection but with a different safety config. The internal auth query uses `unrestrictedSafetyConfig()` while user operations use the normal restricted config.
- `getTableContents()` uses the ddic endpoint which constrains to a single table — structurally safer than `runQuery()` which accepts arbitrary SQL.
- Username validation (`[A-Z0-9_]{1,12}`) eliminates SQL injection — SAP usernames can only contain these characters.
- See **Section 7** for full security analysis including SAP-side technical user lockdown.

| Pro | Con |
|-----|-----|
| Zero ABAP code — nothing to deploy on SAP | Technical user needs `S_SQL_VIEW` on `AGR_USERS` |
| Standard PFCG/SU01 workflow | Role names are a convention (prefix `ZARC1_`) |
| Transport-governed (roles go through CTS) | Still need user-identity mapping (HTTP user → SAP user) |
| Time-validity built in (`FROM_DAT`/`TO_DAT`) | No SU53 trace (no real auth check happening) |
| Works on any SAP 7.50+ system | `AGR_USERS` is sensitive — contains ALL role assignments |
| Composite roles work automatically (`AGR_USERS` resolves them) | |
| Uses existing ARC-1 infrastructure (`runQuery()`) | |

**Effort:** ~2-3 days ARC-1 side, 15 min SAP side.

---

### Approach 2: SOAP RFC → BAPI_USER_GET_DETAIL

**Concept:** Call the standard BAPI via SAP's built-in SOAP gateway to get a user's role assignments. No custom ABAP code needed.

**SAP side:** Activate `/sap/bc/soap/rfc` in SICF (one-time).

**ARC-1 side — the SOAP call:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:urn="urn:sap-com:document:sap:rfc:functions">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:BAPI_USER_GET_DETAIL>
      <USERNAME>JSMITH</USERNAME>
    </urn:BAPI_USER_GET_DETAIL>
  </soapenv:Body>
</soapenv:Envelope>
```

**Response includes `ACTIVITYGROUPS` table:** all roles assigned to the user (role name, from/to dates, org levels).

| Pro | Con |
|-----|-----|
| Standard SAP BAPI — well-documented, stable API | `/sap/bc/soap/rfc` is a security risk (SAP Note 1394100) |
| Returns complete role info including validity dates | Needs SICF activation — may be blocked by security policy |
| Returns much more than just roles (profiles, params) | Requires `S_RFC` authorization on the BAPI |
| The "proper" way to query user info in SAP | New HTTP endpoint to manage (separate from ADT) |
| Works with composite roles, derived roles | SOAP XML parsing needed in ARC-1 |
| No custom ABAP development | Some orgs have this endpoint explicitly deactivated |

**Security concern (SAP Note 1394100):** Once `/sap/bc/soap/rfc` is active, **any RFC-enabled FM** can be called by any authenticated user with `S_RFC` authorization. This is a significant attack surface. Mitigation: restrict via `S_RFC` auth object or UCON allowlists.

**Effort:** ~3-4 days ARC-1 side, SICF activation on SAP side.

---

### Approach 3: SOAP RFC → Custom Auth Check FM

**Concept:** Create a simple RFC-enabled FM `Z_ARC1_CHECK_AUTH` that uses `SUSR_USER_AUTH_FOR_OBJ_GET` to check a custom auth object. Call it via SOAP.

**SAP side — the FM (~30 lines ABAP):**

```abap
FUNCTION Z_ARC1_CHECK_AUTH.
  IMPORTING VALUE(IV_USERNAME) TYPE SY-UNAME
  EXPORTING VALUE(ET_SCOPES)   TYPE STRING_TABLE.

  DATA lt_auth_values TYPE TABLE OF usvalues.

  CALL FUNCTION 'SUSR_USER_AUTH_FOR_OBJ_GET'
    EXPORTING
      user_name  = iv_username
      sel_object = 'ZARC1_SCOPE'
    TABLES
      values_tab = lt_auth_values.

  LOOP AT lt_auth_values INTO DATA(ls_val) WHERE fieldname = 'ARC1_SCOPE'.
    TRANSLATE ls_val-fieldvalue TO LOWER CASE.
    APPEND ls_val-fieldvalue TO et_scopes.
  ENDLOOP.
ENDFUNCTION.
```

**Important:** `AUTHORITY-CHECK ... FOR USER <username>` does NOT exist in standard ABAP. You must use `SUSR_USER_AUTH_FOR_OBJ_GET` to check another user's authorizations, which requires `S_USER_AGR` + `S_USER_AUTH` on the technical user.

| Pro | Con |
|-----|-----|
| Uses real SAP authorization framework | Requires custom auth object + FM + SOAP activation |
| SU53 works for troubleshooting | More ABAP to maintain |
| PFCG auth maintenance (familiar UI) | `SUSR_USER_AUTH_FOR_OBJ_GET` requires privileged access |
| Profile generator resolves composite/derived roles | ~50 lines ABAP, transport, SICF config |
| Most secure — proper auth checks | |

**Effort:** ~5-7 days total (2 days SAP, 3-5 days ARC-1).

---

### Approach 4: Custom ICF Handler (Clean REST API)

**Concept:** ABAP HTTP handler at `/sap/bc/zarc1/auth` that returns user scopes as JSON.

**SAP side (~80 lines ABAP):**

```abap
CLASS zcl_arc1_auth_handler DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
ENDCLASS.

CLASS zcl_arc1_auth_handler IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    DATA(lv_user) = server->request->get_header_field( 'x-arc1-user' ).
    IF lv_user IS INITIAL.
      lv_user = sy-uname.
    ENDIF.

    SELECT agr_name FROM agr_users
      INTO TABLE @DATA(lt_roles)
      WHERE uname = @lv_user
        AND agr_name LIKE 'ZARC1_%'
        AND from_dat <= @sy-datum
        AND to_dat   >= @sy-datum.

    " Build JSON response
    DATA(lv_json) = `{"scopes":[`.
    DATA lv_sep TYPE string.
    LOOP AT lt_roles INTO DATA(ls_role).
      DATA(lv_scope) = to_lower( replace( val = ls_role-agr_name sub = 'ZARC1_' with = '' ) ).
      lv_json = lv_json && lv_sep && `"` && lv_scope && `"`.
      lv_sep = `,`.
    ENDLOOP.
    lv_json = lv_json && `]}`.

    server->response->set_cdata( lv_json ).
    server->response->set_header_field( name = 'content-type' value = 'application/json' ).
  ENDMETHOD.
ENDCLASS.
```

| Pro | Con |
|-----|-----|
| Clean REST endpoint, easy to call from ARC-1 | Most ABAP code to write/maintain |
| Returns exactly what ARC-1 needs (JSON) | Needs SICF node configuration |
| Can do real AUTHORITY-CHECK if needed | Custom class + transport required |
| No dependency on SOAP RFC or table auth | Must be deployed on every SAP system |

**Effort:** ~5-7 days total.

---

### Approach 5: Z-Table with SM30 (Simplest but Least SAP-Native)

**Concept:** Custom table `ZARC1_USER_SCOPES` maintained via SM30.

```
ZARC1_USER_SCOPES:
| MANDT | UNAME     | SCOPE |
|-------|-----------|-------|
| 100   | JSMITH    | READ  |
| 100   | JSMITH    | WRITE |
| 100   | MJONES    | READ  |
| 100   | MJONES    | DATA  |
```

Query via `getTableContents('ZARC1_USER_SCOPES', 10, "UNAME = 'JSMITH'")`.

| Pro | Con |
|-----|-----|
| Simplest possible implementation | Not using SAP auth framework at all |
| No ABAP logic needed | SM30 is clunky for role management |
| Easy to understand | No time-validity, no composite roles |
| Fast to query | Doesn't feel "SAP-native" |

**Effort:** ~1-2 days total.

---

## 4. Comparison Matrix

| | AGR_USERS Query | SOAP BAPI | SOAP Custom FM | ICF Handler | Z-Table |
|-|-----------------|-----------|----------------|-------------|---------|
| **SAP-side code** | None | None | ~50 lines | ~80 lines | Table + maint. view |
| **SAP-side config** | S_TABU_NAM grant | SICF activation | SICF + auth object | SICF node | Table creation |
| **SAP auth framework** | Indirect (role names) | Indirect (role names) | Direct (AUTHORITY-CHECK) | Optional | None |
| **SU53 trace** | No | No | Yes | Optional | No |
| **PFCG workflow** | Yes (empty roles) | Yes | Yes (with auth values) | Depends | No (SM30) |
| **Transport-governed** | Yes | Yes | Yes | Yes | Yes |
| **ARC-1 effort** | 2-3 days | 3-4 days | 4-5 days | 4-5 days | 1-2 days |
| **Security risk** | AGR_USERS readable | SAP Note 1394100 | SAP Note 1394100 | Minimal | Minimal |
| **Works without extras** | Yes (ADT only) | Needs SOAP active | Needs SOAP + FM | Needs ICF node | Needs Z-table |
| **Composite/derived roles** | Auto-resolved | Auto-resolved | Auto-resolved | Manual | Manual |

---

## 5. The User Identity Mapping Problem

All approaches share a common prerequisite: mapping the HTTP-authenticated user to a SAP username.

| HTTP Auth Method | Identity Available | SAP User Mapping |
|-----------------|-------------------|------------------|
| OIDC JWT | `sub`, `preferred_username`, `email` claims | Need convention or mapping |
| API key with profile | Key name only | Need explicit mapping |
| XSUAA JWT | `user_name` claim (from IAS) | Usually matches SAP user |

**Proposed solutions (configurable):**

1. **Convention** (default): OIDC `preferred_username` claim = SAP `SY-UNAME`
2. **Claim mapping**: `--sap-user-claim=email` — extract SAP username from any JWT claim
3. **Header mapping**: `X-SAP-User` header — for reverse proxy setups that inject SAP username
4. **Static mapping**: `--sap-user-map=oidc_sub1:SAPUSER1,oidc_sub2:SAPUSER2`

**Config flags needed:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--sap-role-check` | `false` | Enable SAP-side role resolution |
| `--sap-role-prefix` | `ZARC1_` | Role name prefix to filter |
| `--sap-user-claim` | `preferred_username` | JWT claim containing SAP username |
| `--sap-role-cache-ttl` | `300` (5 min) | Cache duration for resolved roles |

---

## 6. Architecture in ARC-1

### New Auth Provider: `SapRoleAuthProvider`

```
HTTP Request with OIDC JWT
  │
  ▼
validateOidcToken() → { sub, preferred_username, ... }
  │
  ├─ scopes from JWT claims (existing behavior)
  │
  ├─ IF --sap-role-check enabled:
  │   │
  │   ├─ Extract SAP username from JWT (configurable claim)
  │   │
  │   ├─ Check cache: sapRoleCache.get(sapUsername)
  │   │   ├─ HIT: use cached scopes
  │   │   └─ MISS: query AGR_USERS via internal getTableContents() (ddic endpoint)
  │   │
  │   ├─ Merge/intersect scopes (SAP roles AND JWT scopes? OR SAP roles ONLY?)
  │   │
  │   └─ Return AuthInfo { scopes: mergedScopes }
  │
  ▼
handleToolCall() → TOOL_SCOPES check → deriveUserSafety() → ADT client call
```

### Scope Merging Strategy

Two options for how SAP-resolved scopes interact with existing auth:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| **SAP-only** | SAP roles are the sole scope source, JWT scopes ignored | SAP is the single source of truth |
| **Intersection** | User gets the overlap of JWT scopes AND SAP roles | Defense-in-depth: both must agree |

Recommend **SAP-only** as default when `--sap-role-check` is enabled, since the whole point is to let SAP manage scopes.

### Caching

- **In-memory cache** keyed by SAP username
- **TTL: 5 minutes** (configurable via `--sap-role-cache-ttl`)
- **Invalidation:** Time-based only (no webhook from SAP on role change)
- **Cold start:** First request per user adds ~50-200ms latency for the SQL query

### Internal Query — Bypassing Safety

The role resolution query must bypass the user-facing safety system (which may block data queries). The existing `withSafety()` pattern supports this:

```typescript
const internalClient = this.adtClient.withSafety(unrestrictedSafetyConfig());
const result = await internalClient.getTableContents('AGR_USERS', 10, `UNAME = '${validatedUser}' ...`);
```

This is safe because:
- Uses `getTableContents()` (ddic endpoint) — constrained to a single table, not arbitrary SQL
- Username is validated to `[A-Z0-9_]{1,12}` — injection impossible
- Table/view name is from server config, not user input
- The safety bypass is scoped to this single infrastructure query
- See **Section 7** for complete security analysis

---

## 7. Security Deep Dive

### 7.1 The SQL Injection Problem

**ADT's freestyle SQL endpoint (`/sap/bc/adt/datapreview/freestyle`) does NOT support parameterized queries.** The SQL is passed as raw text in the POST body. If a username were concatenated into a freestyle SQL query, it would be vulnerable to injection:

```typescript
// DANGEROUS — DO NOT DO THIS
const sql = `SELECT AGR_NAME FROM AGR_USERS WHERE UNAME = '${sapUsername}'`;
await client.runQuery(sql, 10);  // ← sapUsername could contain ' OR 1=1 --
```

**Solution: Use `getTableContents()` (ddic endpoint) instead of `runQuery()`.**

The ddic endpoint (`/sap/bc/adt/datapreview/ddic`) is structurally safer:
- Table name is fixed in the URL (`ddicEntityName=AGR_USERS`) — not user-controllable
- Only the WHERE clause filter is passed as POST body
- Still not parameterized, but the attack surface is narrower (WHERE clause, not arbitrary SQL)

**Plus strict input validation on the username:**

```typescript
// SAP usernames: uppercase alphanumeric + underscore, max 12 chars
const SAP_USERNAME_RE = /^[A-Z0-9_]{1,12}$/;

function validateSapUsername(raw: string): string {
  const upper = raw.toUpperCase();
  if (!SAP_USERNAME_RE.test(upper)) {
    throw new Error(`Invalid SAP username format: ${raw}`);
  }
  return upper;
}
```

**Combined implementation:**

```typescript
async resolveUserScopes(rawUsername: string): Promise<string[]> {
  const sapUser = validateSapUsername(rawUsername);  // Strict validation
  const today = formatDate(new Date());             // YYYYMMDD

  // Use ddic endpoint (fixed table) instead of freestyle SQL
  const internalClient = this.client.withSafety(unrestrictedSafetyConfig());
  const result = await internalClient.getTableContents(
    'AGR_USERS',
    10,
    `UNAME = '${sapUser}' AND AGR_NAME LIKE 'ZARC1_%' AND FROM_DAT <= '${today}' AND TO_DAT >= '${today}'`
  );
  // sapUser is validated to [A-Z0-9_] only — injection impossible

  return result.rows
    .map(r => r.AGR_NAME?.replace('ZARC1_', '').toLowerCase())
    .filter(s => ['read', 'write', 'data', 'sql', 'admin'].includes(s));
}
```

**Why this is safe:**
1. Username is validated to `[A-Z0-9_]{1,12}` — no quotes, no SQL operators, no whitespace
2. Table name is hardcoded (`AGR_USERS`) — not derived from user input
3. Role prefix (`ZARC1_%`) is hardcoded — not user-controllable
4. Date string is generated internally — not user input
5. Even if validation were somehow bypassed, the ddic endpoint constrains to a single table

### 7.2 Securing the Technical User on SAP

The ARC-1 technical user needs to read `AGR_USERS` for role resolution. This is the most sensitive part — `AGR_USERS` contains ALL role assignments for ALL users in the system.

**Three tiers of lockdown, from simplest to most secure:**

#### Tier 1: S_TABU_NAM — Restrict Table Access (Simple, Recommended Default)

SAP authorization object `S_TABU_NAM` controls which tables a user can access via data preview:

```
Authorization Object: S_TABU_NAM
  ACTVT  = 03 (Display)
  TABLE  = AGR_USERS
```

**PFCG setup:**
1. Create role `ZARC1_TECH_AUTH` in PFCG
2. Add auth object `S_TABU_NAM` with `ACTVT=03`, `TABLE=AGR_USERS`
3. Add auth object `S_ADT_RES` with `ACTVT=01,02` (ADT access — needed for POST endpoints)
4. Do NOT grant `S_TABU_NAM` for any other table
5. Assign role to technical user

**Effect:** Technical user can query `AGR_USERS` via data preview but NOT any other table. If ARC-1's `runQuery()` or `getTableContents()` were somehow abused to target a different table, SAP would reject it with an authorization error.

**Limitations:**
- Technical user can still see ALL rows in `AGR_USERS` (all users, all roles)
- No column-level restriction
- The ARC-1 query filters by `ZARC1_%` prefix in the WHERE clause, but the SAP system doesn't enforce this

| Pro | Con |
|-----|-----|
| No custom ABAP needed | Can see all users' role assignments |
| Standard PFCG role | No row/column filtering |
| Minimal configuration | Relies on ARC-1's WHERE clause for scope |
| Any Basis admin can set up | |

#### Tier 2: CDS View — Row & Column Filtering (Enterprise, Most Secure)

Create a CDS view that exposes only the columns and rows ARC-1 needs:

```abap
@AbapCatalog.sqlViewName: 'ZARC1USERROLES'
@AccessControl.authorizationCheck: #NOT_REQUIRED
define view Z_ARC1_USER_ROLES as select from agr_users {
  uname     as SapUser,
  agr_name  as RoleName
}
where agr_name like 'ZARC1_%'
  and from_dat <= $session.system_date
  and to_dat   >= $session.system_date
```

**SAP-side authorization:**

```
Authorization Object: S_SQL_VIEW
  ACTVT    = 03 (Display)
  DDLNAME  = Z_ARC1_USER_ROLES

Do NOT grant S_TABU_NAM for AGR_USERS.
```

**ARC-1 query changes:**

```typescript
// Query the CDS view instead of the base table
const result = await internalClient.getTableContents(
  'Z_ARC1_USER_ROLES',  // CDS view, not AGR_USERS
  10,
  `SapUser = '${sapUser}'`
);
```

**Effect:**
- Technical user can ONLY access the CDS view, not the base table
- CDS view filters rows to `ZARC1_%` roles only — even if ARC-1 code is compromised, it can't read other roles
- CDS view exposes only `UNAME` and `AGR_NAME` — no other AGR_USERS columns visible
- Time-validity filtering happens in the view (SAP-enforced, not ARC-1-enforced)

| Pro | Con |
|-----|-----|
| Row-level security (only ZARC1_* roles) | Requires CDS view creation (~10 lines ABAP) |
| Column-level security (only user + role) | Must be transported to each SAP system |
| SAP-enforced filtering, not just ARC-1 | Slightly more SAP setup |
| Time-validity enforced by SAP | |
| No access to base AGR_USERS table | |
| Configurable view name in ARC-1 | |

#### Tier 3: CDS View + DCL Access Control (Maximum Security)

Add a Data Control Language (DCL) access control to the CDS view:

```abap
@MappingRole: true
define role Z_ARC1_USER_ROLES_AUTH {
  grant select on Z_ARC1_USER_ROLES
    where SapUser = aspect pfcg_auth(S_USR_GRP, CLASS, ACTVT='03');
}
```

This adds SAP-native row-level authorization — the technical user can only see roles for users they're authorized to manage via `S_USR_GRP`. This is the maximum-security option but adds significant complexity and is likely overkill for most deployments.

### 7.3 Security Summary & Recommendation

| Attack Vector | Mitigation | Enforced By |
|---------------|-----------|-------------|
| SQL injection via username | Strict regex validation `[A-Z0-9_]{1,12}` | ARC-1 code |
| Arbitrary table access | S_TABU_NAM restricts to AGR_USERS only | SAP auth framework |
| Reading non-ARC-1 roles | CDS view with `WHERE agr_name LIKE 'ZARC1_%'` | SAP (Tier 2) or ARC-1 WHERE clause (Tier 1) |
| Column data leakage | CDS view exposes only uname + agr_name | SAP (Tier 2) |
| Compromised ARC-1 enumerating users | CDS view + DCL row-level auth | SAP (Tier 3) |
| Cache poisoning | Cache keyed by validated username, TTL-based expiry | ARC-1 code |
| Replay/stale scopes | Short TTL (5 min), no persistent cache | ARC-1 code |

**Recommended default:** Tier 1 (S_TABU_NAM) for quick setup, with documentation for Tier 2 (CDS view) as the enterprise option.

**New config flag for Tier 2:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--sap-role-view` | `AGR_USERS` | Table or CDS view to query for roles |

This lets customers point ARC-1 at their CDS view (`--sap-role-view=Z_ARC1_USER_ROLES`) without any ARC-1 code changes.

### 7.4 Remaining Security Considerations

**Technical user privilege escalation:**
If the technical user credentials are compromised, an attacker could enumerate all users' ARC-1 permissions (Tier 1) or at minimum see which users have ARC-1 roles (Tier 2). This is inherent to any server-side role resolution — the same risk exists with OIDC introspection endpoints. Mitigation: standard credential rotation, network segmentation, audit logging.

**Internal query bypasses safety system:**
The role resolution uses `unrestrictedSafetyConfig()` to bypass the user-facing safety system. This is necessary (the safety system blocks data queries by default) but must be carefully scoped:
- Only `getTableContents()` is called internally — not `runQuery()`
- The table/view name is hardcoded or from server config (not user input)
- The WHERE clause contains only the validated username and hardcoded filters
- This bypass is an infrastructure operation, not a user operation — similar to how the HTTP layer reads CSRF tokens without auth checks

**Audit trail:**
Role resolution events should be logged to the audit sink:
```
[AUDIT] SAP role resolution: sapUser=JSMITH, resolvedScopes=[read,write], source=AGR_USERS, cached=false
```

---

## 8. Risks & Mitigations (Updated)

| Risk | Severity | Mitigation |
|------|----------|------------|
| SQL injection via username | **Eliminated** | Strict `[A-Z0-9_]{1,12}` validation + ddic endpoint (not freestyle) |
| AGR_USERS exposes all role assignments | Medium → Low | Tier 1: S_TABU_NAM restricts to table; Tier 2: CDS view filters rows+columns |
| Technical user credential compromise | Medium | Standard credential rotation; Tier 2 limits data exposure |
| Cache staleness after role revocation | Low | 5-min TTL; admin can restart ARC-1 to force clear |
| User identity mapping mismatch | Medium | Configurable claim; validation logging; clear error messages |
| Internal safety bypass abuse | Low | Hardcoded table/view name; validated input only; no user-controllable SQL |

---

## 9. Recommendation

### Primary: Approach 1 (AGR_USERS via ADT `getTableContents()`)

**Why:**
- Zero SAP-side code deployment — preserves ARC-1's "zero SAP footprint" value proposition
- Uses ARC-1's existing `getTableContents()` infrastructure (ddic endpoint, safer than freestyle SQL)
- Standard PFCG workflow for role management
- Works on any SAP system that already runs ARC-1
- Composite and derived roles resolve automatically in AGR_USERS
- Lowest implementation effort (~3-4 days including security hardening)
- SQL injection eliminated via strict username validation + constrained endpoint

**Security posture:**
- **Quick setup (Tier 1):** S_TABU_NAM on technical user → restricts to AGR_USERS table only
- **Enterprise (Tier 2):** CDS view with row/column filtering → technical user never sees base table

### Optional Future Enhancement: Approach 2 (SOAP BAPI)

For customers who already have `/sap/bc/soap/rfc` active, offer as alternative auth source:
- `--sap-role-source=table` (default) — ADT table query
- `--sap-role-source=bapi` — SOAP call to BAPI_USER_GET_DETAIL

### Not Recommended: Approaches 3-5

- Custom FM (Approach 3) and ICF handler (Approach 4) require ABAP deployment — contradicts "zero footprint"
- Z-table (Approach 5) doesn't use SAP auth framework at all — no better than API key profiles

---

## 10. Implementation Plan Sketch

If we proceed with Approach 1:

| Task | Files | Effort |
|------|-------|--------|
| 1. Add SAP role config flags | `src/server/config.ts`, `src/server/types.ts`, `src/cli.ts` | 0.5 day |
| 2. Implement SapRoleProvider with security hardening | New: `src/server/sap-roles.ts` (username validation, ddic query, caching) | 1 day |
| 3. Integrate into HTTP auth chain | `src/server/http.ts` | 0.5 day |
| 4. Unit tests (incl. injection attempts) | `tests/unit/server/sap-roles.test.ts` | 1 day |
| 5. Integration tests | `tests/integration/` | 0.5 day |
| 6. Documentation (setup guide: Tier 1 + Tier 2, CDS view code) | `docs/authorization.md`, `docs/cli-guide.md`, `CLAUDE.md` | 0.5 day |

**Total: ~4 days**

---

## 11. Open Questions

1. **Scope merging vs. replacement:** When `--sap-role-check` is enabled alongside OIDC, should SAP roles replace JWT scopes entirely, or intersect with them?
2. **Role prefix configurability:** Is `ZARC1_` the right default? Should customers be able to use their own naming convention?
3. **Fallback behavior:** If the SAP query fails (e.g., user doesn't exist in SAP), should ARC-1 deny access or fall back to JWT scopes?
4. **Audit logging:** Should role resolution events be logged to the audit sink? (Recommended: yes)
5. **BTP ABAP:** Should this also work with BTP ABAP Environment, or is XSUAA sufficient there?
6. **CDS view shipping:** Should ARC-1 ship a sample CDS view as a downloadable transport or abapGit repo for easy Tier 2 setup?
