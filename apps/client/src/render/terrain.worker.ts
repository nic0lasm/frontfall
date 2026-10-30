import type { MapManifest } from "@frontfall/protocol";
import { fetchMapData, type MapInfo } from "../game/maps.ts";
import type { GroundReply } from "./prebaked-ground.ts";
import { bakeTerrainColors } from "./terrain-colors.ts";

/** Bakes the ground of a published map off the page's thread (prebaked-ground.ts). */
self.onmessage = (event: MessageEvent<{ info: MapInfo; manifest: MapManifest }>) => {
  const { info, manifest } = event.data;
  void fetchMapData(info, manifest).then((map) => {
    const heights = new Uint8Array(map.width * map.height);
    const colors = bakeTerrainColors({
      width: map.width,
      height: map.height,
      kinds: map.kinds,
      relief: map.relief,
      wrapsX: map.wrapsX,
      latitudes: map.latitudes,
      heightOut: heights,
    });
    const reply: GroundReply = { id: map.id, sha256: manifest.terrain.sha256, colors, heights };
    self.postMessage(reply, { transfer: [colors.buffer, heights.buffer] });
  });
};
