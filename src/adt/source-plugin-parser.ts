/** The 7.50 and 7.58 source-enhancement wire formats, without fetching response-provided URIs. */
import { TextDecoder } from 'node:util';
import { XMLValidator } from 'fast-xml-parser';
import { AdtError } from './errors.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { parseXml } from './xml-parser.js';

type Row = Record<string, unknown>;
export interface PluginReference {
  name: string;
  type: string;
  uri: string;
}
export interface SourcePlugin {
  id: string;
  uri: string;
  fullName: string;
  mode: string;
  replacing: boolean;
  replaced?: string;
  position?: string;
  source?: string;
  sourceOmitted?: string;
}
export interface PluginImplementation extends PluginReference {
  version: string;
  parent: PluginReference;
  plugins: SourcePlugin[];
  switch?: { name: string; state: string };
}
export interface PluginGraph {
  implementations: PluginImplementation[];
  edges: Array<{ from: string; to: string; kind: 'parent' | 'replacement'; attachment?: string }>;
  omittedImplementations: number;
  omittedSources: number;
}

const rows = (value: unknown): Row[] => (Array.isArray(value) ? value : value ? [value] : []) as Row[];
const attr = (row: Row, name: string) => String(row[`@_${name}`] ?? '');
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const reference = (value: unknown): PluginReference => {
  const r = row(value);
  return { name: attr(r, 'name'), type: attr(r, 'type'), uri: attr(r, 'uri') };
};
function invalid(): never {
  throw new AdtError('Invalid source enhancement response or ownership.');
}
const NAME = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_=$%-]+$/i;
function name(value: string): string {
  if (!NAME.test(value) || value.length > 120) invalid();
  return value;
}
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** No arbitrary URI is followed. Even retained locations must identify the named implementation. */
function pluginUri(uri: string, owner: string): void {
  const match =
    /^\/sap\/bc\/adt\/enhancements\/(?:enhoxhh|enhoxh|implementations)\/([^/]+)(?:\/source\/main|\/elements\/sourcecodeplugins\/[^/?#]+)?(?:#start=\d+,\d+)?$/i.exec(
      uri,
    );
  if (!match || !same(decodeURIComponent(match[1]!), owner) || /%25|\.\./i.test(uri)) invalid();
}

export interface PluginParseOptions {
  /** Validated owning main-object URL. Nested ENHO parents must ultimately lead here. */
  mainObjectUri: string;
  /** An include can own its own plug-ins even when read with an enclosing main-object context. */
  selectedObjectUri?: string;
  selectedSourceUri?: string;
  /** Adapter-verified FUNCTION header of a physical FUGR include; never a metadata fetch target. */
  selectedFunctionSourceUri?: string;
  sources: boolean;
  maxImplementations?: number;
  maxDecodedBytes?: number;
  maxSourceBytes?: number;
}

/** Bounded XML and strict base64/UTF-8 decoding; omission is explicit, never a reconstructed body. */
export function parseSourcePluginElements(xml: string, options: PluginParseOptions): PluginGraph {
  for (const limit of [options.maxImplementations, options.maxDecodedBytes, options.maxSourceBytes])
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) invalid();
  if (Buffer.byteLength(xml) > 256 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    invalid();
  const parsed = parseXml(xml);
  if (!Object.hasOwn(parsed, 'enhancements')) invalid();
  if (Array.isArray(parsed.enhancements) || (typeof parsed.enhancements === 'string' && parsed.enhancements.trim()))
    invalid();
  const root = row(parsed.enhancements);
  if (Object.keys(root).some((k) => !k.startsWith('@_') && k !== 'enhancementImplementations')) invalid();
  const all = rows(root.enhancementImplementations);
  if (all.length > 256) invalid();
  const byName = new Map<string, Row>();
  for (const impl of all) {
    const n = name(attr(impl, 'name')).toUpperCase();
    if (!/^ENHO\/XHH?$/.test(attr(impl, 'type')) || byName.has(n)) invalid();
    byName.set(n, impl);
  }
  for (const impl of all) {
    let current = impl;
    const seen = new Set<Row>();
    while (true) {
      if (seen.has(current)) invalid();
      seen.add(current);
      const parent = reference(current.enhancedObject);
      if (parent.type.startsWith('ENHO/')) {
        pluginUri(parent.uri, name(parent.name));
        const next = byName.get(parent.name.toUpperCase());
        if (!next) invalid();
        current = next;
      } else {
        if (!same(parent.uri, options.mainObjectUri) && !same(parent.uri, options.selectedObjectUri ?? '')) invalid();
        const expectedName = decodeURIComponent(parent.uri.split('/').at(-1) ?? '');
        const expectedType = parent.uri.includes('/programs/includes/')
          ? 'PROG/I'
          : parent.uri.includes('/programs/programs/')
            ? 'PROG/P'
            : parent.uri.includes('/oo/classes/')
              ? 'CLAS/OC'
              : parent.uri.includes('/functions/groups/')
                ? 'FUGR/F'
                : '';
        if (!same(parent.name, expectedName) || parent.type !== expectedType) invalid();
        break;
      }
    }
  }
  let remaining = options.maxDecodedBytes ?? 64 * 1024;
  let omittedSources = 0;
  const max = options.maxImplementations ?? 20;
  const implementations = all.slice(0, max).map((impl): PluginImplementation => {
    const n = attr(impl, 'name');
    const version = attr(impl, 'version');
    if (!version || version.length > 40) invalid();
    const elements = rows(impl.elements).flatMap((e) => rows(e.sourceCodePlugin));
    if (elements.length > 80) invalid();
    const plugins = elements.map((p): SourcePlugin => {
      const uri = attr(p, 'uri');
      pluginUri(uri, n);
      const id = attr(p, 'id').trim();
      if (!/^\d+$/.test(id)) invalid();
      const option = row(row(p.option).sourceCodePluginOption);
      if (option.position) {
        const position = attr(row(option.position), 'uri');
        const [pathAndQuery, fragment] = position.split('#');
        if (!fragment || !/^start=\d+,\d+$/.test(fragment)) invalid();
        const [path, query] = pathAndQuery!.split('?');
        const parent = reference(impl.enhancedObject);
        if (parent.type.startsWith('ENHO/')) pluginUri(`${path}#${fragment}`, parent.name);
        else {
          const selected = options.selectedObjectUri ?? options.mainObjectUri;
          const allowed = new Set(
            [`${options.mainObjectUri}/source/main`, `${selected}/source/main`, options.selectedSourceUri]
              .filter(Boolean)
              .map((p) => p!.toUpperCase()),
          );
          if (
            options.mainObjectUri.startsWith('/sap/bc/adt/functions/groups/') &&
            options.selectedFunctionSourceUri?.startsWith(`${options.mainObjectUri}/fmodules/`)
          )
            allowed.add(options.selectedFunctionSourceUri.toUpperCase());
          if (
            selected.startsWith('/sap/bc/adt/programs/includes/') &&
            options.mainObjectUri.startsWith('/sap/bc/adt/functions/groups/')
          )
            allowed.add(`${options.mainObjectUri}/includes/${selected.split('/').at(-1)}/source/main`.toUpperCase());
          if (
            !canonicalHostRelativeAdtPath(path!, '/sap/bc/adt/', { allowRawEncodedSlash: true }) ||
            !allowed.has(path!.toUpperCase())
          )
            invalid();
        }
        if (query) {
          const params = new URLSearchParams(query);
          if ([...params.keys()].some((k) => k !== 'context') || params.getAll('context').length !== 1) invalid();
          const context = params.get('context')!;
          if (![options.mainObjectUri, options.selectedObjectUri].some((u) => u && same(u, context))) invalid();
        }
      }
      const fullName = attr(p, 'full_name') || attr(p, 'fullname');
      if (!fullName || fullName.length > 4096) invalid();
      const plugin: SourcePlugin = {
        id,
        uri,
        fullName,
        mode: attr(p, 'mode'),
        replacing: attr(p, 'replacing') === 'true',
        ...(attr(p, 'replaced') ? { replaced: attr(p, 'replaced') } : {}),
        ...(option.position ? { position: attr(row(option.position), 'uri') } : {}),
      };
      if (options.sources) {
        const encoded = typeof p.source === 'string' ? p.source.replace(/\s/g, '') : '';
        const size = (encoded.length / 4) * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
        if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
          plugin.sourceOmitted = 'invalid_base64';
        else if (size > Math.min(remaining, options.maxSourceBytes ?? 16 * 1024))
          plugin.sourceOmitted = 'decoded_byte_limit';
        else if (Buffer.from(encoded, 'base64').toString('base64') !== encoded) plugin.sourceOmitted = 'invalid_base64';
        else {
          const bytes = Buffer.from(encoded, 'base64');
          try {
            plugin.source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            remaining -= bytes.length;
          } catch {
            plugin.sourceOmitted = 'invalid_utf8';
          }
        }
        if (plugin.sourceOmitted) omittedSources++;
      }
      return plugin;
    });
    const sw = row(impl.switch);
    return {
      name: n,
      type: attr(impl, 'type'),
      uri: plugins[0]?.uri ?? '',
      version,
      parent: reference(impl.enhancedObject),
      plugins,
      ...(impl.switch ? { switch: { name: attr(row(sw.ref), 'name'), state: attr(sw, 'state') } } : {}),
    };
  });
  const edges: PluginGraph['edges'] = [];
  for (const impl of implementations) {
    edges.push({ from: impl.name, to: impl.parent.name, kind: 'parent' });
    for (const plugin of impl.plugins)
      if (plugin.replacing) {
        // 750 has no `replaced`; enhancedObject retains the immediate replaced implementation.
        edges.push({
          from: impl.name,
          to: impl.parent.name,
          kind: 'replacement',
          attachment: plugin.replaced ?? plugin.fullName,
        });
      }
  }
  return { implementations, edges, omittedImplementations: Math.max(0, all.length - max), omittedSources };
}

/** Cheap HOOK_IMPL list: identities of outer/specific implementations only. */
export function parseSourcePluginIdentities(
  xml: string,
): Array<PluginReference & { switch?: { name: string; state: string } }> {
  if (Buffer.byteLength(xml) > 128 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    invalid();
  const parsed = parseXml(xml);
  if (!Object.hasOwn(parsed, 'enhancementImplementation')) invalid();
  if (
    Array.isArray(parsed.enhancementImplementation) ||
    (typeof parsed.enhancementImplementation === 'string' && parsed.enhancementImplementation.trim())
  )
    invalid();
  if (Object.keys(row(parsed.enhancementImplementation)).some((k) => !k.startsWith('@_') && k !== 'implementation'))
    invalid();
  const items = rows(row(parsed.enhancementImplementation).implementation);
  if (items.length > 256) invalid();
  return items.map((item) => {
    const n = name(attr(item, 'name'));
    const uri = attr(rows(item.link).find((link) => attr(link, 'rel') === 'self') ?? {}, 'href');
    pluginUri(uri, n);
    const sw = row(item.switch);
    return {
      name: n,
      type: uri.includes('/enhoxhh/') ? 'ENHO/XHH' : 'ENHO/XH',
      uri,
      ...(item.switch ? { switch: { name: attr(row(sw.ref), 'name'), state: attr(sw, 'state') } } : {}),
    };
  });
}
