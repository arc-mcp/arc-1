# LLM Evals

End-to-end tool-selection evals for the ARC-1 MCP tool surface. The harness
runs two shapes of eval against your scenarios:

- **`claude-code` (default)** — integration-level via Claude Code CLI.
  Spawns `claude -p` per scenario with ARC-1 as an **stdio** MCP server.
  Keeps Claude's full native toolset alongside ARC-1. Bills to
  `ANTHROPIC_API_KEY`. Scoring ignores native tool noise.
- **`cursor`** — integration-level via Cursor CLI. Same shape as
  `claude-code`, but runs against your Cursor subscription (no API key).
  Writes `.cursor/mcp.json` into a tempdir to register ARC-1. On first
  use you'll need to approve the MCP server once via `cursor-agent` — or
  reuse an already-approved ARC-1 entry from your global
  `~/.cursor/mcp.json` (scoring is server-name-agnostic).
- **`ollama` / `anthropic`** — isolated routing. The harness drives the
  model directly with only ARC-1 tools exposed, running an agentic loop
  with either mock or live MCP responses. Good for model comparison and
  offline runs; less realistic than the integration modes.

Either way the point is to catch regressions in **how LLMs route intent
through our tool descriptions** — the same class of bug we found in FEAT-33
where LLMs text-scanned `DDDDLSRC` via `SAPQuery` instead of calling
`SAPContext(action="impact")`.

---

## TL;DR

```bash
# One-time: build ARC-1 so the stdio MCP server spawns instantly.
# Without dist/, the fallback `npx tsx` cold-start can miss Claude's first
# turn and you'll see "No ARC-1 MCP tools were called".
npm run build

# Default: Claude Code CLI + ARC-1 as stdio MCP. Needs `claude` + ANTHROPIC_API_KEY.
npm run test:eval

# Just one feature bucket (CLI flag)
npm run test:eval -- --file context-impact

# …or via env var, whichever you prefer
EVAL_FILE=context-impact npm run test:eval

# Integration eval via Cursor subscription (no API key)
npm run test:eval -- --provider cursor --file context-impact

# Isolated routing eval with Ollama
npm run test:eval -- --provider ollama --file context-impact

# Isolated routing eval with Anthropic API (no Claude Code)
npm run test:eval -- --provider anthropic --file context-impact
```

All configuration lives in `.env` (copy `.env.example`). CLI flags override
env vars for quick one-offs. The harness fails loudly — missing `claude`
CLI, missing `ANTHROPIC_API_KEY`, unreachable Ollama — rather than
silently skipping.

### CLI flags

Every `EVAL_*` env var has a flag equivalent. Pass them after `--`:

| Flag               | Env var               | Example                                    |
| ------------------ | --------------------- | ------------------------------------------ |
| `--file`           | `EVAL_FILE`           | `--file context-impact,read-basic`         |
| `--scenario`       | `EVAL_SCENARIO`       | `--scenario cds-impact-blast-radius-natural` |
| `--tag`            | `EVAL_TAG`            | `--tag feat-33,cds-impact`                 |
| `--category`       | `EVAL_CATEGORY`       | `--category context`                       |
| `--backend`        | `EVAL_BACKEND`        | `--backend live`                           |
| `--provider`       | `EVAL_PROVIDER`       | `--provider anthropic`                     |
| `--model`          | `EVAL_MODEL`          | `--model claude-haiku-4-5-20251001`        |
| `--mcp-url`        | `EVAL_MCP_URL`        | `--mcp-url http://localhost:3000/mcp`      |
| `--ollama-url`     | `OLLAMA_BASE_URL`     | `--ollama-url http://remote-gpu:11434`     |
| `--threshold`      | `EVAL_PASS_THRESHOLD` | `--threshold 0.7`                          |

Both `--flag value` and `--flag=value` forms work. Unknown flags are
forwarded to vitest, so `--bail`, `--reporter verbose`, etc. still work.

---

## Configuration (`.env`)

```bash
# Provider: claude-code (default), ollama, or anthropic.
EVAL_PROVIDER=claude-code

# ── claude-code (default) ─────────────────────────────────────────────
# Spawns `claude -p` per scenario with ARC-1 as an stdio MCP server.
# Needs: `claude` CLI + ANTHROPIC_API_KEY (bills to API, not subscription).
# The harness writes a throwaway .mcp.json pointing at `tsx src/index.ts`
# and forwards SAP_* / TEST_SAP_* env vars into the spawned server.
ANTHROPIC_API_KEY=sk-ant-...
# EVAL_MODEL=claude-haiku-4-5-20251001       # default
# EVAL_MODEL=claude-sonnet-4-5-20250929      # stronger/slower

# ── Ollama ────────────────────────────────────────────────────────────
# EVAL_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434
# EVAL_MODEL=qwen3.5:9b

# ── Anthropic (isolated routing, no Claude Code) ──────────────────────
# EVAL_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...
# EVAL_MODEL=claude-haiku-4-5-20251001

# ── Backend (ollama/anthropic only — claude-code is always "live") ────
# mock = replay scenario.mockResponses (offline)
# live = call a real ARC-1 MCP server at EVAL_MCP_URL
# EVAL_BACKEND=mock
# EVAL_MCP_URL=http://localhost:3000/mcp

# ── Scoring ───────────────────────────────────────────────────────────
EVAL_PASS_THRESHOLD=0.5
```

### How `claude-code` mode scores

Claude Code runs its own agentic loop. In the stream we see both native
tool calls (`Read`, `Bash`, …) and ARC-1 calls (`mcp__arc1__SAPContext`,
`mcp__arc1__SAPRead`, …). We strip the `mcp__arc1__` prefix and score
**only the ARC-1 calls** against `scenario.optimal` / `acceptable` /
`forbidden`. A scenario fails if:

- the LLM made zero ARC-1 tool calls (ignored the MCP server), or
- the first ARC-1 call was in `forbidden`, or
- no optimal/acceptable match for the first ARC-1 call.

Native tool calls neither help nor hurt — they're realistic noise (the
LLM reading local files, running `ls`, etc.).

### Default models

| Provider  | Default                         | Why                                               |
| --------- | ------------------------------- | ------------------------------------------------- |
| ollama    | `qwen3.5:9b`                    | Best tool-calling quality / latency balance       |
| anthropic | `claude-haiku-4-5-20251001`     | Current Haiku; fast + strong at tool calling      |

Tested Ollama models (any with tool calling works — set `EVAL_MODEL`):

| Model          | Tool calling | Notes                                            |
| -------------- | ------------ | ------------------------------------------------ |
| `qwen3.5:9b`   | ✅           | Default. Fast.                                   |
| `qwen3.5:27b`  | ✅           | Better disambiguation across 11 tools; slower.   |
| `gemma4:31b`   | ⚠️           | Heavy; only if you've confirmed tool calling.    |

### Fail-hard behavior

The harness throws during `beforeAll` when:

- `EVAL_PROVIDER=ollama` but `OLLAMA_BASE_URL` is unreachable
- `EVAL_PROVIDER=ollama` but `EVAL_MODEL` is not installed (`ollama list`)
- `EVAL_PROVIDER=anthropic` but `ANTHROPIC_API_KEY` is unset
- `EVAL_BACKEND=live` but the MCP server `/health` check fails

This is deliberate. Silent skips hide real misconfiguration.

---

## Directory layout

```
tests/evals/
├── README.md                  ← you are here
├── llm-eval.test.ts           ← vitest entry — loops scenarios + persists results
├── harness.ts                 ← agentic loop + tiered scoring
├── live-backend.ts            ← routes tool calls to a real MCP server
├── types.ts                   ← EvalScenario, LLMProvider, result shapes
├── providers/
│   ├── ollama.ts              ← /v1/chat/completions (OpenAI-compatible)
│   └── anthropic.ts           ← /v1/messages
└── scenarios/
    ├── index.ts               ← aggregator — SCENARIO_FILES, ALL_SCENARIOS
    ├── read-basic.ts          ← PROG/CLAS/INTF/FUNC/CDS/TABL/DOMA/table-contents
    ├── search.ts              ← SAPSearch object + source-code
    ├── context-deps.ts        ← SAPContext(action="deps") forward dependencies
    ├── context-impact.ts      ← SAPContext(action="impact") — FEAT-33 blast radius
    ├── write.ts               ← SAPWrite edit_method/create
    ├── diagnose.ts            ← SAPDiagnose syntax/unittest/dumps
    ├── query.ts               ← SAPQuery free SQL
    ├── activate.ts            ← SAPActivate single + RAP batch
    ├── manage.ts              ← SAPManage features/probe
    ├── navigate.ts            ← SAPNavigate where-used
    ├── lint.ts                ← SAPLint local abaplint
    └── transport.ts           ← SAPTransport list/get/release
```

One file per feature bucket. Scenario ids are globally unique (enforced by
`scenarios/index.ts` at import time) so every filter knob is unambiguous.

---

## Filtering (precedence: high → low)

| Env var           | Example                                 | Effect                                             |
| ----------------- | --------------------------------------- | -------------------------------------------------- |
| `EVAL_SCENARIO`   | `cds-impact-blast-radius-natural`       | Run a single scenario by id                        |
| `EVAL_FILE`       | `context-impact,read-basic`             | Run scenarios from these buckets (comma-separated) |
| `EVAL_TAG`        | `feat-33,cds-impact`                    | Run scenarios that carry ANY of these tags         |
| `EVAL_CATEGORY`   | `context`                               | Legacy category filter (one value)                 |
| _(none)_          | —                                       | Run everything                                     |

Filters combine with AND: a scenario must pass every filter you set.
Non-matching scenarios show in the reporter as `↓ skipped`, so the full
matrix is always visible.

---

## Backends

### `EVAL_BACKEND=mock` (default)

- Each scenario supplies `mockResponses: { "SAPRead": "...", "*": "..." }`.
- Zero network calls — fast, deterministic, offline-friendly.
- Can't catch handler/schema drift, only LLM routing.

### `EVAL_BACKEND=live`

- Routes each tool call to a real MCP server at `EVAL_MCP_URL`
  (default `http://localhost:3000/mcp`, same as `E2E_MCP_URL`).
- Catches exactly the class of bug we shipped FEAT-33 with:
  the LLM-observable gap between the tool description, the Zod schema, and
  what the handler actually requires.
- Requires the server to be running and the ADT backend to be reachable.
- Fails hard if `/health` can't be reached — we don't fall back to mocks.
- Use read-only scenarios whenever possible — writes are non-deterministic
  (order, names, transport) and produce flake.

Bring up the server the same way E2E tests do:

```bash
npm run test:e2e:deploy   # background
# or
npm run dev:http          # foreground

EVAL_BACKEND=live EVAL_FILE=context-impact npm run test:eval
```

---

## Scoring

Per scenario:

- **Tool selection** (weight 0.6):
  - 1.0 if the first tool call matches `optimal`
  - 0.5 if it matches `acceptable`
  - 0.0 if it matches `forbidden` or none of the above
- **Parameters** (weight 0.4): fraction of `requiredArgs` / `requiredArgKeys`
  satisfied. Case-insensitive on string values to tolerate ABAP-name
  casing drift.
- **Overall**: `0.6 * tool + 0.4 * params`.
- **Passed**: `overall ≥ EVAL_PASS_THRESHOLD` (default 0.5).

Aggregate results (per model/backend/run) go to
`test-results/evals/<timestamp>-<provider>-<model>-<backend>.json`.

---

## Authoring a scenario

> **Core rule: mock responses must be captured from a real SAP system.**
> If you make them up, the LLM over-fits to fake data and the eval stops
> predicting real behaviour. Every `mockResponses` entry below should have
> been pasted in from a live tool call at some point.

### 1. Pick the right file

Find the feature bucket in `scenarios/`. If the feature is new (new tool or
new `action` enum), create `scenarios/<feature>.ts` and register it in
`scenarios/index.ts` — the filename becomes the `EVAL_FILE` filter value.

### 2. Lift the prompt from a real user interaction

Don't invent prompts; copy them from actual transcripts (PR reviews, Cursor
logs, Copilot Studio traces, the PR description that motivated the feature).
Invented prompts drift from how humans actually phrase things. If you must
invent one, vary it — register 2–3 phrasings as separate scenarios so you
catch routing that's brittle to wording.

### 3. Give it a stable id

Globally unique, kebab-case, feature-prefixed: `cds-impact-blast-radius-natural`,
`rap-lifecycle-service-bind`. The id appears in results JSON and in
`EVAL_SCENARIO`. **Never rename** — breaks historical trend comparisons.

### 4. Capture real mock responses from SAP

This is the step most likely to go wrong. Do it carefully.

**Option A — record from a live MCP call (recommended):**

```bash
# Start the MCP server once (uses SAP_* from .env)
npm run test:e2e:deploy

# Call the tool against the test system and save the raw output.
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{"name":"SAPContext","arguments":{"action":"impact","name":"I_COUNTRY","type":"DDLS"}}
  }' \
  | jq -r '.result.content[0].text' > /tmp/impact-i-country.txt
```

Paste the saved text (or the relevant slice) into `mockResponses` as a
constant:

```ts
const IMPACT_I_COUNTRY_MOCK = `… pasted from /tmp/impact-i-country.txt …`;
```

**Option B — run the scenario once in live mode and promote the trace:**

```bash
EVAL_BACKEND=live EVAL_SCENARIO=cds-impact-blast-radius-natural npm run test:eval
# The live tool output is recorded in test-results/evals/<timestamp>-….json
# Copy the text of the tool result into a mock constant in the scenario file.
```

**Do NOT fabricate responses.** If the shape is wrong, the LLM learns to
expect fake fields and stops following real ADT conventions. Shape matters
more than volume — a trimmed real response beats a fully-populated fake one.

### 5. Declare expectations

```ts
optimal: [       // 1.0 tool-selection score
  { tool: 'SAPContext', requiredArgs: { action: 'impact', name: 'I_COUNTRY', type: 'DDLS' } },
],
acceptable: [    // 0.5 tool-selection score — a defensible alternative
  { tool: 'SAPNavigate', requiredArgs: { action: 'references', type: 'DDLS', name: 'I_COUNTRY' } },
],
forbidden: ['SAPQuery'],   // 0.0 — anti-pattern canary
```

- **optimal** should be the one or two truly best first tool calls.
- **acceptable** captures workable alternatives you don't want to punish.
- **forbidden** locks in anti-patterns (e.g. `SAPQuery` against `DDDDLSRC`
  for CDS impact questions). If there's no clear anti-pattern, use `[]`.

### 6. Tag for filtering

Stable feature tags make `EVAL_TAG` useful across buckets. Examples used today:
`feat-33`, `cds-impact`, `rap`, `discoverability`, `anti-pattern`,
`single-step`, `multi-step`. Prefer fewer, stable tags over many ad-hoc ones.

### 7. Template

```ts
import type { EvalScenario } from '../types.js';

// Captured from `SAPContext(action="impact", name="I_COUNTRY", type="DDLS")`
// against the A4H test system on 2026-04-17. Refresh when the dep graph
// changes meaningfully.
const IMPACT_I_COUNTRY_MOCK = `… real SAP output pasted here …`;

export const SCENARIOS: EvalScenario[] = [
  {
    id: 'cds-impact-blast-radius-natural',
    description: 'Blast-radius question in natural language — the canonical FEAT-33 prompt',
    prompt: 'what breaks if I change the CDS view I_COUNTRY?',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'single-step'],
    optimal: [
      { tool: 'SAPContext', requiredArgs: { action: 'impact', name: 'I_COUNTRY', type: 'DDLS' } },
    ],
    acceptable: [
      { tool: 'SAPNavigate', requiredArgs: { action: 'references', type: 'DDLS', name: 'I_COUNTRY' } },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPContext: IMPACT_I_COUNTRY_MOCK },
  },
];
```

### 8. Refreshing mocks

Real SAP responses drift (system upgrades, activated objects, new where-used
entries). When a scenario starts failing in mock mode but passes in live
mode, that's a signal the mock is stale — regenerate it using step 4.

Tag refreshes with a dated comment above the constant so the next person
knows when it was last synced:

```ts
// Captured on 2026-04-17 from A4H (CDS where-used index).
const IMPACT_I_COUNTRY_MOCK = `…`;
```

### 9. Prefer read-only scenarios in live mode

Writes are non-deterministic: transport numbers, generated names, activation
state. A write scenario in `EVAL_BACKEND=live` will flake. If you must test
a write, wrap it in its own unique object name (`ZARC1_EVAL_<ts>`) and
prefer running it against mocks only.

---

## Output

Console (abridged):

```
  ✅ [context-impact] cds-impact-blast-radius-natural — tool:100% params:100% calls:1 2100ms
  ❌ [context-impact] cds-impact-who-consumes — tool:0% params:0% calls:1 1890ms
     Wrong tool: SAPQuery({"sql":"SELECT..."}). Expected: SAPContext
  ...
  Summary: 5/7 passed | Tool Selection: 71% | Params: 85% | Overall: 76%
```

Persisted JSON (`test-results/evals/…`):

```jsonc
{
  "model": "qwen3.5:9b",
  "toolMode": "standard",
  "timestamp": "2026-04-17T12:34:56.789Z",
  "scores": [{ "scenarioId": "...", "trace": [...], "explanation": "..." }],
  "summary": { "totalScenarios": 7, "passed": 5, "avgOverallScore": 0.76 }
}
```

Files under `test-results/` are gitignored alongside other test artefacts.
Commit them (or not) per your regression-tracking policy.
