// Fighters: the player and the bots share one entity. A fighter is a position
// and a velocity, health and armour, a weapon rack, and (for bots) an AI
// state. All per-fighter numbers live here; the round and the map live in sim.

import { clamp } from './util.js';
import { moveAABB } from './world.js';
import { ARMOR_VALUE, WEAPONS, finishReload, makeWeaponState } from './weapons.js';

export const TEAM_VANGUARD = 0;
export const TEAM_SENTINEL = 1;

export const TEAM_COLORS = {
  [TEAM_VANGUARD]: 0x35d0c5,
  [TEAM_SENTINEL]: 0xf0a830,
};

export const TEAM_NAMES = {
  [TEAM_VANGUARD]: 'Vanguard',
  [TEAM_SENTINEL]: 'Sentinel',
};

let nextId = 1;

/** Reset the id counter so a fresh simulation hands out the same ids every
 *  time — bot behaviour reads f.id (scan sweep phase), so without this two
 *  runs of the same seed would diverge. */
export function resetFighterIds() { nextId = 1; }

export function makeFighter(team, isPlayer, spawn, name) {
  return {
    id: nextId++,
    team,
    isPlayer,
    name,
    alive: true,
    hp: 100,
    armor: 0,
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
    pitch: 0,
    crouch: false,
    onGround: true,
    weapons: [makeWeaponState(WEAPONS.pistol)],
    weapon: 0,
    grenades: { frag: 0, smoke: 0 },
    hasSpike: false,
    money: 800,
    kills: 0,
    deaths: 0,
    // Movement state, read by the HUD and the renderer.
    speed: 0,
    moving: false,
    stepT: 0,
    stepped: false, // set for one step when a footstep lands; the sim plays the sound
    // Combat feedback.
    lastDamageFrom: null,
    lastDamageAt: -99,
    flashT: 0,
    // Bot brain (null for the player).
    bot: null,
    // Last known position for the minimap's "spotted" display.
    spottedAt: -99,
    spottedBy: -1,
  };
}

/** Give a fighter a weapon (buy): adds it to the rack or refills it. */
export function giveWeapon(f, def) {
  const existing = f.weapons.find((w) => w.def.id === def.id);
  if (existing) {
    existing.reserve = def.reserve;
    existing.mag = def.mag;
    return existing;
  }
  const w = makeWeaponState(def);
  f.weapons.push(w);
  f.weapon = f.weapons.length - 1;
  return w;
}

export function buyArmor(f) {
  if (f.money < 650 || f.armor >= ARMOR_VALUE) return false;
  f.money -= 650;
  f.armor = ARMOR_VALUE;
  return true;
}

/** Apply damage, armour absorbing half until it runs out. Returns true on death. */
export function damageFighter(f, amount, from, now) {
  if (!f.alive) return false;
  let left = amount;
  if (f.armor > 0) {
    const absorbed = Math.min(f.armor, left * 0.5);
    f.armor -= absorbed;
    left -= absorbed;
  }
  f.hp -= left;
  f.lastDamageFrom = from;
  f.lastDamageAt = now;
  f.flashT = 0.25;
  if (f.hp <= 0) {
    f.hp = 0;
    f.alive = false;
    f.deaths++;
    if (from) from.kills++;
    return true;
  }
  return false;
}

/** Step one fighter's body: timers, gravity, collision. Movement input is
 *  applied by the caller (player input or bot steering) into f.vel first. */
export function stepFighter(f, dt) {
  // Weapon timers.
  for (const w of f.weapons) {
    if (w.cooldown > 0) w.cooldown -= dt;
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        w.reloadT = 0;
        finishReload(w);
      }
    }
    if (w.bloom > 0) w.bloom = Math.max(0, w.bloom - dt * 0.06);
  }
  if (f.flashT > 0) f.flashT -= dt;
  // Gravity and ground.
  f.vel.y -= 22 * dt;
  const h = f.crouch ? 1.2 : 1.8;
  moveAABB(f.pos, f.vel, dt, 0.36, 0.36, h);
  f.onGround = f.pos.y === 0;
  f.speed = Math.hypot(f.vel.x, f.vel.z);
  f.moving = f.speed > 0.5 && f.onGround;
  if (f.moving) {
    f.stepT -= dt * f.speed;
    if (f.stepT <= 0) {
      f.stepT = 2.2;
      f.stepped = true;
    }
  }
}

/** Desired velocity from a wish direction (unit x/z) and a speed cap. */
export function accelFighter(f, wishX, wishZ, maxSpeed, dt) {
  const accel = f.onGround ? 42 : 12;
  f.vel.x += wishX * accel * dt;
  f.vel.z += wishZ * accel * dt;
  const sp = Math.hypot(f.vel.x, f.vel.z);
  const cap = maxSpeed;
  if (sp > cap) {
    f.vel.x *= cap / sp;
    f.vel.z *= cap / sp;
  }
  // Friction when no input.
  if (wishX === 0 && wishZ === 0 && f.onGround) {
    const fr = Math.max(0, 1 - 10 * dt);
    f.vel.x *= fr;
    f.vel.z *= fr;
  }
}

export function eyeHeight(f) {
  return f.crouch ? 1.15 : 1.62;
}

export function resetFighter(f, spawn) {
  f.alive = true;
  f.hp = 100;
  f.armor = 0;
  f.pos.x = spawn.x;
  f.pos.y = 0;
  f.pos.z = spawn.z;
  f.vel.x = 0;
  f.vel.y = 0;
  f.vel.z = 0;
  f.yaw = spawn.yaw;
  f.pitch = 0;
  f.crouch = false;
  f.weapons = [makeWeaponState(WEAPONS.pistol)];
  f.weapon = 0;
  f.grenades = { frag: 0, smoke: 0 };
  f.hasSpike = false;
  f.bot = f.bot ? { ...f.bot, state: 'advance', target: null, path: null, pathI: 0, dest: null, aimT: 0, burstLeft: 0, burstT: 0, thinkT: 0, lastHeard: null, holdUntil: 0 } : null;
}
