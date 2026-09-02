import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalDataSourceName } from '../../../src/adt/data-source-name.js';
import {
  INTERNAL_DATA_OPERATIONS,
  type InternalDataOperationId,
  internalDataSources,
  internalOperationDenial,
  internalOperationsBlockedBy,
  internalOperationWarning,
} from '../../../src/adt/internal-data-operations.js';

const srcDir = join(import.meta.dirname, '../../../src');
const read = (relative: string) => readFileSync(join(srcDir, relative), 'utf8');

describe('internal data-operation registry', () => {
  it('declares every source as an already-canonical name', () => {
    for (const [id, operation] of Object.entries(INTERNAL_DATA_OPERATIONS)) {
      expect(operation.sources.length).toBeGreaterThan(0);
      for (const source of operation.sources) {
        expect(canonicalDataSourceName(source), `${id} declares ${source}`).toBe(source);
      }
    }
  });

  it('inventories exactly the sources ARC-1 reads for its own features', () => {
    expect(internalDataSources()).toEqual(['SEOMETAREL', 'SUAUTHVALTRC', 'SWOTLV', 'TADIR', 'TOBJ', 'TSTC']);
  });

  // Guards the guard: if someone adds a fixed internal read without registering it, the operator
  // impact matrix in the docs silently goes stale. This checks the code still reads what we declare.
  it.each([
    ['TADIR', 'adt/client.ts'],
    ['SEOMETAREL', 'handlers/navigate.ts'],
    ['TSTC', 'handlers/read.ts'],
    ['SWOTLV', 'handlers/read.ts'],
    ['SUAUTHVALTRC', 'adt/authorization-trace.ts'],
    ['TOBJ', 'adt/authorization-trace.ts'],
  ])('registry source %s is really read by %s', (source, file) => {
    expect(internalDataSources()).toContain(source);
    expect(read(file).toUpperCase()).toContain(source);
  });

  it('maps a blocklist to the features it disables', () => {
    const hits = internalOperationsBlockedBy(['SEOMETAREL', 'USR02']);
    expect(hits.map((hit) => hit.id).sort()).toEqual(['class_hierarchy', 'interface_implementers']);
    expect(hits.every((hit) => hit.blocked).valueOf()).toBe(true);
    expect(internalOperationsBlockedBy(['USR02'])).toEqual([]);
  });

  it('separates core denial from optional degradation', () => {
    const core: InternalDataOperationId[] = [
      'tadir_lookup_db',
      'class_hierarchy',
      'bor_method_lookup',
      'authorization_trace',
    ];
    const optional: InternalDataOperationId[] = ['tran_program_enrichment', 'interface_implementers'];
    for (const id of core) expect(INTERNAL_DATA_OPERATIONS[id].criticality).toBe('core');
    for (const id of optional) expect(INTERNAL_DATA_OPERATIONS[id].criticality).toBe('optional');
  });

  it('gives a core denial the affected feature and an actionable alternative', () => {
    const message = internalOperationDenial('tadir_lookup_db', 'DATA_SOURCE_BLOCKED: ...');
    expect(message).toContain('SAPSearch');
    expect(message).toContain('source="adt"');
    // Honest about what the alternative cannot do.
    expect(message).toContain('orphan/ghost TADIR rows');
  });

  it('gives an optional degradation an explicit incompleteness warning', () => {
    const warning = internalOperationWarning('interface_implementers', 'DATA_SOURCE_BLOCKED');
    expect(warning).toMatch(/^Incomplete result:/);
    expect(warning).toContain('SEOMETAREL');
    expect(warning).toContain('may be incomplete');
  });

  it('explains why the authorization trace denies rather than partially answering', () => {
    const message = internalOperationDenial('authorization_trace', 'DATA_SOURCE_BLOCKED: ...');
    expect(message).toContain('SUAUTHVALTRC');
    expect(message).toContain('TOBJ');
    expect(message).toMatch(/ambiguous|misleading/);
  });

  // The registry must never become a bypass: no caller-settable flag may reach it.
  it('exposes no caller-controlled internal-operation switch', () => {
    for (const file of ['handlers/schemas.ts', 'handlers/tools.ts']) {
      const text = read(file);
      expect(text).not.toMatch(/internalOperation|internal\s*:\s*z\.|["']internal["']\s*:/);
    }
  });

  it('no consumer still uses the refused filtered-preview path for SEOMETAREL', () => {
    for (const file of ['handlers/navigate.ts', 'handlers/where-used.ts']) {
      expect(read(file)).not.toContain("getTableContents('SEOMETAREL'");
    }
  });
});
