#!/usr/bin/env tsx
/**
 * Routing benchmark — 100% discriminator coverage for the tool surface.
 *
 * The existing `tests/evals` scenarios are realistic but narrow (58 scenarios reaching 2/12
 * SAPTransport actions, 11/49 SAPRead types). Descriptions are the dominant tool-selection signal,
 * so trimming one whose values nothing exercises is unmeasurable damage — that is exactly how a
 * "clean" SAPTransport rewrite silently dropped the `target=`/`summary=` syntax.
 *
 * This is a cheaper instrument built for coverage rather than realism: ONE single-turn call per
 * enum value (no agentic loop, no mock responses), scoring only "did it route to the right tool and
 * the right action/type". That is precisely what descriptions are for, and 182 cases cover every
 * discriminator value on the full surface.
 *
 * Anti-leak rule: a generated prompt containing the enum literal or the tool name is rejected. A
 * case that says "use action=release" tests string matching, not routing.
 *
 * CAVEAT (state it, do not hide it): prompts are generated FROM the current descriptions, so they
 * inherit that vocabulary. This measures "does a rewrite preserve the routing the original
 * achieved", not "is the original good". Quarantined cases (all models fail) are the honest signal
 * that a description — or the case — is bad; both deserve human eyes.
 *
 *   npx tsx scripts/routing-bench.ts gen                 # write cases file
 *   npx tsx scripts/routing-bench.ts run --model qwen3.5:27b
 *
 * DETECTION FLOOR — measured, not assumed. Three runs on byte-identical input (claude-haiku-4-5,
 * 182 cases) scored 153 / 149 / 153, and SAPWrite alone moved 33 / 30 / 34 with its description
 * untouched. That is sd ~2.3 and a 4-case range, so a single-run difference below roughly SEVEN
 * cases is indistinguishable from the sampler. `claude -p` exposes no temperature control, which is
 * the likely source.
 *
 * Consequence: use this to catch LARGE regressions and to prove coverage, not to justify a small
 * win. To resolve a 3-case effect, run each arm 5+ times and compare means — a single A/B cannot.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { getToolSchema } from '../src/handlers/schemas.js';
import { getToolDefinitions, type ToolDefinition } from '../src/handlers/tools.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/server/types.js';

loadDotenv();

const OLLAMA = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
export const CASES_PATH = 'tests/evals/routing-cases.json';

export const FULL_CONFIG: ServerConfig = {
  ...DEFAULT_CONFIG,
  allowWrites: true,
  allowDataPreview: true,
  allowFreeSQL: true,
  allowTransportWrites: true,
  allowGitWrites: true,
};

export interface RoutingCase {
  id: string;
  prompt: string;
  tool: string;
  /** Discriminator that must match, e.g. { key: 'action', value: 'release' }. Absent = tool only. */
  key?: string;
  value?: string;
  /**
   * Set to the reason when a case's prompt does not actually ask for its expected answer, e.g.
   * SAPRead.type.TRAN whose prompt asks for the objects in transport A4HK900123 — SAPTransport is
   * the correct response, so scoring it as a TRAN miss penalises correct routing. Quarantined cases
   * are kept (the prompt is evidence about the surface) but excluded from scoring.
   */
  quarantined?: string;
}

// ─── Case inventory ─────────────────────────────────────────────────

/** Every (tool, discriminator, value) triple the surface can route to. */
export function enumTargets(tools: ToolDefinition[]): Array<{ tool: ToolDefinition; key?: string; value?: string }> {
  const out: Array<{ tool: ToolDefinition; key?: string; value?: string }> = [];
  for (const tool of tools) {
    const props = (tool.inputSchema as { properties?: Record<string, { enum?: unknown[] }> }).properties ?? {};
    let any = false;
    for (const key of ['action', 'type'] as const) {
      const values = props[key]?.enum ?? [];
      if (values.length < 2) continue;
      any = true;
      for (const value of values) out.push({ tool, key, value: String(value) });
    }
    if (!any) out.push({ tool });
  }
  return out;
}

// ─── Generation ─────────────────────────────────────────────────────

const GEN_PROMPT = `You write realistic one-line requests that an SAP ABAP developer would type to an AI assistant.

Write ONE request that should be handled by the tool below using {SPEC}.

Hard rules:
- Write what the DEVELOPER wants, in SAP domain language. Never mention the tool name, the parameter
  name, or the literal value — the assistant must infer them.
- The object name MUST match the target. SAP naming is a routing signal, so a ZCL_* name means a
  class and nothing else: naming ZCL_ORDER in a request meant for a view or a message class makes
  the case unanswerable, because the correct answer becomes the class.
  Use the right shape: ZCL_* class, ZIF_* interface, ZI_*/ZC_* CDS view, Z*_MSG message class,
  T001/MARA table, A4HK900123 transport, $TMP/ZPKG package, ZREPORT01 program.
- One sentence. No quotes, no explanation, no JSON. Output the request line and nothing else.

TOOL:
{TOOL}`;

/**
 * A prompt that hands the answer over tests string matching, not routing.
 *
 * The distinction that matters is SCHEMA-shaped leakage, not vocabulary overlap. "action=format" or
 * "use the format action" gives the answer away; "format this ABAP code" is what a developer
 * actually types, and routing it to SAPLint over SAPWrite is still a real decision. The first
 * version rejected both, which threw away coverage for every value that is an ordinary English verb
 * — activate, format, syntax — i.e. exactly the common paths.
 *
 * So: technical identifiers (snake_case, UPPERCASE type codes) never occur naturally and are always
 * a leak; ordinary lowercase words leak only in schema-shaped form.
 */
export function leaks(prompt: string, tool: string, value?: string): boolean {
  const p = prompt.toLowerCase();
  if (p.includes(tool.toLowerCase())) return true;
  if (!value) return false;

  const v = value.toLowerCase();
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // key=value / "value" / `value` — schema-shaped however the word is spelled.
  if (new RegExp(`\\b(action|type)\\s*[=:]\\s*["'\`]?${esc}\\b`).test(p)) return true;
  if (new RegExp(`["'\`]${esc}["'\`]`).test(p)) return true;

  // Technical identifiers: a developer never says "edit_method" or "DOMA" in prose by accident.
  const isTechnical = value.includes('_') || /^[A-Z0-9/]{2,}$/.test(value);
  if (isTechnical) return new RegExp(`\\b${esc}\\b`).test(p);

  // Ordinary word (activate, format, syntax, list…): bare use is legitimate developer phrasing.
  return false;
}

/**
 * Ollama's reasoning models can spend minutes on one completion, past undici's 300 s headers
 * timeout. The first generation run died on exactly that at case ~120 of 182.
 */
async function complete(model: string, prompt: string, temperature: number): Promise<string> {
  const resp = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature, stream: false }),
    signal: AbortSignal.timeout(Number(process.env.GEN_TIMEOUT_MS ?? 900_000)),
  });
  if (!resp.ok) throw new Error(`${model} ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
}

/**
 * The generator only needs to know what this value does — not the whole tool. Sending SAPWrite's
 * full 21 KB JSON once per enum value is what made the first run take 45 minutes.
 */
function generationContext(tool: ToolDefinition, key?: string, value?: string): string {
  const props = (tool.inputSchema as { properties?: Record<string, { description?: string; enum?: unknown[] }> })
    .properties ?? {};
  const parts = [`Tool purpose: ${tool.description}`];
  if (key && value) {
    parts.push(`Target: ${key} = "${value}"`);
    const d = props[key]?.description;
    // The per-value guidance lives in one long description; give the sentences mentioning it.
    if (d) {
      const hit = d
        .split(/(?<=[.;])\s+/)
        .filter((s) => s.toLowerCase().includes(value.toLowerCase()))
        .join(' ');
      parts.push(`What "${value}" means: ${hit || d.slice(0, 400)}`);
    }
  }
  return parts.join('\n');
}

/**
 * Writes after every case and skips ids already present. Generation is a ~20-minute job against a
 * flaky local server; the first run threw at case 120 of 182 and lost all 120. Resumable by
 * construction is cheaper than being careful.
 */
export async function generateCases(model: string, tools: ToolDefinition[], path = CASES_PATH): Promise<RoutingCase[]> {
  const cases: RoutingCase[] = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as RoutingCase[]) : [];
  const done = new Set(cases.map((c) => c.id));
  const targets = enumTargets(tools);
  if (done.size > 0) console.error(`  resuming — ${done.size} cases already present`);

  for (const [i, t] of targets.entries()) {
    const spec = t.key ? `${t.key}="${t.value}"` : 'this tool';
    const id = t.key ? `${t.tool.name}.${t.key}.${t.value}` : t.tool.name;
    if (done.has(id)) continue;

    let prompt = '';
    for (let attempt = 0; attempt < 4 && !prompt; attempt++) {
      let raw: string;
      try {
        raw = await complete(
          model,
          GEN_PROMPT.replace('{SPEC}', spec).replace('{TOOL}', generationContext(t.tool, t.key, t.value)),
          0.3 + attempt * 0.2, // widen on retry rather than re-rolling the same leaky phrasing
        );
      } catch (err) {
        console.error(`  ! ${id}: ${err instanceof Error ? err.message : String(err)} — retrying`);
        continue;
      }
      const cleaned = raw.replace(/^["'\-*\s]+|["'\s]+$/g, '');
      if (cleaned.length > 15 && !leaks(cleaned, t.tool.name, t.value)) prompt = cleaned;
    }
    if (!prompt) {
      console.error(`  ! ${id}: no leak-free prompt after 4 tries — skipped`);
      continue;
    }

    cases.push({ id, prompt, tool: t.tool.name, key: t.key, value: t.value });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cases, null, 2)}\n`);
    if ((i + 1) % 20 === 0) console.error(`  … ${i + 1}/${targets.length}`);
  }
  return cases;
}

// ─── Scoring ────────────────────────────────────────────────────────

const SYSTEM = 'You are connected to an SAP ABAP system via MCP tools. Call exactly one tool to satisfy the request.';

export interface BenchResult {
  /** Routed correctly AND supplied every required argument. This is what the optimizer gates on. */
  passed: number;
  /** Routed correctly, ignoring missing required args. Separates "picked wrong" from "called wrong". */
  routed: number;
  /** Cases scored — total minus cases the server never answered. */
  total: number;
  /** Cases that errored after every retry. Excluded from `total`: a dropped connection is not a
   *  routing verdict, and counting it as one silently deflates the score AND injects per-run noise
   *  that swamps the effect being measured. */
  errors: number;
  failures: Array<{ id: string; got: string }>;
}

/**
 * Deprecated enum values whose canonical replacement is the BETTER answer.
 *
 * SAPRead's type description says "Deprecated aliases: MESSAGES (use MSAG), FTG2 (use
 * FEATURE_TOGGLE)". A model that answers MSAG for a message-class request is doing the right thing,
 * so scoring it as a miss penalises correct behaviour and understates the surface. Same for the
 * SKTD/KTD pair, which the tool documents as aliases of each other.
 */
const ACCEPTED_ALIASES: Record<string, string[]> = {
  MESSAGES: ['MSAG'],
  FTG2: ['FEATURE_TOGGLE'],
  KTD: ['SKTD'],
  SKTD: ['KTD'],
};

function valueMatches(expected: string, actual: string): boolean {
  return actual === expected || (ACCEPTED_ALIASES[expected] ?? []).includes(actual);
}

/**
 * Validate a proposed call against the SAME Zod schema `dispatch.ts` runs, rather than a
 * hand-maintained requirement map.
 *
 * The map approach produced errors in both directions: SAPWrite(edit_method, name, method) passed
 * here while the handler rejects it for missing type/source, SAPTransport(remove_object, id) passed
 * without the required pgmid/type/name, and SAPActivate(activate, objects=[…]) FAILED even though
 * the batch form is valid. It also accepted invented enum aliases the schema refuses. Anything
 * short of the real contract re-introduces that whole class of defect.
 */
function schemaError(toolName: string, args: Record<string, unknown>): string | null {
  const schema = getToolSchema(toolName, false);
  if (!schema) return null;
  const parsed = schema.safeParse(args);
  if (parsed.success) return null;
  const first = (parsed.error as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues?.[0];
  return first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid';
}

/** Transient local-server failures are common under load; only a verdict counts as a verdict. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

/**
 * Concurrency. Sequential, a 182-case gate takes ~15 min and the loop runs dozens of them — which
 * makes the whole thing impractical rather than merely slow. Ollama serves parallel requests
 * (OLLAMA_NUM_PARALLEL, default 4); going wider than the server's own limit just queues.
 */
const CONCURRENCY = (() => {
  const n = Number(process.env.BENCH_CONCURRENCY ?? 4);
  // 0 spawns no workers and returns an apparently-complete zero-score run; NaN does the same.
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
})();

/** A `claude-*` model id routes to the Anthropic Messages API; anything else to local ollama. */
function isAnthropic(model: string): boolean {
  return model.startsWith('claude-');
}

/**
 * `cli:<model>` drives the authenticated `claude` CLI instead of the API — the only Claude path
 * available without an ANTHROPIC_API_KEY.
 *
 * FIDELITY CAVEAT: this presents the tool schemas as text and asks which tool the model would call,
 * rather than exercising native tool-use. It measures the description → selection mapping, which is
 * exactly the question here, but it is not the same code path a real client uses. Treat it as a
 * second data point, never as a replacement for the API or MCP result.
 *
 * (Attaching ARC-1 over `--mcp-config` would be faithful, but the CLI leaves the server `pending`
 * and exposes zero tools in this environment, despite the server answering `initialize` in 0.44s.)
 */
function cliModel(model: string): string | null {
  return model.startsWith('cli:') ? model.slice(4) : null;
}

const CLI_PROMPT = `You are connected to an SAP ABAP system via these MCP tools:

{TOOLS}

User request: {PROMPT}

Which single tool would you call, with which arguments? Reply with ONLY a JSON object:
{"tool":"<name>","args":{...}}
No prose, no markdown fence.`;


/** Credentials must not be inherited by a child processing "delete"/"release"/"push" prompts. */
export function sanitizedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(SAP_|ARC1_|TEST_SAP_|ANTHROPIC_|OLLAMA_)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Exported so a unit test can pin the exact isolation flags — this is a safety boundary. */
export function buildCliArgs(model: string): string[] {
  return [
    '-p',
    '--model',
    model,
    '--safe-mode',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--strict-mcp-config',
    '--permission-mode',
    'plan',
    '--tools',
    '',
  ];
}

async function callViaCli(
  model: string,
  prompt: string,
  toolText: string,
): Promise<{ name: string; args: Record<string, unknown> } | null> {
  const { spawn } = await import('node:child_process');
  const body = CLI_PROMPT.replace('{TOOLS}', toolText).replace('{PROMPT}', prompt);

  // ISOLATION IS MANDATORY, NOT HYGIENE. The corpus contains real destructive requests — "Delete
  // the ZCL_PAYMENT_VALIDATOR class from the system", release, push and unlink prompts. We only
  // ever want the model's opinion as text, so nothing that can act may load.
  //
  // A built-in denylist is NOT sufficient: it leaves user CLAUDE.md, skills, plugins, hooks,
  // commands and agents loaded, and hooks run outside the tool-permission path entirely. Use the
  // CLI's own controls:
  //   --safe-mode               disables user customizations (plugins, hooks, agents, CLAUDE.md)
  //   --tools ''                empty tool set, rather than enumerating built-ins by hand
  //   --disable-slash-commands  no skills
  //   --no-session-persistence  no transcript written for a throwaway scoring call
  //   --strict-mcp-config + {}  no MCP servers, global config ignored
  //   --permission-mode plan    last-resort refusal of side effects
  //
  // The environment is scrubbed too: this script calls loadDotenv(), so SAP_*/ARC1_* credentials
  // are in scope and must not reach a child that is being fed destructive prompts.
  const args = buildCliArgs(model);
  const child = spawn('claude', args, { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'], env: sanitizedEnv() });
  const stdout = await new Promise<string>((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('claude CLI timed out after 180s'));
    }, 180_000);
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI exit ${code}: ${err.slice(0, 200)}`));
    });
    // A child that exits before consuming stdin raises EPIPE on the write. Unhandled, that is an
    // 'error' event on the socket and it takes down the whole run instead of failing one case —
    // turn it into a normal rejection so withRetry() can do its job.
    child.stdin.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(`claude CLI stdin ${e.code ?? e.message}: ${err.slice(0, 200)}`));
    });
    child.stdin.end(body);
  });
  const json = stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
  if (!json) return null;
  const parsed = JSON.parse(json) as { tool?: string; args?: Record<string, unknown> };
  return parsed.tool ? { name: parsed.tool, args: parsed.args ?? {} } : null;
}

/** One scored call. Returns the chosen tool name and its arguments, or null if no tool was called. */
async function callModel(
  model: string,
  prompt: string,
  openaiTools: unknown[],
  anthropicTools: unknown[],
  toolText = '',
): Promise<{ name: string; args: Record<string, unknown> } | null> {
  const cli = cliModel(model);
  if (cli) return callViaCli(cli, prompt, toolText);

  if (isAnthropic(model)) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is required for claude-* models (or run `claude login`).');
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM,
        tools: anthropicTools,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = (await resp.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
    const use = data.content?.find((b) => b.type === 'tool_use');
    return use?.name ? { name: use.name, args: (use.input ?? {}) as Record<string, unknown> } : null;
  }

  const resp = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      tools: openaiTools,
      temperature: 0,
      seed: 42,
      stream: false,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  // Without this, a JSON-bodied 429/500/503 parses to no tool_calls and scores as "(no call)" — a
  // routing verdict, with errors=0 and no retry. Server trouble then silently deflates the result.
  if (!resp.ok) throw new Error(`ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
  };
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return null;
  return { name: call.function.name, args: JSON.parse(call.function.arguments || '{}') as Record<string, unknown> };
}

export async function runBench(tools: ToolDefinition[], cases: RoutingCase[], model: string): Promise<BenchResult> {
  const openai = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const anthropic = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  // Text rendering for the CLI backend — same content the API backends send, serialised as prose.
  const toolText = tools
    .map((t) => `## ${t.name}\n${t.description}\nSchema: ${JSON.stringify(t.inputSchema)}`)
    .join('\n\n');

  let passed = 0;
  let routed = 0;
  let errors = 0;
  const failures: BenchResult['failures'] = [];

  const scoreOne = async (c: RoutingCase): Promise<void> => {
    let got = '(no call)';
    try {
      const call = await withRetry(() => callModel(model, c.prompt, openai, anthropic, toolText));
      if (call) {
        const args = call.args;
        const actual = c.key ? String(args[c.key] ?? '') : '';
        got = c.key ? `${call.name}(${c.key}=${actual || '∅'})` : call.name;

        // Routing alone understates the damage: over-compression can leave the model picking the
        // right action but no longer supplying an argument the schema requires, which is a runtime
        // error rather than a misroute. Score required-arg presence too (presence, not value — the
        // generated prompt does not pin object names).
        const invalid = schemaError(call.name, args);
        if (invalid) got += ` [rejected: ${invalid}]`;

        const routedRight = call.name === c.tool && (!c.key || valueMatches(c.value ?? '', actual));
        if (routedRight) routed++;
        // `passed` means the server would have accepted this call; `routed` means only that the
        // tool and discriminator were right. Reporting both separates "picked wrong" from
        // "picked right but could not construct a usable call".
        if (routedRight && !invalid) {
          passed++;
          return;
        }
      }
    } catch (err) {
      // Retries exhausted: the server never gave a verdict, so there is nothing to score. Counting
      // it as a misroute both deflates the result and adds per-run randomness that hides real
      // effects — which is exactly what happened to the first baseline.
      errors++;
      failures.push({ id: c.id, got: `⚠ unscored: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    failures.push({ id: c.id, got });
  };

  // Fixed-size worker pool over a shared cursor — every worker drains the same queue, so one slow
  // case cannot leave the others idle the way a chunked split would.
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= cases.length) return;
      await scoreOne(cases[i]);
    }
  });
  await Promise.all(workers);

  // Deterministic order regardless of completion order, so two runs diff cleanly.
  const rank = new Map(cases.map((c, i) => [c.id, i]));
  failures.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  // Unscored cases leave the denominator: a score over cases the server answered.
  return { passed, routed, total: cases.length - errors, errors, failures };
}

export function loadCases(path = CASES_PATH, includeQuarantined = false): RoutingCase[] {
  if (!existsSync(path)) throw new Error(`No routing cases at ${path}. Run: npx tsx scripts/routing-bench.ts gen`);
  const all = JSON.parse(readFileSync(path, 'utf8')) as RoutingCase[];
  return includeQuarantined ? all : all.filter((c) => !c.quarantined);
}

// ─── CLI ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (n: string, d: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const tools = getToolDefinitions(FULL_CONFIG) as ToolDefinition[];

  if (cmd === 'gen') {
    const model = flag('model', 'qwen3.6:35b-mlx');
    console.error(`Generating routing cases with ${model} …`);
    const cases = await generateCases(model, tools);
    const targets = enumTargets(tools).length;
    console.log(`${cases.length}/${targets} cases → ${CASES_PATH}`);
    return;
  }

  if (cmd === 'run') {
    const model = flag('model', 'qwen3.5:27b');
    const cases = loadCases();
    const r = await runBench(tools, cases, model);
    console.log(
      `${model}: ${r.passed}/${r.total} pass (${((r.passed / r.total) * 100).toFixed(1)}%)  |  ${r.routed}/${r.total} routed (${((r.routed / r.total) * 100).toFixed(1)}%)${r.errors ? `  |  ⚠ ${r.errors} unscored (server errors)` : ''}`,
    );

    // Per-tool attribution: a weakly-routed tool is where description work pays, and a tool at 0%
    // usually means bad generated cases rather than a bad description — check before trusting it.
    const failed = new Set(r.failures.map((f) => f.id));
    console.log('\ntool           pass');
    for (const name of [...new Set(cases.map((c) => c.tool))]) {
      const mine = cases.filter((c) => c.tool === name);
      const ok = mine.filter((c) => !failed.has(c.id)).length;
      const pct = (ok / mine.length) * 100;
      console.log(`${name.padEnd(14)} ${String(ok).padStart(3)}/${String(mine.length).padEnd(3)} ${pct.toFixed(0).padStart(3)}%${pct < 50 ? '  ← weak' : ''}`);
    }

    console.log('');
    for (const f of r.failures.slice(0, 40)) console.log(`  ✗ ${f.id} → ${f.got}`);
    if (r.failures.length > 40) console.log(`  … ${r.failures.length - 40} more`);
    return;
  }

  console.log('usage: routing-bench.ts gen [--model M] | run [--model M]');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
