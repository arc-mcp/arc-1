/** Bind existing native client adapters to the mutation transport without changing their read implementations. */
import type { AdtClient } from './client.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { assertMutationContext, type MutationContext, singleTargetMutationContext } from './mutation-context.js';
import { getMutationContext, mutationHttp } from './mutation-http.js';
import { createPinnedPackageHierarchyResolver } from './package-hierarchy.js';

export function mutationPackageHierarchy(client: AdtClient, options?: AdtRequestOptions) {
  return createPinnedPackageHierarchyResolver(
    (root, policy) => client.getSubpackages(root, 1000, policy),
    options ?? getMutationContext(client.http, client.safety)?.requestPolicy,
  );
}

export function mutationClient(
  client: AdtClient,
  context: MutationContext,
  http: AdtHttpClient = client.http,
): AdtClient {
  assertMutationContext(client.safety, context);
  if (context.mode === 'single-target' && http === client.http) return client;
  // Same prototype/own-field contract as AdtClient.withSafety and withStatefulSession.
  // Pinned clients are request-local; their package checks bypass the legacy cache holder.
  return Object.assign(Object.create(Object.getPrototypeOf(client)) as AdtClient, client, {
    http: mutationHttp(http, client.safety, context),
  });
}

/** Optional responsibility must not be populated from an unverified IdP username on pinned PP. */
export async function mutationResponsible(client: AdtClient, configuredUsername: string): Promise<string | undefined> {
  const context = getMutationContext(client.http, client.safety) ?? singleTargetMutationContext(client.safety);
  if (context.identityMode === 'mapped-user-unverified') return undefined;
  return configuredUsername || (await client.getEffectiveUser());
}
