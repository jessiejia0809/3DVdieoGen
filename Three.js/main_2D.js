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

// Keep the field small (<10 carriers) for clarity
const coords = generateHexBlob(1); // center + 6 neighbors = 7 carriers

// Build carriers and store graph data
const carriers = [];
const carrierByKey = new Map();
const keyFor = (q, r) => `${q},${r}`;

coords.forEach(({ q, r }) => {
  const { x, y } = axialToXY(q, r, HEX_SIZE + HEX_GAP);
  const key = keyFor(q, r);

  // Group per carrier so rotation affects all child visuals
  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(x, y, 0);
  carrierGroup.add(nodeGroup);

  const mesh = new THREE.Mesh(geometry, carrierMaterial);
  mesh.position.set(0, 0, 0);
  nodeGroup.add(mesh);

  // Outline
  const edges = new THREE.EdgesGeometry(geometry);
  const outline = new THREE.LineSegments(edges, outlineMaterial);
  outline.position.set(0, 0, 0);
  nodeGroup.add(outline);

  // Small “center dot” like your image
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 16),
    new THREE.MeshBasicMaterial({ color: 0x2d5b2a })
  );
  dot.position.set(0, 0, 0.01);
  nodeGroup.add(dot);

  // Orientation marker: small dot near the "top" edge to show facing direction
  const orientDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 12),
    new THREE.MeshBasicMaterial({ color: 0x1f3b1f })
  );
  const orientOffset = HEX_SIZE * 0.35;
  orientDot.position.set(orientOffset, 0, 0.02);
  nodeGroup.add(orientDot);

  // Selection ring (hidden by default)
  const selectRing = new THREE.LineLoop(
    new THREE.RingGeometry(HEX_SIZE * 1.05, HEX_SIZE * 1.15, 32),
    new THREE.LineBasicMaterial({ color: 0xff8c00 })
  );
  selectRing.position.set(0, 0, 0.03);
  selectRing.visible = false;
  nodeGroup.add(selectRing);

  carriers.push({ q, r, x, y, key, group: nodeGroup, rotation: 0, selectRing });
  carrierByKey.set(key, carriers[carriers.length - 1]);
});

// Center the group in view
carrierGroup.position.set(0, 0, 0);

// ---------- Adjacency graph + stitch edges ----------
const neighborDirs = [
  { dq: 1, dr: 0 },
  { dq: 1, dr: -1 },
  { dq: 0, dr: -1 },
  { dq: -1, dr: 0 },
  { dq: -1, dr: 1 },
  { dq: 0, dr: 1 },
];

const edgeGroup = new THREE.Group();
scene.add(edgeGroup);

const textileMaterial = new THREE.MeshBasicMaterial({ color: 0x9b59b6 }); // purple textile segments
const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
const SIDE_NORMAL_ANGLES = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
const MID_DIST = hexRadius * Math.cos(Math.PI / 6); // center to side midpoint

const edges = [];

function nearestSideIndex(vec) {
  const len = Math.hypot(vec.x, vec.y) || 1;
  const nx = vec.x / len;
  const ny = vec.y / len;
  let bestIdx = 0;
  let bestDot = -Infinity;
  SIDE_NORMAL_ANGLES.forEach((angle, idx) => {
    const sx = Math.cos(angle);
    const sy = Math.sin(angle);
    const dot = sx * nx + sy * ny;
    if (dot > bestDot) {
      bestDot = dot;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

carriers.forEach(({ q, r, x, y, key }) => {
  neighborDirs.forEach(({ dq, dr }) => {
    const nq = q + dq;
    const nr = r + dr;
    const neighborKey = keyFor(nq, nr);
    if (!carrierByKey.has(neighborKey)) return;

    // enforce single creation per pair
    if (key > neighborKey) return;

    const neighbor = carrierByKey.get(neighborKey);
    const dx = neighbor.x - x;
    const dy = neighbor.y - y;
    const len = Math.hypot(dx, dy);
    const dirVec = { x: dx / len, y: dy / len };
    const sideIdxA = nearestSideIndex(dirVec);
    const sideIdxB = nearestSideIndex({ x: -dirVec.x, y: -dirVec.y });

    // Short textile segment centered in the gap
    const barThickness = 0.2;
    const barLength = len * 0.55;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(barLength, barThickness, 0.02),
      hiddenMaterial
    );
    bar.position.set((x + neighbor.x) / 2, (y + neighbor.y) / 2, 0.015);
    edgeGroup.add(bar);

    edges.push({
      key: `${key}|${neighborKey}`,
      a: key,
      b: neighborKey,
      mesh: bar,
      baseLength: barLength,
      sideIdxA,
      sideIdxB,
    });
  });
});

// Toggle state for edges: textile present (purple) vs empty (hidden)
function setEdgeStates({ connected = [] }) {
  const connectedSet = new Set(connected);
  edges.forEach((edge) => {
    edge.mesh.material = connectedSet.has(edge.key)
      ? textileMaterial
      : hiddenMaterial;
  });
}

function sideMidpoint(carrier, sideIdx) {
  const normalAngle = SIDE_NORMAL_ANGLES[sideIdx] + carrier.rotation;
  const nx = Math.cos(normalAngle);
  const ny = Math.sin(normalAngle);
  return {
    midX: carrier.x + nx * MID_DIST,
    midY: carrier.y + ny * MID_DIST,
    tangentAngle: normalAngle + Math.PI / 2,
  };
}

function updateEdgesTransform() {
  edges.forEach((edge) => {
    const ca = carrierByKey.get(edge.a);
    const cb = carrierByKey.get(edge.b);
    const aSide = sideMidpoint(ca, edge.sideIdxA);
    const bSide = sideMidpoint(cb, edge.sideIdxB);

    const midX = (aSide.midX + bSide.midX) / 2;
    const midY = (aSide.midY + bSide.midY) / 2;
    const targetLen = Math.hypot(bSide.midX - aSide.midX, bSide.midY - aSide.midY) * 0.85;
    const scale = targetLen / edge.baseLength;
    const angle = Math.atan2(bSide.midY - aSide.midY, bSide.midX - aSide.midX);

    edge.mesh.position.set(midX, midY, edge.mesh.position.z);
    // Align textile along the line connecting the two attachment points (edge between carriers).
    edge.mesh.rotation.z = angle;
    edge.mesh.scale.set(scale, 1, 1);
  });
}

// Static state: show exactly one textile segment (first edge) and no animation
const initialEdge = edges[0]?.key ? [edges[0].key] : [];
setEdgeStates({ connected: initialEdge });
updateEdgesTransform();

// ----- Interaction: per-carrier rotation (not global) -----
let selected = carriers[0] ?? null;
if (selected) selected.selectRing.visible = true;

function setSelected(carrier) {
  selected = carrier;
  carriers.forEach((c) => {
    c.selectRing.visible = c === carrier;
  });
}

const ROTATION_STEP = Math.PI / 3; // 60 degrees per step
function rotateSelected(delta) {
  if (!selected) return;
  selected.rotation += delta;
  selected.group.rotation.z = selected.rotation;
  updateEdgesTransform();
}

// Mouse picking to choose a carrier
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = carriers.map((c) => c.group.children[0]); // the hex mesh
  const intersects = raycaster.intersectObjects(meshes);
  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    const carrier = carriers.find((c) => c.group.children[0] === mesh);
    if (carrier) setSelected(carrier);
  }
}
renderer.domElement.addEventListener("pointerdown", onPointerDown);

// Keyboard: rotate only the selected carrier
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") rotateSelected(-ROTATION_STEP); // clockwise
  if (e.key === "ArrowLeft") rotateSelected(ROTATION_STEP);   // counterclockwise
});

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

// ---------- Render loop ----------
function animate() {
  requestAnimationFrame(animate);

  renderer.render(scene, camera);
}
animate();
