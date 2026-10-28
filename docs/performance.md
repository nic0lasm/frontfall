# Performance

Frontfall has to simulate a 4096 × 2048 world ten times per second on every
client and draw it smoothly in a browser, phones included. This document sets
the budgets the code is held to, explains the data layout that keeps the
simulation inside them, and records what was actually measured. Every number
in the results section comes from the benchmark scripts in [`bench/`](../bench),
not from estimates.

## Budgets

Every budget names the scenario it is measured on and how to measure it.
Those marked **CI** fail the build when they are missed; the others are
checked by hand on the machines below until CI can measure them.

| Area                              | Budget                                   | Scenario                                                                 | Measure with                               | Enforced                 |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ | ------------------------ |
| Simulation tick, full lobby       | p95 ≤ 30 ms                              | Reference game: 64 normal bots on World, 3,000 ticks                     | `pnpm perf:engine`                         | **CI**                   |
| Simulation tick, against `main`   | Not slower: a 10 % slowdown fails        | Reference game, alternated with the merge base                           | `pnpm perf:engine -- --base <checkout>`    | **CI**                   |
| Simulation tick, scripted attacks | p95 ≤ 30 ms                              | 16 scripted players, generated 2048 × 1024, 3,000 ticks                  | `pnpm sim -- … --budget 30`                | **CI**                   |
| Simulation tick, largest map      | p95 ≤ 30 ms                              | Synthetic expansion on 4096 × 2048                                       | `pnpm bench`                               | Exit status, run by hand |
| Simulation memory, largest map    | ≤ 96 MiB of typed arrays                 | Synthetic expansion on 4096 × 2048                                       | `pnpm bench` (Engine memory column)        | By hand                  |
| Allocation per tick               | None in the hot loops once warm          | Synthetic expansion                                                      | `pnpm bench` (heap growth per scenario)    | By hand                  |
| Download, first visit             | ≤ 275 kB sent                            | Page, code, styles, English texts and Latin font of the production build | `pnpm perf:client`                         | **CI**                   |
| Download, simulation worker       | ≤ 50 kB sent                             | Production build                                                         | `pnpm perf:client`                         | **CI**                   |
| Download, World map               | ≤ 175 kB sent                            | Production build                                                         | `pnpm perf:client`                         | **CI**                   |
| Download, every map               | ≤ 520 kB sent                            | Production build                                                         | `pnpm perf:client`                         | **CI**                   |
| Download, whole build but maps    | ≤ 850 kB sent                            | Production build, icons and preview image included                       | `pnpm perf:client`                         | **CI**                   |
| Load, menu and game screen        | Trend only                               | Solo game on World with 63 bots, headless Chromium                       | `pnpm perf:client -- --trend`              | Reported in CI           |
| Frame rate in a game              | Trend only                               | Same game, camera panning, software rendering                            | `pnpm perf:client -- --trend`              | Reported in CI           |
| Frame time, desktop GPU           | ≤ 16.7 ms (60 fps)                       | Same game, or `bench:render` on a laptop                                 | `pnpm bench:render -- --gpu`, then by hand | By hand                  |
| Frame time, mid-range phone       | ≤ 33 ms (30 fps)                         | `bench:render` page opened on the phone                                  | `pnpm bench:render -- --serve`             | By hand                  |
| Draw calls for map and units      | ≤ 10                                     | Synthetic renderer, 10,000 units                                         | `pnpm bench:render`                        | By hand                  |
| Territory upload per tick         | ≤ 1 MiB typical, full map only on resync | Synthetic renderer                                                       | `pnpm bench:render`                        | By hand                  |
| GPU memory for map and units      | ≤ 64 MiB at 4096 × 2048                  | Synthetic renderer                                                       | `pnpm bench:render`                        | By hand                  |
| Main-thread CPU to issue a frame  | ≤ 2 ms                                   | Synthetic renderer                                                       | `pnpm bench:render`                        | By hand                  |

Why these numbers:

- **Tick, 30 ms.** Ten ticks per second leave 100 ms per tick. The engine
  runs in a Web Worker next to the page on phones that are several times
  slower than a CI machine, and the page needs the rest of the CPU.
- **Memory, 96 MiB.** A 4 GB phone kills the tab well before the device limit.
- **Download.** "Sent" is what the game server sends: gzip for text, code
  and maps, as is for fonts and images. A CDN with Brotli sends a little less;
  `perf:client` prints both. The first visit also counts every script and
  style index.html loads up front, so a chunk the bundler splits off the
  entry, or the old-browser check, cannot slip out of it; the favicons,
  small images the browser keeps, are left out. The budgets leave about 15 % of room over the
  build of 2026-10-24: a new dependency or asset that takes more has to be
  argued for, and the budget raised in [`bench/client/budget.json`](../bench/client/budget.json)
  in the same commit.
- **Frame time.** 60 fps on a laptop, 30 fps on a phone. CI has no GPU, so
  its frame rate only shows whether the client got slower to draw, not
  whether it holds the budget.

### Reference machines

| Machine                      | Used for                                        | Notes                                                          |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| GitHub `ubuntu-24.04` runner | Every CI budget, and the comparison with `main` | 4 vCPU, shared: absolute times vary by run, ratios do not      |
| 4-core Intel Xeon, 2.1 GHz   | The results below                               | Cloud VM, 16 GB                                                |
| MacBook Air, Apple M4        | Desktop frame time                              | Chrome on the GPU, `pnpm bench:render -- --gpu`; results below |
| A mid-range phone            | Phone frame time                                | To do: `pnpm bench:render -- --serve` on the same network      |

## Running the benchmarks

```sh
pnpm bench                      # simulation scenarios, about a minute
pnpm bench -- --quick           # a tenth of the ticks, for a quick check
pnpm bench -- --scenario reference --json results.json

pnpm perf:engine                # reference game, budget only, about a minute
pnpm perf:engine -- --base ../frontfall-main   # alternated with another checkout
pnpm perf:client                # download sizes of the production build
pnpm perf:client -- --trend     # and load times and frame rate in Chromium

pnpm bench:render               # renderer in headless Chromium (software GL)
pnpm bench:render -- --gpu      # same, on the machine's GPU
pnpm bench:render -- --serve    # serves the page on port 5180 to open by hand,
                                # for example on a phone on the same network
```

`pnpm bench` exits with a non-zero status when a scenario misses the tick
budget. `pnpm bench:render` needs a Chromium build: it uses Playwright's
browser if one is installed, or the one named by `CHROMIUM_PATH`.

Both use the same seeded workload, so two runs simulate exactly the same
game. The engine table prints a digest of the final owner array: if two runs
disagree on it, the simulation is no longer deterministic.

### The workload

There are no game rules yet, so [`bench/engine/workload.ts`](../bench/engine/workload.ts)
stands in for the expansion phase of a tick, using only engine data
structures. Every player picks random tiles of its front line and pushes
into a neighbouring land tile that it does not own, then the surroundings of
up to 64 freshly captured tiles are checked for enclosed pockets of at most
512 tiles, which are annexed. The map is 60 % land in 64 × 64 blocks with
noisy coasts. The access pattern (random border picks, ownership changes,
bounded fills) is the one the real rules will have; the numbers will be
measured again when they land.

| Scenario  | Map         | Players | Attempted captures/tick |
| --------- | ----------- | ------: | ----------------------: |
| reference | 4096 × 2048 |      64 |                   4,000 |
| crowded   | 4096 × 2048 |     512 |                   4,000 |
| assault   | 4096 × 2048 |      64 |                  20,000 |
| medium    | 2048 × 1024 |      32 |                   2,000 |

Each scenario runs untimed warm-up ticks first (300, or 100 for `assault`)
so territories and border lists reach a realistic size, then times 300 ticks.

## The performance gate in CI

The Performance job of CI runs on every push and pull request. It writes its
tables to the run's job summary, so the numbers are on the run page.

### Engine

[`bench/gate`](../bench/gate) plays the **reference game**: 64 bots of normal
difficulty on the World map, seed 2026, for 3,000 ticks, the first 200 of
which are the untimed spawn phase. It covers the busiest stretch of a full
lobby: by tick 3,000 the bots have fought for most of the land, sailed, and
built cities. Bots do not build forts, so every 50 ticks each bot with an even
id is also ordered to put one on its border, up to two: about 70 forts stand
by the end, and attacks go through fortified land. Nobody else gives orders,
so the game depends only on the engine and the seed.

The gate measures the tick time this way:

1. The mean of each run's ticks at or below its 99th percentile, so that a
   GC pause or a time slice stolen by a neighbour on the shared runner does
   not move it. Every run is a fresh Node process.
2. With `--base`, a checkout of the commit the branch started from (the merge
   base with `main`, or the pull request's base), the game is played on both
   engines in turn, on the same machine, with the same harness and map: a
   warm-up pair that is thrown away, then pairs in ABBA order so that a
   machine getting faster or slower during the job favours neither side.
3. Each pair gives a ratio, this commit's time over the base's. After five
   pairs, a median under 1.04 passes and one over 1.10 fails. Anything in
   between gets five more pairs, and then fails when the median of the ten is
   over 1.06 and at least 70 % of the pairs found this commit slower.

The rule comes from the spread measured between two runs of the same engine:
a few percent per pair on a cloud VM, and once 11.5 % for a single pair. The median
of ten pairs puts a true 10 % slowdown well above 1.06 and an unchanged
engine well below it. Absolute times are compared with nothing but the
30 ms budget, which keeps three times the measured p95 as room.

When `packages/engine` is the same as on the base, the comparison is skipped
and only the budget is checked, on three runs. When the base cannot play the
reference game (an engine API the harness relies on changed), the job says
so and checks the budget only. When the two engines end in different states, the summary says the rules or
the bots changed: the slowdown is then that of a different game, which may be
what the change is for. A slowdown that is worth it is accepted in review with
a trailer in the message of one of the branch's commits:

```text
Performance-Accepted: forts make every attack check its target's surroundings
```

The gate then reports the slowdown with a warning on the run instead of
failing; the 30 ms budget still applies. The trailer counts in any commit
between the base and the branch's head, so it covers the whole branch, and
it only matters while the engine differs from the base.

The job runs on every push and pull request, Dependabot's included, so a
dependency update is held to the download budgets too. Publish does not wait
for CI: once a commit is on `main` it is deployed whatever the gate said,
which is why branches are fast-forwarded onto `main` only after their run is
green (CONTRIBUTING).

`pnpm perf:engine -- --base <checkout> --slowdown 10` slows this checkout's
ticks down by 10 % with a busy wait, to check that the gate still catches it.

### Client

`pnpm perf:client` measures the production build in `apps/client/dist`
against [`bench/client/budget.json`](../bench/client/budget.json), the way
the game server sends it, and fails when a group is over. Sizes do not depend
on the machine, so this check cannot be flaky.

With `--trend`, it then serves the build with the real game server, opens a
solo game on World with 63 normal bots in headless Chromium at 1280 × 720,
and records the time to show the menu, the time from Play to the game screen,
and the frame rate while the camera pans, once in the spawn phase and once
bots are attacking. Chromium draws in software on CI, so these numbers never
fail the job: compare them between runs to see a trend.

## Simulation data layout

### Territory

[`TerritoryMap`](../packages/engine/src/territory/territory-map.ts) keeps
ownership in flat typed arrays indexed by tile:

| Array        | Type          |    Bytes per tile | Purpose                                                |
| ------------ | ------------- | ----------------: | ------------------------------------------------------ |
| `owners`     | `Uint16Array` |                 2 | Owner id, 0 for neutral; up to 65,535 players          |
| border slots | `Int32Array`  |                 4 | Position of the tile in its owner's border list, or -1 |
| border lists | `Int32Array`  | border tiles only | One unordered list per player                          |
| change log   | `Int32Array`  |    fixed, 256 KiB | Tiles changed since the renderer last looked           |

A border tile is an owned tile with at least one orthogonal neighbour held by
someone else, neutral included. When a tile changes hands, only that tile and
its four neighbours can gain or lose border status, so `setOwner` patches the
lists in constant time: removal swaps the last entry into the freed slot. The
list order depends only on the sequence of changes, so picking a border tile
by index with the seeded random generator stays deterministic across clients.

The change log lets the renderer, or the worker that forwards changes to it,
read what changed without diffing the map. When more tiles change than it
holds, it reports an overflow and the consumer redraws everything.

### Bounded flood fill

[`BoundedFloodFill`](../packages/engine/src/territory/bounded-flood-fill.ts)
answers questions such as "is this pocket enclosed?". Only small regions
matter, so the fill gives up as soon as it passes a tile limit instead of
walking the whole continent. Visited tiles are stamped with a generation
number (2 bytes per tile) rather than cleared, so starting a fill is free; the
queue grows to the largest limit used and is reused afterwards.

### Neighbours

`WorldGrid.neighbors()` returns a new array on every call, which is fine in
tests and tools but not in a loop that runs millions of times per second.
`WorldGrid.neighborsInto()` writes the same tiles, in the same order, into a
caller-owned `Int32Array`. Every hot path in the engine uses it, which keeps
the east-west wrap in one place.

## Rendering pipeline

### Territory layer

[`TerritoryLayer`](../apps/client/src/render/territory-layer.ts) draws the
whole map in one draw call:

- Owners are an `R16UI` integer texture whose data **is** the simulation's
  `Uint16Array`: no copy and no conversion on the CPU.
- Terrain is an `R8UI` texture uploaded once.
- A palette texture maps owner ids to colours, 256 entries per row.
- The fragment shader fetches the tile under the pixel with `texelFetch`,
  looks up its colour, and compares it with its four neighbours to draw
  borders. Borders therefore cost no upload at all.
- The mesh spans three copies of the world side by side and wraps columns in
  the shader. With the camera kept over the middle copy, the seam is never
  visible.

After each tick, the changed tiles mark their rows dirty in chunks of
`max(64, width / 32)` columns, and only those chunks are uploaded with
`texSubImage2D`, one call per run of dirty chunks in a row.

### Units

[`UnitLayer`](../apps/client/src/render/unit-layer.ts) draws every unit of one
kind with a single `InstancedMesh`. The vertex shader moves each instance to
the copy of the world nearest the camera, so units near the seam are not
duplicated. Only the span of instances changed since the last frame is
uploaded.

### Mobile compatibility

- WebGL 2 is required: integer textures, `texelFetch` and instancing are core
  features there, so no extension is needed. three.js no longer supports
  WebGL 1 anyway.
- WebGL 2 only guarantees 2048 texels per side. The largest map needs
  `MAX_TEXTURE_SIZE` ≥ 4096, which current phones report; on a device that
  does not, the owner texture has to be split in two halves, not yet done.
- The device pixel ratio should be capped at 2: a phone at ratio 3 shades
  2.25 times more pixels for no visible gain on a tile map.
- No float textures, no derivatives, no depth tricks: the shader only uses
  integer fetches and comparisons.

## Results

Measured on 2026-10-23 with Node 22.22.0 on a 4-core Intel Xeon at 2.10 GHz
(cloud VM, 16 GB), with `pnpm bench` and `pnpm bench:render`.

### Simulation

| Scenario  | Map       | Players | Tiles changed/tick | Tick p50 | Tick p95 | Tick max | Full rescan | Engine memory |
| --------- | --------- | ------: | -----------------: | -------: | -------: | -------: | ----------: | ------------: |
| reference | 4096×2048 |      64 |              1,625 |  2.77 ms |  3.52 ms | 13.62 ms |    39.84 ms |      72.6 MiB |
| crowded   | 4096×2048 |     512 |              2,676 |  3.64 ms |  5.74 ms | 12.59 ms |    47.37 ms |      73.2 MiB |
| assault   | 4096×2048 |      64 |              5,896 |  7.27 ms |  9.21 ms | 11.95 ms |    53.82 ms |      72.9 MiB |
| medium    | 2048×1024 |      32 |                739 |  2.29 ms |  3.90 ms |  5.87 ms |    10.73 ms |      18.4 MiB |

- Every scenario is within the 30 ms budget at p95, the heaviest by a factor
  of three. Ticks above p99 (up to 13.6 ms) happen while border lists grow;
  they are still inside the budget.
- Fewer tiles change than are attempted because many picks land on a coast or
  on a tile the player already owns, as they would in a real game.
- **Full rescan** is the time a naive tick would spend scanning every tile to
  find the front lines: 40 to 54 ms on the largest map, over the whole budget
  on its own. The incremental border lists are what make the budget reachable.
- Memory on the largest map: 48 MiB for ownership (6 bytes per tile),
  16 MiB for the flood fill stamps, 8 MiB for terrain, and the border lists
  for the rest. The JavaScript heap grows by less than 1 MiB per scenario.

### Performance gate

Measured on 2026-10-24 on the same machine, with Node 22.22.0.

| Run                                               | Pairs | Ratios                            | Median | Verdict                      |
| ------------------------------------------------- | ----: | --------------------------------- | -----: | ---------------------------- |
| Same engine on both sides (`main` against itself) |     5 | 0.942, 1.083, 1.011, 0.964, 0.971 |  0.971 | Not slower, after five pairs |
| This commit slowed down by 10 % (`--slowdown 10`) |     5 | 1.104, 1.105, 1.096, 0.973, 1.135 |  1.104 | Slower, after five pairs     |

The same two runs on a GitHub `ubuntu-24.04` runner (AMD EPYC 7763, 4 vCPU,
Node 24.21.0) spread far less:

| Run                                               | Pairs | Ratios                            | Median | Verdict                      |
| ------------------------------------------------- | ----: | --------------------------------- | -----: | ---------------------------- |
| Same engine on both sides                         |     5 | 1.005, 0.992, 1.000, 1.000, 0.987 |  1.000 | Not slower, after five pairs |
| This commit slowed down by 10 % (`--slowdown 10`) |     5 | 1.100, 1.094, 1.075, 1.113, 1.106 |  1.100 | Slower, after five pairs     |

There the reference game took 4.1 ms per tick on average, p95 6.4 ms, max
12 to 13 ms. The Performance job takes about two minutes when the engine did not change,
four when it did and five pairs decide, and six and a half with ten pairs.

The reference game took 5.2 to 5.3 ms per tick on average, p95 8.5 to
9.1 ms, max 17 to 26 ms; 54 bots were alive at tick 3,000, with 40 cities
and 71 forts.

### Client

| Files                                       | Raw       | Sent (gzip) | Brotli   | Budget   |
| ------------------------------------------- | --------- | ----------- | -------- | -------- |
| First visit: page, code, styles, Latin font | 270.6 kB  | 117.1 kB    | 112.9 kB | 275.0 kB |
| Simulation worker                           | 73.8 kB   | 23.5 kB     | 22.5 kB  | 50.0 kB  |
| World map                                   | 2103.5 kB | 150.0 kB    | 137.1 kB | 175.0 kB |
| Every map                                   | 7194.7 kB | 442.2 kB    | 390.4 kB | 520.0 kB |
| Whole build but maps                        | 1356.2 kB | 730.0 kB    | 709.3 kB | 850.0 kB |

The game screen, the renderer (Three.js) and the territory layer are no longer
part of the first visit (2026-10-28): the menu loads without them, and the page
fetches them once it is idle, or on Play if it was not yet. The first visit went from
273.7 kB to 117.1 kB sent; the whole build is the same size. An online game
fetches them as the lobby opens, and holds the turns that come in before the
screen exists.

Each language's texts are a file of their own since 2026-10-27: a page
downloads the catalogue of the language it shows, and another one only when
the player picks it in the menu. The first visit went from 274.8 kB to
268.8 kB sent, with the English texts counted; a French page downloads the
French ones instead, about the same size. The catalogue comes after the
page's code, in parallel with the map list, so the menu does not wait longer.

The worker had reached 50.0 kB, more than half of it the schema library
(zod), which came in with the map manifest it checked. The page now checks
the manifest and hands it to the worker, and the protocol package is marked
free of side effects, so the worker keeps only the constants it reads from it.

In headless Chromium on SwiftShader, the menu showed 1.3 s after the page was
requested and the World game 2.2 s after Play. Panning ran at 22 frames per
second in the spawn phase (p95 83 ms) and 20 once 63 bots were attacking
(p95 100 ms): software rendering, not a frame rate a player would see.

### Rendering, real GPU

Measured on 2026-10-24 on a MacBook Air with an Apple M4, in Google Chrome
(ANGLE on Metal, maximum texture size 16,384), with
`CHROMIUM_PATH=".../Google Chrome" pnpm bench:render -- --gpu`.

| Map       | Viewport |  Units | Draw calls | Static frame p50 / p95 | Frame with a tick p50 / p95 | Full upload frame | First frame | GPU memory |
| --------- | -------- | -----: | ---------: | ---------------------- | --------------------------- | ----------------: | ----------: | ---------: |
| 4096×2048 | 1280×720 | 10,000 |          2 | 1.0 / 1.8 ms           | 16.9 / 19.0 ms              |            7.9 ms |    241.4 ms |   80.7 MiB |
| 2048×1024 | 1280×720 |  2,000 |          2 | 0.5 / 1.2 ms           | 11.8 / 13.1 ms              |            3.9 ms |     21.6 ms |   20.1 MiB |
| 2048×1024 | 780×1688 |  2,000 |          2 | 0.5 / 1.1 ms           | 11.6 / 13.3 ms              |            2.7 ms |     22.4 ms |   20.1 MiB |

- A frame that only redraws stays under 2 ms at p95: the GPU is far from the
  16.7 ms budget.
- On World (2048 × 1024), a frame that also uploads a tick's changes takes
  13 ms at p95, inside the budget. On the 4096 × 2048 map it takes 19 ms, over
  it: that frame comes once per tick, one frame in six at 60 fps, so a player
  sees an occasional dropped frame. The upload, not the drawing, is the cost to
  cut there.
- GPU memory on the largest map is 80.7 MiB, over the 64 MiB budget, against
  24.7 MiB under SwiftShader: Metal reports what the driver allocates, padding
  and copies included. Phones will tell whether the budget needs to change.
- The globe renderer being tried on the `spike/globe` branch draws World in
  1 draw call at 0.4 to 0.5 ms (p95 0.8 to 1.0 ms) per static frame, and
  11.8 ms (p95 13.3 to 15.2 ms) with a tick, at both zoom levels tried.

### Rendering, software GL

Headless Chromium on SwiftShader, Google's CPU implementation of the GPU, on
the same machine. Frame times include waiting for the frame to finish.

| Map       | Viewport |  Units | Draw calls | Triangles | Frame p50 / p95  | Frame with a tick p50 / p95 | Uploaded per tick          | Full upload frame | GPU memory |
| --------- | -------- | -----: | ---------: | --------: | ---------------- | --------------------------- | -------------------------- | ----------------: | ---------: |
| 4096×2048 | 1280×720 | 10,000 |          2 |    80,002 | 182.9 / 209.8 ms | 191.3 / 217.5 ms            | 209,437 texels, 1,121 rows |          218.8 ms |   24.7 MiB |
| 2048×1024 | 1280×720 |  2,000 |          2 |    16,002 | 66.9 / 81.5 ms   | 67.6 / 81.1 ms              | 66,210 texels, 639 rows    |           67.1 ms |    6.1 MiB |
| 2048×1024 | 780×1688 |  2,000 |          2 |    16,002 | 68.3 / 79.2 ms   | 68.4 / 79.9 ms              | 66,210 texels, 639 rows    |           63.8 ms |    6.1 MiB |

What these numbers do show:

- The whole map plus 10,000 units costs **2 draw calls**, and issuing a frame
  takes 0.2 ms of main-thread CPU.
- A tick on the largest map uploads about 209,000 texels (0.4 MiB) instead of
  the 8.4 million of a full upload (16 MiB). An earlier version that uploaded
  one span per row, from the first to the last changed column, sent 670,518
  texels per tick in a quick run.
- GPU memory stays at a third of the budget on the largest map.

What they do not show is frame rate on a real GPU: SwiftShader rasterises on
the CPU, so absolute frame times are only useful to compare two versions of
the renderer on the same machine. A one-off quick run of the largest map with a
single unit instead of 10,000 took 26.3 ms per frame instead of 183 ms, so in
software almost all of the frame goes to the tiny unit triangles, which are
smaller than a pixel when the whole world is on screen. Frame rate budgets
will be checked with `pnpm bench:render -- --gpu` on a laptop and with
`--serve` on a phone; this section will be updated with those runs.

### Full game rules

`pnpm sim` plays a whole game with the real rules: a generated map of
2048×1024 tiles with several continents, scripted players that each send a
third of their troops every ten ticks, and `createGame` driven by a
`TurnClock`. It is the measure that counts once players touch: the synthetic
workload above has no attacks between players and no encirclement.

```sh
pnpm sim -- --width 2048 --height 1024 --players 16 --ticks 6000 --interval 10
pnpm sim -- --budget 30   # exits with an error when the tick p95 is over 30 ms
```

CI runs the 16-player game for 3,000 ticks on every push with `--budget 30`,
and writes its tick median, p95 and maximum to the job summary of the run
(`GITHUB_STEP_SUMMARY`), so the numbers are on the run page without an artifact.

Measured on the same machine, before and after checking enclosures once per
attack and tick instead of once per captured tile:

| Players | Ticks          | Tick p50 | Tick p95 | Tick max | Before: p95 around tick 1,300 |
| ------: | -------------- | -------: | -------: | -------: | ----------------------------: |
|      16 | 4,663 (winner) |  2.36 ms |  7.61 ms | 31.36 ms |                             — |
|      64 | 3,000          |  6.95 ms | 25.32 ms | 44.09 ms |                     172.39 ms |

- With 64 players the worst stretch (ticks 1,500 to 1,900, over 100 attacks
  under way) runs at a p95 of 30 to 36 ms, just over budget. The time goes to
  finding each attack's front line (about half) and to enclosure fills (a
  quarter). v0.1 games have 8 to 16 players; 64 is the target of M7.

### Ports opening

A port that opens searches the sea for routes to the other open ports within
B-TRADE-RANGE: 500 tiles of sea on a map of 2^19 tiles, 1,000 on World. Done
in the tick the port opens, one search took up to 27 ms on World at 500 tiles
and 40 to 50 ms at 1,000, since it then walks most of the ocean. The search
is now spread over ticks, 25,000 water tiles per tick at most, and a port
gets its routes once its search is over, about 5 seconds on World, within
the 10 seconds before its first trade ship. Land masses and the ocean are
also found when the game is created, no longer on first use, which stalled
one tick of play for 48 ms and 108 ms on World.

Measured on World with 8 normal bots and the 64 nations, 20 minutes or to
the winner, then the same with 300,000 gold for every player every 30
seconds so that they build some 70 ports:

| Seed | Ports | Slowest tick of route searches | Slowest tick of the game | Tick p99 |
| ---: | ----: | -----------------------------: | -----------------------: | -------: |
|    1 |    22 |                       12.56 ms |                 21.60 ms |  8.24 ms |
|    2 |    23 |                       13.11 ms |                 21.90 ms | 10.41 ms |
|    3 |    23 |                       13.55 ms |                 18.20 ms |  8.94 ms |
|    1 |    72 |                        8.50 ms |                 23.90 ms | 10.34 ms |
|    2 |    72 |                       10.79 ms |                131.50 ms | 10.03 ms |
|    3 |    67 |                        9.77 ms |                 28.60 ms | 10.75 ms |

Route searches never make a tick slower than 14 ms. The slow ticks left, as
in the second game with 72 ports, come from large attacks and enclosures
when every player is rich, and spend no time on routes.

### Warships and missiles

The warship rules (sailing, captures, fire) and the missile rules (flight,
air defenses, strikes) were timed on their own, tick by tick, on World with
8 normal bots and the 64 nations, seeds 1 to 3, each game played to its
winner (8,318 to 13,783 ticks). Nations owned up to 10 warships at once and
launched 13 to 78 missiles a game.

| Rules    | Mean per tick | Tick p99 | Slowest tick |
| -------- | ------------: | -------: | -----------: |
| Warships |       0.05 ms |  0.58 ms |      7.07 ms |
| Missiles |      0.004 ms |  0.02 ms |      1.10 ms |

A warship's slowest ticks are those where it searches a new path to its
next patrol point, up to `B-BOAT-RANGE` tiles of sea; a missile's are the
tiles of its blast changing hands as it strikes.

## Server load

The game server relays orders and closes one turn every 100 ms for every
game ([protocol](protocol.md)). [`bench/server`](../bench/server) checks that
it keeps that pace with many full games:

```sh
pnpm load -- --spawn-server                           # 20 games × 16 players, 30 min
pnpm load -- --spawn-server --games 20 --players 16 --minutes 2
pnpm load -- --games 20 --players 16 --minutes 30 --url ws://localhost:8080/ws
pnpm load -- --spawn-server --public --json load.json
```

Each simulated player speaks the protocol like the browser: one player per
game creates a private game, the others join it by id and the creator starts
it (`--public` uses matchmaking instead). Every player then sends an order
every 2 s on average (a spawn, then attacks on random tiles with random
troop counts) and a state hash every 50 ticks, and checks every turn it
receives. The report gives, per game:

- **Lateness**: the time between two consecutive turns on one client, minus
  the 100 ms tick. p50, p95 and max over every client of the game.
- **Order latency**: from sending an order to receiving the turn that holds
  it. Half a tick is expected on average, since an order waits for the next
  turn to close.
- Turns lost, reordered or desynced, which make the command exit with a
  non-zero status.

`--spawn-server` runs `createGameServer` in a child process, so its CPU time,
memory and event loop delay are measured apart from the clients'. Without
it, the tool connects to `--url`. Every client sends its own `X-Client-IP`
so that the per-address connection limit does not apply; behind a reverse
proxy that overwrites the header, the limit applies to the whole run.

All the clients run in one process. Its own event loop delay is printed: a
client process that falls behind shows up as lateness that the server did
not cause.

A 10-second run of 2 games of 8 players is part of `pnpm test`
([`bench/test/load.test.ts`](../bench/test/load.test.ts)): every client must
receive every turn in order, and the p95 interval must stay under 300 ms.

### Results

Measured on 2026-10-23 with Node 22.22.0 on the same 4-core Intel Xeon
Processor at 2.10 GHz (cloud VM, 16 GB) as above, with the server and the
320 clients on the same machine, using
`pnpm load -- --spawn-server --games 20 --players 16 --minutes <n>`.

| Run    | Games × players | Turns per client | Lost or reordered | Desyncs | Orders sent / seen | Interval p50 | p95      | p99      | max      | Order latency p50 / p95 / max |
| ------ | --------------- | ---------------: | ----------------: | ------: | -----------------: | -----------: | -------- | -------- | -------- | ----------------------------- |
| 2 min  | 20 × 16         |            1,197 |                 0 |       0 |    19,035 / 19,012 |     100.2 ms | 102.3 ms | 104.6 ms | 141.2 ms | 53.1 / 98.2 / 143.8 ms        |
| 30 min | 20 × 16         |  17,965 – 17,966 |                 0 |       0 |  287,733 / 287,726 |     100.2 ms | 102.4 ms | 105.3 ms | 321.7 ms | 53.0 / 98.1 / 277.5 ms        |

| Run    | Server CPU        | Server RSS        | Server loop delay p99 / max | Client loop delay p99 / max |
| ------ | ----------------- | ----------------- | --------------------------- | --------------------------- |
| 2 min  | 6.9 % of one core | 115 MiB, peak 135 | 4.0 / 53.6 ms               | 1.2 / 40.1 ms               |
| 30 min | 5.9 % of one core | 137 MiB, peak 137 | 4.0 / 74.9 ms               | 1.7 / 168.7 ms              |

- 320 players in 20 full games cost the server about 6 % of one core. Its
  RSS was 115 MiB after 2 minutes and 137 MiB after 30, against 108 MiB for
  a server with a single game of 2 players.
- Turns arrive at their pace: p95 lateness was +1.1 to +3.4 ms depending on
  the game, p99 at most +7 ms. Over 30 minutes no turn was lost, reordered
  or desynced, and every order sent was relayed (the few missing ones were
  in flight when the run stopped).
- The slowest interval, 321.7 ms, came with a 168.7 ms stall of the client
  process; the server's own event loop was never more than 74.9 ms late.
- The mean interval is 100.2 ms, not 100: the server's `setInterval` drifts,
  so a 30-minute game has 35 fewer turns (17,965) than 30 minutes of
  10 ticks/s. Clients follow the turns, not the clock, so this changes only
  the game's real duration.

### Fuzzing

[`apps/server/test/fuzz.test.ts`](../apps/server/test/fuzz.test.ts) feeds
100,000 random, truncated and mutated frames (text and binary, from valid
messages and from scratch) to the decoders in about 2.4 s on this machine, checking that they
never throw and that every accepted binary frame is the canonical encoding of
what it decodes to. It then opens about a thousand connections to a running
server, 1 to 6 frames each, until 4,000 more such frames are sent, checking that `/healthz` still
answers and that a game in progress on the same server keeps receiving its
turns every 100 ms. The generator is seeded; `FUZZ_SEED=<n> pnpm test` tries
other inputs.

It found one crash: a decoding error quotes the client's input, and a
non-ASCII quote could make the close reason longer than the 123 bytes a
WebSocket close frame allows, which made `ws` throw and stopped the whole
server. Reasons are now cut to 123 bytes.

## Next steps

1. Run the render benchmark on phones (a mid-range Android phone, an iPhone)
   and bring the tick upload frame on the largest map under 16.7 ms.
2. Move the simulation into its Web Worker and send each tick's change log to
   the page as a transferable `Int32Array`. A `SharedArrayBuffer` would avoid
   even that copy, but needs cross-origin isolation headers on the server.
3. Wire `TerritoryLayer` and `UnitLayer` into the client in place of the
   current placeholder texture.
4. Hide units, or draw them as points, when they are smaller than a pixel.
5. Measure the frame rate on a GPU in CI, on a runner that has one, and make
   the frame-time budgets fail the build there as the tick budget does.
6. Bring 64-player games under budget: keep each attack's front line between
   ticks instead of rescanning the player's whole border, and share one border
   scan between the attacks of the same player.
7. Run `pnpm load` against the production deployment, behind its reverse
   proxy, from a machine other than the server's.
