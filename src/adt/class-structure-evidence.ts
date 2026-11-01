/** Bind SAP objectstructure to this owner and the same editable source, without following its links. */
import { Expressions, type Nodes } from '@abaplint/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { classSourceEvidence, refuseClassEvidence, type SourceBlock } from './class-source-evidence.js';
import type { LineRange } from './types.js';
import { parseClassStructure } from './xml-parser.js';

const origin = 'https://class-evidence.invalid';
const relation = 'http://www.sap.com/adt/relations/source/';
const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false });
type Element = Record<string, unknown>;
function relativeReference(value: unknown): string {
  if (typeof value !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\'))
    refuseClassEvidence();
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) <= 32) refuseClassEvidence();
  return value;
}
function elements(value: unknown): Element[] {
  if (value === undefined) return [];
  const result = Array.isArray(value) ? value : [value];
  if (result.some((v) => !v || typeof v !== 'object' || Array.isArray(v))) refuseClassEvidence();
  return result as Element[];
}
function sameRange(actual: LineRange, first: Nodes.StatementNode, last = first): void {
  const start = first.getFirstToken().getStart();
  // Native blocks end at the terminating period/comma token, including whitespace before it.
  const terminal = last.getLastToken();
  if (!['.', ','].includes(terminal.getStr())) refuseClassEvidence();
  const end = terminal.getStart();
  if (
    !end ||
    actual.sr !== start.getRow() ||
    actual.sc !== start.getCol() - 1 ||
    actual.er !== end.getRow() ||
    actual.ec !== end.getCol() - 1
  )
    refuseClassEvidence();
}

export function verifiedClassStructure(xml: string, source: string, name: string, owner: string, sapClient: string) {
  if (xml.length > 1024 * 1024 || /<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) refuseClassEvidence();
  const parsed = parser.parse(xml) as Element;
  const roots = elements(parsed['abapsource:objectStructureElement']);
  if (roots.length !== 1) refuseClassEvidence();
  const root = roots[0]!;
  if (
    root['@_adtcore:type'] !== 'CLAS/OC' ||
    root['@_adtcore:name'] !== name ||
    root['@_xmlns:adtcore'] !== 'http://www.sap.com/adt/core' ||
    root['@_xmlns:abapsource'] !== 'http://www.sap.com/adt/abapsource' ||
    root['@_xmlns:atom'] !== 'http://www.w3.org/2005/Atom'
  )
    refuseClassEvidence();
  const base = new URL(`${owner}/objectstructure`, origin);
  if (root['@_xml:base'] !== undefined) {
    if (typeof root['@_xml:base'] !== 'string') refuseClassEvidence();
    const supplied = new URL(relativeReference(root['@_xml:base']), base);
    if (
      supplied.origin !== origin ||
      supplied.pathname.toLowerCase() !== base.pathname.toLowerCase() ||
      supplied.hash ||
      [...supplied.searchParams.keys()].some((k) => !['sap-client', 'sap-language'].includes(k)) ||
      supplied.searchParams.getAll('sap-client').length > 1 ||
      supplied.searchParams.getAll('sap-language').length > 1 ||
      (supplied.searchParams.has('sap-client') && supplied.searchParams.get('sap-client') !== sapClient)
    )
      refuseClassEvidence();
  }
  function ranges(element: Element): Map<string, LineRange> {
    const found = new Map<string, LineRange>();
    if (
      element !== root &&
      (element['@_xml:base'] !== undefined || Object.keys(element).some((k) => k.startsWith('@_xmlns:')))
    )
      refuseClassEvidence();
    for (const link of elements(element['atom:link'])) {
      const rel = link['@_rel'];
      if (typeof rel !== 'string' || !rel.startsWith(relation)) continue;
      const key = rel.slice(relation.length);
      if (!['definitionBlock', 'implementationBlock', 'definitionIdentifier', 'implementationIdentifier'].includes(key))
        continue;
      const href = link['@_href'];
      if (found.has(key) || link['@_xml:base'] !== undefined || Object.keys(link).some((k) => k.startsWith('@_xmlns:')))
        refuseClassEvidence();
      const url = new URL(relativeReference(href), base);
      if (
        url.origin !== origin ||
        url.pathname.toLowerCase() !== `${owner}/source/main`.toLowerCase() ||
        url.search ||
        url.username ||
        url.password
      )
        refuseClassEvidence();
      const match = /^#start=(\d+),(\d+);end=(\d+),(\d+)$/.exec(url.hash);
      if (!match) refuseClassEvidence();
      const [sr, sc, er, ec] = match.slice(1).map(Number);
      if (![sr, sc, er, ec].every(Number.isSafeInteger) || sr! < 1 || er! < sr! || (sr === er && ec! < sc!))
        refuseClassEvidence();
      found.set(key, { sr: sr!, sc: sc!, er: er!, ec: ec! });
    }
    return found;
  }
  function verifyBlock(found: Map<string, LineRange>, key: string, expected: SourceBlock | undefined) {
    const value = found.get(key);
    if (!!value !== !!expected) refuseClassEvidence();
    if (value && expected) sameRange(value, expected.first, expected.last);
  }
  function verifyIdentifier(
    found: Map<string, LineRange>,
    key: string,
    expectedName: string,
    header: Nodes.StatementNode | undefined,
    interfaceReference = false,
  ) {
    const value = found.get(key);
    if (!value) return;
    const identifier = interfaceReference
      ? header?.findFirstExpression(Expressions.InterfaceName)
      : (header?.findFirstExpression(Expressions.MethodName) ?? header?.findFirstExpression(Expressions.ClassName));
    if (!identifier) refuseClassEvidence();
    const start = identifier.getFirstToken().getStart(),
      end = identifier.getLastToken().getEnd();
    if (
      value.sr !== start.getRow() ||
      value.sc !== start.getCol() - 1 ||
      value.er !== end.getRow() ||
      value.ec !== end.getCol() - 1 ||
      identifier.concatTokens().toUpperCase() !== expectedName
    )
      refuseClassEvidence();
  }
  const evidence = classSourceEvidence(source, name);
  const rootRanges = ranges(root);
  verifyBlock(rootRanges, 'definitionBlock', evidence.definition);
  verifyBlock(rootRanges, 'implementationBlock', evidence.implementation);
  verifyIdentifier(rootRanges, 'definitionIdentifier', name, evidence.definition.first);
  verifyIdentifier(rootRanges, 'implementationIdentifier', name, evidence.implementation?.first);
  const declarations = new Set<string>(),
    implementations = new Set<string>();
  for (const child of elements(root['abapsource:objectStructureElement'])) {
    if (!['CLAS/OM', 'CLAS/OO'].includes(String(child['@_adtcore:type']))) continue;
    if (child['abapsource:objectStructureElement'] !== undefined) refuseClassEvidence();
    const method = child['@_adtcore:name'];
    if (typeof method !== 'string' || method !== method.toUpperCase()) refuseClassEvidence();
    for (const key of ['@_abstract', '@_redefinition'])
      if (child[key] !== undefined && child[key] !== 'true' && child[key] !== 'false') refuseClassEvidence();
    const found = ranges(child);
    const declaration = found.get('definitionBlock'),
      implementation = found.get('implementationBlock');
    if (!declaration && !implementation) refuseClassEvidence();
    const expected = evidence.methods.get(method),
      body = evidence.bodies.get(method);
    if (declaration) {
      if (
        !expected ||
        declarations.has(method) ||
        child['@_visibility'] !== expected.visibility ||
        child['@_level'] !== expected.level ||
        (child['@_abstract'] === 'true') !== expected.abstract ||
        (child['@_redefinition'] === 'true') !== expected.redefinition
      )
        refuseClassEvidence();
      sameRange(declaration, expected.declaration);
      declarations.add(method);
    }
    if (implementation) {
      if (!body || implementations.has(method)) refuseClassEvidence();
      sameRange(implementation, body.first, body.last);
      implementations.add(method);
    }
    if (expected) verifyIdentifier(found, 'definitionIdentifier', method, expected.declaration);
    else {
      const interfaceName = method.split('~')[0]!;
      const reference = method.includes('~') ? evidence.interfaces.get(interfaceName) : undefined;
      if (
        !reference ||
        child['@_visibility'] !== reference.visibility ||
        !['instance', 'static'].includes(String(child['@_level'])) ||
        child['@_abstract'] === 'true' ||
        child['@_redefinition'] === 'true'
      )
        refuseClassEvidence();
      verifyIdentifier(found, 'definitionIdentifier', interfaceName, reference.declaration, true);
    }
    verifyIdentifier(found, 'implementationIdentifier', method, body?.first);
  }
  if (declarations.size !== evidence.methods.size || implementations.size !== evidence.bodies.size)
    refuseClassEvidence();
  const structure = parseClassStructure(xml, name);
  if (structure.className !== name || structure.methods.length !== evidence.methods.size) refuseClassEvidence();
  // The shared read parser also accepts split legacy metadata and ignores local-class sections.
  // Recheck its final projection so an ignored/nested node cannot overwrite verified fields.
  sameRange(structure.classDefinitionBlock, evidence.definition.first, evidence.definition.last);
  if (!!structure.classImplementationBlock !== !!evidence.implementation) refuseClassEvidence();
  if (structure.classImplementationBlock && evidence.implementation)
    sameRange(structure.classImplementationBlock, evidence.implementation.first, evidence.implementation.last);
  for (const method of structure.methods) {
    const expected = evidence.methods.get(method.name),
      body = evidence.bodies.get(method.name);
    if (
      !expected ||
      method.visibility !== expected.visibility ||
      method.level !== expected.level ||
      method.abstract !== expected.abstract ||
      !!method.redefinition !== expected.redefinition ||
      !!method.implementation !== !!body
    )
      refuseClassEvidence();
    sameRange(method.definition, expected.declaration);
    if (method.implementation && body) sameRange(method.implementation, body.first, body.last);
  }
  return structure;
}
