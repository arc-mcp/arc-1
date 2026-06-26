# Research: server-side single-system version diff (`SAPRead action="diff"`)

Dated 2026-06-15. System: `a4h.marianzeis.de:50000` (S/4HANA 2023, SAP_BASIS 758). Driven live via
built `dist/cli.js` + main-repo `.env`.

## Goal

Collapse the current 3-call, ~8K-token manual diff (`VERSIONS` → 2× `VERSION_SOURCE` → LLM diffs the
two full sources) into ONE call that returns only the unified-diff hunks (~0.5K tokens):

```
SAPRead(action="diff", type=<type>, name=<name>, from=<ref>, to=<ref>)
  ref ∈ { "active" (default for from), "inactive" (default for to), <revision id>, <full versionUri> }
→ unified diff text only
```

Two flavors:
1. **Version diff** — revision N vs N-1 / vs active. Needs ≥2 snapshots; sparse (see below).
2. **Active-vs-inactive** — last-activated vs saved-but-not-activated draft. The in-flight workhorse.

## Verified ADT contract (live + eclipse-adt)

| Concern | Finding | Evidence |
|---|---|---|
| Active source | `GET <sourceUrl>` (no param) or `?version=active`, `Accept: text/plain` | live: 16607 B for `ZCL_SSI_UNIT_HOOKS` |
| Inactive source | `GET <sourceUrl>?version=inactive`, `Accept: text/plain`. No draft → returns **active body** (200, not 404) | eclipse-adt `api/22-inactive-source-locks-and-conditional-reads.md`; live confirmed |
| Revision source | `GET .../source/main/versions/<ts>/<seq>/content`, `Accept: text/plain` | live: 16659 B via `getRevisionSource` |
| Version list | `GET .../source/main/versions`, `Accept: application/atom+xml;type=feed` → `revisions[].uri` | `client.getRevisions` |
| Server-side diff | **None.** ADT/Eclipse diff is client-side (`AbapCompareSourceTextMergeViewer`) | eclipse-adt `api/12`, `api/22` |
| `?version=` param | Framework-level (`IF_ADT_URI_QUERY_PARAMETERS`), pre-7.50, **release-invariant** | eclipse-adt; SAP Note 2034580 |

ARC-1 already has every fetch primitive: `getRevisions` ([client.ts:946]), `getRevisionSource`
([client.ts:957]), and `fetchSource` honoring `SourceReadOptions.version` via
`appendQueryParam(path,'version',…)` ([client.ts:383-384]).

## Live probe results (the deciding evidence)

```
active   ZCL_SSI_UNIT_HOOKS  = 16607 B
inactive ZCL_SSI_UNIT_HOOKS  = 16607 B raw  (handler adds a 93-B "no draft" banner → 16700 via SAPRead)
revision 00000 (only version) = 16659 B;  diff(active vs revision) = 30 changed lines
VERSIONS count: 1 for ZCL_SSI_UNIT_HOOKS, ZIF_SSI_HOOKS, CL_SALV_TABLE, CL_GUI_FRONTEND_SERVICES
```

### Gotchas caught (would have produced wrong output)
1. **No-draft banner is false-diff bait.** `version=inactive` with no draft returns the active body,
   and the *handler* (`sourceVersionWarning`, [read.ts:105]) prepends
   `"Note: No inactive draft exists…"`. Diffing handler output would surface that banner as a spurious
   `+` line. → **Diff RAW client source** (the banner is handler-level; `fetchSource` returns raw).
   When the two raw sources are byte-equal → report "no differences", do not emit a banner diff.
2. **Snapshot sparsity.** Every object (even standard `CL_SALV_TABLE`) returns exactly 1 version on
   this system — ABAP only cuts version snapshots on transport *release*. Flavor 1 is therefore rare in
   practice; flavor 2 (active-vs-inactive) and revision-vs-active are the realistic wins. (active vs the
   lone revision still gave a real 30-line diff, so the mechanism is proven.)

## ARC-1 impact map

| File | Change |
|---|---|
| `package.json` | add `diff` (+ `@types/diff` dev) — no text-diff dep today |
| `src/adt/source-diff.ts` (new) | pure `unifiedDiff(oldText,newText,labels)` via `diff.createTwoFilesPatch`; unit-tested in isolation |
| `src/adt/client.ts` | `getVersionDiff(type,name,from,to,opts)` — resolves each ref to RAW source (active/inactive via a focused `fetchSourceByType` switch reusing existing `get*`; id→`getRevisions`→`getRevisionSource`; uri→`getRevisionSource`), then `unifiedDiff`. Guard: `checkOperation(this.safety, OperationType.Read, 'GetVersionDiff')` |
| `src/handlers/schemas.ts` | `SAPReadSchema`: add `action: z.enum(['diff']).optional()`, `from`/`to` optional strings; `validateSapReadInput` requires `name` when `action==='diff'` |
| `src/handlers/tools.ts` | SAPRead JSON schema: add `action`, `from`, `to` with descriptions (three-file sync) |
| `src/handlers/read.ts` | early branch: `if (action==='diff')` → `client.getVersionDiff(...)` → `textResult`; default `from='active'`, `to='inactive'`; friendly not-found + "no differences" handling |
| `tests/unit/adt/source-diff.test.ts` (new) | pure diff: change/add/delete/identical/empty |
| `tests/unit/handlers/read.test.ts` | mocked diff cases: active↔inactive, revision id resolution, no-diff, not-found, non-source type rejected |
| `tests/fixtures/tool-definitions/*.json` | regenerate (SAPRead surface changed) — reviewed diff |
| `docs_page/*` SAPRead reference | document `action="diff"` |

## Scope guard (ponytail)
Single-system, two-source, returns unified diff text. NO cross-system (skill territory), NO rename
detection, NO semantic diff, NO multi-object batch. Reuse `diff`; do **not** reuse `diffMethodSets`
(method-set, not text).

## Per-release note
`?version=` and the versions/revision endpoints are framework-level and release-invariant; no
per-release branching needed. (Snapshot sparsity is ABAP behavior, not release-specific.)

## Live verification (Phase 6 — a4h S/4 758, worktree dist via main-repo `.env`)

All read-only; one mutating flavor-2 probe on a `$TMP` throwaway, deleted afterwards.

| # | Scenario | Result |
|---|----------|--------|
| 1 | active read smoke (worktree build live) | ✅ |
| 2 | `from="00000" to="active"` (bare id → feed → revision source → diff) | ✅ `Diff CLAS …: 00000 → active (+2 -28)` |
| 3 | default `action="diff"` on no-draft object | ✅ `No differences between active and inactive` — **no banner hunk** (the key gotcha) |
| 4 | `from=active to=active` | ✅ No differences |
| 5 | `from=<full /sap/bc/adt/ URI> to=active` | ✅ same `(+2 -28)` |
| 6 | `from="99999"` (bad id) | ✅ `404 … Revision "99999" not found … Available revision ids: 00000` |
| 7 | unsupported type (`DOMA`) | ✅ `400 … Version diff is not supported for type "DOMA"` |
| 8 | `type=PROG` + `type=FUGR` dispatch | ✅ both fetch active+inactive and diff |
| 9 | **Flavor 2 real draft**: create `$TMP` PROG → activate → update-without-activate → diff | ✅ `(+2 -1)` showing `+WRITE 'a brand new pending line'.`; object deleted |

Conclusion: all three fetch paths (active/inactive via `?version=`, revision-by-id via the feed,
revision-by-URI), the no-draft guard, both error paths, multi-type dispatch, and the real
active-vs-inactive in-flight diff are verified live. Gate: typecheck + lint + 3853 unit tests +
`check:sizes` + `validate:policy` all green.

## Diff coverage across ALL SAPRead object types (empirical, a4h 758)

Tested every SAPRead object type to decide diff eligibility. Criterion: does the read return
**plain-text source** (diffable) or **parsed metadata / JSON / data** (a diff would be noise or
meaningless)? Only types whose `/source/main` returns raw text qualify.

**DIFFABLE — the 12 supported types (plain-text via `fetchSource`).** Live-confirmed clean
source/diff routing: PROG, CLAS, FUGR, INCL, TABL (`SCARR` DDL), DDLS (`I_CURRENCY`, `ZR_FBCLUBTP`),
DCLS, BDEF (`ZR_FbClubTP`), SRVD (`ZSD_FB_VB1`), DDLX, INTF, FUNC.

**NOT DIFFABLE — read returns metadata/structured, not source (live-confirmed shapes):**

| Type | Live read shape | Verdict |
|------|-----------------|---------|
| DOMA | JSON `{name, dataType, length, fixedValues…}` | metadata — exclude |
| DTEL | JSON `{name, typeKind, domain…}` | metadata — exclude |
| MSAG | JSON `{name, messages[]}` | metadata — exclude |
| SRVB | JSON `{name, bindingType, odataVersion…}` (`parseServiceBinding`) | metadata — exclude |
| VIEW | XML `<adtcore:mainObject …/>` envelope (no definition) | metadata — exclude |
| AUTH, ENHO, FEATURE_TOGGLE, TRAN, API_STATE | parsed JSON metadata | exclude |
| BSP / BSP_DEPLOY, DEVC, TABLE_CONTENTS/QUERY, SYSTEM, COMPONENTS, INACTIVE_OBJECTS, TEXT_ELEMENTS, VARIANTS | listings / data, not object source | exclude |
| SKTD | base64-decoded markdown doc (lossy, niche) | exclude |
| DESD / EVTB / EVTO / DTSC / CSNM / COTA (server-driven) | AFF JSON via `getServerDrivenObject` (different path, mostly 8.16+) | exclude |

`action="diff"` on an excluded type returns a clean `400` listing the 12 supported types
(live-confirmed: DOMA, MSAG, VIEW).

**Conclusion: the 12 source-bearing types are exactly the diffable set — no additions (metadata
diffs are noise), no removals.** CDS views diff as `DDLS`; classic `VIEW` cannot (VIT metadata only).
Coverage is complete; this is recorded so it is not re-litigated.
