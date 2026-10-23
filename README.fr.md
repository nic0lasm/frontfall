# Frontfall

**Un jeu de stratégie territoriale multijoueur en temps réel, sur un monde sans bord.**

[![CI](https://github.com/nic0lasm/frontfall/actions/workflows/ci.yml/badge.svg)](https://github.com/nic0lasm/frontfall/actions/workflows/ci.yml)
[![CodeQL](https://github.com/nic0lasm/frontfall/actions/workflows/codeql.yml/badge.svg)](https://github.com/nic0lasm/frontfall/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/nic0lasm/frontfall/badge)](https://scorecard.dev/viewer/?uri=github.com/nic0lasm/frontfall)
[![Licence : MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

[English version](README.md)

## En un coup d'œil

|                   |                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **Le jeu**        | Étendre son territoire, dépasser ses voisins, tenir la carte. Dans le navigateur, sans installation.          |
| **La différence** | Le monde boucle d'est en ouest. La phase 2 le pose sur un globe 3D : aucun bord où se cacher.                 |
| **État**          | Début de développement. Les fondations du moteur, le serveur de relais et le rendu de la carte sont en place. |
| **Jouer**         | Serveur public sur `nclsmgr.com/frontfall` dès la première version jouable.                                   |
| **Prérequis**     | Un navigateur compatible WebGL 2.                                                                             |
| **Licence**       | MIT                                                                                                           |

## Feuille de route

- [x] Fondations du moteur déterministe : générateur aléatoire à graine, grille qui boucle d'est en ouest
- [x] Serveur de relais des tours avec lobbies, sonde de santé et arrêt propre
- [x] Vue de la carte en Three.js, défilement est-ouest sans fin
- [ ] Territoires, troupes et attaques
- [ ] Bots, pour qu'une partie reste intéressante à peu de joueurs
- [ ] Cartes générées depuis des données géographiques ouvertes
- [ ] Première version multijoueur publique (v1.0)
- [ ] Phase 2 : le même jeu sur un globe 3D

## Lancer en local

Prérequis : Node.js 22.12 ou plus récent (24 recommandé) et pnpm 10 (`corepack enable` le fournit).

```sh
pnpm install
pnpm dev        # client sur http://localhost:5173, serveur sur :8080
```

| Commande             | Rôle                                                      |
| -------------------- | --------------------------------------------------------- |
| `pnpm test`          | Tests unitaires (Vitest)                                  |
| `pnpm test:coverage` | Tests avec couverture ; la CI échoue sous 90 % des lignes |
| `pnpm lint`          | ESLint avec règles typées                                 |
| `pnpm typecheck`     | TypeScript en mode strict, tous les paquets               |
| `pnpm build`         | Client de production et serveur empaqueté                 |

Avec Docker :

```sh
docker build -t frontfall .
docker run --rm -p 8080:8080 frontfall   # http://localhost:8080
```

## Fonctionnement

Chaque client exécute la même simulation. Le serveur ne calcule jamais la partie : il recueille les ordres des joueurs, les regroupe en tours numérotés dix fois par seconde et envoie les mêmes tours à tous. Des entrées identiques sur un moteur déterministe donnent des parties identiques, pour une fraction de la bande passante.

```
              joueurs (navigateur)
   +-------------------------------------+
   |  apps/client                        |
   |  vue Three.js  +  interface HTML    |
   |          |                          |
   |  packages/engine                    |
   |  simulation déterministe            |
   +------------------|------------------+
                      |  WebSocket : ordres -> tours
   +------------------v------------------+
   |  apps/server  (Node.js)             |
   |  lobbies, relais, fichiers statiques|
   +-------------------------------------+
   packages/protocol : schémas des messages, partagés
```

## Contribuer

Signalements, idées et pull requests sont bienvenus. Le point de départ est [CONTRIBUTING.md](CONTRIBUTING.md) ; questions et idées vont dans les [Discussions](https://github.com/nic0lasm/frontfall/discussions). Les failles de sécurité se signalent en privé, comme décrit dans [SECURITY.md](SECURITY.md).

## Inspiration et crédits

Frontfall est un jeu indépendant, dans la lignée des jeux de conquête territoriale par navigateur comme OpenFront. Il ne partage avec eux ni code, ni assets, ni textes. Voir [CREDITS.md](CREDITS.md) pour les bibliothèques et données utilisées.

## Licence

[MIT](LICENSE) © 2026 Nicolas Maigre
