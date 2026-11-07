/** A screen of the page: the menu, the name an invitation asks for, a lobby or a game. */
export interface Screen {
  readonly element: HTMLElement;
  dispose(): void;
}

/** The part of the page a screen goes in. */
export interface ScreenRoot {
  prepend(element: HTMLElement): void;
  readonly classList: Pick<DOMTokenList, "toggle">;
}

/**
 * Shows one screen at a time. The screen before is disposed before the
 * next one is made, so that a game gives its WebGL context back before
 * another game asks for one.
 */
export class ScreenHost {
  private shown: Screen | undefined;
  /** Counts the screens asked for, to tell when another one was asked for while one was made. */
  private asked = 0;

  constructor(private readonly root: ScreenRoot) {}

  /** The screen on the page, if any. */
  get current(): Screen | undefined {
    return this.shown;
  }

  /**
   * Disposes the screen shown, makes the next one and puts it first in the
   * page; a game marks the page as `playing`.
   */
  show<S extends Screen>(make: () => S, game = false): S {
    this.clear();
    const asked = ++this.asked;
    const screen = make();
    // Making it failed the game and showed another screen (the menu): that one stays.
    if (asked !== this.asked) {
      screen.dispose();
      return screen;
    }
    this.shown = screen;
    this.root.classList.toggle("playing", game);
    this.root.prepend(screen.element);
    return screen;
  }

  /** Disposes the screen shown, if it is `screen` or none is named. */
  clear(screen?: Screen): void {
    const shown = this.shown;
    if (!shown || (screen && screen !== shown)) return;
    this.shown = undefined;
    shown.dispose();
  }
}
