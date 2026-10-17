import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  DDIC_LOG_MEDIA,
  DDIC_LOG_RELATION,
  parseDdicActivationLog,
  readDdicActivationLog,
} from '../../../src/adt/ddic-activation-log.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const xml = readFileSync(new URL('../../fixtures/xml/ddic-log-758.xml', import.meta.url), 'utf8');
const object = { type: 'DOMA', name: 'ZARC1_TD_DOM', uri: '/sap/bc/adt/ddic/domains/ZARC1_TD_DOM' };
const metadata = (href?: string) =>
  `<domain name="ZARC1_TD_DOM">${href ? `<link rel="${DDIC_LOG_RELATION}" type="${DDIC_LOG_MEDIA}" href="${href}"/>` : ''}</domain>`;
it('preserves the captured hierarchy and stale activation text without inventing a run timestamp', () => {
  const log = parseDdicActivationLog(xml);
  expect(log.entryCount).toBe(9);
  expect(log.entries[2]?.children[0]?.messages[0]?.text).toBe('Technical log for mass activation');
  expect(log.entries[1]?.messages[0]?.text).toContain('03.08.2026');
});
it('retains plain-text messages from every message branch', () => {
  const log = parseDdicActivationLog(
    '<log><entry><message><messageText>First finding</messageText></message><message><messageText>Second finding</messageText></message></entry></log>',
  );
  expect(log.entries[0]?.messages.map((message) => message.text)).toEqual(['First finding', 'Second finding']);
});
it('follows only the advertised log with GET and reports no attempt correlation', async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ body: metadata('/sap/bc/adt/ddic/logs/db/ACTDOMAZARC1_TD_DOM') })
    .mockResolvedValueOnce({ body: xml });
  const result = await readDdicActivationLog({ get } as unknown as AdtHttpClient, defaultSafetyConfig(), object);
  expect(result).toMatchObject({ status: 'available', correlation: 'not-established', activationTime: null });
  expect(get).toHaveBeenLastCalledWith(
    '/sap/bc/adt/ddic/logs/db/ACTDOMAZARC1_TD_DOM',
    { Accept: DDIC_LOG_MEDIA },
    expect.any(Object),
  );
});
it('keeps missing relations, denial and missing log distinct and refuses external/arbitrary links', async () => {
  const get = vi.fn().mockResolvedValue({ body: metadata() });
  const http = { get } as unknown as AdtHttpClient;
  expect(await readDdicActivationLog(http, defaultSafetyConfig(), object)).toMatchObject({ status: 'unsupported' });
  for (const statusCode of [403, 404]) {
    get.mockRejectedValueOnce(new AdtApiError('SAP error', statusCode, object.uri));
    expect(await readDdicActivationLog(http, defaultSafetyConfig(), object)).toMatchObject({
      status: statusCode === 403 ? 'denied' : 'unavailable',
    });
  }
  for (const href of [
    'https://evil.test/log',
    '/sap/bc/adt/activation',
    '/sap/bc/adt/ddic/logs/../activation',
    '/sap/bc/adt/ddic/logs/x%2F..%2F..%2Factivation',
    '/sap/bc/adt/ddic/logs/%252FABC%252FNAME',
  ]) {
    get.mockResolvedValueOnce({ body: metadata(href) });
    await expect(readDdicActivationLog(http, defaultSafetyConfig(), object)).rejects.toThrow(/unsafe/);
  }
});
it('bounds hierarchy and refuses malformed or unrelated XML', () => {
  const many =
    '<log>' + Array.from({ length: 251 }, (_, i) => `<entry id="${i}" severity="unknown"/>`).join('') + '</log>';
  expect(parseDdicActivationLog(many)).toMatchObject({ entryCount: 250, truncated: true });
  expect(() => parseDdicActivationLog('<html/>')).toThrow();
  expect(() => parseDdicActivationLog('<log>')).toThrow();
});
it('refuses identity mismatch, ambiguous relations and unsafe initial paths without reading a log', async () => {
  const get = vi.fn();
  const http = { get } as unknown as AdtHttpClient;
  get.mockResolvedValueOnce({ body: metadata('/sap/bc/adt/ddic/logs/x').replace('ZARC1_TD_DOM', 'OTHER') });
  await expect(readDdicActivationLog(http, defaultSafetyConfig(), object)).rejects.toThrow(/identity/);
  expect(get).toHaveBeenCalledTimes(1);
  get.mockClear();
  get.mockResolvedValueOnce({
    body: metadata('/sap/bc/adt/ddic/logs/x').replace(
      '</domain>',
      `<link rel="${DDIC_LOG_RELATION}" type="${DDIC_LOG_MEDIA}" href="/sap/bc/adt/ddic/logs/y"/></domain>`,
    ),
  });
  await expect(readDdicActivationLog(http, defaultSafetyConfig(), object)).rejects.toThrow(/Ambiguous/);
  expect(get).toHaveBeenCalledTimes(1);
  get.mockClear();
  await expect(
    readDdicActivationLog(http, defaultSafetyConfig(), { ...object, uri: 'https://foreign.example/log' }),
  ).rejects.toThrow(/unsafe/);
  expect(get).not.toHaveBeenCalled();
});
it('marks deep, long and unknown log evidence explicitly', () => {
  const log = parseDdicActivationLog(
    `<log>${'<entry severity="new-kind">'.repeat(9)}<message><messageText>${'x'.repeat(2001)}</messageText></message>${'</entry>'.repeat(9)}</log>`,
  );
  expect(log.truncated).toBe(true);
  expect(log.entryCount).toBe(8);
  expect(log.entries[0]).toMatchObject({ severity: 'unknown', rawSeverity: 'new-kind' });
  const long = parseDdicActivationLog(
    `<log><entry><message><messageText>${'x'.repeat(2001)}</messageText></message></entry></log>`,
  );
  expect(long.truncated).toBe(true);
  expect(long.entries[0]?.messages[0]?.text).toHaveLength(2000);
});
