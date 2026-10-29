import { CloseCode, type ClientMessage } from "@frontfall/protocol";
import type { Summary } from "../engine/stats.ts";
import { GameStats, LoadClient, TURN_MS, type GameData } from "./client.ts";
import { Histogram, type HistogramData } from "./histogram.ts";
import { LoopDelay, type LoopDelaySummary } from "./loop-delay.ts";

/** How a client learns that the server is full: an error to its request, or a close at once. */
const REFUSED = new RegExp(`too_many_games|closed with ${String(CloseCode.full)}`);

/** How the clients play, whatever process runs them. */
export interface SessionOptions {
  /** WebSocket endpoint, such as ws://localhost:8080/ws. */
  url: string;
  players: number;
  /**
   * Private games are created by one client and joined by id, then started
   * by their creator. Public games are filled by the server's matchmaking,
   * so players end up in games of the server's capacity.
   */
  mode: "private" | "public";
  /** Mean time between two orders of one player. */
  orderIntervalMs: number;
  /** Orders target random tiles below this index. */
  mapTiles: number;
  /** Share of the clients, in %, that stop reading their socket once their game starts. */
  slowPercent?: number;
}

export interface LoadOptions extends SessionOptions {
  games: number;
  durationMs: number;
  /** Progress lines, every `progressMs` while the games run. */
  log?: (line: string) => void;
  progressMs?: number;
}

/** What a set of clients measured, as plain JSON: samples of several processes add up. */
export interface LoadSample {
  games: GameData[];
  clients: number;
  slowClients: number;
  /** Clients the server turned away: no seat (`too_many_games`) or no connection (4006). */
  refusedClients: number;
  /** Time to join and start the games added last, in ms. */
  connectMs: number;
  /** Event loop delay of the process running the clients; the worst process when merged. */
  clientLoopDelay: LoopDelaySummary;
}

export interface RejoinSample {
  clients: number;
  failures: number;
  /** `rejoin` answered `token_in_use` and sent again. */
  retries: number;
  catchUp: HistogramData;
  /** The first failure, if any. */
  error: string | undefined;
}

export interface TurnRange {
  min: number;
  max: number;
}

export interface GameReport {
  id: string;
  players: number;
  minTurns: number;
  maxTurns: number;
  outOfOrder: number;
  changedTurns: number;
  desyncs: number;
  ordersSent: number;
  ordersSeen: number;
  /** Time between consecutive turns on one client, in ms; undefined when no client measured any. */
  interval: Summary | undefined;
  /** Order sent to turn received, in ms; undefined when no order came back. */
  orderLatency: Summary | undefined;
}

export interface LoadReport {
  games: GameReport[];
  /** Every game's intervals together. */
  interval: Summary;
  orderLatency: Summary | undefined;
  connectMs: number;
  /** Event loop delay of the process running the clients, in ms: high values skew the rest. */
  clientLoopDelay: LoopDelaySummary;
  clients: number;
  slowClients: number;
  refusedClients: number;
}

export interface RejoinReport {
  clients: number;
  failures: number;
  retries: number;
  /** From the drop to holding the current turn, in ms. */
  catchUp: Summary | undefined;
  error: string | undefined;
}

/**
 * Whether the client with this index stops reading: spreads `percent` % of
 * the clients evenly over the games.
 */
export function isSlow(index: number, percent: number): boolean {
  return Math.floor(((index + 1) * percent) / 100) > Math.floor((index * percent) / 100);
}

/** The clients of one process: joins games, plays them, measures what they receive. */
export class LoadSession {
  private readonly stats = new Map<string, GameStats>();
  private readonly clients: LoadClient[] = [];
  private readonly loopDelay = new LoopDelay();
  private connectMs = 0;
  private refusedClients = 0;

  constructor(private readonly options: SessionOptions) {}

  /**
   * Joins the clients of these games, numbered across every process so that
   * names and addresses never repeat, starts the games and plays them.
   */
  async add(games: readonly number[]): Promise<number> {
    const start = performance.now();
    const clients = await this.startGames(games);
    for (const { client, index } of clients) {
      client.play(this.options.orderIntervalMs, this.options.mapTiles);
      if (isSlow(index, this.options.slowPercent ?? 0)) client.stall();
      this.clients.push(client);
    }
    this.connectMs = performance.now() - start;
    return this.connectMs;
  }

  progress(): TurnRange {
    const turns = this.clients.filter((client) => !client.stalled).map((client) => client.turns);
    return { min: Math.min(...turns), max: Math.max(...turns) };
  }

  /** Measures since the previous sample; histograms and loop delay start again empty. */
  sample(): LoadSample {
    const sample: LoadSample = {
      games: [...this.stats.values()].map((game) => game.take()),
      clients: this.clients.length,
      slowClients: this.clients.filter((client) => client.stalled).length,
      refusedClients: this.refusedClients,
      connectMs: this.connectMs,
      clientLoopDelay: this.loopDelay.summary(),
    };
    this.loopDelay.reset();
    return sample;
  }

  /** Every client that still reads drops its socket at once, then rejoins. */
  async rejoinStorm(fromZero: boolean): Promise<RejoinSample> {
    const catchUp = new Histogram();
    let failures = 0;
    let retries = 0;
    let error: string | undefined;
    const readers = this.clients.filter((client) => !client.stalled);
    await Promise.all(
      readers.map(async (client) => {
        try {
          const result = await client.rejoin(fromZero);
          catchUp.record(result.caughtUpMs);
          retries += result.retries;
        } catch (cause) {
          failures++;
          error ??= cause instanceof Error ? cause.message : String(cause);
        }
      }),
    );
    return { clients: readers.length, failures, retries, catchUp: catchUp.toData(), error };
  }

  /** Stops every client at the same instant and returns the last sample. */
  stop(): LoadSample {
    // Taken first: the pass below blocks the loop on purpose.
    const clientLoopDelay = this.loopDelay.summary();
    this.loopDelay.stop();
    // One synchronous pass, so every client's turn count is taken at the same instant.
    for (const client of this.clients) client.stop();
    return { ...this.sample(), clientLoopDelay };
  }

  private statsFor = (game: string): GameStats => {
    let found = this.stats.get(game);
    if (!found) {
      found = new GameStats(game);
      this.stats.set(game, found);
    }
    return found;
  };

  private connect(index: number): Promise<LoadClient> {
    return LoadClient.connect({
      url: this.options.url,
      name: `Load ${String(index)}`,
      address: `10.${String((index >> 16) & 255)}.${String((index >> 8) & 255)}.${String(index & 255)}`,
      statsFor: this.statsFor,
    });
  }

  /**
   * Connects a client and sends its first request; undefined when the server
   * turns it away at its admission limits, which the run counts.
   */
  private async admit(
    index: number,
    request: ClientMessage,
    answer: (client: LoadClient) => Promise<unknown>,
  ): Promise<LoadClient | undefined> {
    let client: LoadClient | undefined;
    try {
      client = await this.connect(index);
      client.send(request);
      await answer(client);
      return client;
    } catch (error) {
      if (!(error instanceof Error) || !REFUSED.test(error.message)) throw error;
      client?.stop();
      this.refusedClients++;
      return undefined;
    }
  }

  /** Resolves once every admitted client has `started`. */
  private async startGames(
    games: readonly number[],
  ): Promise<{ client: LoadClient; index: number }[]> {
    const { players } = this.options;
    if (this.options.mode === "public") {
      const admitted = await Promise.all(
        games.flatMap((game) =>
          Array.from({ length: players }, async (_, seat) => {
            const index = game * players + seat;
            const client = await this.admit(index, { type: "play" }, (joined) =>
              joined.lobbyOrStarted(),
            );
            return client ? [{ client, index }] : [];
          }),
        ),
      );
      const clients = admitted.flat();
      // Public games count down 30 s by default once they have two players.
      await Promise.all(clients.map(({ client }) => client.next("started", 120_000)));
      return clients;
    }

    const started = await Promise.all(
      games.map(async (game) => {
        const first = game * players;
        let id = "";
        const host = await this.admit(first, { type: "create" }, async (client) => {
          id = (await client.next("lobby")).game;
        });
        if (!host) {
          this.refusedClients += players - 1;
          return [];
        }
        const admitted = await Promise.all(
          Array.from({ length: players - 1 }, async (_, seat) => {
            const index = first + 1 + seat;
            const guest = await this.admit(index, { type: "join", game: id }, (client) =>
              client.lobbyOrStarted(),
            );
            return guest ? [{ client: guest, index }] : [];
          }),
        );
        const guests = admitted.flat();
        if (guests.length === 0) {
          // A game needs two players to start.
          host.stop();
          this.refusedClients++;
          return [];
        }
        for (;;) {
          const lobby = await host.lobbyOrStarted();
          if (!lobby) break;
          if (lobby.players.length < guests.length + 1) continue;
          // A game set to start when full starts by itself.
          if (!lobby.autoStart || lobby.players.length < lobby.capacity) {
            host.send({ type: "start" });
          }
          break;
        }
        const clients = [{ client: host, index: first }, ...guests];
        await Promise.all(clients.map(({ client }) => client.next("started")));
        return clients;
      }),
    );
    return started.flat();
  }
}

/** Adds up the samples of several processes; a game split between them is merged by id. */
export function mergeSamples(samples: readonly LoadSample[]): LoadSample {
  const games = new Map<string, GameData>();
  for (const sample of samples) {
    for (const game of sample.games) {
      const found = games.get(game.id);
      if (!found) {
        games.set(game.id, game);
        continue;
      }
      const intervals = Histogram.fromData(found.intervals);
      intervals.add(Histogram.fromData(game.intervals));
      const latency = Histogram.fromData(found.orderLatency);
      latency.add(Histogram.fromData(game.orderLatency));
      games.set(game.id, {
        id: game.id,
        intervals: intervals.toData(),
        orderLatency: latency.toData(),
        outOfOrder: found.outOfOrder + game.outOfOrder,
        changedTurns: found.changedTurns + game.changedTurns,
        desyncs: found.desyncs + game.desyncs,
        ordersSent: found.ordersSent + game.ordersSent,
        ordersSeen: found.ordersSeen + game.ordersSeen,
        turnsPerClient: [...found.turnsPerClient, ...game.turnsPerClient],
      });
    }
  }
  return {
    games: [...games.values()],
    clients: samples.reduce((sum, sample) => sum + sample.clients, 0),
    slowClients: samples.reduce((sum, sample) => sum + sample.slowClients, 0),
    refusedClients: samples.reduce((sum, sample) => sum + sample.refusedClients, 0),
    connectMs: Math.max(0, ...samples.map((sample) => sample.connectMs)),
    clientLoopDelay: {
      p99: Math.max(0, ...samples.map((sample) => sample.clientLoopDelay.p99)),
      max: Math.max(0, ...samples.map((sample) => sample.clientLoopDelay.max)),
    },
  };
}

export function mergeRejoins(samples: readonly RejoinSample[]): RejoinSample {
  const catchUp = new Histogram();
  for (const sample of samples) catchUp.add(Histogram.fromData(sample.catchUp));
  return {
    clients: samples.reduce((sum, sample) => sum + sample.clients, 0),
    failures: samples.reduce((sum, sample) => sum + sample.failures, 0),
    retries: samples.reduce((sum, sample) => sum + sample.retries, 0),
    catchUp: catchUp.toData(),
    error: samples.find((sample) => sample.error !== undefined)?.error,
  };
}

const summaryOf = (data: HistogramData): Summary | undefined =>
  data.count > 0 ? Histogram.fromData(data).summary() : undefined;

export function summarizeRejoin(sample: RejoinSample): RejoinReport {
  return {
    clients: sample.clients,
    failures: sample.failures,
    retries: sample.retries,
    catchUp: summaryOf(sample.catchUp),
    error: sample.error,
  };
}

/** Percentiles of a sample. */
export function summarizeLoad(sample: LoadSample): LoadReport {
  const intervals = new Histogram();
  const latency = new Histogram();
  const games = sample.games.map((game): GameReport => {
    const turns = game.turnsPerClient;
    intervals.add(Histogram.fromData(game.intervals));
    latency.add(Histogram.fromData(game.orderLatency));
    return {
      id: game.id,
      players: turns.length,
      minTurns: turns.length > 0 ? Math.min(...turns) : 0,
      maxTurns: turns.length > 0 ? Math.max(...turns) : 0,
      outOfOrder: game.outOfOrder,
      changedTurns: game.changedTurns,
      desyncs: game.desyncs,
      ordersSent: game.ordersSent,
      ordersSeen: game.ordersSeen,
      interval: summaryOf(game.intervals),
      orderLatency: summaryOf(game.orderLatency),
    };
  });
  return {
    games,
    interval: intervals.summary(),
    orderLatency: latency.samples > 0 ? latency.summary() : undefined,
    connectMs: sample.connectMs,
    clientLoopDelay: sample.clientLoopDelay,
    clients: sample.clients,
    slowClients: sample.slowClients,
    refusedClients: sample.refusedClients,
  };
}

/** Plays the games for the given duration in this process and reports what every client saw. */
export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const session = new LoadSession(options);
  await session.add(Array.from({ length: options.games }, (_, game) => game));
  session.sample();
  const runStart = performance.now();
  const progress = setInterval(() => {
    const turns = session.progress();
    const seconds = Math.round((performance.now() - runStart) / 1000);
    options.log?.(
      `${String(seconds)} s: ${String(turns.min)} to ${String(turns.max)} turns per client`,
    );
  }, options.progressMs ?? 30_000);
  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  clearInterval(progress);
  return summarizeLoad(session.stop());
}

const ms = (value: number): string => value.toFixed(1);
export const late = (value: number): string =>
  `${value >= TURN_MS ? "+" : ""}${ms(value - TURN_MS)}`;

/** The report as Markdown tables, lateness counted against the 100 ms turn. */
export function formatReport(report: LoadReport): string {
  const lines = [
    "| Game | Players | Turns | Out of order | Changed | Desyncs | Orders sent / seen | Lateness p50 | p95 | max | Order latency p50 / p95 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const game of report.games) {
    const turns =
      game.minTurns === game.maxTurns
        ? String(game.minTurns)
        : `${String(game.minTurns)}–${String(game.maxTurns)}`;
    const latency = game.orderLatency
      ? `${ms(game.orderLatency.p50)} / ${ms(game.orderLatency.p95)} ms`
      : "–";
    const lateness = game.interval
      ? `${late(game.interval.p50)} ms | ${late(game.interval.p95)} ms | ${late(game.interval.max)} ms`
      : "– | – | –";
    lines.push(
      `| ${game.id} | ${String(game.players)} | ${turns} | ${String(game.outOfOrder)} | ${String(game.changedTurns)} | ${String(game.desyncs)} | ${String(game.ordersSent)} / ${String(game.ordersSeen)} | ${lateness} | ${latency} |`,
    );
  }
  const { interval, orderLatency } = report;
  lines.push(
    "",
    `All games: ${String(interval.samples)} turn intervals, mean ${ms(interval.mean)} ms, p50 ${ms(interval.p50)} ms, p95 ${ms(interval.p95)} ms, p99 ${ms(interval.p99)} ms, max ${ms(interval.max)} ms.`,
  );
  if (orderLatency) {
    lines.push(
      `Order to turn: p50 ${ms(orderLatency.p50)} ms, p95 ${ms(orderLatency.p95)} ms, max ${ms(orderLatency.max)} ms.`,
    );
  }
  if (report.refusedClients > 0) {
    lines.push(
      `The server turned ${String(report.refusedClients)} clients away at its admission limits.`,
    );
  }
  if (report.slowClients > 0) {
    lines.push(
      `${String(report.slowClients)} of ${String(report.clients)} clients stopped reading their socket and are left out of the turns above.`,
    );
  }
  lines.push(
    `Joining and starting every game took ${ms(report.connectMs)} ms. Client event loop delay: p99 ${ms(report.clientLoopDelay.p99)} ms, max ${ms(report.clientLoopDelay.max)} ms.`,
  );
  return lines.join("\n");
}

export function formatRejoin(report: RejoinReport, fromZero: boolean): string {
  const catchUp = report.catchUp
    ? `caught up p50 ${ms(report.catchUp.p50)} ms, p95 ${ms(report.catchUp.p95)} ms, max ${ms(report.catchUp.max)} ms`
    : "none caught up";
  const failed =
    report.failures > 0 ? `, ${String(report.failures)} failed (${report.error ?? "?"})` : "";
  return `Rejoin storm${fromZero ? " from tick 0" : ""}: ${String(report.clients)} clients dropped and rejoined, ${catchUp}, ${String(report.retries)} token_in_use retries${failed}.`;
}
