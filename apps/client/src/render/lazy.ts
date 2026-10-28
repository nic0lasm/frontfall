/**
 * What the first visit leaves out: the globe, the pieces of the flat map, the minimap, and
 * the territory layer that draws the ground and who owns it, with its shaders.
 * One chunk for both, so that the code they share with the page, Three.js, stays
 * inside the page's own chunk instead of being split off and counted in the first visit.
 */
export * from "./globe.ts";
export * from "./minimap.ts";
export * from "./pieces.ts";
export * from "./territory-layer.ts";
