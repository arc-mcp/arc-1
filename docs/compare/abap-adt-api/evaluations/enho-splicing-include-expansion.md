# abap-adt-api v8.1.0 — ENHO splicing & include expansion

> **Priority**: Medium
> **Source**: marcellourbani/abap-adt-api commits `d8c4390` / `5e4cdda` / `48eefd0` (PR #43, 2026-04-21)
> **ARC-1 component**: `src/adt/client.ts` (`getEnhancementImplementation`); potential new `findEnhancementsForObject`

## What they added

A new `objectEnhancements(objectUrl, includeSource)` API that, **given a base ABAP object** (program / include / function group), returns:

- All enhancement implementations (`<enh:enhancementImpl>`) currently bound to that object
- Per-implementation, the list of `EnhancementElement`s — each with URI, sequential id, fullname (`\PR:<prog>\FO:<form>\SE:<section>\EI`), insertion mode, replacing flag
- Optional decoded source code per element
- 0-based line/column position within the base object's source

Plus an "include expansion" companion that splices enhancement source back into the base object's text at the right positions, returning a single composite source view.

This is the mirror image of "what is this ENHO?" — instead it answers "what enhancements affect this PROG/FUGR/INCL?".

## ARC-1 current state

ARC-1 has **only the by-name read** of a single ENHO:

```typescript
async getEnhancementImplementation(name: string): Promise<EnhancementImplementationInfo> {
  // GET /sap/bc/adt/enhancements/enhoxhb/{name}
}
```

— consumed via `SAPRead(type='ENHO', name='Z_MY_ENHO')`.

There is no equivalent of "given PROG `ZARC1_TARGET`, list enhancements bound to it". To find enhancements on a target today, the caller has to:

1. `SAPSearch` for ENHO objects in the package, OR
2. Read the target source and notice it's been enhanced (no ADT-level signal in the regular `/source/main` payload).

## Assessment

**Genuinely useful gap.** "What modifies my object behind the scenes" is exactly the kind of question the LLM can't answer without grovelling through the system, and is high-value for code-review / impact-analysis workflows.

Sketch of an ARC-1 fit:

- New action: `SAPRead(type='ENHO', target='ZARC1_REPORT')` — currently `name` and `target` are mutually exclusive; this would resolve to "list enhancements affecting `ZARC1_REPORT`".
- Or a new `SAPDiagnose(action='enhancements_for', objectName='ZARC1_REPORT')` — fits the diagnostics tool semantically.
- Or extend `SAPRead(type='ENHO').includes` to support `expanded` to splice source — that's a separate concern (rendering composite source, not finding enhancements).

The ADT endpoint (per their parser) is the standard `/sap/bc/adt/enhancements/...` family with a query for the bound object — needs a probe to confirm the exact URL shape on our test systems before committing.

## Decision

**consider-future / probe** — file as a new SAPRead extension. Steps:

1. Run `scripts/probe-adt-types.ts` against `a4h.marianzeis.de` (S/4HANA on-prem trial) and a BTP destination to see what `/sap/bc/adt/enhancements/...?for=...` returns on each.
2. If the endpoint exists on both: add `findEnhancementsForObject(objectUri)` to `client.ts`, wire to `SAPRead(type='ENHO', target=...)`, parser via `xml-parser.ts`.
3. Source splicing is optional and adds complexity — defer until someone asks.

Pair with the cds-impact pattern (`src/adt/cds-impact.ts`) for symmetry — that's the same idea (downstream blast-radius) but for CDS objects.

**Not blocking**. ARC-1's ENHO read covers the inverse direction; this is the missing forward direction.
