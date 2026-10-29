import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

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
