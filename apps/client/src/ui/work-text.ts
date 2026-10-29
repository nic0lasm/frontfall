import { getLanguage, type Language } from "../i18n/index.ts";

/**
 * Texts of the work share and the attack preview (R-ECO-07). They sit here
 * rather than in the catalogues because the HUD is loaded when a game starts:
 * in the catalogues they would weigh on the first download
 * (bench/client/budget.json).
 */
const TEXTS: Record<Language, Record<string, string>> = {
  en: {
    work: "Workers",
    attackHint: "Share of your soldiers sent by each attack. Workers stay home.",
    attackValue: "{share} of your soldiers, {troops} troops sent",
    workValue: "{share} of your troops work, {rate} gold a second more",
    workHint:
      "Share of your troops at home who work: {factor} times the gold of a soldier, but they neither attack nor defend.",
    goldRate: "+{rate}/s",
    goldRateHint: "Gold you earn each second: the base income and your troops; trade comes on top.",
    previewTiles: "≈ {count} tiles",
    previewTile: "≈ {count} tile",
    previewSend: "{troops} soldiers, {cost} a tile",
    previewGain: "+{cap} troops of room",
    previewShort: "too few soldiers",
    previewAll: "all of their land",
  },
  fr: {
    work: "Ouvriers",
    attackHint: "Part de vos soldats envoyée à chaque attaque. Les ouvriers restent chez vous.",
    attackValue: "{share} de vos soldats, {troops} troupes envoyées",
    workValue: "{share} de vos troupes travaillent, {rate} d'or par seconde en plus",
    workHint:
      "Part de vos troupes à la maison qui travaillent : {factor} fois l'or d'un soldat, mais elles n'attaquent ni ne défendent.",
    goldRate: "+{rate}/s",
    goldRateHint:
      "L'or que vous gagnez chaque seconde : le revenu de base et vos troupes, commerce en plus.",
    previewTiles: "≈ {count} cases",
    previewTile: "≈ {count} case",
    previewSend: "{troops} soldats, {cost} par case",
    previewGain: "+{cap} de plafond",
    previewShort: "trop peu de soldats",
    previewAll: "toutes ses terres",
  },
};

/** A text of the work share or the preview in the current language, with `{name}` placeholders filled. */
export function workText(
  key: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return (TEXTS[getLanguage()][key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
