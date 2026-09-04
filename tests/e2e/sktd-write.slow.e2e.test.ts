/**
 * Slow real-system coverage for the multi-node SKTD write path.
 *
 * Run: npm run test:e2e:slow -- tests/e2e/sktd-write.slow.e2e.test.ts
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';
import { bestEffortDelete, loadRapAvailability, uniqueName } from './rap-write-helpers.js';

describe('E2E SKTD multi-node write lifecycle', () => {
  let client: Client;
  let rapAvailable: true | undefined;

  beforeAll(async () => {
    client = await connectClient();
    rapAvailable = await loadRapAvailability(client);
  });

  afterAll(async () => {
    await client?.close().catch(() => {
      // best-effort-cleanup
    });
  });

  it('accumulates exact-ID node writes, accepts an inactive read-back, activates, and cleans up', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZAKT').slice(0, 16);
    const rootName = uniqueName('ZARC1_KTD_R');
    const bpClassName = uniqueName('ZBP_KTD_');
    const baseId = `/sap/bc/adt/bo/behaviordefinitions/${rootName.toLowerCase()}/source/main`;
    const createId = `${baseId}#type=BDEF/BSO;name=${rootName}.create`;
    const updateId = `${baseId}#type=BDEF/BSO;name=${rootName}.update`;

    const write = async (args: Record<string, unknown>) =>
      expectToolSuccessOrSkip(ctx, await callTool(client, 'SAPWrite', args));
    const activate = async (args: Record<string, unknown>) =>
      expectToolSuccess(await callTool(client, 'SAPActivate', args));

    try {
      await write({
        action: 'create',
        type: 'TABL',
        name: tableName,
        package: '$TMP',
        source: [
          "@EndUserText.label : 'ARC1 KTD E2E table'",
          '@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE',
          '@AbapCatalog.tableCategory : #TRANSPARENT',
          '@AbapCatalog.deliveryClass : #A',
          '@AbapCatalog.dataMaintenance : #RESTRICTED',
          `define table ${tableName.toLowerCase()} {`,
          '  key client : abap.clnt not null;',
          '  key id     : sysuuid_x16 not null;',
          '  name       : abap.char(40);',
          '}',
        ].join('\n'),
      });
      await activate({ type: 'TABL', name: tableName });

      await write({
        action: 'create',
        type: 'DDLS',
        name: rootName,
        package: '$TMP',
        source: [
          "@EndUserText.label: 'ARC1 KTD E2E root'",
          '@AccessControl.authorizationCheck: #NOT_REQUIRED',
          `define root view entity ${rootName}`,
          `  as select from ${tableName.toLowerCase()}`,
          '{',
          '  key id as Id,',
          '  name as Name',
          '}',
        ].join('\n'),
      });
      await activate({ type: 'DDLS', name: rootName });

      await write({
        action: 'create',
        type: 'CLAS',
        name: bpClassName,
        package: '$TMP',
        source: [
          `CLASS ${bpClassName.toLowerCase()} DEFINITION PUBLIC ABSTRACT FINAL`,
          `  FOR BEHAVIOR OF ${rootName.toLowerCase()}.`,
          'ENDCLASS.',
          '',
          `CLASS ${bpClassName.toLowerCase()} IMPLEMENTATION.`,
          'ENDCLASS.',
        ].join('\n'),
      });
      await write({
        action: 'create',
        type: 'BDEF',
        name: rootName,
        package: '$TMP',
        source: [
          `managed implementation in class ${bpClassName.toLowerCase()} unique;`,
          'strict;',
          `define behavior for ${rootName} alias KtdRoot`,
          `persistent table ${tableName.toLowerCase()}`,
          'lock master',
          'authorization master ( instance )',
          '{',
          '  field ( readonly ) Id;',
          '  create;',
          '  update;',
          '  delete;',
          '}',
        ].join('\n'),
      });
      await activate({
        objects: [
          { type: 'CLAS', name: bpClassName },
          { type: 'BDEF', name: rootName },
        ],
      });

      await write({
        action: 'create',
        type: 'SKTD',
        name: rootName,
        package: '$TMP',
        refObjectType: 'BDEF/BDO',
        refObjectName: rootName,
        refObjectDescription: 'ARC1 KTD E2E behavior',
        source: 'Root documentation.',
      });
      await activate({ type: 'SKTD', name: rootName });

      // Even with only the root documented, SAP has several writable empty BDEF nodes.
      // SAPRead must therefore emit the root routing heading so adding a node above the
      // metadata marker has no stray preamble and round-trips exactly as instructed.
      const rootOnlyRead = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'active' }),
      );
      const metaMarker = '<!-- arc1:ktd-meta — read-only context below; SAPWrite ignores it -->';
      expect(rootOnlyRead).toContain(`## ${rootName}`);
      expect(rootOnlyRead).toContain(metaMarker);
      expect(rootOnlyRead).toContain(`${rootName}.create`);
      const rootAndCreate = rootOnlyRead.replace(
        metaMarker,
        `## ${createId}\n\nCreate documentation.\n\n${metaMarker}`,
      );
      expect(rootAndCreate).not.toBe(rootOnlyRead);
      await write({ action: 'update', type: 'SKTD', name: rootName, source: rootAndCreate });
      // A stored H2 equal to its own node id is indistinguishable from routing unless
      // the read/write representation escapes it. Write the escaped form, then prove
      // the exact live SAPRead result can be written back below.
      const rootWithCollidingHeading = rootAndCreate.replace(
        'Root documentation.',
        `\\## ${rootName}\n\nRoot documentation.`,
      );
      await write({ action: 'update', type: 'SKTD', name: rootName, source: rootWithCollidingHeading });
      await write({
        action: 'update',
        type: 'SKTD',
        name: rootName,
        source: `## ${updateId}\n\nUpdate documentation.`,
      });

      const inactiveRead = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'inactive' }),
      );
      expect(inactiveRead).toContain('Root documentation.');
      expect(inactiveRead).toContain(`\\## ${rootName}`);
      expect(inactiveRead).toContain(`## ${createId}`);
      expect(inactiveRead).toContain('Create documentation.');
      expect(inactiveRead).toContain(`## ${updateId}`);
      expect(inactiveRead).toContain('Update documentation.');
      expect(inactiveRead).toContain('<!-- arc1:ktd-meta');

      // The exact SAPRead result includes the read-only empty-node index. The writer must strip
      // that context instead of folding it into the last node's Markdown body.
      await write({ action: 'update', type: 'SKTD', name: rootName, source: inactiveRead });
      await activate({ type: 'SKTD', name: rootName });

      const activeRead = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'active' }),
      );
      expect(activeRead).toContain('Root documentation.');
      expect(activeRead).toContain('Create documentation.');
      expect(activeRead).toContain('Update documentation.');
    } finally {
      await bestEffortDelete(client, 'SKTD', rootName);
      await bestEffortDelete(client, 'BDEF', rootName);
      await bestEffortDelete(client, 'CLAS', bpClassName);
      await bestEffortDelete(client, 'DDLS', rootName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  }, 240_000);
});
