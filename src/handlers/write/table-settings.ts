import type { AdtClient } from '../../adt/client.js';
import {
  assertTableSettingsService,
  parseTableSettingsPatch,
  tableSettingsParentUrl,
  updateTableSettings,
} from '../../adt/table-settings.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import { type CacheSecurityContext, invalidateInactiveList } from '../cache-security.js';
import { errorResult, textResult } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';

export async function writeTableSettings(
  client: AdtClient,
  action: string,
  name: string,
  args: Record<string, unknown>,
  cache: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
) {
  if (action !== 'update')
    return errorResult('TABL/DTT supports update only; create or delete the parent TABL instead.');
  if (typeof args.source !== 'string')
    return errorResult('TABL/DTT source must be a partial JSON object of technical settings.');
  const patch = parseTableSettingsPatch(args.source);
  await assertTableSettingsService(client.http, client.safety);
  await enforceAllowedPackageForObjectUrl(client, tableSettingsParentUrl(name), `Technical settings of TABL '${name}'`);
  let previousVersion: string;
  try {
    previousVersion = await updateTableSettings(
      client.http,
      client.safety,
      name,
      patch,
      args.transport as string | undefined,
    );
  } finally {
    cache?.invalidate('TABL/DTT', name, 'all');
    invalidateInactiveList(cache, client, cacheSecurity);
  }
  const activation = previousVersion === 'new' ? 'TABL' : 'TABL/DTT';
  return textResult(
    `Saved technical settings of ${name}. Activate with SAPActivate(type="${activation}", name="${name}").` +
      (previousVersion === 'inactive'
        ? ' Existing inactive settings were preserved except for the supplied fields; activation applies the entire draft.'
        : ''),
  );
}
