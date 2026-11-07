import type { WorkerReply, WorkerRequest } from "./messages.ts";

/** The simulation worker as a session talks to it; a test hands in a fake one. */
export interface SimPort {
  postMessage(request: WorkerRequest): void;
  onmessage: ((event: { readonly data: WorkerReply }) => void) | null;
  onerror: ((event: { readonly message: string }) => void) | null;
  terminate(): void;
}

/** A worker of its own for one game. */
export function simWorker(): SimPort {
  return new Worker(new URL("./sim.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as SimPort;
}
