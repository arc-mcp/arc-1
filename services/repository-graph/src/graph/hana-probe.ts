import { withHanaSession } from './store/hana-connection.js';

try {
  const result = await withHanaSession(async (session) => {
    const rows = await session.exec<Array<{ OK: number }>>('SELECT 1 AS OK FROM DUMMY');
    if (rows[0]?.OK !== 1) throw new Error('Unexpected HANA response');
    return { database: 'hana', sql: 'ready', tlsValidated: true };
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'HANA probe failed'}\n`);
  process.exitCode = 1;
}
