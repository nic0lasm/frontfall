import * as THREE from "three";
import { surfacePoint, tileToLatLon } from "./globe-projection.ts";

export interface GlobeMarkersOptions {
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Most markers drawn at once. */
  readonly capacity: number;
  /** Footprint of a marker in rows of tiles. */
  readonly size: number;
  /** Sides of the shape: 8 draws a disc, 4 a diamond, 3 a triangle. */
  readonly sides?: number;
  /** Drawn after layers with a lower order, over them. */
  readonly order: number;
  /**
   * A map token instead of a flat shape, as on the flat map: a dark disc with
   * a soft shadow, ringed in the marker's colour, with a white glyph of
   * `sides` sides in the middle.
   */
  readonly token?: boolean;
}

const vertexShader = /* glsl */ `
  uniform float unitScale;
  out vec3 vColor;
#ifdef TOKEN
  in float glyph;
  out vec2 vUv;
  out float vGlyph;
#endif

  void main() {
    // The instance's translation is the marker's point on the unit sphere.
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 normal = normalize(centre);
    // A marker in flight is above the surface: its distance from the middle is 1 plus its altitude.
    float radius = length(centre);
    vColor = instanceColor;
#ifdef TOKEN
    vUv = uv;
    vGlyph = glyph;
#endif
    // Behind the horizon: out of the clip volume. The planet writes no depth.
    if (dot(normal, cameraPosition) < 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 east = cross(vec3(0.0, 1.0, 0.0), normal);
    east = length(east) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(east);
    vec3 north = cross(normal, east);
    vec3 world = normal * radius + (east * position.x + north * position.y) * unitScale;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  in vec3 vColor;
  layout(location = 0) out highp vec4 outColor;
#ifdef TOKEN
  in vec2 vUv;
  in float vGlyph;
  uniform float sides;
#endif

  void main() {
#ifdef TOKEN
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float aa = max(fwidth(r) * 1.2, 1e-3);
    float disc = 1.0 - smoothstep(0.8 - aa, 0.8, r);
    float ring = smoothstep(0.58 - aa, 0.58, r);
    // A regular polygon of 'sides' sides, a point up.
    float sector = 6.2831853 / sides;
    float a = atan(p.x, p.y);
    float poly = cos(floor(0.5 + a / sector) * sector - a) * r;
    float glyphMask = 1.0 - smoothstep(0.34 - aa, 0.34, poly);
    // A short shadow to the south-east, under the disc.
    float shadow = (1.0 - smoothstep(0.55, 1.0, length(p - vec2(0.1, -0.14)))) * 0.45;
    vec3 ink = vec3(0.012, 0.02, 0.032);
    vec3 color = mix(ink, vColor, ring);
    color = mix(color, vec3(0.92, 0.9, 0.86) * vGlyph, glyphMask * (1.0 - ring));
    float alpha = max(disc, shadow * (1.0 - disc));
    if (alpha < 0.01) discard;
    outColor = linearToOutputTexel(vec4(color * disc, alpha));
#else
    outColor = linearToOutputTexel(vec4(vColor, 1.0));
#endif
  }
`;

/**
 * Ships or structures on the globe, one instanced draw call per kind: each
 * marker lies flat on the planet at its tile, and markers on the far side
 * are culled in the vertex shader rather than by a depth buffer.
 */
export class GlobeMarkers {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly unitScale = { value: 1 };
  /** Radians of the planet per row of tiles. */
  private readonly rowAngle: number;
  /** Brightness of each token's glyph: 1 when built, less while being built. */
  private readonly glyphs: THREE.InstancedBufferAttribute | undefined;

  constructor(readonly options: GlobeMarkersOptions) {
    this.rowAngle = Math.PI / options.worldHeight;
    const token = options.token === true;
    const geometry = token
      ? new THREE.PlaneGeometry(options.size, options.size)
      : new THREE.CircleGeometry(options.size / 2, options.sides ?? 8, Math.PI / 2);
    if (token) {
      this.glyphs = new THREE.InstancedBufferAttribute(new Float32Array(options.capacity), 1);
      this.glyphs.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("glyph", this.glyphs);
    }
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      defines: token ? { TOKEN: 1 } : {},
      uniforms: { unitScale: this.unitScale, sides: { value: options.sides ?? 8 } },
      depthTest: false,
      depthWrite: false,
      transparent: token,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, options.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.set(0xffffff));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.order;
  }

  get count(): number {
    return this.mesh.count;
  }

  set count(value: number) {
    this.mesh.count = Math.max(0, Math.min(this.options.capacity, Math.floor(value)));
  }

  /** Places marker `index` on tile coordinates (x, y), y counted from the north. */
  set(index: number, x: number, y: number, color: THREE.ColorRepresentation): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.options.capacity) {
      throw new RangeError(`marker ${String(index)} is outside the capacity`);
    }
    const { worldWidth, worldHeight } = this.options;
    const { lat, lon } = tileToLatLon(x + 0.5, y + 0.5, worldWidth, worldHeight);
    this.matrix.makeTranslation(...surfacePoint(lat, lon));
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color.set(color));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Brightness of token `index`'s glyph, 1 for a finished building. */
  setGlyph(index: number, brightness: number): void {
    if (!this.glyphs) return;
    this.glyphs.setX(index, brightness);
    this.glyphs.needsUpdate = true;
  }

  /** Places marker `index` at a point of space around the unit sphere: its direction is the ground it is over, its length 1 plus its altitude. */
  setPoint(
    index: number,
    point: readonly [number, number, number],
    color: THREE.ColorRepresentation,
  ): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.options.capacity) {
      throw new RangeError(`marker ${String(index)} is outside the capacity`);
    }
    this.matrix.makeTranslation(point[0], point[1], point[2]);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color.set(color));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Draws every marker this many times its footprint. */
  setScale(scale: number): void {
    this.unitScale.value = scale * this.rowAngle;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
