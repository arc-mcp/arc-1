import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const execFileAsync = promisify(execFile);
// biome-ignore lint/suspicious/noTemplateCurlyInString: resolved by the deployment service.
const UI_REDIRECT_URI = 'https://arc1-ui-${space-guid}.${default-domain}/login/callback';

describe('BTP UI AppRouter config', () => {
  it('pins patched transitive dependencies on an AppRouter-supported Node release', async () => {
    const packageJson = JSON.parse(await readFile('btp/approuter/package.json', 'utf8')) as {
      engines: { node: string };
      overrides: Record<string, string>;
    };
    const packageLock = JSON.parse(await readFile('btp/approuter/package-lock.json', 'utf8')) as {
      packages: Record<string, { name?: string; version?: string; resolved?: string }>;
    };

    // 22.12 is the floor for require(esm), which the decode-uri-component bridge needs.
    expect(packageJson.engines.node).toBe('^22.12.0 || ^24.0.0');
    expect(packageJson.overrides).toMatchObject({
      axios: '1.18.0',
      'body-parser': '2.3.0',
      'decode-uri-component': 'file:./vendor/decode-uri-component-cjs',
    });
    expect(packageLock.packages['node_modules/axios']?.version).toBe('1.18.0');
    expect(packageLock.packages['node_modules/body-parser']?.version).toBe('2.3.0');
    // AppRouter pins its own patched ws (>= 7.5.10); never override it to a different major.
    // Asserted by version rather than tree position, which npm is free to hoist.
    expect(packageJson.overrides.ws).toBeUndefined();
    const wsEntries = Object.entries(packageLock.packages).filter(([path]) => path.endsWith('node_modules/ws'));
    expect(wsEntries.length).toBeGreaterThan(0);
    for (const [, entry] of wsEntries) {
      expect(entry.version).toBe('7.5.11');
    }

    // query-string reaches decode-uri-component pre-auth, and <= 0.4.2 decodes malformed
    // percent-encoding super-linearly (GHSA DoS). Every resolved copy must be the patched one.
    const decoders = Object.entries(packageLock.packages).filter(
      ([path, entry]) => entry.name === 'decode-uri-component' || path.endsWith('node_modules/decode-uri-component'),
    );
    expect(decoders.length).toBeGreaterThan(0);
    for (const [, entry] of decoders) {
      if (entry.resolved?.startsWith('https://')) {
        expect(entry.version).toBe('0.5.0');
      }
    }
    expect(packageLock.packages['node_modules/decode-uri-component-esm']?.version).toBe('0.5.0');
  });

  it('keeps the decode-uri-component bridge version in lockstep with the package it wraps', async () => {
    // GitHub keys its dependency graph off the lockfile PATH, so the bridge appears as
    // decode-uri-component@<bridge version> while the real tarball is hidden behind the
    // npm: alias (reported as decode-uri-component-esm, which is not a real package and
    // therefore never matches an advisory). The bridge's version field is the only thing
    // Dependabot can match on, so it has to name the version actually being wrapped.
    const bridge = JSON.parse(await readFile('btp/approuter/vendor/decode-uri-component-cjs/package.json', 'utf8')) as {
      version: string;
      dependencies: Record<string, string>;
    };
    const packageLock = JSON.parse(await readFile('btp/approuter/package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };

    const aliasSpec = bridge.dependencies['decode-uri-component-esm'];
    const wrappedVersion = aliasSpec?.replace('npm:decode-uri-component@', '');
    expect(wrappedVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bridge.version).toBe(wrappedVersion);
    expect(packageLock.packages['node_modules/decode-uri-component-esm']?.version).toBe(wrappedVersion);
    expect(packageLock.packages['node_modules/decode-uri-component']?.version).toBe(wrappedVersion);
  });

  it('allows only the reviewed AppRouter npm config through the MTAR inspection gate', async () => {
    const npmrc = await readFile('btp/approuter/.npmrc', 'utf8');
    const activeSettings = npmrc
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    const runbook = await readFile('docs_page/btp-cloud-foundry-deployment.md', 'utf8');

    // Keep the one allowed project config non-secret and narrowly scoped.
    expect(activeSettings).toEqual(['install-links=true']);
    // Both documented inspection implementations must compare the packaged file with source.
    expect(runbook).toContain(`[ "$member" = 'arc1-ui-router/data.zip' ]`);
    expect(runbook).toContain('cmp -s "$tmp/approuter.npmrc" btp/approuter/.npmrc');
    expect(runbook).toContain("$member.Directory.Name -eq 'arc1-ui-router'");
    expect(runbook).toContain('Get-FileHash $allowedNpmrc -Algorithm SHA256');
    // The blanket filename deny remains in place for every other module and path.
    expect(runbook.match(/deny\s*=\s*['"]\\\.env\|\\\.npmrc/g)).toHaveLength(2);
  });

  it('requires admin scope for all UI routes', async () => {
    const xsApp = JSON.parse(await readFile('btp/approuter/xs-app.json', 'utf8')) as {
      routes: Array<Record<string, unknown>>;
    };

    expect(xsApp.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '^/ui(.*)$',
          target: '/ui$1',
          destination: 'arc1-backend',
          authenticationType: 'xsuaa',
          scope: '$XSAPPNAME.admin',
        }),
      ]),
    );
    expect(xsApp.routes.every((route) => route.authenticationType === 'xsuaa')).toBe(true);
    expect(xsApp.routes.every((route) => route.scope === '$XSAPPNAME.admin')).toBe(true);
  });

  it('keeps the optional MTA extension wired to the backend JWT destination', async () => {
    const descriptor = await readFile('mta.yaml', 'utf8');
    const extension = await readFile('mta-ui-approuter.mtaext', 'utf8');
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(descriptor).toContain('name: arc1-ui-router');
    expect(descriptor).toContain('supported-platforms: []');
    expect(descriptor).toContain('name: arc1-mcp-api');
    expect(descriptor).toContain('forwardAuthToken: true');
    expect(extension).toContain('ARC1_UI: "web"');
    expect(extension).toContain('supported-platforms:');
    expect(extension).toContain('CF');
    expect(packageJson.scripts['btp:deploy-ui-ext']).toContain('scripts/btp/prepare-ui-mtaext.mjs');
    expect(packageJson.scripts['btp:deploy-ui-ext']).toContain('-e mta-ui-deploy.mtaext');
    expect(packageJson.scripts['btp:deploy-ui-ext']).not.toContain('-e mta-overrides.mtaext -e');
  });

  it('registers the optional AppRouter route as an exact XSUAA callback host', async () => {
    const extension = parse(await readFile('mta-ui-approuter.mtaext', 'utf8')) as Record<string, any>;
    const router = extension.modules.find((module: Record<string, any>) => module.name === 'arc1-ui-router');
    const xsuaa = extension.resources.find((resource: Record<string, any>) => resource.name === 'arc1-xsuaa');
    const redirects = xsuaa.parameters.config['oauth2-configuration']['redirect-uris'];

    // biome-ignore lint/suspicious/noTemplateCurlyInString: resolved by the deployment service.
    expect(router.parameters.host).toBe('arc1-ui-${space-guid}');
    expect(xsuaa.requires).toEqual([{ name: 'arc1-mcp-api' }]);
    expect(redirects).toEqual([
      '~{arc1-mcp-api/url}/oauth/callback',
      '~{arc1-mcp-api/url}/oauth/logged-out',
      UI_REDIRECT_URI,
    ]);
    const base = parse(await readFile('mta.yaml', 'utf8'));
    const baseRouter = base.modules.find((module: Record<string, any>) => module.name === 'arc1-ui-router');
    expect(baseRouter.parameters.host).toBeUndefined();
  });

  it('preserves restrictive operator config and a custom UI host when adding the UI callback', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'arc1-ui-mtaext-'));
    const inputPath = join(tempDir, 'input.mtaext');
    const outputPath = join(tempDir, 'output.mtaext');
    const input = {
      '_schema-version': '3.1',
      ID: 'operator-overrides',
      extends: 'arc1-mcp',
      modules: [{ name: 'arc1-ui-router', parameters: { host: 'operator-ui', memory: '256M' } }],
      resources: [
        {
          name: 'arc1-xsuaa',
          parameters: {
            config: {
              xsappname: 'operator-owned-name',
              'oauth2-configuration': {
                'redirect-uris': ['https://api.example.test/arc1/oauth/callback'],
                'grant-types': ['authorization_code'],
                'token-validity': 600,
              },
            },
          },
        },
      ],
    };

    try {
      await writeFile(inputPath, stringify(input));
      await execFileAsync(process.execPath, ['scripts/btp/prepare-ui-mtaext.mjs', inputPath, outputPath]);
      const generated = parse(await readFile(outputPath, 'utf8')) as Record<string, any>;
      const xsuaa = generated.resources.find((resource: Record<string, any>) => resource.name === 'arc1-xsuaa');
      const redirects = xsuaa.parameters.config['oauth2-configuration']['redirect-uris'];

      expect(xsuaa.parameters.config.xsappname).toBe('operator-owned-name');
      expect(redirects).toEqual([
        'https://api.example.test/arc1/oauth/callback',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: resolved by the deployment service.
        'https://operator-ui.${default-domain}/login/callback',
      ]);
      expect(xsuaa.parameters.config['oauth2-configuration']['grant-types']).toEqual(['authorization_code']);
      expect(xsuaa.parameters.config['oauth2-configuration']['token-validity']).toBe(600);
      expect(
        generated.modules.find((module: Record<string, any>) => module.name === 'arc1-ui-router').parameters.host,
      ).toBe('operator-ui');
      expect(xsuaa.requires).toEqual([{ name: 'arc1-mcp-api' }]);
      await execFileAsync(process.execPath, ['scripts/btp/prepare-ui-mtaext.mjs', outputPath, outputPath]);
      expect(parse(await readFile(outputPath, 'utf8'))).toEqual(generated);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the shipped UI defaults and inherits base OAuth settings when no operator extension exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'arc1-ui-mtaext-'));
    try {
      const outputPath = join(tempDir, 'output.mtaext');
      await execFileAsync(process.execPath, [
        'scripts/btp/prepare-ui-mtaext.mjs',
        join(tempDir, 'missing'),
        outputPath,
      ]);
      const generated = parse(await readFile(outputPath, 'utf8'));
      const shipped = parse(await readFile('mta-ui-approuter.mtaext', 'utf8'));
      expect(generated.resources).toEqual(shipped.resources);
      expect(generated.modules).toEqual(shipped.modules);
      expect(Object.keys(generated.resources[0].parameters.config['oauth2-configuration'])).toEqual(['redirect-uris']);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      parameters: { host: 'chosen-ui', domain: 'example.com' },
      callbacks: ['https://chosen-ui.example.com/login/callback'],
    },
    {
      parameters: { routes: [{ route: 'ui.example.com' }, { route: 'https://gateway.example.com/arc1/' }] },
      callbacks: ['https://ui.example.com/login/callback', 'https://gateway.example.com/arc1/login/callback'],
    },
    {
      parameters: { hosts: ['existing-ui', 'second-ui'], domain: 'example.com' },
      callbacks: ['https://existing-ui.example.com/login/callback', 'https://second-ui.example.com/login/callback'],
    },
    {
      parameters: {
        host: 'ignored',
        hosts: ['ui'],
        domain: 'ignored.example',
        domains: ['one.example', 'two.example'],
      },
      callbacks: ['https://ui.one.example/login/callback', 'https://ui.two.example/login/callback'],
    },
    {
      parameters: { host: 'ui', domain: 'example.com', 'route-path': '/arc1' },
      callbacks: ['https://ui.example.com/arc1/login/callback'],
    },
    {
      parameters: { 'no-hostname': true, domain: 'ui.example.com' },
      callbacks: ['https://ui.example.com/login/callback'],
    },
    {
      parameters: { 'no-route': true },
      callbacks: [],
    },
  ])('derives callbacks from the operator route settings: $parameters', async ({ parameters, callbacks }) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'arc1-ui-routes-'));
    try {
      const inputPath = join(tempDir, 'input.mtaext');
      const outputPath = join(tempDir, 'output.mtaext');
      await writeFile(
        inputPath,
        stringify({
          modules: [{ name: 'arc1-ui-router', parameters }],
        }),
      );
      await execFileAsync(process.execPath, ['scripts/btp/prepare-ui-mtaext.mjs', inputPath, outputPath]);
      const generated = parse(await readFile(outputPath, 'utf8'));
      const oauth = generated.resources[0].parameters.config['oauth2-configuration'];
      expect(oauth['redirect-uris']).toEqual([
        '~{arc1-mcp-api/url}/oauth/callback',
        '~{arc1-mcp-api/url}/oauth/logged-out',
        ...callbacks,
      ]);
      expect(
        generated.modules.find((module: Record<string, any>) => module.name === 'arc1-ui-router').parameters,
      ).toMatchObject(parameters);
      if ('hosts' in parameters || 'routes' in parameters) {
        expect(
          generated.modules.find((module: Record<string, any>) => module.name === 'arc1-ui-router').parameters.host,
        ).toBe('host' in parameters ? parameters.host : undefined);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
