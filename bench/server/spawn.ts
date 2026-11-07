import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ServerRequest, ServerStats } from "./serve.ts";

export interface SpawnOptions {
  players: number;
  /** Keep the server's admission limits, or the ones given, instead of lifting them. */
  serverLimits: boolean;
  maxPlayers?: number | undefined;
  maxConnections?: number | undefined;
}

/**
 * The game server in a child process run by Bun, as in production, answering
 * one request at a time over IPC; the clients stay on Node.
 */
export class SpawnedServer {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly url: string,
    /** The Bun version the server runs on. */
    readonly bun: string,
    private readonly child: ChildProcess,
  ) {}

  /** Starts serve.ts with Bun and resolves once it listens. */
  static async start(options: SpawnOptions): Promise<SpawnedServer> {
    const child = fork(fileURLToPath(new URL("serve.ts", import.meta.url)), {
      execPath: "bun",
      execArgv: [],
      // Bun speaks JSON over the IPC channel of a Node parent.
      serialization: "json",
      env: {
        ...process.env,
        LOAD_PLAYERS: String(options.players),
        LOAD_SERVER_LIMITS: options.serverLimits ? "1" : "0",
        LOAD_MAX_PLAYERS: options.maxPlayers === undefined ? "" : String(options.maxPlayers),
        LOAD_MAX_CONNECTIONS:
          options.maxConnections === undefined ? "" : String(options.maxConnections),
      },
    });
    const { port, bun } = await new Promise<{ port: number; bun: string }>((resolve, reject) => {
      child.once("message", resolve);
      child.once("exit", (code) => {
        reject(new Error(`server exited with ${String(code)}`));
      });
    });
    return new SpawnedServer(`ws://127.0.0.1:${String(port)}/ws`, bun, child);
  }

  request(what: Exclude<ServerRequest, "stop">): Promise<ServerStats> {
    const reply = this.queue.then(
      () =>
        new Promise<ServerStats>((resolve) => {
          this.child.once("message", resolve);
          this.child.send(what);
        }),
    );
    this.queue = reply;
    return reply;
  }

  /** After the requests still queued, such as a memory sample; resolves once the process is gone. */
  stop(): Promise<void> {
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) resolve();
      else
        this.child.once("exit", () => {
          resolve();
        });
    });
    void this.queue.then(() => {
      if (this.child.connected) this.child.send("stop" satisfies ServerRequest);
    });
    return exited;
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill();
  }
}
