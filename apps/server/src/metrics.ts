/** Upper bounds of the turn duration histogram, in seconds. */
const TURN_BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1];

type Labels = Record<string, string>;

const NO_LABELS: Labels = {};

function key(labels: Labels): string {
  // Unlabelled counters are bumped for every message received.
  if (labels === NO_LABELS) return "";
  return Object.entries(labels)
    .map(([name, value]) => `${name}="${value.replace(/["\\\n]/g, "\\$&")}"`)
    .join(",");
}

class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = NO_LABELS, by = 1): void {
    const id = key(labels);
    this.values.set(id, (this.values.get(id) ?? 0) + by);
  }

  get(labels: Labels = NO_LABELS): number {
    return this.values.get(key(labels)) ?? 0;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [id, value] of this.values) {
      lines.push(`${this.name}${id ? `{${id}}` : ""} ${String(value)}`);
    }
    return lines;
  }
}

/** Upper bounds of the game duration histogram, in minutes. */
const GAME_BUCKETS = [2, 5, 10, 20, 40, 60, 120];

class Histogram {
  private readonly counts: number[];
  private sum = 0;
  private count = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly buckets: readonly number[] = TURN_BUCKETS,
  ) {
    this.counts = new Array<number>(buckets.length).fill(0);
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;
    this.buckets.forEach((bound, index) => {
      if (value <= bound) this.counts[index] = (this.counts[index] ?? 0) + 1;
    });
  }

  render(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
      ...this.buckets.map(
        (bound, index) =>
          `${this.name}_bucket{le="${String(bound)}"} ${String(this.counts[index])}`,
      ),
      `${this.name}_bucket{le="+Inf"} ${String(this.count)}`,
      `${this.name}_sum ${String(this.sum)}`,
      `${this.name}_count ${String(this.count)}`,
    ];
  }
}

/** Values read when /metrics is scraped rather than counted as they change. */
export interface Snapshot {
  games: Record<"open" | "starting" | "running", number>;
  players: number;
  connections: number;
}

/**
 * The server's metrics, in the Prometheus text format. A handful of numbers
 * do not justify a client library.
 */
export class Metrics {
  readonly gamesStarted = new Counter(
    "frontfall_games_started_total",
    "Games that started, by visibility, map and teams.",
  );
  readonly gamesFinished = new Counter(
    "frontfall_games_finished_total",
    "Games that finished, by reason.",
  );
  readonly desyncs = new Counter(
    "frontfall_desyncs_total",
    "Games in which two clients reported different state hashes.",
  );
  readonly rejoins = new Counter(
    "frontfall_rejoins_total",
    "Players who took their seat back after a dropped connection.",
  );
  readonly messages = new Counter(
    "frontfall_messages_received_total",
    "Messages received from clients.",
  );
  readonly rejected = new Counter(
    "frontfall_rejected_messages_total",
    "Connections closed for a message, by reason.",
  );
  readonly refused = new Counter(
    "frontfall_refused_connections_total",
    "WebSocket connections refused before the hello, by reason.",
  );
  readonly slowClients = new Counter(
    "frontfall_slow_clients_total",
    "Connections dropped for leaving too much unread.",
  );
  readonly reports = new Counter(
    "frontfall_reports_total",
    "Reports of a player by another, by reason.",
  );
  readonly gameMinutes = new Histogram(
    "frontfall_game_duration_minutes",
    "Length of the games that finished, in minutes.",
    GAME_BUCKETS,
  );
  readonly turnDuration = new Histogram(
    "frontfall_turn_duration_seconds",
    "Time of one pass of the turn timer, which closes and sends the turns of a tenth of the games.",
  );

  /** `extra` are lines rendered elsewhere, such as the usage counts. */
  render(snapshot: Snapshot, extra: readonly string[] = []): string {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const lines = [
      "# HELP frontfall_games Games on the server, by state.",
      "# TYPE frontfall_games gauge",
      ...Object.entries(snapshot.games).map(
        ([state, count]) => `frontfall_games{state="${state}"} ${String(count)}`,
      ),
      "# HELP frontfall_players Players seated in a game with an open connection.",
      "# TYPE frontfall_players gauge",
      `frontfall_players ${String(snapshot.players)}`,
      "# HELP frontfall_connections Open WebSocket connections.",
      "# TYPE frontfall_connections gauge",
      `frontfall_connections ${String(snapshot.connections)}`,
      ...this.gamesStarted.render(),
      ...this.gamesFinished.render(),
      ...this.desyncs.render(),
      ...this.rejoins.render(),
      ...this.messages.render(),
      ...this.rejected.render(),
      ...this.refused.render(),
      ...this.slowClients.render(),
      ...this.reports.render(),
      ...this.gameMinutes.render(),
      ...this.turnDuration.render(),
      ...extra,
      "# HELP process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${String(memory.rss)}`,
      "# HELP process_cpu_seconds_total User and system CPU time spent in seconds.",
      "# TYPE process_cpu_seconds_total counter",
      `process_cpu_seconds_total ${String((cpu.user + cpu.system) / 1e6)}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}
