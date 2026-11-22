import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

describe('final HTTP request path guard', () => {
  it.each(['/sap/bc/adt/oo/classes/..', '/sap/bc/adt/oo/classes/%2e%2e'])(
    'rejects %s before transport dispatch',
    async (path) => {
      const client = new AdtHttpClient({ baseUrl: 'https://arc1.invalid' });
      const dispatch = vi.fn();
      Reflect.set(client, 'doFetch', dispatch);
      await expect(client.get(path)).rejects.toThrow('dot segments');
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it('refuses a caller object URI outside ADT before package metadata GET', async () => {
    const client = new AdtClient({ baseUrl: 'https://arc1.invalid', safety: unrestrictedSafetyConfig() });
    const dispatch = vi.fn();
    Reflect.set(client.http, 'doFetch', dispatch);
    await expect(client.resolveObjectPackage('/sap/opu/odata/sap/X')).rejects.toThrow('canonical');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('blocks a direct SAPRead class builder before transport dispatch', async () => {
    const client = new AdtClient({ baseUrl: 'https://arc1.invalid', safety: unrestrictedSafetyConfig() });
    const dispatch = vi.fn();
    Reflect.set(client.http, 'doFetch', dispatch);
    await expect(client.getClass('..')).rejects.toThrow('dot segments');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
