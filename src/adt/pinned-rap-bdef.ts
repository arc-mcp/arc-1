import { AdtSafetyError } from './errors.js';
import { RAP_SOURCE_LIMIT } from './pinned-rap-evidence.js';
import {
  extractRapHandlerRequirements,
  type RapHandlerKind,
  type RapHandlerRequirement,
  type RapHandlerScaffoldPlan,
  type RapHandlerSourceSections,
} from './rap-handlers.js';

interface Token {
  text: string;
  at: number;
  end: number;
  line: number;
}

interface Expected {
  entity: string;
  alias: string;
  kind: RapHandlerKind;
  method: string;
  signature: string;
}

const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** Comments/literal contents are masked; literal delimiters and line breaks remain visible. */
export function validatePrivateRapBdef(source: string, className: string, selectedAlias: string): void {
  const tokens: Token[] = [];
  let line = 1,
    previous = 0;
  for (const match of source.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*|\d+|\.\.|[^\s]/g)) {
    line += source.slice(previous, match.index).split('\n').length - 1;
    tokens.push({ text: match[0], at: match.index, end: match.index + match[0].length, line });
    previous = match.index + match[0].length;
  }
  let at = 0;
  const expected: Expected[] = [],
    identities = new Set<string>(),
    aliases = new Set<string>(),
    methods = new Set<string>();
  const peek = () => tokens[at]?.text.toLowerCase();
  const refuse = (): never => {
    throw new AdtSafetyError(
      `BDEF syntax is outside the complete private RAP parser contract near line ${tokens[at]?.line ?? line}. No include was initialized or saved.`,
    );
  };
  const take = (word?: string): Token => {
    const token = tokens[at];
    if (!token || (word !== undefined && token.text.toLowerCase() !== word)) return refuse();
    at++;
    return token;
  };
  const identifier = () => {
    const token = take();
    if (!/^[A-Z_][A-Z0-9_]{0,29}$/i.test(token.text)) refuse();
    return token;
  };
  const lineStart = (token: Token) => {
    if (!/^[ \t]*$/.test(source.slice(source.lastIndexOf('\n', token.at - 1) + 1, token.at))) refuse();
  };
  const add = (entity: string, alias: string, kind: RapHandlerKind, method: string, signature: string) => {
    const key = `${alias}|${method}`.toLowerCase();
    if (methods.has(key) || expected.length >= 100) refuse();
    methods.add(key);
    expected.push({ entity, alias, kind, method: method.toLowerCase(), signature });
  };
  const annotation = () => {
    const token = tokens[at]!;
    lineStart(token);
    const end = source.indexOf('\n', token.at),
      stop = end < 0 ? source.length : end;
    // A masked literal is allowed only as this known non-handler annotation's value.
    if (!/^@EndUserText\.label[ \t]*:[ \t]*''[ \t]*\r?$/i.test(source.slice(token.at, stop))) refuse();
    while (tokens[at] && tokens[at].at < stop) at++;
  };
  const names = () => {
    identifier();
    while (peek() === ',') {
      take(',');
      identifier();
    }
  };
  const cardinality = () => {
    take('[');
    const first = take().text;
    if (first !== '0' && first !== '1') refuse();
    if (peek() === '..') {
      take('..');
      const last = take().text;
      if (last !== '1' && last !== '*') refuse();
    }
    take(']');
  };
  const triggers = () => {
    take('{');
    let count = 0;
    while (peek() !== '}') {
      const kind = take().text.toLowerCase();
      if (kind === 'field') names();
      else if (!['create', 'update', 'delete'].includes(kind)) refuse();
      take(';');
      count++;
    }
    if (!count) refuse();
    take('}');
  };
  const field = () => {
    take('field');
    take('(');
    do {
      if (peek() === ',') take(',');
      if (!['readonly', 'mandatory'].includes(take().text.toLowerCase())) refuse();
      if (peek() === ':') {
        take(':');
        if (!['create', 'update'].includes(take().text.toLowerCase())) refuse();
      }
    } while (peek() === ',');
    take(')');
    names();
    take(';');
  };
  const mapping = () => {
    take('mapping');
    take('for');
    identifier();
    take('{');
    let count = 0;
    while (peek() !== '}') {
      identifier();
      take('=');
      identifier();
      take(';');
      count++;
    }
    if (!count) refuse();
    take('}');
  };

  while (peek() === '@') annotation();
  const implementation = take().text.toLowerCase();
  if (implementation !== 'managed' && implementation !== 'unmanaged') refuse();
  const managed = implementation === 'managed';
  take('implementation');
  take('in');
  take('class');
  if (identifier().text.toUpperCase() !== className) refuse();
  take('unique');
  take(';');
  if (peek() === 'strict') {
    take('strict');
    take('(');
    if (!['1', '2'].includes(take().text)) refuse();
    take(')');
    take(';');
  }
  while (at < tokens.length) {
    if (peek() === '@') {
      annotation();
      continue;
    }
    const start = take('define');
    lineStart(start);
    take('behavior');
    take('for');
    const entity = identifier().text;
    take('alias');
    const aliasToken = identifier(),
      alias = aliasToken.text;
    const header = source.slice(start.at, aliasToken.end);
    if (
      !/^define[ \t]+behavior[ \t]+for[ \t]+[A-Z_][A-Z0-9_]*[ \t]+alias[ \t]+[A-Z_][A-Z0-9_]*$/i.test(header) ||
      identities.size >= 10 ||
      identities.has(entity.toLowerCase()) ||
      aliases.has(alias.toLowerCase()) ||
      alias.length > 26
    )
      refuse();
    identities.add(entity.toLowerCase());
    aliases.add(alias.toLowerCase());
    const seenHeaders = new Set<string>();
    while (peek() !== '{') {
      const kind = take().text.toLowerCase();
      if (seenHeaders.has(kind)) refuse();
      seenHeaders.add(kind);
      if (kind === 'persistent') {
        if (!managed) refuse();
        take('table');
        identifier();
      } else if (kind === 'lock') {
        if (!managed) refuse(); // The shared generator has no FOR LOCK requirement.
        take('master');
      } else if (kind === 'etag') {
        if (!managed) refuse();
        take('master');
        identifier();
      } else if (kind === 'authorization') {
        take('master');
        take('(');
        const mode = take().text.toLowerCase();
        if (mode !== 'instance' && mode !== 'global') refuse();
        take(')'); // A combined list, options or dependent clause is deliberately not consumed.
        const method = `get_${mode}_authorizations`;
        add(
          entity,
          alias,
          mode === 'instance' ? 'instance_authorization' : 'global_authorization',
          method,
          `METHODS ${method} FOR ${mode} AUTHORIZATION IMPORTING ${mode === 'instance' ? 'keys ' : ''}REQUEST requested_authorizations FOR ${alias} RESULT result.`,
        );
      } else refuse();
    }
    take('{');
    while (peek() !== '}') {
      const token = tokens[at];
      if (!token) refuse();
      const kind = peek();
      if (['action', 'static', 'internal', 'factory'].includes(kind!)) {
        lineStart(token);
        if (peek() === 'static') take('static');
        const factory = peek() === 'factory';
        if (factory || peek() === 'internal') take();
        take('action');
        const action = identifier();
        if (!/^[ \tA-Z_]+$/i.test(source.slice(token.at, action.at)) || action.line !== token.line) refuse();
        if (peek() === '[' && factory) cardinality();
        if (peek() === 'parameter') {
          take('parameter');
          identifier();
        }
        let result = false;
        if (peek() === 'result') {
          take('result');
          cardinality();
          if (peek() === '$self') take('$self');
          else identifier();
          result = true;
        }
        const end = take(';');
        if (end.line - token.line > 20) refuse();
        add(
          entity,
          alias,
          'action',
          action.text,
          `METHODS ${action.text} FOR MODIFY IMPORTING keys FOR ACTION ${alias}~${action.text}${result ? ' RESULT result' : ''}.`,
        );
      } else if (kind === 'determination' || kind === 'validation') {
        lineStart(token);
        take();
        const method = identifier();
        take('on');
        const event = take();
        if (
          !['modify', 'save'].includes(event.text.toLowerCase()) ||
          (kind === 'validation' && event.text.toLowerCase() !== 'save') ||
          !/^[ \tA-Z0-9_]+$/i.test(source.slice(token.at, event.end)) ||
          event.line !== token.line
        )
          refuse();
        triggers();
        add(
          entity,
          alias,
          kind,
          method.text,
          `METHODS ${method.text} FOR ${kind === 'determination' ? 'DETERMINE' : 'VALIDATE'} ON ${event.text} IMPORTING keys FOR ${alias}~${method.text}.`,
        );
      } else if (['create', 'update', 'delete'].includes(kind!)) {
        if (!managed) refuse(); // The shared generator has no unmanaged CRUD requirements.
        take();
        take(';');
      } else if (kind === 'read' && !managed) {
        // Preserve the existing BP_DEMO_RAP_STRICT read/global-auth fixture contract.
        take('read');
        take(';');
      } else if (kind === 'field') field();
      else if (kind === 'association' && managed) {
        take('association');
        identifier();
        if (peek() === '{') {
          take('{');
          take('create');
          take(';');
          take('}');
        } else take(';');
      } else if (kind === 'mapping') {
        if (!managed) refuse();
        mapping();
      } else refuse();
    }
    take('}');
  }
  const requirements = extractRapHandlerRequirements(source);
  const key = (requirement: RapHandlerRequirement) =>
    `${requirement.entityName}|${requirement.entityAlias}|${requirement.kind}|${requirement.methodName}`.toLowerCase();
  const admitted = new Map(
    expected.map((row) => [`${row.entity}|${row.alias}|${row.kind}|${row.method}`.toLowerCase(), row]),
  );
  if (
    !identities.size ||
    !expected.length ||
    requirements.length !== expected.length ||
    (selectedAlias && !expected.some((row) => row.alias.toLowerCase() === selectedAlias))
  )
    refuse();
  for (const requirement of requirements) {
    const row = admitted.get(key(requirement));
    if (
      !row ||
      requirement.targetHandlerClass !== `lhc_${row.alias.toLowerCase()}` ||
      normalized(requirement.signature) !== normalized(row.signature)
    )
      refuse();
    admitted.delete(key(requirement));
  }
  if (admitted.size) refuse();
}

export function boundedRapText(source: string): void {
  if (Buffer.byteLength(source) > RAP_SOURCE_LIMIT || source.split('\n').length > 5000 || source.includes('\0'))
    throw new AdtSafetyError('RAP source exceeds its 256 KiB / 5000-line parser bound or contains NUL.');
}

/** Comments/string contents cannot create requirements or alter brace depth in the pure BDEF reader. */
export function rapBdefForPlanning(source: string): string {
  boundedRapText(source);
  let result = '',
    at = 0;
  while (at < source.length) {
    if (source.startsWith('//', at)) {
      const end = source.indexOf('\n', at);
      at = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2);
      if (end < 0) throw new AdtSafetyError('Unterminated BDEF comment is outside the RAP parser contract.');
      result += source.slice(at, end + 2).replace(/[^\n]/g, ' ');
      at = end + 2;
    } else if (source[at] === "'") {
      result += "'";
      let closed = false;
      for (at++; at < source.length; at++) {
        if (source[at] === "'") {
          if (source[at + 1] === "'") {
            at++;
            continue;
          }
          at++;
          closed = true;
          break;
        }
        if (source[at] === '\n') result += '\n';
      }
      if (!closed) throw new AdtSafetyError('Unterminated BDEF literal is outside the RAP parser contract.');
      result += "'";
    } else result += source[at++];
  }
  return result;
}

export function validateRapInputs(
  name: string,
  bdefName: string,
  bdef: string,
  sections: RapHandlerSourceSections,
  alias: string,
): void {
  boundedRapText(bdef);
  validatePrivateRapBdef(bdef, name, alias);
  const cleanMain = sections.main
    .split('\n')
    .filter((line) => !/^\s*\*/.test(line))
    .map((line) => line.split('"', 1)[0])
    .join('\n');
  const mainBindings = [...cleanMain.matchAll(/\bfor\s+behavior\s+of\s+([A-Z][A-Z0-9_]*)\b/gi)];
  if (mainBindings.length !== 1 || mainBindings[0][1].toUpperCase() !== bdefName)
    throw new AdtSafetyError('Class MAIN does not bind exactly the selected BDEF.');
  const seen = new Set<string>();
  for (const source of Object.values(sections)) {
    if (source === undefined) continue;
    boundedRapText(source);
    // Multiline literals/templates can imitate CLASS/METHOD lines in this line-oriented transformer.
    if (/[`|]/.test(source))
      throw new AdtSafetyError('RAP multiline literals/templates need a separately qualified parser.');
    let opened = '',
      method = false;
    const methods = new Set<string>();
    for (const line of source.split('\n')) {
      if (/^\s*\*/.test(line)) continue;
      const code = line.split('"', 1)[0];
      if ((code.match(/'/g)?.length ?? 0) % 2)
        throw new AdtSafetyError('RAP multiline literals need a separately qualified parser.');
      const start = code.match(/^\s*class\s+([A-Z][A-Z0-9_]*)\s+(definition|implementation)\b/i);
      if (start && !/\bdeferred\b/i.test(code)) {
        const key = `${start[1]}:${start[2]}`.toLowerCase();
        if (opened || seen.has(key)) throw new AdtSafetyError('RAP class blocks are nested or ambiguous.');
        seen.add(key);
        opened = key;
      }
      const methodStart = code.match(/^\s*method\s+([A-Z][A-Z0-9_~]*)\b/i);
      if (methodStart) {
        const key = `${opened}:${methodStart[1].toLowerCase()}`;
        if (!opened.endsWith(':implementation') || method || methods.has(key))
          throw new AdtSafetyError('RAP method blocks are nested or ambiguous.');
        methods.add(key);
        method = true;
      }
      if (/^\s*endmethod\s*\./i.test(code)) {
        if (!method) throw new AdtSafetyError('RAP method blocks are incomplete.');
        method = false;
      }
      if (/^\s*endclass\s*\./i.test(code)) {
        if (!opened || method) throw new AdtSafetyError('RAP class or method blocks are incomplete.');
        opened = '';
      }
    }
    if (opened) throw new AdtSafetyError('RAP class blocks are incomplete.');
  }
}

export function validateRapPlan(plan: RapHandlerScaffoldPlan): void {
  if (plan.unresolved.length || plan.insertedSignatureCount > 100 || plan.insertedImplementationStubCount > 100)
    throw new AdtSafetyError('RAP generation is incomplete or exceeds its bounded requirement set.');
  for (const source of Object.values(plan.sections)) if (source !== undefined) boundedRapText(source);
}
