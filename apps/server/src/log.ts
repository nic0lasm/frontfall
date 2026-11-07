import { createHmac } from "node:crypto";
import { systemClock } from "./clock.ts";
import { systemIds } from "./ids.ts";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  /** Something went wrong that the server cannot go on from. */
  error(event: string, fields?: LogFields): void;
}

/** One JSON object per line on stdout, ready for `docker logs` and any log shipper. */
export function jsonLogger(
  write: (line: string) => void = (line) => process.stdout.write(line),
  now: () => number = () => systemClock.now(),
): Logger {
  const log = (level: string, event: string, fields: LogFields = {}) => {
    write(`${JSON.stringify({ time: new Date(now()).toISOString(), level, event, ...fields })}\n`);
  };
  return {
    info: (event, fields) => {
      log("info", event, fields);
    },
    warn: (event, fields) => {
      log("warn", event, fields);
    },
    error: (event, fields) => {
      log("error", event, fields);
    },
  };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Pseudonym of a client address for the logs: the same address gives the same
 * value until the server restarts, and the address cannot be read back from it.
 */
export function addressPseudonym(
  secret: Buffer = systemIds.bytes(32),
): (address: string) => string {
  return (address) => createHmac("sha256", secret).update(address).digest("base64url").slice(0, 12);
}
