import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { OpenSql, SqlDriver, SqlValue } from "./driver.ts";

/** SQLite through `node:sqlite`: the tests under Vitest, which run on Node. */
export const openNodeSqlite: OpenSql = (file) => {
  const db = new DatabaseSync(file);
  const statements = new Map<string, StatementSync>();
  const prepared = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const driver: SqlDriver = {
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params: readonly SqlValue[] = []) => {
      prepared(sql).run(...params);
    },
    all: (sql, params = []) => prepared(sql).all(...params) as never,
    get: (sql, params = []) => prepared(sql).get(...params) as never,
    close: () => {
      db.close();
    },
  };
  return driver;
};
