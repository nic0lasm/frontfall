# In-game screen layout

Who may draw where on the map screen, so that every element added to the game finds its place without moving another. It extends the Interface section of [`art-direction.md`](art-direction.md): same panels, same radii, same tokens. Anything new on screen takes a zone from this page, or the page is changed first.

Sizes are in CSS pixels. The code is `apps/client/src/ui/hud.ts` (markup), `ui/game.css` (the layout, loaded when a game starts) and `styles.css` (a few base rules).

## Three layouts, one rule each

| Layout | When                            | What changes                                                                                                                |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Wide   | width ≥ 1240 and height ≥ 560   | Figures, attack share and buildings form one bar at the foot of the map.                                                    |
| Medium | width 720 to 1239, height ≥ 560 | The same three keep their own places: figures top left, attack share bottom left, buildings in a dock at the bottom centre. |
| Narrow | width < 720, or height < 560    | Figures across the top, buildings in a tray behind a button, leaderboard folded into a chip, first steps as a banner.       |

The widths are those of the screen at the interface size chosen in the menu: at 125 % the wide layout starts at 1550 and at 150 % at 1860, and below that the medium layout is used (the game screen sets `data-wide` on `.game`, and the wide rules hang on it).

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

| Zone       | Position            | Owns                                                                                                                                          | Size and stacking                                                                                                                                    |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TL         | top 12, left 12     | The first-steps guide while it is shown, then the event feed and player cards under it.                                                       | Up to 320 wide. A card never goes under the banner. At most three rows of feed; older rows fade out after 8 s.                                       |
| TC         | top 12, centred     | The banner (one line, 520 wide at most), then answers that are expected from the player (requests) under it at top 60, 380 wide.              | Banner and requests never share a row. The maintenance notice sits above both (top 8, z 20).                                                         |
| TR         | top 12, right 12    | The leaderboard, with the win goal and the clock inside it.                                                                                   | 220 wide, folded to the top rows, one tap opens the list. Nothing else sits in this column above 280; the mini-map does not live here.               |
| BR         | bottom 12, right 12 | The tools: help, pause, speed, menu, round, 40 each, 8 apart. Above them, from bottom 64, the mini-map.                                       | Mini-map up to 200 × 130, same panel as the others. Tools grow to the left, never upward.                                                            |
| Bottom bar | bottom 12, left 12  | Figures, population, attack share with the workers slider under it, and the buildings. In that order, left to right, separated by 1 px rules. | One row, 56 high inside a 6 padding. At 1280 it ends 150 before the tools. A new part of the bar must fit in that gap or replace a part, never wrap. |
| BL         | bottom 96, left 12  | What the bar acts on: the attacks under way and their retreat buttons, the attack preview figures.                                            | 220 wide at most, stacking upward.                                                                                                                   |
| Map        | the rest            | The map and what is drawn on it: pieces, labels, effects, the build preview, the attack arrow.                                                | The left and right middle stay empty on purpose.                                                                                                     |

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

Same zones, except the bottom bar is split: figures top left (TL becomes the feed's second row, at top 96), attack share bottom left (bottom 12), buildings dock bottom centre. TR, TC and BR are as in the wide layout. A new part of the wide bar goes in the zone nearest to its place in the bar. At a larger interface size the dock moves right by 100 px for each extra 100 % so that it clears the attack panel. The build tip sits above whichever of the dock or the bar is there, at `calc(14px + 62px * scale)` (30 + 66 in the wide layout).

## Narrow layout (phone, and windows shorter than 560)

```
+------------------------------+
| figures (troops gold land)   |
|        banner (top 90)       |
|        requests (top 242)    |
|                              |
|        the map               |
|                              |
|  first-steps banner (128)    |
|                [ board chip ]|
| [attack share] [tools: 4-5 ] |
+------------------------------+
```

| Zone          | Rule                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top           | Figures panel top left; banner at top 90 (the figures panel is 82 high with its population line), centred, up to three lines; the threat to a capital uses the same banner in red; requests under it at top 242.                                                                                                                                                                         |
| Bottom bar    | Attack share at the left (right edge 174 from the screen edge, 216 in a solo game, whose tools add speed; 218 and 268 on a touch screen, whose tools are 44 wide; on a touch phone narrower than 480 or shorter than 560 the speed button leaves for the pause banner), the tools at the right (build button first). The build tray opens upward over the bar and closes after a choice. |
| Above the bar | The leaderboard chip bottom right (one line: your colour, name and share, an arrow). The first-steps banner across the width at bottom 128, clear of the chip even at 44 px. Refused-click notes go at the top (top 170), under a three-line banner, never over the bar.                                                                                                                 |
| Events        | Narrow: events borrow the banner. The latest one replaces it for 4 s, over its width, up to three lines, in the same chip; then the banner returns. Requests stay under it. A landscape phone keeps the feed top left, beside the figures, two rows.                                                                                                                                     |
| Never         | More than one row above the bar except the banner; panels wider than the screen minus 24; a control under 36 px that can be touched.                                                                                                                                                                                                                                                     |

Narrow: the mini-map is a round button, 44, top right (bottom right on a short window), and opens as a sheet centred on the map (z 2), at most 40 % of the screen high, 60 % on a short window. It closes after a jump or with its close button.

When the screen is narrow because it is short (landscape phone), the leaderboard stays top right and stops 84 above the bottom so it never runs under the tools, the banner goes under the figures (top 88), and the first-steps banner becomes a short card (text on the left, Hide and Next on the right, 70 px high) that stops 264 short of the right edge, so the closed leaderboard stays whole.

## Common rules of the controls

- **Targets are 44 px**, with a mouse too: the tools, the folded map, the chart tabs, the help's buttons.
- **The attack slider on a phone** has its figures over the rail, so the rail takes the panel's width; a touch screen draws a 28 px thumb and a track filled up to the value (`ui/range-click.ts` sets `--fill`, and reads `--thumb-size` to place a press).
- **A building's kind is not colour alone**: a bar on top of its button (full economy, short defence, dotted weapons, striped demolition). The chosen building is pushed in and ringed in the text colour, with no category tint.
- **A building's bubble** (hover, focus) gives name, keys, price and what it does; there is no native `title`. A finger gets the same text from a long press.
- **The end screen's body scrolls, its buttons never cover it**; what the player earned comes before the chart. **The help's buttons stay in sight** at the foot of the panel.

## Adding an element

1. Pick a zone from the tables, wide first.
2. Say in the change what it replaces or what it displaces; name its narrow behaviour (folds, hides behind a button, or stays).
3. Check three screenshots in the change: wide at 1280 × 800, a phone at 390 × 780 and a landscape phone at 740 × 360, each in a game with the first steps shown and the leaderboard open.
4. Keep the first visit within its budget: HUD code and styles are loaded when a game starts (`ui/game.css`, `ui/game-styles.ts`); only the shell is in the first visit.
5. Update this page when a zone changes hands.

## End screen on a short screen

Under 560 high the panel scrolls as a whole and its buttons (Play again, Keep watching, Main menu) stay stuck to its foot, in one row, so the main action is always in sight.

The three figures (troops, gold, land) have a minimum width that fits a long game's numbers (99.9K, +99.9K/s) and no wrapping, with tabular digits, so the bar does not move while they grow. The wide bar's attack share is a little shorter (204 px) to pay for that reserve.
