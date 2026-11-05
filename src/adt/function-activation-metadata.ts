import { createHash } from 'node:crypto';
import type { ActivationReference } from './devtools.js';
import { AdtSafetyError } from './errors.js';
import { type NativeXmlElement, nativeXmlRoot } from './native-xml-evidence.js';
import { type PinnedFunctionSelection, pinnedFunctionSelection } from './pinned-repository-owner.js';

export interface FunctionActivationMetadata {
  version: 'active' | 'inactive';
  hash: string;
  inactiveAlternative: boolean;
}

export function functionActivationMetadata(
  xml: string,
  selected: PinnedFunctionSelection,
  packageName: string,
): FunctionActivationMetadata {
  if (selected.type !== 'FUNC' && selected.type !== 'INCL')
    throw new AdtSafetyError('Metadata proof requires a function child.');
  const module = selected.type === 'FUNC';
  const core = 'http://www.sap.com/adt/core',
    atom = 'http://www.w3.org/2005/Atom';
  const root = nativeXmlRoot(
    xml,
    module ? 'abapFunctionModule' : 'abapFunctionGroupInclude',
    `http://www.sap.com/adt/functions/${module ? 'fmodules' : 'fincludes'}`,
    true,
  );
  const version = root.attribute('version', core);
  const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F');
  const container = root.child('containerRef', core),
    ownPackage = root.child('packageRef', core);
  if (
    root.attribute('name', core) !== selected.name ||
    root.attribute('type', core) !== (module ? 'FUGR/FF' : 'FUGR/I') ||
    container?.attribute('name', core) !== selected.group ||
    container.attribute('type', core) !== 'FUGR/F' ||
    canonical(container.attribute('uri', core) ?? '') !== canonical(selected.groupUrl) ||
    container.attribute('packageName', core) !== packageName ||
    (ownPackage !== undefined &&
      (ownPackage.attribute('name', core) !== packageName || ownPackage.attribute('type', core) !== 'DEVC/K')) ||
    (version !== 'active' && version !== 'inactive')
  )
    throw new AdtSafetyError('Default function metadata lacks the selected native identity or version.');
  let alternatives = 0,
    inactiveAlternative = false;
  const source = `${canonical(selected.objectUrl)}/source/main`;
  const sourceLinks = new WeakSet<NativeXmlElement>();
  const content = root.canonicalValue({
    omitAttribute: (name, ns, depth, element) =>
      (depth === 0 && ns === core && (name === 'version' || name === 'changedAt')) ||
      (sourceLinks.has(element) && ns === '' && name === 'etag'),
    omitChild: (name, ns, child, depth) => {
      if (
        depth === 1 &&
        name === 'link' &&
        ns === atom &&
        child.attribute('rel', '') === 'http://www.sap.com/adt/relations/source' &&
        child.attribute('href', '') === 'source/main' &&
        ['text/plain', 'text/html'].includes(child.attribute('type', '') ?? '')
      )
        sourceLinks.add(child);
      if (
        depth !== 1 ||
        name !== 'link' ||
        ns !== atom ||
        child.attribute('rel', '') !== 'http://www.sap.com/adt/relations/objectstates'
      )
        return false;
      const href = canonical(child.attribute('href', '') ?? '');
      if (++alternatives !== 1 || (href !== `${source}?version=active` && href !== `${source}?version=inactive`))
        throw new AdtSafetyError('Unexpected or duplicate function version alternative.');
      inactiveAlternative = href.endsWith('?version=inactive');
      return true;
    },
  });
  return { version, inactiveAlternative, hash: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
}

const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F');

export function assertPinnedGroupGenerationReferences(
  owner: string,
  name: unknown,
  refs: readonly ActivationReference[],
): void {
  const selected = pinnedFunctionSelection('FUGR', name);
  if (
    canonical(owner) !== canonical(selected.groupUrl) ||
    refs.length !== 1 ||
    refs.some(
      (ref) =>
        canonical(ref.uri) !== canonical(selected.groupUrl) ||
        (ref.name !== undefined && ref.name.trim() !== selected.name) ||
        (ref.type !== undefined && ref.type !== 'FUGR/F') ||
        (ref.deleted !== undefined && ref.deleted !== 'false'),
    )
  )
    throw new AdtSafetyError('Native group generation requires exactly the selected function group.');
}

/** Generation-only evidence cannot establish that any function-module draft was activated. */
export function nativeFunctionGroupExecution(xml: string): 'activation' | 'generation' | undefined {
  const ns = 'http://www.sap.com/abapxml/checklist';
  const properties = nativeXmlRoot(xml, 'messages', ns).child('properties', ns);
  if (properties?.attribute('activationExecuted', '') === 'true') return 'activation';
  if (
    properties?.attribute('activationExecuted', '') === 'false' &&
    properties.attribute('generationExecuted', '') === 'true'
  )
    return 'generation';
  return undefined;
}
