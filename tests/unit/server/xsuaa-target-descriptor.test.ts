import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { parseArgs } from '../../../src/server/config.js';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const security = JSON.parse(read('xs-security.json'));
const base = parse(read('mta.yaml'));
const app = base.modules.find((entry: { name: string }) => entry.name === 'arc1-mcp-server');
const xsuaa = base.resources.find((entry: { name: string }) => entry.name === 'arc1-xsuaa');
const templates = security['role-templates'];
const collections = xsuaa.parameters.config['role-collections'];
const profile = parse(read('examples/btp/multi-pp/profile.mtaext'));
const overlay = parse(read('examples/btp/multi-pp/target-authorization.mtaext'));

describe('additive XSUAA target-grant descriptor contract', () => {
  it('keeps all existing scopes and their role-template references unchanged', () => {
    expect(security.scopes.map((scope: { name: string }) => scope.name)).toEqual(
      ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'].map((name) => `$XSAPPNAME.${name}`),
    );
    const existing = [
      ['MCPViewer', ['read']],
      ['MCPDeveloper', ['read', 'write', 'transports', 'git']],
      ['MCPDataViewer', ['data']],
      ['MCPSqlUser', ['data', 'sql']],
      ['MCPAdmin', ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin']],
    ] as const;
    for (const [name, scopes] of existing) {
      const template = templates.find((entry: { name: string }) => entry.name === name);
      expect(template['scope-references']).toEqual(scopes.map((scope) => `$XSAPPNAME.${scope}`));
      expect(template).not.toHaveProperty('attribute-references');
    }
    expect(templates.map((entry: { name: string }) => entry.name)).toEqual([
      ...existing.map(([name]) => name),
      'MCPTargetReadAccess',
      'MCPAllTargetReadAccess',
    ]);
  });

  it('requires explicit exact grants and only generates the deliberate all-target default role', () => {
    expect(security.attributes).toEqual([
      {
        name: 'arc1_targets',
        description: 'Exact ARC-1 public target IDs, or explicit * for all targets',
        valueType: 'string',
        valueRequired: true,
      },
    ]);
    expect(templates.find((entry: { name: string }) => entry.name === 'MCPTargetReadAccess')).toEqual({
      name: 'MCPTargetReadAccess',
      description: 'Read-only ARC-1 access to selected SAP targets',
      'scope-references': ['$XSAPPNAME.read'],
      'attribute-references': ['arc1_targets'],
    });
    expect(templates.find((entry: { name: string }) => entry.name === 'MCPAllTargetReadAccess')).toEqual({
      name: 'MCPAllTargetReadAccess',
      description: 'Read-only ARC-1 access to all current and future SAP targets',
      'scope-references': ['$XSAPPNAME.read'],
      'attribute-references': [{ name: 'arc1_targets', 'default-values': ['*'] }],
    });
    expect(security).not.toHaveProperty('role-collections');
    expect(security['oauth2-configuration']).not.toHaveProperty('scopes');
    expect(JSON.stringify(security.scopes)).not.toMatch(/arc1_targets|user_attributes/);
  });

  it('does not broaden an existing collection or assign users when publishing all-target access', () => {
    const existing = [
      ['Viewer', ['MCPViewer']],
      ['Developer', ['MCPDeveloper']],
      ['Data Viewer', ['MCPViewer', 'MCPDataViewer']],
      ['Viewer + SQL', ['MCPViewer', 'MCPSqlUser']],
      ['Developer + Data', ['MCPDeveloper', 'MCPDataViewer']],
      ['Developer + SQL', ['MCPDeveloper', 'MCPSqlUser']],
      ['Admin', ['MCPAdmin']],
    ] as const;
    expect(collections).toHaveLength(existing.length + 1);
    for (const [index, [name, references]] of existing.entries()) {
      expect(collections[index].name).toBe(`ARC-1 ${name} (\${space})`);
      expect(collections[index]['role-template-references']).toEqual(references.map((ref) => `$XSAPPNAME.${ref}`));
    }
    expect(collections.at(-1)).toEqual({
      name: `ARC-1 All Targets (\${space})`,
      description: 'Read-only ARC-1 access to all current and future configured SAP targets',
      'role-template-references': ['$XSAPPNAME.MCPAllTargetReadAccess'],
    });
    for (const collection of collections) {
      expect(Object.keys(collection).sort()).toEqual(['description', 'name', 'role-template-references']);
    }
    expect(xsuaa.parameters.path).toBe('xs-security.json');
    expect(xsuaa.parameters.config.xsappname).toBe(`arc1-mcp-\${space}`);
  });
});

describe('optional target-authorization deployment overlay', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (/^(SAP_|ARC1_|VCAP_)/.test(key)) delete process.env[key];
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it('changes only the authorization mode and leaves deployment/identity settings with the profile', () => {
    expect(overlay).toEqual({
      '_schema-version': '3.1',
      ID: 'arc1-multi-pp-target-authorization-example',
      extends: base.ID,
      modules: [{ name: app.name, properties: { ARC1_MULTI_TARGET_AUTHORIZATION: 'xsuaa-attribute' } }],
    });
    expect(app.properties).not.toHaveProperty('ARC1_MULTI_TARGET_AUTHORIZATION');
    expect(profile.modules[0].properties).not.toHaveProperty('ARC1_MULTI_TARGET_AUTHORIZATION');
    for (const [key, value] of Object.entries({ ...app.properties, ...profile.modules[0].properties })) {
      process.env[key] = String(value);
    }
    const legacy = parseArgs([]);
    expect(legacy.multiTargetAuthorization).toBe('legacy');
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = overlay.modules[0].properties.ARC1_MULTI_TARGET_AUTHORIZATION;
    expect(parseArgs([])).toEqual({ ...legacy, multiTargetAuthorization: 'xsuaa-attribute' });
  });

  it('validates the combined profile and keeps operator instructions on the canonical runbooks', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['btp:validate']).toContain(
      'mbt validate -e examples/btp/multi-pp/profile.mtaext -e examples/btp/multi-pp/target-authorization.mtaext',
    );
    const guide = read('examples/btp/multi-pp/README.md');
    expect(guide).toContain('target-authorization.mtaext');
    expect(guide).toContain('multi-target-setup.md');
    expect(guide).toContain('principal-propagation-setup.md#verify-the-backend-identity');
    expect(guide).not.toMatch(/^cp /m);
  });
});
