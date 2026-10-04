---
name: bootstrap-system-context
description: Ground the assistant in the target SAP system before any coding work by producing a local system-info.md that captures SID, release, components, detected features, RAP constraints, and ARC-1 lint preset. Use when asked to "set up system context", "bootstrap the SAP system", "create system-info.md", or when starting a session against an unfamiliar SAP system.
---

# Bootstrap System Context

Ground the assistant in the target SAP system before any coding work. Produces a local `system-info.md` file that captures SID, release, installed components, detected features, RAP-relevant constraints, and ARC-1's active lint preset — so later prompts stop guessing at constraints.

Run this once per session when working against an unfamiliar system, or again after a system upgrade.

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Output path | `./system-info.md` | Sidecar to the project root |
| Overwrite | Yes, if file exists | Fresh probe results are authoritative |
| Probe features | Yes | Feature flags (RAP, UI5, transports) drive downstream decisions |
| Include lint preset | Yes | Cloud vs on-prem lint rules matter for generated code |
| Include RAP constraints snapshot | Yes | Helps RAP skills avoid known 7.5x pitfalls immediately |

## Input

No input required. Optionally:
- **Output path** (default: `./system-info.md`)
- **Skip feature probe** — if the user only wants identity info and the system is slow

## Step 1: Read System Identity

```
SAPRead(type="SYSTEM")
```

Returns: SID, system type (`onprem` | `btp`), release, kernel version, current user, client, language.

## Step 2: Read Installed Components

```
SAPRead(type="COMPONENTS")
```

Returns an array of `{ name, release, description }`. Capture at minimum: `SAP_BASIS`, `SAP_UI`, `SAP_ABA`, `SAP_GWFND`. These set the safe ABAP syntax ceiling and available APIs.

## Step 3: Probe Feature Availability

```
SAPManage(action="probe")
```

Returns feature flags for: `hana`, `abapGit`, `rap`, `amdp`, `ui5`, `ui5repo`, `transport`, `flp`. Each has `available` (bool), `mode`, and a `message`. These drive decisions like "can I generate a RAP stack?" or "is FLP catalog management wired in?"

If the user requested to skip this step, mark features as "not probed" in the output.

## Step 3b: Derive RAP Constraints Snapshot

Derive a compact RAP constraints block from release + probe + lint context. This is heuristic guidance for skill prompts, not a hard API contract.

Include at minimum:
- Is RAP creation likely viable (`rap.available`, plus whether DDLS/BDEF reads work)
- On-prem 7.5x guardrails (TABL typing pitfalls, projection BDEF header limits, DDLX annotation scope caveats)
- Whether pre-write lint likely covers DDLS only vs broader RAP artifacts
- Whether ARC-1 RAP preflight/scaffolding helpers should be the default path (`preflightBeforeWrite`, `scaffold_rap_handlers`)
- Whether draft should default to deferred/two-pass for safety

## Step 4: Read Lint Preset

```
SAPLint(action="list_rules")
```

Returns `{ preset, abapVersion, enabledRules, disabledRules, ... }`. The preset (`cloud` or `onprem`) reflects the system type detection; `abapVersion` is the target ABAP dialect (e.g., `v754`, `cloud`, `standard`). Generated code should stay within this dialect.

## Step 5: Write system-info.md

Create the file at the chosen path. Use exactly this layout:

```markdown
# System Info: <SID>

_Generated: <ISO timestamp>_ · _Source: ARC-1_

## Identity

| Field | Value |
|---|---|
| SID | <SID> |
| System type | <onprem / btp> |
| Release | <release> |
| Kernel | <kernel> |
| Client | <client> |
| Language | <lang> |
| User | <username> |

## Core Components

| Component | Release | Description |
|---|---|---|
| SAP_BASIS | <release> | <description> |
| SAP_UI | <release> | <description> |
| SAP_ABA | <release> | <description> |
| SAP_GWFND | <release> | <description> |
<additional rows for any other captured components>

## Feature Availability

| Feature | Available | Mode | Note |
|---|---|---|---|
| RAP / CDS | <yes/no> | <auto/on/off> | <message> |
| abapGit | <yes/no> | <auto/on/off> | <message> |
| HANA | <yes/no> | <auto/on/off> | <message> |
| AMDP | <yes/no> | <auto/on/off> | <message> |
| UI5 | <yes/no> | <auto/on/off> | <message> |
| UI5 Repository | <yes/no> | <auto/on/off> | <message> |
| Transports | <yes/no> | <auto/on/off> | <message> |
| FLP | <yes/no> | <auto/on/off> | <message> |

## Lint Configuration

- **Preset**: <cloud / onprem>
- **ABAP dialect**: <abapVersion>
- **Enabled rules**: <count>
- **Disabled rules**: <count>

## RAP Constraints Snapshot

- **RAP endpoint status**: <available / unavailable / not probed>
- **Recommended build mode**: <single-pass / two-pass>
- **TABL admin type guidance**: <syuname+timestampl on on-prem, abp_* on BTP>
- **Known projection BDEF caveat**: <e.g., use `projection;` header only on 7.5x>
- **Known DDLX scope caveat**: <e.g., headerInfo/search/objectmodel placement limits>
- **Lint coverage hint**: <ABAP+DDLS only / broader>
- **RAP helper path**: <`scaffold_rap_handlers` available / use quick-fix fallback>

## Coding Guidance

- Target ABAP dialect: **<abapVersion>** — do not use syntax beyond this level without verifying per object.
- System type is **<onprem / btp>**:
  - If `btp`: prefer released APIs (check with `SAPRead(type="API_STATE", ...)`); avoid non-cloud object types (PROG, INCL, FUGR).
  - If `onprem`: full type range available; still prefer released APIs for forward compatibility.
- Transports <enabled / disabled>: <if disabled, note that writes stay on `$TMP`>.
- RAP stack <available / not available>: <if not available, skip RAP generation skills>.
```

## Step 6: Summarize To The User

After writing the file, report in 3-5 lines:
- Which system was probed (SID, type, release)
- The ABAP dialect ceiling
- Which headline features are available (RAP, UI5, transports)
- Key RAP constraints (for example: two-pass recommendation or strict/draft cautions)
- File path written

Do not dump the full file contents into chat — the user can open the file.

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `SAPRead(type="SYSTEM")` fails with auth error | User lacks `S_ADT_RES` for discovery | Continue without identity block; note in output that SID is unknown |
| `SAPRead(type="COMPONENTS")` empty or 404 | Endpoint unavailable on this system | Note "components endpoint unavailable"; continue with probe + lint |
| `SAPManage(action="probe")` blocked (read-only mode with no `write` scope) | Safety config | Fall back to `SAPManage(action="features")` for cached results |
| `SAPLint(action="list_rules")` returns no preset | ARC-1 lint config not yet loaded | Report "lint preset: not configured"; still write the file |

## Notes

### When To Re-Run

- Starting work against a new or unfamiliar system
- After a support package upgrade (SAP_BASIS release changes)
- When features added (e.g., abapGit installed, RAP runtime enabled)
- When migrating from on-prem to BTP (or vice versa)

### What This Skill Does NOT Do

- **No source code is read** — identity/components/features only
- **No package enumeration** — use `setup-abap-mirror` or `SAPRead(type="DEVC")` for that
- **No SAP system-level configuration changes** — every call is read-only

### Pairing With Other Skills

- Run **before** `generate-rap-service-researched` — the researcher uses system-info.md to pick the right RAP pattern
- Run **before** `setup-abap-mirror` — the mirror skill references system-info.md in its header
- Run **before** `migrate-custom-code` — migration checks depend on knowing the target release
