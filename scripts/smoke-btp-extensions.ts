/** Read-only BTP qualification. Outputs hashes and coverage, never source or credentials. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AdtClient } from '../src/adt/client.js';
import { DataResponseBudget } from '../src/adt/data-result-context.js';
import { createBearerTokenProvider, loadServiceKeyFile } from '../src/adt/oauth.js';
import { checkOperation, OperationType } from '../src/adt/safety.js';
import { parseDiscoveryDocument, parseInstalledComponents } from '../src/adt/xml-parser.js';
import { handleToolCall } from '../src/handlers/dispatch.js';
import { setCachedDiscovery, setCachedFeatures } from '../src/handlers/feature-cache.js';
import { SAPREAD_TYPES_BTP } from '../src/handlers/tool-registry.js';
import { requestContext } from '../src/server/context.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const keyFile = process.env.TEST_BTP_SERVICE_KEY_FILE ?? process.env.SAP_BTP_SERVICE_KEY_FILE;
if (!keyFile) throw new Error('Supply TEST_BTP_SERVICE_KEY_FILE.');
const key = loadServiceKeyFile(keyFile);
const client = new AdtClient({
  baseUrl: key.url,
  client: key.abap?.sapClient ?? '100',
  language: 'EN',
  bearerTokenProvider: createBearerTokenProvider(key),
  retryUnauthorized: false,
});

async function main() {
  // A sleeping free-tier system can take several minutes; do not spend the OAuth callback window on startup.
  const readyBy = Date.now() + 600_000;
  for (;;) {
    const response = await fetch(new URL('/sap/bc/adt/discovery', key.url), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (response.status !== 503) break;
    if (Date.now() >= readyBy) throw new Error('BTP startup still returns HTTP 503.');
    process.stderr.write('BTP startup: HTTP 503; next readiness check in 20 seconds.\n');
    await delay(20_000);
  }
  checkOperation(client.safety, OperationType.Read, 'SmokeBtpExtensions');
  // Authenticate before starting bounded SAP reads. The browser flow is the normal named-user OAuth route.
  await client.http.get('/sap/bc/adt/core/discovery', undefined, { retryTransientErrors: false });
  const components = parseInstalledComponents(
    (
      await client.http.get(
        '/sap/bc/adt/system/components',
        { Accept: 'application/atom+xml;type=feed' },
        {
          deadline: Date.now() + 15_000,
          responseBudget: new DataResponseBudget(1024 * 1024),
          retryTransientErrors: false,
        },
      )
    ).body,
  );
  const release = components.find((component) => component.name === 'SAP_BASIS')?.release;
  assert.ok(release, 'Record the observed SAP_BASIS release before qualification.');
  const discovery = parseDiscoveryDocument(
    (
      await client.http.get(
        '/sap/bc/adt/discovery',
        { Accept: 'application/atomsvc+xml' },
        {
          deadline: Date.now() + 15_000,
          responseBudget: new DataResponseBudget(2 * 1024 * 1024),
          retryTransientErrors: false,
        },
      )
    ).body,
  );
  setCachedDiscovery(discovery);
  setCachedFeatures({ abapRelease: release, discoveryMap: discovery });
  const cases: Record<string, unknown>[] = [
    { type: 'CLAS', name: 'CL_ABAP_RANDOM' },
    { type: 'TABL', name: 'DSH_MEAL' },
    { type: 'TABL', name: 'DDTEST_STRU_INCLUDE' },
    { type: 'PROG', name: 'ENH_NESTED_DEMO' },
    {
      type: 'INCL',
      name: 'ENH_PROG_INCL_IMPLICIT_OPT',
      enhancementContext: { type: 'PROG', name: 'PROG_ENH_SUBOBJ_CHECK' },
    },
    { type: 'FUNC', name: 'SAPBC_GLOBAL_CANCEL_UPDATE', group: 'SAPBC_GLOBAL_FIS' },
    { type: 'FUGR', name: 'SEEF_ADT_TEST_AUNIT_FUGR1' },
    { type: 'CLAS', name: 'CL_OO_ADT_ENHANCED_CLASS' },
    { type: 'CLAS', name: 'CL_SEEF_ADT_TEST_AUNIT_1' },
    { type: 'INTF', name: 'IF_DSH_ENHANCED_OPTIONS' },
    { type: 'BDEF', name: 'DEMO_RAP_EXTENSIBLE' },
  ];
  const rows = [];
  const expectedIdentities = new Map([
    ['DSH_MEAL', 'DSH_S_MEAL_APPEND'],
    ['DDTEST_STRU_INCLUDE', 'DDTEST_APPEND_ACTIVE'],
    ['SEEF_ADT_TEST_AUNIT_FUGR1', 'SEEF_ADT_TEST_ENHO_FUGR1'],
    ['CL_OO_ADT_ENHANCED_CLASS', 'CL_OO_ADT_ENHANCED_CLASS1'],
    ['CL_SEEF_ADT_TEST_AUNIT_1', 'SEEF_ADT_TEST_ENHO_CLASS_1'],
    ['DEMO_RAP_EXTENSIBLE', 'DEMO_RAP_EXTEND1'],
  ]);
  for (const args of cases) {
    let baseline: string | undefined;
    for (const [observation, mode] of (['none', 'summary', 'sources', 'summary'] as const).entries()) {
      const result = await requestContext.run(
        { requestId: `btp-extensions-${args.name}-${mode}`, signal: AbortSignal.timeout(30_000) },
        () =>
          handleToolCall(client, { ...DEFAULT_CONFIG, systemType: 'btp' }, 'SAPRead', {
            ...args,
            version: 'active',
            extensions: mode,
          }),
      );
      if (!SAPREAD_TYPES_BTP.some((type) => type === args.type)) {
        assert.equal(result.isError, true, 'A schema-excluded BTP read type became available.');
        assert.match(result.content[0]!.text, /Invalid arguments for SAPRead/);
        rows.push({ args, mode, observation, status: 'tool_type_unavailable' });
        break;
      }
      if (result.isError) {
        assert.fail(`Expected the qualification fixture to be readable: ${args.type} ${args.name}`);
      }
      const first = result.content[0]!.text;
      if (mode === 'none') baseline = first;
      assert.equal(first, baseline, 'The base source block changed.');
      const extra = result.content.slice(1);
      const outputBytes = extra.reduce((sum, block) => sum + Buffer.byteLength(block.text), 0);
      assert.ok(outputBytes <= (mode === 'sources' ? 16 * 1024 : mode === 'summary' ? 2048 : 0));
      const block = extra.find((entry) => entry.text.startsWith('[extensions] '));
      const summary = block ? JSON.parse(block.text.slice('[extensions] '.length)) : undefined;
      if (mode !== 'none') {
        assert.ok(summary, 'Expected the public extension summary.');
        assert.ok(summary.consumed.sends <= (mode === 'summary' ? 6 : 20));
        assert.ok(summary.consumed.responseBytes <= (mode === 'summary' ? 128 : 256) * 1024);
      }
      if (mode === 'sources') {
        const expected = expectedIdentities.get(String(args.name));
        if (expected)
          assert.ok(
            summary.identities.some((identity: { name: string }) => identity.name === expected),
            `Missing expected identity ${expected}`,
          );
        if (args.type === 'BDEF')
          assert.ok(extra.some((entry) => entry.text.startsWith('[extension source BDEF DEMO_RAP_EXTEND1 ')));
      }
      rows.push({
        args,
        mode,
        observation,
        basePreserved: true,
        baseSha256: digest(first),
        outputBytes,
        summary,
        extraBlocks: extra
          .filter((entry) => entry !== block)
          .map((entry) => ({
            label: entry.text.split('\n', 1)[0],
            bytes: Buffer.byteLength(entry.text),
            sha256: digest(entry.text),
          })),
      });
    }
    process.stderr.write(`BTP extension check completed: ${args.type} ${args.name}\n`);
  }
  assert.ok(rows.some((row) => row.args.name === 'CL_ABAP_RANDOM' && row.basePreserved));
  process.stdout.write(
    `${JSON.stringify(
      {
        target: 'btp',
        checkedAt: new Date().toISOString(),
        testedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        release,
        authentication: 'named-user browser OAuth; direct HTTPS ADT',
        rows,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ target: 'btp', status: 'failed', errorType: error instanceof Error ? error.name : 'unknown' })}\n`,
  );
  process.exitCode = 1;
}
