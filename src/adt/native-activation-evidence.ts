/** Exact native fields used at pinned activation's confirmation boundary. */
import type { ActivationReference } from './devtools.js';
import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';

export function nativeInactiveReferences(xml: string): Array<ActivationReference & { name: string }> {
  const ioc = 'http://www.sap.com/abapxml/inactiveCtsObjects';
  const core = 'http://www.sap.com/adt/core';
  const root = nativeXmlRoot(xml, 'inactiveObjects', ioc);
  const refs: Array<ActivationReference & { name: string }> = [];
  for (const entry of root.children('entry', ioc)) {
    const object = entry.child('object', ioc);
    if (!object) continue; // Native transport-only rows carry no object to activate.
    for (const ref of object.children('ref', ioc)) {
      const uri = ref.attribute('uri', core),
        name = ref.attribute('name', core);
      if (!uri || !name) throw new AdtSafetyError('Native preaudit reference has no object identity.');
      const type = ref.attribute('type', core),
        deleted = object.attribute('deleted', ioc);
      refs.push({ uri, name, ...(type === undefined ? {} : { type }), ...(deleted === undefined ? {} : { deleted }) });
    }
  }
  if (!refs.length) throw new AdtSafetyError('Native preaudit contains no identified objects.');
  return refs;
}

export function nativeActivationExecuted(xml: string): boolean {
  const ns = 'http://www.sap.com/abapxml/checklist';
  return nativeXmlRoot(xml, 'messages', ns).child('properties', ns)?.attribute('activationExecuted', '') === 'true';
}
