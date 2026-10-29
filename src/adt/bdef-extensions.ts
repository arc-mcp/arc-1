/** BDEF extensions: native WUL candidates followed by explicit active-source verification. */
import { bdefRelationRoot, selectBdefCandidates, supportsBdefCandidates } from './bdef-extension-candidates.js';
import { bdefDeclaredEntities } from './bdef-extension-parser.js';
import type { AdtClient } from './client.js';
import { AdtApiError } from './errors.js';
import {
  type ExtensionDiscoverySession,
  ExtensionProtocolError,
  type ExtensionProvider,
  type ExtensionRequest,
  extensionKey,
} from './extension-discovery.js';
import { parseReleaseNumber } from './release.js';
import { NativeRelationProvider, parseRelationXml, RelationProtocolError } from './repository-relations.js';
import { parseDiscoveryObject } from './xml-parser.js';

export interface BdefExtensionCapabilities {
  discovery?: ReadonlyMap<string, string[]>;
  abapRelease?: string;
}

/** No recursion or alternative-route fallback: the native index is explicitly incomplete. */
export async function discoverBdefExtensions(
  client: AdtClient,
  session: ExtensionDiscoverySession,
  request: ExtensionRequest,
  baseSource: string,
  capabilities: BdefExtensionCapabilities = {},
): Promise<void> {
  const provider: ExtensionProvider = {
    id: 'bdef_wul_verified',
    family: 'behavior_extension',
    status: 'returned',
    coverage: 'candidate_index',
    version: 'provider_current',
    nested: 'not_expanded',
    reason: 'WUL candidates verified against active statements; index completeness and runtime applicability unknown.',
  };
  await session.provider(provider, async () => {
    if (request.root.version !== 'active') {
      provider.status = 'unsupported';
      provider.reason = 'unsupported_version: active candidates cannot cover an inactive base.';
      return;
    }
    const release = parseReleaseNumber(capabilities.abapRelease);
    if (release !== undefined && release < 758) {
      provider.status = 'unsupported';
      provider.reason =
        'Behavior extension discovery is unqualified on this release; generic RAP availability is insufficient.';
      return;
    }
    const entities = new Set(bdefDeclaredEntities(baseSource, 'define'));
    if (!entities.size) {
      provider.status = 'unsupported';
      provider.reason = 'No verifiable entity declaration in the base BDEF; no candidates checked.';
      return;
    }
    try {
      const native = new NativeRelationProvider(client, session.options);
      const discovery =
        capabilities.discovery ??
        (await session.read('BDEF', async (options) => {
          const response = await client.http.get(
            '/sap/bc/adt/discovery',
            { Accept: 'application/atomsvc+xml' },
            options,
          );
          const parsed = parseRelationXml(response.body);
          if (!Object.hasOwn(parsed, 'service')) throw new ExtensionProtocolError('Invalid discovery document.');
          return parseDiscoveryObject(parsed);
        }));
      if (!supportsBdefCandidates(discovery, capabilities.abapRelease)) {
        provider.status = 'not_advertised';
        provider.reason = 'The exact BDEF collection and native WUL provider are not advertised.';
        return;
      }
      const root = bdefRelationRoot(request.root.name);
      const network = await session.read('BDEF', () => native.lookup(root, 'incoming'));
      const candidates = selectBdefCandidates(network, root);
      const limit = session.mode === 'summary' ? 2 : Math.max(0, session.limits.nodes - session.result.nodes.length);
      const selected = candidates.slice(0, limit);
      if (candidates.length > selected.length) {
        session.omit('candidates', candidates.length - selected.length);
        provider.status = 'incomplete';
      }
      for (const [index, candidate] of selected.entries()) {
        try {
          const identity = { type: 'BDEF', name: candidate.name, version: 'active' };
          const key = extensionKey(identity);
          let source = session.sourceCache.get(key);
          if (source === undefined) {
            source = (
              await session.read('BDEF', (options) =>
                client.getBdef(candidate.name.toLowerCase(), { ...options, version: 'active' }),
              )
            ).source;
            session.sourceCache.set(key, source);
          }
          const extended = bdefDeclaredEntities(source, 'extend');
          if (!extended.length && !bdefDeclaredEntities(source, 'define').length) {
            provider.status = 'incomplete';
            session.omit('candidates');
            if (session.mode === 'sources') session.omit('sources');
            session.result.issues.push(`BDEF ${candidate.name}: active behavior declaration could not be verified.`);
            continue;
          }
          const targets = extended.filter((entity) => entities.has(entity));
          if (!targets.length) continue;
          if (
            !session.addNode({
              ...identity,
              provider: provider.id,
              family: provider.family,
              uri: candidate.uri,
              applicability: 'unknown',
            })
          ) {
            session.omit('candidates');
            continue;
          }
          for (const entity of targets)
            if (
              !session.addEdge({
                from: key,
                to: extensionKey(request.root),
                kind: 'extends_behavior',
                attribute: entity,
              })
            )
              provider.status = 'incomplete';
          if (session.mode === 'sources')
            session.result.sources.push({ identity, provider: provider.id, representation: 'authored_source', source });
        } catch (error) {
          session.omit('candidates');
          if (session.mode === 'sources') session.omit('sources');
          if (session.stopped || session.options.signal?.aborted || error instanceof RelationProtocolError) {
            session.omit('candidates', selected.length - index - 1);
            throw error;
          }
          provider.status = 'incomplete';
          session.result.issues.push(
            `BDEF ${candidate.name}: active source verification failed${error instanceof AdtApiError ? ` (HTTP ${error.statusCode})` : ''}.`,
          );
        }
      }
    } catch (error) {
      // Native protocol validation must stop the optional phase just like other adapters.
      if (error instanceof RelationProtocolError) {
        session.stopped = true;
        throw new ExtensionProtocolError(error.message);
      }
      throw error;
    }
  });
}
