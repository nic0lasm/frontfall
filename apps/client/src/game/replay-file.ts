import type { GameRecord } from "@frontfall/engine";
import { BUILD } from "../build.ts";
import { REPLAY_EXTENSION } from "./replay-rules.ts";

// What the simulation worker needs too, kept apart from the file reading.
export {
  REPLAY_EXTENSION,
  REPLAY_MAP_CHANGED,
  REPLAY_SPEEDS,
  sameReplayMap,
} from "./replay-rules.ts";

/** Largest replay once uncompressed: far above 30 minutes of busy play. */
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

/** Why a replay file cannot be watched here. */
export type ReplayFileError = "unreadable" | "otherBuild" | "unsupported";

/** The record as a file to save. */
export async function replayFile(record: GameRecord): Promise<Blob> {
  const json = new Blob([JSON.stringify(record)]).stream();
  const compressed = json.pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed, { headers: { "content-type": "application/gzip" } }).blob();
}

/** File name of a saved replay: the map and the day it was played. */
export function replayFileName(record: GameRecord, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `frontfall-${record.map.id}-${day}${REPLAY_EXTENSION}`;
}

/**
 * The record in a saved replay, or why it cannot be watched: only the build
 * that played a game replays it, since the rules may have changed since.
 * Development builds accept any record, for testing.
 */
export async function readReplayFile(
  file: Blob,
  build: string = BUILD,
): Promise<GameRecord | ReplayFileError> {
  if (typeof DecompressionStream === "undefined") return "unsupported";
  let record: GameRecord;
  try {
    const json = await readCapped(file.stream().pipeThrough(new DecompressionStream("gzip")));
    // The reader loads with the first replay, out of the first download.
    const { readGameRecord } = await import("./replay-reader.ts");
    record = readGameRecord(JSON.parse(json));
  } catch {
    return "unreadable";
  }
  if (build !== "dev" && record.build.build !== build) return "otherBuild";
  return record;
}

/** The text of a stream, refused past MAX_REPLAY_BYTES so a crafted file cannot fill the memory. */
async function readCapped(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_REPLAY_BYTES) {
      await reader.cancel();
      throw new RangeError("replay too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}
