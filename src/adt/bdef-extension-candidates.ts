import { parseReleaseNumber } from './release.js';
import {
  type RelationNetwork,
  type RelationObject,
  RelationProtocolError,
  relationObjectUri,
  supportsRelations,
} from './repository-relations.js';

export const BDEF_COLLECTION = '/sap/bc/adt/bo/behaviordefinitions';

/** Generic RAP availability only probes CDS and cannot qualify behavior extensions on 750. */
export function supportsBdefCandidates(discovery: ReadonlyMap<string, string[]>, release?: string): boolean {
  const number = parseReleaseNumber(release);
  return !(number !== undefined && number < 758) && discovery.has(BDEF_COLLECTION) && supportsRelations(discovery);
}

export function bdefRelationRoot(name: string): RelationObject {
  return {
    name: name.toUpperCase(),
    type: 'BDEF/BDO',
    uri: relationObjectUri('BDEF', name),
    package: '',
    version: 'active',
    existence: 'observed_reference',
  };
}

/** Keep only incoming WUL references connected to this root. Fetch paths are rebuilt from names. */
export function selectBdefCandidates(network: RelationNetwork, root: RelationObject): RelationObject[] {
  const incoming = new Set(
    network.edges.filter((edge) => edge.context === 'WUL' && edge.to === root.uri).map((edge) => edge.from),
  );
  const candidates = new Map<string, RelationObject>();
  for (const object of network.objects) {
    if (object.uri === root.uri || object.type !== 'BDEF/BDO' || !incoming.has(object.uri)) continue;
    if (object.version !== 'active' || object.uri !== relationObjectUri('BDEF', object.name))
      throw new RelationProtocolError('behavior candidate identity/URI mismatch.');
    candidates.set(object.uri, object);
  }
  return [...candidates.values()];
}
