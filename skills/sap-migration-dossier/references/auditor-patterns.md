# Auditor Patterns

Use these patterns when a user wants a full migration-readiness dossier, persistent artifacts, review workflow, imported extractor data, or visual output. They are distilled from the `sergio-gracia/ecc-s4h-migrator-auditor` repository and adapted to ARC-1's governed MCP model.

## What To Borrow

| Pattern | Why it matters | ARC-1 adaptation |
|---|---|---|
| Versioned extract schema | Makes reruns and imported evidence reproducible | Write `inventory.json` with `schemaVersion`, `system`, `scope`, `generatedAt`, and `evidenceSources` |
| Node/edge/source model | Separates inventory, graph, and source text | Keep `inventory.json`, `graph.json`, and optional source mirror separate |
| Bounded LLM cards | Prevents huge prompts and hidden assumptions | Cap source context, summarize dependencies, flag truncation |
| Strict enums | Makes review/report aggregation reliable | Use fixed `classification`, `effort`, `status`, `usageStatus`, and `cleanCoreLevel` values |
| Human review state | Keeps AI drafts out of customer-facing decisions | Use `cards.jsonl` + `reviews.jsonl`; final report includes only validated/corrected cards |
| Integrity seal | Helps prove the report matches extracted source | Hash source bodies or source excerpts and report match/missing counts |
| Declared limits | Makes the dossier honest | Always list missing runtime data, dynamic calls, skipped objects, and unavailable APIs |

## Suggested Local Artifact Layout

```
docs/migration-dossiers/<scope>/<YYYY-MM-DD>/
  system-info.md
  methodology.md
  inventory.json
  inventory.csv
  graph.json
  graph.mmd
  atc-findings.json
  usage.json
  cards.jsonl
  reviews.jsonl
  review-summary.md
  report.md
  report.html
  dashboard.html
  skipped.md
```

Write only the files needed for the user's chosen output. For chat-only reports, do not create this folder.

## Minimal Schemas

Inventory record:

```json
{
  "schemaVersion": "arc1-migration-dossier/1",
  "object": {"id": "CLAS:ZCL_FOO", "type": "CLAS", "name": "ZCL_FOO"},
  "package": "ZPKG",
  "description": "",
  "loc": 0,
  "changedOn": null,
  "sourceHash": null,
  "evidence": {
    "source": "SAPRead",
    "usage": "SUSG",
    "dependencies": "SAPContext",
    "atc": "SAPDiagnose"
  },
  "flags": {
    "dynamicCalls": false,
    "sourceTruncated": false,
    "generated": false
  }
}
```

Card record:

```json
{
  "schemaVersion": "arc1-migration-card/1",
  "id": "card:CLAS:ZCL_FOO",
  "objectId": "CLAS:ZCL_FOO",
  "status": "ai_draft",
  "classification": "ADAPT",
  "effort": "M",
  "confidence": 0.74,
  "functionalSummary": "",
  "rationale": "",
  "risks": [],
  "questions": [],
  "evidenceRefs": []
}
```

Review record:

```json
{
  "cardId": "card:CLAS:ZCL_FOO",
  "action": "validated",
  "reviewer": "consultant",
  "reviewedAt": "2026-06-20T00:00:00Z",
  "correctedClassification": null,
  "correctedEffort": null,
  "note": ""
}
```

## ECC Enhancement Inventory Hints

Prefer ARC-1 tools where available. Use table reads only in deep evidence mode.

Classic user exits:
- CMOD projects: `MODATTR`
- project to enhancement assignment: `MODACT`
- enhancement components: `MODSAP`
- customer include source: `TRDIR` names like `ZX*`, then `SAPRead(type="INCL")`

Classic BAdIs:
- implementation metadata often lives in `SXC_ATTR` / `SXC_EXIT`
- release-specific fields vary; query failures are methodology gaps

Enhancement framework:
- use `SAPRead(type="ENHO")` when names are known
- package inventory may reveal `ENHO` / `ENHS` entries

Standard modifications:
- `SMODILOG` indicates modified standard objects
- `SMODISRC` can hint volume
- treat every standard modification as SPAU-relevant effort

Cross references:
- prefer `SAPContext` and `SAPNavigate(action="references")`
- `CROSS` and `WBCROSSGT` are optional fallback evidence and can be stale

Usage:
- prefer SCMON/SUSG from `sap-unused-code`
- ST03N-style aggregates are weaker evidence; label them as aggregate usage, not per-object proof

## SAP Docs MCP Tool Map

The SAP Docs MCP server is optional for running the dossier, but strongly recommended for better migration decisions. Tool namespaces vary by client; use the tool with the matching function name when available.

| Tool | Use in a migration dossier | When to skip |
|---|---|---|
| `sap_get_object_details` | Classify SAP references by release state and Clean Core level; find successor objects for deprecated/internal APIs | Skip for custom Z/Y objects; use ARC-1 metadata instead |
| `search` | Find official/reference docs for ATC themes, RAP/ABAP Cloud patterns, simplification guidance, and replacement APIs | Skip broad generic queries; query only top themes or uncertain decisions |
| `fetch` | Retrieve full content for search results actually used in the rationale | Skip low-ranked or merely interesting results |
| `abap_feature_matrix` | Check whether ABAP syntax/features are available in the target release | Skip when the target release is unknown; first record it as a methodology gap |
| `sap_community_search` | Troubleshoot exact errors or obscure migration symptoms after official docs are insufficient | Skip for normal architecture decisions; community content is supporting evidence |
| `sap_discovery_center_service` | Assess BTP service feasibility, pricing, and roadmap when a replacement implies SAP BTP services | Skip for pure ABAP code audits with no BTP service decision |

Older connector variants may expose equivalent tools as `_search`, `_fetch`, `_sap_docs_search`, `_sap_docs_get`, `_sap_help_search`, or `_sap_help_get`. Prefer the richer `search` / `fetch` / `sap_get_object_details` / `abap_feature_matrix` set when present.

Recommended usage:

1. Extract SAP references from the audited custom objects.
2. Call `sap_get_object_details` for unique SAP APIs that drive risk, not for every trivial reference.
3. Use `search(includeSamples=false)` for official/reference guidance on top ATC themes and replacement strategy.
4. Use `fetch` only for results cited in the report.
5. Use `abap_feature_matrix` for release-sensitive remediation proposals.
6. Use `sap_community_search` only for exact errors, niche symptoms, or workaround research.

Suggested queries:

```
search(query="<ATC check title> S/4HANA migration", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="<deprecated API> successor released API", includeSamples=false, abapFlavor="<cloud|standard>")
search(query="ABAP Cloud released API replacement <object>", includeSamples=false, abapFlavor="cloud")
abap_feature_matrix(query="<ABAP feature>")
sap_community_search(query="<exact error text or obscure symptom>")
```

Report evidence source labels:
- `docs=sap_get_object_details` when Clean Core levels or successors came from SAP Docs MCP
- `docs=search/fetch` when rationale cites documentation
- `docs=unavailable` when SAP Docs MCP is not connected
- `docs=not-used` when the scope did not require external documentation

## Report Quality Rules

- Put reviewed/corrected evidence before generated rationale.
- Exclude `ai_draft` cards from final reports unless the file is explicitly a draft.
- Show pending review counts on the cover or executive summary.
- Separate retirement candidates from migration-remediation candidates.
- Separate SAP Docs evidence from ARC-1 live-system evidence; one is documentation/release-state context, the other is observed system state.
- Keep top-level decision labels stable; put nuance in rationale and questions.
- Include customer questions when evidence is incomplete instead of inventing migration conclusions.
