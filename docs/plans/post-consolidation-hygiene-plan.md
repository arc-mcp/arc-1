# Post-Consolidation Hygiene & Schema-Generation Plan

**Status: Proposed — PR 1 awaiting go.** Successor to
[completed/test-split-and-typecheck-plan.md](completed/test-split-and-typecheck-plan.md) (PR #405)
and the architecture consolidation (PR #402). Sources: a 4-angle survey of merged main
@ `7a032820` (src structure / legacy remnants / test architecture / knowledge architecture) plus an
external Codex review of the candidate list — its ordering (risk-ascending: XML escaping first,
schema generation last, alias removal deferred) is adopted here.

## Process

- **One PR per point**, merged before the next starts. After each merge: a short **plan-review
  checkpoint** — re-read the next PR's section against the then-current main (rebases, new
  findings), adjust, then implement. Update this file's status lines as part of each PR.
- Every PR runs the full gate: `npm test` + `npm run typecheck` + `lint` + `validate:policy` +
  `build` + `check:sizes`, and the tool-definition fixtures stay **byte-identical** — except PR 5,
  whose entire point is an *intentional, semantically-proven* fixture regeneration.
- Release impact (release-please, `bump-minor-pre-major` + `bump-patch-for-minor-pre-major` both
  true): `refactor:`/`test:`/`docs:`/`chore:` → no release; `fix:`/`feat:` → patch (0.9.x);
  `feat!:` → minor (0.10.0).

## Baseline (main @ 7a032820, 2026-06-12)

41,262 src lines / 70,074 test lines; largest file tools.ts 1,587 (budget 1,700); zero TODO/FIXME;
suite 3,721 tests / 118 files green. The survey's *rejected* candidates (with reasons, so they are
not re-triaged): write-helpers.ts / xml-parser.ts / types.ts splits (cohesive; churn > clarity),
dispatch.ts error-tree restructure (well-factored), tools.test.ts + adt.integration.test.ts splits
(structured / sequential-by-design), AGENTS.md↔dev-guide sync guard (verified zero drift; anchors
premature), test `as any` sweep (303 instances are partial-mock plumbing, not type holes).

---

## PR 1 — `refactor(adt)`: one XML escaper (escapeXmlAttr)

**Status: DONE (branch pr1-xml-escaping).** Two commits.

Survey said 3 duplicates; it was **4** (the survey missed `escapeXmlText`). All folded onto the
shared `escapeXmlAttr`:

| Site | Form | Coverage | Output change |
|---|---|---|---|
| `xml-parser.ts:45` `escapeXmlAttr` | exported keeper, 5 importers (abapgit, codeintel, devtools, server-driven, transport) | `& < > " '` | — (keeper) |
| `ddic-xml.ts` `escapeXml` (45 calls) | private | `& " ' < >` (order-equivalent) | none |
| `write-helpers.ts` `escapeXml` (45 calls; ALSO imported by `write/create.ts`) | exported | `& " ' < >` | none |
| `devtools.ts` `escapeXmlText` (3 calls) | private | byte-identical to keeper | none |
| `refactoring.ts` `escapeXml` (10 calls) | private | **omitted `'`** | now emits `&apos;` |

**Correction to the survey/Codex framing:** the missing apostrophe in refactoring.ts is **not an
active bug** — every call site interpolates into double-quoted attributes or element text, where a
literal `'` is valid XML, so today's output is well-formed. So this shipped as `refactor:` (no
release), not `fix:`. The apostrophe escaping becomes uniform as defensive hardening.
**Commit 1** `refactor(adt): consolidate the DDIC/devtools/write XML escapers …` — the three
byte-identical folds (ddic-xml, write-helpers, devtools, + consumer write/create.ts); zero output
change. escapeXmlAttr gains a "this is THE XML escaper" doc comment (notes the separate HTML
escapers in oauth.ts/http.ts that emit `&#39;`).
**Commit 2** `refactor(adt): route change-package XML through the shared escapeXmlAttr` —
refactoring.ts + a test pinning all five entities incl. `'`.
**Gate verification:** the tests-typecheck gate caught the multi-line `escapeXml` import in
write/create.ts that a one-line grep missed — exactly the Stage-T safety net working.
**Result:** one XML escaper in src; 502 affected-suite tests green; no fixture diff.

## PR 2 — `refactor(adt)`: `withSafety()` clone safe by construction

**Status: DONE (branch pr2-withsafety).**

`client.ts` cloned via `Object.create(AdtClient.prototype)` + **6 hand-attached `defineProperty`
fields**; a forgotten field is the proven #333 crash class (runtime `undefined`), guarded only by a
comment. **Checkpoint design decision — landed stronger than the plan's sketch.** The plan proposed
a private ctor / static factory that takes each field, so a forgotten one is a *compile error*.
The shipped fix is simpler and stronger: a **one-liner**

```ts
withSafety(safety) { return Object.assign(Object.create(AdtClient.prototype), this, { safety }); }
```

`Object.create` keeps the prototype (methods + `instanceof`) while skipping the ctor (which would
build a fresh `AdtHttpClient` with a new cookie jar and break the shared session — the constraint
Codex flagged). `Object.assign` then copies **whatever own fields exist** by reference and overrides
only `safety` — so a new field is shared *automatically*. There is no re-attach list to forget at
all (eliminating the list beats guarding it). Verified: the 6 fields are all own-enumerable class
fields (TS `private`, not `#private`), no subclasses, no dynamic field assignments; Object.assign
preserves `instanceof` and reference-shares Maps/holders (Node probe + 156 client tests).
**Test:** added a **structural** guard — iterates `Object.keys(client)` and asserts every field
except `safety` is reference-identical on the clone, so it can't rot when a field is added
(mutation-proven: a non-shared field fails it). The named #333 per-field tests stay as complements.
**Docs:** AGENTS.md + dev-guide + security-model rows updated off "re-attach EVERY field" onto the
Object.assign model (incl. the `#private` caveat).
**Risk:** low — auth-critical path, but the clone semantics are byte-for-byte the same (same http,
same caches, only safety differs); existing identity tests + integration suite cover it.
Commit: `refactor(adt):` (no release).

## PR 3 — `docs:` truth pass (bounded)

**Status: planned; checkpoint after PR 2 merge.**

Scope is **current-guidance accuracy, not history rewriting** (Codex's bound, adopted):

1. Move the three known-executed plans to `docs/plans/completed/`:
   `architecture-consolidation-plan.md`, `architecture-consolidation-progress.md`,
   `test-split-and-typecheck-plan.md` — and fix the AGENTS.md "History" link that points at the
   progress file. Mark the first one's stale "Proposed — v2 for owner review" header as executed
   (PR #402).
2. Quick status triage of the other ~27 top-level plans: move ONLY those whose own header already
   says done/shipped; touch nothing ambiguous.
3. Fix references that present the deleted `src/handlers/intent.ts` as CURRENT:
   `docs_page/roadmap.md` (8 line refs — public site) and
   `docs/research/joule-2026-roadmap-feature-assessment.md` (describes the consolidation as future
   work). Frame as "implemented in the former intent.ts, split into per-tool modules in #402" —
   do not rewrite historical changelog entries.

**Acceptance:** `grep -rn "handlers/intent.ts" docs_page/ docs/research/ README.md` returns only
clearly-historical phrasing; AGENTS.md links resolve; no source changes.
**Risk:** broken links only — grep-verify all moved-file references.

## PR 4 — `test:`/`chore:` small hygiene batch

**Status: planned; checkpoint after PR 3 merge.**

One commit each:
1. `chore(tests):` rename `tests/unit/handlers/intent-rate-limit.test.ts` →
   `dispatch-rate-limit.test.ts` (it tests dispatch.ts; the name is the last "intent" in tests).
2. `test(handlers):` convert the 5 remaining `as ResolvedFeatures` casts in
   `action-policy-integration.test.ts` (lines ~218/234/249/306/434) to the
   `features()`/`featuresOff()` factory — finishing the #405 sweep (file was out of scope then).
3. `test(server):` `xsuaa.test.ts:280` hand-built Response mock → `mockResponse()` from
   `tests/helpers/mock-fetch.ts`.
4. `chore(handlers):` strip the "extracted from intent.ts (Stage B …)" provenance lines from the
   ~15 handler module headers — per the playbook, comments must not record where code came from.

**Acceptance:** suite count unchanged (rename is discovery-neutral); zero `as ResolvedFeatures` in
tests/unit/handlers; no fixture diff; full gate. **Risk:** none.

## PR 5 — Zod → JSON Schema generation (spike first, GO/NO-GO)

**Status: planned; checkpoint after PR 4 merge. The only LLM-surface-touching PR — highest rigor.**

Today `schemas.ts` (Zod, 919 lines) and `tools.ts` (hand-written JSON Schema, 1,587 lines,
263 `description:` strings) define the same 12 tool surfaces twice — the root of the "three-file
sync" invariant. Codex's complication list is real and verified: ~50 `z.preprocess`/
`looseOptionalBoolean` usages + 4 `superRefine` blocks in schemas.ts (superRefine is
runtime-only — fine; `z.preprocess` is where `z.toJSONSchema()` needs explicit input types or
overrides), feature-gated enums, BTP/on-prem variants, OpenAI-compat nullable handling, and rich
LLM-facing prose that must survive byte-for-byte.

**Phase A — spike (no behavior change, throwaway branch):** generate JSON Schema for ONE complex
tool (SAPWrite) via `z.toJSONSchema()`; write a semantic differ (deep-equal modulo key order +
formatting) against the hand-written schema; inventory every divergence class:
`looseOptionalBoolean` → must emit plain `{type:'boolean'}` (what LLMs should send, not what Zod
accepts), enum pruning parity for all 9 fixture variants, `items`/array shapes, nullability,
description placement. Output: a divergence table + **GO/NO-GO**.
**Phase B(GO):** generate `inputSchema` for all tools from the Zod schemas (per-field overrides
where preprocess obscures the wire type); tool-level prose stays as constants; regenerate the 9
snapshot fixtures **intentionally** (the one legitimate `vitest -u`), with a committed semantic
proof: a test asserting old-vs-new schema deep-equality modulo formatting, plus a reviewed fixture
diff. Three-file sync becomes two-file (registry + Zod). AGENTS.md invariant row updated.
**Phase B(NO-GO fallback):** keep hand-written tools.ts but add a **semantic sync test**
(Zod-derived schema ≅ hand-written, modulo the inventoried acceptable divergences) — the drift
class dies either way; generation can be revisited later.
**Acceptance (Codex's criteria, adopted):** preserve every description, preserve
nullable/optional-field semantics, preserve array `items`, regenerate snapshots intentionally with
semantic-comparison tests, MCP client smoke (e2e suite) green. Commit: `refactor(handlers):` if
output is semantically identical; anything user-visible beyond formatting → stop and re-plan.
**Risk:** the LLM-visible surface — bounded by the spike's GO/NO-GO and the semantic differ.

## Parked (explicit non-goals until triggered)

- **Remove deprecated `MESSAGES`/`FTG2` SAPRead aliases** — 14 minors past the "one minor release"
  promise (deprecated v0.9.0, now 0.9.14), but it is a breaking LLM-surface change → `feat!:` →
  0.10.0. **Trigger: the owner schedules a deliberate 0.10.0.** Scope when triggered: registry
  rows, two read.ts dispatch cases + warnings, tools.ts description mentions, fixtures, docs.
- **`checkJs` for `scripts/ci/*.mjs`** — the tests gate already type-checks their *exports* via
  `allowJs` inference; full checkJs needs JSDoc-typing the scripts. Revisit if a script bug slips
  through the inference gate.
