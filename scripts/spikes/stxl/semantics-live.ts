/** Disposable, opt-in SAP semantic oracles. Captures stay private; no RFC or deployed helper. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withStoredTextSession } from './adt-text-source.js';
import { decodeStxl } from './decoder.js';
import { TextReadError } from './errors.js';
import { liveContext, oracleJson } from './live-client.js';
import { assembleChunks, type TextKey } from './reader.js';
import { readClassicText, readClassicTextBatch } from './stored-text.js';

const context = liveContext();
if (process.env.STXL_ALLOW_HELPERS !== 'true') throw new Error('Disposable helpers require explicit opt-in');
if (!['758', '816'].includes(context.label)) throw new Error('This semantic probe is qualified only for 758/816');
await mkdir(context.output, { recursive: true, mode: 0o700 });
await chmod(context.output, 0o700);
const prefix = `ZARC1S${randomUUID().replaceAll('-', '').toUpperCase()}`;
async function save(name: string, value: unknown) {
  await context.save(`${prefix}-${name}`, value);
  await context.save(name, value);
}
const helpers: Array<{ name: string; state: string }> = [];
async function oracle(source: string) {
  try {
    return await context.oracle(source);
  } finally {
    const lifecycle = JSON.parse(
      await readFile(resolve(context.output, `${context.label}-helper-lifecycle.json`), 'utf8'),
    ) as { name: string; state: string };
    if (!helpers.some((entry) => entry.name === lifecycle.name)) helpers.push(lifecycle);
    await save('semantics-helpers.json', helpers);
  }
}
const definitions = [
  ['normal-en', 'NORMAL', 'E', 0, 2],
  ['normal-de', 'NORMAL', 'D', 0, 1],
  ['blank-line', 'BLANK', 'E', 0, 1],
  ['empty-cluster', 'EMPTY', 'E', 0, 0],
  ['header-only', 'HEADER', 'E', 0, 0],
  ['reference-one', 'REF1', 'E', 0, 2],
  ['reference-two', 'REF2', 'E', 0, 2],
  ['broken-reference', 'BROKEN', 'E', 6, 0],
  ['deleted-target', 'BROKENTARGET', 'E', 4, 0],
  ['non-itf', 'NONITF', 'E', 0, -1],
  ['empty-save', 'ZEROSAVE', 'E', 4, 0],
  ['missing-key', 'MISSING', 'E', 4, 0],
  ['missing-language', 'NORMAL', 'F', 4, 0],
] as const;
const cases = definitions.map(([id, suffix, language, status, count]) => ({
  id,
  key: { TDOBJECT: 'TEXT', TDNAME: `${prefix}_${suffix}`, TDID: 'ST', TDSPRAS: language } satisfies TextKey,
  expectedStatus: status,
  expectedCount: count,
}));
const name = (id: string) => {
  const item = cases.find((item) => item.id === id);
  assert.ok(item, 'Unknown synthetic case');
  return item.key.TDNAME;
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const wrap = (body: string) => `CLASS ZCL_ARC1_STXL_ORACLE DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION. INTERFACES if_oo_adt_classrun. ENDCLASS.
 CLASS ZCL_ARC1_STXL_ORACLE IMPLEMENTATION. METHOD if_oo_adt_classrun~main.
 ${body}
 ENDMETHOD. ENDCLASS.`;
const jsonOutput = (source: string) => `
 DATA(writer) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
 CALL TRANSFORMATION id SOURCE ${source} RESULT XML writer.
 out->write( cl_http_utility=>encode_x_base64( writer->get_output( ) ) ).`;
const keyTable = (duplicate = false) =>
  `${cases
    .map(
      ({ key }) =>
        `( tdobject = ${literal(key.TDOBJECT)} tdname = ${literal(key.TDNAME)} tdid = ${literal(key.TDID)} tdspras = ${literal(key.TDSPRAS)} )`,
    )
    .join(
      '\n',
    )}${duplicate ? `\n( tdobject = 'TEXT' tdname = '${name('normal-en')}' tdid = 'ST' tdspras = 'E' )` : ''}`;
const prefixWhere = [
  { field: 'TDOBJECT', op: '=', value: 'TEXT' },
  { field: 'TDID', op: '=', value: 'ST' },
  { field: 'TDNAME', op: 'LIKE', value: `${prefix}%` },
];
type NativeLine = { TDFORMAT: string; TDLINE: string };
type NativeCase = TextKey & {
  STATUS: number;
  HEADER: Record<string, string | number>;
  EXPECTED: NativeLine[];
  OLD_LINE_COUNT: number;
};
type BatchRow = { HEADER: Record<string, string | number>; FUNCTION: string; LINES: NativeLine[] };
const normalize = (lines: NativeLine[]) =>
  lines.map((line) => ({ format: line.TDFORMAT.replace(/ +$/u, ''), text: line.TDLINE.replace(/ +$/u, '') }));
const sameKey = (row: object, key: TextKey) =>
  Object.entries(key).every(([field, value]) => (row as Partial<TextKey>)[field as keyof TextKey] === value);
const checks: Array<{ case: string; status: string; lines?: number; nativeStatus?: number; batchRows?: number }> = [];
const summary: Record<string, string | number | boolean> = { label: context.label, status: 'running' };
await save('semantics-keys.json', { prefix, cases });
await save('semantics-lifecycle.json', { prefix, state: 'preflight' });
for (const table of ['STXH', 'STXL', 'STXB']) {
  const result = await context.client.runTableQuery(table, { columns: ['TDNAME'], where: prefixWhere, maxRows: 1 });
  assert.equal(result.rows.length, 0, 'Refusing to reuse any existing synthetic-prefix data');
}
let fixturesMayExist = false;
let failure: unknown;
try {
  fixturesMayExist = true;
  const setup = await oracle(
    wrap(`
 ASSERT cl_rstxt_persistence_manager=>is_only_default_handler_used( object = 'TEXT' id = 'ST' ) = abap_true.
 DATA header TYPE thead.
 DATA newheader TYPE thead.
 DATA text_lines TYPE tline_tab.
 TYPES: BEGIN OF ty_setup, name TYPE string, status TYPE i, END OF ty_setup.
 DATA cases TYPE STANDARD TABLE OF ty_setup WITH EMPTY KEY.
 ${[
   {
     id: 'normal-en',
     language: 'E',
     lines: `( tdformat = '*' tdline = 'Synthetic English first' ) ( tdformat = '/' tdline = 'Synthetic English second' )`,
   },
   { id: 'normal-de', language: 'D', lines: `( tdformat = '*' tdline = 'Synthetischer deutscher Text' )` },
   { id: 'blank-line', language: 'E', lines: `( tdformat = '' tdline = '' )` },
   { id: 'deleted-target', language: 'E', lines: `( tdformat = '*' tdline = 'Temporary reference target' )` },
   { id: 'empty-save', language: 'E', lines: '' },
 ]
   .map(
     ({ id, language, lines }) => `
 CLEAR header. header-mandt = sy-mandt. header-tdobject = 'TEXT'. header-tdname = '${name(id)}'.
 header-tdid = 'ST'. header-tdspras = '${language}'.
 text_lines = VALUE #( ${lines} ).
 CALL FUNCTION 'SAVE_TEXT' EXPORTING header = header insert = 'X' savemode_direct = 'X'
 TABLES lines = text_lines EXCEPTIONS OTHERS = 8.
 APPEND VALUE #( name = '${id}' status = sy-subrc ) TO cases.
 ASSERT sy-subrc = 0.`,
   )
   .join('\n')}
 CLEAR header. CLEAR text_lines.
 header-mandt = sy-mandt. header-tdobject = 'TEXT'. header-tdname = '${name('empty-cluster')}'.
 header-tdid = 'ST'. header-tdspras = 'E'.
 cl_rstxt_persistence_manager=>create( header = header text_lines = text_lines ).
 APPEND VALUE #( name = 'empty-cluster' status = 0 ) TO cases.
 DATA storage_header TYPE stxh.
 MOVE-CORRESPONDING header TO storage_header.
 storage_header-tdname = '${name('header-only')}'.
 ASSERT cl_rstx_table_view=>insert_stxh( i_stxh = storage_header i_client_specified = abap_true ) = 0.
 APPEND VALUE #( name = 'header-only' status = 0 ) TO cases.
 COMMIT WORK AND WAIT.
 ${[
   ['reference-one', 'normal-en'],
   ['reference-two', 'reference-one'],
   ['broken-reference', 'deleted-target'],
 ]
   .map(
     ([id, target]) => `
 CLEAR header. CLEAR text_lines.
 header-mandt = sy-mandt. header-tdobject = 'TEXT'. header-tdname = '${name(id)}'.
 header-tdid = 'ST'. header-tdspras = 'E'.
 CALL FUNCTION 'REFER_TEXT' EXPORTING header = header ref_object = 'TEXT' ref_name = '${name(target)}' ref_id = 'ST'
 IMPORTING newheader = newheader TABLES lines = text_lines EXCEPTIONS OTHERS = 8.
 ASSERT sy-subrc = 0.
 CALL FUNCTION 'SAVE_TEXT' EXPORTING header = newheader insert = 'X' savemode_direct = 'X'
 TABLES lines = text_lines EXCEPTIONS OTHERS = 8.
 APPEND VALUE #( name = '${id}' status = sy-subrc ) TO cases.
 ASSERT sy-subrc = 0.
 COMMIT WORK AND WAIT.`,
   )
   .join('\n')}
 CALL FUNCTION 'DELETE_TEXT' EXPORTING object = 'TEXT' name = '${name('deleted-target')}' id = 'ST'
 language = 'E' savemode_direct = 'X' EXCEPTIONS OTHERS = 8.
 ASSERT sy-subrc = 0. COMMIT WORK AND WAIT.
 CLEAR header. header-mandt = sy-mandt. header-tdobject = 'TEXT'. header-tdname = '${name('non-itf')}'.
 header-tdid = 'ST'. header-tdspras = 'E'. header-tdtexttype = 'RTF'.
 text_lines = VALUE #( ( tdformat = '*' tdline = '{\\rtf1\\ansi Synthetic RTF}' ) ).
 CALL FUNCTION 'SAVE_TEXT' EXPORTING header = header insert = 'X' savemode_direct = 'X'
 TABLES lines = text_lines EXCEPTIONS OTHERS = 8.
 APPEND VALUE #( name = 'non-itf' status = sy-subrc ) TO cases.
 COMMIT WORK AND WAIT.
 ${jsonOutput('cases = cases')}`),
  );
  const setupJson = oracleJson(setup);
  await save('semantics-setup.json', setupJson);
  await save('semantics-lifecycle.json', { prefix, state: 'created' });
  // Independent console runs ensure the read oracles cannot observe setup's text memory.
  const singleJson = oracleJson(
    await oracle(
      wrap(`
 TYPES: BEGIN OF ty_case, tdobject TYPE tdobject, tdname TYPE tdobname, tdid TYPE tdid, tdspras TYPE spras,
 status TYPE i, old_line_count TYPE thead-tdtxtlines, header TYPE thead, expected TYPE tline_tab, END OF ty_case.
 DATA cases TYPE STANDARD TABLE OF ty_case WITH EMPTY KEY.
 cases = VALUE #( ${keyTable()} ).
 LOOP AT cases ASSIGNING FIELD-SYMBOL(<item>).
 CLEAR: <item>-header, <item>-expected, <item>-old_line_count.
 CALL FUNCTION 'READ_TEXT' EXPORTING object = <item>-tdobject name = <item>-tdname id = <item>-tdid language = <item>-tdspras
 IMPORTING header = <item>-header old_line_counter = <item>-old_line_count TABLES lines = <item>-expected
 EXCEPTIONS id = 1 language = 2 name = 3 not_found = 4 object = 5 reference_check = 6 wrong_access_to_archive = 7 OTHERS = 8.
 <item>-status = sy-subrc.
 ENDLOOP.
 ${jsonOutput('cases = cases')}`),
    ),
  );
  await save('semantics-single-oracle.json', singleJson);
  const batchJson = oracleJson(
    await oracle(
      wrap(`
 DATA text_headers TYPE STANDARD TABLE OF thead WITH EMPTY KEY.
 DATA texts TYPE text_lh. DATA errors TYPE text_lh.
 text_headers = VALUE #( ${keyTable(true)} ).
 CALL FUNCTION 'READ_TEXT_TABLE' IMPORTING text_table = texts error_table = errors TABLES text_headers = text_headers
 EXCEPTIONS wrong_access_to_archive = 7 OTHERS = 8.
 DATA status TYPE i. status = sy-subrc.
 DATA cases TYPE STANDARD TABLE OF thead WITH EMPTY KEY. cases = text_headers.
 ${jsonOutput('cases = cases texts = texts errors = errors status = status')}`),
    ),
  );
  await save('semantics-batch-oracle.json', batchJson);
  const single = JSON.parse(singleJson) as { CASES: NativeCase[] };
  const batch = JSON.parse(batchJson) as { TEXTS: BatchRow[]; ERRORS: BatchRow[]; STATUS: number };
  assert.equal(batch.STATUS, 0, 'Batch function itself failed');
  const capture: Record<string, Record<string, string>[]> = {};
  for (const table of ['STXH', 'STXL', 'STXB']) {
    const result = await context.client.runTableQuery(table, {
      columns:
        table === 'STXH'
          ? [
              'MANDT',
              'TDOBJECT',
              'TDNAME',
              'TDID',
              'TDSPRAS',
              'TDTXTLINES',
              'TDREF',
              'TDREFOBJ',
              'TDREFNAME',
              'TDREFID',
              'TDTEXTTYPE',
              'TDVERSION',
              'TDLDATE',
              'TDLTIME',
            ]
          : [
              'MANDT',
              'RELID',
              'TDOBJECT',
              'TDNAME',
              'TDID',
              'TDSPRAS',
              table === 'STXB' ? 'STRF2' : 'SRTF2',
              'CLUSTR',
              'CLUSTD',
            ],
      where: prefixWhere,
      maxRows: 64,
    });
    assert.ok(result.rows.length < 64, 'Synthetic capture exceeded its bounded row budget');
    for (const row of result.rows)
      assert.ok(
        cases.some(({ key }) => sameKey(row, key)),
        'Unexpected synthetic key',
      );
    capture[table] = result.rows;
  }
  await save('semantics-storage.json', capture);
  const setupCases = JSON.parse(setupJson).CASES as Array<{ NAME: string; STATUS: number }>;
  const nonItfAccepted = setupCases.find((item) => item.NAME === 'non-itf')?.STATUS === 0;
  for (const item of cases) {
    const native = single.CASES.find((row) => sameKey(row, item.key));
    assert.ok(native, 'Single oracle omitted a requested key');
    if (item.id === 'non-itf' && !nonItfAccepted) {
      checks.push({ case: item.id, status: 'setup-rejected', nativeStatus: native.STATUS });
      continue;
    }
    assert.equal(native.STATUS, item.expectedStatus, `Unexpected native outcome for ${item.id}`);
    const successes = batch.TEXTS.filter((row) => sameKey(row.HEADER, item.key));
    const errors = batch.ERRORS.filter((row) => sameKey(row.HEADER, item.key));
    if (native.STATUS === 0) {
      assert.ok(successes.length > 0, `Batch omitted successful ${item.id}`);
      assert.equal(errors.length, 0, `Batch also reported error for ${item.id}`);
      for (const row of successes) assert.deepEqual(normalize(row.LINES), normalize(native.EXPECTED));
      if (item.expectedCount >= 0) assert.equal(native.EXPECTED.length, item.expectedCount, item.id);
      if (!['reference-one', 'reference-two', 'non-itf', 'header-only'].includes(item.id)) {
        const rows = capture.STXL.filter((row) => sameKey(row, item.key));
        assert.ok(rows.length > 0, `Expected physical cluster for ${item.id}`);
        const bytes = assembleChunks(rows, item.key, process.env.TEST_SAP_CLIENT!);
        await save(`semantics-${item.id}.hex`, bytes.toString('hex'));
        assert.deepEqual((await decodeStxl(bytes)).lines, normalize(native.EXPECTED), item.id);
      }
    } else {
      assert.equal(successes.length, 0, `Batch returned failed ${item.id}`);
      assert.ok(errors.length > 0, `Batch omitted failed ${item.id}`);
      for (const row of errors) assert.equal(row.FUNCTION, native.STATUS === 6 ? '5' : 'X', item.id);
    }
    if (item.id === 'header-only') assert.equal(capture.STXL.filter((row) => sameKey(row, item.key)).length, 0);
    checks.push({
      case: item.id,
      status: 'pass',
      nativeStatus: native.STATUS,
      lines: native.EXPECTED.length,
      batchRows: successes.length + errors.length,
    });
  }
  await save('semantics-checks.json', checks);
  const expectedError = (item: (typeof cases)[number]) =>
    item.id === 'non-itf' && nonItfAccepted
      ? 'NON_ITF_TEXT'
      : item.expectedStatus === 6
        ? 'REFERENCE_ERROR'
        : 'NOT_FOUND';
  const readerChecks: Array<{ case: string; status: string; code?: string; lines?: number }> = [];
  await withStoredTextSession(context.client, process.env.TEST_SAP_CLIENT!, async (source) => {
    for (const item of cases) {
      if (item.id === 'non-itf' && !nonItfAccepted) continue;
      const native = single.CASES.find((row) => sameKey(row, item.key))!;
      try {
        const result = await readClassicText(source, item.key);
        assert.equal(native.STATUS, 0, `Reader unexpectedly succeeded for ${item.id}`);
        assert.notEqual(item.id, 'non-itf', 'Reader must reject non-ITF');
        assert.deepEqual(result.lines, normalize(native.EXPECTED), item.id);
        assert.equal(result.lineCount, native.EXPECTED.length, item.id);
        assert.deepEqual(result.header.key, item.key, 'Result header must retain the requested alias key');
        assert.equal(Number(native.HEADER.TDTXTLINES), result.lineCount, 'Native returned count differs');
        assert.equal(result.header.storedLineCount, Number(native.OLD_LINE_COUNT), 'Stored/native old count differs');
        if (item.id === 'reference-one') assert.equal(result.referenceChain.length, 2);
        if (item.id === 'reference-two') assert.equal(result.referenceChain.length, 3);
        if (['reference-one', 'reference-two'].includes(item.id))
          assert.equal(result.resolvedKey.TDNAME, name('normal-en'));
        if (item.id === 'header-only') assert.equal(result.storage.clusterPresent, false);
        if (item.id === 'empty-cluster') assert.equal(result.storage.clusterPresent, true);
        readerChecks.push({ case: item.id, status: 'pass', lines: result.lineCount });
      } catch (error) {
        if (!(error instanceof TextReadError)) throw error;
        assert.ok(native.STATUS !== 0 || item.id === 'non-itf', `Reader failed native successful ${item.id}`);
        assert.equal(error.code, expectedError(item), `Reader error for ${item.id}`);
        readerChecks.push({ case: item.id, status: 'pass', code: error.code });
      }
    }
  });
  const batchInputs = [...cases.map((item) => item.key), cases[0].key];
  const readerBatch = await withStoredTextSession(context.client, process.env.TEST_SAP_CLIENT!, (source) =>
    readClassicTextBatch(source, batchInputs),
  );
  assert.equal(readerBatch.length, batchInputs.length, 'Reader batch must retain duplicate input');
  for (const [index, result] of readerBatch.entries()) {
    const item = cases[index % cases.length];
    const native = single.CASES.find((row) => sameKey(row, item.key))!;
    assert.equal(result.index, index);
    if (native.STATUS === 0 && item.id !== 'non-itf') {
      assert.equal(result.status, 'ok', `Reader batch unexpectedly failed ${item.id}`);
      if (result.status === 'ok') assert.deepEqual(result.text.lines, normalize(native.EXPECTED));
    } else {
      assert.equal(result.status, 'error');
      if (result.status === 'error') assert.equal(result.error.code, expectedError(item));
    }
  }
  await save('semantics-reader-checks.json', {
    checks: readerChecks,
    batchInputs: batchInputs.length,
    batchResults: readerBatch.length,
  });
  await save('semantics-reader-batch.json', readerBatch);
  const discovery = await withStoredTextSession(context.client, process.env.TEST_SAP_CLIENT!, async (source) => {
    const found = await source.discover({ object: 'TEXT', namePrefix: `${prefix}_`, limit: 50 });
    assert.equal(found.more, false);
    assert.deepEqual(
      found.headers.map(({ key }) => JSON.stringify(key)).sort(),
      capture.STXH.map(({ TDOBJECT, TDNAME, TDID, TDSPRAS }) =>
        JSON.stringify({ TDOBJECT, TDNAME, TDID, TDSPRAS }),
      ).sort(),
    );
    const literalPercent = await source.discover({ object: 'TEXT', namePrefix: `${prefix}%`, limit: 50 });
    assert.equal(literalPercent.headers.length, 0, 'A literal percent must not act as a wildcard');
    assert.equal(literalPercent.more, false);
    return { headers: found.headers.length, literalUnderscore: 'pass', literalPercent: 'pass' };
  });
  await save('semantics-discovery-checks.json', discovery);
  Object.assign(summary, {
    nativeCases: checks.filter((item) => item.status === 'pass').length,
    excluded: checks.filter((item) => item.status !== 'pass').length,
    readerSingles: readerChecks.length,
    readerBatchInputs: batchInputs.length,
    readerBatchResults: readerBatch.length,
    discoveryHeaders: discovery.headers,
    literalUnderscore: true,
    literalPercent: true,
    freeSqlEnabled: process.env.STXL_ALLOW_FREE_SQL === 'true',
  });
  process.stderr.write(
    `${JSON.stringify({ label: context.label, stage: 'semantics', passed: checks.filter((item) => item.status === 'pass').length, excluded: checks.filter((item) => item.status !== 'pass').length, storedHeaders: capture.STXH.length })}\n`,
  );
} catch (error) {
  failure = error;
  await save('semantics-failure.json', { prefix, message: error instanceof Error ? error.message : 'Unknown failure' });
} finally {
  if (fixturesMayExist) {
    await save('semantics-lifecycle.json', { prefix, state: 'cleanup-started' });
    const cleanupJson = oracleJson(
      await oracle(
        wrap(`
 DATA keys TYPE STANDARD TABLE OF thead WITH EMPTY KEY. keys = VALUE #( ${keyTable()} ).
 TYPES: BEGIN OF ty_cleanup, tdname TYPE tdobname, tdspras TYPE spras, status TYPE i, END OF ty_cleanup.
 DATA cases TYPE STANDARD TABLE OF ty_cleanup WITH EMPTY KEY.
 LOOP AT keys ASSIGNING FIELD-SYMBOL(<key>).
 CALL FUNCTION 'DELETE_TEXT' EXPORTING object = <key>-tdobject name = <key>-tdname id = <key>-tdid
 language = <key>-tdspras savemode_direct = 'X' EXCEPTIONS not_found = 1 OTHERS = 8.
 APPEND VALUE #( tdname = <key>-tdname tdspras = <key>-tdspras status = sy-subrc ) TO cases.
 ENDLOOP.
 COMMIT WORK AND WAIT.
 ${jsonOutput('cases = cases')}`),
      ),
    );
    await save('semantics-cleanup.json', cleanupJson);
    const cleanup = JSON.parse(cleanupJson).CASES as Array<{ STATUS: number }>;
    assert.ok(
      cleanup.every((item) => item.STATUS === 0 || item.STATUS === 1),
      'A fixture deletion failed',
    );
    for (const table of ['STXH', 'STXL', 'STXB']) {
      const result = await context.client.runTableQuery(table, { columns: ['TDNAME'], where: prefixWhere, maxRows: 1 });
      assert.equal(result.rows.length, 0, `Cleanup absence verification failed for ${table}`);
    }
    await save('semantics-lifecycle.json', {
      prefix,
      state: 'deleted-and-absence-verified',
      keys: cases.length,
      tables: ['STXH', 'STXL', 'STXB'],
    });
    Object.assign(summary, {
      cleanup: 'deleted-and-absence-verified',
      fixtureKeys: cases.length,
      helperCount: helpers.length,
    });
    process.stderr.write(
      `${JSON.stringify({ label: context.label, stage: 'cleanup', status: 'deleted-and-absence-verified', keys: cases.length })}\n`,
    );
  }
}
summary.status = failure ? 'fail' : 'pass';
await save('semantics-summary.json', summary);
if (failure) throw new Error('Semantic probe failed; details are in the private semantics-failure.json artifact');
await save('semantics-failure.json', { prefix, status: 'none' });
process.stderr.write(`${JSON.stringify(summary)}\n`);
