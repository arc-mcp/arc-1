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

export interface SapWriteContext {
  client: AdtClient;
  args: Record<string, unknown>;
  config: ServerConfig;
  cachingLayer: CachingLayer | undefined;
  cacheSecurity: CacheSecurityContext;
  action: string;
  type: string;
  name: string;
  source: string;
  hasSource: boolean;
  include: ClassWriteInclude | undefined;
  includeProvided: boolean;
  transport: string | undefined;
  lintOverride: boolean | undefined;
  preflightOverride: boolean | undefined;
  checkOverride: boolean | undefined;
  objectUrl: string;
  srcUrl: string;
  invalidateWrittenObject: (objType?: string, objName?: string) => void;
  enforcePackageForExistingObject: () => Promise<string | undefined>;
  fetchClassStructureAndMain: (
    clsName: string,
  ) => Promise<{ structure: ClassStructure; main: string; effectiveVersion: SourceVersion }>;
}
