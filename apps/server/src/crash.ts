import type { Logger } from "./log.ts";

/** The part of `process` that reports what nothing caught. */
export interface CrashSource {
  on(
    event: "uncaughtException" | "unhandledRejection",
    listener: (reason: unknown) => void,
  ): unknown;
}

function describe(reason: unknown): { error: string; stack?: string } {
  if (reason instanceof Error) {
    return { error: reason.message, ...(reason.stack !== undefined && { stack: reason.stack }) };
  }
  return { error: String(reason) };
}

/**
 * An error nothing caught, or a promise rejected with no one waiting, leaves
 * the server in a state nobody checked. It is logged, and the process exits
 * with status 1, so that the container restarts it.
 */
export function exitOnCrash(
  source: CrashSource,
  logger: Logger,
  exit: (status: number) => void,
): void {
  source.on("uncaughtException", (reason) => {
    logger.error("uncaught_exception", describe(reason));
    exit(1);
  });
  source.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", describe(reason));
    exit(1);
  });
}
