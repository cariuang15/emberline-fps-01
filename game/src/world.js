// Kestrel Yard: the map. Pure data and geometry queries — no three.js here,
// so the simulation can run without a renderer. Everything is an axis-aligned
// box; fighters collide as AABBs and every ray is a slab test.
//
// Layout (x east, z south, metres; the yard is 64 x 48):
//   Foundry (site A) west, Silo (site B) east, three lanes between them:
//   top lane (z -18), mid (z 0) through a container maze, bottom lane (z +18).
//   Vanguard spawns south-west, Sentinel north-east.

export const MAP = { x0: -32, x1: 32, z0: -24, z1: 24, wallH: 5 };

export const SITES = [
  { id: 'A', name: 'Foundry', x: -26, z: -8, r: 5 },
  { id: 'B', name: 'Silo', x: 26, z: 8, r: 5 },
];

export const SPAWNS = {
  vanguard: [
    { x: -29, z: 18, yaw: -Math.PI / 2 },
    { x: -28, z: 15, yaw: -Math.PI / 2 },
    { x: -30, z: 13, yaw: -Math.PI / 2 },
    { x: -27, z: 20, yaw: -Math.PI / 2 },
  ],
  sentinel: [
    { x: 29, z: -18, yaw: Math.PI / 2 },
    { x: 28, z: -15, yaw: Math.PI / 2 },
    { x: 30, z: -13, yaw: Math.PI / 2 },
    { x: 27, z: -20, yaw: Math.PI / 2 },
  ],
};

// One box: {x0,z0,x1,z1,y0,y1, color, kind}. kind: 'wall' | 'container' |
// 'crate' (low, 1.2 m: crouch cover you can shoot over standing).
export const BOXES = [
  // Border walls
  { x0: -32, z0: -24, x1: 32, z1: -23, y0: 0, y1: 5, color: 0x47505a, kind: 'wall' },
  { x0: -32, z0: 23, x1: 32, z1: 24, y0: 0, y1: 5, color: 0x47505a, kind: 'wall' },
  { x0: -32, z0: -24, x1: -31, z1: 24, y0: 0, y1: 5, color: 0x47505a, kind: 'wall' },
  { x0: 31, z0: -24, x1: 32, z1: 24, y0: 0, y1: 5, color: 0x47505a, kind: 'wall' },
  // Site A (Foundry) — silo core, containers, cover
  { x0: -27.5, z0: -9.5, x1: -24.5, z1: -6.5, y0: 0, y1: 6, color: 0x8a6d3b, kind: 'wall' },
  { x0: -30, z0: -15.2, x1: -24, z1: -12.8, y0: 0, y1: 2.8, color: 0x2f6f6a, kind: 'container' },
  { x0: -23, z0: -7, x1: -21, z1: -5, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  { x0: -20, z0: -12.5, x1: -16, z1: -11.5, y0: 0, y1: 3, color: 0x5b6572, kind: 'wall' },
  { x0: -28, z0: 0.8, x1: -24, z1: 3.2, y0: 0, y1: 2.6, color: 0xb05a2a, kind: 'container' },
  // Site B (Silo)
  { x0: 24.5, z0: 6.5, x1: 27.5, z1: 9.5, y0: 0, y1: 6, color: 0x8a6d3b, kind: 'wall' },
  { x0: 24, z0: 10.8, x1: 30, z1: 13.2, y0: 0, y1: 2.8, color: 0x2f6f6a, kind: 'container' },
  { x0: 21, z0: 5, x1: 23, z1: 7, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  { x0: 16, z0: 11.5, x1: 20, z1: 12.5, y0: 0, y1: 3, color: 0x5b6572, kind: 'wall' },
  { x0: 24, z0: -3.2, x1: 28, z1: -0.8, y0: 0, y1: 2.6, color: 0xb05a2a, kind: 'container' },
  // Mid container maze
  { x0: -4, z0: -7.3, x1: 4, z1: -4.7, y0: 0, y1: 3.2, color: 0x2f6f6a, kind: 'container' },
  { x0: -4, z0: 4.7, x1: 4, z1: 7.3, y0: 0, y1: 3.2, color: 0x2f6f6a, kind: 'container' },
  { x0: -9, z0: -1, x1: -7, z1: 1, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  { x0: 7, z0: -1, x1: 9, z1: 1, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  { x0: -12.5, z0: -12, x1: -11.5, z1: -8, y0: 0, y1: 4, color: 0x5b6572, kind: 'wall' },
  { x0: 11.5, z0: 8, x1: 12.5, z1: 12, y0: 0, y1: 4, color: 0x5b6572, kind: 'wall' },
  // Top lane (z -18)
  { x0: -17.2, z0: -19.2, x1: -14.8, z1: -16.8, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  { x0: 1.5, z0: -19.2, x1: 6.5, z1: -16.8, y0: 0, y1: 2.8, color: 0xb05a2a, kind: 'container' },
  { x0: 17, z0: -19, x1: 19, z1: -17, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  // Bottom lane (z +18)
  { x0: -19, z0: 17, x1: -17, z1: 19, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  { x0: -6.5, z0: 16.8, x1: -1.5, z1: 19.2, y0: 0, y1: 2.8, color: 0xb05a2a, kind: 'container' },
  { x0: 14.8, z0: 16.8, x1: 17.2, z1: 19.2, y0: 0, y1: 1.2, color: 0x7a6a4f, kind: 'crate' },
  // Connector walls (partial, with gaps at the ends)
  { x0: -11, z0: -16.5, x1: -5, z1: -15.5, y0: 0, y1: 3, color: 0x5b6572, kind: 'wall' },
  { x0: 5, z0: 15.5, x1: 11, z1: 16.5, y0: 0, y1: 3, color: 0x5b6572, kind: 'wall' },
];

// Nav graph: waypoints bots walk between. Edges are built at load: two nodes
// link when the straight segment between them clears every solid box.
const NAV_NODES = [
  [-29, 18], [-20, 12], [-14, 6], [-24, -4], [-22, -8], [14, 10], [22, 8],
  [-20, -18], [12, -18], [20, -18], [-10, 18], [14, 18], [-2, 0], [10, 0],
  [-10, 0], [29, -18], [20, -12], [14, -6], [-14, -12], [24, 4], [18, -8],
  [-18, 8], [8, -18], [-8, 18], [-26, 14], [26, -14],
];

function segmentHitsBox(ax, az, bx, bz, box, clearance) {
  // 2D segment vs expanded AABB, slab test on the segment parameter.
  const x0 = box.x0 - clearance, x1 = box.x1 + clearance;
  const z0 = box.z0 - clearance, z1 = box.z1 + clearance;
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < x0 || ax > x1) return false;
  } else {
    let a = (x0 - ax) / dx, b = (x1 - ax) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < z0 || az > z1) return false;
  } else {
    let a = (z0 - az) / dz, b = (z1 - az) / dz;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

export function buildNav() {
  const nodes = NAV_NODES.map(([x, z]) => ({ x, z, edges: [] }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      if (Math.hypot(dx, dz) > 26) continue; // keep edges local
      let blocked = false;
      for (const box of BOXES) {
        if (box.y1 < 1.0) continue; // low crates do not block walking
        if (segmentHitsBox(a.x, a.z, b.x, b.z, box, 0.5)) { blocked = true; break; }
      }
      if (!blocked) {
        const d = Math.hypot(dx, dz);
        a.edges.push({ to: j, cost: d });
        b.edges.push({ to: i, cost: d });
      }
    }
  }
  return nodes;
}

/** Nearest nav node index to (x, z). */
export function nearestNode(nodes, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** A* over the nav graph. Returns an array of node indices, start included. */
export function findPath(nodes, from, to) {
  if (from === to) return [from];
  const open = [{ node: from, f: 0 }];
  const came = new Map([[from, -1]]);
  const g = new Map([[from, 0]]);
  const hx = (i) => Math.hypot(nodes[i].x - nodes[to].x, nodes[i].z - nodes[to].z);
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0].node;
    if (cur === to) {
      const path = [];
      let n = cur;
      while (n !== -1) { path.push(n); n = came.get(n); }
      return path.reverse();
    }
    for (const e of nodes[cur].edges) {
      const ng = g.get(cur) + e.cost;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng);
        came.set(e.to, cur);
        open.push({ node: e.to, f: ng + hx(e.to) });
      }
    }
  }
  return [from];
}

// ---------------------------------------------------------------- rays

/** Ray vs one AABB, slab test. Returns distance along the ray, or Infinity. */
export function rayBox(ox, oy, oz, dx, dy, dz, box, maxDist) {
  let t0 = 0, t1 = maxDist;
  // X
  if (Math.abs(dx) < 1e-9) {
    if (ox < box.x0 || ox > box.x1) return Infinity;
  } else {
    let a = (box.x0 - ox) / dx, b = (box.x1 - ox) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  // Y
  if (Math.abs(dy) < 1e-9) {
    if (oy < box.y0 || oy > box.y1) return Infinity;
  } else {
    let a = (box.y0 - oy) / dy, b = (box.y1 - oy) / dy;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  // Z
  if (Math.abs(dz) < 1e-9) {
    if (oz < box.z0 || oz > box.z1) return Infinity;
  } else {
    let a = (box.z0 - oz) / dz, b = (box.z1 - oz) / dz;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Nearest world hit along a ray, or Infinity. `smoke` is an optional list of {x,y,z,r} spheres that block sight. */
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist, smoke) {
  let best = Infinity;
  for (const box of BOXES) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, box, maxDist);
    if (t < best) best = t;
  }
  if (smoke) {
    for (const s of smoke) {
      // Ray vs sphere, geometric test.
      const cx = s.x - ox, cy = s.y - oy, cz = s.z - oz;
      const proj = cx * dx + cy * dy + cz * dz;
      if (proj < 0 || proj > maxDist) continue;
      const d2 = cx * cx + cy * cy + cz * cz - proj * proj;
      if (d2 < s.r * s.r) {
        const t = proj - Math.sqrt(Math.max(0, s.r * s.r - d2));
        if (t < best) best = t;
      }
    }
  }
  return best;
}

/** Line of sight between two points at eye height, blocked by world or smoke. */
export function hasLOS(ax, ay, az, bx, by, bz, smoke) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const t = rayWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05, smoke);
  return t === Infinity;
}

/** Move an AABB (feet position, half extents hx/hz, height h) with per-axis
 *  resolution against the world. Mutates and returns `pos`. */
export function moveAABB(pos, vel, dt, hx, hz, h) {
  // X axis
  pos.x += vel.x * dt;
  for (const b of BOXES) {
    if (pos.y + h <= b.y0 || pos.y >= b.y1) continue;
    if (pos.x + hx > b.x0 && pos.x - hx < b.x1 && pos.z + hz > b.z0 && pos.z - hz < b.z1) {
      if (vel.x > 0) pos.x = b.x0 - hx;
      else if (vel.x < 0) pos.x = b.x1 + hx;
    }
  }
  if (pos.x < MAP.x0 + hx) pos.x = MAP.x0 + hx;
  if (pos.x > MAP.x1 - hx) pos.x = MAP.x1 - hx;
  // Z axis
  pos.z += vel.z * dt;
  for (const b of BOXES) {
    if (pos.y + h <= b.y0 || pos.y >= b.y1) continue;
    if (pos.x + hx > b.x0 && pos.x - hx < b.x1 && pos.z + hz > b.z0 && pos.z - hz < b.z1) {
      if (vel.z > 0) pos.z = b.z0 - hz;
      else if (vel.z < 0) pos.z = b.z1 + hz;
    }
  }
  if (pos.z < MAP.z0 + hz) pos.z = MAP.z0 + hz;
  if (pos.z > MAP.z1 - hz) pos.z = MAP.z1 - hz;
  // Y axis (ground only; no vertical obstacles to land on)
  pos.y += vel.y * dt;
  if (pos.y <= 0) { pos.y = 0; vel.y = 0; }
  return pos;
}

/** Is (x, z) inside a bomb site? Returns the site or null. */
export function siteAt(x, z) {
  for (const s of SITES) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d <= s.r) return s;
  }
  return null;
}
