# In-game screen layout

Who may draw where on the map screen, so that every element added to the game finds its place without moving another. It extends the Interface section of [`art-direction.md`](art-direction.md): same panels, same radii, same tokens. Anything new on screen takes a zone from this page, or the page is changed first.

Sizes are in CSS pixels. The code is `apps/client/src/ui/hud.ts` (markup), `ui/game.css` (the layout, loaded when a game starts) and `styles.css` (a few base rules).

## Three layouts, one rule each

| Layout | When                            | What changes                                                                                                                |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Wide   | width ≥ 1240 and height ≥ 560   | Figures, attack share and buildings form one bar at the foot of the map.                                                    |
| Medium | width 720 to 1239, height ≥ 560 | The same three keep their own places: figures top left, attack share bottom left, buildings in a dock at the bottom centre. |
| Narrow | width < 720, or height < 560    | Figures across the top, buildings in a tray behind a button, leaderboard folded into a chip, first steps as a banner.       |

A new element is designed for the wide layout first, then given its narrow behaviour in the same change. Medium follows narrow's collapsing rules for anything that does not fit.

## Zones, wide layout

```
+--------------------------------------------------------------+
| TL  event feed          TC  banner / requests      TR  board |
|     (guide first)                                    + clock |
|                                                       + room |
|                                                              |
|                  the map: nothing but the map                |
|                                                              |
|  BL  attacks under way                      BR  mini-map     |
|  [ bottom bar: figures | attack share | buildings ]  [tools] |
+--------------------------------------------------------------+
```

| Zone       | Position            | Owns                                                                                                                             | Size and stacking                                                                                                                                    |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TL         | top 12, left 12     | The first-steps guide while it is shown, then the event feed and player cards under it.                                          | Up to 320 wide. A card never goes under the banner. At most three rows of feed; older rows fade out after 8 s.                                       |
| TC         | top 12, centred     | The banner (one line, 520 wide at most), then answers that are expected from the player (requests) under it at top 60, 380 wide. | Banner and requests never share a row. The maintenance notice sits above both (top 8, z 20).                                                         |
| TR         | top 12, right 12    | The leaderboard, with the win goal and the clock inside it.                                                                      | 220 wide, folded to the top rows, one tap opens the list. Nothing else sits in this column above 280; the mini-map does not live here.               |
| BR         | bottom 12, right 12 | The tools: help, pause, speed, menu, round, 40 each, 8 apart. Above them, from bottom 64, the mini-map.                          | Mini-map up to 200 × 130, same panel as the others. Tools grow to the left, never upward.                                                            |
| Bottom bar | bottom 12, left 12  | Figures, population, attack share, and the buildings. In that order, left to right, separated by 1 px rules.                     | One row, 56 high inside a 6 padding. At 1280 it ends 150 before the tools. A new part of the bar must fit in that gap or replace a part, never wrap. |
| BL         | bottom 96, left 12  | What the bar acts on: the attacks under way and their retreat buttons, the attack preview figures.                               | 220 wide at most, stacking upward.                                                                                                                   |
| Map        | the rest            | The map and what is drawn on it: pieces, labels, effects, the build preview, the attack arrow.                                   | The left and right middle stay empty on purpose.                                                                                                     |

Rules that hold everywhere:

1. **Four corners and the bar.** A new element goes in a zone it fits; if none does, it replaces something or folds into an existing panel. No new floating panels.
2. **Panels, not boxes.** Everything on the HUD is a `panel` (gradient, light edge, shadow, radius 14, 10 for buttons). Only the map is bare.
3. **Pointer events.** The HUD layer passes pointer events through except on panels; a panel never covers more than it draws, so the map stays clickable around it.
4. **Stacking.** Map < HUD panels < tips (z 1) < the player menu and the build tray (z 2) < the end screen and dialogs < the maintenance notice (z 20). Nothing new takes a higher level than a tip without a reason written here.
5. **Text on the map is white with a soft shadow**; text on panels keeps 4.5:1 against the panel.
6. **Numbers are tabular**, prices are warning yellow, ember is for the primary action, the clock bar and the Beta badge only.
7. **Keyboard.** Every control reachable by a key shows the key (kbd, top right of its button, hidden on touch). Slots 1 to 9 and 0 are the build and attack-share keys already documented in the help; a new key goes through [`client.md`](client.md) and the help panel.
8. **Interface size and reduced motion.** Sizes here are at 100 %. The interface size chosen in the menu scales them, so check a new element at 125 % before asking for a merge, and give any motion a static state for the reduced-motion setting.

## Medium layout (720 to 1239)

Same zones, except the bottom bar is split: figures top left (TL becomes the feed's second row, at top 96), attack share bottom left (bottom 12), buildings dock bottom centre. TR, TC and BR are as in the wide layout. A new part of the wide bar goes in the zone nearest to its place in the bar.

## Narrow layout (phone, and windows shorter than 560)

```
+------------------------------+
| figures (troops gold land)   |
|        banner (top 78)       |
|        requests (top 140)    |
|                              |
|        the map               |
|                              |
|  first-steps banner (110)    |
|                [ board chip ]|
| [attack share ] [tools: 4  ] |
+------------------------------+
```

| Zone          | Rule                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top           | Figures panel top left; banner at top 78, centred, up to three lines; requests under it at top 140.                                                                                                          |
| Bottom bar    | Attack share at the left (right edge 174 from the screen edge), the tools at the right (build button first). The build tray opens upward over the bar and closes after a choice.                             |
| Above the bar | The leaderboard chip bottom right (one line: your colour, name and share, an arrow). The first-steps banner across the width at bottom 110. Refused-click notes go at the top (top 140), never over the bar. |
| Never         | More than one row above the bar except the banner; panels wider than the screen minus 24; a control under 36 px that can be touched.                                                                         |

Narrow: the mini-map is a round button, 36, top right (bottom right on a short window), and opens as a sheet centred on the map (z 2), at most 40 % of the screen high, 60 % on a short window. It closes after a jump or with its close button.

When the screen is narrow because it is short (landscape phone), the leaderboard stays top right, the banner goes under it, and the first-steps banner keeps bottom 110.

## Adding an element

1. Pick a zone from the tables, wide first.
2. Say in the change what it replaces or what it displaces; name its narrow behaviour (folds, hides behind a button, or stays).
3. Check three screenshots in the change: wide at 1280 × 800, a phone at 390 × 780 and a landscape phone at 740 × 360, each in a game with the first steps shown and the leaderboard open.
4. Keep the first visit within its budget: HUD code and styles are loaded when a game starts (`ui/game.css`, `ui/game-styles.ts`); only the shell is in the first visit.
5. Update this page when a zone changes hands.
