/**
 * Slow real-system coverage for the multi-node SKTD write path.
 *
 * Run: npm run test:e2e:slow -- tests/e2e/sktd-write.slow.e2e.test.ts
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';
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

  it('previews and accumulates name/ID node writes, round-trips inactive reads, activates, and cleans up', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZAKT').slice(0, 16);
    const rootName = uniqueName('ZARC1_KTD_R');
    const bpClassName = uniqueName('ZBP_KTD_');
    const baseId = `/sap/bc/adt/bo/behaviordefinitions/${rootName.toLowerCase()}/source/main`;
    const createId = `${baseId}#type=BDEF/BSO;name=${rootName}.create`;
    const updateId = `${baseId}#type=BDEF/BSO;name=${rootName}.update`;
    const metaMarker = '<!-- arc1:ktd-meta — read-only context below; SAPWrite ignores it -->';

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

      // A DDLS/DF KTD has only its root node. Store body lines equal to both reserved
      // routing tokens, then prove the marker-free route-safe SAPRead result survives
      // both the exact paste-back and recovery without its outer route heading.
      await write({
        action: 'create',
        type: 'SKTD',
        name: rootName,
        package: '$TMP',
        refObjectType: 'DDLS/DF',
        refObjectName: rootName,
        refObjectDescription: 'ARC1 single-node KTD E2E view',
        source: `\\## ${rootName}\n\nSingle-node view documentation.\n\n\\${metaMarker}\n\nAfter the marker.`,
      });
      await activate({ type: 'SKTD', name: rootName });

      const singleNodeRead = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'active' }),
      );
      // Every read carries the node index behind the marker; the writable half must be exact.
      const [singleNodeWritable, singleNodeContext] = singleNodeRead.split(`\n\n${metaMarker}\n`);
      expect(singleNodeWritable).toBe(
        `## ${rootName}\n\n\\## ${rootName}\n\nSingle-node view documentation.\n\n\\${metaMarker}\n\nAfter the marker.`,
      );
      expect(singleNodeWritable.split(/\r?\n/)).not.toContain(metaMarker);
      expect(singleNodeContext).toContain('Nodes: 1');
      await write({ action: 'update', type: 'SKTD', name: rootName, source: singleNodeRead });
      await write({
        action: 'update',
        type: 'SKTD',
        name: rootName,
        source: singleNodeRead.slice(`## ${rootName}\n\n`.length),
      });
      const singleNodeReadAfterRecovery = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'inactive' }),
      );
      expect(singleNodeReadAfterRecovery).toBe(singleNodeRead);
      await write({ action: 'delete', type: 'SKTD', name: rootName });

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
      expect(rootOnlyRead).toContain(`## ${rootName}`);
      expect(rootOnlyRead).toContain(metaMarker);
      expect(rootOnlyRead).toContain(`${rootName}.create`);
      const rootAndCreate = rootOnlyRead.replace(
        metaMarker,
        `## ${rootName}.create\n\nCreate documentation.\n\n${metaMarker}`,
      );
      expect(rootAndCreate).not.toBe(rootOnlyRead);
      const preview = await write({
        action: 'update',
        type: 'SKTD',
        name: rootName,
        source: rootAndCreate,
        dryRun: true,
      });
      expect(preview).toContain('Would change 1 node(s)');
      expect(preview).toContain(`${rootName}.create`);
      expectToolError(
        await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'SKTD',
          name: rootName,
          source: rootAndCreate.replace(`${rootName}.create`, `${rootName}.create.extra`),
        }),
        'does not exist',
      );
      expectToolError(
        await callTool(client, 'SAPWrite', {
          action: 'update',
          type: 'SKTD',
          name: rootName,
          source: `## ${createId.toUpperCase()}X\n\nMust not be written.`,
        }),
        'does not exist',
      );
      const afterPreview = expectToolSuccess(
        await callTool(client, 'SAPRead', {
          type: 'SKTD',
          name: rootName,
          version: 'inactive',
        }),
      );
      expect(afterPreview.split(`\n\n${metaMarker}`)[0]).toBe(rootOnlyRead.split(`\n\n${metaMarker}`)[0]);
      const applied = await write({ action: 'update', type: 'SKTD', name: rootName, source: rootAndCreate });
      expect(applied).toContain('Changed 1 node(s)');
      expect(applied).toContain(`\n  ${rootName}.create`);
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
        source: `## ${rootName.toLowerCase()}.UPDATE\n\nUpdate documentation.`,
        // Deliberately later-node first: XML splices must follow envelope offsets,
        // not the caller's array order, when Base64 lengths change.
        shortTexts: [
          { node: `${rootName}.update`, text: 'Update a KTD root' },
          { node: `${rootName.toLowerCase()}.CREATE`, text: 'Create a KTD root' },
        ],
      });

      const inactiveRead = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'inactive' }),
      );
      expect(inactiveRead).toContain('Root documentation.');
      expect(inactiveRead).toContain(`\\## ${rootName}`);
      expect(inactiveRead).toContain(`## ${createId}`);
      expect(inactiveRead).toContain('Create documentation.');
      expect(inactiveRead).toContain(`${rootName}.create [optional]: Create a KTD root`);
      expect(inactiveRead).toContain(`## ${updateId}`);
      expect(inactiveRead).toContain('Update documentation.');
      expect(inactiveRead).toContain(`${rootName}.update [optional]: Update a KTD root`);
      expect(inactiveRead).toContain('<!-- arc1:ktd-meta');

      // The exact SAPRead result includes the read-only empty-node index. The writer must strip
      // that context instead of folding it into the last node's Markdown body.
      const roundTrip = await write({ action: 'update', type: 'SKTD', name: rootName, source: inactiveRead });
      expect(roundTrip).toContain('Changed 0 node(s)');
      await activate({ type: 'SKTD', name: rootName });

      const activeRead = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'active' }),
      );
      expect(activeRead).toContain('Root documentation.');
      expect(activeRead).toContain('Create documentation.');
      expect(activeRead).toContain('Update documentation.');
      expect(activeRead).toContain(`${rootName}.create [optional]: Create a KTD root`);
      expect(activeRead).toContain(`${rootName}.update [optional]: Update a KTD root`);

      await write({
        action: 'update',
        type: 'SKTD',
        name: rootName,
        shortTexts: [{ node: createId, text: '' }],
      });
      await activate({ type: 'SKTD', name: rootName });
      const afterClear = expectToolSuccess(
        await callTool(client, 'SAPRead', { type: 'SKTD', name: rootName, version: 'active' }),
      );
      expect(afterClear).not.toContain('Create a KTD root');
      expect(afterClear).toContain('Update a KTD root');
      expect(afterClear).toContain('Create documentation.');
    } finally {
      await bestEffortDelete(client, 'SKTD', rootName);
      await bestEffortDelete(client, 'BDEF', rootName);
      await bestEffortDelete(client, 'CLAS', bpClassName);
      await bestEffortDelete(client, 'DDLS', rootName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  }, 240_000);
});
