import { ReportReason } from "@frontfall/protocol";
import { getLanguage, type Language } from "../i18n/index.ts";
import { h } from "../dom.ts";
import "./report-panel.css";

/**
 * The reasons of a report (R-MODE-06), loaded when a player first opens
 * them: in the catalogues their texts would weigh on the first download
 * (bench/client/budget.json).
 */
const TEXTS: Record<Language, Record<"note" | "refused" | ReportReason, string>> = {
  en: {
    refused: "You have sent many reports lately. Try again in a few minutes.",
    note: "Why? The operator of this server reads reports; the player is not told.",
    abuse: "Insults or harassment",
    name: "Offensive name",
    cheating: "Cheating",
    other: "Something else",
  },
  fr: {
    refused:
      "Vous avez envoyé beaucoup de signalements récemment. Réessayez dans quelques minutes.",
    note: "Pour quelle raison ? L’opérateur de ce serveur lit les signalements ; le joueur n’est pas prévenu.",
    abuse: "Insultes ou harcèlement",
    name: "Nom choquant",
    cheating: "Triche",
    other: "Autre chose",
  },
};

/** Says the server turned down a report: too many came from this address lately. */
export function reportRefused(): HTMLElement {
  return h("p", { class: "report-note", role: "alert" }, TEXTS[getLanguage()].refused);
}

/** One button per reason, under a note on who reads reports; a click calls `pick`. */
export function reportReasons(label: string, pick: (reason: ReportReason) => void): HTMLElement {
  const texts = TEXTS[getLanguage()];
  return h(
    "div",
    { class: "report-reasons", role: "group", "aria-label": label },
    h("p", { class: "report-note" }, texts.note),
    ...ReportReason.options.map((reason) => {
      const button = h(
        "button",
        { type: "button", class: "report-reason", "data-kind": `report-${reason}` },
        texts[reason],
      );
      button.addEventListener("click", () => {
        pick(reason);
      });
      return button;
    }),
  );
}
