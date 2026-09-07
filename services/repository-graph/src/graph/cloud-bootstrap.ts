import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { selectedBinding } from './bindings.js';
import { graphPoolConfig } from './config.js';
import { PgGraphStore } from './store/pg.js';

// Only invoked in a short-lived admin task; never bound to the query app or ARC.
export function bootstrapRoles(secrets: Record<string, unknown>) {
  const roles = [
    ['arc_graph_api', secrets.apiPassword],
    ['arc_graph_writer', secrets.writerPassword],
  ] as const;
  for (const [, password] of roles)
    if (typeof password !== 'string' || !/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid role secrets');
  return roles;
}

let stage = 'configuration';
async function main() {
  const config = graphPoolConfig();
  const roles = bootstrapRoles(selectedBinding(process.env, process.env.ARC_GRAPH_BOOTSTRAP_AUTH_BINDING ?? ''));
  const store = new PgGraphStore(new Pool(config));
  try {
    for (const [role, password] of roles) {
      stage = `create-${role}`;
      const found = await store.pool.query(
        'SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconfig FROM pg_roles WHERE rolname = $1',
        [role],
      );
      // Identifiers/passwords are fixed/strictly validated above; DDL does not support value parameters.
      if (!found.rowCount) {
        await store.pool.query(
          `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
        );
        if (role === 'arc_graph_api')
          await store.pool.query('ALTER ROLE arc_graph_api SET default_transaction_read_only = on');
      } else {
        const r = found.rows[0];
        if (
          !r.rolcanlogin ||
          r.rolsuper ||
          r.rolcreatedb ||
          r.rolcreaterole ||
          r.rolreplication ||
          r.rolbypassrls ||
          (role === 'arc_graph_api' && !r.rolconfig?.includes('default_transaction_read_only=on'))
        )
          throw new Error('Unsafe existing runtime role');
        // Do not silently rotate existing passwords or reapply privileged ALTER ROLE clauses.
        // The subsequent login/grant checks verify these operator-owned roles instead.
      }
    }
    stage = 'migration';
    const migrationVersion = await store.migrate();
    for (const [role, password] of roles) {
      stage = `verify-${role}`;
      const runtime = new Pool({ ...config, user: role, password: password as string, max: 1 });
      try {
        const rights = await runtime.query(`SELECT
          has_table_privilege(current_user, 'arc_graph.nodes', 'SELECT') AS can_read,
          has_table_privilege(current_user, 'arc_graph.nodes', 'INSERT') AS can_write,
          has_schema_privilege(current_user, 'arc_graph', 'CREATE') AS can_ddl`);
        if (
          !rights.rows[0]?.can_read ||
          rights.rows[0]?.can_write !== (role === 'arc_graph_writer') ||
          rights.rows[0]?.can_ddl
        )
          throw new Error('Runtime role check failed');
      } finally {
        await runtime.end();
      }
    }
    stage = 'capacity';
    const client = await store.pool.connect();
    try {
      // Managed pg_stat_ssl can hide the row. Inspect this connection's verified TLS socket,
      // not database monitoring permissions. Keep this pg-specific diagnostic out of ARC.
      const stream = (client as unknown as { connection: { stream: unknown } }).connection.stream;
      if (!(stream instanceof TLSSocket) || !stream.encrypted || !stream.authorized)
        throw new Error('Verified TLS required');
      const result = await client.query(`SELECT current_setting('server_version') AS version,
        current_setting('max_connections') AS max_connections, pg_database_size(current_database())::text AS database_bytes`);
      process.stdout.write(
        `${JSON.stringify({ status: 'ok', migrationVersion, tlsVerified: true, tlsProtocol: stream.getProtocol(), ...result.rows[0] })}\n`,
      );
    } finally {
      client.release();
    }
  } finally {
    await store.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    const code = (error as { code?: string })?.code;
    const networkCodes = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ];
    process.stderr.write(
      JSON.stringify({
        status: 'error',
        operation: 'graph-cloud-bootstrap',
        stage,
        code:
          typeof code === 'string' && (/^[A-Z0-9]{5}$/.test(code) || networkCodes.includes(code)) ? code : 'suppressed',
      }) + '\n',
    );
    process.exitCode = 1;
  });
