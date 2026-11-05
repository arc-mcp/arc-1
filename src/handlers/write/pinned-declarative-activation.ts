/** Private exact-owner CDS/RAP activation evidence, reused by the common activation orchestrator. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../adt/client.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import type { ActivationReference } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import {
  pinnedDeclarativeMetadata,
  pinnedDeclarativeSelection,
  pinnedDeclarativeStateLinkVersion,
} from '../../adt/pinned-repository-owner.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';

const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const core = 'http://www.sap.com/adt/core';

export function selectPrivateDeclarativeActivation(args: Record<string, unknown>) {
  const fields = new Set(['type', 'name', 'action', 'preaudit']);
  if (
    Object.keys(args).some((key) => args[key] !== undefined && !fields.has(key)) ||
    (args.preaudit !== undefined && args.preaudit !== true) ||
    (args.action !== undefined && args.action !== 'activate')
  )
    throw new AdtSafetyError('The private declarative activation profile selects one complete source owner only.');
  return pinnedDeclarativeSelection(args.type, args.name);
}

export function declarativeActivationEvidence(
  client: AdtClient,
  selected: ReturnType<typeof pinnedDeclarativeSelection>,
) {
  let captured: Awaited<ReturnType<typeof metadata>> | undefined;
  let sourceHash: string | undefined;
  async function metadata(version?: 'active') {
    checkOperation(client.safety, OperationType.Read, 'DeclarativeActivationEvidence');
    const response = await client.http.get(
      selected.objectUrl + (version ? '?version=active' : ''),
      { Accept: 'application/*', 'Cache-Control': 'no-cache' },
      { responseBudget: new DataResponseBudget(1024 * 1024, 'declarative-activation-metadata', true) },
    );
    const { root, packageName } = pinnedDeclarativeMetadata(response.body, selected, true);
    await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
    const nativeVersion = root.attribute('version', core);
    if (nativeVersion !== 'active' && nativeVersion !== 'inactive')
      throw new AdtSafetyError('Native declarative metadata lacks an explicit version.');
    let inactiveAlternative = false;
    let alternatives = 0;
    for (const link of root.children('link', 'http://www.w3.org/2005/Atom')) {
      if (link.attribute('rel', '') !== 'http://www.sap.com/adt/relations/objectstates') continue;
      const alternative = pinnedDeclarativeStateLinkVersion(
        selected.type,
        selected.objectUrl,
        link.attribute('href', ''),
      );
      if (++alternatives !== 1 || alternative === undefined)
        throw new AdtSafetyError('Unexpected or duplicate declarative version alternative.');
      inactiveAlternative = alternative === 'inactive';
    }
    return {
      packageName,
      version: nativeVersion,
      inactiveAlternative,
      // Compare complete metadata only across preaudit. Activation may legitimately derive metadata from source.
      hash: hash(JSON.stringify(root.canonicalValue({}))),
    };
  }
  async function source(version: 'active' | 'inactive') {
    checkOperation(client.safety, OperationType.Read, 'DeclarativeActivationEvidence');
    const response = await client.http.get(
      `${selected.objectUrl}/source/main?version=${version}`,
      { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
      { responseBudget: new DataResponseBudget(1024 * 1024, 'declarative-activation-source', true) },
    );
    if (
      !Object.entries(response.headers).some(
        ([key, value]) =>
          key.toLowerCase() === 'content-type' && value.split(';', 1)[0].trim().toLowerCase() === 'text/plain',
      )
    )
      throw new AdtSafetyError('Declarative activation source did not return native text.');
    return hash(response.body);
  }
  return {
    validateReferences(refs: readonly ActivationReference[]) {
      if (
        refs.length !== 1 ||
        refs.some(
          (ref) =>
            canonical(ref.uri) !== canonical(selected.objectUrl) ||
            (ref.name !== undefined && ref.name.trim() !== selected.name) ||
            (ref.type !== undefined && ref.type !== selected.native) ||
            (ref.deleted !== undefined && ref.deleted !== 'false'),
        )
      )
        throw new AdtSafetyError(
          'Declarative activation expanded beyond the selected native owner; no confirmation was sent.',
        );
    },
    async capture() {
      const current = await metadata();
      const currentSource = await source('inactive');
      if (captured && (current.hash !== captured.hash || currentSource !== sourceHash))
        throw new AdtSafetyError('The selected declarative draft changed during preaudit; no confirmation was sent.');
      captured ??= current;
      sourceHash ??= currentSource;
      return current.packageName;
    },
    async verify() {
      if (!captured || !sourceHash) throw new AdtSafetyError('Declarative activation lacks captured source evidence.');
      for (const version of [undefined, 'active'] as const) {
        const current = await metadata(version);
        if (current.packageName !== captured.packageName || current.version !== 'active' || current.inactiveAlternative)
          throw new AdtSafetyError('Native declarative metadata does not confirm the selected active owner.');
      }
      if ((await source('active')) !== sourceHash)
        throw new AdtSafetyError('Native active declarative source differs from the captured draft.');
    },
    get previousVersion() {
      return captured?.version;
    },
    get wasAlreadyActive() {
      return captured?.version === 'active' && !captured.inactiveAlternative;
    },
    get sourceHash() {
      return sourceHash;
    },
  };
}
