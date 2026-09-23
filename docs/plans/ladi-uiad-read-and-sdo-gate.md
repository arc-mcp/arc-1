# Plan: LADI (UIAD) read + SDO discovery gate + classic-FLP deprecation labelling

Status: implemented · Target: one PR · Verified against a4h-2025 (SAP_BASIS 816) and a4h (758)

> Note: main registered DSFD/DTDC and generalised the registry (`metadataContentType` +
> `discoveryMarker`, so the gate is no longer blues-only) after this plan was drafted. The
> implementation follows the current API; the analysis below is unchanged.

## Context

SAP deprecated the classic FLP tile/target-mapping content model (FLP Designer, `/UI2/FLPD_CUST`,
OData `PAGE_BUILDER_CUST`) as of S/4HANA 2023. The replacement is the **Launchpad App Descriptor
Item (LADI)** — repository object `R3TR UIAD` — held in technical catalogs (`R3TR UIAC`).
LADI-based content is a prerequisite for SAP Build Work Zone **content exposure v2**.

On ABAP Cloud, LADIs are explicitly a *developer* artifact, not launchpad-admin content: SAP Help
documents creating and editing them in ABAP Development Tools for Eclipse, and manifest-generated
LADIs are read-only there. That places them inside ARC-1's domain.

ARC-1 today exposes only the **deprecated** side (`SAPManage flp_*` over `PAGE_BUILDER_CUST`) and
mislabels it as "business catalogs".

### Live findings (a4h-2025, SAP_BASIS 816)

| Fact | Evidence |
|---|---|
| `/sap/bc/adt/fiori/uiad` exists | bare GET → 400 (needs name); control path → 404 |
| Accept is **blues v2**, not v1 | v1 → 406; discovery `app:accept` = `application/vnd.sap.adt.blues.v2+xml` |
| `adtcore:type` = `UIAD/TYP` | metadata GET on 2 real instances |
| AFF source is rich + on-point | `generalInformation.{appType,catalogId,transaction}`, `navigation.{targetMappingId,semanticObject,action,desktop,tablet,phone}`, `tiles[]` |
| Instance counts | UIAD **1034**, UIAC 15, UIPG 1, UIST 1 |
| **No** UIAC (catalog) ADT endpoint | 4 candidate paths → 404; discovery map lists only `fiori/{uiad,uipgtyp,uisttop}` |
| LADIs are already discoverable | `SAPRead type=DEVC` lists them as `UIAD/TYP` + name + description |
| Pre-8.16 systems get a bad error | `SAPRead type=DESD|COTA|UIAD` on 758 → raw 404 + misleading "verify the name exists" hint |

## Scope — three changes, one PR

### 1. Register UIAD as a server-driven object type
`src/adt/server-driven.ts` — add `'UIAD'` to `SDO_TYPES` and a `SDO_REGISTRY` entry
(`href: /sap/bc/adt/fiori/uiad`, `createType: 'UIAD/TYP'`, `metadataContentType: BLUES_V2 + discoveryMarker 'blues'`).

The read/write handler branches are generic (`isServerDrivenObjectType`), and the SAPRead/SAPWrite
type tables derive from `SDO_TYPES`, so no handler or schema edits are needed.

This reverses the deliberate exclusion in `docs/plans/completed/add-server-driven-object-read.md`
("Low-value/internal types (SUSI, SFPF, **UIAD**, …) are intentionally left out"). Overturned on
evidence: 1034 instances on 816, and SAP documents LADIs as a developer-owned ADT artifact on ABAP
Cloud — not the internal type it was assumed to be.

Write (create/update/delete) comes along with registration, and is **not** verified as working —
live-tested and SAP refuses it on on-prem:

```
SAPWrite create UIAD → 400 "Editing of LADIs with ALV \"Standard\" not allowed in workbench tools"
```

LADI editing requires the **ABAP Cloud** language version, which is why SAP documents this flow for
the BTP ABAP environment. So on on-prem 816 this type is read-only *in practice*, enforced by SAP
with a clear message. Consequences:

- **No client-side guard.** SAP's refusal is precise and actionable; duplicating it client-side
  would be a guess (ARC-1 cannot tell a manifest-generated LADI from a hand-made one without a
  round-trip). This also covers the read-only manifest-generated case.
- **The module docstring must not inherit the "201 for all registered types" claim** — it is true
  for the original six, false for UIAD. Amend it and record UIAD's verified behaviour instead.
- Shipping read-only would need a new per-type write-exclusion flag — more machinery than the
  server-side refusal already provides.

### 2. Fix the SDO discovery gate (pre-existing bug, affects all 7 types)
`supportsServerDrivenObject()` returns `undefined` when discovery has not been loaded, and the call
sites only short-circuit on an exact `false`. The CLI never loads discovery (`src/cli.ts` calls
`handleToolCall` directly), so the gate never fires and the user gets a raw 404 telling them to
check the object name — when the type does not exist on that release at all.

Add to `src/adt/server-driven.ts`:

```ts
export async function ensureServerDrivenSupport(http, safety, code): Promise<boolean> {
  const known = supportsServerDrivenObject(http, code);
  if (known !== undefined) return known;
  checkOperation(safety, OperationType.Read, 'FetchDiscovery');
  const { map } = await fetchDiscoveryDocument(http); // never throws
  return resolveAcceptType(map, sdoEntry(code).href)?.includes('blues') ?? true;
}
```

Three deliberate choices, each corrected from the first draft after review:

- **`safety` is a required parameter.** `fetchDiscoveryDocument` issues a raw `client.get` with no
  guard, and this moves it inside a tool-call handler — the "all ADT endpoints have safety guards"
  invariant applies. Required (not optional) so a missed call site is a compile error.
- **Do not call `setDiscoveryMap`.** `src/server/server.ts:723,742` re-inject the cached map before
  every tool call, so storing is pointless; and writing to the shared HTTP client under the
  non-strict PP fallback would leak one user's capability view. Use the fetched map locally.
- **`?? true` (proceed) is correct** because `hasDiscoveryData()` cannot distinguish "discovery
  unreachable" from "discovery empty". Failing closed would break every SDO read on a system where
  `/sap/bc/adt/discovery` is 403'd by `S_ADT_RES`. The gate is an error-message affordance, not a
  security control — `checkOperation` and `checkPackage` are unaffected.

Use it at **three** entry points, not two: `src/handlers/read.ts`, `src/handlers/write-helpers.ts`,
and `src/handlers/activate.ts:263` (which routes SDO types with no gate today). In `read.ts` the
`!name` check must stay **before** the gate — `tests/e2e/server-driven-read.e2e.test.ts` asserts it.

Note: this costs one extra discovery GET per SDO call whenever the map is cold (always in the CLI;
in the MCP server only when the startup probe failed). `probe: true` only lowers the log level —
it does not reduce that cost.

### 3. Correct + deprecate-label the classic FLP actions
`src/handlers/tools.ts` — the `flp_*` actions operate on FLP **Designer** catalogs, not business
catalogs (those are `/UI2/FLPCM_CUST`). Fix the wording and add one deprecation pointer noting the
model is deprecated as of S/4HANA 2023, that LADIs (`SAPRead type=UIAD`) are the successor, and
that exposure v2 requires LADI-based content.

This is the **LLM-visible tool surface**, not documentation — it regenerates the frozen fixtures and
changes what every client sees. Two hard constraints measured from
`scripts/ci/check-tool-schema-budget.ts`:

| scenario | schema tokens | budget | headroom |
|---|---|---|---|
| standard-default | 11 969 | 12 050 | **81** |
| standard-full-git | 20 015 | 20 100 | 85 |
| btp-full-git | 18 263 | 18 350 | 87 |

`descriptionCount` for standard-default is **151/151 — zero headroom**, so no new `description`
field may be added. Offset the added deprecation sentence by tightening the existing `flp_*` bullets
so the net stays inside 81 tokens; both the on-prem and BTP SAPManage descriptions are affected.

## Out of scope (researched, deliberately rejected)

| Rejected | Reason |
|---|---|
| UIAC (technical catalog) read | No ADT endpoint exists on 816. `catalogId` inside each LADI allows client-side grouping. |
| UIPG / UIST registration | 1 instance each on 816 — speculative. Add when a real need appears. |
| A "find LADI" search feature | `SAPRead type=DEVC` already lists them. |
| LADI migration audit tool/skill | SAP ships `/UI2/MGR_TC` (per-catalog migration status) and `/UI2/FLPCA` (inventory, spreadsheet export). |
| Reading `SUI_TM_MM_*` tables | Undocumented internal tables; the supported ADT read supersedes them. |
| `src/probe/catalog.ts` entry | No SDO type is probe-catalogued; consistent by omission. |

### 4. Docs that enumerate the SDO types (hand-maintained, will drift)

- `docs_page/tools.md` — 4 spots: SAPRead `type` prose (~:21), the SAPRead per-type rows (~:66-71),
  SAPWrite `type` prose (~:237), and the server-driven writes section + rows (~:289, :299-303).
- `docs_page/roadmap.md` (~:126-127) enumerates the six.
- `docs/dev-guide.md:66-67` — both rows list the six; :66 also says the gate matches
  `blues.v1+xml`, already stale (EVTO is v2; the gate substring-matches `blues`). Fix both.
- `AGENTS.md:181` uses "(DESD/EVTB/…)" — no change needed, and no new row (terseness rule).

## Tests

- `tests/unit/adt/server-driven.test.ts` — UIAD in the v2 group; UIAD in the no-`masterLanguage` loop.
- `tests/unit/handlers/schemas.test.ts:40` — hand-written SDO list, add UIAD (would silently under-test).
- New unit coverage for `ensureServerDrivenSupport`: (a) discovery already loaded → no fetch;
  (b) cold → fetches, then gates correctly on a map lacking the collection; (c) discovery
  unavailable → returns true (proceed); (d) refused by `checkOperation` when safety forbids reads.
- Regenerate the 7 tool-definition fixtures; the diff must be the `UIAD` enum append plus the
  reworded FLP descriptions, nothing else.
- Note: handler tests that do not mock `hasDiscoveryData` now issue an extra discovery GET against
  the shared mock. Existing mocks match on method+pathname, so they tolerate it.

## Verification (live)

1. `SAPRead type=UIAD` on 816 → metadata + AFF JSON.
2. Same call on 758 → the release-aware message, **not** a raw 404.
3. A pre-existing type (`DESD`) on 758 → same clean message (proves the fix is general).
4. **Non-regression: `SAPRead type=EVTB` on 758 still succeeds.** EVTB ships on 758, so this is the
   case the now-active gate could wrongly block. This is the most important live check.
5. Full gate: `npm test`, `typecheck`, `lint`, `validate:policy`, `build`, `check:sizes`.

## Risks

- **False-negative gating.** The gate goes from never-firing to firing; a type available on an older
  release must not be blocked. Covered by verification step 4.
- **Extra discovery round-trip** per SDO call when the map is cold — permanent in the CLI and when
  the MCP startup probe failed, since `server.ts` re-injects the cached map each call. Accepted:
  one GET, and it buys a correct error instead of a misleading one.
- **UIAD writes are refused by SAP on on-prem** (see §1). Intentional; documented, not guarded.
- **Fixture churn** is reviewed by hand per the repo playbook.

## Commits

Gate fix first so each commit is independently correct and bisect-clean (registering a type whose
endpoint 404s on most of the install base is precisely what the gate exists for).

1. `fix: gate server-driven object types on discovery instead of a raw 404`
2. `feat: read Launchpad App Descriptor Items (UIAD) on ABAP Platform 2025`
3. `feat: label classic FLP designer actions as deprecated, point at LADI`

Commit 3 is **not** `docs:` — it changes the LLM-visible tool surface, so it must carry a changelog
entry. Review suggested splitting the gate fix into its own PR; keeping one PR per the request, with
the ordering above preserving bisectability.
