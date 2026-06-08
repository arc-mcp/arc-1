/**
 * ABAP fixture loader for E2E tests.
 *
 * Loads ABAP source files from tests/fixtures/abap/ for creating test objects
 * on the SAP system and for asserting read-back content.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'abap');

/**
 * Read an ABAP fixture file by name.
 * @param filename - e.g., 'zarc1_test_report.abap'
 */
export function readFixture(filename: string): string {
  const path = join(FIXTURES_DIR, filename);
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read fixture ${filename} at ${path}: ${message}`);
  }
}

/** Persistent test objects — created once, expected to stay on SAP */
export const PERSISTENT_OBJECTS = [
  {
    name: 'ZARC1_TEST_REPORT',
    type: 'PROG',
    fixture: 'zarc1_test_report.abap',
    searchQuery: 'ZARC1_TEST_REPORT',
  },
  {
    name: 'ZARC1_E2E_DUMP',
    type: 'PROG',
    fixture: 'zarc1_e2e_dump.abap',
    searchQuery: 'ZARC1_E2E_DUMP',
  },
  {
    name: 'ZIF_ARC1_TEST',
    type: 'INTF',
    fixture: 'zif_arc1_test.intf.abap',
    searchQuery: 'ZIF_ARC1_TEST',
  },
  {
    name: 'ZCL_ARC1_TEST',
    type: 'CLAS',
    fixture: 'zcl_arc1_test.clas.abap',
    searchQuery: 'ZCL_ARC1_TEST',
  },
  {
    name: 'ZCL_ARC1_TEST_UT',
    type: 'CLAS',
    fixture: 'zcl_arc1_test_ut.clas.abap',
    searchQuery: 'ZCL_ARC1_TEST_UT',
  },
  {
    name: 'ZTABL_ARC1_I33',
    type: 'TABL',
    fixture: 'ztabl_arc1_i33.tabl.abap',
    searchQuery: 'ZTABL_ARC1_I33',
  },
  {
    name: 'ZI_ARC1_I33_ROOT',
    type: 'DDLS',
    fixture: 'zi_arc1_i33_root.ddls.abap',
    searchQuery: 'ZI_ARC1_I33_ROOT',
  },
  {
    name: 'ZI_ARC1_I33_PROJ',
    type: 'DDLS',
    fixture: 'zi_arc1_i33_proj.ddls.abap',
    searchQuery: 'ZI_ARC1_I33_PROJ',
  },
] as const;

/** Transient test objects — created and deleted within a test run */
export const TRANSIENT_OBJECTS = [
  {
    name: 'ZARC1_E2E_WRITE',
    type: 'PROG',
    fixture: 'zarc1_e2e_write.abap',
  },
] as const;
