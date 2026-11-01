import { type RelationObject, relationObjectUri } from '../../src/adt/repository-relations.js';
import { escapeXmlAttr } from '../../src/adt/xml-parser.js';

export const relationObject = (name: string, type = 'CLAS/OC', pkg = 'ZTEST'): RelationObject => ({
  uri: relationObjectUri(type.split('/')[0]!, name),
  name,
  type,
  package: pkg,
  version: 'active',
  existence: 'observed_reference',
});
export const relationMetadata = (object: RelationObject) => {
  const tag = object.type === 'CLAS/OC' ? 'abapClass' : 'abapInterface';
  return `<${tag} name="${escapeXmlAttr(object.name)}" type="${object.type}" version="active"><packageRef name="${escapeXmlAttr(object.package)}"/></${tag}>`;
};
export const relationXml = (root: RelationObject, others: RelationObject[], context = 'ENV') =>
  `<networkResponse><activeContext>${context}</activeContext>${[root, ...others]
    .map(
      (o) =>
        `<objectReference uri="${escapeXmlAttr(o.uri)}" name="${escapeXmlAttr(o.name)}" type="${o.type}" packageName="${escapeXmlAttr(o.package)}" exists="true" version="active"/>`,
    )
    .join('')}${others
    .map(
      (o) =>
        `<relation relationType="parentChild" state="A"><object1>${escapeXmlAttr(root.uri)}</object1><object2>${escapeXmlAttr(o.uri)}</object2></relation>`,
    )
    .join('')}</networkResponse>`;
