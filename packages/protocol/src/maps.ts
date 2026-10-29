import { z } from "zod";

/** Bytes in front of the tiles of a terrain file (docs/map-format.md). */
const TERRAIN_HEADER_BYTES = 16;

const mapId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by hyphens");
const count = z.number().int().positive();
const fileName = z.string().regex(/^[a-z0-9-]+\.[a-z]+$/, "a file next to the manifest");

/** Display name in every language of the interface. */
export const MapName = z.object({ en: z.string().min(1), fr: z.string().min(1) });
export type MapName = z.infer<typeof MapName>;

/** Player counts the map is balanced for. */
export const MapPlayers = z
  .object({ min: count, recommended: count, max: count })
  .refine((p) => p.min <= p.recommended && p.recommended <= p.max, "min <= recommended <= max");

/** A computer-controlled nation and the land tile it starts from. */
export const MapNation = z.object({
  name: z.string().min(1),
  capital: z.string().min(1),
  tile: z.number().int().nonnegative(),
});
export type MapNation = z.infer<typeof MapNation>;

/** A place that gives its effect to whoever holds its tile (R-LAND-01). */
export const MapLandmark = z.object({
  id: mapId,
  name: MapName,
  effect: z.enum(["gold", "growth", "fortress", "trade", "shield", "assault"]),
  tile: z.number().int().nonnegative(),
});
export type MapLandmark = z.infer<typeof MapLandmark>;

/** Description of a map, published next to its terrain file as `<id>.json`. */
export const MapManifest = z
  .object({
    format: z.literal(1),
    id: mapId,
    name: MapName,
    /** Bumped whenever the terrain bytes or the nations change, so a published map never changes silently. */
    version: count,
    width: count,
    height: count,
    topology: z.enum(["flat", "cylinder"]),
    /** Longitude and latitude, in degrees, of the outer edges of the grid. */
    projection: z.object({
      type: z.literal("equirectangular"),
      west: z.number().min(-180).max(180),
      east: z.number().min(-180).max(180),
      south: z.number().min(-90).max(90),
      north: z.number().min(-90).max(90),
    }),
    terrain: z.object({
      file: fileName,
      bytes: count,
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    thumbnail: fileName,
    players: MapPlayers,
    nations: z.array(MapNation),
    /** Landmarks (R-LAND-01), on the city maps only; none when left out. */
    landmarks: z.array(MapLandmark).optional(),
    credits: z.array(z.object({ title: z.string(), url: z.url(), license: z.string() })).min(1),
  })
  .superRefine((map, context) => {
    const tiles = map.width * map.height;
    if (map.terrain.bytes !== TERRAIN_HEADER_BYTES + tiles) {
      context.addIssue({
        code: "custom",
        path: ["terrain", "bytes"],
        message: `a ${String(map.width)}x${String(map.height)} map has ${String(TERRAIN_HEADER_BYTES + tiles)} bytes`,
      });
    }
    if (
      map.topology === "cylinder" &&
      (map.projection.west !== -180 || map.projection.east !== 180)
    ) {
      context.addIssue({
        code: "custom",
        path: ["projection"],
        message: "a cylinder map spans every longitude",
      });
    }
    if (
      map.projection.west >= map.projection.east ||
      map.projection.south >= map.projection.north
    ) {
      context.addIssue({ code: "custom", path: ["projection"], message: "empty bounds" });
    }
    map.nations.forEach((nation, index) => {
      if (nation.tile >= tiles) {
        context.addIssue({
          code: "custom",
          path: ["nations", index, "tile"],
          message: "tile outside the map",
        });
      }
    });
    map.landmarks?.forEach((landmark, index) => {
      if (landmark.tile >= tiles) {
        context.addIssue({
          code: "custom",
          path: ["landmarks", index, "tile"],
          message: "tile outside the map",
        });
      }
    });
  });
export type MapManifest = z.infer<typeof MapManifest>;

/** Every published map, for the menu: `maps/index.json`. */
export const MapCatalog = z.object({
  format: z.literal(1),
  maps: z.array(
    z.object({
      id: mapId,
      name: MapName,
      width: count,
      height: count,
      topology: z.enum(["flat", "cylinder"]),
      players: MapPlayers,
      /** Menu section: maps of the Earth, or small drawn maps for quick games. */
      group: z.enum(["world", "quick"]).default("world"),
      manifest: fileName,
      thumbnail: fileName,
    }),
  ),
});
export type MapCatalog = z.infer<typeof MapCatalog>;
