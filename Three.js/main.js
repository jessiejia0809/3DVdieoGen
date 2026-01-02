import * as THREE from "three";

// Basic three.js setup (3D perspective)
const canvas = document.querySelector("#c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6f8fb);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, -24, 12);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

// Lights
scene.add(new THREE.HemisphereLight(0xffffff, 0xa0a0a0, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(8, 8, 14);
dir.castShadow = true;
scene.add(dir);

// Hex helpers
function makeHexShape(radius = 1, pinch = 0.05) {
  const shape = new THREE.Shape();
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    verts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  verts.forEach((v, i) => {
    const next = verts[(i + 1) % 6];
    const mx = (v.x + next.x) / 2;
    const my = (v.y + next.y) / 2;
    const insetX = mx * (1 - pinch);
    const insetY = my * (1 - pinch);
    if (i === 0) shape.moveTo(v.x, v.y);
    shape.quadraticCurveTo(insetX, insetY, next.x, next.y);
  });
  return shape;
}

function axialToXY(q, r, size) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

function generateHexBlob(radius = 1) {
  const coords = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) coords.push({ q, r });
  }
  return coords;
}

// Scene params
const HEX_SIZE = 1.1;
const HEX_GAP = 0.08;
const HEX_HEIGHT = 0.35;
const shape = makeHexShape(HEX_SIZE);
const carrierGeometry = new THREE.ExtrudeGeometry(shape, {
  depth: HEX_HEIGHT,
  bevelEnabled: false,
});
carrierGeometry.translate(0, 0, -HEX_HEIGHT / 2); // center on z

const carrierMaterial = new THREE.MeshStandardMaterial({ color: 0xbddc6a, roughness: 0.55, metalness: 0.05 });
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x2b2b2b });

const rigGroup = new THREE.Group();
scene.add(rigGroup);

const carrierGroup = new THREE.Group();
rigGroup.add(carrierGroup);

const coords = generateHexBlob(1); // 7 carriers
const carriers = [];
const carrierByKey = new Map();
const keyFor = (q, r) => `${q},${r}`;

coords.forEach(({ q, r }) => {
  const { x, y } = axialToXY(q, r, HEX_SIZE + HEX_GAP);
  const key = keyFor(q, r);

  const node = new THREE.Group();
  node.position.set(x, y, 0);
  carrierGroup.add(node);

  const mesh = new THREE.Mesh(carrierGeometry, carrierMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  node.add(mesh);

  const edges = new THREE.EdgesGeometry(carrierGeometry);
  const outline = new THREE.LineSegments(edges, outlineMaterial);
  node.add(outline);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshStandardMaterial({ color: 0x2d5b2a }));
  dot.position.set(0, 0, HEX_HEIGHT / 2 + 0.02);
  node.add(dot);

  const orientDot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshStandardMaterial({ color: 0x1f3b1f }));
  const orientOffset = HEX_SIZE * 0.35;
  orientDot.position.set(orientOffset, 0, HEX_HEIGHT / 2 + 0.02);
  node.add(orientDot);

  carriers.push({ q, r, x, y, key, group: node, rotation: 0 });
  carrierByKey.set(key, carriers[carriers.length - 1]);
});

// Adjacency map
const neighborDirs = [
  { dq: 1, dr: 0 },
  { dq: 1, dr: -1 },
  { dq: 0, dr: -1 },
  { dq: -1, dr: 0 },
  { dq: -1, dr: 1 },
  { dq: 0, dr: 1 },
];

const textileMaterial = new THREE.MeshStandardMaterial({ color: 0x9b59b6, roughness: 0.35, metalness: 0.05 });
const SIDE_NORMAL_ANGLES = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
const MID_DIST = HEX_SIZE * Math.cos(Math.PI / 6);

const neighbors = new Map();
carriers.forEach((c) => neighbors.set(c.key, []));
carriers.forEach(({ q, r, x, y, key }) => {
  neighborDirs.forEach(({ dq, dr }) => {
    const nq = q + dq;
    const nr = r + dr;
    const neighborKey = keyFor(nq, nr);
    if (!carrierByKey.has(neighborKey)) return;
    neighbors.get(key).push(neighborKey);
  });
});

function nearestSideIndex(vec) {
  const len = Math.hypot(vec.x, vec.y) || 1;
  const nx = vec.x / len;
  const ny = vec.y / len;
  let bestIdx = 0;
  let bestDot = -Infinity;
  SIDE_NORMAL_ANGLES.forEach((ang, idx) => {
    const sx = Math.cos(ang);
    const sy = Math.sin(ang);
    const dot = sx * nx + sy * ny;
    if (dot > bestDot) {
      bestDot = dot;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function sideNormal(carrier, sideIdx) {
  const ang = SIDE_NORMAL_ANGLES[sideIdx] + carrier.rotation;
  return { nx: Math.cos(ang), ny: Math.sin(ang), ang };
}

function sideMidpoint(carrier, sideIdx) {
  const n = sideNormal(carrier, sideIdx);
  return {
    midX: carrier.x + n.nx * MID_DIST,
    midY: carrier.y + n.ny * MID_DIST,
    tangentAngle: n.ang + Math.PI / 2,
    normal: n,
  };
}

// Single rod that retargets to the best-facing neighbor of its anchor side
const rodLength = HEX_SIZE * 1.05;
const rodThickness = 0.18;
const rodGeom = new THREE.BoxGeometry(rodLength, rodThickness, 0.05);
const rodMesh = new THREE.Mesh(rodGeom, textileMaterial);
rodMesh.castShadow = true;
rodMesh.receiveShadow = true;
scene.add(rodMesh);

// Yarn anchor point above center and a line from anchor to rod center
const yarnAnchor = new THREE.Vector3(0, 0, 3);
const yarnMat = new THREE.LineBasicMaterial({ color: 0x6e8f69, linewidth: 30 });
let yarnLine = null;
function updateYarnLine() {
  const points = [yarnAnchor.clone(), rod.mesh.position.clone()];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  if (yarnLine) {
    yarnLine.geometry.dispose();
    yarnLine.geometry = geo;
  } else {
    yarnLine = new THREE.Line(geo, yarnMat);
    scene.add(yarnLine);
  }
}

const rod = {
  anchor: carriers[0] ?? null,
  anchorSideIdx: 0,
  mesh: rodMesh,
};

if (rod.anchor) {
  // pick a side that actually faces a neighbor initially
  const neighborKeys = neighbors.get(rod.anchor.key) || [];
  if (neighborKeys.length > 0) {
    const nk = neighborKeys[0];
    const n = carrierByKey.get(nk);
    const dir = { x: n.x - rod.anchor.x, y: n.y - rod.anchor.y };
    rod.anchorSideIdx = nearestSideIndex(dir);
  }
}

function updateRod() {
  if (!rod.anchor) {
    rod.mesh.visible = false;
    return;
  }
  const anchor = rod.anchor;
  const anchorSide = sideMidpoint(anchor, rod.anchorSideIdx);
  const neighborKeys = neighbors.get(anchor.key) || [];
  let best = null;
  neighborKeys.forEach((k) => {
    const nb = carrierByKey.get(k);
    const dx = nb.x - anchor.x;
    const dy = nb.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const dir = { x: dx / len, y: dy / len };
    const dot = dir.x * anchorSide.normal.nx + dir.y * anchorSide.normal.ny;
    if (!best || dot > best.dot) best = { dot, nb, dir };
  });

  if (!best || best.dot < 0.2) {
    rod.mesh.visible = false;
    return;
  }
  rod.mesh.visible = true;

  const nb = best.nb;
  const neighborSideIdx = nearestSideIndex({ x: anchor.x - nb.x, y: anchor.y - nb.y });
  const nbSide = sideMidpoint(nb, neighborSideIdx);

  // Keep a fixed rod length and align parallel to the anchor side
  const scale = 1;
  const rodAngle = anchorSide.tangentAngle;
  const edgeOffset = 0.02;

  // Place the rod right on the anchor edge (slightly offset outward along the normal)
  const posX = anchorSide.midX + anchorSide.normal.nx * edgeOffset;
  const posY = anchorSide.midY + anchorSide.normal.ny * edgeOffset;

  rod.mesh.position.set(posX, posY, HEX_HEIGHT / 2 + 0.06);
  rod.mesh.rotation.set(0, 0, rodAngle);
  rod.mesh.scale.set(scale, 1, 1);

  updateYarnLine();
}

updateRod();

// Per-carrier rotation controls
const ROTATION_STEP = Math.PI / 3; // 60 deg per step
let selected = carriers[0] ?? null;

function rotateCarrier(carrier, delta) {
  if (!carrier) return;
  carrier.rotation += delta;
  carrier.group.rotation.set(0, 0, carrier.rotation);
  updateRod();
}

// Simple picking via raycaster to select a carrier (and click to rotate)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(carrierGroup.children, true);
  if (hit.length > 0) {
    const carrier = carriers.find((c) => c.group === hit[0].object.parent || c.group === hit[0].object);
    if (carrier) {
      selected = carrier;
      // left click rotates CW, right click (button 2) rotates CCW
      if (event.button === 0) rotateCarrier(selected, -ROTATION_STEP);
      if (event.button === 2) rotateCarrier(selected, ROTATION_STEP);
    }
  }
}
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

// Keyboard controls for selected carrier
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") rotateCarrier(selected, -ROTATION_STEP); // CW
  if (e.key === "ArrowLeft") rotateCarrier(selected, ROTATION_STEP);  // CCW
});

// Fit and tilt
carrierGroup.rotation.set(0, 0, 0);

function fitCamera() {
  const box = new THREE.Box3().setFromObject(rigGroup);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y);
  const dist = maxDim * 1.8;
  camera.position.set(center.x, center.y - dist, dist * 0.6);
  camera.up.set(0, 0, 1);
  camera.lookAt(center);
}
fitCamera();

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
