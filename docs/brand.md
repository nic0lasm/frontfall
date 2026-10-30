# Frontfall brand guide

A short reference for anyone making something with the Frontfall name: the game client, the README, a stream overlay, a fan map. Source files live in [`assets/brand/`](../assets/brand/); the colour values are in [`tokens.json`](../assets/brand/tokens.json).

## The mark

![Frontfall logo](../assets/brand/logo-horizontal-on-dark.svg)

A round world split between two territories. The border between them steps down like a front line giving way, and one tile has broken off and is falling. The circle is the world without edges, the stairs are the tile grid the game is played on, the falling tile is the name.

| File                                                              | Use                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `logo-mark.svg`                                                   | Default mark, any background                                            |
| `logo-horizontal-on-dark.svg`, `logo-horizontal-on-light.svg`     | Mark and wordmark side by side                                          |
| `logo-mark-mono-dark.svg`, `logo-mark-mono-light.svg`             | One colour: print, embossing, watermarks                                |
| `logo-horizontal-mono-dark.svg`, `logo-horizontal-mono-light.svg` | One-colour lockup                                                       |
| `wordmark-on-dark.svg`, `wordmark-on-light.svg`                   | Name alone, when the mark is already shown                              |
| `app-icon.svg`, `app-icon-maskable.svg`                           | Square icons; the maskable one keeps the mark inside the 80 % safe zone |

"mono-dark" means dark ink, for light backgrounds; "mono-light" is white, for dark backgrounds.

Rules:

- Keep clear space around the mark equal to a quarter of its diameter.
- Smallest size: 16 px for the mark, 96 px wide for the horizontal logo.
- The two territories are always ember on top, front blue below. Do not swap, recolour, rotate, outline or add effects.
- The gaps in the mark are cut out, not painted: the background shows through. Put the mark on flat or quiet backgrounds.
- The wordmark is uppercase Inter Display ExtraBold, outlined, with FRONT in the text colour and FALL in ember. Do not retype it in another font.

## Colour

### Brand

| Token          | Hex       | Use                                                         |
| -------------- | --------- | ----------------------------------------------------------- |
| `ember`        | `#F25C2A` | Brand colour, primary buttons, focus, highlights on dark    |
| `ember-bright` | `#FF7A47` | Hover and pressed states on dark                            |
| `ember-deep`   | `#D9481A` | Ember on light backgrounds (3.8:1 on paper, 4.3:1 on white) |
| `front`        | `#2F80ED` | Second territory of the mark, links, information            |

Text on an ember button is `ink` (`#0A131C`), 5.6:1. White on ember is too weak for body text.

### Interface (dark first)

| Token       | Hex       | Use                          | Contrast on `night-800` |
| ----------- | --------- | ---------------------------- | ----------------------- |
| `night-900` | `#060C12` | Behind modals                |                         |
| `night-800` | `#0A131C` | Page background              |                         |
| `night-700` | `#111D29` | Panels                       |                         |
| `night-600` | `#182838` | Raised panels, inputs        |                         |
| `night-500` | `#23384C` | Borders, dividers            |                         |
| `slate-400` | `#5C7389` | Disabled, decorative         | 3.8:1                   |
| `slate-300` | `#8DA2B6` | Secondary text               | 7.1:1                   |
| `text`      | `#E7EEF5` | Primary text                 | 16.0:1                  |
| `paper`     | `#F5F2EC` | Light surfaces (docs, print) |                         |
| `ink`       | `#0A131C` | Text on light surfaces       |                         |

State colours: success `#3CCB7F`, warning `#F5B83D`, danger `#F04C5E`, info `#4C9AFF`, all above 5:1 on `night-800`.

### Map

| Token         | Hex       |
| ------------- | --------- |
| `ocean`       | `#0E2233` |
| `ocean-deep`  | `#0A1A28` |
| `land`        | `#3D4A3B` |
| `land-high`   | `#4C5A47` |
| `land-light`  | `#8A8E68` |
| `sea-shallow` | `#1F5878` |
| `foam`        | `#BFE0F0` |

Unclaimed land is a dark, low-saturation green so that every territory colour stands out from it.

### Territories

Twenty player colours, handed out in this order:

| #   | Name      | Hex       | #   | Name    | Hex       |
| --- | --------- | --------- | --- | ------- | --------- |
| 1   | Sky       | `#56B4E9` | 11  | Lime    | `#A4E33B` |
| 2   | Amber     | `#E69F00` | 12  | Aqua    | `#3FD3D3` |
| 3   | Jade      | `#1FB58F` | 13  | Sand    | `#D9B98C` |
| 4   | Lemon     | `#F0E442` | 14  | Magenta | `#DA5CE2` |
| 5   | Azure     | `#4F8CFF` | 15  | Blush   | `#FFB3C1` |
| 6   | Vermilion | `#F2683A` | 16  | Copper  | `#C58456` |
| 7   | Orchid    | `#E58FC4` | 17  | Mint    | `#9EF0C0` |
| 8   | Snow      | `#E6EBF0` | 18  | Lilac   | `#C3B5FF` |
| 9   | Crimson   | `#F05468` | 19  | Lagoon  | `#4FA3A0` |
| 10  | Violet    | `#A57CFF` | 20  | Coral   | `#FF8A75` |

How they were checked (CIEDE2000 colour difference, colour-blindness simulated with the Machado 2009 model):

- The first eight build on the Okabe and Ito set, lightened for a dark map. They stay at least 14.7 apart for normal vision and 7.8 apart with deuteranopia, so games of up to eight players need nothing more.
- All twenty stay at least 10.7 apart for normal vision. Past eight players some pairs get close for colour-blind players, so territories always carry the owner's name on the map and a darker border (the fill colour at 62 % brightness).
- Every colour has at least 2.7:1 contrast against unclaimed land and 4.7:1 against ocean.

The client reads these values from `apps/client/src/palette.ts`; a test fails if it drifts from `tokens.json`.

## Type

| Role               | Typeface                                           | License |
| ------------------ | -------------------------------------------------- | ------- |
| Interface and text | Inter (variable)                                   | OFL-1.1 |
| Wordmark           | Inter Display ExtraBold, outlined in the SVG files | OFL-1.1 |
| Code and logs      | JetBrains Mono, optional                           | OFL-1.1 |

The client bundles Inter through `@fontsource-variable/inter`, so no request goes to a font CDN. Numbers in the interface use tabular figures (`font-feature-settings: "tnum"`) so counters do not jitter.

Both typefaces are under the SIL Open Font License 1.1: free to use, embed and ship, including in commercial work; the fonts themselves cannot be sold on their own.

## Ready-made images

| File                                                                 | Size       | Where it goes                           |
| -------------------------------------------------------------------- | ---------- | --------------------------------------- |
| `docs/assets/banner-dark.svg`                                        | 1280 × 320 | README header, dark theme               |
| `docs/assets/banner-light.svg`                                       | 1280 × 320 | README header, light theme              |
| `docs/assets/social-preview.png`                                     | 1280 × 640 | GitHub repository social preview        |
| `docs/assets/logo.svg`                                               | 512 × 512  | Avatars (Discord, itch.io)              |
| `apps/client/public/og-image.jpg`                                    | 1200 × 630 | Link previews of the game page          |
| `apps/client/public/favicon.*`, `icon-*.png`, `apple-touch-icon.png` |            | Browser tab, home screen, installed app |

The map in the banners is a generated tile map in the territory colours, not a real game.

## Name and logo use

The code and these files are under the [MIT license](../LICENSE). The Frontfall name and logo identify the official project: forks and self-hosted servers are welcome, but please give them their own name and logo so players can tell them apart. Fan art, videos and articles about Frontfall can use the logo as is.
