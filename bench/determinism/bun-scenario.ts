import { readFileSync } from "node:fs";
import type { MapDescription } from "@frontfall/engine";
import { playScenario } from "./scenario.ts";

/**
 * Plays the determinism scenario under Bun and prints the result as JSON, for
 * run.ts to compare with Node's. Arguments: the map's folder, its name, the
 * number of ticks.
 */
const [folder, name, count] = process.argv.slice(2);
if (!folder || !name || !count) {
  console.error("usage: bun bun-scenario.ts <maps folder> <map> <ticks>");
  process.exit(2);
}
const bytes = readFileSync(`${folder}/${name}.bin`);
const manifest = JSON.parse(readFileSync(`${folder}/${name}.json`, "utf8")) as MapDescription;
console.log(JSON.stringify(playScenario(new Uint8Array(bytes), manifest, Number(count))));
