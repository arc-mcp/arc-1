import { afterEach, expect, it, vi } from 'vitest';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { PerUserTransportPool } from '../../../src/server/per-user-transport.js';

let now = 0;
const transport = () => new AdtHttpClient({ baseUrl: 'http://sap:8000' });

afterEach(() => {
  vi.restoreAllMocks();
  now = 0;
});

function pool(maxAgeMs = 1_000, maxEntries?: number) {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return new PerUserTransportPool(maxAgeMs, maxEntries);
}

it('returns the same transport only for the same credential and route', () => {
  const transports = pool();
  const alice = transports.take('Bearer alice', ['PER_USER', 'http://sap:8000', '001'], transport);

  expect(transports.take('Bearer alice', ['PER_USER', 'http://sap:8000', '001'], transport)).toBe(alice);
  expect(transports.take('Bearer bob', ['PER_USER', 'http://sap:8000', '001'], transport)).not.toBe(alice);
  expect(transports.take('Bearer alice', ['PER_USER', 'http://sap:8000', '002'], transport)).not.toBe(alice);
  expect(transports.take('Bearer alice', ['OTHER', 'http://sap:8000', '001'], transport)).not.toBe(alice);
});

it('never pools a request without a credential', () => {
  const transports = pool();
  const first = transports.take('', ['PER_USER'], transport);

  expect(transports.take('', ['PER_USER'], transport)).not.toBe(first);
  expect(transports.size).toBe(0);
});

it('replaces an entry for new requests at the maximum age and drops other aged entries', () => {
  const transports = pool(1_000);
  const alice = transports.take('Bearer alice', ['PER_USER'], transport);
  now = 500;
  transports.take('Bearer bob', ['PER_USER'], transport);

  now = 999;
  expect(transports.take('Bearer alice', ['PER_USER'], transport)).toBe(alice);
  now = 1_000;
  expect(transports.take('Bearer alice', ['PER_USER'], transport)).not.toBe(alice);
  expect(transports.size).toBe(2);
  now = 1_500;
  transports.take('Bearer carol', ['PER_USER'], transport);
  // Bob aged out without being requested again; only the renewed Alice entry and Carol remain.
  expect(transports.size).toBe(2);
});

it('drops the oldest user first when the entry limit is reached', () => {
  const transports = pool(60_000, 2);
  const alice = transports.take('Bearer alice', ['PER_USER'], transport);
  const bob = transports.take('Bearer bob', ['PER_USER'], transport);
  transports.take('Bearer carol', ['PER_USER'], transport);

  expect(transports.size).toBe(2);
  expect(transports.take('Bearer bob', ['PER_USER'], transport)).toBe(bob);
  expect(transports.take('Bearer alice', ['PER_USER'], transport)).not.toBe(alice);
});
