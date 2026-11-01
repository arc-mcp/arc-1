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
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private filePath: string) {
    // Flush buffer every 500ms to balance write frequency vs latency
    this.flushTimer = setInterval(() => {
      void this.writeBuffer();
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

  private writeBuffer(): Promise<void> {
    if (this.buffer.length > 0) {
      const data = `${this.buffer.splice(0).join('\n')}\n`;
      // Serialize batches so flush() also waits for appends started by the interval.
      this.pendingWrite = this.pendingWrite
        .then(() => this.appendPrivate(data))
        .catch((err) => {
          process.stderr.write(`[FileSink] Failed to write to ${this.filePath}: ${err}\n`);
        });
    }
    return this.pendingWrite;
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
