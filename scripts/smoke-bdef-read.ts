/** Read-only public-flow smoke. Print hashes and coverage, never source/authentication bodies. */
import { createHash } from 'node:crypto';
import { AdtClient } from '../src/adt/client.js';
import { DataResponseBudget } from '../src/adt/data-result-context.js';
import { checkOperation, OperationType } from '../src/adt/safety.js';
import { parseDiscoveryDocument } from '../src/adt/xml-parser.js';
import { handleToolCall } from '../src/handlers/dispatch.js';
import { setCachedDiscovery, setCachedFeatures } from '../src/handlers/feature-cache.js';
import { requestContext } from '../src/server/context.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function main() {
  const client = new AdtClient({
    baseUrl: 'https://a4h.marianzeis.de',
    username: process.env.SAP_USER,
    password: process.env.SAP_PASSWORD,
    client: '001',
    language: 'EN',
    insecure: false,
  });
  checkOperation(client.safety, OperationType.Read, 'SmokeBdefDiscovery');
  const discovery = parseDiscoveryDocument(
    (
      await client.http.get(
        '/sap/bc/adt/discovery',
        { Accept: 'application/atomsvc+xml' },
        {
          deadline: Date.now() + 15000,
          responseBudget: new DataResponseBudget(1024 * 1024),
          retryTransientErrors: false,
        },
      )
    ).body,
  );
  setCachedFeatures({ abapRelease: '758', discoveryMap: discovery });
  setCachedDiscovery(discovery);
  let original: string | undefined;
  const rows = [];
  for (const mode of ['none', 'summary', 'sources'] as const) {
    const result = await requestContext.run(
      { requestId: `bdef-smoke-${mode}`, signal: AbortSignal.timeout(20000) },
      () =>
        handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
          type: 'BDEF',
          name: 'DEMO_RAP_EXTENSIBLE',
          version: 'active',
          extensions: mode,
        }),
    );
    const first = result.content[0]?.text ?? '';
    if (mode === 'none') original = first;
    const block = result.content.find((entry) => entry.text.startsWith('[extensions] '));
    const summary = block ? JSON.parse(block.text.slice('[extensions] '.length)) : undefined;
    rows.push({
      mode,
      isError: result.isError === true,
      basePreserved: first === original,
      baseSha256: hash(first),
      contentBlocks: result.content.length,
      summary,
      additionalOutputBytes: result.content.slice(1).reduce((n, b) => n + Buffer.byteLength(b.text), 0),
      extensionSources: result.content
        .filter((entry) => entry.text.startsWith('[extension source '))
        .map((entry) => ({
          label: entry.text.split('\n', 1)[0],
          bytes: Buffer.byteLength(entry.text),
          sha256: hash(entry.text),
        })),
    });
    process.stderr.write(`BDEF public ${mode}: ${result.isError ? 'tool error' : 'completed'}\n`);
  }
  process.stdout.write(`${JSON.stringify({ target: 'a4h', checkedAt: new Date().toISOString(), rows }, null, 2)}\n`);
}
try {
  await main();
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ target: 'a4h', status: 'failed', errorType: error instanceof Error ? error.name : 'unknown' })}\n`,
  );
  process.exitCode = 1;
}
