import * as THREE from "three";

/**
 * The one WebGL context of a game, and its canvas. The flat map and the
 * globe draw with it in turn (`MapScene` swaps them), so a switch of view
 * makes no context: browsers cap how many stay alive, and a new one costs
 * the shaders and textures again.
 */
export class GlContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** Where the shaders' errors go: the view drawing now. */
  private onShaderError: ((message: string) => void) | undefined;
  private readonly pixel = new Uint8Array(4);

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.canvas = this.renderer.domElement;
    // A shader is checked the first time it draws, so its error belongs to the view drawing.
    this.renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
      this.onShaderError?.(
        `shader: ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`,
      );
    };
  }

  /** Readies the context for a frame of one view: its background, and where its shader errors go. */
  use(background: THREE.ColorRepresentation, onShaderError: (message: string) => void): void {
    this.renderer.setClearColor(background);
    this.onShaderError = onShaderError;
  }

  /**
   * Gets a scene ready to draw while another one is shown: its shaders built
   * in parallel, and every texture its materials read sent now rather than
   * by the frame that first needs it. Settles once the shaders are built.
   */
  warm(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    scene.traverse((object) => {
      const { material } = object as Partial<THREE.Mesh>;
      for (const each of Array.isArray(material) ? material : material ? [material] : []) {
        const uniforms = (each as Partial<THREE.ShaderMaterial>).uniforms ?? {};
        for (const { value } of Object.values(uniforms)) {
          if (value instanceof THREE.Texture) this.renderer.initTexture(value as THREE.Texture);
        }
      }
    });
    return this.renderer.compileAsync(scene, camera).then(
      () => undefined,
      () => undefined,
    );
  }

  /** What went wrong with the context itself, if anything: lost, or an error left by the last frame. */
  error(): string | undefined {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) return "context lost";
    const code = gl.getError();
    return code === gl.NO_ERROR ? undefined : `gl error ${String(code)}`;
  }

  /** Waits for the graphics card to finish what was sent (`?perf` timings only). */
  sync(): void {
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
  }

  /** Frees the context on purpose, which the page must not report as lost. */
  dispose(): void {
    this.renderer.dispose();
    // Browsers cap how many contexts stay alive: give this one back now.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
