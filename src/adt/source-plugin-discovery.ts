/** Optional source-code plug-in discovery. All I/O shares the caller's session and SAP identity. */

import { createHash } from 'node:crypto';
import type { AdtClient } from './client.js';
import { AdtApiError } from './errors.js';
import {
  type ExtensionDiscoverySession,
  ExtensionProtocolError,
  type ExtensionRequest,
  extensionKey,
} from './extension-discovery.js';
import { expandsInclude, findIncludeStatements } from './include-expansion.js';
import { type PluginGraph, parseSourcePluginElements, parseSourcePluginIdentities } from './source-plugin-parser.js';
import { type SourcePluginUnit, sourcePluginObjectUri, sourcePluginResources } from './source-plugin-resources.js';

export interface SourcePluginSelection {
  unit: SourcePluginUnit;
  /** Already-read, unfiltered root source. Never take this from formatted/grep/line-window output. */
  source?: string;
}
const protocol = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch {
    throw new ExtensionProtocolError('Invalid source plug-in evidence.');
  }
};

/** Stage 3 can call this same adapter for CLAS, including its selected local source section. */
export async function discoverSourcePlugins(
  client: AdtClient,
  session: ExtensionDiscoverySession,
  request: ExtensionRequest,
  selection: SourcePluginSelection,
): Promise<void> {
  const provider = {
    id: 'source_plugins',
    family: 'source_plugin',
    status: 'returned' as const,
    coverage: session.mode === 'sources' ? ('bounded_traversal' as const) : ('selected_source' as const),
    version: 'provider_current',
    nested: session.mode === 'sources' ? ('bounded' as const) : ('not_expanded' as const),
    reason: 'selected_source_only; runtime applicability unknown',
  };
  await session.provider(provider, async () => {
    if (request.root.version !== 'active') {
      Object.assign(provider, { status: 'unsupported', reason: 'unsupported_version' });
      return;
    }
    if (selection.unit.type === 'INCL' && !request.context) {
      Object.assign(provider, { status: 'context_required', reason: 'include_requires_main_object_context' });
      return;
    }
    const mainUnit: SourcePluginUnit =
      selection.unit.type === 'FUNC'
        ? { type: 'FUGR', name: selection.unit.group! }
        : selection.unit.type === 'INCL'
          ? request.context!
          : selection.unit;
    const mainObjectUri = protocol(() => sourcePluginObjectUri(mainUnit));
    const pending = [{ ...selection, depth: 0 }];
    const seen = new Set<string>();
    const emittedSources = new Set<string>();
    let occurrences = 0;
    let unavailable = false;
    let legacy = false;
    while (pending.length && !session.stopped) {
      const current = pending.shift()!;
      const { unit, depth } = current;
      const key = extensionKey({ ...unit, version: 'active' });
      if (seen.has(key)) continue;
      if (seen.size + session.result.nodes.length >= session.limits.nodes && depth > 0) {
        session.omit('nodes', pending.length + 1);
        Object.assign(provider, { status: 'incomplete', reason: 'source_unit_node_limit' });
        break;
      }
      seen.add(key);
      // Failure belongs to this source unit; 401/403/429/protocol/budgets stop the entire optional phase.
      try {
        const resources = await session.read(unit.type, async (options) => {
          const objectUri = protocol(() => sourcePluginObjectUri(unit));
          const response = await client.http.get(`${objectUri}?version=active`, { Accept: 'application/*' }, options);
          return protocol(() => sourcePluginResources(response.body, unit));
        });
        legacy ||= resources.legacyUnadvertised === true;
        if (session.mode === 'summary' && resources.identities) {
          Object.assign(provider, {
            coverage: 'direct_identities',
            reason: 'HOOK_IMPL outer/specific identities; nested expansion not performed',
          });
          await session.read('ENHO', async (options) => {
            const response = await client.http.get(
              resources.identities!.uri,
              { Accept: resources.identities!.accept },
              options,
            );
            for (const identity of protocol(() => parseSourcePluginIdentities(response.body))) {
              session.addNode({
                type: identity.type,
                name: identity.name,
                uri: identity.uri,
                version: 'provider_current',
                provider: provider.id,
                family: provider.family,
                ...(identity.switch ? { switch: `${identity.switch.name}:${identity.switch.state}` } : {}),
                applicability: 'unknown',
              });
            }
          });
          return;
        }
        if (resources.elements) {
          const context = unit.type === 'INCL' ? `?context=${encodeURIComponent(mainObjectUri)}` : '';
          const graph = await session.read('ENHO', async (options) => {
            const response = await client.http.get(
              resources.elements!.uri + context,
              { Accept: resources.elements!.accept },
              options,
            );
            return protocol(() =>
              parseSourcePluginElements(response.body, {
                mainObjectUri,
                selectedObjectUri: resources.objectUri,
                selectedSourceUri: resources.sourceUri,
                sources: session.mode === 'sources',
                maxImplementations: session.limits.nodes - (session.mode === 'sources' ? seen.size : 0),
              }),
            );
          });
          recordGraph(session, graph, key, emittedSources, provider.id, depth);
        } else {
          unavailable = true;
          session.result.issues.push(`enhancement_relation_not_advertised:${unit.type}:${unit.name}`);
        }
        if (session.mode !== 'sources') return;
        let source = current.source ?? session.sourceCache.get(key);
        if (source === undefined) {
          source = await session.read(unit.type, async (options) => {
            const response = await client.http.get(
              `${resources.sourceUri}?version=active`,
              { Accept: 'text/plain' },
              options,
            );
            return response.body;
          });
        }
        session.sourceCache.set(key, source);
        if (Buffer.byteLength(source) > 256 * 1024) {
          session.omit('sources');
          unavailable = true;
          session.result.issues.push(`source_scan_byte_limit:${unit.type}:${unit.name}`);
          continue;
        }
        for (const include of findIncludeStatements(source)) {
          if (++occurrences > 200) {
            session.omit('nodes');
            Object.assign(provider, { status: 'incomplete', reason: 'include_occurrence_limit' });
            break;
          }
          const child = { type: 'INCL' as const, name: include.name };
          const childKey = extensionKey({ ...child, version: 'active' });
          session.addEdge({ from: key, to: childKey, kind: 'include', location: `line ${include.line}` });
          if (seen.has(childKey)) continue;
          if (depth >= session.limits.depth) {
            session.omit('depth');
            continue;
          }
          if (!expandsInclude(include.name, mainUnit.name)) {
            session.result.issues.push(`include_ownership_skipped:${include.name}`);
            unavailable = true;
            continue;
          }
          pending.push({ unit: child, depth: depth + 1 });
        }
      } catch (error) {
        if (error instanceof ExtensionProtocolError)
          session.result.issues.push(`invalid_source_unit:${unit.type}:${unit.name}`);
        session.result.issues.push(
          `source_unit_unreadable:${unit.type}:${unit.name}:${error instanceof AdtApiError ? error.statusCode : 'read_failed'}`,
        );
        if (session.stopped) {
          session.omit('sources', pending.length + 1);
          for (const left of pending.slice(0, 20))
            session.result.issues.push(`source_unit_not_checked:${left.unit.type}:${left.unit.name}`);
        }
        if (session.stopped || session.options.signal?.aborted) throw error;
        unavailable = true;
        if (depth === 0) throw error;
      }
    }
    if (unavailable)
      Object.assign(provider, { status: 'incomplete', reason: 'source_units_unavailable_or_not_advertised' });
    else if (session.mode === 'sources')
      provider.reason = 'bounded actual-source traversal; unread deeper units may exist; runtime applicability unknown';
    if (legacy) provider.reason += '; qualified 750 unadvertised source provider';
    if (session.mode === 'summary' && unavailable) Object.assign(provider, { status: 'unsupported' });
  });
}

function recordGraph(
  session: ExtensionDiscoverySession,
  graph: PluginGraph,
  sourceKey: string,
  emitted: Set<string>,
  provider: string,
  sourceDepth: number,
): void {
  const keys = new Map(graph.implementations.map((i) => [i.name, extensionKey(i)]));
  session.omit('nodes', graph.omittedImplementations);
  session.omit('sources', graph.omittedSources);
  for (const impl of graph.implementations) {
    let depth = sourceDepth;
    let parent = impl;
    while (parent.parent.type.startsWith('ENHO/')) {
      depth++;
      const next = graph.implementations.find((i) => i.name === parent.parent.name);
      if (!next) break;
      parent = next;
    }
    if (
      !session.addNode(
        {
          type: impl.type,
          name: impl.name,
          version: impl.version,
          uri: impl.uri,
          provider,
          family: 'source_plugin',
          applicability: 'unknown',
          ...(impl.switch ? { switch: `${impl.switch.name}:${impl.switch.state}` } : {}),
        },
        session.mode === 'sources' ? depth : 0,
      )
    )
      continue;
    for (const plugin of impl.plugins) {
      session.addEdge({
        from: sourceKey,
        to: extensionKey(impl),
        kind: 'attachment',
        attribute: plugin.id,
        location: `${plugin.fullName} ${plugin.position ?? ''}`,
        suffix: plugin.mode,
      });
      const bodyKey = `${extensionKey(impl)}:${plugin.id}:${plugin.uri}:${createHash('sha256')
        .update(plugin.source ?? '')
        .digest('hex')}`;
      if (plugin.source !== undefined && !emitted.has(bodyKey)) {
        emitted.add(bodyKey);
        session.result.sources.push({
          identity: { type: impl.type, name: impl.name, version: impl.version },
          source: plugin.source,
          representation: 'rendered_plugin_source',
          provider,
        });
      }
    }
  }
  for (const edge of graph.edges)
    session.addEdge({
      from: keys.get(edge.from) ?? edge.from,
      to: keys.get(edge.to) ?? edge.to,
      kind: edge.kind,
      ...(edge.attachment ? { location: edge.attachment } : {}),
    });
}
