import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BTP UI AppRouter config', () => {
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

    expect(descriptor).toContain('name: arc1-ui-router');
    expect(descriptor).toContain('supported-platforms: []');
    expect(descriptor).toContain('name: arc1-mcp-api');
    expect(descriptor).toContain('forwardAuthToken: true');
    expect(extension).toContain('ARC1_UI: "web"');
    expect(extension).toContain('supported-platforms:');
    expect(extension).toContain('CF');
  });
});
