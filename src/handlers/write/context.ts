/**
 * Shared context for the per-action SAPWrite handlers (Stage D split of write.ts).
 */

import type { AdtClient } from '../../adt/client.js';
import type { ClassStructure } from '../../adt/types.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import type { ServerConfig } from '../../server/types.js';
import type { CacheSecurityContext } from '../cache-security.js';
import type { ClassWriteInclude } from '../object-types.js';
import type { SourceVersion } from '../read.js';

/**
 * Built once by handleSAPWrite after its prologue and passed to each writeAction*. Fields are
 * `readonly`: the action handlers consume the resolved request, they never re-resolve it — and the
 * three closures capture the prologue's locals, so reassigning a field here would silently desync
 * them (e.g. invalidateWrittenObject would key the cache off the old name).
 */
export interface SapWriteContext {
  readonly client: AdtClient;
  readonly args: Record<string, unknown>;
  readonly config: ServerConfig;
  readonly cachingLayer: CachingLayer | undefined;
  readonly cacheSecurity: CacheSecurityContext;
  readonly type: string;
  readonly name: string;
  readonly source: string;
  readonly hasSource: boolean;
  readonly include: ClassWriteInclude | undefined;
  readonly includeProvided: boolean;
  readonly transport: string | undefined;
  readonly lintOverride: boolean | undefined;
  readonly preflightOverride: boolean | undefined;
  readonly checkOverride: boolean | undefined;
  readonly objectUrl: string;
  readonly srcUrl: string;
  readonly invalidateWrittenObject: (objType?: string, objName?: string) => void;
  readonly enforcePackageForExistingObject: () => Promise<string | undefined>;
  readonly fetchClassStructureAndMain: (
    clsName: string,
  ) => Promise<{ structure: ClassStructure; main: string; effectiveVersion: SourceVersion }>;
}
