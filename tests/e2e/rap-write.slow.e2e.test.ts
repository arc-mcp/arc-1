/**
 * Slow E2E Tests for full RAP Object Write Lifecycle.
 *
 * These tests create dependency stacks on a real SAP system. Keep them out of
 * the default PR E2E profile, but run them manually or on a scheduled profile
 * when validating full RAP object coverage.
 *
 * Run: npm run test:e2e:slow
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip } from '../helpers/skip-policy.js';
import {
  callTool,
  connectClient,
  expectToolSuccess,
  expectToolSuccessOrSkip,
  skipOnBatchCreateFailure,
} from './helpers.js';
import { bestEffortDelete, loadRapAvailability, uniqueName } from './rap-write-helpers.js';

describe('E2E RAP write slow lifecycle tests', () => {
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

  it('SAPWrite create DDLS CDS view entity + BDEF, activate, read, delete', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZARV').slice(0, 16);
    const viewName = uniqueName('ZARC1_RI_');
    const bdefName = viewName;
    const bpClassName = uniqueName('ZBP_ARC1_R');

    const tableSource = [
      "@EndUserText.label: 'ARC1 RAP view test table'",
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

    const createTableResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'TABL',
      name: tableName,
      source: tableSource,
      package: '$TMP',
    });
    expectToolSuccessOrSkip(ctx, createTableResult);

    const activateTableResult = await callTool(client, 'SAPActivate', {
      type: 'TABL',
      name: tableName,
    });
    expectToolSuccess(activateTableResult);

    try {
      const viewSource = [
        "@EndUserText.label: 'ARC1 RAP test view'",
        '@AccessControl.authorizationCheck: #NOT_ALLOWED',
        `define root view entity ${viewName}`,
        `  as select from ${tableName.toLowerCase()}`,
        '{',
        '  key id   as Id,',
        '  name     as Name',
        '}',
      ].join('\n');

      const createViewResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: viewName,
        source: viewSource,
        package: '$TMP',
      });
      expectToolSuccess(createViewResult);

      const activateViewResult = await callTool(client, 'SAPActivate', {
        type: 'DDLS',
        name: viewName,
      });
      expectToolSuccess(activateViewResult);

      const bpClassSource = [
        `CLASS ${bpClassName.toLowerCase()} DEFINITION`,
        '  PUBLIC ABSTRACT FINAL',
        `  FOR BEHAVIOR OF ${viewName.toLowerCase()}.`,
        'ENDCLASS.',
        '',
        `CLASS ${bpClassName.toLowerCase()} IMPLEMENTATION.`,
        'ENDCLASS.',
      ].join('\n');

      const createBpResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: bpClassName,
        source: bpClassSource,
        package: '$TMP',
      });
      expectToolSuccess(createBpResult);

      const bdefSource = [
        `managed implementation in class ${bpClassName.toLowerCase()} unique;`,
        'strict;',
        '',
        `define behavior for ${viewName} alias ${viewName.slice(-10)}`,
        `persistent table ${tableName.toLowerCase()}`,
        'lock master',
        'authorization master ( instance )',
        '{',
        '  field ( readonly ) Id;',
        '  create;',
        '  update;',
        '  delete;',
        '}',
      ].join('\n');

      const createBdefResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: bdefName,
        source: bdefSource,
        package: '$TMP',
      });
      expectToolSuccess(createBdefResult);

      const activateBdefResult = await callTool(client, 'SAPActivate', {
        objects: [
          { type: 'CLAS', name: bpClassName },
          { type: 'BDEF', name: bdefName },
        ],
      });
      expectToolSuccess(activateBdefResult);

      const readViewResult = await callTool(client, 'SAPRead', {
        type: 'DDLS',
        name: viewName,
      });
      const viewText = expectToolSuccess(readViewResult);
      expect(viewText.toLowerCase()).toContain('define root view entity');
      expect(viewText.toLowerCase()).toContain(viewName.toLowerCase());

      const readBdefResult = await callTool(client, 'SAPRead', {
        type: 'BDEF',
        name: bdefName,
      });
      const bdefText = expectToolSuccess(readBdefResult);
      expect(bdefText.toLowerCase()).toContain('managed');
      expect(bdefText.toLowerCase()).toContain(viewName.toLowerCase());
    } finally {
      await bestEffortDelete(client, 'BDEF', bdefName);
      await bestEffortDelete(client, 'CLAS', bpClassName);
      await bestEffortDelete(client, 'DDLS', viewName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });

  it('DCLS lifecycle: create, activate, read, delete', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZARD').slice(0, 16);
    const viewName = uniqueName('ZARC1_DV_');
    const dclName = uniqueName('ZARC1_DCL_');

    const tableSource = [
      "@EndUserText.label: 'ARC1 DCL test table'",
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

    const viewSource = [
      "@EndUserText.label: 'ARC1 DCL test view'",
      '@AccessControl.authorizationCheck: #CHECK',
      `define root view entity ${viewName}`,
      `  as select from ${tableName.toLowerCase()}`,
      '{',
      '  key id   as Id,',
      '  name     as Name',
      '}',
    ].join('\n');

    const dclSource = [
      "@EndUserText.label: 'E2E Test Access Control'",
      '@MappingRole: true',
      `define role ${dclName} {`,
      `  grant select on ${viewName};`,
      '}',
    ].join('\n');

    try {
      expectToolSuccessOrSkip(
        ctx,
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'TABL',
          name: tableName,
          source: tableSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'TABL', name: tableName }));

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'DDLS',
          name: viewName,
          source: viewSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'DDLS', name: viewName }));

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'DCLS',
          name: dclName,
          source: dclSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'DCLS', name: dclName }));

      const readDclResult = await callTool(client, 'SAPRead', {
        type: 'DCLS',
        name: dclName,
      });
      const dclText = expectToolSuccess(readDclResult);
      expect(dclText.toLowerCase()).toContain('define role');
      expect(dclText.toLowerCase()).toContain(viewName.toLowerCase());
    } finally {
      await bestEffortDelete(client, 'DCLS', dclName);
      await bestEffortDelete(client, 'DDLS', viewName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });

  it('SAPWrite create SRVD service definition, activate, read, delete', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZARS').slice(0, 16);
    const viewName = uniqueName('ZARC1_RX_');
    const srvdName = uniqueName('ZARC1_SD_');

    const tableSource = [
      "@EndUserText.label: 'ARC1 SRVD test table'",
      '@AbapCatalog.enhancement.category: #NOT_EXTENSIBLE',
      '@AbapCatalog.tableCategory: #TRANSPARENT',
      '@AbapCatalog.deliveryClass: #A',
      '@AbapCatalog.dataMaintenance: #RESTRICTED',
      `define table ${tableName.toLowerCase()} {`,
      '  key client : abap.clnt not null;',
      '  key id     : sysuuid_x16 not null;',
      '  descr      : abap.char(40);',
      '}',
    ].join('\n');

    const createTableResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'TABL',
      name: tableName,
      source: tableSource,
      package: '$TMP',
    });
    expectToolSuccessOrSkip(ctx, createTableResult);

    const activateTableResult = await callTool(client, 'SAPActivate', {
      type: 'TABL',
      name: tableName,
    });
    expectToolSuccess(activateTableResult);

    try {
      const viewSource = [
        "@EndUserText.label: 'ARC1 SRVD test view'",
        '@AccessControl.authorizationCheck: #NOT_ALLOWED',
        `define root view entity ${viewName}`,
        `  as select from ${tableName.toLowerCase()}`,
        '{',
        '  key id    as Id,',
        '  descr     as Description',
        '}',
      ].join('\n');

      const createViewResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: viewName,
        source: viewSource,
        package: '$TMP',
      });
      expectToolSuccess(createViewResult);

      const activateViewResult = await callTool(client, 'SAPActivate', {
        type: 'DDLS',
        name: viewName,
      });
      expectToolSuccess(activateViewResult);

      const srvdSource = [
        "@EndUserText.label: 'ARC1 test service definition'",
        `define service ${srvdName} {`,
        `  expose ${viewName} as TestEntity;`,
        '}',
      ].join('\n');

      const createSrvdResult = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'SRVD',
        name: srvdName,
        source: srvdSource,
        package: '$TMP',
      });
      expectToolSuccess(createSrvdResult);

      const activateSrvdResult = await callTool(client, 'SAPActivate', {
        type: 'SRVD',
        name: srvdName,
      });
      expectToolSuccess(activateSrvdResult);

      const readSrvdResult = await callTool(client, 'SAPRead', {
        type: 'SRVD',
        name: srvdName,
      });
      const srvdText = expectToolSuccess(readSrvdResult);
      expect(srvdText.toLowerCase()).toContain('define service');
      expect(srvdText.toLowerCase()).toContain(viewName.toLowerCase());
    } finally {
      await bestEffortDelete(client, 'SRVD', srvdName);
      await bestEffortDelete(client, 'DDLS', viewName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });

  it('SAPWrite create SRVB, activate, publish, unpublish, delete', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZART').slice(0, 16);
    const viewName = uniqueName('ZARC1_SV_');
    const bdefName = viewName;
    const bpClassName = uniqueName('ZBP_ARC1_S');
    const srvdName = uniqueName('ZARC1_SD_');
    const srvbName = uniqueName('ZARC1_SB_');

    const tableSource = [
      "@EndUserText.label: 'ARC1 SRVB stack table'",
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

    const viewSource = [
      "@EndUserText.label: 'ARC1 SRVB stack view'",
      '@AccessControl.authorizationCheck: #NOT_ALLOWED',
      `define root view entity ${viewName}`,
      `  as select from ${tableName.toLowerCase()}`,
      '{',
      '  key id   as Id,',
      '  name     as Name',
      '}',
    ].join('\n');

    const bpClassSource = [
      `CLASS ${bpClassName.toLowerCase()} DEFINITION`,
      '  PUBLIC ABSTRACT FINAL',
      `  FOR BEHAVIOR OF ${viewName.toLowerCase()}.`,
      'ENDCLASS.',
      '',
      `CLASS ${bpClassName.toLowerCase()} IMPLEMENTATION.`,
      'ENDCLASS.',
    ].join('\n');

    const bdefSource = [
      `managed implementation in class ${bpClassName.toLowerCase()} unique;`,
      'strict;',
      '',
      `define behavior for ${viewName} alias ${viewName.slice(-10)}`,
      `persistent table ${tableName.toLowerCase()}`,
      'lock master',
      'authorization master ( instance )',
      '{',
      '  field ( readonly ) Id;',
      '  create;',
      '  update;',
      '  delete;',
      '}',
    ].join('\n');

    const srvdSource = [
      "@EndUserText.label: 'ARC1 SRVB stack service definition'",
      `define service ${srvdName} {`,
      `  expose ${viewName} as TestEntity;`,
      '}',
    ].join('\n');

    try {
      expectToolSuccessOrSkip(
        ctx,
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'TABL',
          name: tableName,
          source: tableSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'TABL', name: tableName }));

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'DDLS',
          name: viewName,
          source: viewSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'DDLS', name: viewName }));

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'CLAS',
          name: bpClassName,
          source: bpClassSource,
          package: '$TMP',
        }),
      );

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'BDEF',
          name: bdefName,
          source: bdefSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(
        await callTool(client, 'SAPActivate', {
          objects: [
            { type: 'CLAS', name: bpClassName },
            { type: 'BDEF', name: bdefName },
          ],
        }),
      );

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'SRVD',
          name: srvdName,
          source: srvdSource,
          package: '$TMP',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'SRVD', name: srvdName }));

      expectToolSuccess(
        await callTool(client, 'SAPWrite', {
          action: 'create',
          type: 'SRVB',
          name: srvbName,
          package: '$TMP',
          serviceDefinition: srvdName,
          odataVersion: 'V4',
          category: '0',
        }),
      );
      expectToolSuccess(await callTool(client, 'SAPActivate', { type: 'SRVB', name: srvbName }));

      const readSrvbResult = await callTool(client, 'SAPRead', {
        type: 'SRVB',
        name: srvbName,
      });
      const srvbText = expectToolSuccess(readSrvbResult);
      const parsed = JSON.parse(srvbText);
      expect(parsed.name).toBe(srvbName);
      expect(parsed.serviceDefinition).toBe(srvdName);

      expectToolSuccess(await callTool(client, 'SAPActivate', { action: 'publish_srvb', name: srvbName }));
      expectToolSuccess(await callTool(client, 'SAPActivate', { action: 'unpublish_srvb', name: srvbName }));
    } finally {
      await bestEffortDelete(client, 'SRVB', srvbName);
      await bestEffortDelete(client, 'SRVD', srvdName);
      await bestEffortDelete(client, 'BDEF', bdefName);
      await bestEffortDelete(client, 'CLAS', bpClassName);
      await bestEffortDelete(client, 'DDLS', viewName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });

  it('SAPWrite batch_create for table entity + CDS view + DCL', async (ctx) => {
    requireOrSkip(ctx, rapAvailable, 'RAP/CDS not available on test system');

    const tableName = uniqueName('ZARB').slice(0, 16);
    const viewName = uniqueName('ZARC1_RC_');
    const dclName = uniqueName('ZARC1_BD_');

    const tableSource = [
      "@EndUserText.label: 'ARC1 batch test table'",
      '@AbapCatalog.enhancement.category: #NOT_EXTENSIBLE',
      '@AbapCatalog.tableCategory: #TRANSPARENT',
      '@AbapCatalog.deliveryClass: #A',
      '@AbapCatalog.dataMaintenance: #RESTRICTED',
      `define table ${tableName.toLowerCase()} {`,
      '  key client : abap.clnt not null;',
      '  key id     : sysuuid_x16 not null;',
      '  value      : abap.char(40);',
      '}',
    ].join('\n');

    const viewSource = [
      "@EndUserText.label: 'ARC1 batch test view'",
      '@AccessControl.authorizationCheck: #CHECK',
      `define root view entity ${viewName}`,
      `  as select from ${tableName.toLowerCase()}`,
      '{',
      '  key id   as Id,',
      '  value    as Value',
      '}',
    ].join('\n');

    const dclSource = [
      "@EndUserText.label: 'ARC1 batch test access control'",
      '@MappingRole: true',
      `define role ${dclName} {`,
      `  grant select on ${viewName};`,
      '}',
    ].join('\n');

    const batchResult = await callTool(client, 'SAPWrite', {
      action: 'batch_create',
      package: '$TMP',
      objects: [
        {
          type: 'TABL',
          name: tableName,
          source: tableSource,
        },
        {
          type: 'DDLS',
          name: viewName,
          source: viewSource,
        },
        {
          type: 'DCLS',
          name: dclName,
          source: dclSource,
        },
      ],
    });
    const batchText = expectToolSuccessOrSkip(ctx, batchResult);
    if (skipOnBatchCreateFailure(ctx, batchText)) return;

    try {
      const readTableResult = await callTool(client, 'SAPRead', {
        type: 'TABL',
        name: tableName,
      });
      const tableText = expectToolSuccess(readTableResult);
      expect(tableText.toLowerCase()).toContain('define table');
      expect(tableText.toLowerCase()).toContain(tableName.toLowerCase());

      const readViewResult = await callTool(client, 'SAPRead', {
        type: 'DDLS',
        name: viewName,
      });
      const viewText = expectToolSuccess(readViewResult);
      expect(viewText.toLowerCase()).toContain('define root view entity');
      expect(viewText.toLowerCase()).toContain(viewName.toLowerCase());

      const readDclResult = await callTool(client, 'SAPRead', {
        type: 'DCLS',
        name: dclName,
      });
      const dclText = expectToolSuccess(readDclResult);
      expect(dclText.toLowerCase()).toContain('define role');
      expect(dclText.toLowerCase()).toContain(viewName.toLowerCase());
    } finally {
      await bestEffortDelete(client, 'DCLS', dclName);
      await bestEffortDelete(client, 'DDLS', viewName);
      await bestEffortDelete(client, 'TABL', tableName);
    }
  });
});
