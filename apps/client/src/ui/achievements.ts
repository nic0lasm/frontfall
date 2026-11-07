import { safeStorage } from "../storage.ts";
import { CATALOGUE, badgeLevel } from "../achievements/catalog.ts";
import { badge } from "./achievement-badge.ts";
import { AchievementStore } from "../achievements/store.ts";
import { applyTranslations, t, type MessageKey } from "../i18n/index.ts";
import { h } from "../dom.ts";

/** How many achievements the player has earned, for the menu's button. */
export function earnedCount(): number {
  return new AchievementStore(safeStorage()).load().earned.size;
}

/**
 * The page of achievements, opened from the menu: every one with its badge,
 * earned ones lit and dated, the others grey with what they ask for.
 */
export function achievementsPanel(onClose: () => void): HTMLElement {
  const { earned, counts } = new AchievementStore(safeStorage()).load();
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const close = h("button", {
    type: "button",
    class: "secondary",
    "data-i18n": "achievements.close",
  });
  close.addEventListener("click", onClose);

  const dialog = h(
    "section",
    {
      class: "achievements",
      id: "achievements",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "achievements-title",
    },
    h("h1", { id: "achievements-title", "data-i18n": "achievements.title" }),
    h(
      "p",
      { class: "achievements-count", id: "achievements-count" },
      t("achievements.count", { earned: earned.size, total: CATALOGUE.length }),
    ),
    h(
      "ul",
      { class: "achievement-list" },
      ...CATALOGUE.map((achievement) => {
        const { id, counter, tiers } = achievement;
        const entry = earned.get(id);
        const level = entry ? badgeLevel(achievement, entry.level) : 0;
        const count = counter ? counts[counter] : 0;
        const next = tiers?.find((goal) => count < goal);
        return h(
          "li",
          {
            class: entry === undefined ? "locked" : "earned",
            "data-achievement": id,
            "data-level": String(level),
          },
          badge(id, level),
          h(
            "span",
            {},
            h("strong", { "data-i18n": `achievement.${id}.name` as MessageKey }),
            h("small", { "data-i18n": `achievement.${id}.text` as MessageKey }),
            entry === undefined
              ? h("em", { "data-i18n": "achievements.locked" })
              : h("em", {}, t("achievements.earnedOn", { date: date.format(entry.at) })),
            ...(tiers
              ? [
                  h(
                    "em",
                    { class: "progress" },
                    next === undefined
                      ? t("achievements.tiersDone", { count })
                      : t("achievements.progress", { count, next }),
                  ),
                ]
              : []),
          ),
        );
      }),
    ),
    close,
  );
  applyTranslations(dialog);
  const overlay = h("div", { class: "overlay" }, dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) onClose();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") onClose();
  });
  return overlay;
}
