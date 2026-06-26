import { describe, expect, it, vi } from 'vitest';
import type { AdtClient, SourceReadOptions, SourceReadResult } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { buildStructureHierarchy, parseEmbeddedStructures } from '../../../src/adt/structure-hierarchy.js';

type TestClient = Pick<AdtClient, 'getTabl' | 'resolveTablObjectUrl' | 'http' | 'safety'>;

describe('structure hierarchy', () => {
  describe('parseEmbeddedStructures', () => {
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
  });

  describe('buildStructureHierarchy', () => {
    it('uses scoped TABL where-used to find append structures and confirms extend source', async () => {
      const post = vi.fn(async (_path: string, body: string) => {
        if (body.includes('scopeRequest')) {
          return {
            body: `<?xml version="1.0"?>
<usageReferences:scopeResponse xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:objectType type="TABL/DS" description="Structure" count="2"/>
  <usageReferences:objectType type="CLAS/OC" description="Class" count="1"/>
</usageReferences:scopeResponse>`,
          };
        }
        if (body.includes('objectTypeFilter value="TABL/DS"')) {
          return {
            body: whereUsedXml([
              { name: 'ZAPPEND_OK', type: 'TABL/DS', uri: '/sap/bc/adt/ddic/structures/ZAPPEND_OK' },
              { name: 'ZAPPEND_NOPE', type: 'TABL/DS', uri: '/sap/bc/adt/ddic/structures/ZAPPEND_NOPE' },
            ]),
          };
        }
        return { body: whereUsedXml([]) };
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
      expect(post.mock.calls.some((call) => String(call[1]).includes('objectTypeFilter value="TABL/DS"'))).toBe(true);
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

    it('keeps the include tree when scoped where-used is rejected with HTTP 400', async () => {
      const post = vi.fn(async (_path: string, body: string) => {
        if (body.includes('scopeRequest')) {
          throw new AdtApiError(
            'No where-used scope available for this object',
            400,
            '/sap/bc/adt/repository/informationsystem/usageReferences/scope',
          );
        }
        return { body: whereUsedXml([]) };
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
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          'Where-used scope endpoint unavailable for ZBASE; append structure discovery may be incomplete.',
        ]),
      );
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
    http: { post } as unknown as AdtClient['http'],
    resolveTablObjectUrl: vi.fn(async (name: string) => `/sap/bc/adt/ddic/structures/${encodeURIComponent(name)}`),
    getTabl: vi.fn(async (name: string, _opts?: SourceReadOptions): Promise<SourceReadResult> => {
      const source = sources[name.toUpperCase()];
      if (source === undefined) throw new AdtApiError('Not found', 404, `/sap/bc/adt/ddic/structures/${name}`);
      return { source, notModified: false, statusCode: 200 };
    }),
  };
}

function whereUsedXml(refs: Array<{ name: string; type: string; uri: string }>): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
${refs
  .map(
    (ref) => `    <usageReferences:referencedObject uri="${ref.uri}" isResult="true">
      <usageReferences:adtObject adtcore:name="${ref.name}" adtcore:type="${ref.type}" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>`,
  )
  .join('\n')}
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
}
