# Spike: generate tools.ts JSON Schema from the Zod schemas (z.toJSONSchema)

**Date:** 2026-06-12
**Status:** Spike complete — **NO-GO on full generation**; ship the sync-test fallback instead.
**Context:** PR 5 of [post-consolidation-hygiene-plan.md](../plans/2026-06-12-post-consolidation-hygiene-plan.md).
The idea (from the merged-main survey + an external review): collapse the "three-file sync"
invariant by generating the hand-written JSON Schema in `src/handlers/tools.ts` from the Zod schemas
in `src/handlers/schemas.ts` via `z.toJSONSchema()`. This is the ONLY LLM-surface-touching item, so
it was gated behind a spike + GO/NO-GO before any fixture regeneration.

## Method (empirical, zod 4.4.3)

Ran `z.toJSONSchema(SAPWriteSchema)` (the most complex tool — `superRefine` + ~17
`looseOptionalBoolean` preprocessors + 3 batch variants) and structurally diffed the output against
the frozen fixture `tests/fixtures/tool-definitions/onprem-full-textsearch-on.json` (the byte-exact
LLM surface). Scratch scripts, not committed.

## Findings — divergence inventory

| # | Divergence | Severity | Notes |
|---|---|---|---|
| **D1** | **Descriptions have no Zod home.** Generated schema: **0/53** props carry a `description`. Hand-written: **53/53**. Across all of `schemas.ts` there are only **2** `.describe()` calls (and 0 `.meta()`), vs **263** hand-written `description:` strings in `tools.ts`. | **Decisive / blocking** | The premise that descriptions live in `.describe()` and "come along for free" is **false**. The LLM-facing prose lives exclusively in tools.ts. |
| D2 | **SAPWrite-only nullable transform not reproduced.** Hand-written has 52 nullable optional props (`type: [..., "null"]`) via `makeOptionalPropertiesNullable` (applied to SAPWrite *only*, tools.ts:594). Generated: 0. | Replicable | A post-generation step could re-apply it, but it's a per-tool quirk the generator must special-case. |
| D3 | Generated adds top-level `$schema` + `additionalProperties`; hand-written has neither. | Strippable | Trivial post-processing. |
| **D4** | **`.transform()` makes `z.toJSONSchema` THROW** (`"Transforms cannot be represented in JSON Schema"`). SAPContext's `siblingMaxCandidates` (`z.coerce.number().int().transform(clamp)`) can't be generated without `{ unrepresentable: 'any' }` (→ emits `any`, losing the type). | **Blocking per-tool** | Found while building the parity test. Generation would need per-field special-casing or input/output-schema split. Reinforces NO-GO. |
| obs | **`maxResults` int-vs-number looseness.** SAPRead/SAPContext use `z.coerce.number().int()` (→ `integer`) but the hand-written schema (and the other three tools' `maxResults`, which omit `.int()`) say `number`. | Pre-existing, benign | A real minor inconsistency surfaced by the parity test; not worth an LLM-surface change to fix. The test normalizes `integer`→`number` (guards type *category*, not numeric precision). |
| — | `superRefine` (cross-field rules) silently dropped by `z.toJSONSchema`. | **Not a divergence** | Correct — those rules aren't JSON-Schema-expressible and the hand-written schema doesn't encode them either. Runtime-only, stays in Zod. |
| — | `looseOptionalBoolean` (a `z.preprocess`) → `{"type":"boolean"}`. | **Handled** | Matches the hand-written boolean type (modulo D2's nullable wrap). |
| — | Property **set** parity: 53 generated = 53 hand-written, no extras either side. | **Already perfect** | And already guarded — see below. |

## Why NO-GO on full generation

1. **D1 makes it a 263-string migration on the most sensitive surface.** "Generate from Zod" first
   requires hand-migrating all 263 LLM-facing description strings into `.describe()` calls in
   schemas.ts, byte-perfectly. That is exactly the high-risk, LLM-instruction-facing edit the spike
   was meant to de-risk — and the spike found no mechanical shortcut. Even then, tool-level prose
   (the big `SAPREAD_DESC_*` blocks) stays as constants, so the win is partial.
2. **The drift class the invariant guards is already ~covered:**
   - `schema-key-sync.test.ts` — Zod field-key set ≡ JSON-Schema field-key set (all 12 tools).
   - `registry-sync.test.ts` — JSON-Schema type enums ≡ Zod enums ≡ registry.
   - `tool-definitions-snapshot.test.ts` — the exact JSON bytes are frozen (9 variants).
   Generation wouldn't kill a *live* drift risk; it would just relocate where the schema is authored
   (and add D2/D3 quirks to replicate).
3. The one **uncovered** sliver: per-property **base-type** parity (a field flipped boolean→string in
   Zod would pass key-sync, pass the snapshot, and pass registry-sync, yet silently make Zod reject
   what the LLM is told is valid). That sliver is closeable with a ~40-line test — no generation, no
   fixture regen, no LLM-surface risk.

## Decision → ship the fallback

- Add `zod-jsonschema-parity.test.ts`: for every tool, `z.toJSONSchema(getToolSchema(...))`'s
  per-property base type ≅ the hand-written `getToolDefinitions(...)` type (modulo descriptions +
  D2 nullable + D3 extras). Closes the last drift sliver; the spike proves it currently holds.
- Update the stale `schemas.ts` header ("JSON Schema generation … is planned for a future PR") to
  record that generation was evaluated and rejected, pointing here + at the guard tests.
- Leave `tools.ts` hand-written. Revisit generation only if descriptions are ever migrated into Zod
  for an independent reason (then D1 dissolves and this dossier's math changes).
