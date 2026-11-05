/** Mock native controller semantics: upsert incoming rows, remove only explicit deletion instructions. */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { nativeXmlCharacterRoot } from '../../../src/adt/native-xml-evidence.js';

const mc = 'http://www.sap.com/adt/MessageClass';
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  cdataPropName: '#cdata',
  commentPropName: '#comment',
});
const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: false,
  cdataPropName: '#cdata',
  commentPropName: '#comment',
});
type Node = Record<string, any>;
function parsed(xml: string) {
  const tree = parser.parse(xml) as Node[];
  const root = tree.find((n) => Object.keys(n).some((k) => k.split(':').at(-1) === 'messageClass'))!;
  const key = Object.keys(root).find((k) => k.split(':').at(-1) === 'messageClass')!;
  const body = root[key] as Node[];
  const rows = body.filter((n) => Object.keys(n).some((k) => k.split(':').at(-1) === 'messages'));
  const semantic = nativeXmlCharacterRoot(xml, 'messageClass', mc);
  const numbers = semantic.children('messages', mc).map((r) => r.attribute('msgno', mc)!);
  if (numbers.length !== rows.length) throw new Error('Mock native row shape mismatch.');
  return { tree, body, rows, numbers, semantic };
}
export function nativeMessageSave(before: string, incoming: string): string {
  const old = parsed(before),
    next = parsed(incoming);
  const removed = new Set(next.semantic.children('deletedmessages', mc).map((r) => r.attribute('msgno', mc)!));
  if ([...removed].some((n) => !/^\d{3}$/.test(n))) throw new Error('Mock refuses implicit native default 000.');
  for (let i = next.body.length - 1; i >= 0; i--) {
    const rowIndex = next.rows.indexOf(next.body[i]);
    if (
      Object.keys(next.body[i]).some((k) => k.split(':').at(-1) === 'deletedmessages') ||
      (rowIndex >= 0 && removed.has(next.numbers[rowIndex]))
    )
      next.body.splice(i, 1);
  }
  for (let i = 0; i < old.rows.length; i++) {
    if (!next.numbers.includes(old.numbers[i]) && !removed.has(old.numbers[i])) next.body.push(old.rows[i]);
  }
  return builder.build(next.tree);
}
