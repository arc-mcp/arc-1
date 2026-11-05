import { expect, it, vi } from 'vitest';
import { activate } from '../../../src/adt/devtools.js';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

it('does not label a pre-submit cancellation as a submitted activation', async () => {
  const http = new AdtHttpClient({ baseUrl: 'https://sap.example' });
  const post = vi.spyOn(http, 'post');
  const error = new AdtNetworkError('Cancelled before submission');
  await expect(
    activate(http, { ...defaultSafetyConfig(), allowWrites: true }, '/sap/bc/adt/programs/programs/ztest', {
      beforeSubmit: () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(error.activationOutcome).toBeUndefined();
  expect(error.extraHint).toBeUndefined();
  expect(post).not.toHaveBeenCalled();
  post.mockRestore();
});
