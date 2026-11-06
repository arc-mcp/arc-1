/**
 * SQLite driver selection for the persistent cache.
 *
 * `better-sqlite3` is a native addon and cannot be embedded in a single-executable build, so the
 * cache falls back to the `node:sqlite` built-in. Both are loaded lazily and synchronously via
 * `createRequire`, so memory/none cache modes never touch either module.
 */

import { createRequire } from 'node:module';

export type SqliteDriverName = 'better-sqlite3' | 'node:sqlite';

export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** The small surface of better-sqlite3 that SqliteCache relies on. */
export interface SqliteDb {
  readonly driver: SqliteDriverName;
  pragma(statement: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction(fn: () => void): () => void;
  close(): void;
}

interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const nodeRequire = createRequire(import.meta.url);

export function openSqliteDatabase(dbPath: string, preferred: SqliteDriverName | 'auto' = 'auto'): SqliteDb {
  if (preferred === 'node:sqlite') return openNodeSqlite(dbPath);
  if (preferred === 'better-sqlite3') return openBetterSqlite(dbPath);
  try {
    return openBetterSqlite(dbPath);
  } catch (betterSqliteError) {
    try {
      return openNodeSqlite(dbPath);
    } catch (nodeSqliteError) {
      throw new Error(
        `No SQLite driver available (better-sqlite3: ${describe(betterSqliteError)}; node:sqlite: ${describe(nodeSqliteError)})`,
      );
    }
  }
}

function openBetterSqlite(dbPath: string): SqliteDb {
  const Database = nodeRequire('better-sqlite3') as new (path: string) => Omit<SqliteDb, 'driver'>;
  const db = new Database(dbPath);
  return Object.assign(db, { driver: 'better-sqlite3' as const });
}

function openNodeSqlite(dbPath: string): SqliteDb {
  const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: new (path: string) => NodeSqliteDatabase };
  const db = new DatabaseSync(dbPath);
  // Match better-sqlite3's default wait when another process writes the shared cache.
  db.exec('PRAGMA busy_timeout = 5000');
  return {
    driver: 'node:sqlite',
    pragma: (statement) => db.exec(`PRAGMA ${statement}`),
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    transaction: (fn) => () => {
      db.exec('BEGIN');
      try {
        fn();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => db.close(),
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}
