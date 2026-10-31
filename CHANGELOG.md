# Changelog

Every release of Frontfall and what it changes in play, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/); each version also has its notes on the [releases page](https://github.com/nic0lasm/frontfall/releases).

## [Unreleased]

### Added

- **The gold of a trade ship, at the dock.** When a trade ship reaches a port, the gold it brings you now rises as a "+N" over that port, for your own ships and for those that call at your ports. Two ships docking together add up in one figure, and with reduced motion the figure stays still and fades.
- **Know who is attacking you.** The panel at the bottom left now also lists the attacks on your land (who, how many troops), and a click on a line takes you to the attacker. Counter sends troops back at them, as many as theirs or your attack share allows. It lists your ships at sea too, with their cargo, their target and the time left, and a ship of another player heading for your coast shows in red, with a line in the event feed.
- **A red rim when you are losing.** The screen edge flashes red when you lose land or an enemy ship sails for your coast, for players who play without sound. It stays still with reduced motion.
- **Back to your land.** Home, or Space when no button has the focus, takes the map back to your land, and so does a new button at the top of the minimap.
- **A word on your army.** The banner says when your army is full and no longer grows, and when very few troops are left.
- **Marks beside the troops.** A crown for the biggest player, a tick for an ally, a warning for a traitor, a barred circle for an embargo and an envelope for an alliance request, shown beside each player's troops on the map.
- **The Micho Palace and the Mosque of Cyrus are wonders.** You can build only one of each, as can every other player. The Palace is now worth five cities and costs the price of three, instead of two for two; the Mosque of Cyrus makes three tries at each missile instead of two, so it stops about 98 in 100 (against 75 for a plain air defense), and costs only twice an air defense. A second one is refused and costs nothing: its button greys out and says why.
- **A new tutorial, in five minutes.** The menu's "Tutorial · 5 min" starts a gentle practice game on the Strait, against two easy computer players and a few city-states, at double speed. It opens on what the game is, then a card in the corner gives one task at a time, thirteen in all: place your start, pick a doctrine, grow on free land, choose how many troops attack, put workers to work, take a city-state, build a city, a port and a fort, ask a neighbour for an alliance, then diplomacy (gifts, embargoes, tribute, traitors), missiles and air defense, and how a game is won. The steps that cost gold show how far your gold is from the price, any step can be skipped, and the last one leads to five rules to keep and a real game.
- **Doctrine cards that leave the map in view.** The doctrine cards now fold to a line each on a phone, and only the one you chose spells out its effects, so that the map stays in view to place your start. On a phone they now sit above the bottom bar instead of over it, so the sliders stay in reach, and the tutorial's card sits under the line that tells you to touch a land instead of hiding it. On a computer the doctrine cards sit above the bottom bar too, and the tutorial's step on the share of troops now moves on when you use the shortcut (Shift and a digit), not only the slider.
- **Doctrines.** In every game that keeps them on (the default, public games included), everyone picks one of three doctrines before the start, each a small edge with a small cost: the Conqueror attacks faster and loses fewer troops taking land, but earns and holds a little less; the Merchant gets more gold from trade and income, but pays more troops to take land; the Bastion holds more troops, loses fewer when land is taken and builds cheaper forts, but attacks more slowly. No pick plays the balanced doctrine, which changes nothing. Nations pick one too, and everyone sees every doctrine once play starts.
- **Point at a ship to read it.** Resting the mouse on a transport, trade or war ship shows a card with its owner, what it carries (troops aboard, goods, or its health left) and where it is bound. On a touch screen, press and hold the ship.
- **Point at bombed land to read it.** Resting the mouse on land under fallout shows a card with the missile (light or heavy), that taking a tile there costs twice the usual price, the seconds before it clears, and who fired it when the missile came down in this game. On a touch screen, press and hold unclaimed irradiated land.
- **City-states.** Games with nations now come with small city-states scattered across the map, six for each nation (420 on the world map). They are weak, never ally with anyone and nobody can ally with them, and whoever takes their last tile takes their gold: they are where everyone, you included, finds land and gold early on. You only hear of the ones you take.
- **Land by boat along a shared border.** When you touch a player by land, a click always attacked by land. You can now choose the boat: hold Shift and click their coast, or press and hold their land and pick "Land here by boat" in the player menu. The troops sail from your closest coast and land where you pointed.

### Changed

- **A heavy missile no longer wipes out a whole army.** It used to kill three times the share of troops that matched the land it took, so a blast over a third of a player's land killed every soldier they had. It now kills the share that matches the land it took. The light missile is unchanged.
- **The first steps of a first game** now also cover the doctrine, the share of troops that attacks, a fort and asking a neighbour for an alliance, and end on how a game is won.
- **Pay tribute for peace.** A weaker player can pay a clearly stronger one for a two-minute truce: neither can attack the other, and the stronger keeps the gold. A truce is not an alliance, so it takes no gifts, and either side may break it as a traitor.
- **Diplomacy takes a step.** Attack or land on a player and their ports shut to you for five minutes, unless you become allies first. They can keep the embargo longer or lift it. Gifts of troops and gold now go to allies and teammates only. An alliance can be renewed in its last 30 seconds instead of 60. Each row of the leaderboard says what a player is to you: at war, embargoed, hostile, wary, friendly or neutral.
- **Your figures explain themselves.** Rest the mouse on, or press, Troops, Gold or Land: a card says what the number is made of (troop cap, soldiers and workers, base income and workers' share, tiles and the winning share). It works with the keyboard too.
- **A greyed building says why.** Point at a building you cannot place yet, or press it: its card tells what is missing (gold to find, a loaded silo, a finished port, room for a city).
- **End screen buttons.** With three buttons, "Play again" takes a row of its own and the other two share the next, instead of one left alone.
- **A quieter screen.** The banner no longer repeats the attack panel, and a card of figures or of a building goes away at your next touch.
- **Keep playing after the game is decided.** Choosing "Keep watching" on the end screen no longer takes your orders away: if you still hold land, you can attack, build, trade and talk to the others while the game goes on. Only a player who has been wiped out just watches.
- **A new economy, on the genre's classic footing.** Every number that drives growth, gold, trade, prices and computer players was rebuilt from the values the genre's reference game has used for years, so the game has a stable base to tune from. Fronts that collapse, the pace of attacks, workers, the palace and the mosque stay Frontfall's own.
  - **Population.** Everyone starts with room for 10,000 troops; land adds room ever more slowly as it grows, and each city adds 25,000. Troops grow slowly when your army is small, fastest a little under half your cap, and stop at it.
  - **Gold.** Every player earns 1,000 gold a second whatever their size. Putting troops to work adds up to one and a half times that again, in proportion to how much of your cap works; a huge idle army no longer earns anything by itself.
  - **Trade.** Each port tries for a ship every second, more often when you have few ports, less often when the seas are crowded. A ship now pays far more for a long route: about 1,000 gold for a short hop, 52,500 for 300 tiles of sea, 125,000 for 1,000.
  - **Prices.** Cities and ports cost 125,000 and double with each one, up to a million; forts cost 50,000 more each, up to 250,000; air defenses 1.5 million more each, up to 3 million; silos a million, missiles 750,000, heavy missiles 5 million, warships 250,000 more each.
  - **Taking land.** Free land costs 1.6 troops a tile (2 on hills, 2.4 on mountains). A player's tile costs more when you attack with fewer troops than they hold and less with more, plus their soldiers per tile; huge empires pay less to attack and to be attacked, and bots' land is cheaper.
  - **Nations.** They take free land first, then turn on a player once their army reaches half or more of their cap, and send what they have above a reserve. Each difficulty gives them a way of picking targets: easy nations answer their attacker and go for the weakest neighbour; normal ones also hold grudges, punish traitors and gang up on a runaway leader; hard ones answer every attack at once, keep troops back against their strongest neighbour and prey on the weak and the already beaten. Easy nations hold half the troops of a player and start with half as many, normal ones nearly as many as you, hard ones as many and decide faster; easy nations leave a human player alone three times in four, normal ones once in four, and an easy nation never attacks you while your army is under a third of its cap, even if you attacked it: a new player who sent everything gets the time to rebuild. They no longer wait out a grace period.
  - **Alliances with nations.** A nation answers your request once and sticks to it. Early in the game most nations shake hands; later they want a partner about as strong as they are, and at normal and hard they take the hand of a player they fear. They now ask you too, now and then.
- **Your last land is never swallowed whole.** Land surrounded by a single neighbour still goes to them at once, except when it is all you have left: they now have to fight for it, so a small start boxed in by a city-state and the sea no longer ends your game in a blink.
- **Games recorded before this version can no longer be replayed.** They were played under the old economy.

### Fixed

- **A blank map now says why.** When a browser (Brave with its fingerprinting shield, for one) creates WebGL 2 but draws nothing, the game now stops with a message that says what to change instead of leaving an empty map under the controls.

## [0.9.4] - 2026-10-30

### Added

- **The Mosque of Cyrus.** A new building, next to the Micho Palace (key J): an air defense twice as effective. It tries twice to stop each missile that flies within its range instead of once, so it stops about nine in ten (against three in four for a plain air defense). It costs what your next two air defenses would, counts as two after, takes as long to build as an air defense, and is left out of a game that leaves air defenses out. Nations do not build it.

### Fixed

- **A missile blast is a disc.** A missile's blast was a diamond, a good third smaller than the circle drawn around its target. It now burns the whole disc, so the land it takes matches the radius you see; heavy missiles reach further than before.

### Changed

- **Irradiated land can be taken back.** Land under fallout is no longer closed: you can attack or land on it at once, at twice the usual price while the fallout lasts (90 s after a heavy missile, 30 s after a light one). The marked zone on the map shows how long that lasts.
- **Easy nations offer peace.** At easy, after five minutes, a nation proposes an alliance to a smaller neighbour who has not attacked it. Normal and hard nations still only ally with friends.
- **A calmer pace.** A normal game now plays a quarter slower: everything happens at three quarters of its former speed, in solo, in private lobbies and in public games, and the other speeds scale with it. Nothing else changes: the same moves cost the same, so only the clock is slower.
- **Play now opens on Lyon.** The quick game now starts on the Lyon map, with its nations and landmarks, instead of the whole world, and the menu fetches its files ahead so it starts sooner. Games you create yourself keep the map you pick.

## [0.9.3] - 2026-10-30

### Fixed

- **Easy is really easy.** Easy nations are slower and calmer: they expand and decide more slowly, send smaller attacks, wait ten minutes before turning on you instead of five, and fire a missile every ten minutes instead of every four. A newcomer is no longer overrun by the whole map a few minutes in. Normal and hard are unchanged.

### Changed

- **A menu that opens sooner.** The generated maps' pictures are drawn when the game is built, the graphics check runs when the browser is idle, the map's ground is prepared in the background while the menu waits, and the chosen map and the simulation are fetched ahead, so a game starts sooner.

## [0.9.2] - 2026-10-30

A new look and a livelier battlefield: the map as stained glass, ships, buildings and missiles drawn as real objects, volumetric explosions, fallout zones you can read, nations with a memory and a voice, and a server now in France.

### Added

- **Nations with a memory and a voice.** Each nation now remembers what you do to it and tells you how it feels about you when you hover over it or open its menu: hostile, wary, neutral or friendly. Attacks, landings and missiles anger it, gifts, alliances and help against its enemies win it over, and time heals both. Nations talk with quick messages and emoji: they greet new neighbours, ask you to leave them alone, thank you for a gift, answer alliance requests with a thumbs up or down, and call on their allies to turn on the leader. They ask their friends and the neighbours of a runaway leader for alliances, heed your "Let's be allies" and "Help me!", attack whoever attacks their allies or send them troops, place an embargo on players they are hostile to, and never forgive a betrayal soon: the betrayed nation turns on the traitor at once. And they can betray too, at every level, rarely at easy: a nation eyes a much weaker ally on its border, grows wary of them in plain sight, gives a thumbs down, then says sorry and attacks. Grow, keep troops at home or stay in its good books, and it thinks twice.
- **Half speed.** Games can now also run at ×0.5, for a calmer game or to learn: in solo with the speed button (or T) and in the pause screen, and for the whole game in a private lobby. Everything happens twice as slowly, the time limit included, and the replay is the same at any speed.
- **A statistics page.** `/stats.html` draws the server's public figures: games per day over the last 90 days, the maps played and how long games last, every value written out as well as drawn. It counts games as each player's page reports them, so a game of four counts four times, and leaves out browsers that ask not to be tracked. When the server gives no figures, it opens a saved copy of `/api/stats` instead.
- **Fallout zones you can read.** The land a missile leaves unusable is now marked out on the map: hatched in olive, outlined with dashes, and cut to the land so it never spills over the sea. A countdown arc runs down clockwise from the top, with a mark every 10 seconds, and a warning triangle sits at the centre, so you can tell at a glance how long the ground stays closed. Two zones that overlap are hatched in opposite directions and read as a grid. Nothing depends on colour alone, the zone fades out in its last seconds, and with reduced motion it does not blink.

### Changed

- **A faster start.** The menu appears about twice as fast: the pictures of the generated maps are drawn once when the game is built instead of on your device, and the check for WebGL waits until the menu is up. Pressing Play also opens a game much sooner: while you read the menu, the browser quietly fetches the chosen map and the simulation, and bakes the ground of the map in a background worker, so the page no longer freezes for about a second when a game begins.
- **Real ships on the sea.** Ships are no longer little plates: each one is a hull seen from above, painted in the colour of its owner, and you read what it is at a glance. A warship is slim and pointed with turrets, a transport is a blunt barge with its troops on deck and a ramp at the bow, a trade ship is long and carries stacks of containers. They turn to face where they are going, throw a bow wave, and leave a wake of foam that stays on the water behind them and never crosses the shore. Zoomed out, a hull gets wider and gains a pale outline so its colour and its kind still read on a phone; close up, all the detail and a soft shadow appear, with no jump in between. The light graphics profile draws the same hulls without the shadow and the shading, and reduced motion keeps the foam from drifting.
- **A new look for the interface: the campaign table.** Panels are now night leather with a brass rule and a stitched seam, buttons are keys that stand proud and sink when pressed, the sliders have a grooved rail and a brass knob, and labels are brass over cream figures. The buildings of the build bar and the help are small painted miniatures that wear your colour. On a phone with the buildings open, the reason a click was refused now shows over the first-steps guide instead of hiding behind it.
- **Explosions with volume.** A missile that comes down now makes a real blast instead of a flat disc: a white flash, a rolling fireball that cools to soot, a column of smoke lit by the same light as the relief and throwing its shadow on the ground, a shock wave with dust behind it, sparks, embers and clods of earth, as wide as the area it really destroys, wider than a thumb even from far away. A strike far from the screen costs nothing, at most four blasts play at once, wide ones are drawn at half resolution so a phone keeps its pace, and the light graphics setting leaves out the finest details. With reduced motion a strike is still a single fading disc.
- **Buildings painted as figurines.** Cities, forts, ports, the Palace, silos, air defences, capitals and landmarks are no longer flat plates with a white symbol: each is a small painted figure standing on a base in its owner's colour, lit from the north-west with a soft shadow, with the roofs and banners in the owner's colour too. They are drawn larger on the world map (at least 26 px, the Palace 28 px, capitals and landmarks bigger) so the city, the fort and the Palace no longer look alike from afar, and they gain windows, crenels and flags as you zoom in. When many of a player's cities, forts or ports crowd together on a zoomed-out map, they are shown as one figure with two companions and a small coin with their number, and they spread out again as you zoom in.
- **The map as stained glass.** The ground is lit from the north-west with real relief: ridges, rock and snow on the mountains, patchy plains, darker forests. Each country is a tint of translucent glass over it, brighter at its edge, inside a crisp dark line. Attack fronts are a thin line of ember with sparks and smoke instead of wide stripes, and the sea gets depth, a swell, glints and surf that creeps in. It all holds still with less motion and is lighter at world zoom.
- **Missiles that count.** The land a missile strikes now stays unusable for 30 seconds, so neither you nor anyone else can take it back at once, and the strike kills three times as many of the soldiers there as before. The heavy missile covers a much wider area, half as wide again, leaves the land unusable for a minute and a half, and costs 3,000,000 gold instead of 1,500,000. Nations fire half as often, so the game is no harder.
- **Missiles you can follow.** A missile in flight is now a real object: a steel body with a band in the colour of whoever fired it and a glowing tail, rising on an arc over the land with its shadow on the ground and a trail of smoke behind it. Where it is headed, a dashed circle shows the exact area it will hit, closing in and pulsing faster as it arrives. With reduced motion the flame, the smoke and the pulse hold still, and on a weak device the shadow and the smoke's grain are left out.
- **Smoother coasts and borders.** Zoomed in, coastlines are drawn as smooth curves instead of steps of tiles, and the borders between countries bend softly instead of following the squares of the map; a country's reach over the ground around it is a little wider, so lone tiles and thin necks round off too.
- **A clearer tutorial.** The first steps are now six instead of eight, each in short sentences with one thing to do: place your start, expand, set the share of troops with the slider, build a city, build a fort, offer an alliance. The control a step asks for is ringed on screen (the slider, the City or Fort button, or the build button on a phone), and moving the slider moves the guide on. After you place your start, the guide says to wait for the countdown instead of asking you to expand too early. Ships and ports are left to the help, which now also explains fronts (H or ?), and the tutorial game now plays at easy.

- **A clearer game screen.** On a phone the attack slider now has its figures over it and a rail three times longer, with a bigger thumb and a filled track. Hovering or focusing a building shows a bubble with what it does, its keys and its price. Buildings carry their kind on top of the button as well as in colour (a bar for the economy, a short one for defence, a dotted one for weapons, a striped one for demolition), and the chosen one is pushed in and ringed in white instead of looking like the weapons beside it. On the end screen the title is larger and the achievements you earned come before the chart. The help shows bigger pictures, two buildings to a row on a wide screen, and its back button stays in sight. Tools, the folded map and the chart tabs are 44 px everywhere.

### Fixed

- **The privacy page says where the server is.** The game's server now runs at OVH in Gravelines, France, inside the European Union, instead of Canada; the privacy page, in English and in French, no longer mentions a transfer outside the Union.

- **A missile stopped in the air no longer explodes on the ground.** When an air defense or a shield landmark stopped a missile, the game drew and played the same blast as for a strike, where the missile had been last seen. Now only a missile that comes down makes a blast, on its target; one that is stopped bursts in the air with a short, cooler flash and a ring on the air defense, and makes no impact sound.
- **The menu shows sooner.** The page used to draw the pictures of the three quick maps before showing anything, which kept it blank for a fraction of a second on a laptop and longer on a phone; they now appear a moment after the menu. The page also starts downloading its language texts, the map list and its font together with its code instead of one after the other.
- **One click is enough on the troop and worker sliders.** A press anywhere on the track now sets the value there, with a mouse or a finger, and keeps following while you drag: the middle reads 50 % without catching the handle, and a press no longer has to be repeated. The keyboard works as before.

### For self-hosters and contributors

- **`/api/status` tells when the server started.** Its new `startedAt` field changes with every restart, so a script polling the server can tell a restart from games ending. `pnpm announce` uses it to post when a running public game ends, without a winner ([self-hosting.md](docs/self-hosting.md#announce-public-games-on-discord)).
- **Announce public games on Discord.** `pnpm announce`, run next to a server with `FRONTFALL_URL` and `DISCORD_WEBHOOK_URL`, posts each public game once, when it opens, with its map, its seats and a link to join. It mentions nobody, escapes the names players type, and never prints the webhook address ([self-hosting.md](docs/self-hosting.md#announce-public-games-on-discord)).

## [0.9.1] - 2026-10-29

Easier to start and to sign in: nations that accept alliances, every level eased and games that start at easy, one account for Discord, Google and email, and a handful of fixes to taking a game back.

### Added

- **One account, several ways to sign in.** Signed in, open your profile and add Google, Discord or an email address to the same account, then sign in with whichever you like. If the one you add already has an account of its own, the game asks before merging the two: you keep your current name and the achievements of both, and the other name becomes free. Nothing is ever joined without you, and a way to sign in can be taken off as long as another is left.
- **More operator's tests.** Next to double gold, the operator of a server can now give themselves double troops, structures at half price and double defense in a private game they host, each on its own box. As before, nobody else can have them, the lobby and the end screen tell every player of that game, and such a game counts for no statistics or achievements.

### For self-hosters and contributors

- **Protocol 25.** `configure` takes `operatorBonuses`, a sum of bonuses, in place of `operatorGold`, and `lobby` and `started` carry `operatorBonuses` in place of `goldBonus` ([R-MODE-09](docs/rules.md), [protocol](docs/protocol.md)). Pages from before this release reload on their next connection.

### Changed

- **Nations make alliances.** Ask a nation for an alliance and it now answers: it accepts when you are not fighting it, have not betrayed anyone lately, are less than half again its size and it has fewer than two allies, and it renews on the same terms. Your ally never attacks you. The player menu says these terms before you ask. A nation still never asks first.
- **Every level is easier.** Nations leave you more time to take free land before they turn on anyone: 5 minutes at easy instead of 3, 140 seconds at normal instead of 100, 115 at hard instead of 90. In our test games a steady player now wins almost every game at easy, about one in three at normal and one in four at hard.
- **Easy by default.** A new solo game, a quick game and public online games now start at easy; pick normal or hard in the menu or the lobby when you want more. A setup you chose before is kept.

### Fixed

- **Signing out in plain sight.** Signed in, the menu now says how under your name, with a Sign out button there, instead of a small link inside the closed profile card.

- **The gold a second counts the base income.** The bar showed +13/s while you earned over 500: it left out the 500 gold every player gets. It now counts it, and its tooltip says so.
- **A game taken back shows itself at once.** After a reload, the solo game waiting in pause now shows its map, figures and first-steps card as they stand, instead of an empty screen and "Loading the map…" until you pressed P. The game is also kept every 15 seconds instead of 30.
- **An online game offered back sooner.** Reopen the game within 15 seconds of closing a tab and the menu used to offer nothing; it now offers "Resume" as soon as the seat is free.
- **Landmarks announced together.** On Paris and Lyon, the five landmarks of the map open the game in one line of the feed instead of pushing each other out.
- **A clean end screen.** The first-steps card and the attack line no longer stay behind the victory window.

## [0.9.0] - 2026-10-29

Smooth and quick: a lighter picture for phones and dense screens, orders that answer at once, new sounds and a score, a guided start and games you can take back, two city maps, and a server that holds thousands of players.

### Added

- **A Graphics setting, and a lighter picture for phones that struggle.** The menu's Accessibility section has a new Graphics choice: Automatic (the default), Light and Sharpest. Automatic picks by your device: a weak one gets the light picture, the flat map drawn at your screen's own pixels, a phone gets the full map at 1.5 times its screen's pixels instead of twice, and a game that still cannot keep up at the lowest sharpness switches to the light picture by itself and remembers it. Sharpest keeps the picture as sharp as the screen allows whatever the device. The choice applies to the next game.
- **Eliminate a country, take its gold.** Whoever takes the last tile of a player, a bot or a nation now takes all of their gold, instead of it vanishing. In capital mode, taking a capital brings all of its owner's gold too, no longer half. The events feed tells everyone who eliminated whom and for how much, and your own gold counter shows what you just took, rising over it. Land a missile leaves to nobody still eliminates nobody.
- **An operator's test bonus, said to everyone.** The operator of a server, signed in to their own account, can double their own gold in a private game they host, to try long games and late structures faster. Nobody else can have it, it is never offered in public games, and the lobby and the end screen tell every player of that game; such a game counts for no statistics or achievements. A self-hosted server has it off unless its operator lists their account ([server.md](docs/server.md#operator-gold-bonus)).
- **Measure a phone with `?perf`.** Add `?perf` to the game's address and a small panel shows the map's frame time, with a button to copy a report of the device, the picture used and how frames fared.
- **The first steps now cover fronts and ships.** Your first solo game's guide grew from six steps to eight: after your first attack, a step explains fronts that give way (and that a fort holds), and after your first building, one explains sending troops across the water by ship and what a port is for. Both move on by themselves when it happens, or with Next, and both read as taps on a phone. The game itself is no easier.
- **A tutorial, whenever you want it.** A Tutorial button under Play solo starts a short guided game on a small map with two nations at normal strength, and shows the first steps whether or not you put them away before. It leaves your solo setup as it was, and Play again replays the tutorial. The guide is a card you can read with the keyboard or a screen reader, and on a phone it speaks of taps. It loads only when you start it: the first visit is no heavier.
- **A map ready when the game starts.** In an online lobby the map downloads while the players gather, so the start no longer waits for it.
- **Light vibrations on a phone.** An attack against you, a land taken, a victory and a defeat each give a short buzz. A switch in the Accessibility panel turns it off; it is also off when reduced motion is on. Only on devices that can vibrate.
- **Pick up a game where you left it.** A solo game is now kept as you play: reload the page and you are back in it, paused, where you were; close the tab or let your phone drop it, and the menu offers it back next time, with "Resume" or "Drop it". An online game you closed by mistake is offered back the same way, as long as the server keeps your seat (5 minutes). A game is forgotten once it ends or you leave it from the menu.
- **Light background music.** A calm score of marimba, kalimba and soft strings plays under the game and follows how it goes: a few quiet notes in peace, a pulse of drums when you attack or are attacked, a fuller sound as your share of the map grows. It is composed as you play, from a handful of chords, so it never loops the same minute twice. It starts with the game once you have clicked or pressed a key, fades out when the game ends, and stops while the tab is hidden. It has its own volume slider in the menu's Accessibility section, next to the effects slider (a lower default, 35 %), and the mute switch, now "Mute all sound", silences both.
- **More sounds.** The game starts with a soft call; finishing a city, a fort, a port, a palace, a silo or an air defense each sounds different; a missile lands with a boom wherever it falls, yours or not; a request for an alliance, a betrayal by an ally and losing land to an enemy each have their own sound.
- **Two city maps: Paris and Lyon.** Fight street by street across the real lie of each city, built from satellite land cover and elevation. In Paris, the Seine winds from Bercy to Boulogne with the Île de la Cité in its middle, the Bois de Boulogne and the Bois de Vincennes are woods that slow an attack like hills, and the heights around the river valley, from Montmartre and Belleville to Montparnasse, stand up as hills and mountains. In Lyon, the Saône and the Rhône close in on the Presqu'île and meet at the Confluence, Fourvière and the Croix-Rousse rise above them and the Parc de la Tête d'Or is a wood with its lake. Ships sail the rivers, so a port on the Seine or the Rhône can trade and land troops across the water. Nations are named after the arrondissements and quarters they start in, Montmartre, Belleville, the Quartier latin, the Croix-Rousse, the Presqu'île, and the towns around: 37 in Paris, 19 in Lyon, which reaches east to Décines. Both maps are listed with the world maps and load only when you pick them.
- **Landmarks in Paris and Lyon.** Each city has famous places worth taking, marked on the map in the colour of whoever holds them and announced to everyone when they change hands. In Paris, the Louvre brings 20 % more gold, the Parc des Princes grows your troops 15 % faster, Sacré-Cœur makes the land around it twice as costly to take, the Eiffel Tower stops one missile in two flying near it, and the Arc de Triomphe makes every tile your attacks take 10 % cheaper. In Lyon, Le Crayon brings 20 % more gold, the OL stadium grows your troops 15 % faster, Fourvière guards the hill around it, and the Port Édouard-Herriot adds 50 % to the gold of each trade ship. Rest the mouse on a landmark, or press and hold it on a phone, and a card tells what it gives, in numbers, and who holds it; the help lists every landmark of the map for the keyboard.

### Changed

- **Fights take time, and cost both sides.** An attack on a player now moves at the pace of its front: the longer the border it pushes on and the stronger it is against the soldiers facing it, the faster it goes, up to a fifth of the front's length each tenth of a second. A neighbour is no longer swallowed in a second, and a few armies falling on you at once leave you time to answer: every tile taken still costs the attacker troops and kills the defender's. Unowned land is taken as fast as before. To keep the game as hard, normal nations are sharper: they decide every second, keep more troops at home and end their grace after 100 seconds instead of 120.
- **No more limit on cities.** Your land no longer caps how many cities you may build: each city simply costs half as much again as the last. The message "Your land does not support that many cities" is gone, and the bar counts the cities you have built.
- **Gold for everyone.** Every player now earns 500 gold a second whatever their size, on top of the gold their troops and trade bring, so a first city comes within the first minutes even for a small country.
- **Warship mode says what to do.** Clicking water with no warship yet now says to buy one at a port first, and when you have ships but none can reach that water, it says to pick water linked by sea to one of them. The mode's help line explains both steps.

- **Sound effects, redone.** Every effect is now a small instrument played in a warm room instead of a bare beep: wooden bars, thumb piano, soft strings and drums. Each one has several variants, so a long game no longer repeats the same few clips. Sounds are placed by where they happen: a conquest on the left of the screen sounds on the left, one far beyond the edge is quieter, duller and echoes more, and looking at the whole map from high up softens everything a little. Your own actions stay clear wherever the view is.
- **Back in the game sooner after a network hiccup.** An online game notices within a few seconds when its connection has died without a word, as when a phone switches from Wi-Fi to mobile data or wakes up, and reconnects on its own; when the network comes back or you return to the tab, it tries at once instead of waiting for its next attempt.
- **Softer changes of screen.** The menu, the lobby and the game fade in instead of cutting; with reduced motion, they simply appear.
- **The two sliders say what they do.** In the bar, the attack slider has a sword and the workers slider a wrench, and each shows its value as it will play: the troops an attack sends (30% · 954) and the gold a second the workers add (40% · +25/s), live as you move it. Short tooltips explain each, screen readers hear the same, and on a phone the workers slider in the buildings tray carries its name.

- **A right click leaves a build mode.** With a building picked (a city, say), a right click on the map goes back to attacking, like Esc, without opening the player menu. Without a build mode, it still opens that menu.

- **The bar at the foot of the screen no longer moves.** Your troops, gold and land keep a fixed room, and figures show at most three digits (124K, 1.24M), so the bar and the sliders beside it stay still as the numbers climb, on computers and phones.

- **Taps on a touch screen no longer turn into drags.** A finger that wobbles up to 12 pixels while it taps still picks the tile, instead of moving the map by a hair and picking nothing.

- **Thousands of players on one server.** The game server now sends turns spread over each tenth of a second, so turns keep their pace at several thousand players at once, a player who reloads mid-game catches up without slowing anyone, and a connection that stalls no longer weighs on the server.
- **A full server says so.** When the server is full, the game tells you and tries again by itself, instead of showing a lost connection; and after a server restart, pages come back spread over time instead of all at once.
- **The line about expanding goes away for good.** The note at the top of the game that says to click or tap land next to yours no longer comes back once you have sent your first attack, in that game or any later one, on a computer or a phone. It frees the top of a small screen; the help and the first steps still explain it.
- **A smoother map on high-density screens.** Moving, zooming and playing no longer stutter on a laptop whose graphics chip cannot draw every pixel of a Retina screen sixty times a second: the map is drawn a little less sharp while frames fall behind, and back at full sharpness as soon as they keep up. Phones draw the map at most at twice their screen's resolution. The map's shading also does less work for the same picture: borders up close, the sea's swell and the grain of the ground are cheaper to draw.
- **Games run lighter.** Each turn of a game takes about a third less time to work out, on the server and in solo games alike, and capital mode games with many nations up to three times less: a capital that moves no longer searches the whole map, and fronts, encirclements, ships and forts do less work for the same result. Nothing about the rules changes.

- **Your orders play at once in a solo game.** An order no longer waits up to a tenth of a second for the game's next beat: that beat plays as soon as the order is given, and the one after keeps its time, so the game runs at the same pace.
- **Orders answer sooner.** A ring now shows under the pointer the moment you press on the map, instead of after you let go and the game has read the click; it turns into the usual answer once the order is read. Online, a turn that the network or a busy page delays no longer holds back every turn after it for three seconds: it plays a little late on its own, so your orders come back sooner, by about 60 ms in our measurements and much more after a hiccup.
- **Fewer hitches on every tick.** Taking in each turn of the game costs the page about a fifth of what it did: the panels, the names over the land and the leaderboard no longer redraw what has not changed, so frames keep coming while the bots attack. Names over the land are also placed faster.

### Fixed

- **No more "This land is already yours" on an enemy.** When your attack took a tile a moment before you clicked it, the click was refused although the map still showed the enemy there. It now goes at the enemy's land right beside it.
- **The attack slider is wide enough for a finger on a phone.** On a narrow screen it was squeezed to a few pixels beside the buttons while attacks were open or the buildings tray was out; it now keeps at least 44 pixels, and on the narrowest phones its sword icon steps aside to make room.
- **The first steps keep off the buildings tray.** On a phone, the first steps' card no longer sits behind the open tray: it moves under your figures, and in a short window it waits until the tray closes.
- **A tutorial you reload comes back.** Reloading the page a few seconds into a solo game or the tutorial now takes you back into it, where it was kept after only three seconds of play instead of fifteen.
- **The music slider starts at 35 %.** It showed 40 % because its steps were too coarse; it now moves in steps of 5.

### Security

- **Names that only look like someone else's are refused.** A player name can no longer pass for a staff name with look-alike letters from another alphabet, full-width letters or accents, be invisible, or pile up stacked accents. In a game, and against an account's name, two names that read the same count as one: the second player gets a number after it.
- **Limits that one network cannot dodge.** A player on IPv6 now counts as their whole home network for the per-address limits and for bans, as every IPv4 player already did. Sign-in links by email are limited to ten a day for one network, and to two then one every ten minutes for one mailbox, however the address is spelled.
- **"Play now" only sends you into a standard game.** A quick game whose host changed its map, teams, bots, nations or other options no longer takes players who pressed Play now. One network may have ten games open or running at once, so a handful of players can no longer fill the server with empty games; the message says to start, finish or leave one first.
- **No false desync warning.** In a game where the players' checks disagree with no clear majority, nobody is told their game went out of step any more: one player could make an honest opponent look out of sync.
- **Account changes only from the game's own page,** even on a server that leaves the origin of its game socket open. The operator's routes answer only commands typed on the server itself, never a web page open there.

### For self-hosters and contributors

- **Errors of players, grouped.** The errors players' pages report are grouped on the server by kind, message and place in the code, and counted by day, release, browser family, device and screen, for 30 days. `/admin/errors?days=N`, from inside the container, lists them, the most reported first ([server.md](docs/server.md#errors-of-players)); `client_error` log lines name their group. Error reports carry, optionally, the file, line and column of the game's own code they came from, the browser family, the device and the screen; a game a page could not take back from its snapshot is reported as the new kind `snapshot` ([privacy.md](docs/privacy.md#reports)). The game protocol does not change.
- **Protocol 24.** The lobby carries `operator` and `goldBonus`, `configure` takes `operatorGold` and `started` carries `goldBonus` ([R-MODE-09](docs/rules.md), [protocol](docs/protocol.md)); a game saved by an older server comes back without the bonus. A "Play now" never joins a game whose host changed its options, and `desync` is no longer sent when no majority of the reports agrees. Pages from before this release reload on their next connection.
- **What one server holds.** `FRONTFALL_MAX_PLAYERS` (3000), `FRONTFALL_MAX_CONNECTIONS` (5000), `FRONTFALL_MAX_LOG_MIB` (192), `FRONTFALL_GAMES_PER_ADDRESS` (10), `FRONTFALL_TRUST_PROXY` and `FRONTFALL_OPERATOR_ACCOUNTS` are new ([server.md](docs/server.md#configuration)). Measured with `pnpm load` on 4 cores at 2.1 GHz, one server holds 4800 players with the turns within 9 ms of their time, and falls behind from about 5600; 3040 players who all reload are back within 4.6 s, and a tenth who stop reading do not grow its memory ([capacity.md](docs/capacity.md)). New metrics `frontfall_refused_connections_total` and `frontfall_slow_clients_total`; `pnpm load` takes `--client-procs`, `--ramp`, `--rejoin-storm`, `--slow-clients` and `--heap-mib`.
- **Speed.** A turn of the engine costs about a third less, the map's shader, uploads and frame pacing are lighter, and a page takes in an update in about a fifth of its former time, all measured in [performance.md](docs/performance.md). `?perf` on the game's address measures a phone. The speed work changes no rule; the rule changes of this release are listed above.

- **Balance keys for the new fights.** `B-ATTACK-PACE` (20 %), `B-ATTACK-PACE-ODDS` (3x) and `B-GOLD-BASE` (500 gold a second) are new, `B-CITY-LAND` is now 0 (no limit), and the normal nations' `B-NATION-INTERVAL` (1 s), `B-NATION-RESERVE` (40 %), `B-NATION-HOLD` (30 %) and `B-NATION-GRACE` (100 s) changed ([balance.md](docs/balance.md), R-ATTACK-03, R-BUILD-07, R-ECO-03). On World, 30 minutes, collapsing fronts, attacks on players take land at 23 tiles a second at the median instead of 159, and the average player wins 7 games of 24 against normal nations (5 before) and 0 of 12 against hard ones.
- **Golden replays rebuilt.** The six golden replays (`europe-capitals`, `europe-normal`, `europe-teams`, `world-collapse`, `world-hard`, `world-nations`) were rebuilt for the new rules, so the hash of each game changed. The game protocol stays at 24, as above. The balance bench (`bench/balance`) now also reports how long fights between players last and how much land falls in 10 s.
- **Tick cost.** On the engine gate's reference game a tick takes 4.45 ms, against 3.49 ms before the pace and 3.16 ms without it, because longer attacks mean fronts planned on more ticks; the tick p95 is 7.55 ms against the 30 ms budget.

- **Everything is still synthesised in the browser**, so there are no sound files and nothing to credit in `CREDITS.md`. The audio lives in `apps/client/src/audio/` and loads as its own chunk after the first click: `voices.ts` holds the instruments, `palettes.ts` the scale, instruments and room, `synth.ts` the effects and their variants, `music.ts` the generative score, `mix.ts` the buses, room and limiter, and `place.ts` the placement by view. The first-visit budget is unchanged (118.4 kB); the whole build grows by about 5 kB. The sound settings now store a `music` level beside `volume` and `muted`. No game rule, replay or message depends on sound.

### Removed

- **The "Win in about…" line is gone.** Under the clock in the leaderboard, the estimate of when the leader would win jumped around and told you little, so it no longer shows.

## [0.8.0] - 2026-10-29

Own rules: fronts that collapse and a capital mode, a harder game, a lighter first visit, workers, an attack preview and build previews, and game speed.

### Added

- **Capitals show it when they fall, and when they are in danger.** In capital mode, a gold ring spreads from a capital that is taken or razed, with a short flash over it. While an enemy front threatens your own capital, a slow ring pulses around it until the danger passes. With reduced motion, the fall is a single disc that fades and the pulse is off. Not on the globe yet.
- **A ring where a player's land first appears, and a soft glow along a front.** When the spawn phase ends, each start tile gets a ring that spreads out from it, so you can see where everyone begins. While land is being taken, a faint glow breathes along the front, at most twice a second. With reduced motion, the ring is a single disc that fades without growing and the glow is off. Not on the globe yet.
- **Build from the keyboard, and see where it goes before you place it.** Keys 1 to 9 now pick a building, and the number is on its button: 1 city, 2 palace, 3 fort, 4 port, 5 silo, 6 air defense, 7 warships, 8 missile, 9 heavy missile (the letters still work). Once a building is picked, the map shows it faded in your colour under the pointer, with a green ring when it fits and a red one when it does not, and a card with its price and, when it does not fit, why: too close to another building, not your land, not enough gold, no coast. A fort or an air defense also shows how far it reaches. On a phone, the first tap shows the preview and a second tap on the same spot, or the card's Place here button, places it. Nothing is built until you confirm.
- **Fronts that collapse.** Hold an attack's pressure on a thin front and it gives way by whole stretches instead of tile by tile. When your attack has at least three times the soldiers facing it (their soldiers per tile, times the tiles of theirs you touch) and keeps taking land for 3 seconds, the front breaks: their land within about 5 tiles of your spearhead (10 on World) falls at once at half the usual price, and any pocket it cuts off falls with it. A ring of ember marks the spot and the feed tells you, whether the front that broke was theirs or yours. Forts hold: land a fort covers never gives way. A thin border with troops at work breaks first, so call your workers back to arms, fight back or build a fort when a neighbour masses on you. Nations know the rule: they push hard on a front that is about to give, against anyone bigger than them, and keep their troops under arms where a neighbour could break them. It is the first of the **special rules**, a new section of its own in the solo setup and in the lobby: on by default and in every public game, and the host of a private game can turn it off. The lobby and the end screen show which special rules a game is played with.
- **Capital mode.** A second special rule, off by default: tick it in "Special rules" when you set up a solo game or a private lobby. Where you start becomes your capital, a gold crown in your colour that everyone sees on the map and on the globe. Land around a capital costs three times as much to take, more than a fort, and the capital itself is guarded by a fifth of its owner's soldiers; but whoever takes it takes the whole empire at once, every tile and building, with half of its troops and gold. Capitals can only fall after the first 3 minutes of play, counted down at the top of the screen; before that, a capital that is overrun just moves. Games get shorter and every front near a capital matters. When an enemy front comes close to your capital, the banner at the top turns red and names the attacker, and the feed tells you; a capital hit by a missile is razed and moves, at the cost of half your troops. Bots and nations play it too: their attacks head straight for your capital, nations rush to defend theirs and gang up on a runaway leader sooner. The end screen tells you who took your capital or how many you took, and lists the capitals that fell.
- **Put troops to work.** A second slider under the attack share, "Workers", sends part of your troops at home to work: each worker earns four times the gold of a soldier, up to 80 % of your troops. Workers neither attack nor defend, so your land gets cheaper to take and attacks, ships and gifts draw on your soldiers only. Your gold per second now shows under your gold, and moves as you drag the slider. It starts at 0 %, so nothing changes until you touch it. On a phone, the slider sits at the top of the build tray. Nations put 40 % of their troops to work once their army is full and nobody attacks them, and call them back as soon as someone does.
- **See what an attack would take before you send it.** Point at a neighbour's land, or rest a finger on it, and the bottom left shows about how many tiles your current attack share would take there, how many soldiers it sends, what each tile costs and how much room for troops it would add. On a phone it keeps to one line. It is an estimate: hills, mountains and forts cost more.
- **Game speed.** A solo game can now run at ×1, ×2 or ×4: press the round ×1 button after pause, or T, to go to the next pace, or pick one in the pause banner (where it lives on a phone, so the attack slider and the leaderboard keep their room). In a private online game, the host picks the speed in the lobby for the whole game, and everyone sees it in the summary; public games always run at ×1. Only the pace changes: at ×2 everything happens twice as soon, the time limit included, and a replay plays the same whatever speed the game had.

### Changed

- **A lighter first visit.** The menu no longer waits for the game screen or the 3D renderer: they load once the page is idle, or when you press Play, and an online lobby fetches them as it opens. The first visit sends about 117 kB instead of 274 kB; the whole game is the same size. The browser console no longer reports a blocked script on every visit.
- **Small tidy-ups for the new rules.** On a phone the banner, which also carries the capital alarm, and the refused-click notes sit clear of the figures panel. The two special rules in the menu and the lobby read as the main line of each switch, with their hint under them. On a landscape phone the end screen keeps Play again, Keep watching and Main menu in sight while the rest scrolls.
- **Harder to run away with the map.** Past a fifth of the map, each tile you add holds 70 % of the troops it used to, so a large empire grows thinner and its neighbours can bite back. Troops above your cap, back from an attack or left after you lose land, now drift away (half of the excess in about 14 seconds) instead of piling up for ever. Nations cross the sea when their neighbours are down to scraps, so a game no longer stalls with one empire holding a continent. Easy nations keep fewer troops at home, so they can be beaten, and fire missiles at most every 2 minutes each (every minute at normal); a light missile costs 600,000 gold instead of 300,000. On World, the scripted stand-in for an average player now wins about a third of its games against normal nations and a quarter against hard ones.
- **Cleaner edges up close.** Zoomed right in, country edges stay a few pixels wide instead of growing into thick bands, pale countries get a darker outline so they stand out on sand and snow, and the ground keeps a fine grain.
- **Sharper ridges.** Mountain ranges are shaded at two scales, so their crests stand out from the broad slopes when you zoom in.
- **A clearer sea.** Every coast now has a crisp band of light shallows with its fine line of foam, in place of the soft glow; coastal water is a shade lighter and deepens slowly offshore. Zoomed in, slow swells drift across open water; they hold still when reduced motion is on.
- **A touch screen reads "tap", not "click".** The line at the top of the game, the one that says where to start and how to expand, and the build prompts now say "Tap" (and drop "Esc to cancel") when you play with a finger, on a phone or a tablet. On a landscape phone, the first steps take a short card beside the leaderboard instead of its full width, and "Hide the guide" is a 44 px target on a touch screen.
- **Digits pick buildings; Shift and a digit sets the attack share.** The digit keys 1 to 9 and 0 used to set the share of troops an attack takes. That is now Shift + 1 to 9 (10 % to 90 %) and Shift + 0 (all of them), as the slider at the bottom has always allowed. The help and the first steps say so.

### For self-hosters and contributors

- **Balance pass.** New keys `B-DESERTION` (5 % of the excess per second, [R-ECO-02](docs/rules.md)), `B-NATION-MISSILE-PAUSE` (120 / 60 / 30 s, R-BOT-12) and `B-NATION-SCRAPS` (5 %, the new R-BOT-18); `B-POP-FALLOFF` 70 % (was 100 %, off), `B-COST-MISSILE` 600,000, easy `B-NATION-RESERVE` 25 %. The scripted average player of `pnpm balance -- --average` sails when its land fronts stall for 30 s: before, it stalled near 61 % of World and its wins understated how easy the game was. Every game's hash changes, so the golden replays are rebuilt; the protocol is unchanged, and a snapshot of nations now carries when each may fire again. Figures and the values tried are in [balance.md](docs/balance.md#bots). Tick time is unchanged (`pnpm perf:engine -- --base`, median change 1.3 %, p95 6.1 ms).
- The worker answers a new `peek` request with what a click in a build mode would do, for the build preview ([client](docs/client.md#build-preview)). The simulation and the protocol do not change.
- **Protocol 22 and the special rules.** The game options, `lobby` and `started` carry `rules` (`{ "collapsingFronts": true }`), the special rules of [R-MODE-08](docs/rules.md); a public game refuses any but the defaults, and games saved by an older server come back without them. Collapsing fronts are [R-ATTACK-10](docs/rules.md) with `B-COLLAPSE-ODDS` 3, `B-COLLAPSE-BUILDUP` 3 s, `B-COLLAPSE-DEPTH` 5 tiles and `B-COLLAPSE-COST` 50 %, and nations play them under [R-BOT-16](docs/rules.md). In the engine, a rule is off unless `GameSetup.rules` turns it on, and only a rule that is on enters the state hash, snapshots, replays and desync reports; the new balance values change every game's hash, so the golden replays are rebuilt, with a fifth one played with the rule. `pnpm balance` and `pnpm sim` take `--rule collapsingFronts`. Measured on World against the scripted average player that takes to the sea (30 minutes, every game decided): with normal nations the player wins 6 of 20 against 10 without the rule, with hard nations 5 of 12 against 8. Tick time is unchanged (`pnpm sim` on 2048 × 1024, p95 about 17 ms either way).
- **Protocol 23 and capital mode.** `rules` gains `capitals` (`{ "collapsingFronts": true, "capitals": false }`), off by default and in every public game; games saved by an older server come back with it off. The rule is [R-CAP-01 to R-CAP-06](docs/rules.md#capital-mode), with `R-WIN-04`, and nations and bots play it under [R-BOT-17](docs/rules.md); its values are the `B-CAPITAL-*` keys of [balance.md](docs/balance.md#capitals). A game without the rule plays and hashes exactly as before: the capital keys enter the balance digest only when the rule is on. A sixth golden replay, `europe-capitals`, is played with both rules. `pnpm balance` takes `--rule capitals` and then reports the capitals that fell.
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

[Unreleased]: https://github.com/nic0lasm/frontfall/compare/v0.9.4...HEAD
[0.9.4]: https://github.com/nic0lasm/frontfall/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/nic0lasm/frontfall/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/nic0lasm/frontfall/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/nic0lasm/frontfall/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/nic0lasm/frontfall/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/nic0lasm/frontfall/compare/v0.7.0...v0.8.0
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
