import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BDEF_COLLECTION,
  bdefRelationRoot,
  selectBdefCandidates,
  supportsBdefCandidates,
} from '../../../src/adt/bdef-extension-candidates.js';
import { bdefExtensionTargets } from '../../../src/adt/bdef-extension-parser.js';
import { normalizeRelationNetwork, RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const root = bdefRelationRoot('DEMO_RAP_EXTENSIBLE');
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/extensions/${name}`, import.meta.url), 'utf8');

describe('BDEF candidate index', () => {
  it('replays the captured 758 WUL and verifies DEMO_RAP_EXTEND1 using actual active sources', () => {
    const network = normalizeRelationNetwork(fixture('bdef-wul.xml'), 'WUL', root);
    expect(selectBdefCandidates(network, root).map(({ name }) => name)).toEqual([
      'DEMO_RAP_EVENT_EXT',
      'DEMO_RAP_EXTEND1',
    ]);
    expect(bdefExtensionTargets(fixture('bdef-base.bdef'), fixture('bdef-extension.bdef'))).toEqual([
      'DEMO_RAP_EXTENSIBLE',
    ]);
  });

  it('excludes self, ordinary object types and disconnected references even with promising names', () => {
    const extension = relationObject('EXTENSION', 'BDEF/BDO');
    const ordinary = relationObject('EXTEND_BEHAVIOR_FOR_ROOT', 'CLAS/OC');
    const disconnected = relationObject('UNCONNECTED', 'BDEF/BDO');
    const network = normalizeRelationNetwork(
      relationXml(root, [extension, ordinary, disconnected], 'WUL'),
      'WUL',
      root,
    );
    network.edges = network.edges.filter((edge) => edge.from !== disconnected.uri);
    network.edges.push({
      from: root.uri,
      to: root.uri,
      context: 'WUL',
      kind: 'uses',
      evidence: 'sap_relation_explorer',
      direct: null,
    });
    expect(selectBdefCandidates(network, root)).toEqual([extension]);
  });

  it('rejects a BDEF candidate whose name does not own its URI', () => {
    const extension = relationObject('EXTENSION', 'BDEF/BDO');
    const network = normalizeRelationNetwork(relationXml(root, [extension], 'WUL'), 'WUL', root);
    network.objects[1]!.name = 'OTHER';
    expect(() => selectBdefCandidates(network, root)).toThrow('identity/URI mismatch');
  });

  it.each(['750', '7.50', '757'])('does not qualify release %s from a generic RAP or relation endpoint', (release) => {
    expect(
      supportsBdefCandidates(
        new Map([
          [RELATIONS_PATH, [RELATIONS_MIME]],
          [BDEF_COLLECTION, []],
        ]),
        release,
      ),
    ).toBe(false);
  });

  it('requires the exact BDEF collection and native relation MIME even on 758', () => {
    const discovery = new Map([
      [RELATIONS_PATH, [RELATIONS_MIME]],
      [BDEF_COLLECTION, []],
    ]);
    expect(supportsBdefCandidates(discovery, '758')).toBe(true);
    discovery.delete(BDEF_COLLECTION);
    discovery.set('/sap/bc/adt/ddic/ddl/sources', []);
    expect(supportsBdefCandidates(discovery, '758')).toBe(false);
  });

  it.each(['ENV', 'EXTED_OBJ'])('rejects a successful wrong-context response: %s', (context) => {
    expect(() => normalizeRelationNetwork(relationXml(root, [], context), 'WUL', root)).toThrow('context');
  });

  it('rejects a wrong-root network before treating anything as a candidate', () => {
    expect(() => normalizeRelationNetwork(relationXml(bdefRelationRoot('OTHER'), [], 'WUL'), 'WUL', root)).toThrow(
      'root',
    );
  });

  it('treats a missing native context as malformed metadata', () => {
    const xml = relationXml(root, [], 'WUL').replace('<activeContext>WUL</activeContext>', '');
    expect(() => normalizeRelationNetwork(xml, 'WUL', root)).toThrow('metadata field');
  });
});
