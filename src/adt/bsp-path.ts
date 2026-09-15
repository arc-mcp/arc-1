export interface ResolvedBspPath {
  appName: string;
  path?: string;
}

export const BSP_OBJECTS_PATH = '/sap/bc/adt/filestore/ui5-bsp/objects';

export function bspContentPath(appName: string, path?: string): string {
  const cleanPath = path?.replace(/^\/+/, '') ?? '';
  const objectPath = cleanPath ? `${appName.toUpperCase()}/${cleanPath}` : appName.toUpperCase();
  return `${BSP_OBJECTS_PATH}/${encodeURIComponent(objectPath)}/content`;
}

function normalizeBspPath(path: string | undefined): string | undefined {
  const normalized = path?.replace(/^\/+|\/+$/g, '');
  return normalized || undefined;
}

function combineBspPaths(first: string | undefined, second: string | undefined): string | undefined {
  const normalizedFirst = normalizeBspPath(first);
  const normalizedSecond = normalizeBspPath(second);
  return [normalizedFirst, normalizedSecond].filter((part): part is string => Boolean(part)).join('/') || undefined;
}

/**
 * Separate a BSP application name from an optionally appended repository path.
 *
 * `/NS/APP` is indistinguishable from an ordinary app/path with a stray leading slash, so it is
 * treated as a namespaced application root. Ordinary application names must omit a leading slash;
 * callers can put their case-sensitive repository path in `appendedPath` instead.
 */
export function resolveBspNameAndPath(name: string, appendedPath?: string): ResolvedBspPath {
  const namespaceEnd = name.startsWith('/') ? name.indexOf('/', 1) : -1;
  const pathStart = namespaceEnd >= 0 ? name.indexOf('/', namespaceEnd + 1) : name.indexOf('/');
  if (pathStart <= 0) {
    const path = normalizeBspPath(appendedPath);
    return { appName: name, ...(path ? { path } : {}) };
  }

  const path = combineBspPaths(name.slice(pathStart + 1), appendedPath);
  return { appName: name.slice(0, pathStart), ...(path ? { path } : {}) };
}
