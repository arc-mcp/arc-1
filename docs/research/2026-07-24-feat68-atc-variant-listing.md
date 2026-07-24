# FEAT-68 — ATC check-variant listing dossier

> Live-verified 2026-07-24 on **a4h 2023 (758)** and **a4h-2025 (816)**.
> Independent repo corroboration from `~/DEV/arc-1-lsp` (adt-ls ships a `list_atc_variants` tool) and
> `~/DEV/mcp-abap-adt-fr0ster` discovery capture.

## Goal

Let an LLM discover which ATC check variant to pass to `SAPDiagnose action=atc` — today the `variant`
param is a free string the model has to guess, or it falls back to the system default *whose name it
cannot see*.

## The "200 ≠ content" trap (caught in Phase 1)

The earlier roadmap note said "`/atc/variants` returns 200 on both releases" — implying a usable
list. **It returns 200 with `<nameditem:totalItemCount>0` when called bare** — an EMPTY list. The
endpoint is a **named-item search that requires a filter**. This is exactly the status-not-content
trap; a plan built on the bare 200 would have shipped an always-empty listing.

## Verified ADT contract (live, content-checked)

### 1. List variants — `GET /sap/bc/adt/atc/variants?name=<pattern>`

| Aspect | Value | Evidence |
|---|---|---|
| Accept | `application/vnd.sap.adt.nameditems.v1+xml` **→ 200** (Phase-3 re-check, 758+816), also `application/xml`/`*/*`; `atom+xml` and `atc.variants.v1` → **406** | live |
| Required query | `name=<pattern>` (`*` = all). **Filter is honored** | `name=*`→215, `name=ZABAP*`→1, `name=ABAP_CLOUD*`→4, `name=ZZZ_NO_SUCH*`→0 (816) |
| Response root | `<nameditem:namedItemList>` ns `http://www.sap.com/adt/nameditem` | live body |
| Count element | `<nameditem:totalItemCount>` | live |
| Item shape | `<nameditem:namedItem><nameditem:name>X</nameditem:name><nameditem:description>Y</nameditem:description><nameditem:data/></nameditem:namedItem>` | live |
| Volume | **758 → 184 variants, 816 → 215** | live |
| Discovery template | `/atc/variants{?maxItemCount,data}` | fr0ster `adt-discovery.xml:4504` (note: `name` also works live; `maxItemCount` to cap — verify in Phase 3) |

Sample (816): `ABAP_CLOUD_DEVELOPMENT_3TIER` → "Variant 4 Cloud Development with 3 Tier Extensibility Model".

### 2. System default — `GET /sap/bc/adt/atc/customizing`

| Aspect | Value | Evidence |
|---|---|---|
| Accept | `application/xml` | live 200 both releases |
| Root | `<atc:customizing>` ns `http://www.sap.com/adt/atc` | live |
| Default variant | `<property name="systemCheckVariant" value="ZABAP_CLOUD_DEVELOPMENT"/>` | live both releases |

This is the name ATC uses when `checkVariant` is empty — adt-ls decompile confirms `runCheck` with an
empty variant calls `getSystemDefaultCheckVariant()` server-side (`arc-1-lsp` capability map). So the
value of surfacing it is **transparency**, not behavior change: the LLM can see/report the default.

### Not the endpoint (disambiguation)
- `/atc/checkvariants` (singular collection, `chkvv4+xml`) → **400 uriMappingError** on a bare GET —
  it's the editable CHKV *workbench object* CRUD path, not a listing. Don't conflate.
- Repository search `objectType=CHKV` also returns variant objects, but `/atc/variants` is the
  purpose-built, description-carrying list. Prefer it.

## Design (recommended — confirm in plan)

A dedicated read action, mirroring adt-ls's own `list_atc_variants` tool:

`SAPDiagnose action=atc_variants` → JSON `{ systemDefault: "ZABAP_CLOUD_DEVELOPMENT", filter, count,
variants: [{ name, description }] }`. **As shipped: the existing `variant` param doubles as the
name filter** (default `*`) — no new `filter` property was added. The list uses
`Accept: application/vnd.sap.adt.nameditems.v1+xml`.

- Combines both endpoints: customizing (default) + variants list (filtered by `name`, default `*`).
- Read-only → `data`? No — pure ADT read, `read` scope (same as `action=atc`'s reads). No new safety surface.
- Reuses the existing `namedItem` parser precedent in `src/adt/transport.ts`.

**Budget note:** FEAT-68 branches from **`main`** (independent of #604), so its budget baseline is
main's, not the #604 branch's 14-byte figure. A new `SAPDiagnose` action adds an enum value + a short
description clause. Measure on main; if it doesn't fit, trim the SAPDiagnose description (it has room
vs. SAPWrite). The listing itself is high-value/low-bytes.

Alternative considered & rejected: fold into `action=atc` error hints only (near-zero surface) — but
a dedicated discovery action is what adt-ls does and is genuinely more useful (proactive, not
reactive). Keep the option open if budget is tight on main.

## Affected ARC-1 files

| File | Change |
|---|---|
| `src/adt/devtools.ts` | `listAtcVariants()` (GET `/atc/variants?name=`) + `getAtcSystemDefaultVariant()` (GET `/atc/customizing`) |
| `src/adt/xml-parser.ts` | parse `<nameditem:namedItemList>` (name+description) and `<atc:customizing>` `systemCheckVariant` |
| `src/handlers/diagnose.ts` | `action=atc_variants` case |
| `src/handlers/schemas.ts`, `tools.ts` | new action enum value + description (reuses existing `variant` param as the filter; 3-file sync) |
| `src/authz/policy.ts` | `SAPDiagnose.atc_variants` → `read` scope |
| `tests/unit/adt/devtools.test.ts` (or new), `tests/unit/handlers/diagnose*.test.ts` | parser + handler tests with the live fixture |
| `tests/fixtures/tool-definitions/*.json` | regenerate (new action) |
| `docs_page/tools.md`, `docs/dev-guide.md`, `docs_page/roadmap.md` | document; mark FEAT-68 done |

## Branching

Independent of #604 → **branch from `origin/main`**. Clean standalone PR.

## Phase-1 exit gate — all YES
- [x] Exact endpoints + verified response **content** live (item shape, filter honored, default value)
- [x] Checked adt-ls (has `list_atc_variants`), fr0ster (discovery), eclipse-adt (worklist accept), mcp-abap-adt (none)
- [x] Per-release: 758 + 816 both return the list + default (184 / 215 variants)
- [x] Every affected ARC-1 file listed
- [x] Written here with cited evidence

## Open questions for the plan
- New `atc_variants` action vs. `SAPRead type=ATC_VARIANTS` — recommend the SAPDiagnose action (ATC is a diagnose concern).
- Verify `maxItemCount` caps results (content check) in Phase 3; confirm `name` vs `data` param naming holds on 758.
- Measure the real byte cost on main before committing to a new action.
