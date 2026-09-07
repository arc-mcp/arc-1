import { selectedBinding } from './bindings.js';
import { hanaConfig, withHanaSession } from './store/hana-connection.js';
import { HANA_TABLE_DDL } from './store/hana-schema.js';

// A no-route, one-shot task only. DBADMIN is never bound to a query or collection app.
try {
  if (process.env.ARC_GRAPH_HANA_BOOTSTRAP !== 'true') throw new Error('Explicit bootstrap mode required');
  const admin = selectedBinding(process.env, process.env.ARC_GRAPH_HANA_SERVICE_BINDING ?? '');
  const users = admin.bootstrapUsers as Record<string, Record<string, unknown>>;
  const envFor = (credentials: Record<string, unknown>) => ({
    ARC_GRAPH_HANA_SERVICE_BINDING: 'bootstrap-target',
    VCAP_SERVICES: JSON.stringify({ 'user-provided': [{ name: 'bootstrap-target', credentials }] }),
  });
  for (const role of ['owner', 'reader', 'writer']) {
    const user = users?.[role];
    if (
      !user ||
      user.user !== `ARC_GRAPH_${role.toUpperCase()}` ||
      user.schema !== 'ARC_GRAPH' ||
      user.host !== admin.host ||
      !/^[a-zA-Z0-9]{32,128}$/.test(String(user.password))
    )
      throw new Error('Invalid dedicated HANA bootstrap credentials');
    hanaConfig(envFor(user));
  }
  await withHanaSession(
    async (session) => {
      for (const role of ['owner', 'reader', 'writer']) {
        const user = users[role]!;
        const existing = await session.exec('SELECT USER_NAME FROM SYS.USERS WHERE USER_NAME = ?', [String(user.user)]);
        if (!existing.length)
          // HANA Cloud user names use unicode-name syntax, not quoted SQL identifiers.
          // Names/passwords were strictly allowlisted above before reaching this DDL sink.
          await session.exec(`CREATE USER ${user.user} PASSWORD "${user.password}" NO FORCE_FIRST_PASSWORD_CHANGE`);
        // Existing users must match the retained credentials. Never reset someone else's account.
        await withHanaSession(
          (target) => target.exec('SELECT 1 AS OK FROM DUMMY'),
          envFor({ ...user, schema: undefined }),
        );
      }
      const schemas = await session.exec('SELECT SCHEMA_OWNER FROM SYS.SCHEMAS WHERE SCHEMA_NAME = ?', ['ARC_GRAPH']);
      if (!schemas.length) await session.exec('CREATE SCHEMA "ARC_GRAPH" OWNED BY ARC_GRAPH_OWNER');
      else if (schemas[0]?.SCHEMA_OWNER !== 'ARC_GRAPH_OWNER') throw new Error('Refusing an unowned HANA schema');
    },
    process.env,
    60_000,
  );
  await withHanaSession(
    async (session) => {
      const tables = await session.exec('SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?', [
        'ARC_GRAPH',
        'SCHEMA_MIGRATIONS',
      ]);
      if (tables.length) {
        const versions = await session.exec('SELECT VERSION FROM SCHEMA_MIGRATIONS');
        if (versions.length !== 1 || versions[0]?.VERSION !== 1)
          throw new Error('Incomplete schema: manual migration recovery required');
      } else {
        for (const statement of HANA_TABLE_DDL) await session.exec(statement);
      }
      for (const role of ['READER', 'WRITER'])
        await session.exec(`GRANT SELECT ON SCHEMA "ARC_GRAPH" TO ARC_GRAPH_${role}`);
      for (const table of ['NODES', 'EDGE_OBSERVATIONS', 'GENERATIONS', 'COLLECTION_JOBS'])
        await session.exec(`GRANT INSERT, UPDATE, DELETE ON "ARC_GRAPH"."${table}" TO ARC_GRAPH_WRITER`);
      await session.exec('GRANT UPDATE ON "ARC_GRAPH"."COLLECTOR_LOCK" TO ARC_GRAPH_WRITER');
    },
    envFor(users.owner!),
    60_000,
  );
  process.stdout.write(
    `${JSON.stringify({ database: 'hana', schema: 'ARC_GRAPH', migrationVersion: 1, separateUsers: true, bootstrap: 'passed' })}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'HANA bootstrap failed'}\n`);
  process.exitCode = 1;
}
