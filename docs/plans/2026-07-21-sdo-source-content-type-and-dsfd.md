# Plan — Fix SDO source format (DTSC write is broken) + add DSFD

> Status: revised 2026-07-21 after adversarial review (v2). Evidence:
> [docs/research/2026-07-21-sap-vscode-roadmap-dtdc-dsfd-probe.md](../research/2026-07-21-sap-vscode-roadmap-dtdc-dsfd-probe.md)
> Live-probed on a4h-2025 (SAP_BASIS 816) + a4h 2023 (758).

## Problem

One false premise — *"server-driven object source is always AFF JSON"* — is baked into **two**
places, so `SAPWrite type=DTSC` cannot succeed on any system today.

**(a) Client-side gate.** `src/handlers/write-helpers.ts:796-811` runs `JSON.parse(source)` and
short-circuits before any HTTP call, on both `create`-with-source (`:826`) and `update` (`:842`).

**(b) Server-side content type.** `src/adt/server-driven.ts:52` hardcodes
`SDO_SOURCE_CONTENT_TYPE = 'application/json'` for the source PUT (`:238`).

Live PUT `…/source/main` results on 816, per type:

| Type | `application/json` | `text/plain` | Source flavor |
|---|---|---|---|
| DESD | **200** | 415 | JSON — correct today |
| CSNM | **200** | 415 | JSON — correct today |
| EVTB | **200** | 415 | JSON — correct today |
| EVTO | **200** | 415 | JSON — correct today |
| COTA | **200** | 415 | JSON — correct today |
| **DTSC** | **415** | **200** | **text — BROKEN in shipped code** |
| DSFD (new) | 415 | **200** | text |

DTSC and DSFD sources are DDL (`define static cache … retention 60 s`), which fails (a) *and* (b).
Read, create and delete are unaffected — the read path's `Accept: 'application/json, */*'`
(`server-driven.ts:163`) already passes text through via its `*/*` fallback.

**Why it shipped:** the 2026-06-05 SDO-write verification exercised *create* for all six types but
only ran a full `create→source→activate→read→delete` round-trip for **DESD** — which is genuinely
JSON. Unit tests are mock-based and assert whatever the code sends, so they cannot catch a content
type the real server rejects.

## Fix — one required field drives both call sites

```ts
export interface SdoRegistryEntry {
  …
  /**
   * Source flavor. NOT uniform: AFF-JSON types PUT application/json and 415 on text; the DDL-text
   * types (DTSC, DSFD) PUT text/plain and 415 on JSON. Live-verified per type on 816.
   */
  sourceFormat: 'json' | 'text';
}
```

A `'json' | 'text'` union rather than a raw content-type string: it is typo-proof at compile time,
and it drives *both* the `JSON.parse` gate and the PUT content type from one value — the two places
that drifted apart. **Required**, not optional-with-a-JSON-default: this bug exists precisely
because a global assumption was applied to every type, so a new registration must be a compile
error until the author states the flavor (playbook §3 "make invariants true by construction").

`satisfies Record<(typeof SDO_TYPES)[number], SdoRegistryEntry>` (`server-driven.ts:100`) already
makes both failure modes a TS2741 compile error: an entry missing the field, and a `SDO_TYPES` code
with no registry key.

`SDO_SOURCE_CONTENT_TYPE` is deleted. `updateServerDrivenObjectSource` derives the content type from
the entry; `validateSource` in `write-helpers.ts` only JSON-parses when the flavor is `json`.

## Add DSFD

Live-verified as an exact SDO match — `<blue:blueSource>` root, `blues.v1+xml`, same templateLinks
as DTSC, create with `adtcore:type="DSFD/SCF"` → 201, source round-trip with `text/plain` → 200.
Available on **758 and 816** (DTSC is 816-only); the existing discovery gate handles that with no
release logic, exactly as it already does for EVTB on 758.

```ts
DSFD: {
  href: '/sap/bc/adt/ddic/dsfd/sources',
  label: 'CDS Scalar Function Definition',
  createType: 'DSFD/SCF',
  blueContentType: BLUES_V1,
  sourceFormat: 'text',
},
```

## Files

Inventory corrected after review — the v1 plan missed `write-helpers.ts` (the blocker) and six more.

| File | Change |
|---|---|
| `src/adt/server-driven.ts` | `sourceFormat` on the interface + all 7 entries; `DSFD` in `SDO_TYPES` + registry; delete `SDO_SOURCE_CONTENT_TYPE`; derive CT in `updateServerDrivenObjectSource`; fix the header comment (`:5-6`, `:13`) |
| `src/handlers/write-helpers.ts` | **Blocker.** Gate `JSON.parse` on the flavor; fix the JSON-assuming prose at `:766`, `:796`, `:805-807`, `:834`, `:840`, `:858` |
| `src/handlers/tool-descriptions.ts` | DSFD in `SAPWRITE_DESC_ONPREM` (`:14`) + `SAPWRITE_DESC_BTP` (`:26`) — LLM-visible, lands verbatim in the snapshot fixtures |
| `src/handlers/tools.ts` | DSFD in the SDO sentence at `:432`, `:433`, `:622`, `:623` |
| `tests/unit/adt/server-driven.test.ts` | Per-type PUT content-type assertions; DSFD in the loops at `:194`, `:228`; retitle `:297` |
| `tests/unit/handlers/schemas.test.ts` | DSFD in the 6-code array at `:69` |
| `tests/unit/handlers/tools.test.ts` | DSFD in the arrays at `:222`, `:231` |
| `tests/fixtures/tool-definitions/*.json` | Regenerate (`vitest -u`) — reviewed diff, DSFD only |
| `docs_page/tools.md` | DSFD at `:21`, `:69-73`, `:241`, `:294`, `:304-308`; **correct the now-false claim at `:296`** ("written … as `application/json`") |
| `docs/dev-guide.md` | DSFD at `:68`; **correct `:69`** (same false `application/json` claim) |
| `docs_page/btp-abap-environment.md` | DSFD at `:393` |
| `docs_page/roadmap.md` | Correct the stale claim at `:138`; add rows for the deferred items |
| `AGENTS.md` | Server-driven row: note the per-type source flavor gotcha |

Confirmed **not** needing changes: `tool-registry.ts` and `schemas.ts` genuinely derive from
`SDO_TYPES` (via `SAPREAD_TYPES_*`/`SAPWRITE_TYPES_*`). `src/authz/policy.ts` needs no row — but
*not* because it derives from `SDO_TYPES` (it doesn't reference it at all); `getActionPolicy`
(`:98-104`) falls back to the tool-level `SAPRead`/`SAPWrite` rows. `SAPActivateSchema`
(`schemas.ts:682`) takes a free-form `z.string()`.

## Test

1. **Unit** — per-type PUT content-type assertions, and a DDL-text source surviving the client gate.
   Both fail against today's code (the regression guard).
2. **Full gate** — `npm test`, `typecheck`, `lint`, `validate:policy`, `build`, `check:sizes`.
   Note `check:sizes` `WRITE_WIRE_WALL = 68_000` with the surface at ~66.3 KB — a **hard ceiling,
   not a ratchet**. If the added prose breaches it, trim wording; do not raise the wall.
3. **Live 816** — round-trip DTSC and DSFD via the built CLI in `$TMP`: create → update source →
   activate → read → delete. This is what actually proves the fix. Re-run DESD to prove the JSON
   path did not regress.
4. **Live 758** — DSFD round-trip; confirm DTSC still gates cleanly.

## Known gaps accepted

- **DSFD on BTP is unverified.** All SDO types are `btp: true` by construction and discovery-gated
  at runtime, so a system without it degrades cleanly. But `tests/integration/btp-abap.integration.test.ts:852`
  iterates `Object.keys(SDO_REGISTRY)`, so DSFD silently gains a live BTP create attempt in that
  (local-only, credential-gated) suite. Flagged, not blocked.
- **"8.16+" prose is now wrong for two types.** DSFD ships on 758, as EVTB already does. The runtime
  errors (`write-helpers.ts:781-783`, `read.ts:187-189`) and descriptions say "requires SAP_BASIS
  8.16+". `docs_page/tools.md:299` already carves out EVTB; DSFD doubles the inaccuracy. Fixing the
  gate prose properly is a follow-up — the gate itself is discovery-driven and behaves correctly.

## Scope — deliberately excluded

Each becomes a roadmap row:

- **DTDC (Dynamic Cache)** — needs real generalization, not a registry row: type-specific
  `application/vnd.sap.adt.ddic.dtdc.v1+xml` and a `<dtdc:dtdcSource>` root, so it fails the
  `.includes('blues')` gate (`server-driven.ts:142`), `parseBlueSource`, and `buildBlueSourceXml`
  (`:184`), which emits a literal `<blue:blueSource>`.
- **ATC check-variant listing** (`/sap/bc/adt/atc/variants`, 200 on both releases) — today an LLM
  must guess the `variant` string for `SAPDiagnose action=atc`.
- **Mass syntax check** — `syntaxCheck()` already builds a list-shaped payload with one entry.
- **Table technical settings** — TABL create ships with no delivery class / data class / size
  category / buffering.
- **Dictionary activation log** — `activation/runs` is 405 POST-only; needs its own research.
- **CDS entity indexes** — `ddic/db/indexes` + `ddic/extensionindexes` exist (406, need Accept).

## Risk

Moderate, concentrated in one place. The JSON path for the five working types is unchanged (same
string, now derived from a per-entry flavor). DTSC goes from broken to working. DSFD is additive and
discovery-gated.

The real risk is the **tool-definition fixture diff** — the LLM-visible surface is frozen by
`tool-definitions-snapshot.test.ts` (playbook §1), so the regenerated fixtures must be diff-reviewed
to confirm DSFD is the *only* change.
