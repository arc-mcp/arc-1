/** Native identity evidence for standalone procedural sources; package-only checks cannot identify aliases. */
import type { AdtClient } from './client.js';
import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import { checkPackage } from './safety.js';

const core = 'http://www.sap.com/adt/core';
export interface PinnedProgramOwnerEvidence {
  packageName: string;
  includeUsage?: {
    contextRefCount?: number;
    contexts: { uri: string; name: string; packageName?: string }[];
  };
}

export async function readPinnedProgramOwner(
  client: AdtClient,
  owner: string,
): Promise<PinnedProgramOwnerEvidence | undefined> {
  const selected = /^\/sap\/bc\/adt\/programs\/(programs|includes)\/([^/]+)$/.exec(owner);
  if (!selected) return undefined;
  const name = decodeURIComponent(selected[2]!).toUpperCase();
  const program = selected[1] === 'programs';
  const namespace = `http://www.sap.com/adt/programs/${selected[1]}`;
  const response = await client.http.get(owner, { Accept: 'application/*', 'Cache-Control': 'no-cache' });
  function refuse(): never {
    throw new AdtSafetyError(
      'Pinned procedural mutations require a standalone native PROG/INCL owner with its own package. Function-group, generated or ambiguous container sources need their dedicated adapter.',
    );
  }
  const root = nativeXmlRoot(response.body, program ? 'abapProgram' : 'abapInclude', namespace);
  if (root.attribute('name', core) !== name || root.attribute('type', core) !== (program ? 'PROG/P' : 'PROG/I'))
    refuse();
  const pkg = root.child('packageRef', core);
  const packageName = pkg?.attribute('name', core);
  if (pkg?.attribute('type', core) !== 'DEVC/K' || !packageName) refuse();
  if (root.hasChild('containerRef')) refuse();
  if (
    program &&
    !['executableProgram', 'subroutinePool', 'modulePool'].includes(root.attribute('programType', namespace) ?? '')
  )
    refuse();
  const contexts = root.children('contextRef', namespace);
  const usages: NonNullable<PinnedProgramOwnerEvidence['includeUsage']>['contexts'] = [];
  for (const ref of contexts) {
    const uri = ref.attribute('uri', core);
    if (ref.attribute('type', core) !== 'PROG/P' || !uri) refuse();
    const context = /^\/sap\/bc\/adt\/programs\/programs\/([^/]+)(?:\/source\/main)?$/.exec(uri);
    if (!context) refuse();
    let contextName: string;
    try {
      contextName = decodeURIComponent(context[1]!).toUpperCase();
    } catch {
      refuse();
    }
    if (
      !/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/.test(contextName) ||
      /^(?:\/[^/]+\/)?SAPL/.test(contextName) ||
      (ref.attribute('name', core) !== undefined && ref.attribute('name', core) !== contextName)
    )
      refuse();
    usages.push({
      uri,
      name: contextName,
      ...(ref.attribute('packageName', core) !== undefined ? { packageName: ref.attribute('packageName', core) } : {}),
    });
  }
  const rawCount = root.attribute('contextRefCount', namespace);
  const count = rawCount === undefined ? undefined : Number(rawCount);
  if (
    count !== undefined &&
    (!/^\d+$/.test(String(rawCount)) || !Number.isSafeInteger(count) || count < contexts.length)
  )
    refuse();
  // Usage information is not a complete ownership/where-used list. Do not follow or authorize these resources.
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  return {
    packageName,
    ...(!program
      ? { includeUsage: { ...(count === undefined ? {} : { contextRefCount: count }), contexts: usages } }
      : {}),
  };
}

export async function verifyPinnedProgramOwner(client: AdtClient, owner: string): Promise<string | undefined> {
  return (await readPinnedProgramOwner(client, owner))?.packageName;
}
