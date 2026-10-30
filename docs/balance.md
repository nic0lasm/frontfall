# Balance values

Status: starting values, not yet play-tested · Rules: [rules.md](rules.md)

Every number the rules depend on lives here. The values are Frontfall's own starting points and will move with play-testing; each change goes through a pull request that explains what it fixes in play. When the engine implements a value, its constant carries the same key in a comment so the two stay linked.

Values are checked with headless games that only bots, nations and a scripted stand-in for a human play: a casual player (`--casual`) or an average one (`--average`). `pnpm balance` plays one setup on many seeds, several games at a time, and prints how long games last, who wins against their fair share, gold from troops and from trade, and missiles; every game is deterministic, so the figures are the same on any machine:

```sh
pnpm balance -- --map world --bots normal:4,hard:4 --seeds 1-12
pnpm balance -- --map world --bots normal:0 --nations normal --casual --minutes 30
pnpm balance -- --map europe --bots hard:11 --set tradeRange=1000
pnpm balance -- --map world --bots normal:0 --nations hard --average --minutes 30
```

Durations are given in seconds of play and converted to ticks with `B-TICK-RATE`. Percentages apply to whole numbers and round down (`R-ECO-04`).

## Time

| Key              | Value | Unit         | Used by      | Notes                                                |
| ---------------- | ----: | ------------ | ------------ | ---------------------------------------------------- |
| `B-TICK-RATE`    |    10 | ticks/second | `R-FAIR-03`  | Fixed by the protocol (`TICK_RATE`)                  |
| `B-BASE-PACE`    |  0.75 | × the beats  | `R-MODE-07`  | Ticks per beat of the clock at speed 1; only cadence |
| `B-SPAWN-PHASE`  |    20 | s            | `R-SPAWN-01` | Long enough to read the map, short enough to start   |
| `B-MAX-DURATION` |  3600 | s            | `R-WIN-02`   | One hour                                             |

## Spawn

| Key                | Value | Unit   | Used by      | Notes                                           |
| ------------------ | ----: | ------ | ------------ | ----------------------------------------------- |
| `B-SPAWN-DISTANCE` |    30 | tiles  | `R-SPAWN-02` | On a map of 2^19 tiles                          |
| `B-SPAWN-RADIUS`   |     3 | tiles  | `R-SPAWN-04` | Diamond of 25 tiles on a map of 2^19 tiles      |
| `B-START-TROOPS`   |  2500 | troops | `R-SPAWN-04` | Enough for a first expansion of about 300 tiles |

Spawn values are set for a map of 2^19 tiles (1024 × 512) (`R-SPAWN-06`). On a larger map, spacing and radius grow with the square root of the area, and starting troops with the start area: on World (2048 × 1024) players start 60 tiles apart with a radius of 6 and 10,000 troops. With the old fixed values, scripted players held 5 % of World's land after 30 s of play; they now hold 17 %, and the land is taken in about 90 s instead of 150 s (`pnpm sim -- --map world`).

## Economy

| Key                | Value | Unit                         | Used by      | Notes                                                        |
| ------------------ | ----: | ---------------------------- | ------------ | ------------------------------------------------------------ |
| `B-POP-BASE`       | 10000 | troops                       | `R-ECO-01`   | Every player's cap, before land and cities                   |
| `B-POP-LAND`       |   200 | troops × tiles^0.6           | `R-ECO-01`   | 1,000 tiles hold 12,600, 100,000 tiles 200,000               |
| `B-POP-PER-CITY`   | 25000 | troops                       | `R-BUILD-01` | Per working city                                             |
| `B-GROWTH-BASE`    |     1 | troops/tick                  | `R-ECO-02`   | What an empty army gains far below its cap                   |
| `B-GROWTH-DIVISOR` |    40 | divisor of (10 × army)^0.73  | `R-ECO-02`   | A larger army grows faster, until the cap slows it           |
| `B-DESERTION`      |     5 | % of the excess/second       | `R-ECO-02`   | Troops above the cap that leave                              |
| `B-GOLD-RATE`      |     0 | gold per 1,000 idle troops/s | `R-ECO-03`   | Off: size alone earns nothing                                |
| `B-GOLD-BASE`      |  1000 | gold/s                       | `R-ECO-03`   | For every living player, whatever their size                 |
| `B-WORK-MAX`       |    80 | % of troops at home          | `R-ECO-07`   | The rest always defends                                      |
| `B-WORK-GOLD`      |   150 | % of `B-GOLD-BASE`           | `R-ECO-07`   | Earned on top when workers fill the whole cap, less pro rata |

Since 0.9.5 the economy follows the long-standing reference of the genre, value for value, in the troops the game shows: a base cap of 10,000 for everyone, the land's 0.6 power, 25,000 per city, and a growth of (1 + (10 × army)^0.73 / 40) troops per tick times the room left under the cap, which peaks a little under half the cap. Gold is a flat 1,000 a second for every player, plus trade (`R-UNIT-03`). Workers are Frontfall's own (`R-ECO-07`): with the whole cap at work a player earns 2.5 times the flat income, and the cap bounds the bonus, so a large army does not mint gold. Powers and logarithms are computed with additions, products and quotients only, so every client gets the same numbers (`R-ECO-04`).

## Attacks

| Key                   |       Value | Unit                        | Used by       | Notes                                                          |
| --------------------- | ----------: | --------------------------- | ------------- | -------------------------------------------------------------- |
| `B-ATTACK-RATIO-MIN`  |           5 | %                           | `R-ATTACK-02` | Default ratio in the interface is 30 %                         |
| `B-TILE-WEIGHT`       | 8 / 10 / 12 | troops                      | `R-MAP-06`    | Plains / hills / mountains: what a tile's price is measured in |
| `B-NEUTRAL-SHARE`     |          20 | % of the tile's weight      | `R-ATTACK-04` | 1.6 troops a plains tile                                       |
| `B-BOT-NEUTRAL-SHARE` |          10 | % of the tile's weight      | `R-ATTACK-04` | For bots                                                       |
| `B-LOSS-BASE`         |       0.463 | × the tile's weight         | `R-ATTACK-03` | Of a player's tile, times the odds                             |
| `B-LOSS-DENSITY`      |       0.039 | × weight per soldier/tile   | `R-ATTACK-03` | The defender's soldiers per tile, times the odds               |
| `B-ODDS-MIN`          |         0.6 | defender soldiers per troop | `R-ATTACK-03` | A larger attack pays no less than this                         |
| `B-ODDS-MAX`          |           2 | defender soldiers per troop | `R-ATTACK-03` | A smaller attack pays no more than this                        |
| `B-LARGE-MID`         |      300000 | tiles                       | `R-ATTACK-03` | Size at which a territory has half its size bonus              |
| `B-LARGE-ATTACKER`    |          70 | % off the base              | `R-ATTACK-03` | For a huge attacker                                            |
| `B-LARGE-DEFENDER`    |          30 | % off the base              | `R-ATTACK-03` | For a huge defender                                            |
| `B-BOT-DEFENSE`       |          70 | % of the price              | `R-ATTACK-03` | Of a bot's tile, for players and nations                       |
| `B-ATTACK-SPEED`      |           4 | divisor                     | `R-ATTACK-03` | Tiles taken per tick: 1 + isqrt(troops) / 4                    |
| `B-ATTACK-PACE`       |          20 | % of the front per tick     | `R-ATTACK-03` | Against a player, at full strength                             |
| `B-ATTACK-PACE-ODDS`  |         3.0 | × the garrison facing it    | `R-ATTACK-03` | Troops for full pace; less goes slower                         |
| `B-ATTACK-SPREAD`     |           4 | tiles                       | `R-ATTACK-03` | Head start per side shared with own land                       |
| `B-ENCIRCLE-MAX`      |        4000 | tiles                       | `R-ATTACK-08` | Larger pockets must be conquered                               |
| `B-RETREAT-PENALTY`   |          25 | % of returning troops       | `R-ATTACK-06` |                                                                |

## Collapsing fronts

| Key                  | Value | Unit                             | Used by       | Notes                                                       |
| -------------------- | ----: | -------------------------------- | ------------- | ----------------------------------------------------------- |
| `B-COLLAPSE-ODDS`    |   3.0 | × the garrison facing the attack | `R-ATTACK-10` | Garrison: defender's soldiers per tile × tiles on the front |
| `B-COLLAPSE-BUILDUP` |     3 | s of overwhelming advance        | `R-ATTACK-10` | Before a front gives way, then again                        |
| `B-COLLAPSE-DEPTH`   |     5 | tiles                            | `R-ATTACK-10` | On a map of 2^19 tiles, 10 on World                         |
| `B-COLLAPSE-COST`    |    50 | % of the usual price per tile    | `R-ATTACK-10` | The defender still loses their troops per tile              |
| `B-SPECIAL-RULES`    |    on | collapsing fronts                | `R-MODE-08`   | In public games and quick play; capital mode stays off      |

## Ships

| Key            | Value | Unit             | Used by     | Notes                                             |
| -------------- | ----: | ---------------- | ----------- | ------------------------------------------------- |
| `B-BOAT-SPEED` |     2 | water tiles/tick | `R-UNIT-02` | An ocean of 500 tiles takes 25 s                  |
| `B-BOAT-MAX`   |     3 | ships per player | `R-UNIT-02` | Transport ships at sea at once                    |
| `B-BOAT-RANGE` |  1000 | water tiles      | `R-UNIT-02` | Longest route; also bounds the cost of the search |

## Warships

| Key                |  Value | Unit        | Used by      | Notes                                                       |
| ------------------ | -----: | ----------- | ------------ | ----------------------------------------------------------- |
| `B-COST-WARSHIP`   | 250000 | gold        | `R-UNIT-04`  | First warship; one more for each owned, up to `B-COST-MAX`  |
| `B-WARSHIP-MAX`    |      4 | warships    | `R-UNIT-04`  | Per player                                                  |
| `B-WARSHIP-PATROL` |     30 | water tiles | `R-UNIT-04`  | Around the patrol tile, on a map of 2^19 tiles; 60 on World |
| `B-WARSHIP-RANGE`  |     12 | tiles       | `R-UNIT-04`  | The same on every map                                       |
| `B-WARSHIP-RELOAD` |      1 | s           | `R-UNIT-04`  | Between two shots                                           |
| `B-WARSHIP-DAMAGE` |    250 | health      | `R-UNIT-04`  | A warship sinks at the fourth hit                           |
| `B-WARSHIP-HEALTH` |   1000 | health      | `R-UNIT-04`  |                                                             |
| `B-WAR-MEMORY`     |     30 | s           | `R-UNIT-04`  | A fight is remembered this long after it ends               |
| `B-EMBARGO-NOTICE` |     30 | s           | `R-UNIT-04`  | An embargo stands this long before trade ships can be taken |
| `B-EMBARGO-AUTO`   |    300 | s           | `R-DIPLO-09` | An embargo placed after an attack lasts this long           |

Warships fire only between players at war: a transport ship sailing for a coast makes its owner at war with the coast's owner from the moment it sails, so an escort draws the fire while the transport passes. Trade ships are taken only after an embargo has been announced for `B-EMBARGO-NOTICE`, so trade between players at peace is never at risk.

## Trade

| Key                | Value | Unit           | Used by     | Notes                                                                              |
| ------------------ | ----: | -------------- | ----------- | ---------------------------------------------------------------------------------- |
| `B-TRADE-RANGE`    |   500 | water tiles    | `R-UNIT-03` | Longest trade route on a map of 2^19 tiles, 1,000 on World; also bounds the search |
| `B-TRADE-INTERVAL` |     1 | s              | `R-UNIT-03` | Between two rolls of one port for a ship, counted from when it was built           |
| `B-TRADE-MAX`      |   100 | ships per port | `R-UNIT-03` | Trade ships of one port at sea at once                                             |
| `B-TRADE-ODDS`     |   100 | rolls          | `R-UNIT-03` | A port's roll succeeds one time in this many, before the boosts below              |

Since 0.9.5 trade follows the reference of the genre. Each port rolls once a second. A player with six ports or more succeeds one time in `B-TRADE-ODDS`; with fewer, up to 2.25 times as often for a single port. Each missed roll makes the next likelier, and a sea with hundreds of trade ships makes all of them rarer, down to a quarter. Far ports (300 water tiles or more) and allies' ports are drawn twice as often. A ship pays each side 75,000 / (1 + e^(−0.03 (length − 300))) + 50 × length: about 1,000 gold for 20 tiles, 52,500 for 300 and 125,000 for 1,000. A warship that takes a trade ship under an embargo (`R-UNIT-04`) earns what the ship would have paid.

Like the other lengths, the range grows with the side of the map. At 500 tiles on World, bots, who start 60 tiles apart or more and often on other continents, had no port in each other's reach: in 12 games of 8 normal bots, not one trade ship sailed. At 1,000 tiles, with bots building on the ocean (`R-BOT-06`), the median player with a port earns 3,700 to 5,300 gold per second from trade between 6 and 10 minutes: 63 % of what its troops earn at 6 minutes, 22 % at 10. The leader gets 4 to 5 % of its income from trade. Trade helps the small empires and does little for the one that is running away with the game; games last as long as before (`pnpm balance -- --map world --bots normal:8 --seeds 1-12`).

## Diplomacy

| Key                           | Value | Unit | Used by      | Notes                                                     |
| ----------------------------- | ----: | ---- | ------------ | --------------------------------------------------------- |
| `B-ALLIANCE-REQUEST-TIMEOUT`  |    20 | s    | `R-DIPLO-01` |                                                           |
| `B-ALLIANCE-REQUEST-COOLDOWN` |    30 | s    | `R-DIPLO-01` | From a request running out to the next to the same player |
| `B-ALLIANCE-DURATION`         |   300 | s    | `R-DIPLO-03` | Fixed, so that no pact freezes a free-for-all             |
| `B-ALLIANCE-RENEWAL`          |    30 | s    | `R-DIPLO-03` | Last part of an alliance in which both may renew it       |
| `B-TRAITOR-DURATION`          |    30 | s    | `R-DIPLO-04` |                                                           |
| `B-TRAITOR-DEFENSE`           |    50 | %    | `R-DIPLO-04` | Of the usual price of a traitor's tile, after any fort    |

## Structures

| Key                      |   Value | Unit       | Used by      | Notes                                                   |
| ------------------------ | ------: | ---------- | ------------ | ------------------------------------------------------- |
| `B-BUILD-TIME`           |       5 | s          | `R-BUILD-*`  | For every structure but the two below                   |
| `B-BUILD-TIME-LONG`      |      10 | s          | `R-BUILD-*`  | Missile silo and air defense                            |
| `B-COST-CITY`            |  125000 | gold       | `R-BUILD-01` | First city                                              |
| `B-COST-FORT`            |   50000 | gold       | `R-BUILD-03` | First fort; one more for each owned                     |
| `B-COST-PORT`            |  125000 | gold       | `R-BUILD-02` | First port                                              |
| `B-COST-SILO`            | 1000000 | gold       | `R-BUILD-04` | Every missile silo                                      |
| `B-COST-AIR-DEFENSE`     | 1500000 | gold       | `R-BUILD-05` | First air defense; one more for each owned              |
| `B-COST-GROWTH`          |       2 | multiplier | `R-BUILD-*`  | Cities and ports: the n-th costs base × 2^(n−1)         |
| `B-COST-MAX`             | 1000000 | gold       | `R-BUILD-*`  | Most a city, a port or a warship costs                  |
| `B-COST-FORT-MAX`        |  250000 | gold       | `R-BUILD-03` | Most a fort costs                                       |
| `B-COST-AIR-DEFENSE-MAX` | 3000000 | gold       | `R-BUILD-05` | Most an air defense costs                               |
| `B-PALACE-CITIES`        |       2 | cities     | `R-BUILD-08` | Fixed: what a palace counts as, for cost, land and pop. |
| `B-BUILD-SPACING`        |      10 | tiles      | `R-BUILD-07` | Between any two structures                              |
| `B-CITY-LAND`            |       0 | tiles      | `R-BUILD-07` | Land each city beyond the first needs; 0 for no limit   |
| `B-FORT-RADIUS`          |      25 | tiles      | `R-BUILD-03` |                                                         |
| `B-FORT-STRENGTH`        |     200 | % of price | `R-BUILD-03` | Paid by attackers inside the radius                     |
| `B-FORT-LOSSES`          |      50 | % of loss  | `R-BUILD-03` | Lost by the defender inside the radius                  |

Structure values were set on World with eight normal bots, five seeds. Before structures, a bot reached `B-WIN-SHARE` after 8.8 to 13.0 minutes (median 10.1). With cities worth 10 % and one per 20,000 tiles of World, the snowball brought that down to 7.5 to 9.8 minutes; at 5 % and one per 40,000 tiles it is 7.9 to 10.6 (median 10.1), and a scripted casual player that also builds cities wins against seven normal bots as often as before (2 seeds out of 5).

Distances and land are given for a map of 2^19 tiles, like the spawn values: on a larger map `B-FORT-RADIUS` grows with the spawn radius and `B-CITY-LAND`, when a game sets it, with the spawn area, so on World a fort covers 50 tiles around it and a limit of 10,000 tiles per city becomes 40,000.

## Missiles

| Key                      |   Value | Unit           | Used by      | Notes                                                                 |
| ------------------------ | ------: | -------------- | ------------ | --------------------------------------------------------------------- |
| `B-SILO-RELOAD`          |      30 | s              | `R-BUILD-04` | From a launch to the next one from the same silo                      |
| `B-COST-MISSILE`         |  750000 | gold           | `R-UNIT-05`  | Every missile; it does not grow                                       |
| `B-COST-HEAVY-MISSILE`   | 5000000 | gold           | `R-UNIT-05`  | Every heavy missile                                                   |
| `B-MISSILE-SPEED`        |       8 | tiles per tick | `R-UNIT-05`  | 80 tiles a second: across World in under 13 s                         |
| `B-MISSILE-RADIUS`       |      12 | tiles          | `R-UNIT-05`  | On a map of 2^19 tiles; 24 on World                                   |
| `B-HEAVY-MISSILE-RADIUS` |      45 | tiles          | `R-UNIT-05`  | On a map of 2^19 tiles; 90 on World                                   |
| `B-FALLOUT-TIME`         |      90 | s              | `R-UNIT-06`  | Under a heavy missile                                                 |
| `B-FALLOUT-TIME-LIGHT`   |      30 | s              | `R-UNIT-06`  | Under a light missile                                                 |
| `B-FALLOUT-COST`         |     200 | %              | `R-UNIT-06`  | Price of taking a tile under fallout, against its usual price         |
| `B-MISSILE-TROOPS`       |     300 | %              | `R-UNIT-05`  | Of the share of troops the land under the blast held                  |
| `B-AIR-DEFENSE-RADIUS`   |      60 | tiles          | `R-BUILD-05` | On a map of 2^19 tiles; 120 on World                                  |
| `B-AIR-DEFENSE-CHANCE`   |      75 | %              | `R-BUILD-05` | Per missile flying into the radius                                    |
| `B-AIR-DEFENSE-RELOAD`   |      10 | s              | `R-BUILD-05` | From a missile stopped to the next one the same air defense tries for |

A missile is a late tool to break a front that holds: a silo and its first missile cost 1.75 million gold, and a silo fires twice a minute at most. A light missile on World burns about 1,800 tiles, a heavy one about 11,000, the size of a medium country. An air defense covers some 45,000 tiles around it; one stops three missiles out of four that fly over it, two in a row fifteen out of sixteen, until they reload.

## Bots

Each value is given for easy / normal / hard (`R-BOT-04`); the others are the same at every difficulty.

| Key                       |           Value | Unit                            | Used by    | Notes                                                                                                                                          |
| ------------------------- | --------------: | ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `B-BOT-INTERVAL`          |       5 / 5 / 2 | s between decisions             | `R-BOT-01` | Bots spread their decisions over the interval                                                                                                  |
| `B-BOT-ATTACK-RATIO`      |    15 / 15 / 40 | % of troops at home             | `R-BOT-01` | Sent by one expansion or attack order                                                                                                          |
| `B-BOT-RESERVE`           |    50 / 40 / 20 | % of population cap             | `R-BOT-01` | Never sent; kept at home to defend                                                                                                             |
| `B-BOT-BOLDNESS`          | 100 / 110 / 150 | % of the bot's troop density    | `R-BOT-01` | Attacks a neighbour at most this dense; half while land is free. Equal density is worth attacking: spent troops grow back, captured land stays |
| `B-BOT-SAMPLES`           |              16 | border tiles per decision       | `R-BOT-05` | At least this many, or the square root of the border when longer, so a narrow land front is found                                              |
| `B-BOT-SEA-TARGETS`       |               8 | coasts per sea search           | `R-BOT-05` | Weighed closest first                                                                                                                          |
| `B-BOT-SEA-MIN`           |              16 | water tiles                     | `R-BOT-05` | Coasts closer to the bot's shore count as the same front                                                                                       |
| `B-BOT-SEA-RETRY`         |               4 | decisions                       | `R-BOT-05` | Skipped after a sea search that found nothing, since one search can walk `B-BOAT-RANGE` of sea                                                 |
| `B-BOT-CITY-SEARCH`       |              40 | tiles                           | `R-BOT-06` | Radius around its start in which a bot looks for room for a city                                                                               |
| `B-BOT-PORT-SEARCH`       |              60 | tiles                           | `R-BOT-06` | Radius around its start in which a bot looks for a coast for its port                                                                          |
| `B-BOT-ALLIANCE-MAX`      |               1 | allies                          | `R-BOT-10` | So that a bot always has someone left to fight                                                                                                 |
| `B-NATION-INTERVAL`       |       8 / 6 / 5 | s between decisions             | `R-BOT-09` | In place of `B-BOT-INTERVAL`                                                                                                                   |
| `B-NATION-TRIGGER`        |        50 to 60 | % of population cap             | `R-BOT-26` | Drawn per nation: from here it attacks a player, and one decision in ten whatever its troops                                                   |
| `B-NATION-KEEP`           |        30 to 40 | % of population cap             | `R-BOT-26` | Drawn per nation: what an attack on a player leaves at home                                                                                    |
| `B-NATION-EXPAND`         |        10 to 20 | % of population cap             | `R-BOT-26` | Drawn per nation: what an expansion into free land leaves at home                                                                              |
| `B-NATION-HUMAN`          |   25 / 75 / 100 | % of decisions                  | `R-BOT-26` | Aimed at a player who is no nation, that go on to attack                                                                                       |
| `B-NATION-CAP`            |   50 / 75 / 100 | % of a player's cap             | `R-BOT-04` | A nation's population cap                                                                                                                      |
| `B-NATION-GROWTH`         |   90 / 95 / 100 | % of a player's growth          | `R-BOT-04` | A nation's troop growth                                                                                                                        |
| `B-NATION-ODDS`           |             off | % of the nation's troop density | `R-BOT-09` | Since 0.9.5 a nation weighs its own troops, not the odds (`R-BOT-26`)                                                                          |
| `B-NATION-FULL`           |              90 | % of population cap             | `R-BOT-15` | From here a nation at peace puts troops to work                                                                                                |
| `B-NATION-GRACE`          |       0 / 0 / 0 | s of play                       | `R-BOT-09` | None since 0.9.5: the trigger share and `B-NATION-HUMAN` pace nations instead                                                                  |
| `B-NATION-PILE`           |               2 | nations                         | `R-BOT-13` | Most nations that open a front on the same player early on; the leader is not protected                                                        |
| `B-NATION-PILE-TIME`      |             600 | s of play                       | `R-BOT-13` | After this, nations gang up on anyone                                                                                                          |
| `B-NATION-THREAT`         |              10 | % of the nation's troops        | `R-BOT-08` | Smaller attacks do not make a nation hold, so a trickle of them cannot freeze it                                                               |
| `B-NATION-WORK`           |              40 | % of troops at home             | `R-BOT-15` | Put to work while its army is full and nobody holds it                                                                                         |
| `B-NATION-HOLD`           |    60 / 50 / 30 | % of population cap             | `R-BOT-08` | Under attack, a nation sends nothing below this, and only answers the attacker above it                                                        |
| `B-NATION-WARSHIPS`       |               2 | warships                        | `R-BOT-11` | No more than ports, bought while an enemy transport sails for the nation's coast                                                               |
| `B-NATION-SILO-CITIES`    |               2 | cities                          | `R-BOT-12` | Before a nation builds a silo                                                                                                                  |
| `B-NATION-HUNT`           |     0 / 20 / 20 | % of all ownable land           | `R-BOT-14` | From here the leading player is the first target of every nation along its border, odds allowing; never on easy                                |
| `B-NATION-MISSILE-LEADER` |              30 | % of all ownable land           | `R-BOT-12` | From here the leading player becomes a nation's target when nobody attacks it                                                                  |
| `B-NATION-MISSILE-PAUSE`  |  600 / 120 / 60 | s                               | `R-BOT-12` | From one of its missiles to the next; twice as long since missiles leave fallout and kill more                                                 |
| `B-NATION-SCRAPS`         |               5 | % of the nation's land          | `R-BOT-18` | A neighbour with less land than this is attacked by land only when no landing is worth it                                                      |
| `B-NATION-ALLIANCE-MAX`   |               2 | allies                          | `R-BOT-19` | In place of `B-BOT-ALLIANCE-MAX`: a nation leaves room for a second friend                                                                     |
| `B-NATION-ALLIANCE-SIZE`  |             150 | % of the nation's land          | `R-BOT-19` | A player less than half again its size can still buy peace                                                                                     |
| `B-NATION-MOOD-ATTACK`    |              10 | points                          | `R-BOT-20` | Each attack or landing on the nation's land, down to -60                                                                                       |
| `B-NATION-MOOD-MISSILE`   |              40 | points                          | `R-BOT-20` | A missile on its land                                                                                                                          |
| `B-NATION-MOOD-TRAITOR`   |              20 | points                          | `R-BOT-20` | Every other nation, when a player betrays anyone, down to -60                                                                                  |
| `B-NATION-MOOD-ANGRY`     |               5 | points                          | `R-BOT-20` | An angry face, down to -10                                                                                                                     |
| `B-NATION-MOOD-GIFT`      |              20 | points                          | `R-BOT-20` | A gift worth at least `B-NATION-GIFT-SHARE`                                                                                                    |
| `B-NATION-GIFT-SHARE`     |               5 | % of its troops or gold         | `R-BOT-20` | After the gift                                                                                                                                 |
| `B-NATION-MOOD-ALLIED`    |              15 | points                          | `R-BOT-20` | An alliance formed or renewed, both ways                                                                                                       |
| `B-NATION-MOOD-HELP`      |               5 | points                          | `R-BOT-20` | An attack on a player attacking the nation                                                                                                     |
| `B-NATION-MOOD-SORRY`     |              10 | points                          | `R-BOT-20` | An apology, up to 0                                                                                                                            |
| `B-NATION-MOOD-HEAL`      |               6 | s per point                     | `R-BOT-20` | A bad score heals: hostility from attacks is gone in 6 minutes                                                                                 |
| `B-NATION-MOOD-FADE`      |              20 | s per point                     | `R-BOT-20` | A good score fades, but not between allies                                                                                                     |
| `B-NATION-MOOD-HOSTILE`   |             -50 | points                          | `R-BOT-20` | At or below: hostile                                                                                                                           |
| `B-NATION-MOOD-WARY`      |             -10 | points                          | `R-BOT-20` | Below: wary                                                                                                                                    |
| `B-NATION-MOOD-FRIENDLY`  |              25 | points                          | `R-BOT-20` | At or above: friendly; two gifts that count                                                                                                    |
| `B-NATION-GRUDGE`         |  no / yes / yes |                                 | `R-BOT-22` | Whether it turns on a neighbour it is hostile to                                                                                               |
| `B-NATION-COURT`          |              20 | s                               | `R-BOT-23` | Between two looks at its neighbours                                                                                                            |
| `B-NATION-COURT-PLAYERS`  |     300 / 0 / 0 | s of play                       | `R-BOT-23` | Easy only: from here a nation offers an alliance to a smaller neighbour that has not attacked it; 0 never                                      |
| `B-NATION-GIFT`           |              25 | % of its soldiers               | `R-BOT-24` | Given to an ally in need                                                                                                                       |
| `B-NATION-GIFT-PAUSE`     |              60 | s                               | `R-BOT-24` | Between two gifts                                                                                                                              |
| `B-NATION-NEED`           |              25 | % of the ally's cap             | `R-BOT-24` | An ally under attack below this is in need without asking                                                                                      |
| `B-NATION-BETRAY-LAND`    |    30 / 50 / 70 | % of the nation's land          | `R-BOT-25` | An ally this small is worth betraying                                                                                                          |
| `B-NATION-BETRAY-TROOPS`  |    20 / 35 / 50 | % of the nation's troops        | `R-BOT-25` | ... with this few troops                                                                                                                       |
| `B-NATION-COVET`          |              10 | points                          | `R-BOT-25` | Its score of the ally it eyes drops by this at each look                                                                                       |
| `B-NATION-BETRAY-SCORE`   |             -20 | points                          | `R-BOT-25` | It betrays at this score: a fresh ally after about a minute and a half                                                                         |

Since 0.9.5 nations follow the reference of the genre: free land first, sending what lies above `B-NATION-EXPAND`; a player only from `B-NATION-TRIGGER` of their cap, sending what lies above `B-NATION-KEEP`; difficulty changes their pace, their population and how often they let a human player be. The notes below tell how the earlier values were found; the odds, grace, attack ratio and reserve they mention are gone.

Nation values were set on World against a scripted casual player (an order every 5 s with 30 % of its troops, free land first, then its weakest neighbour, then by sea, and a city when its gold allows), at normal difficulty, six to eight seeds, over 20 to 30 minutes, before alliances existed. With `B-NATION-ODDS` alone, nations hardly ever attacked each other once the land was taken, and 7 games out of 8 had no winner after 20 minutes; `B-NATION-FULL` lets a full army fight on. Without `B-NATION-GRACE`, the casual player lost its early game to a neighbouring nation in 3 seeds out of 6, between 3 and 7 minutes, against 7 seeds out of 8 with 71 bots in place of the nations. With 2 minutes of grace and the 64 nations, it is never eliminated before 9 minutes, and is alive and leading after 30 minutes in 5 seeds out of 6; a nation won the sixth in 12.4 minutes (3 minutes of grace: 6 out of 6, and no nation won). Against 8 normal bots without nations, a bot wins in about 10 minutes. With nations, the menu suggests no bots: with 7 bots on top and no grace, the casual player survived 30 minutes in 1 seed out of 6.

The grace went from 2 minutes to 2.5 once nations had ports, warships and missiles. With 2 minutes, the casual player on World was eliminated in 8 seeds out of 8, after 4.2 minutes at the median: it takes the most free land, so it is the thinnest player when the grace ends, and eight to ten nations attack it within the same minute. With 2.5 minutes it is alive after 30 minutes in 7 seeds out of 8 and leads with about 60 % of the land, where it stalls, since the script fires no missile; against hard nations it is still eliminated, after 3.6 minutes. 3 minutes made the script win every game, `B-NATION-ODDS` at 60 % did not save it (eliminated after 3.3 minutes), and on Europe it wins every game either way (`pnpm balance -- --map world --bots normal:0 --nations normal --casual --minutes 30`).

The pile limit came from World v4 (70 nations), where the casual player is eliminated in about 5 minutes in 3 seeds out of 8 at normal difficulty, and in 8 out of 8 at hard. With two attackers at most on a player who does not lead, for the first 10 minutes, it is alive after 30 minutes in 6 seeds out of 8 at normal, and in 3 out of 8 at hard (the others are eliminated after 5.5 minutes at the median, against 3.6 without the limit); games are decided as often as before. The same limit applied to the leader as well left no game decided in 30 minutes: nations could no longer gang up on whoever runs away with the map.

Difficulty levels for nations were set against a scripted average player (`--average`): it starts on the free tile farthest from the nations among a few hundred drawn from the seed, decides every 2 s, sends half its troops into free land and 40 % at a neighbour once its army is at 45 % of its cap and its troops per tile are a fifth above theirs, answers whoever attacks it, and builds cities, a port, forts facing an attacker, a silo, an air defense and light missiles. Nations used to share the pace and reserve of bots, with the reserve 10 points higher. On World, 12 seeds, 30 minutes, that player won 10 games at easy, 12 at normal and 12 at hard, in 7 to 8 minutes, and never lost: it holds 7 % of the land after a minute and 40 % after four, while the nations keep half their army at home and leave the leader alone. Faster pace alone did not change that (8 seeds: 4 wins out of 4 at normal); what does is a shorter grace with nations that turn on the leader (`R-BOT-14`). With the values above, easy is unchanged; at normal the average player wins 6 games of 12 (8 to 24 minutes, 18 at the median), loses 2 (eliminated after 11 minutes) and leads without winning in the other 4, stalled near 61 % of the land; at hard it wins none and is eliminated after 7.6 minutes at the median. The scripted casual player now survives only at easy: at normal it is eliminated after 3.5 minutes, at hard after 1.6, so easy is the level for a first game; the default difficulty is unchanged. A known limit: on Europe, a smaller map, the average player still wins every game at easy and normal in about 4 minutes, before the hunt starts, and 5 games of 8 at hard. Bots are unchanged, so games without nations play as before. A World game with the 70 nations costs 5 to 7 ms per tick on one core instead of 3.4 to 4.2 (`pnpm balance -- --map world --bots normal:0 --nations normal --average --minutes 30`).

Start positions are checked the same way, with nations only, 24 seeds and 30 minutes. With Ottawa as the only start north of the United States, Canada won 18 games of 24 on World and 23 on Americas; no balance value fixed it, since the cause is the free Arctic. The maps now seat more nations in the far north ([maps](maps.md#how-a-map-is-made)), and no nation wins more than 6 games of 24 on either map. The leader holds less land early (18 % at 10 minutes instead of 39 % on World), so games with nations last longer: 21 minutes in median instead of 15 on World, 14 instead of 9 on Americas. Once Canada is held back, Japan is the next to take free land, by sea in the Russian Far East: a start to watch in played games.

Bot values were tuned on World against a scripted stand-in for a casual player (an order every 5 s with 30 % of its troops, unowned land first, then its weakest neighbour), three seeds, seven bots. With the first values, hard bots wiped it out in under 3 minutes in two games out of three; with these, it survives every game at every difficulty, and the leading hard bot holds about half the land after 4 minutes, against a quarter for easy bots.

Hard bots were made stronger later, and only them, so that easy and normal keep the game a newcomer can win: they send 40 % instead of 35, keep 20 % at home instead of 30, and attack neighbours up to 150 % of their density instead of 125. Against seven hard bots on World, eight seeds, the scripted casual player (now also building cities) was eliminated in 7 games instead of 6, after 3.3 minutes at the median instead of 4.0; with eight hard bots alone, a bot reached `B-WIN-SHARE` in 7.4 minutes at the median instead of 8.2. On Europe against eleven hard bots, six seeds, the change is within noise (eliminated in 2 games instead of 3, one win either way).

Until 0.9.5, the paragraphs below applied to the economy of before (see Economy above):

Troop growth peaks at 38 % of the cap (`B-GROWTH-FLOOR` 20 %, `B-GROWTH-RATE` 8 %): an empty army takes 23 s to reach half its cap and 48 s to reach 90 %, against 22 s and 72 s when growth was fastest for an empty army (3.2 %). The peak rewards a player who keeps an army at home, and nations, which keep a reserve, sat near it: on World against normal nations, twelve seeds, the scripted average player won 1 game in 12 instead of 6. It now opens a war only with 60 % of its cap and keeps 35 % at home, as a player reading the population bar would; with growth as before, that changes nothing (6 wins of 12 either way). With troops at work (`R-ECO-07`) as well, normal nations decide every 2 s instead of 1 and keep 10 % of their cap instead of 25 %, and easy nations wait 3 minutes instead of 2.5: on World the average player wins 5 games of 12 at normal (4 before the peak, with troops at work) and is never eliminated, none at hard (eliminated in 5, against 7 before) and 10 at easy. A later hunt, a smaller attack ratio or a longer grace at normal left it at 2 or 3 wins, every 3 or 4 s at 8 or 9. Normal bots decide every 5 s instead of 3 and send 15 % instead of 25 %; games without nations are still much harder than before: against eight normal bots the average player wins 2 games of 8 instead of 8, against eight easy ones 5, against eight hard ones 1, as before. Values were tried with `pnpm balance -- --average --set growthFloorPercent=…`.

`B-POP-FALLOFF` was off (100 %) until the scripted average player learnt to sail. It was tried at 50 % past 20 % of the land with eight hard bots on World, five seeds, once bots had learnt to sail (`R-BOT-05`): the leader reached `B-WIN-SHARE` in 7 to 8 minutes in every seed, with or without it, and on a small map with three bots, every bot being past the share, the lead changed hands for 15 minutes. That was not worth the stalemates then.

The average player used to stall near 61 % of World: once free land was gone, it attacked the scraps a neighbouring nation had left along its border every 2 s, each attack ending the next tick, and with a land enemy always in sight it never sailed. Games that showed as undecided, or as a player held at 61 %, were that. It now looks overseas first when its land grows by less than 1 % over 30 s. With that alone, on World against normal nations, twelve seeds and 30 minutes, it won 11 games of 12 in 10 minutes at the median, and as many at hard as at normal: the difficulty no longer told the levels apart. The same stall held back nations that led: `R-BOT-18` sends them overseas when their neighbours are down to scraps.

Sending troops at those scraps and calling them back also stacked an army: troops away in an attack leave room under the cap, the army at home grows into it, and the troops coming back sit on top. The average player held 43 million troops for a cap of 16 million and 100 million gold after 20 minutes. `B-DESERTION` lets the excess drift away, half of it in about 14 s.

Against the leader that runs away with the map, what works is the cap: past 20 % of the land each tile adds 70 % of its usual troops (`B-POP-FALLOFF`), so a large empire grows thinner, as the sublinear population of the reference game does. Stronger defense (`B-DEFENSE-DENSITY` 1.5 or 2), slower attacks (`B-ATTACK-SPEED` 8) or a base income for every player left the average player at 7 to 11 wins of 12; nations that hunt sooner, bolder or after a shorter grace at hard left more games undecided without fewer wins. At 50 % past 20 %, hard falls to 3 wins but only half the games end in 30 minutes; at 30 % past 15 %, one game of twelve ends. With the values above, on World, twelve seeds and 30 minutes, the average player wins:

| Nations | Collapsing fronts (the default) | No special rule                       | Capital mode                |
| ------- | ------------------------------- | ------------------------------------- | --------------------------- |
| Easy    |                                 | 4 of 12, never eliminated (6 decided) |                             |
| Normal  | 4 of 12 (12 decided)            | 5 of 12 (12 decided)                  | 6 of 12 (12 decided, 7 min) |
| Hard    | 0 of 12 (6 decided)             | 0 of 12 (6 decided)                   | 0 of 12 (12 decided, 8 min) |

Easy nations keep 25 % of their cap at home instead of 60 %: with 60 % they were too dense for anyone to take, and the average player won 1 game in 12 there. Easy nations launched up to 36 missiles a minute between them once rich; `B-NATION-MISSILE-PAUSE` and a dearer light missile (600,000 instead of 300,000, nearer the reference game's 750,000) bring that down to 70 a game at the median. Games of bots alone are unchanged: against eight normal bots on World, or eleven on Europe, the average player wins 2 games of 12 either way, and a bot still wins in 6 to 10 minutes. Hard nations keep 40 % of their cap at home instead of 10 %: with 10 %, on Europe, the average player ate the largest and thinnest nation and won 10 games of 12 in under 7 minutes, before the hunt (`B-NATION-HUNT`) starts. With 40 % it wins 1 game of 12 there (11 decided), and none on World, where hard nations eliminate it after 6.5 minutes at the median; 25 % left Europe at 6 wins. On Europe against normal nations it wins 5 games of 12; a reserve of 25 % for normal nations made them easier to beat (9 on Europe, 11 on World), so normal keeps 10 %. Values were measured with `pnpm balance -- --map world --bots normal:0 --nations normal --average --minutes 30 --seeds 1-12 --rule collapsingFronts`.

With ships for everyone, a scripted player that also sails (free land first, then its weakest neighbour, then a ship to a free or weaker coast, 30 % of its troops every 5 s) wins most solo games: against 7 normal bots on World, 7 seeds out of 8, in 5.5 to 7.2 minutes; against the menu's default of 11 normal bots on Europe, 5 out of 6, in 4.3 to 5.4 minutes. Against 7 hard bots on World it wins 2 seeds out of 4. A real casual player is slower than this script, so these are upper bounds; playtests decide whether normal bots need to be bolder.

Fights between players then lasted no time at all: on World against normal nations, an attack that took a player's land lasted 0.7 s at the median, and the average player lost 96 % of its land within 10 s at its worst moment, when a few nations fell on it together at the end of their grace. `B-ATTACK-PACE` ties the speed of an attack on a player to the length of its front and to its odds against the soldiers facing it, as the reference game does with the shared border and the balance of forces; the price of a tile and the defender's losses (`R-ATTACK-03`) are unchanged, so both sides still pay for every tile. With a pace of 20 % at odds of 3, attacks take land at 23 tiles a second at the median instead of 159, and the nations' first attacks no longer sweep the average player away: its largest loss in 10 s comes after 2 to 24 minutes instead of at once, and in 9 games of 24 stays under a quarter of its land. A player already worn down to a few thousand tiles still falls within 10 s to a much larger neighbour, two rows of tiles a second. A slower pace (10 % at odds of 5) left most games undecided after 30 minutes; a pace without a ceiling for larger odds brought back the 10-second collapse. Counting troops away in attacks against the cap made the game easier (13 wins of 24) and was dropped.

The land limit on cities (`B-CITY-LAND`, 40,000 tiles per city on World) and a gold income that followed troops alone left a small player with one city and about 200 gold a second. Cities are now limited by their growing price only, and every player earns `B-GOLD-BASE`. A ceiling of 1,000,000 on the price of a structure, as in the reference game, let the average player stack cities and win 14 to 19 games of 24, and was dropped.

Slower fights stop one nation from rolling over the others, and the average player won 11 games of 24 against normal nations. Normal nations now decide every second (`B-NATION-INTERVAL`), hold back less under attack (`B-NATION-HOLD`), keep 40 % of their cap at home (`B-NATION-RESERVE`) and end their grace after 100 s (`B-NATION-GRACE`): at 90 s the average player won 1 game of 24, at 105 s 11. On World, 30 minutes, collapsing fronts, the average player wins:

| Nations | Before                   | After                                                  |
| ------- | ------------------------ | ------------------------------------------------------ |
| Normal  | 5 of 24 (nations win 19) | 7 of 24 (nations win 10, 7 undecided), eliminated in 2 |
| Hard    | 0 of 12, eliminated in 5 | 0 of 12, eliminated in 6                               |

Players found every level too hard after that, easy included, so the grace was lengthened again: the longer it is, the more free land the player takes before any nation turns on them. Normal went from 100 to 140 s, where the average player wins 9 games of 24 (7 at 100 s, 5 at 110 s, 7 at 120 s, 17 at 160 s), and is eliminated in 1. Hard went from 90 to 115 s, where the average player wins 3 games of 12 and is never eliminated, 7 games staying undecided (0 at 110 s, 5 at 120 s). Easy went from 180 to 300 s, where the average player wins 22 games of 24 in 13 to 21 minutes, and is never eliminated (11 at 180 s, 22 as well at 420 s). Lower `B-NATION-ODDS` or `B-NATION-ATTACK-RATIO` made the game harder, not easier: nations that fight each other less grow faster. A player cut down to a few thousand tiles still loses most of it within 10 s when a large nation turns on them: the pace of an attack follows the front, and a small country is all front.

Missiles then changed nothing that lasted. On World against normal nations, a light missile took 0.54 % of the land of the player it struck (median of 1,305 strikes) and as much of their troops, and 30 s later that player held all of it again: free land is cheap to take back. A light missile now leaves 30 s of fallout (`B-FALLOUT-TIME-LIGHT`) and kills three times that share of troops (`B-MISSILE-TROOPS`): none of the land is back 30 s later. The heavy missile was a bargain at 2.5 times the price for 6 times the land; it now covers 90 tiles on World for 3,000,000 gold and leaves 90 s of fallout. With nations firing as often, the average player won 6 games of 24 at normal; with `B-NATION-MISSILE-PAUSE` doubled, it wins 21 of 24 at easy, 8 of 24 at normal and 5 of 12 at hard, within the noise of 22, 9 and 3 before. Flattening gold instead (0.3 gold per 100 troops, 800 a second for everyone) made normal harder, 5 of 24.

Easy was still too hard for a real player: the scripted casual player (World, 8 seeds, 30 minutes) was eliminated in 2 games and, after 15 minutes, a nation held half of the land in the median game. Easy nations now decide every 10 s instead of 5, send 8 % of their troops instead of 15, leave players alone for 10 minutes instead of 5, and fire a missile every 10 minutes instead of 4. The casual player is then never eliminated and wins 8 games of 8 (21 minutes at the median), and the average player still wins 23 games of 24 (18 minutes at the median). Normal and hard are untouched. Measured with `pnpm balance -- --map world --bots normal:0 --nations easy --casual --minutes 30 --seeds 1-8`.

## Capitals

| Key                  | Value | Unit        | Used by    | Notes                                                         |
| -------------------- | ----: | ----------- | ---------- | ------------------------------------------------------------- |
| `B-CAPITAL-RADIUS`   |    15 | tiles       | `R-CAP-02` | On a map of 2^19 tiles; 30 on World                           |
| `B-CAPITAL-STRENGTH` |   300 | % of price  | `R-CAP-02` | Paid by attackers inside the radius; a fort does not add      |
| `B-CAPITAL-GARRISON` |    20 | % of troops | `R-CAP-02` | Of the owner's soldiers, added to the capital tile's price    |
| `B-CAPITAL-SPOILS`   |    50 | %           | `R-CAP-03` | Of the fallen player's troops; the gold all goes (`R-ECO-08`) |
| `B-CAPITAL-RAZE`     |    50 | % of troops | `R-CAP-04` | Lost when a missile razes the capital                         |
| `B-CAPITAL-GRACE`    |   180 | s           | `R-CAP-06` | Of play before a capital can fall                             |
| `B-CAPITAL-ALERT`    |    30 | tiles       | `R-CAP-05` | Enemy land this close threatens a capital; 60 on World        |

Like a fort's, the radius and the alert distance grow with the spawn radius on larger maps. A capital is harder to take than a fort, but it cannot be moved or rebuilt, and it costs everything once lost: the only way to keep it is to keep the fronts away from it.

## Landmarks

| Key                          | Value | Unit       | Used by     | Notes                                                       |
| ---------------------------- | ----: | ---------- | ----------- | ----------------------------------------------------------- |
| `B-LANDMARK-GOLD`            |    20 | %          | `R-LAND-02` | More gold from troops and workers, for each gold landmark   |
| `B-LANDMARK-GROWTH`          |    15 | %          | `R-LAND-02` | Faster troop growth, never past the cap                     |
| `B-LANDMARK-FORTRESS-RADIUS` |    12 | tiles      | `R-LAND-02` | On a map of 2^19 tiles, growing with larger maps like forts |
| `B-LANDMARK-FORTRESS`        |   200 | % of price | `R-LAND-02` | Paid inside the radius; a fort or a capital does not add    |
| `B-LANDMARK-TRADE`           |    50 | %          | `R-LAND-02` | More gold from each trade ship, sent or received            |
| `B-LANDMARK-SHIELD-RADIUS`   |    40 | tiles      | `R-LAND-02` | On a map of 2^19 tiles                                      |
| `B-LANDMARK-SHIELD-CHANCE`   |    50 | %          | `R-LAND-02` | Per missile, on the tick it comes within the radius         |
| `B-LANDMARK-ASSAULT`         |    10 | %          | `R-LAND-02` | Less paid for each tile the holder's attacks and ships take |

First values. A landmark is worth a detour but not a game: a gold landmark is about what a city adds to a mid-sized empire's income, and the fortress doubles the price of the land around Sacré-Cœur or Fourvière, less than a fort. With them, the scripted average player wins 8 games of 24 against normal nations on Paris and 5 on Lyon (`pnpm balance -- --map paris --bots normal:4 --nations normal --average --seeds 1-24`); nations do not seek landmarks out yet, they take them as their fronts reach them.

## Victory

| Key           | Value | Unit              | Used by    | Notes |
| ------------- | ----: | ----------------- | ---------- | ----- |
| `B-WIN-SHARE` |    75 | % of ownable land | `R-WIN-01` |       |

Nico's targets (30 October): a player getting the hang of the game (`--intermediate`: an order every 3 s with 40 % of its troops) wins or leads with more than 40 % of the land after 22.5 minutes of play, which is 30 minutes at the normal pace (`B-BASE-PACE`), in 80 % of games at easy, 50 % at normal and 30 % at hard. Nations at normal and hard used to send 40 % and 60 % of their troops after 140 and 115 s: this player was eliminated after about 5 minutes, and won or led 2 games of 12 at normal and 1 at hard. With 20 % of their troops at normal, 30 % at hard and a grace of 600 s for both, it wins or leads 11 games of 24 at normal and 6 of 24 at hard (after the disc-shaped missiles, 6 of 24 at normal and 7 at hard; normal then got odds of 80 % and a hold of 50 %: 10 of 24); at easy, with the values of 0.9.3, 12 of 12 (and the casual player about 9 of 12). Measured with `pnpm balance -- --map world --bots normal:0 --nations normal --intermediate --minutes 22.5 --seeds 1-24 --rule collapsingFronts`. A win alone is too rare to measure at normal and hard, because nations stall near 61 % of the land, so "won or led" is the figure. Variations of a few points are noise: the same values with a ratio of 22 % gave 1 game of 12 instead of 5.
