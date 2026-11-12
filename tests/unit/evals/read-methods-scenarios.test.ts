import { expect, it } from 'vitest';
import { readMethodFixtureExecutor } from '../../evals/scenarios/read-methods.js';
import { mockFetch } from '../handlers/setup-undici-mock.js';

const object = { type: 'CLAS', name: 'ZCL_TOKEN_EVAL' };

it('executes declaration, body and typo-recovery fixtures through the real handler without SAP', async () => {
  mockFetch.mockClear();
  const signature = JSON.parse(
    await readMethodFixtureExecutor('SAPRead', { ...object, method: 'execute', methodView: 'signature' }),
  );
  expect(signature).toMatchObject({ scope: 'own-declaration', methodName: 'execute' });
  expect(signature.signature).toContain('RETURNING VALUE(rv_length) TYPE i');
  const body = await readMethodFixtureExecutor('SAPRead', { ...object, method: 'execute' });
  expect(body).toContain('rv_length = strlen( iv_text ).');
  expect(await readMethodFixtureExecutor('SAPRead', { ...object, method: 'lcl_worker~execute' })).toContain(
    'result = 42.',
  );
  const typo = await readMethodFixtureExecutor('SAPRead', { ...object, method: 'excute' });
  expect(typo).toContain('Error: Method');
  expect(typo).toContain('Suggestions in selected source: execute.');
  expect(await readMethodFixtureExecutor('SAPRead', { ...object, method: '*' })).toContain('execute');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('refuses unsupported fixture requests and runs conflicting selectors through runtime validation', async () => {
  mockFetch.mockClear();
  expect(await readMethodFixtureExecutor('SAPWrite', { ...object, action: 'update' })).toMatch(/^Error:/);
  expect(await readMethodFixtureExecutor('SAPRead', { ...object, name: 'REAL_SAP_CLASS' })).toMatch(/^Error:/);
  expect(await readMethodFixtureExecutor('SAPRead', { ...object, method: 'execute', include: 'testclasses' })).toMatch(
    /^Error:/,
  );
  expect(await readMethodFixtureExecutor('SAPRead', { ...object, method: 'execute', format: 'structured' })).toMatch(
    /^Error:.*structured/s,
  );
  expect(mockFetch).not.toHaveBeenCalled();
});
