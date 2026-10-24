# Client

The browser client lives in [`apps/client`](../apps/client). This document
covers the conventions that are not obvious from the code.

## How a solo game runs

```text
 page                                    worker (game/sim.worker.ts)
 ----                                    ---------------------------
 Menu ── setup ──> GameScreen            SoloGame
                    │  click(tile, ratio) ──>  orderForClick ─> turn ──> Game
                    │                          bots decide inside the tick
                    │  <── update every tick:  changed tiles, players, attacks
                    ├─ Renderer (render/)  draws owners from a mirror array
                    ├─ FlatCamera          screen <-> tile, pan and zoom
                    ├─ InputController     pointer, wheel, pinch, keys
                    └─ Hud, dialogs        plain HTML over the canvas
```

- The simulation runs in a Web Worker at `B-TICK-RATE`, so a slow tick never
  drops a frame. Updates are posted with their buffers transferred, never
  shared: the page needs no cross-origin isolation headers.
- The page sends clicks, not orders. The worker holds the game and decides
  what a click means: a start during the spawn phase, then an expansion or an
  attack with the attack ratio. The same `GameSession` carries an online
  game, where the orders go to the server instead (below).
- Bots are installed in the engine (`installBots`) and decide during the tick,
  from the game state and its seed, so every client of an online game
  computes the same moves.
- Only `apps/client/src/render` imports Three.js, which a test checks. The
  interface talks to the two contracts of ADR 0003, never to Three.js:
  `Renderer` (`render/renderer.ts`: player colours, changed tiles, ships, a
  frame for a camera view) and `Camera` (`render/camera.ts`: screen to tile
  and back, pan, zoom, focus, with east-west wrapping). `createRenderer`
  returns the flat `MapView` today; the globe will implement the same
  contract with its own camera. The issue that set them out named the
  renderer's calls `init`, `applyUpdates` and `frame`: they became the
  constructor, `markChanged` and `setShips`, and `render(view)`, because the
  page, not the renderer, holds the game state.
- The menu lists the maps of `maps/index.json`, the World first, then small
  generated test maps (`game/maps.ts`), reduced to their largest landmass. The
  worker downloads a published map and checks it against its manifest
  (`loadMap` of the engine) before the game starts, then hands the page a copy
  of the terrain to draw. Without a catalogue, only the generated maps remain.
- The setup lives in the query string (`?map=pangaea&bots=8&difficulty=hard`),
  so a link starts the same game, and the last one is remembered in
  `localStorage` when storage is available.

## Playing online

The menu offers the next public game, a new private game, and the public
games waiting for players (`/api/games`, fetched every 3 seconds while the
menu shows). The lobby (`ui/lobby.ts`) shows who is in, the countdown of a
public game, and for a private one its invitation link, `?game=<id>`, with a
Copy button; only the host sees "Start the game". The address bar holds the
link while the player waits, so a reload joins again. The lobby also says
when the page is outdated (with a Reload button), when a game expired before
it started or ended for another reason, and why a request was refused.

```text
 page                                          worker
 ----                                          ------
 OnlineClient (net/online.ts) ── turns ──> GameScreen.pushTurns ─> SoloGame.playTurns
      ^                                         │                       │
      └─── orders, hashes ── ServerLink <───────┴── click → order ──────┘
```

Once the server sends `started`, the page builds the same game as every
other client: the map, the seed, the humans in the server's numbering,
and `bots` bots of the game's difficulty numbered after them. The host of a
private game picks the map, bots and difficulty in the lobby (`configure`),
starting from the menu's choices; maps come from the published catalogue
only, grouped like the menu's "World maps" and "Quick games" (`group` in
`maps/index.json`, generated maps counting as quick), and only those that
seat the players already in, and bots stop at 25 or at the map's most players less the players in (empty seats shrink to make room),
whichever is lower. The other players see the settings as one line. The worker has no
clock of its own: it runs each turn the server relays, every player's orders
in it, and a batch of turns at once after a rejoin. The page holds the turns
back in a jitter buffer (`game/turn-pacer.ts`): turn n plays at n ticks of
the clock plus the largest delay among the last 30 turns, so bunched
arrivals still come out one per tick; a backlog of more than 4 turns plays
at once. A solo game goes down the same path: each tick, its orders become
the turn a server would have sent. A click becomes an order
the page sends to the server; it takes effect when its turn comes back.
After every 50th tick the worker hashes the game state and the page reports
it, so the server can tell a client out of step (`desync`). The worker keeps
every turn with orders and every hash it sent; on a desync the notice offers
"Download a report", a `DesyncReport` (docs/engine.md) that
`pnpm sim -- --replay` plays again to find the first tick that differs. Games
on generated maps have no report. Until its turn comes back, an online
order's ring pulses on its target. Once a game starts, the tab keeps its seat token in session storage and the
URL becomes `?game=<id>`: a reload sends `rejoin` from tick 0, replays every
turn at once and plays on; leaving from the menu gives the seat up. An online game never pauses, and its HUD
has no pause button.

## Drawing the map

The territory layer draws the whole map in one draw call (ADR 0003):

- The ground colour of every tile is computed once when the map loads
  (`render/terrain-colors.ts`): sea from the continental shelf to the deep,
  land from lowlands to rock, shaded by the slope between neighbours, light
  from the north-west. The alpha channel marks the sides of water tiles that
  touch land, where the shader draws the surf line.
- Each frame, the shader reads the owner of the tile and its four
  neighbours: the fill lets the relief show through, a light rim of constant
  width on screen marks borders, and the fill thickens when zoomed out so
  small countries stay visible.
- A tile that changes hands fades in over 150 ms, from the time it changed:
  a front moves smoothly instead of jumping once a tick.
- Names and troops sit on the deepest tile of each country, found by a
  distance transform in the worker every half second
  (`game/label-anchors.ts`), and as large as the land around that tile allows.
- A frame is drawn only when the camera moved, tiles changed or are still
  fading, or ships are at sea.

## Beta

Until 1.0, the menu and the HUD show a beta badge with the version of the
client (`apps/client/package.json`), and the menu says that rules, balance and
visuals will still change. Vite passes the version to the page
(`src/release.ts`); the badge disappears by itself once the version reaches
1.0.0.

## Controls

| Input                                         | Action                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Click or tap                                  | Pick a start, then expand or attack                                                      |
| Click a coast over water                      | Send a ship with the attack ratio of the troops                                          |
| Drag, one finger                              | Move the map                                                                             |
| Wheel, pinch, `+` and `-`                     | Zoom, towards the cursor or between the fingers                                          |
| Arrows or `WASD`                              | Move the map, at the same speed at any frame rate                                        |
| `1` to `9`, `0`                               | Attack with 10 % to 90 % of the troops, `0` for all                                      |
| `C`, `F`, `X`                                 | Build a city, build a fort, demolish: then click your land; the next click attacks again |
| Right click, long press, or a leaderboard row | Open that player's menu: ask for an alliance, accept, renew or betray                    |
| `Esc`                                         | Close the player menu, or leave a build mode                                             |
| `P` or `Esc`                                  | Pause and resume                                                                         |
| `H` or `?`                                    | Show the controls                                                                        |

The build panel above the toolbar (a row of icons under the stats on phones and short windows) has the same three modes as buttons, with the cost of the next city and fort, and the cities owned against the most the land supports (`R-BUILD-07`). Structures are drawn as light diamonds (cities) and triangles (forts) on a dark outline, greyed while being built.

The player menu opens at the foot of the leaderboard (`R-DIPLO`). It says whether the player is an ally and for how long, and offers the one order that fits: ask, accept their request, renew in the last minute of an alliance, or betray, which asks for a second click. Requests to the player wait under the banner with a bar that empties until they run out; Ignore hides one without an answer. Allies are marked in the leaderboard and their land has a dashed white rim, drawn by the territory shader from a flag in its palette. Traitors carry a badge while the mark lasts, and a feed under the stats tells every player who allied, whose alliance ended and who betrayed whom, in a polite live region. A click that would attack an ally is refused and says to betray first. A long press opens the menu only for a finger or a pen held still for 500 ms; a mouse uses its right button.

While attacks are under way, a panel at the bottom left lists each one, its
target and its troops, with a Retreat button that calls it back
(`R-ATTACK-06`): the troops come home, less `B-RETREAT-PENALTY`, which the
button's tooltip states.

`Esc` also closes a dialog: on the end screen it does what "Keep watching"
does, and the menu button of the HUD stays the way out.

A click on land the player cannot reach by land sends a transport ship when
it is a coast within sailing range, from the player's nearest coast. A click
that sends nothing (water, own land, too few troops, out of reach, every ship
at sea) gets a red ring and one line saying why; one that sends an order gets
a ring of its own. A press that moves more than 6 pixels is a drag, never a
click. WASD is read by
physical key, so it stays under the same fingers on AZERTY keyboards. The page
itself never zooms or scrolls during a game (`user-scalable=no`, `touch-action:
none`): a pinch must reach the map, not the browser.

## Translations

Every text the player can read comes from a catalogue in
[`apps/client/src/i18n`](../apps/client/src/i18n): `en.json` is the reference,
`fr.json` and any later language must have exactly the same keys. The language
is taken from the browser's preferences (French for any `fr` variant, English
otherwise) until the player picks one, and the choice is kept in
`localStorage`. Changing it with `setLanguage` updates the page in place,
without a reload.

Keys are flat and grouped by screen, such as `status.connecting`. Messages use
named placeholders in braces:

```ts
import { plural, t } from "./i18n/index.ts";

t("status.connected", { player: "p3" }); // "Connected as p3"
plural("lobby.players", 4); // "4 players", the count is also {count}
```

Static text in `index.html` is marked instead of written in code:
`data-i18n="key"` sets the element's text and
`data-i18n-attr="aria-label:key;title:key"` sets attributes, with placeholder
values, if any, as a JSON object in `data-i18n-params`. The English text
stays in the HTML so the page reads correctly before the script runs.
`applyTranslations` fills them, and the client calls it again whenever the
language changes. Code that writes text itself should listen with
`onLanguageChange` and write it again.

### Adding a message

1. Add the key and its English text to `en.json`.
2. Add the same key, with the same placeholders, to every other catalogue.
3. Use it with `t("your.key")`; the key type comes from `en.json`, so a typo
   does not compile.

For a message that depends on a number, add one key per plural category of
the language, `your.key.one` and `your.key.other` for English and French, and
call `plural("your.key", count)`. A category a catalogue lacks falls back to
`other`.

### Adding a language

1. Copy `en.json` to `<code>.json`, where `<code>` is the primary language
   subtag (`de`, `es`, …), and translate the values.
2. Import it and add it to `CATALOGUES` in `i18n/index.ts`, and add its
   native name to `LANGUAGES` for the language menu.

The tests in `apps/client/test/i18n.test.ts` check that every catalogue has the
English keys and placeholders, and that no source file outside `i18n/` writes
literal text into the page. The menu has a language picker; it calls
`setLanguage`.
