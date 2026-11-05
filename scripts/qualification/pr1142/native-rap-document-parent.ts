/** Only the exact owned SKTD relation may change after its acknowledged create or confirmed deletion. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import type { RapReceipt } from './native-rap-evidence.js';
import type { RapFixture } from './native-rap-fixtures.js';

const atom = 'http://www.w3.org/2005/Atom';
const relation = 'http://www.sap.com/adt/relations/dita/documentation';
const group = JSON.stringify(['element', atom, 'link']);
const rel = JSON.stringify(['attribute', '', 'rel']);
type Value = Array<[string, unknown]>;
export function assertRapDocumentParentTransition(
  parent: RapFixture,
  document: RapFixture,
  before: RapReceipt,
  after: RapReceipt,
  present: boolean,
): void {
  if (
    parent.type !== 'BDEF' ||
    document.type !== 'SKTD' ||
    parent.name !== document.name ||
    document.dependencies.length !== 1 ||
    document.dependencies[0] !== parent.owner ||
    !before.active ||
    !after.active ||
    before.metadataViews?.length !== 2 ||
    after.metadataViews?.length !== 2
  )
    throw new Error('Exact active BDEF/document coupling proof required.');
  const withoutMetadata = ({ fingerprint: _fingerprint, metadataViews: _views, ...rest }: RapReceipt) => rest;
  if (JSON.stringify(withoutMetadata(before)) !== JSON.stringify(withoutMetadata(after)))
    throw new Error('BDEF source/state changed with the document relation.');
  const expected = nativeXmlRoot(
    `<link xmlns="${atom}" href="${document.owner}" rel="${relation}" type="application/vnd.sap.adt.sktdv2+xml" title="DITA Documentation"/>`,
    'link',
    atom,
    true,
  ).canonicalValue({});
  const normalize = (value: string, wanted: boolean) => {
    const fields = JSON.parse(value) as Value;
    let count = 0;
    const normalized = fields.flatMap(([key, entries]) => {
      if (key !== group) return [[key, entries]];
      const remaining = (entries as Value[]).filter((link) => {
        if (!link.some(([key, value]) => key === rel && value === relation)) return true;
        count++;
        if (JSON.stringify(link) !== JSON.stringify(expected))
          throw new Error('Unqualified BDEF documentation relation.');
        return false;
      });
      return remaining.length ? [[key, remaining]] : [];
    });
    if (count !== (wanted ? 1 : 0)) throw new Error('Missing or ambiguous owned documentation relation.');
    return JSON.stringify(normalized);
  };
  for (let i = 0; i < 2; i++)
    if (normalize(before.metadataViews[i], !present) !== normalize(after.metadataViews[i], present))
      throw new Error('BDEF metadata changed outside its exact owned documentation relation.');
}
