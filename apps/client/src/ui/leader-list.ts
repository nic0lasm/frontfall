import type { GameUpdate, PlayerView } from "../game/solo-game.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { h, setText, swatch } from "./dom.ts";

/** The rows of the leaderboard in the HUD. */
export class LeaderList {
  readonly element = h("ol", { class: "leaderboard-list", id: "leaderboard-list" });
  /** Rows by player id, kept across renders so focus stays on a picked row. */
  private readonly rows = new Map<number, LeaderRow>();

  constructor(
    /** A row was picked: the menu of that player. */
    private readonly onPick: (player: number) => void,
  ) {}

  /** Rows are made again on the next render, in new colours for example. */
  clear(): void {
    this.rows.clear();
  }

  /**
   * The leading players, and the player at this screen if lower. Every other
   * player's row is a button that opens their menu; allies and traitors are
   * marked. Rows are reused, so a row with focus keeps it.
   */
  render(
    update: GameUpdate,
    /** Rows listed, besides the player's own. */
    size: number,
    color: (player: number) => string,
    /** The player's share of the land, as shown. */
    share: (tiles: number) => string,
  ): void {
    const { players, you, diplomacy } = update;
    const ranked = players
      .filter((player) => player.alive)
      .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
    const shown = ranked.slice(0, size);
    const humanRank = ranked.findIndex((player) => player.id === you);
    if (humanRank >= size) shown.push(ranked[humanRank] as PlayerView);
    const allies = new Set(diplomacy.allies.map((ally) => ally.id));
    const teammates = new Set(diplomacy.teammates);
    const traitors = new Set(diplomacy.traitors.map((traitor) => traitor.id));
    const atWar = new Set(diplomacy.atWar);
    const embargoed = new Set([...diplomacy.embargoes, ...diplomacy.embargoedBy]);
    const moods = new Map(diplomacy.moods.map((entry) => [entry.id, entry.mood]));
    const rows = shown.map((player) => {
      let row = this.rows.get(player.id);
      if (!row) {
        row = leaderRow(player, player.id === you, color(player.id), this.onPick);
        this.rows.set(player.id, row);
      }
      const rank = ranked.indexOf(player) + 1;
      if (row.item.value !== rank) row.item.value = rank;
      setText(row.name, player.name);
      // The name of the button is what it shows, so that "click Brask" works by voice; what it
      // does is its description. Set here, not once, so it follows a change of language.
      const description = t("diplo.playerMenu", { name: player.name });
      if (row.button?.getAttribute("aria-description") !== description) {
        row.button?.setAttribute("aria-description", description);
      }
      setText(row.land, share(player.tiles));
      const teammate = teammates.has(player.id);
      row.ally.hidden = !teammate && !allies.has(player.id);
      setText(row.ally, t(teammate ? "diplo.teammateBadge" : "diplo.allyBadge"));
      row.traitor.hidden = !traitors.has(player.id);
      // One word for what the player is to you: war, then an embargo, then how a nation feels.
      const status = row.button
        ? atWar.has(player.id)
          ? "war"
          : embargoed.has(player.id)
            ? "embargo"
            : (moods.get(player.id) ?? (teammate || allies.has(player.id) ? "" : "neutral"))
        : "";
      row.status.hidden = status === "";
      row.status.dataset["status"] = status;
      setText(row.status, status === "" ? "" : t(`diplo.status.${status}` as MessageKey));
      return row.item;
    });
    for (const [id, row] of this.rows) {
      if (!shown.some((player) => player.id === id)) {
        row.item.remove();
        this.rows.delete(id);
      }
    }
    const order = [...this.element.children];
    if (rows.length !== order.length || rows.some((row, i) => row !== order[i])) {
      // Moving a row drops its focus: give it back.
      const focused = document.activeElement;
      this.element.replaceChildren(...rows);
      if (focused instanceof HTMLElement && this.element.contains(focused)) focused.focus();
    }
  }
}

interface LeaderRow {
  item: HTMLLIElement;
  name: HTMLElement;
  land: HTMLElement;
  ally: HTMLElement;
  traitor: HTMLElement;
  /** What the player is to the one at this screen: war, embargo, mood or neutral. */
  status: HTMLElement;
  /** Opens the player's menu; none on the row of the player at this screen. */
  button?: HTMLElement;
}

function leaderRow(
  player: PlayerView,
  you: boolean,
  color: string,
  onPick: (player: number) => void,
): LeaderRow {
  const name = h("span", { class: "leader-name" });
  const land = h("span", { class: "leader-land" });
  const ally = h("span", {
    class: "badge badge-ally",
    "data-i18n": "diplo.allyBadge",
    hidden: true,
  });
  const traitor = h("span", {
    class: "badge badge-traitor",
    "data-i18n": "diplo.traitorBadge",
    hidden: true,
  });
  const status = h("span", { class: "badge badge-status", hidden: true });
  ally.textContent = t("diplo.allyBadge");
  traitor.textContent = t("diplo.traitorBadge");
  const content = [swatch(color), name, ally, traitor, status, land];
  if (you) {
    return {
      item: h("li", { class: "leader you" }, ...content),
      name,
      land,
      ally,
      traitor,
      status,
    };
  }
  const button = h(
    "button",
    {
      type: "button",
      class: "leader-button",
      "data-player": player.id,
    },
    ...content,
  );
  button.addEventListener("click", () => {
    onPick(player.id);
  });
  return { item: h("li", { class: "leader" }, button), name, land, ally, traitor, status, button };
}
