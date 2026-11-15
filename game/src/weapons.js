// Weapons and gunfire. Hitscan: one ray per bullet against fighters and the
// world. Spread and recoil punish firing on the move and spraying; stopping
// to aim pays. Grenades are physical: they arc, bounce off boxes, then burst.

import { clamp } from './util.js';
import { BOXES, rayBox, rayWorld } from './world.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9', slot: 1, price: 0, damage: 34, headMul: 2.0,
    rpm: 380, mag: 13, reserve: 52, reload: 1.1, spread: 0.010, moveSpread: 0.022,
    recoil: 0.30, kick: 0.011, auto: false, range: 60, zoom: 1, tracer: 0xd8e6f0,
  },
  smg: {
    id: 'smg', name: 'MP9', slot: 1, price: 900, damage: 26, headMul: 1.8,
    rpm: 780, mag: 30, reserve: 120, reload: 1.9, spread: 0.019, moveSpread: 0.034,
    recoil: 0.22, kick: 0.008, auto: true, range: 45, zoom: 1, tracer: 0xffe08a,
  },
  rifle: {
    id: 'rifle', name: 'VK-47', slot: 1, price: 1700, damage: 33, headMul: 2.0,
    rpm: 600, mag: 25, reserve: 75, reload: 2.2, spread: 0.007, moveSpread: 0.026,
    recoil: 0.42, kick: 0.014, auto: true, range: 80, zoom: 1, tracer: 0xffd27a,
  },
  sniper: {
    id: 'sniper', name: 'Longshot', slot: 1, price: 2600, damage: 95, headMul: 2.0,
    rpm: 48, mag: 5, reserve: 15, reload: 3.4, spread: 0.001, moveSpread: 0.06,
    recoil: 1.6, kick: 0.05, auto: false, range: 120, zoom: 4, tracer: 0xbfe3ff,
  },
};

export const GRENADE_DEFS = {
  frag: { id: 'frag', name: 'Frag grenade', price: 300, radius: 7, damage: 110, fuse: 1.5 },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 250, radius: 0, damage: 0, fuse: 1.2, duration: 12 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 50;

/** A fighter's weapon state: { def, mag, reserve, reloadT, cooldown, spreadBloom }. */
export function makeWeaponState(def) {
  return { def, mag: def.mag, reserve: def.reserve, reloadT: 0, cooldown: 0, bloom: 0 };
}

export function startReload(w) {
  if (w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloadT = w.def.reload;
  return true;
}

export function finishReload(w) {
  const need = w.def.mag - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
}

/** Current spread (radians) for a shot: base + movement + bloom, reduced by aiming. */
export function currentSpread(f, aiming) {
  const w = f.weapons[f.weapon];
  const speed = Math.hypot(f.vel.x, f.vel.z);
  const moving = clamp(speed / 5.4, 0, 1);
  const crouch = f.crouch ? 0.6 : 1;
  let s = w.def.spread + w.def.moveSpread * moving + w.bloom;
  if (aiming) s *= 0.45;
  return s * crouch;
}

/** A fighter's eye position. Writes into `out` ({x,y,z}). */
export function eyeOf(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + (f.crouch ? 1.15 : 1.62);
  out.z = f.pos.z;
  return out;
}

/** Fire one bullet from fighter `f`. Returns a shot record or null when the
 *  weapon cannot fire (cooling down, reloading, empty). The caller resolves
 *  the hit against fighters and the world. `dir` is the aim direction; the
 *  function perturbs it by the current spread using `rng`. */
export function tryFire(f, dir, rng, now, aiming) {
  const w = f.weapons[f.weapon];
  if (w.reloadT > 0 || w.cooldown > 0 || w.mag <= 0) return null;
  w.mag--;
  w.cooldown = 60 / w.def.rpm;
  w.bloom = Math.min(0.05, w.bloom + w.def.recoil * 0.02);
  // Recoil: pitch kick up, small random yaw.
  f.pitch = clamp(f.pitch + w.def.kick * (0.7 + rng() * 0.6), -1.45, 1.45);
  f.yaw += (rng() - 0.5) * w.def.kick * 0.5;
  const spread = currentSpread(f, aiming);
  const dx = dir.x + (rng() - 0.5) * 2 * spread;
  const dy = dir.y + (rng() - 0.5) * 2 * spread;
  const dz = dir.z + (rng() - 0.5) * 2 * spread;
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    origin: { x: f.pos.x, y: f.pos.y + (f.crouch ? 1.15 : 1.62), z: f.pos.z },
    dir: { x: dx / len, y: dy / len, z: dz / len },
    weapon: w.def,
    shooter: f,
    time: now,
  };
}

/** Resolve a shot against fighters and the world. Returns
 *  { hit: 'world'|'fighter'|null, fighter, head, dist, point }. */
export function resolveShot(shot, fighters, smoke) {
  const { origin, dir, weapon, shooter } = shot;
  const maxDist = weapon.range;
  const wallT = rayWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, smoke);
  let best = null;
  let bestT = wallT;
  for (const f of fighters) {
    if (f === shooter || !f.alive) continue;
    // Head: sphere at eye height. Body: AABB around the torso and legs.
    const headY = f.pos.y + (f.crouch ? 0.95 : 1.5);
    const hx = f.pos.x - origin.x, hy = headY - origin.y, hz = f.pos.z - origin.z;
    const proj = hx * dir.x + hy * dir.y + hz * dir.z;
    let headT = Infinity;
    if (proj > 0 && proj < maxDist) {
      const d2 = hx * hx + hy * hy + hz * hz - proj * proj;
      if (d2 < 0.22 * 0.22) headT = proj - Math.sqrt(Math.max(0, 0.0484 - d2));
    }
    const body = {
      x0: f.pos.x - 0.36, x1: f.pos.x + 0.36,
      y0: f.pos.y, y1: f.pos.y + (f.crouch ? 1.2 : 1.8),
      z0: f.pos.z - 0.36, z1: f.pos.z + 0.36,
    };
    const bodyT = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, body, maxDist);
    const t = Math.min(headT, bodyT);
    if (t < bestT) {
      bestT = t;
      best = { fighter: f, head: headT <= bodyT, dist: t };
    }
  }
  if (best) {
    const p = {
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
    };
    return { hit: 'fighter', fighter: best.fighter, head: best.head, dist: bestT, point: p };
  }
  if (wallT !== Infinity) {
    return {
      hit: 'world',
      dist: wallT,
      point: { x: origin.x + dir.x * wallT, y: origin.y + dir.y * wallT, z: origin.z + dir.z * wallT },
    };
  }
  return { hit: null, dist: maxDist, point: { x: origin.x + dir.x * maxDist, y: origin.y + dir.y * maxDist, z: origin.z + dir.z * maxDist } };
}

/** Damage falloff with distance: full to 15 m, half at the weapon's range. */
export function damageAt(def, dist, head) {
  const fall = clamp(1 - (Math.max(0, dist - 15) / Math.max(1, def.range - 15)) * 0.5, 0.5, 1);
  return def.damage * fall * (head ? def.headMul : 1);
}

// ---------------------------------------------------------------- grenades

/** Throw a grenade from a fighter: initial velocity from aim dir + up. */
export function throwGrenade(f, dir, kind) {
  const def = GRENADE_DEFS[kind];
  return {
    kind,
    def,
    owner: f,
    pos: { x: f.pos.x, y: f.pos.y + 1.4, z: f.pos.z },
    vel: { x: dir.x * 13 + f.vel.x * 0.4, y: dir.y * 13 + 4.5, z: dir.z * 13 + f.vel.z * 0.4 },
    fuse: def.fuse,
    bounced: false,
    dead: false,
  };
}

/** Step one grenade: gravity, bounce off boxes and the ground, fuse countdown.
 *  Returns 'burst' when it detonates, else null. Mutates `g`. */
export function stepGrenade(g, dt) {
  if (g.dead) return null;
  g.vel.y -= 14 * dt;
  g.pos.x += g.vel.x * dt;
  g.pos.y += g.vel.y * dt;
  g.pos.z += g.vel.z * dt;
  // Ground bounce.
  if (g.pos.y < 0.12) {
    g.pos.y = 0.12;
    if (Math.abs(g.vel.y) > 1.5) {
      g.vel.y = -g.vel.y * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      g.bounced = true;
    } else {
      g.vel.y = 0;
      g.vel.x *= 0.9;
      g.vel.z *= 0.9;
    }
  }
  // Box bounce: push out along the smallest penetration axis, dampen.
  for (const b of BOXES) {
    if (g.pos.x > b.x0 && g.pos.x < b.x1 && g.pos.y > b.y0 && g.pos.y < b.y1 && g.pos.z > b.z0 && g.pos.z < b.z1) {
      const dxl = g.pos.x - b.x0, dxr = b.x1 - g.pos.x;
      const dyl = g.pos.y - b.y0, dyr = b.y1 - g.pos.y;
      const dzl = g.pos.z - b.z0, dzr = b.z1 - g.pos.z;
      const m = Math.min(dxl, dxr, dyl, dyr, dzl, dzr);
      if (m === dxl) { g.pos.x = b.x0; g.vel.x = -Math.abs(g.vel.x) * 0.45; }
      else if (m === dxr) { g.pos.x = b.x1; g.vel.x = Math.abs(g.vel.x) * 0.45; }
      else if (m === dyl) { g.pos.y = b.y0; g.vel.y = -Math.abs(g.vel.y) * 0.45; }
      else if (m === dyr) { g.pos.y = b.y1; g.vel.y = Math.abs(g.vel.y) * 0.45; }
      else if (m === dzl) { g.pos.z = b.z0; g.vel.z = -Math.abs(g.vel.z) * 0.45; }
      else { g.pos.z = b.z1; g.vel.z = Math.abs(g.vel.z) * 0.45; }
      g.bounced = true;
    }
  }
  g.fuse -= dt;
  if (g.fuse <= 0) {
    g.dead = true;
    return 'burst';
  }
  return null;
}
