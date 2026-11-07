import { TICK_RATE } from "@frontfall/protocol";
import type { Logger } from "./log.ts";
import type { Metrics } from "./metrics.ts";
import type { RoomObserver } from "./room.ts";

/** What the games report as they start, end and meet trouble: counted and logged. */
export function roomObserver(metrics: Metrics, logger: Logger): RoomObserver {
  return {
    started(room) {
      metrics.gamesStarted.inc({
        visibility: room.settings.visibility,
        map: room.settings.map,
        teams: String(room.settings.teams),
      });
      logger.info("game_started", {
        game: room.id,
        visibility: room.settings.visibility,
        players: room.playerCount,
      });
    },
    finished(room, reason) {
      metrics.gamesFinished.inc({ reason });
      if (room.log.length > 0) metrics.gameMinutes.observe(room.log.length / TICK_RATE / 60);
      logger.info("game_finished", { game: room.id, reason, ticks: room.log.length });
    },
    orderThrottled(room, seat, total) {
      metrics.throttledOrders.inc();
      // Once per player: the first order dropped, then when it is clearly not a burst. Never the address.
      if (total === 1 || total === 50) {
        logger.warn("orders_throttled", { game: room.id, player: seat.id, dropped: total });
      }
    },
    desync(room, tick, hash, expected) {
      metrics.desyncs.inc();
      logger.warn("desync", { game: room.id, tick, hash, expected: expected ?? null });
    },
  };
}
