/** Live lock/save/unlock lifecycle coverage using the configured direct test identity (not a PP route). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { createObject, safeUpdateClassInclude, safeUpdateSource } from '../../src/adt/crud.js';
import { activate } from '../../src/adt/devtools.js';
import { sourceHash } from '../../src/adt/source-precondition.js';
import { buildCreateXml, CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('shared mutation lifecycle against SAP', () => {
  let client: AdtClient;
  const registry = new CrudRegistry();
  beforeAll(() => {
    const connected = getTestClient();
    client = connected.withSafety({ ...connected.safety, allowedPackages: ['$TMP'] });
  });
  afterAll(async () => {
    if (client) expect((await cleanupAll(client.http, client.safety, registry)).failed).toEqual([]);
  });

  it('saves main source and an include, rejects a stale hash, then reacquires the lock and activates', async () => {
    const name = generateUniqueName('ZARC1_MUT');
    const owner = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
    const sourceUrl = `${owner}/source/main`;
    await createObject(
      client.http,
      client.safety,
      '/sap/bc/adt/oo/classes',
      buildCreateXml('CLAS', name, '$TMP', 'ARC-1 shared mutation lifecycle test'),
    );
    registry.register(owner, 'CLAS', name);
    const initial = `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS value RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS ${name.toLowerCase()} IMPLEMENTATION.
  METHOD value.
    result = 1.
  ENDMETHOD.
ENDCLASS.
`;
    await safeUpdateSource(client.http, client.safety, owner, sourceUrl, initial);
    const before = (await client.http.get(sourceUrl)).body;
    expect(before).toContain('result = 1.');
    const include = `${owner}/includes/testclasses`;
    await safeUpdateClassInclude(client.http, client.safety, owner, include, '* ARC-1 lifecycle fixture\n');
    expect((await client.http.get(include)).body).toContain('ARC-1 lifecycle fixture');

    await safeUpdateSource(
      client.http,
      client.safety,
      owner,
      sourceUrl,
      initial.replace('= 1.', '= 2.'),
      undefined,
      undefined,
      sourceHash(before),
    );
    const after = (await client.http.get(sourceUrl)).body;
    expect(after).toContain('result = 2.');

    // A stale hash is refused under the lock; the lock is released and can be reacquired.
    await expect(
      safeUpdateSource(client.http, client.safety, owner, sourceUrl, initial, undefined, undefined, sourceHash(before)),
    ).rejects.toThrow();
    expect((await client.http.get(sourceUrl)).body).toBe(after);
    await safeUpdateSource(
      client.http,
      client.safety,
      owner,
      sourceUrl,
      initial.replace('= 1.', '= 3.'),
      undefined,
      undefined,
      sourceHash(after),
    );
    expect((await client.http.get(sourceUrl)).body).toContain('result = 3.');
    expect((await activate(client.http, client.safety, owner)).success).toBe(true);
    expect((await cleanupAll(client.http, client.safety, registry)).failed).toEqual([]);
    await expect(client.http.get(owner)).rejects.toMatchObject({ statusCode: 404 });
  }, 120_000);
});
