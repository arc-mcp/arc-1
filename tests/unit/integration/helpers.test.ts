import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSapCredentials, requireSapCredentials } from '../../integration/helpers.js';

// These are unit fixtures: importing the live helper must never load workspace credentials.
vi.mock('dotenv', () => ({ config: vi.fn() }));

const SAP_ENV_KEYS = [
  'TEST_SAP_URL',
  'TEST_SAP_USER',
  'TEST_SAP_PASSWORD',
  'SAP_URL',
  'SAP_USER',
  'SAP_PASSWORD',
] as const;

const originalEnv: Record<string, string | undefined> = Object.fromEntries(
  SAP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearSapEnv(): void {
  for (const key of SAP_ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of SAP_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('integration helpers credential enforcement', () => {
  it('throws when SAP credentials are missing', () => {
    clearSapEnv();

    expect(hasSapCredentials()).toBe(false);
    expect(() => requireSapCredentials()).toThrow(/Integration test setup error/);
  });

  it('accepts TEST_SAP_* credentials', () => {
    clearSapEnv();
    process.env.TEST_SAP_URL = 'http://example.sap.local:50000';
    process.env.TEST_SAP_USER = 'DEVELOPER';
    process.env.TEST_SAP_PASSWORD = 'secret';

    expect(hasSapCredentials()).toBe(true);
    expect(() => requireSapCredentials()).not.toThrow();
  });

  it('accepts SAP_* fallback credentials', () => {
    clearSapEnv();
    process.env.SAP_URL = 'http://example.sap.local:50000';
    process.env.SAP_USER = 'DEVELOPER';
    process.env.SAP_PASSWORD = 'secret';

    expect(hasSapCredentials()).toBe(true);
    expect(() => requireSapCredentials()).not.toThrow();
  });
});
