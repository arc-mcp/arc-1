/** Match an object or its source/include paths, never another object's name prefix. */
export function activationDetailMatchesObject(detailUri: string | undefined, objectUri: string): boolean {
  const normalize = (uri: string) => {
    try {
      // SAP may encode the same name differently, e.g. TABLE%7e001 versus TABLE~001.
      return decodeURIComponent(uri.replace(/#.*$/, '')).replace(/\/+$/, '').toLowerCase();
    } catch {
      return '';
    }
  };
  const object = normalize(objectUri);
  const detail = detailUri ? normalize(detailUri) : '';
  return !!object && !!detail && (detail === object || detail.startsWith(`${object}/`));
}
