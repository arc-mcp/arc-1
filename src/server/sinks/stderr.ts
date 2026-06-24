/**
 * Stderr log sink for ARC-1.
 *
 * Writes audit events to stderr in text or JSON format.
 * This is the default sink — always active.
 *
 * Critical: never write to stdout (reserved for MCP JSON-RPC).
 */

import type { AuditEvent } from '../audit.js';
import type { LogLevel } from '../logger.js';
import type { LogSink } from './types.js';

export type LogFormat = 'text' | 'json';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class StderrSink implements LogSink {
  private minLevel: number;

  constructor(
    private format: LogFormat = 'text',
    minLevel: LogLevel = 'info',
  ) {
    this.minLevel = LEVEL_PRIORITY[minLevel];
  }

  write(event: AuditEvent): void {
    if (LEVEL_PRIORITY[event.level] < this.minLevel) return;

    if (this.format === 'json') {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    } else {
      const { timestamp, level, event: eventType, ...rest } = event;
      const ctx = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
      process.stderr.write(`[${timestamp}] ${level.toUpperCase()}: [${eventType}]${ctx}\n`);
    }
  }
}
