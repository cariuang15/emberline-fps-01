// The HUD: every DOM readout, the minimap, the buy menu and the overlays.
// It reads the simulation state and never writes it (except through the
// callbacks the main loop passes in). Text updates are cached so the DOM is
// only touched when a value actually changes.

import { BOXES, MAP, SITES } from './world.js';
import { GRENADE_DEFS, WEAPONS } from './weapons.js';
import { TEAM_SENTINEL, TEAM_VANGUARD } from './fighters.js';
import { WIN_ROUNDS } from './sim.js';

const $ = (id) => document.getElementById(id);

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(callbacks) {
  const els = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    healthNum: $('health-num'),
    healthBar: $('health-fill'),
    armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    grenades: $('grenades'),
    timer: $('timer'),
    roundLabel: $('round-label'),
    scoreV: $('score-v'),
    scoreS: $('score-s'),
    money: $('money'),
    aliveV: $('alive-v'),
    aliveS: $('alive-s'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    subbanner: $('subbanner'),
    minimap: $('minimap'),
    damageDir: $('damage-dir'),
    spikeStatus: $('spike-status'),
    hint: $('hint'),
    overlayMenu: $('overlay-menu'),
    overlayBuy: $('overlay-buy'),
    overlayDead: $('overlay-dead'),
    overlayEnd: $('overlay-end'),
    endTitle: $('end-title'),
    endCopy: $('end-copy'),
    scoreboard: $('scoreboard'),
    scoreRows: $('score-rows'),
    buyGrid: $('buy-grid'),
    lowHealth: $('low-health'),
  };
  const mm = els.minimap.getContext('2d');
  const last = {};
  let lastPhase = '';
  let bannerUntil = 0;

  function set(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      if (el) el.textContent = value;
    }
  }

  // Build the buy menu once.
  const items = [
    { key: '1', name: 'MP9', desc: 'Submachine gun · fast, close', price: WEAPONS.smg.price },
    { key: '2', name: 'VK-47', desc: 'Rifle · the workhorse', price: WEAPONS.rifle.price },
    { key: '3', name: 'Longshot', desc: 'Bolt sniper · one shot', price: WEAPONS.sniper.price },
    { key: '4', name: 'Kevlar vest', desc: '50 armour', price: 650 },
    { key: '5', name: 'Frag grenade', desc: 'Burst damage, radius 7 m', price: GRENADE_DEFS.frag.price },
    { key: '6', name: 'Smoke grenade', desc: 'Blocks sight for 12 s', price: GRENADE_DEFS.smoke.price },
  ];
  for (const item of items) {
    const div = document.createElement('button');
    div.className = 'buy-item';
    div.type = 'button';
    div.innerHTML = `<b>[${item.key}] ${item.name}</b><span>${item.desc}</span><em>$${item.price}</em>`;
    div.addEventListener('click', () => callbacks.onBuy(item.key));
    els.buyGrid.appendChild(div);
  }

  $('play').addEventListener('click', () => callbacks.onPlay());
  $('restart').addEventListener('click', () => callbacks.onRestart());
  $('mute-btn').addEventListener('click', () => callbacks.onMute());

  function drawMinimap(s, now) {
    const W = els.minimap.width, H = els.minimap.height;
    const sx = W / (MAP.x1 - MAP.x0), sy = H / (MAP.z1 - MAP.z0);
    const X = (x) => (x - MAP.x0) * sx;
    const Z = (z) => (z - MAP.z0) * sy;
    mm.fillStyle = 'rgba(16,19,23,0.85)';
    mm.fillRect(0, 0, W, H);
    mm.fillStyle = '#3a4149';
    for (const b of BOXES) mm.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * sx, (b.z1 - b.z0) * sy);
    for (const site of SITES) {
      mm.strokeStyle = '#f0a830';
      mm.lineWidth = 1.5;
      mm.beginPath();
      mm.arc(X(site.x), Z(site.z), site.r * sx, 0, Math.PI * 2);
      mm.stroke();
      mm.fillStyle = '#f0a830';
      mm.font = 'bold 11px system-ui, sans-serif';
      mm.textAlign = 'center';
      mm.textBaseline = 'middle';
      mm.fillText(site.id, X(site.x), Z(site.z));
    }
    // Spike.
    if (s.spike.planted || s.spike.dropped) {
      mm.fillStyle = '#ff5a2a';
      mm.beginPath();
      mm.arc(X(s.spike.pos.x), Z(s.spike.pos.z), 4, 0, Math.PI * 2);
      mm.fill();
    }
    // Fighters.
    for (const f of s.fighters) {
      if (!f.alive) continue;
      const x = X(f.pos.x), y = Z(f.pos.z);
      if (f.isPlayer) {
        mm.save();
        mm.translate(x, y);
        mm.rotate(-f.yaw);
        mm.fillStyle = '#35d0c5';
        mm.beginPath();
        mm.moveTo(7, 0); mm.lineTo(-5, -5); mm.lineTo(-5, 5); mm.closePath();
        mm.fill();
        mm.restore();
      } else if (f.team === TEAM_VANGUARD) {
        mm.fillStyle = '#35d0c5';
        mm.beginPath(); mm.arc(x, y, 3.5, 0, Math.PI * 2); mm.fill();
      } else if (now - f.spottedAt < 4) {
        mm.fillStyle = '#f0a830';
        mm.beginPath(); mm.arc(x, y, 3.5, 0, Math.PI * 2); mm.fill();
      }
    }
  }

  function update(s, input, spreadPx, now) {
    const p = s.player;
    const w = p.weapons[p.weapon];

    // Crosshair gap follows spread; hitmarker flashes on a hit.
    els.crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
    els.hitmarker.classList.toggle('on', now - (s.lastHitAt ?? -99) < 0.12);

    set(els.healthNum, 'hp', String(Math.ceil(p.hp)));
    els.healthBar.style.width = `${Math.max(0, p.hp)}%`;
    els.healthBar.classList.toggle('low', p.hp <= 30);
    set(els.armorNum, 'armor', p.armor > 0 ? `◈ ${Math.ceil(p.armor)}` : '');
    set(els.ammoMag, 'mag', String(w.mag));
    set(els.ammoReserve, 'res', `/ ${w.reserve}`);
    set(els.grenades, 'nades', `◉ ${p.grenades.frag}  ◎ ${p.grenades.smoke}`);
    set(els.timer, 'timer', s.phase === 'buy' ? `BUY ${fmtTime(s.timer)}` : s.spike.planted ? `💣 ${fmtTime(s.spike.timer)}` : fmtTime(s.timer));
    els.timer.classList.toggle('urgent', s.phase === 'live' && s.timer < 15);
    set(els.roundLabel, 'round', `ROUND ${s.round}`);
    set(els.scoreV, 'sv', String(s.score.vanguard));
    set(els.scoreS, 'ss', String(s.score.sentinel));
    set(els.money, 'money', `$${p.money}`);
    const aliveV = s.fighters.filter((f) => f.team === TEAM_VANGUARD && f.alive).length;
    const aliveS = s.fighters.filter((f) => f.team === TEAM_SENTINEL && f.alive).length;
    set(els.aliveV, 'av', '●'.repeat(aliveV) + '○'.repeat(4 - aliveV));
    set(els.aliveS, 'as', '●'.repeat(aliveS) + '○'.repeat(4 - aliveS));

    // Spike status line.
    let spikeText = '';
    if (s.spike.planted) spikeText = `SPIKE PLANTED — ${Math.ceil(s.spike.timer)}s`;
    else if (p.hasSpike) spikeText = 'YOU CARRY THE SPIKE — plant at A or B';
    else if (s.spike.dropped) spikeText = 'SPIKE DROPPED — pick it up';
    else if (s.spike.carrier && !s.spike.carrier.isPlayer) spikeText = `${s.spike.carrier.name} carries the spike`;
    set(els.spikeStatus, 'spike', spikeText);
    els.spikeStatus.classList.toggle('planted', s.spike.planted);

    // Context hint.
    let hint = '';
    if (s.phase === 'buy') hint = 'Buy phase — press B for the buy menu';
    else if (s.phase === 'live' && p.alive) {
      if (p.hasSpike) {
        const inSite = s.spike.plantT > 0;
        hint = inSite ? 'Planting…' : 'Hold E at a site to plant the spike';
      } else if (s.spike.planted) {
        hint = 'Hold E at the spike to defuse';
      }
    }
    set(els.hint, 'hint', hint);

    // Plant / defuse progress is drawn as a thin bar under the crosshair.
    const prog = s.spike.plantT > 0 ? s.spike.plantT / 3.5 : s.spike.defuseT > 0 ? s.spike.defuseT / 6 : 0;
    els.crosshair.style.setProperty('--prog', prog.toFixed(2));

    // Kill feed: last 4 events.
    const feed = s.events.filter((e) => e.kind === 'kill' || e.kind === 'info').slice(-4);
    const feedKey = feed.map((e) => e.text + e.t).join('|');
    if (last.feed !== feedKey) {
      last.feed = feedKey;
      els.killfeed.innerHTML = '';
      for (const e of feed) {
        const div = document.createElement('div');
        div.className = `feed-${e.kind}`;
        div.textContent = e.text;
        els.killfeed.appendChild(div);
      }
    }

    // Damage direction indicator.
    if (s.damageDir !== null) {
      els.damageDir.style.opacity = '1';
      els.damageDir.style.transform = `translate(-50%, -50%) rotate(${s.damageDir.toFixed(2)}rad)`;
    } else {
      els.damageDir.style.opacity = '0';
    }

    // Low-health vignette.
    els.lowHealth.style.opacity = p.alive && p.hp <= 30 ? String(1 - p.hp / 40) : '0';

    // Banners on phase change.
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      bannerUntil = now + 3;
      if (s.phase === 'buy') {
        els.banner.textContent = `ROUND ${s.round}`;
        els.subbanner.textContent = 'Buy phase — spend your money, then fight';
      } else if (s.phase === 'live') {
        els.banner.textContent = 'ROUND LIVE';
        els.subbanner.textContent = s.player.hasSpike ? 'You carry the spike' : 'Eliminate Sentinel or plant the spike';
      } else if (s.phase === 'roundEnd') {
        els.banner.textContent = s.winner === TEAM_VANGUARD ? 'ROUND WON' : 'ROUND LOST';
        els.subbanner.textContent = s.winReason;
      } else if (s.phase === 'matchEnd') {
        els.banner.textContent = s.matchWinner === TEAM_VANGUARD ? 'VICTORY' : 'DEFEAT';
        els.subbanner.textContent = `${s.score.vanguard} — ${s.score.sentinel} · first to ${WIN_ROUNDS}`;
      }
    }
    const showBanner = now < bannerUntil && s.phase !== 'menu';
    els.banner.style.opacity = showBanner ? '1' : '0';
    els.subbanner.style.opacity = showBanner ? '1' : '0';

    // Overlays.
    els.overlayMenu.hidden = s.phase !== 'menu';
    els.overlayBuy.hidden = !(s.phase === 'buy' && input.buyOpen);
    els.overlayDead.hidden = p.alive || s.phase === 'menu' || s.phase === 'matchEnd';
    els.overlayEnd.hidden = s.phase !== 'matchEnd';
    if (s.phase === 'matchEnd') {
      els.endTitle.textContent = s.matchWinner === TEAM_VANGUARD ? 'VICTORY' : 'DEFEAT';
      els.endCopy.textContent = `Kestrel Yard ends ${s.score.vanguard} — ${s.score.sentinel}. Vanguard takes the yard.`;
    }

    // Buy menu affordability.
    if (!els.overlayBuy.hidden) {
      const items = els.buyGrid.children;
      const prices = [900, 1700, 2600, 650, 300, 250];
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle('cant', p.money < prices[i]);
      }
    }

    // Scoreboard (Tab held).
    els.scoreboard.hidden = !input.scoreboard;
    if (input.scoreboard) {
      const rows = s.fighters.map((f) => {
        const cls = f.team === TEAM_VANGUARD ? 'row-v' : 'row-s';
        return `<tr class="${cls}"><td>${f.name}${f.isPlayer ? ' (you)' : ''}</td><td>${f.kills}</td><td>${f.deaths}</td><td>$${f.money}</td></tr>`;
      }).join('');
      const html = rows;
      if (last.scoreHtml !== html) {
        last.scoreHtml = html;
        els.scoreRows.innerHTML = html;
      }
    }

    drawMinimap(s, now);
  }

  return { update, els };
}
