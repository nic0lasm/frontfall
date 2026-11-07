/** A value SQLite stores in a column, or binds to a parameter. */
export type SqlValue = string | number | null | Uint8Array;

/**
 * The few calls the stores make of SQLite, so that the same stores run on
 * `bun:sqlite` in production and on `node:sqlite` under Vitest.
 */
export interface SqlDriver {
  /** Runs statements with no parameters and no rows, such as the schema. */
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  /** Every row; the caller names their shape, which SQLite does not check: the queries are the server's own. */
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  /** The first row, or undefined. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined;
  close(): void;
}

/** Opens the database at `file`, creating it when missing. */
export type OpenSql = (file: string) => SqlDriver;

/**
 * Runs `work` in one transaction: every write it makes is kept, or none if
 * it throws. Taken at once for writing, so another process that writes too
 * (the admin command) waits instead of failing halfway.
 */
export function transaction<T>(db: SqlDriver, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
