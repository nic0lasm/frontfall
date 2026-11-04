# Premium graphics

A richer look of the map for the builds that need not fit in the web download budget: the phone apps and the desktop release. It lives on the `feat/premium-graphics` branch and stays an option of the same renderer, so the code is shared with the web game.

## What changes

The web game lights the land in its shader from one byte of relief a tile, drawn from Natural Earth's regions. The premium look reads a ground baked ahead from real elevation instead, at four texels a tile:

- **Land**: the game's climates for the lowland colour (`bakeTerrainColors`, without its relief), then real uplands, rock on the high and steep ground, snow above a snow line that falls with the latitude, the ice of the map's impassable tiles. It is lit from the north-west with two softer fill lights, warmer on the lit side, with sky light darkening the valleys. Slopes are raised 3.4 times so that they read from above.
- **Sea**: real depth, from the shelf to the abyss, with the floor faintly lit.

Territories, borders, fronts, pieces, the sea's swell and surf are drawn as before over that ground. Everything is decoration: the rules keep the map's tiles, and a mountain drawn where the map holds plains costs nothing to cross.

In the territory layer (`apps/client/src/render/territory-layer.ts`) the option is `premium`: two images, land with its light in alpha and sea, compiled in as `#define PREMIUM`. The shader then leaves out the relief it would work out, which makes a frame cheaper to draw.

## Baking

```sh
pnpm premium -- --maps europe,world,americas,africa,asia --texels 4
```

The tool (`tools/src/premium/`) downloads the elevation tiles that cover each map, at the zoom whose pixels are at least as fine as the texels, keeps them in `node_modules/.cache/mapgen/terrarium/`, and writes `apps/client/public/maps/premium/<map>-land.webp`, `<map>-sea.webp` (half the texels: the sea is smooth) and `index.json`. These files are left out of git: the premium builds bake them. A bake takes a few minutes a map.

| Map      | Land texture | Elevation zoom | Land + sea (WebP) |
| -------- | ------------ | -------------- | ----------------- |
| World    | 8192 × 4096  | 5              | 5.8 MB            |
| Europe   | 5120 × 4320  | 8              | 6.0 MB            |
| Americas | 3840 × 4096  | 7              | 2.5 MB            |
| Africa   | 4096 × 4096  | 7              | 4.1 MB            |
| Asia     | 5120 × 4352  | 7              | 8.1 MB            |

Rivers are drawn from the elevation alone: every texel of land drains to the sea along a priority flood, and a river shows where more than 6,000 km² of wet land drains through it (a desert counts for little), widest past 400,000 km².

Up close, the shader sharpens the ground against its own blur and adds crags where the light changes fast; at middle zooms the shadows of high clouds drift over the map (still with less motion), and a light grading leans the shadows blue and the highlights warm.

## Cost

Measured on the fixed scene (`bench/showcase`, Europe) in the software renderer, median of 12 frames: 12 to 22 % less time a frame than 0.9.9 at every zoom, on a laptop and a phone, as the relief is no longer worked out a pixel at a time. On a GPU, texture reads weigh more than in software: the cost is to be measured again on an iPhone with `?perf` on a premium build, against the 0.9.9 measure in [performance.md](performance.md). The textures take about 120 MB of graphics memory on Europe with their mipmaps, which is why the light picture leaves them out.

The light the land got is kept in the alpha channel, so the images must be decoded without premultiplying it (`createImageBitmap` with `premultiplyAlpha: "none"`).

## Checking the look

`bench/showcase` draws a fixed scene (owners, a front, buildings, ships) on a published map with the game's renderer, at three zooms on a laptop and a phone:

```sh
pnpm --filter @frontfall/bench showcase -- --out shots --label premium --query "premium=1&time=10"
```

`time=n` adds the median time of n frames, in the software renderer unless `--gpu` is given.

## Sources and licences

The elevation comes from the [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on the AWS Open Data registry, in their Terrarium encoding. They merge public datasets; the ones that cover the Earth maps, and the credit each asks for:

| Dataset                             | Where                        | Licence                          |
| ----------------------------------- | ---------------------------- | -------------------------------- |
| SRTM (NASA)                         | Land between 60° N and 56° S | Public domain                    |
| GMTED2010 (USGS)                    | Land, coarser                | Public domain                    |
| ETOPO1 (NOAA)                       | Sea floor                    | Public domain                    |
| 3DEP (USGS)                         | United States                | Public domain                    |
| EU-DEM (Copernicus)                 | Europe                       | Copernicus data policy, credit   |
| ArcticDEM (Polar Geospatial Center) | North of 60° N               | Credit                           |
| CDEM (Natural Resources Canada)     | Canada                       | Open Government Licence – Canada |
| Kartverket                          | Norway                       | CC BY 4.0                        |
| data.gov.uk (Environment Agency)    | Great Britain                | Open Government Licence          |
| INEGI                               | Mexico                       | Free use, credit                 |
| Geoscience Australia                | Australia                    | CC BY 4.0                        |
| LINZ                                | New Zealand                  | CC BY 4.0                        |

All of them allow the derived images to ship with the game, under their credits; the credits go in the about page of a premium build. The upstream list of credits (Tilezen's `joerd` attribution document) is checked again before a release.

The bake tool uses [sharp](https://sharp.pixelplumbing.com/) (Apache-2.0, with libvips under LGPL-3.0) to read and write images. It is a development tool only: nothing of it ships.
