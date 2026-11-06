import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { expect, it, vi } from 'vitest';
import { loadRapAvailability } from '../../e2e/rap-write-helpers.js';

function clientWithRap(rap: unknown): Client {
  return {
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ rap }) }] }),
  } as unknown as Client;
}

it('probes availability even when the server has not populated its feature cache', async () => {
  const client = clientWithRap({ available: true, mode: 'auto' });
  await expect(loadRapAvailability(client)).resolves.toBe(true);
  expect(client.callTool).toHaveBeenCalledWith({ name: 'SAPManage', arguments: { action: 'probe' } });
});

it.each([
  { available: false, mode: 'auto', message: 'RAP/CDS development is not available — endpoint not found (404)' },
  { available: false, mode: 'off', message: 'Disabled by configuration' },
])('allows a known absent or disabled RAP prerequisite: %j', async (rap) => {
  await expect(loadRapAvailability(clientWithRap(rap))).resolves.toBeUndefined();
});

it.each([
  'auth failure (401) — cannot determine availability',
  'forbidden (403) — endpoint exists but user lacks authorization',
  'network error',
  'cannot determine availability from an invalid ADT response',
])('keeps failed RAP probes visible: %s', async (message) => {
  await expect(loadRapAvailability(clientWithRap({ available: false, mode: 'auto', message }))).rejects.toThrow(
    'RAP probe failure',
  );
});
