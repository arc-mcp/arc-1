# BSP / UI5 Filestore read is wrongly disabled by a 404 feature probe

**Date:** 2026-06-24
**Area:** `SAPRead type=BSP` (UI5/Fiori filestore reads), feature probing
**Verdict:** ARC-1 bug — not user error. The `ui5` feature probe checks a handler-less
node that always 404s, so the long-running MCP server disables BSP reads even though the
feature works on every tested system. **Fix is a one-line endpoint change.**

## Symptom

User reports "BSP objects to read UI5 applications … it's not in there / I can't use it in
the test system." Through an MCP client (Claude Desktop / Copilot / Cursor pointed at the
long-running ARC-1 server), `SAPRead type=BSP` returns:

> UI5/Fiori BSP Filestore is not available on this SAP system. Run SAPManage(action="probe")
> to verify feature availability.

…even though deployed UI5 apps are present and readable.

## Root cause

`src/adt/features.ts` probes the `ui5` feature at the **bare** node:

```ts
{ id: 'ui5', endpoint: '/sap/bc/adt/filestore/ui5-bsp', description: 'UI5/Fiori BSP' },
```

That bare node has **no ADT handler** → returns `404`. `classifyFeatureProbeStatus(..., 404)`
maps 404 → `{ available: false, reason: 'endpoint not found (404) — ICF service not activated' }`
(`features.ts:481`). The resolved feature is cached at server startup
(`server.ts:365 probeFeatures` → `:388 setCachedFeatures`). The read handler then blocks:

```ts
// src/handlers/read.ts:673
case 'BSP': {
  if (cachedFeatures?.ui5 && !cachedFeatures.ui5.available) {
    return errorResult('UI5/Fiori BSP Filestore is not available on this SAP system. …');
  }
  ...
```

The actual collection that ARC-1's client uses for every BSP operation is
`/sap/bc/adt/filestore/ui5-bsp/**objects**` (`client.ts:1408/1419/1431`) — and **that** returns
`200`. So the feature is fully functional; only the probe URL is wrong. The probe's own
"ICF service not activated" message is misleading — the service is active.

### Why the CLI "works" but the server doesn't

`cachedFeatures` is a process-wide singleton, written only by the startup probe
(`feature-cache.ts`). A one-shot `arc1-cli call SAPRead --arg type=BSP` is a fresh process that
never probes, so `cachedFeatures` is `undefined`, the gate short-circuits, and BSP works. The
long-running MCP server probes once at startup and caches `ui5.available=false`, so every BSP
read is blocked. This is exactly why it looked like "doesn't work in the test system."

## Live evidence (verified content, not just status)

Raw `curl` (`-u MARIAN:…`, `Accept: application/atom+xml`):

| System (SAP_BASIS) | `GET /sap/bc/adt/filestore/ui5-bsp` | `GET …/ui5-bsp/objects` |
|---|---|---|
| a4h-2023 (758) | **404** | **200** — apps: `/UI2/C2GFLPPLUG`, `/UI2/LAUNCHPAGE`, `/UI2/RA_TEMPLATES`, `/UI2/TILECHIPS`, `/UI2/USHELL`, … |
| npl-750 (750)  | **404** | **200** — apps: `/UI2/LAUNCHPAGE`, `/UI2/TILECHIPS`, … |
| a4h-2025 (816) | **404** | **200** |

The 404→bare / 200→`/objects` split is **release-invariant** across 7.50, 7.58, and 8.16.

End-to-end through ARC-1 against a4h-2023:

```
$ node dist/cli.js call SAPManage --arg action=probe
  ui5     -> available:false  "UI5/Fiori BSP is not available — endpoint not found (404) — ICF service not activated"
  ui5repo -> available:true   "UI5 ABAP Repository Deploy is available"
  flp     -> available:true

$ node dist/cli.js call SAPRead --arg type=BSP        # CLI: no cached probe → gate skipped
  [ {"name":"/UI2/C2GFLPPLUG","description":"C2G Plugin for Fiori Launchpad"}, … ]   # WORKS
```

Confirms: probe says unavailable; the underlying read works.

### `BSP_DEPLOY` / `ui5repo` is fine

`ui5repo` probes `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV`, which returns `307 → 200` (trailing
slash redirect). `classifyFeatureProbeStatus` routes any non-2xx/401/403/404 to `available:true`,
and the redirect resolves to 200, so `ui5repo` is correctly `available:true`. No change needed.
(`$metadata` returns 406/403 by Accept negotiation, but the probe hits the service root, not
`$metadata`.)

## The fix

Point the `ui5` probe at the real collection (one line, `src/adt/features.ts`):

```ts
{ id: 'ui5', endpoint: '/sap/bc/adt/filestore/ui5-bsp/objects', description: 'UI5/Fiori BSP' },
```

`GET …/objects` returns 200 wherever the filestore exists (proven on 750/758/816) and 404 where
it genuinely doesn't — so the gate keeps its value (blocks only when truly absent) and stops
false-disabling a working feature.

Notes / non-changes:
- `HEAD /objects` returns `400` (size 0) — classified `available:true`, but the probe loop is
  GET-based; not worth special-casing.
- `?maxResults=1` is **ignored** by the filestore (body 106767 B with and without it), so the
  startup GET pulls the full app list (~104 KB on a4h). One-time, parallel with ~8 other startup
  probes — acceptable. `// ponytail:` if probe payload-at-scale ever matters, switch the whole
  probe loop to HEAD; don't special-case one entry.

## Immediate workaround (no rebuild)

Force the feature on, bypassing the broken probe — set in the ARC-1 server env:

```
SAP_FEATURE_UI5=on
```

(`config.ts:456` → `SAP_FEATURE_UI5`; `on` skips the probe and reports available.) BSP reads then
work against the live system today.

## Affected ARC-1 files

| File | Role |
|---|---|
| `src/adt/features.ts:42` | **the fix** — `ui5` probe endpoint |
| `tests/unit/adt/features.test.ts` | add regression test: ui5 probe hits `/objects`, not the bare node |
| `src/handlers/read.ts:673` | BSP/BSP_DEPLOY gate — clearer error (403-vs-404 causes + `SAP_FEATURE_UI5[_REPO]=on` override) |
| `src/adt/client.ts:1402–1435` | `listBspApps` / `getBspAppStructure` / `getBspFileContent` (already use `/objects`, correct) |

Adjacent, verified correct — no change: `xml-parser.ts` (`parseBspAppList`/`parseBspFolderListing`),
`ui5-repository.ts` (BSP_DEPLOY), `tool-registry.ts` BSP row, schemas/tools BSP+BSP_DEPLOY surface.

## How to use BSP once fixed (correct usage, for the user)

- `SAPRead type=BSP` (no name) → list deployed apps `[{name, description}]`
- `SAPRead type=BSP name=/UI2/USHELL` → browse the app's root file tree
- `SAPRead type=BSP name=/UI2/USHELL include=webapp` → browse a subfolder (no dot ⇒ folder)
- `SAPRead type=BSP name=/UI2/USHELL include=manifest.json` → read a file (has a dot ⇒ file)
- `SAPRead type=BSP_DEPLOY name=ZAPP` → OData metadata (name, package, description)

App names are uppercased server-side; folder listings are non-recursive.

## Cross-check: a field report blaming a "separate inactive ICF node"

An analysis from another system attributed the same bare-node 404 to a *distinct, inactive*
SICF service `…/adt/filestore/ui5-bsp` (parent `adt` green, child off; activate it, possibly
blocked by missing `S_ICF_ADM`). **That mechanism is wrong for how ADT works**, and it's
falsifiable — it never tested `/objects`. Live on a4h-2023, the bare-parent-404 is *universal*
across the whole ADT tree:

| Bare ADT parent | A real resource under it |
|---|---|
| `GET /sap/bc/adt/oo` → **404** | `…/oo/classes/cl_abap_typedescr/source/main` → **200** |
| `GET /sap/bc/adt/ddic` → **404** | `…/ddic/tables/t000` → **406** (handler exists; Accept mismatch) |
| `GET /sap/bc/adt/filestore` → **404**, `…/filestore/ui5-bsp` → **404** | `…/filestore/ui5-bsp/objects` → **200** |

`/sap/bc/adt` is a **single ICF node with one REST dispatcher**; `oo`, `ddic`,
`filestore/ui5-bsp` are internal routes, **not** separately-activatable SICF nodes. So the
bare-node 404 is the ARC-1 probe bug, not an inactive sub-node.

**Source reads work** — refuting "you cannot read BSP source files via arc-1 today." Live via
ARC-1's own code path (fixed build) against a4h-2023:

```
SAPRead type=BSP name=/UI2/USHELL                      → folder tree (chips/, i18n/, manifest.json, shells/)
SAPRead type=BSP name=/UI2/USHELL include=manifest.json → 3360 bytes of real JSON ("sap.app": { "id": "sap.ushell.flp", … })
```

What CAN legitimately make BSP unavailable on a given system/user:
- **403** — the ADT user lacks `S_ADT_RES` for the filestore (authorization, *not* ICF activation).
  After this fix the probe reports 403 with the right reason, and the read error now surfaces it.
- **404 on `/objects` itself** — the filestore resource is genuinely absent (very old / stripped
  systems). Unlikely wherever ADT is otherwise working. The deciding test on any system is
  `GET /sap/bc/adt/filestore/ui5-bsp/objects` (with the user's creds), never the bare node.

The field report's *backend-first* alternatives remain useful as a fallback (and when only a
read-only/limited user is available): `BSP_DEPLOY` (name/package/desc), `DEVC` (package contents),
`SRVB`/`SRVD`/`DDLX`/`DDLS` (Fiori Elements config lives here, not in BSP files), `SAPManage`
FLP catalog/tiles, plus the UI5 runtime URL `/sap/bc/ui5_ui5/sap/<APP>/manifest.json` and the Git
repo for custom extensions. (Unverified claim in that report: the program name
`RS_DOCU_ADT_ACTIVATE_ICF_NODES` — not confirmed; don't rely on it.)

### Read-error UX improvement (shipped with this fix)

`read.ts` BSP/BSP_DEPLOY gate errors now name the two real causes — **403** = the ADT user lacks
`S_ADT_RES` for the filestore (authorization, *not* ICF activation); **404** = the resource is
genuinely absent on that release — and point to `SAPManage(action="probe")` for the exact status
plus the `SAP_FEATURE_UI5[_REPO]=on` overrides. (Deliberately does *not* echo the probe's raw
`message`, whose shared "ICF service not activated" text is misleading for a single-REST-node 404.)

### End-to-end verification through the cached-feature gate

Replicating the exact server startup (`probeFeatures` → `setCachedFeatures`) then calling
`handleToolCall('SAPRead', …)` — i.e. the path the long-running MCP server uses, which the one-shot
CLI skips — against a4h-2023 after the fix:

```
PROBE   ui5.available = true
LIST    type=BSP                                  → app list (gate passes)
TREE    type=BSP name=/UI2/USHELL                 → folder tree
FILE    type=BSP name=/UI2/USHELL include=manifest.json → 3360 bytes of source
SUBDIR  type=BSP name=/UI2/USHELL include=i18n    → i18n/i18n.properties
```

All four BSP operations succeed through the cached gate — confirming the probe fix is the complete
fix for reading BSP going forward, not just a probe cosmetic.

## Open questions / follow-ups (out of scope for the fix)

- Probe payload at scale (switch loop to HEAD) — deferred, see ponytail note above.
- No live (non-mocked) test covers the actual filestore read path; all BSP tests are mocked.
  A single integration test that lists apps against a live system would catch a future
  contract drift. Deferred — not required for this fix.
