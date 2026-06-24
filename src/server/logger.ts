/**
 * Logger for ARC-1.
 *
 * Critical: ALL output goes to stderr, never stdout.
 * stdout is reserved for the MCP JSON-RPC stream (stdio transport).
 * Using console.log() would corrupt the MCP protocol.
 *
 * Supports two output formats:
 * - 'text': human-readable for local development
 * - 'json': structured for cloud deployments (CF, K8s, Datadog)
 *
 * Architecture: the Logger dispatches to registered LogSinks.
 * StderrSink is always active. FileSink and BTPAuditLogSink are optional.
 *
 * The emitAudit() method writes structured audit events to ALL sinks
 * (file/BTP sinks receive all events regardless of stderr level filter).
 *
 * Per OWASP MCP guide and Datadog recommendations, every log entry
 * includes timestamp and level. Tool call logs include correlation
 * context (session ID, tool name, duration).
 */

import { type AuditEvent, redactAuditEvent } from './audit.js';
import { getCurrentContext } from './context.js';
import { type LogFormat as SinkLogFormat, StderrSink } from './sinks/stderr.js';
import type { LogSink } from './sinks/types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = SinkLogFormat;

export interface LogContext {
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private minLevel: number;
  private sinks: LogSink[];

  constructor(
    private format: LogFormat = 'text',
    verbose: boolean = false,
  ) {
    this.minLevel = verbose ? LEVEL_PRIORITY.debug : LEVEL_PRIORITY.info;
    // Default: stderr only
    this.sinks = [new StderrSink(format, verbose ? 'debug' : 'info')];
  }

  /** Add a log sink (file, BTP audit log, etc.) */
  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  /** Get all registered sinks (for testing) */
  getSinks(): readonly LogSink[] {
    return this.sinks;
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  /**
   * Emit a structured audit event to all sinks.
   * Each sink handles its own level filtering.
   * Automatically attaches requestId from AsyncLocalStorage context.
   */
  emitAudit(event: AuditEvent): void {
    let eventWithContext = event;
    // Attach requestId from context if not already set
    if (!event.requestId) {
      const ctx = getCurrentContext();
      if (ctx) {
        eventWithContext = {
          ...event,
          requestId: ctx.requestId,
          ...(!event.user && ctx.user ? { user: ctx.user } : {}),
        };
      }
    }

    const safeEvent = redactAuditEvent(eventWithContext);

    for (const sink of this.sinks) {
      try {
        sink.write(safeEvent);
      } catch {
        // Sinks must not throw — but if they do, don't crash the server
      }
    }
  }

  /** Flush all sinks (for graceful shutdown) */
  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((s) => s.flush?.()));
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_PRIORITY[level] < this.minLevel) return;

    // Redact sensitive fields from context
    const safeContext = context ? redactSensitive(context) : undefined;

    if (this.format === 'json') {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...safeContext,
      };
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    } else {
      const ts = new Date().toISOString();
      const ctx = safeContext ? ` ${JSON.stringify(safeContext)}` : '';
      process.stderr.write(`[${ts}] ${level.toUpperCase()}: ${message}${ctx}\n`);
    }
  }
}

/** Redact known sensitive fields to prevent credential leakage in logs */
function redactSensitive(context: LogContext): LogContext {
  const sensitiveKeys = ['password', 'token', 'cookie', 'authorization', 'secret', 'csrf'];
  const result: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** Global logger instance — initialized during server startup */
export let logger = new Logger('text', false);

/** Initialize the global logger with server configuration */
export function initLogger(format: LogFormat, verbose: boolean): void {
  logger = new Logger(format, verbose);
}

/**
 * Structural-logger view of the global {@link logger} for `@arc-mcp/xsuaa-auth`.
 *
 * The package's `Logger` interface (SPEC §5) types `emitAudit` as
 * `(event: Record<string, unknown>) => void`, whereas ARC-1's `Logger.emitAudit`
 * accepts the narrower `AuditEvent` union. A function that requires `AuditEvent`
 * is contravariantly NOT assignable where any `Record<string, unknown>` may be
 * passed, so ARC-1's `logger` cannot be handed to the package directly. This thin
 * adapter widens `emitAudit` and forwards verbatim — the package only ever emits
 * objects matching ARC-1's audit-event shapes (oauth_client_registered,
 * oauth_redirect_uri_registered/_rejected, oauth_client_lookup_failed), which
 * were lifted from ARC-1, so the cast is sound. The other four methods are
 * structurally identical and pass through unchanged. Resolves `logger` lazily so
 * `initLogger()`'s reassignment is honored.
 */
export const authLibLogger = {
  debug: (message: string, data?: Record<string, unknown>): void => logger.debug(message, data),
  info: (message: string, data?: Record<string, unknown>): void => logger.info(message, data),
  warn: (message: string, data?: Record<string, unknown>): void => logger.warn(message, data),
  error: (message: string, data?: Record<string, unknown>): void => logger.error(message, data),
  emitAudit: (event: Record<string, unknown>): void => logger.emitAudit(event as unknown as AuditEvent),
};
