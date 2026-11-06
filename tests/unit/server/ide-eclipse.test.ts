import { describe, expect, it } from 'vitest';
import { textResult } from '../../../src/handlers/shared.js';
import { validateConfig } from '../../../src/server/config.js';
import { appendIdeLinks, buildEclipseLink, IDE_LINK_LIMIT } from '../../../src/server/ide-links.js';
import { resolveHttpIdeContext } from '../../../src/server/ide-request.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const source = textResult('CLASS cl_abap_typedescr DEFINITION.');
const args = { type: 'CLAS', name: 'CL_ABAP_TYPEDESCR' };
const local: ServerConfig = { ...DEFAULT_CONFIG, ideLinks: 'eclipse', ideSystemId: 'A4H', client: '001' };

describe('native Eclipse navigation', () => {
  it.each([
    ['CLAS/OC', 'CL_ABAP_TYPEDESCR', 'oo/classes/cl_abap_typedescr'],
    ['INTF', 'IF_SERIALIZABLE_OBJECT', 'oo/interfaces/if_serializable_object'],
    ['PROG', 'SAPMSSY0', 'programs/programs/sapmssy0'],
    ['DDLS', '/DMO/I_FLIGHT', 'ddic/ddl/sources/%2Fdmo%2Fi_flight'],
  ])('uses the known ADT object endpoint for %s', (type, name, path) => {
    expect(buildEclipseLink('A4H', { type, name })).toBe(`adt://A4H/sap/bc/adt/${path}`);
  });

  it('does not accept project authorities, commands, versions, includes, or unsupported object types', () => {
    for (const sid of ['A4H_2023', 'A4H.2023', 'A4H-2025', 'a4h', 'A4H?x', '', '123']) {
      expect(buildEclipseLink(sid, args)).toBeUndefined();
    }
    for (const name of [
      '../X',
      'X?version=inactive',
      'X#start=1',
      'X%2F..',
      'Z(abc)',
      'X\nY',
      'Z[A](command:x)',
      'A'.repeat(81),
    ]) {
      expect(buildEclipseLink('A4H', { ...args, name })).toBeUndefined();
    }
    for (const include of ['definitions', 'implementations', 'testclasses', 'macros', '../main']) {
      expect(buildEclipseLink('A4H', { ...args, include })).toBeUndefined();
    }
    for (const type of ['FUNC', 'TABL', 'DTEL', 'DOMA', 'DEVC', 'VERSIONS', 'DUMPS', 'BDEF', 'UNKNOWN']) {
      expect(buildEclipseLink('A4H', { type, name: 'X' })).toBeUndefined();
    }
    expect(buildEclipseLink('A4H', { ...args, name: 'A'.repeat(80) })).toBeDefined();
    expect(buildEclipseLink('A4H', { ...args, include: 'MAIN' })).toBe(buildEclipseLink('A4H', args));
  });

  it('keeps source unchanged, labels SID and client, and never supplies a version or fragment', () => {
    const result = appendIdeLinks(source, 'SAPRead', { ...args, version: 'inactive' }, local);
    expect(result.content[0]).toEqual(source.content[0]);
    expect(result.content[1].text).toContain('SAP SID: A4H; client: 001');
    expect(result.content[1].text).toContain('Check the local project matches this backend');
    expect(result.content[1].text).toContain('(adt://A4H/sap/bc/adt/oo/classes/cl_abap_typedescr)');
    expect(result.content[1].text).not.toMatch(/vscode:|version=|#start/);
    expect(source.content).toHaveLength(1);
  });

  it('bounds search links and omits errors, edits, unsupported includes, and unselected targets', () => {
    const rows = textResult(
      JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ objectType: 'CLAS', objectName: `ZCL_${i}` }))),
    );
    expect(appendIdeLinks(rows, 'SAPSearch', {}, local).content[1].text.match(/adt:\/\//g)).toHaveLength(
      IDE_LINK_LIMIT,
    );
    expect(appendIdeLinks({ ...source, isError: true }, 'SAPRead', args, local).content).toEqual(source.content);
    expect(appendIdeLinks(source, 'SAPWrite', args, local)).toBe(source);
    expect(appendIdeLinks(source, 'SAPRead', { ...args, method: 'lhc_x~read' }, local)).toBe(source);
    expect(appendIdeLinks(source, 'SAPRead', args, { ...local, multiTargetEndpoints: true })).toBe(source);
  });

  it('opts in to Eclipse on an HTTP server and never treats a route alias as the SID', () => {
    const config: ServerConfig = {
      ...local,
      transport: 'http-streamable',
      ideLinks: 'eclipse',
      multiTargetEndpoints: true,
      targetId: 'A4H-2025/001',
    };
    const eclipse = resolveHttpIdeContext(config, { 'arc1-ide-client': 'eclipse' });
    expect(eclipse).toEqual({ style: 'eclipse', systemId: 'A4H', target: 'A4H-2025/001' });
    const result = appendIdeLinks(source, 'SAPRead', args, config, eclipse);
    expect(result.content[1].text).toContain('target: A4H-2025/001');
    expect(result.content[1].text).toContain('adt://A4H/');
    expect(result.content[1].text).not.toContain('adt://A4H-2025/');
    const vscode = resolveHttpIdeContext(config, {
      'arc1-ide-client': 'vscode',
      'arc1-ide-destinations-v1': 'A4H-2025/001=LOCAL',
    });
    expect(appendIdeLinks(source, 'SAPRead', args, config, vscode)).toBe(source);
    expect(appendIdeLinks(source, 'SAPRead', args, config)).toBe(source);
    for (const overrides of [{ ideLinks: 'off' as const }, { ideSystemId: '' }, { targetId: undefined }]) {
      expect(resolveHttpIdeContext({ ...config, ...overrides }, { 'arc1-ide-client': 'eclipse' })).toBeUndefined();
    }
    expect(
      appendIdeLinks(source, 'SAPRead', args, config, { style: 'eclipse', systemId: 'DEV', target: config.targetId }),
    ).toBe(source);
  });

  it('validates explicit local SID', () => {
    expect(() => validateConfig(local)).not.toThrow();
    expect(() => validateConfig({ ...local, ideSystemId: '' })).toThrow(/requires ARC1_IDE_SYSTEM_ID/);
    expect(() => validateConfig({ ...local, ideSystemId: 'A4H-2025' })).toThrow(/three-character SAP SID/);
    expect(() => validateConfig({ ...local, multiTargetEndpoints: true })).toThrow(/single-target only/);
  });
});
