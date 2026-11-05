import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import {
  contractSelection,
  observeContractHttp,
} from '../../../scripts/qualification/pr1142/native-contract-transport.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtHttpClient } from '../../../src/adt/http.js';

it.each([200, 500])('bounds chunked native response bodies before recording them (HTTP %s)', async (status) => {
  let sends = 0;
  const server = createServer((_req, res) => {
    sends++;
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.write('x'.repeat(80));
    res.end('y'.repeat(80));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server');
  const rows: unknown[] = [];
  const selection = contractSelection('0123456789ABCDEF');
  const http = observeContractHttp(
    new AdtHttpClient({ baseUrl: `http://127.0.0.1:${address.port}` }),
    selection,
    (row) => rows.push(row),
    async () => {},
  );
  try {
    await expect(
      http.get(selection.moduleUrl, undefined, { responseBudget: new DataResponseBudget(128, 'test', true) }),
    ).rejects.toMatchObject({ name: 'AdtResponseLimitError' });
    expect(sends).toBe(1);
    expect(rows).not.toContainEqual(expect.objectContaining({ stage: 'response' }));
    expect(JSON.stringify(rows)).not.toContain('xxxxxxxx');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
