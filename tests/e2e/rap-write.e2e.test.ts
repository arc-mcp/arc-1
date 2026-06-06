/**
 * E2E Tests for RAP Object Write Lifecycle (default profile).
 *
 * Creates, reads, activates, and deletes representative RAP-capable objects on
 * a real SAP system. Requires rap.available = true on the test system and
 * skips gracefully if RAP is unavailable.
 *
 * Full DDLS/BDEF/DCLS/SRVD/SRVB stack coverage lives in rap-write.slow.e2e.test.ts.
 * Objects are transient and cleanup is best-effort to avoid masking failures.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolSuccess, expectToolSuccessOrSkip } from './helpers.js';
import { bestEffortDelete, bestEffortDeletePackage, loadRapAvailability, uniqueName } from './rap-write-helpers.js';

describe('E2E RAP write lifecycle tests', () => {
  let client: Client;
  let rapAvailable: true | undefined;

  beforeAll(async () => {
    client = await connectClient();
    rapAvailable = await loadRapAvailability(client);
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // best-effort-cleanup
    }
  });

  it('SAPManage create_package, verify, delete', async (ctx) => {
    // Use $-prefix: $TMP has software component LOCAL which only allows TEST* and $* names.
    const packageName = uniqueName('$ARC1T_');

    const createResult = await callTool(client, 'SAPManage', {
      action: 'create_package',
      name: packageName,
      description: 'ARC-1 E2E test package',
      superPackage: '$TMP',
    });
    expectToolSuccessOrSkip(ctx, createResult);

    try {
      const readResult = await callTool(client, 'SAPRead', {
        type: 'DEVC',
        name: packageName,
      });
      const readText = expectToolSuccess(readResult);
      const parsed = JSON.parse(readText);
      expect(Array.isArray(parsed)).toBe(true);

      const deleteResult = await callTool(client, 'SAPManage', {
        action: 'delete_package',
        name: packageName,
      });
      expectToolSuccessOrSkip(ctx, deleteResult);
    } finally {
      await bestEffortDeletePackage(client, packageName);
    }
  });

  it('SAPWrite create TABL table entity, activate, read, delete', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZART').slice(0, 16);
    const ddlSource = [
      "@EndUserText.label: 'ARC1 RAP test table'",
      '@AbapCatalog.enhancement.category: #NOT_EXTENSIBLE',
      '@AbapCatalog.tableCategory: #TRANSPARENT',
      '@AbapCatalog.deliveryClass: #A',
      '@AbapCatalog.dataMaintenance: #RESTRICTED',
      `define table ${tableName.toLowerCase()} {`,
      '  key client : abap.clnt not null;',
      '  key id     : sysuuid_x16 not null;',
      '  name       : abap.char(40);',
      '}',
    ].join('\n');

    const createResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'TABL',
      name: tableName,
      source: ddlSource,
      package: '$TMP',
    });
    expectToolSuccessOrSkip(ctx, createResult);

    try {
      const activateResult = await callTool(client, 'SAPActivate', {
        type: 'TABL',
        name: tableName,
      });
      expectToolSuccess(activateResult);

      const readResult = await callTool(client, 'SAPRead', {
        type: 'TABL',
        name: tableName,
      });
      const readText = expectToolSuccess(readResult);
      expect(readText.toLowerCase()).toContain('define table');
      expect(readText.toLowerCase()).toContain(tableName.toLowerCase());
    } finally {
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });

  it('SAPWrite create TABL, read, update, activate, delete', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZTAB').slice(0, 16);

    const createSource = [
      "@EndUserText.label : 'ARC1 TABL lifecycle'",
      '@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE',
      '@AbapCatalog.tableCategory : #TRANSPARENT',
      '@AbapCatalog.deliveryClass : #A',
      '@AbapCatalog.dataMaintenance : #RESTRICTED',
      `define table ${tableName.toLowerCase()} {`,
      '  key client : abap.clnt not null;',
      '  key id     : abap.numc(8) not null;',
      '  descr      : abap.char(40);',
      '}',
    ].join('\n');

    const updateSource = [
      "@EndUserText.label : 'ARC1 TABL lifecycle updated'",
      '@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE',
      '@AbapCatalog.tableCategory : #TRANSPARENT',
      '@AbapCatalog.deliveryClass : #A',
      '@AbapCatalog.dataMaintenance : #RESTRICTED',
      `define table ${tableName.toLowerCase()} {`,
      '  key client : abap.clnt not null;',
      '  key id     : abap.numc(8) not null;',
      '  descr      : abap.char(40);',
      '  note       : abap.char(80);',
      '}',
    ].join('\n');

    const createResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'TABL',
      name: tableName,
      package: '$TMP',
      source: createSource,
    });
    expectToolSuccessOrSkip(ctx, createResult);

    try {
      const readCreatedResult = await callTool(client, 'SAPRead', {
        type: 'TABL',
        name: tableName,
      });
      const readCreatedText = expectToolSuccess(readCreatedResult).toLowerCase();
      expect(readCreatedText).toContain('define table');
      expect(readCreatedText).toContain('descr');

      const activateResult = await callTool(client, 'SAPActivate', {
        type: 'TABL',
        name: tableName,
      });
      expectToolSuccess(activateResult);

      const updateResult = await callTool(client, 'SAPWrite', {
        action: 'update',
        type: 'TABL',
        name: tableName,
        source: updateSource,
      });
      expectToolSuccessOrSkip(ctx, updateResult);

      const readUpdatedResult = await callTool(client, 'SAPRead', {
        type: 'TABL',
        name: tableName,
      });
      const readUpdatedText = expectToolSuccess(readUpdatedResult).toLowerCase();
      expect(readUpdatedText).toContain('note');
    } finally {
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });

  it('SAPWrite create MSAG, read, update with messages, delete', async (ctx) => {
    const msagName = uniqueName('ZARC1MC').slice(0, 20);

    try {
      const createResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'MSAG',
        name: msagName,
        package: '$TMP',
        description: 'ARC-1 test message class',
      });
      const createText = expectToolSuccessOrSkip(ctx, createResult);
      expect(createText).toContain(`Created MSAG ${msagName}`);

      const readResult = await callTool(client, 'SAPRead', {
        type: 'MSAG',
        name: msagName,
      });
      const readText = expectToolSuccess(readResult);
      const readData = JSON.parse(readText);
      expect(readData.name).toBe(msagName);
      expect(readData.messages).toEqual([]);

      const updateResult = await callTool(client, 'SAPWrite', {
        action: 'update',
        type: 'MSAG',
        name: msagName,
        messages: [
          { number: '001', shortText: 'Test message &1' },
          { number: '002', shortText: 'Another message' },
        ],
      });
      const updateText = expectToolSuccessOrSkip(ctx, updateResult);
      expect(updateText).toContain(`updated MSAG ${msagName}`);

      const readResult2 = await callTool(client, 'SAPRead', {
        type: 'MSAG',
        name: msagName,
      });
      const readText2 = expectToolSuccess(readResult2);
      const readData2 = JSON.parse(readText2);
      expect(readData2.messages).toHaveLength(2);
      expect(readData2.messages[0].number).toBe('001');
      expect(readData2.messages[0].shortText).toContain('Test message');

      // Deprecated 'MESSAGES' alias must still return the same data during its compatibility window.
      const readAliasResult = await callTool(client, 'SAPRead', {
        type: 'MESSAGES',
        name: msagName,
      });
      const readAliasData = JSON.parse(expectToolSuccess(readAliasResult));
      expect(readAliasData.messages).toHaveLength(2);
      expect(readAliasData.name).toBe(msagName);

      const deleteResult = await callTool(client, 'SAPWrite', {
        action: 'delete',
        type: 'MSAG',
        name: msagName,
      });
      const deleteText = expectToolSuccessOrSkip(ctx, deleteResult);
      expect(deleteText).toContain(`Deleted MSAG ${msagName}`);
    } finally {
      await bestEffortDelete(client, 'MSAG', msagName);
    }
  });
});
