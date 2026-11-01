import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { lockObject, unlockObject } from '../../src/adt/crud.js';
import { activate } from '../../src/adt/devtools.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

// Through dispatch: exercise schema/normalization, the real package gate, lock/PUT/unlock,
// and read-back. All writes belong to uniquely named disposable $TMP objects.
describe('text elements via SAPRead/SAPWrite', () => {
  let client: AdtClient;
  const registry = new CrudRegistry();
  const config = { ...DEFAULT_CONFIG, allowWrites: true, allowedPackages: ['$TMP'], lintBeforeWrite: false };

  beforeAll(async () => {
    client = getTestClient();
    client.safety.allowedPackages = ['$TMP'];
    client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
  });

  afterAll(async () => {
    if (!client) return;
    const report = await cleanupAll(client.http, client.safety, registry);
    expect(report.failed, 'all temporary text-pool objects must be deleted').toEqual([]);
  });

  async function call(tool: string, args: Record<string, unknown>): Promise<string> {
    const result = await handleToolCall(client, config, tool, args);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.content.map((c) => c.text ?? '').join('\n');
  }

  it('avoids a fresh empty class save and verifies state after real writes', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/textelements/classes'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/classes collection absent`,
    );
    const name = generateUniqueName('ZARC1_TPS');
    const objectUrl = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
    const poolUrl = `/sap/bc/adt/textelements/classes/${name.toLowerCase()}`;
    await call('SAPWrite', {
      action: 'create',
      type: 'CLAS',
      name,
      package: '$TMP',
      source: `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\nENDCLASS.`,
    });
    registry.register(objectUrl, 'CLAS', name);
    await call('SAPActivate', { type: 'CLAS', name });
    const write = (source: string) => call('SAPWrite', { action: 'edit_text_symbols', type: 'CLAS', name, source });
    expect(await write('')).toContain('No changes: symbols');
    expect((await client.http.get(`${poolUrl}?version=inactive`)).body).toContain('adtcore:version="active"');
    expect(await write('@MaxLength:20\n001=State test\n')).toContain('SAP reports the text pool active');
    const cleared = await write('');
    expect(cleared).toContain('SAP reports the text pool active');
    expect(cleared).toContain('Removed texts: 001');
    expect((await client.http.get(`${poolUrl}?version=inactive`)).body).toContain('adtcore:version="active"');
    await call('SAPWrite', { action: 'delete', type: 'CLAS', name });
    registry.remove(name);
    await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
  }, 60_000);

  it('explains the first activation needed after writing a new program text pool', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/textelements/programs'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/programs collection absent`,
    );
    const name = generateUniqueName('ZARC1_IT');
    const objectUrl = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
    const poolUrl = `/sap/bc/adt/textelements/programs/${name.toLowerCase()}`;
    await call('SAPWrite', {
      action: 'create',
      type: 'PROG',
      name,
      package: '$TMP',
      source: `REPORT ${name.toLowerCase()}.\nPARAMETERS p_test TYPE c LENGTH 10.\nWRITE p_test.`,
    });
    registry.register(objectUrl, 'PROG', name);
    ctx.onTestFinished(async () => {
      // Even if an assertion fails, activate before deletion so no inactive text pool is orphaned.
      await call('SAPActivate', { type: 'PROG', name });
      await call('SAPWrite', { action: 'delete', type: 'PROG', name });
      registry.remove(name);
      await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
    });
    const message = await call('SAPWrite', {
      action: 'edit_text_symbols',
      type: 'PROG',
      name,
      textPart: 'selections',
      source: 'P_TEST=New program label',
    });
    expect(message).toContain(`SAPActivate(type="PROG", name="${name}")`);
    expect(message).toContain('never been activated');
    expect(message).not.toContain('Updated and activated');
    const activation = await call('SAPActivate', { type: 'REPT', name });
    expect(activation).toContain('Text-pool activation requested');
    expect(activation).toContain(`SAPActivate(type="PROG", name="${name}")`);
    await call('SAPActivate', { type: 'PROG', name });
    const inactive = await client.getInactiveObjects();
    expect(inactive.filter((entry) => [objectUrl, poolUrl].includes(entry.uri.toLowerCase()))).toEqual([]);
    expect(await call('SAPRead', { type: 'TEXT_ELEMENTS', objectType: 'PROG', name, include: 'selections' })).toMatch(
      /P_TEST\s*=New program label/,
    );
  }, 60_000);

  it('activates an existing program text draft by either type and in a batch without activating source', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/textelements/programs'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/programs collection absent`,
    );
    const name = generateUniqueName('ZARC1_IT');
    const objectUrl = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
    const poolUrl = `/sap/bc/adt/textelements/programs/${name.toLowerCase()}`;
    const source = `REPORT ${name.toLowerCase()}.\nPARAMETERS p_test TYPE c LENGTH 10.\nWRITE 'active'.`;
    await call('SAPWrite', { action: 'create', type: 'PROG', name, package: '$TMP', source });
    registry.register(objectUrl, 'PROG', name);
    ctx.onTestFinished(async () => {
      // Clean the pool even if testing a broken activation route, so deletion cannot orphan it.
      expect((await activate(client.http, client.safety, poolUrl, { preaudit: false, name })).success).toBe(true);
      await call('SAPWrite', { action: 'delete', type: 'PROG', name });
      registry.remove(name);
      await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
    });
    await call('SAPActivate', { type: 'PROG', name });
    const active = (await client.http.get(`${objectUrl}/source/main?version=active`)).body;
    await call('SAPWrite', { action: 'update', type: 'PROG', name, source: source.replace("'active'", "'draft'") });
    for (const args of [{ type: 'REPT', name }, { type: 'PROG/PX', name }, { objects: [{ type: 'PROG/PX', name }] }]) {
      // Stage an inactive pool directly: SAPWrite now activates it automatically (#946).
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, client.safety, poolUrl, 'MODIFY');
        try {
          await session.put(
            `${poolUrl}/source/selections?lockHandle=${encodeURIComponent(lock.lockHandle)}`,
            'P_TEST=Pending label',
            'application/vnd.sap.adt.textelements.selections.v1',
            { Accept: 'application/vnd.sap.adt.textelements.selections.v1' },
          );
        } finally {
          await unlockObject(session, poolUrl, lock.lockHandle);
        }
      });
      expect((await client.getInactiveObjects()).some((entry) => entry.uri.toLowerCase() === poolUrl)).toBe(true);
      expect(await call('SAPActivate', args)).toMatch(/requested/);
      expect((await client.getInactiveObjects()).some((entry) => entry.uri.toLowerCase() === poolUrl)).toBe(false);
      expect((await client.http.get(`${objectUrl}/source/main?version=active`)).body).toBe(active);
      expect((await client.http.get(`${objectUrl}/source/main?version=inactive`)).body).toContain("'draft'");
      expect(await client.getTextElementPart('PROG', name, 'selections')).toMatch(/P_TEST\s*=Pending label/);
    }
  }, 60_000);

  for (const type of ['PROG', 'FUGR'] as const) {
    it(`${type} selection screen and text-pool lifecycle`, async (ctx) => {
      const collection = type === 'PROG' ? 'programs' : 'functiongroups';
      requireOrSkip(
        ctx,
        client.http.discoveryAcceptFor(`/sap/bc/adt/textelements/${collection}`),
        `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/${collection} collection absent`,
      );
      const name = generateUniqueName(type === 'PROG' ? 'ZARC1_IT' : 'ZATG');
      const objectUrl = `${type === 'PROG' ? '/sap/bc/adt/programs/programs' : '/sap/bc/adt/functions/groups'}/${name.toLowerCase()}`;
      const fields =
        'PARAMETERS p_test TYPE c LENGTH 10.\nDATA v_test TYPE c LENGTH 10.\nSELECT-OPTIONS s_test FOR v_test.';
      await call('SAPWrite', {
        action: 'create',
        type,
        name,
        package: '$TMP',
        description: 'ARC-1 text-pool lifecycle',
      });
      registry.register(objectUrl, type, name);
      if (type === 'PROG') {
        await call('SAPWrite', {
          action: 'update',
          type,
          name,
          source: `REPORT ${name.toLowerCase()}.\n${fields}\nWRITE 'Hello'.`,
        });
      } else {
        await call('SAPWrite', {
          action: 'update',
          type: 'INCL',
          group: name,
          name: `L${name}TOP`,
          source: `FUNCTION-POOL ${name}.\nSELECTION-SCREEN BEGIN OF SCREEN 100.\n${fields}\nSELECTION-SCREEN END OF SCREEN 100.`,
        });
      }
      await call('SAPActivate', { type, name });

      if (type === 'FUGR') {
        expect(await call('SAPWrite', { action: 'edit_text_symbols', type, name, source: '' })).toContain(
          'No changes: symbols',
        );
      }

      const read = (part?: string) =>
        call('SAPRead', { type: 'TEXT_ELEMENTS', objectType: type, name, ...(part ? { include: part } : {}) });
      const write = async (textPart: string, source: string) => {
        const message = await call('SAPWrite', { action: 'edit_text_symbols', type, name, textPart, source });
        const poolUri = `/sap/bc/adt/textelements/${collection}/${name.toLowerCase()}`;
        expect(message).toContain('SAP reports the text pool active');
        expect((await client.http.get(`${poolUri}?version=inactive`)).body).toContain('adtcore:version="active"');
        const inactive = await client.getInactiveObjects();
        expect(inactive.filter((entry) => entry.uri.toLowerCase() === poolUri)).toEqual([]);
        return message;
      };

      await write('symbols', '@MaxLength:20\n001=Hello\n\n@MaxLength:20\n002=Second\n');
      const symbols = await read('symbols');
      expect(symbols).toContain('001=Hello');
      expect(symbols).toContain('002=Second');

      await write('selections', 'P_TEST=Parameter label\nS_TEST=Selection label\n');
      const selections = await read('selections');
      expect(selections).toMatch(/P_TEST\s*=Parameter label/);
      expect(selections).toMatch(/S_TEST\s*=Selection label/);
      expect(await read('symbols')).toBe(symbols);

      await write(
        'headings',
        'listHeader=Lifecycle report\n\ncolumnHeader_1=First column\ncolumnHeader_2=\ncolumnHeader_3=\ncolumnHeader_4=\n',
      );
      const headings = await read('headings');
      expect(headings).toContain('listHeader=Lifecycle report');
      expect(headings).toContain('columnHeader_1=First column');
      expect(await read('selections')).toBe(selections);
      const whole = await read();
      for (const [part, body] of [
        ['symbols', symbols],
        ['selections', selections],
        ['headings', headings],
      ]) {
        expect(whole).toContain(`=== ${part} ===\n${body}`);
      }

      // Rejected bodies must leave the earlier pool intact and release the lock for the next write.
      const malformed = await handleToolCall(client, config, 'SAPWrite', {
        action: 'edit_text_symbols',
        type,
        name,
        source: '@MaxLength:20\n001=Broken\n002=Missing max length\n',
      });
      expect(malformed.isError).toBe(true);
      expect(malformed.content[0]?.text).toMatch(/406|inconsisten|text elements contain errors/i);
      expect(await read('symbols')).toBe(symbols);
      // Clearing a value is also a loss even when SAP retains the symbol definition.
      expect(await write('symbols', '@MaxLength:20\n001=Hello\n\n@MaxLength:20\n002=')).toContain(
        'Removed texts: 002.',
      );
      expect(await read('symbols')).toMatch(/002=\s*$/);
      await write('symbols', '@MaxLength:20\n001=Hello\n\n@MaxLength:20\n002=Second');
      expect(await write('symbols', '@MaxLength:20\n001=Replacement\n')).toContain('Removed texts: 002.');
      expect(await read('symbols')).toContain('001=Replacement');
      expect(await read('symbols')).not.toContain('002=');

      // Explicit empty source clears only the selected part, without requiring SAPActivate.
      expect(await write('symbols', '')).toContain('Removed texts: 001.');
      expect(await read('symbols')).toBe('');
      expect(await read('selections')).toBe(selections);
      expect(await read('headings')).toBe(headings);
      expect(await write('selections', '')).toContain('Removed texts: P_TEST, S_TEST.');
      expect(await read('selections')).not.toMatch(/Parameter label|Selection label/);
      expect(await read('headings')).toBe(headings);

      await call('SAPWrite', { action: 'delete', type, name });
      registry.remove(name);
      await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
    }, 60_000);
  }

  it('reports native selection removals after lowercase keys and dictionary labels are normalized', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/textelements/programs'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/programs collection absent`,
    );
    const name = generateUniqueName('ZARC1_IT');
    const objectUrl = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
    await call('SAPWrite', {
      action: 'create',
      type: 'PROG',
      name,
      package: '$TMP',
      source: `REPORT ${name.toLowerCase()}.\nPARAMETERS p_user TYPE syuname.\nPARAMETERS p_test TYPE c LENGTH 10.`,
    });
    registry.register(objectUrl, 'PROG', name);
    ctx.onTestFinished(async () => {
      await call('SAPActivate', { type: 'PROG', name });
      await call('SAPWrite', { action: 'delete', type: 'PROG', name });
      registry.remove(name);
      await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
    });
    await call('SAPActivate', { type: 'PROG', name });
    const write = (source: string) =>
      call('SAPWrite', {
        action: 'edit_text_symbols',
        type: 'PROG',
        name,
        textPart: 'selections',
        source,
      });
    await write('@DDICReference\nP_USER=User name\nP_TEST=Original label');
    const complete = await client.getTextElementPart('PROG', name, 'selections');
    expect(complete).toContain('@DDICReference');
    const message = await write('p_user=Fixed name');
    expect(message).toContain('Removed texts: P_TEST.');
    expect(message).toContain('Removed dictionary references: P_USER.');
    const saved = await client.getTextElementPart('PROG', name, 'selections');
    expect(saved).toMatch(/P_USER\s*=Fixed name/);
    expect(saved).toMatch(/P_TEST\s*=\?\.\.\./);
    expect(saved).not.toContain('@DDICReference');
    expect(await write(complete)).not.toContain('Removed');
    expect(await client.getTextElementPart('PROG', name, 'selections')).toBe(complete);
  }, 60_000);

  // #940: a pool saved without activation (ARC-1 <= 1.5.1, SE38) must not outlive its deleted program.
  for (const activated of [true, false]) {
    it(`preserves ${activated ? 'an active' : 'a never-activated'} program and its pool draft until explicit activation`, async (ctx) => {
      requireOrSkip(
        ctx,
        client.http.discoveryAcceptFor('/sap/bc/adt/textelements/programs'),
        `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/programs collection absent`,
      );
      const name = generateUniqueName('ZARC1_IT');
      const objectUrl = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
      const poolUrl = `/sap/bc/adt/textelements/programs/${name.toLowerCase()}`;
      const repotext = async () =>
        (await client.runQuery(`SELECT progname, r3state FROM repotext WHERE progname = '${name}'`)).rows;
      const program = {
        action: 'create',
        type: 'PROG',
        name,
        package: '$TMP',
        source: `REPORT ${name.toLowerCase()}.\nPARAMETERS p_test TYPE c LENGTH 10.\nWRITE p_test.`,
      };
      await call('SAPWrite', program);
      registry.register(objectUrl, 'PROG', name);
      try {
        if (activated) await call('SAPActivate', { type: 'PROG', name });
        await client.http.withStatefulSession(async (session) => {
          const lock = await lockObject(session, client.safety, poolUrl, 'MODIFY');
          try {
            const ct = 'application/vnd.sap.adt.textelements.selections.v1';
            const url = `${poolUrl}/source/selections?lockHandle=${encodeURIComponent(lock.lockHandle)}`;
            await session.put(url, 'P_TEST=Draft label', ct, { Accept: ct });
          } finally {
            await unlockObject(session, poolUrl, lock.lockHandle);
          }
        });
        expect(await repotext()).toContainEqual(expect.objectContaining({ R3STATE: 'I' }));

        const refused = await handleToolCall(client, config, 'SAPWrite', { action: 'delete', type: 'PROG', name });
        expect(refused.isError).toBe(true);
        expect(refused.content[0]?.text).toContain('text pool is inactive');
        await expect(client.http.get(objectUrl)).resolves.toBeDefined();
        expect(await repotext()).toContainEqual(expect.objectContaining({ R3STATE: 'I' }));
        expect(
          (
            await client.http.get(`${poolUrl}/source/selections?version=inactive`, {
              Accept: 'application/vnd.sap.adt.textelements.selections.v1',
            })
          ).body,
        ).toContain('Draft label');
        if (!activated) await call('SAPActivate', { type: 'PROG', name });
        await call('SAPActivate', { type: 'REPT', name });
        await call('SAPWrite', { action: 'delete', type: 'PROG', name });
        await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
        expect(await repotext()).toEqual([]);
      } finally {
        // A regression can delete the program but leave its pool. Recover that orphan too.
        if ((await repotext()).length > 0) {
          try {
            await client.http.get(objectUrl);
          } catch (error) {
            expect(error).toMatchObject({ statusCode: 404 });
            await call('SAPWrite', program);
          }
          await call('SAPActivate', { type: 'PROG', name });
          const result = await activate(client.http, client.safety, poolUrl, { preaudit: false, name });
          expect(result.success, JSON.stringify(result)).toBe(true);
          await call('SAPWrite', { action: 'delete', type: 'PROG', name });
        }
        await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
        expect(await repotext()).toEqual([]);
        registry.remove(name);
      }
    }, 60_000);
  }
  it('explains and performs explicit recovery before deleting an uncompilable new program', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/textelements/programs'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/programs collection absent`,
    );
    const name = generateUniqueName('ZARC1_IT');
    const objectUrl = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
    await call('SAPWrite', {
      action: 'create',
      type: 'PROG',
      name,
      package: '$TMP',
      source: `REPORT ${name}.\nthis is invalid abap.`,
    });
    try {
      const refused = await handleToolCall(client, config, 'SAPWrite', { action: 'delete', type: 'PROG', name });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toContain(`replace the source with REPORT ${name}.`);
      await expect(client.http.get(objectUrl)).resolves.toBeDefined();
    } finally {
      await call('SAPWrite', { action: 'update', type: 'PROG', name, source: `REPORT ${name}.` });
      await call('SAPActivate', { type: 'PROG', name });
      await call('SAPWrite', { action: 'delete', type: 'PROG', name });
      await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
      expect((await client.runQuery(`SELECT progname, r3state FROM repotext WHERE progname = '${name}'`)).rows).toEqual(
        [],
      );
    }
  }, 60_000);
});
