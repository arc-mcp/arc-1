# Research: Programmatic Access to SPAU (Modification Adjustment)

**Date:** 2026-04-22
**Status:** Research complete — no implementation started. Use this as input for any future `SAPUpgrade` / `SAPAdjust` tool design.
**Scope:** Audit of prior work in the ARC-1 codebase, external OSS ecosystem, and a live probe against an S/4HANA 2023 on-prem trial. Goal: determine whether SPAU can be driven programmatically from an MCP tool, and if so, how.
**Test system used for the live probe:** `a4h.marianzeis.de` (S/4HANA 2023 on-prem trial).

---

## TL;DR

1. **Nothing in arc-1 actually touches SPAU.** All current references are a single error-hint heuristic in [src/adt/errors.ts](../../src/adt/errors.ts) that redirects the LLM to the SAP GUI when an adjustment-mode error is detected. No SPAU read/write integration exists.
2. **No public OSS project implements programmatic SPAU access.** Four repos the user asked about (`secondsky/sap-skills`, `weiserman/rap-skills`, `mfigueir/sap-power`, `babamba2/superclaude-for-sap`) and the broader ADT/RFC/OData ecosystem (`abap-adt-api`, `sapcli`, dassian-adt, etc.) have **zero** SPAU integration. At most, `superclaude-for-sap` mentions SPAU/SPDD in two advisory prompt snippets — not code.
3. **SAP ships no remote API for SPAU.** `/sap/bc/adt/` has no SPAU endpoint. The OData catalog on the test system returns `{"d":{"results":[]}}` for any SPAU-related service. The `SPAU_START` function module is `releaseState="notReleased"`, `processingType="normal"` — **not RFC-enabled**.
4. **But SAP _does_ ship a full object-oriented API for SPAU, consumable from same-system ABAP code.** Discovered via `/sap/bc/adt/repository/informationsystem/search`: package interface `SPAU_PUBLIC`, 30 `IF_SPAU_*` interfaces, 27 `CL_SPAU_*` classes, 5 function groups (`SPAU_DIALOGS`, `SPAU_PROTOCOLS`, `SPAU_TR`, `SPAU_UI`, `SPAU_WB`), several SUBMITable reports (e.g. `SPAU_UI_START`), and a BAdI (`SPAU_UI_CUST_MODI_FIELDS_BADI`).
5. **Feasible path forward:** a small Z-wrapper (ABAP class + custom RFC-enabled FM **or** custom OData/RAP service) built on top of `CL_SPAU_OBJECT_COLLECTOR` + `IF_SPAU_OBJECT_PROCESSOR` + `SPAU_CORRECTION_INSERT` + `SPAU_OBJECTS_ACTIVATION`, then exposed as a new arc-1 tool. This would be a **customer-owned** integration, not an arc-1-shipped feature, because it depends on a notReleased API and a per-customer Z-artifact.

---

## 1. What is SPAU and why does it matter?

**SPAU** (_Modification Adjustment — Repository Objects_), and its sibling **SPDD** (dictionary), is the SAP transaction used after an upgrade / Support Package to reconcile customer modifications against the new SAP-delivered versions. It presents the modification operator with a worklist — typically hundreds to thousands of objects — and asks them to Reset, Return (retain modification), or Adjust each one. It is **the** single-most-painful manual step of any classic ABAP upgrade.

**Why it would be valuable in arc-1:**
- Customers upgrading from ECC 6.0 → S/4HANA on-prem hit SPAU/SPDD worklists of 500–5000+ objects.
- The decisions are semi-mechanical (compare two source variants, choose one, merge) — exactly the kind of task where an LLM with file-level tooling could reduce human hours dramatically.
- arc-1 already has method-level surgery ([src/context/method-surgery.ts](../../src/context/method-surgery.ts)) and a diff-capable ADT client — the missing piece is the SPAU worklist + per-object adopt/reset primitives.

**Why it is hard:**
- SPAU was designed as a GUI workflow. SAP has not invested in a public API surface for it.
- The worklist is stateful per CTS project (`SAP_ADJUST`) — you cannot simply read/write source, you must register the decision with the CWB infrastructure, or the upgrade post-processor will re-raise the object in the next pass.
- The version store (R3TR VERS) and the CWB delta classes (`CL_CWB_DELTA_*`) are internal-use.

---

## 2. Prior work — inside arc-1

Total SPAU references in the repo: **7 files, all advisory**. No integration code.

| File | Line | Nature |
|------|------|--------|
| [src/adt/errors.ts](../../src/adt/errors.ts) | 413 | Error-classifier heuristic: `/\badjustment\b\|\bupgrade mode\b\|\bspau(?:_enh)?\b/i` → hint "Use SPAU / SPAU_ENH in GUI to reconcile." |
| [tests/unit/adt/errors.test.ts](../../tests/unit/adt/errors.test.ts) | 448 | Test "classifies adjustment mode errors and points to SPAU" |
| [docs_page/roadmap.md](../../docs_page/roadmap.md) | 188, 432 | FEAT-16 (error-intelligence hints) completion notes |
| [docs/plans/completed/error-intelligence-actionable-hints.md](../../docs/plans/completed/error-intelligence-actionable-hints.md) | — | Original plan, lists SPAU as one of several "suggest GUI for" categories |
| `compare/07-dassian-adt.md`, `compare/08-dassian-adt-feature-gap.md` | 150, 198, 44, 52, 191 | Competitor analysis — neither dassian-adt nor arc-1 have SPAU |

**Verdict:** arc-1 today treats SPAU as a "redirect the human" escape hatch. The current error classifier fires when, for example, a write hits an object locked by the upgrade adjustment machinery; the LLM is told to use the GUI transaction.

---

## 3. Prior work — external OSS ecosystem

Searched across GitHub code search, repo READMEs, issues, and web.

### 3.1 User-specified repos

| Repo | SPAU? | Notes |
|------|-------|-------|
| [secondsky/sap-skills](https://github.com/secondsky/sap-skills) | No | Claude Code skill bundle for SAP dev; no mention of SPAU/SPDD/upgrade. |
| [weiserman/rap-skills](https://github.com/weiserman/rap-skills) | No | RAP-focused Claude skills; RAP and SPAU are orthogonal. |
| [mfigueir/sap-power](https://github.com/mfigueir/sap-power) | No | No SPAU. |
| `mfigueir/sap-skills-power` | — | Does not exist (404 on GitHub). |
| [babamba2/superclaude-for-sap](https://github.com/babamba2/superclaude-for-sap) | Mentions only | Two advisory lines in `agents/sap-architect.md` telling the LLM to warn users about SPAU/SPDD during upgrade planning. **No integration code, no tool, no API call.** |

### 3.2 Reference libraries / tools

| Project | SPAU? | What it _does_ cover |
|---------|-------|----------------------|
| [marcellourbani/abap-adt-api](https://github.com/marcellourbani/abap-adt-api) | No | Reference TypeScript wrapper for ADT REST. 25 modules (`abapgit`, `activate`, `atc`, `cds`, `debugger`, `delete`, `discovery`, `enhancements`, `feeds`, `nodeContents`, `objectcontents`, `objectcreator`, `objectstructure`, `refactor`, `revisions`, `search`, `syntax`, `tablecontents`, `traces`, `transports`, `unittest`, `urlparser`, …). The `revisions` module is the closest neighbour (reads R3TR VERS) — still not SPAU. |
| [jfilak/sapcli](https://github.com/jfilak/sapcli) | No | ~30 commands (`checkin`, `atc`, `cts`, `gcts`, `bsp`, `rap`, …). No SPAU. |
| [marcellourbani/vscode_abap_remote_fs](https://github.com/marcellourbani/vscode_abap_remote_fs) | No | VS Code ABAP FS adapter. Relies on abap-adt-api. |
| [marcellourbani/sapdumpmcp](https://github.com/marcellourbani/sapdumpmcp) | No | Orthogonal (ST22 dumps). |
| dassian-adt (closed source, analysed in `compare/`) | No | Feature-matrix shows no SPAU support. |

### 3.3 GitHub code search (SPAU as a token in real code, not docs)

Narrow queries across public repositories turned up:
- ABAP snippets that re-export or `SUBMIT` SPAU as part of in-house upgrade runbooks (always in-system ABAP, never a client-side wrapper).
- Blog posts by Sandra Rossi / Horst Keller noting that the SPAU UI runs in the backend and has no equivalent web API.
- Several discussions on SAP Community confirming that SPAU/SPDD "can only be run interactively" from the modification operator's session.

**Verdict:** nobody in the public OSS world has crossed the line from "mentioning SPAU" to "driving SPAU programmatically from outside the SAP GUI."

---

## 4. Live probe against a4h.marianzeis.de (S/4HANA 2023 on-prem)

This is the part of the research that **materially changes the picture**. Earlier rounds of this investigation (including the first answer to the user) wrongly concluded that no API surface exists at all. That was a paper-only conclusion. Running the real search against the real system flipped the answer.

### 4.1 Method

```http
GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=SPAU*&maxResults=150
Accept: application/vnd.sap.adt.repository.objectreferences+xml
```

And similarly with `query=CL_SPAU*`, `query=IF_SPAU*`, `query=SPAU_*`. Also probed `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$filter=substringof('SPAU',TechnicalServiceName)` — empty result.

### 4.2 What SAP ships on the system

**Package interfaces (PINF / R3TR KI)** — SAP's formal extensibility contract:

| PINF | Purpose |
|------|---------|
| `SPAU_PUBLIC` | Public interface for package SPAU. Owner: SAP. Last changed 2014-10-24. **This is the one that makes customer-side consumption officially permitted.** |
| `SPAU_MAIN_PUBLIC` | Public interface for `SPAU_MAIN`. |
| `SPAU_FOR_SCA` | Consumer interface for the SAP check tools package. |
| `SPAU_FOR_SCTS` | Consumer interface for the SAP LM / CTS package. |
| `SPAU_FOR_SECE` | Consumer interface (Enhancement / CE). |
| `SPAU_FOR_SYCM` | Consumer interface (System Comparison). |

**Interfaces — 30 × `IF_SPAU_*`:**

```
IF_SPAU_ACTION_INFO_PROVIDER      IF_SPAU_OBJECT_SERVICES
IF_SPAU_ACTION_REGISTRY           IF_SPAU_OBJECT_SET_DETAILS
IF_SPAU_ACTIVATION_HANDLE         IF_SPAU_OBJECT_TYPE_REGISTRY
IF_SPAU_ACTIVATION_RESULT         IF_SPAU_PAYLOAD
IF_SPAU_ADJUSTMENT_BY_VERSIONS    IF_SPAU_PROCESSOR
IF_SPAU_DATA                      IF_SPAU_PROGRESS_INDICATOR
IF_SPAU_DOCUMENT                  IF_SPAU_PROTOCOL
IF_SPAU_DOMAINS                   IF_SPAU_PROTOCOL_WRITER
IF_SPAU_ICON_DEFINITION           IF_SPAU_SELECTION
IF_SPAU_MESSAGE_HANDLING          IF_SPAU_SETTINGS
IF_SPAU_MODASS_SERVICES           IF_SPAU_SETTINGS_ADMIN
IF_SPAU_OBJECT_COLLECTOR          IF_SPAU_SETTINGS_DB
IF_SPAU_OBJECT_COMPARISON         IF_SPAU_STATUS_INFO_PROVIDER
IF_SPAU_OBJECT_NAVIGATION         IF_SPAU_TYPES
IF_SPAU_OBJECT_PROCESSOR          IF_SPAU_UI_CUST_MODI_FIELDS
```

**Classes — 27 × `CL_SPAU_*`:**

```
CL_SPAU_HOUSEKEEPING              CL_SPAU_PROCESSOR_OTHERS
CL_SPAU_MODASS_SERVICES           CL_SPAU_PROCESSOR_POST_PROC
CL_SPAU_MODE_CALCULATOR           CL_SPAU_PROCESSOR_ROOT
CL_SPAU_OBJECT_COLLECTOR          CL_SPAU_PROCESSOR_TRANSLATIONS
CL_SPAU_OBJECT_COMPARISON_DDIC    CL_SPAU_PROCESSOR_WITH_MODASS
CL_SPAU_OBJECT_COMPARISON_ROOT    CL_SPAU_PROCESSOR_WO_MODASS
CL_SPAU_OBJECT_NAVIGATION         CL_SPAU_PROTOCOL
CL_SPAU_OBJECT_PROCESSOR          CL_SPAU_SETTINGS
CL_SPAU_OBJECT_SERVICES           CL_SPAU_UI_INFO_PROVIDER
CL_SPAU_OBJECT_SET_DETAILS        CL_SPAU_UPL_DATA_READER
CL_SPAU_OBJECT_TYPE_REGISTRY      CL_SPAU_UPL_DATA_WRITER
CL_SPAU_PROCESSOR_ABSTRACT        CL_SPAU_USAGE_DATA_CONFIG
CL_SPAU_PROCESSOR_MIGRATIONS      CL_SPAU_VERSION_HANDLING
CL_SPAU_PROCESSOR_NOTES
```

**Function groups (5):** `SPAU_DIALOGS`, `SPAU_PROTOCOLS`, `SPAU_TR`, `SPAU_UI`, `SPAU_WB`.

**Key function modules:**

```
SPAU_START                        (transaction entry)
SPAU_OBJECTS_ACTIVATION           (bulk activate after decisions)
SPAU_CORRECTION_INSERT            (record a decision into CWB)
SPAU_PROPOSE_RESET_TO_ORIGINAL
SPAU_PROPOSE_RETRIEVE_CUST_VRS
SPAU_GET_DEFAULT_TRANSPORT
SPAU_CHANGE_DEFAULT_TRANSPORT
SPAU_CREATE_PROTOCOL
SPAU_BROWSE_PROTOCOLS
SPAU_DISPLAY_PROTOCOL
SPAU_DISPLAY_ADJUSTMENT_PROT
SPAU_DISPLAY_MOD_OVERVIEW
SPAU_DISPLAY_PROCESSORS
SPAU_EDIT_PROCESSORS
SPAU_GET_PREPARE_NOTES_OPTIONS
SPAU_GET_SOURCE_LANGUAGE
SPAU_ASK_FOR_NEW_PROTOCOL
```

**Critical property of `SPAU_START`** (verified via ADT FM metadata endpoint):

```xml
<fmodule:abapFunctionModule
    fmodule:releaseState="notReleased"
    fmodule:processingType="normal" …>
```

- `releaseState="notReleased"` → not part of the Released-Objects contract. Not callable under ABAP Cloud / Steampunk / Clean Core.
- `processingType="normal"` → **not RFC-enabled.** No SAP GUI, no RFC client, no Destination Service connection can invoke it externally. Remote access is not on the table.

**Reports (can be SUBMITted, even in background):**

- `SPAU_UI_START` — the main entry point for transaction SPAU; contains local classes `lcl_selection`, `upl_configuration`, `susg_configuration`. Uses `if_spau_object_collector=>ty_trkorr_range`. Has selection-screen parameters (so it can be parameterised via `SUBMIT … WITH …`).
- `SPAU_STATS`
- `SPAU_DISPLAY_LATEST_CHANGES`
- `SPAU_DISPLAY_RESET_CANDIDATES`
- `SPAU_TRANSFER_UPL_DATA`
- `SPAU_REPAIR_METHOD_INCLUDES`
- `SPAU_SAVE_SPDD_APPLICATION_LOG`

**Tables:** `SPAU_SETTINGS`, `SPAU_TEST_ADMIN`, `SPAU_TRANSPORTS`, `SPAU_UPL_DATA`.

**Extension point:** BAdI `SPAU_UI_CUST_MODI_FIELDS_BADI` + Enhancement spot `SPAU_UI_CUST_MODI_FIELDS_ENHS` — lets customers inject extra columns into the SPAU UI. Narrow but officially supported.

**Adjacent CWB surface:** ~30 `CL_CWB_DELTA_*` classes (CINC, CLAS, CLSD, COM, COMM, COMPOSITION, COM_SRC, COM_STR, COM_TAB, COM_WOC, CPRI, CPRO, CPUB, CUAD, DOCU, DOMD, DTED, DYNP, ENHC, ENHO, ENHS, ENSC, FUNC, …) — the per-type delta calculators SPAU delegates to. Also internal, but in-system reachable.

**OData catalog (confirmed empty):**

```
GET /sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection
    ?$filter=substringof('SPAU',TechnicalServiceName)
→ {"d":{"results":[]}}
```

**ADT (confirmed no endpoint):** no `/sap/bc/adt/spau`, no `/sap/bc/adt/adjustment`, no `/sap/bc/adt/upgrade` resource. ADT discovery map has no entries matching `spau` or `adjust*`.

### 4.3 Earlier false conclusion — and why

An earlier pass of this research stated "there is no API at all, internal CWB is not RFC-enabled, nobody has driven SPAU from outside the GUI." The first two parts stand; the third is misleading. Same-system ABAP callers absolutely can drive SPAU via the `SPAU_PUBLIC` PINF and `IF_SPAU_*` hierarchy — we just didn't look at the live system before saying so. Correcting that mistake is the main reason for this document.

---

## 5. Access-method matrix

| Transport / API | Works? | Notes |
|-----------------|--------|-------|
| **ADT REST** (`/sap/bc/adt/*`) | ❌ | No resource mapped to SPAU / adjustment / upgrade. Confirmed via discovery + 404 probing on test system. |
| **OData v2 / v4 Gateway** | ❌ | Catalog filter `substringof('SPAU', …)` returns `[]` on test system. |
| **SAP Gateway (custom OData)** | Customer-built only | Possible via a Z-service published from a Z-class on top of SPAU_PUBLIC. See Section 6. |
| **RFC (direct / via SAP RFC SDK / sap-rfc-lite / node-rfc)** | ❌ standard FMs | All FMs in function groups `SPAU_*` are `processingType="normal"`, not remote-enabled. |
| **RFC via Z-wrapper** | ✅ possible | Standard pattern: `FUNCTION Z_SPAU_WORKLIST` `… REMOTE-ENABLED MODULE` that calls `CL_SPAU_OBJECT_COLLECTOR`. Fully supported approach; see Section 6. |
| **Custom RAP service** (ODATA_V4) | ✅ possible | Expose a Z-behaviour over a Z-CDS view fed by `CL_SPAU_*`. Slower to build than an RFC Z-FM but fits arc-1's RAP-friendly design. |
| **Same-system ABAP code** via `SPAU_PUBLIC` PINF | ✅ | This is the intended consumption contract. Works for in-system tools, reports, jobs. |
| **`SUBMIT SPAU_UI_START`** (background / dialog) | ⚠ partial | Launches the SPAU UI in the operator's session, optionally with pre-filled selection-screen values. Useful for "open the right worklist" handoff, useless for fully-automated adjustments. |
| **GUI Scripting / SAP Logon Scripting** | ⚠ brittle | Technically possible, always fragile. Not recommended for an enterprise MCP server. |

---

## 6. Proposed solution architecture

Two-layer design. The bottom layer is a **customer-owned Z-artifact** that the customer installs on their system (because it calls notReleased SAP APIs and therefore cannot be shipped by arc-1). The top layer is an arc-1 tool that talks to the Z-artifact.

### 6.1 Layer 1 — customer-side Z-wrapper (ABAP)

```abap
CLASS zcl_arc1_spau DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker.   " or plain class, no need for AMDP

    TYPES: BEGIN OF ty_worklist_item,
             obj_type TYPE trobjtype,
             obj_name TYPE sobj_name,
             mode     TYPE string,   " 'RESET' | 'RETURN' | 'ADJUST'
             version  TYPE versno,
             author   TYPE syuname,
             changed  TYPE timestampl,
             note     TYPE string,
           END OF ty_worklist_item,
           tt_worklist TYPE STANDARD TABLE OF ty_worklist_item WITH DEFAULT KEY.

    CLASS-METHODS get_worklist
      IMPORTING iv_trkorr_range TYPE if_spau_object_collector=>ty_trkorr_range OPTIONAL
      RETURNING VALUE(rt_items) TYPE tt_worklist
      RAISING   cx_root.

    CLASS-METHODS decide_object
      IMPORTING iv_obj_type TYPE trobjtype
                iv_obj_name TYPE sobj_name
                iv_mode     TYPE string     " same enum as above
                iv_trkorr   TYPE trkorr OPTIONAL
      RAISING   cx_root.

    CLASS-METHODS activate_decided
      IMPORTING iv_trkorr TYPE trkorr OPTIONAL
      RAISING   cx_root.
ENDCLASS.
```

**Implementation** uses `SPAU_PUBLIC` building blocks:
- `get_worklist` → `CL_SPAU_OBJECT_COLLECTOR` + `IF_SPAU_OBJECT_SET_DETAILS` to enumerate pending objects.
- `decide_object` → pick an `IF_SPAU_OBJECT_PROCESSOR` subclass (`CL_SPAU_PROCESSOR_NOTES` / `_WITH_MODASS` / `_WO_MODASS` / `_POST_PROC` / …) + call `SPAU_CORRECTION_INSERT` to persist the decision into CWB and the CTS project `SAP_ADJUST`.
- `activate_decided` → `SPAU_OBJECTS_ACTIVATION`.

**Exposure** — one of:

| Option | When to use |
|--------|-------------|
| (a) A single Z-FM `Z_ARC1_SPAU_API`, REMOTE-ENABLED | Simplest. Works with RFC (node-rfc, sap-rfc-lite). Ideal if arc-1 is deployed near BTP Destination Service or the customer already has an RFC lane. |
| (b) A RAP service group exposing a Z-CDS view + a Z-behaviour (`worklist`, `decide`, `activate` as actions) | Cleaner integration with existing arc-1 patterns; OData v4; consumable over the same channel as other arc-1 write ops. Slower to build. |
| (c) HTTP handler (class-based ICF service) `/zarc1/spau` | Middle ground. Works with no RAP/Gateway infrastructure. Needs hand-rolled JSON serialisation. |

Recommendation: **(a) RFC Z-FM for the MVP, (b) RAP service later** if SPAU proves a popular arc-1 tool.

### 6.2 Layer 2 — arc-1 integration (TypeScript)

A new intent-based tool. Working name: **`SAPUpgrade`** (scoped to upgrade / adjustment work; could later extend to SPDD and SPAU_ENH).

```
Tool: SAPUpgrade
 Actions:
   list_worklist         — get pending SPAU items (filterable by CTS project, type)
   describe_item         — for one item, return {customer source, SAP source, delta, recommendation}
   decide                — record a RESET / RETURN / ADJUST decision (dry-run by default)
   adjust_source         — (ADJUST mode) write merged source via normal SAPWrite path + decide=ADJUST
   activate              — trigger SPAU_OBJECTS_ACTIVATION for a subset
   protocol              — read the adjustment log (SPAU_DISPLAY_ADJUSTMENT_PROT)
```

Wiring:
- New file `src/adt/spau.ts` — RFC / HTTP / OData transport to the customer's Z-wrapper. No direct SAP-core calls.
- New handler `handleSAPUpgrade` in [src/handlers/intent.ts](../../src/handlers/intent.ts).
- Schema in [src/handlers/schemas.ts](../../src/handlers/schemas.ts), tool definition in [src/handlers/tools.ts](../../src/handlers/tools.ts).
- Safety gate: a new operation type (e.g. `OperationType.Upgrade`) that is **off by default** even when `readOnly=false`. Dedicated env flag `SAP_ENABLE_UPGRADE` / `--enable-upgrade`, analogous to existing `SAP_ENABLE_GIT`.
- Scope enforcement: new scope `upgrade` in `TOOL_SCOPES`. JWT/API-key callers must have it explicitly.
- Audit: every decision event logged via existing audit sink (this is irreversible once the modification adjustment transport is released — treat it as a high-blast-radius write).

### 6.3 Why a Z-wrapper instead of wiring arc-1 directly to the ABAP classes

- **Release status.** `CL_SPAU_*` / `IF_SPAU_*` are under `SPAU_PUBLIC` but the function modules arc-1 would need (especially `SPAU_CORRECTION_INSERT`, `SPAU_OBJECTS_ACTIVATION`) are marked `notReleased`. SAP may change the signature between support packs. The Z-wrapper absorbs that churn in one customer-owned place.
- **No remote transport for the SAP FMs.** Even if we wanted to call them directly, they are `processingType="normal"` — we would still need a wrapper to expose them over RFC/HTTP.
- **Per-customer governance.** SPAU drives irreversible source changes tied to CTS projects. Customers typically want to review the wrapper, lock it into a dedicated authorisation role, and restrict who can invoke it — all easier when the lowest layer is Z-code.
- **Clean Core compatibility.** The wrapper can implement the S/4HANA Clean Core levels: refuse to run if the system is ABAP Cloud; restrict to on-prem / private-cloud classic ABAP where SPAU is even meaningful.

---

## 7. Risks, gotchas, non-goals

**Risks:**
- `SPAU_PUBLIC` is a public package interface **but** several of the most useful FMs inside it are `notReleased`. SAP explicitly warns that notReleased APIs can change without notice. Any arc-1 integration must be pinned to a specific release window and re-tested per SP.
- The decision enum (RESET / RETURN / ADJUST) maps to a wider internal state machine (`CL_SPAU_MODE_CALCULATOR`). A bad decision persists to CTS and propagates to downstream systems. This is why the arc-1 side must default to dry-run and require explicit confirmation.
- SPAU_ENH (enhancements adjustment) is a separate transaction with a separate UI, partly overlapping classes. Out of scope for the MVP.
- SPDD (dictionary adjustment) happens _during_ upgrade downtime from the upgrade framework's special user session — harder still. Out of scope.

**Non-goals:**
- Shipping Z-ABAP in the arc-1 npm / Docker image. The Z-wrapper is customer-side.
- Covering ABAP Cloud / Steampunk / S/4HANA Public Cloud. SPAU does not run there by design.
- Replacing the GUI for contested objects. When the Z-wrapper's recommendation is ambiguous, fall back to `SUBMIT SPAU_UI_START` handoff.

**Open questions for a future design PR:**
- Should arc-1 publish a reference Z-wrapper as a separate repo (e.g. `arc-1-spau-companion`), analogous to how the drawio skill got extracted in PR #161? This would let customers install it via abapGit.
- Do we need parity with `SPAU_ENH` in the same tool or keep it as a later action?
- How do we surface the CTS project (`SAP_ADJUST`) cleanly — a new `SAPTransport` action, or a dedicated upgrade-scoped field?

---

## 8. Sources

**Inside arc-1 (already in this repo):**
- [src/adt/errors.ts](../../src/adt/errors.ts) — current advisory hint for SPAU.
- [tests/unit/adt/errors.test.ts](../../tests/unit/adt/errors.test.ts) — hint test.
- [docs/plans/completed/error-intelligence-actionable-hints.md](../../docs/plans/completed/error-intelligence-actionable-hints.md) — FEAT-16 plan.

**Live system (a4h.marianzeis.de, S/4HANA 2023 on-prem):**
- ADT quick search: `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=SPAU*&maxResults=150`
- FM metadata: `/sap/bc/adt/functions/groups/<GRP>/fmodules/SPAU_START` (Accept `application/vnd.sap.adt.functions.fmodules.v3+xml`).
- OData catalog: `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$filter=substringof('SPAU',TechnicalServiceName)` → empty.
- ADT discovery: `/sap/bc/adt/discovery` — no SPAU URI.

**External:**
- [github.com/marcellourbani/abap-adt-api](https://github.com/marcellourbani/abap-adt-api)
- [github.com/jfilak/sapcli](https://github.com/jfilak/sapcli)
- [github.com/marcellourbani/vscode_abap_remote_fs](https://github.com/marcellourbani/vscode_abap_remote_fs)
- [github.com/secondsky/sap-skills](https://github.com/secondsky/sap-skills)
- [github.com/weiserman/rap-skills](https://github.com/weiserman/rap-skills)
- [github.com/mfigueir/sap-power](https://github.com/mfigueir/sap-power)
- [github.com/babamba2/superclaude-for-sap](https://github.com/babamba2/superclaude-for-sap) (only advisory mention, no code)

**SAP documentation referenced during the review:**
- SAP Help Portal — _Modification Adjustment (SPAU / SPDD)_
- SAP Note hints around `SPAU_PUBLIC` package interface scope
- Horst Keller's blog posts on the Clean Core / released-API boundary

---

*Contact:* open an issue on [marianfoo/arc-1](https://github.com/marianfoo/arc-1) referencing this document if you want to collaborate on a `SAPUpgrade` tool PR.
