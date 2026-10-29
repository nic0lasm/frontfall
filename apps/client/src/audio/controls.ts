import { getLanguage, onLanguageChange, type Language } from "../i18n/index.ts";
import { h } from "../ui/dom.ts";
import { soundSettings, updateSound } from "./settings.ts";

/** These texts travel with the audio code, so the first visit does not carry them. */
const TEXTS: Record<Language, { mute: string; volume: string; music: string }> = {
  en: { mute: "Mute all sound", volume: "Sound effects volume", music: "Music volume" },
  fr: {
    mute: "Couper tout le son",
    volume: "Volume des effets sonores",
    music: "Volume de la musique",
  },
};

/** The mute switch and the two volume sliders, for the Accessibility panel. */
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

  const music = h("input", {
    type: "range",
    id: "music-volume",
    min: "0",
    max: "100",
    step: "5",
  });
  music.value = String(soundSettings().music);
  music.addEventListener("change", () => {
    updateSound({ music: Number(music.value) });
  });
  const musicText = h("label", { for: "music-volume" });

  const words = (): void => {
    const texts = TEXTS[getLanguage()];
    muteText.textContent = texts.mute;
    volumeText.textContent = texts.volume;
    musicText.textContent = texts.music;
  };
  words();
  onLanguageChange(words);

  return [
    h("label", { class: "toggle", for: "sound-muted" }, muted, muteText),
    h("div", { class: "field" }, volumeText, volume),
    h("div", { class: "field" }, musicText, music),
  ];
}
