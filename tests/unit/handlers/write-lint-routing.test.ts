import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { runPreWriteLint } = await import('../../../src/handlers/write-helpers.js');

const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, abapRelease: '758', lintBeforeWrite: true };
const modulePool = 'INCLUDE ztop.\nMODULE status_0100 OUTPUT.\nENDMODULE.';
const localClassProgram = `CLASS lcl_x DEFINITION.
ENDCLASS.
CLASS lcl_x IMPLEMENTATION.
ENDCLASS.
START-OF-SELECTION.
WRITE / 1.`;
const localInterfaceInclude = 'INTERFACE lif_x.\nENDINTERFACE.\nDATA lv TYPE i.';
const cds = '/* header */\ndefine view entity Z_TEST as select from ztable { key f1, f2 }';
const invalidCds = cds.replace('f1, f2', 'f1 f2');

describe('pre-write lint uses the supplied object type', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
  });

  it.each([
    ['PROG', modulePool],
    ['PROG', localClassProgram],
    ['INCL', localInterfaceInclude],
    ['INCL', 'DATA lv TYPE i.\nFORM run.\nlv = 1.\nENDFORM.'],
    ['INCL', 'MODULE status_0100 OUTPUT.\nENDMODULE.'],
    ['INCL', 'FUNCTION-POOL zfg.'],
    ['INCL', 'FUNCTION z_func.\nENDFUNCTION.'],
    ['CLAS', '* header\nCLASS z_test DEFINITION PUBLIC.\nENDCLASS.\nCLASS z_test IMPLEMENTATION.\nENDCLASS.'],
    ['INTF', '"! header\nINTERFACE z_test PUBLIC.\nMETHODS run.\nENDINTERFACE.'],
  ])('accepts valid %s source: %s', (type, source) => {
    expect(runPreWriteLint(source, type, 'Z_TEST', config)).toEqual({ blocked: false });
  });

  it.each([
    ['PROG', `${modulePool}\nINVALID SYNTAX HERE.`, 'parser_error'],
    ['INCL', 'FORM run.\nINVALID SYNTAX HERE.\nENDFORM.', 'parser_error'],
    ['INCL', 'FUNCTION-POOL zfg.\nINVALID SYNTAX HERE.', 'parser_error'],
    ['INCL', 'FUNCTION z_func.\nINVALID SYNTAX HERE.\nENDFUNCTION.', 'parser_error'],
    ['CLAS', 'CLASS z_test DEFINITION PUBLIC.\nINVALID SYNTAX HERE.\nENDCLASS.', 'parser_error'],
    ['INTF', 'INTERFACE z_test PUBLIC.\nINVALID SYNTAX HERE.\nENDINTERFACE.', 'parser_error'],
    ['CLAS', 'REPORT z_test.\nWRITE / 1.', 'Expected CLASSDEFINITION'],
    ['INTF', 'CLASS z_test DEFINITION PUBLIC.\nENDCLASS.', 'Expected INTERFACE'],
    ['DDLS', invalidCds, 'cds_parser_error'],
  ])('rejects invalid %s source with %s', (type, source, finding) => {
    const lint = runPreWriteLint(source, type, 'Z_TEST', config);
    expect(lint.blocked).toBe(true);
    expect(lint.result?.content[0]?.text).toContain(finding);
    expect(lint.result?.content[0]?.text).toContain('"v758"');
  });

  it.each(['TABL', 'BDEF', 'DDLX', 'SRVD', 'FUNC', 'UNKNOWN', '', 'constructor', 'toString', '__proto__'])(
    'continues to skip unsupported type %s even with malformed source',
    (type) => {
      expect(runPreWriteLint('INVALID SYNTAX HERE.', type, 'Z_TEST', config)).toEqual({ blocked: false });
    },
  );

  it('preserves the explicit lint override', () => {
    expect(runPreWriteLint(invalidCds, 'DDLS', 'Z_TEST', config, false)).toEqual({ blocked: false });
    expect(runPreWriteLint(invalidCds, 'DDLS', 'Z_TEST', { ...config, lintBeforeWrite: false }, true).blocked).toBe(
      true,
    );
  });

  it('keeps source-based function signatures unsupported in INCL, as with the old FUGR parser selection', () => {
    const source = 'FUNCTION z_func\n  IMPORTING\n    VALUE(iv_value) TYPE i\n.\nENDFUNCTION.';
    const lint = runPreWriteLint(source, 'INCL', 'Z_TEST', config);
    expect(lint.blocked).toBe(true);
    expect(lint.result?.content[0]?.text).toContain('parser_error');
  });

  it.each([
    cds,
    '-- header\ndefine abstract entity Z_TEST { f1 : abap.char(10); }',
    '// header\ndefine custom entity Z_TEST { key f1 : abap.char(10); }',
    'define table function Z_TEST returns { key f1 : abap.char(10); } implemented by method zcl_x=>m;',
  ])('lints valid DDLS as CDS: %s', (source) => {
    expect(runPreWriteLint(source, 'DDLS', 'Z_TEST', config)).toEqual({ blocked: false });
    const broken = source.replace('f1', 'f1 INVALID');
    const lint = runPreWriteLint(broken, 'DDLS', 'Z_TEST', config);
    expect(lint.blocked).toBe(true);
    expect(lint.result?.content[0]?.text).toContain('cds_parser_error');
    expect(lint.result?.content[0]?.text).not.toContain('CLASSDEFINITION');
  });

  it.each(['create', 'batch_create', 'update'])(
    'rejects invalid DDLS during %s before any mutation',
    async (action) => {
      const object = { type: 'DDLS', name: 'Z_TEST', package: '$TMP', source: invalidCds };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action,
        ...(action === 'batch_create' ? { objects: [object] } : object),
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('cds_parser_error');
      expect(mockFetch.mock.calls.filter(([, opts]) => ['POST', 'PUT', 'DELETE'].includes(opts?.method))).toEqual([]);
    },
  );

  it.each(['create', 'batch_create', 'update'])('writes INCLUDE-led PROG source during %s', async (action) => {
    mockFetch.mockImplementation((url: string | URL) => {
      if (String(url).includes('_action=LOCK')) {
        return Promise.resolve(
          mockResponse(200, '<asx:values><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
            'x-csrf-token': 'T',
          }),
        );
      }
      return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
    });
    const object = { type: 'PROG', name: 'Z_TEST', package: '$TMP', source: modulePool };
    const result = await handleToolCall(createClient(), config, 'SAPWrite', {
      action,
      ...(action === 'batch_create' ? { objects: [object] } : object),
    });
    expect(result.isError).toBeFalsy();
    const writes = mockFetch.mock.calls
      .filter(([, opts]) => opts?.method === 'PUT')
      .map(([url, opts]) => ({ path: new URL(String(url)).pathname, source: opts.body }));
    expect(writes).toContainEqual({ path: '/sap/bc/adt/programs/programs/Z_TEST/source/main', source: modulePool });
  });

  it('normalizes batch aliases and rejects a bad second item before creating the valid first item', async () => {
    const result = await handleToolCall(createClient(), config, 'SAPWrite', {
      action: 'batch_create',
      objects: [
        { type: 'PROG/P', name: 'Z_TEST', package: '$TMP', source: modulePool },
        { type: 'DDLS/DF', name: 'Z_BAD', package: '$TMP', source: invalidCds.replace('Z_TEST', 'Z_BAD') },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('cds_parser_error');
    expect(result.content[0]?.text).not.toContain('CLASSDEFINITION');
    expect(mockFetch.mock.calls.filter(([, opts]) => ['POST', 'PUT', 'DELETE'].includes(opts?.method))).toEqual([]);
  });
});
