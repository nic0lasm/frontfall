import type { DesyncReport, Turn } from "@frontfall/engine";
import { TICK_RATE } from "@frontfall/protocol";
import { LocalSession, type ServerLink } from "../game/local-session.ts";
import { TurnPacer } from "../game/turn-pacer.ts";
import type { MapData, MapInfo } from "../game/maps.ts";
import type { ClickOutcome } from "../game/messages.ts";
import type { ClickMode, GameUpdate, SoloOptions } from "../game/solo-game.ts";
import { InputController } from "../input/controller.ts";
import { applyTranslations, onLanguageChange, t, type MessageKey } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import type { CameraView, ViewCamera } from "../render/camera.ts";
import {
  createCamera,
  createRenderer,
  fitsGlobe,
  globeLoaded,
  type Renderer,
  type ViewKind,
} from "../render/renderer.ts";
import { endScreen, helpPanel } from "./end-screen.ts";
import { ClickMarks } from "./click-marks.ts";
import { Hud } from "./hud.ts";
import { PlayerLabels } from "./labels.ts";

/** Matches the fade of the territory layer, with a frame to spare. */
const FADE_MS = 200;

/** How often the turns of an online game are checked for being due. */
const PACER_MS = 10;

/** Size of a tile on screen once the view closes in on the player's start. */
const START_TILE_PIXELS = 6;

export interface GameScreenActions {
  onNewGame(): void;
  onMenu(): void;
  /** The game could not start; the key names the message to show. */
  onFailure(key: MessageKey): void;
}

/**
 * One game on screen: the map, the input that drives the camera and sends
 * orders, the HUD, and the dialogs on top. Owns everything it creates and
 * releases it in dispose().
 */
export class GameScreen {
  readonly element: HTMLElement;
  private owners = new Uint16Array(0);
  private camera: ViewCamera;
  private readonly surface: HTMLElement;
  private view: Renderer | undefined;
  private input: InputController;
  private readonly hud: Hud;
  private readonly session: LocalSession;
  private readonly cleanups: (() => void)[] = [];
  private latest: GameUpdate | undefined;
  private overlay: HTMLElement | undefined;
  private paused = false;
  private ended = false;
  private focused = false;
  private ticksPerSecond = 10;
  private ownableTiles = 1;
  private peakTiles = 0;
  private frameHandle = 0;
  private readonly marks = new ClickMarks();
  private previousShips = new Map<number, number>();
  private updatedAt = 0;
  /** Something to draw that the camera alone does not show. */
  private dirty = true;
  private drawnView: CameraView | undefined;
  private wrapsX = true;
  private readonly labels = new PlayerLabels();
  /** Online: evens out the arrival of the server's turns before the worker plays them. */
  private readonly pacer: TurnPacer;
  /** Tiles that changed hands fade in until then: frames are drawn until it passes. */
  private fadingUntil = 0;
  /** What a click on the map does, picked in the HUD. */
  private mode: ClickMode = "attack";
  /** Build mode of the last click sent, picked again if the click is refused. */
  private modeSent: ClickMode | undefined;
  /** The structures last drawn, as a key that changes when any of them does. */
  private drawnStructures = "";
  /** Flat map or globe; G switches when the globe was asked for and the map allows it. */
  private viewKind: ViewKind;
  private readonly globeAllowed: boolean;
  private readonly mapSize: { readonly width: number; readonly height: number };
  /** What the renderer is made from, kept to make another one when the view switches. */
  private shown: { map: MapData; you: number; maxPlayer: number } | undefined;

  constructor(
    readonly options: SoloOptions,
    map: MapInfo,
    private readonly actions: GameScreenActions,
    /** Online: the connection the game's orders go to; the game then never pauses. */
    private readonly link?: ServerLink,
    /** The view to start with; "globe" also lets G switch views (a prototype, ADR 0005). */
    view: ViewKind = "flat",
  ) {
    this.globeAllowed = view === "globe" && fitsGlobe(map) && globeLoaded();
    this.viewKind = this.globeAllowed ? "globe" : "flat";
    this.mapSize = { width: map.width, height: map.height };
    this.camera = createCamera(map, this.viewKind);
    // Input listens on a layer of its own under the HUD, so clicks on panels never reach the map.
    this.surface = document.createElement("div");
    this.surface.className = "map-surface";
    this.surface.id = "map";
    this.surface.setAttribute("role", "application");
    this.surface.dataset.i18nAttr = "aria-label:game.map";
    this.surface.setAttribute("aria-label", t("game.map"));
    this.surface.setAttribute("aria-busy", "true");

    this.hud = new Hud(
      {
        onPause: () => {
          this.togglePause();
        },
        onHelp: () => {
          this.showHelp();
        },
        onMenu: () => {
          this.leave();
        },
        onRetreat: (attack) => {
          this.retreat(attack);
        },
        onMode: (mode) => {
          this.setMode(mode);
        },
      },
      { pausable: link === undefined },
    );
    this.element = document.createElement("div");
    this.element.className = "game";
    this.element.append(
      this.surface,
      this.labels.element,
      this.marks.element,
      this.hud.element,
      this.marks.note,
    );

    this.input = this.createInput();

    this.session = new LocalSession(
      options,
      map,
      {
        onStart: (info) => {
          this.showMap(info.map, info.you, info.maxPlayer);
          this.ticksPerSecond = info.rules.ticksPerSecond;
          this.ownableTiles = info.rules.ownableTiles;
          this.hud.setRules(info.rules);
        },
        onUpdate: (update) => {
          this.apply(update);
        },
        onClick: (tile, outcome) => {
          this.marks.show(tile, outcome, performance.now(), link !== undefined);
          this.afterBuildClick(outcome);
        },
        onError: (message) => {
          console.error(message);
          this.actions.onFailure("game.failed");
        },
      },
      link,
    );

    const keydown = (event: KeyboardEvent): void => {
      this.key(event);
    };
    window.addEventListener("keydown", keydown);
    const resize = (): void => {
      this.resize();
    };
    window.addEventListener("resize", resize);
    this.pacer = new TurnPacer((turns) => {
      this.session.pushTurns(turns);
      const mine = turns.reduce(
        (count, turn) => count + turn.orders.filter((entry) => entry.player === options.you).length,
        0,
      );
      if (mine > 0) this.marks.arrived(mine, performance.now());
    }, 1000 / TICK_RATE);
    if (link) {
      // A timer rather than frames: a hidden tab draws nothing but must keep playing.
      const pacing = setInterval(() => {
        this.pacer.update(performance.now());
      }, PACER_MS);
      this.cleanups.push(() => {
        clearInterval(pacing);
      });
    }
    this.cleanups.push(
      () => {
        window.removeEventListener("keydown", keydown);
      },
      () => {
        window.removeEventListener("resize", resize);
      },
      onLanguageChange(() => {
        applyTranslations(this.surface);
        this.hud.refresh();
      }),
    );
  }

  /** Call once the element is in the page, so sizes are known. */
  start(): void {
    this.resize();
    let last = performance.now();
    const frame = (now: number): void => {
      this.input.update(now - last);
      last = now;
      // A frame is drawn only when something on the map changed: the GPU
      // idles while nothing moves, during a pause above all.
      const view = this.camera.view();
      const moved = !sameView(view, this.drawnView);
      const sailing = (this.latest?.boats.length ?? 0) > 0;
      const fading = now < this.fadingUntil;
      if (this.view && (moved || this.dirty || sailing || fading)) {
        this.placeShips(now);
        this.view.render(view);
        this.drawnView = view;
        // Ships still glide after their last tick: one more frame to settle them.
        this.dirty = sailing;
      }
      this.labels.place(this.camera, this.camera.scale);
      this.marks.place(this.camera, now);
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.session.dispose();
    this.input.dispose();
    this.view?.dispose();
    this.element.remove();
  }

  private createInput(): InputController {
    return new InputController(this.surface, this.camera, {
      onTileClick: (tile) => {
        this.click(tile);
      },
    });
  }

  private showMap(map: MapData, you: number, maxPlayer: number): void {
    this.owners = new Uint16Array(map.width * map.height);
    this.wrapsX = map.wrapsX;
    this.shown = { map, you, maxPlayer };
    this.mountRenderer();
  }

  /** Makes the renderer of the current kind over the owners array, already filled or not. */
  private mountRenderer(): Renderer | undefined {
    if (!this.shown) return undefined;
    const { map, you, maxPlayer } = this.shown;
    let view: Renderer;
    try {
      view = createRenderer(
        {
          width: map.width,
          height: map.height,
          kinds: map.kinds,
          wrapsX: map.wrapsX,
          relief: map.relief,
          owners: this.owners,
          maxOwner: maxPlayer,
        },
        this.viewKind,
      );
    } catch (error) {
      // Most likely the WebGL context, lost or refused after the check of the menu.
      console.error(error);
      this.actions.onFailure("webgl.missing");
      return undefined;
    }
    for (let id = 1; id <= maxPlayer; id++) {
      view.setPlayerColor(id, playerColor(id - 1).hex);
    }
    view.setHighlight(you);
    view.canvas.classList.add("map-canvas");
    this.surface.append(view.canvas);
    this.surface.removeAttribute("aria-busy");
    this.view = view;
    this.dirty = true;
    this.drawnView = undefined;
    this.resize();
    return view;
  }

  /**
   * Flat map to globe and back in a running game: a new camera over the same
   * tile and zoom, a new renderer over the same owners array, and the input
   * wired to the new camera.
   */
  private switchView(): void {
    if (!this.globeAllowed) return;
    const { centerX, centerY } = this.camera.view();
    const { width, height } = this.mapSize;
    const centre = Math.min(height - 1, Math.floor(centerY)) * width + Math.floor(centerX);
    const zoom = this.camera.zoom;
    this.viewKind = this.viewKind === "globe" ? "flat" : "globe";
    this.camera = createCamera({ width, height, wrapsX: this.wrapsX }, this.viewKind);
    this.camera.resize(window.innerWidth, window.innerHeight);
    this.camera.focus(centre, zoom);
    this.input.dispose();
    this.input = this.createInput();
    if (!this.view) return;
    this.view.dispose();
    this.view = undefined;
    // The owners are already there to draw.
    this.mountRenderer()?.markAllChanged();
    this.drawnStructures = "";
    if (this.latest) this.placeStructures(this.latest);
  }

  /**
   * Ships glide from where they were on the previous tick to where they are
   * now, over one tick, instead of jumping B-BOAT-SPEED tiles at a time.
   */
  private placeShips(now: number): void {
    const view = this.view;
    const ships = this.latest?.boats;
    if (!view || !ships) return;
    const { width } = this.mapSize;
    const progress = Math.min(1, (now - this.updatedAt) / (1000 / this.ticksPerSecond));
    view.setShips(
      ships.map((ship) => {
        const to = ship.tile;
        const from = this.previousShips.get(ship.id) ?? to;
        const fromX = from % width;
        const toX = to % width;
        // The short way across the seam of a wrapping map.
        let dx = toX - fromX;
        if (this.wrapsX && Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
        const fromY = Math.floor(from / width);
        const toY = Math.floor(to / width);
        return {
          x: fromX + dx * progress,
          y: fromY + (toY - fromY) * progress,
          color: playerColor(ship.player - 1).hex,
        };
      }),
    );
  }

  private resize(): void {
    this.dirty = true;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.view?.resize(width, height);
    this.camera.resize(width, height);
  }

  private apply(update: GameUpdate): void {
    this.previousShips = new Map((this.latest?.boats ?? []).map((ship) => [ship.id, ship.tile]));
    this.updatedAt = performance.now();
    if (update.owners) {
      this.owners.set(update.owners);
      this.view?.markAllChanged();
      this.dirty = true;
    } else if (update.changedTiles.length > 0) {
      const { changedTiles, changedOwners } = update;
      for (let i = 0; i < changedTiles.length; i++) {
        this.owners[changedTiles[i] as number] = changedOwners[i] as number;
      }
      this.view?.markChanged(changedTiles);
      this.dirty = true;
      this.fadingUntil = performance.now() + FADE_MS;
    }
    const human = update.players.find((player) => player.id === update.you);
    if (human) this.peakTiles = Math.max(this.peakTiles, human.tiles);
    if (!this.focused && human && human.tiles > 0) {
      // Once, when the player's start appears, picked or placed by the game:
      // on a large map it is a few pixels wide at the zoom that shows it all.
      this.focused = true;
      const start = this.owners.indexOf(update.you);
      const zoom = (START_TILE_PIXELS * this.mapSize.height) / this.camera.viewportHeight;
      if (start >= 0) this.camera.focus(start, Math.max(this.camera.zoom, zoom));
    }
    this.placeStructures(update);
    this.latest = update;
    this.labels.update(update.players, update.labels);
    this.hud.update(update, performance.now());
    // The panels grow and shrink with their content: measured once per update.
    this.labels.avoid(
      [...this.hud.element.children]
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.width > 0),
    );
    if (update.winner !== undefined && !this.ended) {
      this.ended = true;
      this.hud.update(update, performance.now(), true);
      this.showEnd(update);
    }
  }

  private click(tile: number): void {
    const update = this.latest;
    if (!update || this.paused || update.winner !== undefined) return;
    this.session.click(tile, this.hud.ratio, this.mode);
    // One structure per pick of the button: the next click attacks again,
    // unless the worker refuses this one (afterBuildClick).
    if (this.mode !== "attack") {
      const sent = this.mode;
      this.setMode("attack");
      this.modeSent = sent;
    }
  }

  /** A refused build gives its mode back, if the player has not picked another since. */
  private afterBuildClick(outcome: ClickOutcome): void {
    const sent = this.modeSent;
    this.modeSent = undefined;
    if (!sent || outcome === "build" || outcome === "demolish") return;
    if (this.mode === "attack") this.setMode(sent);
  }

  /** Picking the current mode again goes back to attacking. */
  private setMode(mode: ClickMode): void {
    this.modeSent = undefined;
    this.mode = mode === this.mode ? "attack" : mode;
    this.hud.setMode(this.mode);
    this.surface.dataset.mode = this.mode;
  }

  /** Structures change rarely: they are drawn again only when one appears, finishes or changes hands. */
  private placeStructures(update: GameUpdate): void {
    const key = update.structures
      .map((s) => `${String(s.id)}:${String(s.player)}:${s.ready ? "1" : "0"}`)
      .join(",");
    if (!this.view || key === this.drawnStructures) return;
    this.drawnStructures = key;
    const { width } = this.mapSize;
    this.view.setStructures(
      update.structures.map((structure) => ({
        x: structure.tile % width,
        y: Math.floor(structure.tile / width),
        type: structure.type,
        ready: structure.ready,
      })),
    );
    this.dirty = true;
  }

  private retreat(attack: number): void {
    const update = this.latest;
    if (!update || this.paused || update.winner !== undefined) return;
    this.session.sendOrder({ type: "retreat", attack });
  }

  private key(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement && event.target.type === "text") return;
    if (event.code === "Escape" && this.overlay) {
      this.closeOverlay();
      event.preventDefault();
      return;
    }
    // Esc first drops a build mode, before it pauses the game.
    if (event.code === "Escape" && this.mode !== "attack") {
      this.setMode("attack");
      event.preventDefault();
      return;
    }
    const modes: Partial<Record<string, ClickMode>> = {
      KeyC: "city",
      KeyF: "fort",
      KeyX: "demolish",
    };
    const mode = modes[event.code];
    if (mode) {
      this.setMode(mode);
      event.preventDefault();
      return;
    }
    if (event.code.startsWith("Digit")) {
      const digit = Number(event.code.slice(5));
      this.hud.setRatio(digit === 0 ? 100 : digit * 10);
      event.preventDefault();
    } else if (event.code === "KeyP" || event.code === "Escape") {
      this.togglePause();
      event.preventDefault();
    } else if (event.code === "KeyG" && this.globeAllowed) {
      this.switchView();
      event.preventDefault();
    } else if (event.code === "KeyH" || event.key === "?") {
      this.showHelp();
      event.preventDefault();
    }
  }

  /** Back to the menu; asks first while the player still has a game to lose. */
  private leave(): void {
    const latest = this.latest;
    const human = latest?.players.find((player) => player.id === latest.you);
    const playing = !this.ended && human?.alive === true && human.tiles > 0;
    if (playing && !window.confirm(t("hud.leaveConfirm"))) return;
    this.actions.onMenu();
  }

  /** Online: the server flagged this client's state hash after `tick`. */
  desync(tick: number, expected: number | null): void {
    this.session.desync(tick, expected);
  }

  /** Online: the game so far as a desync report, or none on a generated map. */
  desyncReport(): Promise<DesyncReport | undefined> {
    return this.session.report();
  }

  /** Online: turns relayed by the server, in order. */
  pushTurns(turns: Turn[]): void {
    this.pacer.push(turns, performance.now());
    this.pacer.update(performance.now());
  }

  private togglePause(): void {
    if (this.link) {
      // An online game runs for everyone: Esc only closes what is open.
      if (this.overlay) this.closeOverlay();
      return;
    }
    if (this.paused) {
      this.closeOverlay();
      return;
    }
    this.paused = true;
    this.session.setPaused(true);
    const banner = document.createElement("div");
    banner.className = "overlay paused";
    const text = document.createElement("p");
    text.className = "paused-text";
    text.textContent = t("hud.paused");
    banner.append(text);
    banner.addEventListener("click", () => {
      this.closeOverlay();
    });
    this.showOverlay(banner);
  }

  private showHelp(): void {
    if (!this.link) {
      this.paused = true;
      this.session.setPaused(true);
    }
    this.showOverlay(
      helpPanel(() => {
        this.closeOverlay();
      }),
    );
  }

  private showOverlay(element: HTMLElement): void {
    this.overlay?.remove();
    this.overlay = element;
    this.element.append(element);
    element.querySelector<HTMLElement>("button")?.focus();
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = undefined;
    if (this.paused) {
      this.paused = false;
      this.session.setPaused(false);
    }
    this.surface.focus();
  }

  private showEnd(update: GameUpdate): void {
    this.showOverlay(
      endScreen(
        {
          update,
          ticksPerSecond: this.ticksPerSecond,
          ownableTiles: this.ownableTiles,
          peakTiles: this.peakTiles,
        },
        {
          onNewGame: () => {
            this.actions.onNewGame();
          },
          onMenu: () => {
            this.actions.onMenu();
          },
          onWatch: () => {
            this.overlay?.remove();
            this.overlay = undefined;
          },
        },
      ),
    );
  }
}

function sameView(a: CameraView, b: CameraView | undefined): boolean {
  return (
    b !== undefined &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.halfWidth === b.halfWidth &&
    a.halfHeight === b.halfHeight
  );
}
