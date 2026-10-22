/** Read-only qualification. Supply 1–10 stable saved logs, each with at most 200 messages. */
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import type { readApplicationLog } from '../../src/adt/application-log.js';
import type { AdtClient } from '../../src/adt/client.js';
import { DataResponseBudget } from '../../src/adt/data-result-context.js';
import { checkOperation, defaultSafetyConfig, OperationType } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

const service = '/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/';
const configured = process.env.TEST_APPLICATION_LOG_NUMBERS?.trim();
const numbers = configured ? configured.split(',').map((value) => value.trim()) : [undefined];
const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, allowDataPreview: true };
const auth = { token: 'integration', clientId: 'application-log-test', scopes: ['data'] };
type Result = Awaited<ReturnType<typeof readApplicationLog>>;
type Message = Extract<Result, { status: 'ok' }>['messages'][number];
interface NativeMessage {
  MessageNumber: string;
  Type: string;
  Text: string;
  Timestamp: string;
  HasLongText: boolean;
  HasDetailText: boolean;
}

describe('saved application logs on live SAP', () => {
  let client: AdtClient;
  beforeAll(() => {
    requireSapCredentials();
    if (configured && (numbers.length > 10 || numbers.some((value) => !/^\d{20}$/u.test(value ?? '')))) {
      throw new Error('TEST_APPLICATION_LOG_NUMBERS must contain 1–10 comma-separated exact 20-digit numbers.');
    }
    client = getTestClient().withSafety({ ...defaultSafetyConfig(), allowDataPreview: true });
  });

  async function native<T>(path: string, parameters: Record<string, string>) {
    checkOperation(client.safety, OperationType.Query, 'ApplicationLogIntegrationReference');
    const response = await client.http.get(
      `${service}${path}?${new URLSearchParams({ ...parameters, $format: 'json' })}`,
      { Accept: 'application/json' },
      { responseBudget: new DataResponseBudget(2 * 1024 * 1024), signal: AbortSignal.timeout(30_000) },
    );
    return JSON.parse(response.body).d as { results: T[]; __next?: string };
  }

  async function read(logNumber: string, maxRows?: number, offset?: number) {
    const response = await handleToolCall(
      client,
      config,
      'SAPQuery',
      { action: 'application_log', applicationLog: { logNumber, maxRows, offset } },
      auth,
    );
    // Keep SAP payloads and log identities out of assertion output, including on failure.
    expect(response.isError, 'Public application-log call must succeed').not.toBe(true);
    const result = JSON.parse(response.content[0]!.text as string) as Result;
    if (result.status !== 'ok')
      throw new Error('Configured saved log is not visible; choose a stable visible fixture.');
    expect(result.logNumber === logNumber).toBe(true);
    expect(result.snapshotGuaranteed).toBe(false);
    return result;
  }

  for (const [index, logNumber] of numbers.entries()) {
    it(`matches native rendering and complete pagination for fixture ${index + 1}`, async (ctx) => {
      requireOrSkip(ctx, logNumber, `${SkipReason.NO_FIXTURE}: set TEST_APPLICATION_LOG_NUMBERS to stable saved logs`);
      const overview = await native<{ LogHandle: string; LogNumber: string }>('ApplicationLogOverviewSet', {
        $filter: `LogNumber eq '${logNumber}'`,
        $top: '2',
      });
      expect(overview.results.length, 'Configured fixture must be visible and unique').toBe(1);
      expect(overview.results[0]!.LogNumber === logNumber).toBe(true);
      const handle = encodeURIComponent(overview.results[0]!.LogHandle.replaceAll("'", "''")).replaceAll("'", '%27');
      // Deliberately use HeaderSet; the production reader navigates from OverviewSet.
      const reference = await native<NativeMessage>(`ApplicationLogHeaderSet('${handle}')/ApplicationLogMessageSet`, {
        $top: '201',
        $skip: '0',
      });
      expect(reference.results.length, 'Choose a stable fixture with at most 200 messages').toBeLessThanOrEqual(200);
      expect(Boolean(reference.__next), 'Reference must contain the complete fixture').toBe(false);
      const expected: Message[] = reference.results.map((row) => ({
        number: row.MessageNumber,
        type: row.Type,
        text: row.Text,
        timestamp: row.Timestamp,
        hasLongText: row.HasLongText,
        hasDetails: row.HasDetailText,
      }));

      for (const size of [1, 2, 100]) {
        const page = await read(logNumber, size);
        expect(isDeepStrictEqual(page.messages, expected.slice(0, size)), `Page size ${size} must match SAP`).toBe(
          true,
        );
      }
      const collected: Message[] = [];
      let offset = 0;
      for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
        const page = await read(logNumber, undefined, offset);
        expect(page.messages.length).toBeLessThanOrEqual(50);
        expect(isDeepStrictEqual(page.messages, expected.slice(offset, offset + 50))).toBe(true);
        collected.push(...page.messages);
        expect(page.more).toBe(offset + 50 < expected.length);
        if (!page.more) break;
        expect(page.nextOffset).toBe(offset + 50);
        offset = page.nextOffset!;
      }
      expect(isDeepStrictEqual(collected, expected), 'Complete default-size pagination must match SAP').toBe(true);
      expect(new Set(collected.map((message) => message.number)).size).toBe(collected.length);
      for (const end of [expected.length, expected.length + 1]) {
        const page = await read(logNumber, 1, end);
        expect(page.messages.length).toBe(0);
        expect(page.more).toBe(false);
        expect(page).not.toHaveProperty('nextOffset');
      }
    }, 60_000);
  }
});
