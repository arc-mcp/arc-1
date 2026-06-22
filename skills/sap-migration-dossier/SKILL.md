---
name: sap-migration-dossier
description: Create practical ECC to S/4HANA custom-code migration dossiers for SAP packages, namespaces, object lists, or uploaded extracts. Use when asked to audit custom ABAP for S/4HANA readiness, create a shareable migration-readiness report, combine ATC + unused-code + clean-core evidence, classify user exits/BAdIs/enhancements/standard modifications, save results to Markdown/HTML/CSV/JSON, or visualize migration scope.
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

## When To Escalate

Use optional modes only when the user asks or the scope makes chat output impractical.

| User asks for | Do this |
|---|---|
| "save it", "share it", "dossier", "client report" | Create `docs/migration-dossiers/<scope>/<date>/` with `report.md` and optional `inventory.csv` |
| "HTML", "PDF", "dashboard" | Generate a self-contained `report.html`; mention it can be printed to PDF |
| "reviewed", "consultant validation", "not AI-only" | Create draft cards and include only validated/corrected cards in the final report |
| "graph", "visualize", "dependency map" | Generate a bounded Mermaid graph for the top risk/high-fanout objects |
| "deep ECC", "user exits", "BAdIs", "standard modifications" | Use deep evidence from `references/auditor-patterns.md`; only use `SAPQuery` when allowed |
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
