import * as THREE from './vendor/three/three.module.js';

let renderer = null;
let scene = null;
let camera = null;
let tray = null;
let animationFrame = 0;
let activeRoll = 0;

const FACE_COUNT = 20;
const RADIUS = 1.16;
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const colorFor = { W: '#efe4c8', U: '#4f92c6', B: '#6f5b91', R: '#bd5a4c', G: '#4f8a63' };

function seeded(seed) {
  let value = (seed >>> 0) || 1;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return ((value >>> 0) % 10_000) / 10_000; };
}

function resultTexture(value) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'); context.clearRect(0, 0, 256, 256);
  context.fillStyle = '#fffdf5'; context.strokeStyle = '#17110e'; context.lineWidth = 10;
  context.font = '900 142px Georgia'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.strokeText(String(value), 128, 136); context.fillText(String(value), 128, 136);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function geometryFaces(colors, dieIndex) {
  const base = new THREE.IcosahedronGeometry(RADIUS, 0).toNonIndexed(); const position = base.getAttribute('position');
  const group = new THREE.Group(); const faces = [];
  for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
    const geometry = new THREE.BufferGeometry(); const vertices = new Float32Array(9);
    for (let vertex = 0; vertex < 3; vertex += 1) { vertices[vertex * 3] = position.getX(faceIndex * 3 + vertex); vertices[vertex * 3 + 1] = position.getY(faceIndex * 3 + vertex); vertices[vertex * 3 + 2] = position.getZ(faceIndex * 3 + vertex); }
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    // Whole-face colors cycle through the twenty real triangles: 10/10, 7/7/6,
    // five each, or four each, depending on commander identity size.
    const material = new THREE.MeshStandardMaterial({ color: colors[(faceIndex + dieIndex) % colors.length] || '#b88a45', roughness: .38, metalness: .18, flatShading: true });
    group.add(new THREE.Mesh(geometry, material));
    const centroid = new THREE.Vector3(); for (let vertex = 0; vertex < 3; vertex += 1) centroid.add(new THREE.Vector3(vertices[vertex * 3], vertices[vertex * 3 + 1], vertices[vertex * 3 + 2]));
    centroid.multiplyScalar(1 / 3); faces.push({ centroid, normal: centroid.clone().normalize() });
  }
  base.dispose(); return { group, faces };
}

function createDie(die, index, count, seed) {
  const random = seeded(seed + index * 7919); const identity = Array.isArray(die.colors) && die.colors.length ? die.colors : [];
  const colors = identity.map(color => colorFor[color]).filter(Boolean); if (!colors.length) colors.push('#b88a45');
  const { group, faces } = geometryFaces(colors, index); const result = Math.max(1, Math.min(FACE_COUNT, Number(die.value) || 1)); const targetFace = faces[result - 1];
  const target = new THREE.Quaternion().setFromUnitVectors(targetFace.normal, new THREE.Vector3(0, 0, 1)); const axis = new THREE.Vector3(random() - .5, random() - .5, random() - .5).normalize();
  const start = target.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, (3 + Math.floor(random() * 3)) * Math.PI * 2));
  // At phone scale, a physically recessed numeral read as a blank face. Keep
  // the chosen face readable above its material without obscuring the tumble.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: resultTexture(result), transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(1.18, 1.18, 1); sprite.renderOrder = 10; sprite.visible = false;
  const column = index % 2; const row = Math.floor(index / 2); const rows = Math.ceil(count / 2);
  const end = new THREE.Vector3((column - .5) * (count === 1 ? 0 : 2.35), (rows - 1) * .72 - row * 1.45, 0);
  const labelPosition = targetFace.centroid.clone().addScaledVector(targetFace.normal, .18).applyQuaternion(target).add(end);
  return { group, sprite, labelPosition, start, target, startPosition: new THREE.Vector3((random() - .5) * 5.5, 3.2 + random() * 1.4, -1.1 + random()), end, drift: new THREE.Vector3((random() - .5) * 1.2, random() * .5, 0), delay: index * 115, duration: 1550 + random() * 430 };
}

function resize(container) { const width = Math.max(1, container.clientWidth); const height = Math.max(1, container.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }

function setup(container) {
  if (renderer?.domElement.parentElement === container) { resize(container); return; }
  cancelAnimationFrame(animationFrame); container.querySelector('.custom-dice-canvas')?.remove();
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.domElement.className = 'custom-dice-canvas'; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(34, 1, .1, 100); camera.position.set(0, 0, 10);
  const key = new THREE.DirectionalLight('#fff1cf', 3.2); key.position.set(3, 6, 8); key.castShadow = true; scene.add(key); scene.add(new THREE.HemisphereLight('#90b9d4', '#21170e', 2));
  tray = new THREE.Group(); scene.add(tray); container.append(renderer.domElement); resize(container);
}

// The server result, visual seed, and start time are shared; every phone ends
// on the same numbered face while the preceding tumble remains deterministic.
export async function rollPhysicalD20s({ container, dice = [], onRollSettled = () => {} }) {
  if (!container || !dice.length || prefersReducedMotion() || !window.WebGLRenderingContext) return { animated: false, results: [] };
  const sequence = ++activeRoll;
  try {
    setup(container); tray.clear(); container.dataset.diceCount = String(dice.length); container.dataset.rollComplete = 'false';
    const startedAt = Number(dice[0]?.startedAt) || Date.now(); const seed = Number(dice[0]?.seed) || Math.floor(startedAt % 2_147_483_647);
    const diceModels = dice.map((die, index) => createDie(die, index, dice.length, seed)); diceModels.forEach(({ group, sprite }) => { tray.add(group); tray.add(sprite); }); const maxDuration = Math.max(...diceModels.map(die => die.delay + die.duration));
    const tick = () => {
      if (sequence !== activeRoll) return;
      const elapsed = Math.max(0, Date.now() - startedAt); let complete = elapsed >= maxDuration;
      for (const die of diceModels) {
        const progress = Math.min(1, Math.max(0, (elapsed - die.delay) / die.duration)); const eased = 1 - Math.pow(1 - progress, 3);
        die.group.quaternion.slerpQuaternions(die.start, die.target, eased); die.group.position.copy(die.startPosition).lerp(die.end, eased).addScaledVector(die.drift, Math.sin(progress * Math.PI)); die.sprite.position.copy(die.labelPosition); die.sprite.visible = progress >= 1;
        if (progress < 1) complete = false;
      }
      renderer.render(scene, camera);
      if (complete) { container.dataset.rollComplete = 'true'; onRollSettled(true); return; }
      animationFrame = requestAnimationFrame(tick);
    };
    tick(); return { animated: true, results: [] };
  } catch (error) { console.warn('Custom d20 renderer unavailable; showing the locked table result instead.', error); return { animated: false, results: [] }; }
}

export function stopPhysicalD20s() { activeRoll += 1; cancelAnimationFrame(animationFrame); tray?.clear(); }
