import type { GameRules } from "../../game/messages.ts";
import type { GameUpdate } from "../../game/game-view.ts";
import type { MapLandmarkData } from "../../game/maps.ts";
import { EventsFeed, type FeedTarget } from "../events-feed.ts";
import { FeedWatcher, landLost, type LandLost } from "../feed-events.ts";
import { PlayerTip, type ShipRef } from "../player-tip.ts";

export { facts } from "../player-tip.ts";

/**
 * The event feed and the player card of a game screen, fetched when a game
 * starts so the first visit does not carry them. Until they are here the
 * screen shows neither.
 */
export class FeedHost {
  private readonly feed: EventsFeed;
  private readonly watcher: FeedWatcher;
  private readonly tip: PlayerTip;
  private readonly untrack: () => void;

  constructor(
    hud: HTMLElement,
    game: HTMLElement,
    surface: HTMLElement,
    private readonly ownerAt: (tile: number) => number,
    /** False in a replay, where nobody is the player. */
    personal: boolean,
    go: (target: FeedTarget) => void,
    landmarks: readonly MapLandmarkData[] = [],
  ) {
    this.watcher = new FeedWatcher(personal, landmarks);
    this.feed = new EventsFeed(
      go,
      window.matchMedia("(width < 720px)"),
      window.matchMedia("(height < 560px)"),
    );
    this.tip = new PlayerTip((id) => this.watcher.alliesOf(id), ownerAt);
    hud.append(this.feed.element);
    game.append(this.tip.element);
    this.untrack = this.tip.track(surface);
  }

  setRules(rules: GameRules): void {
    this.tip.setRules(rules);
  }

  /** What `update` takes from the player: read before the map takes the update in. */
  lost(update: GameUpdate): LandLost {
    return landLost(update, this.ownerAt);
  }

  /** Shows what `update` brings, as the screen shows it, once the map has taken it in. */
  observe(update: GameUpdate, lost: LandLost, now: number): void {
    this.tip.update(update);
    for (const entry of this.watcher.observe(update, lost, this.ownerAt))
      this.feed.push(entry, now);
  }

  /**
   * The first steps own the top left while they show there, as a card: the
   * feed goes under them.
   */
  clearOf(guide: DOMRect | undefined): void {
    const card = guide !== undefined && guide.height > 0 && guide.left < 40 && guide.width < 340;
    this.feed.below(card && guide.top < window.innerHeight / 2 ? guide : undefined);
  }

  /** The pointer is over the land of `owner`, 0 for none. */
  over(owner: number): void {
    this.tip.over(owner);
  }

  /** The pointer is over `landmark`, undefined for none (R-LAND-02). */
  overLandmark(landmark: MapLandmarkData | undefined): void {
    this.tip.overLandmark(landmark);
  }

  /** The pointer is over `ship`, undefined for none. */
  overShip(ship: ShipRef | undefined): void {
    this.tip.overShip(ship);
  }

  /** The pointer is over the fallout around `zone`, undefined for none. */
  overFallout(zone: number | undefined): void {
    this.tip.overFallout(zone);
  }

  /** A long press on the fallout around `zone`, at (x, y) on screen. */
  pinFallout(zone: number, x: number, y: number): void {
    this.tip.pinFallout(zone, x, y);
  }

  /** A long press on `ship`, at (x, y) on screen. */
  pinShip(ship: ShipRef, x: number, y: number): void {
    this.tip.pinShip(ship, x, y);
  }

  /** A long press on `landmark`, at (x, y) on screen. */
  pinLandmark(landmark: MapLandmarkData, x: number, y: number): void {
    this.tip.pin(landmark, x, y);
  }

  expire(now: number): void {
    this.feed.expire(now);
  }

  refresh(): void {
    this.feed.refresh();
  }

  dispose(): void {
    this.untrack();
    this.feed.dispose();
    this.feed.element.remove();
    this.tip.element.remove();
  }
}
