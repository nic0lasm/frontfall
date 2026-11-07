import type { GameRecord } from "@frontfall/engine";
import type { GameUpdate } from "../../game/game-runner.ts";
import type { SessionCapabilities } from "../../game/session.ts";
import type { GameRules } from "../../game/messages.ts";
import { getLanguage, t, type MessageKey } from "../../i18n/index.ts";
import type { MapLandmarkData } from "../../maps.ts";
import { safeStorage } from "../../storage.ts";
import type { GameTracker } from "../../usage.ts";
// The end screen loads while the game starts, out of the first download.
import type { endScreen, GameSummary } from "../end-screen.ts";
import { chaptersDone, markChapter, setGuideDone } from "../guide-state.ts";
import type { HelpOptions } from "../help.ts";
import type { GuideHost } from "./guide-host.ts";
import type { Overlays } from "./overlays.ts";

/** Where the dialogs of a game lead. */
export interface DialogActions {
  onNewGame(): void;
  onMenu(): void;
  /** The tutorial is over and the player wants a real game: the one their menu is set to. */
  onRealGame?(): void;
  /** The player asked for a record of the game, to save. */
  onRecord?(record: GameRecord): void;
}

export interface DialogHostOptions {
  readonly overlays: Overlays;
  readonly can: SessionCapabilities;
  /** The practice game: the help's guide restarts its core steps. */
  readonly tutorial: boolean;
  readonly actions: DialogActions;
  readonly guide: GuideHost;
  /** The choices of the pace, shown under the pause banner. */
  readonly paceChoices: () => HTMLElement | undefined;
  /** For the help: the game as it stands, its rules and its landmarks, with who holds each. */
  readonly latest: () => GameUpdate | undefined;
  readonly rules: () => GameRules | undefined;
  readonly landmarks: () => readonly MapLandmarkData[];
  readonly ownerAt: (tile: number) => number;
  /** A finger rather than a mouse: the help shows gestures instead of keys. */
  readonly touch: () => boolean;
  /** What the end screen says of the game decided by `update`. */
  readonly summary: (update: GameUpdate) => GameSummary;
  readonly record: () => Promise<GameRecord | undefined>;
  readonly tracker: GameTracker | undefined;
  /** The screen was left: a dialog fetched too late shows nothing. */
  readonly disposed: () => boolean;
}

/**
 * The dialogs over a game: the pause, the tutorial's introduction and its
 * end, the help, the end screen, and the question before leaving. A game
 * that can pause stops behind each; an online game runs on for everyone.
 */
export class DialogHost {
  /** The end screen's code, once fetched. */
  private endScreen: typeof endScreen | undefined;
  /** The game ended and its end screen is on its way: the pause holds until it shows. */
  private ending = false;

  constructor(private readonly o: DialogHostOptions) {}

  /** Fetches the end screen while the game starts; failing here only leaves showEnd to try again. */
  preload(): void {
    import("../end-screen.ts").then(
      (module) => {
        this.endScreen = module.endScreen;
      },
      () => undefined,
    );
  }

  togglePause(): void {
    const { overlays } = this.o;
    if (this.ending) return;
    if (!this.o.can.canPause) {
      // An online game runs for everyone: Esc only closes what is open.
      if (overlays.open) overlays.close();
      return;
    }
    if (overlays.paused) {
      overlays.close();
      return;
    }
    overlays.showPause(this.o.paceChoices());
  }

  /** Back to the menu; asks first while the player still has a game to lose. */
  leave(playing: boolean): void {
    if (playing && !window.confirm(t("hud.leaveConfirm"))) return;
    this.o.actions.onMenu();
  }

  /** Before the practice game: three lines on what the game is, with the clock stopped until the player starts. */
  showIntro(): void {
    void import("../tutorial-dialogs.ts").then(({ introDialog }) => {
      if (this.o.disposed() || this.ending) return;
      const { overlays } = this.o;
      overlays.pause();
      overlays.show(
        introDialog(
          () => {
            overlays.close();
          },
          () => {
            this.o.actions.onMenu();
          },
        ),
      );
    });
  }

  /** After the last step of the tutorial: five rules, and the way to a real game. */
  showOutro(): void {
    void import("../tutorial-dialogs.ts").then(({ outroDialog }) => {
      if (this.o.disposed() || this.ending) return;
      const { overlays, actions } = this.o;
      overlays.pause();
      overlays.show(
        outroDialog(
          chaptersDone(safeStorage()),
          (chapter) => {
            overlays.close();
            void import("../guide.ts").then(({ CHAPTERS }) => {
              this.o.guide.start(CHAPTERS[chapter], () => {
                markChapter(safeStorage(), chapter);
                this.showOutro();
              });
            });
          },
          () => {
            (actions.onRealGame ?? actions.onMenu)();
          },
          () => {
            overlays.close();
          },
        ),
      );
    });
  }

  showHelp(): void {
    void import("../help.ts").then(({ helpPanel }) => {
      if (this.ending) return;
      const { overlays, can } = this.o;
      if (can.canPause) overlays.pause();
      overlays.show(
        helpPanel({
          ...this.helpFacts(),
          online: !can.canPause,
          onClose: () => {
            overlays.close();
          },
          onGuide: can.guided
            ? () => {
                setGuideDone(safeStorage(), false);
                overlays.close();
                this.o.guide.start(this.o.tutorial ? "bases" : "first");
              }
            : undefined,
        }),
      );
    });
  }

  /** What the help says of this game: the costs, what it leaves out, who holds each landmark. */
  private helpFacts(): Omit<HelpOptions, "online" | "onClose" | "onGuide"> {
    const latest = this.o.latest();
    const rules = this.o.rules();
    return {
      build: latest?.build,
      disabled: rules?.disabled ?? 0,
      capitals: rules?.special.capitals ?? false,
      landmarks: this.o.landmarks().map((landmark) => {
        const holder = this.o.ownerAt(landmark.tile);
        const name = latest?.players.find((p) => p.id === holder)?.name ?? "";
        return {
          name: landmark.name[getLanguage()],
          effect: t(`tip.landmark.${landmark.effect}` as MessageKey),
          holder:
            holder === 0
              ? t("tip.landmarkFree")
              : holder === latest?.you
                ? t("tip.landmarkYours")
                : t("tip.landmarkHeld", { name }),
        };
      }),
      touch: this.o.touch(),
    };
  }

  /** The game is decided: its end screen, at once if its code is here. */
  showEnd(update: GameUpdate): void {
    // A solo game waits behind the end screen, so its record ends where the game did.
    if (this.o.can.canPause) this.o.overlays.pause();
    // Fetched long before, unless the game ended within moments of its start.
    if (this.endScreen) {
      this.openEnd(this.endScreen, update);
      return;
    }
    this.ending = true;
    import("../end-screen.ts").then(
      (module) => {
        this.ending = false;
        this.openEnd(module.endScreen, update);
      },
      (error: unknown) => {
        // No end screen to show: the game goes on rather than stay frozen.
        console.error(error);
        this.ending = false;
        this.o.overlays.close();
      },
    );
  }

  private openEnd(screen: typeof endScreen, update: GameUpdate): void {
    const { overlays, actions } = this.o;
    overlays.show(
      screen(this.o.summary(update), this.o.tracker, {
        onNewGame: () => {
          actions.onNewGame();
        },
        onMenu: () => {
          actions.onMenu();
        },
        onWatch: () => {
          overlays.close();
        },
        onDownload: () => {
          void this.o.record().then((record) => {
            if (record) actions.onRecord?.(record);
          });
        },
      }),
    );
  }
}
