// Every sound in the game, synthesized with WebAudio: no audio files, no
// network. One shared noise buffer, one master gain, one mute flag. All
// functions are safe to call before the context exists (they no-op until the
// first user gesture creates it).
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function noise(dur, filterFreq, type, gain, when = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Gunshot: a sharp crack plus a low thump. `near` is 1 for your own gun. */
export function sfxShot(kind, near) {
  if (!ctx) return;
  const g = near ? 0.5 : 0.16;
  if (kind === 'sniper') {
    noise(0.28, 900, 'lowpass', g);
    noise(0.08, 4000, 'highpass', g * 0.7);
    tone(160, 0.18, 'sine', g * 0.5, 50);
  } else if (kind === 'smg') {
    noise(0.09, 1800, 'bandpass', g * 0.9);
    tone(220, 0.07, 'square', g * 0.25, 90);
  } else if (kind === 'pistol') {
    noise(0.11, 2200, 'bandpass', g);
    tone(200, 0.08, 'square', g * 0.3, 80);
  } else {
    noise(0.14, 1400, 'bandpass', g);
    tone(180, 0.1, 'square', g * 0.35, 70);
  }
}

export function sfxDry() {
  tone(1400, 0.04, 'square', 0.12);
}

export function sfxReload() {
  tone(500, 0.05, 'square', 0.12);
  tone(700, 0.05, 'square', 0.12, 0, 0.18);
  tone(420, 0.06, 'square', 0.14, 0, 0.45);
}

export function sfxHit() {
  tone(2200, 0.05, 'sine', 0.2, 1600);
}

export function sfxKill() {
  tone(880, 0.09, 'sine', 0.22);
  tone(1320, 0.12, 'sine', 0.2, 0, 0.08);
}

export function sfxHurt() {
  tone(140, 0.18, 'sawtooth', 0.25, 70);
  noise(0.12, 500, 'lowpass', 0.2);
}

export function sfxStep(run) {
  noise(0.06, 300, 'lowpass', run ? 0.1 : 0.06);
}

export function sfxPlantTick(final) {
  tone(final ? 1200 : 900, 0.07, 'square', 0.16);
}

export function sfxPlantDone() {
  tone(660, 0.12, 'square', 0.2);
  tone(990, 0.16, 'square', 0.2, 0, 0.12);
}

export function sfxExplosion() {
  noise(1.1, 300, 'lowpass', 0.9);
  noise(0.5, 1200, 'bandpass', 0.4);
  tone(70, 0.9, 'sine', 0.7, 28);
}

export function sfxGrenadePin() {
  tone(1800, 0.03, 'square', 0.1);
}

export function sfxBounce() {
  tone(300, 0.05, 'sine', 0.12, 180);
}

export function sfxBuy() {
  tone(980, 0.06, 'sine', 0.18);
  tone(1470, 0.08, 'sine', 0.16, 0, 0.06);
}

export function sfxRoundWin() {
  const notes = [523, 659, 784];
  notes.forEach((f, i) => tone(f, 0.16, 'triangle', 0.22, 0, i * 0.12));
}

export function sfxRoundLose() {
  const notes = [392, 330, 262];
  notes.forEach((f, i) => tone(f, 0.18, 'triangle', 0.2, 0, i * 0.13));
}

export function sfxClick() {
  tone(1200, 0.03, 'square', 0.1);
}
