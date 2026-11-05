import { createHash } from 'node:crypto';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { AdtClient } from './client.js';
import { AdtSafetyError } from './errors.js';
import type { AdtRequestOptions } from './http.js';
import { nativeXmlRoot, readNativeMetadata } from './native-xml-evidence.js';
import { assertPinnedNativeName } from './pinned-managed-resources.js';
import { pinnedDeclarativeSelection } from './pinned-repository-owner.js';
import { checkOperation, checkPackage, OperationType } from './safety.js';
import { escapeXmlAttr } from './xml-parser.js';

const SRVB = 'http://www.sap.com/adt/ddic/ServiceBindings';

const core = 'http://www.sap.com/adt/core';

const publicationBookkeeping = new Set(
  [
    ['attribute', core, 'changedAt'],
    ['attribute', core, 'changedBy'],
    ['attribute', SRVB, 'published'],
    ['attribute', SRVB, 'bindingCreated'],
  ].map((key) => JSON.stringify(key)),
);

export const SERVICE_BINDING_COLLECTION = '/sap/bc/adt/businessservices/bindings';

const ACCEPT = 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml';

export interface PinnedBindingSelection {
  name: string;
  objectUrl: string;
}

export function pinnedBindingSelection(name: unknown): PinnedBindingSelection {
  assertPinnedNativeName(name, 'Service binding');
  return { name, objectUrl: `${SERVICE_BINDING_COLLECTION}/${encodeURIComponent(name)}` };
}

export interface PinnedBindingEvidence extends PinnedBindingSelection {
  packageName: string;
  nativeVersion?: string;
  description?: string;
  language?: string;
  changedAt?: string;
  published?: boolean;
  bindingCreated?: boolean;
  bindingType?: string;
  odataVersion?: string;
  category?: string;
  implementation?: string;
  /** Every native service/content pair, unmerged: multi-version documents are not silently narrowed. */
  services: { name?: string; version?: string; serviceDefinition?: string }[];
  metadataHash: string;
  /** Whole-document identity/scope excluding only native publication/bookkeeping flags. */
  publicationHash: string;
  inactiveAlternative: boolean;
}

const flag = (value: string | undefined) => (value === 'true' ? true : value === 'false' ? false : undefined);

export function parsePinnedBinding(xml: string, selected: PinnedBindingSelection): PinnedBindingEvidence {
  const root = nativeXmlRoot(xml, 'serviceBinding', SRVB, true);
  const pkg = root.child('packageRef', core);
  const packageName = pkg?.attribute('name', core);
  if (
    root.attribute('name', core) !== selected.name ||
    root.attribute('type', core) !== 'SRVB/SVB' ||
    root.hasChild('containerRef') ||
    (pkg?.attribute('type', core) !== undefined && pkg?.attribute('type', core) !== 'DEVC/K') ||
    !packageName
  )
    throw new AdtSafetyError('The native service binding identity and own package could not be verified.');
  const services = root.children('services', SRVB).flatMap((service) => {
    const contents = service.children('content', SRVB);
    return (contents.length ? contents : [undefined]).map((content) => {
      const definition = content?.child('serviceDefinition', SRVB);
      const definitionName = definition?.attribute('name', core);
      if (definitionName !== undefined) {
        // The native link must really be a service definition of that exact name.
        const expected = pinnedDeclarativeSelection('SRVD', definitionName);
        const type = definition?.attribute('type', core);
        const uri = definition?.attribute('uri', core);
        if (
          (type !== undefined && type !== 'SRVD/SRV') ||
          (uri !== undefined && uri.toLowerCase() !== expected.objectUrl.toLowerCase())
        )
          throw new AdtSafetyError('The native service definition link is not type and name matched.');
      }
      return {
        name: service.attribute('name', SRVB),
        version: content?.attribute('version', SRVB),
        serviceDefinition: definitionName,
      };
    });
  });
  const bindings = root.children('binding', SRVB);
  if (bindings.length > 1) throw new AdtSafetyError('The native service binding has several binding blocks.');
  const binding = bindings[0];
  const alternatives = root
    .children('link', 'http://www.w3.org/2005/Atom')
    .filter((link) => link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
  if (
    alternatives.length > 1 ||
    alternatives.some((link) => {
      const parts = (link.attribute('href', '') ?? '').split('?');
      const [path, query] = parts;
      return (
        parts.length !== 2 ||
        path?.toLowerCase() !== selected.objectUrl.toLowerCase() ||
        (query !== 'version=active' && query !== 'version=inactive')
      );
    })
  )
    throw new AdtSafetyError('Unexpected native service-binding version alternative.');
  // Reuse one canonical traversal so ordinary reads retain their existing element budget.
  const canonical = root.canonicalValue({}) as [string, unknown][];
  return {
    ...selected,
    packageName,
    nativeVersion: root.attribute('version', core),
    description: root.attribute('description', core),
    language: root.attribute('language', core),
    changedAt: root.attribute('changedAt', core),
    published: flag(root.attribute('published', SRVB)),
    bindingCreated: flag(root.attribute('bindingCreated', SRVB)),
    bindingType: binding?.attribute('type', SRVB),
    odataVersion: binding?.attribute('version', SRVB),
    category: binding?.attribute('category', SRVB),
    implementation: binding?.child('implementation', SRVB)?.attribute('name', core) || undefined,
    services,
    inactiveAlternative: alternatives[0]?.attribute('href', '')?.endsWith('?version=inactive') === true,
    publicationHash: createHash('sha256')
      .update(JSON.stringify(canonical.filter(([key]) => !publicationBookkeeping.has(key))))
      .digest('hex'),
    metadataHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  };
}

/** Identity and full native content for ordinary reads; no write-package authorization here. */
export async function readBindingDocument(
  client: AdtClient,
  selected: PinnedBindingSelection,
  version?: 'active',
  request?: AdtRequestOptions,
): Promise<{ xml: string; evidence: PinnedBindingEvidence }> {
  checkOperation(client.safety, OperationType.Read, 'PinnedServiceBindingEvidence');
  const response = await readNativeMetadata(
    client.http,
    selected.objectUrl + (version ? `?version=${version}` : ''),
    'service-binding-metadata',
    request,
    ACCEPT,
  );
  const evidence = parsePinnedBinding(response.body, selected);
  return { xml: response.body, evidence };
}

/** Mutation callers always enforce the actual native package. */
export async function readPinnedBinding(
  client: AdtClient,
  selected: PinnedBindingSelection,
  version?: 'active',
): Promise<PinnedBindingEvidence> {
  const { evidence } = await readBindingDocument(client, selected, version);
  await checkPackage(client.safety, evidence.packageName, client.getPackageHierarchyResolver());
  return evidence;
}

/** Exactly one service/version pair; several versions need an explicit, individually verified selection. */
export function singlePinnedBindingService(evidence: PinnedBindingEvidence, version?: string) {
  const matches = evidence.services.filter((service) => version === undefined || service.version === version);
  const service = matches[0];
  if (matches.length !== 1 || !service?.version || !service.name)
    throw new AdtSafetyError('Select one exact native service version of this binding.');
  return { ...service, name: service.name, version: service.version };
}

export const BINDING_XML_TYPE = 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml';

const srvb = 'http://www.sap.com/adt/ddic/ServiceBindings';

const xmlOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
  commentPropName: '#comment',
};

type Node = Record<string, unknown>;

const local = (key: string) => key.slice(key.lastIndexOf(':') + 1);

function one(nodes: Node[], name: string): { node: Node; key: string; children: Node[] } {
  const matches = nodes.flatMap((node) =>
    Object.keys(node)
      .filter((key) => key !== ':@' && local(key) === name)
      .map((key) => ({ node, key, children: node[key] as Node[] })),
  );
  if (matches.length !== 1 || !Array.isArray(matches[0]?.children))
    throw new AdtSafetyError('The service-binding document does not have one unambiguous editable node.');
  return matches[0];
}

function attribute(node: Node, name: string, value: string, exemplar: string) {
  const attrs = node[':@'] as Record<string, string> | undefined;
  if (!attrs) throw new AdtSafetyError('Missing native service-binding attributes.');
  const keys = Object.keys(attrs).filter((k) => k.startsWith('@_') && local(k) === name);
  const sample = Object.keys(attrs).filter((k) => k.startsWith('@_') && local(k) === exemplar);
  if (keys.length > 1 || (!keys.length && sample.length !== 1))
    throw new AdtSafetyError('Ambiguous service-binding attribute.');
  const key = keys[0] ?? sample[0]!.replace(new RegExp(`${exemplar}$`), name);
  attrs[key] = escapeXmlAttr(value);
}

export interface PinnedBindingPatch {
  description?: string;
  serviceDefinition?: string;
  odataVersion?: 'V2' | 'V4';
  category?: '0' | '1';
  version?: string;
}

/** Native root/type/package and editable paths are namespace-checked before selecting lexical nodes. */
export function patchPinnedBindingDocument(
  xml: string,
  selected: PinnedBindingSelection,
  patch: PinnedBindingPatch,
): string {
  const before = parsePinnedBinding(xml, selected);
  singlePinnedBindingService(before);
  if (before.services.length !== 1 || !before.services[0]?.serviceDefinition || before.bindingType !== 'ODATA')
    throw new AdtSafetyError('A binding update requires one native OData service/content pair.');
  const nodes = new XMLParser(xmlOptions).parse(xml) as Node[];
  const root = one(nodes, 'serviceBinding');
  if (patch.description !== undefined) attribute(root.node, 'description', patch.description, 'name');
  const service = one(root.children, 'services');
  const content = one(service.children, 'content');
  const definition = one(content.children, 'serviceDefinition');
  if (patch.serviceDefinition !== undefined) {
    attribute(definition.node, 'name', patch.serviceDefinition, 'name');
    const attrs = definition.node[':@'] as Record<string, string>;
    if (Object.keys(attrs).some((key) => local(key) === 'uri'))
      attribute(definition.node, 'uri', pinnedDeclarativeSelection('SRVD', patch.serviceDefinition).objectUrl, 'name');
  }
  if (patch.version !== undefined) attribute(content.node, 'version', patch.version, 'version');
  const binding = one(root.children, 'binding');
  if (patch.odataVersion !== undefined) attribute(binding.node, 'version', patch.odataVersion, 'type');
  if (patch.category !== undefined) attribute(binding.node, 'category', patch.category, 'type');
  const body = new XMLBuilder(xmlOptions).build(nodes) as string;
  const after = parsePinnedBinding(body, selected);
  if (
    after.description !== (patch.description ?? before.description) ||
    after.services[0]?.serviceDefinition !== (patch.serviceDefinition ?? before.services[0]?.serviceDefinition) ||
    after.services[0]?.version !== (patch.version ?? before.services[0]?.version) ||
    after.odataVersion !== (patch.odataVersion ?? before.odataVersion) ||
    after.category !== (patch.category ?? before.category)
  )
    throw new AdtSafetyError('The service-binding patch did not preserve the selected native identities.');
  return body;
}

/** Save/activation may change only these root bookkeeping attributes; all opaque content is retained. */
export function bindingStableDocument(xml: string): string {
  return JSON.stringify(
    nativeXmlRoot(xml, 'serviceBinding', srvb, true).canonicalValue({
      omitAttribute: (name, namespace, depth) =>
        depth === 0 && namespace === core && ['version', 'changedAt', 'changedBy'].includes(name),
    }),
  );
}

const key = (kind: 'attribute' | 'element', namespace: string, name: string) => JSON.stringify([kind, namespace, name]);

type Fields = Array<[string, unknown]>;

const value = (fields: Fields, selected: string) => fields.find(([name]) => name === selected)?.[1];

const remove = (fields: Fields, selected: string) => fields.filter(([name]) => name !== selected);

const emptyBindingData = JSON.stringify([
  [key('element', core, 'content'), [[[key('attribute', core, 'encoding'), 'base64']]]],
]);

/** Full metadata/preaudit hashes and save/publication projections are deliberately unchanged. */
export function bindingActivationMatches(
  beforeXml: string,
  afterXml: string,
  selected: PinnedBindingSelection,
): boolean {
  const before = parsePinnedBinding(beforeXml, selected),
    after = parsePinnedBinding(afterXml, selected);
  if (bindingStableDocument(beforeXml) === bindingStableDocument(afterXml)) return true;
  // The existing non-generated profile is unchanged. This alternate proof is only a first
  // activation of one owned, unpublished V4 service/version (native Web API evidence; UI source contract).
  if (
    before.nativeVersion !== 'inactive' ||
    after.nativeVersion !== 'active' ||
    before.bindingCreated !== false ||
    after.bindingCreated !== true ||
    before.published !== false ||
    after.published !== false ||
    before.bindingType !== 'ODATA' ||
    before.odataVersion !== 'V4' ||
    !['0', '1'].includes(before.category ?? '') ||
    before.implementation !== selected.name ||
    before.services.length !== 1 ||
    after.services.length !== 1
  )
    return false;
  const service = before.services[0]!;
  if (
    !service.name ||
    !service.serviceDefinition ||
    !service.version ||
    !/^\d{4}$/.test(service.version) ||
    service.version === '0000'
  )
    return false;
  assertPinnedNativeName(service.name, 'Binding service');
  const beforeRoot = nativeXmlRoot(beforeXml, 'serviceBinding', srvb, true);
  const afterRoot = nativeXmlRoot(afterXml, 'serviceBinding', srvb, true);
  if (
    beforeRoot.attribute('releaseSupported', srvb) !== 'true' ||
    afterRoot.attribute('releaseSupported', srvb) !== 'true'
  )
    return false;
  const beforeContract = beforeRoot.attribute('contract', srvb),
    afterContract = afterRoot.attribute('contract', srvb);
  const expectedContract = before.category === '0' ? 'C1' : 'C2';
  if (afterContract !== expectedContract || (beforeContract !== undefined && beforeContract !== afterContract))
    return false;
  const project = (xml: string) =>
    nativeXmlRoot(xml, 'serviceBinding', srvb, true).canonicalValue({
      omitAttribute: (name, namespace, depth) =>
        depth === 0 &&
        ((namespace === core && ['version', 'changedAt', 'changedBy'].includes(name)) ||
          (namespace === srvb && (name === 'bindingCreated' || (name === 'contract' && beforeContract === undefined)))),
    }) as Fields;
  const oldFields = project(beforeXml),
    newFields = project(afterXml);
  // Select exact expanded structural segments, never a same-named subtree in an opaque extension.
  const serviceKey = key('element', srvb, 'services'),
    contentKey = key('element', srvb, 'content');
  const oldServices = value(oldFields, serviceKey) as Fields[] | undefined;
  const newServices = value(newFields, serviceKey) as Fields[] | undefined;
  if (oldServices?.length !== 1 || newServices?.length !== 1) return false;
  const oldContents = value(oldServices[0]!, contentKey) as Fields[] | undefined;
  const newContents = value(newServices[0]!, contentKey) as Fields[] | undefined;
  if (oldContents?.length !== 1 || newContents?.length !== 1) return false;
  const dataKey = key('element', srvb, 'bindingTypeData');
  if (value(oldContents[0]!, dataKey) === undefined) {
    const newData = value(newContents[0]!, dataKey) as Fields[] | undefined;
    if (newData !== undefined) {
      // Only the getter's empty base64 content wrapper is a derived addition. Extra attributes,
      // duplicate children, foreign namespaces, scalar text or nonempty payload remain differences.
      if (newData.length !== 1 || JSON.stringify(newData[0]) !== emptyBindingData) return false;
      const field = newServices[0]!.find(([name]) => name === contentKey)!;
      field[1] = [remove(newContents[0]!, dataKey)];
    }
  }
  return JSON.stringify(oldFields) === JSON.stringify(newFields);
}
