/**
 * Live round-trip for function-module processing metadata.
 *
 * A successful create response is not sufficient evidence: an older backend
 * could ignore an unfamiliar attribute and silently create a normal function
 * module. This test creates disposable modules, reads their root metadata back,
 * activates them, and removes every fixture.
 *
 * Run against each supported profile:
 *   npm run test:integration -- fugr-func-processing.integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import type { FunctionUpdateTaskKind } from '../../src/handlers/function-processing.js';
import type { ToolResult } from '../../src/handlers/shared.js';
import type { ServerConfig } from '../../src/server/types.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

function requireToolSuccess(result: ToolResult, step: string): void {
  if (result.isError) {
    throw new Error(`${step} failed; inspect the correlated ARC-1 server log for backend diagnostics.`);
  }
}

function xmlAttribute(xml: string, name: string): string | undefined {
  return new RegExp(`\\bfmodule:${name}="([^"]+)"`).exec(xml)?.[1];
}

describe('FUNC processing metadata lifecycle', () => {
  let client: AdtClient;
  let config: ServerConfig;
  const registry = new CrudRegistry();

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
    config = {
      systemType: 'onprem',
      toolMode: 'standard',
      lintBeforeWrite: false,
      checkBeforeWrite: false,
    } as ServerConfig;
  });

  afterAll(async () => {
    if (!client) return;
    const report = await cleanupAll(client.http, client.safety, registry);
    if (report.failed.length > 0) {
      throw new Error(`FUNC processing fixture cleanup failed for ${report.failed.length} object(s).`);
    }
  }, 60_000);

  it('persists every supported processing kind through create, readback, and activation', async () => {
    const group = generateUniqueName('ZARC1FPG');
    const groupUrl = `/sap/bc/adt/functions/groups/${encodeURIComponent(group.toLowerCase())}`;
    const groupCreate = await handleToolCall(client, config, 'SAPWrite', {
      action: 'create',
      type: 'FUGR',
      name: group,
      package: '$TMP',
      description: 'ARC-1 FUNC processing integration test',
    });
    requireToolSuccess(groupCreate, 'FUGR create');
    registry.register(groupUrl, 'FUGR', group);

    const cases: Array<{
      name: string;
      processingType?: 'normal' | 'rfc' | 'update';
      updateTaskKind?: FunctionUpdateTaskKind;
      expectedProcessingType: 'normal' | 'rfc' | 'update';
    }> = [
      {
        name: generateUniqueName('ZARC1FPN'),
        expectedProcessingType: 'normal',
      },
      {
        name: generateUniqueName('ZARC1FPN'),
        processingType: 'normal',
        expectedProcessingType: 'normal',
      },
      {
        name: generateUniqueName('ZARC1FPR'),
        processingType: 'rfc',
        expectedProcessingType: 'rfc',
      },
      {
        name: generateUniqueName('ZARC1FPU'),
        processingType: 'update',
        updateTaskKind: 'startImmediate',
        expectedProcessingType: 'update',
      },
      {
        name: generateUniqueName('ZARC1FPU'),
        processingType: 'update',
        updateTaskKind: 'immediateStartNoRestart',
        expectedProcessingType: 'update',
      },
      {
        name: generateUniqueName('ZARC1FPU'),
        processingType: 'update',
        updateTaskKind: 'startDelayed',
        expectedProcessingType: 'update',
      },
    ];

    for (const testCase of cases) {
      const moduleUrl = `${groupUrl}/fmodules/${encodeURIComponent(testCase.name.toLowerCase())}`;
      const create = await handleToolCall(client, config, 'SAPWrite', {
        action: 'create',
        type: 'FUNC',
        name: testCase.name,
        group,
        description: 'ARC-1 FUNC processing test module',
        source: `FUNCTION ${testCase.name.toLowerCase()}.\nENDFUNCTION.\n`,
        ...(testCase.processingType === undefined ? {} : { processingType: testCase.processingType }),
        ...(testCase.updateTaskKind === undefined ? {} : { updateTaskKind: testCase.updateTaskKind }),
      });
      if (create.isError) {
        // The processing update deliberately fails closed after the create POST.
        // If SAP retained a normal shell, register it before throwing so afterAll
        // still removes the partial fixture.
        try {
          await client.http.get(moduleUrl);
          registry.register(moduleUrl, 'FUNC', testCase.name);
        } catch {
          // No child exists, so there is nothing additional to clean up.
        }
      } else {
        registry.register(moduleUrl, 'FUNC', testCase.name);
      }
      requireToolSuccess(create, `${testCase.expectedProcessingType} FUNC create`);

      const inactiveMetadata = await client.http.get(`${moduleUrl}?version=inactive`);
      expect(xmlAttribute(inactiveMetadata.body, 'processingType')).toBe(testCase.expectedProcessingType);
      if (testCase.updateTaskKind === undefined) {
        expect(xmlAttribute(inactiveMetadata.body, 'updateTaskKind')).toBeUndefined();
      } else {
        expect(xmlAttribute(inactiveMetadata.body, 'updateTaskKind')).toBe(testCase.updateTaskKind);
      }

      const activation = await handleToolCall(client, config, 'SAPActivate', {
        type: 'FUNC',
        name: testCase.name,
        group,
      });
      requireToolSuccess(activation, `${testCase.expectedProcessingType} FUNC activation`);

      const activeMetadata = await client.http.get(`${moduleUrl}?version=active`);
      expect(xmlAttribute(activeMetadata.body, 'processingType')).toBe(testCase.expectedProcessingType);
      if (testCase.updateTaskKind === undefined) {
        expect(xmlAttribute(activeMetadata.body, 'updateTaskKind')).toBeUndefined();
      } else {
        expect(xmlAttribute(activeMetadata.body, 'updateTaskKind')).toBe(testCase.updateTaskKind);
      }
    }
  }, 120_000);
});
