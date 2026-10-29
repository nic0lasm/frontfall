/**
 * A share of the simulated players for `pnpm load -- --client-procs <n>`,
 * run in a child process and driven by pool.ts.
 */
import { LoadSession, type SessionOptions } from "./load.ts";
import type { WorkerReply, WorkerRequest } from "./pool.ts";

const session = new LoadSession(JSON.parse(process.env.LOAD_SESSION ?? "{}") as SessionOptions);

async function answer(request: WorkerRequest): Promise<WorkerReply> {
  switch (request.type) {
    case "add":
      return { type: "added", connectMs: await session.add(request.games) };
    case "progress":
      return { type: "progress", turns: session.progress() };
    case "sample":
      return { type: "sample", sample: session.sample() };
    case "rejoin":
      return { type: "rejoined", rejoin: await session.rejoinStorm(request.fromZero) };
    case "stop":
      return { type: "sample", sample: session.stop() };
  }
}

let stopping = false;
// The bench died: nothing will stop these clients.
process.on("disconnect", () => {
  if (!stopping) process.exit(1);
});

process.on("message", (request: WorkerRequest) => {
  if (request.type === "stop") stopping = true;
  answer(request).then(
    (reply) => {
      process.send?.(reply, () => {
        // The process ends once the sockets have closed.
        if (request.type === "stop") process.disconnect();
      });
    },
    (error: unknown) => {
      process.send?.({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerReply);
    },
  );
});
