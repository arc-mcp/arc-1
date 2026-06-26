# Research: Fiori Elements App Deployment via ARC-1

## Question

Can ARC-1 go beyond RAP service generation to also create a Fiori Elements app on top, deploy it, and create a launchpad tile? What APIs exist? What do competitors offer?

## TL;DR

| Capability | Feasible? | How? |
|-----------|-----------|------|
| Generate Fiori Elements app | **Yes** | Generate `manifest.json` + `Component.js` + i18n, ZIP it, deploy |
| Deploy to ABAP (BSP repository) | **Yes** | OData service `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` — base64 ZIP upload |
| Publish service binding | **Yes** | ADT API exists (`PublishServiceBinding`) — confirmed working |
| Create launchpad tile | **Yes** | `crossNavigation.inbounds` in manifest.json — auto-registered by app index |
| Custom ICF node needed? | **No** | Deployment creates ICF entry automatically; FLP uses manifest.json |

**CRITICAL CORRECTION from initial research:** The ADT filestore endpoint (`/sap/bc/adt/filestore/ui5-bsp`) is **READ-ONLY** — returns HTTP 405 on POST/PUT/DELETE. SAP's official deploy-tooling uses a completely different OData service for writes.

---

## VSP (vibing-steampunk) UI5/BSP: The Cautionary Tale

### What Happened

vibing-steampunk implemented 7 UI5/BSP tools in v2.10.0 against the ADT filestore endpoint. In v2.10.1, **4 write tools were disabled** because the ADT filestore API returns HTTP 405 (Method Not Allowed) on POST/PUT/DELETE.

**Only 3 read-only tools work:**
1. `UI5ListApps` — List BSP applications
2. `UI5GetApp` — Get app details + file structure
3. `UI5GetFileContent` — Read individual file content

**4 write tools exist in code but are disabled:**
4. `UI5UploadFile` — PUT with content types (405)
5. `UI5DeleteFile` — DELETE (405)
6. `UI5CreateApp` — POST with XML payload (405)
7. `UI5DeleteApp` — DELETE (405)

### Sources

- `internal/mcp/tools_focused.go`: `// UI5/Fiori BSP Management (3 read-only - ADT filestore is read-only)`
- `articles/2026-02-10-vsp-two-months-later.md`: "Write operations blocked - ADT Filestore is read-only"
- `articles/2026-02-18-100-stars-celebration.md`: "UI5/BSP writes - ADT filestore is read-only. Need alternate API."
- SAP/open-ux-tools issue #943 confirms the ADT filestore service is read-only

### VSP's Identified Workaround (Not Implemented)

They identified `/UI5/CL_REPOSITORY_LOAD` (ABAP class) and `/UI5/UI5_REPOSITORY_LOAD` (function module) as alternatives, but haven't implemented them. Their README states: "UI5/BSP Write - ADT filestore is read-only, needs custom plugin."

### API Quirks Discovered by VSP

- App names must be **uppercased**
- Directory listing is **NOT recursive** (only immediate children)
- Leading slashes must be stripped from file paths before URL encoding
- Response format is **Atom XML feed**, not JSON
- Feature detection should use **OPTIONS** request (200 or 405 = available, 404 = unavailable)

---

## The Real Deployment API: SAP ABAP Repository OData Service

### Discovery from SAP/open-ux-tools

SAP's official `@sap-ux/deploy-tooling` package (part of the 89-package open-ux-tools monorepo) does **NOT** use the ADT filestore for deployment. Instead, it uses:

**`/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV`**

This is an OData service available since **SAP_UI 7.53** that accepts a **base64-encoded ZIP archive** of the entire webapp in an Atom XML payload. This is how SAP Web IDE, SAP Business Application Studio, and the `ui5-task-nwabap-deployer` all deploy Fiori apps.

### API Specification

#### Check if app exists
```
GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{appName}')?$format=json
```

#### Deploy new app (POST)
```
POST /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories
Content-Type: application/atom+xml; type=entry; charset=UTF-8
X-Csrf-Token: {token}
Query: CodePage='UTF8'&CondenseMessagesInHttpResponseHeader=X&format=json
Optional: TransportRequest={TR}&TestMode=true&SafeMode={bool}
```

#### Update existing app (PUT)
```
PUT /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{appName}')
Content-Type: application/atom+xml; type=entry; charset=UTF-8
X-Csrf-Token: {token}
Query: (same as POST)
```

#### Delete app (DELETE)
```
DELETE /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{appName}')
Query: TransportRequest={TR}&TestMode=true (optional)
```

#### Download app files
```
GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{appName}')
Query: CodePage='UTF8'&DownloadFiles='RUNTIME'
```
Returns base64-encoded ZIP.

### Atom XML Payload (POST/PUT)

```xml
<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
       xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
       xml:base="{serviceUrl}">
  <id>{serviceUrl}/Repositories('{appName}')</id>
  <title type="text">Repositories('{appName}')</title>
  <updated>{ISO-8601-timestamp}</updated>
  <category term="/UI5/ABAP_REPOSITORY_SRV.Repository"
            scheme="http://schemas.microsoft.com/ado/2007/08/dataservices/scheme"/>
  <link href="Repositories('{appName}')" rel="edit" title="Repository"/>
  <content type="application/xml">
    <m:properties>
      <d:Name>{appName}</d:Name>
      <d:Package>{PACKAGE_UPPERCASE}</d:Package>
      <d:Description>{description}</d:Description>
      <d:ZipArchive>{base64-encoded-zip-of-webapp}</d:ZipArchive>
      <d:Info/>
    </m:properties>
  </content>
</entry>
```

### Key Implementation Details

- **Always ZIP**: Entire webapp is zipped, base64-encoded, sent as single `ZipArchive` property
- **No incremental deployment**: Full ZIP uploaded every time, SAP extracts and replaces all files
- **CSRF tokens**: First request sends `X-Csrf-Token: Fetch` header, response returns token for subsequent writes
- **Error handling**: 401 (auth failure), 412 (SafeMode conflict — app ID mismatch), 408/504 (timeout — retry up to 3 times)
- **App URL after deployment**: `/sap/bc/ui5_ui5/sap/{appName}?sap-client={client}`
- **Config**: `maxBodyLength: Infinity`, `maxContentLength: Infinity` (ZIPs can be large)
- **Prerequisite**: SAP_UI 7.53+ with `S_DEVELOP` authorization

### Deploy Workflow

```
1. Build webapp files (manifest.json, Component.js, i18n, etc.)
2. Create ZIP archive of webapp/ directory
3. Base64-encode the ZIP
4. GET /Repositories('{appName}') → check if app exists
5. If new:  POST /Repositories with Atom XML payload
   If exists: PUT /Repositories('{appName}') with Atom XML payload
6. Handle transport request (optional, via ADT CTS services)
7. App is live at /sap/bc/ui5_ui5/sap/{appName}
8. App index is automatically updated (no separate registration)
```

---

## FLP Tile Creation: No Separate API Needed

### The Discovery

SAP's `@sap-ux/flp-config-sub-generator` does NOT call any FLP API. It simply writes `crossNavigation.inbounds` into the `manifest.json`. The Fiori app index **automatically** picks up this configuration when the app is deployed via the ABAP Repository service.

### manifest.json FLP Configuration

```json
{
  "sap.app": {
    "crossNavigation": {
      "inbounds": {
        "myApp-display": {
          "semanticObject": "ZBooking",
          "action": "display",
          "title": "{{appTitle}}",
          "subtitle": "{{appSubTitle}}",
          "icon": "sap-icon://list",
          "signature": {
            "parameters": {},
            "additionalParameters": "allowed"
          }
        }
      }
    }
  }
}
```

### What's Needed for a Tile to Appear

1. Deploy the app with `crossNavigation.inbounds` in manifest.json
2. App index auto-registers the app
3. Admin assigns the app to a catalog/group in FLP Designer (or it's auto-assigned in BTP)

The `crossNavigation.inbounds` section defines the semantic object, action, title, and icon. This is sufficient for the app to be discoverable in FLP. Assignment to specific catalogs/groups is a one-time admin task, not something that needs automation.

---

## Fiori Elements manifest.json Template (OData V4 LROP)

Based on SAP's `@sap-ux/fiori-elements-writer`, here is the complete manifest.json structure for a List Report + Object Page:

```json
{
  "_version": "1.65.0",
  "sap.app": {
    "id": "z.my.app",
    "type": "application",
    "title": "{{appTitle}}",
    "description": "{{appDescription}}",
    "applicationVersion": { "version": "1.0.0" },
    "dataSources": {
      "mainService": {
        "uri": "/sap/opu/odata4/sap/{service_binding}/srvd_a2x/sap/{service_definition}/0001/",
        "type": "OData",
        "settings": {
          "odataVersion": "4.0"
        }
      }
    },
    "crossNavigation": {
      "inbounds": {
        "{appId}-display": {
          "semanticObject": "{SemanticObject}",
          "action": "display",
          "title": "{{appTitle}}",
          "signature": {
            "parameters": {},
            "additionalParameters": "allowed"
          }
        }
      }
    }
  },
  "sap.ui": {
    "technology": "UI5",
    "deviceTypes": { "desktop": true, "tablet": true, "phone": true }
  },
  "sap.ui5": {
    "flexEnabled": true,
    "dependencies": {
      "minUI5Version": "1.120.0",
      "libs": {
        "sap.m": {},
        "sap.ui.core": {},
        "sap.ushell": {},
        "sap.fe.templates": {}
      }
    },
    "models": {
      "": {
        "dataSource": "mainService",
        "preload": true,
        "settings": {
          "operationMode": "Server",
          "autoExpandSelect": true,
          "earlyRequests": true
        }
      },
      "@i18n": {
        "type": "sap.ui.model.resource.ResourceModel",
        "uri": "i18n/i18n.properties"
      }
    },
    "routing": {
      "routes": [
        {
          "pattern": ":?query:",
          "name": "{Entity}List",
          "target": "{Entity}List"
        },
        {
          "pattern": "{Entity}({key}):?query:",
          "name": "{Entity}ObjectPage",
          "target": "{Entity}ObjectPage"
        }
      ],
      "targets": {
        "{Entity}List": {
          "type": "Component",
          "id": "{Entity}List",
          "name": "sap.fe.templates.ListReport",
          "options": {
            "settings": {
              "contextPath": "/{Entity}",
              "variantManagement": "Page",
              "navigation": {
                "{Entity}": {
                  "detail": { "route": "{Entity}ObjectPage" }
                }
              }
            }
          }
        },
        "{Entity}ObjectPage": {
          "type": "Component",
          "id": "{Entity}ObjectPage",
          "name": "sap.fe.templates.ObjectPage",
          "options": {
            "settings": {
              "editableHeaderContent": false,
              "contextPath": "/{Entity}"
            }
          }
        }
      }
    },
    "contentDensities": { "compact": true, "cozy": true }
  },
  "sap.fiori": {
    "registrationIds": [],
    "archeType": "transactional"
  }
}
```

### Template Types Supported by SAP

From `@sap-ux/fiori-elements-writer`:
- `lrop` — List Report + Object Page (most common for RAP)
- `worklist` — Worklist page
- `alp` — Analytical List Page
- `ovp` — Overview Page
- `feop` — Form Entry Object Page
- `fpm` — Flexible Programming Model

### Minimal Webapp Structure

```
webapp/
├── manifest.json          ← The critical file (see template above)
├── Component.js           ← ~10 lines standard boilerplate
├── i18n/
│   └── i18n.properties   ← appTitle, appDescription, entity labels
└── index.html             ← FLP sandbox launcher (optional, for testing)
```

**Component.js** (standard boilerplate):
```javascript
sap.ui.define(["sap/fe/core/AppComponent"], function(AppComponent) {
  "use strict";
  return AppComponent.extend("z.my.app.Component", {
    metadata: { manifest: "json" }
  });
});
```

---

## Other Useful open-ux-tools APIs Discovered

### ADT Filestore (Read-Only) — for reading deployed apps

```
GET /sap/bc/adt/filestore/ui5-bsp/objects/{appName}/content
Accept: application/xml
```
Returns Atom XML feed of files/folders. Useful for verifying deployment.

### App Index Service — for querying deployed apps

```
GET /sap/bc/ui2/app_index/?fields={fields}&{searchParams}
GET /sap/bc/ui2/app_index/ui5_app_info_json?id={appId}
```
Read-only. Automatically populated by ABAP Repository service on deploy.

### ADT Transport Check — for UI5 app transport

```
POST /sap/bc/adt/cts/transportchecks
Content-Type: application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData

<DATA>
  <DEVCLASS>{packageName}</DEVCLASS>
  <OPERATION>I</OPERATION>
  <URI>/sap/bc/adt/filestore/ui5-bsp/objects/{appName}/$create</URI>
</DATA>
```

### ADT Transport Create — for UI5 app transport

```
POST /sap/bc/adt/cts/transports
Content-Type: application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest

<DATA>
  <OPERATION>I</OPERATION>
  <DEVCLASS>{packageName}</DEVCLASS>
  <REQUEST_TEXT>{description}</REQUEST_TEXT>
  <REF>/sap/bc/adt/filestore/ui5-bsp/objects/{appName}/$create</REF>
</DATA>
```

### ATO Settings — detect cloud vs on-prem

```
GET /sap/bc/adt/ato/settings
Accept: application/*
```
Returns: `operationsType` (C=Cloud, P=Premise), `developmentPackage`, `isTransportRequestRequired`.

### UI5 Version — detect available UI5 version

```
GET /sap/public/bc/ui5_ui5/bootstrap_info.json
```
Returns: `{ "Version": "1.120.0" }`. Useful for setting `minUI5Version` in manifest.json.

### LREP Service — for adaptation projects (not needed for new apps)

```
POST/PUT/DELETE /sap/bc/lrep/dta_folder/
```
For deploying adaptation projects (app variants). Different from BSP deployment.

---

## Competitor Analysis (Updated)

### Feature Matrix: UI5/Fiori Deployment

| Feature | ARC-1 | vibing-steampunk | fr0ster | dassian-adt | SAP Joule | SAP fiori-mcp-server |
|---------|-------|-----------------|---------|-------------|-----------|---------------------|
| BSP Read (ADT filestore) | No | **Yes (3 tools)** | No | No | No | No |
| BSP Write (ADT filestore) | N/A | **Broken (405)** | No | No | No | No |
| BSP Deploy (ABAP_REPOSITORY_SRV) | No | No | No | No | No | No |
| SRVB Publish | No | Yes | No | No | N/A | No |
| Fiori App Generation | No | No | No | No | No | **Yes** |
| FLP Tile via manifest.json | No | No | No | No | No | No |

**Key findings:**
1. **VSP's 7 BSP tools are misleading** — only 3 read-only tools work, 4 write tools are disabled
2. **Nobody uses the correct deployment API** (`ABAP_REPOSITORY_SRV`) yet
3. SAP has a `fiori-mcp-server` that can generate Fiori apps but doesn't deploy to ABAP
4. **No MCP server** offers end-to-end RAP + Fiori + Deploy

### SAP fiori-mcp-server

Discovered in the open-ux-tools monorepo. Uses `@modelcontextprotocol/sdk` 1.29.0 with LanceDB embeddings. Tools include: `search_docs`, `list_fiori_apps`, `list_functionalities`, `get_functionality_details`, `execute_functionality`. Can generate Fiori Elements apps but doesn't deploy to ABAP systems.

---

## Key Decision: Use `@sap/generator-fiori` Headless Mode (Not In-Memory Templates)

### Why Not Generate Templates In-Memory?

The initial plan proposed generating `manifest.json`, `Component.js`, and `i18n.properties` from scratch in ARC-1. This was rejected because:

1. **manifest.json varies significantly by UI5 version** — routing targets, dependency libs, descriptor version, model settings all change across 1.71, 1.84, 1.96, 1.108, 1.120, 1.136+
2. **OData V2 vs V4 differences** — V2 uses `sap.suite.ui.generic.template.*`, V4 uses `sap.fe.templates.*`
3. **Floorplan-specific configuration** — List Report, Worklist, Analytical, Overview Page each have different routing/target structures
4. **SAP maintains this in `@sap-ux/fiori-elements-writer`** — ~10 packages, EJS templates, version-aware logic. Reimplementing is fragile and will break.

### Three Options Evaluated

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| A: In-memory templates | Generate manifest.json etc. ourselves | No external deps | Fragile, version-sensitive, maintenance burden |
| B: `@sap/generator-fiori` headless | Shell out to `npx yo @sap/fiori:headless` | SAP-maintained, always correct, simple | Needs Node.js + npx, first-run download ~100MB |
| C: fiori-mcp-server delegation | Orchestrate via MCP skill prompt | Zero code changes | User must configure 2 MCP servers, `@sap-ux/store` dependency for auth |

### Decision: Option B — `@sap/generator-fiori` Headless Mode

**Rationale:**
- Single MCP server (no extra user config)
- Uses ARC-1's existing SAP connection for EDMX fetching (no `@sap-ux/store` dependency)
- SAP-maintained generator handles all UI5 version/floorplan complexity
- `@sap/generator-fiori` is on **public npm** (Apache-2.0 license, v1.22.0+)
- The fiori-mcp-server itself uses this exact approach internally

**Option C as lightweight alternative:** The skill docs can mention that users with `fiori-mcp-server` configured can use it instead. No code needed — pure prompt guidance.

---

## Deep Dive: `@sap/generator-fiori` Headless Mode

### Package Facts

| Property | Value |
|----------|-------|
| Package | `@sap/generator-fiori` |
| Registry | Public npm (npmjs.com) |
| License | Apache-2.0 |
| Current version | 1.22.0+ (April 2026) |
| Size | ~10 MB unpacked, 444 files |
| Code | Webpack-bundled/minified (closed source), but underlying open-source packages are in `SAP/open-ux-tools` |
| Dependencies | All bundled (no transitive installs) |

### Invocation

```bash
npx -y yo@4 @sap/fiori:headless <config-file.json> [--force] [--skipInstall] [--delete]
```

| Flag | Purpose |
|------|---------|
| `-y` | Auto-accept npx install prompt |
| `yo@4` | Pinned Yeoman version (fiori-mcp-server pins this) |
| `--force` | Overwrite existing files |
| `--skipInstall` | Skip `npm install` (we only need `webapp/` for deployment) |
| `--delete` | Delete config JSON after generation |

### Config JSON Format (Version 0.2)

The config format is versioned. Current version is `"0.2"` — the generator validates this and throws `App config version mismatch, supported: 0.2` on mismatch.

**Complete reference** (from `@sap-ux/fiori-generator-shared` types + fiori-mcp-server Zod schemas):

```typescript
interface AppConfig {
    readonly version: string;                    // MUST be "0.2"
    readonly floorplan: FloorplanKey;           // "FE_LROP" | "FE_FPM" | "FE_OVP" | "FE_ALP" | "FE_FEOP" | "FE_WORKLIST" | "FF_SIMPLE"
    project: {
        readonly name: string;                   // MUST match /^[a-z0-9-]+$/ (lowercase + dashes only!)
        targetFolder?: string;                   // Absolute path — generator creates {name}/ subfolder here
        readonly namespace?: string;
        readonly title?: string;
        readonly description?: string;           // Required by MCP schema
        readonly ui5Theme?: string;              // e.g. "sap_horizon" (defaults based on UI5 version)
        readonly ui5Version?: string;            // e.g. "1.120.0" (defaults to latest if omitted)
        readonly localUI5Version?: string;
        readonly sapux?: boolean;                // MUST be true for all FE floorplans, false for FF_SIMPLE
        readonly skipAnnotations?: boolean;
        readonly enableEslint?: boolean;
        readonly enableTypeScript?: boolean;
    };
    service?: {
        readonly host?: string;                  // SAP system URL (HTTPS)
        readonly servicePath?: string;           // OData service path
        readonly client?: string;                // SAP client number
        readonly edmx?: string;                  // FULL EDMX XML string (required for FE floorplans!)
        readonly scp?: boolean;
        readonly destination?: string;
        readonly destinationInstance?: string;
        readonly annotations?: Annotations;
        readonly capService?: { ... };           // CAP-specific (not used for RAP)
        readonly apiHubApiKey?: string;
    };
    // FE floorplans only:
    readonly entityConfig?: {
        mainEntity?: { entityName: string; type?: any };
        filterEntityType?: string;
        navigationEntity?: {
            EntitySet: string;                    // Entity set name for nav target
            Name: string;                         // Navigation property name (e.g. "_Booking")
            Role?: string;
        };
        generateFormAnnotations?: boolean;        // Default: true. Set false when CDS DDLX handles annotations.
        generateLROPAnnotations?: boolean;        // Default: true. Set false when CDS DDLX handles annotations.
        qualifier?: string;
        tableType?: string;                       // "GridTable" | "AnalyticalTable" | "ResponsiveTable" | "TreeTable"
        hierarchyQualifier?: string;
    };
    deployConfig?: DeployConfig;
    flpConfig?: FLPConfig;
    telemetryData?: {
        generationSourceName?: string;           // e.g. "arc-1"
        generationSourceVersion?: string;
    };
}
```

### Floorplan Values

The `floorplan` field uses **enum keys** (not values):

| Key (use this) | Internal value | Description |
|-----------------|----------------|-------------|
| `FE_LROP` | `lrop` | List Report + Object Page (most common for RAP) |
| `FE_FPM` | `fpm` | Flexible Programming Model |
| `FE_OVP` | `ovp` | Overview Page |
| `FE_ALP` | `alp` | Analytical List Page |
| `FE_FEOP` | `feop` | Form Entry Object Page |
| `FE_WORKLIST` | `worklist` | Worklist |
| `FF_SIMPLE` | `basic` | Freestyle SAPUI5 app (not Fiori Elements) |

### Minimal Config for a RAP Service (Simplest Possible)

For a RAP service with CDS UI annotations (DDLX), we want the **simplest generation** — no local annotations, no TypeScript, no ESLint. The CDS `@UI.LineItem`, `@UI.FieldGroup` etc. annotations drive the UI entirely.

```json
{
    "version": "0.2",
    "floorplan": "FE_LROP",
    "project": {
        "name": "zbooking-app",
        "description": "Booking Management",
        "targetFolder": "/tmp/fiori-gen-abc123",
        "sapux": true
    },
    "service": {
        "host": "https://my-sap:443",
        "servicePath": "/sap/opu/odata4/sap/zsb_booking/srvd_a2x/sap/zsd_booking/0001/",
        "client": "100",
        "edmx": "<?xml version=\"1.0\"?><edmx:Edmx ...full metadata...</edmx:Edmx>"
    },
    "entityConfig": {
        "mainEntity": {
            "entityName": "Booking"
        },
        "generateFormAnnotations": false,
        "generateLROPAnnotations": false
    },
    "telemetryData": {
        "generationSourceName": "arc-1",
        "generationSourceVersion": "1.0.0"
    }
}
```

Setting `generateFormAnnotations: false` and `generateLROPAnnotations: false` is important — it tells the generator NOT to create local annotation files, relying entirely on backend CDS annotations. This is exactly right for RAP services where DDLX handles everything.

### Output Structure

The generator creates `{targetFolder}/{project.name}/`:

```
{project.name}/
├── package.json               # npm package (not needed for deployment)
├── ui5.yaml                   # UI5 tooling config (not needed for deployment)
├── ui5-local.yaml             # Local dev config (not needed for deployment)
├── README.md                  # (not needed for deployment)
├── .gitignore                 # (not needed for deployment)
└── webapp/                    # ← THIS is what gets ZIPped and deployed
    ├── manifest.json          # Critical: routing, datasource, models, FLP config
    ├── Component.js           # ~6 lines boilerplate (extends sap/fe/core/AppComponent)
    ├── i18n/
    │   └── i18n.properties    # appTitle, appDescription
    └── test/
        └── flpSandbox.html    # FLP sandbox for local testing
```

**For ABAP deployment, only the `webapp/` folder is ZIPped** — the root project files (`package.json`, `ui5.yaml`, etc.) are for local development and are not uploaded.

### EDMX Metadata Requirement

The generator requires the full OData EDMX XML as a string in `service.edmx`. Without it, generation throws: `Error('Missing required property: edmx')`.

**How to obtain EDMX from a published RAP service binding:**

For OData V4 (most common for RAP):
```
GET /sap/opu/odata4/sap/{service_binding}/srvd_a2x/sap/{service_definition}/0001/$metadata
Accept: application/xml
```

For OData V2:
```
GET /sap/opu/odata/sap/{service_binding_v2}/$metadata
Accept: application/xml
```

The service URL pattern is available from the service binding metadata (ARC-1's `getSrvb()` returns `odataVersion` and can derive the URL). After `publishServiceBinding()`, the service is live and `$metadata` is accessible.

### Error Handling

| Scenario | Error Message | ARC-1 Should |
|----------|--------------|--------------|
| Config version wrong | `App config version mismatch, supported: 0.2` | Validate before calling |
| Missing EDMX | `Missing required property: edmx` | Always provide EDMX |
| Folder exists (no --force) | `A folder with the application name already exists` | Always use `--force` |
| Invalid project name | Zod/validation error | Validate `/^[a-z0-9-]+$/` before calling |
| npx not found | Process error (ENOENT) | Check Node.js available, report |
| Generator crashes | Exit code 1, stderr | Parse stderr, return to user |
| First run download | ~30-60s delay | Warn user in skill docs |

### How fiori-mcp-server Calls It (Reference Implementation)

From `packages/fiori-mcp-server/src/tools/functionalities/generate-fiori-ui-application/execute-functionality.ts`:

```typescript
// 1. Merge with predefined values
const generatorConfig = {
    ...PREDEFINED_GENERATOR_VALUES,  // { version: '0.2', telemetryData: {...}, project: { sapux: true } }
    ...generatorConfigValidated,
    project: { ...PREDEFINED_GENERATOR_VALUES.project, ...generatorConfigValidated.project }
};

// 2. Set sapux based on floorplan
generatorConfig.project.sapux = generatorConfig.floorplan !== 'FF_SIMPLE';

// 3. Read EDMX from file and embed inline
const metadata = await FSpromises.readFile(metadataPath, { encoding: 'utf8' });
generatorConfig.service.edmx = metadata;

// 4. Write config to temp file
const configPath = join(targetDir, `${appName}-generator-config.json`);
await FSpromises.writeFile(configPath, JSON.stringify(generatorConfig, null, 4), { encoding: 'utf8' });

// 5. Run generator
const command = `npx -y yo@4 @sap/fiori:headless ${configFileName} --force --skipInstall`;
const { stdout, stderr } = await runCmd(command, { cwd: targetDir });

// 6. Cleanup
finally {
    if (existsSync(configPath)) await FSpromises.unlink(configPath);
    if (existsSync(metadataPath)) await FSpromises.unlink(metadataPath);
}
```

### Two-Layer Architecture

1. **`@sap/generator-fiori`** (closed source, bundled) — Yeoman shell handling CLI, sub-generator composition, headless config parsing
2. **`@sap-ux/*` packages** (open source in `SAP/open-ux-tools`) — Actual generation logic:
   - `@sap-ux/fiori-generator-shared` — Shared types including `AppConfig`
   - `@sap-ux/fiori-elements-writer` — The `generate()` function producing files via mem-fs
   - `@sap-ux/odata-service-writer` — OData service config in manifest.json
   - `@sap-ux/ui5-application-writer` — package.json, ui5.yaml scaffolding

The writer packages have a clean programmatic API via `mem-fs-editor` (files generated in memory, not written to disk until `fs.commit()`). However, using them directly would pull ~10 transitive `@sap-ux/*` packages + ejs + i18next + lodash + mem-fs into ARC-1's dependencies. The headless CLI approach avoids this dependency bloat.

---

## UI5 Version Detection: SAP_UI Component Mapping

### The Problem

The headless config needs `project.ui5Version` to generate a correct `manifest.json` with the right `minUI5Version`. Using a version higher than the target system means the app might use APIs that don't exist. Using a version too low means missing newer FE features.

### Solution: Map SAP_UI Component to UI5 Version

ARC-1 already fetches `/sap/bc/adt/system/components` at startup (`src/adt/features.ts:detectSystemFromComponents`). This returns all installed software components including `SAP_UI` with its release number.

**The authoritative mapping** (from `https://ui5.sap.com/versionoverview.json`):

| SAP_UI Release | UI5 LTS Version | Frontend Server | Support End |
|----------------|------------------|-----------------|-------------|
| `816` | `1.136.0` | FES 2025 for S/4HANA | Q4/2032 |
| `758` | `1.120.0` | FES 2023 for S/4HANA | Q4/2030 |
| `757` | `1.108.0` | FES 2022 for S/4HANA | Q4/2030 |
| `756` | `1.96.0` | FES 2021 for S/4HANA | Q4/2026 |
| `755` | `1.84.0` | FES 2020 for S/4HANA | Out of maintenance |
| `754` | `1.71.0` | Fiori FES 6.0 | Q4/2030 |
| `753` | `1.60.0` | Fiori FES 5.0 | Out of maintenance |

**Implementation in ARC-1:**

```typescript
const SAP_UI_TO_UI5: Record<string, string> = {
    '816': '1.136.0',
    '758': '1.120.0',
    '757': '1.108.0',
    '756': '1.96.0',
    '755': '1.84.0',
    '754': '1.71.0',
    '753': '1.60.0',
};

// Usage: extract from already-fetched components
const components = await client.getInstalledComponents();
const sapUi = components.find(c => c.name.toUpperCase() === 'SAP_UI');
const ui5Version = sapUi ? SAP_UI_TO_UI5[sapUi.release] ?? '1.120.0' : '1.120.0';
```

**Why `.0` patch level:** Use `1.120.0` not `1.120.17`. The `minUI5Version` in manifest.json is a minimum requirement — `.0` ensures compatibility regardless of the system's patch level.

**BTP systems:** For BTP (detected via `SAP_CLOUD` component presence), UI5 is loaded from CDN. Default to `1.136.0` (latest LTS).

**This mapping is stable** — SAP_UI versions are fixed releases. SAP_UI 7.58 always ships UI5 1.120.x. The mapping only changes when SAP ships a new SAP_UI version (~annually). Zero additional HTTP requests needed.

**Alternative endpoint** (less reliable): `GET /sap/public/bc/ui5_ui5/bootstrap_info.json` returns `{ "Version": "1.120.0" }` on some systems, but it's not available on BTP ABAP Environment (UI5 loaded from CDN) and not always present on-premise.

**External reference:** `https://ui5.sap.com/versionoverview.json` contains the full mapping and can be fetched at build time or cached if dynamic mapping is ever needed.

---

## SAP fiori-mcp-server Analysis

### What It Is

`@sap-ux/fiori-mcp-server` (v0.6.48, Apache-2.0) is SAP's official MCP server for Fiori app generation. Part of the `SAP/open-ux-tools` monorepo. Actively developed (90+ releases since Sept 2025).

### 5 MCP Tools

| Tool | Purpose |
|------|---------|
| `search_docs` | Vector search across Fiori/UI5 docs (uses LanceDB + Xenova transformers) |
| `list_fiori_apps` | Scan directory for existing Fiori apps |
| `list_functionalities` | List available operations |
| `get_functionality_details` | Get parameter schema for an operation |
| `execute_functionality` | Execute an operation with parameters |

### 6 Functionalities

1. `generate-fiori-ui-application` — Generate FE app for OData (non-CAP, e.g., RAP)
2. `generate-fiori-ui-application-cap` — Generate FE app within CAP project
3. `add-page` — Add pages to existing app
4. `delete-page` — Delete pages
5. `create-controller-extension` — Add controller extensions
6. `fetch-service-metadata` — Fetch EDMX from a live SAP system

### Architecture: Shells Out to Yeoman

Both generation functionalities work by:
1. Building a JSON config from MCP tool parameters
2. Writing it to a temp file
3. Running `npx -y yo@4 @sap/fiori:headless <config>.json --force --skipInstall`
4. Cleaning up temp files in `finally` block

It does **not** use `@sap-ux/fiori-elements-writer` directly — it delegates to the closed-source `@sap/generator-fiori` Yeoman generator.

### Key Limitation: SAP System Auth

The `fetch-service-metadata` functionality uses `@sap-ux/store` to look up pre-stored SAP systems (saved via VS Code Fiori tools or Business Application Studio). It cannot take credentials from ARC-1's SAP connection. This is the main reason ARC-1 should fetch EDMX itself rather than delegating to fiori-mcp-server.

### Does NOT Handle Deployment

The MCP server only generates and modifies apps. There are no deployment functionalities. ARC-1 still needs its own deploy implementation via ABAP_REPOSITORY_SRV.

### Can Be Used Alongside ARC-1 (Option C)

Both Claude Desktop and Claude Code support multiple MCP servers. A skill/prompt can instruct the LLM to call tools from both servers:
1. ARC-1 fetches EDMX via `SAPRead`
2. LLM writes EDMX to temp file
3. fiori-mcp-server generates app via `execute_functionality`
4. ARC-1 deploys via `SAPManage(deploy_ui5)`

This works but requires users to configure two MCP servers and pre-store SAP systems in `@sap-ux/store`.

---

## Revised Implementation Plan

### Phase 1: ADT Filestore Read Operations (COMPLETED)
- **Status:** Implemented in `src/adt/client.ts`
- `listBspApps()`, `getBspAppStructure()`, `getBspFileContent()` are live
- Uses `/sap/bc/adt/filestore/ui5-bsp/objects` (read-only)

### Phase 2: Publish Service Binding (COMPLETED)
- **Status:** Implemented in `src/adt/devtools.ts`
- `publishServiceBinding()` and `unpublishServiceBinding()` are live
- Uses `/sap/bc/adt/businessservices/odatav2/publishjobs` and `unpublishjobs`

### Phase 3: ABAP Repository Service — Query/Describe (COMPLETED)
- **Status:** `getAppInfo()` implemented (or can use existing BSP read operations)
- Foundation for Phase 4 deployment

### Phase 4: Deploy Fiori Elements App (E2E Skill)
- **Effort:** M (3-5 days)
- **Impact:** Very high — completes the Table → RAP → Fiori Elements pipeline. First MCP server to do this.
- **Approach:** Use `@sap/generator-fiori` headless mode to generate the app. Deploy via ABAP_REPOSITORY_SRV. Only ZIP the `webapp/` subfolder.
- **Key components:**
  1. SAP_UI → UI5 version mapping (easy, data already available)
  2. EDMX metadata fetching from published SRVB (medium)
  3. Headless config builder + `npx` child process (medium)
  4. `webapp/` ZIP creation with `adm-zip` (easy)
  5. Deploy via ABAP_REPOSITORY_SRV POST/PUT (hard — different HTTP path, separate CSRF, Atom XML)
  6. Skill/command markdown (easy)
- **Detailed plan:** `docs/plans/2026-04-09-phase4-deploy-fiori-app.md`

### Out of Scope: FLP Tile/Launchpad Configuration
FLP configuration varies significantly by system type and setup:
- **BTP ABAP:** `crossNavigation.inbounds` in manifest.json is auto-registered. Managed App Router handles the rest.
- **On-prem:** Requires admin to configure catalog/group via FLP Designer (transaction `/UI2/FLPD_CUST`), set up semantic objects (`/UI2/SEMOBJ_SAP`), and assign target mappings.
- **Recommendation:** After deployment, provide system-specific guidance and link to SAP documentation. The deployed app is accessible directly via its ICF URL + `index.html` without FLP.

---

## What a Full "Generate RAP + Fiori + Deploy" Skill Would Look Like

```
Step 1-12:  [Existing] Generate RAP stack (table, CDS, BDEF, SRVD, DDLX, CLAS)
Step 13:    [Existing] Create service binding (manual — instruct user)
Step 14:    [Done] Publish service binding → OData service is live
Step 15:    [Phase 4] Detect UI5 version from SAP_UI component
Step 16:    [Phase 4] Fetch $metadata EDMX from published service
Step 17:    [Phase 4] Build headless config + run @sap/generator-fiori
Step 18:    [Phase 4] ZIP webapp/ folder with adm-zip
Step 19:    [Phase 4] Deploy via ABAP_REPOSITORY_SRV (POST or PUT)
Step 20:    [Done] Verify via BSP filestore read (already implemented)
Step 21:    [Done] App accessible at /sap/bc/ui5_ui5/sap/{appName}?sap-client={client}
```

---

## Detailed API Reference

See **[`docs/plans/2026-04-09-fiori-deployment-api-reference.md`](2026-04-09-fiori-deployment-api-reference.md)** for:
- Exact HTTP methods, URLs, headers, query parameters
- Atom XML payload format with all fields
- CSRF token flow differences from ADT
- Error handling by HTTP status code
- Retry logic for timeouts (408/504)
- SafeMode/TestMode behavior
- ZIP archive creation
- Transport check/create XML payloads
- ADT filestore read-only operations
- Differences from ARC-1's existing ADT HTTP client

---

## Summary

| Question | Answer |
|----------|--------|
| Can we create a Fiori Elements app? | **Yes** — generate manifest.json + Component.js + i18n |
| Can we deploy it? | **Yes** — via `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` (NOT ADT filestore) |
| Can we create a tile? | **Out of scope** — guide user with SAP docs (BTP vs on-prem differs) |
| Do competitors do this? | **Nobody does end-to-end.** VSP has read-only BSP. SAP fiori-mcp-server generates but doesn't deploy. |
| Does the ADT filestore work for writes? | **No** — returns HTTP 405. Use ABAP_REPOSITORY_SRV instead. |
| What about on-prem vs BTP? | Both supported — ABAP_REPOSITORY_SRV available since SAP_UI 7.53 |

**Bottom line:** Phases 1-3 are fully feasible with proven SAP APIs. ARC-1 would be the **first MCP server** to offer end-to-end RAP + Fiori generation and deployment. The API reference document provides production-quality specs derived from SAP's own `@sap-ux/deploy-tooling` source code.
