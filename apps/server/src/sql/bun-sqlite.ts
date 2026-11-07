import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite";
import type { OpenSql, SqlDriver, SqlValue } from "./driver.ts";

/** SQLite through `bun:sqlite`: the server in production and the admin command. */
export const openBunSqlite: OpenSql = (file) => {
  const db = new Database(file, { create: true, strict: true });
  const statements = new Map<string, Statement>();
  const prepared = (sql: string): Statement => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.query(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const bind = (params: readonly SqlValue[]): SQLQueryBindings[] => params as SQLQueryBindings[];
  const driver: SqlDriver = {
    exec: (sql) => {
      db.run(sql);
    },
    run: (sql, params = []) => {
      prepared(sql).run(...bind(params));
    },
    all: (sql, params = []) => prepared(sql).all(...bind(params)) as never,
    get: (sql, params = []) => (prepared(sql).get(...bind(params)) ?? undefined) as never,
    close: () => {
      db.close();
    },
  };
  return driver;
};
