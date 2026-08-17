/**
 * Startup observability — effective-policy log + contradiction warnings.
 *
 * Emits a single structured log line at startup with the resolved safety config,
 * plus a human-readable one-liner and (at debug level) per-field source attribution.
 * Also scans for useless/dangerous flag combinations and warns about them.
 *
 * Called once from src/server/server.ts after resolveConfig() returns. The same
 * functions are reused by `arc1 config show` (Task 9).
 */

import type { Logger } from './logger.js';
import type { ConfigSource, ServerConfig } from './types.js';

/** Emit effective policy log lines (structured + human-readable + sources at debug). */
export function logEffectivePolicy(config: ServerConfig, sources: Record<string, ConfigSource>, logger: Logger): void {
  const safety = {
    allowWrites: config.allowWrites,
    allowDataPreview: config.allowDataPreview,
    allowFreeSQL: config.allowFreeSQL,
    allowTransportWrites: config.allowTransportWrites,
    allowGitWrites: config.allowGitWrites,
    gzipDataPreviewBody: config.gzipDataPreviewBody,
    allowedPackages: config.allowedPackages,
    allowedTransports: config.allowedTransports,
    denyActionsCount: config.denyActions.length,
  };

  // Structured log — emitted as info with the safety object as metadata
  // (doesn't use emitAudit because effective_policy isn't a per-request audit event)
  logger.info('effective policy resolved', safety);

  // Human-readable one-liner — for humans scanning stderr
  const yn = (v: boolean): string => (v ? 'YES' : 'NO');
  const line =
    `effective safety: writes=${yn(config.allowWrites)} data=${yn(config.allowDataPreview)} ` +
    `sql=${yn(config.allowFreeSQL)} packages=[${config.allowedPackages.join(',')}] ` +
    `transports=${yn(config.allowTransportWrites)} git=${yn(config.allowGitWrites)} ` +
    `gzipDataPreview=${yn(config.gzipDataPreviewBody)} denyActions=${config.denyActions.length}`;
  logger.info(line);

  // Per-field source attribution — debug-level detail for "where did this value come from?"
  const formatSource = (s: ConfigSource): string => {
    if (s === 'default') return 'default';
    if (typeof s === 'object') {
      if ('env' in s) return `env ${s.env}`;
      if ('flag' in s) return `flag ${s.flag}`;
      if ('file' in s) return `file ${s.file}`;
    }
    return 'unknown';
  };
  const relevantFields = [
    'allowWrites',
    'allowDataPreview',
    'allowFreeSQL',
    'allowTransportWrites',
    'allowGitWrites',
    'gzipDataPreviewBody',
    'allowedPackages',
    'allowedTransports',
    'denyActions',
  ];
  const sourceMap: Record<string, string> = {};
  for (const f of relevantFields) {
    if (sources[f] !== undefined) sourceMap[f] = formatSource(sources[f]);
  }
  logger.debug('effective-policy sources', sourceMap);
}

/**
 * Detect useless/dangerous flag combinations and return human-readable warnings.
 *
 * Categories:
 *   1. allowTransportWrites=true + allowWrites=false — transport mutations blocked anyway.
 *   2. allowGitWrites=true + allowWrites=false — same for git.
 *   3. allowedPackages is non-default but allowWrites=false — restriction is unreachable.
 *   4. gzipDataPreviewBody=true while both data-preview gates are false — encoding is unreachable.
 *   5. denyActions entry already gated by a server flag (informational only).
 */
export function detectContradictions(config: ServerConfig): string[] {
  const warnings: string[] = [];

  if (config.allowTransportWrites && !config.allowWrites) {
    warnings.push('allowTransportWrites=true has no effect when allowWrites=false; transport writes will be blocked.');
  }

  if (config.allowGitWrites && !config.allowWrites) {
    warnings.push('allowGitWrites=true has no effect when allowWrites=false; git writes will be blocked.');
  }

  if (config.gzipDataPreviewBody && !config.allowDataPreview && !config.allowFreeSQL) {
    warnings.push(
      'gzipDataPreviewBody=true has no effect when allowDataPreview=false and allowFreeSQL=false; no data-preview request body can reach the transport.',
    );
  }

  // Default allowedPackages is ['$TMP']. Anything else is a configured restriction
  // that has no effect if writes are globally disabled.
  const isDefaultPackages = config.allowedPackages.length === 1 && config.allowedPackages[0] === '$TMP';
  if (!isDefaultPackages && config.allowedPackages.length > 0 && !config.allowWrites) {
    warnings.push(
      `allowedPackages=${JSON.stringify(config.allowedPackages)} is configured but allowWrites=false; restriction has no effect (reads are not package-gated).`,
    );
  }

  // Informational: denyActions entry for a tool/action that's already out of reach.
  // Example: denyActions=['SAPWrite.delete'] while allowWrites=false.
  if (!config.allowWrites) {
    for (const pattern of config.denyActions) {
      if (pattern.startsWith('SAPWrite') || pattern.startsWith('SAPActivate') || pattern.startsWith('SAPManage')) {
        warnings.push(
          `denyActions entry '${pattern}' is already unreachable because allowWrites=false (informational, not an error).`,
        );
      }
    }
  }

  return warnings;
}

/** Log each contradiction warning via logger.warn (stderr). */
export function logContradictions(warnings: string[], logger: Logger): void {
  for (const w of warnings) logger.warn(`config contradiction: ${w}`);
}
