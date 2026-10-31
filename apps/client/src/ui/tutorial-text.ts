import { getLanguage, type Language } from "../i18n/index.ts";

/**
 * Texts of the tutorial: its steps, its meter and its two dialogs. They sit
 * here rather than in the catalogues because they load with the guide, the
 * first time it shows: in the catalogues they would weigh on the first
 * download (bench/client/budget.json). Both languages have the same keys and
 * placeholders; apps/client/test/tutorial-text.test.ts checks it.
 *
 * No figure of the balance is written here: what a building costs comes in as
 * a parameter, and the rest is said in words, so that a change to
 * docs/balance.md never leaves the tutorial telling something false.
 */
const EN = {
  // The card
  step: "Step {step}/{count}",
  next: "Next",
  finish: "Finish",
  hide: "Hide the guide",
  meter: "{gold} of {cost} gold",
  meterReady: "Enough gold: go ahead",

  // Step names
  "name.start": "Your start",
  "name.doctrine": "Your doctrine",
  "name.expand": "Grow",
  "name.troops": "Your army",
  "name.work": "Gold",
  "name.citystates": "City-states",
  "name.build": "A city",
  "name.port": "A port",
  "name.defend": "A fort",
  "name.players": "Allies",
  "name.diplomacy": "Diplomacy",
  "name.missiles": "Late game",
  "name.win": "Winning",

  // Step texts, for a mouse and for a finger where the gesture changes
  start:
    "Click any land to place your start. Pick open ground, away from the other colours. You can move it until the countdown ends.",
  startTouch:
    "Tap any land to place your start. Pick open ground, away from the other colours. You can move it until the countdown ends.",
  doctrine:
    "Pick a doctrine on the cards: Conqueror strikes fast, Merchant lives off trade, Bastion holds the line. New here? Bastion forgives mistakes. It cannot change once the game starts.",
  expandWait: "Start placed. When the countdown ends, the game begins.",
  expand:
    "Free land never fights back. Click land next to yours to take it: the more land you hold, the higher your troop cap.",
  expandTouch:
    "Free land never fights back. Tap land next to yours to take it: the more land you hold, the higher your troop cap.",
  troops:
    "This slider sets the share of your troops that each attack sends. The rest stays home and defends you, so never send everything: a third to a half is a good start. Shortcut: Shift + 1 to 0.",
  troopsTouch:
    "This slider sets the share of your troops that each attack sends. The rest stays home and defends you, so never send everything: a third to a half is a good start.",
  work: "Gold comes in on its own. The Workers slider puts troops at home to work: more gold, but workers neither attack nor defend. Raise it while nobody threatens you, lower it when a neighbour attacks.",
  citystates:
    "Small players called city-states sit around the map. They are weak, ally with nobody and keep gold. Attack one: you take its land, and all its gold with its last tile.",
  build:
    "A city raises your troop cap, so you grow faster. Click City (C), then your land. While the gold comes in, keep expanding.",
  buildTouch:
    "A city raises your troop cap, so you grow faster. Tap City, then your land: a second tap places it. While the gold comes in, keep expanding.",
  port: "A port sends trade ships to other players’ ports, and both sides earn gold. Click Port (O), then your coast. To cross water with troops, click a far coast: a boat carries them, no port needed.",
  portTouch:
    "A port sends trade ships to other players’ ports, and both sides earn gold. Tap Port, then your coast. To cross water with troops, tap a far coast: a boat carries them, no port needed.",
  defend:
    "A fort makes the land around it dearer to take: build it behind a front that is attacked. Click Fort (F), then your border.",
  defendTouch:
    "A fort makes the land around it dearer to take: build it behind a front that is attacked. Tap Fort, then your border: a second tap places it.",
  players:
    "An ally cannot attack you: the cheapest defence there is. Right click a neighbour, or click its name in the leaderboard, and ask for an alliance.",
  playersTouch:
    "An ally cannot attack you: the cheapest defence there is. Long press a neighbour, or tap its name in the leaderboard, and ask for an alliance.",
  diplomacy:
    "Allies can send each other troops and gold. An embargo cuts a rival’s trade. Facing a much bigger player, you can pay tribute for a truce. Betray an ally and every player sees a traitor.",
  missiles:
    "Late game: a silo launches missiles that wipe out land, troops and buildings, and leave fallout. An air defense may stop them, and warships guard a coast. They cost a lot: build your economy first.",
  win: "You win by holding {share} of the land, by being the last one standing, or by holding the most land when time runs out. To last: take free land early, keep troops at home, ally a neighbour, fort your front.",

  // Before the game
  "intro.title": "Frontfall in five minutes",
  "intro.lead":
    "You lead a young nation. Grow on free land, build, trade, ally and fight until your colour covers the map.",
  "intro.growLead": "Grow.",
  "intro.grow":
    " Free land never fights back. Your troops multiply on their own, up to a cap that land and cities raise.",
  "intro.chooseLead": "Choose.",
  "intro.choose":
    " A doctrine, how many troops you send, how many work for gold, what to build, who to ally with.",
  "intro.learnLead": "Learn by doing.",
  "intro.learn":
    " A card in the corner gives one task at a time. Skip any of them: nothing blocks you.",
  "intro.note":
    "This practice game is gentle: two easy computer players and a few city-states. It runs at double speed (T changes it, P pauses).",
  "intro.start": "Start",
  "intro.leave": "Back to the menu",

  // After it
  "outro.title": "You know the game",
  "outro.lead":
    "That is all it takes. In a real game the map is bigger and nations play too. Five rules to keep:",
  "outro.rule1": "Take free land first.",
  "outro.rule2": "Keep troops at home: send a third to a half.",
  "outro.rule3": "Cities for growth, forts where you are attacked, ports for gold.",
  "outro.rule4": "Ally your neighbours, and watch the leaderboard for the leader.",
  "outro.rule5": "Save for missiles late in the game.",
  "outro.play": "Play a real game",
  "outro.stay": "Keep playing here",
} as const;

export type TutorialKey = keyof typeof EN;

const FR: Readonly<Record<TutorialKey, string>> = {
  step: "Étape {step}/{count}",
  next: "Suivant",
  finish: "Terminer",
  hide: "Masquer le guide",
  meter: "{gold} sur {cost} d’or",
  meterReady: "Assez d’or : allez-y",

  "name.start": "Votre départ",
  "name.doctrine": "Votre doctrine",
  "name.expand": "Grandir",
  "name.troops": "Votre armée",
  "name.work": "L’or",
  "name.citystates": "Cités-États",
  "name.build": "Une ville",
  "name.port": "Un port",
  "name.defend": "Un fort",
  "name.players": "Alliés",
  "name.diplomacy": "Diplomatie",
  "name.missiles": "Fin de partie",
  "name.win": "Gagner",

  start:
    "Cliquez sur une terre pour poser votre départ. Choisissez de la place libre, loin des autres couleurs. Vous pouvez le déplacer jusqu’à la fin du compte à rebours.",
  startTouch:
    "Touchez une terre pour poser votre départ. Choisissez de la place libre, loin des autres couleurs. Vous pouvez le déplacer jusqu’à la fin du compte à rebours.",
  doctrine:
    "Choisissez une doctrine sur les cartes : le Conquérant frappe vite, le Marchand vit du commerce, le Bastion tient la ligne. Premier jeu ? Le Bastion pardonne les erreurs. Elle ne change plus une fois la partie lancée.",
  expandWait: "Départ posé. À la fin du compte à rebours, la partie commence.",
  expand:
    "La terre libre ne se défend pas. Cliquez sur une terre voisine de la vôtre pour la prendre : plus vous avez de terres, plus votre plafond de troupes monte.",
  expandTouch:
    "La terre libre ne se défend pas. Touchez une terre voisine de la vôtre pour la prendre : plus vous avez de terres, plus votre plafond de troupes monte.",
  troops:
    "Cette glissière fixe la part de vos troupes envoyée à chaque attaque. Le reste garde la maison et vous défend : n’envoyez jamais tout, entre un tiers et la moitié c’est un bon début. Raccourci : Maj + 1 à 0.",
  troopsTouch:
    "Cette glissière fixe la part de vos troupes envoyée à chaque attaque. Le reste garde la maison et vous défend : n’envoyez jamais tout, entre un tiers et la moitié c’est un bon début.",
  work: "L’or arrive tout seul. La glissière Ouvriers met des troupes au travail : plus d’or, mais les ouvriers n’attaquent ni ne défendent. Montez-la tant que personne ne vous menace, baissez-la quand un voisin attaque.",
  citystates:
    "De petits joueurs appelés cités-États sont posés autour de la carte. Faibles, alliés à personne, ils gardent de l’or. Attaquez-en une : vous prenez ses terres, et tout son or avec sa dernière case.",
  build:
    "Une ville augmente votre plafond de troupes : vous grandissez plus vite. Cliquez sur Ville (C), puis sur votre terre. Pendant que l’or arrive, continuez à vous étendre.",
  buildTouch:
    "Une ville augmente votre plafond de troupes : vous grandissez plus vite. Touchez Ville, puis votre terre : un second toucher la pose. Pendant que l’or arrive, continuez à vous étendre.",
  port: "Un port envoie des navires de commerce vers les ports des autres joueurs, et les deux camps gagnent de l’or. Cliquez sur Port (O), puis sur votre côte. Pour traverser l’eau avec des troupes, cliquez sur une côte lointaine : un bateau les porte, sans port.",
  portTouch:
    "Un port envoie des navires de commerce vers les ports des autres joueurs, et les deux camps gagnent de l’or. Touchez Port, puis votre côte. Pour traverser l’eau avec des troupes, touchez une côte lointaine : un bateau les porte, sans port.",
  defend:
    "Un fort rend la terre autour de lui plus chère à prendre : posez-le derrière un front attaqué. Cliquez sur Fort (F), puis sur votre frontière.",
  defendTouch:
    "Un fort rend la terre autour de lui plus chère à prendre : posez-le derrière un front attaqué. Touchez Fort, puis votre frontière : un second toucher le pose.",
  players:
    "Un allié ne peut pas vous attaquer : la défense la moins chère qui soit. Clic droit sur un voisin, ou clic sur son nom dans le classement, puis proposez une alliance.",
  playersTouch:
    "Un allié ne peut pas vous attaquer : la défense la moins chère qui soit. Appui long sur un voisin, ou toucher son nom dans le classement, puis proposez une alliance.",
  diplomacy:
    "Les alliés peuvent s’envoyer des troupes et de l’or. Un embargo coupe le commerce d’un rival. Face à un joueur bien plus grand, vous pouvez payer un tribut pour une trêve. Trahissez un allié et tout le monde voit un traître.",
  missiles:
    "Fin de partie : un silo lance des missiles qui rasent terres, troupes et bâtiments et laissent des retombées. Une défense aérienne peut les arrêter, des navires de guerre gardent une côte. Tout cela coûte cher : bâtissez d’abord votre économie.",
  win: "On gagne en tenant {share} des terres, en restant le dernier debout, ou en tenant le plus de terres quand le temps est écoulé. Pour durer : prenez la terre libre tôt, gardez des troupes à la maison, alliez-vous à un voisin, fortifiez votre front.",

  "intro.title": "Frontfall en cinq minutes",
  "intro.lead":
    "Vous dirigez une jeune nation. Grandissez sur la terre libre, bâtissez, commercez, alliez-vous et combattez jusqu’à ce que votre couleur couvre la carte.",
  "intro.growLead": "Grandir.",
  "intro.grow":
    " La terre libre ne se défend pas. Vos troupes se multiplient seules, jusqu’à un plafond que les terres et les villes relèvent.",
  "intro.chooseLead": "Choisir.",
  "intro.choose":
    " Une doctrine, combien de troupes envoyer, combien travaillent pour l’or, quoi bâtir, avec qui s’allier.",
  "intro.learnLead": "Apprendre en jouant.",
  "intro.learn":
    " Une carte dans le coin donne une tâche à la fois. Passez-en autant que vous voulez : rien ne vous bloque.",
  "intro.note":
    "Cette partie d’entraînement est douce : deux joueurs de l’ordinateur faciles et quelques cités-États. Elle va à double vitesse (T la change, P la met en pause).",
  "intro.start": "Commencer",
  "intro.leave": "Retour au menu",

  "outro.title": "Vous connaissez le jeu",
  "outro.lead":
    "C’est tout ce qu’il faut. Dans une vraie partie, la carte est plus grande et des nations jouent aussi. Cinq règles à garder :",
  "outro.rule1": "Prenez d’abord la terre libre.",
  "outro.rule2": "Gardez des troupes à la maison : envoyez un tiers à la moitié.",
  "outro.rule3": "Des villes pour grandir, des forts où l’on vous attaque, des ports pour l’or.",
  "outro.rule4": "Alliez-vous à vos voisins, et surveillez le classement pour repérer le leader.",
  "outro.rule5": "Gardez de quoi payer des missiles en fin de partie.",
  "outro.play": "Jouer une vraie partie",
  "outro.stay": "Continuer à jouer ici",
};

export const TUTORIAL_TEXTS: Readonly<Record<Language, Readonly<Record<TutorialKey, string>>>> = {
  en: EN,
  fr: FR,
};

/** A text of the tutorial in the current language, with `{name}` placeholders filled. */
export function tutorialText(
  key: TutorialKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return TUTORIAL_TEXTS[getLanguage()][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
