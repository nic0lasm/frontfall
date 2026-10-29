import { TURN_MS } from "./client.ts";
import type { LoadReport } from "./load.ts";
import type { LoopDelaySummary } from "./loop-delay.ts";
import type { ServerStats } from "./serve.ts";

/** A step saturates the server when turns run this late at p95, in ms… */
export const SATURATED_LATENESS_MS = 20;
/** …or when its event loop is this late at p99, in ms. */
export const SATURATED_LOOP_MS = 50;
/** Above this client loop delay p99, in ms, the clients may be what runs late. */
export const CLIENT_BOUND_LOOP_MS = 20;

export interface TurnPassSummary {
  passes: number;
  meanMs: number;
  /** The upper bound of the bucket that holds the 99th percentile; undefined beyond the last one. */
  p99AtMostMs: number | undefined;
}

/** What the server spent between two stats requests. */
export interface ServerWindow {
  cpuPercent: number;
  rssBytes: number;
  peakRssBytes: number;
  heapUsedBytes: number;
  peakHeapUsedBytes: number;
  loopDelay: LoopDelaySummary;
  turnPass: TurnPassSummary | undefined;
}

export function serverWindow(
  before: ServerStats,
  after: ServerStats,
  wallMs: number,
): ServerWindow {
  const cpuMs = (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000;
  const passes = after.turnPasses.count - before.turnPasses.count;
  let turnPass: TurnPassSummary | undefined;
  if (passes > 0) {
    const bucket = after.turnPasses.buckets.find(([bound, count]) => {
      const earlier = before.turnPasses.buckets.find(([other]) => other === bound)?.[1] ?? 0;
      return count - earlier >= 0.99 * passes;
    });
    turnPass = {
      passes,
      meanMs: ((after.turnPasses.sumSeconds - before.turnPasses.sumSeconds) / passes) * 1000,
      p99AtMostMs: bucket ? bucket[0] * 1000 : undefined,
    };
  }
  return {
    cpuPercent: (cpuMs / wallMs) * 100,
    rssBytes: after.rssBytes,
    peakRssBytes: after.peakRssBytes,
    heapUsedBytes: after.heapUsedBytes,
    peakHeapUsedBytes: after.peakHeapUsedBytes,
    loopDelay: after.loopDelay,
    turnPass,
  };
}

export const mib = (bytes: number): string => (bytes / 2 ** 20).toFixed(0);
const ms = (value: number): string => value.toFixed(1);

function turnPassText(pass: TurnPassSummary | undefined): string {
  if (!pass) return "–";
  const p99 = pass.p99AtMostMs === undefined ? "> 100" : `≤ ${String(pass.p99AtMostMs)}`;
  return `${pass.meanMs.toFixed(2)} ms mean, p99 ${p99} ms`;
}

export function formatServer(server: ServerWindow): string {
  return `Server: ${server.cpuPercent.toFixed(1)} % of one core over the run, RSS ${mib(server.rssBytes)} MiB (peak ${mib(server.peakRssBytes)} MiB), heap used ${mib(server.heapUsedBytes)} MiB (peak ${mib(server.peakHeapUsedBytes)} MiB), event loop delay p99 ${ms(server.loopDelay.p99)} ms, max ${ms(server.loopDelay.max)} ms, turn pass ${turnPassText(server.turnPass)}.`;
}

export interface RampStep {
  games: number;
  report: LoadReport;
  server: ServerWindow | undefined;
}

/** Why a step counts as saturated, or undefined when it kept up. */
export function saturation(step: RampStep): string | undefined {
  const lateness = step.report.interval.p95 - TURN_MS;
  if (lateness > SATURATED_LATENESS_MS) return `lateness p95 +${ms(lateness)} ms`;
  if (step.server && step.server.loopDelay.p99 > SATURATED_LOOP_MS)
    return `server loop p99 ${ms(step.server.loopDelay.p99)} ms`;
  return undefined;
}

export function formatRamp(steps: readonly RampStep[]): string {
  const lines = [
    "| Games | Players | Server CPU | RSS | Heap | Loop p99 | Turn pass | Lateness p95 | max | Order → turn p95 | Client loop p99 | |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  let flagged = false;
  for (const step of steps) {
    const { report, server } = step;
    const reason = saturation(step);
    const notes: string[] = [];
    if (reason && !flagged) {
      notes.push(`**saturated** (${reason})`);
      flagged = true;
    } else if (reason) notes.push(`saturated (${reason})`);
    if (report.clientLoopDelay.p99 > CLIENT_BOUND_LOOP_MS) notes.push("clients late");
    if (report.refusedClients > 0) notes.push(`${String(report.refusedClients)} refused`);
    const serverCells = server
      ? `${server.cpuPercent.toFixed(1)} % | ${mib(server.rssBytes)} MiB | ${mib(server.heapUsedBytes)} MiB | ${ms(server.loopDelay.p99)} ms | ${turnPassText(server.turnPass)}`
      : "– | – | – | – | –";
    const latency = report.orderLatency ? `${ms(report.orderLatency.p95)} ms` : "–";
    lines.push(
      `| ${String(step.games)} | ${String(report.clients)} | ${serverCells} | +${ms(report.interval.p95 - TURN_MS)} ms | +${ms(report.interval.max - TURN_MS)} ms | ${latency} | ${ms(report.clientLoopDelay.p99)} ms | ${notes.join(", ")} |`,
    );
  }
  return lines.join("\n");
}

export interface MemorySample {
  seconds: number;
  rssBytes: number;
  heapUsedBytes: number;
}

/** At most `rows` rows, evenly picked, the last sample always among them. */
export function formatTimeline(samples: readonly MemorySample[], rows = 20): string {
  const lines = ["| Time | Server RSS | Heap used |", "| ---: | ---: | ---: |"];
  const every = Math.max(1, Math.ceil(samples.length / rows));
  samples.forEach((sample, index) => {
    if (index % every !== 0 && index !== samples.length - 1) return;
    lines.push(
      `| ${String(sample.seconds)} s | ${mib(sample.rssBytes)} MiB | ${mib(sample.heapUsedBytes)} MiB |`,
    );
  });
  return lines.join("\n");
}
