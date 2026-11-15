// Bot brains. A bot is a fighter with a state machine: it advances along
// routes through the yard, holds angles, engages what it sees, reacts to what
// it hears, and plays the objective — planting and defusing the spike. Bots
// shoot with the same weapons and the same spread rules as the player, with
// aim error and a reaction delay that shrink as they track a target.

import { angleDelta, clamp, pick } from './util.js';
import { findPath, hasLOS, nearestNode, siteAt } from './world.js';
import { eyeOf, tryFire } from './weapons.js';
import { TEAM_SENTINEL, TEAM_VANGUARD, accelFighter } from './fighters.js';

const BOT_NAMES = {
  [TEAM_VANGUARD]: ['Rook', 'Fable', 'Iris'],
  [TEAM_SENTINEL]: ['Bram', 'Kessler', 'Voss', 'Hale'],
};

const HOLD_NODES = {
  // Defenders hold near the sites and mid.
  [TEAM_SENTINEL]: [4, 20, 16, 21, 12, 17],
  [TEAM_VANGUARD]: [2, 13, 14, 6, 10, 22],
};

export function makeBot(team, role, skill, name) {
  return {
    role,
    skill, // 0..1, higher is sharper
    state: 'advance',
    target: null,
    aimT: 0,
    reactionT: 0,
    burstLeft: 0,
    burstT: 0,
    thinkT: 0,
    path: null,
    pathI: 0,
    dest: null,
    holdNode: -1,
    holdUntil: 0,
    lastHeard: null,
    lastSeen: null,
    lastSeenT: -99,
    plantT: 0,
    defuseT: 0,
    assignedSite: null,
    strafeDir: 1,
    strafeT: 0,
    name,
  };
}

export function botDisplayName(team, index) {
  return BOT_NAMES[team][index % BOT_NAMES[team].length];
}

/** Pick a destination node for a bot and path to it. */
function goTo(f, s, node) {
  const from = nearestNode(s.nav, f.pos.x, f.pos.z);
  f.bot.path = findPath(s.nav, from, node);
  f.bot.pathI = 0;
  f.bot.dest = node;
}

/** Nearest visible enemy, or null. Also updates lastSeen memory. */
function perceive(f, s, now) {
  const eye = eyeOf(f, { x: 0, y: 0, z: 0 });
  let best = null;
  let bestScore = Infinity;
  for (const e of s.fighters) {
    if (e.team === f.team || !e.alive) continue;
    const dx = e.pos.x - f.pos.x, dz = e.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) continue;
    const ang = Math.atan2(-dx, -dz);
    // The forward direction in yaw terms is the yaw itself; compare directly.
    const diff = Math.abs(angleDelta(f.yaw, ang));
    if (diff > 1.15 && dist > 4) continue; // outside the vision cone
    const eyeY = e.pos.y + (e.crouch ? 0.95 : 1.5);
    if (!hasLOS(eye.x, eye.y, eye.z, e.pos.x, eyeY, e.pos.z, s.smoke)) continue;
    const score = dist + (e.crouch ? 3 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (best) {
    f.bot.lastSeen = { x: best.pos.x, z: best.pos.z, t: now };
    f.bot.lastSeenT = now;
    best.spottedAt = now;
    best.spottedBy = f.id;
  }
  return best;
}

/** 10 Hz decisions: objective, target, destination. */
function think(f, s, now, rng) {
  const b = f.bot;
  const enemyAlive = s.fighters.some((e) => e.team !== f.team && e.alive);
  if (!enemyAlive) return;
  const spike = s.spike;

  // --- objective ---
  if (f.team === TEAM_VANGUARD) {
    if (spike.planted) {
      // Defend the planted spike: hold near its site.
      if (b.state !== 'engage' && b.dest !== spike.siteNode) goTo(f, s, spike.siteNode);
      if (b.state !== 'engage') b.state = 'advance';
    } else if (f.hasSpike) {
      const site = b.assignedSite === 'A' ? 4 : 6; // nav nodes at the sites
      if (siteAt(f.pos.x, f.pos.z)) {
        b.state = 'plant';
      } else if (b.dest !== site) {
        goTo(f, s, site);
        b.state = 'advance';
      }
    } else if (spike.dropped) {
      const node = nearestNode(s.nav, spike.pos.x, spike.pos.z);
      if (b.dest !== node) {
        goTo(f, s, node);
        b.state = 'advance';
      }
    } else {
      // Escort the carrier: follow a route to the carrier's site.
      const carrier = s.fighters.find((e) => e.hasSpike && e.alive);
      const site = carrier && carrier.bot ? carrier.bot.assignedSite : b.assignedSite;
      const node = site === 'A' ? 4 : 6;
      if (s.timer < 25 && b.dest !== node) {
        goTo(f, s, node);
        b.state = 'advance';
      } else if (b.dest === null || b.state === 'hold') {
        const hold = pick(rng, HOLD_NODES[TEAM_VANGUARD]);
        goTo(f, s, hold);
        b.state = 'advance';
      }
    }
  } else {
    // Sentinel defenders.
    if (spike.planted) {
      const node = spike.siteNode;
      if (siteAt(f.pos.x, f.pos.z) && spike.planted) {
        b.state = 'defuse';
      } else if (b.dest !== node) {
        goTo(f, s, node);
        b.state = 'advance';
      }
    } else if (b.lastHeard && now - b.lastHeard.t < 4 && b.state !== 'engage') {
      const node = nearestNode(s.nav, b.lastHeard.x, b.lastHeard.z);
      if (b.dest !== node) {
        goTo(f, s, node);
        b.state = 'advance';
      }
    } else if (b.state !== 'engage' && (b.dest === null || now > b.holdUntil)) {
      const hold = pick(rng, HOLD_NODES[TEAM_SENTINEL]);
      goTo(f, s, hold);
      b.holdUntil = now + 6 + rng() * 8;
      b.state = 'advance';
    }
  }

  // --- arrival ---
  if (b.state === 'advance' && b.path && b.pathI >= b.path.length) {
    b.state = 'hold';
    b.holdUntil = now + 4 + rng() * 6;
    b.path = null;
  }
}

/** Per-step steering and firing. */
export function updateBot(f, s, dt, now, rng) {
  const b = f.bot;
  if (!f.alive) return;
  b.thinkT -= dt;
  if (b.thinkT <= 0) {
    b.thinkT = 0.1;
    think(f, s, now, rng);
  }

  // Perception every step (cheap: few fighters).
  const seen = perceive(f, s, now);
  if (seen) {
    if (b.target !== seen) {
      b.target = seen;
      b.aimT = 0;
      // Reaction delay: sharper bots and close targets answer faster.
      const dist = Math.hypot(seen.pos.x - f.pos.x, seen.pos.z - f.pos.z);
      b.reactionT = clamp(0.55 - b.skill * 0.25 - Math.max(0, 20 - dist) * 0.008, 0.18, 0.6);
    }
    b.aimT += dt;
  } else if (b.target) {
    // Lost sight: keep the memory briefly, then drop the target.
    if (now - b.lastSeenT > 1.2) {
      b.target = null;
      b.aimT = 0;
    }
  }

  // --- movement ---
  let wishX = 0, wishZ = 0;
  let maxSpeed = 4.6;
  if (b.target && b.state !== 'plant' && b.state !== 'defuse' && !f.hasSpike) {
    // Engage: strafe and hold ground, facing the target. The spike carrier
    // does not stop to fight: it keeps pushing the site (and still shoots —
    // the firing code below does not care about state).
    b.strafeT -= dt;
    if (b.strafeT <= 0) {
      b.strafeT = 0.7 + rng() * 0.9;
      b.strafeDir = rng() < 0.5 ? -1 : 1;
    }
    const dx = b.target.pos.x - f.pos.x, dz = b.target.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist, nz = dz / dist;
    // Strafe perpendicular; close in slowly when far, back off when very near.
    const radial = dist > 16 ? 0.5 : dist < 5 ? -0.6 : 0;
    wishX = -nz * b.strafeDir * 0.8 + nx * radial;
    wishZ = nx * b.strafeDir * 0.8 + nz * radial;
    maxSpeed = 3.4;
    // Face the target.
    const wantYaw = Math.atan2(-dx, -dz);
    f.yaw += angleDelta(f.yaw, wantYaw) * Math.min(1, dt * 10);
    const eyeY = f.pos.y + 1.5;
    const ty = b.target.pos.y + 1.3;
    f.pitch = clamp(Math.atan2(ty - eyeY, dist) * 0.8, -1.2, 1.2);
  } else if (b.state === 'defuse' && s.spike.planted) {
    // Close in on the spike itself, not just the site: the plant can be
    // anywhere on the site, and the defuse only counts within 1.6 m of it.
    const dx = s.spike.pos.x - f.pos.x, dz = s.spike.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.2) {
      wishX = dx / dist;
      wishZ = dz / dist;
      const wantYaw = Math.atan2(-dx, -dz);
      f.yaw += angleDelta(f.yaw, wantYaw) * Math.min(1, dt * 6);
    }
  } else if (b.state === 'advance' && b.path && b.pathI < b.path.length) {
    const node = s.nav[b.path[b.pathI]];
    const dx = node.x - f.pos.x, dz = node.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      b.pathI++;
    } else {
      wishX = dx / dist;
      wishZ = dz / dist;
      // Face where we walk, with a scan sweep while holding ground later.
      const wantYaw = Math.atan2(-dx, -dz);
      f.yaw += angleDelta(f.yaw, wantYaw) * Math.min(1, dt * 6);
    }
  } else if (b.state === 'hold') {
    // Scan: slow yaw sweep.
    f.yaw += dt * 0.5 * (Math.sin(now * 0.4 + f.id) > 0 ? 1 : -1);
    if (now > b.holdUntil && b.role !== 'holder') {
      b.dest = null;
      b.thinkT = 0;
    }
  }

  // Crouch when holding a long angle with a target: steadier aim.
  f.crouch = Boolean(b.target) && Math.hypot(b.target.pos.x - f.pos.x, b.target.pos.z - f.pos.z) > 18 && rng() < 0.02 ? true : f.crouch;
  if (!b.target) f.crouch = false;

  const speedCap = f.crouch ? 2.6 : maxSpeed;
  accelFighter(f, wishX, wishZ, speedCap, dt);

  // --- firing ---
  if (b.target && b.aimT >= b.reactionT) {
    const w = f.weapons[f.weapon];
    b.burstT -= dt;
    if (b.burstLeft <= 0 && b.burstT <= 0) {
      b.burstLeft = 3 + Math.floor(rng() * 3);
      b.burstT = 0.5 + rng() * 0.6;
    }
    if (b.burstLeft > 0 && w.cooldown <= 0 && w.reloadT <= 0 && w.mag > 0) {
      const t = b.target;
      const eye = eyeOf(f, { x: 0, y: 0, z: 0 });
      const ty = t.pos.y + (t.crouch ? 0.95 : 1.45);
      const dx = t.pos.x - eye.x, dy = ty - eye.y, dz = t.pos.z - eye.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      // Aim error: base + distance, shrinking as the bot tracks the target.
      const track = clamp(b.aimT / 1.2, 0, 1);
      const err = (0.045 + dist * 0.0011) * (1 - 0.55 * track) * (1.15 - b.skill * 0.5);
      const dir = {
        x: dx / dist + (rng() - 0.5) * 2 * err,
        y: dy / dist + (rng() - 0.5) * 2 * err,
        z: dz / dist + (rng() - 0.5) * 2 * err,
      };
      const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dir.x /= dl; dir.y /= dl; dir.z /= dl;
      const shot = tryFire(f, dir, rng, now, false);
      if (shot) {
        b.burstLeft--;
        s.pendingShots.push(shot);
        s.noise.push({ x: f.pos.x, z: f.pos.z, t: now, r: 26 });
      }
    }
  }
  // Reload when safe and the mag is low.
  const w = f.weapons[f.weapon];
  if (!b.target && w.mag < w.def.mag * 0.4 && w.reloadT <= 0 && w.reserve > 0) {
    w.reloadT = w.def.reload;
  }
  if (w.mag === 0 && w.reloadT <= 0 && w.reserve > 0) {
    w.reloadT = w.def.reload;
  }
}
