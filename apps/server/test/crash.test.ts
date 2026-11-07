import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { exitOnCrash } from "../src/crash.ts";
import type { LogFields, Logger } from "../src/log.ts";

function setup() {
  const process = new EventEmitter();
  const logged: { event: string; fields?: LogFields }[] = [];
  const exits: number[] = [];
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (event, fields) => logged.push({ event, ...(fields && { fields }) }),
  };
  exitOnCrash({ on: (event, listener) => process.on(event, listener) }, logger, (status) =>
    exits.push(status),
  );
  return { process, logged, exits };
}

describe("exitOnCrash", () => {
  it("logs an uncaught exception with its stack, then exits with status 1", () => {
    const { process, logged, exits } = setup();
    const error = new Error("boom");
    process.emit("uncaughtException", error);
    expect(logged).toEqual([
      { event: "uncaught_exception", fields: { error: "boom", stack: error.stack } },
    ]);
    expect(exits).toEqual([1]);
  });

  it("logs an unhandled rejection, whatever it was rejected with, then exits with status 1", () => {
    const { process, logged, exits } = setup();
    process.emit("unhandledRejection", "plain text");
    expect(logged).toEqual([{ event: "unhandled_rejection", fields: { error: "plain text" } }]);
    expect(exits).toEqual([1]);
  });

  it("does nothing before anything goes wrong", () => {
    const { logged, exits } = setup();
    expect(logged).toEqual([]);
    expect(exits).toEqual([]);
  });
});
