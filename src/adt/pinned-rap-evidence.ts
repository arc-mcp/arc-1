import { createHash } from 'node:crypto';
import type { AdtClient } from './client.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { type NativeXmlElement, nativeXmlRoot } from './native-xml-evidence.js';
import {
  pinnedDeclarativeMetadata,
  pinnedDeclarativeSelection,
  pinnedDeclarativeStateLinkVersion,
} from './pinned-repository-owner.js';
import {
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
  type RapHandlerSourceSections,
} from './rap-handlers.js';
import { checkOperation, OperationType } from './safety.js';
import { parseClassMetadata } from './xml-parser.js';

export const RAP_SOURCE_LIMIT = 256 * 1024;

export const rapHash = (value: string) => createHash('sha256').update(value).digest('hex');

const core = 'http://www.sap.com/adt/core',
  cls = 'http://www.sap.com/adt/oo/classes';

const atom = 'http://www.w3.org/2005/Atom';

export const rapSections = ['main', 'definitions', 'implementations'] as const;

export type RapSection = (typeof rapSections)[number];

export const rapOwner = (name: string) => `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;

export const rapSource = (name: string, part: RapSection) =>
  `${rapOwner(name)}/${part === 'main' ? 'source/main' : `includes/${part}`}`;

function packageUriMatches(uri: string | undefined, packageName: string): boolean {
  if (uri === undefined) return true;
  const segment = /^\/sap\/bc\/adt\/packages\/([^/?#]+)$/.exec(uri)?.[1];
  try {
    return segment !== undefined && decodeURIComponent(segment).toUpperCase() === packageName;
  } catch {
    return false;
  }
}

function version(root: NativeXmlElement, source: string, bdefOwner?: string) {
  const value = root.attribute('version', core);
  if (value !== 'active' && value !== 'inactive')
    throw new AdtSafetyError('RAP metadata has no qualified native version.');
  const alternatives = root
    .children('link', atom)
    .filter((link) => link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
  if (alternatives.length > 1) throw new AdtSafetyError('RAP metadata has ambiguous version alternatives.');
  const alternative = alternatives[0]?.attribute('href', '');
  // BDEF alone uses the qualified owner-link contract; class/include forms stay exact source URIs.
  if (
    bdefOwner !== undefined
      ? alternatives.length > 0 && pinnedDeclarativeStateLinkVersion('BDEF', bdefOwner, alternative) === undefined
      : alternative !== undefined &&
        alternative !== `${source}?version=active` &&
        alternative !== `${source}?version=inactive`
  )
    throw new AdtSafetyError('RAP version alternative is not the exact selected source.');
  return { version: value, alternative };
}

export function rapEvidence(client: AdtClient, name: string) {
  let reads = 0,
    bytes = 0;
  async function get(http: AdtHttpClient, path: string, text = false) {
    if (++reads > 100) throw new AdtSafetyError('RAP evidence exceeds its read bound.');
    checkOperation(client.safety, OperationType.Read, 'PinnedRapEvidence');
    const response = await http.get(
      path,
      { Accept: text ? 'text/plain' : 'application/*', 'Cache-Control': 'no-cache' },
      {
        responseBudget: new DataResponseBudget(RAP_SOURCE_LIMIT, 'rap-evidence', true),
        suppressNotFoundLog: true,
      },
    );
    bytes += Buffer.byteLength(response.body);
    if (bytes > 4 * 1024 * 1024) throw new AdtSafetyError('RAP evidence exceeds its cumulative byte bound.');
    if (
      text &&
      !Object.entries(response.headers).some(
        ([key, value]) =>
          key.toLowerCase() === 'content-type' && value.split(';', 1)[0].trim().toLowerCase() === 'text/plain',
      )
    )
      throw new AdtSafetyError('RAP source did not return native text.');
    return response.body;
  }
  async function classMetadata(http: AdtHttpClient, active = false) {
    const xml = await get(http, rapOwner(name) + (active ? '?version=active' : ''));
    const root = nativeXmlRoot(xml, 'abapClass', cls, true);
    const pkg = root.child('packageRef', core);
    const ref = root.child('rootEntityRef', cls);
    const bdefName = ref?.attribute('name', core);
    const packageName = pkg?.attribute('name', core);
    if (
      root.attribute('name', core) !== name ||
      root.attribute('type', core) !== 'CLAS/OC' ||
      (root.attribute('uri', core) !== undefined && root.attribute('uri', core)?.toLowerCase() !== rapOwner(name)) ||
      root.attribute('category', cls) !== 'behaviorPool' ||
      root.hasChild('containerRef') ||
      !packageName ||
      packageName.length > 30 ||
      !/^(?:\/[A-Z0-9_]+\/)?(?:[A-Z][A-Z0-9_]*|\$[A-Z0-9_]+)$/.test(packageName) ||
      pkg?.attribute('type', core) !== 'DEVC/K' ||
      !packageUriMatches(pkg.attribute('uri', core), packageName) ||
      (ref &&
        (!bdefName ||
          !/^[A-Z][A-Z0-9_]{0,29}$/.test(bdefName) ||
          ref.attribute('type', core) !== 'STOB/DO' ||
          ref.attribute('uri', core) !==
            `/sap/bc/adt/ddic/ddl/sources/${bdefName.toLowerCase()}/source/main#name=${bdefName.toLowerCase()}`))
    )
      throw new AdtSafetyError('The native RAP class identity, package or root entity is unqualified.');
    const state = version(root, rapSource(name, 'main'));
    const includes = root.children('include', cls).map((include) => {
      const part = include.attribute('includeType', cls);
      if (
        !part ||
        !['main', 'definitions', 'implementations', 'macros', 'testclasses'].includes(part) ||
        include.attribute('type', core) !== 'CLAS/I' ||
        include.attribute('sourceUri', 'http://www.sap.com/adt/abapsource') !==
          (part === 'main' ? 'source/main' : `includes/${part}`)
      )
        throw new AdtSafetyError('The native RAP class includes an unqualified source resource.');
      return { part, ...version(include, `${rapOwner(name)}/${part === 'main' ? 'source/main' : `includes/${part}`}`) };
    });
    if (
      new Set(includes.map((item) => item.part)).size !== includes.length ||
      !includes.some((item) => item.part === 'main')
    )
      throw new AdtSafetyError('The native RAP class include inventory is incomplete or ambiguous.');
    return { metadata: parseClassMetadata(xml), packageName, bdefName, ...state, includes };
  }
  async function bdef(http: AdtHttpClient, bdefName: string) {
    const selected = pinnedDeclarativeSelection('BDEF', bdefName);
    const read = async () => {
      const { root } = pinnedDeclarativeMetadata(await get(http, selected.objectUrl), selected, true);
      return {
        ...version(root, `${selected.objectUrl}/source/main`, selected.objectUrl),
        hash: rapHash(JSON.stringify(root.canonicalValue({}))),
      };
    };
    const before = await read();
    const source = await get(http, `${selected.objectUrl}/source/main`, true);
    const after = await read();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new AdtSafetyError('BDEF metadata changed during its source read.');
    return { ...after, source, sourceHash: rapHash(source) };
  }
  return { get, classMetadata, bdef };
}

interface Declaration {
  name: string;
  signature?: string;
}

interface ClassMembers {
  declarations: Declaration[];
  implementations: Set<string>;
}

/** Keep code delimiters; strings/comments cannot manufacture declarations or statement endings. */
function codeOnly(source: string): string {
  let code = '';
  for (const line of source.split('\n')) {
    if (/^\s*\*/.test(line)) continue;
    let literal = false;
    for (let at = 0; at < line.length; at++) {
      const char = line[at]!;
      if (char === "'") {
        if (literal && line[at + 1] === "'") at++;
        else {
          literal = !literal;
          code += "'";
        }
      } else if (!literal) {
        if (char === '"') break;
        code += char;
      }
    }
    code += '\n';
  }
  return code;
}

/** ABAP method and parameter names may differ; the complete RAP binding/type/event must agree. */
function signature(statement: string): string | undefined {
  const declaration = statement
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*~\s*/g, '~')
    .toLowerCase()
    .match(/^methods [a-z_]\w* (.+)\.$/);
  return declaration?.[1]
    .replace(/\bimporting ([a-z_]\w*) request ([a-z_]\w*) for\b/, 'importing _ request _ for')
    .replace(/\bimporting request ([a-z_]\w*) for\b/, 'importing request _ for')
    .replace(/\bimporting ([a-z_]\w*) for\b/, 'importing _ for')
    .replace(/\bresult ([a-z_]\w*)$/, 'result _');
}

function members(source: string): Map<string, ClassMembers> {
  const classes = new Map<string, ClassMembers>();
  let current: ClassMembers | undefined,
    mode = '';
  for (const value of codeOnly(source).split('.')) {
    const statement = value.trim();
    const start = statement.match(/^class\s+([a-z_]\w*)\s+(definition|implementation)\b/i);
    if (start && !/\bdeferred\b/i.test(statement)) {
      const name = start[1]!.toLowerCase();
      current = classes.get(name) ?? { declarations: [], implementations: new Set() };
      classes.set(name, current);
      mode = start[2]!.toLowerCase();
    } else if (/^endclass$/i.test(statement)) {
      current = undefined;
      mode = '';
    } else if (current && mode === 'definition') {
      const declaration = statement.match(/^((?:class-)?methods)(?:\s+|(?=:))(:?)([\s\S]+)$/i);
      if (!declaration) continue;
      // Chained utility declarations still occupy names. If the legacy generator duplicates a
      // chained handler, final verification detects the ambiguity instead of accepting its plan.
      const parts = declaration[2] ? declaration[3]!.split(',') : [declaration[3]!];
      for (const part of parts) {
        const name = part
          .trim()
          .match(/^([a-z_]\w*)\b/i)?.[1]
          ?.toLowerCase();
        if (!name) throw new AdtSafetyError('RAP method declaration could not be resolved.');
        current.declarations.push({ name, signature: signature(`${declaration[1]} ${part.trim()}.`) });
      }
    } else if (current && mode === 'implementation') {
      // Keep the complete identity: an interface-qualified body is not its plain name prefix.
      const name = statement
        .replace(/\s*~\s*/g, '~')
        .match(/^method\s+(\S+)(?:\s|$)/i)?.[1]
        ?.toLowerCase();
      if (name) current.implementations.add(name);
    }
  }
  return classes;
}

/** Before planning, reject hidden requirements; afterward, every selected handler must be complete. */
export function validateRapHandlerBindings(
  bdef: string,
  sections: RapHandlerSourceSections,
  alias: string,
  complete: boolean,
): void {
  const requirements = extractRapHandlerRequirements(bdef).filter(
    (requirement) => !alias || requirement.entityAlias.toLowerCase() === alias,
  );
  const source = Object.values(sections).filter(Boolean).join('\n\n');
  const classes = members(source);
  const legacyMissing = new Set(findMissingRapHandlerRequirements(requirements, source));
  const legacyMissingStubs = new Set(findMissingRapHandlerImplementationStubs(requirements, source));
  for (const requirement of requirements) {
    const current = classes.get(requirement.targetHandlerClass.toLowerCase());
    const declarations = current?.declarations ?? [];
    if (new Set(declarations.map((declaration) => declaration.name)).size !== declarations.length)
      throw new AdtSafetyError(`RAP class ${requirement.targetHandlerClass} has duplicate method declarations.`);
    const expected = signature(requirement.signature);
    const matched = declarations.filter((declaration) => declaration.signature === expected);
    if (!expected || matched.length > 1)
      throw new AdtSafetyError(`RAP handler ${requirement.entityAlias}~${requirement.methodName} is ambiguous.`);
    if (matched.length === 1) {
      if ((complete || !legacyMissingStubs.has(requirement)) && !current?.implementations.has(matched[0]!.name))
        throw new AdtSafetyError(`RAP handler implementation ${matched[0]!.name} is missing; the plan is incomplete.`);
      continue;
    }
    if (
      complete ||
      !legacyMissing.has(requirement) ||
      declarations.some((declaration) => declaration.name === requirement.methodName.toLowerCase())
    )
      throw new AdtSafetyError(
        `RAP handler ${requirement.entityAlias}~${requirement.methodName} has no matching declaration; resolve the incompatible method before scaffolding. No include was initialized or saved.`,
      );
  }
}
