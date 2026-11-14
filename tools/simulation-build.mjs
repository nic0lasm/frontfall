import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Everything that decides how a game plays, given its turns: the engine and
// its balance, the contracts, the protocol, the maps, and the client's setup of a game. Two
// builds with the same sources here simulate alike, whatever else changed.
// See docs/protocol.md, "Simulation build".
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCES = [
  { dir: "packages/engine/src", keep: (name) => name.endsWith(".ts") },
  { dir: "packages/contracts/src", keep: (name) => name.endsWith(".ts") },
  { dir: "packages/protocol/src", keep: (name) => name.endsWith(".ts") },
  { dir: "apps/client/public/maps", keep: (name) => /\.(bin|json)$/.test(name) },
  { dir: "apps/client/src/game", keep: (name) => name === "simulation.ts" },
];

/** The files that make the simulation build, as paths from the repository root, sorted. */
export function simulationFiles(root = ROOT) {
  const files = [];
  for (const { dir, keep } of SOURCES) {
    for (const entry of readdirSync(join(root, dir), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && keep(entry.name)) {
        files.push(relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
      }
    }
  }
  return files.sort();
}

/**
 * Twelve hex digits of a SHA-256 over each file's path and content. Text has
 * its carriage returns dropped, so a checkout on Windows gives the same build.
 */
export function simulationBuild(root = ROOT) {
  const hash = createHash("sha256");
  for (const file of simulationFiles(root)) {
    let content = readFileSync(join(root, file));
    if (!file.endsWith(".bin"))
      content = Buffer.from(content.toString("utf8").replaceAll("\r", ""));
    hash.update(`${file}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest("hex").slice(0, 12);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(simulationBuild());
}
