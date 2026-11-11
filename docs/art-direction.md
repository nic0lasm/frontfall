# Art direction

How Frontfall should look and feel from v0.7 on. The identity (logo, ember and front blue, Inter, the twenty player colours) is unchanged and lives in [`brand.md`](brand.md) and `assets/brand/tokens.json`. This page covers what happens inside the game: terrain, territories, pictograms, interface, motion and sound.

The direction is called **Relief**: a lit table-top map, with hill-shaded land, depth-shaded sea and crisp tactical markers on top of it.

![World view on a laptop](assets/art-direction/world-laptop-C.png)

The mock-ups are drawn for this page with generated terrain. They fix the look, not the exact pixels.

## Intentions

- **A map you want to look at.** Land and sea have volume and light, so a quiet moment in a game is still pleasant to watch.
- **Readable first.** Ownership, fronts and what is built where must be clear at a glance, on a phone in daylight, with up to twenty players.
- **Markers you read at a glance.** A building is a tactical marker with its own pictogram, ringed in its owner's colour; a ship is a hull with its own silhouette.
- **Original.** Shapes, palette and layout are our own. No asset, glyph or layout is taken from another game.

## Terrain

Light comes from the north-west. Land is lit from a height texture (one byte a tile, smoothed through a cubic B-spline), with ridged detail added in two octaves that fade out when a pixel becomes too big for them; the same height field drives shading and colour. The map is a table of stained glass: lit relief below, tinted glass above, a dark lead line between.

| Part         | Treatment                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plains       | The biome colour, varied in tone and brightness by two scales of noise, so a field is never flat, and close up plots of fields of uneven sizes, bent and cut once, with hedges on some sides and faint furrows                                                                                                                                                                  |
| Forest       | Darker and greener, with a canopy grain that fades out zoomed out, and close up tree crowns of uneven size lit from the north-west, with clearings                                                                                                                                                                                                                              |
| Hills        | Kept in their grass and lit gently; where the upland colour starts is moved by noise, so a region of hills fades in raggedly, never as an oval                                                                                                                                                                                                                                  |
| Mountains    | Warm earthy rock on the crests and steep slopes, meadow left on the gentle ones, snow only on the highest crests; ground baked white (ice caps, polar land) keeps its ice and only a quarter of the relief light; ridges branch into a network (isotropic ridged noise on bent coordinates), never parallel stripes; they are decoration, not the altitude the game uses        |
| Shading      | Slope facing the light, folds darkened from the smooth heights, 0.5 to 1.32 of the base colour; warm light on the lit side, cool shade on the other, strongest on the mountains                                                                                                                                                                                                 |
| Outline      | The baked relief is read through a few tiles of noise, so the rough outline of a relief region turns ragged; the rules keep their tiles                                                                                                                                                                                                                                         |
| Sea          | The map's own bathymetry, blurred into slopes: a lighter shelf, darker slopes and the darkest abyss; clear turquoise shallows along the shore, large slow patches of tone offshore, a slow swell and a surf line close up, and one wave creeping in only up close (farther out it read as a contour line). Maps without bathymetry shade their sea by the distance to the coast |
| Coast        | A smooth curve (B-spline of the coast distance), never steps of tiles; a fine cold line on the owned side                                                                                                                                                                                                                                                                       |
| Edge of view | A vignette at world zoom only, as the map is an object on a dark table                                                                                                                                                                                                                                                                                                          |

Unclaimed land stays dark and quiet so that every territory colour stands out from it (at least 2.7:1, as in the brand guide). There are no rivers: the maps hold no hydrography.

Close up, fields come in broad patches of the green plains, with open meadow between them; ground whose baked colour is sand or dry steppe gets dunes instead (long ripples bent by noise), never fields. Hills hand over to the mountain ridges gradually, never at a line.

## Territories

- The owner colour is a light translucent tint over the lit land (32 % close up, 50 % at world zoom, a quarter less for pale colours, which are also darkened), a little uneven from patch to patch (±26 %), so the relief and the ground stay visible under every country. The colour gathers in the first 14 px along the border, lighter and more saturated, so a country reads by its edge, with a faint bevel that catches the north-west light (choice of 2026-11-03).
- The player's own territory gets no special colour; it is marked by the name label and a wider, whiter rim, as are allies (dashed) and the land under the pointer.
- Names and troop counts sit on the territory in a bold sans with a soft shadow, sized by territory area, and fade out when a territory is too small to hold them.

## Borders and fronts

Three kinds of edge, each drawn differently so they can be told apart without colour.

| Edge                       | Look                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Border with unclaimed land | A crisp dark lead line (1.3 px, 1.35 times wider for the player, allies and the hovered land) with a hair of light inside                                                                                                                                                                                                                                     |
| Coast                      | A finer, colder line, left out on a speck of land so an islet keeps its colour, plus the surf on the water side                                                                                                                                                                                                                                               |
| Contact (two players)      | The lead line 1.9 times wider                                                                                                                                                                                                                                                                                                                                 |
| Front (land just taken)    | A bright cream core (1 px) in dashes that march forward, an ember edge (2 px) and a short glow, the strip behind it darkened by half over about 15 px, embers rising from the land just taken (particles of the effects layer, never a grid of tile centres); the glow is blended between tiles at every zoom, so it never shows steps; quieter along a coast |

Never a wide band and no candy stripes. With less motion, the dashes, embers, glints, waves and the swell hold still; the line stays. Every width is in screen pixels, so it reads the same on a phone at 390 px.

## Pictograms

Every building and unit has its own pictogram: city, fort, port, Micho Palace, missile silo, warship, trade ship, missile. The set is drawn in-house; the SVG sources are in [`assets/art-direction/icons/`](assets/art-direction/icons/).

![Icon sheet](assets/art-direction/icons-C.png)

Rules:

1. **One silhouette each.** The glyph alone, in a single colour, must tell the eight apart: a skyline for the city, a battlemented tower for the fort, an anchor for the port, a dome with a flag for the Palace, a hatch with a nose cone for the silo, a hull with a gun for the warship, a hull with stacked boxes for the trade ship, a finned body on a diagonal for the missile.
2. **Drawn on a 24-unit grid**, stroke-free where possible, with at least 1.2 units between details. Details are cut out of the shape, never added as hairlines.
3. **Readable at 16 px**, the smallest size on screen. Anything that disappears at 16 px is removed from the glyph, not from the plate.
4. **Token plate** (ships and missiles on the map; the build bar and the help use the round markers described under Interface). A rounded square (corner radius 6 of 24) with a top-to-bottom gradient of the owner colour (28 % lighter at the top, 38 % darker at the bottom), a soft highlight on the upper half and a short drop shadow. The glyph is white with details in a dark shade of the owner colour; accent parts (flag, flame) use one warm yellow.
5. **Owner colour on the plate** so ownership reads at a glance; colour-blind players rely on the glyph and the label.
6. **Sizes.** Ships and missiles: 13 to 18 px at World zoom, 32 to 40 px up close, 28 px in menus. Buildings are round map markers (see Piece geometry), with their own sizes.
7. **No text on plates**, no numbers. Counts go in labels next to them.

## Ships

Ships are modern vessels seen from above, drawn procedurally in one instanced draw call (`render/ship-layer.ts`, no image): a hull lit from the north-west like the relief, a deck and a faceted superstructure that throws its shadow on the deck and on the water, a bow wave and a wake.

1. **Three contemporary types, told apart by their silhouette.** Warship: a slim destroyer with a fine bow and a square transom, a gun turret and a grid of launch cells forward, a faceted bridge with its mast, a funnel, a hangar and a helicopter deck aft. Transport: an amphibious assault ship, a flat flight deck from end to end with a dashed centre line, landing spots and two helicopters, an island to starboard and a well-deck gate at the stern. Trade ship: a stout container ship with a blunt bow, seven bays of containers, a white bridge with its wings over the sides and a funnel in the owner's livery, aft.
2. **Owner colour first.** It is on the gunwale band of every hull, on the destroyer's deck (toned towards naval grey), on the assault ship's flight deck (mixed with dark deck paint), and on the container ship's hull, forecastle, funnel and about four containers in ten. The superstructure stays light grey or white, so the type reads on every colour.
3. **Length on screen** is the hull's length in tiles (1.6, 2.5 and 3.5), never below 28, 33 and 46 CSS pixels (12 % more on a phone). Small on screen, the whole ship is drawn broader, deck and superstructure included, to a beam of 8 to 10 px, so that its colour and its blocks read; it takes its true slender lines as it grows.
4. **Two detail ramps.** Deck, superstructure and shadows come in between 10 and 27 px of length; the small things (launch cells, deck markings, helicopter rotors, container ribs, winches) between 48 and 110 px. Everything is interpolated; nothing switches.
5. **Wake.** A moving ship leaves the two arms of a Kelvin wake and a churned core of propeller wash, turquoise just behind the stern, then white, fading over about one and a half lengths, fainter while the ship is small on screen. The foam is fixed to the sea and cut where the water mask says land; a ship at rest has no wake and its quad stops at the stern.
6. **A warship that fires** flashes at the muzzle and a ring of warm light runs round the hull, fading with the shot.
7. **Profiles.** Saver draws the same ships without the relief, the shadows and the second octave of foam noise. Reduced motion holds the foam still and leaves out the flash, keeping only a softer ring.
8. Colour is still the only owner code; a second code is part of the accessibility work to come.

## Piece geometry

The nine buildings (city, Micho Palace, Mosque of Cyrus, capital, fort, port, silo, air defence, landmark) are drawn as map markers from one set of pictograms, `apps/client/src/render/pieces-geo.ts`: flat filled shapes on a 32-unit grid, with cut-outs, each at a level of detail. Level 0 is the silhouette with only the cut-outs that survive at 16 px (the gates, the anchor's ring); level 1 adds windows, jewels and seams from about 30 px. Nothing in level 0 is thinner than 1.4 units of the grid.

Each kind has a pictogram of its own, not a view of a building: a lopsided skyline climbing to one spire for the city, a dome with a spire between two low pavilions for the Palace, a dome between two tall pointed minarets for the Mosque, a five-pointed crown for the capital, a low crenellated wall with a gate for the fort, an anchor for the port, an upright finned rocket on its pad for the silo, two launch tubes on a diagonal over a turret for the air defence, a pediment on four columns for a landmark. A test rasterises them at the size they have on a marker of 16, 20 and 24 px and fails if any two overlap too much, or if the city, the fort and the Palace come close.

### Map markers

`pieces-paint.ts` paints each pictogram once, when the game starts, on a marker: a dark, slightly see-through disc (42 % of the piece's width in radius) with the pictogram in white, a ring in the owner's colour on its edge, a thin dark line outside the ring, then a short halo of the owner's colour fading out. The ring is thicker at level 0 (7 % of the width) than at level 1 (5 %), so it stays a clear line of colour at 26 px. The atlas holds two levels for the nine kinds, 128 px a cell, in one RGBA texture of shares (white, owner's colour, coverage): about 1.6 MB with its mipmaps. The owner's colour is added by the shader at full strength, never darkened, so amber, lemon or snow stay bright; the dark disc and the dark line keep the marker apart from land of the same hue. Colour is only on the ring and the halo, and the kind only in the pictogram, so a player who does not see the colour still tells the pieces apart.

The marker is centred on its tile, so what is clicked or hovered is what is under it. On the world map it is at least 26 px wide (the Palace and the Mosque 28, the capital 34, a landmark 32), the same CSS size on a phone. It changes level of detail at about 30 px, and only once clearly past the threshold (10 %), so a zoom that rests on it does not flicker. A piece still being built keeps its pictogram, paler, with a dashed ring and no halo.

**Groups.** At world zoom, the finished cities, forts and ports of one player that are closer than 2.2 times their size on screen are drawn as one marker with two satellites peeking out behind it and a dark coin of 18 px with their number (2 to 99, then 99+, readable without colour). Capitals, Palaces, silos, air defences, landmarks and anything under construction are never grouped: they are tactical facts to see one by one. The groups are worked out again when the zoom changes by about 2 %, and a pair that was together stays together a little beyond the limit (12 %), so a group does not flicker either. The graphics profiles and reduced motion change nothing here: the markers are still images and one instanced draw each.

## Interface

- **Table de campagne.** The interface is the table the map lies on: night leather panels with a brass rule, a second rule inside and a dotted seam (`--ff-lift`, `--ff-raised` in `styles.css`), brass for labels (`--ff-label`), cream for figures (`--ff-value`), blue-grey for secondary text. Panels sit above the map like raised pieces.
- **Keys.** Every button is a key that stands 3 px proud (a solid shadow, no blur) and sinks 2 px when pressed; the main action is ember. Tools are round with a brass ring. The chosen building is the key held down: pressed in, ringed in cream. Sliders have a grooved rail filled to the value and a brass knob. Motion is limited to 80 ms steps and is switched off with reduced motion.
- **Tactical markers.** The twelve pieces of the build bar and the help (`ui/painted-icons.ts`) are markers on a tactical map: a white silhouette, solid and without outlines, on a dark translucent disc (82 % opaque), ringed in the owner's colour (`--own`, set on the game screen) with a soft halo of the same colour, so a piece on the bar wears the player's colour like the piece on the map and light colours such as amber stay at full strength. The glyph fills 94 % of a 32-unit disc; details are shaded cut-outs (75 % dark) and the missile flame is the one warm accent. Each silhouette must read at 24 px, the bar's size: the missile silo is a tall nose cone on a bunker, the air defence a low dome with two splayed tubes, the missile a slim body with one pair of fins and the heavy missile a body twice as wide with two bands and two pairs of fins, and demolish a hammer. The chosen piece takes a thicker ring and a fuller halo; one out of reach turns grey, ring included. The one-colour glyphs of `icons.ts` remain for tools, menus and achievement badges.
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
- A missile in flight is drawn as an object, not a plate: a steel body seen from above with a band in its launcher's colour, an ember nose and a flame, lit from the north-west like the relief. It follows an arc that lifts it north of its straight route by a height that is nil at both ends, and grows by half at the top; its shadow stays on the ground and tightens as it comes down. A trail of smoke puffs hangs along the arc and fades after the missile has landed. On the target a dashed circle at the real blast radius, with four ticks, closes in and pulses faster as the missile arrives; it is never smaller than 14 px, and shape, dashes and rhythm carry it, not colour. With reduced motion the flame, the smoke and the pulse hold still (a dotted line along the arc, a fixed circle); the light picture (Saver) drops the shadow and the smoke's grain. A missile that is stopped in the air bursts where it was, apart from the blast of a strike on its target. Ships leave a wake of foam painted with their hull (see Ships): it stays fixed to the sea and fades over about one and a half lengths.
- Land under fallout (R-UNIT-06), dearer to take while it lasts, is marked out by `render/fallout-layer.ts`: an olive wash with hatching at 45° (the next zone over hatches the other way, so an overlap reads as a grid), a dashed outline light inside dark, all cut to the land by the ground's coast, then a countdown arc that runs down clockwise from the top over a dotted rail, a mark every 10 s of the whole duration, and a danger triangle at the centre, 11 to 30 px. The time left is read from the angle, never the hue; the zone dissolves over its last 2.5 s and blinks over the last 4 s unless motion is held still. The arc is 4 px wide, 6 on a touch screen.
- Every ship carries a smoothed heading and a speed, and one that leaves the sea lingers a moment as docking, landing or sinking (`ShipMotion` in `ui/screen/ship-motion.ts`); the hulls turn and wake with the first two. A transport that lands splashes, a trade ship that docks rings its port with a coin, and a ship that is sunk leaves churned water, a ring of foam, wreckage that drifts apart and a puff of smoke, sized against the hull on screen (a warship also flares once).
- A missile that comes down makes a volumetric blast (`render/explosion-layer.ts`, `explosion-shader.ts`): a white-hot flash, a fireball of rolling spheres that cools to soot, smoke lit by the relief's north-west light and throwing its shadow on the ground, a shock wave with a dust band behind it, sparks, rising embers and clods of earth that stay. It is drawn from the time alone, without a texture. Its radius is the blast radius of the rules, never less than 26 CSS pixels (44 for the heavy missile) when zoomed far out. A cost cap holds it in check: at most four blasts play at once and a fifth falls back to the plain flash and ring; a blast wider than 120 device pixels of radius is drawn into a half-resolution target and laid over the map; the light graphics profile leaves out the sparks, embers, clods and smoke shadow and halves the target. With reduced motion, a strike is a single disc that only fades.
- A player who is out of the game leaves two rings in their colour, wider and slower than a fallen capital, where they lost their last tile, and their colour drifts out as embers; with reduced motion it is one fading disc of that colour.
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

Tutorial and onboarding screens and the title screen get their own pass in later work, using the rules above.

## Globe

The planet floats in a blue-black sky with sparse stars fixed to its frame. A sun stands over the viewer's left shoulder, wherever the globe is turned: the face toward the camera is lit, the far limb falls into a soft shade (never below 42 % of the light), the atmosphere glows brighter on the sunny side, and the open sea shows a small glint seen from afar only. Buildings are tokens like the flat map's markers: a dark disc with a short shadow, ringed in the owner's colour, with a white glyph whose number of sides tells the kind, from 14 to 30 CSS pixels whatever the zoom; a building under way has a dimmed glyph.
