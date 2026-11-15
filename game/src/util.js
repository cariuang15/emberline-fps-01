// Small helpers shared by every module. No allocations in the hot paths:
// callers pass scratch objects where the note says so.
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** Smallest signed turn from angle `from` to angle `to`. */
export function angleDelta(from, to) {
  return wrapAngle(to - from);
}

/** A seeded RNG (mulberry32) so staged scenes and bot behaviour are repeatable. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one of `list` with rng(). */
export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

/** A 3D vector scratch pad: three reusable vectors, so hot loops allocate nothing. */
export function makeScratch() {
  return {
    a: { x: 0, y: 0, z: 0 },
    b: { x: 0, y: 0, z: 0 },
    c: { x: 0, y: 0, z: 0 },
  };
}
