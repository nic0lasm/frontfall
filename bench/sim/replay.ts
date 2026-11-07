import { readFileSync } from "node:fs";
import {
  loadMap,
  readDesyncReport,
  replayDesyncReport,
  type MapDescription,
} from "@frontfall/engine";

interface PublishedManifest extends MapDescription {
  readonly format: number;
  readonly version: number;
}

/**
 * `bun run sim --replay report.json`: plays a desync report again on the
 * published map it names and says where hashes first part. Exits with 1 when
 * the replay does not give the client's own hashes back, since the report then
 * cannot be trusted to reproduce anything.
 */
export function replay(path: string): number {
  const report = readDesyncReport(JSON.parse(readFileSync(path, "utf8")));
  const maps = new URL("../../apps/client/public/maps/", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL(`${report.map.id}.json`, maps), "utf8"),
  ) as PublishedManifest;
  if (manifest.format !== report.map.format || manifest.terrain.sha256 !== report.map.sha256) {
    console.error(
      `map ${report.map.id} here is version ${String(manifest.version)}, not the one the report was written on ` +
        `(version ${String(report.map.version)}, terrain ${report.map.sha256.slice(0, 12)})`,
    );
    return 1;
  }
  const { terrain } = loadMap(readFileSync(new URL(`${report.map.id}.bin`, maps)), manifest);
  console.log(
    `${report.map.id} v${String(report.map.version)}, seed ${String(report.seed)}, ` +
      `${String(report.players.length)} players (${String(report.bots.ids.length)} ${report.bots.difficulty} bots), ` +
      `${String(report.ticks)} ticks, written by ${report.build.release} (protocol ${String(report.build.protocol)})`,
  );
  const result = replayDesyncReport(report, terrain);
  const hex = (hash: number) => hash.toString(16).padStart(8, "0");
  if (result.firstDesync) {
    const { tick, local, expected } = result.firstDesync;
    console.log(
      `first desync at tick ${String(tick)}: this client ${hex(local)}, the others ${hex(expected)}`,
    );
  } else {
    console.log("no desync in the report: every checked hash matched the other players'");
  }
  if (result.firstLocalMismatch) {
    const { tick, replay: replayed, local } = result.firstLocalMismatch;
    console.error(
      `the replay parts from the client at tick ${String(tick)}: replay ${hex(replayed)}, client ${hex(local)}`,
    );
    return 1;
  }
  console.log(`replay matches the client's hashes over ${String(result.ticks)} ticks`);
  return 0;
}
