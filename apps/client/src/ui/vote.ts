import type { FeedbackReason } from "@frontfall/protocol";
import { applyTranslations, type MessageKey } from "../i18n/index.ts";
import type { GameTracker } from "../usage.ts";
import { h } from "../dom.ts";
import { feedbackLinks } from "./feedback.ts";

const REASONS: readonly FeedbackReason[] = ["too_hard", "too_long", "unclear", "slow_or_buggy"];

const SVG = "http://www.w3.org/2000/svg";

/** A hand-drawn thumb, up or down, in the colour of the text. */
function thumb(up: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "thumb");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute(
    "d",
    "M2 10h4v11H2zM8 21V10l4-7c1.7 0 2.8 1.2 2.4 3L14 10h5.4c1.6 0 2.7 1.5 2.3 3l-1.8 6.6c-.3 1.3-1.4 2.4-2.8 2.4z",
  );
  if (!up) path.setAttribute("transform", "rotate(180 12 12)");
  svg.append(path);
  return svg;
}

/**
 * A thumbs up or down on the game just played, counted without saying who
 * gave it; a thumbs down may add one reason from a fixed list.
 */
export function feedbackBlock(tracker: GameTracker, details: string): HTMLElement {
  const question = h("p", { class: "feedback-question", "data-i18n": "feedback.question" });
  const thanks = h("p", { class: "feedback-thanks", "data-i18n": "feedback.thanks", hidden: true });
  const button = (key: MessageKey, mark: SVGSVGElement, onClick: () => void): HTMLButtonElement => {
    const element = h(
      "button",
      { type: "button", class: "secondary", "data-i18n-attr": `aria-label:${key}` },
      mark,
    );
    element.addEventListener("click", onClick);
    return element;
  };
  const reasons = h("div", { class: "feedback-reasons", hidden: true });
  const thumbs = h("div", { class: "feedback-thumbs" });
  const done = (): void => {
    thumbs.hidden = true;
    reasons.hidden = true;
    question.hidden = true;
    thanks.hidden = false;
  };
  const send = (vote: "up" | "down", reason?: FeedbackReason): void => {
    tracker.vote(vote, reason);
    done();
  };
  thumbs.append(
    button("feedback.up", thumb(true), () => {
      send("up");
    }),
    button("feedback.down", thumb(false), () => {
      thumbs.hidden = true;
      question.dataset.i18n = "feedback.why";
      applyTranslations(block);
      reasons.hidden = false;
      reasons.querySelector("button")?.focus();
    }),
  );
  for (const reason of REASONS) {
    const choice = h("button", {
      type: "button",
      class: "secondary",
      "data-i18n": `feedback.reason.${reason}`,
    });
    choice.addEventListener("click", () => {
      send("down", reason);
    });
    reasons.append(choice);
  }
  const plain = h("button", { type: "button", class: "link", "data-i18n": "feedback.noReason" });
  plain.addEventListener("click", () => {
    send("down");
  });
  reasons.append(plain);
  const block = h(
    "div",
    { class: "feedback", id: "feedback" },
    question,
    thumbs,
    reasons,
    thanks,
    feedbackLinks(details),
  );
  applyTranslations(block);
  return block;
}
