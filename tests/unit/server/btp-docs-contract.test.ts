import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { multiTargetToolDefinitions } from '../../../src/server/multi-target-tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const guide = read('docs_page/multi-target-setup.md');
const config = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };

function documentedActions(markdown: string): Map<string, string[]> {
  const block = markdown
    .split('<!-- multi-target-action-contract:start')[1]
    ?.split('<!-- multi-target-action-contract:end -->')[0];
  if (!block) throw new Error('Missing maintained action table');
  const rows = new Map<string, string[]>();
  for (const line of block.split('\n')) {
    const row = /^\| `(SAP\w+)` \| (.*) \|$/.exec(line);
    if (!row) continue;
    if (rows.has(row[1]!)) throw new Error('Duplicate tool row');
    rows.set(
      row[1]!,
      [...row[2]!.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!),
    );
  }
  return rows;
}

function assertParity(markdown: string): void {
  const rows = documentedActions(markdown);
  const definitions = multiTargetToolDefinitions(getToolDefinitions(config), config);
  expect([...rows.keys()].sort()).toEqual(definitions.map((tool) => tool.name).sort());
  for (const name of ['SAPLint', 'SAPDiagnose', 'SAPTransport']) {
    const tool = definitions.find((item) => item.name === name)!;
    const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(rows.get(name)?.toSorted(), name).toEqual(properties.action?.enum?.toSorted());
  }
}

describe('BTP documentation contracts', () => {
  it('keeps the maintained maximum action table in sync with the real schema', () => assertParity(guide));

  it('detects a missing or invented action (guard regression)', () => {
    expect(() => assertParity(guide.replace('`lint_and_fix`, ', ''))).toThrow();
    expect(() => assertParity(guide.replace('`list_rules` (offline', '`list_rules`, `format` (offline'))).toThrow();
  });

  it('builds docs for every PR without SAP credentials or deployment permissions', () => {
    const text = read('.github/workflows/docs.yml');
    const workflow = parse(text);
    expect(workflow.on).toHaveProperty('pull_request');
    expect(workflow.on.pull_request).toBeNull();
    expect(workflow.on).not.toHaveProperty('pull_request_target');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.docs).not.toHaveProperty('if');
    expect(text).not.toContain('secrets.');
    expect(
      workflow.jobs.docs.steps.filter((step: { run?: string }) => step.run).map((step: { run: string }) => step.run),
    ).toEqual(['pip install -r requirements-docs.txt', 'npm run docs:build']);
    for (const step of workflow.jobs.docs.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    }
    const pages = parse(read('.github/workflows/pages.yml'));
    expect(pages.jobs.build.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ run: 'pip install -r requirements-docs.txt' }),
        expect.objectContaining({ run: 'mkdocs build --strict' }),
      ]),
    );
  });
});
