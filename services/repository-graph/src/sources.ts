const INITIAL_OBJECT_TYPES = ['CLAS', 'INTF', 'PROG', 'DDLS'];
export function sourcePathFromObject(object: { OBJECT_TYPE: string; OBJECT_URI: string }): string {
  const baseType = object.OBJECT_TYPE.split('/', 1)[0]?.toUpperCase();
  if (!INITIAL_OBJECT_TYPES.some((allowed) => allowed === baseType)) {
    throw new Error(`Unsupported source type ${object.OBJECT_TYPE}`);
  }
  const url = new URL(object.OBJECT_URI, 'https://sap.invalid');
  if (!url.pathname.startsWith('/sap/bc/adt/')) {
    throw new Error(`Unsafe ADT object URI ${object.OBJECT_URI}`);
  }
  return `${url.pathname.replace(/\/$/, '')}/source/main`;
}
