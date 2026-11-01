/** Native formatter patch candidate. Not admitted by the multi-target capability table yet. */
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { PrettyPrinterSettings } from './devtools.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtResponse } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { mutationHttp } from './mutation-http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { decodeXmlEntities } from './xml-entities.js';
import { escapeXmlAttr } from './xml-parser.js';

export const FORMATTER_SETTINGS_PATH = '/sap/bc/adt/abapsource/prettyprinter/settings';
export const FORMATTER_SETTINGS_CONTENT_TYPE = 'application/vnd.sap.adt.ppsettings.v2+xml';
const namespace = 'http://www.sap.com/adt/prettyprintersettings';
const styles = new Set(['keywordUpper', 'keywordLower', 'keywordAuto', 'none']);
const xmlOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  commentPropName: '#comment',
  // Decode exactly once with our XML-only decoder, including numeric references.
  processEntities: false,
};
type XmlNode = Record<string, unknown>;

function invalid(): never {
  throw new AdtSafetyError('Unknown or ambiguous native formatter settings XML; no replacement defaults are used.');
}
function attributeValue(value: string): string {
  // XML 1.0 normalizes literal attribute whitespace before resolving character references.
  return decodeXmlEntities(value.replace(/\r\n?/g, '\n').replace(/[\n\t]/g, ' '));
}
function trivia(node: XmlNode): boolean {
  const keys = Object.keys(node);
  return (
    keys.length === 1 &&
    (keys[0] === '#comment' || (keys[0] === '#text' && typeof node['#text'] === 'string' && !node['#text'].trim()))
  );
}

/** Keep native attributes, namespaces, comments and declaration rather than constructing a two-field document. */
export function parsePinnedFormatterDocument(body: string) {
  if (
    Buffer.byteLength(body) > 16 * 1024 ||
    /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body) ||
    XMLValidator.validate(body) !== true
  )
    invalid();
  const nodes = new XMLParser(xmlOptions).parse(body) as XmlNode[];
  const declarations = nodes.filter((node) => Object.hasOwn(node, '?xml'));
  const declaration = declarations[0]?.[':@'] as Record<string, string> | undefined;
  if (declarations.length > 1 || (declaration?.['@_encoding'] && declaration['@_encoding'].toLowerCase() !== 'utf-8'))
    invalid();
  const roots = nodes.filter((node) => !trivia(node) && !Object.hasOwn(node, '?xml'));
  if (roots.length !== 1) invalid();
  const root = roots[0];
  const names = Object.keys(root).filter((key) => key !== ':@');
  if (names.length !== 1) invalid();
  const name = names[0];
  const children = root[name];
  const attributes = root[':@'] as Record<string, string> | undefined;
  if (!attributes || !Array.isArray(children) || !children.every(trivia)) invalid();
  const decoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== 'string') invalid();
    // The XML validator accepts undefined entities and invalid numeric references.
    const remaining = value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (reference) => {
      if (decodeXmlEntities(reference) === reference) invalid();
      return '';
    });
    if (remaining.includes('&')) invalid();
    decoded[key] = attributeValue(value);
  }
  const resolve = (qualified: string, element = false): string => {
    const parts = qualified.split(':');
    if (parts.length > 2 || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(part))) invalid();
    const prefix = parts.length === 2 ? parts[0] : undefined;
    const uri =
      prefix === 'xml'
        ? 'http://www.w3.org/XML/1998/namespace'
        : prefix
          ? decoded[`@_xmlns:${prefix}`]
          : element
            ? decoded['@_xmlns']
            : '';
    if (uri === undefined) invalid();
    return `{${uri}}${parts.at(-1)}`;
  };
  if (resolve(name, true) !== `{${namespace}}PrettyPrinterSettings`) invalid();
  const expanded = new Map<string, string>();
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith('@_') || typeof value !== 'string') invalid();
    if (key === '@_xmlns' || key.startsWith('@_xmlns:')) continue;
    const fullName = resolve(key.slice(2));
    if (expanded.has(fullName)) invalid();
    expanded.set(fullName, key);
  }
  const indentation = expanded.get(`{${namespace}}indentation`);
  const style = expanded.get(`{${namespace}}style`);
  if (!indentation || !style || !['true', 'false'].includes(decoded[indentation]) || !styles.has(decoded[style]))
    invalid();
  const settings: PrettyPrinterSettings = {
    indentation: decoded[indentation] === 'true',
    style: decoded[style] as PrettyPrinterSettings['style'],
  };
  const unrelated = Object.fromEntries(
    [...expanded]
      .filter(([, key]) => key !== indentation && key !== style)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, attribute]) => [key, decoded[attribute]]),
  );
  return { nodes, attributes, names: { indentation, style }, settings, unrelated };
}

function validatePatch(patch: Partial<PrettyPrinterSettings>): void {
  if (
    !patch ||
    typeof patch !== 'object' ||
    Array.isArray(patch) ||
    Object.keys(patch).some((key) => key !== 'indentation' && key !== 'style') ||
    (patch.indentation === undefined && patch.style === undefined) ||
    (patch.indentation !== undefined && typeof patch.indentation !== 'boolean') ||
    (patch.style !== undefined && !styles.has(patch.style))
  ) {
    throw new AdtSafetyError('Supply a boolean indentation and/or a supported formatter style, with no other fields.');
  }
}

function readDocument(response: AdtResponse) {
  if (response.headers['content-type']?.split(';')[0].trim().toLowerCase() !== FORMATTER_SETTINGS_CONTENT_TYPE)
    throw new AdtSafetyError('The native formatter endpoint did not return the qualified v2 XML representation.');
  return parsePinnedFormatterDocument(response.body);
}

function strongEtag(response: AdtResponse): string | undefined {
  const value = response.headers.etag;
  if (value === undefined) return undefined;
  if (!/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) || value.length > 1024)
    throw new AdtSafetyError('Invalid native formatter ETag.');
  return value.startsWith('W/') ? undefined : value;
}

export interface PinnedFormatterOutcome {
  ok: boolean;
  state: 'unchanged' | 'updated' | 'update-rejected' | 'update-unconfirmed';
  phase: 'validation' | 'read' | 'write' | 'readback';
  retryable: false;
  /** SAP documents these preferences as per-user/per-system. This adapter never derives a SAP username from a JWT. */
  scope: 'mapped-user-formatter-settings';
  concurrency?: 'strong-etag' | 'native-unconditional';
  before?: PrettyPrinterSettings;
  settings?: PrettyPrinterSettings;
  statusCode?: number;
  message?: string;
}

/** Required registered context; all native calls use one deadline and no mutation replay. No repository owner exists. */
export async function patchPinnedFormatterSettings(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  patch: Partial<PrettyPrinterSettings>,
): Promise<PinnedFormatterOutcome> {
  const outcome: PinnedFormatterOutcome = {
    ok: false,
    state: 'unchanged',
    phase: 'validation',
    retryable: false,
    scope: 'mapped-user-formatter-settings',
  };
  try {
    assertMutationContext(safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    checkOperation(safety, OperationType.Update, 'SetPrettyPrinterSettings');
    validatePatch(patch);
    // Capture the validated values before the first asynchronous native read.
    patch = { indentation: patch.indentation, style: patch.style };
    const scoped = mutationHttp(http, safety, context);
    const headers = { Accept: FORMATTER_SETTINGS_CONTENT_TYPE };
    outcome.phase = 'read';
    throwIfRequestCancelled(context.requestPolicy);
    const response = await scoped.get(FORMATTER_SETTINGS_PATH, headers);
    const current = readDocument(response);
    const etag = strongEtag(response);
    outcome.concurrency = etag ? 'strong-etag' : 'native-unconditional';
    outcome.before = current.settings;
    const next = {
      ...current.settings,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    };
    if (next.indentation === current.settings.indentation && next.style === current.settings.style) {
      return { ...outcome, ok: true, settings: current.settings };
    }
    for (const field of ['indentation', 'style'] as const) {
      if (patch[field] !== undefined) current.attributes[current.names[field]] = String(patch[field]);
    }
    for (const [key, value] of Object.entries(current.attributes))
      current.attributes[key] = escapeXmlAttr(attributeValue(value)).replace(
        /[\t\n\r]/g,
        (char) => `&#${char.charCodeAt(0)};`,
      );
    const body = new XMLBuilder(xmlOptions).build(current.nodes) as string;
    // Validate the complete outgoing document before the one allowed submission.
    const prepared = parsePinnedFormatterDocument(body);
    if (
      prepared.settings.indentation !== next.indentation ||
      prepared.settings.style !== next.style ||
      JSON.stringify(prepared.unrelated) !== JSON.stringify(current.unrelated)
    )
      invalid();
    checkOperation(safety, OperationType.Update, 'SetPrettyPrinterSettings');
    throwIfRequestCancelled(context.requestPolicy);
    outcome.phase = 'write';
    outcome.state = 'update-unconfirmed';
    await scoped.put(FORMATTER_SETTINGS_PATH, body, FORMATTER_SETTINGS_CONTENT_TYPE, {
      ...headers,
      ...(etag ? { 'If-Match': etag } : {}),
    });
    outcome.phase = 'readback';
    throwIfRequestCancelled(context.requestPolicy);
    const readback = readDocument(await scoped.get(FORMATTER_SETTINGS_PATH, headers));
    const actual = readback.settings;
    outcome.settings = actual;
    if (actual.indentation !== next.indentation || actual.style !== next.style)
      throw new AdtSafetyError('Native formatter read-back did not match the requested settings.');
    if (JSON.stringify(current.unrelated) !== JSON.stringify(readback.unrelated))
      throw new AdtSafetyError('Unrelated native formatter attributes changed during the update.');
    return { ...outcome, ok: true, state: 'updated' };
  } catch (error) {
    if (error instanceof AdtApiError) {
      outcome.statusCode = error.statusCode;
      if (outcome.phase === 'write' && [400, 401, 403, 404, 409, 412, 415, 422, 423].includes(error.statusCode))
        outcome.state = 'update-rejected';
    }
    outcome.message =
      error instanceof AdtSafetyError
        ? error.message
        : outcome.state === 'unchanged'
          ? 'No formatter update was submitted.'
          : 'The formatter update was not confirmed. Read the native settings before deciding the next action.';
    return outcome;
  }
}
