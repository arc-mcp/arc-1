import { describe, expect, it } from 'vitest';
import { classifyToolErrorSkip } from '../../e2e/helpers.js';

describe('E2E helper skip classification', () => {
  it.each([
    [
      'DDIC table UNLOCK',
      'ADT API error: status 400 at /sap/bc/adt/ddic/tables/ZTABINFPWSSEOCBK?_action=UNLOCK&lockHandle=ABC123: Service cannot be reached',
    ],
    [
      'package LOCK',
      'ADT API error: status 400 at /sap/bc/adt/packages/%24ARC1T_INSMNJCNKZELA?_action=LOCK&accessMode=MODIFY: Service cannot be reached',
    ],
    [
      'message class LOCK',
      'ADT API error: status 400 at /sap/bc/adt/messageclass/ZARC1MCINSMNJJSVBMUT?_action=LOCK&accessMode=MODIFY: Service cannot be reached',
    ],
    [
      'program UNLOCK',
      'ADT API error: status 400 at /sap/bc/adt/programs/programs/ZARC1_E2E_WRITE?_action=UNLOCK&lockHandle=ABC123: Service cannot be reached',
    ],
    [
      'DDLS UNLOCK',
      'ADT API error: status 400 at /sap/bc/adt/ddic/ddl/sources/ZARC1SKTDMQ265IXA171U?_action=UNLOCK&lockHandle=ABC123: Service cannot be reached',
    ],
    [
      'unrelated unlock',
      'ADT API error: status 400 at /sap/bc/adt/packages/ZPKG?_action=UNLOCK&lockHandle=ABC123: Authorization failed',
    ],
    [
      'non-session source read',
      'ADT API error: status 400 at /sap/bc/adt/programs/programs/ZFOO/source/main: Service cannot be reached',
    ],
  ])('keeps %s errors visible', (_label, text) => {
    const result = {
      isError: true,
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };

    const reason = classifyToolErrorSkip(result);
    expect(reason).toBeNull();
  });
});

// Match the server's explicit discovery refusals, not arbitrary failures at similar paths.
import {
  DEVC_WRITE_UNAVAILABLE_HINT,
  DOMA_WRITE_UNAVAILABLE_HINT,
  TABL_DT_WRITE_UNAVAILABLE_HINT,
} from '../../../src/handlers/write-helpers.js';

it.each([DOMA_WRITE_UNAVAILABLE_HINT, TABL_DT_WRITE_UNAVAILABLE_HINT, DEVC_WRITE_UNAVAILABLE_HINT])(
  'recognizes an explicit pre-write capability refusal: %s',
  (text) => {
    expect(classifyToolErrorSkip({ isError: true, content: [{ type: 'text', text }] })).toMatch(
      /^Backend feature not supported/,
    );
    expect(classifyToolErrorSkip({ content: [{ type: 'text', text }] })).toBeNull();
  },
);

it.each([
  'ADT API error: status 403 at /sap/bc/adt/ddic/domains: Not authorized',
  'ADT API error: status 500 at /sap/bc/adt/ddic/tables: Internal server error',
  'Network timeout at /sap/bc/adt/packages',
  'ADT API error: status 404 at /sap/bc/adt/ddic/tables/Z_MISSING: Object missing',
  'ADT API error: status 404 at /sap/bc/adt/ddic/tables/Z_MISSING: Z_MISSING does not exist',
  'ADT API error: status 404 at /sap/bc/adt/ddic/domains/Z_MISSING: Z_MISSING does not exist',
  'ADT API error: status 404 at /sap/bc/adt/packages/Z_MISSING: Z_MISSING does not exist',
])('does not infer an absent collection from: %s', (text) => {
  expect(classifyToolErrorSkip({ isError: true, content: [{ type: 'text', text }] })).toBeNull();
});

it('only skips batch preflight when every failure is an explicit collection refusal and nothing was attempted', () => {
  const domain = { status: 'failed', creation: 'not_attempted', error: DOMA_WRITE_UNAVAILABLE_HINT };
  const skipped = { status: 'skipped', creation: 'not_attempted' };
  const classify = (phase: string, results: unknown[]) =>
    classifyToolErrorSkip({
      isError: true,
      content: [
        { type: 'text', text: 'Batch preflight rejected entries; no objects were created' },
        { type: 'text', text: JSON.stringify({ batch: { phase, results } }) },
      ],
    });
  expect(classify('preflight', [domain, skipped])).toMatch(/batch fixture requires/);
  expect(classify('preflight', [domain, { ...domain, error: 'Not authorized' }])).toBeNull();
  expect(classify('execution', [domain, skipped])).toBeNull();
  expect(classify('preflight', [domain, { ...skipped, creation: 'unknown' }])).toBeNull();
  expect(classify('preflight', [skipped])).toBeNull();
});

import { batchCreateResult, batchEntryResult, failBatchEntry } from '../../../src/handlers/write/batch-results.js';

it('does not let a rejected batch manifest fall through to legacy summary matching', () => {
  const domain = batchEntryResult(0, 'DOMA', 'ZDOMAIN', '$TMP');
  failBatchEntry(domain, 'preflight', DOMA_WRITE_UNAVAILABLE_HINT);
  const dtel = batchEntryResult(1, 'DTEL', 'ZDTEL', '$TMP');
  failBatchEntry(dtel, 'preflight', 'Data element ZDTEL does not exist');
  expect(
    classifyToolErrorSkip(
      batchCreateResult([domain, dtel], {
        preflight: true,
        activateAtEnd: false,
        warnings: [],
      }),
    ),
  ).toBeNull();

  failBatchEntry(dtel, 'create', 'Not authorized');
  expect(
    classifyToolErrorSkip(
      batchCreateResult([dtel], {
        activateAtEnd: false,
        warnings: [],
      }),
    ),
  ).toBeNull();
});
