/** Live shared-lifecycle coverage using the configured direct test identity, not a PP route qualification. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { createObject, safeUpdateClassInclude, safeUpdateSource } from '../../src/adt/crud.js';
import { sourceHash } from '../../src/adt/source-precondition.js';
import { handlePinnedWrite } from '../../src/handlers/write/pinned.js';
import { handlePinnedActivation } from '../../src/handlers/write/pinned-activation.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
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

  it('saves through both adapters, rejects a stale hash, then reacquires the lock and activates', async () => {
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

    // Exercise the production pinned adapter with a test-only policy. Authentication remains
    // the direct test identity: this does not test XSUAA grants, destinations or PP mapping.
    const policy = {
      target: `DIRECT_TEST/${client.sapClient}`,
      enabled: true,
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    };
    const config = {
      ...DEFAULT_CONFIG,
      targetId: policy.target,
      multiTargetEndpoints: true,
      multiTargetWrite: policy,
      allowWrites: true,
      allowedPackages: ['$TMP'],
      ppEnabled: true,
      ppStrict: true,
      lintBeforeWrite: false,
    };
    const pinned = client.withSafety({ ...client.safety, multiTargetWrite: policy });
    const args = { action: 'update', type: 'CLAS', name, expectedSourceHash: sourceHash(before) };
    const saved = await handlePinnedWrite(pinned, { ...args, source: initial.replace('= 1.', '= 2.') }, config);
    expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
    expect(JSON.parse(saved.content[0]!.text!).state).toBe('saved-inactive');
    const after = (await client.http.get(sourceUrl)).body;
    expect(after).toContain('result = 2.');

    const stale = await handlePinnedWrite(pinned, { ...args, source: initial }, config);
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale)).toContain('Source changed');
    expect((await client.http.get(sourceUrl)).body).toBe(after);
    const again = await handlePinnedWrite(
      pinned,
      { ...args, expectedSourceHash: sourceHash(after), source: initial.replace('= 1.', '= 3.') },
      config,
    );
    expect(again.isError, JSON.stringify(again)).not.toBe(true);
    expect((await client.http.get(sourceUrl)).body).toContain('result = 3.');
    const activation = await handlePinnedActivation(pinned, { type: 'CLAS', name });
    expect(activation.isError, JSON.stringify(activation)).not.toBe(true);
    expect(JSON.parse(activation.content[0]!.text!).success).toBe(true);
    expect((await cleanupAll(client.http, client.safety, registry)).failed).toEqual([]);
    await expect(client.http.get(owner)).rejects.toMatchObject({ statusCode: 404 });
  }, 120_000);
});
