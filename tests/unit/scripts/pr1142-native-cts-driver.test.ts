import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generatedCtsId } from '../../../scripts/qualification/pr1142/native-cts-evidence.js';
import { CTS_STEPS, harness } from './pr1142-native-cts-harness.js';

it.each(['organizer', 'bare', 'legacy-record'] as const)(
  'adopts the exact generated request from the %s response before its independent native lookup',
  async (creationResponse) => {
    const h = harness(undefined, { creationResponse });
    const result = await h.run('A');
    expect(result.failure).toBe(false);
    expect(result.completed).toEqual(CTS_STEPS.A);
    expect(h.records.find((r) => r.generatedRequest)).toMatchObject({
      generatedRequest: 'A4HK910001',
      ownership: 'unconfirmed',
    });
    const response = h.records.find((r) => r.stage === 'response' && r.path === '/sap/bc/adt/cts/transports');
    expect(response.body).toBe(
      `${creationResponse === 'organizer' ? '/sap/bc/adt/cts/transportrequests/' : creationResponse === 'bare' ? '' : '/com.sap.cts/object_record/'}A4HK910001`,
    );
    expect(h.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/cts/transports')).toHaveLength(1);
    h.assertSafe();
  },
);

it('recognizes the captured A4H creation response without treating it as ownership proof', () => {
  const response = readFileSync(new URL('../../fixtures/cts/create-record-uri-a4h-758.txt', import.meta.url), 'utf8');
  expect(generatedCtsId(response, [])).toBe('A4HK906607');
  expect(() => generatedCtsId(response, ['A4HK906607'])).toThrow();
});

it.each([
  '/other/object_record/A4HK906607',
  'https://a4h.example/com.sap.cts/object_record/A4HK906607',
  '/com.sap.cts/object_record/A4HK906607?x=1',
  '/com.sap.cts/object_record/A4HK906607#x',
  '/com.sap.cts/object_record/A4HK906607/extra',
  '/com.sap.cts/object_record/%414HK906607',
  '/com.sap.cts/object_record/A4HK906605',
  '/com.sap.cts/object_record/A4HK906606',
  '/com.sap.cts/object_record/NPLK906607',
  '/com.sap.cts/object_record/A4HK906607\nA4HK906608',
])('refuses an unqualified generated record identity: %s', (body) => {
  expect(() => generatedCtsId(body, [])).toThrow();
});

it.each(['typed', 'wrong-id', 'untyped', 'forbidden'] as const)('handles final native C absence: %s', async (mode) => {
  const h = harness(),
    a = await h.run('A'),
    b = await h.run('B', a);
  const fixture = readFileSync(
    new URL('../../fixtures/xml/cts-request-not-found-a4h-758.xml', import.meta.url),
    'utf8',
  );
  h.hooks.reply = (r) => {
    if (
      r.method !== 'GET' ||
      r.path !== '/sap/bc/adt/cts/transportrequests/A4HK910005' ||
      h.trees.get('A4HK910005')?.exists !== false
    )
      return;
    return {
      statusCode: mode === 'forbidden' ? 403 : 404,
      data:
        mode === 'untyped'
          ? '<html>Missing</html>'
          : fixture.replaceAll('A4HK000000', mode === 'wrong-id' ? 'A4HK999999' : 'A4HK910005'),
    };
  };
  const c = await h.run('C', b);
  if (mode === 'typed') {
    expect(c).toMatchObject({
      failure: false,
      completed: CTS_STEPS.C,
      remaining: [],
      current: { A4HK910005: 'absent', A4HK910006: 'absent' },
    });
    expect(c.confirmedDeleted).toEqual(expect.arrayContaining(['A4HK910005', 'A4HK910006']));
    expect(h.records.some((r) => r.nativeOrganizer === 'A4HK910005' && r.typedAbsence === true)).toBe(true);
  } else {
    expect(c.failure).toBe(true);
    expect(c.inspectionRequired).toContain('A4HK910005');
    expect(c.confirmedDeleted).not.toContain('A4HK910005');
  }
  expect(h.calls.filter((r) => r.method === 'DELETE' && r.path.includes('/cts/transportrequests/'))).toHaveLength(2);
  h.assertSafe();
});

it('runs the three actual handler and class lifecycles, retaining released history and typed C absence', async () => {
  const h = harness(),
    a = await h.run('A');
  expect(a, JSON.stringify(h.records.filter((r) => r.stoppedAt || r.adapter))).toMatchObject({
    failure: false,
    completed: CTS_STEPS.A,
    remaining: [],
  });
  const b = await h.run('B', a);
  expect(b, JSON.stringify(h.records.filter((r) => r.stoppedAt || r.adapter))).toMatchObject({
    failure: false,
    completed: CTS_STEPS.B,
    remaining: [],
  });
  const c = await h.run('C', b);
  expect(c, JSON.stringify(h.records.filter((r) => r.stoppedAt || r.adapter))).toMatchObject({
    failure: false,
    completed: CTS_STEPS.C,
    remaining: [],
  });
  expect(c.requests).toHaveLength(3);
  expect(c.retainedReleasedHistory).toHaveLength(4);
  expect(c.confirmedDeleted).toHaveLength(4);
  expect(
    h.calls
      .filter((call) => call.method === 'DELETE' && call.path.includes('/cts/transportrequests/'))
      .map((call) => call.path),
  ).toEqual(['/sap/bc/adt/cts/transportrequests/A4HK910006', '/sap/bc/adt/cts/transportrequests/A4HK910005']);
  expect(h.calls.filter((call) => call.path.endsWith('/newreleasejobs')).map((call) => call.path)).toEqual(
    ['A4HK910002', 'A4HK910001', 'A4HK910004', 'A4HK910003'].map(
      (id) => `/sap/bc/adt/cts/transportrequests/${id}/newreleasejobs`,
    ),
  );
  expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(4);
  expect(h.calls.filter((c) => c.path === '/sap/bc/adt/cts/transports' && c.method === 'POST')).toHaveLength(3);
  h.assertSafe();
});

it.each(['server', 'destination', 'write', 'transport'] as const)(
  'refuses missing %s authority before any HTTP',
  async (mode) => {
    const h = harness();
    if (mode === 'server') Object.assign(h.client.safety.multiTargetWrite!, { serverAllowedTransports: [] });
    if (mode === 'destination') Object.assign(h.client.safety.multiTargetWrite!, { allowedTransports: [] });
    if (mode === 'write') h.client.safety.allowWrites = false;
    if (mode === 'transport') h.client.safety.allowTransportWrites = false;
    expect((await h.run('A')).failure).toBe(true);
    expect(h.calls).toEqual([]);
    h.assertSafe();
  },
);
it.each([
  'target-missing',
  'target-foreign',
  'description',
  'owner',
  'foreign-row',
  'foreign-child',
  'paged',
  'summary-paged',
] as const)('retains uncertain generated creation after native %s evidence, with one POST', async (fault) => {
  const h = harness();
  h.hooks.reply = (r) => {
    if (r.method !== 'GET' || !r.path.includes('/cts/transportrequests/')) return;
    const t = [...h.trees.values()][0];
    let body = h.xml(t);
    if (fault === 'target-missing') body = body.replace('t:target=""', '');
    if (fault === 'target-foreign') body = body.replace('t:target=""', 't:target="QAS"');
    if (fault === 'description') body = body.replace(t.description, 'WRONG');
    if (fault === 'owner') body = body.replace('t:owner="MARIAN"', 't:owner="OTHER"');
    if (fault === 'foreign-row')
      body = body.replace(
        '</t:task>',
        '<t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="UNRELATED" t:position="000010" t:lock_status="X"/></t:task>',
      );
    if (fault === 'foreign-child')
      body = body.replace(
        '</t:request>',
        '<t:task t:number="A4HK999999" t:parent="' +
          t.parent +
          '" t:owner="MARIAN" t:type="Unclassified" t:status="D" t:desc="Other" t:target="" t:source_client="001" t:uri="/sap/bc/adt/cts/transportrequests/A4HK999999"/></t:request>',
      );
    if (fault === 'summary-paged') body = body.replace('</t:request>', '<t:all_objects t:hasMore="true"/></t:request>');
    if (fault === 'paged') body = body.replace('<t:root ', '<t:root t:hasMore="true" ');
    return { statusCode: 200, data: body };
  };
  const r = await h.run('A');
  expect(r.failure).toBe(true);
  expect(r.unknownCreation).toBe(true);
  expect(r.inspectionRequired).toContain('A4HK910001');
  expect(h.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  expect(h.calls.some((c) => ['PUT', 'DELETE'].includes(c.method))).toBe(false);
  h.assertSafe();
});
it('retains a transient unexpected creation child even when a later read omits it', async () => {
  const h = harness();
  let reads = 0;
  h.hooks.reply = (r) => {
    if (r.method === 'GET' && r.path.includes('/cts/transportrequests/') && ++reads === 1) {
      const t = [...h.trees.values()][0];
      return {
        statusCode: 200,
        data: h
          .xml(t)
          .replace(
            '</t:request>',
            `<t:task t:number="A4HK999999" t:parent="${t.parent}" t:owner="MARIAN" t:type="Unclassified" t:status="D" t:desc="Other" t:target="" t:source_client="001" t:uri="/sap/bc/adt/cts/transportrequests/A4HK999999"/></t:request>`,
          ),
      };
    }
  };
  const r = await h.run('A');
  expect(r.failure).toBe(true);
  expect(r.inspectionRequired).toContain('A4HK999999');
  expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  h.assertSafe();
});
it.each(['reassign', 'remove', 'release'] as const)(
  'stops on uncertain native %s without retry or compensation',
  async (fault) => {
    const h = harness();
    let count = 0;
    h.hooks.reply = (r) => {
      const selected =
        fault === 'reassign'
          ? r.method === 'PUT' && r.body.includes('changeowner')
          : fault === 'remove'
            ? r.method === 'PUT' && r.body.includes('removeobject')
            : r.method === 'POST' && r.path.includes('/newreleasejobs');
      if (selected) {
        count++;
        return { statusCode: 503, data: 'Synthetic native uncertainty' };
      }
    };
    const r = await h.run('A');
    expect(r.failure).toBe(true);
    expect(count).toBe(1);
    expect(r.inspectionRequired).toContain('A4HK910001');
    expect(r.inspectionRequired).toContain('A4HK910002');
    expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(fault === 'release' ? 1 : 0);
    h.assertSafe();
  },
);
it.each(['present', 'unknown'] as const)(
  'keeps C deletion history but retains a later %s parent/task observation',
  async (fault) => {
    const h = harness(),
      a = await h.run('A'),
      b = await h.run('B', a);
    let final = false;
    h.hooks.record = (r) => {
      if (r.completedStep === 'delete-recursive') final = true;
    };
    h.hooks.reply = (r) => {
      if (final && r.method === 'GET' && r.path.endsWith('A4HK910005')) {
        const t = h.trees.get('A4HK910005')!;
        if (fault === 'unknown') return { statusCode: 404, data: 'Ambiguous CTS 404' };
        t.exists = true;
        t.taskExists = true;
        return { statusCode: 200, data: h.xml(t) };
      }
    };
    const r = await h.run('C', b);
    expect(r.failure).toBe(true);
    expect(r.confirmedDeleted).toEqual(expect.arrayContaining(['A4HK910005', 'A4HK910006']));
    expect(r.remaining).toEqual(expect.arrayContaining(['A4HK910005', 'A4HK910006']));
    expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(4);
    h.assertSafe();
  },
);
it('refuses source drift first visible under the owning delete lock, then unlocks without DELETE', async () => {
  const h = harness();
  let locks = 0;
  h.hooks.before = (r) => {
    if (r.path.startsWith(`${h.graph.classes[0].owner}?`) && r.path.includes('_action=LOCK') && ++locks === 2)
      h.classes.get(h.graph.classes[0].owner)!.source = 'changed under lock';
  };
  const r = await h.run('A');
  expect(r.failure).toBe(true);
  expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(h.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(2);
  expect(r.remaining).toContain(h.graph.classes[0].owner);
  h.assertSafe();
});
it.each([
  'A4HK906605',
  'A4HK906606',
  'DEVK910001',
  'https://foreign.invalid/sap/bc/adt/cts/transportrequests/A4HK910001',
])('never adopts reserved/foreign generated response %s', async (value) => {
  const h = harness();
  h.hooks.reply = (r) =>
    r.method === 'POST' && r.path === '/sap/bc/adt/cts/transports' ? { statusCode: 201, data: value } : undefined;
  const r = await h.run('A');
  expect(r.failure).toBe(true);
  expect(r.unknownCreation).toBe(true);
  expect(h.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  expect(h.calls.some((c) => c.path.includes('/cts/transportrequests/'))).toBe(false);
  h.assertSafe();
});
it('refuses an oversized read response before creating a request', async () => {
  const h = harness();
  h.hooks.reply = (r) =>
    r.path.startsWith('/sap/bc/adt/packages/') ? { statusCode: 200, data: 'X'.repeat(2 * 1024 * 1024 + 1) } : undefined;
  const r = await h.run('A');
  expect(r.failure).toBe(true);
  expect(h.calls.some((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toBe(false);
  h.assertSafe();
});

it.each(['future-summary', 'transient-foreign-summary', 'transient-direct-row'] as const)(
  'never adopts an empty creation graph after %s on its first native read',
  async (fault) => {
    const h = harness();
    let injected = 0;
    h.hooks.reply = (r) => {
      const t = [...h.trees.values()][0];
      if (
        !t ||
        r.method !== 'GET' ||
        !r.path.startsWith('/sap/bc/adt/cts/transportrequests/') ||
        (injected && fault !== 'future-summary')
      )
        return;
      injected++;
      const row = `<t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="${fault === 'transient-foreign-summary' ? 'UNRELATED_FOREIGN_CLASS' : h.graph.classes[0].name}" t:position="000010" t:lock_status="X"/>`;
      return {
        statusCode: 200,
        data: h
          .xml(t)
          .replace(
            '</t:request>',
            `${fault === 'transient-direct-row' ? row : `<t:all_objects>${row}</t:all_objects>`}</t:request>`,
          ),
      };
    };
    const r = await h.run('A');
    expect(injected).toBeGreaterThan(0);
    expect(r.failure).toBe(true);
    expect(r.unknownCreation).toBe(true);
    expect(r.completed).toEqual([]);
    expect(r.inspectionRequired).toEqual(expect.arrayContaining(['A4HK910001', 'A4HK910002']));
    expect(h.calls.filter((c) => ['POST', 'PUT', 'DELETE'].includes(c.method))).toHaveLength(1);
    h.assertSafe();
  },
);
it.each(['summary', 'direct'] as const)(
  'requires an empty %s inventory before transferring the still-empty task',
  async (shape) => {
    const h = harness();
    let bound = false,
      injected = false;
    h.hooks.record = (r) => {
      if (r.completedStep === 'create-request') bound = true;
    };
    h.hooks.reply = (r) => {
      const t = [...h.trees.values()][0];
      if (!bound || injected || r.method !== 'GET' || !r.path.startsWith('/sap/bc/adt/cts/transportrequests/')) return;
      injected = true;
      const row = `<t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="${h.graph.classes[0].name}" t:position="000010" t:lock_status="X"/>`;
      return {
        statusCode: 200,
        data: h
          .xml(t)
          .replace(
            '</t:request>',
            `${shape === 'summary' ? `<t:all_objects>${row}</t:all_objects>` : row}</t:request>`,
          ),
      };
    };
    const r = await h.run('A');
    expect(injected).toBe(true);
    expect(r.failure).toBe(true);
    expect(r.completed).toEqual(['create-request']);
    expect(h.calls.filter((c) => ['PUT', 'DELETE'].includes(c.method))).toHaveLength(0);
    h.assertSafe();
  },
);
it('retains a nonempty post-remove summary and never continues to class deletion', async () => {
  const h = harness();
  let removed = false,
    injected = false;
  h.hooks.before = (r) => {
    if (r.method === 'PUT' && r.body.includes('remove')) removed = true;
  };
  h.hooks.reply = (r) => {
    const t = [...h.trees.values()][0];
    if (!removed || injected || r.method !== 'GET' || !r.path.startsWith('/sap/bc/adt/cts/transportrequests/')) return;
    injected = true;
    return {
      statusCode: 200,
      data: h
        .xml(t)
        .replace(
          '</t:request>',
          `<t:all_objects><t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="${h.graph.classes[0].name}" t:position="000010" t:lock_status="X"/></t:all_objects></t:request>`,
        ),
    };
  };
  const r = await h.run('A');
  expect(injected).toBe(true);
  expect(r.failure).toBe(true);
  expect(r.completed).not.toContain('remove-object');
  expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  expect(r.inspectionRequired).toContain('A4HK910001');
  h.assertSafe();
});
it('allows qualified own summary rows after recording, preserving the complete A lifecycle', async () => {
  const h = harness();
  let summaries = 0;
  h.hooks.reply = (r) => {
    const t = [...h.trees.values()][0];
    if (!t?.objects.length || r.method !== 'GET' || !r.path.startsWith('/sap/bc/adt/cts/transportrequests/')) return;
    summaries++;
    return {
      statusCode: 200,
      data: h.xml(t).replace('</t:request>', `<t:all_objects>${t.objects.join('')}</t:all_objects></t:request>`),
    };
  };
  const r = await h.run('A');
  expect(summaries).toBeGreaterThan(0);
  expect(r.failure).toBe(false);
  expect(r.completed).toEqual(CTS_STEPS.A);
  h.assertSafe();
});
it.each(['target', 'source_client', 'uri'] as const)(
  'retains newly observed member before missing %s validation, without giving it wire authority',
  async (attribute) => {
    const h = harness();
    let bound = false,
      injected = false;
    h.hooks.record = (r) => {
      if (r.completedStep === 'create-request') bound = true;
    };
    h.hooks.reply = (r) => {
      const t = [...h.trees.values()][0];
      if (!bound || injected || r.method !== 'GET' || !r.path.startsWith('/sap/bc/adt/cts/transportrequests/')) return;
      injected = true;
      const extra =
        `<t:task t:number="A4HK999998" t:parent="${t.parent}" t:owner="MARIAN" t:type="Unclassified" t:status="D" t:desc="Unexpected" t:target="" t:source_client="001" t:uri="/sap/bc/adt/cts/transportrequests/A4HK999998"/>`.replace(
          new RegExp(` t:${attribute}="[^"]*"`),
          '',
        );
      return { statusCode: 200, data: h.xml(t).replace('</t:request>', `${extra}</t:request>`) };
    };
    const r = await h.run('A');
    expect(injected).toBe(true);
    expect(r.failure).toBe(true);
    expect(r.current.A4HK999998).toBe('unknown');
    expect(r.remaining).toContain('A4HK999998');
    expect(r.inspectionRequired).toContain('A4HK999998');
    expect(h.calls.some((c) => c.path.includes('A4HK999998'))).toBe(false);
    expect(h.calls.filter((c) => ['PUT', 'DELETE'].includes(c.method))).toHaveLength(0);
    h.assertSafe();
  },
);
