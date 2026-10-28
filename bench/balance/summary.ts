import type { GameReport, PlayerReport } from "./game.ts";

/** Figures over many games of one setup, as the balance report prints them. */
export interface BalanceSummary {
  readonly games: number;
  readonly decided: number;
  /** Minutes of play to the decision: median, lowest and highest, of decided games. */
  readonly decidedAt?: { readonly median: number; readonly min: number; readonly max: number };
  /** Wins of each kind of player against its fair share: the share of players of that kind. */
  readonly groups: readonly GroupSummary[];
  /** Median share of the land held by the leader at the end of some minutes, in %. */
  readonly leaderShare: Readonly<Record<number, number>>;
  /** Gold per second at some minutes, medians over games. */
  readonly income: readonly IncomeSummary[];
  readonly missiles: {
    /** Launched per game, median and highest. */
    readonly median: number;
    readonly max: number;
    /** Share aimed at the leader's land, in %. */
    readonly atLeaderPercent: number;
    /** Most launched in one minute, and in 10 seconds, over all games. */
    readonly perMinuteMax: number;
    readonly burstMax: number;
  };
  readonly casual?: {
    readonly won: number;
    readonly alive: number;
    /** Minutes of play at elimination, median of the games it lost that way. */
    readonly eliminatedMedian?: number;
  };
}

export interface GroupSummary {
  readonly group: string;
  readonly players: number;
  readonly wins: number;
  /** Wins over games decided, divided by the group's share of the players. 1 is fair. */
  readonly fairness: number;
}

export interface IncomeSummary {
  readonly minute: number;
  readonly medianTroop: number;
  readonly medianTrade: number;
  readonly leaderTroop: number;
  readonly leaderTrade: number;
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

/** Groups a player belongs to: its kind and difficulty, and where it started. */
export function groupsOf(player: PlayerReport): string[] {
  const kind = player.difficulty ? `${player.kind} ${player.difficulty}` : player.kind;
  return [kind, player.coastal ? "start: coastal" : "start: inland"];
}

const MINUTES = [4, 6, 8, 10, 15];

export function summarize(reports: readonly GameReport[]): BalanceSummary {
  const decided = reports.filter((r) => r.decidedAt !== undefined);
  const times = decided.map((r) => r.decidedAt as number);

  const players = new Map<string, number>();
  const wins = new Map<string, number>();
  let total = 0;
  for (const report of reports) {
    for (const player of report.players) {
      total++;
      for (const group of groupsOf(player)) players.set(group, (players.get(group) ?? 0) + 1);
    }
    const winner = report.players.find((p) => p.id === report.winner);
    if (winner) for (const group of groupsOf(winner)) wins.set(group, (wins.get(group) ?? 0) + 1);
  }
  const groups = [...players.entries()]
    .map(([group, count]) => {
      const won = wins.get(group) ?? 0;
      const share = count / total;
      return {
        group,
        players: count,
        wins: won,
        fairness: decided.length === 0 ? 0 : won / decided.length / share,
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group));

  const at = (report: GameReport, minute: number) =>
    report.minutes.find((m) => m.minute === minute);
  const leaderShare: Record<number, number> = {};
  for (const minute of MINUTES) {
    const shares = reports.flatMap((r) => {
      const m = at(r, minute);
      // A game decided earlier counts with its share at the end.
      return [m ? m.leaderSharePercent : r.leaderSharePercent];
    });
    leaderShare[minute] = median(shares);
  }
  const income = MINUTES.map((minute) => {
    const rows = reports.flatMap((r) => {
      const m = at(r, minute);
      return m ? [m] : [];
    });
    return {
      minute,
      medianTroop: median(rows.map((m) => m.medianTroopGold)),
      medianTrade: median(rows.map((m) => m.medianTradeGold)),
      leaderTroop: median(rows.map((m) => m.leaderTroopGold)),
      leaderTrade: median(rows.map((m) => m.leaderTradeGold)),
    };
  });

  const launched = reports.map((r) => r.minutes.reduce((sum, m) => sum + m.missiles, 0));
  const atLeader = reports.reduce(
    (sum, r) => sum + r.minutes.reduce((s, m) => s + m.missilesAtLeader, 0),
    0,
  );
  const allMissiles = launched.reduce((a, b) => a + b, 0);
  const missiles = {
    median: median(launched),
    max: Math.max(0, ...launched),
    atLeaderPercent: allMissiles === 0 ? 0 : (atLeader * 100) / allMissiles,
    perMinuteMax: Math.max(0, ...reports.flatMap((r) => r.minutes.map((m) => m.missiles))),
    burstMax: Math.max(0, ...reports.map((r) => r.missileBurst)),
  };

  const casuals = reports.flatMap((r) => {
    const casual = r.players.find((p) => p.kind === "casual" || p.kind === "average");
    return casual ? [{ casual, won: r.winner === casual.id }] : [];
  });
  const lost = casuals.flatMap(({ casual }) =>
    casual.eliminatedAt === undefined ? [] : [casual.eliminatedAt],
  );

  return {
    games: reports.length,
    decided: decided.length,
    ...(times.length
      ? { decidedAt: { median: median(times), min: Math.min(...times), max: Math.max(...times) } }
      : {}),
    groups,
    leaderShare,
    income,
    missiles,
    ...(casuals.length
      ? {
          casual: {
            won: casuals.filter((c) => c.won).length,
            alive: casuals.filter((c) => c.casual.eliminatedAt === undefined).length,
            ...(lost.length ? { eliminatedMedian: median(lost) } : {}),
          },
        }
      : {}),
  };
}
