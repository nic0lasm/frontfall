import "./guide.css";
import { h } from "./dom.ts";
import { tutorialText, type TutorialKey } from "./tutorial-text.ts";

/** A dialog over the game, in the layout of the help: `div.overlay > section.help`. The overlays (ui/screen/overlays.ts) keep the rest inert and focus the primary button. */
function dialog(id: string, title: TutorialKey, ...content: HTMLElement[]): HTMLElement {
  const panel = h(
    "section",
    {
      class: "help tutorial-dialog",
      id,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": `${id}-title`,
    },
    h("h2", { id: `${id}-title` }, tutorialText(title)),
    ...content,
  );
  return h("div", { class: "overlay" }, panel);
}

function button(
  label: TutorialKey,
  kind: "primary" | "secondary",
  onClick: () => void,
): HTMLElement {
  const element = h("button", { type: "button", class: kind }, tutorialText(label));
  element.addEventListener("click", onClick);
  return element;
}

/**
 * Before the practice game: what Frontfall is in three lines, and what the
 * card in the corner will do. The game waits behind it, so a new player
 * reads it with all the time they like.
 */
export function introDialog(onStart: () => void, onLeave: () => void): HTMLElement {
  const point = (lead: TutorialKey, text: TutorialKey): HTMLElement =>
    h("li", {}, h("strong", {}, tutorialText(lead)), tutorialText(text));
  const start = button("intro.start", "primary", onStart);
  const root = dialog(
    "tutorial-intro",
    "intro.title",
    h("p", {}, tutorialText("intro.lead")),
    h(
      "ul",
      { class: "tutorial-points" },
      point("intro.growLead", "intro.grow"),
      point("intro.chooseLead", "intro.choose"),
      point("intro.learnLead", "intro.learn"),
    ),
    h("p", { class: "tutorial-note" }, tutorialText("intro.note")),
    h("div", { class: "tutorial-actions" }, button("intro.leave", "secondary", onLeave), start),
  );
  return root;
}

/** After the last step: five rules to keep, and the way to a real game. */
export function outroDialog(onPlay: () => void, onStay: () => void): HTMLElement {
  const play = button("outro.play", "primary", onPlay);
  const root = dialog(
    "tutorial-outro",
    "outro.title",
    h("p", {}, tutorialText("outro.lead")),
    h(
      "ol",
      { class: "tutorial-rules" },
      ...(["outro.rule1", "outro.rule2", "outro.rule3", "outro.rule4", "outro.rule5"] as const).map(
        (rule) => h("li", {}, tutorialText(rule)),
      ),
    ),
    h("div", { class: "tutorial-actions" }, button("outro.stay", "secondary", onStay), play),
  );
  return root;
}
