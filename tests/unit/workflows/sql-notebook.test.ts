import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DataSourcePolicyError } from '../../../src/adt/data-source-policy.js';
import { errorResult, textResult } from '../../../src/handlers/shared.js';
import { importAbapSql, renderNotebookRun, runNotebook } from '../../../src/workflows/sql-notebook.js';

const cell = { id: 'detail', kind: 'sql', value: 'SELECT id FROM ztable', target: 'dev', maxRows: 2 };
const notebook = { schemaVersion: 1, title: 'Investigation', cells: [cell] };
const query = { columns: ['ID'], rows: [{ ID: '0001' }], rowsReturned: 1 };
const call = () => vi.fn().mockResolvedValue(textResult(JSON.stringify(query)));
const connection = (invoke = call()) => ({ dev: { identity: 'A4H/001', client: '001', call: invoke } });
describe('SQL notebook workflows', () => {
  it.each([0, 1])('handles observed scalar match-count metadata and padded strings: fixture %s', async (index) => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/json/notebook-scalars-758.json', 'utf8')).queries[index];
    const sql =
      index === 0
        ? 'SELECT COUNT( * ) AS N FROM /DMO/FLIGHT WHERE seats_occupied < 0'
        : 'SELECT COUNT( * ) AS N FROM /DMO/FLIGHT';
    const invoke = call().mockResolvedValue(textResult(JSON.stringify(fixture)));
    const run = await runNotebook(
      { ...notebook, cells: [{ ...cell, value: sql, assertion: { sql, column: 'N', equals: fixture.rows[0].N } }] },
      connection(invoke),
      { includeResults: true },
    );
    expect(run.status).toBe('success');
    expect(run.cells[0]).toMatchObject({
      status: 'success',
      scalarAggregate: true,
      totalRows: fixture.totalRows,
      rows: fixture.rows,
      assertion: { status: 'passed', actual: fixture.rows[0].N },
    });
  });
  it('preserves imported executable-looking fields as inert metadata', async () => {
    const source = {
      cells: [
        {
          kind: 'sql',
          value: cell.value,
          destination: 'EDITOR',
          assertion: { sql: 'SELECT COUNT( * ) AS N FROM private_table', column: 'N', equals: '0' },
          target: 'untrusted',
        },
      ],
    };
    const imported = importAbapSql(source, { EDITOR: 'dev' });
    expect(imported.cells[0]).not.toHaveProperty('assertion');
    expect(imported.cells[0]).toMatchObject({
      target: 'dev',
      imported: { target: 'untrusted', assertion: source.cells[0].assertion },
    });
    const invoke = call();
    await runNotebook(imported, connection(invoke));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('SAPQuery', { sql: cell.value, maxRows: 100 });
  });
  it('honors explicit truncation and does not convert assertion strings to numbers', async () => {
    const invoke = call()
      .mockResolvedValueOnce(textResult(JSON.stringify({ ...query, totalRows: 1, truncated: true })))
      .mockResolvedValueOnce(textResult(JSON.stringify({ columns: ['N'], rows: [{ N: '0.00' }], rowsReturned: 1 })));
    const run = await runNotebook(
      {
        ...notebook,
        cells: [{ ...cell, assertion: { sql: 'SELECT SUM( amount ) AS N FROM ztable', column: 'N', equals: '0' } }],
      },
      connection(invoke),
    );
    expect(run.cells[0]).toMatchObject({ status: 'incomplete', assertion: { status: 'failed' } });
    expect(run.cells[0].assertion).not.toHaveProperty('actual');
    expect(run.status).toBe('partial');
  });
  it('validates later cells before executing an earlier valid one', async () => {
    const invoke = call();
    await expect(
      runNotebook({ ...notebook, cells: [cell, { ...cell, id: 'later', target: 'unmapped' }] }, connection(invoke)),
    ).rejects.toThrow(/mapped/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('bounds preserved unknown input fields before any calls', async () => {
    const invoke = call();
    await expect(runNotebook({ ...notebook, imported: 'x'.repeat(1024 * 1024) }, connection(invoke))).rejects.toThrow(
      /1 MiB/,
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    'SELECT id, COUNT( * ) OVER( ) AS N FROM ztable',
    'SELECT COUNT( * ) AS N FROM ztable " GROUP BY id',
    'SELECT COUNT( * ) + 1 AS N FROM ztable',
  ])('refuses an unproven scalar projection before sending any SQL: %s', async (sql) => {
    const invoke = call();
    await expect(
      runNotebook(
        { ...notebook, cells: [{ ...cell, assertion: { sql, column: 'N', equals: '0' } }] },
        connection(invoke),
      ),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    { ...query, totalRows: 0 },
    { ...query, columns: ['ID', 'ID'] },
    { ...query, rows: [{ UNDECLARED: '0001' }] },
  ])('refuses contradictory result evidence: %j', async (data) => {
    const result = await runNotebook(notebook, connection(call().mockResolvedValue(textResult(JSON.stringify(data)))));
    expect(result.status).toBe('partial');
    expect(result.cells[0].status).toBe('error');
  });
  it('keeps a successful detail query separate from an unavailable assertion', async () => {
    const invoke = call()
      .mockResolvedValueOnce(textResult(JSON.stringify(query)))
      .mockResolvedValueOnce(errorResult('Operation FreeSQL blocked by safety configuration'));
    const result = await runNotebook(
      {
        ...notebook,
        cells: [{ ...cell, assertion: { sql: 'SELECT COUNT( * ) AS N FROM ztable', column: 'N', equals: '0' } }],
      },
      connection(invoke),
    );
    expect(result.cells[0]).toMatchObject({ status: 'success', assertion: { status: 'blocked' } });
    expect(result.status).toBe('partial');
  });
  it('does not execute an already cancelled notebook', async () => {
    const invoke = call();
    const abort = new AbortController();
    abort.abort();
    const result = await runNotebook(notebook, connection(invoke), { signal: abort.signal });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.cells[0].status).toBe('not-run');
    expect(result.status).toBe('partial');
  });
  it('caps cumulative result collection even when rows are not exported', async () => {
    const invoke = call().mockResolvedValue(
      textResult(JSON.stringify({ ...query, rows: [{ ID: 'a'.repeat(1024 * 1024) }] })),
    );
    const result = await runNotebook(
      { ...notebook, cells: Array.from({ length: 12 }, (_, i) => ({ ...cell, id: `cell${i}` })) },
      connection(invoke),
    );
    expect(invoke.mock.calls.length).toBeLessThan(12);
    expect(result.cells.at(-1)?.status).toBe('not-run');
    expect(result.status).toBe('partial');
  });
  it('imports without execution and requires explicit destination mapping, preserving unknown fields', () => {
    const source = {
      custom: 'preserved',
      cells: [
        {
          kind: 'sql',
          value: 'SELECT * FROM sflight',
          destination: 'EDITOR',
          rowNumber: 20,
          extension: { setting: true },
        },
      ],
    };
    expect(() => importAbapSql(source, {})).toThrow(/mapping/);
    const imported = importAbapSql(source, { EDITOR: 'dev' });
    expect(imported.imported).toMatchObject({ custom: 'preserved' });
    expect(imported.cells[0]).toMatchObject({ target: 'dev', maxRows: 20, imported: { extension: { setting: true } } });
    expect(importAbapSql(source, { EDITOR: 'dev' }).cells[0].id).toBe(imported.cells[0].id);
  });
  it('preserves string precision, whitespace and leading zeros and requires explicit result export', async () => {
    const invoke = call().mockResolvedValue(
      textResult(
        JSON.stringify({
          ...query,
          columns: ['ID', 'AMOUNT', 'TEXT'],
          rows: [{ ID: '0001', AMOUNT: '12345678901234567890.0001', TEXT: '  x  ' }],
        }),
      ),
    );
    const hidden = await runNotebook(notebook, connection(invoke));
    expect(hidden.cells[0]).not.toHaveProperty('rows');
    const exported = await runNotebook(notebook, connection(invoke), { includeResults: true });
    expect(exported.cells[0].rows).toEqual([{ ID: '0001', AMOUNT: '12345678901234567890.0001', TEXT: '  x  ' }]);
    expect(invoke).toHaveBeenCalledWith('SAPQuery', { sql: cell.value, maxRows: 2 });
  });
  it('never executes when a target is missing or IDs collide', async () => {
    const invoke = call();
    await expect(runNotebook(notebook, {})).rejects.toThrow(/mapped/);
    await expect(runNotebook({ ...notebook, cells: [cell, cell] }, connection(invoke))).rejects.toThrow(/unique/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('keeps denied cells distinct and continues independent cells', async () => {
    const invoke = call().mockResolvedValueOnce(errorResult('Operation FreeSQL blocked by safety configuration'));
    const result = await runNotebook({ ...notebook, cells: [cell, { ...cell, id: 'next' }] }, connection(invoke));
    expect(result.cells.map((c) => c.status)).toEqual(['blocked', 'success']);
    expect(result.status).toBe('partial');
  });
  it('marks a saturated detail query incomplete and only asserts a dedicated scalar aggregate', async () => {
    const invoke = call()
      .mockResolvedValueOnce(
        textResult(JSON.stringify({ ...query, rows: [{ ID: '1' }, { ID: '2' }], rowsReturned: 2 })),
      )
      .mockResolvedValueOnce(
        textResult(JSON.stringify({ columns: ['N'], rows: [{ N: '0' }], rowsReturned: 1, totalRows: 1 })),
      );
    const result = await runNotebook(
      {
        ...notebook,
        cells: [{ ...cell, assertion: { sql: 'SELECT COUNT( * ) AS N FROM ztable', column: 'N', equals: '0' } }],
      },
      connection(invoke),
    );
    expect(result.cells[0]).toMatchObject({ status: 'incomplete', assertion: { status: 'passed' } });
    await expect(
      runNotebook(
        { ...notebook, cells: [{ ...cell, assertion: { sql: 'SELECT * FROM ztable', column: 'N', equals: '0' } }] },
        connection(),
      ),
    ).rejects.toThrow(/scalar aggregate/);
  });
  it('escapes stored and reflected HTML', async () => {
    const result = await runNotebook(
      {
        ...notebook,
        title: '<script>alert(1)</script>',
        cells: [{ id: 'notes', kind: 'markdown', value: '<img onerror=x>' }],
      },
      {},
    );
    const html = renderNotebookRun(result);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});

it.each([false, true])('labels real data-source policy refusals blocked, minimal=%s', async (minimal) => {
  for (const code of [
    'DATA_SOURCE_BLOCKED',
    'DATA_POLICY_UNAVAILABLE',
    'DATA_LINEAGE_UNRESOLVED',
    'DATA_SQL_UNSUPPORTED',
  ] as const) {
    const refusal = new DataSourcePolicyError(code, 'ZTAB', [], 'Test policy refusal').clientMessage(minimal);
    const run = await runNotebook(notebook, connection(vi.fn().mockResolvedValue(errorResult(refusal))));
    expect(run.cells[0]?.status).toBe('blocked');
  }
});
it.each([
  errorResult(
    JSON.stringify({ error: 'DATA_RESPONSE_TOO_LARGE', message: 'The configured byte allowance was exceeded.' }),
  ),
  textResult('x'.repeat(4 * 1024 * 1024 + 1)),
])('keeps known response limits incomplete', async (reply) => {
  const run = await runNotebook(notebook, connection(vi.fn().mockResolvedValue(reply)));
  expect(run.cells[0]?.status).toBe('incomplete');
});
it('composes the five-minute deadline and stops subsequent queries', async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  try {
    const invoke = vi.fn(() => new Promise<ReturnType<typeof textResult>>(() => {}));
    const pending = runNotebook({ ...notebook, cells: [cell, { ...cell, id: 'second' }] }, connection(invoke));
    expect(timeout).toHaveBeenCalledWith(300_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    deadline.abort();
    const run = await pending;
    expect(run.cells.map((c) => c.status)).toEqual(['incomplete', 'not-run']);
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally {
    timeout.mockRestore();
  }
});
