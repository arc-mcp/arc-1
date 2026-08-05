import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const execFileAsync = promisify(execFile);
// biome-ignore lint/suspicious/noTemplateCurlyInString: MTA resolves this placeholder at deployment time.
const UI_HOST = 'arc1-ui-${space-guid}';
// biome-ignore lint/suspicious/noTemplateCurlyInString: MTA resolves these placeholders at deployment time.
const UI_REDIRECT_URI = 'https://arc1-ui-${space-guid}.${default-domain}/**';

describe('BTP UI AppRouter config', () => {
  it('pins patched transitive dependencies on an AppRouter-supported Node release', async () => {
    const packageJson = JSON.parse(await readFile('btp/approuter/package.json', 'utf8')) as {
      engines: { node: string };
      overrides: Record<string, string>;
    };
    const packageLock = JSON.parse(await readFile('btp/approuter/package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };

    expect(packageJson.engines.node).toBe('^22.0.0 || ^24.0.0');
    expect(packageJson.overrides).toMatchObject({ axios: '1.18.0', 'body-parser': '2.3.0' });
    expect(packageLock.packages['node_modules/axios']?.version).toBe('1.18.0');
    expect(packageLock.packages['node_modules/body-parser']?.version).toBe('2.3.0');
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

    expect(router.parameters.host).toBe(UI_HOST);
    expect(xsuaa.requires).toEqual([{ name: 'arc1-mcp-api' }]);
    expect(redirects).toEqual(['http://localhost:*/**', '~{arc1-mcp-api/url}/**', UI_REDIRECT_URI]);
  });

  it('adds both deployment routes to the generated UI extension without discarding operator config', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'arc1-ui-mtaext-'));
    const inputPath = join(tempDir, 'input.mtaext');
    const outputPath = join(tempDir, 'output.mtaext');
    const input = {
      '_schema-version': '3.1',
      ID: 'operator-overrides',
      extends: 'arc1-mcp',
      resources: [
        {
          name: 'arc1-xsuaa',
          parameters: {
            config: {
              xsappname: 'operator-owned-name',
              'oauth2-configuration': {
                'redirect-uris': ['https://api.example.test/arc1/**'],
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
        'https://api.example.test/arc1/**',
        'http://localhost:*/**',
        '~{arc1-mcp-api/url}/**',
        UI_REDIRECT_URI,
      ]);
      expect(
        generated.modules.find((module: Record<string, any>) => module.name === 'arc1-ui-router').parameters.host,
      ).toBe(UI_HOST);
      expect(xsuaa.requires).toEqual([{ name: 'arc1-mcp-api' }]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
