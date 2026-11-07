# Client

The browser client lives in [`apps/client`](../apps/client). This document
covers the conventions that are not obvious from the code.

## Layers

`apps/client/src` is divided into layers, and `tools/test/boundaries.test.ts`
fails when a file imports a layer it may not (ADR 0013, ADR 0014). A layer may
always import itself.

| Layer                               | May import                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| `app/` and `main.ts` (the app)      | anything                                                          |
| `ui/` (with `ui/screen/`)           | game, render, input, audio, achievements, stats, root; net, types |
| `game/`, `net/`, `render/`          | root                                                              |
| `input/`                            | root; render, types                                               |
| `audio/`, `achievements/`, `stats/` | root; game, types                                                 |
| root files                          | root files and `i18n`                                             |

Every layer may also import `i18n`, the translations, which imports root files
only.

Root files are the ones directly in `src/`: `build`, `palette`, `usage`,
`release`, `compat`, `terrain`, `maps`, `webgl-support`, `dom` (the `h`
element helper), `probe`, `storage` and `signals`. Browser storage is reached only
through `storage.ts`, which answers `undefined` where touching it throws.
The sound settings (`audio/settings.ts`) are the one exception: they read
`localStorage` inside their own `try`, as importing `storage.ts` there would
split it into a chunk of its own that the first visit loads too.
A new folder in `src/` needs a line in the table in the test.

The list of bot levels and the default rules live in `game/defaults.ts`, and
`youOf(update)` in `game/selectors.ts` finds the player a screen plays.

## The app shell

`main.ts` only starts the page: it loads the accessibility settings and
starts `App` (`app/app.ts`). The app holds the page's state, shows one
screen for it and keeps the address bar in step (ADR 0013).

```text
 boot ──> menu ──> playing (solo, tutorial) ──> ended
   │       │  ^         ^                         │
   │       │  └─────────┼──── menu, from anywhere ┘
   │       ├──> watching (a replay)
   │       └──> lobby ──> playing (online) ──> ended ──> lobby (rematch)
   └──> join (an invitation asks for a name) ──> lobby
```

- `app/state.ts` is the table: each state lists the events it answers,
  and `next(state, event)` is a pure function with a unit test. The
  profile, the achievements and the settings are panels of the menu, not
  states; the tutorial is a solo game of its own.
- `app/address.ts` writes each state's address, always a query string
  relative to the page (ADR 0004): the setup for the menu and a solo game,
  `?game=<id>` for a lobby the server named and an online game. The first
  screen keeps the address the page was opened with (the sign-in reads its
  `#signin=` link), and so do the join screen, the tutorial and a replay.
  It also reads the address once, as the page opens: an invitation, `?online`,
  the testing options (`?speed=`, `?minutes=`, `?gold=`, `?cityland=`).
- The view goes in the address while the globe is on: `?view=globe`, or
  `?view=map` once G switched back to the flat map; a reload comes back to
  the view it left. Only an address with one of these turns the globe on:
  nothing about the view is stored, so a page opened without it shows the
  flat map alone, a game taken back included.
- `app/screen-host.ts` shows one screen at a time and disposes the one
  before first, so that a game gives its WebGL context back before the
  next one asks for one. The page's `body` carries `data-screen` with the
  state's name.
- `app/online.ts` follows an online game from the lobby to its end,
  `app/notices.ts` the notices over the screens, and `app/game-code.ts`
  fetches the game screen's code ahead of a game.

## How a solo game runs

```text
 page                                    worker (game/sim.worker.ts)
 ----                                    ---------------------------
 Menu ── setup ──> GameScreen            GameRunner
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
  attack with the attack ratio. The same `GameSession` interface carries an
  online game, where the orders go to the server instead (below), and a
  replay.
- Bots and nations are installed in the engine (`installBots`,
  `installNations`) and decide during the tick, from the game state and its
  seed, so every client of an online game computes the same moves. Nations
  come from the map's manifest, numbered after the bots, each with its start
  tile. They take muted tones of their own (`NATION_COLORS` in palette.ts),
  each picked as far as possible from the player colours, the bare map and
  the nations before it; a test keeps all 64 apart. In a team game
  (`?teams=2` to `4`), every player takes a shade of their team's hue instead
  (`teamColor`), and the leaderboard's goal bar counts the team's land.
- Only `apps/client/src/render` imports Three.js, which a test checks. The
  interface talks to the two contracts of ADR 0003, never to Three.js:
  `Renderer` (`render/renderer.ts`: player colours, changed tiles, ships, a
  frame for a camera view) and `Camera` (`render/camera.ts`: screen to tile
  and back, pan, zoom, focus, with east-west wrapping). `createRenderer`
  returns the flat `MapView` or the `GlobeView`, each with its own camera.
  The issue that set them out named the
  renderer's calls `init`, `applyUpdates` and `frame`: they became the
  constructor, `markChanged` and `setShips`, and `render(view)`, because the
  page, not the renderer, holds the game state.
- The menu lists the maps of `maps/index.json`, the World first, then small
  generated test maps (`maps.ts`), reduced to their largest landmass. The
  page downloads and checks a published map's manifest, so the worker does
  without the schema library; the worker downloads the terrain and checks it
  against the manifest (`loadMap` of the engine) before the game starts, then hands the page a copy
  of the terrain to draw. Without a catalogue, only the generated maps remain.
- The setup lives in the query string (`?map=pangaea&bots=8&difficulty=hard&nations=1`),
  so a link starts the same game, and the last one is remembered in
  `localStorage` when storage is available.
- `?off=silo,warship` leaves structures and units out of the game
  (`R-MODE-03`), by the names `city`, `fort`, `port`, `silo`, `airDefense` and
  `warship`; a private game created from the menu starts with the same choice.
- `?view=globe` shows a map of the whole planet on a globe, and G switches
  between the globe and the flat map during the game. It is a prototype for
  v0.6, kept out of the menu; see [ADR 0005](adr/0005-globe-spike.md).

## Sessions

The screen talks to one `GameSession` (`game/session.ts`), whatever the
mode, and `openSession` (`game/sessions.ts`) picks it: a `ReplaySession` for
options with a record, an `OnlineSession` with a link to the server, a
`SoloSession` otherwise. Each starts the worker the same way
(`game/worker-session.ts`) and declares its `capabilities`, which the screen
asks instead of checking the mode:

| Capability    | Solo | Online                 | Replay |
| ------------- | ---- | ---------------------- | ------ |
| `canPause`    | yes  | no                     | yes    |
| `canOrder`    | yes  | yes                    | no     |
| `canSetSpeed` | yes  | no                     | yes    |
| `recordable`  | yes  | yes                    | no     |
| `relayed`     | no   | yes                    | no     |
| `canHide`     | no   | yes                    | no     |
| `canReport`   | no   | when the server allows | no     |
| `guided`      | yes  | no                     | no     |

What a mode cannot do its session ignores. The online session owns the
`TurnPacer` and the `ServerLink`: it sends orders, hashes and snapshots to
the server, and plays the server's turns through the pacer on a timer of its
own, so a hidden tab keeps playing. Its clock and the worker are handed in,
so `test/sessions.test.ts` runs every mode with a fake worker, a fake link
and a clock moved by hand.

## The game screen

`ui/game-screen.ts` only wires the parts of a game together; each part is a
module of `ui/screen/`:

| Module            | What it does                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `map-scene.ts`    | The renderer, its camera and the minimap                                         |
| `input-host.ts`   | The pointer on the map: clicks as orders in the mode picked, long presses, hover |
| `pointing.ts`     | The ship, the landmark or the fallout under the pointer                          |
| `orders.ts`       | The orders the player gives, each when `canAct` allows                           |
| `policy.ts`       | `canAct`: whether the player can act now, and in which phase                     |
| `panel-host.ts`   | The HUD, the player menu, the doctrine cards, the pace, the labels               |
| `dialog-host.ts`  | The pause, the tutorial's dialogs, the help, the end screen, leaving             |
| `overlays.ts`     | The one dialog at a time and the pause that goes with it                         |
| `outcome.ts`      | Peak land, statistics, achievements, the usage report, the end of the game       |
| `feed-host.ts`    | The event feed and the player card, loaded when the game starts                  |
| `guide-host.ts`   | The first steps and the tips                                                     |
| `preview-host.ts` | What a build click would do, before it is made                                   |
| `game-keys.ts`    | The shortcut of each key                                                         |
| `ship-motion.ts`  | Headings, wakes and the last moments of the ships                                |

`canAct` answers in one place what each order used to check on its own: no
order before the first update, while a dialog holds the game, or while a
record is watched, and diplomacy only in play. A decided game is not
refused there: a solo game waits behind its end screen, which pauses it,
and every game plays on once the player keeps watching (R-WIN-03).

## Panels and signals

The panels (`ui/screen/panel-host.ts`) keep the latest update, as this
screen shows it (hidden players renamed, R-DIPLO-08), in one signal of
`@preact/signals-core`. Each
panel watches its own part of it through `select(signal, pick, equals)`
(`signals.ts`), and runs only when that part changes: the marks beside the
names with the relations (`relationMarks`), the doctrine cards with their
seconds (`doctrineView`), the gold floats with a trade ship docking
(`tradeGains`). The HUD and the player menu show figures that move every
tick and take every update; the HUD still draws a few times a second. The
watchers belong to the panels' `Effects` and stop with the screen. The
worker and its messages are unchanged.

Before the library came in, the whole build but the maps sent 848.4 kB with
gzip and the game screen's chunk 35.8 kB; with it, 850.4 kB and 37.8 kB
(`bun run perf:client`). That took the build over its budget of 850 kB, which
the same commit raised to 852.5 kB ([performance.md](performance.md#budgets)).

## Replays

The end screen saves the game as a replay: a `GameRecord` (see
[engine.md](engine.md#game-records)) in JSON, compressed with gzip, in a
`.ffr` file named after the map and the day. "Watch a replay", at the foot of
the menu, opens one. Only the build that played a game replays it, since the
rules and the balance may have changed since; another build's file is refused
with a message, and so is a file that is not a replay, or one whose map has
changed since. A development build (`dev`) opens any build's replay.

While watching, the worker plays the recorded turns at ×1, ×2, ×4 or ×8 from
the bar at the bottom (at the top on a phone), the bots decide again as they
did, and no order can be given: the build panel, the attack ratio, the attack
list and the banner are hidden. At the last tick of the record the bar says
whether the replay reached the hash the game recorded. A replay runs on past
the win when the player kept watching before saving it.

## Playing online

The menu offers "Play now", which joins the fullest public game waiting or
opens one that starts by itself after 60 seconds, a public game of one's own
under a name the player types, a private game, and the list of public games
(`/api/games`, fetched every 3 seconds while the menu shows, with
`If-None-Match`): name, map, mode, host, seats taken, and whether it is
waiting or already running, with a Join button for those that can be joined.
The lobby (`ui/lobby.ts`) shows the game's name, who is in and who hosts it,
the countdown of a "Play now" game, and its invitation link, `?game=<id>`,
with a Copy button. Only the host sees the settings and "Start the game",
which waits for a second player in a public game, and, during a countdown,
the button that stops it. While the player touches the page, the lobby tells
the server at most every 30 seconds, so that a host who walked away hands the
role on. An invitation link first asks for the name
the other players will see (`ui/join.ts`), filled with the last one and saved
with the setup, unless the link has `name=` or the tab holds a seat to take
back. The address bar holds the
link while the player waits, so a reload joins again. The lobby also says
when the page is outdated (with a Reload button), when a game expired before
it started or ended for another reason, and why a request was refused.

```text
 page                                          worker
 ----                                          ------
 OnlineClient (net/online.ts) ── turns ──> OnlineSession.pushTurns ─> GameRunner.playTurns
      ^                                         │                       │
      └─── orders, hashes ── ServerLink <───────┴── click → order ──────┘
```

Once the server sends `started`, the page builds the same game as every
other client: the map, the seed, the humans in the server's numbering,
`bots` bots of the game's difficulty numbered after them, and the map's
nations after the bots when `nations` is set, dealt into `teams` teams when
it is not 0. The host of a game names it, if it is public, sets its seats and
whether it starts when full, and picks the map, bots, difficulty, nations and teams in the lobby (`configure`), and unticks what the game leaves out (`R-MODE-03`), whose buttons and keys then disappear from the game;
starting from the menu's choices; maps come from the published catalogue
only, grouped like the menu's "World maps" and "Quick games" (`group` in
`maps/index.json`, generated maps counting as quick), and only those that
seat the players already in, and bots stop at 25 or at the map's most players less the players in (empty seats shrink to make room),
whichever is lower. The other players see the settings as one line. The worker has no
clock of its own: it runs each turn the server relays, every player's orders
in it, and a batch of turns at once after a rejoin. The page holds the turns
back in a jitter buffer (`game/turn-pacer.ts`): turn n plays at n ticks of
the clock plus the largest delay among the last 30 turns but for the 3
latest (a lone late turn plays late on its own rather than hold the others
back), so bunched
arrivals still come out one per tick; a backlog of more than 4 turns plays
at once. A solo game goes down the same path: each tick, its orders become
the turn a server would have sent. Its clock (`game/beat-clock.ts`) plays
the next beat as soon as the player gives an order, and the beat after keeps
its time, never more than one beat ahead of the schedule. A click becomes an order
the page sends to the server; it takes effect when its turn comes back.
After every 50th tick the worker hashes the game state and the page reports
it, so the server can tell a client out of step (`desync`). The worker keeps
every turn with orders and every hash it sent; on a desync the notice offers
"Download a report", a `DesyncReport` (docs/engine.md) that
`bun run sim -- --replay` plays again to find the first tick that differs. Games
on generated maps have no report. A ring shows under the pointer as soon as it
presses the map, and becomes the answer to the click once the worker reads
it. Until its turn comes back, an online order's ring pulses on its target. Once a game starts, the tab keeps its seat token in session storage and the
URL becomes `?game=<id>`: a reload sends `rejoin` from tick 0, replays every
turn at once and plays on; leaving from the menu gives the seat up. An online game never pauses, and its HUD
has no pause button.

### Staying in the game

A connection can die without the browser noticing, as when a phone changes
networks or wakes up: no `close` comes for minutes. A running game hears
from the server at every beat, so `OnlineClient.check()`, which the page
calls every second, drops a connection silent for 6 seconds
(`SILENT_MS`) and opens another, which takes the seat back from the next
tick it needs. When the browser says the network is back (`online`) or the
page comes to the front again, `reconnectNow()` tries at once instead of at
the end of the wait, and drops a game's connection that has been quiet for 2
seconds. Neither touches a lobby's connection: a lobby can be quiet for long.

The seat token is also copied to local storage with the time the game was
last heard from, touched every 5 seconds while turns come in. A page opened
again, after the tab was closed or the phone dropped it, finds that copy and
offers the game back over the menu ("Resume" or "Drop it"), as long as the
server may still keep the seat (5 minutes) and no other tab has played it in
the last 15 seconds (`net/seat.ts`). Resuming starts from the snapshot of the
game this browser kept (#39), like a reload.

A solo game is kept too. The worker sends a snapshot 15 seconds into the
game, then every 30 seconds, and whenever the page goes to the background;
the page keeps the last one in IndexedDB (`game/snapshot-store.ts`, key
`solo`) with the options the game started with. A reload goes straight back
to it, paused; a page opened again offers it over the menu. The game is
forgotten once it is decided, left from the menu, or replaced by another one.
What the screen gathered itself, the charts of the end screen and the
alliances seen in the feed, starts again from the snapshot.

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
- For a second and a half after that, the tile marks the front of an
  attack: its edge turns to light and dark stripes that march along it, and
  the strip behind pulses. An attack takes at least one tile every tick, so
  its front stays lit for as long as it lasts, and no attack data reaches the
  renderer. Zoomed out, where a tile is smaller than a pixel, the strip takes
  the stripes. With the system's reduced motion setting the stripes hold
  still.
- The land of the player under the mouse is lit whole, with a wide white
  rim; on a touch screen, the land under a resting finger, until it lifts or
  moves on. The shader compares owners, so pieces across the seam light too.
- Names and troops sit on the deepest tile of each country, found by a
  distance transform in the worker every half second
  (`game/label-anchors.ts`), and as large as the land around that tile allows.
- A frame is drawn only when the camera moved, the hovered land changed,
  tiles changed or are still fading, or ships are at sea, plus one frame
  when the last fronts go dark. An attack changes tiles every tick, so its
  front marches for as long as it lasts; once it stops, the stripes stand
  still until that last frame clears them, rather than keep the GPU busy for
  another second and a half.

### The globe and the switch

`?view=globe`, or the `?view=map` the address takes once G switched back,
is still the only way to the globe (ADR 0005); the menu offers none. A game
has one WebGL context (`createContext`, in `render/gl-context.ts`), which
every renderer of the game draws on and which outlives them: G does not
make a new one.

- `MapScene` keeps a renderer per view. On the globe path, once the browser
  is idle after the start, it makes the view that G shows next over the same
  owners array and with the ground the first one baked (`bakedGround`), has
  its shaders built and its textures sent (`warm`), and draws it once just
  before a frame of the view shown, which covers it (`data-ready` on `#map`
  says it is done). G then only swaps which renderer draws; while it waits,
  the other renderer is told of every tile that changes hands, so showing
  it sends only those.
- The input holds one camera for the whole game, a `SwitchCamera`
  (`render/switch-camera.ts`) that passes every call to the camera of the
  view shown: a switch moves it to the other camera, over the same tile and
  zoom, and the input stays as it is.
- A renderer declares what it can do beyond the common contract in
  `capabilities`: its kind, and its combat effects (`RendererEffects`), which
  the flat map draws and the globe does not yet. The scene asks there
  rather than calling hooks a renderer may lack.
- `e2e/tests/globe.spec.ts` times six switches on the World map in Chromium
  and fails when their median takes 500 ms or more from the key to the new
  view drawn (M7-07, #66); the game's clock must still run after them. It
  is tagged `@timing`: CI runs it alone, in the Performance job, rather than
  in the sharded end-to-end runs, where other browsers share the machine.

## Build preview

In a build mode, before a click is made, the interface shows what it would do
(`ui/screen/preview-host.ts`, `ui/build-preview.ts`). The page asks the worker,
which knows the game, with a `peek` message (`game/messages.ts`); the worker
answers with `previewForClick` (`game/click-orders.ts`), which calls
`orderForClick`, the function that turns the click into an order, and the engine's
`orderError` under it. No rule is read twice and no order is queued by asking.
The answer is where the order would land (a port snaps to the coast, a warship
to its port), the refusal it would meet, if any, and the reach of a fort or an
air defense in tiles (`fortRadius`, `airDefenseRadius`).

The map draws the structure faded in the player's colour, as for one being built
(`MapScene.setGhost`, through the same `setStructures` as real ones, flat map and
globe alike). A DOM layer at tooltip level (z 1, so a panel never cuts the card) draws a ring on the tile, green or red,
the dashed circle of the reach, and a card with the name, the price and the
reason, a ✓ or a ✕ in front so that colour is never the only sign. A mouse asks
as it hovers; a finger taps once to ask and again, on the same spot or on the
card's _Place here_ button, to place. While a preview shows it asks again every
400 ms, as gold comes in and land changes hands. The first time a player picks a
building, the bar's tip points out the numbers (or the two taps) and is not said
again (`frontfall.buildHint` in local storage).

## Beta

Before 1.0, the menu and the HUD showed a beta badge with the version of the
client, and the menu said that rules, balance and visuals would still change.
Vite passes the root `package.json` version to the page (`src/release.ts`);
the badge disappeared by itself when the version reached 1.0.0, and nothing
replaces it.

## Controls

| Input                                         | Action                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click or tap                                  | Pick a start, then expand or attack                                                                                                                             |
| Click a coast over water                      | Send a ship with the attack ratio of the troops                                                                                                                 |
| Drag, one finger                              | Move the map                                                                                                                                                    |
| Wheel, pinch, `+` and `-`                     | Zoom, towards the cursor or between the fingers                                                                                                                 |
| Arrows or `WASD`                              | Move the map, at the same speed at any frame rate                                                                                                               |
| `Shift` + `1` to `9`, `Shift` + `0`           | Attack with 10 % to 90 % of the troops, `0` for all                                                                                                             |
| `1` to `9`                                    | Pick the building of that number, as its button shows it: city, palace, fort, port, silo, air defense, warships, missile, heavy missile                         |
| `C`, `B`, `F`, `O`, `L`, `K`, `J`, `X`        | Build a city, a Micho Palace, a fort, a port, a missile silo, an air defense or a Mosque of Cyrus, demolish: then click your land; the next click attacks again |
| `V`                                           | Warships: click your port to buy one, or water to send your closest warship to patrol there                                                                     |
| `M`, `N`                                      | Launch a missile or a heavy missile from your closest loaded silo: then click the target                                                                        |
| Right click, long press, or a leaderboard row | Open that player's menu: ask for an alliance, accept, renew or betray, embargo their trade, send a gift or a message                                            |
| `Esc`                                         | Close the player menu, or leave a build mode                                                                                                                    |
| `Home`, `Space`                               | Take the map back to the player's land (Space only when no button has the focus); the minimap has a button for it                                               |
| `P` or `Esc`                                  | Pause and resume                                                                                                                                                |
| `T`                                           | Solo: run the game at ×0.5, ×1, ×2 or ×4, in turn (`R-MODE-07`); the round button after pause and the pause banner do the same                                  |
| `H` or `?`                                    | How to play: the controls, and every building with its cost                                                                                                     |

The build panel above the toolbar, in two columns (two rows of icons under the stats on phones and short windows), has the same modes as buttons, with the cost of each, and the cities owned against the most the land supports (`R-BUILD-07`). Structures are drawn as light diamonds (cities), octagons (palaces), triangles (forts), hexagons (ports), pentagons (silos), discs (air defenses) and decagons (mosques) on a dark outline, greyed while being built. Trade ships are small dots in their owner's colour, smaller than transport ships; warships are larger triangles. Missiles in flight are bright ember diamonds, larger for a heavy one, above everything else, and land under fallout turns a scorched olive until it clears: the territory layer rewrites the ground colours of those tiles only when the fallout changes. Zoomed out, ships keep a smallest size on screen (`SHIP_SIZES` in `render/map-view.ts`), as structures do.

The player menu opens at the foot of the leaderboard (`R-DIPLO`). It says whether the player is an ally and for how long, and offers the one order that fits: ask, accept their request, renew in the last minute of an alliance, or betray, which asks for a second click. Every player but a teammate also has a button to put an embargo on their trade or lift it, and the menu says when either side holds one (`R-DIPLO-05`). Two more buttons send the player the attack ratio's share of your troops or of your gold (`R-DIPLO-06`); the menu says when the two of you are at war, which refuses gifts. Send a message unfolds the quick messages and emoji (`R-DIPLO-07`); one click sends one, and it shows in the feed of the sender and of the receiver only. Requests to the player wait under the banner with a bar that empties until they run out; Ignore hides one without an answer. Allies are marked in the leaderboard and their land has a dashed white rim, drawn by the territory shader from a flag in its palette. Traitors carry a badge while the mark lasts, and the event feed (below) tells every player who allied, whose alliance ended, who betrayed whom, who put or lifted an embargo on whom, whose warship took whose trade ship, who launched a missile at whom and whose air defense stopped it, who sent a gift to whom. A click that would attack an ally is refused and says to betray first. A long press opens the menu only for a finger or a pen held still for 500 ms; a mouse uses its right button.

The event feed (`ui/events-feed.ts`, fed by `ui/feed-events.ts`) is the one place the game says what just happened, top left under the first steps (`docs/hud-layout.md`). Besides the diplomacy events the engine logs, the player's own screen derives three kinds of news by comparing two updates, so the engine and the protocol are untouched: an alliance request that arrived, land taken from you (once per attacker per 15 s, at the first tile taken), and a building of yours gone with its land in other hands. The same event within the life of a line is counted ("x3"). A line lasts 8 s, and does not fade while the pointer or the focus is on the feed; at most three lines show, two in a window under 560 px high, and on a phone held upright only the latest, which takes the banner's place for 4 s, the news about you kept over the rest. A line with a place is a button that centres the map on it, at least at the zoom of the first view. The list is a polite live region; the fade and the slide-in follow the reduced-motion setting like every other motion. Both load when a game starts (`ui/screen/feed-host.ts`), out of the first visit. The card of a player (`ui/player-tip.ts`) follows a mouse resting on land, is a tooltip, and shows the same figures as the line the player menu starts with; who is allied with whom outside your own alliances is read from the events since the game started here, so a game picked up after a reload may miss older ones.

While attacks are under way, a panel at the bottom left lists each one, its
target and its troops, with a Retreat button that calls it back
(`R-ATTACK-06`): the troops come home, less `B-RETREAT-PENALTY`, which the
button's tooltip states.

Under them (`ui/threats.ts`) the panel lists the attacks on the player's land
(attacker and troops; a click centres the map on the attacker, Counter sends
back the troops of the attack or the attack ratio's share of the soldiers,
whichever is less, at the attacker's land) and the ships at sea: the player's
own, with target and time left, and any other player's heading for the
player's coast, in red. `GameUpdate.incoming` and the `target` and `ticksLeft`
of `BoatView` are read from the game for it; no rule and no message change.
`ui/alert-frame.ts` flashes a red rim for a second when land is lost (the
sound's threshold) or such a ship is first seen; reduced motion turns the fade
off. The banner warns when troops reach 95 % of the cap or fall under 1 000.
`PlayerLabels.setRelations` puts marks before each player's troops (crown for
the biggest player, tick for an ally, warning sign for a traitor, barred circle
for an embargo, envelope for an alliance request); it runs once per update and
writes a text only when a player's marks change, never per frame.

`Esc` also closes a dialog: on the end screen it does what "Keep watching"
does, and the menu button of the HUD stays the way out.

A click on land the player cannot reach by land sends a transport ship when
it is a coast within sailing range, from the player's nearest coast. A click
that sends nothing (water, own land, too few troops, out of reach, every ship
at sea) gets a red ring and one line saying why, for four seconds, naming the
building first when a build was refused ("Port: …"); one that sends an order gets
a ring of its own. A press that moves more than 6 pixels is a drag, never a
click. WASD is read by
physical key, so it stays under the same fingers on AZERTY keyboards. Command letters
(C, F, O, L, K, V, M, N, X, P, G, H) are read by the letter the layout prints
on the key, so M is M and `?` opens the help on AZERTY too; a layout without
Latin letters falls back to the physical key. The page
itself never zooms or scrolls during a game (`user-scalable=no`, `touch-action:
none`): a pinch must reach the map, not the browser.

## Help and first steps

The `?` button, `H` or `?` open "How to play" (`ui/help.ts`), which pauses a
solo game. The help and the guide below, with their styles, are chunks of their
own, out of the first download: the help is fetched as a game starts, the guide
only when it shows. It has four short sections: expanding, building, other players and
the map. The building rows come from `BUILD_MODES` in `ui/hud.ts`, the list
the build panel is made from, so a new building shows in both: icon, name,
key, the player's current cost (from the last update, so the rise of each
city's price is in it), and what it does and where it goes in half a
sentence (`help.place.<mode>`, with `B-BUILD-SPACING` as `{spacing}`). Modes
the game leaves out (`R-MODE-03`) are not listed. On a touch screen
(`pointer: coarse`) the lines say tap and long press instead of click and
right click, and keys are left out. The dialog keeps Tab among its buttons,
opens scrolled to its top, and scrolls by itself on a small screen.

Build buttons show their key in a corner, except on touch screens and in the
compact layout. Holding a finger on one for 500 ms explains it, the way a
tooltip does for a mouse, and that press does not pick the mode.

A first solo game shows "First steps" (`ui/guide.ts`), a card under the stats
(across the screen under the banner on phones), never online and never in a
replay. It asks for one thing at a time and moves on when the player does it:
pick a start, pick a doctrine, expand once the attacks open, set the share of
troops that attacks, build a city (with its current cost), a fort, ask a
neighbour for an alliance, then a last word on how a game is won. A step
already done is skipped, and a step with no use in the game (a doctrine in a
game without doctrines) is too. The steps that cost gold show a meter of the
player's gold against the price. Next moves on without doing the step, and
Hide puts the guide away; reaching the end or hiding it sets `frontfall.guide`
to `done` in `localStorage`, and "Show the first steps again" in the help
clears it. The step text sits in a polite live region, and the card takes no
focus from the map. Without storage the guide simply shows again next game.

## Tips

`ui/hints.ts` (a chunk of its own, loaded when a solo game reaches play) shows a
short "Good to know" card the first time something happens that a new player
may not understand: an attack on the player, an embargo on them, an alliance
request, gold for several cities left unspent, fallout on the map. It takes
the guide's spot and waits while the guide's card is up; it closes with Got it
or after twenty seconds of play, and "Stop these tips" ends them for good. The
ones shown are kept in `localStorage` (`frontfall.hints`, or `off`). Never
online and never in a replay, like the guide.

## The tutorial

The menu's "Tutorial · 5 min" starts a practice game of its own (`tutorial()`
in `app/app.ts`), apart from the setup saved in the menu. It is meant to be
played once, in about five minutes, and to leave a player who knows the whole
game and wants to play it:

- **A gentle game.** The Strait (two lands joined by a neck, with coasts),
  two easy bots and four city-states with no nation to bring them
  (`cityStates`), a spawn phase of 60 s instead of 20 to read the choices in
  (`spawnSeconds`), and double speed so that the first buildings come within
  minutes. All three are options of the solo setup
  (`game/simulation.ts`), kept in the record of the game like any other
  option. A catalogue that fails to load leaves the generated Skirmish map.
- **An introduction** (`ui/tutorial-dialogs.ts`) opens first, with the clock
  stopped behind it: what the game is in three lines, and what the card in the
  corner will do. A reload of the practice game goes back to the game, not to
  the introduction.
- **A core of eight steps** in the same card as the first steps, all of them
  things to do: start (on a wide stretch of land, not the neck), doctrine,
  growing on free land, the share of troops that attacks, a city, an attack on
  a neighbour (with the attacks panel and the retreat), a port and the boat,
  a fort. The steps that ask for an action wait for it, and Next always moves
  on. They are in `BASES` (`ui/guide.ts`); `STEPS` lists every step and the
  shorter list of a first game is `FIRST_STEPS`.
- **Three chapters**, each of two short steps and played in the same game from
  the last word: gold and city-states, allies and diplomacy, missiles and how
  a game is won (`CHAPTERS`). A chapter does not skip steps for what the
  player built. The chapters read are kept in `localStorage`
  (`frontfall.chapters`) and shown with a tick.
- **A last word.** Next on the last step opens a dialog with five rules to
  keep, the chapters, and two ways on: a real game of the menu's setup, or
  staying in the practice game. A chapter ends back on this dialog.

The texts of the card and of both dialogs are in `ui/tutorial-text.ts`, in
both languages, not in the catalogues: they load with the guide and weigh
nothing on the first visit. They say no figure of the balance (prices come in
as parameters, the rest in words) so that a change to `balance.md` never
leaves them false; `test/tutorial-text.test.ts` checks it, and that both
languages have the same keys.

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
