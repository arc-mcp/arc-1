/** OData service information of a service binding: services, versions, URLs, entity sets and navigations. */
import { AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

const BINDING_ACCEPT = 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml';
const INFO_COLLECTIONS: Record<string, string> = {
  V2: '/sap/bc/adt/businessservices/odatav2',
  V4: '/sap/bc/adt/businessservices/odatav4',
};

type XmlNode = Record<string, unknown>;

export interface ServiceEntitySet {
  name: string;
  isRoot: boolean;
  navigations: Array<{ name: string; target: string }>;
}

export interface ServiceVersionInfo {
  serviceName: string;
  serviceVersion: string;
  serviceDefinition: string;
  releaseState?: string;
  published?: boolean;
  /** Path relative to the SAP host, exactly as SAP reports it. */
  serviceUrl?: string;
  entitySets?: ServiceEntitySet[];
  note?: string;
}

export interface ServiceBindingInfo {
  name: string;
  bindingType: string;
  odataVersion: string;
  bindingCategory: string;
  services: ServiceVersionInfo[];
  note?: string;
}

function nodes(value: unknown): XmlNode[] {
  if (value === undefined || value === null || typeof value !== 'object') return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function attribute(node: XmlNode | undefined, name: string): string {
  return String(node?.[`@_${name}`] ?? '');
}

function bindingCategory(category: string): string {
  if (category === '0') return 'UI';
  return category === '1' ? 'Web API' : category;
}

function parseEntitySets(service: XmlNode): ServiceEntitySet[] {
  const information = nodes(service.serviceInformation)[0];
  return nodes(information?.collection).map((collection) => ({
    name: attribute(collection, 'name'),
    isRoot: attribute(collection, 'isRoot') === 'true',
    navigations: nodes(collection.navigation).map((navigation) => ({
      name: attribute(navigation, 'name'),
      target: attribute(navigation, 'target'),
    })),
  }));
}

/** Parses the V2 `serviceList` or V4 `serviceGroup` document for one service version. */
export function parseServiceInfoDocument(
  xml: string,
  serviceName: string,
  serviceVersion: string,
): Pick<ServiceVersionInfo, 'published' | 'serviceUrl' | 'entitySets' | 'note'> {
  const parsed = parseXml(xml);
  const root = nodes(parsed.serviceList ?? parsed.serviceGroup)[0];
  const service = nodes(root?.services).find(
    (entry) =>
      attribute(entry, 'serviceId').toUpperCase() === serviceName.toUpperCase() &&
      attribute(entry, 'serviceVersion') === serviceVersion,
  );
  // A missing entry must not look like a service without entity sets.
  if (!service) throw new AdtError(`SAP returned no service information for ${serviceName} version ${serviceVersion}.`);

  // V2 reports the publish state per service, V4 on the group.
  const published = attribute(service, 'published') || attribute(root, 'published');
  const serviceUrl = attribute(service, 'serviceUrl');
  if (published !== 'true') {
    return {
      published: published === 'false' ? false : undefined,
      ...(serviceUrl ? { serviceUrl } : {}),
      note:
        published === 'false'
          ? 'SAP reports no entity sets for a service that is not published; publish it to read them (SAPActivate action=publish_srvb).'
          : 'SAP did not report a recognized publication state; entity sets are unknown.',
    };
  }
  if (service.serviceInformation === undefined) {
    return { published: true, ...(serviceUrl ? { serviceUrl } : {}), note: 'SAP returned no entity-set information.' };
  }
  return { published: true, serviceUrl, entitySets: parseEntitySets(service) };
}

/** Reads the binding, then the service information of each service version it declares. */
export async function getServiceBindingInfo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
): Promise<ServiceBindingInfo> {
  checkOperation(safety, OperationType.Read, 'GetServiceBindingInfo');
  const response = await http.get(`/sap/bc/adt/businessservices/bindings/${encodeURIComponent(name)}`, {
    Accept: BINDING_ACCEPT,
  });
  const parsed = parseXml(response.body);
  const binding = nodes(parsed.serviceBinding)[0];
  const details = nodes(binding?.binding)[0];
  const bindingType = attribute(details, 'type');
  const odataVersion = attribute(details, 'version');
  const declared = nodes(binding?.services).flatMap((service) =>
    nodes(service.content).map((content) => ({
      serviceName: attribute(service, 'name'),
      serviceVersion: attribute(content, 'version'),
      serviceDefinition: attribute(nodes(content.serviceDefinition)[0], 'name'),
      ...(attribute(content, 'releaseState') ? { releaseState: attribute(content, 'releaseState') } : {}),
    })),
  );

  const info: ServiceBindingInfo = {
    name: attribute(binding, 'name') || name,
    bindingType,
    odataVersion,
    bindingCategory: bindingCategory(attribute(details, 'category')),
    services: declared,
  };
  const collection = bindingType === 'ODATA' ? INFO_COLLECTIONS[odataVersion] : undefined;
  if (!collection) {
    return { ...info, note: 'Service information is available only for OData V2 and V4 bindings.' };
  }

  const services: ServiceVersionInfo[] = [];
  for (const service of declared) {
    const query = new URLSearchParams({
      servicename: service.serviceName,
      serviceversion: service.serviceVersion,
      srvdname: service.serviceDefinition,
    });
    const document = await http.get(`${collection}/${encodeURIComponent(info.name)}?${query}`);
    services.push({
      ...service,
      ...parseServiceInfoDocument(document.body, service.serviceName, service.serviceVersion),
    });
  }
  return { ...info, services };
}
