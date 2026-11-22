import type { AdtClient } from './client.js';

/** TABL subtype (`TABL/DT`, `TABL/DS`) from repository search; undefined without an exact TABL hit.
 *  Uncached and probe-free. Throws when the search fails. */
export async function searchTablSubtype(
  client: Pick<AdtClient, 'searchObject'>,
  name: string,
): Promise<string | undefined> {
  const upper = name.toUpperCase();
  // NPL 7.50 appends a localized suffix to adtcore:name ("T000 (Database Table)",
  // "BAPIRET2 (Structure)"), so strip parenthesized text before matching. A4H
  // and modern releases return just the bare name; both forms must work.
  // Only TABL hits count: a same-named program must not hide the table's subtype.
  const match = (await client.searchObject(name, 5)).find((r) => {
    const bare = String(r.objectName ?? '')
      .replace(/\s*\(.*$/, '')
      .toUpperCase();
    return bare === upper && String(r.objectType ?? '').startsWith('TABL');
  });
  return match?.objectType;
}
