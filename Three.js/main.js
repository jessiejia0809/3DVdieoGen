import * as THREE from "three";

/**
 * STEP 2 GOAL:
 * - Draw a field of hexagon "carriers" in a planar layout.
 * - Keep it simple: no motion yet.
 *
 * Later steps will add:
 * - sequencing (activation schedule)
 * - rotation direction and speed
 * - connectors / yarn paths
 */

// ---------- Basic three.js setup ----------
const canvas = document.querySelector("#c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// Use an orthographic camera for a "diagram/simulation" look (like your image)
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

// Simple light (MeshBasicMaterial doesn’t need it, but good to have if you switch later)
scene.add(new THREE.AmbientLight(0xffffff, 1.0));

// ---------- Hex geometry helpers ----------
function makeHexShape(radius = 1) {
  // Flat hex in XY plane
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6; // rotate so it "sits flat" on top
    const x = radius * Math.cos(a);
    const y = radius * Math.sin(a);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// Axial hex coords (q,r) -> 2D pixel coords (x,y)
function axialToXY(q, r, size) {
  // pointy-top axial coordinate system
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

// Generate a blob-like set of axial coords to approximate the “patch” in your image
function generateHexBlob(radius = 3) {
  const coords = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r });
    }
  }

  // Optional: remove a few to create an irregular boundary (more like your screenshot)
  // Adjust/remove these later to match your exact layout.
  const removeSet = new Set([
    "3,0", "3,-1", "2,2", "-3,1", "-2,3"
  ]);
  return coords.filter(({ q, r }) => !removeSet.has(`${q},${r}`));
}

// ---------- Build the carrier field ----------
const carrierGroup = new THREE.Group();
scene.add(carrierGroup);

const HEX_SIZE = 0.95;              // overall carrier size
const HEX_GAP = 0.06;               // spacing between carriers
const hexRadius = HEX_SIZE;         // shape radius
const shape = makeHexShape(hexRadius);
const geometry = new THREE.ShapeGeometry(shape);

// Carrier fill material (match later with your palette)
const carrierMaterial = new THREE.MeshBasicMaterial({
  color: 0xbddc6a, // light green-ish
});

// (Optional) outline for readability
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x2b2b2b });

const coords = generateHexBlob(3);

// Create carriers as individual meshes (fine for ~30–200 pieces)
coords.forEach(({ q, r }) => {
  const { x, y } = axialToXY(q, r, HEX_SIZE + HEX_GAP);

  const mesh = new THREE.Mesh(geometry, carrierMaterial);
  mesh.position.set(x, y, 0);
  carrierGroup.add(mesh);

  // Outline
  const edges = new THREE.EdgesGeometry(geometry);
  const outline = new THREE.LineSegments(edges, outlineMaterial);
  outline.position.copy(mesh.position);
  carrierGroup.add(outline);

  // Small “center dot” like your image
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 16),
    new THREE.MeshBasicMaterial({ color: 0x2d5b2a })
  );
  dot.position.set(x, y, 0.01);
  carrierGroup.add(dot);

  // Orientation marker: small dot near the "top" edge to show facing direction
  const orientDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 12),
    new THREE.MeshBasicMaterial({ color: 0x1f3b1f })
  );
  const orientOffset = hexRadius * 0.7;
  orientDot.position.set(x, y + orientOffset, 0.02);
  carrierGroup.add(orientDot);
});

// Center the group in view
carrierGroup.position.set(0, 0, 0);

// Fit camera bounds to content
function fitCameraToGroup(group, padding = 1.2) {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const halfW = (size.x / 2) * padding;
  const halfH = (size.y / 2) * padding;

  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.near = 0.1;
  camera.far = 100;
  camera.position.set(center.x, center.y, 10);
  camera.lookAt(center.x, center.y, 0);
  camera.updateProjectionMatrix();
}
fitCameraToGroup(carrierGroup);

// ---------- Resize ----------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", onResize);
onResize();

// ---------- Render loop (static for now) ----------
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
