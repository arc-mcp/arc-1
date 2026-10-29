/** Class-bound identity coverage is distinct from source-code hooks and local class sections. */
import type { AdtClient } from './client.js';
import { enhancementMethodIncludes, readEnhancementIncludeRevision } from './enhancement-include.js';
import { readActiveClassEnhancementSource } from './enhancements.js';
import { AdtApiError } from './errors.js';
import {
  type ExtensionDiscoverySession,
  type ExtensionNode,
  ExtensionProtocolError,
  type ExtensionProvider,
  type ExtensionRequest,
  extensionKey,
} from './extension-discovery.js';
import {
  NativeRelationProvider,
  RELATION_NAME,
  RelationContextError,
  RelationProtocolError,
  relationObjectUri,
} from './repository-relations.js';
import { RevisionHistoryError } from './revision-feed.js';
import { discoverSourcePlugins, type SourcePluginSelection } from './source-plugin-discovery.js';

const PROVIDER = 'class_exted_obj';
const FAMILY = 'class_bound_enhancement';

/** Both providers share one session, while main/local hook coverage stays selected-source scoped. */
export async function discoverClassExtensions(
  client: AdtClient,
  session: ExtensionDiscoverySession,
  request: ExtensionRequest,
  selection: SourcePluginSelection,
  release?: string,
): Promise<void> {
  const identities = await discoverClassIdentities(client, session, request);
  if (request.root.type === 'INTF') return;
  if (session.stopped) {
    session.result.providers.push({
      id: 'source_plugins',
      family: 'source_plugin',
      status: 'incomplete',
      coverage: 'selected_source',
      reason: 'optional_phase_stopped',
      nested: 'not_expanded',
    });
    return;
  }
  await discoverSourcePlugins(client, session, request, selection);
  const hooks = session.result.providers.find((provider) => provider.id === 'source_plugins');
  if (hooks) hooks.reason = `class_section=${selection.unit.section ?? 'main'}; ${hooks.reason ?? ''}`;
  // Rendered hooks already represent these implementations; generated fallback is for missing sources.
  const missing = identities.filter(
    (node) =>
      !session.result.sources.some(
        (source) =>
          source.identity.name.toUpperCase() === node.name.toUpperCase() && source.identity.version === 'active',
      ),
  );
  await discoverClassSources(client, session, missing, release);
}

/** Normalize untrusted provider failures inside session.read so malformed responses stop the phase. */
async function protocol<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RelationProtocolError || error instanceof RevisionHistoryError)
      throw new ExtensionProtocolError('Invalid class enhancement provider response.');
    throw error;
  }
}

export async function discoverClassIdentities(
  client: AdtClient,
  session: ExtensionDiscoverySession,
  request: ExtensionRequest,
): Promise<ExtensionNode[]> {
  const nodes: ExtensionNode[] = [];
  const provider: ExtensionProvider = {
    id: PROVIDER,
    family: FAMILY,
    status: 'returned',
    coverage: 'direct_identities',
    version: 'provider_current',
    nested: 'not_expanded',
    reason: 'owning_object_scope; native ENHO types do not identify enhancement technology or switch applicability',
  };
  await session.provider(provider, async () => {
    if (request.root.version !== 'active') {
      provider.status = 'unsupported';
      provider.reason = 'unsupported_version';
      return;
    }
    const rootType = request.root.type;
    if (rootType !== 'CLAS' && rootType !== 'INTF') {
      provider.status = 'unsupported';
      provider.reason = 'unsupported_provider';
      return;
    }
    await session.read('ENHO', async () => undefined);
    // validateRoot selects fixed CLAS/INTF routes and requires the exact active identity.
    const native = new NativeRelationProvider(client, session.options);
    const root = await session.read(rootType, () =>
      protocol(() => native.validateRoot(rootType, request.root.name, { version: 'active' })),
    );
    let network: Awaited<ReturnType<NativeRelationProvider['lookupExtending']>> | undefined;
    try {
      network = await session.read(rootType, () =>
        protocol(async () => {
          // lookupExtending validates the same root and activeContext before returning any nodes.
          try {
            return await native.lookupExtending(root);
          } catch (error) {
            if (error instanceof RelationContextError && !session.options.attemptBudget?.authorizationFailureObserved)
              return undefined;
            throw error;
          }
        }),
      );
    } catch (error) {
      if (
        error instanceof AdtApiError &&
        !session.options.attemptBudget?.authorizationFailureObserved &&
        [404, 405, 406, 501].includes(error.statusCode)
      ) {
        provider.status = 'unsupported';
        provider.reason = 'unsupported_provider';
        return;
      }
      throw error;
    }
    if (!network) {
      provider.status = 'unsupported';
      provider.reason = 'unsupported_context';
      return;
    }
    // EXTED_OBJ can return a nested graph in one response. Walk only ENHO-to-owner paths rooted here.
    const eligible = new Map(
      network.objects.filter((object) => /^ENHO\//.test(object.type)).map((object) => [object.uri, object]),
    );
    const depths = new Map([[root.uri, -1]]);
    const pending = [root.uri];
    const children = new Map<string, string[]>();
    for (const edge of network.edges) {
      if (!eligible.has(edge.from)) continue;
      const list = children.get(edge.to) ?? [];
      list.push(edge.from);
      children.set(edge.to, list);
    }
    for (let index = 0; index < pending.length; index++) {
      const parent = pending[index]!;
      for (const child of children.get(parent) ?? []) {
        if (depths.has(child)) continue;
        depths.set(child, depths.get(parent)! + 1);
        pending.push(child);
      }
    }
    const identities = new Map<string, ExtensionNode>();
    await session.read('ENHO', async () => {
      for (const uri of pending.slice(1)) {
        const object = eligible.get(uri)!;
        const collection = { 'ENHO/XH': 'enhoxh', 'ENHO/XHH': 'enhoxhh', 'ENHO/XHB': 'enhoxhb' }[object.type];
        if (
          !collection ||
          object.name.length > 30 ||
          !RELATION_NAME.test(object.name) ||
          object.uri !== `/sap/bc/adt/enhancements/${collection}/${encodeURIComponent(object.name.toLowerCase())}`
        )
          throw new ExtensionProtocolError('Invalid native enhancement identity.');
        const node: ExtensionNode = {
          type: object.type,
          name: object.name,
          version: 'active',
          uri: object.uri,
          provider: PROVIDER,
          family: FAMILY,
          applicability: 'unknown',
        };
        if (session.addNode(node, session.mode === 'summary' ? 0 : depths.get(uri))) {
          identities.set(object.uri, node);
          nodes.push(node);
        }
      }
    });
    provider.coverage = 'bounded_traversal';
    provider.nested = 'bounded';
    provider.reason =
      'provider_returned_EXTED_OBJ_graph; owning_object_scope; technology and runtime applicability unknown';
    for (const edge of network.edges) {
      const node = identities.get(edge.from);
      const parent = identities.get(edge.to);
      if (node && (edge.to === root.uri || parent))
        session.result.edges.push({
          from: extensionKey(node),
          to: extensionKey(parent ?? request.root),
          kind: 'extends',
          location: 'EXTED_OBJ; enhancement_to_base',
        });
    }
  });
  return nodes;
}

/** Active ENHO and generated children share the caller's send, byte, time, deny-rule and user boundary. */
export async function discoverClassSources(
  client: AdtClient,
  session: ExtensionDiscoverySession,
  nodes: ExtensionNode[],
  release?: string,
): Promise<void> {
  if (session.mode !== 'sources' || session.stopped) return;
  for (const node of nodes) {
    if (session.stopped) break;
    const provider: ExtensionProvider = {
      id: `${PROVIDER}_source:${node.name}`,
      family: FAMILY,
      status: 'returned',
      coverage: 'selected_source',
      version: 'active',
      nested: 'bounded',
    };
    await session.provider(provider, async () => {
      if (!['ENHO/XH', 'ENHO/XHH'].includes(node.type)) {
        provider.status = 'unsupported';
        provider.reason = 'unsupported_source_provider';
        session.omit('sources');
        return;
      }
      const guarded = {
        http: client.http,
        safety: client.safety,
        getRevisions: (...args: Parameters<AdtClient['getRevisions']>) =>
          session.read('INCL', (options) => client.getRevisions(args[0], args[1], args[2], options)),
        getRevisionSource: (uri: string) => session.read('INCL', (options) => client.getRevisionSource(uri, options)),
      };
      const source = await session.read('ENHO', (options) =>
        protocol(async () => {
          const source = await readActiveClassEnhancementSource(guarded, node, options, release);
          const expectedOwners = [
            { ...session.request.root, type: 'CLAS/OC', uri: relationObjectUri('CLAS', session.request.root.name) },
            ...session.result.nodes.filter((parent) =>
              session.result.edges.some(
                (edge) =>
                  edge.kind === 'extends' && edge.from === extensionKey(node) && edge.to === extensionKey(parent),
              ),
            ),
          ];
          if (
            source.enhancedObject &&
            !expectedOwners.some(
              (owner) =>
                source.enhancedObject!.uri === owner.uri &&
                source.enhancedObject!.type === owner.type &&
                source.enhancedObject!.name.toUpperCase() === owner.name.toUpperCase(),
            )
          )
            throw new ExtensionProtocolError('Enhancement source belongs to another class.');
          return source;
        }),
      );
      if (source.source === undefined) {
        provider.status = 'unsupported';
        provider.reason = 'source_unavailable';
        session.omit('sources');
        return;
      }
      const generated = source.enhancementInclude;
      const identity = generated ? { type: 'INCL', name: generated.name, version: 'active' } : node;
      if (generated && !session.addNode({ ...identity, provider: provider.id, family: FAMILY }, 1)) {
        session.omit('sources');
        return;
      }
      if (generated)
        session.result.edges.push({
          from: extensionKey(node),
          to: extensionKey(identity),
          kind: 'generated_include_revision',
        });
      session.result.sources.push({
        identity,
        provider: provider.id,
        representation: generated ? 'generated_include_revision' : 'authored_source',
        source: source.source,
      });
      if (!generated) return;
      provider.reason = `generated_include=${generated.name}; active_revision=00000; generated_method_includes_only; implementation names may be absent`;
      for (const child of enhancementMethodIncludes(source.source, generated.name)) {
        if (session.stopped) break;
        const identity = { type: 'INCL', name: child, version: 'active' };
        if (!session.addNode({ ...identity, provider: provider.id, family: FAMILY }, 1)) {
          session.omit('sources');
          continue;
        }
        session.result.edges.push({
          from: extensionKey({ type: 'INCL', name: generated.name, version: 'active' }),
          to: extensionKey(identity),
          kind: 'generated_method_include',
        });
        const read = await session.read('INCL', (options) =>
          protocol(() => readEnhancementIncludeRevision(guarded, child, options)),
        );
        if (!read) {
          session.omit('sources');
          provider.status = 'incomplete';
          provider.reason += '; child_active_revision_missing';
          continue;
        }
        session.result.sources.push({
          identity,
          provider: provider.id,
          representation: 'generated_include_revision',
          source: read.source,
        });
      }
    });
    if (provider.status === 'incomplete' || provider.status === 'denied') session.omit('sources');
  }
}
