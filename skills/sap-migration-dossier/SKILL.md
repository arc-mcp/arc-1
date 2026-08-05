---
name: sap-migration-dossier
description: Create practical ECC to S/4HANA custom-code migration dossiers for SAP packages, namespaces, object lists, or uploaded extracts. Use when asked to audit custom ABAP for S/4HANA readiness, create a shareable migration-readiness report, combine ATC + unused-code + clean-core evidence, inventory integration interfaces (RFC, IDoc, SEGW/OData, destinations) for clean core integration, classify user exits/BAdIs/enhancements/standard modifications, save results to Markdown/HTML/CSV/JSON, or visualize migration scope.
---

# SAP Migration Dossier

Build a migration planning artifact, not a one-object fix workflow. Use this skill to combine the existing ARC-1 migration skills into a scoped dossier that is easy to start and can become more formal only when the user asks.

Default to a concise chat report. Offer files, review cards, HTML, CSV/JSON, and graphs as optional follow-ups; do not ask the user to design a reporting system up front.

Read `references/auditor-patterns.md` only when the user asks for persistent artifacts, human review, imported extracts, deep ECC enhancement extraction, integrity hashes, HTML dashboards, or graph output.

Use SAP Docs MCP when available, especially for Clean Core/API status, successor APIs, release-specific syntax, and migration guidance. If SAP Docs MCP is not connected, still run the dossier with ARC-1 evidence and list "SAP Docs MCP unavailable" as an evidence gap.

## Default Path

If the scope is clear, start immediately:

1. Resolve the scope.
   - Package: `SAPRead(type="DEVC", name="<package>")`
   - Prefix/namespace: `SAPSearch` per relevant type (`PROG`, `CLAS`, `FUGR`, `FUNC`, `DDLS`, `BDEF`, `SRVD`, `TABL`)
   - Object list: resolve ambiguous names with `SAPSearch`
   - Local extract: parse the file and state that evidence is imported, not live ARC-1
2. Build a small inventory: object, type, package, description, LOC when available, last change/version when available.
3. Add migration signals:
   - ATC: `SAPDiagnose(action="atc", type="<type>", name="<name>")`
   - Clean-core/API risk: reuse `sap-clean-core-atc` logic
   - SAP Docs MCP: enrich SAP API references with `sap_get_object_details`; use `search`/`fetch` for the top ATC themes or replacement guidance
   - Usage/retirement: reuse `sap-unused-code` only if SCMON/SUSG data is available
   - Dependencies/where-used: `SAPContext` or `SAPNavigate(action="references")`
4. Return a concise report with:
   - headline counts
   - highest-risk objects
   - likely retirement candidates
   - standard modification / enhancement hotspots
   - top ATC/Clean Core themes
   - clear evidence gaps
   - suggested next action

Ask only when required:
- If no scope is provided, ask for a package, namespace/prefix, or object list.
- If the scope is very large, ask whether to narrow it or save a file-based dossier.
- If the user wants customer-facing decisions, ask whether to use a human-reviewed flow.

## Integration Interfaces (Clean Core Integration)

Run this section when the user asks about interfaces, integration, RFC/IDoc/OData, "clean core
integration", or which interfaces block a cloud move. Skip it otherwise — the default path stays
about custom code.

This is a **different axis** from `sap-clean-core-atc`. That skill rates *extensibility* (SAP Note
3578329, which APIs your code calls). This section rates *integration technologies* (SAP Note
3690029, how systems talk to this one). Same A–D letters, different axis — SAP's own wording is that
the integration note "complements, but does not overlap with" the extensibility guidance.

### Evidence (all read-only)

| Ask | Call |
|---|---|
| What interface objects exist | `SAPQuery`: `SELECT object, COUNT( * ) AS cnt FROM tadir WHERE pgmid = 'R3TR' AND obj_name LIKE 'Z%' GROUP BY object ORDER BY cnt DESCENDING` |
| Names + package per type | same, filtered to `IWPR IWSV IWSG IWMO SRVD SRVB EVTB EVTO IDOC SICF HTTP` |
| RFC-enabled custom FMs | `SAPQuery`: `SELECT funcname, pname FROM tfdir WHERE fmode = 'R' AND funcname LIKE 'Z%'` |
| Custom IDoc basic types | `SAPQuery`: `SELECT idoctyp, released FROM edbas WHERE idoctyp LIKE 'Z%'` |
| IDoc port type (decides B vs C) | `SAPQuery`: `SELECT port, porttyp FROM edipo` |
| Outbound destinations | `SAPQuery`: `SELECT rfcdest, rfctype FROM rfcdes` — `3` = ABAP RFC, `H` = HTTP, `T` = TCP/IP |
| Release contract state | `SAPRead(type="API_STATE", name="<obj>", objectType="<type>")` |

Two gotchas: `SAPRead(type="DEVC")` omits legacy SEGW types, so use TADIR or
`SAPSearch(searchType="tadir_lookup", source="db")` for those. And the supported contracts are
per object type (an `SRVD` exposes C0 only), so never report a single system-wide "share at C2".

Table reads need `data` scope plus `SAP_ALLOW_DATA_PREVIEW` (or free SQL). Without them, run the
TADIR census alone and mark RFC/IDoc/destination coverage as an evidence gap — do not guess.

### Levels (SAP Note 3690029)

Abridged to what an ABAP system exposes. The note also covers BW extractors, SLT, Delta Share and
data products — out of ARC-1's reach, so list those as evidence gaps rather than omitting them.

| Technology | Level | ARC-1 evidence |
|---|---|---|
| Eventing via RAP (AMQP/MQTT) | **A** | TADIR `EVTB` / `EVTO`; `SAPRead(type="EVTB")` |
| OData via RAP service binding; CDS via service binding | **A** | TADIR `SRVB` + `SRVD` |
| HTTP(S) | **A** | TADIR `SICF` / `HTTP` (custom ICF nodes) |
| Web services via SOA Manager | **A** | not ADT-visible — confirm in SOAMANAGER |
| OData via SAP Gateway Service Builder (SEGW) | **B** | TADIR `IWPR` `IWSV` `IWSG` `IWMO` |
| BAPI via RFC; RFC (CPI-C); WebSocket RFC | **B** | `TFDIR.FMODE = 'R'`; `RFCDES.RFCTYPE = '3'` |
| IDoc via HTTPS | **B** | `EDBAS` + `EDIPO` port type |
| IDoc via RFC; ABAP proxy via XI | **C** | `EDBAS` + RFC port |
| Flat file, FTP, SFTP, JDBC/ODBC | **D** | `SAPSearch(searchType="source_code")` for `OPEN DATASET`, `FTP_` |
| RFC (ODP) | **Forbidden** | prohibited by the API policy (SAP Note 3255746) — flag on sight |

The note rates the *technology*, and says the level for a given scenario is use-case dependent.
Report the level as SAP's default for that technology, not as a verdict on the interface.

### Output

Add to the report: a count per level (this is SAP's "upgrade stability" KPI), the modernization
candidates ranked B→A and C→B, and any Forbidden hit first. The common finding is SEGW/Gateway V2
(**B**) alongside RAP V4 (**A**) — hand those to `migrate-segw-to-rap`. The other standard move is
IDoc via RFC (**C**) → RAP business events (**A**).

## When To Escalate

Use optional modes only when the user asks or the scope makes chat output impractical.

| User asks for | Do this |
|---|---|
| "save it", "share it", "dossier", "client report" | Create `docs/migration-dossiers/<scope>/<date>/` with `report.md` and optional `inventory.csv` |
| "HTML", "PDF", "dashboard" | Generate a self-contained `report.html`; mention it can be printed to PDF |
| "reviewed", "consultant validation", "not AI-only" | Create draft cards and include only validated/corrected cards in the final report |
| "graph", "visualize", "dependency map" | Generate a bounded Mermaid graph for the top risk/high-fanout objects |
| "deep ECC", "user exits", "BAdIs", "standard modifications" | Use deep evidence from `references/auditor-patterns.md`; only use `SAPQuery` when allowed |
| "interfaces", "integration", "RFC/IDoc/OData inventory", "clean core integration" | Run the Integration Interfaces section |
| "successor API", "released API", "what replaces this" | Use SAP Docs MCP `sap_get_object_details`, then `search`/`fetch` for guidance if needed |
| "will this syntax work on release X" | Use SAP Docs MCP `abap_feature_matrix` plus `search` with the right ABAP flavor |
| "fix this" | Switch to `migrate-custom-code` for selected findings; this skill should not mass-remediate |

## Output Shape

For chat output, keep it short:

```
Migration Dossier - <scope>

Scope: <n> objects, <types>, <packages>
Evidence: ATC=<variant/default>, docs=<SAP Docs MCP/unavailable>, usage=<SCMON/SUSG/unavailable>, clean-core=<source>, dependencies=<source>

Summary:
- <1-3 lines>

Priority objects:
| Object | Why it matters | Suggested action |

Retirement candidates:
| Object | Evidence | Caveat |

Main risks:
- <ATC/Clean Core/standard modification themes>

Evidence gaps:
- <missing usage data, skipped objects, dynamic calls, unavailable variants>

Next step:
- <one recommendation>
```

For file output, keep the default artifact set small:

```
docs/migration-dossiers/<scope>/<date>/
  report.md
  inventory.csv
  methodology.md
```

Add `report.html`, `cards.jsonl`, `reviews.jsonl`, `graph.mmd`, or `dashboard.html` only when requested.

## Review Rules

Use a human review gate only for customer-facing or decision-grade reports.

Statuses:

```
ai_draft | validated | corrected | skipped | ai_error
```

Classifications:

```
REMOVE | KEEP | ADAPT | COVERED_BY_STANDARD | UNDETERMINED
```

Keep these separate from the decision:

```
cleanCoreLevel: A | B | C | D | unknown
usageStatus: USED | LIKELY_UNUSED | UNUSED | INDETERMINATE
```

Final reviewed reports must exclude `ai_draft` cards unless explicitly labeled as drafts.

## Safety

- Do not run unscoped system-wide extraction.
- Do not use `SAPQuery` unless free SQL is enabled and the user chose deep evidence.
- Do not treat zero ATC findings as clean if the object is `$TMP` or ATC skipped it.
- Do not delete, update, activate, or transport objects from this skill.
- Do not publish AI-only assessments as final decisions unless explicitly labeled draft.
- State evidence gaps plainly instead of filling them with assumptions.
