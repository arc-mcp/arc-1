import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import { expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { AdtClient, mockFetch } from '../unit/handlers/setup-undici-mock.js';
import {
  baselineRefuses,
  cases,
  failureCategory,
  grade,
  normalizeEvalArgs,
  systemPrompt,
  type TraceEntry,
} from './diagnostic-value/cases.js';
import { createWorld } from './diagnostic-value/world.js';

const { handleToolCall } = await import('../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../src/handlers/feature-cache.js');
const { getToolDefinitions } = await import('../../src/handlers/tools.js');
const { features, onprem } = await import('../unit/handlers/handler-test-config.js');
const baselineRef = '62eb17b456cd57908cdac2a508082027ed5d88f7';
const baseline = JSON.parse(readFileSync(new URL('./diagnostic-value/baseline-tools.json', import.meta.url), 'utf8'));
const catalogs = { baseline, candidate: getToolDefinitions(onprem(), false, features()) };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname))
  throw new Error('This offline eval uses local Ollama only.');
const models = (process.env.DIAGNOSTIC_EVAL_MODELS ?? 'qwen3:30b,llama3.1:8b').split(',');
const repeats = Number(process.env.DIAGNOSTIC_EVAL_REPEATS ?? 2);
const arms = (process.env.DIAGNOSTIC_EVAL_ARMS ?? 'baseline,candidate').split(',');
if (!arms.length || new Set(arms).size !== arms.length || arms.some((arm) => !['baseline', 'candidate'].includes(arm)))
  throw new Error('Use baseline, candidate, or both for DIAGNOSTIC_EVAL_ARMS.');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Use 1..3 repetitions.');
const selected = cases.filter(
  (c) => !process.env.DIAGNOSTIC_EVAL_CASES || process.env.DIAGNOSTIC_EVAL_CASES.split(',').includes(c.id),
);
const outDir = resolve(
  process.env.DIAGNOSTIC_EVAL_OUTPUT ??
    `test-results/diagnostic-value/${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const options = { temperature: 0, num_ctx: 32768, num_predict: 2048 };
const ajv = new Ajv({ strict: false });
const catalogData = Object.fromEntries(
  Object.entries(catalogs).map(([arm, definitions]) => [
    arm,
    {
      tools: definitions.map((t: { name: string; description: string; inputSchema: object }) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      validators: new Map(
        definitions.map((t: { name: string; inputSchema: object }) => [t.name, ajv.compile(t.inputSchema)]),
      ),
    },
  ]),
) as Record<string, { tools: object[]; validators: Map<string, ReturnType<typeof ajv.compile>> }>;

interface ChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}
async function json<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(body ? 180_000 : 5000),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

it('compares diagnostic task outcomes with installed local models', async () => {
  mkdirSync(outDir, { recursive: true });
  const tags = await json<{ models: Array<{ name: string; digest: string }> }>('/api/tags');
  const modelInfo = [];
  for (const model of models) {
    const installed = tags.models.find((m: { name: string }) => m.name === model);
    if (!installed) throw new Error(`Model not installed: ${model}`);
    const info = await json('/api/show', { model });
    modelInfo.push({
      name: model,
      digest: installed.digest,
      details: info.details,
      capabilities: info.capabilities,
      parameters: info.parameters,
    });
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    baselineRef,
    candidateHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    candidatePatchHash: hash(execFileSync('git', ['diff', '--', 'src'], { encoding: 'utf8' })),
    files: Object.fromEntries(
      [
        'tests/evals/diagnostic-value.test.ts',
        'tests/evals/diagnostic-value/cases.ts',
        'tests/evals/diagnostic-value/world.ts',
        'tests/evals/diagnostic-value/baseline-tools.json',
      ].map((file) => [file, hash(readFileSync(file, 'utf8'))]),
    ),
    modelInfo,
    ollama: await json('/api/version'),
    options,
    think: false,
    argumentNormalization:
      'Production normalization before schema validation; trace.arguments is normalized, responses retain original arguments.',
    repeats,
    arms,
    systemPrompt,
    cases: selected,
    catalogs: Object.fromEntries(
      Object.entries(catalogData).map(([key, data]) => [
        key,
        {
          sha256: hash(JSON.stringify(data.tools)),
          bytes: Buffer.byteLength(JSON.stringify(data.tools)),
          tools: data.tools,
        },
      ]),
    ),
  };
  writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  const results = [];
  for (const model of models)
    for (let repeat = 0; repeat < repeats; repeat++)
      for (const arm of (repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']).filter((arm) =>
        arms.includes(arm),
      )) {
        for (const task of selected) {
          vi.restoreAllMocks();
          resetCachedFeatures();
          mockFetch.mockReset();
          const world = createWorld(task.id);
          mockFetch.mockImplementation(world.fetch);
          const client = new AdtClient({ baseUrl: 'https://offline.invalid', safety: defaultSafetyConfig() });
          const catalog = catalogData[arm]!;
          const messages: Array<Record<string, unknown>> = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: task.prompt },
          ];
          const trace: TraceEntry[] = [];
          const responses = [];
          let runtimeContextLength: number | undefined;
          const started = Date.now();
          const trialId = `${model.replace(/[^\w.-]/g, '_')}-${repeat}-${task.id}-${arm}`;
          console.log(JSON.stringify({ event: 'trial_start', model, repeat, arm, caseId: task.id }));
          let answer = '';
          let error: string | undefined;
          try {
            for (let turn = 0; turn < 8; turn++) {
              if (Date.now() - started > 360_000) throw new Error('Trial time budget exceeded.');
              const response = await json<ChatResponse>('/api/chat', {
                model,
                messages,
                tools: catalog.tools,
                stream: false,
                ...(Array.isArray(modelInfo.find((m) => m.name === model)?.capabilities) &&
                (modelInfo.find((m) => m.name === model)!.capabilities as string[]).includes('thinking')
                  ? { think: false }
                  : {}),
                options: { ...options, seed: 1700 + repeat },
              });
              responses.push(response);
              if (turn === 0) {
                const running = await json<{ models: Array<{ name: string; context_length?: number }> }>('/api/ps');
                runtimeContextLength = running.models.find((m) => m.name === model)?.context_length;
              }
              writeFileSync(
                `${outDir}/${trialId}.partial.json`,
                JSON.stringify(
                  {
                    model,
                    repeat,
                    arm,
                    caseId: task.id,
                    started,
                    messages,
                    responses,
                    trace,
                    requests: world.requests,
                  },
                  null,
                  2,
                ),
              );
              const message = response.message;
              if (!message || typeof message !== 'object') throw new Error('Missing Ollama message.');
              messages.push(message);
              if (!message.tool_calls?.length) {
                answer = message.content ?? '';
                break;
              }
              for (const call of message.tool_calls) {
                if (trace.length >= 10) throw new Error('Tool-call budget exceeded.');
                const name = call.function.name;
                const args = normalizeEvalArgs(name, call.function.arguments);
                const validate = catalog.validators.get(name);
                let result: string;
                let isError: boolean;
                if (!validate?.(args) || (arm === 'baseline' && baselineRefuses(name, args))) {
                  result = JSON.stringify({
                    error:
                      arm === 'baseline' && baselineRefuses(name, args)
                        ? 'objects is only supported for atc and cannot be combined with name, type, or url.'
                        : 'Tool or arguments not available in this catalog.',
                    details: validate?.errors,
                  });
                  isError = true;
                } else {
                  const reply = await handleToolCall(client, { ...DEFAULT_CONFIG, systemType: 'onprem' }, name, args, {
                    token: 'offline',
                    clientId: 'reader',
                    scopes: ['read'],
                  });
                  result = reply.content.map((c) => c.text ?? '').join('\n');
                  isError = Boolean(reply.isError);
                }
                trace.push({ name, arguments: args, result, isError });
                messages.push({ role: 'tool', tool_name: name, content: result });
              }
            }
            if (!answer) error = 'No final answer within turn budget.';
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
          const score = grade(task, answer, trace);
          const failure = failureCategory(error, world.unsupported);
          const trial = {
            model,
            repeat,
            arm,
            caseId: task.id,
            ...score,
            completed: !error && !world.unsupported.length && score.completed,
            inconclusive: failure === 'fixture' || failure === 'infrastructure',
            failure,
            runtimeContextLength,
            contextNearLimit: responses.some(
              (r) => (r.prompt_eval_count ?? 0) > 0.9 * (runtimeContextLength ?? options.num_ctx),
            ),
            error,
            unsupported: world.unsupported,
            toolCalls: trace.length,
            invalidCalls: trace.filter((t) => t.isError).length,
            backendCalls: world.requests.length,
            backendBytes: world.requests.reduce((n, r) => n + Buffer.byteLength(r.response), 0),
            returnedBytes: trace.reduce((n, t) => n + Buffer.byteLength(t.result), 0),
            promptTokens: responses.reduce((n, r) => n + (r.prompt_eval_count ?? 0), 0),
            completionTokens: responses.reduce((n, r) => n + (r.eval_count ?? 0), 0),
            durationMs: Date.now() - started,
            answer,
            trace,
            requests: world.requests,
            responses,
          };
          const filename = `${model.replace(/[^\w.-]/g, '_')}-${repeat}-${task.id}-${arm}.json`;
          writeFileSync(`${outDir}/${filename}`, JSON.stringify(trial, null, 2));
          const { trace: _trace, requests: _requests, responses: _responses, ...summary } = trial;
          results.push(summary);
          writeFileSync(`${outDir}/summary.json`, JSON.stringify(results, null, 2));
          console.log(
            JSON.stringify({
              model,
              repeat,
              arm,
              task: task.id,
              completed: trial.completed,
              honest: trial.honest,
              inconclusive: trial.inconclusive,
              calls: trial.toolCalls,
              error,
            }),
          );
        }
      }
  console.log(`Diagnostic eval evidence: ${outDir}`);
  // Poor model outcomes are recorded, not hidden by assertion failure. Infrastructure must still be usable.
  expect(results.some((r) => !r.inconclusive)).toBe(true);
}, 7_200_000);
