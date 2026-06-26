# API Reference: UI5 App Deployment to ABAP

This document provides the exact API specifications needed to implement Fiori app deployment in ARC-1, based on deep analysis of SAP's `@sap-ux/deploy-tooling` (`@sap-ux/axios-extension`) source code.

## Two APIs, Two Purposes

| API | Path | Purpose | Read | Write |
|-----|------|---------|------|-------|
| **ABAP Repository OData** | `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` | Deploy/undeploy UI5 apps | Yes | **Yes** |
| **ADT Filestore** | `/sap/bc/adt/filestore/ui5-bsp` | Browse deployed app files | Yes | **No (HTTP 405)** |

The ABAP Repository service is the **primary deployment API** — it accepts a base64-encoded ZIP of the entire webapp. The ADT Filestore is read-only and useful for verifying deployments or reading individual files.

---

## Part 1: ABAP Repository OData Service

**Base path:** `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV`
**Available since:** SAP_UI 7.53
**Authorization:** `S_DEVELOP` authorization object

### 1.1 Get App Info

Check if a BSP app exists and retrieve its metadata.

```
GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{appName}')
Accept: application/json
Query: $format=json
```

**Response (200):**
```json
{
  "d": {
    "Name": "ZAPP_BOOKING",
    "Package": "ZPACKAGE",
    "Description": "Manage Bookings",
    "Info": "",
    "ZipArchive": ""
  }
}
```

**Response (404):** App does not exist.

### 1.2 Download App Files

Retrieve the deployed webapp as a base64-encoded ZIP.

```
GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{appName}')
Accept: application/json
Query: $format=json&CodePage=UTF8&DownloadFiles=RUNTIME
```

**Response (200):** Same as above, but `ZipArchive` contains the base64-encoded ZIP.

**Note:** Requires ABAP 2308 or newer.

### 1.3 Deploy New App (POST)

Create a new BSP application with all webapp files.

```
POST /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories
Content-Type: application/atom+xml; type=entry; charset=UTF-8
X-Csrf-Token: {token}
Accept: application/json,application/xml,text/plain,*/*

Query parameters (always):
  CodePage='UTF8'
  CondenseMessagesInHttpResponseHeader=X
  format=json

Query parameters (optional):
  TransportRequest={DEVK900123}
  TestMode=true
  SafeMode=false
```

**Request body:** Atom XML (see Section 1.5)

### 1.4 Update Existing App (PUT)

Update an existing BSP application. Same payload as POST.

```
PUT /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{encodeURIComponent(appName)}')
Content-Type: application/atom+xml; type=entry; charset=UTF-8
X-Csrf-Token: {token}

Query parameters: same as POST
```

**Important:** The package cannot be changed on update. If the app exists, use the existing package from `getInfo()`, not the config package. Log a warning if the user tries to change it.

### 1.5 Atom XML Payload

```xml
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
       xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
       xml:base="{serviceBaseUrl}">
  <id>{serviceBaseUrl}/Repositories('{xmlEscape(appName)}')</id>
  <title type="text">Repositories('{xmlEscape(appName)}')</title>
  <updated>{new Date().toISOString()}</updated>
  <category term="/UI5/ABAP_REPOSITORY_SRV.Repository"
            scheme="http://schemas.microsoft.com/ado/2007/08/dataservices/scheme"/>
  <link href="Repositories('{xmlEscape(appName)}')" rel="edit" title="Repository"/>
  <content type="application/xml">
    <m:properties>
      <d:Name>{xmlEscape(appName)}</d:Name>
      <d:Package>{packageName.toUpperCase()}</d:Package>
      <d:Description>{xmlEscape(description)}</d:Description>
      <d:ZipArchive>{zipBuffer.toString('base64')}</d:ZipArchive>
      <d:Info/>
    </m:properties>
  </content>
</entry>
```

**XML escaping map:**
```typescript
const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '"': '&quot;', "'": '&apos;', '<': '&lt;', '>': '&gt;'
};
```

**Fields:**
| Field | Value | Notes |
|-------|-------|-------|
| `d:Name` | BSP app name | XML-escaped |
| `d:Package` | ABAP package | **Uppercased** |
| `d:Description` | Description | XML-escaped. Default: `"Deployed with ARC-1"` |
| `d:ZipArchive` | Base64-encoded ZIP | The entire webapp as a ZIP buffer |
| `d:Info` | Empty | Self-closing element |

### 1.6 Delete App (DELETE)

```
DELETE /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/Repositories('{encodeURIComponent(appName)}')
X-Csrf-Token: {token}

Query parameters:
  CodePage='UTF8'
  CondenseMessagesInHttpResponseHeader=X
  format=json
  TransportRequest={TR}  (optional)
  TestMode=true           (optional)
```

### 1.7 CSRF Token Flow

SAP's deploy-tooling does **NOT** use a separate HEAD request for CSRF. Instead:

1. The first GET request (`getInfo()`) includes header `X-Csrf-Token: Fetch`
2. The response includes header `x-csrf-token: {token}` (lowercase)
3. Store the token and send it on all subsequent write requests
4. Also capture all `set-cookie` response headers and send them back

For ARC-1, we can either:
- Reuse our existing CSRF mechanism (`src/adt/http.ts` uses HEAD to `/sap/bc/adt/core/discovery`)
- Or piggyback on the first GET to the OData service

Since `/sap/opu/odata/` is a different path from `/sap/bc/adt/`, we may need a **separate CSRF token** for this service. The ADT CSRF token may not be valid for OData services.

### 1.8 Deploy Workflow (Complete)

```
1. GET /Repositories('{appName}') → check existence
   - Also fetches CSRF token (X-Csrf-Token: Fetch header)
   - 200 = app exists (use PUT to update)
   - 404 = new app (use POST to create)

2. Build ZIP from webapp files → base64-encode

3. Build Atom XML payload with app name, package, description, ZIP

4. POST or PUT with payload
   - Include CSRF token
   - Include transport if non-$TMP package

5. Parse response:
   - sap-message header (JSON) contains success/error details
   - Log messages from details array

6. App is live at: /sap/bc/ui5_ui5/sap/{appName.toLowerCase()}?sap-client={client}
```

### 1.9 Error Handling

| Status | Context | Behavior |
|--------|---------|----------|
| **401** | Any | Auth failure — credentials invalid |
| **403** | TestMode | Expected — response body has validation details |
| **404** | GET info | App doesn't exist — use POST to create |
| **408** | POST/PUT | Timeout — retry (max 3 attempts) |
| **412** | POST/PUT | SafeMode conflict — app has different `sap.app/id`. Retry with `SafeMode=false` after confirmation |
| **504** | POST/PUT | Gateway timeout — retry (max 3 attempts) |
| **400** | DELETE | Transient error — retry once |

**Retry logic for timeout (408/504):**
```
Attempt 1: POST or PUT (based on getInfo result)
Attempt 2: Re-check getInfo → POST or PUT (timeout may have partially created app)
Attempt 3: Re-check getInfo → POST or PUT
Attempt 4: Throw error
```

**SafeMode 412 handling:**
SAP returns 412 when the deployed BSP's `sap.app/id` (from manifest.json) doesn't match the new ZIP's `sap.app/id`. This prevents accidental overwrites. To force overwrite, resend with `SafeMode=false`.

### 1.10 Response Message Parsing

**Success** — `sap-message` response header (JSON string):
```json
{
  "code": "200",
  "message": "Repository ZAPP_BOOKING imported successfully",
  "longtext_url": "/sap/.../LongText",
  "details": [
    { "code": "200", "message": "Created object ...", "severity": "info" }
  ]
}
```

**Error** — response body (JSON):
```json
{
  "error": {
    "code": "005056A509B11EE1B...",
    "message": { "lang": "en", "value": "Error message text" },
    "innererror": {
      "transactionid": "...",
      "timestamp": "...",
      "errordetails": [
        { "code": "...", "message": "...", "severity": "error" }
      ]
    }
  }
}
```

### 1.11 TestMode and SafeMode

| Parameter | Purpose | Default |
|-----------|---------|---------|
| `TestMode=true` | Backend validates without deploying. Returns 403 with details. | false |
| `SafeMode=true` | Prevents overwriting BSP with different `sap.app/id`. Returns 412 on conflict. | true (server default) |
| `SafeMode=false` | Force overwrite regardless of `sap.app/id` mismatch. | — |

---

## Part 2: ADT Filestore (Read-Only)

**Base path:** `/sap/bc/adt/filestore/ui5-bsp/objects`
**ADT Discovery:** `scheme: 'http://www.sap.com/adt/categories/filestore'`, `term: 'filestore-ui5-bsp'`

The ADT discovery XML also reveals two additional collections:
- `ui5-rt-version` at `/sap/bc/adt/filestore/ui5-bsp/ui5-rt-version` — UI5 runtime version
- `ui5-deploy-storage` at `/sap/bc/adt/filestore/ui5-bsp/deploy-storage` — deploy storage marker

### 2.1 Feature Detection

```
HEAD /sap/bc/adt/filestore/ui5-bsp
```
- **200 or 405** → UI5 filestore is available
- **404** → UI5 filestore not available (SICF service not activated)

VSP uses OPTIONS instead of HEAD — both work.

### 2.2 List/Search BSP Applications

```
GET /sap/bc/adt/filestore/ui5-bsp/objects
Accept: application/atom+xml
Query: name={pattern}&maxResults={n}
```

The `name` parameter supports wildcards: `Z*`, `*DEMO*`, etc. Returns Atom XML feed where each `<entry>` represents a BSP app:
- `<atom:title>` → app name (e.g., `ZTESTAPP`)
- `<atom:summary>` → description
- `<atom:id>` → URI

### 2.3 Get App Structure (Files/Folders)

```
GET /sap/bc/adt/filestore/ui5-bsp/objects/{encodeURIComponent(appName)}/content
Accept: application/xml
Content-Type: application/atom+xml
```

Returns Atom XML feed of files and folders. **NOT recursive** — only returns immediate children. To get a full tree, recursively query each subfolder.

**Response example (root listing):**
```xml
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"
           xml:base="/sap/bc/adt/filestore/ui5-bsp/objects/">
  <atom:id>ZTESTAPP</atom:id>
  <atom:title>ZTESTAPP</atom:title>

  <!-- FILE entry -->
  <atom:entry>
    <atom:category term="file"/>
    <atom:content xmlns:afr="http://www.sap.com/adt/afr"
                  afr:etag="20230112203908"
                  type="application/octet-stream"
                  src="./ZTESTAPP%2fComponent.js/content"/>
    <atom:id>ZTESTAPP%2fComponent.js</atom:id>
    <atom:title>ZTESTAPP/Component.js</atom:title>
    <atom:link href="https://host/sap/bc/ui5_ui5/sap/ZTESTAPP/component.js?..."
               rel="execute" type="application/http"/>
  </atom:entry>

  <!-- FOLDER entry -->
  <atom:entry>
    <atom:category term="folder"/>
    <atom:content type="application/atom+xml;type=feed"
                  src="./ZTESTAPP%2fi18n/content"/>
    <atom:id>ZTESTAPP%2fi18n</atom:id>
    <atom:title>ZTESTAPP/i18n</atom:title>
  </atom:entry>
</atom:feed>
```

**File vs folder detection:** `<atom:category term="file"/>` vs `<atom:category term="folder"/>`

**File metadata:**
- `afr:etag` — timestamp (format `YYYYMMDDHHMMSS`), useful for cache validation
- `content.src` — URL to fetch the file content
- `link[rel="execute"]` — browser-accessible URL for the file (dev-mode)

### 2.4 List Subfolder Contents

```
GET /sap/bc/adt/filestore/ui5-bsp/objects/{encodeURIComponent(appName + '/' + subPath)}/content
Accept: application/xml
Content-Type: application/atom+xml
```

Example for i18n subfolder: `GET .../objects/ZTESTAPP%2fi18n/content`

**Critical:** The slash between app name and path is **percent-encoded** (`%2f`), not a literal slash. The entire combined path is a single URL segment. Nested paths are doubly encoded: `ZTESTAPP%2fi18n%2fi18n.properties`.

### 2.5 Get File Content

```
GET /sap/bc/adt/filestore/ui5-bsp/objects/{encodeURIComponent(appName + '/' + filePath)}/content
Accept: application/xml
Content-Type: application/octet-stream
```

Returns **raw file content** (no XML wrapping). The `Content-Type` header distinguishes file requests from folder requests:
- `application/octet-stream` → file content (raw bytes)
- `application/atom+xml` → folder listing (Atom XML feed)

### 2.6 URL Encoding Pattern

This is the trickiest part. The path uses `encodeURIComponent()` on the combined `appName + path`:

```typescript
// Correct:
const url = `/objects/${encodeURIComponent(appName + filePath)}/content`;
// Produces: /objects/ZTESTAPP%2fwebapp%2findex.html/content

// WRONG:
const url = `/objects/${encodeURIComponent(appName)}/${filePath}/content`;
// Would produce: /objects/ZTESTAPP/webapp/index.html/content (404)
```

The `filePath` should start with `/` when non-empty:
```typescript
if (filePath && !filePath.startsWith('/')) {
  throw new Error('filePath must start with /');
}
```

### 2.7 Atom XML Parsing

Use `fast-xml-parser` with namespace removal:
```typescript
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseAttributeValue: true,
  attributeNamePrefix: ''
});
```

**Important:** When a folder contains exactly one entry, `parsed.feed.entry` is a **single object**, not an array. Always normalize:
```typescript
const entries = Array.isArray(parsed.feed.entry)
  ? parsed.feed.entry
  : parsed.feed.entry ? [parsed.feed.entry] : [];
```

Extract file info:
```typescript
const node = {
  name: entry.title.split('/').pop(),           // "Component.js"
  path: entry.title.substring(appName.length),  // "/Component.js"
  type: entry.category.term,                    // "file" | "folder"
  etag: entry.content?.['afr:etag'],            // "20230112203908" (files only)
};
```

### 2.8 Summary of Read Operations

| Operation | Method | Path | Content-Type | Response |
|-----------|--------|------|-------------|----------|
| List apps | GET | `/objects?name={pattern}&maxResults={n}` | — | Atom feed of apps |
| List folder | GET | `/objects/{encodeURIComponent(app+path)}/content` | `application/atom+xml` | Atom feed of entries |
| Get file | GET | `/objects/{encodeURIComponent(app+path)}/content` | `application/octet-stream` | Raw file content |

### 2.9 API Quirks Summary

- App names are **uppercased** by the server
- Directory listing is **NOT recursive** (immediate children only)
- Path separator `/` must be **percent-encoded** (`%2f`) as part of a single path segment
- Leading slashes must be **stripped** from file paths before combining with app name
- Single entry responses are an **object, not array** — must normalize
- Write operations (POST, PUT, DELETE) return **HTTP 405 Method Not Allowed**
- `afr:etag` format is `YYYYMMDDHHMMSS` (useful for caching/change detection)
- Response is **Atom XML feed** format
- File paths are encoded as `APPNAME%2FFILEPATH` (slash → %2F)
- Write operations (POST, PUT, DELETE) return **HTTP 405 Method Not Allowed**

---

## Part 3: Transport Handling for UI5 Deployments

### 3.1 Transport Check

Determine available transport requests for a UI5 app deployment.

**Endpoint:** Resolved via ADT Discovery catalog
**ADT Category:** `scheme: 'http://www.sap.com/adt/categories/cts'`, `term: 'transportchecks'`

```
POST {endpoint-from-discovery}
Accept: application/vnd.sap.as+xml; dataname=com.sap.adt.transport.service.checkData
Content-Type: application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData
```

**Payload:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
    <asx:values>
        <DATA>
            <PGMID/>
            <OBJECT/>
            <OBJECTNAME/>
            <DEVCLASS>{packageName}</DEVCLASS>
            <SUPER_PACKAGE/>
            <OPERATION>I</OPERATION>
            <URI>/sap/bc/adt/filestore/ui5-bsp/objects/{encodeURIComponent(appName)}/$create</URI>
        </DATA>
    </asx:values>
</asx:abap>
```

**Response parsing:**
- `<RESULT>` with status `S` → success
  - `<RECORDING>` without `<LOCKS>` → new project, returns all `<REQ_HEADER>` entries
  - `<LOCKS>` present → existing project, returns locked transport from `<LOCKS>//REQ_HEADER`
- `<RESULT>` with status `E` → error (check `<CTS_MESSAGE>` elements)
- `<DLVUNIT>` = `LOCAL_PACKAGE` / `LOCAL` / `ZLOCAL` → local package, no transport needed

**Transport fields:** `TRKORR` (number), `AS4USER` (owner), `AS4TEXT` (description), `CLIENT`, `TARSYSTEM`

### 3.2 Transport Create

Create a new transport request for UI5 app deployment.

**ADT Category:** `scheme: 'http://www.sap.com/adt/categories/cts'`, `term: 'transports'`

```
POST {endpoint-from-discovery}
Accept: text/plain
Content-Type: application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest
```

**Payload:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
    <asx:values>
        <DATA>
            <OPERATION>I</OPERATION>
            <DEVCLASS>{packageName}</DEVCLASS>
            <REQUEST_TEXT>{description}</REQUEST_TEXT>
            <REF>/sap/bc/adt/filestore/ui5-bsp/objects/{appName}/$create</REF>
        </DATA>
    </asx:values>
</asx:abap>
```

**Response:** Plain text: `/com.sap.cts/object_record/{TRANSPORT_NUMBER}`
Strip prefix to extract transport number.

**Auto-generated description:** `"For ABAP repository {appName}, created by ARC-1"` (max 60 chars).

### 3.3 When Transport is Needed

| Package | Transport Required? |
|---------|-------------------|
| `$TMP` | **No** — local package, no transport |
| `ZLOCAL` / `LOCAL` | **No** — local development package |
| Any other | **Yes** — transport request mandatory |

ARC-1 already has transport management in `src/adt/transport.ts`. The existing `listTransports`, `createTransport`, `releaseTransport` can be reused. The only new piece is the transport check XML with the `<URI>` pointing to the filestore path.

---

## Part 4: ZIP Archive Creation

### 4.1 What Goes in the ZIP

The ZIP contains the webapp files at the **root level** (no parent `webapp/` folder):

```
manifest.json
Component.js
i18n/
  i18n.properties
index.html            (optional — FLP sandbox launcher)
```

### 4.2 How SAP Creates the ZIP

SAP uses `adm-zip` (npm package):

```typescript
import ZipFile from 'adm-zip';

function createArchive(files: Map<string, Buffer>): Buffer {
  const zip = new ZipFile();
  for (const [path, content] of files) {
    zip.addFile(path, content);
  }
  return zip.toBuffer();
}
```

For ARC-1, since we generate the files in memory (not from disk), we'd use:
```typescript
const zip = new AdmZip();
zip.addFile('manifest.json', Buffer.from(manifestJson, 'utf8'));
zip.addFile('Component.js', Buffer.from(componentJs, 'utf8'));
zip.addFile('i18n/i18n.properties', Buffer.from(i18nProps, 'utf8'));
const archive = zip.toBuffer();
const base64 = archive.toString('base64');
```

### 4.3 Exclude Patterns

SAP's deploy-tooling supports exclude patterns (regex) in `ui5-deploy.yaml`:
```yaml
exclude:
  - /test/
  - /localService/
```

For ARC-1, since we generate the files ourselves, we control what goes in the ZIP. No exclude mechanism needed.

---

## Part 5: App URL After Deployment

```
/sap/bc/ui5_ui5/sap/{appName.toLowerCase()}?sap-client={client}
```

For namespaced apps (starting with `/`):
```
/sap/bc/ui5_ui5{appName.toLowerCase()}
```

Example: App `ZAPP_BOOKING` on client 100:
```
https://sap-host:443/sap/bc/ui5_ui5/sap/zapp_booking?sap-client=100
```

---

## Part 6: Differences from ARC-1's Existing ADT HTTP Client

| Aspect | ADT APIs (`/sap/bc/adt/`) | ABAP Repository (`/sap/opu/odata/`) |
|--------|--------------------------|-------------------------------------|
| Base path | `/sap/bc/adt/` | `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` |
| Protocol | REST (custom XML) | OData V2 (Atom XML + JSON) |
| CSRF source | HEAD `/sap/bc/adt/core/discovery` | Piggyback on first GET |
| Response format | XML (various content types) | JSON (with `$format=json`) |
| Payload format | Various (text, XML) | Atom XML entry |
| Cookie scope | Same domain | Same domain (shared cookies) |

**Implementation approach:** Since both APIs are on the same SAP host, they share the same authentication, cookies, and session. ARC-1's existing HTTP client can be extended to make requests to `/sap/opu/odata/` paths. However, the CSRF token may need to be fetched separately for the OData service.

**Recommended:** Add a new method to `src/adt/http.ts` (or a new `src/adt/odata.ts`) that:
1. Uses the same undici fetch, cookies, and auth as the ADT client
2. Fetches a CSRF token from the OData service (via `X-Csrf-Token: Fetch` on first GET)
3. Constructs Atom XML payloads for write operations
4. Parses OData V2 JSON responses

---

## Part 7: Feature Detection

### Detect ABAP Repository Service Availability

```
HEAD /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV
```
- **200** → Service available
- **401/403** → Service exists but auth issue
- **404** → Service not available (SAP_UI < 7.53 or SICF not activated)

### Detect UI5 Version on Target System

**Primary method (recommended): SAP_UI component mapping**

ARC-1 already fetches `/sap/bc/adt/system/components` at startup. Extract the `SAP_UI` component release and map to the UI5 LTS version:

```typescript
const SAP_UI_TO_UI5: Record<string, string> = {
    '816': '1.136.0',    // FES 2025 for S/4HANA, EOM Q4/2032
    '758': '1.120.0',    // FES 2023 for S/4HANA, EOM Q4/2030
    '757': '1.108.0',    // FES 2022 for S/4HANA, EOM Q4/2030
    '756': '1.96.0',     // FES 2021 for S/4HANA, EOM Q4/2026
    '755': '1.84.0',     // FES 2020 (out of maintenance)
    '754': '1.71.0',     // Fiori FES 6.0, EOM Q4/2030
    '753': '1.60.0',     // Fiori FES 5.0 (out of maintenance)
};
```

This mapping is stable — SAP_UI versions are fixed releases. It only changes when SAP ships a new SAP_UI version (~annually). Source: `https://ui5.sap.com/versionoverview.json`.

Always use `.0` patch level (e.g., `1.120.0` not `1.120.17`) — `minUI5Version` is a minimum requirement.

For BTP systems (detected via `SAP_CLOUD` component), default to `1.136.0` (latest LTS). UI5 on BTP is loaded from CDN, not from the ABAP server.

**Fallback method (less reliable):**

```
GET /sap/public/bc/ui5_ui5/bootstrap_info.json
```

Response:
```json
{ "Version": "1.120.0" }
```

Not available on BTP ABAP Environment (UI5 loaded from CDN) and not always present on-premise. Use only as fallback.

**External reference endpoint:**

```
GET https://ui5.sap.com/versionoverview.json
```

Returns JSON with `activeVersion`, plus an array of all UI5 versions with `sapuiversion` (SAP_UI component version), `lts` flag, `support` status, and `eom`/`eocp` dates. Can be used to build/update the mapping dynamically at build time.

### Detect ATO Settings (Cloud vs On-Prem)

```
GET /sap/bc/adt/ato/settings
Accept: application/*
```

Returns XML with `operationsType`: `C` (Cloud) or `P` (Premise). Useful for determining if transport is required and which development package to use.

---

## Part 8: Fiori Elements App Generation via `@sap/generator-fiori`

### 8.1 Overview

Instead of generating manifest.json/Component.js templates in-memory (fragile, version-sensitive), ARC-1 uses SAP's official `@sap/generator-fiori` package in **headless mode**. This is the same approach used by SAP's own `@sap-ux/fiori-mcp-server`.

**Package:** `@sap/generator-fiori` (public npm, Apache-2.0, ~10 MB)
**Mechanism:** Shell out to `npx -y yo@4 @sap/fiori:headless <config.json> --force --skipInstall`
**Output:** Complete Fiori Elements project; only `webapp/` subfolder is ZIPped for deployment

### 8.2 Headless Config JSON (Version 0.2)

The config `version` field **must be `"0.2"`** — validated, throws on mismatch.

**Minimal config for a RAP LROP app with CDS annotations:**

```json
{
    "version": "0.2",
    "floorplan": "FE_LROP",
    "project": {
        "name": "zbooking-app",
        "description": "Booking Management",
        "targetFolder": "/tmp/fiori-gen-abc123",
        "ui5Version": "1.120.0",
        "sapux": true
    },
    "service": {
        "host": "https://my-sap:443",
        "servicePath": "/sap/opu/odata4/sap/zsb_booking/srvd_a2x/sap/zsd_booking/0001/",
        "client": "100",
        "edmx": "<?xml version=\"1.0\"?><edmx:Edmx Version=\"4.0\" xmlns:edmx=\"http://docs.oasis-open.org/odata/ns/edmx\">...</edmx:Edmx>"
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

**Important fields:**

| Field | Required | Constraints |
|-------|----------|-------------|
| `version` | Yes | Must be `"0.2"` |
| `floorplan` | Yes | Enum key: `"FE_LROP"`, `"FE_FPM"`, `"FE_OVP"`, `"FE_ALP"`, `"FE_FEOP"`, `"FE_WORKLIST"`, `"FF_SIMPLE"` |
| `project.name` | Yes | `/^[a-z0-9-]+$/` — lowercase + dashes only, no underscores |
| `project.targetFolder` | Yes | Absolute path — generator creates `{name}/` subfolder here |
| `project.sapux` | Yes | `true` for all FE floorplans, `false` only for `FF_SIMPLE` |
| `project.description` | Recommended | Used in package.json + i18n |
| `project.ui5Version` | Recommended | Defaults to latest if omitted; set from SAP_UI mapping |
| `service.edmx` | Yes (FE) | Full EDMX XML string — throws `Missing required property: edmx` without it |
| `service.host` | Yes | SAP system URL |
| `service.servicePath` | Yes | OData service path |
| `entityConfig.mainEntity.entityName` | Yes (FE) | EntitySet name from EDMX |
| `entityConfig.generateFormAnnotations` | No | Default `true`. Set `false` when CDS DDLX handles annotations |
| `entityConfig.generateLROPAnnotations` | No | Default `true`. Set `false` when CDS DDLX handles annotations |

### 8.3 EDMX Metadata Acquisition

The generator needs the full OData EDMX XML. ARC-1 fetches it from the published service binding.

**OData V4 (typical for RAP):**
```
GET /sap/opu/odata4/sap/{service_binding_name}/srvd_a2x/sap/{service_definition_name}/0001/$metadata
Accept: application/xml
```

**OData V2:**
```
GET /sap/opu/odata/sap/{service_binding_name}/$metadata
Accept: application/xml
```

The service URL pattern and OData version are available from `getSrvb()` which returns `odataVersion`, `serviceDefinition`, and other metadata. The service must be published first (`publishServiceBinding()`).

### 8.4 Generated Output

```
{project.name}/
├── package.json               # Not needed for deployment
├── ui5.yaml                   # Not needed for deployment
├── ui5-local.yaml             # Not needed for deployment
├── README.md                  # Not needed for deployment
├── .gitignore                 # Not needed for deployment
└── webapp/                    # ← ZIP this folder for deployment
    ├── manifest.json          # Routing, datasource, models, FLP config
    ├── Component.js           # ~6 lines (extends sap/fe/core/AppComponent)
    ├── i18n/
    │   └── i18n.properties    # appTitle, appDescription
    └── test/
        └── flpSandbox.html    # FLP sandbox
```

Only the `webapp/` folder contents go into the ZIP archive for ABAP deployment. Files must be at the ZIP root level (no `webapp/` parent folder in the archive).

### 8.5 ARC-1 Integration Flow

```
1. Read SRVB metadata (getSrvb) → get odataVersion, serviceDefinition
2. Detect UI5 version from SAP_UI component → e.g., "1.120.0"
3. Fetch $metadata EDMX from published service
4. Read projection CDS entity → get main entity name
5. Derive project.name from BSP name (lowercase + dashes: "ZAPP_BOOKING" → "zapp-booking")
6. Build headless config JSON
7. Write config to temp file
8. Run: npx -y yo@4 @sap/fiori:headless config.json --force --skipInstall
9. ZIP contents of {targetFolder}/{project.name}/webapp/ using adm-zip
10. Deploy ZIP via ABAP_REPOSITORY_SRV (POST or PUT)
11. Cleanup temp directory
12. Return app URL: /sap/bc/ui5_ui5/sap/{bspName.toLowerCase()}?sap-client={client}
```

### 8.6 Error Handling

| Scenario | Generator Behavior | ARC-1 Should |
|----------|-------------------|--------------|
| Config version wrong | `Error('App config version mismatch, supported: 0.2')` | Hard-code `"0.2"`, never hits |
| Missing EDMX | `Error('Missing required property: edmx')` | Always provide — validate before calling |
| Invalid project.name | Validation error | Validate `/^[a-z0-9-]+$/` before calling |
| Folder exists (no --force) | `Error('A folder already exists')` | Always use `--force` |
| npx not found | ENOENT process error | Check Node.js available, report to user |
| First run delay | ~30-60s (downloads yo + @sap/generator-fiori ~100MB) | Warn user in skill, not a code issue |
| Generator crash | Exit code 1, error on stderr | Parse stderr, return to user |

### 8.7 Gotchas

1. **`project.name` must be lowercase-dashes** — ABAP names like `ZAPP_BOOKING` won't work as project names. Derive: `zapp-booking`. The BSP name for deployment remains uppercase.
2. **`floorplan` uses enum keys** — `"FE_LROP"` not `"lrop"`
3. **First run is slow** (~30-60s) — npx downloads Yeoman + `@sap/generator-fiori`. Subsequent runs are fast (cached).
4. **Only `webapp/` gets ZIPped** — not the root project folder
5. **EDMX must be the full XML document** — not a subset
6. **`service.host` should be HTTPS** — the generator validates this for OData projects
7. **Yeoman version pinned to v4** — `yo@4` specifically (fiori-mcp-server pins this)
8. **Timeout consideration** — add a timeout guard (~120s) for the npx process; first run can be slow but shouldn't hang indefinitely
