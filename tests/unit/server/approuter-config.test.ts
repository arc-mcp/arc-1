import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
});
