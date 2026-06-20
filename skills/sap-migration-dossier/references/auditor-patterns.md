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

## Report Quality Rules

- Put reviewed/corrected evidence before generated rationale.
- Exclude `ai_draft` cards from final reports unless the file is explicitly a draft.
- Show pending review counts on the cover or executive summary.
- Separate retirement candidates from migration-remediation candidates.
- Keep top-level decision labels stable; put nuance in rationale and questions.
- Include customer questions when evidence is incomplete instead of inventing migration conclusions.
