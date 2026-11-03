import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { BDEF_COLLECTION } from '../../../src/adt/bdef-extension-candidates.js';
import { AdtClient } from '../../../src/adt/client.js';
import { RELATIONS_MIME, RELATIONS_PATH, relationObjectUri } from '../../../src/adt/repository-relations.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedDiscovery, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

it.each(
  ['CLAS', 'INTF', 'BDEF'].flatMap((type) =>
    ['SAPNavigate', 'SAPNavigate.relations', 'SAP.navigate'].flatMap((deny) =>
      (type === 'BDEF' ? [true, false] : [true]).map((warm) => ({ type, deny, warm })),
    ),
  ),
)('$type preserves independent reads when $deny is denied (warm=$warm)', async ({ type, deny, warm }) => {
  const uri = relationObjectUri(type, 'ZROOT');
  const source = type === 'BDEF' ? 'define behavior for ENTITY {}' : `${type} original source`;
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://loopback.invalid').pathname.toLowerCase();
    paths.push(path);
    if (path === `${uri}/source/main`) res.end(source);
    else if (path === uri) {
      const tag = type === 'CLAS' ? 'abapClass' : 'abapInterface';
      res.end(
        `<${tag} name="ZROOT" type="${type === 'CLAS' ? 'CLAS/OC' : 'INTF/OI'}" version="active">${type === 'CLAS' ? '<include includeType="main"><link rel="http://www.sap.com/adt/relations/enhancements" href="source/main/enhancements/elements"/></include>' : ''}</${tag}>`,
      );
    } else if (path === `${uri}/source/main/enhancements/elements`)
      res.end(
        readFileSync(new URL('../../fixtures/extensions/source/class-758.xml', import.meta.url), 'utf8')
          .replaceAll('cl_seef_adt_test_aunit_1', 'zroot')
          .replaceAll('CL_SEEF_ADT_TEST_AUNIT_1', 'ZROOT'),
      );
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected listener');
    const client = new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    client.safety.denyActions.push(deny);
    const discovery = new Map([
      [BDEF_COLLECTION, []],
      [RELATIONS_PATH, [RELATIONS_MIME]],
    ]);
    if (warm) {
      setCachedDiscovery(discovery);
      setCachedFeatures({ abapRelease: '758', discoveryMap: discovery });
    } else resetCachedFeatures();
    const read = (extensions: string) =>
      handleToolCall(
        client,
        { ...DEFAULT_CONFIG, toolMode: deny === 'SAP.navigate' ? 'hyperfocused' : 'standard' },
        deny === 'SAP.navigate' ? 'SAP' : 'SAPRead',
        deny === 'SAP.navigate'
          ? { action: 'read', type, name: 'ZROOT', version: 'active', params: { extensions } }
          : { type, name: 'ZROOT', version: 'active', extensions },
      );
    const legacy = await read('none');
    const result = await read('sources');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual(legacy.content[0]);
    const summary = JSON.parse(result.content[1]!.text.slice('[extensions] '.length));
    expect(summary.providers[0].status).toBe('denied');
    if (type === 'CLAS') {
      expect(summary.providers.find((p: { id: string }) => p.id === 'source_plugins').status).toBe('returned');
      expect(summary.identities.length).toBeGreaterThan(0);
      expect(result.content.some((block) => block.text.includes('representation=rendered_plugin_source'))).toBe(true);
      expect(paths).toContain(`${uri}/source/main/enhancements/elements`);
      expect(summary.consumed.sends).toBe(2);
    } else {
      expect(summary.identities).toEqual([]);
      expect(summary.consumed.sends).toBe(0);
    }
    expect(paths).not.toContain(RELATIONS_PATH);
  } finally {
    resetCachedFeatures();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('retains native class identities after a hook failure under one shared optional allowance', async () => {
  const name = 'CL_SEEF_ADT_TEST_AUNIT_1';
  const owner = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
  const source = `CLASS ${name} DEFINITION.\nENDCLASS.\r\n`;
  const metadata = readFileSync(
    new URL('../../fixtures/extensions/source/class-metadata-758.xml', import.meta.url),
    'utf8',
  );
  const network = readFileSync(
    new URL('../../fixtures/class-extensions/class-hook-native.xml', import.meta.url),
    'utf8',
  );
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://loopback.invalid').pathname.toLowerCase();
    paths.push(path);
    res.setHeader('x-csrf-token', 'TEST');
    if (path === `${owner}/source/main`) res.end(source);
    else if (path === owner) res.end(metadata);
    else if (path === RELATIONS_PATH) res.end(network);
    else if (path === `${owner}/enhancements/implementations`) res.writeHead(500).end('synthetic hook failure');
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected listener');
    const client = new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'CLAS',
      name,
      extensions: 'summary',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe(source);
    const block = result.content.find((entry) => entry.text.startsWith('[extensions] '));
    const summary = JSON.parse(block!.text.slice('[extensions] '.length));
    expect(summary.providers.find((provider: { id: string }) => provider.id === 'class_exted_obj').status).toBe(
      'returned',
    );
    expect(summary.providers.find((provider: { id: string }) => provider.id === 'source_plugins').status).toBe(
      'incomplete',
    );
    expect(summary.identities.length).toBeGreaterThan(0);
    expect(summary.consumed.sends).toBe(paths.length - 1);
    expect(summary.consumed.sends).toBeLessThanOrEqual(6);
    expect(summary.consumed.responseBytes).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.byteLength(block!.text)).toBeLessThanOrEqual(2048);
  } finally {
    resetCachedFeatures();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
