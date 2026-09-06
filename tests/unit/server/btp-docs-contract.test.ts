import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, parseDocument } from 'yaml';
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
  it('inspects and deploys the same explicitly named archive without a rebuild step', () => {
    const runbook = read('docs_page/btp-cloud-foundry-deployment.md');
    const inspected = /npm run btp:inspect-mtar -- --archive "([^"]+)"/.exec(runbook)?.[1];
    const deployment = runbook.split('## 6. Deploy the MTA')[1]?.split('## 7.')[0] ?? '';
    expect(inspected).toBe('mta_archives/arc1-mcp_<version>.mtar');
    expect(deployment).toContain(`cf deploy "${inspected}" -e mta-overrides.mtaext`);
    const commands = [...deployment.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]).join('\n');
    expect(commands).not.toMatch(/btp:build|btp:deploy|mbt build/);
    expect(runbook).not.toMatch(/inspect_mtar\(\)|\$MTAR|Sort-Object LastWriteTime|ls -t mta_archives/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['btp:inspect-mtar']).toBe('node scripts/btp/inspect-mtar.mjs');
  });

  it('routes administration acceptance to SAP-side identity evidence, not SYSTEM.user', () => {
    const admin = read('docs_page/btp-administration.md');
    expect(admin).toContain('principal-propagation-setup.md#verify-the-backend-identity');
    expect(admin).not.toContain('must identify the human SAP user');
  });

  it('does not package the AppRouter regression-test directory', () => {
    const descriptor = parse(read('mta.yaml'));
    const router = descriptor.modules.find((module: { name: string }) => module.name === 'arc1-ui-router');
    expect(router['build-parameters'].ignore).toContain('test/');
  });

  it('uses the observed CF route rather than deriving OAuth URLs from the space', () => {
    const xsuaa = read('docs_page/xsuaa-setup.md');
    expect(xsuaa).toContain('cf app <app-name>');
    expect(xsuaa).toContain('curl -fsS "$ARC1_URL/.well-known/oauth-authorization-server"');
    expect(xsuaa).not.toContain('https://arc1-mcp-<space>.');
    expect(xsuaa).not.toContain('onto per-space naming changes its route host');
  });

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
    ).toEqual(['pip install -r requirements-docs.txt', 'mkdocs build --strict']);
    const pages = parse(read('.github/workflows/pages.yml'));
    for (const job of [workflow.jobs.docs, pages.jobs.build, pages.jobs.deploy]) {
      for (const step of job.steps) {
        if (step.uses) {
          expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
          expect(step.uses).not.toContain('actions/setup-node');
        }
        expect(step.with?.['fetch-depth']).not.toBe(0);
      }
    }
    expect(pages.jobs.build.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ run: 'pip install -r requirements-docs.txt' }),
        expect.objectContaining({ run: 'mkdocs build --strict' }),
      ]),
    );
  });

  it('makes broken local anchors fail the strict documentation build', () => {
    expect(parseDocument(read('mkdocs.yml')).getIn(['validation', 'links', 'anchors'])).toBe('warn');
  });
});
