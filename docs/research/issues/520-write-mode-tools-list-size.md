# Issue #520 — write-mode `tools/list` fails to load in Copilot-for-Eclipse

> ## ⚠️ CORRECTION (2026-06-27) — size is NOT the root cause
> Controlled A/B testing (parallel Codex investigation) **disproved** the size theory documented
> below. A clean **~74 KB** build still fails in Copilot-for-Eclipse, while a **full-schema 0.9.21
> build (all 253 enums, ~82 KB) with only the nullable unions removed** (`ARC1_SAPWRITE_NO_NULLABLE`)
> **loads fine**. The real trigger is **`makeOptionalPropertiesNullable()` (PR #363)** emitting
> `type: ["string","null"]` nullable union types for SAPWrite's optional fields — Copilot-for-Eclipse's
> MCP client **rejects nullable union types and drops the whole tool set**. Version correlation
> confirms it: 0.9.11 (works, nullableTypes=0) → 0.9.12 (first release with nullableTypes, #363) →
> 0.9.21 (fails, nullableTypes=95); read-only works because SAPWrite is absent.
>
> The size analysis below was a **confound** — payload size *and* nullable-union count both jumped
> 0.9.11→0.9.21, so the size correlation fit a non-causal pattern. It is retained as the investigation
> record. **The #520 fix** = stop emitting nullable unions in the default `tools/list` schema; keep the
> runtime `stripLlmEmptyValues` cleanup so polluted calls still work; make nullable-schema emission
> opt-in/client-specific for OpenAI strict mode; add a regression test that default schemas contain no
> `type: [...]` arrays. **PR #523** (the work in this dossier) is a **token-efficiency / schema-hygiene**
> change that does NOT fix #520 by itself.

**Status:** SUPERSEDED — original size verdict (2026-06-26) disproven 2026-06-27; see correction above.
**Original verdict (kept as record):** In write mode (`SAP_ALLOW_WRITES=true`) the MCP `tools/list`
payload has grown to ~84 KB on 0.9.21, *seemingly* exceeding a payload-size limit in Copilot-for-Eclipse
(logs `MCP server arc-1 is already running` but never `Refreshed N tools`); read-only (~52 KB) and
0.9.11 write mode (~68 KB) work. — **this size explanation was later disproven (see correction).**

**Reporter:** `@lorandmatyas` (external), S/4HANA 816, Eclipse (GitHub Copilot), stdio + Basic auth.

---

## TL;DR

- Not a config/auth bug. ARC-1 emits a **valid** `tools/list`; the consumer (Copilot's Eclipse
  `mcpGateway`) can't accept one this large. The trigger is **ARC-1 schema bloat**.
- `SAP_ALLOW_WRITES=true` adds **SAPWrite (~28 KB alone!)** + SAPActivate. Combined with read tools
  that also grew (SAPRead ~12 KB, SAPDiagnose ~11.5 KB, ~doubled since 0.9.11), the write-mode list
  is ~84 KB — over the ~68–80 KB the gateway tolerates.
- **There is already a CI guard** (`scripts/ci/check-tool-schema-budget.ts`, wired into
  `npm run check:sizes`) — but it enforces a **token estimate** (`schemaTokenEstimate`), and the
  write-mode budget is `22_000` tokens ≈ **88 KB**, set *above* the breaking point and ratcheted
  *up* with each feature. So the guard green-lit 84 KB. **The guard measures the wrong dimension and
  has no client-wire-size ceiling.** This is the future-proofing gap.
- Fix has two halves: **(A) trim** the biggest schemas back under a safe ceiling, **(B) re-aim the
  guard** at a hard compact-wire-byte ceiling (total + per-tool, every mode) that reflects real
  MCP-client limits and cannot be silently ratcheted past them.

## Live validation (2026-06-26)

Captured the actual `tools/list` JSON-RPC result over stdio from the published packages
(`npx arc-1@<ver>`), reporter's env, dummy SAP (the list is static — no SAP call needed):

| Config | Tools | compact `tools/list` bytes | Copilot-Eclipse |
|---|---|---|---|
| `0.9.21` read-only (no `SAP_ALLOW_WRITES`) | 9 | ~52 KB | ✅ loads |
| `0.9.11` write mode | 11 | ~68 KB | ✅ loads (reporter) |
| **`0.9.21` write mode** | 11 | **~84 KB** | ❌ stuck, 0 tools (reporter) |

Per-tool bytes, 0.9.21 write mode (compact `JSON.stringify(tool)`):

```
 SAPWrite    28425   <-- the lever
 SAPRead     12332
 SAPDiagnose 11497   (0.9.11: 6168 — ~doubled)
 SAPManage    6875
 SAPTransport 6769
 SAPContext   6620
 SAPSearch    2564
 SAPActivate  2467
 SAPNavigate  2246
 SAPLint      2219
 SAPQuery     1541
 TOTAL       ~83.6 KB
```

- Same JSON-Schema keywords in both versions (`enum/items/properties/required/type`) — pure
  **content bloat**, not a new/invalid construct. SAPWrite description chars 13138→14605, enum
  values 73→95; max nesting depth 9→10.
- ARC-1 produces and returns the full 84 KB list **instantly** over stdio (verified) — it is **not**
  an ARC-1 hang or a startup crash; the failure is entirely on the consumer side.
- Snapshot fixtures (`tests/fixtures/tool-definitions/*.json`) are **pretty-printed** (`JSON.stringify(…, null, 2)`),
  so e.g. `onprem-full-textsearch-on.json` = 112 KB ≈ 84 KB compact × 1.35. The **wire** size is the
  compact size; that is what the guard must measure (it already computes `schemaBytes` compact).

### The existing guard and why it failed

`scripts/ci/check-tool-schema-budget.ts` measures `schemaBytes` (compact) + a `schemaTokenEstimate`
(= bytes/4), per scenario, but only enforces three **token/count** budgets:
`schemaTokenEstimate`, `descriptionTokenEstimate`, `descriptionCount`.

- `standard-full-git` (write) budget: `schemaTokenEstimate: 22_000` → **≈ 88 KB allowed**.
- The budget comments are a history of `+200/+150` upward bumps — it grew *with* the bloat.
- No **per-tool** ceiling (a single 28 KB tool is invisible to a total-only token budget set high).
- It's framed as a **cost/token** ratchet, not a **client wire-size** limit. Wrong dimension.

## Root cause

1. **Proximate:** Copilot-for-Eclipse's MCP gateway silently rejects a `tools/list` whose payload
   exceeds ~68–80 KB (evidence: 68 KB works, 84 KB doesn't; exact limit is in closed-source
   `cls-source/dist/main.js`, not knowable, but bracketed).
2. **ARC-1's contribution (the part we own):** the write-mode tool surface bloated to 84 KB because
   the size guard caps *tokens* at a ceiling *above* real client limits and was ratcheted up per
   feature instead of forcing trims.

## Fix design (for review — Codex + maintainer)

### Part A — Trim the biggest schemas (one-time, gets us under the new ceiling)

Target: **write-mode compact `tools/list` ≤ ~64 KB** (margin below the 68 KB proven-good and well
under the 84 KB known-bad; a common client buffer boundary). Per-tool **≤ ~18 KB**.

Trim the three biggest, **without changing tool semantics or the three-file schema sync**:
- **SAPWrite (~28 KB → ~16 KB):** condense the 2177-char action description + the 1208-char
  "CLAS-ONLY…" include param + repeated type lists; move long worked examples to `docs_page/`.
- **SAPRead (~12 KB → ~8.5 KB, helps BOTH modes):** condense the exhaustive inline type catalog
  (each type's parenthetical is a paragraph); keep the type list, shorten the prose, point to docs.
- **SAPDiagnose (~11.5 KB → ~7 KB, both modes):** condense the trace_*/odata_perf/cds_sql/sql_trace_*
  action docs added since 0.9.11.

Estimated result: write ~63 KB, read ~44 KB. Every change is visible in the regenerated snapshot
fixtures (`vitest -u`) and reviewed.

### Part B — Re-aim the guard at a hard wire-byte ceiling (the durable fix)

In `check-tool-schema-budget.ts`, add and enforce **compact-byte ceilings** alongside the token
estimates (keep those — they're still a useful cost ratchet, but lower them post-trim):
- `maxTotalWireBytes` per scenario (e.g. **64_000**), enforced on `schemaBytes`.
- `maxPerToolWireBytes` (e.g. **18_000**), enforced on the largest single tool.
- Apply to **every** scenario incl. read-only (`standard-default`) and write (`standard-full-git`,
  `btp-full-git`) — both modes, both system types.
- A loud comment: *these reflect real MCP-client wire limits (Copilot-Eclipse drops ~80 KB); do NOT
  raise to make CI pass — trim the surface or move guidance to docs.* The ceiling is a wall, not a
  ratchet.
- Lower the existing `schemaTokenEstimate`/`descriptionTokenEstimate`/`descriptionCount` budgets to
  the post-trim reality in the same commit.

Optional belt-and-suspenders (decide in review): a **startup stderr warning** when the live
`tools/list` exceeds a soft threshold, naming `ARC1_TOOL_MODE=hyperfocused` as the escape hatch —
helps users whose client silently drops the list. Low cost; logs where stderr-hiding clients still
keep a file/console.

### Out of scope
- Changing tool **semantics** or removing actions. Pure verbosity reduction only.
- Working around Copilot's silent-drop (that's an upstream bug — report to
  `microsoft/copilot-for-eclipse`).
- Per-action lazy/dynamic schemas (a larger redesign; note as a future option if trimming proves
  insufficient long-term).

## Affected files

- `src/handlers/tools.ts` — trim SAPWrite/SAPRead/SAPDiagnose descriptions (the JSON Schema the LLM
  sees). Three-file sync: schemas.ts/handlers unchanged (no param add/remove — wording only).
- `scripts/ci/check-tool-schema-budget.ts` — add `maxTotalWireBytes` + `maxPerToolWireBytes`
  enforcement; lower token budgets.
- `tests/fixtures/tool-definitions/*.json` — regenerate via `vitest -u` (reviewed diff).
- `tests/unit/handlers/tool-definitions-snapshot.test.ts` — unchanged logic; snapshots move.
- (Optional) a unit test mirroring the wire-byte ceiling so it runs in `npm test` too.
- `scripts/ci/check-file-sizes.mjs` — the `src/handlers/tools.ts` line budget likely shrinks; lower it.
- Docs: `docs_page/` SAPWrite/SAPRead detail pages absorb any moved-out guidance.

## Combined finalized plan (after Codex adversarial review, 2026-06-26)

Codex confirmed the trim-+-hard-byte-ceiling approach and refined it (6 findings). Final decisions:

**Part A — Trim `src/handlers/tools.ts` (target write-mode `{tools}` wire ≤ ~60 KB, hard wall 64 KB).**
Trim SAPWrite (~28→~16 KB), SAPRead (~12→~8.5 KB), SAPDiagnose (~11.5→~7 KB). Codex F3 (what to
cut vs keep — this is the quality guardrail):
- **KEEP:** action→field routing rules; required-field sets; destructive-action warnings; the
  minimal-payload *"do not send irrelevant fields"* guidance (`tools.ts:150-160`, our anti-#360
  arg-pollution defense); the nullable-optional strict-mode backstop (`tools.ts:456-467`).
- **CUT:** duplicated enum prose already encoded in `enum`; endpoint internals (URIs, checkrun
  mechanics); multi-line worked examples; release/version anecdotes; repeated type catalogs.
- Move cut long-form guidance to `docs_page/` SAPWrite/SAPRead/SAPDiagnose pages. Regen snapshots
  via `vitest -u`, review the diff.

**Part B — Re-aim the guard (`scripts/ci/check-tool-schema-budget.ts`).**
- **F2 (HIGH):** measure `JSON.stringify({ tools: definitions })` (the `tools/list` result shape the
  client receives), not the bare array — the JSON-RPC envelope adds only tens of bytes (immaterial to
  the bracket) but the guard must budget the right shape.
- **F1:** add `maxTotalWireBytes` as a **hard wall per scenario** — write/btp-write = **64_000**,
  read-only = **56_000**, with a loud "this is a client-safety wall, do NOT raise — trim instead"
  comment. Trim aims ~4 KB under each wall.
- **F4:** add `maxPerToolWireBytes = 18_000` as a *secondary* anti-hotspot guard; fail **primarily on
  total**; always print the top-N tools by size in the report so creep is visible.
- Lower the existing `schemaTokenEstimate`/`descriptionTokenEstimate`/`descriptionCount` budgets to
  post-trim reality (stop the upward ratchet).

**Part C — Runtime startup warning (`src/server/server.ts`, ~573-610), F5.**
CI only sees built-ins (`getToolDefinitions`); plugin `Custom_*` tools are appended at runtime. After
assembling the full live `tools/list`, if its `{tools}` wire size exceeds a soft threshold (~60 KB),
`logger.warn` the size + name `ARC1_TOOL_MODE=hyperfocused` as the escape hatch. Catches the plugin
/runtime blind spot CI structurally cannot.

**Scope (F6):** the ceilings protect the *observed Copilot-for-Eclipse* failure; other clients' limits
are an untested hypothesis — document it that way, don't claim a broad multi-client win.

**Not now (noted as future options):** per-action lazy/dynamic schemas (bigger redesign); a second
soft-ratchet tier (over-engineering — the hard wall + visible top-N reporting suffices).

## As shipped (PR #523) — supersedes the target numbers above

The implemented walls landed a notch above the initial 64/56/18 KB plan, **deliberately**: hitting the
~60 KB target would have required cutting load-bearing prose (Codex F3 risk), so the trim stopped where
it only removed redundancy/examples/duplicated catalogs, and the wall was set to the **evidence-based
proven-good line** (the 0.9.11 size that loads in Copilot-for-Eclipse) rather than an arbitrary lower
number. Read-only got its own lower ceiling.

| | initial plan | as shipped (`scripts/ci/check-tool-schema-budget.ts`) |
|---|---|---|
| write/btp `{tools}` wall | 64_000 | **68_000** (0.9.11 proven-good; 84 KB known-bad) |
| read-only wall | 56_000 | **50_000** |
| per-tool wall | 18_000 | **21_000** |
| write-mode actual | ~63 KB | **66.6 KB** |
| read-only actual | ~44 KB | **43 KB** |
| SAPWrite (largest tool) | ~16 KB | **20 KB** |

Net: write-mode `{tools}` 87→66.6 KB, read 54→43 KB, SAPWrite 28→20 KB; the reporter's 11-tool config
lands ~64 KB, comfortably under the 68 KB proven-good line. A startup `logger.warn` fires once when the
live list (incl. runtime plugin `Custom_*` tools) exceeds a 60 KB soft threshold. Lower is better for
untested clients (F6), but the trim deliberately did not over-cut to chase 60 KB.

## Ruled out (earlier hypotheses)

- **Non-3-digit `SAP_CLIENT`** (`#471`, 0.9.19): a real startup throw, but reporter confirmed a
  3-digit client (`100`). Live-verified SAP doesn't zero-pad `sap-client` (758 + 816:
  `?sap-client=1`→401, `001`→200) so `#471` is correct and stays — just not this issue.
- **Copilot `activeModel is null` NPE / m2e / ADT-editor Error Log entries** — unrelated Eclipse
  noise the reporter and we both dismissed; not in the failure path.
- **better-sqlite3 native module, config-combination throw** — disproven (process starts fine with
  full write env; read mode works).
