import type { AuditEvent } from './audit.js';
import type { LogSink } from './sinks/types.js';

export interface UiLogEntry {
  timestamp: string;
  level: string;
  event: string;
  requestId?: string;
  user?: string;
  clientId?: string;
  [key: string]: unknown;
}

export interface UiLogQuery {
  event?: string;
  level?: string;
  requestId?: string;
  limit?: number;
}

export class UiLogBufferSink implements LogSink {
  private readonly entries: UiLogEntry[] = [];

  constructor(private readonly maxEntries = 500) {}

  write(event: AuditEvent): void {
    this.entries.push(sanitizeAuditEvent(event));
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  list(query: UiLogQuery = {}): { total: number; limit: number; items: UiLogEntry[] } {
    const limit = clampLimit(query.limit);
    const filtered = this.entries
      .filter((entry) => !query.event || entry.event === query.event)
      .filter((entry) => !query.level || entry.level === query.level)
      .filter((entry) => !query.requestId || entry.requestId === query.requestId);

    return {
      total: filtered.length,
      limit,
      items: filtered.slice(-limit).reverse(),
    };
  }
}

function sanitizeAuditEvent(event: AuditEvent): UiLogEntry {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event) as Array<[string, unknown]>) {
    if (isSensitiveLogField(key)) continue;
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized as UiLogEntry;
}

function isSensitiveLogField(key: string): boolean {
  return (
    [
      'requestBody',
      'responseBody',
      'requestHeaders',
      'responseHeaders',
      'errorBody',
      'resultPreview',
      'registeredClientId',
    ].includes(key) || /password|token|secret|cookie|authorization|csrf/i.test(key)
  );
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}... [truncated ${value.length} chars]` : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveLogField(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeValue(nested);
      }
    }
    return result;
  }
  return value;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(limit)));
}
