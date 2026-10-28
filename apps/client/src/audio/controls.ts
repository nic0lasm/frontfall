import { getLanguage, onLanguageChange, type Language } from "../i18n/index.ts";
import { h } from "../ui/dom.ts";
import { soundSettings, updateSound } from "./settings.ts";

/** These texts travel with the audio code, so the first visit does not carry them. */
const TEXTS: Record<Language, { mute: string; volume: string }> = {
  en: { mute: "Mute sound effects", volume: "Sound effects volume" },
  fr: { mute: "Couper les effets sonores", volume: "Volume des effets sonores" },
};

/** The mute switch and the volume slider, for the Accessibility panel. */
export function soundPanel(): HTMLElement[] {
  const muted = h("input", { type: "checkbox", id: "sound-muted" });
  muted.checked = soundSettings().muted;
  muted.addEventListener("change", () => {
    updateSound({ muted: muted.checked });
  });
  const muteText = h("span");

  const volume = h("input", {
    type: "range",
    id: "sound-volume",
    min: "0",
    max: "100",
    step: "10",
  });
  volume.value = String(soundSettings().volume);
  volume.addEventListener("change", () => {
    updateSound({ volume: Number(volume.value) });
  });
  const volumeText = h("label", { for: "sound-volume" });

  const words = (): void => {
    const texts = TEXTS[getLanguage()];
    muteText.textContent = texts.mute;
    volumeText.textContent = texts.volume;
  };
  words();
  onLanguageChange(words);

  return [
    h("label", { class: "toggle", for: "sound-muted" }, muted, muteText),
    h("div", { class: "field" }, volumeText, volume),
  ];
}
