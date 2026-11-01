/** Native identity evidence for standalone procedural sources; package-only checks cannot identify aliases. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { parseXml } from '../../adt/xml-parser.js';

export async function verifyPinnedProgramOwner(client: AdtClient, owner: string): Promise<string | undefined> {
  const selected = /^\/sap\/bc\/adt\/programs\/(programs|includes)\/([^/]+)$/.exec(owner);
  if (!selected) return undefined;
  const name = decodeURIComponent(selected[2]!).toUpperCase();
  const program = selected[1] === 'programs';
  const response = await client.http.get(owner, { Accept: 'application/*', 'Cache-Control': 'no-cache' });
  const refuse = () => {
    throw new AdtSafetyError(
      'Pinned procedural edits require a standalone native PROG/INCL owner with its own package. Function-group, generated or ambiguous container sources need their dedicated adapter.',
    );
  };
  if (Buffer.byteLength(response.body, 'utf8') > 1024 * 1024) refuse();
  const root = parseXml(response.body)[program ? 'abapProgram' : 'abapInclude'] as Record<string, unknown> | undefined;
  if (!root || Array.isArray(root) || root['@_name'] !== name || root['@_type'] !== (program ? 'PROG/P' : 'PROG/I'))
    refuse();
  const pkg = root!.packageRef as Record<string, unknown> | undefined;
  if (!pkg || Array.isArray(pkg) || pkg['@_type'] !== 'DEVC/K' || typeof pkg['@_name'] !== 'string' || !pkg['@_name'])
    refuse();
  if (root!.containerRef !== undefined) refuse();
  if (program && !['executableProgram', 'subroutinePool', 'modulePool'].includes(String(root!['@_programType'])))
    refuse();
  const contexts =
    root!.contextRef === undefined ? [] : Array.isArray(root!.contextRef) ? root!.contextRef : [root!.contextRef];
  for (const ref of contexts) {
    if (
      !ref ||
      typeof ref !== 'object' ||
      ref['@_type'] !== 'PROG/P' ||
      typeof ref['@_uri'] !== 'string' ||
      !/^\/sap\/bc\/adt\/programs\/programs\/[^/]+\/source\/main$/.test(ref['@_uri'])
    )
      refuse();
  }
  // contextRefCount is usage information, not a complete ownership list; do not follow or authorize those resources.
  return pkg!['@_name'] as string;
}
