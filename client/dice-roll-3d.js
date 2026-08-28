import * as THREE from './vendor/three/three.module.js';

let renderer, scene, camera, tray, animationFrame = 0, activeRoll = 0, physicsReady, RAPIER;
const FACE_COUNT = 20, RADIUS = 1.08, STEP_SECONDS = 1 / 60, ROLL_SECONDS = 3.5, SETTLE_SECONDS = .82;
const FACE_COLORS = { W: '#efe4c8', U: '#4f92c6', B: '#6f5b91', R: '#bd5a4c', G: '#4f8a63' };
const FACE_TEXTURES = new Map();
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function seeded(seed) { let value = (seed >>> 0) || 1; return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return ((value >>> 0) % 10_000) / 10_000; }; }
function faceTexture(value) {
  if (FACE_TEXTURES.has(value)) return FACE_TEXTURES.get(value);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const context = canvas.getContext('2d'); context.fillStyle = '#fffdf5'; context.strokeStyle = '#160f0c'; context.lineWidth = 14;
  context.font = '900 164px Georgia'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.strokeText(String(value), 128, 137); context.fillText(String(value), 128, 137);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; FACE_TEXTURES.set(value, texture); return texture;
}

function faceGeometry(colors, dieIndex) {
  const base = new THREE.IcosahedronGeometry(RADIUS, 0).toNonIndexed(); const position = base.getAttribute('position'); const group = new THREE.Group(); const faces = []; const hullPoints = new Float32Array(position.array);
  for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
    const vertices = new Float32Array(9);
    for (let vertex = 0; vertex < 3; vertex += 1) { vertices[vertex * 3] = position.getX(faceIndex * 3 + vertex); vertices[vertex * 3 + 1] = position.getY(faceIndex * 3 + vertex); vertices[vertex * 3 + 2] = position.getZ(faceIndex * 3 + vertex); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colors[(faceIndex + dieIndex) % colors.length] || '#b88a45', roughness: .31, metalness: .16, flatShading: true })); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    const centroid = new THREE.Vector3(); for (let vertex = 0; vertex < 3; vertex += 1) centroid.add(new THREE.Vector3(vertices[vertex * 3], vertices[vertex * 3 + 1], vertices[vertex * 3 + 2])); centroid.multiplyScalar(1 / 3); const normal = centroid.clone().normalize();
    // Numbers are visible for the complete roll, not revealed at the end.
    const number = new THREE.Mesh(new THREE.PlaneGeometry(.54, .54), new THREE.MeshBasicMaterial({ map: faceTexture(faceIndex + 1), transparent: true, depthTest: true, depthWrite: false, side: THREE.FrontSide })); number.position.copy(centroid).addScaledVector(normal, .052); number.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); group.add(number); faces.push({ centroid, normal });
  }
  base.dispose(); return { group, faces, hullPoints };
}

function layout(index, count) { const columns = count <= 2 ? 2 : count <= 4 ? 2 : count <= 6 ? 3 : 4; const rows = Math.ceil(count / columns); return new THREE.Vector3(((index % columns) - (columns - 1) / 2) * 2.28, -1.94, (Math.floor(index / columns) - (rows - 1) / 2) * 2.35); }
function createDie(die, index, count, seed) {
  const random = seeded(seed + index * 7919); const colors = (Array.isArray(die.colors) ? die.colors : []).map(color => FACE_COLORS[color]).filter(Boolean); if (!colors.length) colors.push('#b88a45'); const { group, faces, hullPoints } = faceGeometry(colors, index); const result = Math.max(1, Math.min(FACE_COUNT, Number(die.value) || 1));
  const target = new THREE.Quaternion().setFromUnitVectors(faces[result - 1].normal, new THREE.Vector3(0, 1, 0)); const axis = new THREE.Vector3(random() - .5, random() - .5, random() - .5).normalize(); const start = new THREE.Quaternion().setFromAxisAngle(axis, random() * Math.PI * 2); const landing = layout(index, count); const spawn = new THREE.Vector3(landing.x + (random() - .5) * 1.3, 3.2 + random() * 1.2, landing.z + (random() - .5) * 1.15);
  return { group, hullPoints, target, start, landing, spawn, impulse: new THREE.Vector3((landing.x - spawn.x) * .92 + (random() - .5) * 2.6, 1.4 + random() * 1.1, (landing.z - spawn.z) * .92 + (random() - .5) * 2.6), torque: new THREE.Vector3((random() - .5) * 20, (random() - .5) * 20, (random() - .5) * 20) };
}
async function physics() {
  if (!physicsReady) physicsReady = import('./vendor/rapier/rapier.mjs').then(async ({ default: engine }) => { RAPIER = engine; await RAPIER.init(); });
  await physicsReady;
}
function resize(container) { renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false); camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); }
function setup(container) {
  if (renderer?.domElement.parentElement === container) { resize(container); return; } cancelAnimationFrame(animationFrame); container.querySelector('.custom-dice-canvas')?.remove(); renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.domElement.className = 'custom-dice-canvas'; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(0, 12.5, 9.2); camera.lookAt(0, -1.8, 0); const key = new THREE.DirectionalLight('#fff1cf', 3.7); key.position.set(4, 8, 7); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key); scene.add(new THREE.HemisphereLight('#91bcd5', '#21170e', 2.15)); const surface = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 8.5), new THREE.MeshStandardMaterial({ color: '#21160f', roughness: .76 })); surface.rotation.x = -Math.PI / 2; surface.position.y = -3.05; surface.receiveShadow = true; scene.add(surface); tray = new THREE.Group(); scene.add(tray); container.append(renderer.domElement); resize(container);
}
function trayPhysics(world) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(5.3, .18, 4.25).setTranslation(0, -3.2, 0).setFriction(.72).setRestitution(.31));
  [[-5.45, 0, 0, .15, 3.2, 4.4], [5.45, 0, 0, .15, 3.2, 4.4], [0, 0, -4.38, 5.6, 3.2, .15], [0, 0, 4.38, 5.6, 3.2, .15]].forEach(([x, y, z, hx, hy, hz]) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(.62).setRestitution(.42)));
}
function settle(model, body, progress) {
  const current = body.rotation(); const from = new THREE.Quaternion(current.x, current.y, current.z, current.w); const desired = from.slerp(model.target.clone(), Math.min(.19, .055 + progress * .14)); body.setRotation({ x: desired.x, y: desired.y, z: desired.z, w: desired.w }, true); body.setLinvel({ x: 0, y: Math.min(body.linvel().y, 0), z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); const position = body.translation(); body.applyImpulse({ x: (model.landing.x - position.x) * .11, y: 0, z: (model.landing.z - position.z) * .11 }, true);
}

export async function rollPhysicalD20s({ container, dice = [], onRollSettled = () => {} }) {
  if (!container || !dice.length || prefersReducedMotion() || !window.WebGLRenderingContext) return { animated: false, results: [] }; const sequence = ++activeRoll;
  try {
    await physics(); if (sequence !== activeRoll) return { animated: false, results: [] }; setup(container); tray.clear(); container.dataset.diceCount = String(dice.length); container.dataset.rollComplete = 'false'; const startedAt = Number(dice[0]?.startedAt) || Date.now(); const seed = Number(dice[0]?.seed) || Math.floor(startedAt % 2_147_483_647); const world = new RAPIER.World({ x: 0, y: -15, z: 0 }); trayPhysics(world); const models = dice.map((die, index) => createDie(die, index, dice.length, seed));
    const bodies = models.map(model => { tray.add(model.group); const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(model.spawn.x, model.spawn.y, model.spawn.z).setRotation({ x: model.start.x, y: model.start.y, z: model.start.z, w: model.start.w }).setLinearDamping(.24).setAngularDamping(.16)); world.createCollider(RAPIER.ColliderDesc.convexHull(model.hullPoints).setDensity(1.25).setFriction(.68).setRestitution(.37), body); body.applyImpulse(model.impulse, true); body.applyTorqueImpulse(model.torque, true); return body; });
    let previous = Date.now(), accumulator = 0; const tick = () => { if (sequence !== activeRoll) { world.free(); return; } const now = Date.now(); accumulator += Math.min(.05, (now - previous) / 1000); previous = now; const elapsed = Math.max(0, (now - startedAt) / 1000); const settling = Math.max(0, Math.min(1, (elapsed - (ROLL_SECONDS - SETTLE_SECONDS)) / SETTLE_SECONDS)); while (accumulator >= STEP_SECONDS) { if (settling > 0) bodies.forEach((body, index) => settle(models[index], body, settling)); world.timestep = STEP_SECONDS; world.step(); accumulator -= STEP_SECONDS; } if (elapsed >= ROLL_SECONDS) bodies.forEach((body, index) => { const model = models[index]; body.setTranslation(model.landing, true); body.setRotation({ x: model.target.x, y: model.target.y, z: model.target.z, w: model.target.w }, true); }); models.forEach((model, index) => { const pose = bodies[index].translation(), rotation = bodies[index].rotation(); model.group.position.set(pose.x, pose.y, pose.z); model.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w); }); renderer.render(scene, camera); if (elapsed >= ROLL_SECONDS) { container.dataset.rollComplete = 'true'; world.free(); onRollSettled(true); return; } animationFrame = requestAnimationFrame(tick); }; tick(); return { animated: true, results: [] };
  } catch (error) { console.warn('Physical d20 renderer unavailable; showing the locked table result instead.', error); return { animated: false, results: [] }; }
}
export function stopPhysicalD20s() { activeRoll += 1; cancelAnimationFrame(animationFrame); tray?.clear(); }
