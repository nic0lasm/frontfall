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
}

const vertexShader = /* glsl */ `
  uniform float unitScale;
  out vec3 vColor;

  void main() {
    // The instance's translation is the marker's point on the unit sphere.
    vec3 normal = normalize((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
    vColor = instanceColor;
    // Behind the horizon: out of the clip volume. The planet writes no depth.
    if (dot(normal, cameraPosition) < 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 east = cross(vec3(0.0, 1.0, 0.0), normal);
    east = length(east) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(east);
    vec3 north = cross(normal, east);
    vec3 world = normal + (east * position.x + north * position.y) * unitScale;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  in vec3 vColor;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    outColor = linearToOutputTexel(vec4(vColor, 1.0));
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

  constructor(readonly options: GlobeMarkersOptions) {
    this.rowAngle = Math.PI / options.worldHeight;
    const geometry = new THREE.CircleGeometry(options.size / 2, options.sides ?? 8, Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: { unitScale: this.unitScale },
      depthTest: false,
      depthWrite: false,
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
