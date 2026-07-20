# Token optimization — verified plan, 2026-07-17

Every claim below was live-tested against a4h (758) or verified verbatim against vendor docs.
Evidence: [docs/research/2026-07-17-token-optimization.md](../research/2026-07-17-token-optimization.md).

## The one number that decides the whole plan

`SAPNavigate(references, CLAS, CL_ABAP_TYPEDESCR)` — 6,644 records, 968,609 real tokens:

| Strategy | tokens | verdict |
|---|---|---|
| as shipped | 968,609 | 4.8× a 200k window |
| drop empty/default fields | 725,176 (−25%) | still 3.6× a window — **useless alone** |
| + compact JSON | 574,151 (−41%) | still 2.9× a window — **useless alone** |
| **bound to 50 + total count** | **4,284 (−99.56%)** | **the fix** |

**Bounding is the only intervention that matters. Serialization tweaks are rounding errors.**
Do P1. Everything after it is optional polish.

---

## ⚠️ Reversed from the earlier recommendation: do NOT add a dispatch truncation cap

I previously recommended a global result cap at `dispatch.ts`. **That was wrong. Do not build it.**

[Claude Code MCP docs](https://code.claude.com/docs/en/mcp), verbatim:

> *"Without the annotation, results that exceed the default threshold are **persisted to disk and
> replaced with a file reference** in the conversation."*

Claude Code does **not** truncate large MCP results — it writes them to a file and hands the model a
reference it can grep. That is strictly better than truncation. A server-side cap would **replace a
grep-able full file with a pre-truncated 25k stub** — an active regression for Claude Code users.

Tested, for the record, what a blunt cap would do:

| Cut at 25k tokens | Result |
|---|---|
| JSON (where-used) | **Invalid** — `Unterminated string at position 77625`; 176/6,644 records survive |
| ABAP (`CL_GUI_ALV_GRID`) | **Silently wrong** — 26/212 methods survive; tail reads as ordinary ABAP. The model cannot tell it is incomplete and will answer "method X does not exist" |

ABAP truncation fails *quietly*, which is worse than JSON failing loudly. Neither is acceptable, and
neither is necessary: **bound the data at the source (P1) so a huge payload is never produced.**

---

## P1 — Bound the list-returning paths ★ do this first

**Verified problem.** `SAPNavigate(references)` = 968,609 tokens. **No limit exists at any layer** —
not the handler, not the ADT request XML, not the parse loop (`navigate.ts:52` → `where-used.ts:45`
→ `codeintel.ts:179`). Passing `maxResults: 5` returns a **byte-identical** result (silently ignored).
Second-worst measured: `INTF IF_SERIALIZABLE_OBJECT` = 424,471 bytes (~106k tokens).

**Benefit.** −99.56% on the worst path. Correct for *every* client, breaks no client-side handling.

**Risk — real, and it is not token cost.** Truncated impact analysis is *dangerous*. If a user asks
"what breaks if I change this?" and gets 50 of 3,412 consumers with no indication, that is a wrong
answer to a migration-safety question. `SAPContext(action="impact")` is exactly this use case.

**Mitigation (mandatory, not optional):** never return a bare truncated array. Always:

```jsonc
{ "total": 6644, "shown": 50, "truncated": true,
  "hint": "6644 references; showing 50. Narrow with packageName/type filters, or raise maxResults (max 1000).",
  "references": [ /* ... */ ] }
```

The `total` is the load-bearing field. It is what makes the sample honest.

**RESOLVED: server-side limiting is impossible. Bound client-side; expect no latency win.**

Verified 9 ways against the live system. SAP's ADT discovery declares the template as
`usageReferences{?uri}` — `uri` and nothing else — while *sibling collections in the same workspace*
declare limiting idioms (`search{?…,maxResults}`, `objecttypes{?maxItemCount,…}`,
`textsearch{?searchFromIndex,searchToIndex,…}`). Deliberate omission, not an oversight.

Every attempt returned **byte-identical 4,176,664 bytes / 13,288 refs**: `?maxResults`, `?maxItemCount`,
`?searchFromIndex&searchToIndex`, `?rowNumber/$top/limit`, body `<maxResults>`, root attr
`maxResults`, the `abap-adt-api` body shape, `objectTypeFilter`, `?filter/objectType/scope`, and a
`#start=1,1` fragment. Proof the body cannot ever carry a limit: **a bogus URI in the body returns the
identical bytes** — the body is schema-validated (empty → 400) but semantically ignored; selection is
driven 100% by `?uri=`. `marcellourbani/abap-adt-api` sends no limit either.

| Buys | |
|---|---|
| **Tokens** | **Yes, decisively** — ~750k → ~4k |
| Latency | **No** — 3,265–4,536 ms across 18 calls, flat regardless of params; it is SAP-side RIS compute |
| Wire transfer | **No** — 4.2 MB always crosses the wire |

⇒ Bound it for tokens. **Do not add a `maxResults` param expecting SAP to honor it** — slice locally.

**Two bugs found in passing (fix inside this work)**
- **`objectTypeFilter` is dead code** (`codeintel.ts:187`). SAP ignores it *and* `findWhereUsed` does
  not filter client-side either. **Confirmed live:** `objectType: "CLAS/OC"` returns byte-identical
  results (47,545 = 47,545). So `SAPNavigate(references)` / `SAPContext(usages)` **silently promise a
  filter they never perform.** Either implement it client-side (now trivial — we already hold the full
  list) or remove the param. This also invalidates any "narrow by type" hint.
- **`getWhereUsedScope` targets a 404 endpoint** — `POST …/usageReferences/scope` → *"No suitable
  resource found"* on 758, with two live callers (`structure-hierarchy.ts:183`, `cds-hints.ts:194`)
  burning round-trips on a false assumption.

**Steps**
1. Add `maxResults` (default 100, clamp `[1, 1000]` via the existing `clampSearchResults`) to
   `findWhereUsed` (`src/adt/codeintel.ts:179`), applied **client-side after parse**; thread through
   `where-used.ts:45`.
2. Wrap the response in `{total, shown, truncated, hint, references}`. **Keep `total` accurate —
   count before slicing.**
3. Add `maxResults` to `schemas.ts` + `tools.ts` for `SAPNavigate(references)` and
   `SAPContext(usages|impact)` (three-file sync).
4. Implement `objectType` filtering client-side, or delete the param. Do not leave it lying.
5. Same treatment, same shape, for the other uncapped paths: `SAPNavigate(completion)`,
   `SAPTransport(list|history)`, `SAPLint(lint)`, `SAPDiagnose(traces)`, `SAPRead(INACTIVE_OBJECTS)`.

**Tests**
- Unit: `total` reflects the full count while `references.length === maxResults`; clamp bounds.
- Unit: `maxResults` is honored (the current silent-ignore is the regression to lock out).
- Integration: `CL_ABAP_TYPEDESCR` references stay under ~5k tokens and report `total: 6644`.

**Effort.** Small–medium. One real function + a response shape + schema sync.

---

## P2 — `format:"structured"` is never smaller (fix or delete)

**Verified, n=8, 8/8 larger:**

| Class | raw | structured | delta |
|---|---|---|---|
| CL_ABAP_TYPEDESCR | 5,838 | 6,429 | +10.1% |
| CL_GUI_CONTAINER | 5,062 | 5,580 | +10.2% |
| CL_ABAP_REGEX | 1,881 | 2,192 | +16.5% |
| CL_SALV_TABLE | 3,975 | 4,763 | +19.8% |
| CL_ABAP_ZIP | 6,587 | 8,353 | +26.8% |
| CL_HTTP_CLIENT | 55,939 | 83,050 | +48.5% |
| CL_ABAP_UNIT_ASSERT | 16,586 | 42,283 | +154.9% |
| **CL_ABAP_MATCHER** | 5,118 | **91,350** | **+1,685% (18×)** |

**Cause.** `getClassStructured` (`client.ts:507`) fetches main + testclasses + definitions +
implementations + macros in parallel and returns all of them as pretty-printed JSON — a strict
superset of the full-source read. It is the single most expensive read in the server, and it is
presented to the LLM as the more sophisticated option.

**Benefit.** Removes an 18× footgun.

**Risk.** Someone may depend on it. It is opt-in and non-default, so blast radius is small.

**Steps.** Pick one:
- (a) **Cheapest:** fix the schema description in `tools.ts` — state plainly that `structured`
  returns *all* class includes and costs more than a plain read; point to `method=`/`grep=`.
- (b) **Better:** make `structured` return metadata + section *index* (names/signatures), not bodies.
  That would make the name honest and the option actually useful.
- (c) Remove it.

Recommend **(a) now, (b) as a follow-up** — (a) is a description edit; (b) is a real feature.

**Tests.** Add a unit assertion that `structured` bytes ≤ raw bytes if (b) is done — the ratchet
that would have caught this.

---

## P3 — `SAPContext(deps)` does not compress CDS — DEFERRED, measured not worth it

> **Status 2026-07-17: deferred out of PR 1 on measurement.** The finding below is factually correct
> — CDS deps really does emit full DDL — but the live payloads are small: `I_CURRENCYSTDVH` 305
> tokens, `I_COUNTRY` 959, `I_CALENDARDATE` 2,113. At 3.7× that saves ~1,500 tokens on the worst
> case, against the ~964,000 P1 saved. It is ~0.15% of the value, carries the highest semantic risk
> in the set (dropping joins/annotations from a view's DDL), and needs schema headroom that does not
> exist (20 bytes left under the wall). CDS DDL is simply small next to ABAP class source — which is
> why the class path shows 264× and this one does not. Revisit as its own PR if a real analytical
> model with 20+ deps proves otherwise.

**Verified by inspection.** For a class, `deps` returns the `PUBLIC SECTION` only — real compression,
measured **14×** (`CL_ABAP_TYPEDESCR` 5,838 → 413) and **264×** (`CL_GUI_ALV_GRID` 135,830 → 515).
For CDS, `compressCdsContext` → `formatCdsResult` (`compressor.ts:499-503`) pushes `r.source.trim()`
— the **full DDL** of every dependency: annotations, joins, associations, casts. Confirmed by reading
the live output for `I_CURRENCYSTDVH`. Same for interfaces: `extractInterfaceContract`
(`contract.ts:199`) returns full source.

So the tool description's *"one compact response vs N SAPRead calls (7-30x fewer tokens)"* is
**accurate for CLAS and false for DDLS** — for CDS it saves round-trips, not tokens.

**Benefit, measured.** The compressed form already exists: `SAPRead(DDLS, include="elements")`
returns the field catalog — `I_CURRENCY` **278 → 76 tokens (3.7×)**. With `maxDeps` default 20, a
20-dep view goes ~5,560 → ~1,520 tokens.

**Risk.** The field catalog drops joins/annotations. For *"what fields can I select"* that is right;
for *"what does this view mean"* it loses semantics. Ship it as the default with an escape hatch
(`includeSource: true`), not as a silent downgrade.

**Steps**
1. Reuse `extractCdsElements` inside `compressCdsContext` instead of `r.source.trim()`.
2. Add `includeSource?: boolean` (default false) to restore today's behavior.
3. Fix the `SAPContext` description: the 7-30× claim applies to CLAS; state what DDLS returns.
4. Consider the same for interfaces (`contract.ts:199`) — signatures over full source.

**Tests.** Unit: CDS deps output contains the field catalog and *not* `define view`; `includeSource:
true` restores the DDL.

**Effort.** Small — the compressor exists, it is just not wired into the CDS path.

---

## P4 — Add MCP server `instructions`

**Verified.** The SDK supports it (`server/index.d.ts:15`, `instructions?: string`). ARC-1's
`new Server({name:'arc-1',version:VERSION},{capabilities:{tools:{}}})` (`server.ts:669`) omits it.

**Why it matters now.** Tool search is default-on in Claude Code — tools are *deferred*, and Claude
Code's docs say server instructions are how Claude decides to *search for* your tools at all.

**Benefit.** Discoverability when deferred. **Not free** — instructions sit in context (~100 tokens),
so keep them short: what ARC-1 is, when to reach for it, and the token-cheap paths
(`SAPContext deps` → `grep=` → `method=` → full read).

**Risk.** Low. Costs ~100 tokens; wasted if the client ignores it (harmless).

**Steps.** Add a ≤1KB `instructions` string at `server.ts:669`. Keep under 2KB — Claude Code
truncates server instructions and tool descriptions silently at 2KB.

**Tests.** Assert it is present, non-empty, and <2KB (the truncation wall).

---

## P5 — Unknown params are silently ignored (every mode)

**Verified.** No `.strict()` anywhere in `schemas.ts`; Zod strips unknown keys by default.

```
SAPRead {type:CLAS, name:CL_GUI_ALV_GRID, onlyMethod:"refresh_table_display"}
  -> status: success, 543,318 bytes
```

The LLM asked for one method, got the whole class, and was told nothing. Worst in **hyperfocused**
mode, where the `params` bag has no schema at all — so the *token-saving* mode is the one most likely
to trigger the *worst* blowup.

**Benefit.** Turns a 136k silent dump into a corrected call.

**RESOLVED: the #360 conflict is ASSUMED, not real. `.strict()` is safe at the top level.**

The actual GPT payloads are in the **PR #363** thread (not the issue body), from a live OpenCode+GPT
session. Replayed through the built Zod schema:

| | DDLS update | DOMA create |
|---|---|---|
| Keys GPT sent | 47 | 47 |
| **Unknown keys** | **0** | **0** |
| `.strict()` verdict | **would still PASS** | **would still PASS** |

The pollution is **known keys with empty/wrong-typed values** (`method=`, `group=`, `length=0`,
`signExists=false` …) — exactly what `stripLlmEmptyValues` already handles. `.strict()` rejects only
*unknown* keys, so it would have rejected **zero** of #360's pollution. The two are orthogonal axes:
#360 = *value* normalization; `.strict()` = *key* rejection. The #360 design doc never mentions
unknown keys. And the mechanism explains why it cannot occur: **OpenAI strict mode requires
`additionalProperties: false`, so the model physically cannot emit an unknown key.**

**The one real risk found.** `batchObjectSchemaOnprem` items have 36 keys vs the 56-key top level, and
#360 documents top-level keys (`activate`, `dryRun`, `include`, `lintBeforeWrite`) **leaking into
items**. Item-level `.strict()` *would* regress. ⇒ **Top-level strict = safe; item-level strict = do not.**

**Options**
- **A. `.strict()` at the top level** — rejects before the SAP call. The only universal prevention.
- **B. Warn-only** — **rejected.** It executes normally, so the 543KB dump still lands in context;
  the warning arrives *after* the token burn. It annotates the damage instead of preventing it.
  (Keep its one good idea — fuzzy-matching the closest param — as text in A's error message.)
- **C. `additionalProperties: false`** in `tools.ts` — advisory only (Claude's default tool use is
  unconstrained), so insufficient alone, but zero-cost and worth shipping alongside A. Note the
  inconsistency: **ARC-1 already requires `additionalProperties: false` from third-party plugin
  manifests (`manifest-interpreter.ts:92`) while setting it on none of its own 12 tools.** It is also
  a prerequisite for OpenAI strict-mode compat.

**Recommend A + C.** Scope `.strict()` to the top-level `z.object()` (before `.superRefine`, which
returns a ZodEffects) and leave `batchObjectSchema*` non-strict.

**Tests.** Unit: `onlyMethod` → rejected with an error naming the key and suggesting `method`; the
**real #360 payloads from PR #363** (47 keys, 0 unknown) still pass — that is the regression test
that proves the conflict is absent; a polluted `batch_create` still passes (item-level not strict).

---

## P6 — Serialization hygiene — SHIPPED, and the accuracy gate was finally run

> **Accuracy eval, 2026-07-17 — no measurable cost.** Subject: GPT-5 via `codex exec`. Four real
> ARC-1 payloads (where-used 25 refs, transport list 12, search 18, DEVC 20), 18 questions with
> programmatic ground truth, identical questions/payload/order per arm — only whitespace differs.
> Payload text embedded raw in the prompt, exactly as a tool result reaches a model (no Read tool,
> which would re-format compact JSON and confound the arms).
>
> | arm | score |
> |---|---|
> | pretty | **18/18 (100%)** |
> | compact | **18/18 (100%)** |
> | | **+0.0pp** |
>
> Nine of the 18 required multi-record traversal — filter-and-count across 25 references, summing
> `objectCount` across 12 transports, "the LAST object in the array" — i.e. exactly the cases where
> indentation might plausibly help track structure. All correct in both arms.
>
> **Limitation, stated plainly: this is a ceiling effect.** Both arms scored 100%, so the eval has no
> headroom and can only rule out a *large* effect, not a subtle one. To detect a few points of
> degradation the questions would need to be hard enough that the pretty arm drops below 100%.
>
> **Two harness bugs worth remembering**, because the first run *looked* like a clean result:
> it scored **0/18 vs 0/18** — a perfect "tie" that was really `codex exec` blocking on a non-TTY
> stdin ("Reading additional input from stdin…") and answering nothing. `execFile` silently ignores
> a `stdio` option, so closing stdin needs a real shell (`< /dev/null`). A broken eval and a null
> result are indistinguishable from the summary line alone — check the parse rate before the score.

## P6 — Serialization hygiene — SHIPPED (PR 2)

> **Status 2026-07-17: done.** One `toolJson()` helper; 86 sites across 11 handler modules via a
> bounded codemod. Measured live on already-bounded results: where-used 11,856 → 8,781 (−26%),
> transport 5,689 → 3,581 (−37%), DEVC 5,372 → 4,404 (−18%), search 2,922 → 2,472 (−15%).
> **Field pruning rejected on measurement:** dropping empty strings adds only 7.6% over compaction
> alone, and dropping `""`/`0`/`false` removes `isResult:false` (which separates a real where-used
> hit from a structural tree node) and `line:0` (meaning "no line info") — absent ≠ false.
> The "gate on an eval" caveat below stands: accuracy was reasoned about, not A/B tested.

**Verified but small.** 77 `JSON.stringify(x, null, 2)` sites across `src/handlers/`.

| Result | pretty → compact |
|---|---|
| SAPSearch (20 hits) | 1,167 → 987 (−15.5%) |
| SAPRead DEVC (30) | 1,248 → 1,023 (−18.1%) |
| SAPNavigate refs | 11,886 → 9,359 (−21.3%) |

Honest range: **15–21% on typical results** (the −26.6% I first quoted came from the pathological
deeply-nested case). Field pruning (`snippet:""`, `line:0`, `isResult:false` are serialized for every
record) adds ~25% on record-heavy results.

**Risk.** Accuracy impact is **unmeasured**. Anthropic's guidance on result format is explicitly
eval-driven ("no one-size-fits-all"). This is *not* the TOON trap (it stays JSON), but it is also not
free of doubt. Human-readability of CLI output drops.

**Steps.** One shared `toolJson()` helper; swap the 77 sites; prune empty/default fields at the
serializer. **Gate on an eval** comparing tool-call accuracy pretty vs compact on a fixture set.

**Do not start this before P1.** −41% on a 968k result is still 574k.

---

## Explicitly NOT doing

| | Why |
|---|---|
| **Dispatch truncation cap** | Breaks Claude Code's persist-to-disk, which is better than anything we can do server-side. Tested: corrupts JSON, silently mutilates ABAP |
| **TOON / token-optimized formats** | Only controlled study ([arXiv 2605.29676](https://arxiv.org/html/2605.29676v1)) is negative: 2–18% saved for up to **−36pp accuracy** |
| **Tokenizer dependency** | `bytes/4` validated: −4%/+2% on ABAP source, +10% (conservative) on schema JSON. Only caveat: it *under*-counts pretty JSON by 29% |
| **Further schema trimming** | Deferred entirely for Claude Code (tool search default-on); 12 tools is under the 30–50 tool accuracy cliff; already ratcheted in CI. Keep the guard for Copilot Studio / Gemini / Cursor — but stop optimizing it |
| **Counting cache as a token win** | A source cache hit returns the **full** source plus a `[cached:revalidated]` line — net token-*negative*. It buys latency and SAP load, not context |
| **`_meta["anthropic/maxResultSizeChars"]`** | Raises the persist-to-disk threshold — i.e. pushes *more* into context. The opposite of what we want. Revisit only if persist-to-disk proves worse than inline for a specific tool |

## Suggested order

| | Item | Win | Effort | Risk |
|---|---|---|---|---|
| 1 | **P1** bound where-used + friends | **−99.56%** | S–M | Truncated impact analysis → mitigated by mandatory `total` |
| 2 | **P2(a)** fix `structured` description | removes an 18× footgun | minutes | none |
| 3 | **P5(A+C)** top-level `.strict()` + `additionalProperties:false` | prevents 136k typo dumps | S | none top-level (proven); **do not** apply to batch items |
| 4 | **P3** CDS deps → field catalog | 3.7× | S | loses joins/annotations → `includeSource` escape hatch |
| 5 | **P4** server `instructions` | discoverability | one line | ~100 tokens of context |
| 6 | **P6** serialization hygiene | 15–21% | M | accuracy unmeasured → gate on eval |

P1 is the only item that changes the outcome. 2–5 are cheap correctness wins worth taking while
in the area. P6 is optional and should be last.

## PR sequencing

Two measured constraints drive this — neither is negotiable:

**1. The schema budget has 49 bytes of headroom.** `standard-full-git` = 67,951 / 68,000 against
`WRITE_WIRE_WALL`, which the guard documents as *"Do NOT raise them — trim the schema instead."*
Measured cost of the planned additions:

| Addition | Cost |
|---|---|
| `additionalProperties: false` × 12 tools (P5-C) | **+348 bytes** |
| `maxResults` on SAPNavigate + SAPContext (P1) | **+328 bytes** |
| both | +676 bytes vs **49 available** — busts the wall by ~627 |

⇒ **A trim must land first (or in the same PR).** Descriptions are 12,240 of 16,988 tokens (**72% of
the schema**), so the room exists — the guard's own prescribed remedy is to trim descriptions and move
long guidance to `docs_page/`.

**2. The tool-definition fixtures are frozen.** Any change to `tools.ts` regenerates all 9
`tests/fixtures/tool-definitions/*.json`. Two concurrent schema-touching PRs conflict on 9 JSON files.
⇒ **schema-touching work should be combined, or landed strictly sequentially with a rebase.**

### Recommended: 3 PRs

| PR | Contents | Type | Why this boundary |
|---|---|---|---|
| **1** | Trim descriptions → free ≥1KB; move long guidance to `docs_page/` | `refactor:` (no release) | **Gate.** Everything else red-CIs without it. Pure trim, no behavior change — reviewable as a clean fixture diff on its own |
| **2** | **P1** bounding + `objectType` fix + `getWhereUsedScope` removal + **P5** `.strict()`+`additionalProperties` + **P2** description + **P3** CDS catalog + **P4** instructions | `feat:` | All schema-touching → **one** fixture regen, one budget reconciliation, one review of the frozen surface. This is the whole value |
| **3** | **P6** compact/prune serialization | `refactor:` (no release) | Eval-gated + 77 mechanical sites. Mixing it in would bury PR 2's behavior diff and make revert all-or-nothing |

### Could be 2

Fold PR 1 into PR 2 (trim and add in one commit, ending green). Costs you a fixture diff that mixes
shrinking descriptions with new params — harder to review, but legitimate. **Do not go below 2:** P6
must stay separate.

### What must never combine

- **P6 with anything.** Different revert unit (accuracy risk), `refactor:` vs `feat:`, and a 77-file
  mechanical diff hides real changes.
- **Do not raise `WRITE_WIRE_WALL` to dodge the trim.** The guard exists for this exact moment.

### Bundling risk, stated honestly

PR 2 bundles the one change that can reject previously-accepted calls (`.strict()`) with the 99.56%
win (bounding). A client breakage would force reverting both. **Accepted because `.strict()`'s risk is
measured, not assumed:** the real #360 payloads carry 47 keys and **0 unknown keys**, and OpenAI strict
mode *cannot* emit unknown keys. If that evidence is ever contradicted, peel P5 into its own PR — it is
the natural fracture line.

## Scorecard — how each original claim survived verification

| Claim | Verdict |
|---|---|
| Global dispatch cap fixes everything | **REVERSED** — Claude Code persists to disk; a cap would regress it |
| Blunt truncation is safe | **REFUTED** — corrupts JSON; *silently* mutilates ABAP (26/212 methods) |
| where-used is unbounded | **CONFIRMED** — 968k tokens; `maxResults` silently ignored |
| where-used can be limited server-side | **REFUTED** — 9 variants byte-identical; tokens-only win |
| `format:"structured"` costs more | **CONFIRMED** — 8/8, up to +1,685% |
| CDS `deps` does not compress | **CONFIRMED** — emits full DDL; catalog is 3.7× smaller |
| `objectType` filter works | **REFUTED** — dead code; byte-identical results |
| `.strict()` would break #360 GPT clients | **REFUTED** — 47 keys sent, **0 unknown**; conflict was assumed |
| Pretty-print costs 26.6% | **REVISED** — 15–21% on typical results |
| `bytes/4` is accurate | **CONFIRMED** — −4%/+2% on source; under-counts pretty JSON by 29% |
