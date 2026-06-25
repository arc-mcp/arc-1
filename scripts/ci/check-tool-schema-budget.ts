#!/usr/bin/env tsx
/**
 * MCP tool schema budget guard.
 *
 * This intentionally uses a deterministic byte/4 token estimate instead of a
 * tokenizer dependency. The number is a CI ratchet, not billing telemetry: if
 * tool descriptions or JSON schemas grow, this fails and forces a reviewed
 * budget bump or a prompt-surface reduction.
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
}

export interface ToolSchemaBudget {
  schemaTokenEstimate: number;
  descriptionTokenEstimate: number;
  descriptionCount: number;
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

export const TOOL_SCHEMA_SCENARIOS: ToolSchemaScenario[] = [
  {
    name: 'standard-default',
    config: DEFAULT_CONFIG,
    textSearchAvailable: true,
    resolvedFeatures: ALL_FEATURES_AVAILABLE,
    budget: {
      // +200/+150 for SAPRead action="diff" (action/from/to params + their descriptions).
      // +350/+350/+1 for context-first KTD guidance (KTD alias + SAPContext includeKtd).
      // +135/+100/+1 for SAPManage action="set_api_state" (apiState param + action/visibility docs).
      // +90/+60/+1 for the set_api_state `contract` param (C0–C4 enum + per-type docs).
      // +1 descriptionCount for SAPDiagnose `coverage` param (FEAT-41 AUnit coverage).
      // +~590/+440/+7 for SAPDiagnose trace_start/trace_requests/trace_cancel actions + their params.
      // +odata_perf/cds_sql actions + `url` param (PR #509 OData/SQL perf-insight).
      // +sql_trace_state/set_sql_trace_state/sql_trace_directory + `sqlOn` param (PR #510 ST05 trace control).
      schemaTokenEstimate: 13_800,
      descriptionTokenEstimate: 11_000,
      descriptionCount: 165,
    },
  },
  {
    name: 'standard-full-git',
    config: FULL_ACCESS_CONFIG,
    textSearchAvailable: true,
    resolvedFeatures: ALL_FEATURES_AVAILABLE,
    budget: {
      // schema +200 for SAPRead action="diff" (action/from/to params).
      // +400/+350 for context-first KTD guidance (KTD alias + SAPContext includeKtd).
      // +135/+135 for SAPManage action="set_api_state" (apiState param + action/visibility docs).
      // +120/+80/+1 for the set_api_state `contract` param (C0–C4 enum + per-type docs).
      // +1 descriptionCount / ~60 desc tokens for SAPDiagnose `coverage` param (FEAT-41).
      // +TTYP read/write type + SAPWrite rowType/rowTypeKind params (FEAT-65).
      // +~570/+460/+6 for SAPDiagnose trace_start/trace_requests/trace_cancel actions + their params.
      // +odata_perf/cds_sql actions + `url` param (PR #509 OData/SQL perf-insight).
      // +sql_trace_* actions + `sqlOn` param (PR #510 ST05 trace control).
      schemaTokenEstimate: 22_000,
      descriptionTokenEstimate: 16_950,
      descriptionCount: 282,
    },
  },
  {
    name: 'btp-full-git',
    config: { ...FULL_ACCESS_CONFIG, systemType: 'btp' },
    textSearchAvailable: true,
    resolvedFeatures: { ...ALL_FEATURES_AVAILABLE, systemType: 'btp' },
    budget: {
      // Bumped +200 for the SAPTransport `remove_object` action (its pgmid/type/name key +
      // action description). Keeps ~110 tokens of headroom, matching the other scenarios.
      // Further +200/+150 for SAPRead action="diff" (action/from/to params + descriptions).
      // +450/+350 for context-first KTD guidance (KTD alias + SAPContext includeKtd).
      // +135/+135 for SAPManage action="set_api_state" (apiState param + action/visibility docs).
      // +120/+80 for the set_api_state `contract` param (C0–C4 enum + per-type docs).
      // +1 descriptionCount / ~60 desc tokens for SAPDiagnose `coverage` param (FEAT-41).
      // +SAPWrite rowType/rowTypeKind params (FEAT-65; global SAPWrite props, present on BTP too).
      // +~570/+460/+4 for SAPDiagnose trace_start/trace_requests/trace_cancel actions + their params.
      // +odata_perf/cds_sql actions + `url` param (PR #509 OData/SQL perf-insight).
      // +sql_trace_* actions + `sqlOn` param (PR #510 ST05 trace control).
      schemaTokenEstimate: 20_240,
      descriptionTokenEstimate: 15_300,
      descriptionCount: 280,
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
  const serialized = JSON.stringify(definitions);
  const schemaBytes = Buffer.byteLength(serialized, 'utf8');
  const descriptions = collectDescriptionStats(definitions);

  return {
    scenario: scenario.name,
    tools: definitions.length,
    schemaBytes,
    schemaTokenEstimate: estimateTokens(schemaBytes),
    descriptionCount: descriptions.count,
    descriptionBytes: descriptions.bytes,
    descriptionTokenEstimate: descriptions.tokenEstimate,
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
    for (const metric of ['schemaTokenEstimate', 'descriptionTokenEstimate', 'descriptionCount'] as const) {
      if (measurement[metric] > budget[metric]) {
        offenders.push({
          scenario: measurement.scenario,
          metric,
          actual: measurement[metric],
          budget: budget[metric],
        });
      }
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
        `  ${measurement.scenario}: tools=${measurement.tools}, schema~${measurement.schemaTokenEstimate} tokens ` +
        `(${measurement.schemaBytes} bytes), descriptions=${measurement.descriptionCount}/~${measurement.descriptionTokenEstimate} tokens`,
    ),
  ];

  if (offenders.length === 0) {
    lines.push('✓ tool schema budget: all scenarios within budget.');
    return lines.join('\n');
  }

  lines.push('', '✗ tool schema budget failed:');
  for (const offender of offenders) {
    lines.push(`  ${offender.scenario}.${offender.metric}: ${offender.actual} (budget ${offender.budget})`);
  }
  lines.push(
    '',
    'Trim tool descriptions/schema payload, move long examples into docs/help surfaces, or raise the budget deliberately.',
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
