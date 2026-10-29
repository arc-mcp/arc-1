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
  RelationContextError,
  RelationProtocolError,
  relationObjectUri,
} from './repository-relations.js';
import { RevisionHistoryError } from './revision-feed.js';

const PROVIDER = 'class_exted_obj';
const FAMILY = 'class_bound_enhancement';

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
            if (error instanceof RelationContextError) return undefined;
            throw error;
          }
        }),
      );
    } catch (error) {
      if (error instanceof AdtApiError && [404, 405, 406, 501].includes(error.statusCode)) {
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
    // The native normalizer retains direction; validate subtype paths before exposing/fetching identities.
    const selected = network.objects.filter(
      (object) =>
        /^ENHO\//.test(object.type) && network.edges.some((edge) => edge.from === object.uri && edge.to === root.uri),
    );
    const identities = new Map<string, ExtensionNode>();
    await session.read('ENHO', async () => {
      for (const object of selected) {
        const collection = { 'ENHO/XH': 'enhoxh', 'ENHO/XHH': 'enhoxhh', 'ENHO/XHB': 'enhoxhb' }[object.type];
        if (
          !collection ||
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
        if (session.addNode(node)) {
          identities.set(object.uri, node);
          nodes.push(node);
        }
      }
    });
    for (const edge of network.edges) {
      const node = identities.get(edge.from);
      if (node && edge.to === root.uri)
        session.result.edges.push({
          from: extensionKey(node),
          to: extensionKey(request.root),
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
          if (
            source.enhancedObject &&
            (source.enhancedObject.uri !== relationObjectUri('CLAS', session.request.root.name) ||
              source.enhancedObject.name.toUpperCase() !== session.request.root.name.toUpperCase() ||
              source.enhancedObject.type !== 'CLAS/OC')
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
      provider.reason = `generated_include=${generated.name}; active_revision=00000; implementation names may be absent`;
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
  }
}
