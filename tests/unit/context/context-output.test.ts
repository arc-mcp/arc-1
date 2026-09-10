import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { compressCdsContext, compressContext } from '../../../src/context/compressor.js';

const clas = (name: string, dependencies: string[] = []) =>
  `CLASS ${name} DEFINITION PUBLIC.\nPUBLIC SECTION.\n${dependencies.map((d, i) => `DATA ref${i} TYPE REF TO ${d}.`).join('\n')}\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\nENDCLASS.`;

function clientFor(sources: Record<string, string>) {
  const fetch = vi.fn(async (name: string) => {
    const source = sources[name.toUpperCase()];
    if (source === undefined) throw new Error(`Cannot read ${name} at attempted source endpoint`);
    return source;
  });
  return {
    client: { getClass: fetch, getInterface: fetch, getDdls: fetch, getTabl: fetch } as unknown as AdtClient,
    fetch,
  };
}

describe('source-context output scope', () => {
  it('separates root candidates from recursive attempts and counts real output lines', async () => {
    const { client, fetch } = clientFor({ ZCL_A: clas('ZCL_A', ['ZCL_CHILD']), ZCL_CHILD: clas('ZCL_CHILD') });
    const result = await compressContext(client, clas('ZCL_ROOT', ['zcl_a', 'ZCL_MISSING']), 'ZCL_ROOT', 'CLAS', 2, 2);
    expect(result.depsFound).toBe(2);
    expect(result.depsResolved).toBe(2);
    expect(result.depsFailed).toBe(1);
    expect(result.depsFiltered).toBe(0);
    expect(fetch.mock.calls.map(([name]) => name.toUpperCase())).toEqual(['ZCL_A', 'ZCL_MISSING', 'ZCL_CHILD']);
    expect(result.output).toContain('2 root candidates after filtering; 0 root candidates not fetched');
    expect(result.output).toContain('across explored levels: 2 resolved, 1 failed');
    expect(result.output).toContain('Source-derived');
    expect(result.output).toContain('not proof of absence as another SAP type');
    expect(result.totalLines).toBe(result.output.split('\n').length);
  });

  it('counts only unattempted root names, not transitive contracts or failed reads', async () => {
    const { client, fetch } = clientFor({ ZCL_A: clas('ZCL_A', ['ZCL_CHILD']), ZCL_CHILD: clas('ZCL_CHILD') });
    const result = await compressContext(
      client,
      clas('ZCL_ROOT', ['ZCL_A', 'ZCL_B', 'ZCL_C']),
      'ZCL_ROOT',
      'CLAS',
      1,
      2,
    );
    expect(result.depsFound).toBe(3);
    expect(result.depsResolved).toBe(2);
    expect(result.depsFiltered).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('3 root candidates after filtering; 2 root candidates not fetched');
    expect(result.output).not.toContain('complete graph');
  });

  it('keeps zero-candidate context scoped and never fabricates failed reads', async () => {
    const { client, fetch } = clientFor({});
    const result = await compressContext(client, clas('ZCL_ROOT'), 'ZCL_ROOT', 'CLAS');
    expect(result.depsFound).toBe(0);
    expect(result.depsFiltered).toBe(0);
    expect(result.depsFailed).toBe(0);
    expect(result.output).toContain('0 root candidates after filtering');
    expect(result.output).toContain('Coverage is not complete');
    expect(result.output).not.toContain('Failed dependencies');
    expect(fetch).not.toHaveBeenCalled();
    expect(result.totalLines).toBe(result.output.split('\n').length);
  });

  it('applies the same counting semantics to CDS, including multiline contracts', async () => {
    const { client, fetch } = clientFor({
      ZI_CHILD: 'define view entity ZI_CHILD as select from zbase { key id }',
      ZBASE: 'define table zbase {\n key id : abap.int4;\n}',
    });
    const result = await compressCdsContext(
      client,
      'define view entity ZI_ROOT as projection on zi_child { key id }',
      'ZI_ROOT',
      1,
      2,
    );
    expect(result.depsFound).toBe(1);
    expect(result.depsResolved).toBe(2);
    expect(result.depsFiltered).toBe(0);
    expect(result.output).toContain('1 root candidates after filtering; 0 root candidates not fetched');
    expect(result.output).toContain('across explored levels: 2 resolved, 0 failed');
    expect(result.totalLines).toBe(result.output.split('\n').length);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
