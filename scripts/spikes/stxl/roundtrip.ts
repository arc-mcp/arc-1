/** Opt-in live test: SAVE_TEXT -> ADT table query -> TypeScript -> DELETE_TEXT. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { liveContext } from './live-client.js';
import { keyFilters, readStoredText } from './reader.js';

const context = liveContext();
if (process.env.STXL_ALLOW_HELPERS !== 'true')
  throw new Error('Disposable test writes require STXL_ALLOW_HELPERS=true');
const name = `ZARC1_STXL_${randomUUID().replaceAll('-', '').toUpperCase()}`;
const key = { TDOBJECT: 'TEXT', TDNAME: name, TDID: 'ST', TDSPRAS: 'E' };
const where = keyFilters(key);
const before = await context.client.runTableQuery('STXH', { columns: ['TDNAME'], where, maxRows: 1 });
assert.equal(before.rows.length, 0, 'Refusing to overwrite an existing text');
const wrap = (body: string) => `CLASS ZCL_ARC1_STXL_ORACLE DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION. INTERFACES if_oo_adt_classrun. ENDCLASS.
 CLASS ZCL_ARC1_STXL_ORACLE IMPLEMENTATION. METHOD if_oo_adt_classrun~main.
 ${body}
 ENDMETHOD. ENDCLASS.`;
await context.save('roundtrip-lifecycle.json', { name, state: 'planned' });
try {
  await context.oracle(
    wrap(`
 DATA header TYPE thead.
 header-tdobject = 'TEXT'. header-tdname = '${name}'. header-tdid = 'ST'. header-tdspras = 'E'.
 DATA lines TYPE STANDARD TABLE OF tline WITH EMPTY KEY.
 DATA(seed) = CONV int8( 17012026 ).
 DATA(alphabet) = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !#$%&()*+,-./:;<=>?@[]^_{|}~'.
 DO 2000 TIMES.
   DATA(text) = CONV string( '' ).
   DO 132 TIMES.
     seed = ( seed * 48271 ) MOD 2147483647.
     DATA(idx) = CONV i( seed MOD strlen( alphabet ) ).
     text = text && substring( val = alphabet off = idx len = 1 ).
   ENDDO.
   APPEND VALUE #( tdformat = '*' tdline = text ) TO lines.
 ENDDO.
 CALL FUNCTION 'SAVE_TEXT' EXPORTING header = header insert = 'X' savemode_direct = 'X'
 TABLES lines = lines EXCEPTIONS OTHERS = 8.
 ASSERT sy-subrc = 0.
 COMMIT WORK AND WAIT.
 DATA check TYPE STANDARD TABLE OF tline WITH EMPTY KEY.
 CALL FUNCTION 'READ_TEXT' EXPORTING object = 'TEXT' name = header-tdname id = 'ST' language = 'E'
 TABLES lines = check EXCEPTIONS OTHERS = 8.
 ASSERT sy-subrc = 0. ASSERT check = lines.
 out->write( 'SAVED_AND_VERIFIED' ).`),
  );
  await context.save('roundtrip-lifecycle.json', { name, state: 'saved' });
  const result = await readStoredText(context.client, key, process.env.TEST_SAP_CLIENT!);
  const fixture = JSON.parse(
    await readFile(new URL('../../../tests/fixtures/stxl/sap-758.json', import.meta.url), 'utf8'),
  );
  const digest = createHash('sha256').update(JSON.stringify(result.lines)).digest('hex');
  assert.equal(digest, fixture.cases[8].sha256);
  assert.ok(result.chunks > 32, 'Must exercise more than one ADT chunk window');
  const evidence = {
    label: context.label,
    status: 'pass',
    chunks: result.chunks,
    lines: result.lines.length,
    compressedBytes: result.compressedBytes,
    outputBytes: result.outputBytes,
    sha256: digest,
  };
  await context.save('roundtrip-checks.json', evidence);
  process.stderr.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await context.oracle(
    wrap(`
 DATA name TYPE tdobname VALUE '${name}'.
 CALL FUNCTION 'DELETE_TEXT' EXPORTING object = 'TEXT' name = name id = 'ST' language = 'E' savemode_direct = 'X'
 EXCEPTIONS not_found = 1 OTHERS = 8.
 ASSERT sy-subrc = 0 OR sy-subrc = 1.
 COMMIT WORK AND WAIT.
 out->write( 'CLEANED' ).`),
  );
  for (const table of ['STXH', 'STXL']) {
    const result = await context.client.runTableQuery(table, { columns: ['TDNAME'], where, maxRows: 1 });
    assert.equal(result.rows.length, 0, `Cleanup verification failed for ${table}`);
  }
  await context.save('roundtrip-lifecycle.json', { name, state: 'deleted-and-absence-verified' });
}
