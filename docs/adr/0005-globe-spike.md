# 0005 · Globe rendering: what the spike found

Status: Proposed · Date: 2026-10-24

## Context

Phase 2 puts the game on a globe (v0.6), and v1.0 ships it. Before more of the flat view is built on the `Renderer` and `Camera` contracts of [ADR 0003](0003-renderer-split.md), a spike of three days at most tested them against a second implementation: the World map on a sphere, with picking ([#53](https://github.com/nic0lasm/frontfall/issues/53), [#56](https://github.com/nic0lasm/frontfall/issues/56)). The engine and the protocol were out of bounds; the flat view had to stay as it is.

The prototype is in the client behind `?view=globe`, for maps that span the whole planet (World, Ring). G switches between the globe and the flat map in a running game.

## What was built

- **Ray-traced sphere, not a sphere mesh.** The territory layer draws a quad over the whole screen. Each pixel casts a ray from the camera, meets the unit sphere, and turns the point into latitude, longitude, then tile coordinates. From there the fragment shader is the flat one: same owner, ground, palette and fade textures, same border and coast logic, one draw call. A first version on a `SphereGeometry` was dropped before it was finished: interpolated texture coordinates are wrong on the faces that touch the poles, and the mesh would need more faces as the zoom closes in.
- **One projection module for drawing and picking.** `render/globe-projection.ts` is plain arithmetic, without three.js: the camera pose for a view, the ray for a screen point, the screen point of a latitude and longitude. The renderer and the globe camera both use it, so a click lands where the tile is drawn. A test checks it against three.js's own `PerspectiveCamera` and `Raycaster` on 1,000 random screen points at zooms 1, 4 and 24, and checks that clicks in space select nothing.
- **The `CameraView` contract did not change.** The globe reads the same four numbers as the flat map: the tile under the middle of the screen, and a half-height in tiles. The camera distance follows from the half-height, so a tile at the middle of the screen has the same size in pixels on both views, and a zoom keeps its meaning across a switch. `GlobeCamera` implements `Camera`; the input, the labels and the click marks did not change, apart from hiding a mark whose tile is behind the planet.
- **Ships and structures** lie flat on the planet, one instanced draw call per kind, with markers behind the horizon culled in the vertex shader rather than by a depth buffer.
- **The `Renderer` contract held.** `GlobeView` implements it without new methods. `createRenderer` and a new `createCamera` choose the implementation; the game screen asks for a kind and never imports either class. The globe's code is a separate chunk of about 9 kB, fetched only with `?view=globe`.
- **What changed for the flat map.** Its shader is the same program with the globe's lines left out by a `#define`; borders and coasts measure east and west edges with a column width that is 1 there. The game screen holds any `ViewCamera` rather than a `FlatCamera`. `MapView.dispose` now calls `forceContextLoss()`, so leaving a game frees its WebGL context at once instead of at garbage collection; switching views relies on it. Click marks whose tile is far off screen are hidden rather than moved there.

## Pitfalls, and where they stand

| Topic        | Finding                                                                                                                                                                                                   | In the prototype                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Poles        | A sphere mesh pinches the texture at the poles; ray tracing does not. Columns narrow as cos(latitude), so the 2,048 columns of the World end up much finer than a pixel near the poles.                   | Clean caps. The camera keeps the middle of the screen within 85° of latitude. East and west edges are measured in the width of a column, so borders keep their width toward the poles. Drags near a pole still turn fast. |
| Antimeridian | The longitude jumps from 180 to -180 between neighbouring pixels, which breaks screen-space derivatives on columns.                                                                                       | No seam: the line width comes from the derivative of the row only, and owner and border lookups wrap like on the flat map.                                                                                                |
| Picking      | A click must hit the tile drawn under it, and a click in space must select nothing.                                                                                                                       | Exact, through the shared projection module; checked against three.js.                                                                                                                                                    |
| Text         | Labels are HTML placed by `tileToScreen`; their size follows the scale at the middle of the screen.                                                                                                       | Labels on the far side are hidden. Near the rim, labels come out too large and are not foreshortened. Needs M6-06: a size from the local scale, and a fade toward the rim.                                                |
| Sampling     | Owners are read by `texelFetch`, one texel per pixel. Zoomed out, a pixel covers several tiles, and the globe shimmers while it turns. The flat map has the same issue, but it rarely moves at that zoom. | Accepted for the spike. Needs a reduced owner texture or a supersampled fill when zoomed out, as part of M7-05.                                                                                                           |
| Units        | Unit positions come in tiles from the north.                                                                                                                                                              | Ships and structures are placed on the sphere and keep a readable size. Trajectories (missiles, v0.4) need great circles, not straight lines in tile space.                                                               |
| Switching    | Each switch makes a new WebGL context and bakes the ground colours again.                                                                                                                                 | About 0.7 s in SwiftShader on the World map, over the 0.5 s goal of v0.7. Keep one `WebGLRenderer` and one baked ground texture across views for M7-07.                                                                   |

## Measurements

The cloud machines have no GPU: these are from Chromium headless with SwiftShader, the CPU rasteriser, on 4 cores. They compare the two views; they say nothing about frame rates on a real GPU, which have to be measured on a laptop and a phone (`pnpm bench:render -- --gpu --globe`).

`pnpm bench:render -- --globe`, World size (2,048 × 1,024), 32 players, territory only:

| View                            | Viewport   | Static frame p50 / p95 | Frame with updates p50 |
| ------------------------------- | ---------- | ---------------------: | ---------------------: |
| Globe, whole planet (zoom 1.5)  | 1280 × 720 |         58.8 / 71.6 ms |                60.3 ms |
| Globe, close (zoom 8)           | 1280 × 720 |         51.1 / 65.2 ms |                57.3 ms |
| Globe, close (zoom 8)           | 780 × 1688 |         70.3 / 82.5 ms |                74.7 ms |
| Flat, 2,000 units, same session | 1280 × 720 |        80.2 / 102.0 ms |                78.9 ms |

In the game, paused, turning the World with the arrow keys for five seconds: 21 to 26 frames per second on the globe, 28 to 29 on the flat map. Per pixel, the ray, `asin` and `atan` cost about as much as the flat map's work, and the GPU memory is the same, since the textures are shared.

## Decision (proposed)

For v0.6, build the globe on this prototype rather than starting over:

1. Keep the ray-traced sphere and the shared projection module. They remove the seam, the poles and the picking mismatch as classes of bugs.
2. Keep `Renderer`, `Camera` and `CameraView` as they are. The spike needed one addition only: a `ViewCamera` that also gives its view, zoom and scale, which both cameras implement.
3. Keep the equirectangular map format. A cube-sphere grid is not needed for drawing. It would only be needed if play near the poles turns out unfair, and the World map has ice caps there.
4. Plan for what the spike left out: labels over the globe (M6-06), sampling when zoomed out (M7-05), a single WebGL context across switches (M7-07), great-circle trajectories with missiles, and a frame-rate measurement on the reference laptop before v0.6 starts.
5. Regional maps (Europe, Africa…) stay flat: they cover part of the planet, and a globe would show them as a patch of land in an empty world.

## Consequences

- v0.6 issues M6-01 to M6-04 are mostly done in prototype form. The estimate for v0.6 can come down by about a week, if the frame rate on a real GPU confirms the SwiftShader comparison.
- The prototype stays behind `?view=globe` until v0.6. It is not in the interface, so players do not find it by chance.
- Any change to the territory shader now has to keep both paths working. The e2e test `globe.spec.ts` checks the globe starts, picks and switches.
