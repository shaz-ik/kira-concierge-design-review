/* Kira Concierge — 3D hotel map for the public hall kiosk and the guest tablet.
   Three.js (jsDelivr, pinned in the page's import map). Every floor of the Grand Marina is
   its own group of glass rooms. For a route, only the floors it uses stay on screen — they
   glide apart so neither hides the other, joined by the lift shaft — and a purple line grows
   from "You are here" to the destination, then a little person walks it.
   One persistent canvas: the kiosk re-renders its screens, so attach() moves the map into
   whichever slot is on screen instead of building a new one. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const H = window.KiraHotel;
const ICON = '../assets/icons/';
const LIFT_Z_DOOR = -9, LIFT_Z_SHAFT = -14.5;
const ROUTE_GAP = 22;        // floor spacing while a route is shown
const AZ = 0.5;             // camera: from the front-right, above —
let EL = 0.52;              // steeper for a single floor, lower when floors are stacked

const PAL = {
  dark: {
    slab: [0x2a2433, 0.92], slabEdge: [0xc4a6ff, 0.26], room: [0x8c4ef6, 0.2], roomEdge: [0xc4a6ff, 0.55],
    dest: [0xa36bff, 0.55], core: [0x8b879a, 0.55], water: [0x38bdf8, 0.75], outdoor: [0x3a3446, 0.8], mine: [0x4ade80, 0.24],
    ghost: [0x8c4ef6, 0.05], ghostEdge: [0xc4a6ff, 0.16], shaft: [0xc4a6ff, 0.1],
    route: 0xd9c7ff, glow: 0x8c4ef6, outline: 0xffffff, here: 0x4ade80, pin: 0xa36bff, shadow: 'rgba(0,0,0,.55)'
  },
  light: {
    slab: [0xffffff, 0.95], slabEdge: [0x8c4ef6, 0.2], room: [0xd9c8fb, 0.75], roomEdge: [0x8c4ef6, 0.38],
    dest: [0x8c4ef6, 0.7], core: [0xc9c6d4, 0.85], water: [0x5cc8f5, 0.8], outdoor: [0xeeeaf6, 0.9], mine: [0x86efac, 0.6],
    ghost: [0xb794ff, 0.06], ghostEdge: [0x8c4ef6, 0.14], shaft: [0x8c4ef6, 0.09],
    route: 0x7a3ff0, glow: 0xb794ff, outline: 0x5b2bb8, here: 0x16a34a, pin: 0x8c4ef6, shadow: 'rgba(60,40,120,.22)'
  }
};

let host, renderer, labels, scene, overlay, camera, controls;
let theme = document.documentElement.classList.contains('theme-light') ? 'light' : 'dark';
const reg = [];          // { m: material, role, floor, area } — recoloured on theme change, faded per floor
const floors = {};       // id -> { group, chip, y, toY, dim, toDim }
const areaLabels = [];   // { obj, floor, place, on }
let ghost = null, shaft = null, shadow = null;
let here = null, pin = null, walk = null, camTween = null, framing = null, destId = null, liftSpan = null, lastStep = -1;
let onStep = null;

/* ---------------- Build ---------------- */

function mat(role, floor, area, kind) {
  const [c, o] = PAL[theme][role];
  const m = kind === 'line'
    ? new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o })
    : new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: o, roughness: 0.55, metalness: 0.05, depthWrite: role === 'slab' || role === 'core' });
  reg.push({ m, role, floor, area });
  return m;
}

function rectBox(parent, r, y, h, role, floor, area, edgeRole) {
  const g = new THREE.BoxGeometry(r[2] - r[0], h, r[3] - r[1]);
  const mesh = new THREE.Mesh(g, mat(role, floor, area));
  mesh.position.set((r[0] + r[2]) / 2, y + h / 2, (r[1] + r[3]) / 2);
  parent.add(mesh);
  if (edgeRole) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), mat(edgeRole, floor, area, 'line'));
    edges.position.copy(mesh.position);
    parent.add(edges);
  }
  return mesh;
}

function label(parent, html, cls, x, y, z, center) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  if (center) obj.center.set(center[0], center[1]);
  parent.add(obj);
  return obj;
}

function ring(color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

function build() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  labels = new CSS2DRenderer();
  labels.domElement.className = 'map-labels';
  host = document.createElement('div');
  host.className = 'map3d';
  host.appendChild(renderer.domElement);
  host.appendChild(labels.domElement);

  // the walker is drawn in its own pass on top, so a floor above never hides it
  overlay = new THREE.Scene();
  [scene, overlay].forEach((sc) => {
    sc.add(new THREE.HemisphereLight(0xffffff, 0x6b4bb0, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(40, 90, 70);
    sc.add(sun);
  });

  // soft contact shadow under the lowest floor
  const c = document.createElement('canvas'); c.width = c.height = 128;
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  paintShadow();

  const fp = H.FOOTPRINT;
  H.FLOORS.forEach((f) => {
    const g = new THREE.Group();
    const y = H.floorY(f.id);
    g.position.y = y;
    scene.add(g);
    rectBox(g, fp, -0.6, 0.6, 'slab', f.id, null, 'slabEdge');
    rectBox(g, H.LIFT_CORE, 0, 2.6, 'core', f.id, 'lifts', null);
    const chip = label(g, '<b>' + f.short + '</b><span>' + f.theme + '</span>', 'map-floor', fp[0] - 1.5, 0, fp[3], [1, 0.5]);
    floors[f.id] = { group: g, chip, y, toY: y, dim: 1, toDim: 1 };
    areaLabels.push({ obj: label(g, 'Lifts', 'map-label', 0, 3.6, (H.LIFT_CORE[1] + H.LIFT_CORE[3]) / 2), floor: f.id, place: 'lifts', on: false });
  });
  H.AREAS.forEach((a) => {
    const g = floors[a.floor].group;
    if (a.kind === 'water') rectBox(g, a.rect, 0, 0.5, 'water', a.floor, a.place, 'roomEdge');
    else if (a.kind === 'outdoor') rectBox(g, a.rect, -0.6, 0.6, 'outdoor', a.floor, a.place, 'slabEdge');
    else rectBox(g, a.rect, 0, 2.2, a.kind === 'mine' ? 'mine' : 'room', a.floor, a.place, 'roomEdge');
    if (a.label) areaLabels.push({ obj: label(g, a.label, 'map-label', (a.rect[0] + a.rect[2]) / 2, 3.2, (a.rect[1] + a.rect[3]) / 2), floor: a.floor, place: a.place, on: false });
  });

  // guest floors 3–7 (overview only): ghosted plates between Level 2 and the roof
  ghost = { group: new THREE.Group(), dim: 1, toDim: 1 };
  const g0 = H.floorY('L2') + 2.6, g1 = H.floorY('L8') - 1.4;
  for (let i = 0; i < 5; i++) rectBox(ghost.group, fp, g0 + (g1 - g0) * (i + 0.5) / 5 - 0.1, 0.2, 'ghost', '_ghost', null, 'ghostEdge');
  ghost.chip = label(ghost.group, H.GUEST_FLOORS.label, 'map-floor ghost', fp[0] - 1.5, (g0 + g1) / 2, fp[3], [1, 0.5]);
  scene.add(ghost.group);

  // the lift shaft: stretched each frame between the lowest and highest floor in view
  const core = H.LIFT_CORE;
  shaft = new THREE.Mesh(new THREE.BoxGeometry(core[2] - core[0], 1, core[3] - core[1]), mat('shaft', null, null));
  shaft.position.set((core[0] + core[2]) / 2, 0, (core[1] + core[3]) / 2);
  scene.add(shaft);

  controls = new OrbitControls(camera, host);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.7;
  controls.minDistance = 30; controls.maxDistance = 320;
  controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.32;
  controls.addEventListener('start', () => { camTween = null; framing = null; host.classList.add('touched'); });

  new ResizeObserver(resize).observe(host);
  requestAnimationFrame(tick);
}

function paintShadow() {
  const t = shadow.material.map, c = t.image, x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, PAL[theme].shadow); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  t.needsUpdate = true;
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // the panel widens as it opens: keep the view fitted until the visitor turns or zooms the map
  if (framing) frame(framing, true);
}

/* ---------------- Layout & camera ---------------- */

// overview: every floor at its own height, guest floors ghosted. route: only its floors, spread apart.
function layout(routeFloors) {
  const on = routeFloors ? routeFloors.slice().sort((a, b) => H.floor(a).level - H.floor(b).level) : null;
  H.FLOORS.forEach((f) => {
    const F = floors[f.id], i = on ? on.indexOf(f.id) : -1;
    if (!on) { F.toY = H.floorY(f.id); F.toDim = f.guest ? 0 : 1; }
    else if (i >= 0) { F.toY = i * ROUTE_GAP; F.toDim = 1; }
    else F.toDim = 0;
  });
  ghost.toDim = on ? 0 : 1;
}

function frame(points, refit) {
  framing = points;
  const b = new THREE.Box3();
  points.forEach((p) => b.expandByPoint(p));
  const centre = b.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL));
  // Closest distance at which every point still projects inside the panel, then nudge the target
  // so the picture sits in the middle (a box's centre isn't its centre on screen at an angle).
  const probe = camera.clone(), v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const place = (d) => { probe.position.copy(centre).addScaledVector(dir, d); probe.lookAt(centre); probe.updateMatrixWorld(); probe.updateProjectionMatrix(); };
  const fits = (d) => { place(d); return points.every((p) => { v.copy(p).project(probe); return Math.abs(v.x) <= 0.9 && Math.abs(v.y) <= 0.86 && v.z < 1; }); };
  let dist = 100;
  for (let pass = 0; pass < 3; pass++) {
    let lo = 10, hi = 900;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    dist = hi; place(dist);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    points.forEach((p) => { v.copy(p).project(probe); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
    const h = dist * Math.tan(THREE.MathUtils.degToRad(probe.fov) / 2), w = h * probe.aspect;
    right.setFromMatrixColumn(probe.matrixWorld, 0); up.setFromMatrixColumn(probe.matrixWorld, 1);
    centre.addScaledVector(right, (x0 + x1) / 2 * w).addScaledVector(up, (y0 + y1) / 2 * h);
  }
  const pos = centre.clone().addScaledVector(dir, dist);
  if (refit && camTween) { camTween.toP = pos; camTween.toT = centre; return; }
  if (refit) { camera.position.copy(pos); controls.target.copy(centre); return; }
  camTween = { t0: performance.now(), dur: 1100, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: pos, toT: centre };
}

function footprintPoints(ys) {
  const fp = H.FOOTPRINT, pts = [];
  // the floor names sit just left of each floor's front corner — keep them in the frame too
  ys.forEach((y) => { pts.push(new THREE.Vector3(fp[0] - 22, y, fp[3]), new THREE.Vector3(fp[2], y + 3, fp[1]), new THREE.Vector3(fp[2], y, fp[3])); });
  return pts;
}

/* ---------------- Route ---------------- */

function local(nodeId) { const n = H.NODES[nodeId]; return new THREE.Vector3(n[1], 0.45, n[2]); }
function world(nodeId) { const v = local(nodeId); v.y += floors[H.NODES[nodeId][0]].toY; return v; }

// CSS2DObject only removes its element when it is removed itself, not when its group is — drop label elements here
function disposeTree(o) { o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); if (x.isCSS2DObject) x.element.remove(); }); }
function clearRoute() {
  disposeWalker();
  if (walk) { scene.remove(walk.group); disposeTree(walk.group); }
  if (pin) { pin.group.parent.remove(pin.group); disposeTree(pin.group); }
  walk = null; pin = null; destId = null; liftSpan = null; lastStep = -1;
}

function placeHere(kiosk) {
  if (here) { here.group.parent.remove(here.group); disposeTree(here.group); }
  const group = new THREE.Group();
  group.position.copy(local(kiosk.node));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), new THREE.MeshBasicMaterial({ color: PAL[theme].here, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05;
  const r = ring(PAL[theme].here);
  group.add(disc, r);
  label(group, '<i></i>You are here', 'map-here', 0, 0, 0, [0.5, -0.9]);  // under the ring, so the walker stands clear of it
  floors[kiosk.floor].group.add(group);
  here = { group, disc, ring: r };
}

function makePin(place) {
  const group = new THREE.Group();
  group.position.copy(local(place.node));
  const m = new THREE.MeshStandardMaterial({ color: PAL[theme].pin, emissive: PAL[theme].pin, emissiveIntensity: 0.35, roughness: 0.35 });
  const bob = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 24), m);
  cone.rotation.x = Math.PI; cone.position.y = 1.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.05, 28, 20), m);
  head.position.y = 3.1;
  bob.add(cone, head);
  const r = ring(PAL[theme].pin);
  group.add(bob, r);
  label(group, '<img src="' + ICON + place.icon + '.png" alt="">' + place.name, 'map-label dest', 0, 6.2, 0);
  floors[place.floor].group.add(group);
  pin = { group, bob, ring: r, mat: m };
}

// The walker: a little person in Kira purple with a light outline, so it stands out on either theme.
// The frame loop sizes it by the camera's distance, so it stays about the same size on screen however
// far out the map is framed. Arms and legs hang from pivots at the shoulders and hips; it faces +z
// until the frame loop turns it.
function makeWalker() {
  const M = (color, roughness) => new THREE.MeshStandardMaterial({ color, roughness });
  const skin = M(0xe2a882, 0.6), top = M(0xa36bff, 0.45), trousers = M(0x3b2f5c, 0.7), hair = M(0x2a1c16, 0.8), dark = M(0x1b1720, 0.5);
  const person = new THREE.Group(), body = new THREE.Group();
  person.add(body);
  const limb = (r, len, m, x, y, hand) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m);
    mesh.position.y = 0.05 - (len / 2 + r);
    pivot.add(mesh);
    if (hand) { const h = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 12, 10), skin); h.position.y = -(len + r * 1.6); pivot.add(h); }
    body.add(pivot);
    return pivot;
  };
  const legL = limb(0.21, 0.95, trousers, -0.22, 1.42), legR = limb(0.21, 0.95, trousers, 0.22, 1.42);
  const armL = limb(0.13, 0.7, top, -0.56, 2.58, true), armR = limb(0.13, 0.7, top, 0.56, 2.58, true);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.62, 6, 16), top);
  torso.position.y = 2.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 18), skin);
  head.position.y = 3.02;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.385, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.set(0, 3.05, -0.04); cap.rotation.x = -0.3;
  const eyes = [-0.12, 0.12].map((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), dark); e.position.set(x, 3.05, 0.32); return e; });
  body.add(torso, head, cap, ...eyes);
  // outline: each body part again, a little bigger, back faces only
  const line = new THREE.MeshBasicMaterial({ color: PAL[theme].outline, side: THREE.BackSide });
  const parts = [];
  body.traverse((o) => { if (o.isMesh && o.geometry.type !== 'SphereGeometry' || o === head || o === cap) parts.push(o); });
  parts.forEach((o) => { const h = new THREE.Mesh(o.geometry, line); h.scale.setScalar(o === head || o === cap ? 1.14 : 1.2); o.add(h); });
  // a soft glow ring under the feet, so it's easy to spot
  const glow = ring(PAL[theme].glow);
  glow.position.y = 0.06;
  person.add(glow);
  person.visible = false;
  return { person, body, legL, legR, armL, armR, glow, line, yaw: 0, amp: 0 };
}

function disposeWalker() {
  if (!walk) return;
  overlay.remove(walk.walker.person); disposeTree(walk.walker.person);
}

const STRIDE = 2.4, WALK_SPEED = 6, PAUSE = 1600;  // map units per stride, units a second, ms at the destination

// Stand the walker at a point along the route (0–1), turned the way it's going, legs swinging while it walks.
function poseWalker(u, walking, dt, snap) {
  const W = walk.walker, p = walk.path.getPointAt(u), tan = walk.path.getTangentAt(u);
  W.person.position.set(p.x, p.y - 0.45, p.z);
  if (Math.hypot(tan.x, tan.z) > 0.3) {
    const want = Math.atan2(tan.x, tan.z);
    let d = want - W.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    W.yaw += snap ? d : d * Math.min(1, dt / 90);
  } else walking = false;  // riding the lift
  W.person.rotation.y = W.yaw;
  W.amp += ((walking ? 0.6 : 0) - W.amp) * Math.min(1, dt / 120);
  const ph = (u * walk.total / STRIDE) * Math.PI * 2, s = Math.sin(ph);
  W.legL.rotation.x = s * W.amp; W.legR.rotation.x = -s * W.amp;
  W.armL.rotation.x = -s * W.amp * 0.8; W.armR.rotation.x = s * W.amp * 0.8;
  W.body.position.y = Math.abs(Math.cos(ph)) * 0.12 * (W.amp / 0.6);
}

function show(route) {
  if (!host) build();
  clearRoute();
  host.classList.remove('touched');
  if (!route) { overview(); return; }
  layout(route.floors);
  EL = route.floors.length > 1 ? 0.52 : 0.82;
  placeHere(route.from);
  destId = route.place.id;

  // points along the legs, at the floors' new heights; a lift ride goes into the shaft, up, and out
  const pts = [], legStart = [];
  const push = (v) => { const last = pts[pts.length - 1]; if (!last || last.distanceTo(v) > 0.01) pts.push(v); };
  route.legs.forEach((leg) => {
    legStart.push(pts.length ? pts.length - 1 : 0);
    if (leg.type === 'walk') leg.nodes.forEach((n) => push(world(n)));
    else {
      const a = floors[leg.floor].toY + 0.45, b = floors[leg.toFloor].toY + 0.45;
      push(new THREE.Vector3(0, a, LIFT_Z_DOOR)); push(new THREE.Vector3(0, a, LIFT_Z_SHAFT));
      push(new THREE.Vector3(0, b, LIFT_Z_SHAFT)); push(new THREE.Vector3(0, b, LIFT_Z_DOOR));
      liftSpan = [leg.floor, leg.toFloor];
    }
  });
  const path = new THREE.CurvePath();
  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
  const total = path.getLength();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const legFrac = legStart.map((i) => cum[i] / total);  // where each step starts along the line

  const seg = Math.min(900, Math.max(80, Math.round(total * 4))), radial = 10;
  const core = new THREE.Mesh(new THREE.TubeGeometry(path, seg, 0.32, radial, false), new THREE.MeshBasicMaterial({ color: PAL[theme].route }));
  const glow = new THREE.Mesh(new THREE.TubeGeometry(path, seg, 0.85, radial, false),
    new THREE.MeshBasicMaterial({ color: PAL[theme].glow, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.renderOrder = 5;
  const group = new THREE.Group();
  group.add(core, glow);
  scene.add(group);
  [core, glow].forEach((m) => m.geometry.setDrawRange(0, 0));
  const walker = makeWalker();
  overlay.add(walker.person);
  makePin(route.place);

  // labels: the other places on the destination's floor, the lifts on the floor you start from, and your own room
  areaLabels.forEach((l) => {
    l.on = l.place === 'myroom' || (l.place !== destId && (l.place === 'lifts' ? !!liftSpan && l.floor === route.from.floor : l.floor === route.place.floor));
  });

  const top = (nodeId, h) => world(nodeId).add(new THREE.Vector3(0, h, 0));
  frame(footprintPoints(route.floors.map((f) => floors[f].toY)).concat(pts, [top(route.place.node, 8), top(route.from.node, 3.5)]));
  walk = {
    group, path, total, seg, radial, core, glow, walker, legFrac, cycle: -1,
    t0: performance.now() + 1000,                                       // let the floors and camera settle first
    draw: Math.min(3600, Math.max(1500, total * 34)),                   // ms to draw the whole line
    loop: Math.min(16000, Math.max(4000, total / WALK_SPEED * 1000))    // ms for the walker to walk it
  };
}

function replay() { if (walk) { walk.t0 = performance.now() + 150; walk.cycle = -1; lastStep = -1; walk.walker.person.visible = false; } }

function overview(kiosk) {
  if (!host) build();
  clearRoute();
  layout(null);
  EL = 0.52;
  if (kiosk) placeHere(kiosk);
  areaLabels.forEach((l) => { l.on = false; });
  frame(footprintPoints([0, H.floorY('L8')]));
}

/* ---------------- Theme ---------------- */

function setTheme(light) {
  theme = light ? 'light' : 'dark';
  if (!host) return;
  reg.forEach((r) => { r.isDest = null; });  // recoloured on the next frame
  paintShadow();
  if (here) { here.disc.material.color.setHex(PAL[theme].here); here.ring.material.color.setHex(PAL[theme].here); }
  if (pin) { pin.mat.color.setHex(PAL[theme].pin); pin.mat.emissive.setHex(PAL[theme].pin); pin.ring.material.color.setHex(PAL[theme].pin); }
  if (walk) { walk.core.material.color.setHex(PAL[theme].route); walk.glow.material.color.setHex(PAL[theme].glow); walk.walker.glow.material.color.setHex(PAL[theme].glow); walk.walker.line.color.setHex(PAL[theme].outline); }
}

/* ---------------- Frame loop ---------------- */

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let lastNow = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (!host.isConnected || !host.clientWidth) return;
  // time-based easing, so floors settle in about a second at any frame rate
  const dt = Math.min(500, now - (lastNow || now)), k = 1 - Math.exp(-dt / 180);
  lastNow = now;

  if (camTween) {
    const c = ease(Math.min(1, (now - camTween.t0) / camTween.dur));
    camera.position.lerpVectors(camTween.fromP, camTween.toP, c);
    controls.target.lerpVectors(camTween.fromT, camTween.toT, c);
    if (c >= 1) camTween = null;
  }
  controls.update();

  // floors glide to their heights and fade in or out
  let lo = Infinity, hi = -Infinity;
  Object.keys(floors).forEach((id) => {
    const F = floors[id];
    F.y += (F.toY - F.y) * k; F.dim += (F.toDim - F.dim) * k;
    F.group.position.y = F.y;
    F.group.visible = F.dim > 0.02;
    F.chip.visible = F.dim > 0.5;
    if (F.toDim > 0.5) { lo = Math.min(lo, F.y); hi = Math.max(hi, F.y); }
  });
  ghost.dim += (ghost.toDim - ghost.dim) * k;
  ghost.group.visible = ghost.dim > 0.02; ghost.chip.visible = ghost.dim > 0.5;
  if (liftSpan || !walk) {
    const a = liftSpan ? Math.min(floors[liftSpan[0]].y, floors[liftSpan[1]].y) : lo, b = liftSpan ? Math.max(floors[liftSpan[0]].y, floors[liftSpan[1]].y) : hi;
    shaft.visible = b - a > 1;
    shaft.scale.y = b - a + 2.6; shaft.position.y = (a + b + 2.6) / 2;
  } else shaft.visible = false;
  shadow.position.y = lo - 1.2;

  const pulse = 0.5 + 0.5 * Math.sin(now / 420);
  reg.forEach((r) => {
    const isDest = r.role === 'room' && !!r.area && r.area === destId;
    const role = isDest ? 'dest' : r.role;
    const dim = r.floor === '_ghost' ? ghost.dim : r.floor ? floors[r.floor].dim : 1;
    r.m.opacity = PAL[theme][role][1] * (isDest ? 0.75 + 0.25 * pulse : 1) * dim;
    if (r.isDest !== isDest) { r.m.color.setHex(PAL[theme][role][0]); r.isDest = isDest; }
    if (r.m.emissive) { r.m.emissive.setHex(isDest ? PAL[theme].pin : 0x000000); r.m.emissiveIntensity = isDest ? 0.25 + 0.25 * pulse : 0; }
  });
  areaLabels.forEach((l) => { l.obj.visible = l.on && floors[l.floor].dim > 0.5; });

  // "You are here" ring and the destination pin
  const k1 = (now % 1600) / 1600;
  if (here) { here.ring.scale.setScalar(1 + k1 * 2.2); here.ring.material.opacity = 0.85 * (1 - k1); }
  if (pin) {
    pin.bob.position.y = Math.sin(now / 380) * 0.35;
    const k2 = ((now + 800) % 1600) / 1600; pin.ring.scale.setScalar(1 + k2 * 2.6); pin.ring.material.opacity = 0.8 * (1 - k2);
  }

  // route: the line grows while the walker waits at the start, then it walks the line, pauses at the
  // destination, and pops back to the start to go again
  if (walk) {
    const t = now - walk.t0, W = walk.walker;
    const frac = t < 0 ? 0 : t < walk.draw ? ease(t / walk.draw) : 1;
    const n = Math.floor(frac * walk.seg) * walk.radial * 6;
    walk.core.geometry.setDrawRange(0, n); walk.glow.geometry.setDrawRange(0, n);
    if (t >= 0) {
      const lap = walk.loop + PAUSE, c = t < walk.draw ? -1 : (t - walk.draw) % lap, cycle = t < walk.draw ? -1 : Math.floor((t - walk.draw) / lap);
      const tip = c < 0 ? 0 : Math.min(1, c / walk.loop);
      const snap = cycle !== walk.cycle;
      walk.cycle = cycle;
      poseWalker(Math.min(0.9999, tip), c >= 0 && c < walk.loop, dt, snap || !W.person.visible);
      const pop = c < 0 ? Math.min(1, t / 300) : cycle > 0 && c < 300 ? c / 300 : c > lap - 300 ? (lap - c) / 300 : 1;
      const size = THREE.MathUtils.clamp(camera.position.distanceTo(W.person.position) * 0.0115, 1.1, 3.2);
      W.person.scale.setScalar(size * Math.max(0.001, ease(pop)));
      W.person.visible = true;
      const k3 = (now % 1400) / 1400;
      W.glow.scale.setScalar(0.8 + k3 * 1.2); W.glow.material.opacity = 0.7 * (1 - k3);
      let step = 0;
      walk.legFrac.forEach((f, i) => { if (tip >= f - 1e-6) step = i; });
      if (step !== lastStep) { lastStep = step; if (onStep) onStep(step); }
    }
  }

  renderer.autoClear = true;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay, camera);
  labels.render(scene, camera);
}

/* ---------------- API ---------------- */

window.KiraMap = {
  attach(slot) {
    if (!host) { build(); layout(null); frame(footprintPoints([0, H.floorY('L8')]), true); }
    if (host.parentNode !== slot) slot.appendChild(host);
    resize();
  },
  show, overview, replay, setTheme,
  set onStep(fn) { onStep = fn; }
};
window.dispatchEvent(new Event('kira-map-ready'));
