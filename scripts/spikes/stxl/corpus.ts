import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { liveContext, oracleJson } from './live-client.js';
import { readStoredText, type TextKey } from './reader.js';

const context = liveContext();
const language = process.env.STXL_CORPUS_LANGUAGE;
if (language && !/^[A-Z0-9]$/.test(language)) throw new Error('Invalid corpus language');
const prefix = language ? `corpus-${language}` : 'corpus';
const keys = new Map<string, TextKey>();
for (const [field, op, value, limit] of [
  ['TDOBJECT', '=', 'TEXT', 40],
  ['TDOBJECT', '<>', 'TEXT', 20],
  ['SRTF2', '>', '0', 20],
] as const) {
  const result = await context.client.runTableQuery('STXL', {
    columns: ['TDOBJECT', 'TDNAME', 'TDID', 'TDSPRAS'],
    where: [
      { field: 'RELID', op: '=', value: 'TX' },
      { field, op, value },
      ...(language ? [{ field: 'TDSPRAS', op: '=', value: language }] : []),
    ],
    maxRows: limit,
  });
  for (const row of result.rows) {
    const key: TextKey = { TDOBJECT: row.TDOBJECT, TDNAME: row.TDNAME, TDID: row.TDID, TDSPRAS: row.TDSPRAS };
    keys.set(JSON.stringify(key), key);
  }
}
await context.save(`${prefix}-keys.json`, [...keys.values()]);
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const source = `CLASS ZCL_ARC1_STXL_ORACLE DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION. INTERFACES if_oo_adt_classrun. ENDCLASS.
CLASS ZCL_ARC1_STXL_ORACLE IMPLEMENTATION.
 METHOD if_oo_adt_classrun~main.
 TYPES: BEGIN OF ty_case, tdobject TYPE tdobject, tdname TYPE tdobname, tdid TYPE tdid, tdspras TYPE spras,
 status TYPE i, header TYPE thead, expected TYPE STANDARD TABLE OF tline WITH EMPTY KEY, END OF ty_case.
 DATA cases TYPE STANDARD TABLE OF ty_case WITH EMPTY KEY.
 cases = VALUE #( ${[...keys.values()].map((key) => `( tdobject = ${literal(key.TDOBJECT)} tdname = ${literal(key.TDNAME)} tdid = ${literal(key.TDID)} tdspras = ${literal(key.TDSPRAS)} )`).join('\n')} ).
 LOOP AT cases ASSIGNING FIELD-SYMBOL(<case>).
 CALL FUNCTION 'READ_TEXT' EXPORTING object = <case>-tdobject name = <case>-tdname id = <case>-tdid language = <case>-tdspras
 IMPORTING header = <case>-header TABLES lines = <case>-expected EXCEPTIONS OTHERS = 8.
 <case>-status = sy-subrc.
 IF lines( <case>-expected ) > 3000. CLEAR <case>-expected. <case>-status = 99. ENDIF.
 ENDLOOP.
 DATA(writer) = cl_sxml_string_writer=>create( type = if_sxml=>co_xt_json ).
 CALL TRANSFORMATION id SOURCE cases = cases RESULT XML writer.
 out->write( cl_http_utility=>encode_x_base64( writer->get_output( ) ) ).
 ENDMETHOD. ENDCLASS.`;
const output =
  process.env.STXL_REUSE_ORACLE === 'true'
    ? await readFile(resolve(context.output, `${context.label}-${prefix}-oracle.json`), 'utf8')
    : oracleJson(await context.oracle(source));
await context.save(`${prefix}-oracle.json`, output);
const oracle = JSON.parse(output) as {
  CASES: Array<
    TextKey & { STATUS: number; HEADER: Record<string, string>; EXPECTED: Array<{ TDFORMAT: string; TDLINE: string }> }
  >;
};
const results = [];
let index = 0;
for (const item of oracle.CASES) {
  if (item.STATUS !== 0) {
    results.push({
      index,
      status: 'excluded',
      reason: item.STATUS === 99 ? 'oracle text exceeds 3000-line test budget' : 'READ_TEXT failure',
      oracleStatus: item.STATUS,
    });
    index++;
    continue;
  }
  const key: TextKey = { TDOBJECT: item.TDOBJECT, TDNAME: item.TDNAME, TDID: item.TDID, TDSPRAS: item.TDSPRAS };
  const started = performance.now();
  try {
    const decoded = await readStoredText(context.client, key, process.env.TEST_SAP_CLIENT!);
    await context.save(`${prefix}-${index}.hex`, decoded.bytes.toString('hex'));
    assert.equal(item.STATUS, 0, 'READ_TEXT oracle did not return success');
    assert.deepEqual(
      decoded.lines,
      item.EXPECTED.map((line) => ({
        format: line.TDFORMAT.replace(/ +$/u, ''),
        text: line.TDLINE.replace(/ +$/u, ''),
      })),
    );
    results.push({
      index,
      status: 'pass',
      object: item.TDOBJECT,
      language: item.TDSPRAS,
      version: decoded.version,
      codePage: decoded.codePage,
      chunks: decoded.chunks,
      compressedBytes: decoded.compressedBytes,
      outputBytes: decoded.outputBytes,
      lines: decoded.lines.length,
      ms: performance.now() - started,
    });
  } catch (error) {
    results.push({
      index,
      status: 'fail',
      object: item.TDOBJECT,
      language: item.TDSPRAS,
      oracleStatus: item.STATUS,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    process.exitCode = 1;
  }
  process.stderr.write(`${JSON.stringify(results.at(-1))}\n`);
  await context.save(`${prefix}-checks.json`, results);
  index++;
}
