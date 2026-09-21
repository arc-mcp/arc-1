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

### Scope first

Reuse the scope resolved in the Default Path — do not hard-code `Z%`. Build the name filter from
what the user actually asked for: their prefixes (`Z*`, `Y*`), registered namespaces (`/NS/*`), the
object list, or `TADIR.DEVCLASS` for a package. A `Z%`-only filter silently drops `Y*` and every
namespaced object.

The `EDIPO*` tables (IDoc ports), `EDP13` (partner profiles) and `RFCDES` (destinations) are
**system-wide configuration** — they have no package or namespace to scope by. Ask before reading
them, report them as landscape context rather than as part of the scoped inventory, and skip them
entirely if the user declined deep evidence.

### Evidence (all read-only)

Default to `SAPRead(type="TABLE_QUERY")` — `data` scope, structured `where`, no user-written SQL.
**Always pass `columns`**: omitting it emits `SELECT *`, which on configuration tables pulls fields
the dossier has no business reading.

| Ask | Call | `columns` |
|---|---|---|
| Interface objects in scope | `TADIR`, `where` `PGMID = R3TR` + `OBJECT IN (…)` + scope filter | `OBJECT, OBJ_NAME, DEVCLASS` |
| RFC-enabled custom FMs | `TFDIR`, `where` `FMODE = 'R'` + scope filter (see below) | `FUNCNAME, PNAME` |
| Custom IDoc basic types | `EDBAS`, scope filter on `IDOCTYP` | `IDOCTYP, RELEASED` |
| IDoc → port binding | `EDP13` (outbound partner profiles) | `MESTYP, IDOCTYP, RCVPOR` |
| Port type per port | `EDIPORT` — the summary table for every port type; `PORTTYP` is domain `EDI_PORTYP` | `PORT, PORTTYP` |
| Destination behind an XML-HTTP port | `EDIPOXH` (`LOGDES` names the destination) | `PORT, LOGDES` |
| Outbound destinations | `RFCDES` — see the `RFCTYPE` codes below | `RFCDEST, RFCTYPE` **only** |
| Release contract state | `SAPRead(type="API_STATE", name="<obj>", objectType="<type>")` | — |

Never select `RFCDES.RFCOPTIONS` or `RFCOPTION1`…`RFCOPTIONV`. Those hold the packed connection
string including logon data; the dossier needs the destination name and type and nothing else.

The `OBJECT IN (…)` list is `IWPR IWSV IWSG IWMO SRVD SRVB EVTB EVTO IDOC SICF HTTP`.

**Code tables** (read from the system's own domains, not hard-coded assumptions):

| `EDIPORT.PORTTYP` (domain `EDI_PORTYP`) | `RFCDES.RFCTYPE` |
|---|---|
| `0` CPI-C · `1` transactional RFC · `2` SAPcomm | `3` RFC to ABAP system (TCP/IP) · `W` RFC via WebSockets |
| `3` File · `6` XML File | `H` HTTP to **ABAP system** · `G` HTTP to **external server** |
| `4` Internet · `5` ABAP programming interface · `7` XML HTTP | `T` external program · `I` same-database · `L` reference · `A` application |

Do not treat `H` as the only HTTP destination — outbound integrations to non-SAP endpoints are
type `G`, which is exactly the case that matters most here.

**One query per prefix.** `TABLE_QUERY` ANDs every `where` entry, so two `LIKE` conditions on the
same field match nothing — run `Z%`, `Y%` and each namespace separately and union client-side.
Results are capped at 10,000 rows: a partition returning **exactly** 10,000 must be reported as
truncated, not counted as complete. The type census is a count over the rows you fetched.

**Scoping TFDIR.** A function module's name does not encode its package, so `FUNCNAME LIKE` only
works for a *name-prefix* scope. For a package dossier, resolve the package's `FUGR` objects first
and match `TFDIR.PNAME` against them before checking `FMODE`. Build that program name correctly:
the namespace comes **first**, so function group `/NS/FOO` has main program `/NS/SAPLFOO` — not
`SAPL/NS/FOO`. Only a non-namespaced group `ZFOO` gives `SAPLZFOO`. Getting this backwards silently
returns zero rows for every namespaced group.

Only if the user chose **deep evidence** and free SQL is enabled, `SAPQuery` can do the census in one
grouped statement: `SELECT object, COUNT( * ) AS cnt FROM tadir WHERE pgmid = 'R3TR' AND obj_name
LIKE 'Z%' GROUP BY object ORDER BY cnt DESCENDING` — substituting the resolved scope for `'Z%'`.
This is an optimization, never a requirement.

The two gates are independent and **neither implies the other** — `SAPQuery` needs `sql` scope and
`SAP_ALLOW_FREE_SQL` (the tool is not even registered without it); `TABLE_QUERY` needs `data` scope
and `SAP_ALLOW_DATA_PREVIEW`. Instances exist with free SQL on and data preview off, and vice versa.

If neither is available there is no table-based fallback: `tadir_lookup` does not help, because
`source="db"`/`"both"` escalate to `sql` scope themselves and it resolves *exact names* rather than
discovering objects by type. Do this instead — `SAPRead(type="DEVC")` for each package in scope and
an ordinary `SAPSearch` object search per type, both best-effort — then mark the TADIR census,
legacy SEGW types, and all RFC/IDoc/destination coverage as unavailable. Do not guess.

One gotcha: `SAPRead(type="DEVC")` omits legacy SEGW types, so use TADIR for those (or
`tadir_lookup`, which needs `sql` scope and exact names). And supported contracts are per object
type (an `SRVD` exposes C0 only), so never report a single system-wide "share at C2".

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
| IDoc via HTTPS | **B** | `EDP13` → `EDIPORT.PORTTYP = 7` **plus** TLS confirmed on its destination |
| IDoc via RFC | **C** | `EDP13` → `EDIPORT.PORTTYP = 1` |
| ABAP proxy via XI | **C** | **not covered here** — no ADT evidence; check SPROXY / SXMB config |
| Flat file | **D** | `SAPSearch(searchType="source_code")` for `OPEN DATASET` |
| FTP | **D** | `source_code` search for `FTP_CONNECT` / `FTP_COMMAND` |
| SFTP, JDBC/ODBC | **D** | **not ABAP-detectable** — external tooling; ask, do not infer |
| RFC (ODP) | **Forbidden** | prohibited by the API policy (SAP Note 3255746) — flag on sight |

**IDoc levels need the port, and the port needs the partner profile.** `EDBAS` lists basic types and
`EDIPORT` lists ports, but neither links them — the outbound partner profile (`EDP13`) carries the
`RCVPOR` that binds a message/basic type to its receiver port. Read the type from
`EDIPORT.PORTTYP`, not from `EDIPO.PORTTYP` (verified empty on a live system that had a working
port) and not by guessing which `EDIPO*` table holds the row — `EDIPOF` is the ABAP programming
interface, not a file port. Without the full `EDP13` → `EDIPORT` join, report IDocs as **B/C
indeterminate**; never count them into a level.

`PORTTYP = 7` proves XML-over-HTTP, **not HTTPS**. The port only names a destination
(`EDIPOXH.LOGDES`); TLS is configured on that destination — commonly an `RFCTYPE = 'G'` entry — and
its SSL setting lives inside the `RFCDES` connection blob this skill refuses to read. So treat
XML-HTTP ports as *candidate* Level B and ask the user to confirm SSL in SM59 for that destination.
Do not infer TLS from the port, and do not parse `RFCOPTIONS` to find out.

`source_code` search needs SAP_BASIS 7.51+. On older ECC systems it is unavailable, so a clean
Level-D result there means "not searched", not "not present" — record it as an evidence gap.

The note rates the *technology*, and says the level for a given scenario is use-case dependent.
Report the level as SAP's default for that technology, not as a verdict on the interface.

### Output

**Count interfaces, not artifacts.** One integration is usually several objects: a RAP service is an
`SRVD` *and* an `SRVB`; an IDoc scenario is a basic type *and* a partner profile *and* a port; an
RFC interface is a function module *and* possibly a destination. Collapse each into one **interface
record** — `{ id, technology, level, evidence[] }` — and let the level distribution count those
records. Report raw artifact counts separately and label them as such; never add the two together.

Then add: the **integration-technology level distribution** (count of interface records per level),
the modernization candidates ranked B→A and C→B, and any Forbidden hit first. Do not label the
distribution an upgrade-stability metric — Note 3690029 deliberately excludes upgrade stability from
the level model because it depends on the underlying ABAP object's release state. Report that
separately from `API_STATE` and the Business Accelerator Hub. The common finding is SEGW/Gateway V2
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
extensibilityLevel: A | B | C | D | unknown   # Note 3578329 — which SAP APIs the code calls
integrationLevel:   A | B | C | D | FORBIDDEN | indeterminate   # Note 3690029 — interface technology
usageStatus: USED | LIKELY_UNUSED | UNUSED | INDETERMINATE
```

The two levels are independent axes and must never be merged into a single `cleanCoreLevel`. Most
cards carry only one of them: code objects get `extensibilityLevel`, interface records get
`integrationLevel`. `indeterminate` is the correct value for an IDoc whose port could not be
resolved — do not round it to B or C.

Final reviewed reports must exclude `ai_draft` cards unless explicitly labeled as drafts.

## Safety

- Do not run unscoped system-wide extraction.
- Do not use `SAPQuery` unless free SQL is enabled and the user chose deep evidence.
- Do not treat zero ATC findings as clean if the object is `$TMP` or ATC skipped it.
- Do not delete, update, activate, or transport objects from this skill.
- Do not publish AI-only assessments as final decisions unless explicitly labeled draft.
- State evidence gaps plainly instead of filling them with assumptions.
