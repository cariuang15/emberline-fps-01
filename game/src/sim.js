// The simulation: one state object, one fixed step. Everything the game is —
// rounds, money, the spike, grenades, tracers, the kill feed — lives here.
// Rendering reads this state; it never writes it. The step is fixed at 60 Hz
// so a staged scene plays the same way every time.

import { clamp, mulberry32, pick } from './util.js';
import { SPAWNS, buildNav, hasLOS, siteAt } from './world.js';
import {
  ARMOR_PRICE, GRENADE_DEFS, WEAPONS,
  damageAt, eyeOf, resolveShot, startReload, stepGrenade, throwGrenade, tryFire,
} from './weapons.js';
import {
  TEAM_SENTINEL, TEAM_VANGUARD, buyArmor, damageFighter, giveWeapon,
  makeFighter, resetFighter, resetFighterIds, stepFighter, accelFighter,
} from './fighters.js';
import { botDisplayName, makeBot, updateBot } from './bots.js';
import * as sfx from './audio.js';

export const SIM_DT = 1 / 60;
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const FUSE_TIME = 35;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 6;
export const WIN_ROUNDS = 5;
export const WIN_MONEY = 325;
export const LOSE_MONEY = 190;
export const KILL_MONEY = 300;
export const PLANT_MONEY = 300;

export function createSim(seed) {
  resetFighterIds();
  const rng = mulberry32(seed);
  const s = {
    seed,
    rng,
    time: 0,
    tick: 0,
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseT: 0,
    round: 1,
    score: { vanguard: 0, sentinel: 0 },
    timer: BUY_TIME,
    nav: buildNav(),
    fighters: [],
    player: null,
    spike: {
      carrier: null, dropped: false, planted: false,
      site: null, siteNode: -1, pos: { x: 0, z: 0 },
      timer: 0, plantT: 0, defuseT: 0, defuser: null,
    },
    grenades: [],
    smoke: [],
    tracers: [],
    particles: [],
    flashes: [],
    pendingShots: [],
    noise: [],
    events: [],
    shake: 0,
    damageDir: null,
    damageAt: -99,
    lastHitAt: -99,
    winner: null,
    winReason: '',
    matchWinner: null,
  };
  // Player + 3 Vanguard bots vs 4 Sentinel bots.
  const vSpawns = SPAWNS.vanguard;
  const sSpawns = SPAWNS.sentinel;
  const player = makeFighter(TEAM_VANGUARD, true, vSpawns[0], 'You');
  s.player = player;
  s.fighters.push(player);
  for (let i = 0; i < 3; i++) {
    const f = makeFighter(TEAM_VANGUARD, false, vSpawns[i + 1], botDisplayName(TEAM_VANGUARD, i));
    f.bot = makeBot(TEAM_VANGUARD, i === 0 ? 'carrier' : 'entry', 0.45 + rng() * 0.3, f.name);
    f.bot.assignedSite = rng() < 0.5 ? 'A' : 'B';
    s.fighters.push(f);
  }
  for (let i = 0; i < 4; i++) {
    const f = makeFighter(TEAM_SENTINEL, false, sSpawns[i], botDisplayName(TEAM_SENTINEL, i));
    f.bot = makeBot(TEAM_SENTINEL, 'holder', 0.45 + rng() * 0.3, f.name);
    f.bot.assignedSite = i < 2 ? 'A' : 'B';
    s.fighters.push(f);
  }
  return s;
}

export function addEvent(s, text, team, kind) {
  s.events.push({ text, team, kind: kind || 'info', t: s.time });
  if (s.events.length > 24) s.events.splice(0, s.events.length - 24);
}

/** Bots spend their money at the start of a round. */
function botBuy(f, rng) {
  const r = rng();
  if (f.money >= WEAPONS.sniper.price && r < 0.18) giveWeapon(f, WEAPONS.sniper);
  else if (f.money >= WEAPONS.rifle.price && r < 0.75) giveWeapon(f, WEAPONS.rifle);
  else if (f.money >= WEAPONS.smg.price) giveWeapon(f, WEAPONS.smg);
  if (f.money >= ARMOR_PRICE && rng() < 0.6) buyArmor(f);
  if (f.money >= GRENADE_DEFS.frag.price && rng() < 0.5) { f.money -= GRENADE_DEFS.frag.price; f.grenades.frag++; }
  if (f.money >= GRENADE_DEFS.smoke.price && rng() < 0.35) { f.money -= GRENADE_DEFS.smoke.price; f.grenades.smoke++; }
  f.weapon = f.weapons.length - 1;
}

export function startMatch(s) {
  s.score.vanguard = 0;
  s.score.sentinel = 0;
  s.round = 1;
  s.matchWinner = null;
  for (const f of s.fighters) f.money = 800;
  startRound(s);
}

export function startRound(s) {
  // Fresh loadouts every round; money carries over.
  const vSpawns = SPAWNS.vanguard;
  const sSpawns = SPAWNS.sentinel;
  let vi = 0, si = 0;
  for (const f of s.fighters) {
    const spawn = f.team === TEAM_VANGUARD ? vSpawns[vi++] : sSpawns[si++];
    resetFighter(f, spawn);
    if (f.bot) botBuy(f, s.rng);
  }
  // The spike goes to a Vanguard bot or the player, alternating by round.
  const carriers = s.fighters.filter((f) => f.team === TEAM_VANGUARD);
  const carrier = carriers[s.round % 2 === 1 ? 0 : 1];
  carrier.hasSpike = true;
  s.spike.carrier = carrier;
  s.spike.dropped = false;
  s.spike.planted = false;
  s.spike.site = null;
  s.spike.plantT = 0;
  s.spike.defuseT = 0;
  s.spike.defuser = null;
  if (carrier.bot) carrier.bot.assignedSite = s.rng() < 0.5 ? 'A' : 'B';
  s.grenades.length = 0;
  s.smoke.length = 0;
  s.pendingShots.length = 0;
  s.noise.length = 0;
  s.phase = 'buy';
  s.phaseT = 0;
  s.timer = BUY_TIME;
  s.winner = null;
  s.winReason = '';
  addEvent(s, `Round ${s.round} — buy phase`, null, 'round');
}

function endRound(s, winnerTeam, reason) {
  if (s.phase === 'roundEnd' || s.phase === 'matchEnd') return;
  s.winner = winnerTeam;
  s.winReason = reason;
  if (winnerTeam === TEAM_VANGUARD) s.score.vanguard++;
  else s.score.sentinel++;
  for (const f of s.fighters) {
    f.money += f.team === winnerTeam ? WIN_MONEY : LOSE_MONEY;
  }
  const name = winnerTeam === TEAM_VANGUARD ? 'Vanguard' : 'Sentinel';
  addEvent(s, `${name} wins the round — ${reason}`, winnerTeam, 'round');
  if (s.score.vanguard >= WIN_ROUNDS || s.score.sentinel >= WIN_ROUNDS) {
    s.matchWinner = winnerTeam;
    s.phase = 'matchEnd';
  } else {
    s.phase = 'roundEnd';
  }
  s.phaseT = 0;
  if (winnerTeam === TEAM_VANGUARD) sfx.sfxRoundWin();
  else sfx.sfxRoundLose();
}

/** One shot's aftermath: damage, tracer, sound, kill feed. */
function applyShot(s, shot, result) {
  const { shooter, weapon } = shot;
  s.tracers.push({
    a: { ...shot.origin },
    b: { ...result.point },
    t: 0, life: 0.09, color: weapon.tracer,
  });
  if (s.tracers.length > 24) s.tracers.shift();
  s.flashes.push({ x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, t: 0 });
  if (s.flashes.length > 8) s.flashes.shift();
  const near = shooter.isPlayer;
  sfx.sfxShot(weapon.id, near);
  s.noise.push({ x: shooter.pos.x, z: shooter.pos.z, t: s.time, r: 26 });
  if (result.hit === 'fighter') {
    const target = result.fighter;
    const dmg = damageAt(weapon, result.dist, result.head);
    const died = damageFighter(target, dmg, shooter, s.time);
    if (shooter.isPlayer) {
      sfx.sfxHit();
      s.lastHitAt = s.time;
    }
    if (target.isPlayer) {
      // Direction indicator: the attacker's angle in the player's own frame —
      // forward is (0,0,-1) at yaw 0, right is (+1,0,0). atan2(right, forward)
      // is the marker's clockwise rotation from straight ahead.
      const dx = shooter.pos.x - target.pos.x, dz = shooter.pos.z - target.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const fwdX = -Math.sin(target.yaw), fwdZ = -Math.cos(target.yaw);
      const rgtX = Math.cos(target.yaw), rgtZ = -Math.sin(target.yaw);
      const lx = (dx * rgtX + dz * rgtZ) / len;
      const lz = (dx * fwdX + dz * fwdZ) / len;
      s.damageDir = Math.atan2(lx, lz);
      s.damageAt = s.time;
      sfx.sfxHurt();
    }
    if (died) {
      shooter.money += KILL_MONEY;
      addEvent(s, `${shooter.name} ✕ ${target.name}${result.head ? ' (headshot)' : ''}`, shooter.team, 'kill');
      if (shooter.isPlayer) sfx.sfxKill();
      if (target.hasSpike) dropSpike(s, target);
      // Explosion of red particles at the kill.
      burstParticles(s, result.point, 0xff5a4a, 10, 3);
    }
    burstParticles(s, result.point, 0xffd27a, 4, 1.5);
  } else if (result.hit === 'world') {
    burstParticles(s, result.point, 0xcfd6dd, 5, 1.2);
  }
}

/** The player's aim direction from yaw/pitch, matching the camera:
 *  yaw 0 looks down -z, pitch up is positive. */
function aimDir(p) {
  const cp = Math.cos(p.pitch);
  return {
    x: -Math.sin(p.yaw) * cp,
    y: Math.sin(p.pitch),
    z: -Math.cos(p.yaw) * cp,
  };
}

export function dropSpike(s, carrier) {
  carrier.hasSpike = false;
  s.spike.carrier = null;
  s.spike.dropped = true;
  s.spike.pos.x = carrier.pos.x;
  s.spike.pos.z = carrier.pos.z;
  addEvent(s, 'The spike was dropped', null, 'info');
}

export function burstParticles(s, at, color, n, speed) {
  for (let i = 0; i < n; i++) {
    if (s.particles.length > 256) s.particles.shift();
    const a = s.rng() * Math.PI * 2;
    const up = s.rng() * 2 - 0.4;
    s.particles.push({
      x: at.x, y: at.y, z: at.z,
      vx: Math.cos(a) * speed * (0.4 + s.rng() * 0.6),
      vy: up * speed,
      vz: Math.sin(a) * speed * (0.4 + s.rng() * 0.6),
      life: 0, max: 0.4 + s.rng() * 0.5,
      color, size: 0.05 + s.rng() * 0.06,
    });
  }
}

/** Player buying. `key` is the buy-menu key pressed. Returns true if bought. */
export function buyItem(s, key) {
  const p = s.player;
  if (s.phase !== 'buy') return false;
  const table = {
    '1': WEAPONS.smg, '2': WEAPONS.rifle, '3': WEAPONS.sniper,
    '4': 'armor', '5': 'frag', '6': 'smoke',
  };
  const item = table[key];
  if (!item) return false;
  if (item === 'armor') {
    if (buyArmor(p)) { sfx.sfxBuy(); return true; }
    return false;
  }
  if (item === 'frag' || item === 'smoke') {
    const def = GRENADE_DEFS[item];
    if (p.money >= def.price && p.grenades[item] < 2) {
      p.money -= def.price;
      p.grenades[item]++;
      sfx.sfxBuy();
      return true;
    }
    return false;
  }
  if (p.money >= item.price) {
    p.money -= item.price;
    giveWeapon(p, item);
    sfx.sfxBuy();
    return true;
  }
  return false;
}

/** One fixed step. `input` is the player's current input (see main.js). */
export function stepSim(s, input, dt) {
  s.time += dt;
  s.tick++;
  const p = s.player;
  const now = s.time;

  // --- phase timers ---
  if (s.phase === 'buy') {
    s.timer -= dt;
    if (s.timer <= 0) {
      s.phase = 'live';
      s.timer = ROUND_TIME;
      addEvent(s, 'Round live — good luck', null, 'round');
    }
  } else if (s.phase === 'live') {
    s.timer -= dt;
    if (s.timer <= 0 && !s.spike.planted) {
      endRound(s, TEAM_SENTINEL, 'time expired — the spike was never planted');
    }
  } else if (s.phase === 'roundEnd') {
    s.phaseT += dt;
    if (s.phaseT > 4.5) {
      s.round++;
      startRound(s);
    }
    // No simulation during the banner except particles.
    decayFx(s, dt);
    return;
  } else if (s.phase === 'matchEnd' || s.phase === 'menu') {
    decayFx(s, dt);
    return;
  }
  s.phaseT += dt;

  // --- player movement ---
  if (p.alive && (s.phase === 'live' || s.phase === 'buy')) {
    const speed = input.walk ? 2.8 : p.crouch ? 2.6 : 5.4;
    accelFighter(p, input.mx, input.mz, speed, dt);
    p.crouch = input.crouch;
    if (input.jump && p.onGround) {
      p.vel.y = 6.2;
      p.onGround = false;
    }
  } else {
    accelFighter(p, 0, 0, 5.4, dt);
  }

  // --- player firing ---
  if (p.alive && s.phase === 'live') {
    const w = p.weapons[p.weapon];
    if (input.reload) startReload(w);
    const wantFire = input.fire && (w.def.auto || input.firePressed);
    if (wantFire) {
      const dir = aimDir(p);
      const shot = tryFire(p, dir, s.rng, now, input.aim);
      if (shot) {
        const result = resolveShot(shot, s.fighters, s.smoke);
        applyShot(s, shot, result);
      } else if (w.mag === 0 && w.reloadT <= 0 && input.firePressed) {
        sfx.sfxDry();
      }
    }
    // Grenade throw.
    if (input.throwKind && p.grenades[input.throwKind] > 0) {
      const dir = aimDir(p);
      p.grenades[input.throwKind]--;
      s.grenades.push(throwGrenade(p, dir, input.throwKind));
      sfx.sfxGrenadePin();
    }
    // Weapon slots.
    if (input.slot !== 0 && input.slot <= p.weapons.length) {
      p.weapon = input.slot - 1;
    }
  }

  // --- bots ---
  for (const f of s.fighters) {
    if (!f.isPlayer && f.alive) updateBot(f, s, dt, now, s.rng);
  }

  // --- resolve bot shots ---
  for (const shot of s.pendingShots) {
    const result = resolveShot(shot, s.fighters, s.smoke);
    applyShot(s, shot, result);
  }
  s.pendingShots.length = 0;

  // --- bodies: timers, gravity, collision, separation ---
  for (const f of s.fighters) stepFighter(f, dt);
  for (let i = 0; i < s.fighters.length; i++) {
    const a = s.fighters[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < s.fighters.length; j++) {
      const b = s.fighters[j];
      if (!b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.72) {
        const push = (0.72 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
    }
  }

  // --- footsteps ---
  for (const f of s.fighters) {
    if (f.stepped) {
      f.stepped = false;
      const d = Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z);
      if (d < 24) sfx.sfxStep(f.speed > 4);
    }
  }

  // --- spike pickup ---
  if (s.spike.dropped) {
    for (const f of s.fighters) {
      if (f.team === TEAM_VANGUARD && f.alive) {
        const d = Math.hypot(f.pos.x - s.spike.pos.x, f.pos.z - s.spike.pos.z);
        if (d < 1.3) {
          f.hasSpike = true;
          s.spike.carrier = f;
          s.spike.dropped = false;
          addEvent(s, `${f.name} picked up the spike`, TEAM_VANGUARD, 'info');
          break;
        }
      }
    }
  }

  // --- plant / defuse ---
  const carrier = s.spike.carrier;
  if (s.phase === 'live' && carrier && carrier.alive && !s.spike.planted) {
    const site = siteAt(carrier.pos.x, carrier.pos.z);
    const planting = site && (carrier.isPlayer ? input.use : carrier.bot && carrier.bot.state === 'plant');
    if (planting) {
      s.spike.plantT += dt;
      if (Math.floor(s.spike.plantT * 4) !== Math.floor((s.spike.plantT - dt) * 4)) sfx.sfxPlantTick(false);
      if (s.spike.plantT >= PLANT_TIME) {
        s.spike.planted = true;
        s.spike.site = site.id;
        s.spike.siteNode = site.id === 'A' ? 4 : 6;
        s.spike.timer = FUSE_TIME;
        s.spike.pos.x = carrier.pos.x;
        s.spike.pos.z = carrier.pos.z;
        carrier.hasSpike = false;
        carrier.money += PLANT_MONEY;
        s.spike.carrier = null;
        addEvent(s, `Spike planted at ${site.name}!`, TEAM_VANGUARD, 'info');
        sfx.sfxPlantDone();
      }
    } else {
      s.spike.plantT = Math.max(0, s.spike.plantT - dt * 2);
    }
  }
  if (s.phase === 'live' && s.spike.planted) {
    s.spike.timer -= dt;
    // Defuse: a defender at the spike, holding use.
    let defuser = null;
    for (const f of s.fighters) {
      if (f.team !== TEAM_SENTINEL || !f.alive) continue;
      const d = Math.hypot(f.pos.x - s.spike.pos.x, f.pos.z - s.spike.pos.z);
      if (d < 1.6) {
        const defusing = f.isPlayer ? input.use : f.bot && f.bot.state === 'defuse';
        if (defusing) { defuser = f; break; }
      }
    }
    if (defuser) {
      s.spike.defuser = defuser;
      s.spike.defuseT += dt;
      if (Math.floor(s.spike.defuseT * 2) !== Math.floor((s.spike.defuseT - dt) * 2)) sfx.sfxPlantTick(false);
      if (s.spike.defuseT >= DEFUSE_TIME) {
        endRound(s, TEAM_SENTINEL, 'the spike was defused');
      }
    } else {
      s.spike.defuser = null;
      s.spike.defuseT = Math.max(0, s.spike.defuseT - dt * 2);
    }
    if (s.phase === 'live' && s.spike.timer <= 0) {
      // Detonation: wipe everyone near the site, attackers win.
      burstParticles(s, { x: s.spike.pos.x, y: 1, z: s.spike.pos.z }, 0xff7a2a, 60, 9);
      burstParticles(s, { x: s.spike.pos.x, y: 1, z: s.spike.pos.z }, 0xffd27a, 40, 6);
      s.shake = 1;
      sfx.sfxExplosion();
      for (const f of s.fighters) {
        const d = Math.hypot(f.pos.x - s.spike.pos.x, f.pos.z - s.spike.pos.z);
        if (d < 9) damageFighter(f, 200 * (1 - d / 12), null, now);
      }
      endRound(s, TEAM_VANGUARD, 'the spike detonated');
    }
  }

  // --- grenades ---
  for (const g of s.grenades) {
    const burst = stepGrenade(g, dt);
    if (burst === 'burst') {
      if (g.kind === 'frag') {
        burstParticles(s, g.pos, 0xff7a2a, 40, 8);
        burstParticles(s, g.pos, 0x9aa2ab, 24, 4);
        s.shake = Math.min(1, s.shake + 0.5);
        sfx.sfxExplosion();
        for (const f of s.fighters) {
          if (!f.alive) continue;
          const d = Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z) + Math.abs((f.pos.y + 1) - g.pos.y) * 0.5;
          if (d < g.def.radius) {
            const los = hasLOS(g.pos.x, g.pos.y, g.pos.z, f.pos.x, f.pos.y + 1, f.pos.z, null);
            const dmg = g.def.damage * (1 - d / g.def.radius) * (los ? 1 : 0.35);
            const died = damageFighter(f, dmg, g.owner, now);
            if (died) {
              g.owner.money += KILL_MONEY;
              addEvent(s, `${g.owner.name} ✕ ${f.name} (frag)`, g.owner.team, 'kill');
              if (f.hasSpike) dropSpike(s, f);
            }
          }
        }
      } else {
        // Smoke: a cloud that blocks sight for 12 seconds.
        s.smoke.push({ x: g.pos.x, y: 1.2, z: g.pos.z, r: 3.2, until: now + g.def.duration });
        burstParticles(s, g.pos, 0xd8dde2, 30, 2);
      }
    }
  }
  s.grenades = s.grenades.filter((g) => !g.dead);
  s.smoke = s.smoke.filter((sm) => sm.until > now);

  // --- round end by elimination ---
  if (s.phase === 'live') {
    const vAlive = s.fighters.some((f) => f.team === TEAM_VANGUARD && f.alive);
    const sAlive = s.fighters.some((f) => f.team === TEAM_SENTINEL && f.alive);
    if (!vAlive) endRound(s, TEAM_SENTINEL, 'Vanguard eliminated');
    else if (!sAlive) endRound(s, TEAM_VANGUARD, 'Sentinel eliminated');
  }

  // --- hearing memory decays ---
  s.noise = s.noise.filter((n) => now - n.t < 1.5);

  decayFx(s, dt);
}

function decayFx(s, dt) {
  for (const t of s.tracers) t.t += dt;
  s.tracers = s.tracers.filter((t) => t.t < t.life);
  for (const pt of s.particles) {
    pt.life += dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.z += pt.vz * dt;
    pt.vy -= 6 * dt;
    if (pt.y < 0.02) { pt.y = 0.02; pt.vy = 0; }
  }
  s.particles = s.particles.filter((pt) => pt.life < pt.max);
  for (const f of s.flashes) f.t += dt;
  s.flashes = s.flashes.filter((f) => f.t < 0.07);
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 1.8);
  if (s.damageDir !== null && s.time - s.damageAt > 1.2) s.damageDir = null;
}
