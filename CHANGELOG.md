# Changelog

Every release of Frontfall and what it changes in play, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/); each version also has its notes on the [releases page](https://github.com/nic0lasm/frontfall/releases).

## [Unreleased]

### Changed

- **The sign-in buttons wear the Discord and Google logos.** In Your profile, the buttons now read "Sign in with Discord" and "Sign in with Google" (in French, "Se connecter avec …") with each service's own logo, in the colours the services ask for.

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

[Unreleased]: https://github.com/nic0lasm/frontfall/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/nic0lasm/frontfall/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/nic0lasm/frontfall/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/nic0lasm/frontfall/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/nic0lasm/frontfall/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/nic0lasm/frontfall/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/nic0lasm/frontfall/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nic0lasm/frontfall/releases/tag/v0.1.0
