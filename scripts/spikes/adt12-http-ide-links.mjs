import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Optional protocol smoke: npm run build && node scripts/spikes/adt12-http-ide-links.mjs
// Uses the production preference parser/decorator; synthetic tool, no SAP calls or credentials.
const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const express = require('express');
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StreamableHTTPClientTransport } = await import(
  pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'))
);
const { McpServer } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')));
const { createMcpHandler } = await import(new URL('dist/server/http.js', root));
const { appendIdeLinks } = await import(new URL('dist/server/ide-links.js', root));
const { resolveHttpIdeContext } = await import(new URL('dist/server/ide-request.js', root));
const { DEFAULT_CONFIG } = await import(new URL('dist/server/types.js', root));
const target = 'A4H/001';
const payload = JSON.stringify({ objectType: 'CLAS', objectName: 'CL_ABAP_TYPEDESCR', target });
let calls = 0;
const app = express();
app.use(express.json());
app.post(
  '/A4H/001/mcp',
  createMcpHandler(() => {
    const server = new McpServer({ name: 'request-header-research', version: '1.0.0' });
    server.registerTool(
      'research',
      { description: 'Synthetic object identity; no SAP request', inputSchema: {} },
      async (_args, extra) => {
        calls++;
        const config = {
          ...DEFAULT_CONFIG,
          transport: 'http-streamable',
          ideLinks: 'eclipse',
          ideSystemId: 'A4H',
          targetId: target,
          multiTargetEndpoints: true,
        };
        return appendIdeLinks(
          { content: [{ type: 'text', text: payload }] },
          'SAPRead',
          { type: 'CLAS', name: 'CL_ABAP_TYPEDESCR' },
          config,
          resolveHttpIdeContext(config, extra.requestInfo?.headers),
        );
      },
    );
    return server;
  }),
);
const listener = await new Promise((resolve) => {
  const l = app.listen(0, '127.0.0.1', () => resolve(l));
});
const url = new URL(`http://127.0.0.1:${listener.address().port}/A4H/001/mcp`);
const cases = [
  ['Eclipse', { 'Arc1-Ide-Client': 'eclipse' }, true],
  ['no preference', {}, false],
  ['removed VS Code mapping', { 'Arc1-Ide-Client': 'vscode', 'Arc1-Ide-Destinations-V1': 'A4H/001=DEV' }, false],
  ['ordinary client', { 'Arc1-Ide-Client': 'claude' }, false],
];
try {
  await Promise.all(
    cases.map(async ([label, headers, expected]) => {
      const client = new Client({ name: label, version: '1.0' });
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
        }),
      );
      try {
        // Repeated calls prove metadata is available after initialize in stateless mode.
        const results = await Promise.all([
          client.callTool({ name: 'research', arguments: {} }),
          client.callTool({ name: 'research', arguments: {} }),
        ]);
        for (const result of results) {
          assert.equal(result.content[0].text, payload);
          assert.equal(result.content.length, expected ? 2 : 1);
          if (expected) {
            assert.ok(result.content[1].text.includes('adt://A4H/sap/bc/adt/oo/classes/cl_abap_typedescr'));
          }
        }
        console.log(`PASS ${label}`);
      } finally {
        await client.close();
      }
    }),
  );
  assert.equal(calls, cases.length * 2);
  const original = { content: [{ type: 'text', text: 'CLASS cl_abap_typedescr DEFINITION.' }] };
  assert.equal(
    appendIdeLinks(
      original,
      'SAPRead',
      { type: 'CLAS', name: 'CL_ABAP_TYPEDESCR' },
      { ...DEFAULT_CONFIG, transport: 'http-streamable', ideLinks: 'eclipse', ideSystemId: 'A4H' },
    ),
    original,
  );
  console.log('PASS no request preference means no HTTP decoration');
  console.log(
    JSON.stringify({
      calls,
      concurrentClients: cases.length,
      sapRequests: 0,
      sourceBlocksUnchanged: true,
      btpDeployed: false,
    }),
  );
} finally {
  await new Promise((resolve) => listener.close(resolve));
}
