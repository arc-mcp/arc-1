import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindingStableDocument,
  parsePinnedBinding,
  patchPinnedBindingDocument,
  pinnedBindingSelection,
} from '../../../src/adt/pinned-service-binding-owner.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { pinnedPublicAuth } from '../../helpers/pinned-public-auth.js';
import {
  bindingName,
  bindingUri,
  bindingXml,
  definitionUri,
  managedHarness,
  nativeAbsent,
  ownerXml,
  packageXml,
} from './pinned-managed-harness.js';

const { createPinnedBinding, deletePinnedBinding, updatePinnedBinding } = await import(
  '../../../src/adt/pinned-service-binding.js'
);
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handlePinnedActivation, handlePrivatePinnedBindingActivation } = await import(
  '../../../src/handlers/write/pinned-activation.js'
);
const { preparePinnedPublication, preparePinnedPublicationBatch } = await import(
  '../../../src/adt/pinned-publication.js'
);
let exists: boolean, body: string, fault: string;
let harness: ReturnType<typeof managedHarness>;
const selected = pinnedBindingSelection(bindingName);
const metadataHash = () => parsePinnedBinding(body, selected).metadataHash;
const createInput = {
  name: bindingName,
  package: '$TMP',
  description: 'New binding',
  serviceDefinition: 'ZDEFINITION',
  odataVersion: 'V4',
  category: '0',
  version: '0001',
} as const;
beforeEach(() => {
  exists = true;
  body = bindingXml();
  fault = '';
  harness = managedHarness((r) => {
    if (r.path === '/sap/bc/adt/packages/%24TMP') return mockResponse(200, packageXml('$TMP'));
    if (r.path === definitionUri) return mockResponse(200, ownerXml());
    if (r.method === 'GET' && r.path.startsWith(bindingUri)) {
      if (!exists) return mockResponse(404, nativeAbsent);
      return mockResponse(
        200,
        fault === 'readback-drift' && saved().length ? body.replace('ZDEFINITION', 'ZFOREIGN') : body,
      );
    }
    if (r.method === 'POST' && r.path === '/sap/bc/adt/businessservices/bindings') {
      exists = true;
      body = patchPinnedBindingDocument(body, selected, createInput);
      return mockResponse(201, '');
    }
    if (r.method === 'PUT' && r.path.startsWith(bindingUri)) {
      body = r.body;
      return mockResponse(fault === 'lost-save' ? 503 : 200, '');
    }
    if (r.method === 'DELETE' && r.path.startsWith(bindingUri)) {
      exists = false;
      return mockResponse(204, '');
    }
    if (r.method === 'POST' && r.path.startsWith('/sap/bc/adt/activation')) {
      if (fault === 'expanded-preaudit' || fault === 'changed-preaudit') {
        if (fault === 'changed-preaudit') body = body.replace('adtcore:description="', 'adtcore:description="Changed ');
        const uri = fault === 'expanded-preaudit' ? '/sap/bc/adt/businessservices/bindings/ZOTHER' : bindingUri;
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref adtcore:uri="${uri}" adtcore:name="ZBIND" adtcore:type="SRVB/SVB"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
        );
      }
      body = body.replace('adtcore:version="inactive"', 'adtcore:version="active"');
      if (fault === 'activation-drift') body = body.replace('adtcore:description="', 'adtcore:description="Changed ');
      return mockResponse(
        200,
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    }
    return undefined;
  });
});
const saved = () => harness.calls.filter((r) => r.method === 'PUT');
const update = (patch = {}) =>
  updatePinnedBinding(harness.client, harness.context(), {
    name: bindingName,
    expectedMetadataHash: metadataHash(),
    description: 'Changed & preserved',
    ...patch,
  });
const publish = (patch = {}) =>
  preparePinnedPublication(
    harness.client,
    harness.context(),
    { name: bindingName, version: '0001', serviceType: 'odatav4', expectedMetadataHash: metadataHash(), ...patch },
    'publish_srvb',
  );

describe('private service-binding document and CRUD', () => {
  it('preserves opaque native fields, content, and unknown extension namespaces when patching', () => {
    body = body.replace(
      '</srvb:serviceBinding>',
      '<ext:opaque xmlns:ext="urn:future" ext:flag="&amp;">A &amp; B</ext:opaque></srvb:serviceBinding>',
    );
    const patched = patchPinnedBindingDocument(body, selected, { description: 'Changed & preserved' });
    expect(patched).toContain('<ext:opaque xmlns:ext="urn:future" ext:flag="&amp;">A &amp; B</ext:opaque>');
    expect(patched).toContain('bindingTypeData');
    expect(parsePinnedBinding(patched, selected).description).toBe('Changed & preserved');
    const restore = patchPinnedBindingDocument(patched, selected, {
      description: parsePinnedBinding(body, selected).description!,
    });
    expect(bindingStableDocument(restore)).toBe(bindingStableDocument(body));
  });
  it('creates inactive SRVB only after package and referenced-definition checks', async () => {
    exists = false;
    expect(await createPinnedBinding(harness.client, harness.context(), createInput)).toMatchObject({
      ok: true,
      state: 'created-inactive',
    });
    expect(harness.calls.some((r) => r.path.includes('/publishjobs') || r.path.includes('/activation'))).toBe(false);
  });
  it('saves under the owner lock and validates the preserved document', async () => {
    const snapshot = await handleToolCall(harness.client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'SRVB',
      name: bindingName,
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(harness.calls.every((call) => call.method === 'GET')).toBe(true);
    const result = await update({ expectedMetadataHash: JSON.parse(snapshot.content[0]!.text).metadataHash });
    expect(result, JSON.stringify({ result, calls: harness.calls })).toMatchObject({
      ok: true,
      state: 'saved-inactive',
    });
    expect(saved()).toHaveLength(1);
    expect(saved()[0]?.path).toContain('lockHandle=SECRET_HANDLE');
    expect(harness.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(harness.calls.some((r) => r.path.includes('/activation'))).toBe(false);
  });
  it('rejects a stale metadata hash under the lock without saving', async () => {
    const snapshot = await handleToolCall(harness.client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'SRVB',
      name: bindingName,
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    body = body.replace('adtcore:description="', 'adtcore:description="Concurrent ');
    expect(await update({ expectedMetadataHash: JSON.parse(snapshot.content[0]!.text).metadataHash })).toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(saved()).toHaveLength(0);
    expect(harness.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });
  it.each(['published', 'generated', 'unknown'])('refuses %s binding state before locking', async (state) => {
    if (state === 'published') body = body.replace('srvb:published="false"', 'srvb:published="true"');
    if (state === 'generated') body = body.replace('srvb:bindingCreated="false"', 'srvb:bindingCreated="true"');
    if (state === 'unknown') body = body.replace('srvb:published="false"', 'srvb:published="unknown"');
    expect(await update()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(harness.calls.some((r) => r.path.includes('_action=LOCK'))).toBe(false);
  });
  it.each([
    { expectedMetadataHash: undefined },
    { include: 'source' },
    { description: 'line\nbreak' },
    { version: 'latest' },
    { category: 0 },
    { serviceDefinition: '../OTHER' },
  ])('refuses invalid update input %j', async (patch) => {
    expect(await update(patch)).toMatchObject({ ok: false, state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it('does not replay an uncertain save or expose lock/session credentials', async () => {
    fault = 'lost-save';
    const result = await update();
    expect(result).toMatchObject({ ok: false, state: 'save-unconfirmed', retryable: false });
    expect(saved()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_HANDLE|SECRET_SESSION/);
    expect(harness.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });
  it('preserves a successful save with unverifiable readback as incomplete', async () => {
    fault = 'readback-drift';
    expect(await update()).toMatchObject({ ok: false, state: 'saved-unverified' });
    expect(saved()).toHaveLength(1);
  });
  it('deletes exactly the unpublished binding and verifies native absence', async () => {
    expect(await deletePinnedBinding(harness.client, harness.context(), { name: bindingName })).toMatchObject({
      ok: true,
      state: 'deleted',
    });
    expect(harness.calls.filter((r) => r.method === 'DELETE' && r.path.startsWith(bindingUri))).toHaveLength(1);
    expect(harness.calls.some((r) => r.path.includes('/publishjobs'))).toBe(false);
  });
  it('rejects spoofed namespaces and expansion into multiple services', async () => {
    body = body.replace('http://www.sap.com/adt/ddic/ServiceBindings', 'urn:spoofed');
    expect(
      await updatePinnedBinding(harness.client, harness.context(), {
        name: bindingName,
        expectedMetadataHash: '0'.repeat(64),
        description: 'Changed',
      }),
    ).toMatchObject({ ok: false, state: 'unchanged' });
    expect(saved()).toHaveLength(0);
  });
});

describe('private binding activation and publication boundary', () => {
  it('selects the shared binding activation profile without a tool-controlled grant', async () => {
    const result = await handlePinnedActivation(harness.client, { type: 'SRVB', name: bindingName });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(harness.calls.filter((call) => call.path.startsWith('/sap/bc/adt/activation'))).toHaveLength(1);
  });
  it('uses the shared private activation protocol and verifies native active metadata', async () => {
    const result = await handlePrivatePinnedBindingActivation(harness.client, { type: 'SRVB', name: bindingName });
    expect(result.isError, JSON.stringify({ result, calls: harness.calls })).not.toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(result)).toContain('nativeMetadataVerified');
    expect(harness.calls.filter((r) => r.path.startsWith('/sap/bc/adt/activation'))).toHaveLength(1);
    expect(harness.calls.some((r) => r.path.endsWith('?version=active'))).toBe(true);
  });
  it.each(['expanded-preaudit', 'changed-preaudit'])('refuses %s without activation confirmation', async (scenario) => {
    fault = scenario;
    const result = await handlePrivatePinnedBindingActivation(harness.client, { type: 'SRVB', name: bindingName });
    expect(result.isError).toBe(true);
    expect(harness.calls.filter((r) => r.path.startsWith('/sap/bc/adt/activation'))).toHaveLength(1);
  });
  it('reports native activation as incomplete when active metadata changed', async () => {
    fault = 'activation-drift';
    const result = await handlePrivatePinnedBindingActivation(harness.client, { type: 'SRVB', name: bindingName });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('binding-active-verification');
    expect(harness.calls.filter((r) => r.path.startsWith('/sap/bc/adt/activation'))).toHaveLength(1);
  });
  it('validates the exact active binding but refuses missing current-principal qualification', async () => {
    body = bindingXml('active');
    expect(await publish()).toMatchObject({ ok: false, state: 'unchanged', qualification: 'not-established' });
    expect(harness.calls.every((r) => r.method === 'GET')).toBe(true);
  });
  it.each([
    { version: 'latest' },
    { serviceType: 'odata' },
    { expectedMetadataHash: undefined },
    { transport: 'A4HK900001' },
    { name: '../ZBIND' },
  ])('rejects publication input before read: %j', async (patch) => {
    await expect(publish(patch)).rejects.toThrow();
    expect(harness.calls).toHaveLength(0);
  });
  it('refuses inactive binding and active metadata drift without a job', async () => {
    await expect(publish()).rejects.toThrow();
    expect(harness.calls.some((r) => r.method === 'POST')).toBe(false);
  });
  it.each(['inactive', 'INACTIVE', 'active?ignored'])(
    'refuses a native inactive or malformed alternative %s',
    async (version) => {
      body = bindingXml('active').replace(
        '</srvb:serviceBinding>',
        `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${bindingUri}?version=${version}"/></srvb:serviceBinding>`,
      );
      if (version !== 'inactive') expect(() => metadataHash()).toThrow();
      else await expect(publish()).rejects.toThrow();
      expect(harness.calls.some((r) => r.method === 'POST')).toBe(false);
    },
  );
  it.each(
    [
      [],
      Array.from({ length: 11 }, () => ({})),
      [
        { name: bindingName, version: '0001', serviceType: 'odatav4', expectedMetadataHash: '0'.repeat(64) },
        { name: bindingName, version: '0001', serviceType: 'odatav4', expectedMetadataHash: '0'.repeat(64) },
      ],
    ].map((bindings) => ({ bindings })),
  )('bounds and deduplicates all batch selection before native reads', async ({ bindings }) => {
    await expect(
      preparePinnedPublicationBatch(harness.client, harness.context(), { action: 'publish_srvb', bindings }),
    ).rejects.toThrow();
    expect(harness.calls).toHaveLength(0);
  });
});

function publicConfig() {
  return {
    ...DEFAULT_CONFIG,
    ...harness.client.safety,
    client: '001',
    targetId: 'A4H/001',
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    ppEnabled: true,
    ppStrict: true,
  };
}
it('public SRVB metadata update preserves its exact optimistic guard and native document', async () => {
  const args = {
    action: 'update',
    type: 'SRVB',
    name: bindingName,
    description: 'Public update',
    expectedMetadataHash: metadataHash(),
  };
  const stale = await handleToolCall(
    harness.client,
    publicConfig(),
    'SAPWrite',
    { ...args, expectedMetadataHash: 'a'.repeat(64) },
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(stale.isError).toBe(true);
  expect(saved()).toHaveLength(0);
  const result = await handleToolCall(
    harness.client,
    publicConfig(),
    'SAPWrite',
    args,
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(JSON.parse(result.content[0].text).state).toBe('saved-inactive');
  expect(saved()).toHaveLength(1);
});
it('public SRVB deletion keeps the generated-owner cleanup guard', async () => {
  body = bindingXml('active').replace('srvb:bindingCreated="false"', 'srvb:bindingCreated="true"');
  const result = await handleToolCall(
    harness.client,
    publicConfig(),
    'SAPWrite',
    { action: 'delete', type: 'SRVB', name: bindingName },
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(result.isError).toBe(true);
  expect(harness.calls.some((call) => call.method === 'DELETE')).toBe(false);
});
