/** Match an object or its source/include paths, never another object's name prefix. */
export function activationDetailMatchesObject(detailUri: string | undefined, objectUri: string): boolean {
  const normalize = (uri: string) => uri.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  const object = normalize(objectUri);
  const detail = detailUri ? normalize(detailUri) : '';
  return !!object && !!detail && (detail === object || detail.startsWith(`${object}/`));
}
