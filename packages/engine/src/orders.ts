import type { Game, Order, Player } from "./game.ts";
import {
  DiplomacyError,
  allyError,
  betrayError,
  embargoError,
  isAllied,
  tributeError,
} from "./diplomacy.ts";
import { BuildError, isStructureKind, placementError } from "./structures.ts";
import { soldiers, workError } from "./economy.ts";
import { giftError } from "./gifts.ts";
import { missileError } from "./missiles.ts";
import { quickError } from "./quick-messages.ts";
import { patrolError, warshipError } from "./warships.ts";

/**
 * Why an order cannot be carried out in the current state, or undefined when
 * it can. Orders come from the network, so nothing about them is trusted:
 * every field is checked here before any handler sees the order.
 */
export function orderError(game: Game, player: Player, order: Order): string | undefined {
  switch (order.type) {
    case "spawn":
      if (game.phase !== "spawn") return "the spawn phase is over";
      return tileError(game, order.tile);
    case "attack": {
      // R-SPAWN-05: nobody attacks during the spawn phase.
      if (game.phase !== "play") return "attacks start after the spawn phase";
      const error = tileError(game, order.target);
      if (error) return error;
      if (!Number.isSafeInteger(order.troops) || order.troops < 1) return "invalid troop count";
      // R-ECO-07: workers stay at home.
      if (order.troops > soldiers(player)) return "not enough troops";
      if (game.territory.ownerOf(order.target) === player.id) return "the target is already owned";
      // R-DIPLO-02: an ally is attacked only after betraying them.
      if (isAllied(game, player.id, game.territory.ownerOf(order.target)))
        return DiplomacyError.Ally;
      return undefined;
    }
    case "embark": {
      if (game.phase !== "play") return "attacks start after the spawn phase";
      const error = tileError(game, order.target);
      if (error) return error;
      if (!Number.isSafeInteger(order.troops) || order.troops < 1) return "invalid troop count";
      if (order.troops > soldiers(player)) return "not enough troops";
      if (game.territory.ownerOf(order.target) === player.id) return "the target is already owned";
      if (isAllied(game, player.id, game.territory.ownerOf(order.target)))
        return DiplomacyError.Ally;
      if (!game.terrain.isCoast(order.target)) return "ships can only land on a coast";
      const atSea = game.boats.filter((boat) => boat.player === player.id).length;
      if (atSea >= game.balance.boatMax) return "too many ships at sea";
      return undefined;
    }
    case "retreat":
      if (game.phase !== "play") return "attacks start after the spawn phase";
      if (!Number.isSafeInteger(order.attack) || order.attack < 1) return "invalid attack id";
      return undefined;
    case "build": {
      if (game.phase !== "play") return BuildError.Early;
      if (!isStructureKind(order.structure)) return "unknown structure";
      return (
        tileError(game, order.tile) ?? placementError(game, player, order.structure, order.tile)
      );
    }
    case "demolish": {
      if (game.phase !== "play") return BuildError.Early;
      const error = tileError(game, order.tile);
      if (error) return error;
      const owned = game.structures.some((s) => s.tile === order.tile && s.player === player.id);
      return owned ? undefined : "no structure of yours on the tile";
    }
    case "ally":
      return playerError(order.target) ?? allyError(game, player, order.target);
    case "tribute":
      return playerError(order.target) ?? tributeError(game, player, order.target);
    case "betray":
      return playerError(order.target) ?? betrayError(game, player, order.target);
    case "embargo":
      return playerError(order.target) ?? embargoError(game, player, order.target, order.on);
    case "warship":
      return tileError(game, order.port) ?? warshipError(game, player, order.port);
    case "patrol":
      if (!Number.isSafeInteger(order.ship)) return "invalid ship id";
      return patrolError(game, player, order.ship, order.tile);
    case "missile":
      if (!Number.isSafeInteger(order.size)) return "unknown missile size";
      return tileError(game, order.target) ?? missileError(game, player, order.target, order.size);
    case "gift":
      return (
        playerError(order.target) ?? giftError(game, player, order.target, order.troops, order.gold)
      );
    case "quick":
      return playerError(order.target) ?? quickError(game, player, order.target, order.phrase);
    case "work":
      return workError(game, order.share);
  }
}

function playerError(id: number): string | undefined {
  return Number.isSafeInteger(id) ? undefined : DiplomacyError.Player;
}

function tileError(game: Game, tile: number): string | undefined {
  if (!Number.isInteger(tile) || tile < 0 || tile >= game.terrain.topology.size) {
    return "the tile is outside the map";
  }
  if (!game.terrain.isOwnable(tile)) return "the tile cannot be owned";
  return undefined;
}
