# ABAP Object Type Research Methodology

This document defines **how** we research each ABAP object type that ARC-1 exposes via its tools.
The motivation: issue #218 surfaced that ARC-1's `SLASH_TYPE_MAP` and schema enums conflate two
distinct concepts (TADIR R3TR types vs ADT slash subtypes vs file-format types) and contain
several invented or mislabeled entries (`STRU/DS`, `FUNC/FM`). Before we fix anything else, we
need a rigorous, reproducible procedure so each type's classification is grounded in evidence,
not folklore.

## The four "type" namespaces and why they differ

When SAP says "type" it means at least one of these. Most bugs in this area come from
treating them as interchangeable:

| Namespace | Example | Source of truth | Width |
|---|---|---|---|
| **TADIR R3TR object type** | `TABL`, `CLAS`, `PROG`, `FUGR` | DD: table `TADIR`, view `TRDIR`; transactions SE80/SE16 | 4 char, ~hundreds |
| **TADIR LIMU sub-object** | `FUNC` (function module under FUGR), `METH`, `REPS` | Table `TADIR` rows with `PGMID = LIMU` | 4 char |
| **ADT slash subtype (workbench type)** | `CLAS/OC`, `TABL/DT`, `TABL/DS`, `FUGR/FF` | ADT discovery `/sap/bc/adt/discovery`; ADT XML responses; ABAP class `CL_WB_OBJECT_TYPE` and table `WBOBJTYPE` | 6+ char incl. `/` |
| **abapGit / abap-file-formats type** | `clas`, `tabl`, `prog` | Repo [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats); abapGit serializers; cloud BTP REST exposure | 4 char (lower), maps to TADIR R3TR |

Confusion vector for issue #218: `STRU` was used as if it were a TADIR R3TR type, when it is
only the second half of the ADT slash subtype `TABL/DS`. There is no `R3TR STRU`. Same shape
for `FUNC/FM` — `FUNC` exists only as a TADIR `LIMU` sub-object under `FUGR`, never as a
top-level R3TR type, and the ADT slash form is `FUGR/FF` (function group function), not
`FUNC/FM`. ARC-1's `SLASH_TYPE_MAP` invented `FUNC/FM` and is treating `FUNC` as if it were a
peer of `CLAS` / `PROG` — which it is not.

The research **must** record, for every type ARC-1 currently exposes, which namespace each
identifier actually lives in, so we can decide consciously whether the alias is correct,
legacy-tolerable, or invented and harmful.

## Per-type research procedure

For every type listed in `01-inventory.md`, complete the following steps. The output goes into
`types/<short-type>.md` using the template at the bottom of this file.

### Step 1: TADIR ground truth

- Search abap-file-formats: `https://github.com/SAP/abap-file-formats` for the type. The repo
  is the closest thing to an authoritative SAP-published list of object types and their
  sub-objects.
- Verify the type appears in the SAP Help portal "Object Types" topic for ABAP Workbench /
  ADT, if findable.
- Locally: search the abap-file-formats clone (if available) for `<type>/file-format`, README
  tables, and `model/object-types.json`-style indexes.
- Record:
  - Full TADIR R3TR name (e.g. `TABL → Table`)
  - Whether the type has LIMU sub-objects, and which (e.g. `FUGR` has LIMU `FUNC`, `INCL`)
  - Whether abap-file-formats supports it for cloud (✅ / ❌ / partial)

### Step 2: ADT slash subtype enumeration

- Run a *probe* against both test systems (a4h S/4HANA 2023 and the 7.50 system if
  reachable) and record what the ADT discovery / search / where-used APIs actually return:
  - `/sap/bc/adt/repository/typestructure` (returns `<adtcore:objectType>` slash codes)
  - `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=…&objectType=<X>`
  - `/sap/bc/adt/repository/nodepath?uri=…`
- Eclipse plugin reference: in `/Users/marianzeis/DEV/arc-1-eclipse-adt/`, grep
  `com.sap.adt.core.apidoc-*` and the API jars for the type code (slash form). Eclipse's
  `WBObjectType` maps these.
- Record every slash subtype seen, plus the URL prefix(es) ADT uses (e.g. `TABL/DT`
  → `/sap/bc/adt/ddic/tables/`; `TABL/DS` → `/sap/bc/adt/ddic/structures/`).
- Note any release-conditional behavior (NW 7.50 vs S/4 vs BTP).

### Step 3: SAP backend code & docs

- Use `mcp__sap-docs__search` and `mcp__sap-docs__sap_get_object_details` for the type code
  to pull official help.
- Use `mcp__sap-notes__search` for known issues mentioning the type — especially anything
  about "object type X is not supported" / KBAs about ADT errors.
- For BTP / steampunk ABAP availability, cross-check: is the type listed as released in
  abap-file-formats with `release_state: released`? Is it allowed to be created via ADT in
  steampunk?
- If applicable, look up the SAP class `CL_WB_OBJECT_TYPE` constants for the slash form.

### Step 4: Cross-reference compare/ folder & other MCP servers

- Check `compare/00-feature-matrix.md` and `compare/02-mcp-abap-abap-adt-api.md` — do other
  MCP-ADT projects expose this type, and how do they spell it?
- Cross-check `mcp-abap-abap-adt-api`, `aws-abap-accelerator`, etc. for naming. Convergence
  across multiple implementations is weak evidence the form is real; divergence is strong
  evidence at least one is wrong.

### Step 5: Live verification on test systems

- a4h (S/4HANA 2023): primary test system, S/4 + ABAP-Cloud development model enabled.
  Most modern types should resolve here. Use `arc1-cli call SAPRead --type <X> --name <known
  object>` plus direct `curl` against the ADT URL.
- 7.50 (NW 7.50 trial / NPL): legacy gate — confirms which subtypes existed before the
  abap-file-formats era and whether ARC-1's URL routing works there. If credentials are
  stale, mark "could not verify directly" and rely on ADT discovery cached fixtures under
  `tests/fixtures/probe/`.
- Record HTTP status, response body shape (XML root element, namespaces), and any 404 /
  redirect behavior.

### Step 6: ARC-1 surface audit

For each type, list every place ARC-1 references the canonical short form *and* every slash
alias:

- `src/handlers/schemas.ts` — `SAPREAD_TYPES_*`, `SAPWRITE_TYPES_*`, `SAPCONTEXT_TYPES_*`
- `src/handlers/intent.ts` — `SLASH_TYPE_MAP`, `objectBasePath`, switch cases in
  `handleSAPRead`/`handleSAPWrite`/`handleSAPActivate`/`handleSAPNavigate`/`handleSAPContext`,
  `inferObjectType`
- `src/handlers/tools.ts` — tool description type lists shown to LLMs
- `src/adt/client.ts` — `getProgram`, `getClass`, `getTabl`, etc.
- `src/adt/crud.ts` — write paths
- `src/adt/codeintel.ts` — where-used scope mapping
- `src/probe/catalog.ts` — type probe entries

Cite line numbers. The goal is to know, for each type, exactly what would change if we
renamed/removed/aliased it.

### Step 7: Verdict & recommendation

End each type doc with:

- **Verdict**: `correct` / `legacy-tolerable` / `wrong` / `pseudo` / `incomplete`
- **Evidence severity**: `verified-on-live-system` / `verified-from-source` / `inferred`
- **Recommendation**: keep / remove alias / rename / add / split / collapse — concrete action
- **Breaking change**: yes/no, severity, who's affected
- **Test gap**: what new unit/integration/E2E test would have caught the bug

## Per-type document template

Use this structure for every `types/<short>.md`. Empty headings are *required* even when
"N/A" — explicit absence is information.

```markdown
# <SHORT> — <Human Name>

## TL;DR
1-3 sentences: what is the canonical truth, what does ARC-1 currently do, is it correct.

## TADIR ground truth
- **R3TR type**: <code> (or "does not exist as R3TR")
- **LIMU sub-objects**: <list>
- **abap-file-formats support**: <state> (link)
- **Source URL or fixture**: <citation>

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `XXXX/YY` | … | `/sap/bc/adt/...` | a4h ✅ / 7.50 ✅ / fixture |

## SAP docs & notes
- <bullet list of relevant SAP help links / notes>

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: <how it spells it>
- abapGit / abap-file-formats: <state>
- compare/00-feature-matrix.md row: <link>

## Live verification
### a4h (S/4HANA 2023)
- Test object: `<NAME>`
- ADT response: <status, root element>

### 7.50 (NW 7.50)
- Test object: `<NAME>`
- ADT response: <status, root element, or "could not verify — credentials">

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | … | `XXXX` | ✅ / ❌ |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | … | `XXXX/YY → ZZZZ` | ✅ / ❌ |

## Verdict
- **Status**: correct / legacy-tolerable / wrong / pseudo / incomplete
- **Evidence**: verified-on-live-system / verified-from-source / inferred
- **Issue**: <if any>

## Recommendation
- <keep / remove alias / rename / add / split>
- **Breaking change**: yes / no — affects <who>
- **Test gap to close**: <unit/integration/e2e tests to add>
```

## Calibration: what "thorough" means here

A type doc is **insufficient** if it relies on a single source. We should always be able to
say "TADIR says X, abap-file-formats says X, Eclipse ADT plugin says X, the live system
returns X, ARC-1 currently spells it Y — that's why it's a bug." When evidence sources
disagree, that disagreement is the most important thing to record.

A type doc is **complete** when:
- All 7 steps have been performed and cited
- A reader can act on the recommendation without re-doing the research
- Test gaps are concrete (file path + test name + assertion shape)
