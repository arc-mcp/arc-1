import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { RELATION_OBJECTS } from '../../../src/adt/relation-objects.js';
import { NativeRelationProvider, parseRelationXml } from '../../../src/adt/repository-relations.js';
import { escapeXmlAttr } from '../../../src/adt/xml-parser.js';

// Independent citation map, like SLASH_TYPE_EVIDENCE, but test-owned: no production I/O or citation payload.
const RELATION_OBJECT_EVIDENCE: Record<string, string> = {
  'CLAS/OC': 'clas',
  'INTF/OI': 'intf',
  'DDLS/DF': 'ddls',
  'DCLS/DL': 'dcls',
  'BDEF/BDO': 'bdef',
  'SRVD/SRV': 'srvd',
  'TABL/DT': 'tabl',
  'TABL/DS': 'tabl',
  'TTYP/DA': 'ttyp',
  'DTEL/DE': 'dtel',
  'DOMA/DD': 'doma',
  'PROG/P': 'prog',
  'PROG/I': 'incl',
  'FUGR/F': 'fugr',
  'FUGR/FF': 'func',
  'VIEW/DV': 'view',
  'ENHO/XHB': 'enho',
  'MSAG/N': 'msag',
  'TRAN/T': 'tran',
  'SHLP/DH': 'shlp',
  'SKTD/TYP': 'sktd',
  'ENHS/XSB': 'enhs',
  'ENQU/DL': 'enqu',
  'TYPE/DG': 'type',
  'EVTB/EVB': 'evtb',
  'DSFD/SCF': 'dsfd',
};
interface RecordedIdentity {
  source: {
    sapBasis: string;
    metadataMethod: string;
    metadataPath: string;
    metadataSha256: string;
    networkSha256: string;
    observedEdges: number;
  };
  type: string;
  native: string;
  name: string;
  uri: string;
  metadataRootQName: string;
  context: 'ENV' | 'WUL';
  metadataXml: string;
  networkXml: string;
}
const repo = new URL('../../../', import.meta.url);
const fixtureName = (native: string) => `${native.toLowerCase().replace('/', '-')}.json`;
const recorded = (native: string): RecordedIdentity =>
  JSON.parse(readFileSync(new URL(`tests/fixtures/relations/${fixtureName(native)}`, repo), 'utf8'));
const canonicalEscapes = (uri: string) => uri.replace(/%[a-f0-9]{2}/gi, (part) => part.toUpperCase());

function evidenceGaps(
  specs: ReadonlyArray<{ native: string; type: string; metadataRoot: string }>,
  evidence = RELATION_OBJECT_EVIDENCE,
) {
  const gaps: string[] = [];
  const keys = specs.map((spec) => spec.native);
  if (new Set(keys).size !== keys.length || keys.slice().sort().join() !== Object.keys(evidence).sort().join())
    gaps.push('evidence keys');
  for (const spec of specs) {
    if (!evidence[spec.native]) continue;
    const fixture = recorded(spec.native);
    const doc = readFileSync(new URL(`docs/research/abap-types/types/${evidence[spec.native]}.md`, repo), 'utf8');
    if (!doc.includes(`### ${spec.native}`) || !doc.includes(`adtcore:type="${spec.native}"`))
      gaps.push(`${spec.native}: citation`);
    if (fixture.native !== spec.native || fixture.type !== spec.type) gaps.push(`${spec.native}: identity`);
    if (
      fixture.metadataRootQName.split(':').at(-1) !== spec.metadataRoot ||
      !(spec.metadataRoot in parseRelationXml(fixture.metadataXml))
    )
      gaps.push(`${spec.native}: metadataRoot`);
  }
  return gaps;
}

afterEach(() => vi.restoreAllMocks());
describe('independent recorded relation evidence', () => {
  it('requires exactly one cited fixture per native identity', () => {
    expect(evidenceGaps(RELATION_OBJECTS)).toEqual([]);
    expect(
      readdirSync(new URL('tests/fixtures/relations/', repo))
        .filter((name) => name.endsWith('.json'))
        .sort(),
    ).toEqual(Object.keys(RELATION_OBJECT_EVIDENCE).map(fixtureName).sort());
  });
  it('detects missing citations, wrong documents and copied-but-wrong metadata roots', () => {
    const { 'ENQU/DL': _missing, ...missing } = RELATION_OBJECT_EVIDENCE;
    expect(evidenceGaps(RELATION_OBJECTS, missing)).toContain('evidence keys');
    expect(evidenceGaps(RELATION_OBJECTS, { ...RELATION_OBJECT_EVIDENCE, 'ENQU/DL': 'clas' })).toContain(
      'ENQU/DL: citation',
    );
    expect(
      evidenceGaps(
        RELATION_OBJECTS.map((spec) => (spec.type === 'ENQU' ? { ...spec, metadataRoot: 'invented' } : spec)),
      ),
    ).toContain('ENQU/DL: metadataRoot');
  });
  it.each(RELATION_OBJECTS)(
    '$native replays observed GET metadata and a native edge, not generated XML envelopes',
    async (spec) => {
      const fixture = recorded(spec.native);
      expect(fixture.source.sapBasis).toBe('758');
      expect(fixture.source.metadataMethod).toBe('GET');
      expect(fixture.source.metadataPath).toBe(fixture.uri);
      expect(fixture.source.metadataSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.source.networkSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.source.observedEdges).toBeGreaterThan(0);
      const client = new AdtClient({ baseUrl: 'http://not-contacted.invalid' });
      const resolution = `<objectReferences><objectReference name="${escapeXmlAttr(fixture.name)}" type="${fixture.native}" uri="${escapeXmlAttr(fixture.uri)}"/></objectReferences>`;
      const get = vi.spyOn(client.http, 'get').mockImplementation(async (path) => {
        if (!path.includes('informationsystem/search')) expect(path).toBe(canonicalEscapes(fixture.uri));
        return {
          statusCode: 200,
          headers: {},
          body: path.includes('informationsystem/search') ? resolution : fixture.metadataXml,
        };
      });
      vi.spyOn(client.http, 'post').mockResolvedValue({ statusCode: 200, headers: {}, body: fixture.networkXml });
      const provider = new NativeRelationProvider(client, {});
      const root = await provider.validateRoot(spec.type, fixture.name);
      expect(root).toMatchObject({
        type: fixture.native,
        name: fixture.name.toUpperCase(),
        uri: canonicalEscapes(fixture.uri),
        existence: 'metadata_validated',
      });
      expect(get).toHaveBeenCalledTimes(spec.resolve === 'quickSearch' ? 2 : 1);
      const network = await provider.lookup(root, fixture.context === 'ENV' ? 'outgoing' : 'incoming');
      expect(network.edges).toHaveLength(1);
      expect(network.objects.find((node) => node.uri === root.uri)?.type).toBe(fixture.native);
    },
  );
});
