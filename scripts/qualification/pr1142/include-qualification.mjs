import { digest } from './fixture-contract.mjs';
import { readToolBody } from './safe-io.mjs';

export const includeKinds = ['definitions', 'implementations', 'macros', 'testclasses'];
export const includeSource = (fixture, marker, include, version) =>
  `" ${marker} ${fixture.name} ${include} version ${version}\n`;
const comparable = (source) => source.replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** Shared with the real-handler contract test; source saves have no `ok` field. */
export const isIncludeSaveResult = (body, expected) =>
  body?.state === 'saved-inactive' &&
  body.action === 'update' &&
  body.target === expected.target &&
  body.type === 'CLAS' &&
  body.name === expected.name &&
  body.include === expected.include &&
  body.initialized === expected.initialized &&
  typeof body.sourceHash === 'string' &&
  /^[a-f0-9]{64}$/.test(body.sourceHash);

/** Runs only inside the deletion qualifier, with its verified frozen writer and owned fixture. */
export async function qualifyIncludes({ fixture, marker, entry, client, target, call, ensure, step, save }) {
  ensure(`includes.${fixture.name}.class`, fixture.type === 'CLAS');
  entry.includes = { complete: false, kinds: {} };
  await save();
  for (const include of includeKinds) {
    const prefix = `include-${fixture.name}-${include}`;
    const key = { type: 'CLAS', name: fixture.name, include };
    const state = (entry.includes.kinds[include] = {});
    const read = async () => {
      const body = (await call(client, 'SAPRead', { ...key, format: 'editable' })).body;
      ensure(`${prefix}.editable_source`, typeof body?.source === 'string' && body.sourceHash === digest(body.source));
      return body;
    };
    step(`${prefix}-initial-read`);
    const response = await client.request('tools/call', {
      name: 'SAPRead',
      arguments: { ...key, format: 'editable' },
    });
    const initial = readToolBody(response);
    ensure(`${prefix}.initial_protocol`, response.status === 200 && initial.result != null && !response.json?.error);
    state.initialReadAvailable = initial.result.isError !== true;
    let expectedSourceHash;
    if (state.initialReadAvailable) {
      ensure(
        `${prefix}.initial_hash`,
        typeof initial.body?.source === 'string' && initial.body.sourceHash === digest(initial.body.source),
      );
      expectedSourceHash = initial.body.sourceHash;
      state.initialSourceHash = expectedSourceHash;
    }
    // A failed MCP read is NOT absence evidence. The writer must independently prove typed
    // absence under the class lock before initialization; otherwise this qualification fails.
    state.blankRefusals = [];
    for (const [label, source] of [
      ['empty-without-hash', ''],
      ['whitespace', ' \r\n\t'],
    ]) {
      step(`${prefix}-${label}`);
      const refused = (await call(client, 'SAPWrite', { ...key, action: 'update', source }, 'PINNED_WRITE_REFUSED'))
        .body;
      ensure(`${prefix}.${label}.unchanged_result`, refused?.state === 'unchanged');
      const afterResponse = await client.request('tools/call', {
        name: 'SAPRead',
        arguments: { ...key, format: 'editable' },
      });
      const after = readToolBody(afterResponse);
      ensure(
        `${prefix}.${label}.protocol`,
        afterResponse.status === 200 && after.result != null && !afterResponse.json?.error,
      );
      if (state.initialReadAvailable) {
        ensure(
          `${prefix}.${label}.unchanged_source`,
          after.result.isError !== true &&
            after.body?.sourceHash === expectedSourceHash &&
            digest(after.body.source) === expectedSourceHash,
        );
      } else {
        // Unavailable is deliberately not called absent: the initial MCP read cannot prove that.
        ensure(`${prefix}.${label}.still_unavailable`, after.result.isError === true);
      }
      state.blankRefusals.push(label);
      await save();
    }
    const write = async (source, label) => {
      step(`${prefix}-${label}`);
      state.attempt = label;
      await save();
      const body = (
        await call(client, 'SAPWrite', {
          ...key,
          action: 'update',
          source,
          ...(expectedSourceHash ? { expectedSourceHash } : {}),
        })
      ).body;
      state.lastWrite = body;
      await save();
      ensure(
        `${prefix}.${label}.saved`,
        isIncludeSaveResult(body, {
          target,
          name: fixture.name,
          include,
          initialized: expectedSourceHash === undefined,
        }),
      );
      step(`${prefix}-${label}-readback`);
      const current = await read();
      ensure(
        `${prefix}.${label}.readback`,
        current.sourceHash === body.sourceHash && comparable(current.source) === comparable(source),
      );
      expectedSourceHash = current.sourceHash;
      state.sourceHash = current.sourceHash;
      await save();
    };
    await write(includeSource(fixture, marker, include, 1), 'first-save');
    state.initialized = state.lastWrite.initialized;
    const firstSourceHash = expectedSourceHash;
    const refuse = async (label, hash) => {
      step(`${prefix}-${label}`);
      ensure(`${prefix}.${label}.different_hash`, hash !== expectedSourceHash);
      const refused = (
        await call(
          client,
          'SAPWrite',
          {
            ...key,
            action: 'update',
            source: includeSource(fixture, marker, include, 3),
            ...(hash ? { expectedSourceHash: hash } : {}),
          },
          'PINNED_WRITE_REFUSED',
        )
      ).body;
      ensure(`${prefix}.${label}.unchanged_result`, refused?.state === 'unchanged');
      ensure(`${prefix}.${label}.unchanged_source`, (await read()).sourceHash === expectedSourceHash);
    };
    await refuse('missing-hash', undefined);
    await write(includeSource(fixture, marker, include, 2), 'existing-save');
    await refuse('stale-hash', firstSourceHash);
    await write('', 'clear');
    await write(includeSource(fixture, marker, include, 3), 'final-save');
    state.complete = true;
    await save();
  }
  entry.includes.initializedKinds = includeKinds.filter((kind) => entry.includes.kinds[kind].initialized === true);
  entry.includes.complete = true;
  await save();
}
