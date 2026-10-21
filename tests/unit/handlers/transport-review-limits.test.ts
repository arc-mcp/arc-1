// Regression: an oversized CTS inventory through the real HTTP + dispatch path.
import { expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

it('explains an oversized transport inventory without data-query advice', async () => {
  const entry = (i: number) =>
    `<tm:abap_object tm:pgmid="LIMU" tm:type="METH" tm:name="ZCL_BIG_${i}" tm:wbtype="CLAS/OM" tm:obj_info="Method (ABAP Objects)" tm:position="${i}"/>`;
  const body = `<?xml version="1.0" encoding="utf-8"?><tm:root xmlns:tm="http://www.sap.com/cts/transports"><tm:request tm:number="A4HK900001" tm:owner="DEV" tm:desc="Big" tm:status="R" tm:type="K"><tm:task tm:number="A4HK900002" tm:owner="DEV" tm:status="R"><tm:abap_object_list>${Array.from({ length: 9000 }, (_, i) => entry(i)).join('')}</tm:abap_object_list></tm:task></tm:request></tm:root>`;
  expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);
  mockFetch.mockResolvedValue(
    mockResponse(200, body, { 'content-type': 'application/vnd.sap.adt.transportorganizer.v1+xml' }),
  );
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPTransport', {
    action: 'diff',
    id: 'A4HK900001',
  });
  expect(result.isError).toBe(true);
  const text = result.content[0]!.text;
  expect(text).not.toContain('data-preview');
  expect(text).toContain('too large for an automated review');
});
