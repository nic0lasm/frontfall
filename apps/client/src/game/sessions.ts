import type { MapInfo } from "../maps.ts";
import type { GameSnapshot, SoloOptions } from "./game-runner.ts";
import { OnlineSession, type ServerLink } from "./online-session.ts";
import { ReplaySession } from "./replay-session.ts";
import type { GameSession, SessionEvents } from "./session.ts";
import { SoloSession } from "./solo-session.ts";

/**
 * The session of a game's mode: a replay when the options carry a record,
 * online with a link to the server, solo otherwise. `keep` takes the
 * snapshots of a solo game, for a reload; other modes ignore it.
 */
export function openSession(
  options: SoloOptions,
  map: MapInfo,
  events: SessionEvents,
  link?: ServerLink,
  keep?: (snapshot: GameSnapshot) => void,
): GameSession {
  if (options.record) return new ReplaySession(options, map, events);
  if (link) return new OnlineSession(options, map, events, link);
  return new SoloSession(options, map, events, keep);
}
