/** Shared literal state alternatives; identity is validated before this check, links are never followed. */
import type { NativeXmlElement } from '../../../src/adt/native-xml-evidence.js';
export function assertDdicStateAlternatives(
  root: NativeXmlElement,
  fixture: { owner: string; name: string; type?: string },
  active: boolean,
) {
  // A4H/758 emits exactly this relative spelling for an index's complementary version.
  // Match the one encoded separator literally; do not decode or follow arbitrary URLs.
  const indexAlias =
    fixture.type === 'TABL/DTI' &&
    root.attribute('type', 'http://www.sap.com/adt/core') === 'TABL/DTI' &&
    root.attribute('name', 'http://www.sap.com/adt/core') === fixture.name &&
    /^[A-Z][A-Z0-9_]{0,29}~[A-Z0-9]{1,3}$/.test(fixture.name) &&
    fixture.owner === `/sap/bc/adt/ddic/db/indexes/${fixture.name.toLowerCase()}`
      ? [`./${fixture.name.replaceAll('~', '%7e')}`]
      : [];
  // Only literal same-owner alternatives are evidence; URLs are never followed.
  const links = root
    .children('link', 'http://www.w3.org/2005/Atom')
    .filter((l) => l.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
  if (
    links.length > 1 ||
    links.some((l) => {
      const href = l.attribute('href', '');
      const state = (['active', 'inactive'] as const).find((version) => {
        const query = `?version=${version}`;
        return (
          href?.endsWith(query) &&
          [fixture.owner, `${fixture.owner}/source/main`, `./${fixture.name}`, ...indexAlias].some(
            (owner) => owner.toLowerCase() === href.slice(0, -query.length).toLowerCase(),
          )
        );
      });
      return !state || (active && state === 'inactive');
    })
  )
    throw new Error('DDIC state alternative unconfirmed.');
}
