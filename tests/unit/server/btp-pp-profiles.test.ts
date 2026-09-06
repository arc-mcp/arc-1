import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { parseArgs } from '../../../src/server/config.js';
import { projectMultiTargetDestination } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import type { ServerConfig } from '../../../src/server/types.js';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const base = parse(read('mta.yaml'));
const app = base.modules.find((module: { name: string }) => module.name === 'arc1-mcp-server');
const profile = (name: string) => parse(read(`examples/btp/${name}/profile.mtaext`));
const destination = (name: string, file: string) => JSON.parse(read(`examples/btp/${name}/${file}.destination.json`));

// Only the property maps of these constrained examples are overlaid here. MBT separately
// validates the actual descriptors; this helper is not a general MTA merger.
function resolveProfile(name: string): ServerConfig {
  const extension = profile(name);
  expect(Object.keys(extension).sort()).toEqual(['ID', '_schema-version', 'extends', 'modules']);
  expect(extension.extends).toBe(base.ID);
  expect(extension.modules).toHaveLength(1);
  expect(extension.modules[0].name).toBe(app.name);
  expect(Object.keys(extension.modules[0]).sort()).toEqual(['name', 'properties']);
  for (const [key, value] of Object.entries({ ...app.properties, ...extension.modules[0].properties })) {
    expect(typeof value, key).toBe('string');
    process.env[key] = value as string;
  }
  return parseArgs([]);
}

function registry(raw: Record<string, string>[], config: ServerConfig, instanceNames: string[] = []) {
  const subaccount = raw.map(
    (properties) =>
      projectMultiTargetDestination({
        Name: properties.Name!,
        Type: properties.Type,
        URL: properties.URL,
        Authentication: properties.Authentication,
        ProxyType: properties.ProxyType,
        // The SDK's normalized type requires these keys even for password-free PP.
        User: '',
        Password: '',
        originalProperties: properties,
      })!,
  );
  return DestinationRegistry.fromDiscovery(
    {
      subaccount,
      instanceNames,
      scannedCount: raw.length,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    config,
  );
}

function assertFixtureFields(raw: Record<string, unknown>) {
  expect(raw['sap-client']).toBeTypeOf('string');
  expect(raw['sap-client']).toMatch(/^\d{3}$/);
  expect(raw['sap-sysid']).toBe('QAS');
  expect(raw.Type).toBe('HTTP');
  expect(raw.ProxyType).toBe('OnPremise');
  const url = new URL(String(raw.URL));
  expect(url.protocol).toBe('http:'); // Virtual leg, not internal SCC → SAP protocol.
  expect(url.hostname).toMatch(/\.example\.invalid$/);
  expect(url.username).toBe('');
  expect(url.password).toBe('');
  if (raw.Authentication === 'BasicAuthentication') {
    expect(raw.User).toBe('<owner-supplied-startup-user>');
    expect(raw.Password).toBe('<owner-supplied-managed-secret>');
  } else {
    expect(raw.Authentication).toBe('PrincipalPropagation');
    expect(raw).not.toHaveProperty('User');
    expect(raw).not.toHaveProperty('Password');
  }
  expect(Object.keys(raw).filter((key) => /secret|token|certificate/i.test(key))).toEqual([]);
}

describe('actual BTP PP setup examples', () => {
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

  it.each(['single-pp', 'multi-pp'])('resolves %s with the conservative safety ceiling', (name) => {
    const config = resolveProfile(name);
    expect(config).toMatchObject({
      transport: 'http-streamable',
      ppEnabled: true,
      ppStrict: true,
      ppAllowSharedCookies: false,
      multiTargetAllowBasicAuth: false,
      cacheMode: 'none',
      toolMode: 'standard',
      uiMode: 'off',
      allowWrites: false,
      allowDataPreview: false,
      allowFreeSQL: false,
      allowTransportWrites: false,
      allowGitWrites: false,
    });
    expect(config.denyActions).toEqual(['SAPDiagnose.atc', 'SAPDiagnose.unittest']);
    expect(process.env.ARC1_PLUGINS).toBe('');
    expect(process.env.SAP_XSUAA_AUTH).toBe('true');
    expect(process.env.SAP_INSECURE).toBe('false');
    expect(process.env.ARC1_MULTI_TARGET_AUTHORIZATION).toBeUndefined();
  });

  it('pairs single startup and request destination names/client intent without multi markers', () => {
    const config = resolveProfile('single-pp');
    const startup = destination('single-pp', 'startup');
    const request = destination('single-pp', 'request');
    expect(config.multiTargetEndpoints).toBe(false);
    expect(process.env.SAP_BTP_DESTINATION).toBe(startup.Name);
    expect(process.env.SAP_BTP_PP_DESTINATION).toBe(request.Name);
    expect(startup.Name).not.toBe(request.Name);
    expect(startup.Authentication).toBe('BasicAuthentication');
    expect(request.Authentication).toBe('PrincipalPropagation');
    for (const raw of [startup, request]) {
      assertFixtureFields(raw);
      expect(raw['sap-client']).toBe('001');
      expect(Object.keys(raw).filter((key) => key.startsWith('arc1.'))).toEqual([]);
    }
  });

  it('discovers both multi PP clients through the real projector and full registry', () => {
    const config = resolveProfile('multi-pp');
    const raw = ['qas-001', 'qas-100'].map((file) => destination('multi-pp', file));
    raw.forEach(assertFixtureFields);
    expect(config.multiTargetEndpoints).toBe(true);
    expect(process.env.SAP_BTP_DESTINATION).toBeUndefined();
    expect(process.env.SAP_BTP_PP_DESTINATION).toBeUndefined();
    const result = registry(raw, config);
    expect(result.failure).toBeUndefined();
    expect(result.targets.map((target) => target.target)).toEqual(['QAS/001', 'QAS/100']);
    expect(result.counts.quarantined).toBe(0);
    for (const target of result.targets) {
      expect(target.identity).toBe('per-user');
      expect(target.effectivePolicy).toEqual({ allowDataPreview: false, allowFreeSQL: false });
    }
  });

  it('detects numeric clients, accidental credentials and colliding target identities', () => {
    const raw = destination('multi-pp', 'qas-001');
    expect(() => assertFixtureFields({ ...raw, 'sap-client': 1 })).toThrow();
    expect(() => assertFixtureFields({ ...raw, 'sap-client': 100 })).toThrow();
    expect(() => assertFixtureFields({ ...raw, Password: 'DO_NOT_SHIP_SECRET_SENTINEL' })).toThrow();
    const config = resolveProfile('multi-pp');
    expect(registry([raw, { ...raw, Name: 'OTHER' }], config).targets).toHaveLength(0);
    expect(registry([raw], config, [raw.Name]).targets).toHaveLength(0);
  });

  it('wires both packs into MBT validation and excludes examples/private files from packaging', () => {
    const command = JSON.parse(read('package.json')).scripts['btp:validate'];
    for (const name of ['single-pp', 'multi-pp']) {
      expect(command).toContain(`mbt validate -e examples/btp/${name}/profile.mtaext`);
    }
    expect(app['build-parameters'].ignore).toEqual(expect.arrayContaining(['examples/', '.arc1/']));
    expect(read('.gitignore').split('\n')).toContain('.arc1/');
  });

  it.each(['single-pp', 'multi-pp'])(
    'copies %s through the runbook without overwriting an existing override',
    (name) => {
      const guide = read('docs_page/btp-cloud-foundry-deployment.md');
      const command = guide.split('\n').find((line) => line.startsWith(`cp -n examples/btp/${name}/`));
      expect(command).toBe(`cp -n examples/btp/${name}/profile.mtaext mta-overrides.mtaext`);
      expect(guide).not.toMatch(/^cp mta-overrides\.mtaext\.example/m);
      const folder = mkdtempSync(join(tmpdir(), 'arc1-doc-profile-'));
      const source = `examples/btp/${name}/profile.mtaext`;
      const target = join(folder, 'mta-overrides.mtaext');
      try {
        mkdirSync(dirname(join(folder, source)), { recursive: true });
        writeFileSync(join(folder, source), read(source));
        const [program, ...args] = command!.split(' ');
        const first = spawnSync(program!, args, { cwd: folder });
        expect(first.error).toBeUndefined();
        expect(first.status).toBe(0);
        expect(readFileSync(target, 'utf8')).toBe(read(source));
        writeFileSync(target, 'existing customer override\n');
        const second = spawnSync(program!, args, { cwd: folder });
        expect(second.error).toBeUndefined();
        // cp -n's skip status differs by platform; the preservation contract does not.
        expect([0, 1]).toContain(second.status);
        expect(readFileSync(target, 'utf8')).toBe('existing customer override\n');
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  );

  it('keeps example readers on the canonical procedure and separates SAP identity evidence', () => {
    for (const name of ['single-pp', 'multi-pp']) {
      const example = read(`examples/btp/${name}/README.md`);
      expect(example).toContain('btp-cloud-foundry-deployment.md#4-create-the-landscape-extension');
      expect(example).toContain('principal-propagation-setup.md#verify-the-backend-identity');
      expect(example).not.toMatch(/^cp /m);
    }
    const pp = read('docs_page/principal-propagation-setup.md');
    expect(pp).toContain('### Verify the backend identity');
    expect(pp).toContain('configuration');
    expect(pp).toContain('**unverified**');
    expect(pp).not.toContain('must identify the propagated human user');
    expect(read('docs_page/btp-setup-worksheet.md')).not.toContain('## Task handoffs');
  });
});
