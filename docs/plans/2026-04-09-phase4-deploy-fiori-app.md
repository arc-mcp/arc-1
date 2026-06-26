# Phase 4: Deploy Fiori Elements App (E2E Skill)

## Overview

Complete the end-to-end pipeline: Table → RAP → Published Service → Fiori Elements App → Deployed & Accessible. This phase uses SAP's official `@sap/generator-fiori` in headless mode to generate a Fiori Elements app, ZIPs the `webapp/` folder, and deploys it to the ABAP system via the ABAP Repository OData Service.

**Key architectural decision:** App generation is delegated to `@sap/generator-fiori` (headless CLI) instead of generating templates in-memory. The generator handles all UI5 version/floorplan complexity — manifest.json structure varies significantly across UI5 versions, OData V2 vs V4, and floorplan types. See `fiori-deployment-research.md` "Key Decision" section for full rationale.

**Dependencies:** Phase 2 (publish SRVB) and Phase 3 (ABAP Repository query) must be completed first.

## Context

### Current State (What ARC-1 Already Has)

| Capability | Status | Location |
|-----------|--------|----------|
| Publish/unpublish SRVB | Done | `src/adt/devtools.ts:128-163` |
| Read SRVB metadata (odataVersion, serviceDefinition) | Done | `src/adt/client.ts:268-274` (getSrvb) |
| List/browse/read BSP apps | Done | `src/adt/client.ts:424-457` |
| Detect SAP_BASIS version + system type | Done | `src/adt/features.ts:178-193` |
| SAP component list (includes SAP_UI) | Done | `src/adt/client.ts` (getInstalledComponents) |
| CSRF token management | Done | `src/adt/http.ts:385-452` |
| BSP app existence check (getAppInfo) | Done | `src/adt/ui5-repository.ts` |

### What's Missing

| Capability | Complexity | Notes |
|-----------|------------|-------|
| SAP_UI → UI5 version mapping | Easy | Hardcoded lookup, data already available |
| Fetch $metadata EDMX from published SRVB | Medium | GET on OData service URL, V2 vs V4 URL patterns |
| Headless config builder + npx child process | Medium | Build JSON, shell out, handle errors, cleanup temp dir |
| ZIP `webapp/` folder with adm-zip | Easy | Standard ZIP library |
| Deploy via ABAP_REPOSITORY_SRV (POST/PUT) | Hard | Different HTTP path, may need separate CSRF, Atom XML payload |
| Undeploy via ABAP_REPOSITORY_SRV (DELETE) | Medium | Simpler than deploy but same HTTP concerns |
| Skill + command markdown | Easy | Prompt template |

### Target State

- `SAPManage(action="deploy_ui5", name="ZAPP_BOOKING", package="$TMP", service_binding="ZSB_BOOKING")` — generates + deploys a Fiori Elements app
- `SAPManage(action="undeploy_ui5", name="ZAPP_BOOKING")` — removes a deployed app
- New skill `generate-fiori-app` — orchestrates the full flow
- App accessible at `/sap/bc/ui5_ui5/sap/{appname}?sap-client={client}`

### Key Files

| File | Role |
|------|------|
| `src/adt/ui5-repository.ts` | Extend with `deployApp()`, `undeployApp()` |
| `src/adt/fiori-generator.ts` | **New** — headless config builder, npx runner, EDMX fetcher |
| `src/adt/features.ts` | Add SAP_UI → UI5 version mapping |
| `src/handlers/intent.ts` | Add deploy/undeploy actions in SAPManage handler |
| `src/handlers/tools.ts` | Update SAPManage description |
| `src/handlers/schemas.ts` | Update SAPManage schema |
| `skills/generate-fiori-app.md` | **New** — Fiori Elements app generation skill |
| `.claude/commands/generate-fiori-app.md` | **New** — Claude Code command |
| `skills/generate-rap-service.md` | Update to reference generate-fiori-app as next step |
| `package.json` | Add `adm-zip` dependency |
| `tests/unit/adt/fiori-generator.test.ts` | **New** — generator config + process tests |
| `tests/unit/adt/ui5-repository.test.ts` | Deploy/undeploy unit tests |

### Design Principles

1. **Delegate generation to SAP's tooling** — `@sap/generator-fiori` handles all UI5 version/floorplan complexity. ARC-1 only builds the config JSON and runs the CLI.
2. **Keep the generated app minimal** — `FE_LROP` floorplan, `generateFormAnnotations: false`, `generateLROPAnnotations: false`. The CDS DDLX annotations drive the UI. The app is just a shell.
3. **Only ZIP `webapp/`** — the generator produces a full project (package.json, ui5.yaml, etc.) but only the `webapp/` folder contents go into the deployment ZIP. Files at ZIP root level, no parent directory.
4. **Deploy via ABAP_REPOSITORY_SRV** — the proven OData API, same as SAP Web IDE, BAS, and deploy-tooling. NOT the ADT filestore (which is read-only, returns 405 on writes).
5. **Use existing SAP connection for EDMX** — ARC-1 fetches `$metadata` directly from the published service. No dependency on `@sap-ux/store` or separate auth config.
6. **Package is uppercased, BSP name is uppercased** — standard SAP convention.
7. **FLP tile is out of scope** — after deploy, provide system-specific guidance. The `crossNavigation.inbounds` in manifest.json enables auto-registration on BTP.

## Development Approach

Test-driven with mock HTTP for deployment. Generator tests use fixtures (pre-built config JSON → verify structure). The npx child process is mocked in unit tests. Integration testing of the full flow requires a real SAP system.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

---

### Task 1: Add adm-zip dependency

**Files:** `package.json`
**Complexity:** Easy
**Risk:** None

- [ ] Run `npm install adm-zip` and `npm install -D @types/adm-zip`
- [ ] Verify `package.json` has `adm-zip` in dependencies and `@types/adm-zip` in devDependencies
- [ ] Run `npm test` — all tests must pass

---

### Task 2: Add SAP_UI → UI5 version mapping

**Files:** `src/adt/features.ts`
**Complexity:** Easy
**Risk:** Low — additive change, existing feature detection untouched

Add a function to extract the UI5 version from the already-fetched system components.

- [ ] Add `SAP_UI_TO_UI5` mapping constant (see `fiori-deployment-api-reference.md` Part 7 for the full table):
  ```typescript
  const SAP_UI_TO_UI5: Record<string, string> = {
      '816': '1.136.0',
      '758': '1.120.0',
      '757': '1.108.0',
      '756': '1.96.0',
      '754': '1.71.0',
  };
  ```
- [ ] Add `getUi5Version(components: InstalledComponent[]): string` function that:
  1. Finds the `SAP_UI` component in the list
  2. Maps its `release` to UI5 version via `SAP_UI_TO_UI5`
  3. Falls back to `'1.120.0'` if not found (safe LTS default)
  4. For BTP systems (detected via `SAP_CLOUD` component), defaults to `'1.136.0'`
- [ ] Export the function for use in the generator module
- [ ] Add unit tests (~5 tests): known mappings (816→1.136.0, 758→1.120.0), unknown release falls back, BTP default, missing SAP_UI falls back
- [ ] Run `npm test` — all tests must pass

---

### Task 3: Create Fiori generator module (EDMX fetch + headless config + npx runner)

**Files:**
- Create: `src/adt/fiori-generator.ts`
- Create: `tests/unit/adt/fiori-generator.test.ts`

**Complexity:** Medium
**Risk:** Medium — child process management, temp file cleanup, EDMX URL construction

This module handles three concerns: fetching EDMX metadata, building the headless config, and running the generator.

#### 3a: EDMX metadata fetching

- [ ] Implement `fetchEdmxMetadata(http, serviceUrl: string): Promise<string>` that:
  1. GETs `{serviceUrl}/$metadata` with `Accept: application/xml`
  2. Returns the raw EDMX XML string
  3. Throws a clear error if the service returns 404 (not published?) or non-XML response
- [ ] Handle V4 vs V2 URL patterns:
  - V4: `/sap/opu/odata4/sap/{srvb_name}/srvd_a2x/sap/{srvd_name}/0001/$metadata`
  - V2: `/sap/opu/odata/sap/{srvb_name}/$metadata`
  - The service URL can be derived from SRVB metadata (`getSrvb()` returns `odataVersion` and `serviceDefinition`)
- [ ] Add helper `buildServiceUrl(srvbName: string, srvdName: string, odataVersion: '2.0' | '4.0'): string` to construct the OData service base URL
- [ ] Add unit tests (~5 tests): V4 URL construction, V2 URL construction, EDMX fetch success, fetch 404 error, non-XML response error

#### 3b: Headless config builder

- [ ] Define `FioriGeneratorConfig` interface:
  ```typescript
  interface FioriGeneratorConfig {
      bspName: string;           // ABAP BSP name (e.g., "ZAPP_BOOKING")
      description: string;       // App description
      serviceHost: string;       // SAP system URL
      servicePath: string;       // OData service path
      sapClient: string;         // SAP client number
      edmx: string;              // Full EDMX XML
      entityName: string;        // Main entity name from CDS projection
      ui5Version: string;        // From SAP_UI mapping (e.g., "1.120.0")
  }
  ```
- [ ] Implement `buildHeadlessConfig(config: FioriGeneratorConfig): object` that builds the JSON config:
  - `version: "0.2"` (mandatory, validated by generator)
  - `floorplan: "FE_LROP"` (List Report + Object Page)
  - `project.name`: derive from bspName — lowercase, replace underscores with dashes (`ZAPP_BOOKING` → `zapp-booking`). Must match `/^[a-z0-9-]+$/`
  - `project.sapux: true` (required for FE floorplans)
  - `project.ui5Version`: from SAP_UI mapping
  - `service.edmx`: the full EDMX XML string
  - `entityConfig.generateFormAnnotations: false` (CDS DDLX handles this)
  - `entityConfig.generateLROPAnnotations: false` (CDS DDLX handles this)
  - `telemetryData.generationSourceName: "arc-1"`
- [ ] Add unit tests (~8 tests): config has version 0.2, floorplan is FE_LROP, project name derived correctly (uppercase→lowercase, underscores→dashes), sapux is true, EDMX embedded in service, annotations disabled, telemetry included, invalid BSP name throws

#### 3c: npx process runner

- [ ] Implement `generateFioriApp(config: FioriGeneratorConfig): Promise<string>` that:
  1. Creates a temp directory (`os.tmpdir()` + random suffix)
  2. Builds the headless config via `buildHeadlessConfig()`
  3. Writes config to `{tempDir}/generator-config.json`
  4. Runs `npx -y yo@4 @sap/fiori:headless generator-config.json --force --skipInstall` with `cwd: tempDir`
  5. Returns the path to the generated `webapp/` folder: `{tempDir}/{projectName}/webapp`
  6. On error: parses stderr for known error patterns, throws descriptive error
  7. Timeout: 120 seconds (first run downloads ~100MB; subsequent runs are fast)
- [ ] Implement `cleanupGeneratedApp(tempDir: string): Promise<void>` — removes the temp directory
- [ ] Add unit tests (~5 tests): config written to temp file, npx command constructed correctly, stderr parsed on error, timeout handled, cleanup removes temp dir. **Mock `child_process.exec`** — do not actually run npx in unit tests.
- [ ] Run `npm test` — all tests must pass

**Note on testing:** The npx invocation cannot be tested in unit tests (requires Node.js + network). Integration tests against a real SAP system would cover the full flow. For unit tests, mock `child_process.exec` and verify the command string and config JSON structure.

---

### Task 4: Implement deploy and undeploy via ABAP Repository Service

**Files:**
- Modify: `src/adt/ui5-repository.ts`
- Modify: `tests/unit/adt/ui5-repository.test.ts`

**Complexity:** Hard — this is the highest-risk task
**Risk:** High — different HTTP path than ADT, may need separate CSRF token, Atom XML payload

See `fiori-deployment-api-reference.md` Parts 1-3 for the complete API specification.

#### 4a: ZIP creation helper

- [ ] Implement `createWebappZip(webappPath: string): Buffer`:
  1. Walk the `webappPath` directory
  2. Add each file to a `new AdmZip()` instance with paths relative to `webappPath` (files at ZIP root, no parent folder)
  3. Return `zip.toBuffer()`
- [ ] Add unit tests (~3 tests): ZIP contains expected files, paths are relative (no `webapp/` prefix), ZIP buffer is valid

#### 4b: Atom XML payload builder

- [ ] Add helper `createAtomPayload(appName: string, packageName: string, description: string, zipBase64: string): string`:
  - Builds the Atom XML entry payload per `fiori-deployment-api-reference.md` Section 1.5
  - XML-escape name and description using the escape map: `& → &amp;`, `" → &quot;`, `' → &apos;`, `< → &lt;`, `> → &gt;`
  - Uppercase the package name
  - Use ISO timestamp for `<updated>`
  - Include `<d:Name>`, `<d:Package>`, `<d:Description>`, `<d:ZipArchive>`, `<d:Info/>`
- [ ] Add unit tests (~4 tests): XML contains correct name, package uppercased, description escaped, base64 ZIP embedded

#### 4c: CSRF token for OData service

The ABAP Repository OData Service (`/sap/opu/odata/`) is on a different path than ADT (`/sap/bc/adt/`). The existing ADT CSRF token (from HEAD `/sap/bc/adt/core/discovery`) **may not be valid** for the OData service.

- [ ] Implement CSRF fetching for the OData path: piggyback on the `getAppInfo()` GET request by adding `X-Csrf-Token: Fetch` header, then capture the `x-csrf-token` response header
- [ ] Store the OData CSRF token separately from the ADT CSRF token
- [ ] If the ADT CSRF token works for OData (needs manual testing), simplify by reusing it
- [ ] Add unit tests (~2 tests): CSRF token captured from getAppInfo response, token included in subsequent write requests

**Important:** This CSRF concern needs manual testing against a real SAP system to verify. The behavior may differ between on-premise and BTP. Document findings.

#### 4d: Deploy (POST/PUT)

- [ ] Implement `deployApp(http, safety, config: { name: string; package: string; description: string; archive: Buffer; transport?: string }): Promise<string>`:
  1. `checkOperation(safety, OperationType.Create, 'DeployUI5App')`
  2. Call `getAppInfo()` to check existence (also fetches CSRF token)
  3. Base64-encode the archive buffer
  4. Build Atom XML payload via `createAtomPayload()`
  5. If app doesn't exist: POST to `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories`
  6. If app exists: PUT to `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{encodeURIComponent(name)}')`
  7. Headers: `Content-Type: application/atom+xml; type=entry; charset=UTF-8`, `X-Csrf-Token: {token}`
  8. Query params: `CodePage='UTF8'&CondenseMessagesInHttpResponseHeader=X&format=json`
  9. Optional query param: `TransportRequest={transport}` (required for non-$TMP packages)
  10. Parse `sap-message` response header (JSON) for success/error details
  11. Return app URL: `/sap/bc/ui5_ui5/sap/{name.toLowerCase()}?sap-client={client}`
- [ ] Implement retry logic for 408/504 timeout: retry up to 3 times, re-check `getAppInfo()` on each retry (timeout may have partially created the app, switching POST to PUT)
- [ ] Add unit tests (~8 tests): deploy new app (POST), redeploy existing (PUT), transport param in query, Atom XML structure, base64 encoding, package uppercased, retry on 504, safety check blocks

#### 4e: Undeploy (DELETE)

- [ ] Implement `undeployApp(http, safety, appName: string, transport?: string): Promise<void>`:
  1. `checkOperation(safety, OperationType.Delete, 'UndeployUI5App')`
  2. DELETE to `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{encodeURIComponent(appName)}')`
  3. Query params: `CodePage='UTF8'&CondenseMessagesInHttpResponseHeader=X&format=json`
  4. Optional: `TransportRequest={transport}`
  5. Parse `sap-message` header for confirmation
- [ ] Add unit tests (~3 tests): undeploy sends DELETE, transport param included, safety check blocks

- [ ] Run `npm test` — all tests must pass

---

### Task 5: Wire up SAPManage handler

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`

**Complexity:** Medium
**Risk:** Low — follows established handler patterns

- [ ] Add `deploy_ui5` and `undeploy_ui5` to SAPManage action enum in `src/handlers/schemas.ts`. Add fields:
  - `service_binding: z.string().optional()` — SRVB name for auto-generation
  - `archive_base64: z.string().optional()` — for pre-built ZIP upload (advanced use case)
- [ ] Update SAPManage description in `src/handlers/tools.ts`:
  ```
  deploy_ui5: deploy a UI5/Fiori app to the ABAP system. Provide service_binding to auto-generate
  a Fiori Elements app from a published RAP service, or archive_base64 for a pre-built ZIP.
  undeploy_ui5: remove a deployed UI5/Fiori app.
  ```
- [ ] Add `deploy_ui5` case in `handleSAPManage` at `src/handlers/intent.ts`:
  1. If `service_binding` provided:
     a. Read SRVB metadata via `getSrvb()` → get odataVersion, serviceDefinition
     b. Detect UI5 version from SAP_UI component via `getUi5Version()`
     c. Build service URL via `buildServiceUrl()`
     d. Fetch EDMX via `fetchEdmxMetadata()`
     e. Read projection CDS entity for main entity name
     f. Call `generateFioriApp()` → get webapp path
     g. Call `createWebappZip()` → get ZIP buffer
     h. Call `deployApp()` → get app URL
     i. Call `cleanupGeneratedApp()` → remove temp dir
     j. Return app URL
  2. If `archive_base64` provided:
     a. Decode base64 to Buffer
     b. Call `deployApp()` directly
     c. Return app URL
  3. If neither provided: return error
- [ ] Add `undeploy_ui5` case: call `undeployApp()` with name and optional transport
- [ ] Add handler unit tests (~5 tests): deploy from service binding (mock all dependencies), deploy from archive, undeploy, missing name error, deploy returns URL
- [ ] Run `npm test` — all tests must pass

---

### Task 6: Create generate-fiori-app skill

**Files:**
- Create: `skills/generate-fiori-app.md`
- Create: `.claude/commands/generate-fiori-app.md`
- Modify: `skills/generate-rap-service.md`
- Modify: `.claude/commands/generate-rap-service.md`
- Modify: `skills/README.md`

**Complexity:** Easy
**Risk:** None — markdown only

- [ ] Create `skills/generate-fiori-app.md` with the following flow:
  1. **Input:** Service binding name (required), BSP app name (optional, derived from SRVB if not given), package (optional, defaults to `$TMP`), transport (optional)
  2. **Step 1:** Read SRVB metadata → confirm published, get odataVersion
  3. **Step 2:** Read projection CDS view for entity name
  4. **Step 3:** Read DDLX metadata annotations for UI annotation labels (informational)
  5. **Step 4:** Call `SAPManage(action="deploy_ui5", service_binding="ZSB_...", name="ZAPP_...", package="$TMP")`
  6. **Step 5:** Present the app URL to the user
  7. **Notes section:** Document first-run delay (~60s for npx download), FLP guidance (BTP: auto-registered via crossNavigation; on-prem: `/UI2/FLPD_CUST`), alternative with fiori-mcp-server
- [ ] Create `.claude/commands/generate-fiori-app.md` with same content
- [ ] Update `skills/generate-rap-service.md` to add: "Next step: Generate a Fiori Elements app with the generate-fiori-app skill"
- [ ] Update `.claude/commands/generate-rap-service.md` with same reference
- [ ] Add `generate-fiori-app` to the skills table in `skills/README.md`
- [ ] Run `npm test` — all tests must pass (skill changes are markdown, just verify no regressions)

---

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the complete E2E flow works conceptually:
  ```
  generate-rap-service → manual SRVB creation
  → SAPActivate(action="publish_srvb")
  → generate-fiori-app skill
  → SAPManage(action="deploy_ui5", service_binding="ZSB_...")
  → app URL returned
  → verify via SAPRead(type="BSP")
  ```
- [ ] Document FLP guidance in skill: for BTP point to crossNavigation auto-registration, for on-prem point to `/UI2/FLPD_CUST` transaction
- [ ] Move this plan to `docs/plans/completed/`

---

## Risk Assessment

| Task | Risk | Why | Mitigation |
|------|------|-----|------------|
| Task 1 (adm-zip) | None | Standard npm dependency | — |
| Task 2 (UI5 mapping) | Low | Hardcoded lookup, stable data | Fallback to 1.120.0 |
| Task 3a (EDMX fetch) | Medium | V2 vs V4 URL patterns, service must be published | Derive URL from SRVB metadata |
| Task 3b (config builder) | Low | Pure data transformation | Comprehensive unit tests |
| Task 3c (npx runner) | Medium | Child process, temp files, first-run delay, Docker? | Timeout guard, cleanup in finally |
| Task 4a (ZIP) | Low | adm-zip is straightforward | — |
| Task 4b (Atom XML) | Low | String construction, well-documented format | Test against reference in api-reference.md |
| Task 4c (CSRF) | **High** | Unknown if ADT CSRF works for OData path | Needs manual testing, implement fallback |
| Task 4d (deploy POST/PUT) | **High** | Complex flow, retry logic, transport handling | Thorough unit tests, integration test |
| Task 4e (undeploy) | Medium | Simpler than deploy but same HTTP concerns | — |
| Task 5 (handler) | Low | Follows established patterns | — |
| Task 6 (skill) | None | Markdown only | — |

**Testing priority:** Task 4 (deploy/undeploy) needs the most thorough testing. Task 3c (npx runner) needs integration testing with a real SAP system. Everything else can be well-covered by unit tests alone.

---

## Reference Documents

- `docs/plans/2026-04-09-fiori-deployment-research.md` — Full research: options evaluated, generator analysis, fiori-mcp-server analysis, UI5 version detection
- `docs/plans/2026-04-09-fiori-deployment-api-reference.md` — API specs: ABAP Repository OData Service, ADT Filestore, transport handling, ZIP creation, headless generator config format
