# Map format, version 1

A map is three files that sit side by side in `maps/`:

| File        | Content                                               |
| ----------- | ----------------------------------------------------- |
| `<id>.bin`  | Terrain: a 16-byte header, then one byte per tile     |
| `<id>.json` | Manifest: name, size, topology, nations, credits, sum |
| `<id>.png`  | Thumbnail for the menu, at most 256 pixels wide       |

`maps/index.json` lists every published map for the menu, each with its
name, size, topology, player counts, file names and a `group`: `world` for
the maps of the Earth, `quick` for the small drawn maps. A catalogue without
groups reads as `world`. How the files are produced is described in
[`maps.md`](maps.md).

Files stay uncompressed so they can be read in place; the web server
compresses them on the way (gzip or Brotli). The format is read by
`decodeMapFile` and `loadMap` in `@frontfall/engine`, and the manifest is
checked by `MapManifest` in `@frontfall/protocol`.

## Terrain file

All numbers are little-endian.

| Offset | Size | Field   | Value                                                  |
| ------ | ---- | ------- | ------------------------------------------------------ |
| 0      | 4    | magic   | `46 46 4D 50`, the ASCII text `FFMP`                   |
| 4      | 2    | version | `1`                                                    |
| 6      | 2    | flags   | bit 0: the map wraps east to west (cylinder)           |
| 8      | 4    | width   | columns, at least 1                                    |
| 12     | 4    | height  | rows, at least 1                                       |
| 16     | w×h  | tiles   | row 0 is the northern edge; each row runs west to east |

Every other flag bit must be zero. A reader refuses a file whose magic,
version, flags or length it does not recognise: the length is always exactly
`16 + width × height`, and `width × height` is at most 2²⁶.

### Tile byte

| Bits | Name      | Meaning                                                   |
| ---- | --------- | --------------------------------------------------------- |
| 7    | land      | 1 for land, 0 for water                                   |
| 6    | shore     | land with at least one water neighbour; always 0 on water |
| 5    | reserved  | 0                                                         |
| 0–4  | magnitude | elevation band on land, depth band on water (0 to 31)     |

On land, magnitude 31 means impassable (R-MAP-02): ice caps and glaciers.
The engine turns the other bands into the relief levels of the rules
(R-MAP-01):

| Land magnitude | Tile kind  | Typical relief                  |
| -------------- | ---------- | ------------------------------- |
| 0 to 9         | Plains     | Lowlands, below about 500 m     |
| 10 to 19       | Hills      | Plateaus, foothills, low ranges |
| 20 to 30       | Mountains  | High ranges such as the Alps    |
| 31             | Impassable | Ice caps and glaciers           |

On water, the magnitude counts depth steps: 0 for the continental shelf
(less than 200 m), then higher values for deeper water. The generator's
thresholds are listed in [`maps.md`](maps.md#relief-and-depth). Ships do not
use depth yet; it is stored now so that maps need not change when they do.

Neighbours are the four orthogonal tiles. On a cylinder, the west neighbour
of column 0 is the last column of the same row (R-MAP-03).

### Worked example

A 4 × 2 cylinder:

```text
row 0:  deep water · plains on the shore · hills on the shore · ice
row 1:  shelf water · plains on the shore · mountains on the shore · ice on the shore
```

```text
46 46 4D 50   magic "FFMP"
01 00         version 1
01 00         flags: wraps east to west
04 00 00 00   width 4
02 00 00 00   height 2
03 C0 CC 9F   row 0: water depth 3 · land+shore 0 · land+shore 12 · land 31
00 C5 D6 DF   row 1: water depth 0 · land+shore 5 · land+shore 22 · land+shore 31
```

`C0` is `1100 0000`: land, shore, magnitude 0. `D6` is `1101 0110`: land,
shore, magnitude 22, so mountains. `9F` is `1001 1111`: land, not on the
shore, magnitude 31, so impassable. A test in
`packages/engine/test/map-file.test.ts` encodes this example and compares it
with these bytes.

## Manifest

```json
{
  "format": 1,
  "id": "world",
  "name": { "en": "World", "fr": "Monde" },
  "version": 1,
  "width": 2048,
  "height": 1024,
  "topology": "cylinder",
  "projection": { "type": "equirectangular", "west": -180, "east": 180, "south": -90, "north": 90 },
  "terrain": { "file": "world.bin", "bytes": 2097168, "sha256": "…" },
  "thumbnail": "world.png",
  "players": { "min": 2, "recommended": 16, "max": 64 },
  "nations": [{ "name": "France", "capital": "Paris", "tile": 286933 }],
  "credits": [
    {
      "title": "Natural Earth 5.1.2",
      "url": "https://www.naturalearthdata.com/",
      "license": "Public domain"
    }
  ]
}
```

- `landmarks`, on the city maps only, lists their landmarks (R-LAND-01):
  each has an `id`, a `name` in every language of the interface, an
  `effect` (`gold`, `growth`, `fortress`, `trade`, `shield` or `assault`)
  and the `tile` it stands on, land a player can own. A reader that does not
  know the field ignores it.
- `version` is the version of this map, not of the format. Any change to the
  terrain bytes needs a new version; CI enforces it (see [`maps.md`](maps.md)).
  A change to the nations alone needs one too: a replay only plays on the
  version of the map it was recorded on.
- `projection` gives the outer edges of the grid in degrees. Columns are
  evenly spaced in longitude and rows in latitude (an equirectangular grid);
  the degrees per column and per row may differ, which keeps regional maps
  from looking stretched. A cylinder always spans −180 to 180.
- `terrain.bytes` must equal `16 + width × height` and `terrain.sha256` is
  the SHA-256 of the whole terrain file. The loader checks both.
- `nations` are the computer-controlled nations, each with a land tile to
  start from (`y × width + x`), in order of priority: a game with n nations
  takes the first n, which the generator spreads over the whole map.
- `credits` names every dataset the map was built from.
