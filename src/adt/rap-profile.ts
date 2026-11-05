/** Request-owned RAP policy. Public arguments cannot register or select a profile. */
import type { AdtClient } from './client.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import type { RapGenerateActivation } from './rap-generate.js';
import type { RapHandlerScaffoldPlan, RapHandlerSourceSections } from './rap-handlers.js';
import type { ClassMetadata } from './types.js';

export type RapEdit = <T>(
  operation: (http: AdtHttpClient, save: (url: string, source: string) => Promise<void>) => Promise<T>,
) => Promise<T>;
export interface RapProfile {
  readonly context: PinnedMutationContext;
  metadata(): Promise<ClassMetadata>;
  bdef(http: AdtHttpClient, name: string): Promise<string>;
  sources(http: AdtHttpClient): Promise<RapHandlerSourceSections>;
  validateSources(bdef: string, sections: RapHandlerSourceSections, alias: string): void;
  validatePlan(plan: RapHandlerScaffoldPlan): void;
  edit: RapEdit;
  activate(): Promise<RapGenerateActivation>;
}
const profiles = new WeakMap<AdtClient, RapProfile>();
export function registerRapProfile(client: AdtClient, profile: RapProfile): () => void {
  assertMutationContext(client.safety, profile.context);
  if (profiles.has(client)) throw new AdtSafetyError('The RAP client already owns a profile.');
  profiles.set(client, profile);
  return () => profiles.delete(client);
}
export function rapProfile(client: AdtClient): RapProfile | undefined {
  const profile = profiles.get(client);
  if (client.safety.multiTargetWrite && !profile)
    throw new AdtSafetyError('A registered pinned RAP profile is required.');
  if (profile) assertMutationContext(client.safety, profile.context);
  return profile;
}
