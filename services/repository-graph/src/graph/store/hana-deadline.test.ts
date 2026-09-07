import type { Connection } from '@sap/hana-client';
import { afterEach, expect, it, vi } from 'vitest';

const driver = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), abort: vi.fn() }));
vi.mock('@sap/hana-client', () => ({ default: { createConnection: () => driver } }));

import { HanaSession, withHanaSession } from './hana-connection.js';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('never starts database work after a late connection crosses the deadline', async () => {
  vi.useFakeTimers();
  const operation = vi.fn();
  const env = {
    ARC_GRAPH_HANA_SERVICE_BINDING: 'reader',
    VCAP_SERVICES: JSON.stringify({
      'user-provided': [
        { name: 'reader', credentials: { host: 'hana.example.test', port: 443, user: 'READER', password: 'private' } },
      ],
    }),
  };
  const promise = withHanaSession(operation, env);
  const assertion = expect(promise).rejects.toThrow('deadline exceeded');
  await vi.advanceTimersByTimeAsync(4500);
  await assertion;
  expect(driver.abort).toHaveBeenCalledOnce();
  const connected = driver.connect.mock.calls[0]![1] as (error?: Error) => void;
  connected();
  await vi.advanceTimersByTimeAsync(1);
  expect(operation).not.toHaveBeenCalled();
  expect(driver.disconnect).toHaveBeenCalled();
});

it('database errors disclose only the numeric error code, never SQL or bound values', async () => {
  const exec = vi.fn((_sql, _parameters, callback) =>
    callback(Object.assign(new Error('SECRET_SOURCE_PASSWORD'), { code: 258 })),
  );
  const session = new HanaSession({ exec } as unknown as Connection);
  await expect(session.exec('SELECT ?', ['SECRET_SOURCE_PASSWORD'])).rejects.toThrow(/^HANA operation failed \(258\)$/);
});
