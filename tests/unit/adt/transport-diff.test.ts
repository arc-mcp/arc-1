/**
 * Transport-diff selection + rollup.
 *
 * The ordering, blank-transport and LIMU-name cases are not hypothetical — each mirrors a
 * shape captured live from a4h (S/4HANA 2023, SAP_BASIS 758) on 2026-08-03. See
 * docs/plans/2026-08-03-transport-diff.md §1 for the raw evidence.
 */
import { describe, expect, it } from 'vitest';
import {
  baselineStatusFor,
  classIncludesFor,
  revisionNumber,
  rollupTransportObjects,
  selectTransportRevisionPair,
} from '../../../src/adt/transport-diff.js';
import type { RevisionInfo, TransportObject } from '../../../src/adt/types.js';

const rev = (id: string, timestamp: string, transport?: string): RevisionInfo => ({
  id,
  author: 'MARIAN',
  timestamp,
  uri: `/sap/bc/adt/oo/classes/zcl_x/includes/main/versions/20260623112341/${id}/content`,
  ...(transport ? { transport } : {}),
});

/** The live a4h feed for ZCL_ARC1_DEMO_CALC, in the order ADT returned it. */
const A4H_CLASS_FEED = [
  rev('00002', '2026-06-23T11:23:41Z', 'A4HK906291'),
  rev('00000', '2026-06-23T11:22:09Z'),
  rev('00001', '2026-06-23T09:34:43Z', 'A4HK906289'),
];

const obj = (o: Partial<TransportObject>): TransportObject => ({
  pgmid: 'R3TR',
  type: 'PROG',
  name: 'Z_X',
  wbtype: '',
  description: '',
  locked: false,
  position: '000001',
  ...o,
});

describe('revisionNumber', () => {
  it('reads a bare 5-digit atom id', () => {
    expect(revisionNumber(rev('00042', '2026-01-01T00:00:00Z'))).toBe('00042');
  });

  it('falls back to the version segment of the content uri', () => {
    const r: RevisionInfo = {
      id: 'urn:sap:adt:version:7',
      author: '',
      timestamp: '2026-01-01T00:00:00Z',
      uri: '/sap/bc/adt/programs/programs/z_x/source/main/versions/20260623093443/00007/content',
    };
    expect(revisionNumber(r)).toBe('00007');
  });
});

describe('selectTransportRevisionPair', () => {
  it('picks the revision written under the transport', () => {
    const pair = selectTransportRevisionPair(A4H_CLASS_FEED, ['A4HK906291']);
    expect(pair.selectionMethod).toBe('exact-transport');
    expect(pair.current?.id).toBe('00002');
  });

  it('skips the active work state when walking back (live a4h feed order 00002, 00000, 00001)', () => {
    const pair = selectTransportRevisionPair(A4H_CLASS_FEED, ['A4HK906291']);
    expect(pair.previous?.id).toBe('00001');
    expect(pair.skipped).toHaveLength(1);
    expect(pair.skipped[0].revision.id).toBe('00000');
    expect(pair.skipped[0].reason).toMatch(/active work state/);
  });

  it('never selects the active revision as current when a real snapshot exists', () => {
    const pair = selectTransportRevisionPair(A4H_CLASS_FEED, ['SOMETHING_ELSE']);
    expect(pair.selectionMethod).toBe('latest-revision-fallback');
    expect(pair.current?.id).toBe('00002');
  });

  it('reports active-only-fallback when the feed holds nothing but the work state', () => {
    const pair = selectTransportRevisionPair([rev('00000', '2026-04-18T18:42:16Z')], ['A4HK906291']);
    expect(pair.selectionMethod).toBe('active-only-fallback');
    expect(pair.current?.id).toBe('00000');
    expect(pair.previous).toBeNull();
  });

  it('handles an empty feed', () => {
    const pair = selectTransportRevisionPair([], ['A4HK906291']);
    expect(pair).toMatchObject({ current: null, previous: null, selectionMethod: 'no-revisions' });
  });

  it('accepts a predecessor with a blank transport (VRSD rows with no korrnum exist)', () => {
    const feed = [
      rev('00002', '2026-06-23T11:23:41Z', 'A4HK906291'),
      rev('00001', '2026-06-01T09:00:00Z'), // released, but no CTS id recorded
    ];
    const pair = selectTransportRevisionPair(feed, ['A4HK906291']);
    expect(pair.previous?.id).toBe('00001');
    expect(pair.skipped).toHaveLength(0);
  });

  it('skips same-transport siblings so two saves still diff against the pre-transport state', () => {
    const feed = [
      rev('00003', '2026-06-23T12:00:00Z', 'A4HK906291'),
      rev('00002', '2026-06-23T11:00:00Z', 'A4HK906291'),
      rev('00001', '2026-06-01T09:00:00Z', 'A4HK906289'),
    ];
    const pair = selectTransportRevisionPair(feed, ['A4HK906291']);
    expect(pair.current?.id).toBe('00003');
    expect(pair.previous?.id).toBe('00001');
    expect(pair.skipped.map((s) => s.revision.id)).toEqual(['00002']);
    expect(pair.skipped[0].reason).toMatch(/same transport/);
  });

  it('breaks equal timestamps on the version number, not feed order', () => {
    const ts = '2026-06-23T11:00:00Z';
    const feed = [rev('00001', ts, 'A4HK906289'), rev('00003', ts, 'A4HK906291'), rev('00002', ts, 'A4HK906289')];
    const pair = selectTransportRevisionPair(feed, ['A4HK906291']);
    expect(pair.current?.id).toBe('00003');
    expect(pair.previous?.id).toBe('00002');
  });

  it('sorts a revision with no timestamp as oldest, never ahead of a dated one', () => {
    // Live shape (CERTRULE_DYNP on a4h): version 00001 carries no <atom:updated> at all.
    // Comparing it on the version number would make it outrank the newer, dated 00002.
    const feed = [
      rev('00000', '2026-03-28T19:43:17Z', 'A4HK900110'),
      rev('00002', '2026-03-28T19:42:52Z', 'A4HK900111'),
      { id: '00001', author: '', timestamp: '', uri: '/sap/bc/adt/x/versions/1/00001/content' } as RevisionInfo,
    ];
    const pair = selectTransportRevisionPair(feed, ['A4HK900110']);
    expect(pair.current?.id).toBe('00000');
    expect(pair.previous?.id).toBe('00002');
  });

  it('is order-independent for the undated case', () => {
    const undated = { id: '00001', author: '', timestamp: '', uri: '/sap/bc/adt/x/versions/1/00001/content' };
    const a = rev('00000', '2026-03-28T19:43:17Z', 'A4HK900110');
    const b = rev('00002', '2026-03-28T19:42:52Z', 'A4HK900111');
    for (const feed of [
      [a, b, undated],
      [undated, a, b],
      [b, undated, a],
    ] as RevisionInfo[][]) {
      expect(selectTransportRevisionPair(feed, ['A4HK900110']).previous?.id).toBe('00002');
    }
  });

  it('never uses an inactive draft (99999) as the baseline', () => {
    // Live: a CDS view created but not yet activated has only a 99999 entry. SAP maps 99999 to
    // "Inactive" and 00000 to "Active" — either can be the current side, neither is a baseline.
    const feed = [
      rev('99999', '2026-08-03T21:35:57Z', 'A4HK906370'),
      rev('00000', '2026-08-03T21:30:00Z', 'A4HK906370'),
      rev('00004', '2026-07-01T09:00:00Z', 'A4HK906111'),
    ];
    const pair = selectTransportRevisionPair(feed, ['A4HK906370']);
    expect(pair.current?.id).toBe('99999');
    expect(pair.previous?.id).toBe('00004');
    expect(pair.skipped.map((s) => s.revision.id)).toEqual(['00000']);
  });

  it('does not fall back onto an inactive draft when no revision names the transport', () => {
    const feed = [rev('99999', '2026-08-03T21:35:57Z'), rev('00003', '2026-07-01T09:00:00Z', 'A4HK906111')];
    const pair = selectTransportRevisionPair(feed, ['A4HK909999']);
    expect(pair.selectionMethod).toBe('latest-revision-fallback');
    expect(pair.current?.id).toBe('00003');
  });

  it('matches a task id as well as the request id', () => {
    const feed = [rev('00002', '2026-06-23T11:23:41Z', 'A4HK906292'), rev('00001', '2026-06-01T09:00:00Z')];
    const pair = selectTransportRevisionPair(feed, ['A4HK906291', 'A4HK906292']);
    expect(pair.selectionMethod).toBe('exact-transport');
    expect(pair.current?.id).toBe('00002');
  });

  it('ignores a blank transport id on the current side when matching', () => {
    const pair = selectTransportRevisionPair([rev('00001', '2026-06-01T09:00:00Z')], ['']);
    expect(pair.selectionMethod).toBe('latest-revision-fallback');
  });
});

describe('baselineStatusFor', () => {
  it('reports a real diff', () => {
    expect(baselineStatusFor(selectTransportRevisionPair(A4H_CLASS_FEED, ['A4HK906291']))).toBe('prior-revision');
  });

  it('confirms creation only when the current revision was matched to the transport', () => {
    const feed = [rev('00001', '2026-06-23T09:34:43Z', 'A4HK906289'), rev('00000', '2026-06-23T09:34:04Z')];
    expect(baselineStatusFor(selectTransportRevisionPair(feed, ['A4HK906289']))).toBe('no-prior-snapshot');
  });

  it('calls a missing baseline ambiguous when the current revision was only guessed', () => {
    const feed = [rev('00001', '2026-06-23T09:34:43Z', 'A4HK900001'), rev('00000', '2026-06-23T09:34:04Z')];
    expect(baselineStatusFor(selectTransportRevisionPair(feed, ['A4HK906289']))).toBe('baseline-ambiguous');
  });

  it('reports baseline-unavailable for an empty feed', () => {
    expect(baselineStatusFor(selectTransportRevisionPair([], ['A4HK906289']))).toBe('baseline-unavailable');
  });
});

describe('rollupTransportObjects', () => {
  it('drops CORR release-comment entries', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'CORR', type: 'RELE', name: 'A4HK906292 20260623 112341 MARIAN' })] },
    ]);
    expect(out).toHaveLength(0);
  });

  it('rolls a space-padded LIMU METH entry up to its class', () => {
    const out = rollupTransportObjects([
      {
        id: 'A4HK906292',
        objects: [
          obj({ pgmid: 'LIMU', type: 'METH', name: 'ZCL_ARC1_DEMO_CALC            SUBTRACT', wbtype: 'CLAS/OM' }),
        ],
      },
    ]);
    expect(out).toEqual([
      expect.objectContaining({ pgmid: 'R3TR', type: 'CLAS', name: 'ZCL_ARC1_DEMO_CALC', taskIds: ['A4HK906292'] }),
    ]);
  });

  it('rolls an =-padded LIMU CINC entry up to its class', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'CINC', name: 'ZCL_ARC1_DEMO_CALC============CCIMP' })] },
    ]);
    expect(out[0]).toMatchObject({ type: 'CLAS', name: 'ZCL_ARC1_DEMO_CALC' });
  });

  it('rolls the class pool report up to its class', () => {
    const out = rollupTransportObjects([
      {
        id: 'T1',
        objects: [obj({ pgmid: 'LIMU', type: 'REPT', name: 'ZCL_ARC1_DEMO_CALC============CP', wbtype: 'CLAS/OC' })],
      },
    ]);
    expect(out[0]).toMatchObject({ type: 'CLAS', name: 'ZCL_ARC1_DEMO_CALC' });
  });

  it('rolls a LIMU REPS entry up to its program', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPS', name: 'Z_REPORT' })] },
    ]);
    expect(out[0]).toMatchObject({ pgmid: 'R3TR', type: 'PROG', name: 'Z_REPORT' });
  });

  it('collapses the same object across two tasks and keeps both task ids', () => {
    const method = obj({ pgmid: 'LIMU', type: 'METH', name: 'ZCL_X                         ADD', wbtype: 'CLAS/OM' });
    const out = rollupTransportObjects([
      { id: 'T1', objects: [method] },
      { id: 'T2', objects: [method] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].taskIds).toEqual(['T1', 'T2']);
    expect(out[0].components).toHaveLength(2);
  });

  it('passes R3TR objects through untouched', () => {
    const out = rollupTransportObjects([{ id: 'T1', objects: [obj({ type: 'DDLS', name: 'Z_VIEW' })] }]);
    expect(out[0]).toMatchObject({ pgmid: 'R3TR', type: 'DDLS', name: 'Z_VIEW' });
  });

  it('skips entries with no usable name', () => {
    expect(rollupTransportObjects([{ id: 'T1', objects: [obj({ name: '' })] }])).toHaveLength(0);
  });
});

describe('rollup — REPT is ambiguous between class pool and program text pool', () => {
  it('keeps a program text pool on the program (not a phantom class)', () => {
    const out = rollupTransportObjects([
      {
        id: 'T1',
        objects: [
          obj({ pgmid: 'LIMU', type: 'REPS', name: 'ZARC1_DEMO_REPORT', wbtype: 'PROG/P' }),
          obj({ pgmid: 'LIMU', type: 'REPT', name: 'ZARC1_DEMO_REPORT', wbtype: 'PROG/P' }),
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pgmid: 'R3TR', type: 'PROG', name: 'ZARC1_DEMO_REPORT' });
  });

  it('still rolls the =-padded class pool report up to its class', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPT', name: 'ZCL_X============CP', wbtype: 'CLAS/OC' })] },
    ]);
    expect(out[0]).toMatchObject({ type: 'CLAS', name: 'ZCL_X' });
  });

  it('rolls a =-padded REPT up to its class even without a CLAS wbtype', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPT', name: 'ZCL_X============CP', wbtype: '' })] },
    ]);
    expect(out[0]).toMatchObject({ type: 'CLAS', name: 'ZCL_X' });
  });
});

describe('rollup — includes are not programs', () => {
  it('types a LIMU REPS include as INCL, so its revisions resolve', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPS', name: 'LZFOOU01', wbtype: 'PROG/I' })] },
    ]);
    expect(out[0]).toMatchObject({ pgmid: 'R3TR', type: 'INCL', name: 'LZFOOU01' });
  });

  it('types an R3TR PROG entry with wbtype PROG/I as INCL', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'R3TR', type: 'PROG', name: 'Z_INCLUDE', wbtype: 'PROG/I' })] },
    ]);
    expect(out[0]).toMatchObject({ type: 'INCL', name: 'Z_INCLUDE' });
  });

  it('leaves a real program as PROG', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'R3TR', type: 'PROG', name: 'Z_REPORT', wbtype: 'PROG/P' })] },
    ]);
    expect(out[0]).toMatchObject({ type: 'PROG', name: 'Z_REPORT' });
  });
});

describe('classIncludesFor — the transport states which includes it touched', () => {
  /** Real CTS shape: the class name is padded into a 30-char field with '=', then the suffix. */
  const cinc = (clas: string, suffix: string) => `${clas.padEnd(30, '=')}${suffix}`;
  /** Real CTS shape for a method: class name padded to 30 with SPACES, then the method. */
  const meth = (clas: string, method: string) => `${clas.padEnd(30, ' ')}${method}`;
  const clas = (components: Array<{ pgmid: string; type: string; name: string; wbtype: string }>) => ({
    pgmid: 'R3TR',
    type: 'CLAS',
    name: 'ZCL_X',
    description: '',
    taskIds: ['T1'],
    components: components.map((c) => ({ ...c, taskId: 'T1' })),
  });

  it('diffs only the implementations include for a CCIMP entry', () => {
    const selection = classIncludesFor(
      clas([{ pgmid: 'LIMU', type: 'CINC', name: cinc('ZCL_X', 'CCIMP'), wbtype: '' }]),
    );
    expect(selection.includes).toEqual(['implementations']);
    // Derived from CTS, so every selected part really was changed — suppression must not apply.
    expect(selection.fromComponents).toBe(true);
  });

  it('maps each class-pool suffix to its include', () => {
    const selection = classIncludesFor(
      clas([
        { pgmid: 'LIMU', type: 'CINC', name: cinc('ZCL_X', 'CCDEF'), wbtype: '' },
        { pgmid: 'LIMU', type: 'CINC', name: cinc('ZCL_X', 'CCAU'), wbtype: '' },
        { pgmid: 'LIMU', type: 'CINC', name: cinc('ZCL_X', 'CCMAC'), wbtype: '' },
      ]),
    );
    expect(selection.includes.sort()).toEqual(['definitions', 'macros', 'testclasses']);
    expect(selection.fromComponents).toBe(true);
  });

  it('maps a method to the main source', () => {
    expect(
      classIncludesFor(
        clas([{ pgmid: 'LIMU', type: 'METH', name: 'ZCL_X                         ADD', wbtype: 'CLAS/OM' }]),
      ).includes,
    ).toEqual(['main']);
  });

  it('resolves the include for a 30-char class name, which CTS does NOT pad', () => {
    // 6.6% of live CINC rows: the class name fills the whole 30-char field, so there is no
    // '=' at all and splitting on it silently resolved the include to `main`.
    const name = 'ZCL_ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // exactly 30 chars
    expect(name).toHaveLength(30);
    expect(
      classIncludesFor(clas([{ pgmid: 'LIMU', type: 'CINC', name: `${name}CCIMP`, wbtype: '' }])).includes,
    ).toEqual(['implementations']);
  });

  it('resolves a namespaced class include', () => {
    expect(
      classIncludesFor(clas([{ pgmid: 'LIMU', type: 'CINC', name: cinc('/NS/ZCL_X', 'CCAU'), wbtype: '' }])).includes,
    ).toEqual(['testclasses']);
  });

  it('falls back to all five when the transport carries a whole-class entry', () => {
    expect(
      classIncludesFor(clas([{ pgmid: 'R3TR', type: 'CLAS', name: 'ZCL_X', wbtype: 'CLAS/OC' }])).includes,
    ).toEqual(['main', 'definitions', 'implementations', 'macros', 'testclasses']);
  });

  it('covers both when a class carries a method and a local-class include', () => {
    const selection = classIncludesFor(
      clas([
        { pgmid: 'LIMU', type: 'METH', name: meth('ZCL_X', 'ADD'), wbtype: 'CLAS/OM' },
        { pgmid: 'LIMU', type: 'CINC', name: cinc('ZCL_X', 'CCIMP'), wbtype: '' },
      ]),
    );
    expect(selection.includes.sort()).toEqual(['implementations', 'main']);
    expect(selection.fromComponents).toBe(true);
  });
});

describe('baselineStatusFor — evidence level is visible', () => {
  it('marks a predecessor found under a fallback selection as unverified', () => {
    const feed = [
      rev('00003', '2026-06-23T12:00:00Z', 'A4HK900001'),
      rev('00002', '2026-06-01T09:00:00Z', 'A4HK900000'),
    ];
    const pair = selectTransportRevisionPair(feed, ['A4HK906291']);
    expect(pair.selectionMethod).toBe('latest-revision-fallback');
    expect(baselineStatusFor(pair)).toBe('prior-revision-unverified');
  });
});

describe('rollup — function-group sources are inventory, not programs', () => {
  it('does not route a FUGR/I include to the program endpoint', () => {
    // Live-verified wbtype (7.50 + 7.58). /programs/programs/LZ..U01 404s, so typing it PROG
    // produced a baseline-unavailable row for every FUGR include in every FUGR transport.
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPS', name: 'LZARC1_FGU01', wbtype: 'FUGR/I' })] },
    ]);
    expect(out[0].type).not.toBe('PROG');
    expect(out[0].type).not.toBe('INCL');
  });

  it('also captures the FUGR main program shape', () => {
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPS', name: 'SAPLZARC1_FG', wbtype: 'FUGR/PX' })] },
    ]);
    expect(out[0].type).not.toBe('PROG');
  });
});

describe('baselineStatusFor — creation needs positive evidence', () => {
  const feedWithOlder = [
    rev('00003', '2026-06-23T12:00:00Z', 'A4HK906291'),
    rev('00001', '2026-01-01T09:00:00Z', 'A4HK900001'),
  ];

  it('does not claim creation when an older revision exists but was not reached', () => {
    // Simulates the undated-current shape: the pair walk finds no predecessor, but the feed
    // plainly holds an older version, so the object cannot have been created here.
    const pair = {
      current: feedWithOlder[0],
      previous: null,
      selectionMethod: 'exact-transport' as const,
      skipped: [],
    };
    expect(baselineStatusFor(pair, feedWithOlder)).toBe('baseline-ambiguous');
  });

  it('still reports creation when nothing older exists', () => {
    const feed = [rev('00001', '2026-06-23T09:34:43Z', 'A4HK906289'), rev('00000', '2026-06-23T09:34:04Z')];
    expect(baselineStatusFor(selectTransportRevisionPair(feed, ['A4HK906289']), feed)).toBe('no-prior-snapshot');
  });

  it('ignores work-state rows when looking for something older', () => {
    const feed = [rev('00001', '2026-06-23T09:34:43Z', 'A4HK906289'), rev('00000', '2026-06-23T09:34:04Z')];
    const pair = { current: feed[0], previous: null, selectionMethod: 'exact-transport' as const, skipped: [] };
    expect(baselineStatusFor(pair, feed)).toBe('no-prior-snapshot');
  });
});

describe('rollup — FUGR/FF is a function module, not function-group source', () => {
  it('keeps LIMU FUNC on the supported FUNC path', () => {
    // SLASH_TYPE_MAP maps FUGR/FF -> FUNC ("a function module, not the function group").
    // Matching the bare FUGR/ prefix would send every changed function module to inventory.
    const out = rollupTransportObjects([
      { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'FUNC', name: 'Z_ARC1_FM', wbtype: 'FUGR/FF' })] },
    ]);
    expect(out[0]).toMatchObject({ type: 'FUNC', name: 'Z_ARC1_FM' });
  });

  it('still treats the group container and its includes as inventory', () => {
    for (const wbtype of ['FUGR/I', 'FUGR/PX', 'FUGR/F']) {
      const out = rollupTransportObjects([
        { id: 'T1', objects: [obj({ pgmid: 'LIMU', type: 'REPS', name: 'LZFGU01', wbtype })] },
      ]);
      expect(out[0].type).not.toBe('PROG');
      expect(out[0].type).not.toBe('INCL');
      expect(out[0].type).not.toBe('FUNC');
    }
  });
});
