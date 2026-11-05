import { afterEach, expect, it, vi } from 'vitest';
import {
  captureContractGroupBaseline,
  nextContractActiveReceipt,
  verifyContractActiveReceipt,
  verifyContractGroupBaseline,
} from '../../../scripts/qualification/pr1142/native-contract-inventory.js';
import {
  contractSelection,
  observeContractHttp,
} from '../../../scripts/qualification/pr1142/native-contract-transport.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';

const selected = contractSelection('0123456789ABCDEF'),
  marker = 'native fixture';
const core = 'http://www.sap.com/adt/core',
  ns = 'http://www.sap.com/adt/abapsource';
const structure = `<s:objectStructureElement xmlns:s="${ns}" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F"><s:objectStructureElement c:name="L${selected.group}TOP" c:type="FUGR/I"/><s:objectStructureElement c:name="L${selected.group}UXX" c:type="FUGR/I"/><s:objectStructureElement c:name="SAPL${selected.group}" c:type="FUGR/PX"/></s:objectStructureElement>`;
const metadata = `<g:abapFunctionGroup xmlns:g="http://www.sap.com/adt/functions/groups" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F" c:description="${marker}" c:createdBy="MARIAN"><c:packageRef c:name="$TMP"/></g:abapFunctionGroup>`;
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const bodies = new Map<string, string>();
  const statuses = new Map<string, number>();
  const media = new Map<string, string>();
  const get = vi.fn(async (path: string, headers?: Record<string, string>, _policy?: AdtRequestOptions) => ({
    statusCode: statuses.get(path) ?? 200,
    headers: { 'content-type': media.get(path) ?? headers?.Accept ?? 'text/plain' },
    body:
      bodies.get(path) ??
      (path.endsWith('/objectstructure')
        ? structure
        : path.startsWith(`${selected.groupUrl}?`)
          ? metadata
          : 'original native bytes'),
  }));
  const remove = vi.fn().mockResolvedValue({ statusCode: 204, headers: {}, body: '' });
  const http = { get, delete: remove } as unknown as AdtHttpClient;
  return { http, get, remove, bodies, statuses, media };
}

it('captures the raw tree, both metadata/source versions, both include versions and every text part', async () => {
  const native = fixture();
  const baseline = await captureContractGroupBaseline(native.http, selected, marker, () => {});
  expect(Object.keys(baseline.hashes)).toHaveLength(15);
  expect(native.get).toHaveBeenCalledTimes(15);
  expect(Object.keys(baseline.hashes)).toContain(`${selected.groupUrl}/source/main?version=active`);
  expect(Object.keys(baseline.hashes)).toContain(`${selected.groupUrl}?version=inactive`);
  for (const version of ['active', 'inactive'])
    for (const part of ['symbols', 'selections', 'headings'])
      expect(Object.keys(baseline.hashes)).toContain(
        `/sap/bc/adt/textelements/functiongroups/${selected.group}/source/${part}?version=${version}`,
      );
  await expect(
    verifyContractGroupBaseline(native.http, selected, marker, baseline, () => {}, {}),
  ).resolves.toBeUndefined();
  expect(native.get).toHaveBeenCalledTimes(30);
});

it.each(['FUGR/PD', 'FUGR/PM', 'FUGR/PT', 'FUGR/FF'])(
  'refuses an extra %s that the listing projection omits',
  async (type) => {
    const native = fixture();
    const baseline = await captureContractGroupBaseline(native.http, selected, marker, () => {});
    native.bodies.set(
      `${selected.groupUrl}/objectstructure`,
      structure.replace(
        '</s:objectStructureElement>',
        `<s:objectStructureElement c:name="FOREIGN" c:type="${type}"/></s:objectStructureElement>`,
      ),
    );
    const journal: unknown[] = [];
    const observed = observeContractHttp(
      native.http,
      selected,
      () => {},
      (session, _path, policy) =>
        verifyContractGroupBaseline(session, selected, marker, baseline, (event) => journal.push(event), policy),
    );
    await expect(observed.delete(selected.groupUrl)).rejects.toThrow('unqualified member');
    expect(native.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(journal)).toContain('FOREIGN');
  },
);

it.each([
  `${selected.groupUrl}/source/main?version=active`,
  `${selected.groupUrl}/source/main?version=inactive`,
  `${selected.groupUrl}/includes/l${selected.group.toLowerCase()}top/source/main?version=active`,
  `${selected.groupUrl}/includes/l${selected.group.toLowerCase()}uxx/source/main?version=inactive`,
  `/sap/bc/adt/textelements/functiongroups/${selected.group}/source/symbols?version=active`,
  `/sap/bc/adt/textelements/functiongroups/${selected.group}/source/selections?version=inactive`,
  `/sap/bc/adt/textelements/functiongroups/${selected.group}/source/headings?version=active`,
])('preserves changed native content at %s', async (path) => {
  const native = fixture();
  const baseline = await captureContractGroupBaseline(native.http, selected, marker, () => {});
  native.bodies.set(path, 'changed by another operation');
  await expect(verifyContractGroupBaseline(native.http, selected, marker, baseline, () => {}, {})).rejects.toThrow(
    'source or text changed',
  );
  expect(native.remove).not.toHaveBeenCalled();
});

it('does not hide an active-only metadata change or a new nested member', async () => {
  const native = fixture();
  const baseline = await captureContractGroupBaseline(native.http, selected, marker, () => {});
  native.bodies.set(
    `${selected.groupUrl}?version=active`,
    metadata.replace('c:createdBy="MARIAN"', 'c:createdBy="MARIAN" editorFlag="changed"'),
  );
  await expect(verifyContractGroupBaseline(native.http, selected, marker, baseline, () => {}, {})).rejects.toThrow(
    'source or text changed',
  );
  native.bodies.clear();
  native.bodies.set(
    `${selected.groupUrl}/objectstructure`,
    structure.replace(
      'c:type="FUGR/I"/>',
      'c:type="FUGR/I"><s:objectStructureElement c:name="FOREIGN" c:type="FUGR/PM"/></s:objectStructureElement>',
    ),
  );
  await expect(verifyContractGroupBaseline(native.http, selected, marker, baseline, () => {}, {})).rejects.toThrow(
    'unqualified member',
  );
});

it('requires a complete baseline bound to this group before making guard reads', async () => {
  const native = fixture();
  const baseline = await captureContractGroupBaseline(native.http, selected, marker, () => {});
  native.get.mockClear();
  for (const invalid of [undefined, { ...baseline, group: 'ZFOREIGN' }, { ...baseline, hashes: {} }])
    await expect(verifyContractGroupBaseline(native.http, selected, marker, invalid, () => {}, {})).rejects.toThrow(
      'baseline is missing',
    );
  expect(native.get).not.toHaveBeenCalled();
});

it('refuses partial responses and a source login page instead of treating it as content', async () => {
  const native = fixture();
  native.statuses.set(`${selected.groupUrl}/objectstructure`, 206);
  await expect(captureContractGroupBaseline(native.http, selected, marker, () => {})).rejects.toThrow(
    'complete HTTP 200',
  );
  native.statuses.clear();
  native.media.set(`${selected.groupUrl}/source/main?version=active`, 'text/html');
  await expect(captureContractGroupBaseline(native.http, selected, marker, () => {})).rejects.toThrow('media type');
});

it('carries one tighter deadline across the entire inventory capture', async () => {
  const native = fixture();
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  await captureContractGroupBaseline(native.http, selected, marker, () => {}, { deadline: 5000 });
  expect(native.get.mock.calls.map((call) => call[2]?.deadline)).toEqual(Array(15).fill(5000));
});

it('allows only a previously witnessed active source or the just-verified own save', () => {
  const created = nextContractActiveReceipt(undefined, { hash: 'created', metadataHash: 'meta' }, 'created');
  const saved = nextContractActiveReceipt(created, { hash: 'created', metadataHash: 'meta' }, 'saved');
  expect(() => verifyContractActiveReceipt(saved, { hash: 'saved', metadataHash: 'meta' })).not.toThrow();
  expect(() => verifyContractActiveReceipt(saved, { hash: 'foreign', metadataHash: 'meta' })).toThrow(
    'active function changed',
  );
  expect(() => verifyContractActiveReceipt(saved, { hash: 'saved', metadataHash: 'foreign' })).toThrow(
    'active function changed',
  );
  expect(() => nextContractActiveReceipt(saved, { hash: 'foreign', metadataHash: 'meta' }, 'new-save')).toThrow(
    'Unrecognized active',
  );
  expect(() => nextContractActiveReceipt(saved, { hash: 'saved', metadataHash: 'foreign' }, 'new-save')).toThrow(
    'Unrecognized active',
  );
});
