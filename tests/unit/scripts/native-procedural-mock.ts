/** Keep the real final-dispatch wrapper over a confined native-protocol MockAgent. */
import { type Mock, vi } from 'vitest';

export const mockFetch: Mock<(...args: any[]) => any> = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: mockFetch,
    Agent: function MockNativeAgent() {
      return actual.getGlobalDispatcher();
    },
    Client: class {
      constructor() {
        throw new Error('The fixed native direct protocol has no Connectivity Client');
      }
    },
  };
});
export const { AdtClient } = await import('../../../src/adt/client.js');
