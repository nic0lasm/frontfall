import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LoadSession,
  mergeRejoins,
  mergeSamples,
  type LoadSample,
  type RejoinSample,
  type SessionOptions,
  type TurnRange,
} from "./load.ts";

/** The simulated players, in this process or spread over several. */
export interface ClientPool {
  /** Joins and starts these games; resolves with the time it took, in ms. */
  add(games: readonly number[]): Promise<number>;
  progress(): Promise<TurnRange>;
  /** Measures since the previous sample, then starts again. */
  sample(): Promise<LoadSample>;
  rejoinStorm(fromZero: boolean): Promise<RejoinSample>;
  stop(): Promise<LoadSample>;
  /** Ends the client processes at once, when the bench fails. */
  kill(): void;
}

export type WorkerRequest =
  | { type: "add"; games: number[] }
  | { type: "progress" }
  | { type: "sample" }
  | { type: "rejoin"; fromZero: boolean }
  | { type: "stop" };

export type WorkerReply =
  | { type: "added"; connectMs: number }
  | { type: "progress"; turns: TurnRange }
  | { type: "sample"; sample: LoadSample }
  | { type: "rejoined"; rejoin: RejoinSample }
  | { type: "failed"; error: string };

/** Every client in this process, as the bench always did. */
export class LocalPool implements ClientPool {
  private readonly session: LoadSession;

  constructor(options: SessionOptions) {
    this.session = new LoadSession(options);
  }

  add(games: readonly number[]): Promise<number> {
    return this.session.add(games);
  }

  progress(): Promise<TurnRange> {
    return Promise.resolve(this.session.progress());
  }

  sample(): Promise<LoadSample> {
    return Promise.resolve(this.session.sample());
  }

  rejoinStorm(fromZero: boolean): Promise<RejoinSample> {
    return this.session.rejoinStorm(fromZero);
  }

  stop(): Promise<LoadSample> {
    return Promise.resolve(this.session.stop());
  }

  kill(): void {
    // The clients end with this process.
  }
}

/** One forked process running worker.ts, answering one request at a time. */
class Worker {
  private readonly child: ChildProcess;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SessionOptions) {
    this.child = fork(fileURLToPath(new URL("worker.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, LOAD_SESSION: JSON.stringify(options) },
    });
  }

  request(request: WorkerRequest): Promise<WorkerReply> {
    const reply = this.queue.then(
      () =>
        new Promise<WorkerReply>((resolve, reject) => {
          const exited = (code: number | null) => {
            reject(new Error(`client process exited with ${String(code)}`));
          };
          this.child.once("exit", exited);
          this.child.once("message", (message: WorkerReply) => {
            this.child.off("exit", exited);
            if (message.type === "failed") reject(new Error(message.error));
            else resolve(message);
          });
          this.child.send(request);
        }),
    );
    this.queue = reply.catch(() => undefined);
    return reply;
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill();
  }
}

/**
 * Clients spread over `processes` forked processes, game by game, so that
 * thousands of players do not wait on one event loop. Their samples merge
 * as if one process had measured them all; the client loop delay is the
 * worst process's.
 */
export class ForkedPool implements ClientPool {
  private readonly workers: Worker[];

  constructor(options: SessionOptions, processes: number) {
    this.workers = Array.from({ length: processes }, () => new Worker(options));
  }

  async add(games: readonly number[]): Promise<number> {
    const shares = this.workers.map((_, index) =>
      games.filter((_game, position) => position % this.workers.length === index),
    );
    const replies = await Promise.all(
      this.workers.map((worker, index) =>
        (shares[index]?.length ?? 0) > 0
          ? worker.request({ type: "add", games: shares[index] ?? [] })
          : Promise.resolve<WorkerReply>({ type: "added", connectMs: 0 }),
      ),
    );
    return Math.max(...replies.map((reply) => (reply.type === "added" ? reply.connectMs : 0)));
  }

  async progress(): Promise<TurnRange> {
    const ranges = (await this.all({ type: "progress" })).flatMap((reply) =>
      reply.type === "progress" && Number.isFinite(reply.turns.min) ? [reply.turns] : [],
    );
    return {
      min: Math.min(...ranges.map((range) => range.min)),
      max: Math.max(...ranges.map((range) => range.max)),
    };
  }

  async sample(): Promise<LoadSample> {
    return mergeSamples(this.samples(await this.all({ type: "sample" })));
  }

  async rejoinStorm(fromZero: boolean): Promise<RejoinSample> {
    const replies = await this.all({ type: "rejoin", fromZero });
    return mergeRejoins(
      replies.flatMap((reply) => (reply.type === "rejoined" ? [reply.rejoin] : [])),
    );
  }

  async stop(): Promise<LoadSample> {
    return mergeSamples(this.samples(await this.all({ type: "stop" })));
  }

  kill(): void {
    for (const worker of this.workers) worker.kill();
  }

  private all(request: WorkerRequest): Promise<WorkerReply[]> {
    return Promise.all(this.workers.map((worker) => worker.request(request)));
  }

  private samples(replies: readonly WorkerReply[]): LoadSample[] {
    return replies.flatMap((reply) => (reply.type === "sample" ? [reply.sample] : []));
  }
}
