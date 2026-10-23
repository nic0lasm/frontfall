import { WorldGrid } from "@frontfall/engine";
import * as THREE from "three";
import { connect, socketUrl } from "./connection.ts";
import { generateLand } from "./terrain.ts";

const grid = new WorldGrid(512, 256);
const land = generateLand(grid, 2026);

const pixels = new Uint8Array(grid.size * 4);
for (let i = 0; i < grid.size; i++) {
  const [r, g, b] = land[i] === 1 ? [92, 128, 76] : [24, 58, 86];
  // Textures start at the bottom row; the grid starts at the north pole.
  const row = grid.height - 1 - grid.y(i);
  const offset = (row * grid.width + grid.x(i)) * 4;
  pixels.set([r, g, b, 255], offset);
}
const texture = new THREE.DataTexture(pixels, grid.width, grid.height);
texture.magFilter = THREE.NearestFilter;
texture.colorSpace = THREE.SRGBColorSpace;
texture.needsUpdate = true;

const scene = new THREE.Scene();
const geometry = new THREE.PlaneGeometry(grid.width, grid.height);
const material = new THREE.MeshBasicMaterial({ map: texture });

// Three copies side by side: wherever the camera sits, the world continues.
for (const shift of [-1, 0, 1]) {
  const copy = new THREE.Mesh(geometry, material);
  copy.position.x = shift * grid.width;
  scene.add(copy);
}

const camera = new THREE.OrthographicCamera();
camera.position.z = 10;
let zoom = 1;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
document.body.append(renderer.domElement);

function resize(): void {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h);
  const halfHeight = grid.height / 2 / zoom;
  const halfWidth = (halfHeight * w) / h;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

function clampY(): void {
  const limit = Math.max(0, grid.height / 2 - grid.height / 2 / zoom);
  camera.position.y = Math.min(limit, Math.max(-limit, camera.position.y));
}

let dragging: { x: number; y: number } | undefined;
renderer.domElement.addEventListener("pointerdown", (event) => {
  dragging = { x: event.clientX, y: event.clientY };
});
window.addEventListener("pointerup", () => {
  dragging = undefined;
});
window.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const unitsPerPixel = (camera.top - camera.bottom) / window.innerHeight;
  camera.position.x -= (event.clientX - dragging.x) * unitsPerPixel;
  camera.position.y += (event.clientY - dragging.y) * unitsPerPixel;
  // Recentre on the middle copy so panning east or west never runs out.
  camera.position.x = grid.wrapX(camera.position.x + grid.width / 2) - grid.width / 2;
  clampY();
  dragging = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    zoom = Math.min(16, Math.max(1, zoom * Math.exp(-event.deltaY * 0.001)));
    resize();
    clampY();
  },
  { passive: false },
);
window.addEventListener("resize", resize);

resize();
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

const status = document.querySelector<HTMLElement>("#status");
const showStatus = (text: string): void => {
  if (status) status.textContent = text;
};

connect(socketUrl(location.href), {
  onOpen(send) {
    showStatus("Joining…");
    send({ type: "join", lobby: "public", name: "Guest" });
  },
  onMessage(message) {
    if (message.type === "joined") showStatus(`Connected as ${message.player}`);
    if (message.type === "turn" && message.turn.tick % 10 === 0) {
      showStatus(`Turn ${String(message.turn.tick)}`);
    }
  },
  onClose(retryInMs) {
    showStatus(`Disconnected, retrying in ${String(Math.ceil(retryInMs / 1000))} s`);
  },
});
