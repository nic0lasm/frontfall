import * as THREE from "three";
import { MAP_COLORS, STRUCTURE_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import type { EffectsLayer } from "./effects-layer.ts";
import type { FalloutLayer } from "./fallout-layer.ts";
import { applyView } from "./orthographic.ts";
import type * as Pieces from "./pieces.ts";
import type * as Hulls from "./ship-layer.ts";
import { groupPieces, keyOf } from "./pieces-group.ts";
import type {
  FalloutZone,
  MissileEnd,
  Renderer,
  RendererOptions,
  StructureMark,
  UnitMark,
} from "./renderer.ts";
import type * as Territories from "./territory-layer.ts";
import type { TerritoryLayer } from "./territory-layer.ts";
import { UnitLayer } from "./unit-layer.ts";

/** Ships at sea at once: B-BOAT-MAX for each of up to 26 players, with room to spare. */
const SHIP_CAPACITY = 128;

/** Trade ships at sea at once: B-TRADE-MAX for each port of a crowded map. */
const TRADE_CAPACITY = 512;
/** Warships at once: B-WARSHIP-MAX for each of up to 64 players. */
const WARSHIP_CAPACITY = 256;

/**
 * Size of each kind of ship in tiles, and its smallest size on screen in CSS
 * pixels: zoomed out, a trade ship stays a readable dot rather than vanishing.
 */
export const SHIP_SIZES = {
  transport: { tiles: 2.5, minPixels: 6 },
  trade: { tiles: 1.6, minPixels: 6 },
  warship: { tiles: 3.5, minPixels: 10 },
  missile: { tiles: 2.5, minPixels: 9 },
  heavyMissile: { tiles: 4, minPixels: 13 },
} as const;

/** Scale of a ship of `size` for its smallest size on screen at `tilesPerPixel`. */
export function shipScale(
  size: { tiles: number; minPixels: number },
  tilesPerPixel: number,
): number {
  return Math.max(1, (size.minPixels * tilesPerPixel) / size.tiles);
}

/** Missiles in flight at once: one per silo, with room to spare. */
const MISSILE_CAPACITY = 256;

/**
 * Smallest size of a piece on screen, in CSS pixels, however far the view is
 * zoomed out. A painted building needs 24 to 26 px at world zoom to be told
 * from the others (the Palace and the Mosque 28, the capital and landmarks larger); ships and
 * missiles are token plates and stay small.
 */
const PIECE_MIN_PIXELS = {
  transport: 13,
  trade: 12,
  warship: 16,
  missile: 14,
  heavyMissile: 18,
  structure: 26,
  palace: 28,
  mosque: 28,
  capital: 34,
  landmark: 32,
} as const;

/** The structures that crowd into a carpet at world zoom and are drawn as a group instead. */
const GROUPED = ["city", "fort", "port"] as const;
type Grouped = (typeof GROUPED)[number];

const isGrouped = (type: string): type is Grouped => (GROUPED as readonly string[]).includes(type);

/** Two pieces closer than this many of their own sizes on screen are drawn as one group. */
const GROUP_REACH = 1.35;
/** Where a group's satellites stand and its count, as fractions of the piece's size, y up. */
const SATELLITES = [
  [-0.42, 0.22],
  [0.4, 0.26],
] as const;
const COUNT_SHIFT = [0.4, -0.12] as const;
/** Side of the count's coin, in CSS pixels. */
const COIN_PIXELS = 20;
/** Zoom must change by this much (a ratio's logarithm) before the groups are worked out again. */
const REGROUP_STEP = 0.02;

/** Structures drawn at once; each player's land rarely holds more than a few. */
const STRUCTURE_CAPACITY = 1024;

/** What the map draws pieces with: plain shapes (UnitLayer) or token plates (PieceLayer). */
interface Marker {
  readonly mesh: THREE.Object3D;
  count: number;
  set(
    index: number,
    x: number,
    y: number,
    color: THREE.ColorRepresentation,
    built?: boolean,
    shiftX?: number,
    shiftY?: number,
  ): void;
  setScale(scale: number): void;
  /** Size on screen in CSS pixels, for the level of detail of a painted building. */
  setPixels?(pixels: number): void;
  update(cameraX: number): unknown;
  dispose(): void;
}

/** One kind of structure: a token plate, or without the pieces a dark shape with a lighter one on top. */
interface StructureLayers {
  readonly outline?: Marker;
  readonly fill: Marker;
  /** Footprint of the fill in tiles. */
  readonly size: number;
  /** Smallest size on screen, in CSS pixels. */
  readonly minPixels: number;
}

/** Darkness of the corners of the view, on a laptop and on a narrow phone screen. */
const STRENGTH = { wide: 0.38, narrow: 0.6 };

interface Vignette {
  setNarrow(narrow: boolean): void;
  dispose(): void;
}

/**
 * A screen-wide quad that darkens the edges of the view, drawn after
 * everything else so the interface stays readable over a bright map.
 */
function addVignette(scene: THREE.Scene): Vignette {
  const strength = { value: STRENGTH.wide };
  const material = new THREE.ShaderMaterial({
    uniforms: { strength },
    vertexShader: "varying vec2 p;void main(){p=position.xy;gl_Position=vec4(p,0.,1.);}",
    fragmentShader:
      "varying vec2 p;uniform float strength;void main(){gl_FragColor=vec4(.02,.05,.08,strength*smoothstep(.6,1.5,length(p)));}",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100;
  scene.add(mesh);
  return {
    setNarrow: (narrow) => {
      strength.value = narrow ? STRENGTH.narrow : STRENGTH.wide;
    },
    dispose: () => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * The flat map: one WebGL canvas, the territory layer, and an orthographic
 * camera placed from the view of the interface's camera.
 */
export class MapView implements Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly territory: TerritoryLayer;
  private readonly bufferSize = new THREE.Vector2();
  /** Ships as painted hulls, once their code is there; plates (below) stand in without it. */
  private readonly hulls: Hulls.ShipLayer | undefined;
  private readonly ships: Marker | undefined;
  private readonly tradeShips: Marker | undefined;
  private readonly warships: Marker | undefined;
  private readonly missiles: Marker;
  private readonly heavyMissiles: Marker;
  private readonly structures: Record<StructureMark["type"], StructureLayers>;
  /** The coins that carry the count of each kind of group, once the pieces are there. */
  private readonly counts: Partial<Record<Grouped, Pieces.CountLayer>> = {};
  private marks: readonly StructureMark[] = [];
  /** Whether the marks changed since they were last laid out. */
  private marksChanged = false;
  /** Tiles per pixel the pieces were last laid out at. */
  private laidOutAt = 0;
  /** For each grouped kind, the group number of each piece last time, to keep a group together at a threshold. */
  private readonly grouped: Record<Grouped, Map<number, number>> = {
    city: new Map(),
    fort: new Map(),
    port: new Map(),
  };
  private readonly vignette: Vignette;
  private readonly startedAt = performance.now();
  /** Combat effects, once their code has arrived; they are not in the first bundle. */
  private effects: EffectsLayer | undefined;
  /** Zones of fallout, once their code has arrived, and the ones to show when it does. */
  private fallout: FalloutLayer | undefined;
  private falloutZones: readonly FalloutZone[] = [];
  private moving = true;
  private disposed = false;
  /** Width of the canvas in CSS pixels, to keep structures readable when zoomed out. */
  private cssWidth = 1;

  /**
   * `territories` is the territory layer's code, and `pieces` the code
   * loadPieces fetched: without it, pieces are plain shapes. Both come in
   * the chunk the first visit leaves out (lazy.ts).
   */
  constructor(
    readonly options: RendererOptions,
    territories: typeof Territories,
    pieces?: typeof Pieces,
    hulls?: typeof Hulls,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(MAP_COLORS.oceanDeep);
    this.canvas = this.renderer.domElement;
    this.territory = new territories.TerritoryLayer({
      width: options.width,
      height: options.height,
      owners: options.owners,
      terrain: options.kinds,
      wrapsX: options.wrapsX,
      relief: options.relief,
      groundSource: options.groundSource,
      latitudes: options.latitudes,
      flat: options.flat,
      maxOwner: options.maxOwner,
    });
    // The layer spans x in [-width, 2 * width) and y in [0, height) from the
    // south edge; applyView puts the origin at the centre of the middle copy.
    this.territory.mesh.position.set(-options.width / 2, -options.height / 2, 0);
    this.scene.add(this.territory.mesh);
    const world = {
      worldWidth: options.width,
      worldHeight: options.height,
      wrapsX: options.wrapsX,
    };
    // A token plate with its glyph when the pieces are there, else a plain shape.
    const unit = (
      kind: Pieces.PieceKind,
      capacity: number,
      size: number,
      sides: number,
      depth: number,
      order: number,
    ): Marker => {
      const layer: Marker = pieces
        ? new pieces.PieceLayer({ ...world, capacity, size, kind, order })
        : new UnitLayer({ ...world, capacity, size, sides, depth });
      layer.mesh.position.copy(this.territory.mesh.position);
      this.scene.add(layer.mesh);
      return layer;
    };
    if (hulls) {
      this.hulls = new hulls.ShipLayer({
        ...world,
        capacity: SHIP_CAPACITY + TRADE_CAPACITY + WARSHIP_CAPACITY,
        kinds: options.kinds,
        flat: options.flat === true,
        phone: options.phone === true,
      });
      this.hulls.mesh.position.copy(this.territory.mesh.position);
      this.scene.add(this.hulls.mesh);
    } else {
      this.ships = unit("transport", SHIP_CAPACITY, SHIP_SIZES.transport.tiles, 8, 0.1, 1);
      this.tradeShips = unit("trade", TRADE_CAPACITY, SHIP_SIZES.trade.tiles, 8, 0.1, 1);
      this.warships = unit("warship", WARSHIP_CAPACITY, SHIP_SIZES.warship.tiles, 3, 0.15, 2);
    }
    // Missiles are above everything else.
    this.missiles = unit("missile", MISSILE_CAPACITY, SHIP_SIZES.missile.tiles, 4, 0.4, 5);
    this.heavyMissiles = unit(
      "heavyMissile",
      MISSILE_CAPACITY,
      SHIP_SIZES.heavyMissile.tiles,
      4,
      0.4,
      5,
    );
    // Without the pieces, cities are diamonds, forts triangles, ports hexagons,
    // silos pentagons and air defenses discs, all larger than a ship.
    const layers = (
      kind: Exclude<
        Pieces.PieceKind,
        "transport" | "trade" | "warship" | "missile" | "heavyMissile"
      >,
      sides: number,
      size: number,
      /** Drawn over the other structures, as a capital over the city by it. */
      above = 0,
    ): StructureLayers => {
      const layer = (extra: number, depth: number, order: number): Marker => {
        const marker: Marker = pieces
          ? new pieces.PieceLayer({ ...world, capacity: STRUCTURE_CAPACITY, size, kind, order })
          : new UnitLayer({
              ...world,
              capacity: STRUCTURE_CAPACITY,
              size: size + extra,
              sides,
              depth,
            });
        marker.mesh.position.copy(this.territory.mesh.position);
        this.scene.add(marker.mesh);
        return marker;
      };
      const minPixels =
        kind === "palace" || kind === "mosque" || kind === "capital" || kind === "landmark"
          ? PIECE_MIN_PIXELS[kind]
          : PIECE_MIN_PIXELS.structure;
      return pieces
        ? { fill: layer(0, 0.3 + above, 3 + above * 10), size, minPixels }
        : {
            outline: layer(1.5, 0.2 + above, 0),
            fill: layer(0, 0.3 + above, 0),
            size,
            minPixels,
          };
    };
    this.structures = {
      city: layers("city", 4, 4),
      palace: layers("palace", 8, 5.5),
      mosque: layers("mosque", 10, 5.5),
      fort: layers("fort", 3, 4.5),
      port: layers("port", 6, 4),
      silo: layers("silo", 5, 4.5),
      airDefense: layers("airDefense", 12, 4),
      // Without the pieces, a star of a shape; drawn after the buildings, so on top.
      capital: layers("capital", 5, 6.5, 0.1),
      landmark: layers("landmark", 4, 6, 0.05),
    };
    if (pieces) {
      for (const type of GROUPED) {
        const layer = new pieces.CountLayer({
          ...world,
          capacity: STRUCTURE_CAPACITY / 2,
          size: this.structures[type].size,
          order: 4,
        });
        layer.mesh.position.copy(this.territory.mesh.position);
        this.scene.add(layer.mesh);
        this.counts[type] = layer;
      }
    }
    this.vignette = addVignette(this.scene);
    this.camera.position.z = 10;
    this.loadEffects();
    this.loadFallout();
  }

  private loadEffects(): void {
    void import("./effects-layer.ts").then(
      ({ EffectsLayer }) => {
        if (this.disposed) return;
        this.effects = new EffectsLayer({
          three: [
            THREE.Mesh,
            THREE.ShaderMaterial,
            THREE.InstancedBufferGeometry,
            THREE.InstancedBufferAttribute,
            THREE.BufferAttribute,
          ],
          map: this.options,
          scene: this.scene,
          anchor: this.territory.mesh.position,
          moving: this.moving,
          explosions: [
            THREE.Mesh,
            THREE.ShaderMaterial,
            THREE.BufferGeometry,
            THREE.BufferAttribute,
            THREE.Scene,
            THREE.OrthographicCamera,
            THREE.WebGLRenderTarget,
            THREE.Color,
          ],
          renderer: this.renderer,
          saver: this.options.flat ?? false,
        });
      },
      // The map is as playable without them.
      () => undefined,
    );
  }

  private loadFallout(): void {
    void import("./fallout-layer.ts").then(
      ({ FalloutLayer }) => {
        if (this.disposed) return;
        this.fallout = new FalloutLayer({
          three: [
            THREE.Mesh,
            THREE.ShaderMaterial,
            THREE.InstancedBufferGeometry,
            THREE.InstancedBufferAttribute,
            THREE.BufferAttribute,
          ],
          map: this.options,
          ground: this.territory.groundTexture,
          scene: this.scene,
          anchor: this.territory.mesh.position,
          moving: this.moving,
          coarse: matchMedia("(pointer: coarse)").matches,
        });
        this.fallout.set(this.falloutZones, this.clock());
      },
      // The map is as playable without them, with the land under fallout left plain.
      () => undefined,
    );
  }

  setPlayerColor(id: number, color: string): void {
    this.territory.setOwnerColor(id, color);
  }

  /** The player whose land gets the wide rim. */
  setAllies(ids: readonly number[]): void {
    this.territory.setAllies(ids);
  }

  setHighlight(id: number): void {
    this.territory.setHighlight(id);
  }

  setHovered(id: number): void {
    this.territory.setHovered(id);
  }

  setMotion(moving: boolean): void {
    this.moving = moving;
    this.effects?.setMotion(moving);
    this.hulls?.setMotion(moving);
    this.fallout?.setMotion(moving);
    this.territory.setMotion(moving);
  }

  /** Tiles whose owner changed in the shared array since the last frame; they fade in. */
  markChanged(tiles: ArrayLike<number>): void {
    this.territory.markChanged(tiles, this.clock());
    this.effects?.changed(tiles, this.clock());
  }

  markAllChanged(): void {
    this.territory.markAllChanged();
  }

  /** Ships at sea, replacing the previous ones. */
  setShips(ships: readonly UnitMark[]): void {
    let transports = 0;
    let trade = 0;
    let warships = 0;
    let missiles = 0;
    let heavy = 0;
    const hulls: Record<Hulls.ShipKind, Hulls.Hull[]> = { trade: [], transport: [], warship: [] };
    for (const ship of ships) {
      // A ship leaving the sea is not drawn as a plate: it is for the layer that draws hulls.
      if (ship.state) continue;
      if (ship.kind === "missile" || ship.kind === "heavyMissile") {
        // The effects draw the missile itself, once their code is here.
        if (this.effects?.drawsMissiles) continue;
      }
      if (ship.kind === "missile") {
        if (missiles < MISSILE_CAPACITY) this.missiles.set(missiles++, ship.x, ship.y, ship.color);
      } else if (ship.kind === "heavyMissile") {
        if (heavy < MISSILE_CAPACITY) this.heavyMissiles.set(heavy++, ship.x, ship.y, ship.color);
      } else if (this.hulls) {
        const kind = ship.kind ?? "transport";
        hulls[kind].push({
          kind,
          x: ship.x,
          y: ship.y,
          heading: ship.heading ?? 0,
          speed: ship.speed ?? 0,
          color: ship.color,
          seed: (ship.id ?? 0) % 10,
        });
      } else if (ship.kind === "trade") {
        if (trade < TRADE_CAPACITY) this.tradeShips?.set(trade++, ship.x, ship.y, ship.color);
      } else if (ship.kind === "warship") {
        if (warships < WARSHIP_CAPACITY) this.warships?.set(warships++, ship.x, ship.y, ship.color);
      } else if (transports < SHIP_CAPACITY) {
        this.ships?.set(transports++, ship.x, ship.y, ship.color);
      }
    }
    // The warships over the transports, and those over the trade ships.
    this.hulls?.setHulls([...hulls.trade, ...hulls.transport, ...hulls.warship]);
    if (this.ships) this.ships.count = transports;
    if (this.tradeShips) this.tradeShips.count = trade;
    if (this.warships) this.warships.count = warships;
    this.missiles.count = missiles;
    this.heavyMissiles.count = heavy;
    this.effects?.ships(ships, this.clock());
  }

  /** A front gave way around `tile` (R-ATTACK-10). */
  collapsed(tile: number): void {
    this.effects?.collapsed(tile, this.clock());
  }

  /** A capital fell or was razed on `tile` (R-CAP-03, R-CAP-04). */
  capitalFell(tile: number): void {
    this.effects?.capitalFell(tile, this.clock());
  }

  /** The capital of the player at this screen is under threat (R-CAP-05), or `undefined` once safe. */
  capitalThreat(tile: number | undefined): void {
    this.effects?.capitalThreat(tile);
  }

  animating(): boolean {
    const now = this.clock();
    return (this.effects?.alive(now) ?? false) || (this.fallout?.alive(now) ?? false);
  }

  setFallout(zones: readonly FalloutZone[]): boolean {
    this.falloutZones = zones;
    return this.fallout?.set(zones, this.clock()) ?? false;
  }

  missileStruck(end: MissileEnd): void {
    this.effects?.missileStruck(end.x, end.y, end.heavy, this.clock());
  }

  missileIntercepted(end: MissileEnd): void {
    this.effects?.missileIntercepted(end.x, end.y, end.heavy, end.site, this.clock());
  }

  setStructures(structures: readonly StructureMark[]): void {
    // Laid out by the next render, which knows how far the view is zoomed.
    this.marks = structures;
    this.marksChanged = true;
  }

  /** Puts every structure in its layer; at world zoom the crowded cities, forts and ports of one player into groups. */
  private layOut(tilesPerPixel: number): void {
    this.marksChanged = false;
    this.laidOutAt = tilesPerPixel;
    for (const type of [
      "city",
      "palace",
      "mosque",
      "fort",
      "port",
      "silo",
      "airDefense",
      "capital",
      "landmark",
    ] as const) {
      const { outline, fill, size, minPixels } = this.structures[type];
      const kept = isGrouped(type) ? this.grouped[type] : undefined;
      const coins = isGrouped(type) ? this.counts[type] : undefined;
      let count = 0;
      const placed = (structure: StructureMark, shiftX = 0, shiftY = 0): void => {
        if (count >= STRUCTURE_CAPACITY) return;
        if (outline) {
          outline.set(count, structure.x, structure.y, STRUCTURE_COLORS.outline);
          fill.set(
            count,
            structure.x,
            structure.y,
            structure.ready ? STRUCTURE_COLORS.fill : STRUCTURE_COLORS.building,
          );
        } else {
          fill.set(
            count,
            structure.x,
            structure.y,
            structure.color ?? "#ffffff",
            structure.ready,
            shiftX,
            shiftY,
          );
        }
        count++;
      };
      const own = this.marks.filter((structure) => structure.type === type);
      if (isGrouped(type) && coins && kept) {
        // Finished pieces of a known owner group; pieces still being built stay one by one.
        const single = own.filter((structure) => !structure.ready || !structure.color);
        const ready = own.filter((structure) => structure.ready && structure.color);
        const reach = GROUP_REACH * Math.max(size, minPixels * tilesPerPixel);
        const groups = groupPieces(
          ready.map((structure) => ({
            x: structure.x,
            y: structure.y,
            owner: structure.color ?? "",
          })),
          reach,
          kept,
        );
        const before = new Map<number, number>();
        let coin = 0;
        groups.forEach((group, number) => {
          const [first, ...rest] = group.members;
          const main = ready[first ?? 0];
          if (!main) return;
          if (rest.length === 0) {
            placed(main);
            return;
          }
          for (const member of group.members) {
            const at = ready[member];
            if (at) before.set(keyOf(at.x, at.y), number);
          }
          // The satellites stand behind the main piece, to the north, so they are drawn first.
          rest.slice(0, SATELLITES.length).forEach((_, i) => {
            const [dx, dy] = SATELLITES[i] ?? [0, 0];
            placed(main, dx, dy);
          });
          placed(main);
          coins.set(coin++, main.x, main.y, group.members.length, COUNT_SHIFT[0], COUNT_SHIFT[1]);
        });
        coins.count = coin;
        this.grouped[type] = before;
        for (const structure of single) placed(structure);
      } else {
        for (const structure of own) placed(structure);
      }
      if (outline) outline.count = count;
      fill.count = count;
    }
  }

  ground(): Uint8Array {
    return this.territory.groundTexture.image.data as Uint8Array;
  }

  setPixelRatio(ratio: number): void {
    // Three.js sizes the drawing buffer again for the same CSS size.
    this.renderer.setPixelRatio(ratio);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.cssWidth = Math.max(1, width);
    this.vignette.setNarrow(width < 700);
  }

  render(view: CameraView): void {
    applyView(this.camera, view, this.options.width, this.options.height);
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.territory.setViewport(this.bufferSize.x, this.bufferSize.y);
    this.territory.setTime(this.clock());
    this.territory.flush(this.renderer);
    const tilesPerPixel = (2 * view.halfWidth) / this.cssWidth;
    if (
      this.marksChanged ||
      Math.abs(Math.log(tilesPerPixel / (this.laidOutAt || tilesPerPixel))) > REGROUP_STEP
    ) {
      this.layOut(tilesPerPixel);
    }
    const sized = (kind: keyof typeof SHIP_SIZES): number =>
      shipScale(
        { tiles: SHIP_SIZES[kind].tiles, minPixels: PIECE_MIN_PIXELS[kind] },
        tilesPerPixel,
      );
    this.ships?.setScale(sized("transport"));
    this.tradeShips?.setScale(sized("trade"));
    this.warships?.setScale(sized("warship"));
    this.missiles.setScale(sized("missile"));
    this.heavyMissiles.setScale(sized("heavyMissile"));
    this.missiles.update(this.camera.position.x);
    this.heavyMissiles.update(this.camera.position.x);
    this.ships?.update(this.camera.position.x);
    this.tradeShips?.update(this.camera.position.x);
    this.warships?.update(this.camera.position.x);
    this.hulls?.update(this.clock(), this.camera.position.x, tilesPerPixel);
    for (const { outline, fill, size, minPixels } of Object.values(this.structures)) {
      const scale = Math.max(1, (minPixels * tilesPerPixel) / size);
      outline?.setScale(scale);
      fill.setScale(scale);
      fill.setPixels?.(Math.max(size / tilesPerPixel, minPixels));
      outline?.update(this.camera.position.x);
      fill.update(this.camera.position.x);
    }
    for (const type of GROUPED) {
      const { size, minPixels } = this.structures[type];
      const scale = Math.max(1, (minPixels * tilesPerPixel) / size);
      this.counts[type]?.setScale(COIN_PIXELS * tilesPerPixel, scale);
      this.counts[type]?.update(this.camera.position.x);
    }
    this.effects?.update(this.clock(), this.camera.position.x, view, tilesPerPixel);
    this.fallout?.update(this.clock(), this.camera.position.x, tilesPerPixel);
    this.renderer.render(this.scene, this.camera);
  }

  /** Seconds since the view was made: small enough for exact 32-bit floats in the shader. */
  private clock(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  dispose(): void {
    this.vignette.dispose();
    this.disposed = true;
    this.effects?.dispose();
    this.fallout?.dispose();
    this.territory.dispose();
    for (const type of GROUPED) this.counts[type]?.dispose();
    this.hulls?.dispose();
    this.ships?.dispose();
    this.tradeShips?.dispose();
    this.warships?.dispose();
    this.missiles.dispose();
    this.heavyMissiles.dispose();
    for (const { outline, fill } of Object.values(this.structures)) {
      outline?.dispose();
      fill.dispose();
    }
    this.renderer.dispose();
    // Switching views creates another context; browsers cap how many stay alive.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
