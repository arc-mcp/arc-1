import { describe, expect, it, vi } from 'vitest';
import type { AdtClient, SourceReadOptions, SourceReadResult } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { buildStructureHierarchy, parseEmbeddedStructures } from '../../../src/adt/structure-hierarchy.js';

type TestClient = Pick<AdtClient, 'getTabl' | 'resolveTablObjectUrl' | 'http' | 'safety'>;

describe('structure hierarchy', () => {
  describe('parseEmbeddedStructures', () => {
    it('keeps an apostrophe in a legacy line comment from masking later includes', () => {
      expect(parseEmbeddedStructures("field : abap.char(1); -- don't\n-- include zghost;\ninclude zreal;")).toEqual([
        { name: 'ZREAL', attribute: null, kind: 'include' },
      ]);
    });
    it('marks unqualified nested or unfinished scans instead of silently claiming complete coverage', () => {
      for (const source of ['/* see /* note */\ninclude zreal;', "@label: 'unfinished\ninclude zreal;"]) {
        const issues: string[] = [];
        expect(parseEmbeddedStructures(source, issues)).toEqual([]);
        expect(issues.length).toBeGreaterThan(0);
      }
    });
    it('does not turn comments or multiline literals into include evidence', () => {
      expect(
        parseEmbeddedStructures(`
/* include zghost;
/* nested */ include zghost2;
*/
* unmatched comment token /*
@EndUserText.label: 'literal /*
include zliteral;
*/ ''quoted'''
include /* comment */ zreal with suffix real;
/* unfinished
include zunfinished;
`),
      ).toEqual([{ name: 'ZREAL', attribute: null, kind: 'include', suffix: 'real' }]);
    });
    it('parses modern and classic includes but not append syntax from source', () => {
      const refs = parseEmbeddedStructures(`
@AbapCatalog.enhancement.category: #EXTENSIBLE_CHARACTER_NUMERIC
define structure zbase {
  include zanon_inc;
  address : include zaddr_inc;
  field1 : abap.char(10);
  .INCLUDE zclassic_inc
  .APPEND zdead_append
  // include zcommented;
}`);

      expect(refs).toEqual([
        { name: 'ZANON_INC', attribute: null, kind: 'include' },
        { name: 'ZADDR_INC', attribute: 'address', kind: 'include' },
        { name: 'ZCLASSIC_INC', attribute: null, kind: 'include' },
      ]);
    });

    it('parses key includes of a table definition', () => {
      const refs = parseEmbeddedStructures(`
@AbapCatalog.tableCategory : #TRANSPARENT
define table ztab {
  key include zkey_inc not null;
  key keys : include znamed_key_inc not null;
  key include /arc/key_inc not null;
  key client : abap.clnt not null;
  include zdata_inc;
}`);

      expect(refs).toEqual([
        { name: 'ZKEY_INC', attribute: null, kind: 'include' },
        { name: 'ZNAMED_KEY_INC', attribute: 'keys', kind: 'include' },
        { name: '/ARC/KEY_INC', attribute: null, kind: 'include' },
        { name: 'ZDATA_INC', attribute: null, kind: 'include' },
      ]);
    });
  });

  describe('buildStructureHierarchy', () => {
    it.each(['unavailable', 'too_many'])('keeps dedicated child discovery after %s index fallback', async (failure) => {
      const post = vi.fn(async () => {
        if (failure === 'unavailable') throw new AdtApiError('Unavailable', 400, '/usageReferences');
        return {
          body: whereUsedXml(
            Array.from({ length: 13 }, (_, i) => ({
              name: `ZREF${i}`,
              type: 'TABL/DS',
              uri: `/sap/bc/adt/ddic/structures/ZREF${i}`,
            })),
          ),
        };
      });
      const client = makeStructureClient(
        {
          ZBASE: 'define structure zbase {\n include zinc;\n}',
          ZINC: 'define structure zinc {}',
          ZAPPEND: 'extend type zinc with zappend {}',
        },
        post,
      );
      client.http.get = vi.fn(async (path: string) => {
        if (path.endsWith('/enhancements'))
          return {
            body: '<elementInfo name="ZINC" type="TABL/DS"><elementInfo name="ZAPPEND" type="TABL/DS" uri="/sap/bc/adt/ddic/structures/ZAPPEND/source/main"/></elementInfo>',
          };
        const name = new URL(path, 'https://local').pathname.split('/').at(-1)!;
        return {
          body: `<blueSource name="${name}" type="TABL/DS" version="active">${name === 'ZINC' ? '<link rel="http://www.sap.com/adt/relations/enhancements" href="./ZINC/enhancements"/>' : ''}</blueSource>`,
        };
      }) as unknown as AdtClient['http']['get'];
      const result = await buildStructureHierarchy(client, 'ZBASE');
      expect(result.tree.children[0]?.children).toContainEqual(
        expect.objectContaining({ structure: 'ZAPPEND', kind: 'append' }),
      );
      expect(post).toHaveBeenCalledTimes(1);
    });
    it('finds appends through one native query per structure and confirms their source', async () => {
      const post = vi.fn(async (path: string) => {
        if (path.includes('/scope')) throw new AdtApiError('Not found', 404, path);
        return {
          body: whereUsedXml(
            path.endsWith('ZBASE')
              ? [
                  { name: 'ZAPPEND_OK', type: 'TABL/DS', uri: '/sap/bc/adt/ddic/structures/ZAPPEND_OK' },
                  { name: 'ZAPPEND_NOPE', type: 'TABL/DS', uri: '/sap/bc/adt/ddic/structures/ZAPPEND_NOPE' },
                  { name: 'ZTAB_CONSUMER', type: 'TABL/DT', uri: '/sap/bc/adt/ddic/tables/ZTAB_CONSUMER' },
                  {
                    name: 'ZCONTAINER',
                    type: 'TABL/DS',
                    uri: '/sap/bc/adt/ddic/structures/ZCONTAINER',
                    isResult: false,
                  },
                  { name: 'ZCL_CONSUMER', type: 'CLAS/OC', uri: '/sap/bc/adt/oo/classes/ZCL_CONSUMER' },
                ]
              : [],
          ),
        };
      });
      const client = makeStructureClient(
        {
          ZBASE: `define structure zbase {
  include zinc;
}`,
          ZINC: 'define structure zinc { field1 : abap.char(1); }',
          ZAPPEND_OK: 'extend type zbase with { append_field : abap.char(1); }',
          ZAPPEND_NOPE: 'define structure zappend_nope { field1 : abap.char(1); }',
        },
        post,
      );

      const result = await buildStructureHierarchy(client, 'zbase');

      expect(result.tree.children.map((child) => `${child.kind}:${child.structure}`)).toEqual([
        'include:ZINC',
        'append:ZAPPEND_OK',
      ]);
      expect(result.summary).toMatchObject({ includes: 1, appends: 1, unresolved: 0 });
      expect(post).toHaveBeenCalledTimes(3);
      expect(post.mock.calls.every(([path]) => !path.includes('/scope'))).toBe(true);
      expect(result.extensionDiscovery?.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ coverage: 'candidate_index' })]),
      );
      expect(client.getTabl).not.toHaveBeenCalledWith('ZTAB_CONSUMER', expect.anything());
      expect(client.getTabl).not.toHaveBeenCalledWith('ZCONTAINER', expect.anything());
    });

    it('skips where-used when includeExtensions is false', async () => {
      const post = vi.fn();
      const client = makeStructureClient(
        {
          ZBASE: `define structure zbase {
  include zinc;
}`,
          ZINC: 'define structure zinc { field1 : abap.char(1); }',
        },
        post,
      );

      const result = await buildStructureHierarchy(client, 'ZBASE', { includeExtensions: false });

      expect(result.includeExtensions).toBe(false);
      expect(result.tree.children).toHaveLength(1);
      expect(result.tree.children[0]?.kind).toBe('include');
      expect(post).not.toHaveBeenCalled();
    });

    it('keeps the include tree when where-used is unavailable', async () => {
      const post = vi.fn(async (path: string) => {
        throw new AdtApiError('Where-used unavailable', 400, path);
      });
      const client = makeStructureClient(
        {
          ZBASE: `define structure zbase {
  include zinc;
}`,
          ZINC: 'define structure zinc { field1 : abap.char(1); }',
        },
        post,
      );

      const result = await buildStructureHierarchy(client, 'ZBASE');

      expect(result.tree.children).toHaveLength(1);
      expect(result.tree.children[0]).toMatchObject({ kind: 'include', structure: 'ZINC' });
      expect(result.summary).toMatchObject({ includes: 1, appends: 0, unresolved: 0 });
      expect(post).toHaveBeenCalledTimes(1);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          'Where-used endpoint unavailable for ZBASE; index fallback was skipped for the rest of the tree.',
        ]),
      );
    });

    it('keeps includes and warns instead of scanning a large candidate set', async () => {
      const candidates = Array.from({ length: 51 }, (_, i) => ({
        name: `ZREF${i}`,
        type: 'TABL/DS',
        uri: `/sap/bc/adt/ddic/structures/zref${i}`,
      }));
      const post = vi.fn(async () => ({ body: whereUsedXml(candidates) }));
      const client = makeStructureClient(
        {
          ZBASE: 'define structure zbase {\n include zinc;\n}',
          ZINC: 'define structure zinc { field : abap.char(1); }',
        },
        post,
      );
      const result = await buildStructureHierarchy(client, 'ZBASE');
      expect(result.tree.children).toEqual([{ structure: 'ZINC', attribute: null, kind: 'include', children: [] }]);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          'Where-used returned 51 structure candidates for ZBASE, exceeding the append scan limit of 12; index fallback was skipped for the rest of the tree.',
        ]),
      );
      expect(post).toHaveBeenCalledTimes(1);
      expect(client.getTabl).toHaveBeenCalledTimes(2);
    });

    it('reports denied coverage and preserves the root after authorization failures', async () => {
      const error = new AdtApiError('Forbidden', 403, '/usageReferences');
      const client = makeStructureClient(
        { ZBASE: 'define structure zbase { field : abap.char(1); }' },
        vi.fn(async () => {
          throw error;
        }),
      );
      const result = await buildStructureHierarchy(client, 'ZBASE');
      expect(result.extensionDiscovery?.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'denied' })]),
      );
      expect(result.warnings).toContain('http_403');
    });

    it('still finds the last append when exactly 12 candidates are returned', async () => {
      const candidates = Array.from({ length: 12 }, (_, i) => ({
        name: `ZREF${String(i).padStart(2, '0')}`,
        type: 'TABL/DS',
        uri: `/sap/bc/adt/ddic/structures/zref${i}`,
      }));
      const sources = Object.fromEntries(candidates.map(({ name }) => [name, `define structure ${name} { }`]));
      sources.ZBASE = 'define structure zbase { }';
      sources.ZREF11 = 'extend type zbase with zref49 { }';
      const client = makeStructureClient(
        sources,
        vi.fn(async (path: string) => ({ body: whereUsedXml(path.endsWith('ZBASE') ? candidates : []) })),
      );

      const result = await buildStructureHierarchy(client, 'ZBASE');
      expect(result.tree.children).toEqual([{ structure: 'ZREF11', kind: 'append', attribute: null, children: [] }]);
      expect(result.extensionDiscovery?.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ coverage: 'candidate_index' })]),
      );
    });

    it('retains collected root appends when a nested include exceeds the scan limit', async () => {
      const post = vi.fn(async (path: string) => ({
        body: whereUsedXml(
          path.endsWith('ZBASE')
            ? [{ name: 'ZAPPEND', type: 'TABL/DS', uri: '/sap/bc/adt/ddic/structures/zappend' }]
            : Array.from({ length: 51 }, (_, i) => ({
                name: `ZREF${i}`,
                type: 'TABL/DS',
                uri: `/sap/bc/adt/ddic/structures/zref${i}`,
              })),
        ),
      }));
      const client = makeStructureClient(
        {
          ZBASE: 'define structure zbase {\n include zinc;\n}',
          ZINC: 'define structure zinc { }',
          ZAPPEND: 'extend type zbase with zappend { }',
        },
        post,
      );
      const result = await buildStructureHierarchy(client, 'ZBASE');
      expect(result.summary).toMatchObject({ includes: 1, appends: 1 });
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('51 structure candidates for ZINC')]),
      );
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('preserves the root and reports a candidate source authorization failure', async () => {
      const client = makeStructureClient(
        { ZBASE: 'define structure zbase { }' },
        vi.fn(async () => ({
          body: whereUsedXml([{ name: 'ZDENIED', type: 'TABL/DS', uri: '/sap/bc/adt/ddic/structures/zdenied' }]),
        })),
      );
      const error = new AdtApiError('Forbidden', 403, '/sap/bc/adt/ddic/structures/zdenied');
      vi.mocked(client.getTabl).mockResolvedValueOnce({
        source: 'define structure zbase { }',
        notModified: false,
        statusCode: 200,
      });
      vi.mocked(client.getTabl).mockRejectedValueOnce(error);
      const result = await buildStructureHierarchy(client, 'ZBASE');
      expect(result.extensionDiscovery?.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'denied' })]),
      );
      expect(result.warnings).toContain('http_403');
    });

    it('marks recursive include cycles without treating shared children as cycles', async () => {
      const client = makeStructureClient(
        {
          ZROOT: `define structure zroot {
  include za;
  include zb;
}`,
          ZA: `define structure za {
  include zshared;
}`,
          ZB: `define structure zb {
  include zshared;
}`,
          ZSHARED: `define structure zshared {
  include zroot;
}`,
        },
        vi.fn(async () => ({ body: whereUsedXml([]) })),
      );

      const result = await buildStructureHierarchy(client, 'ZROOT', { includeExtensions: false });
      const [a, b] = result.tree.children;
      expect(a?.children[0]?.structure).toBe('ZSHARED');
      expect(a?.children[0]?.cyclic).toBeUndefined();
      expect(a?.children[0]?.children[0]?.structure).toBe('ZROOT');
      expect(a?.children[0]?.children[0]?.cyclic).toBe(true);
      expect(b?.children[0]?.structure).toBe('ZSHARED');
      expect(b?.children[0]?.cyclic).toBeUndefined();
    });
  });
});

function makeStructureClient(sources: Record<string, string>, post: ReturnType<typeof vi.fn>): TestClient {
  return {
    safety: unrestrictedSafetyConfig(),
    http: {
      post,
      get: vi.fn(async () => {
        throw new AdtApiError('Metadata unavailable', 404, '/metadata');
      }),
    } as unknown as AdtClient['http'],
    resolveTablObjectUrl: vi.fn(async (name: string) => `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`),
    getTabl: vi.fn(async (name: string, _opts?: SourceReadOptions): Promise<SourceReadResult> => {
      const source = sources[name.toUpperCase()];
      if (source === undefined) throw new AdtApiError('Not found', 404, `/sap/bc/adt/ddic/structures/${name}`);
      return { source, notModified: false, statusCode: 200 };
    }),
  };
}

function whereUsedXml(refs: Array<{ name: string; type: string; uri: string; isResult?: boolean }>): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
${refs
  .map(
    (ref) => `    <usageReferences:referencedObject uri="${ref.uri}" isResult="${ref.isResult ?? true}">
      <usageReferences:adtObject adtcore:name="${ref.name}" adtcore:type="${ref.type}" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>`,
  )
  .join('\n')}
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
}
