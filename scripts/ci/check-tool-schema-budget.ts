#!/usr/bin/env tsx
/**
 * MCP tool schema budget guard.
 *
 * Two kinds of limit per scenario:
 *
 * 1. HARD WIRE-BYTE WALLS — `maxTotalWireBytes` / `maxPerToolWireBytes`. These are the real
 *    constraint: some MCP clients silently DROP a `tools/list` whose payload is too large. GitHub
 *    Copilot-for-Eclipse's gateway drops the write-mode list above ~68–80 KB (issue #520: 68 KB
 *    loads, 84 KB does not), logging "MCP server … is already running" but never registering a
 *    tool. The walls are derived from that evidence (68 KB proven-good) — they are a CLIENT-SAFETY
 *    CEILING, NOT a ratchet. Do NOT raise them to make CI pass: trim the schema (shorter
 *    descriptions, move long guidance to docs_page/) so the payload fits. Measured on the exact
 *    `JSON.stringify({ tools })` shape the client receives (the JSON-RPC envelope adds only tens of
 *    bytes on top).
 *
 * 2. TOKEN RATCHETS — `schemaTokenEstimate` / `descriptionTokenEstimate` / `descriptionCount`. A
 *    deterministic byte/4 estimate (no tokenizer dep). These are a COST ratchet seeded at
 *    current+headroom; lower them when the surface shrinks, bump consciously (in the diff) when a
 *    feature legitimately grows it — but never above the wire wall.
 *
 * Run: npm run check:sizes
 */

import { pathToFileURL } from 'node:url';
import type { FeatureStatus, ResolvedFeatures } from '../../src/adt/types.js';
import { getToolDefinitions, type ToolDefinition } from '../../src/handlers/tools.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../src/server/types.js';

const TOKEN_ESTIMATE_BYTES = 4;

export interface DescriptionStats {
  count: number;
  bytes: number;
  tokenEstimate: number;
}

export interface ToolSchemaMeasurement {
  scenario: string;
  tools: number;
  schemaBytes: number;
  schemaTokenEstimate: number;
  descriptionCount: number;
  descriptionBytes: number;
  descriptionTokenEstimate: number;
  /** Largest single tool, measured as compact JSON.stringify(tool) bytes. */
  maxToolBytes: number;
  maxToolName: string;
  /** Tools sorted largest-first (for the CI report). */
  toolBytes: Array<{ name: string; bytes: number }>;
}

export interface ToolSchemaBudget {
  schemaTokenEstimate: number;
  descriptionTokenEstimate: number;
  descriptionCount: number;
  /** Hard client-safety wall on the whole `{ tools }` wire payload (bytes). Do NOT raise — trim. */
  maxTotalWireBytes?: number;
  /** Hard client-safety wall on the largest single tool (bytes). Do NOT raise — trim. */
  maxPerToolWireBytes?: number;
}

export interface ToolSchemaScenario {
  name: string;
  config: ServerConfig;
  textSearchAvailable: boolean;
  resolvedFeatures?: ResolvedFeatures;
  budget: ToolSchemaBudget;
}

export interface BudgetOffender {
  scenario: string;
  metric: keyof ToolSchemaBudget;
  actual: number;
  budget: number;
}

const availableFeature = (id: string): FeatureStatus => ({ id, available: true, mode: 'on' });

const ALL_FEATURES_AVAILABLE: ResolvedFeatures = {
  hana: availableFeature('hana'),
  abapGit: availableFeature('abapGit'),
  gcts: availableFeature('gcts'),
  rap: availableFeature('rap'),
  amdp: availableFeature('amdp'),
  ui5: availableFeature('ui5'),
  transport: availableFeature('transport'),
  ui5repo: availableFeature('ui5repo'),
  flp: availableFeature('flp'),
  textSearch: { available: true },
};

const FULL_ACCESS_CONFIG: ServerConfig = {
  ...DEFAULT_CONFIG,
  allowWrites: true,
  allowDataPreview: true,
  allowFreeSQL: true,
  allowTransportWrites: true,
  allowGitWrites: true,
};

// Client-safety wire walls (issue #520). 68 KB is the largest write-mode tools/list proven to load
// in Copilot-for-Eclipse; we hold the full surface a few KB under it. Read-only is far smaller, so
// it gets its own lower wall. These are walls, not ratchets — trim the surface, don't raise them.
const WRITE_WIRE_WALL = 68_000;
const READ_WIRE_WALL = 50_000;
const PER_TOOL_WIRE_WALL = 21_000;

export const TOOL_SCHEMA_SCENARIOS: ToolSchemaScenario[] = [
  {
    name: 'standard-default',
    config: DEFAULT_CONFIG,
    textSearchAvailable: true,
    resolvedFeatures: ALL_FEATURES_AVAILABLE,
    budget: {
      // Post-#520 trim: read-only surface measured ~43.3 KB / ~10.8k schema tokens / 164 descriptions.
      schemaTokenEstimate: 11_800,
      descriptionTokenEstimate: 8_800,
      descriptionCount: 175,
      maxTotalWireBytes: READ_WIRE_WALL,
      maxPerToolWireBytes: PER_TOOL_WIRE_WALL,
    },
  },
  {
    name: 'standard-full-git',
    config: FULL_ACCESS_CONFIG,
    textSearchAvailable: true,
    resolvedFeatures: ALL_FEATURES_AVAILABLE,
    budget: {
      // Post-#520 trim: full write surface ~66.3 KB / ~16.6k schema tokens / 250 descriptions.
      schemaTokenEstimate: 17_300,
      descriptionTokenEstimate: 12_400,
      descriptionCount: 265,
      maxTotalWireBytes: WRITE_WIRE_WALL,
      maxPerToolWireBytes: PER_TOOL_WIRE_WALL,
    },
  },
  {
    name: 'btp-full-git',
    config: { ...FULL_ACCESS_CONFIG, systemType: 'btp' },
    textSearchAvailable: true,
    resolvedFeatures: { ...ALL_FEATURES_AVAILABLE, systemType: 'btp' },
    budget: {
      // Post-#520 trim: full BTP write surface ~64.5 KB / ~16.1k schema tokens / 248 descriptions.
      schemaTokenEstimate: 16_800,
      descriptionTokenEstimate: 12_000,
      descriptionCount: 260,
      maxTotalWireBytes: WRITE_WIRE_WALL,
      maxPerToolWireBytes: PER_TOOL_WIRE_WALL,
    },
  },
  {
    name: 'hyperfocused-default',
    config: { ...DEFAULT_CONFIG, toolMode: 'hyperfocused' },
    textSearchAvailable: true,
    resolvedFeatures: ALL_FEATURES_AVAILABLE,
    budget: {
      schemaTokenEstimate: 250,
      descriptionTokenEstimate: 120,
      descriptionCount: 8,
      maxTotalWireBytes: 4_000,
      maxPerToolWireBytes: 4_000,
    },
  },
];

export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / TOKEN_ESTIMATE_BYTES);
}

export function collectDescriptionStats(value: unknown): DescriptionStats {
  let count = 0;
  let bytes = 0;

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;

    for (const [key, child] of Object.entries(node)) {
      if (key === 'description' && typeof child === 'string') {
        count += 1;
        bytes += Buffer.byteLength(child, 'utf8');
      }
      visit(child);
    }
  }

  visit(value);
  return { count, bytes, tokenEstimate: estimateTokens(bytes) };
}

export function measureToolDefinitions(scenario: ToolSchemaScenario): ToolSchemaMeasurement {
  const definitions = getToolDefinitions(
    scenario.config,
    scenario.textSearchAvailable,
    scenario.resolvedFeatures,
  ) as ToolDefinition[];
  // Measure the exact shape the client receives from tools/list: { tools: [...] } (Codex review,
  // issue #520). The JSON-RPC envelope ({"jsonrpc","id","result"}) adds only ~40 bytes on top.
  const schemaBytes = Buffer.byteLength(JSON.stringify({ tools: definitions }), 'utf8');
  const descriptions = collectDescriptionStats(definitions);
  const toolBytes = definitions
    .map((tool) => ({ name: tool.name, bytes: Buffer.byteLength(JSON.stringify(tool), 'utf8') }))
    .sort((a, b) => b.bytes - a.bytes);
  const largest = toolBytes[0] ?? { name: '(none)', bytes: 0 };

  return {
    scenario: scenario.name,
    tools: definitions.length,
    schemaBytes,
    schemaTokenEstimate: estimateTokens(schemaBytes),
    descriptionCount: descriptions.count,
    descriptionBytes: descriptions.bytes,
    descriptionTokenEstimate: descriptions.tokenEstimate,
    maxToolBytes: largest.bytes,
    maxToolName: largest.name,
    toolBytes,
  };
}

export function checkToolSchemaBudgets(
  scenarios: ToolSchemaScenario[] = TOOL_SCHEMA_SCENARIOS,
): { measurements: ToolSchemaMeasurement[]; offenders: BudgetOffender[] } {
  const measurements = scenarios.map(measureToolDefinitions);
  const offenders: BudgetOffender[] = [];

  for (const measurement of measurements) {
    const budget = scenarios.find((scenario) => scenario.name === measurement.scenario)?.budget;
    if (!budget) continue;

    // Token ratchets (cost). Order preserved for the existing test.
    for (const metric of ['schemaTokenEstimate', 'descriptionTokenEstimate', 'descriptionCount'] as const) {
      if (measurement[metric] > budget[metric]) {
        offenders.push({ scenario: measurement.scenario, metric, actual: measurement[metric], budget: budget[metric] });
      }
    }

    // Hard wire-byte walls (client safety) — primary failure, fail on total first.
    if (budget.maxTotalWireBytes !== undefined && measurement.schemaBytes > budget.maxTotalWireBytes) {
      offenders.push({
        scenario: measurement.scenario,
        metric: 'maxTotalWireBytes',
        actual: measurement.schemaBytes,
        budget: budget.maxTotalWireBytes,
      });
    }
    if (budget.maxPerToolWireBytes !== undefined && measurement.maxToolBytes > budget.maxPerToolWireBytes) {
      offenders.push({
        scenario: measurement.scenario,
        metric: 'maxPerToolWireBytes',
        actual: measurement.maxToolBytes,
        budget: budget.maxPerToolWireBytes,
      });
    }
  }

  return { measurements, offenders };
}

export function formatToolSchemaBudgetReport(
  measurements: ToolSchemaMeasurement[],
  offenders: BudgetOffender[],
): string {
  const lines = [
    'MCP tool schema budget:',
    ...measurements.map(
      (measurement) =>
        `  ${measurement.scenario}: tools=${measurement.tools}, wire=${measurement.schemaBytes} bytes ` +
        `(~${measurement.schemaTokenEstimate} tokens), descriptions=${measurement.descriptionCount}/~${measurement.descriptionTokenEstimate} tokens; ` +
        `largest: ${measurement.toolBytes
          .slice(0, 3)
          .map((t) => `${t.name} ${t.bytes}`)
          .join(', ')}`,
    ),
  ];

  if (offenders.length === 0) {
    lines.push('✓ tool schema budget: all scenarios within budget.');
    return lines.join('\n');
  }

  lines.push('', '✗ tool schema budget failed:');
  for (const offender of offenders) {
    const wall = offender.metric === 'maxTotalWireBytes' || offender.metric === 'maxPerToolWireBytes';
    lines.push(
      `  ${offender.scenario}.${offender.metric}: ${offender.actual} (${wall ? 'WALL' : 'budget'} ${offender.budget})`,
    );
  }
  lines.push(
    '',
    'maxTotalWireBytes / maxPerToolWireBytes are CLIENT-SAFETY WALLS (issue #520: large tools/list silently dropped by Copilot-for-Eclipse). ' +
      'Do NOT raise them — trim tool descriptions/schema payload or move long guidance into docs_page/. Token budgets may be bumped consciously, but never above the wire wall.',
  );
  return lines.join('\n');
}

function main(): void {
  const { measurements, offenders } = checkToolSchemaBudgets();
  const report = formatToolSchemaBudgetReport(measurements, offenders);
  const stream = offenders.length > 0 ? process.stderr : process.stdout;
  stream.write(`${report}\n`);
  if (offenders.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
