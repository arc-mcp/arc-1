import { expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  buildCdsActivationDependencyHint,
  buildCdsDeleteDependencyHint,
  buildCdsUpdateCrudHint,
} from '../../../src/handlers/cds-hints.js';

it.each([
  // Native 7.50 resultDescription; translated text must survive without English-message matching.
  'Where-used is not supported at this position. Select a supported object and perform the search again.',
  'Die Verwendungsnachweissuche wird an dieser Position nicht unterstützt.',
])('preserves SAP explanations for empty CDS results: %s', async (description) => {
  const post = vi.fn().mockResolvedValue({
    body: `<usageReferences:usageReferenceResult numberOfResults="0" resultDescription="${description}" referencedObjectIdentifier="" xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"><usageReferences:referencedObjects/></usageReferences:usageReferenceResult>`,
  });
  const client = { http: { post }, safety: unrestrictedSafetyConfig() } as unknown as AdtClient;
  const uri = '/sap/bc/adt/ddic/ddl/sources/zi_base';

  const update = await buildCdsUpdateCrudHint(client, 'ZI_BASE', uri);
  const deletion = await buildCdsDeleteDependencyHint(client, 'DDLS', 'ZI_BASE', uri);
  const activation = await buildCdsActivationDependencyHint(client, 'ZI_BASE', uri);

  for (const hint of [update, deletion, activation]) expect(hint).toContain(`SAP where-used response: ${description}`);
  expect(update).toContain('does not establish that none exist');
  expect(post).toHaveBeenCalledTimes(3);
  expect(post.mock.calls.every(([path]) => !path.includes('/scope'))).toBe(true);
});
