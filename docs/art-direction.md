# Art direction

How Frontfall should look and feel from v0.7 on. The identity (logo, ember and front blue, Inter, the twenty player colours) is unchanged and lives in [`brand.md`](brand.md) and `assets/brand/tokens.json`. This page covers what happens inside the game: terrain, territories, pictograms, interface, motion and sound.

The direction is called **Relief**: a lit table-top map, with hill-shaded land, depth-shaded sea and shaded game pieces standing on it.

![World view on a laptop](assets/art-direction/world-laptop-C.png)

The mock-ups are drawn for this page with generated terrain. They fix the look, not the exact pixels.

## Intentions

- **A map you want to look at.** Land and sea have volume and light, so a quiet moment in a game is still pleasant to watch.
- **Readable first.** Ownership, fronts and what is built where must be clear at a glance, on a phone in daylight, with up to twenty players.
- **Pieces, not icons.** A city, a fort or a ship looks like an object placed on the map, with its own silhouette.
- **Original.** Shapes, palette and layout are our own. No asset, glyph or layout is taken from another game.

## Terrain

Light comes from the north-west. Land is lit from a height texture (one byte a tile, smoothed through a cubic B-spline), with ridged detail added in two octaves that fade out when a pixel becomes too big for them; the same height field drives shading and colour. The map is a table of stained glass: lit relief below, tinted glass above, a dark lead line between.

| Part         | Treatment                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plains       | The biome colour, varied in tone and brightness by two scales of noise, so a field is never flat                                                  |
| Forest       | Darker and greener, with a canopy grain that fades out zoomed out                                                                                 |
| Mountains    | Rock in the valleys and on the steep slopes, pale crests, a little snow on the highest; the ridges are decoration, not the altitude the game uses |
| Shading      | Slope facing the light, with a cavity term in the folds, 0.4 to 1.5 of the base colour                                                            |
| Sea          | Four tones of depth (shelf, middle, open, abyss), a slow swell, glints that twinkle, a surf line on the shore and two waves creeping in           |
| Coast        | A smooth curve (B-spline of the coast distance), never steps of tiles; a fine cold line on the owned side                                         |
| Edge of view | A vignette at world zoom only, as the map is an object on a dark table                                                                            |

Unclaimed land stays dark and quiet so that every territory colour stands out from it (at least 2.7:1, as in the brand guide). There are no rivers: the maps hold no hydrography.

## Territories

- The owner colour is a translucent tint over the lit land (58 % close up, 76 % at world zoom), a little uneven from patch to patch (±26 %), lighter and more saturated in the first 10 px along the border, with a faint bevel that catches the north-west light. Hills stay visible under a territory.
- The player's own territory gets no special colour; it is marked by the name label and a wider, whiter rim, as are allies (dashed) and the land under the pointer.
- Names and troop counts sit on the territory in a bold sans with a soft shadow, sized by territory area, and fade out when a territory is too small to hold them.

## Borders and fronts

Three kinds of edge, each drawn differently so they can be told apart without colour.

| Edge                       | Look                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Border with unclaimed land | A crisp dark lead line (1.3 px, 1.35 times wider for the player, allies and the hovered land) with a hair of light inside                                                                                   |
| Coast                      | A finer, colder line, left out on a speck of land so an islet keeps its colour, plus the surf on the water side                                                                                             |
| Contact (two players)      | The lead line 1.9 times wider                                                                                                                                                                               |
| Front (land just taken)    | One thin ember line (1.5 to 2 px) with a hot core and a soft glow, the strip behind it darkened by half over about 15 px, sparks that rise and smoke that drifts, only near the line; quieter along a coast |

Never a wide band and no candy stripes. With less motion, sparks, smoke, flicker, glints, waves and the swell hold still; the ember line stays. Every width is in screen pixels, so it reads the same on a phone at 390 px.

## Pictograms

Every building and unit has its own pictogram: city, fort, port, Micho Palace, missile silo, warship, trade ship, missile. The set is drawn in-house; the SVG sources are in [`assets/art-direction/icons/`](assets/art-direction/icons/).

![Icon sheet](assets/art-direction/icons-C.png)

Rules:

1. **One silhouette each.** The glyph alone, in a single colour, must tell the eight apart: a skyline for the city, a battlemented tower for the fort, an anchor for the port, a dome with a flag for the Palace, a hatch with a nose cone for the silo, a hull with a gun for the warship, a hull with stacked boxes for the trade ship, a finned body on a diagonal for the missile.
2. **Drawn on a 24-unit grid**, stroke-free where possible, with at least 1.2 units between details. Details are cut out of the shape, never added as hairlines.
3. **Readable at 16 px**, the smallest size on screen. Anything that disappears at 16 px is removed from the glyph, not from the plate.
4. **Token plate.** A rounded square (corner radius 6 of 24) with a top-to-bottom gradient of the owner colour (28 % lighter at the top, 38 % darker at the bottom), a soft highlight on the upper half and a short drop shadow. The glyph is white with details in a dark shade of the owner colour; accent parts (flag, flame) use one warm yellow.
5. **Owner colour on the plate** so ownership reads at a glance; colour-blind players rely on the glyph and the label.
6. **Sizes.** Ships and missiles: 13 to 18 px at World zoom, 32 to 40 px up close, 28 px in menus. Buildings are figurines, not plates (see Piece geometry), with their own sizes.
7. **No text on plates**, no numbers. Counts go in labels next to them.

## Ships

Ships are not plates: each is a hull seen from above, painted procedurally in one instanced draw call (`render/ship-layer.ts`, no image). Light comes from the upper left; a soft pillow shading is derived from the distance to the hull's edge, and a shadow falls on the water.

1. **The kind is read from the silhouette.** Warship: slim and very pointed, steel with the owner's colour on a stripe, the rim and the turret caps. Transport: a blunt barge, owner deck, crates aft, troops forward, a ramp at the bow. Trade ship: long and pointed, owner-painted hull, stacks of containers, a white aft bridge.
2. **Length on screen** is the hull's length in tiles (1.6, 2.5 and 3.5), never below 21, 27 and 34 CSS pixels (12 % more on a phone).
3. **One detail ramp.** Between 30 and 84 px of length the far silhouette (the owner's colour whole, a wider hull of at least 9.5 px of beam, a clear bow, a pale outline against the dark sea, one mark per kind) turns into the full painting. Everything is interpolated; nothing switches.
4. **Bow wave and wake** follow the speed of the ship: a V at the bow, two arms and a churned core behind it. The foam is fixed to the sea, so it stays where the ship passed, and it is cut where the water mask says land.
5. **Profiles.** Auto and Quality draw the shading, the shadow and the two-octave foam noise. Saver draws the same hulls and wake with one octave and no shading or shadow. Reduced motion freezes the drift of the foam.
6. Colour is still the only owner code; a second code is part of the accessibility work to come.

## Piece geometry

The eight buildings (city, Micho Palace, capital, fort, port, silo, air defence, landmark) share one drawing, `apps/client/src/render/pieces-geo.ts`: flat parts with a material role (stone, metal, wood, gold, owner colour) and a level of detail. Level 0 is the silhouette alone and is kept at every size; level 1 (windows, crenels, flags) appears from about 30 px; level 2 only close up. Nothing in level 0 is thinner than 2.5 units of the 100-unit piece, so it survives at 24 px.

The three that used to merge at 20 px are drawn apart on purpose: the city is the only lopsided piece, a skyline climbing to one slender spire; the fort is low and wide with no roof; the Palace is symmetric under a round dome with a gilded spire. A test rasterises the silhouettes at 16, 20 and 24 px and fails if any two pieces overlap too much.

### Painted miniatures

`pieces-paint.ts` paints the shared drawing as a figurine, once, when the game starts: a lit front, a shaded side and a lit top for each material, round parts shaded left to right, a thin dark outline (heavier at the coarse level, where a hairline would vanish), a pale rim on lit tops, and a soft shadow falling to the south-east. Each piece stands on a base in the owner's colour, dark at the rim and lighter on top with a pale lip. The atlas holds three levels of detail for the eight kinds (about 1.5 MB with its mipmaps, 128 px a cell). The owner's colour is not in the pixels: roofs, banners and bases are painted in grey and tinted by the shader, which also darkens a very light colour so a roof stands out from land of the same hue. Colour is always carried in three places (base, roof, banner) and the kind only by its silhouette, so a player who does not see the colour still tells the pieces apart.

On the world map a building is at least 26 px wide (the Palace 28, the capital 34, a landmark 32), still readable on a phone at the same CSS size. It changes level of detail at about 30 and 70 px, and only once clearly past the threshold (10 %), so a zoom that rests on one does not flicker. A piece still being built is drawn greyer and fainter.

**Groups.** At world zoom, the finished cities, forts and ports of one player that are closer than 1.35 times their size on screen are drawn as one piece with two satellites behind it and a dark coin with their number (2 to 99, then 99+, readable without colour). Capitals, Palaces, silos, air defences, landmarks and anything under construction are never grouped: they are tactical facts to see one by one. The groups are worked out again when the zoom changes by about 2 %, and a pair that was together stays together a little beyond the limit (12 %), so a group does not flicker either. The graphics profiles and reduced motion change nothing here: the figurines are still images and one instanced draw each.

## Interface

- **Table de campagne.** The interface is the table the map lies on: night leather panels with a brass rule, a second rule inside and a dotted seam (`--ff-lift`, `--ff-raised` in `styles.css`), brass for labels (`--ff-label`), cream for figures (`--ff-value`), blue-grey for secondary text. Panels sit above the map like raised pieces.
- **Keys.** Every button is a key that stands 3 px proud (a solid shadow, no blur) and sinks 2 px when pressed; the main action is ember. Tools are round with a brass ring. The chosen building is the key held down: pressed in, ringed in cream. Sliders have a grooved rail filled to the value and a brass knob. Motion is limited to 80 ms steps and is switched off with reduced motion.
- **Painted miniatures.** The eleven pieces of the build bar and the help (`ui/painted-icons.ts`) are small oblique views in three tones plus the owner's paint (`--own`, set on the game screen), so a piece on the bar wears the player's colour like the piece on the map. The tones are custom properties (`--t-l`, `--t-m`, `--t-d`) so a context can repaint them. The one-colour glyphs of `icons.ts` remain for tools, menus and achievement badges.
- Corner radius 14 px for panels, 12 px for keys, never mixed inside one panel.
- Numbers use tabular figures; labels are small uppercase with letter-spacing.
- Ember is reserved for the primary action, the timer bar and the Beta badge. Prices use the warning yellow.
- Laptop: stats top left, leaderboard top right, build list on the right edge, attack slider at the bottom centre, round buttons bottom right. Phone: stats across the top, build row under it as five icon buttons, leaderboard folded into a one-line chip, attack slider and buttons in a bottom bar.

![Close-up on a phone](assets/art-direction/near-phone-C.png)

Where each element of the game screen goes, on a laptop and on a phone, is in [`hud-layout.md`](hud-layout.md).

## Motion

Motion explains what is happening; it never decorates.

- Territory edges ease over about 150 ms when land is taken.
- A front under attack pulses its ridge at 1 Hz; a quiet front stays still.
- A missile in flight is drawn as an object, not a plate: a steel body seen from above with a band in its launcher's colour, an ember nose and a flame, lit from the north-west like the relief. It follows an arc that lifts it north of its straight route by a height that is nil at both ends, and grows by half at the top; its shadow stays on the ground and tightens as it comes down. A trail of smoke puffs hangs along the arc and fades after the missile has landed. On the target a dashed circle at the real blast radius, with four ticks, closes in and pulses faster as the missile arrives; it is never smaller than 14 px, and shape, dashes and rhythm carry it, not colour. With reduced motion the flame, the smoke and the pulse hold still (a dotted line along the arc, a fixed circle); the light picture (Saver) drops the shadow and the smoke's grain. A missile that is stopped in the air bursts where it was, apart from the blast of a strike on its target. Ships leave a wake of foam painted with their hull (see Ships): it stays fixed to the sea and fades over about two lengths.
- Land under fallout (R-UNIT-06), dearer to take while it lasts, is marked out by `render/fallout-layer.ts`: an olive wash with hatching at 45° (the next zone over hatches the other way, so an overlap reads as a grid), a dashed outline light inside dark, all cut to the land by the ground's coast, then a countdown arc that runs down clockwise from the top over a dotted rail, a mark every 10 s of the whole duration, and a danger triangle at the centre, 11 to 30 px. The time left is read from the angle, never the hue; the zone dissolves over its last 2.5 s and blinks over the last 4 s unless motion is held still. The arc is 4 px wide, 6 on a touch screen.
- Every ship carries a smoothed heading and a speed, and one that leaves the sea lingers a moment as docking, landing or sinking (`ShipMotion` in `ui/screen/ship-motion.ts`); the hulls turn and wake with the first two, and the three states are for the lives and deaths of a ship, still to be drawn.
- A missile that comes down makes a volumetric blast (`render/explosion-layer.ts`, `explosion-shader.ts`): a white-hot flash, a fireball of rolling spheres that cools to soot, smoke lit by the relief's north-west light and throwing its shadow on the ground, a shock wave with a dust band behind it, sparks, rising embers and clods of earth that stay. It is drawn from the time alone, without a texture. Its radius is the blast radius of the rules, never less than 26 CSS pixels (44 for the heavy missile) when zoomed far out. A cost cap holds it in check: at most four blasts play at once and a fifth falls back to the plain flash and ring; a blast wider than 120 device pixels of radius is drawn into a half-resolution target and laid over the map; the light graphics profile leaves out the sparks, embers, clods and smoke shadow and halves the target. With reduced motion, a strike is a single disc that only fades.
- New buildings drop onto their tile in 120 ms with a small bounce, and the plate shadow shortens as it lands.
- Everything honours the reduced-motion setting: pulses and bounces become static states, trails stay.

## Sound

Soft, tactile, never shrill. Wooden bars, a thumb piano and soft strings in a warm room (the `atlas` palette), all synthesised in the browser.

- Every effect has several variants, and the same one never plays twice in a row.
- A sound happens where its event is: panned to its side of the screen, quieter, duller and more echoing the further it lies beyond the edge, and softer when the whole map is in view. The player's own doing always stays clear.
- A light generative score runs under the game: a pad on a slow progression, a few melody notes and sparkles, drums that come in with the fighting and strings that come in with the empire. It stops when the game ends and while the tab is hidden.
- Effects and music have their own sliders, and one switch mutes both. Nothing plays until the page has been clicked once.
- Everything is made for the project, so nothing is listed in `CREDITS.md`. A recorded or third-party sound would need a licence that allows commercial use and an entry there.

## Quality criteria

Every visual change is judged against these, on a capture or a measurement, so that "looks good" is not an opinion. Each change ships with before and after captures on a laptop and on a phone.

**Map**

- No stair-steps on a coast at 3x zoom.
- No square or diamond halo around an island at any zoom.
- Relief stays visible under a coloured territory.
- No visible bands on a sea gradient.

**Legibility**

- A territory stands out from bare land by at least 2.7:1, pale colours included, and keeps a darker outline.
- A piece is recognised alone, in one tone, at 16 px, including on a white territory (the worst case).
- A front is told apart from a quiet border without colour.
- Checked with twenty players, on a phone, at half screen brightness.

**Interface**

- No panel covers more than a quarter of the map on a phone.
- Panel text keeps 4.5:1; there is one display face, used for big moments and territory names, and tabular figures everywhere.
- No system emoji in the interface.

**Motion**

- Every animation explains an event and has a still state when motion is reduced.
- Nothing drops below 60 frames per second on the reference laptop.

**Budgets and originality**

- The first-visit budget in [`performance.md`](performance.md) is never raised; anything added to the first screen is offset or loaded on demand.
- A flatter setting and a no-effects setting exist for weak devices.
- Shapes, palette and layout are our own, and the CI copy check passes.

## Accessibility

- Every colour in a territory is paired with a name label and a darker border; fronts are told apart by thickness and ridge, not hue.
- Pictograms are told apart by outline alone (rule 1 above).
- Text on panels keeps at least 4.5:1 contrast; map labels keep a shadow so they stay readable over any territory colour.
- A setting reduces shading and foam for players who want a flatter map, and one removes motion.

## Performance

The ground, its height and the coast distance are baked once per tile when the map loads and again only where the terrain changes; the rest is computed per pixel in the territory shader (`render/territory-layer.ts`, shipped minified, about 3 kB gzip, in the lazy chunk). It costs about 40 % more than the former look in software rendering, measured with `pnpm bench:render`; the cost on real GPUs is still to measure on the reference laptop and a mid-range phone. Octaves, grain and glints fade out as a pixel grows, so world zoom pays little. The Saver profile keeps the flat map. The look must keep to the budgets in [`performance.md`](performance.md) on the reference laptop and phone; a flatter setting exists for devices that cannot.

## Not covered here

Tutorial and onboarding screens, the title screen and the globe view get their own pass in later v0.7 and v0.9.x work, using the rules above.
