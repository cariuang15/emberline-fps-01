// Emberline — Kestrel Yard: boot, input and the game loop. The loop runs the
// simulation at a fixed 60 Hz step, apart from rendering, and the HUD and the
// renderer read the same state object the simulation writes.
//
// ?shot=start|combat|buy|end&seed=N stages a deterministic scene for
// screenshots: the same seed plays the same way every time.

import { createSim, startMatch, startRound, stepSim, buyItem, SIM_DT } from './sim.js';
import { createView } from './render.js';
import { createHud } from './hud.js';
import { initAudio, toggleMute } from './audio.js';
import { currentSpread } from './weapons.js';
import { WEAPONS } from './weapons.js';
import { giveWeapon } from './fighters.js';
import { clamp } from './util.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 7);
const shot = params.get('shot');

const sim = createSim(seed);
const view = createView(document.getElementById('game'), sim);
const input = {
  mx: 0, mz: 0,
  fire: false, firePressed: false,
  reload: false, jump: false, crouch: false, walk: false, aim: false,
  throwKind: null, use: false, slot: 0,
  buyOpen: false, scoreboard: false,
};
sim.input = input;
const hud = createHud({
  onPlay: () => {
    initAudio();
    if (sim.phase === 'menu') startMatch(sim);
    lockPointer();
  },
  onBuy: (key) => buyItem(sim, key),
  onRestart: () => {
    initAudio();
    startMatch(sim);
    lockPointer();
  },
  onMute: () => {
    const muted = toggleMute();
    document.getElementById('mute-btn').textContent = muted ? 'Sound: off' : 'Sound: on';
  },
});

// ---------------------------------------------------------------- input

const keys = new Set();
let locked = false;
let dragging = false;

function lockPointer() {
  const el = view.renderer.domElement;
  try {
    const p = el.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* drag-look fallback below */ });
  } catch {
    /* drag-look fallback below */
  }
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === view.renderer.domElement;
});

view.renderer.domElement.addEventListener('click', () => {
  initAudio();
  if (sim.phase !== 'menu') lockPointer();
});

document.addEventListener('mousemove', (e) => {
  if (sim.phase === 'menu') return;
  const dx = e.movementX || 0;
  const dy = e.movementY || 0;
  if (locked || dragging) {
    const p = sim.player;
    p.yaw -= dx * 0.0021;
    p.pitch = clamp(p.pitch - dy * 0.0021, -1.45, 1.45);
  }
});

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.overlay') || e.target.closest('button')) return;
  initAudio();
  if (e.button === 0) {
    if (sim.phase === 'menu') return;
    input.fire = true;
    input.firePressed = true;
    dragging = true;
    if (!locked) lockPointer();
  } else if (e.button === 2) {
    input.aim = true;
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    input.fire = false;
    dragging = false;
  } else if (e.button === 2) {
    input.aim = false;
  }
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) {
    if (e.code === 'Tab') input.scoreboard = true;
    return;
  }
  keys.add(e.code);
  switch (e.code) {
    case 'KeyR': input.reload = true; break;
    case 'KeyG':
      input.throwKind = sim.player.grenades.frag > 0 ? 'frag' : sim.player.grenades.smoke > 0 ? 'smoke' : null;
      break;
    case 'Digit1': case 'Digit2': case 'Digit3':
    case 'Digit4': case 'Digit5': case 'Digit6': {
      const n = Number(e.code.slice(-1));
      // With the buy menu open, number keys buy; otherwise they swap weapons.
      if (input.buyOpen && sim.phase === 'buy') buyItem(sim, String(n));
      else if (n <= 3) input.slot = n;
      break;
    }
    case 'KeyB':
      if (sim.phase === 'buy') input.buyOpen = !input.buyOpen;
      break;
    case 'KeyM': {
      const muted = toggleMute();
      document.getElementById('mute-btn').textContent = muted ? 'Sound: off' : 'Sound: on';
      break;
    }
    case 'Tab': input.scoreboard = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') input.scoreboard = false;
});

window.addEventListener('resize', () => view.resize());

/** Camera-relative wish direction from the held keys, in world x/z. */
function moveWish() {
  const p = sim.player;
  const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
  const rgtX = Math.cos(p.yaw), rgtZ = -Math.sin(p.yaw);
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let mx = fwdX * f + rgtX * r;
  let mz = fwdZ * f + rgtZ * r;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  return { mx, mz };
}

// ---------------------------------------------------------------- shot staging

function stageShot(name) {
  const s = sim;
  if (name === 'start') {
    // Menu over the yard at dawn: the player stands at spawn, looking east.
    s.player.pos.x = -29;
    s.player.pos.z = 18;
    s.player.yaw = -Math.PI / 2;
    s.player.pitch = 0;
    return;
  }
  startMatch(s);
  if (name === 'buy') {
    s.player.money = 2400;
    input.buyOpen = true;
    s.timer = 11;
    return;
  }
  if (name === 'end') {
    // Round 6 just ended: Vanguard 3 — Sentinel 2, the spike blew at Foundry.
    s.score.vanguard = 3;
    s.score.sentinel = 2;
    s.round = 6;
    s.phase = 'roundEnd';
    s.phaseT = 0.5;
    s.winner = 0;
    s.winReason = 'the spike detonated';
    s.spike.planted = true;
    s.spike.site = 'A';
    s.spike.pos.x = -26;
    s.spike.pos.z = -8;
    s.player.pos.x = -18;
    s.player.pos.z = -2;
    s.player.yaw = Math.atan2(8, 6); // face the site at (-26, -8)
    s.player.pitch = -0.05;
    return;
  }
  // 'combat': mid-round, mid-map, a Sentinel in the open ahead, tracer in
  // flight. The defenders are slow to react here so the player is still
  // standing when the shutter falls.
  s.phase = 'live';
  s.timer = 62;
  s.score.vanguard = 1;
  s.score.sentinel = 1;
  s.round = 3;
  const p = s.player;
  p.pos.x = -8;
  p.pos.z = 2;
  // Aim straight at the first defender: direction (18, -5) from the player.
  p.yaw = Math.atan2(-18, 5);
  p.pitch = -0.02;
  giveWeapon(p, WEAPONS.rifle); // staged with the rifle
  const foes = s.fighters.filter((f) => f.team === 1);
  foes[0].pos.x = 10;
  foes[0].pos.z = -3;
  foes[0].bot.target = p;
  foes[0].bot.aimT = 0.3;
  foes[0].bot.reactionT = 1.5;
  foes[0].bot.burstLeft = 0;
  foes[1].pos.x = 14;
  foes[1].pos.z = 5;
  foes[1].bot.target = null; // walks its route, not engaging yet
  // The player holds the trigger for the whole scene, so a tracer is in
  // flight whenever the shutter falls.
  input.fire = true;
}

if (shot) stageShot(shot);

// ---------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;

  // Per-frame input, from the held keys.
  const wish = moveWish();
  input.mx = wish.mx;
  input.mz = wish.mz;
  input.crouch = keys.has('KeyC') || keys.has('ControlLeft');
  input.walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.jump = keys.has('Space');
  input.use = keys.has('KeyE');

  // Fixed-step simulation, at most 5 steps a frame.
  let steps = 0;
  while (acc >= SIM_DT && steps < 5) {
    stepSim(sim, input, SIM_DT);
    acc -= SIM_DT;
    steps++;
  }
  if (steps === 5) acc = 0;

  // One-frame inputs are consumed by the step above.
  input.firePressed = false;
  input.reload = false;
  input.slot = 0;
  input.throwKind = null;

  const spreadPx = currentSpread(sim.player, input.aim) * 1400;
  hud.update(sim, input, spreadPx, sim.time);
  view.render(sim, dt);
}

requestAnimationFrame(frame);

// Test hook: the state, for scripted play-tests and screenshots.
window.__emberline = { sim, version: 'emberline-1.0' };
