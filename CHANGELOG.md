# Changelog

Every release of Frontfall and what it changes in play, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/); each version also has its notes on the [releases page](https://github.com/nic0lasm/frontfall/releases).

## [Unreleased]

### Added

- **A ring where a player's land first appears, and a soft glow along a front.** When the spawn phase ends, each start tile gets a ring that spreads out from it, so you can see where everyone begins. While land is being taken, a faint glow breathes along the front, at most twice a second. With reduced motion, the ring is a single disc that fades without growing and the glow is off. Not on the globe yet.
- **Build from the keyboard, and see where it goes before you place it.** Keys 1 to 9 now pick a building, and the number is on its button: 1 city, 2 palace, 3 fort, 4 port, 5 silo, 6 air defense, 7 warships, 8 missile, 9 heavy missile (the letters still work). Once a building is picked, the map shows it faded in your colour under the pointer, with a green ring when it fits and a red one when it does not, and a card with its price and, when it does not fit, why: too close to another building, not your land, not enough gold, no coast. A fort or an air defense also shows how far it reaches. On a phone, the first tap shows the preview and a second tap on the same spot, or the card's Place here button, places it. Nothing is built until you confirm.
- **Fronts that collapse.** Hold an attack's pressure on a thin front and it gives way by whole stretches instead of tile by tile. When your attack has at least three times the soldiers facing it (their soldiers per tile, times the tiles of theirs you touch) and keeps taking land for 3 seconds, the front breaks: their land within about 5 tiles of your spearhead (10 on World) falls at once at half the usual price, and any pocket it cuts off falls with it. A ring of ember marks the spot and the feed tells you, whether the front that broke was theirs or yours. Forts hold: land a fort covers never gives way. A thin border with troops at work breaks first, so call your workers back to arms, fight back or build a fort when a neighbour masses on you. Nations know the rule: they push hard on a front that is about to give, against anyone bigger than them, and keep their troops under arms where a neighbour could break them. It is the first of the **special rules**, a new section of its own in the solo setup and in the lobby: on by default and in every public game, and the host of a private game can turn it off. The lobby and the end screen show which special rules a game is played with.
- **Put troops to work.** A second slider under the attack share, "Workers", sends part of your troops at home to work: each worker earns four times the gold of a soldier, up to 80 % of your troops. Workers neither attack nor defend, so your land gets cheaper to take and attacks, ships and gifts draw on your soldiers only. Your gold per second now shows under your gold, and moves as you drag the slider. It starts at 0 %, so nothing changes until you touch it. On a phone, the slider sits at the top of the build tray. Nations put 40 % of their troops to work once their army is full and nobody attacks them, and call them back as soon as someone does.
- **See what an attack would take before you send it.** Point at a neighbour's land, or rest a finger on it, and the bottom left shows about how many tiles your current attack share would take there, how many soldiers it sends, what each tile costs and how much room for troops it would add. On a phone it keeps to one line. It is an estimate: hills, mountains and forts cost more.
- **Game speed.** A solo game can now run at ×1, ×2 or ×4: press the round ×1 button after pause, or T, to go to the next pace, or pick one in the pause banner (where it lives on a phone, so the attack slider and the leaderboard keep their room). In a private online game, the host picks the speed in the lobby for the whole game, and everyone sees it in the summary; public games always run at ×1. Only the pace changes: at ×2 everything happens twice as soon, the time limit included, and a replay plays the same whatever speed the game had.

### Changed

- **Sharper ridges.** Mountain ranges are shaded at two scales, so their crests stand out from the broad slopes when you zoom in.
- **A clearer sea.** Every coast now has a crisp band of light shallows with its fine line of foam, in place of the soft glow; coastal water is a shade lighter and deepens slowly offshore. Zoomed in, slow swells drift across open water; they hold still when reduced motion is on.
- **A touch screen reads "tap", not "click".** The line at the top of the game, the one that says where to start and how to expand, and the build prompts now say "Tap" (and drop "Esc to cancel") when you play with a finger, on a phone or a tablet. On a landscape phone, the first steps take a short card beside the leaderboard instead of its full width, and "Hide the guide" is a 44 px target on a touch screen.
- **Digits pick buildings; Shift and a digit sets the attack share.** The digit keys 1 to 9 and 0 used to set the share of troops an attack takes. That is now Shift + 1 to 9 (10 % to 90 %) and Shift + 0 (all of them), as the slider at the bottom has always allowed. The help and the first steps say so.

### For self-hosters and contributors

- The worker answers a new `peek` request with what a click in a build mode would do, for the build preview ([client](docs/client.md#build-preview)). The simulation and the protocol do not change.
- **Protocol 22 and the special rules.** The game options, `lobby` and `started` carry `rules` (`{ "collapsingFronts": true }`), the special rules of [R-MODE-08](docs/rules.md); a public game refuses any but the defaults, and games saved by an older server come back without them. Collapsing fronts are [R-ATTACK-10](docs/rules.md) with `B-COLLAPSE-ODDS` 3, `B-COLLAPSE-BUILDUP` 3 s, `B-COLLAPSE-DEPTH` 5 tiles and `B-COLLAPSE-COST` 50 %, and nations play them under [R-BOT-16](docs/rules.md). In the engine, a rule is off unless `GameSetup.rules` turns it on, and only a rule that is on enters the state hash, snapshots, replays and desync reports; the new balance values change every game's hash, so the golden replays are rebuilt, with a fifth one played with the rule. `pnpm balance` and `pnpm sim` take `--rule collapsingFronts`. Measured on World with normal nations against the scripted average player (20 seeds, 30 minutes): 18 games decided against 15 without the rule, and the player wins 2 against 6; the two games left undecided stall across an ocean, which the scripted player does not cross. Tick time is unchanged (`pnpm sim` on 2048 × 1024, p95 about 17 ms either way).
- **Protocol 20 and a new rule.** A new order, `work` (`share` from 0 to 100, which the engine checks against `B-WORK-MAX`), sets a player's work share ([R-ECO-07](docs/rules.md), `B-WORK-MAX` 80 %, `B-WORK-GOLD` 4); nations use it under [R-BOT-15](docs/rules.md) (`B-NATION-WORK` 40 %). Older pages and servers are turned away. Snapshots move to format 2 (each player's work share), and the price of a defender's land now counts their soldiers only. Measured on World against the scripted average player (12 seeds, 30 minutes), nations are no easier: it wins 4 games of 12 against normal nations (6 before) and is eliminated in 7 against hard ones (3 before).
- **Protocol 19.** The game options, `lobby` and `started` carry `speed` (1, 2 or 4); at speed 4 the server sends four turns in each 100 ms frame, and a public game refuses any speed but 1 ([protocol](docs/protocol.md), `R-MODE-07`). Games saved by an older server come back at speed 1. Pages from before this release reload on their next connection.

## [0.7.0] - 2026-10-28

Look and feel: a map with smooth coasts and climates, pieces you can tell apart, a raised interface with one bar at the foot of the map, small effects for combat, and sign-in by email with achievements that follow your account.

### Added

- **Sign in by email, and keep your achievements.** No Discord or Google account? Sign in with email under your name in the menu: type your address, open the link it sends on any device within 15 minutes, press Finish signing in, and that is it. No password to remember; the link works once. And whichever way you sign in, your achievements now go with your account: sign in on another phone or computer and they are there, nothing is ever lost from either side. The game keeps no email address, only a scrambled version of it to find your account again ([what is kept](docs/privacy.md#if-you-sign-in)).
- **Small effects for attacks, landings and missiles.** A pale dotted arc follows a missile and fades after it lands, where a flash, a ring and a few sparks mark the impact; a ship leaves a short wake; troops landing from a boat make a ring and a few drops on the shore; a trade ship rings the port it leaves and the one it reaches; and tiles that change hands along an attack spark for a moment. They are drawn only where you are looking, and they cost nothing in the first download. With "Reduce motion" on, or when your system asks for less motion, the trails stay and each impact becomes a single disc that fades without growing. Not on the globe yet.
- **The game, minute by minute, on the end screen.** When a game ends, a chart shows the land of each player over time, with a switch to see their troops instead. Your line is thicker, the leaders are drawn in their map colours, and a dashed line marks the share that wins. Touch, hover or the arrow keys read every player's figure at one moment, along with what happened then (an alliance made or ended, one broken, a player eliminated), and a table below gives the same figures in words. Nothing changes in the rules.
- **Time before a win.** Under the clock in the leaderboard, the game now says in how long the leader would win if they keep their pace of the last half minute ("Win in about 3:20 at this pace"). It shows only when the leader is gaining and would win before time runs out, and it counts game time, so it holds when the game is paused.
- **A feed of what happens, and a card for each player.** Top left, under the first steps, a few lines tell you what matters as it happens: an alliance proposed to you, a neighbour taking your land, a city or other building lost, and the rest of the diplomacy (alliances, betrayals, embargoes, gifts, messages, missiles). The same event is counted ("x3") instead of repeated, the news about you stands out from the rest, and each line fades after a few seconds, or stays while your pointer or focus is on it. Click a line (or press Enter on it) and the map centres on where it happened. At most three lines show; on a phone held upright the latest takes the place of the banner for four seconds; and it is read aloud politely by a screen reader; with "Reduce motion" on, lines simply appear and vanish. Rest the mouse on any land to see its owner's card: name, how they stand with you (ally, teammate, traitor, at war, embargo), their troops against their cap, their gold, their share of the map and who they are allied with. On a touch screen, a long press opens the player menu, which now carries the same figures.
- **See how your army grows.** A thin bar next to your troops shows your army against its cap, a bright band where it grows fastest, and the troops you gain each second. Hover it, or tap it on a phone, for a short explanation.
- **Flat map setting.** In the menu's Accessibility section, "Flat map" draws the map in square tiles without the smoothing, which is lighter for older devices. It applies from the next game.
- **A mini-map.** A small map in the bottom right corner shows who owns what, a frame around the part you are looking at, your own land outlined in white, and the fronts where land just changed hands, in ember. Click or drag on it to move the view; on a map that wraps around the world the frame splits across the seam. Fold it with the arrow, and it stays as you left it for your next games. On a phone it starts folded, in the top right corner. It is redrawn a few times a second and not at all while folded, so it costs the graphics chip nothing.
  _FR : une mini-carte en bas à droite montre les territoires, le cadre de la vue et les fronts actifs en braise ; un clic ou un glissement déplace la vue ; elle se replie, et reste repliée par défaut sur téléphone._

### Changed

- **Troops grow fastest at about a third of your cap.** An almost empty army now refills slowly, a mid-sized one fastest, and growth still stops at the cap: sending every troop into an attack leaves you weak for longer, while keeping an army in the bright band of the population bar refills it fast. Difficulties were adjusted around it: normal nations decide every 2 seconds instead of every second and keep less at home, easy nations wait 3 minutes before they attack instead of 2.5, and normal bots act more slowly. Against nations, a good player wins about as often as before; games against bots only are harder than they were.
- **Smooth coasts and borders.** Coasts and the borders between countries now run in curves instead of stepping from square to square, with a fine line of foam along every shore. The blurred glow around coasts and the diamond shapes around islands are gone: the sea darkens over a narrow shelf instead. Clicks still pick the same tile, and no rule changes.
- **Climates on the map.** Land takes its colour from its latitude and its distance to the sea: sand in the Sahara, Arabia and the heart of Australia, forest in the tropics, steppe in between, then taiga, tundra and ice toward the poles and on the highest peaks. Hills are lit from the north-west over smoothed relief, with a fine grain when zoomed in.
- **Dark countries keep a light rim.** Countries in a dark colour now have a thin light line just inside their dark edge, so they stand apart from the ground even in very low vision or on a screen in sunlight. Pale colours, your own land and your allies keep their edges as before.
- **Attacks burn on the map.** The front of an attack now turns to ember, with light stripes marching along it, and the land just taken glows ember behind it and pulses, fading as the attack moves on. It reads on any player colour and without colour, and holds still when reduced motion is on.
- **A raised, lit look for the interface.** Panels, the build dock, the menu and the end screen now sit above the map like raised pieces: a soft gradient, a light edge on top and a shadow, with rounder corners. The main button is a lit ember, your own row in the leaderboard and the build tool you picked are highlighted, gold is yellow, the buttons at the bottom right are round, and the end screen has a glow (ember for a win, blue for a defeat) and its figures in a recessed box. Nothing moves and every setting for interface size and contrast still applies.
- **Buildings and units are pieces you can tell apart on the map.** Cities, forts, ports, missile silos, air defenses, the Micho Palace, transport and trade ships, warships and missiles are now small tokens in their owner's colour, each with its own white silhouette (a skyline, a tower with battlements, an anchor, a dome with a flag, a boat with sails, a gun on a hull, a rocket), instead of white dots and triangles. They stay at least 16 pixels wide however far you zoom out, and one still being built is drawn faded. Each token has a dark edge and a light colour gets a darker plate, so a piece stays readable on land of its own colour, even white on white, with a white silhouette that keeps at least 3:1 against every player colour.
- **The online buttons stack on a phone.** "Play now", "Create a private game" and "Watch a replay" now sit one under the other at full width instead of wrapping unevenly.
- **A coloured build dock, with the price in sight.** Each building has its colour (blue for the economy, green for defence, ember for arms) and its price sits under its icon, so you no longer hover to read it. The name and key still show on hover.
- **On a phone, a lighter screen.** The leaderboard folds into a one-line chip with your own row (tap the arrow for the whole list), and the first steps become a banner above the bottom bar instead of a card over the map.
- **A high point on the end screen.** The most land you held at once is now the big figure, in a larger display face fetched only when a game ends, and the thumbs up and down are drawn instead of system emoji.
- **One bar at the foot of the map on a wide screen.** Your troops, gold and land, the share of troops an attack takes and the buildings now sit side by side in a single bar at the bottom left, so what you use in a game is in one place and the top left is clear for the first steps. Narrower windows and phones keep their layout.
- **Easier to read and to reach.** On a touch screen, buttons, menus, switches and sliders are now at least 44 pixels high, so a thumb hits what it aims at (on the narrowest phones, under 360 pixels wide, the buttons at the bottom right stay a little smaller to leave room for the attack slider). The prices of buildings you cannot afford yet are brighter, the hint in the name field is easier to read, and in high contrast the counter of achievements no longer fades. Behind the end screen and the help, the rest of the page can no longer be reached with the keyboard or a screen reader, so Tab stays among the choices you are offered. A screen reader now reads a leaderboard row as the name and share you see, and announces the pause.

### For self-hosters and contributors

- The mini-map (`render/minimap.ts`, `render/minimap-image.ts`) is a 2D canvas that reuses the ground the map's renderer baked, so nothing is computed twice. It loads with the territory layer, out of the first download, and its texts travel with its code.
- The ground texture now holds each tile's signed distance to the coast in its alpha channel and is drawn with linear filtering and mipmaps; the renderer gets the map's latitudes from its manifest. Building the ground at the start of a game takes longer (about 2.3 s instead of 1.4 s for World on a slow cloud machine), and the map's textures take about a third more GPU memory. The territory layer and its shaders now load with the globe and the pieces, after the page, so the first download is about 4 kB lighter.
- **Accessibility checks in the end-to-end tests.** `e2e/tests/accessibility-audit.spec.ts` runs axe (WCAG 2.2 AA) on the menu in English and French, with the settings open and in high contrast, on the game and its help, and on the end screen. `e2e/tests/contrast.ts` measures the contrast of every text over gradients and the map, which axe cannot read; the same spec checks touch targets of 44 pixels on a phone, no running animation with reduced motion, no horizontal scroll at 200 % zoom, and the keyboard staying inside the end screen. The palette test now covers tritanopia too. The e2e package depends on `@axe-core/playwright`, and its TypeScript config now knows the DOM.
- **The game's styles load when a game starts.** The styles of the in-game interface, the end screen, diplomacy and the replay bar moved to their own file, fetched while the menu is open, so the first visit is 1.5 kB lighter.
- Troop growth (`R-ECO-02`): new balance value `B-GROWTH-FLOOR` (`growthFloorPercent`, 20), the rate of an empty army in percent of `B-GROWTH-RATE`, now 8 % (was 3.2 %). `B-NATION-INTERVAL` 5 / 2 / 1 s, `B-NATION-RESERVE` 60 / 10 / 10 %, `B-NATION-GRACE` 180 / 120 / 90 s, `B-BOT-INTERVAL` 5 / 5 / 2 s, `B-BOT-ATTACK-RATIO` 15 / 15 / 40 %. The golden replays were rewritten and the scripted average player of `pnpm balance` now keeps about a third of its cap at home in a war ([balance](docs/balance.md#economy)). Game updates now carry the troops the player gains per second.
- A game loaded from a snapshot while sea routes were still being searched found its trade partners later than the game it was saved from, and the two parted. Snapshots now keep the routes' search order and progress; `SNAPSHOT_FORMAT` is 3, and snapshots of format 2 are refused.
- Sign-in by email is off unless `FRONTFALL_SMTP_FILE` points at the JSON of a mailbox (`hote`, `port` 465 or 587, `utilisateur`, `motDePasse`, `expediteur`, the format nclsmgr.com's mail service already reads), with `FRONTFALL_PUBLIC_URL`, `FRONTFALL_SESSION_SECRET` and `FRONTFALL_DATA`; Discord and Google may stay unset. New routes `POST /auth/email`, `POST /auth/email/confirm` and `POST /api/me/achievements`. Links hold a 256-bit token kept only as a hash, in memory, for 15 minutes; limits per network, per address and per day (`FRONTFALL_EMAIL_DAILY_LIMIT`, 150 by default); the answer never tells whether an address has an account, and no address reaches the logs ([server](docs/server.md#sign-in-by-email), [self-hosting](docs/self-hosting.md#sign-in-by-email)). The protocol does not change. The server now depends on `nodemailer`.
- `accounts/accounts.json` may now hold accounts made by email and achievements. A release before this one sets such a file aside as `accounts.json.broken-<time>` and starts with no accounts: keep that file if you go back, and restore it when you come forward again.
- **The vote on the end screen loads with the end screen.** The thumbs and their reasons moved out of the first-visit code (`ui/vote.ts`), and the end screen's display face (Inter ExtraBold at its large optical size, cut down to about 14 kB) is only fetched after a game.

## [0.6.4] - 2026-10-28

A first look at the new Frontfall: a map with relief, countries you can read at a glance, sound effects and a one-click rematch.

### Added

- **Sound effects.** Short, soft sounds for an attack you launch, land you take, a building you finish, a missile you fire, a new alliance, and for victory and defeat. They are made by your browser as you play, so nothing extra is downloaded until the first sound is due. The page stays silent until you have clicked or pressed a key once, as browsers require. In the menu's Accessibility section, a switch mutes them and a slider sets their volume; both are kept between visits. There is no music.

### Changed

- **Play again, or back to the lobby, in one click.** On the end screen, a solo game now offers "Play again": the same map and the same settings, with a new game started at once. An online game offers "Back to the lobby": a public game takes you to the next one waiting, a private game opens a new private lobby with the same settings, ready to share. The main menu is still one click away.
- **A map worth looking at.** The sea now darkens gradually from a bright shallow along every coast to the deep over about 30 tiles, with a pale halo on the shallows, where it used to be one flat blue. Land eases down toward the coast, hills and mountains are shaded from the north-west with a fine grain so close-ups are no longer flat, and the edges of the view are softly darkened (more on a phone) so the interface reads over the map. Territories, fronts and every rule are unchanged.
- **Territories and fronts are easier to read.** A country's colour now lies over the relief instead of hiding it, so hills show through. Each country has a thin dark edge in its own colour, and where two players touch, the edge is wider with a light ridge on top, so a front can be told from a plain border without relying on colour. Your own land keeps its wide light rim. The first eight player colours stay apart under the common forms of colour blindness, which a test now checks.

### For self-hosters and contributors

- **Sound code on demand.** The sound effects live in `apps/client/src/audio/` and load as their own chunk, so the first-visit budget is unchanged. The cues are read from the updates the game screen already gets, and no game rule, replay or message depends on them.
- The ground colours are baked from the distance to the coast, and `land-light`, `sea-shallow` and `foam` join the map tokens (`assets/brand/tokens.json`, [brand guide](docs/brand.md)). The first download stays under its budget, with less room left.
- **Shader text is stripped of comments in the build**, which gives the first visit about 1 kB back.

## [0.6.3] - 2026-10-28

A privacy policy and terms of use for the public server.

### Added

- **Privacy policy and terms of use, in English and French.** What the game keeps about a guest (nothing) and about an account (a name and a scrambled id, never an email), the cookie, reports, logs, hosting and backups, how to delete an account, and a short set of rules for playing, at [/privacy.html](https://nclsmgr.com/frontfall/privacy.html) and [/terms.html](https://nclsmgr.com/frontfall/terms.html) (and `.fr.html`). They are linked from the sign-in box and from the page about the game. Full terms are still planned for 1.0.
- **Two more server fixes from [@MohammadBnei](https://github.com/MohammadBnei)** (#139, #140). A missing `usage.json` next to its `.bak` now loads the copy instead of starting the counts from zero, which the second save would have written over the backup; to reset the counts, delete both files ([server](docs/server.md#usage-counts)). The end-to-end test that plays a game and sends a thumbs down no longer runs against the public server after a deploy, so it stops adding a test game to the real counts. Thank you.

## [0.6.2] - 2026-10-28

A harder game on normal and hard, a longer first-steps guide, a page about the game and the sign-in buttons with their logos.

### Added

- **A page about the game, in English and French.** What Frontfall is, how to play in six steps, where and with whom, and where the code and the credits are, at [/about.html](https://nclsmgr.com/frontfall/about.html) and [/about.fr.html](https://nclsmgr.com/frontfall/about.fr.html). It loads on its own, apart from the game.

### Changed

- **Normal and hard nations fight back.** Nations at normal and hard now play every second, keep fewer troops at home, give you less time before they attack (2 minutes at normal, 1 and a half at hard instead of 2 and a half) and gang up on whoever holds a fifth of the map, when they can win the fight. A player who used to win every game on normal in about 7 minutes now wins about half of them, and hard is meant to beat you. Easy is unchanged and is the level for a first game. Games with bots only play as before.
- **First steps cover attack and defence.** The first-steps card goes from four to six steps: what the share of troops you send means (the ones you keep earn gold and defend your land, and a running attack can be called back), and how to hold a border that is attacked, with a fort. The help has a new Defend section, a tip for phones (long press a building button to read what it does) and a link to the About page.
- **The sign-in buttons wear the Discord and Google logos.** In Your profile, the buttons now read "Sign in with Discord" and "Sign in with Google" (in French, "Se connecter avec …") with each service's own logo, in the colours the services ask for.
- **Better reading of first games.** The anonymous game report now also says how long a player took to give a first order, and the counters separate games left within two minutes from games lost within two minutes. Nothing is added that could name a player, and no game rule or difficulty changes ([what is sent](docs/privacy.md#reports)).
- **A better preview when you share the link.** In a chat or on a social network, the game now shows a new picture taken from a real game, with its title and a description, instead of the old placeholder. Search engines and people without JavaScript also get a short description of the game.

### For self-hosters and contributors

- **Two server fixes from [@MohammadBnei](https://github.com/MohammadBnei)** (#137, #138): the per-address connection slot is freed when a WebSocket handshake is refused, and a hello from another build no longer lets later messages of that connection through. Thank you.
- **Back up and restore.** The data of the public server now has an encrypted backup kept off the machine, and [self-hosting](docs/self-hosting.md#backing-up-and-restoring) and [operations](docs/operations.md) explain how to back up and restore it.
- The first download is lighter: the end screen, the replay bar and the replay reader load when first needed, and the engine package is marked free of side effects. The first-visit budget now counts everything the page loads up front.
- The game screen of the client is split into modules (map scene, ships, dialogs, keys, orders, achievements, first steps) with no change of behaviour.
- The share image `og-image.png` (1200 x 630) and the README screenshot and time-lapse (`docs/assets/`) come from a current build. `apps/client/public/about*.html` are plain pages with their own stylesheet: they stay out of the first-visit budget and need no change in the server.
- `pnpm balance -- --average` plays a scripted average player, stronger than `--casual`, to measure the difficulty levels; nations take their own pace, attack ratio and reserve from `NATION_DIFFICULTIES` (`B-NATION-INTERVAL`, `B-NATION-ATTACK-RATIO`, `B-NATION-RESERVE`, `B-NATION-HUNT`, rule `R-BOT-14`), and the `world-nations` golden replay was recorded again.

## [0.6.1] - 2026-10-28

### Fixed

- **The Discord and Google sign-in buttons can be seen.** In Your profile, the button at the top right of the menu, they showed as plain grey text that nobody took for buttons. They are real buttons now.

## [0.6.0] - 2026-10-28

A lighter screen, a game you can play from the keyboard, things to earn and a way to keep your name. Nothing here changes how a game plays.

### Added

- **Play from the keyboard.** Tab reaches the map, a cross marks the middle of the view, the arrows or WASD move it under the cross, Enter or Space clicks where it stands and Shift+Enter (or the menu key) opens that tile's menu. The help lists it.
- **Accessibility settings** at the bottom of the menu: interface size (100, 125 or 150 %), reduce motion (it already followed your device's setting, and now you can ask for it in the game), and high contrast. They are kept in your browser.
- **Achievements.** Twenty achievements to earn as you play, shown with their own badges: win a game, hold half the map, win in 20 minutes, win without a missile, build a city, a port, a fort or a Micho Palace, cross the sea, send a warship or a trade ship out, form an alliance, make a gift, and more. Three of them have bronze, silver and gold tiers (Conqueror for wins, Builder for cities, Veteran for games played). The end screen lists what a game just earned, and Achievements in the main menu shows them all, with your progress towards the next tier. They are kept in your browser on this device only; nothing is sent to the server and no game rule changes.
- **Your profile, kept on your device.** A new "Your profile" panel in the menu lets you pick your colour for solo games from eight that stay apart under the common forms of colour blindness, and lists the last ten games you finished: map, mode, how it ended, minutes and day. Your name, colour and games stay in your browser; nothing is sent to the server. "Forget my profile and achievements" erases them, with your achievements and any game in progress. Online and in team games the game still gives the colours, so that everyone sees the same ones.
- **Keep your name: sign in with Discord or Google.** Optional, under your name in the menu. Once signed in, the name you play under is yours alone: nobody else can take it, online or as a guest. You can change it there, sign out, or delete your account in one click. The game keeps only that name and a scrambled number from the service, no email and no picture ([what is kept](docs/privacy.md#if-you-sign-in)). Playing as a guest stays exactly as it was.
- **Report a player.** In an online game, a player's menu now has Report this player: pick a reason (insults or harassment, offensive name, cheating, something else) and the report goes to whoever runs the server, who can ban the network of someone who abuses others. The player is not told. No text to type; the report keeps the game, the reason and the name they played under, never your address ([what is kept](docs/privacy.md#reporting-a-player)).

### Changed

- **A lighter menu.** The first screen is now your name, a line that sums up the game (map, bots, difficulty) and Play solo. Tap that line to change the map and the rules. Your profile, achievements, accessibility settings and language moved to a row of buttons at the top. Play now, a private game and watching a replay sit together, and the public games and their names are one tap away.
- **A lighter screen in play.** The buildings are now a row of icons at the foot of the map: hover or focus one to see its name, key and cost. On a phone they sit behind a Build button next to the other buttons and close once you pick one. The leaderboard lists the three leaders and you, and opens to ten when you tap its title. The Beta badge no longer sits on the map.
- **Clearer icons.** Buildings, missiles and the buttons for help, pause, menu and close now have drawn icons, each with its own shape, instead of plain squares and triangles. They stay legible on a phone.
- **A clear message on an unsupported browser.** A browser that cannot draw the game (no WebGL 2, or too old to read it) now says so at the top of the menu, in English or French, instead of showing a blank page or failing when you press Play. The supported versions are listed in [Supported browsers](docs/browsers.md).
- **You can zoom the page on a phone or a computer again**, and the small grey text of the menu is easier to read.

### Fixed

- The Frontfall logo now shows in the browser tab on Safari too, instead of the icon of nclsmgr.com.

### For self-hosters and contributors

- Sign-in with Discord or Google, off unless `FRONTFALL_PUBLIC_URL`, `FRONTFALL_SESSION_SECRET` (32 characters or more) and a service's `FRONTFALL_OAUTH_<SERVICE>_ID` and `_SECRET` are set, with `FRONTFALL_DATA`; the server then needs to reach Discord and Google, which the container of the bundled setup could not before. Accounts go in `accounts/accounts.json`. New routes `/auth/<service>`, `/auth/logout` and `/api/me` ([server](docs/server.md#accounts), [self-hosting](docs/self-hosting.md#sign-in-with-discord-or-google)). The protocol does not change for this: the session cookie goes with the game socket. Changing the session secret only signs everyone out.
- **Reports and bans for operators.** `GET /admin/reports` lists the reports of the last 30 days and the players most reported, each named by a keyed hash of their address that stays the same across restarts. `POST /admin/bans?target=…&days=…` bans an address or such a reference, `DELETE` lifts it, and `bans.json` under `FRONTFALL_DATA/moderation/` can be edited by hand and read again without a restart. Banned connections close with code `4005` ([server](docs/server.md#reports-and-bans)).
- Report a player follows `R-MODE-06` in the [rulebook](docs/rules.md). Protocol version 18: `report`, `reported`, the `too_many_reports` error and close code `4005` ([protocol](docs/protocol.md#report)). Pages loaded before the update are asked to reload.
- The texts of the interface now load one language at a time, so a page only fetches the language it shows.
- CI sets up faster: the browsers come from a cached action and the end-to-end tests run in three parallel shards. The WebKit end-to-end project now also plays the narrow-phone interface, the accessibility settings, the local profile and the achievements, besides the solo game, replays and globe it already ran.

## [0.5.0] - 2026-10-27

Public games you can keep tidy, honest error counts and a first look at where the look of the game is going. Nothing here changes how a game plays.

### Added

- **Remove a player from your lobby.** The host sees a Remove button next to every other player until the game starts (`R-MODE-05`). The player removed is told so, and cannot join that game again from the same network.
- **Hide a player.** In an online game, a player's menu now has Hide this player: on your screen only, their name becomes "Player 2" (their number) on the map, in the leaderboard and in the events, and their quick messages no longer reach you (`R-DIPLO-08`). The same button shows them again. Nothing changes in the game itself, and they are not told.

### Changed

- A public game takes at most three players from one network, so that nobody fills one with their own tabs. Private games, shared by invitation, keep no such limit. Pages loaded before this update are asked to reload once it is deployed (protocol version 17).
- **The error figures on [`/api/stats`](https://nclsmgr.com/frontfall/api/stats) are honest now.** `context_lost` showed up in almost every game, but it was the page freeing its own graphics context when a game ends or the view changes, not a real loss. Only a context the browser takes away is counted.

### For self-hosters and contributors

- One address may open 30 WebSockets a minute after a first 40, answered `429` beyond: set `FRONTFALL_CONNECTIONS_PER_MINUTE`. `FRONTFALL_SEATS_PER_ADDRESS` changes the three seats per address of public games, 0 for none, as for a LAN party behind one router ([server](docs/server.md#configuration)).
- The usage counts are no longer lost to a damaged file: each save keeps the one before as `usage.json.bak`, which the server falls back on, and every month's counts are also written to their own file in `usage/months/` (`2026-10.json`), added to and never cut down, so a month can be kept or collected before the 90 days of `/api/stats` run out ([server](docs/server.md#usage-counts)).
- Protocol version 17: `kick`, the `removed` reason of `ended`, the `removed` and `too_many_seats` errors ([protocol](docs/protocol.md#kick)).
- The direction for the game's new look is written down: [art direction](docs/art-direction.md) (terrain as relief, a set of icons drawn for the game) with mock-ups. It guides v0.7; nothing in the game uses it yet.

## [0.4.1] - 2026-10-25

Public games, games that survive updates and a fairer start on the maps of the north. Games running when this update is deployed end, once: the server before it could not keep them. After it, updates that leave the rules alone no longer cut games.

### Added

- **Public games of your own.** "Create a public game" opens a game under the name you choose (3 to 32 characters). You are its host: pick the map, the mode, bots, nations, what the game leaves out and the number of seats, from 2 to 16, then start it when you are ready, as soon as a second player is in. Tick "Start as soon as the game is full" to let it go by itself. Other players see it in the list until it starts.
- **A list of public games** in the menu, refreshed every few seconds: each game's name, map, mode, host and seats taken, and whether it is waiting or already in progress. Waiting games have a Join button.
- **Micho Palace** (`R-BUILD-08`): B, then a click on your land, builds a palace worth two cities on one tile. It costs what your next two cities would, counts as two cities towards the cities your land supports and the price of later ones, and once ready raises the troop cap as two cities do. It is captured and demolished like a city, and a game that leaves out cities leaves it out too. Bots and nations do not build it, though nations aim missiles at it as at a city. Protocol version 15 carries it as a `build` structure: pages loaded before the update are sent away to reload once it is deployed.
- **How to play.** The ? button, H or ? open a help that lists the controls in four short sections, and every building with its key, what it costs you now and where it goes. On a phone it gives the gestures instead.
- **First steps.** Your first solo game shows four steps that move on as you play: pick a start, expand, build a city, open another player's menu. Next skips one, Hide puts the guide away, and the help brings it back.
- **Your name from an invitation link.** A link to a private game first asks for the name the other players will see, filled with the last one you used, and keeps it for next time.
- **Keys on the build buttons.** Each button shows its key; on a phone, a long press on a button says what it does.
- **Updates no longer cut games short without a word.** When the server is about to restart for an update, a band at the top of the page counts the minutes down, and the update waits for running games to end. A game the update still has to stop ends with a message that says so.
- **Back in the game in seconds after a reload.** Your browser keeps a snapshot of the online game you play, 30 seconds in and then every two minutes. A reload starts from it and plays only the turns since, instead of the whole game from its first turn, which took tens of seconds late in a game. A snapshot that does not match the game is dropped, and the game is played from the start as before.
- **Games go on through server updates.** A game still running when the server restarts pauses for a few seconds, then goes on from where it was: your page reconnects on its own and you keep your seat. Only an update that changes how games play still ends it.
- **Server status page** at [/status](https://nclsmgr.com/frontfall/status): players online, games running, lobbies, and any update on its way.
- **Say how the game went.** The end screen asks whether you enjoyed the game: a thumbs up, or a thumbs down with one reason to pick if you like (too hard, too long, did not know what to do, slow or buggy). Next to it, and at the bottom of the menu, **Share an idea** and **Report a bug** lead to the project's GitHub, where I read everything.
- **The game counts how it is played, not who plays.** At the end of each game your browser tells the game's server the map, the mode, how long it lasted, how it ended, phone or computer and the language, plus any error that broke the game. No name, no address, no cookie, and nothing at all from a browser set to Do Not Track or Global Privacy Control. The server keeps only daily totals, which anyone can read at [`/api/stats`](https://nclsmgr.com/frontfall/api/stats); [every field is listed here](docs/privacy.md).

### Fixed

- **Aiming at the coast is easier.** A port, a warship or a ship sent across the sea no longer asks for a click right on the shore: a click within about 24 pixels of the coast finds your closest coast tile that can take it, 40 with a finger, at any zoom. On a large map zoomed out the coast is under a pixel wide, so a port almost never found it. Port and warship modes stay armed until one goes through, or until Esc, so a second quick click builds instead of attacking, and a click too far from any coast still says why.
- **Lobby settings stay as you set them.** On a slow connection, the host who changed several settings in a row could see one of them snap back, and the game started with the old value. Each choice now holds until the server has answered it.
- When an online game loses its connection, a notice now says so, with the time to the next attempt, instead of a map that silently stops. A player who cannot get their seat back is told that the game went on without them or is over, no longer that every player left.
- A solo game waits behind its end screen until you choose to keep watching. It used to play on, so the clock ran past the time limit and a replay saved a few minutes later held those minutes too.
- Players who join an online game under a name already taken in it, such as everyone who kept the default one, are numbered (Commander, Commander 2…) instead of looking alike in the lobby, the leaderboard and on the map.
- A game without ports no longer offers warships or embargoes: the lobby unticks warships with ports, and the player menu drops the embargo, which had no trade to cut and only declared a war.
- **Keys on AZERTY keyboards.** M did nothing and ? picked the missile mode. Command letters now follow the letter printed on the key, whatever the layout.
- **A dropped connection in a lobby keeps your place.** A phone that sleeps or a network that blinks gets 30 seconds to come back, with the host role if you had it, and lands in the game if it started meanwhile. In a running game, your seat now waits 5 minutes instead of 2, and up to 16 players can share one home or mobile network.
- **Reloading after a desync helps.** The page that says your game no longer matches the others asks for a reload; the reload now rebuilds the game from the start and clears the warning, instead of showing it again.
- Bots and nations build their port on the ocean, no longer on a lake where it found nobody to trade with. Building your own port on a lake shore still works, and a note says it trades only with ports on the same lake.

### Changed

- During the first 10 minutes, no more than two nations attack the same player at once, unless that player leads the map. A newcomer who expanded fast was too often the target of five or six nations together before they had a chance to defend.
- **More nations in the far north.** On World and Americas, Canada no longer has the Arctic to itself: Greenland, Nunavut, the Northwest Territories, Yukon and Alaska now play as nations, along with Iceland on World and Chubut in Patagonia on Americas. Canada used to win most games of nations on these maps; now no nation wins more than about one game in four. World has 70 nations and Americas 28, and games with nations last a few minutes longer.
- **"Play now"** replaces "Join a public game". It sends you to the fullest game opened the same way, never to one that waits for its host, or opens one in your name that starts by itself 60 seconds after you arrive, and no sooner than 30 seconds after a second player joins, so a third still has time. If nobody else came by then, bots join you so you are never left waiting. Its host can start it sooner, or stop the countdown once and start it by hand.
- Every online game now shows who hosts it. If the host leaves, or does nothing for two minutes while others wait, another player becomes the host, so a lobby never hangs.
- Every lobby has an invitation link, public games included.
- One player can have at most three games waiting to start at once, public and private together.
- Nations leave newcomers alone for 2.5 minutes instead of 2. A player who expanded fast was often the thinnest on the map when the grace ended, and eight to ten nations attacked them within the same minute.
- The reason a click was refused stays up for four seconds and names the building, as in "Port: …".
- Trade reaches farther on large maps: 500 tiles of sea, as before, on a map of 2^19 tiles, and 1,000 on World, where ports were often too far apart to trade at all. A long route pays more: up to 22,000 gold to each side on World.
- **Fewer reloads after an update.** An update that leaves the rules, the balance and the maps as they are no longer sends open pages away to reload, and a replay keeps playing across such updates. Only an update that changes how a game plays out does.

### For self-hosters and contributors

- **Hosting your own server** has [a guide](docs/self-hosting.md) and a ready [`compose.yaml`](compose.yaml): data volume, read-only container, time for running games to end on a stop, then HTTPS with Caddy or nginx, a sub-path, updates and checks.
- CI builds the image of each commit, starts it with that `compose.yaml` and plays solo and private games against it, then restarts it to check the data volume is kept.
- CI reports known advisories in the dependencies in the summary of its Check job, as a warning that does not fail the build.
- On `SIGTERM` the server stops opening games and lets running ones play on for `FRONTFALL_DRAIN_SECONDS` (20 s by default); `POST /admin/maintenance?minutes=N`, from inside the container only, announces a restart; `/api/status` gives the status page as JSON and `/api/games` the number of games running. Pushes to `next` can deploy a preview at `/frontfall-next/` ([server](docs/server.md#shutdown)).
- `pnpm balance` plays many headless games of one setup, bots, nations and a scripted player, and prints how long they last, who wins against their fair share, income from troops and trade, and missiles ([balance](docs/balance.md)).
- Pages and servers now compare a simulation build, a hash of the engine, the balance, the protocol, the maps and the setup of a game, instead of the commit. `node tools/simulation-build.mjs` prints it, and `/api/status` reports it as `simulation` ([protocol](docs/protocol.md#simulation-build)).
- With `FRONTFALL_DATA` set, the server no longer drains: on `SIGTERM` it writes the games still running to `games/` in that directory (seed, settings, seats and their tokens, the turn log; `0600`), and the next run of the same simulation build takes them back and deletes the files. `/api/status` says so as `keepsGames` ([server](docs/server.md#shutdown)).
- The Publish workflow no longer deploys at once when `/api/games` does not answer: it announces the update and waits, as when games are running.
- A self-hosted server reports its release in the `X-Frontfall-Release` header of `/healthz`, next to the build. The release number has one home, the version of the root `package.json`, read by the client and the server alike.

## [0.4.0] - 2026-10-25

Deeper game, then sea and missiles, released together: build cities and forts, ally and betray, face named nations, trade by sea, fight at sea, launch missiles, play in teams and watch your games again. Every rule of the [rulebook](docs/rules.md) is now in the game. There is no 0.3.0: both versions were checked and released as one.

### Added

- **Cities and forts** ([rules](docs/rules.md#6-structures)). Gold now buys structures, from the panel above the toolbar or with C (city), F (fort) and X (demolish). A city (60,000 gold) adds 5 % to the troops your land can hold; you may own one, plus one more for every 10,000 tiles of land (40,000 on World). A fort (30,000 gold) doubles the price of the land around it for attackers and halves what you lose there. Each structure of a kind costs half as much again as the one before, they keep their distance from each other, and they change hands with their tile.
- **Alliances and betrayal** ([rules](docs/rules.md#5-diplomacy)). A right click, a long press or a row of the leaderboard opens a player's menu to ask for an alliance, accept, renew or betray. An alliance lasts 5 minutes and can be renewed in its last minute; allies cannot attack each other. Whoever betrays an ally is marked a traitor, and their land costs half price for 30 seconds.
- **Nations** ([rules](docs/rules.md#8-bots-and-nations)). On the maps of the Earth and the quick maps, the countries of the map play from their capitals, under their own names. They hold their border when attacked, answer the attacker and build a fort facing it, fight one player at a time, and leave newcomers alone for the first 2 minutes. Start on a capital to take that nation's place. They are on by default, with a box in the menu and the lobby to turn them off.
- **Ports and trade** ([rules](docs/rules.md#7-units)). A port (O, 100,000 gold) goes on your coast. Every 10 seconds it sends a trade ship to another player's port within 500 tiles of sea, and when it arrives you both earn 2,000 gold plus 20 for each tile of the route. Transport ships still leave from any coast.
- **Embargoes**. A player's menu can stop all trade between the two of you; every player is told.
- **Warships**. Press V, then click your port, to buy a warship (250,000 gold, four at most); click on water to send your closest one to patrol there. Warships fire at the ships of players you are at war with: an attack or a landing between you in the last 30 seconds, or an embargo. An escort draws their fire away from a transport. Once an embargo has stood for 30 seconds, warships capture the other side's trade ships in range, with all the gold they carry.
- **Missiles**. A missile silo (L, 800,000 gold) launches a missile (M, 300,000) or a heavy missile (N, 1,500,000) at any land, every 30 seconds. The blast clears the land and its structures and kills a matching share of the owner's troops; a heavy missile's blast is wider and leaves fallout that nobody can take for a minute. A blast can never reach an ally or a teammate.
- **Air defenses**. An air defense (K, 1,000,000 gold) stops three missiles out of four that fly near it, then reloads for 10 seconds.
- **Teams** ([rules](docs/rules.md#9-victory-and-game-modes)). Free-for-all, or 2, 3 or 4 teams, in the menu and the lobby. Players are dealt into teams in turn, teammates share shades of one colour and can never fight each other, and a team wins together at 75 % of the land.
- **Replays**. The end screen saves the game as a `.ffr` file, and "Watch a replay" in the menu plays it again at ×1 to ×8. At the end, the bar says whether the replay reached the same state as the game.
- **Gifts**. A player's menu sends them a share of your troops or gold, set by the attack slider, as long as you are not at war; they take only the troops their land has room for, and every player is told.
- **Quick messages**. Eight short phrases and four emoji from a player's menu, seen only by the two of you, one every 2 seconds at most.
- **Private game options**. The host can leave out cities, forts, ports, missile silos, air defenses or warships for everyone, bots and nations included. A link does the same with `?off=silo,warship`.
- **Smarter nations**. Nations build a port after their first city, buy warships while an enemy landing sails for their coast, build a silo once they have two cities and an air defense once someone else has a silo, and fire missiles at whoever attacks them, or at a leader who holds 30 % of the land.
- The land under the mouse, or under a finger resting on a touch screen, lights up whole, and the edge of every attack under way marches with stripes, so fronts show on the map. The stripes hold still for players who ask their system for reduced motion.
- Bots build cities near their start, then one port, and accept an alliance from a smaller player they are not fighting.

### Changed

- Hard bots are stronger: they attack with more troops, keep fewer at home and take on denser neighbours ([balance](docs/balance.md#bots)). Easy and normal bots play as before.
- The panels over the map are opaque, so structures and ships no longer show through them.
- Ships stay readable when the map is zoomed out: trade ships and transports keep at least 6 pixels, warships 10, on the flat map and on the globe.
- The game loads faster: the simulation's download is down from 50 kB to 23.5 kB compressed.
- The beta label shows 0.4.0.
- Game protocol 13: replays and desync reports saved by earlier versions no longer play.
- For contributors: every change is held to a performance budget in CI, with 64 bots on World against the commit it branched from; `pnpm perf:engine` and `pnpm perf:client` run the same checks locally ([performance](docs/performance.md#budgets)).

### Fixed

- A build click that the game refused no longer turns build mode back on when the answer comes late, after a later click already built something.

## [0.2.0] - 2026-10-24

Online with friends: a player creates a private game from the menu, picks the map, the bots and their difficulty, and shares a link; every browser plays the same game in lockstep, and a desync is detected, reported and can be replayed. Eight maps, with the Panama and Suez canals open.

### Added

- **Online games in the browser**: the menu lists public games and opens private ones; the lobby shows the players, the countdown, the invitation link and the host's start button, and says when the page is outdated or a game expired. Every client runs the server's turns in its worker, with the bots the server asks for, and reports state hashes for desync detection ([docs/client.md](docs/client.md#playing-online)).
- Protocol version 3: the host of a private game picks the map, the number of bots and their difficulty (`configure`); the server accepts only published maps, and a small map or many bots leaves fewer seats. The `desync` message and log carry both hashes (protocol version 4).
- Online turns are evened out by a jitter buffer, so turns that the network bunches still play one per tick; a hidden tab keeps playing. Solo games run their turns down the same path.
- An online order keeps its ring on the map until the turn that carries it comes back from the server.
- A reload takes the online seat back: the tab rejoins the game, replays every turn and plays on with the others. Leaving from the menu gives the seat up.
- A desync offers a report to download. Engine: `DesyncReport` (version 1) holds the seed, map, balance, players, bots, turns and hashes of a game; `pnpm sim -- --replay report.json` plays one again and names the first tick where the client parted from the others ([docs/engine.md](docs/engine.md)).
- **Five more maps**: Americas, Africa and Asia from Natural Earth, and three small drawn maps, Island, Strait and Ring, for quick games and as test cases for a single landmass, a narrow strait and the east-west seam. The menu and the lobby list Earth maps and quick maps apart. The eight maps weigh under 400 kB compressed.
- Ships sail through the Panama and Suez canals on the World, Americas, Africa and Asia maps.
- Engine: golden replays of scripted games on Europe and World pin the state hash every 50 ticks; they run in Node with the tests and in Chromium and Firefox workers with `pnpm determinism`, and fail on the first tick that differs. The state hash now covers every balance value. `pnpm golden` writes them again after a change meant to alter games.
- End-to-end tests: a four-player private game without a desync, a reload during a game, and a forced desync whose downloaded report is replayed.

### Fixed

- Player colours show in the leaderboard and the lobby on servers whose content security policy forbids inline styles, as the public server does. The end-to-end tests run behind the same policy.

### Changed

- Nations on the continental maps start on their own continent and away from the map's edges.
- The server fits the seats of a private game to its map.
- The client is versioned 0.2.0, and the beta label shows it.

## [0.1.0] - 2026-10-24

The first playable beta: a solo game in the browser against bots on a map of the Earth or of Europe, with expansion, attacks, encirclement, retreat and ships across the sea, from the menu to the end screen. The relay server and protocol for online games are already in place.

### Added

- **Online games, protocol version 2** ([docs/protocol.md](docs/protocol.md)): a version handshake, binary frames for orders and turns, public games that start after a countdown or when full, private games joined by invitation link (`?game=<id>`), a list of public games at `/api/games`, reconnection with every missed turn, desync detection from client state hashes, and player name rules.
- Pages from an older build are asked to reload instead of joining a game they could desynchronise. Online games are played on the World map.
- Server protection and monitoring ([docs/server.md](docs/server.md)): a message rate limit per connection, idle connections closed, JSON logs that never record client addresses, and Prometheus metrics at `/metrics`, answered only to requests from the host.
- An operations runbook ([docs/operations.md](docs/operations.md)): logs, restart, rollback to a previous image and what to do after an uptime alert.
- `/healthz` answers `503` when the turn timer has stalled for 5 seconds or the server is shutting down, so an uptime check sees a server that accepts requests but no longer plays.
- The image caps the Node.js heap at 512 MiB, and `FRONTFALL_MAX_GAMES` and `FRONTFALL_MAX_CONNECTIONS` set the server's limits.
- Large static files, map files included, are served gzipped to browsers that accept it.
- Static files carry an `ETag`, so browsers revalidate maps and get `304 Not Modified` instead of downloading them again.
- Server limits: open connections in all, private games per address, orders per player per turn and the size of a game's turn log; a game not started within ten minutes ends with reason `expired`.
- Engine: the rules of a complete game of expansion, from `createGame`: `Topology` with flat and wrapping grids, exact integer arithmetic, the game state and its tick loop, validation of every order, the spawn phase, growth of troops and gold, expansion into unowned land, attacks between players, encirclement, retreat and victory ([docs/engine.md](docs/engine.md)).
- Engine: encirclement captures enclosed land of any player next to an attack's new tiles, not only of the player under attack, and also after expansion into unowned land (R-ATTACK-08). All fronts of a tick are planned before any attack moves.
- Engine: the population cap starts from the map's starting troops, so new and small players grow from the first tick (R-ECO-01). Bots of every difficulty are calmer: hard bots no longer wipe out a casual player within minutes on World.
- Engine: bots that have nothing left to take by land send transport ships to free or weaker land away from their own shore, with up to B-BOAT-MAX ships at sea (R-BOT-05). Large empires look at more of their border, so they no longer miss a narrow land front. A falloff of the population cap past a share of the map is available (R-ECO-06, off by default). A beachhead whose troops are still attacking is no longer captured by encirclement (R-ATTACK-08). Together these let a leader reach the 75 % win on World: between hard bots it now takes 7 to 8 minutes, where the leader used to stall around 62 %.
- Engine: only the pocket next to where an attack is aimed is spared from encirclement, so a token attack no longer shelters all of a player's land (R-ATTACK-08). Bots wait a few decisions before searching the sea again when it offered nothing, and no longer send a ship that cannot pay for a free beach.
- Engine: attacks spread as a wedge towards their aim instead of a thin line, and move twice as fast for the same cost (B-ATTACK-SPEED 4, B-ATTACK-SPREAD). Spawn spacing, radius and starting troops grow with the map (R-SPAWN-06).
- Engine: transport ships carry troops across the sea and land them on another coast, so players on different continents meet (`embark` order, R-UNIT-02).
- `pnpm determinism`, run in CI: the same bot game on World reaches the same state hash in Node and in a Chromium worker.
- Engine: `game.hash()`, a hash of the whole game state, pinned by a scripted test game.
- Engine: `TurnClock` closes turns from local orders for solo games and tests; `pnpm sim` plays a whole game headless and reports tick times.
- Project foundations: deterministic engine (seeded random generator, world grid that wraps east-west), turn relay server with lobbies, Three.js map view with endless east-west panning, CI, container image and automated deployment.
- Game rules specification ([docs/rules.md](docs/rules.md)) with rule identifiers, and starting balance values ([docs/balance.md](docs/balance.md)).
- Architecture decision records: deterministic lockstep, topology, renderer split, hosting under a sub-path.
- Clean-room policy and a CI job that compares every pull request with the reference codebase, by tokens for code and by hash for other files.
- End-to-end tests of the built game at `/` and under `/frontfall/`, run in CI and against the public server after each deployment.
- `/healthz` reports the running build in the `X-Frontfall-Version` header; the deployment waits for the new version to answer.
- Images are tagged with the version on `v*` tags.
- WebSocket connections are limited per player address, and the number of open games is capped.
- Pre-commit hook that formats and lints staged files.
- Map proposal issue form.
- **Maps from open data**: World (2048 × 1024, wraps east to west) and Europe (1280 × 1080), generated from Natural Earth by `pnpm maps` with coasts, relief, ocean depth, polar ice and 64 and 40 starting nations. The map format is specified in [docs/map-format.md](docs/map-format.md) and the generator in [docs/maps.md](docs/maps.md); the engine loads and verifies a map in about 30 ms.
- WebSocket protocol reference ([docs/protocol.md](docs/protocol.md)): connection URL, limits, and every message with an example.
- The interface is available in English and French, chosen from the browser's languages; the client can switch language without reloading ([docs/client.md](docs/client.md#translations)).
- The game says it is a beta, with its version, on the menu and during a game, until 1.0 ([docs/client.md](docs/client.md#beta)).
- **A new look for the map**: shaded relief, shallow and deep seas, surf along the coasts, crisp borders, tiles that fade in as fronts move, and player names with their troops on their land ([docs/client.md](docs/client.md#drawing-the-map)).
- Ships in the solo game: a click on a coast across the sea sends troops by ship, ships are drawn gliding at sea, and a click that sends nothing says why on the map ([docs/client.md](docs/client.md#controls)).
- Attacks under way are listed during a game, each with a Retreat button that calls it back ([docs/client.md](docs/client.md#controls)).
- The HUD states the win condition and shows how far the leader and the player are from it, with the time played.
- **Solo game in the browser**: a menu with map, bot count and difficulty, a game against bots run in a Web Worker, a HUD with troops, gold, land, attack ratio and leaderboard, pause, a help panel and an end screen ([docs/client.md](docs/client.md)).
- Engine: bots that expand into free land and attack their weakest neighbour, with three difficulty levels (`B-BOT-*` in [docs/balance.md](docs/balance.md)).
- Map controls: pan and zoom with the keyboard, zoom towards the cursor, pinch to zoom on touch screens, and a clear message when the browser cannot run WebGL 2.
- **The README is now the project's front page**, in English and French: brand banner, a Play now section, the milestone table, an architecture diagram, self-hosting and a four-step contribution guide. Bug and feature forms label new issues for triage.

### Changed

- The game stays in beta until v1.0, which is now the complete game on the 3D globe. The balanced flat-map version becomes v0.5, and the globe and performance milestones become v0.6 and v0.7.
- The roadmap now ships phase 1 as playable versions instead of milestones M1 to M5: v0.1 is a solo game against bots on a map of the Earth, v0.2 online games with friends, v0.3 structures, diplomacy and nations, v0.4 ships and missiles, then v1.0. Each version lists the checks that make it playable ([docs/roadmap.md](docs/roadmap.md)).
- The engine compiles without browser or Node types, and its lint rules also reject `Date`, `crypto` and floating-point `Math` functions whose results vary between browsers.
- Node.js 24 is required.
- Static files are served with cache headers: hashed assets are immutable, the page is revalidated.
- Desync detection compares every player's hash for the same tick and flags only those who differ from the majority, so one client cannot end a game for everyone with a false hash.
- The server trusts the `X-Client-IP` header only from a proxy on a private address, and accepts WebSocket connections without an `Origin` header, as sent by bots and tools.
- A client that cannot read a turn asks for a reload instead of playing on out of step, and one that notices a gap in its turns rejoins to fetch the missing ones.

[Unreleased]: https://github.com/nic0lasm/frontfall/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/nic0lasm/frontfall/compare/v0.6.4...v0.7.0
[0.6.4]: https://github.com/nic0lasm/frontfall/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/nic0lasm/frontfall/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/nic0lasm/frontfall/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/nic0lasm/frontfall/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/nic0lasm/frontfall/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/nic0lasm/frontfall/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/nic0lasm/frontfall/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/nic0lasm/frontfall/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/nic0lasm/frontfall/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nic0lasm/frontfall/releases/tag/v0.1.0
