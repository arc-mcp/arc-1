/** Namespace-bound v1 ST05 fields; OFF defaults are grounded in the captured 758 kernel contract. */
import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';

const NS = 'http://www.sap.com/adt/tools/performance/tracestate';
const TYPES = ['sqlOn', 'bufOn', 'enqOn', 'rfcOn', 'httpOn', 'apcOn', 'amcOn', 'authOn'];
const FILTERS = ['traceUser', 'transactionCode', 'program', 'rfcFunction', 'url', 'wpId'];
const RESET_PROPERTIES = ['includeMissingTableNameOn', 'authErrorsOnly', 'includedTables', 'excludedTables'];
type Fields = Array<[string, string | Fields[]]>;
const key = (name: string) => JSON.stringify(['element', NS, name]);
const refusal = () => new AdtSafetyError('Unknown native ST05 state XML.');
function children(fields: Fields, name: string): Fields[] {
  const value = fields.find(([k]) => k === key(name))?.[1];
  if (!Array.isArray(value)) throw refusal();
  return value;
}
function one(fields: Fields, name: string): Fields {
  const found = children(fields, name);
  if (found.length !== 1) throw refusal();
  return found[0];
}
function text(fields: Fields): string {
  if (!fields.length) return '';
  if (fields.length !== 1 || fields[0][0] !== 'text' || typeof fields[0][1] !== 'string') throw refusal();
  return fields[0][1];
}
function known(fields: Fields, names: string[]): boolean {
  return fields.length === names.length && fields.every(([k]) => names.some((name) => key(name) === k));
}

/** Unknown fields remain in comparison. Only exact native fields at their owning depth are omitted. */
export function st05NativeState(xml: string) {
  // This v1 profile has no qualified numeric-reference representation; avoid semantic collisions
  // in the legacy XML parser while preserving the submitted opaque bytes.
  if (/&#/.test(xml)) throw new AdtSafetyError('Unqualified ST05 character-reference representation.');
  const root = nativeXmlRoot(xml, 'traceStateInstanceTable', NS, true).canonicalValue({}) as Fields;
  const instances = children(root, 'traceStateInstance');
  const identities = instances.map((node) => {
    // These response-owned values may change, but their attributes/descendants are not disposable.
    for (const name of ['modificationUser', 'modificationDateTime', 'isLocal', 'isSelected']) {
      if (!node.some(([k]) => k === key(name))) continue;
      const scalar = text(one(node, name));
      if (['isLocal', 'isSelected'].includes(name) && !['true', 'false'].includes(scalar)) throw refusal();
    }
    const types = one(node, 'traceTypes');
    if (!known(types, TYPES)) throw refusal();
    for (const type of TYPES) if (!['true', 'false'].includes(text(one(types, type)))) throw refusal();
    const properties = one(node, 'traceProperties');
    for (const name of ['stackTraceOn', 'includeMissingTableNameOn', 'authErrorsOnly'])
      if (!['true', 'false'].includes(text(one(properties, name)))) throw refusal();
    return {
      instance: text(one(node, 'instance')),
      sqlOn: text(one(types, 'sqlOn')) === 'true',
      otherOn: TYPES.slice(1).some((type) => text(one(types, type)) === 'true'),
      user: text(one(one(node, 'traceFilter'), 'traceUser')),
    };
  });
  const project = (off: boolean) =>
    JSON.stringify(
      root.map(([k, value]) => {
        if (k !== key('traceStateInstance')) return [k, value];
        return [
          k,
          [...instances]
            .sort((a, b) => text(one(a, 'instance')).localeCompare(text(one(b, 'instance'))))
            .map((node) =>
              node
                .filter(
                  ([name]) =>
                    !['modificationUser', 'modificationDateTime', 'isLocal', 'isSelected'].some((v) => name === key(v)),
                )
                .map(([name, v]) => {
                  if (name === key('traceTypes'))
                    return [name, [one(node, 'traceTypes').filter(([n]) => n !== key('sqlOn'))]];
                  if (name === key('traceFilter')) {
                    const fields = one(node, 'traceFilter');
                    if (off && !known(fields, FILTERS))
                      throw new AdtSafetyError('Cannot verify native OFF normalization of unknown ST05 filter fields.');
                    return [
                      name,
                      [
                        fields
                          .filter(([n]) => n !== key('traceUser'))
                          .map(([n, val]) => {
                            if (!off) return [n, val];
                            text((val as Fields[])[0]);
                            if ((val as Fields[]).length !== 1) throw refusal();
                            return [n, [[]]];
                          }),
                      ],
                    ];
                  }
                  if (off && name === key('traceProperties')) {
                    const fields = one(node, 'traceProperties');
                    if (!known(fields, [...RESET_PROPERTIES, 'stackTraceOn']))
                      throw new AdtSafetyError('Cannot verify native OFF normalization of unknown ST05 properties.');
                    return [
                      name,
                      [
                        fields.map(([n, val]) => {
                          const original = (val as Fields[])[0];
                          if ((val as Fields[]).length !== 1) throw refusal();
                          if (n === key('stackTraceOn')) return [n, val];
                          if (n === key('includedTables') || n === key('excludedTables')) {
                            // No captured nonempty table-list wire contract: do not discard opaque descendants.
                            if (original.length)
                              throw new AdtSafetyError(
                                'Nonempty ST05 table selections require a qualified OFF representation.',
                              );
                            return [n, val];
                          }
                          if (!['true', 'false'].includes(text(original))) throw refusal();
                          return [n, [[['text', 'false']]]];
                        }),
                      ],
                    ];
                  }
                  return [name, v];
                }),
            ),
        ];
      }),
    );
  return { identities, unrelated: project(false), offUnrelated: () => project(true) };
}
