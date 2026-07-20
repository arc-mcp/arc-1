# Token optimization — measured, 2026-07-17

Live-probed against a4h (SAP_BASIS 758) via `dist/cli.js`. Token counts are a real BPE tokenizer
(`gpt-tokenizer`, as a stand-in for Claude's — not public) unless marked `~` (= `bytes/4` estimate).

**One-line finding:** ARC-1 guards the small number and not the big one. The `tools/list` schema
(~20k tokens, one-time, guarded by CI, and *deferred entirely* for Claude Code) gets a dedicated CI
script with wire walls and ratchets. A single `SAPNavigate(references)` returns **968,609 tokens** and
has no guard at any layer.

## 1. Measurements

### 1.1 The fixed cost — tool schema (already well handled)

| Scenario | Tools | Wire bytes | ~tokens |
|---|---|---|---|
| standard-default (read-only) | 9 | 44,795 | 11,199 |
| standard-full-git | 12 | 67,951 | 16,988 |
| btp-full-git | 12 | 65,784 | 16,446 |
| hyperfocused | 1 | 898 | 225 |

Real tokenizer on the `onprem-full` fixture: **20,130 tokens** (88,807 bytes → 4.41 bytes/token).

### 1.2 The variable cost — tool results (unguarded)

Same information need, different tool path. `CL_GUI_ALV_GRID`:

| Strategy | ~tokens | vs full read |
|---|---|---|
| `SAPRead` (full source) | 135,830 | 1× |
| `SAPRead format="structured"` | **151,701** | **1.12× — WORSE** |
| `SAPRead grep=` | 2,037 | 67× cheaper |
| `SAPRead method=` | 1,362 | 100× cheaper |
| `SAPContext action="deps"` | **515** | **264× cheaper** |

`CL_ABAP_TYPEDESCR`: full 5,838 · structured 6,429 (worse) · deps 413 (**14× cheaper**).

**The documented "7-30x fewer tokens" claim for `SAPContext deps` is understated — measured 14×-264×.**

### 1.3 Real size distribution (20 ordinary SAP classes, not cherry-picked)

```
min 181 · median 5,838 · p75 16,198 · p90 55,939 · max 135,830 · mean 17,128
>25k tokens: 3/20   >50k tokens: 2/20
```

Heavy-tailed. The median read is harmless; the tail is not. **The mean single class read (17,128)
≈ the entire tool schema (20,130) that CI guards.** Worst offenders are unremarkable, everyday
classes: `CL_GUI_ALV_GRID` 135k, `CL_HTTP_CLIENT` 55.9k, `CL_GUI_FRONTEND_SERVICES` 47.9k.

### 1.4 The worst path — where-used

`SAPNavigate(action="references", type="CLAS", name="CL_ABAP_TYPEDESCR")`:

- **3,003,504 bytes = 968,609 real tokens** in one call — **4.8× Claude's entire 200k window**, 48× the schema.
- **No `maxResults` exists at any layer** — not handler, not XML request, not parse loop
  (`navigate.ts:52` → `where-used.ts:45` → `codeintel.ts:179`).
- Passing `maxResults: 5` returns a **byte-identical** result. Silently ignored.

### 1.5 `bytes/4` is sound for source, but under-counts pretty JSON

| Content | bytes/token | `bytes/4` error |
|---|---|---|
| ABAP source (`CL_ABAP_TYPEDESCR`) | 3.85 | −4% |
| ABAP source (`CL_GUI_ALV_GRID`) | 4.07 | +2% |
| Tool schema JSON (compact) | 4.41 | +10% (conservative) |
| **Where-used result (pretty JSON)** | **3.10** | **−29% (under-counts)** |

**Do not add a tokenizer dependency.** `bytes/4` is accurate for source and conservative for the
schema — the CI budgets are sound as-is. Only note that it *under-reports* pretty-printed JSON.

### 1.6 Pretty-print overhead (measured, real tokenizer)

The where-used result: pretty **968,609** → compact **711,274** = **−26.6%** (257,335 tokens on one
call). 77 `JSON.stringify(x, null, 2)` call sites across `src/handlers/`.

This is *not* the TOON/TRON trap (§2.4) — it stays JSON, only whitespace goes.

## 2. What the field says (2025–2026)

### 2.1 The schema problem is already solved for Claude Code — but not for ARC-1's other clients

[Claude Code MCP docs](https://code.claude.com/docs/en/mcp), verbatim: *"Tool search is enabled by
default. MCP tools are deferred rather than loaded into context upfront."*

So for Claude Code, ARC-1's 20k schema **never enters context**. But tool search is disabled when
`ANTHROPIC_BASE_URL` is a non-first-party host (enterprise proxies) and does not exist at all in
Copilot Studio / Gemini CLI / Cursor — which [AGENTS.md §5](../../AGENTS.md) names as target clients.

**⇒ The CI schema budget is justified, for the non-Claude clients. Keep it. But further schema
trimming is low-ROI** — [`defer_loading`](https://www.anthropic.com/engineering/advanced-tool-use)
already banks 85% for Claude Code, and 12 tools is comfortably under the **30–50 tool accuracy
cliff** Anthropic's docs name.

### 2.2 The 25,000-token client cap — this is a correctness bug, not a cost problem

[Claude Code MCP docs](https://code.claude.com/docs/en/mcp), verbatim: *"Claude Code displays a
warning when MCP tool output exceeds 10,000 tokens and limits output to 25,000 tokens by default."*

ARC-1 declares **no** `_meta["anthropic/maxResultSizeChars"]` (hard ceiling 500,000 chars). So today:

| ARC-1 returns | Claude Code shows the model | Model sees |
|---|---|---|
| where-used, 968k tokens | truncated at 25k | **2.5% of results** |
| `CL_GUI_ALV_GRID`, 135k | truncated at 25k | **~18% of the class** |

The cut lands wherever 25k tokens happens to fall, with no marker ARC-1 controls. **The model can
conclude a method does not exist because it was truncated away.** Meanwhile the 3MB still crossed
the wire from SAP. Non-Claude clients may have no cap at all — there the full 968k really does land.

Anthropic's [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
prescribes the fix directly: truncation errors should steer the agent *"toward many small and
targeted searches instead of a single, broad search."* ARC-1 already has the ideal targets to steer
to — `grep=`, `method=`, `SAPContext deps` — measured at 67×/100×/264× cheaper (§1.2).

### 2.3 Evidence grades for the techniques considered

| Technique | Savings | Grade | Verdict for ARC-1 |
|---|---|---|---|
| Deferred tool loading | 85% context, +25pp accuracy (Opus 4) | B+ vendor | Client-side; already on for Claude Code |
| Result truncation + steering | unquantified | B | **Adopt — §3.1** |
| Concise/detailed `ResponseFormat` | 72 vs 206 tok (~⅓) | B | Candidate — §3.5 |
| Tool consolidation | qualitative | B | **Already banked** (12 intent tools) |
| Programmatic tool calling | 20–40%; **−8% on τ²-bench** | B+ | **Unavailable** — MCP connector tools excluded |
| Code execution w/ MCP | "98.7%" | **C — illustrative, no methodology** | Don't chase the number |
| Sub-agent isolation | context ↓, **tokens ↑15×** | B+ | Not a cost saving |
| **TOON / token-optimized formats** | 2–18% | **A — and NEGATIVE** | **Do not adopt** |

### 2.4 The one A-grade result is a debunking

[Notation Matters (arXiv 2605.29676)](https://arxiv.org/html/2605.29676v1), Kutschka & Geiger,
2026-05-28 — the only controlled study: TOON saves 2–18% input tokens for **up to −36pp accuracy**
(89%→53% worst case). Full compression makes BFCL parallel-call categories *"collapse to near zero."*
Community claims of "TOON cuts costs 50–70%" are unsupported. Caveat: 17B–32B open-weight models
only; Claude/GPT-5 excluded.

### 2.5 The MCP spec will not help

The [2025-11-25 spec](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) has
**no tool-result pagination** (pagination exists for `tools/list` only) and **no normative guidance
on result size**. [Discussion #799](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/799)
proposes it; still open, not adopted. Worse, `structuredContent` *"SHOULD also return the serialized
JSON in a TextContent block"* — i.e. the spec's structured-output path **doubles** your tokens.

Every token discipline is the server author's to implement.

### 2.6 Prompt caching does not make schema size free

Cache reads are **0.1×**, not 0×, and bill every turn forever. Cached tokens **still consume the
context window**. And modifying tool definitions invalidates the **entire** cache (tools → system →
messages). Relevant risk: ARC-1's tool list varies by scope/feature-probe. That is fine *across*
users (separate lineages) but a probe that re-resolves **mid-conversation** would nuke the whole
cache. Not observed; worth not introducing.

## 3. Follow-ups, ranked by ROI

### 3.1 ★ One global result cap at the dispatch chokepoint

**The single highest-ROI change, and it is ~10 lines.** `dispatch.ts:741` **already computes
`resultSize` for every tool call** and already truncates for the audit preview
(`buildAuditResultPreview`, `maxLen=500`) — it just never acts on it for the LLM-facing result,
which returns untouched at `dispatch.ts:761`.

One cap there catches **every** unbounded path at once — where-used, BSP files, class reads,
transport lists, traces, lint — with no per-handler work and no new abstraction. Truncate at a
deliberate boundary and steer, per §2.2:

> Result truncated at N tokens. Narrow the request: `grep=<pattern>` (67× smaller), `method=<name>`
> (100× smaller), or `SAPContext(action="deps")` (264× smaller).

This converts a silent client-side cut into a deliberate server-side one that teaches the model the
cheaper path. **Do this before anything else in this list.**

### 3.2 ★ Bound where-used / references

968,609 tokens, no limit at any layer, and `maxResults` is silently ignored (§1.4). Even with §3.1
capping the damage, the 3MB still crosses the wire and the model still gets 2.5% of the answer.
Needs a real limit in `codeintel.ts:179` + honoring `maxResults`. Same for
`SAPContext(action="usages"/"impact")`, `SAPNavigate(completion)`, `SAPTransport(list/history)`,
`SAPLint`, `SAPDiagnose(traces)` — all currently unbounded.

### 3.3 Unknown params are silently ignored — in every mode

`SAPRead{type,name,onlyMethod:"x"}` → `status: success`, **543,318 bytes**. Zod strips unknown keys
by default; no `.strict()` anywhere in `schemas.ts`. An LLM typo silently falls back to the most
expensive possible behavior. Worst in **hyperfocused** mode, where the `params` bag has no schema at
all — so the *token-saving* mode is the one most likely to trigger the *worst* token blowup.

`.strict()` would regress GPT arg-pollution handling (#360) — a warning in the result is the cheap
version.

### 3.4 Compact the JSON

−26.6% measured (§1.6), 77 call sites, one helper. Stays JSON, so it is not the §2.4 trap. Secondary
to §3.1/§3.2 — compacting 968k still leaves 711k; **bound first, then compact**. Worth an eval pass
per Anthropic's "no one-size-fits-all" caveat on result formatting.

### 3.5 Two things that are mis-sold today

- **`format:"structured"` costs MORE than raw** — +12% / +10% measured (§1.2). It is a strict
  superset (main + testclasses + definitions + implementations + macros, all pretty-printed JSON).
  Presented as the smarter option; it is the most expensive single read in the server. Fix or document.
- **`SAPContext` on CDS does no compression at all** — `compressCdsContext` → `formatCdsResult`
  (`compressor.ts:499-503`) pushes `r.source.trim()`, i.e. **20 full DDL sources** by default. It is
  a bundler wearing a compressor's docstring. Same for interfaces: `extractInterfaceContract`
  (`contract.ts:199`) returns full source. The 264× win in §1.2 is the *class* path only.

### 3.6 Free wins

- **Declare `_meta["anthropic/maxResultSizeChars"]`** (≤500,000 chars) so legitimately-large reads
  are cut on ARC-1's terms, not blindly at 25k. Pairs with §3.1.
- **Add MCP server `instructions`** — currently absent. With tool search default-on, this is *how
  Claude decides to search for ARC-1's tools at all*. Free discoverability.
- **Keep tool descriptions <2KB** — Claude Code truncates them silently. `SAPWrite` is 19,931 bytes
  total; worth checking per-description.

### 3.7 Explicitly do NOT do

- **Do not adopt TOON/TRON** — the only A-grade evidence is negative (§2.4).
- **Do not add a tokenizer dep** — `bytes/4` is validated (§1.5).
- **Do not trim the schema further** — deferred for Claude Code, already ratcheted, under the 30–50
  tool cliff. Keep the CI guard for non-Claude clients; stop optimizing it.
- **Do not count caching as a token win** — a source cache hit returns the *full* source plus a
  `[cached:revalidated]` line. It is net token-*negative*; it buys latency and SAP load, not context.

## Reproduce

```bash
npx tsx scripts/ci/check-tool-schema-budget.ts     # schema numbers (§1.1)
node dist/cli.js call SAPNavigate --json '{"action":"references","type":"CLAS","name":"CL_ABAP_TYPEDESCR"}' \
  2>&1 | grep -o '"resultSize":[0-9]*'             # 3,003,504 (§1.4)
node dist/cli.js call SAPRead --json '{"type":"CLAS","name":"CL_GUI_ALV_GRID"}' \
  2>&1 | grep -o '"resultSize":[0-9]*'             # 543,318 (§1.2)
```
