// The renderer: three.js scene, built once from the map, then synced from the
// simulation state every frame. No per-frame allocations: tracers, particles
// and smoke come from fixed pools, and all scratch vectors are module-level.

import * as THREE from 'three';
import { BOXES, MAP, SITES } from './world.js';
import { TEAM_COLORS } from './fighters.js';
import { eyeHeight } from './fighters.js';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpColor = new THREE.Color();

const TRACER_POOL = 24;
const PARTICLE_POOL = 256;
const SMOKE_POOL = 8;

/** A canvas texture with a name tag for a fighter. */
function nameTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 8;
  g.fillStyle = color;
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The yard's ground: asphalt with lane lines, site circles and hazard marks. */
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 768;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3136';
  g.fillRect(0, 0, 1024, 768);
  // Concrete patches.
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 1024, y = Math.random() * 768;
    g.fillStyle = `rgba(${20 + Math.random() * 30 | 0},${22 + Math.random() * 30 | 0},${26 + Math.random() * 30 | 0},0.5)`;
    g.fillRect(x, y, 4 + Math.random() * 22, 4 + Math.random() * 22);
  }
  const toPx = (x, z) => [((x - MAP.x0) / (MAP.x1 - MAP.x0)) * 1024, ((z - MAP.z0) / (MAP.z1 - MAP.z0)) * 768];
  // Lane dashes.
  g.strokeStyle = 'rgba(220,200,120,0.55)';
  g.lineWidth = 4;
  g.setLineDash([26, 22]);
  for (const z of [-18, 0, 18]) {
    const [x0, y0] = toPx(-31, z);
    const [x1, y1] = toPx(31, z);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.setLineDash([]);
  // Site circles and letters.
  for (const site of SITES) {
    const [cx, cy] = toPx(site.x, site.z);
    const r = (site.r / 64) * 1024;
    g.strokeStyle = 'rgba(240,168,48,0.9)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(240,168,48,0.85)';
    g.font = '700 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(site.id, cx, cy);
  }
  // Hazard stripes at the yard gates.
  g.fillStyle = 'rgba(240,168,48,0.35)';
  for (const [gx, gz] of [[-31, 0], [31, 0]]) {
    const [x, y] = toPx(gx, gz);
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    for (let i = -3; i < 4; i++) g.fillRect(i * 18, -60, 9, 120);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createView(container, s) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd98a4e, 55, 130);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 400);

  // Dusk sky dome.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x27364f) },
      mid: { value: new THREE.Color(0xd98a4e) },
      low: { value: new THREE.Color(0x3a2a22) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(low, mid, smoothstep(-0.08, 0.12, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(180, 24, 16), skyMat));

  // Lights: warm low sun + cool sky fill.
  const sun = new THREE.DirectionalLight(0xffc98a, 3.4);
  sun.position.set(-40, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x7fa8c9, 0x3a2f26, 1.15));

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.x1 - MAP.x0, MAP.z1 - MAP.z0),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.94, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Map boxes.
  const boxGeoCache = new Map();
  function boxGeometry(w, h, d) {
    const key = `${w}|${h}|${d}`;
    let g = boxGeoCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      boxGeoCache.set(key, g);
    }
    return g;
  }
  const matCache = new Map();
  function boxMaterial(color) {
    let m = matCache.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.18 });
      matCache.set(color, m);
    }
    return m;
  }
  for (const b of BOXES) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
    const mesh = new THREE.Mesh(boxGeometry(w, h, d), boxMaterial(b.color));
    mesh.position.set((b.x0 + b.x1) / 2, b.y0 + h / 2, (b.z0 + b.z1) / 2);
    mesh.castShadow = h > 1.5;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Painted edge stripe on tall containers so lanes read at a glance.
    if (b.kind === 'container') {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.04, 0.18, d + 0.04),
        new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.6, metalness: 0.2 }),
      );
      stripe.position.set(mesh.position.x, b.y0 + h - 0.35, mesh.position.z);
      scene.add(stripe);
    }
  }

  // Site rings, pulsed every frame from this list (no scene traversal).
  const siteRings = [];
  for (const site of SITES) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 18),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.55, metalness: 0.5 }));
    silo.position.set(site.x, 3, site.z);
    silo.castShadow = true;
    scene.add(silo);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65, 1.65, 0.3, 18),
      new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.3 }),
    );
    cap.position.set(site.x, 6.1, site.z);
    scene.add(cap);
    // Site ring on the ground, pulsing.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    siteRings.push(ring);
    scene.add(ring);
  }

  // Distant city silhouettes beyond the walls.
  const cityMat = new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 78 + (i % 5) * 7;
    const h = 14 + ((i * 37) % 26);
    const b = new THREE.Mesh(new THREE.BoxGeometry(8 + (i % 3) * 4, h, 8), cityMat);
    b.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    scene.add(b);
  }

  // --- fighters ---
  const fighterMeshes = new Map();
  function makeFighterMesh(f) {
    const group = new THREE.Group();
    const color = TEAM_COLORS[f.team];
    const suit = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.75, metalness: 0.25 });
    const accent = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.2,
      emissive: color,
      emissiveIntensity: 0.55,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.95, 4, 10), suit);
    body.position.y = 0.92;
    body.castShadow = true;
    group.add(body);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.12), accent);
    chest.position.set(0, 1.15, 0.3);
    group.add(chest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), suit);
    head.position.y = 1.58;
    head.castShadow = true;
    group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1), accent);
    visor.position.set(0, 1.6, 0.17);
    group.add(visor);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.78), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.6 }));
    gun.position.set(0.22, 1.18, 0.42);
    group.add(gun);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nameTexture(f.name, f.team === 0 ? '#7fe8de' : '#ffd28a'),
      transparent: true,
      depthWrite: false,
    }));
    tag.scale.set(1.7, 0.42, 1);
    tag.position.y = 2.15;
    group.add(tag);
    group.userData = { body, head, gun, tag, suit, accent };
    // The player's own mesh is never synced (the render loop skips it) and
    // would otherwise sit at the world origin, visible mid-map. Hide it.
    if (f.isPlayer) group.visible = false;
    scene.add(group);
    fighterMeshes.set(f.id, group);
    return group;
  }
  for (const f of s.fighters) makeFighterMesh(f);

  // --- viewmodel gun (first person) ---
  const viewGun = new THREE.Group();
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.45, metalness: 0.65 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), gunMetal);
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMetal);
  gunBarrel.position.set(0, 0.02, -0.42);
  const gunAccent = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.025, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x2a8f88, roughness: 0.4, metalness: 0.3, emissive: 0x2a8f88, emissiveIntensity: 0.12 }),
  );
  gunAccent.position.set(0, 0.07, -0.08);
  viewGun.add(gunBody, gunBarrel, gunAccent);
  viewGun.scale.setScalar(0.62);
  viewGun.position.set(0.25, -0.23, -0.55);
  camera.add(viewGun);
  scene.add(camera);

  // --- spike ---
  const spike = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.4, metalness: 0.4, emissive: 0xf0a830, emissiveIntensity: 0.9 }),
  );
  spike.visible = false;
  scene.add(spike);
  const spikeLight = new THREE.PointLight(0xf0a830, 0, 9);
  scene.add(spikeLight);

  // --- tracers (pooled lines) ---
  const tracerLines = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracerLines.push(line);
  }

  // --- particles (pooled points) ---
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_POOL * 3);
  const pCol = new Float32Array(PARTICLE_POOL * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);

  // --- smoke (pooled translucent spheres) ---
  const smokeMeshes = [];
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  for (let i = 0; i < SMOKE_POOL; i++) {
    const m = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({
      color: 0xd8dde2, transparent: true, opacity: 0.32, depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    smokeMeshes.push(m);
  }

  // --- muzzle flash light ---
  const flashLight = new THREE.PointLight(0xffd27a, 0, 14);
  scene.add(flashLight);

  function syncFighter(f, now) {
    const g = fighterMeshes.get(f.id);
    if (!g) return;
    // First person: the player's own body and name tag must never be visible
    // — the camera sits inside the body, and the tag would float in the
    // middle of the screen.
    if (f.isPlayer) {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (!f.alive) {
      // Fallen body: lying on its side, sinking slightly.
      g.position.set(f.pos.x, 0.22, f.pos.z);
      g.rotation.set(0, f.yaw, Math.PI / 2);
      g.scale.set(1, 0.72, 1);
      g.userData.tag.visible = false;
      return;
    }
    g.userData.tag.visible = true;
    g.position.set(f.pos.x, f.pos.y, f.pos.z);
    // The model's gun points down +z; at yaw 0 the fighter faces -z.
    g.rotation.set(0, f.yaw + Math.PI, 0);
    g.scale.set(1, f.crouch ? 0.72 : 1, 1);
    // Aim the head with the pitch.
    g.userData.head.rotation.x = 0;
    g.userData.gun.rotation.x = -f.pitch * 0.6;
  }

  function render(state, dt) {
    const p = state.player;
    // Camera: the player's eye, or a teammate's when spectating.
    let eye = null;
    if (!p.alive) {
      const mate = state.fighters.find((f) => f.team === p.team && f.alive && !f.isPlayer);
      if (mate) {
        eye = { x: mate.pos.x, y: mate.pos.y + eyeHeight(mate), z: mate.pos.z, yaw: mate.yaw, pitch: mate.pitch };
      }
    }
    if (!eye) {
      eye = { x: p.pos.x, y: p.pos.y + eyeHeight(p), z: p.pos.z, yaw: p.yaw, pitch: p.pitch };
    }
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(eye.yaw);
    camera.rotateX(eye.pitch);
    // Camera shake from explosions.
    if (state.shake > 0.01) {
      const sh = state.shake * 0.12;
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
      camera.rotation.z += (Math.random() - 0.5) * sh * 0.1;
    }
    // Zoom for the sniper scope.
    const w = p.weapons[p.weapon];
    const aiming = state.input && state.input.aim && w.def.zoom > 1;
    camera.fov += ((aiming ? 74 / w.def.zoom : 74) - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();

    // Viewmodel: bob with movement, kick back on fire.
    const moving = p.moving && p.alive;
    const bobT = state.time * (p.crouch ? 5 : 9);
    viewGun.position.set(
      0.25 + (moving ? Math.sin(bobT) * 0.012 : 0),
      -0.23 + (moving ? Math.abs(Math.cos(bobT)) * 0.014 : 0),
      -0.55 + (p.flashT > 0.18 ? 0.09 : 0),
    );
    viewGun.visible = p.alive;

    for (const f of state.fighters) {
      if (f.isPlayer) continue;
      syncFighter(f, state.time);
    }

    // Tracers.
    for (let i = 0; i < TRACER_POOL; i++) {
      const line = tracerLines[i];
      const t = state.tracers[i];
      if (!t) {
        line.material.opacity = 0;
        continue;
      }
      const pos = line.geometry.attributes.position.array;
      pos[0] = t.a.x; pos[1] = t.a.y; pos[2] = t.a.z;
      pos[3] = t.b.x; pos[4] = t.b.y; pos[5] = t.b.z;
      line.geometry.attributes.position.needsUpdate = true;
      line.material.color.setHex(t.color);
      line.material.opacity = Math.max(0, 1 - t.t / t.life) * 0.9;
    }

    // Particles.
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const pt = state.particles[i];
      if (!pt) {
        pPos[i * 3 + 1] = -100;
        continue;
      }
      pPos[i * 3] = pt.x;
      pPos[i * 3 + 1] = pt.y;
      pPos[i * 3 + 2] = pt.z;
      tmpColor.setHex(pt.color);
      const fade = 1 - pt.life / pt.max;
      pCol[i * 3] = tmpColor.r * fade;
      pCol[i * 3 + 1] = tmpColor.g * fade;
      pCol[i * 3 + 2] = tmpColor.b * fade;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // Smoke.
    for (let i = 0; i < SMOKE_POOL; i++) {
      const sm = state.smoke[i];
      const m = smokeMeshes[i];
      if (!sm) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(sm.x, sm.y, sm.z);
      const pulse = 1 + Math.sin(state.time * 1.3 + i) * 0.08;
      m.scale.setScalar(sm.r * pulse);
    }

    // Spike: dropped or planted, blinking.
    const sp = state.spike;
    if (sp.dropped || sp.planted) {
      spike.visible = true;
      spike.position.set(sp.pos.x, 0.14, sp.pos.z);
      spikeLight.position.set(sp.pos.x, 1.2, sp.pos.z);
      const blink = sp.planted ? (Math.sin(state.time * 6) > 0 ? 2.4 : 0.4) : 1.2;
      spikeLight.intensity = blink;
      spike.material.emissiveIntensity = sp.planted ? 1.6 : 0.9;
    } else {
      spike.visible = false;
      spikeLight.intensity = 0;
    }

    // Muzzle flash light at the latest flash.
    const fl = state.flashes[state.flashes.length - 1];
    if (fl && fl.t < 0.05) {
      flashLight.position.set(fl.x, fl.y, fl.z);
      flashLight.intensity = 26 * (1 - fl.t / 0.05);
    } else {
      flashLight.intensity = 0;
    }

    // Site rings pulse.
    const now = state.time;
    for (const ring of siteRings) {
      ring.material.opacity = 0.35 + Math.sin(now * 2) * 0.15;
    }

    renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  return { renderer, scene, camera, render, resize };
}
