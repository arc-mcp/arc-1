import { type DdicExtensionClient, discoverDdicAppends } from './ddic-extensions.js';
import { parseEmbeddedStructures } from './embedded-structures.js';
import { type ExtensionAdapter, type ExtensionNode, extensionKey } from './extension-discovery.js';

/** Summary is two linked GETs after a fresh TABL base. Sources expands actual DDIC occurrences. */
export function ddicExtensionAdapter(client: DdicExtensionClient, baseSource: string): ExtensionAdapter {
  return async (session, request) => {
    if (session.mode === 'summary' || request.root.version !== 'active') {
      await discoverDdicAppends(client, session, request.root.name);
      return;
    }
    const queue = [{ name: request.root.name.toUpperCase(), identity: request.root, source: baseSource, depth: 0 }];
    const expanded = new Set<string>();
    let scanIncomplete = false;
    const fetched = new Set<string>([extensionKey(request.root)]);
    for (let cursor = 0; cursor < queue.length && !session.stopped; cursor++) {
      const current = queue[cursor]!;
      if (expanded.has(current.name)) continue;
      expanded.add(current.name);
      const { references } = await discoverDdicAppends(
        client,
        session,
        current.name,
        current.depth + 1,
        current.identity,
      );
      const scanIssues: string[] = [];
      const embedded = parseEmbeddedStructures(current.source, scanIssues);
      if (scanIssues.length) {
        scanIncomplete = true;
        session.result.issues.push(...scanIssues.map((issue) => `ddic_source_scan:${current.name}:${issue}`));
      }
      const includes: ExtensionNode[] = embedded.map((ref) => {
        const node: ExtensionNode = {
          type: 'TABL',
          name: ref.name,
          version: 'active',
          provider: 'ddic_source_includes',
          family: 'ddic_include',
        };
        if (session.addNode(node, current.depth + 1))
          session.addEdge({
            from: extensionKey(current.identity),
            to: extensionKey(node),
            kind: 'include',
            observationVersion: 'active',
            attribute: ref.attribute,
            ...(ref.suffix ? { suffix: ref.suffix } : {}),
          });
        return node;
      });
      for (const node of [...references, ...includes]) {
        if (session.stopped) {
          session.omit('sources');
          continue;
        }
        const key = extensionKey({ ...node, version: 'active' });
        if (fetched.has(key)) continue;
        // Discovery already charged node omissions; never fetch omitted identities.
        if (
          !session.result.nodes.some(
            (existing) => existing.name.toUpperCase() === node.name.toUpperCase() && existing.type === node.type,
          )
        ) {
          session.omit('sources');
          continue;
        }
        fetched.add(key);
        const provider = {
          id: node.provider,
          family: node.family,
          status: 'returned' as const,
          coverage: 'bounded_traversal' as const,
          version: 'active',
          scope: node.name,
        };
        await session.provider(provider, async () => {
          const source = await session.read(
            'TABL',
            async (options) =>
              (
                await (node.family === 'ddic_append'
                  ? client.getStructure(node.name, { ...options, version: 'active' })
                  : client.getTabl(node.name, { ...options, version: 'active' }))
              ).source,
          );
          session.sourceCache.set(key, source);
          session.result.sources.push({
            identity: { ...node, version: 'active' },
            representation: 'authored_source',
            source,
            provider: node.provider,
          });
          if (current.depth < session.limits.depth)
            queue.push({ name: node.name, identity: node, source, depth: current.depth + 1 });
          else session.omit('depth');
        });
        if (provider.status !== 'returned') session.omit('sources');
      }
    }
    session.result.providers.push({
      id: 'ddic_source_includes',
      family: 'ddic_include',
      status: session.stopped || scanIncomplete ? 'incomplete' : 'returned',
      coverage: 'bounded_traversal',
      nested: 'bounded',
      reason: 'Actual source includes and metadata-linked appends; bounded traversal, separate observations.',
    });
  };
}
