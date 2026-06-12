import { describe, expect, it } from 'vitest';
import {
  checkToolSchemaBudgets,
  collectDescriptionStats,
  estimateTokens,
  formatToolSchemaBudgetReport,
  TOOL_SCHEMA_SCENARIOS,
  type ToolSchemaScenario,
} from '../../../scripts/ci/check-tool-schema-budget.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('check-tool-schema-budget', () => {
  it('estimates tokens with the CI byte/4 heuristic', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(8)).toBe(2);
    expect(estimateTokens(9)).toBe(3);
  });

  it('counts only string-valued description fields recursively', () => {
    const stats = collectDescriptionStats({
      description: 'top',
      properties: {
        description: {
          type: 'string',
          description: 'schema field named description',
        },
        nested: [{ description: 'nested' }, { description: 42 }],
      },
    });

    expect(stats).toEqual({
      count: 3,
      bytes: Buffer.byteLength('topschema field named descriptionnested', 'utf8'),
      tokenEstimate: 10,
    });
  });

  it('passes the current ARC-1 tool schema scenarios under their ratchet budgets', () => {
    const { measurements, offenders } = checkToolSchemaBudgets();

    expect(offenders).toEqual([]);
    expect(measurements.map((measurement) => measurement.scenario)).toEqual(
      TOOL_SCHEMA_SCENARIOS.map((scenario) => scenario.name),
    );
    expect(measurements.find((measurement) => measurement.scenario === 'hyperfocused-default')).toMatchObject({
      tools: 1,
      schemaTokenEstimate: expect.any(Number),
    });
  });

  it('reports every metric that exceeds a scenario budget', () => {
    const scenario: ToolSchemaScenario = {
      name: 'tiny-budget',
      config: DEFAULT_CONFIG,
      textSearchAvailable: true,
      budget: {
        schemaTokenEstimate: 1,
        descriptionTokenEstimate: 1,
        descriptionCount: 1,
      },
    };

    const { measurements, offenders } = checkToolSchemaBudgets([scenario]);
    const report = formatToolSchemaBudgetReport(measurements, offenders);

    expect(offenders.map((offender) => offender.metric)).toEqual([
      'schemaTokenEstimate',
      'descriptionTokenEstimate',
      'descriptionCount',
    ]);
    expect(report).toContain('tiny-budget.schemaTokenEstimate');
    expect(report).toContain('Trim tool descriptions/schema payload');
  });
});
