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
      "Share of your troops at home who work: the more of your population cap works, the more gold, up to {percent} % more than the base income; workers neither attack nor defend.",
    goldRate: "+{rate}/s",
    goldRateHint:
      "Gold you earn each second: the base income, more for your workers; trade comes on top.",
    whyGold: "Not enough gold: {gap} short.",
    whyCityLimit: "No room for another city on your land yet.",
    whyWonder: "You have built this wonder already: one each.",
    whyLoad: "No silo is loaded yet.",
    whyPort: "A finished port is needed first.",
    statTroops:
      "Troops at home: {troops} of {cap}, a cap that land and cities raise. {soldiers} can fight, {workers} work. They grow by {growth} a second.",
    statGold:
      "Gold: +{rate} a second, {base} of base income and {workers} from workers. Trade routes and landmarks come on top.",
    statLand:
      "Land: {share} of the map, {tiles} tiles. More land raises your troop cap; the game is won at {win}.",
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
      "Part de vos troupes à la maison qui travaillent : plus votre plafond de population travaille, plus vous gagnez d'or, jusqu'à {percent} % de plus que le revenu de base ; les ouvriers n'attaquent ni ne défendent.",
    goldRate: "+{rate}/s",
    goldRateHint:
      "L'or que vous gagnez chaque seconde : le revenu de base, plus pour vos ouvriers ; commerce en plus.",
    whyGold: "Pas assez d'or : il en manque {gap}.",
    whyCityLimit: "Plus de place pour une ville sur vos terres pour l'instant.",
    whyWonder: "Vous avez déjà bâti cette merveille : une seule chacun.",
    whyLoad: "Aucun silo n'est encore chargé.",
    whyPort: "Il faut d'abord un port terminé.",
    statTroops:
      "Troupes à la maison : {troops} sur {cap}, un plafond que les terres et les villes relèvent. {soldiers} peuvent se battre, {workers} travaillent. Elles augmentent de {growth} par seconde.",
    statGold:
      "Or : +{rate} par seconde, dont {base} de revenu de base et {workers} grâce aux ouvriers. Routes commerciales et sites remarquables en plus.",
    statLand:
      "Terres : {share} de la carte, {tiles} cases. Plus de terres relèvent votre plafond de troupes ; la partie se gagne à {win}.",
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
