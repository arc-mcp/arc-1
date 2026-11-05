import { expect, it, vi } from 'vitest';
import { documentNodes } from '../../../scripts/qualification/pr1142/native-rap-documents-evidence.js';
import {
  RAP_DOCUMENT_STAGES,
  rapDocumentFixtures,
} from '../../../scripts/qualification/pr1142/native-rap-documents-fixtures.js';
import { rapHarness } from './pr1142-native-rap-harness.js';

const f = rapDocumentFixtures('0123456789AB'),
  doc = f[6];
it.each([false, true])(
  'composes native managed RAP plus accumulating KTD drafts and reverse cleanup (proxy=%s)',
  async (proxy) => {
    const h = rapHarness({ documents: true, proxy });
    const result = await h.run();
    expect(h.world.unexpected).toEqual([]);
    expect(result).toMatchObject({
      failure: false,
      completed: RAP_DOCUMENT_STAGES,
      remaining: [],
      inspectionRequired: [],
      finalAbsenceConfirmed: true,
    });
    expect(result.confirmedDeleted).toEqual([...f].reverse().map((x) => x.owner));
    expect(h.world.calls.filter((v) => v.method === 'DELETE').map((v) => v.path.split('?')[0])).toEqual(
      [...f].reverse().map((x) => x.owner),
    );
    const puts = h.world.calls.filter((v) => v.method === 'PUT' && v.path.startsWith(doc.owner));
    expect(puts).toHaveLength(3);
    const body = puts[2].body!;
    const { nodes, ids } = documentNodes(doc, body);
    expect(nodes.get(ids[0])!.text).toBe(doc.create.source);
    expect(nodes.get(ids[1])!.text).toBe('Owned create documentation.');
    expect(nodes.get(ids[2])!.text).toBe('Owned update documentation.');
    expect(nodes.get(ids[1])!.shortText).toBe('Create an owned RAP item');
    expect(nodes.get(ids[2])!.shortText).toBe('Update an owned RAP item');
    expect(body).toContain('x:value="001"');
    expect(h.records.some((v) => v.documentActiveCounterpart === doc.owner)).toBe(true);
  },
);
it.each(['wrong-parent', 'wrong-author', 'missing-operation', 'duplicate-id', 'foreign-slot'] as const)(
  'refuses native generated document %s before its first PUT',
  async (fault) => {
    const h = rapHarness({ documents: true });
    let armed = false;
    h.hooks.record = (v) => {
      if (v.creationAcknowledged === doc.owner) armed = true;
    };
    h.hooks.before = (u, r) => {
      if (!armed || r.method !== 'GET' || u.pathname !== doc.owner) return;
      armed = false;
      const obj = h.world.objects.get(doc.owner)!;
      if (fault === 'wrong-parent')
        obj.metadata = obj.metadata.replace('adtcore:type="BDEF/BDO"', 'adtcore:type="DDLS/DF"');
      if (fault === 'wrong-author') obj.metadata = obj.metadata.replace('createdBy="MARIAN"', 'createdBy="FOREIGN"');
      if (fault === 'missing-operation')
        obj.metadata = obj.metadata.replaceAll(`${doc.name}.update`, `${doc.name}.unqualified`);
      if (fault === 'duplicate-id') obj.metadata = obj.metadata.replaceAll(`${doc.name}.update`, `${doc.name}.create`);
      if (fault === 'foreign-slot')
        obj.metadata = obj.metadata.replace(
          'xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"',
          'xmlns:sktd="urn:foreign"',
        );
    };
    const r = await h.run();
    expect(r).toMatchObject({ failure: true, stoppedAt: 'create-document' });
    expect(r.remaining).toContain(doc.owner);
    expect(h.world.calls.some((v) => v.method === 'PUT' && v.path.startsWith(doc.owner))).toBe(false);
    expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
  },
);
it('preserves earlier draft and refuses an opaque native readback loss before activation/deletion', async () => {
  const h = rapHarness({ documents: true });
  let stage: string | undefined,
    saved = false;
  h.hooks.record = (v) => {
    if (v.stageStarted) stage = v.stageStarted;
  };
  h.hooks.before = (u, r) => {
    if (stage !== 'update-document-update') return;
    if (r.method === 'PUT' && u.pathname === doc.owner) saved = true;
    else if (saved && r.method === 'GET' && u.pathname === doc.owner) {
      saved = false;
      h.world.objects.get(doc.owner)!.metadata = h.world.objects
        .get(doc.owner)!
        .metadata.replace('x:value="001"', 'x:value="002"');
    }
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'update-document-update' });
  expect(r.remaining).toContain(doc.owner);
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
});
it('refuses changed BDEF before document CREATE and never creates a replacement graph', async () => {
  const h = rapHarness({ documents: true });
  h.hooks.record = (v) => {
    if (v.stageStarted === 'create-document') h.world.objects.get(f[3].owner)!.source += '// drift';
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'create-document' });
  expect(
    h.world.calls.some((v) => v.method === 'POST' && v.path === doc.owner.slice(0, doc.owner.lastIndexOf('/'))),
  ).toBe(false);
});

it('retains historical document deletion plus current reappearance and refuses BDEF deletion', async () => {
  const h = rapHarness({ documents: true });
  let saved = '';
  h.hooks.record = (v) => {
    if (v.stageStarted === 'delete-document') saved = h.world.objects.get(doc.owner)!.metadata;
    if (v.stageStarted === 'delete-bdef') h.world.objects.get(doc.owner)!.metadata = saved;
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'delete-bdef' });
  expect(r.confirmedDeleted).toContain(doc.owner);
  expect(r.remaining).toContain(doc.owner);
  expect(r.inspectionRequired).toContain(doc.owner);
  expect(h.world.calls.some((v) => v.method === 'DELETE' && v.path.startsWith(f[3].owner))).toBe(false);
});
it('reports saved draft uncertainty when the previous active counterpart changes', async () => {
  const h = rapHarness({ documents: true });
  let armed = false;
  h.hooks.record = (v) => {
    if (v.stageStarted === 'update-document-create') armed = true;
  };
  h.hooks.before = (u, r) => {
    if (armed && r.method === 'PUT' && u.pathname === doc.owner) {
      armed = false;
      h.activeDocuments.set(doc.owner, h.activeDocuments.get(doc.owner)!.replace('x:value="001"', 'x:value="002"'));
    }
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'update-document-create' });
  expect(h.world.calls.filter((v) => v.method === 'PUT' && v.path.startsWith(doc.owner))).toHaveLength(2);
  expect(r.remaining).toContain(doc.owner);
  expect(h.world.calls.some((v) => v.method === 'DELETE')).toBe(false);
});
it.each([false, true].flatMap((proxy) => (['source', 'stop', 'expiry'] as const).map((fault) => ({ proxy, fault }))))(
  'actual document auth wait refuses $fault and retains owning cleanup (proxy=$proxy)',
  async ({ proxy, fault }) => {
    let armed = false,
      entered!: () => void,
      release!: () => void;
    const waiting = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const h = rapHarness({
      documents: true,
      proxy,
      token: async () => {
        if (armed) {
          armed = false;
          entered();
          await gate;
        }
        return 'synthetic-token';
      },
    });
    h.hooks.record = (v) => {
      if (v.stage === 'request' && v.phase === 'update-document-create' && v.method === 'PUT') armed = true;
    };
    const work = h.run();
    await waiting;
    if (fault === 'source') h.breakSource();
    else if (fault === 'stop') h.stop();
    else vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    release();
    const r = await work;
    expect(r).toMatchObject({ failure: true, stoppedAt: 'update-document-create', cleanupUnconfirmed: false });
    expect(h.world.calls.filter((v) => v.method === 'PUT' && v.path.startsWith(doc.owner))).toHaveLength(1);
    expect(h.records.filter((v) => v.ownSessionClosed !== undefined).at(-1)).toMatchObject({ ownSessionClosed: true });
  },
);
