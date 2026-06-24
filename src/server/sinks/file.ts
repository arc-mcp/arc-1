/**
 * File log sink for ARC-1.
 *
 * Appends JSON-line audit events to a file.
 * Useful in Docker (mount volume) or for post-hoc log analysis.
 *
 * Writes are fire-and-forget — errors are logged to stderr but never thrown.
 * All events are written regardless of level (file is the full audit trail).
 */

import { appendFile, chmod } from 'node:fs/promises';
import type { AuditEvent } from '../audit.js';
import type { LogSink } from './types.js';

const PRIVATE_FILE_MODE = 0o600;

export class FileSink implements LogSink {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private permissionsPromise: Promise<void> | undefined;

  constructor(private filePath: string) {
    // Flush buffer every 500ms to balance write frequency vs latency
    this.flushTimer = setInterval(() => {
      this.flushSync();
    }, 500);
    // Don't prevent process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  write(event: AuditEvent): void {
    this.buffer.push(JSON.stringify(event));
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.writeBuffer();
  }

  private flushSync(): void {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.splice(0);
    const data = `${lines.join('\n')}\n`;
    // Fire-and-forget — errors go to stderr
    this.appendPrivate(data).catch((err) => {
      process.stderr.write(`[FileSink] Failed to write to ${this.filePath}: ${err}\n`);
    });
  }

  private async writeBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.splice(0);
    const data = `${lines.join('\n')}\n`;
    try {
      await this.appendPrivate(data);
    } catch (err) {
      process.stderr.write(`[FileSink] Failed to write to ${this.filePath}: ${err}\n`);
    }
  }

  private async appendPrivate(data: string): Promise<void> {
    await this.ensurePrivateFile();
    await appendFile(this.filePath, data, { encoding: 'utf-8', mode: PRIVATE_FILE_MODE });
  }

  private ensurePrivateFile(): Promise<void> {
    if (!this.permissionsPromise) {
      this.permissionsPromise = appendFile(this.filePath, '', { encoding: 'utf-8', mode: PRIVATE_FILE_MODE }).then(() =>
        chmod(this.filePath, PRIVATE_FILE_MODE),
      );
    }
    return this.permissionsPromise;
  }
}
