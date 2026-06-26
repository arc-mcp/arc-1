# DassianInc/dassian-adt — Deep Analysis Update

> **Repository**: https://github.com/DassianInc/dassian-adt
> **MCPB successor**: https://github.com/albanleong/abap-mcpb
> **Language**: TypeScript (compiled to JS) | **License**: MIT
> **Stars**: 33 (up from 32 on 2026-04-14) | **Forks**: 7
> **Status**: Active — no new commits since 2026-04-14 (latest: MCP OAuth 2.0 per-user)
> **Last deep analysis**: 2026-04-16

---

## New Commits Since 2026-04-14

**None.** The last commits were on 2026-04-14:
- `6f9d20b` — feat: MCP OAuth 2.0 per-user SAP authentication (already evaluated in 07-dassian-adt.md)
- `a8b7c20` — feat: read PORT env var for Azure App Service compatibility

No new features or fixes since the previous analysis. The explosive April sprint (0 → 53 tools in 2 weeks) appears to have concluded.

---

## Issues

**0 open issues, 0 closed issues.** The DassianInc/dassian-adt GitHub repository has no issues filed as of 2026-04-16. No public bug tracker activity.

---

## Deep Implementation Analysis

### 1. `abap_run` — Internal Mechanics (IF_OO_ADT_CLASSRUN)

The handler in `src/handlers/RunHandlers.ts` works as follows:

**Class creation workflow:**
```
1. Read /sap/bc/adt/oo/interfaces/if_oo_adt_classrun/source/main
   → Check if "main" appears in source → determines ~run (≤2023) vs ~main (2024+)
   → Allows explicit interfaceMethod override parameter

2. createObject('CLAS/OC', 'ZCL_TMP_ADT_RUN', '$TMP', ...)

3. Lock /sap/bc/adt/oo/classes/{className}
   → Write source via setObjectSource(sourceUrl, source, lockHandle)
   → Unlock

4. activate(className, classUrl)
   → Log out (some systems commit activation only when session closes)

5. POST /sap/bc/adt/oo/classrun/{className}
   Accept: text/plain
   → Re-login stateless to get fresh CSRF token
   → Capture response body as output

6. finally: lock → deleteObject(classUrl, lockHandle) [best-effort]
```

**Generated class template:**
```abap
CLASS zcl_tmp_adt_run DEFINITION PUBLIC FINAL
  CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_tmp_adt_run IMPLEMENTATION.
  METHOD if_oo_adt_classrun~{run|main}.
    " user code here
  ENDMETHOD.
ENDCLASS.
```

**Error handling:**
- HTTP 500: suggests missing IF_OO_ADT_CLASSRUN or runtime dump in ST22
- HTTP 200 with error body: catches e.g. "Error: Class does not implement ~main"
- Stale classes (from prior failed run): prompts user to delete + retry with different className

**ARC-1 implication:** Endpoint is `POST /sap/bc/adt/oo/classrun/{name}` with `Accept: text/plain`. Needs `OperationType.Execute` safety gate + confirmation elicitation.

---

### 2. Multi-System Support (SAP UI Landscape XML)

From `src/index.ts` analysis:

**Data structure:** `Map<string, SystemEntry>` where each entry contains:
- `AuthConfig` (url, user, password, client, language, authType)
- An `ADTClient` instance
- Instantiated handler objects (SourceHandlers, ObjectHandlers, etc.)

**Configuration sources:**
- `SAP_SYSTEMS_FILE` — path to JSON file with array of auth configs
- `SAP_SYSTEMS` — inline JSON string
- `SAP_SYSTEMS_TEMPLATE` — systems without credentials (for OAuth login page)
- Fallback: individual `SAP_URL`/`SAP_USER`/`SAP_PASSWORD` env vars

**LLM integration:** When multiple systems configured, a required `sap_system_id` parameter is injected into every tool's JSON schema — the LLM routes each call to the correct system.

**SAP UI Landscape XML:** The commit message `a5bcbfc` on 2026-04-12 references "SAP UI Landscape XML auto-discovery" — the server reads `SAPUILandscapeGlobal.xml` to auto-populate system entries. This is the configuration file format used by SAP Logon Pad.

**ARC-1 implication:** ARC-1 uses one-instance-per-system model (env vars per instance). Dassian's approach requires a separate ADTClient per system and full handler set duplication. For BTP-native ARC-1, Destination Service is the equivalent (one destination = one system). Multi-system via env vars is valid for on-premise.

---

### 3. MCP OAuth 2.0 Per-User (commit `6f9d20b`, 2026-04-14)

From `src/index.ts`:

**Three auth modes:**
1. **Service mode** — shared `SAP_SYSTEMS` credentials for all MCP sessions
2. **OAuth mode** — requires user login; no fallback to service account
3. **Hybrid mode** — authenticated users get personal credentials; unauthenticated fall back to service account

**OAuth endpoints implemented:**
- `GET /oauth/authorize` — HTML login form showing all configured systems
- `POST /oauth/authorize` — validates SAP credentials, generates 10-minute authorization code
- `POST /oauth/token` — PKCE code exchange → access token stored in `issuedTokens` map
- `GET /.well-known/oauth-authorization-server` — OAuth metadata endpoint
- `GET /.well-known/oauth-protected-resource` — protected resource metadata

**PKCE support:** Standard `code_verifier`/`code_challenge` PKCE flow.

**Token storage:** In-memory `issuedTokens` Map (no persistence across restarts).

**Per-user SAP session:** Each issued token is associated with the user's SAP credentials. When a tool call comes in with a Bearer token, the server looks up the corresponding SAP credentials and uses a per-user ADTClient.

**Key difference from ARC-1:** Dassian's OAuth is a self-hosted authorization server that issues its own tokens, mapping them to SAP credentials. ARC-1 uses BTP Destination Service (external), XSUAA OAuth (BTP-issued tokens), or OIDC (external JWT validation). Dassian's approach is simpler for on-premise deployment but lacks enterprise features (token refresh, revocation, audit).

---

### 4. Enhancement/BAdI Read Tools

**Not present.** Confirmed across all handler files:
- `DdicHandlers.ts`: only `ddic_element` and `ddic_references`
- `ObjectHandlers.ts`: BDEF (behavior definitions) support, but no ENHO/ENHS
- No `abap_get_enhancement` or `abap_get_badi` tools
- Feature matrix entry remains: ❌ for dassian-adt

---

### 5. `raw_http` — Exact Behavior

From `src/handlers/SystemHandlers.ts`:

**What it does:** Executes arbitrary HTTP requests against the connected SAP ADT system.

**Parameters:**
- `method`: GET, POST, PUT, DELETE, PATCH
- `path`: Must start with `/sap/bc/adt/...`
- `body`: Optional request payload
- `headers`: Configurable Content-Type (default: `application/xml`) and Accept

**Restrictions enforced:**
- Documented warning: "NEVER use raw_http to POST to lock endpoints (`?method=adtLock`)"
- "each call may get a different ICM session" — cannot do lock→write→unlock sequences
- Lock handles become invalid across multiple raw_http calls

**Implementation:** Wraps `abap-adt-api` HTTP client, executes within `withSession()` context.

**Security implication for ARC-1:** This is an unrestricted ADT escape hatch. ARC-1 intentionally does not expose this — safety system would be completely bypassed. The documented warning against lock operations shows they recognize the danger but rely on documentation rather than enforcement.

---

### 6. `abap_get_function_group` — Parallel Fetch

From `src/handlers/SourceHandlers.ts`:

**Algorithm:**
```
1. GET /sap/bc/adt/functions/groups/{encoded}/objectstructure
   → Parse XML response (abapsource:objectStructureElement children)
   → Extract all atom:link href attributes matching /includes/|/fmodules/ with /source/main suffix

2. Extract readable names: last path segment, URL-decoded, uppercased

3. Promise.all() — parallel getObjectSource() for each discovered link
   → Results collected into two dicts: { sources: {name: code}, errors: {name: error} }

4. Return combined response
```

**Implementation note:** Uses `fast-xml-parser` to parse objectstructure XML, then regex `href` extraction. The parallel fetch is idiomatic JavaScript — `Promise.all()` over all discovered links.

**ARC-1 implication:** This is exactly the pattern needed for FEAT-18. The endpoint is the same `/objectstructure` endpoint that ARC-1's existing `getObjectStructure()` would use. Implementation is straightforward: parse the XML links, map to parallel source fetches.

---

### 7. `abap_get_annotation_defs`

From `src/handlers/DdicHandlers.ts`:

**What it does:** Retrieves annotation definitions from SAP's CDS annotation framework.

**Tools:**
- `ddic_element` — `adtclient.ddicElement()` — retrieves DDIC metadata (field names, types, key flags, data element labels, lengths, decimals, CDS annotations). Supports association resolution and extension views.
- `ddic_references` — `adtclient.ddicRepositoryAccess()` — lists objects referencing a given entity (impact analysis).

**Note:** The file is called `DdicHandlers.ts` and the tools are `ddic_element`/`ddic_references`. The "annotation defs" tool referenced in the README appears to map to `ddic_element` (which includes CDS annotations as part of DDIC metadata). There is no separate `abap_get_annotation_defs` tool — it was likely folded into the DDIC handler.

---

### 8. New Tools vs 2026-04-14

**No new tools since 2026-04-14.** Tool count remains at **53 tools** across 13 handler files. The full inventory from the deep analysis on 2026-04-14 is current.

**Complete handler file inventory:**
| Handler | Size | Tools |
|---------|------|-------|
| SourceHandlers.ts | 34,747 bytes | abap_get_source, abap_set_source, abap_edit_method, abap_set_class_include, abap_get_function_group, abap_pretty_print, abap_revisions |
| ObjectHandlers.ts | 31,617 bytes | abap_create, abap_delete, abap_activate, abap_activate_batch, abap_search, abap_object_info |
| QualityHandlers.ts | 20,751 bytes | abap_syntax_check, abap_atc_run, abap_atc_variants, abap_where_used, abap_find_definition, abap_fix_proposals |
| TransportHandlers.ts | 26,470 bytes | transport_create, transport_assign, transport_release, transport_list, transport_info, transport_contents, transport_set_owner, transport_add_user, transport_delete |
| RunHandlers.ts | 15,762 bytes | abap_run |
| TraceHandlers.ts | 13,893 bytes | traces_list, traces_set_parameters, traces_create_config, traces_hit_list, traces_statements, traces_db_access, traces_delete, traces_delete_config |
| BaseHandler.ts | 15,368 bytes | (base class) |
| TestHandlers.ts | 8,059 bytes | abap_create_test_include, abap_unit_test |
| DataHandlers.ts | 4,899 bytes | abap_table, abap_query |
| SystemHandlers.ts | 10,046 bytes | login, healthcheck, raw_http, abap_get_dump |
| DdicHandlers.ts | 3,876 bytes | ddic_element, ddic_references |
| GitHandlers.ts | 1,995 bytes | git_repos, git_pull |
| RapHandlers.ts | 3,941 bytes | rap_binding_details, rap_publish_binding |

**Auth module:** `src/auth/loginPage.ts` — HTML OAuth login form

---

### 9. Stars/Forks Growth

| Date | Stars | Forks |
|------|-------|-------|
| 2026-04-14 (first analysis) | 32 | 7 |
| 2026-04-16 (this update) | 33 | 7 |

Growth: +1 star in 2 days. The explosive early growth (0 → 32 in 2 weeks) has moderated. No new forks.

---

### 10. Issues Revealing abap-adt-api Library Bugs

Since dassian-adt has **no public issues**, we infer abap-adt-api library limitations from commit messages:

| Commit | Issue Revealed | Relevance to ARC-1 |
|--------|---------------|-------------------|
| `9186ffd` fix(srvd+session): correct SRVD/SRVB paths | Library uses wrong ADT paths for SRVD/SRVB | Verify ARC-1 SRVD/SRVB endpoint URLs match |
| `9027549` fix(activate_batch): bypass library array form | Library's batch activation breaks with array form — causes "Check of condition failed" | ARC-1 uses custom HTTP for activation |
| `98acfe0` fix(errors): stop misclassifying activation/syntax errors as SM12 | Library error classification incorrect — maps activation errors to lock messages | ARC-1's custom error handling avoids this |
| `dc28400` fix(abap_run): surface SAP error body on 500 | Library swallows 500 body — can't distinguish SICF-inactive vs runtime error | ARC-1's custom HTTP always captures body |
| `e171509` fix: revert /source/main suffix on class includes | Library appends wrong suffix for class includes | ARC-1 builds include URLs manually |
| Multiple lock-related fixes | Library session management fragile — dead session cycles, 400 detection gaps | ARC-1's withStatefulSession() more robust |

**Key finding:** The abap-adt-api library (v8.0.1 as of 2026-04-05) has several fragilities that dassian-adt works around with custom code. ARC-1's fully custom HTTP layer avoids these library-level issues.

---

## abap-mcpb (albanleong) — Analysis

### Repository: https://github.com/albanleong/abap-mcpb

**Created**: 2026-03-31 | **Stars**: 0 | **Forks**: 0 | **Commits**: 1 (initial commit only)

### What It Is

A packaging of dassian-adt v2.0 in **MCPB format** — a Claude Desktop-specific bundle format that allows one-click installation without building from source. Users download the `.mcpb` file and open it in Claude Desktop; configuration is done via a built-in form (URL, credentials, client, language) rather than JSON editing.

### Architecture

The MCPB contains the compiled JavaScript from dassian-adt with **two files customized:**

**1. QualityHandlers.js** — Enhanced ATC tool:
- Triggers new quality checks (instead of just fetching existing ones)
- Returns results structured by severity level with check identifiers, titles, and source locations
- This improvement predates dassian-adt's upstream `abap_atc_run` enhancement

**2. index.js** — Error handling improvements:
- Global `uncaughtException` handler
- Global `unhandledRejection` handler
- Environmental diagnostic logging during startup
- Exception handling around stdio runner for better error visibility

All other 24 files are identical to dassian-adt v2.0 (25-tool snapshot).

### Assessment

- **No development activity** — 1 commit, 0 stars, 0 issues
- **Frozen snapshot** of dassian-adt v2.0 (25 tools, pre-OAuth, pre-multi-system)
- **Behind dassian-adt** by 28+ tools and 2 auth methods
- **Value:** MCPB format is interesting for ARC-1 — zero-build-step installation could expand Claude Desktop adoption
- **Not a competitive threat** — merely a packaging exercise

---

## Summary Assessment (2026-04-16)

### What Changed Since 2026-04-14

**dassian-adt:** No new commits. 1 new star (+1). Repository appears stable at 53 tools.

**abap-mcpb:** No new commits. Effectively dormant.

### Deep Implementation Findings (new detail not in previous analysis)

1. **abap_run ADT endpoint**: `POST /sap/bc/adt/oo/classrun/{className}` — clean implementation, good reference for ARC-1 FEAT
2. **Multi-system**: `Map<string, SystemEntry>` with `sap_system_id` injected into all tool schemas — pragmatic for on-premise
3. **OAuth**: Self-hosted AS with PKCE, in-memory token store — simpler than BTP but lacks enterprise features
4. **abap_get_function_group**: `Promise.all()` over `atom:link` hrefs from objectstructure XML — clean reference for FEAT-18
5. **No Enhancement/BAdI tools** confirmed — gap remains
6. **DdicHandlers**: `ddic_element` + `ddic_references` only, no separate annotation tool
7. **raw_http**: Enforced via documentation only, no code-level restrictions — security design flaw
8. **Transport handlers**: 9 tools (more than reported) including transport_set_owner, transport_add_user, transport_delete
9. **Test handlers**: 2 tools — `abap_create_test_include` + `abap_unit_test`
10. **Trace handlers**: 8 tools — full profiler workflow

### Updated Gap Analysis

No changes to gap analysis since 2026-04-14 — no new features added. See `08-dassian-adt-feature-gap.md`.

### Feature Matrix Corrections (vs 00-feature-matrix.md)

| Item | Previous | Corrected | Reason |
|------|----------|-----------|--------|
| Transport tools count | 6 | 9 | +transport_set_owner, +transport_add_user, +transport_delete |
| Trace tools | listed under Diagnostics | Separate TraceHandlers.ts (8 tools) | Full profiler workflow |
| ddic_element scope | "annotation definitions" | DDIC metadata including CDS annotations | No separate annotation tool |
| SRVB read | ❌ | ❌ (confirmed) | rap_binding_details reads binding config, not SRVB source |
| Test include create | ❌ | ✅ | abap_create_test_include exists in TestHandlers.ts |

---

_Last updated: 2026-04-16_
