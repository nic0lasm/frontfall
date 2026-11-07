# Guide du playtest

Pour ceux qui jouent à Frontfall et nous aident à trouver ce que les tests ne voient pas : un écran confus, un appareil lent, une partie qui semble injuste. Cinq séances d'environ 30 minutes apprennent beaucoup. Rien à installer : un navigateur récent suffit.

Le playtest se joue sur le jeu lui-même, [nclsmgr.com/frontfall/](https://nclsmgr.com/frontfall/), et au besoin sur la préversion, [nclsmgr.com/frontfall-next/](https://nclsmgr.com/frontfall-next/). Dites laquelle vous avez jouée. La version anglaise de ce guide, [playtest.md](playtest.md), fait foi.

## Avant de commencer

- Jouez sur l'appareil que vous utilisez d'habitude, téléphone compris. Ne lisez pas les règles avant : savoir jusqu'où un nouveau joueur va seul est la première chose à apprendre.
- Pour mesurer la vitesse sur un téléphone ou un ordinateur, ajoutez `?perf` à l'adresse du jeu : un petit rapport apparaît, à copier dans vos notes.
- Prenez des notes en jouant, avec vos mots : ce que vous avez essayé, ce que vous attendiez, ce qui s'est passé. Une capture ou une courte vidéo vaut mieux qu'une longue description.

## À essayer

Chaque séance a un but. Faites-les dans l'ordre que vous voulez et arrêtez-vous quand vous êtes fatigué : une partie laissée en route nous apprend aussi quelque chose.

| Séance | À faire                                                                                                         | Ce que nous voulons savoir                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1      | Faire le tutoriel depuis le menu, sans aide.                                                                    | Où un nouveau joueur bloque, et si les cinq minutes suffisent.                     |
| 2      | Une partie solo contre des bots, sur la carte de votre choix, à la difficulté qui vous semble juste.            | Si la difficulté est bonne, et si une partie donne envie d'aller au bout.          |
| 3      | Une partie publique, ou privée avec des amis : rejoindre par le salon, jouer jusqu'à la fin ou jusqu'au départ. | Clarté du salon, latence, ce qui se passe quand quelqu'un part, utilité de la fin. |
| 4      | La même chose sur un téléphone ou une tablette, tenus dans les deux sens.                                       | Si les commandes tiennent sous le doigt et si l'écran garde l'essentiel.           |
| 5      | Une longue partie (une heure ou plus) avec ports, commerce, alliances et quelques bâtiments.                    | Rythme en fin de partie, encombrement de la carte, fluidité, ce que vous arrêtez.  |

À essayer dans toute séance : changer de langue, activer le contraste élevé ou une interface plus grande, jouer au clavier, recharger la page en pleine partie, quitter une partie et y revenir, laisser une partie aller jusqu'à son terme.

## Comment répondre

- **Quelque chose est cassé ou semble faux :** ouvrez un [rapport de bug](https://github.com/nic0lasm/frontfall/issues/new?template=bug.yml) avec les étapes, votre navigateur et votre système, et une capture. Les liens de l'écran de fin et du menu ouvrent le même formulaire avec la version déjà remplie.
- **Une idée, une impression, une question :** écrivez-la dans la discussion « Playtest » des [Discussions](https://github.com/nic0lasm/frontfall/discussions). Un court message par séance suffit : quelle séance, sur quoi vous avez joué, ce qui vous a plu, ce qui a gâché, ce que vous changeriez en premier.
- **Après une partie**, le jeu demande si vous avez aimé et, après un pouce vers le bas, ce qui a le plus gâché. Un toucher suffit : la réponse ne porte ni nom ni texte libre (voir [privacy.md](privacy.md)).

Un compte GitHub n'est pas nécessaire pour jouer, mais il l'est pour ouvrir un rapport ou écrire dans les Discussions. Sans compte, envoyez vos notes à la personne qui vous a invité : elle les publiera.

## Les trois questions

Quelle que soit la séance, répondez à ces trois questions dans votre message, une ligne chacune :

1. **Aviez-vous envie de relancer une partie tout de suite ?** Oui, peut-être ou non, et pourquoi.
2. **Quel a été le premier moment où vous ne saviez plus quoi faire, ou n'avez plus compris l'écran ?** Un moment et un endroit du jeu suffisent.
3. **Si vous pouviez changer une seule chose avant la 1.0, laquelle ?**

Tout le reste est le bienvenu, mais ce sont ces trois réponses que le bilan compte.

## Mesurer un playtest

Le seul chiffre qui compte est le nombre de parties jouées jusqu'au bout. Le jeu le compte déjà, sans nom ni cookie (voir [privacy.md](privacy.md)) : une partie est **terminée** quand elle s'achève sur l'écran de fin, gagnée ou perdue, et **abandonnée** quand le joueur retourne au menu, ferme l'onglet ou perd la connexion. Depuis le dépôt :

```sh
bun run playtest-report 2026-11-04   # parties comptées à partir de ce jour (UTC)
bun run playtest-report              # depuis le début du comptage
```

La commande lit `https://nclsmgr.com/frontfall/api/stats` (`FRONTFALL_URL` pour un autre serveur) et affiche, par mode, les parties jouées, terminées et abandonnées, la part terminée, les parties quittées en moins de deux minutes et les pouces. Avant le playtest de la 1.0, toutes versions confondues, 28 parties sur 54 étaient terminées (52 %) : 26 sur 44 en solo, 1 sur 8 en privé. Un bon résultat pour la 1.0 : plus de 60 % des parties solo terminées, sans hausse des parties quittées en moins de deux minutes.

Les compteurs ne distinguent pas les testeurs des autres joueurs : on lit donc le bilan sur les jours du playtest, à côté des notes de la discussion.

## Ce qu'il advient des retours

Le mainteneur lit chaque retour et résume les cinq séances dans la discussion : ce qui a été vu, combien de fois, ce qui a été décidé. Chaque point qui demande un changement devient une issue, rangée dans la version qu'il bloque : un problème qui empêche de jouer ou de comprendre va dans la prochaine version, le reste passe après. Un retour avec les étapes pour le reproduire se corrige plus vite, et un retour d'un téléphone ou d'un vieux navigateur vaut plus qu'un cinquième retour d'un ordinateur rapide.

Merci d'avoir joué.
