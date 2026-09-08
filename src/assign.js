import { clearAssignments, bulkInsertPatches } from './db.js';
import { hash32 } from './encoding.js';

/**
 * Sort patches by angle around the seed, then outward.
 * Consecutive runs are thin pie slices spanning the biome's full radius.
 *
 * @param {Array} patches
 * @param {number} seedX
 * @param {number} seedY
 * @returns {Array} Sorted patches
 */
export function spiralSort(patches, seedX, seedY) {
  return patches.sort((a, b) => {
    const angleA = Math.atan2(a.y - seedY, a.x - seedX);
    const angleB = Math.atan2(b.y - seedY, b.x - seedX);
    if (angleA !== angleB) return angleA - angleB;
    return Math.hypot(a.x - seedX, a.y - seedY)
         - Math.hypot(b.x - seedX, b.y - seedY);
  });
}

/**
 * Sort patches by distance from the seed, then by angle.
 * Consecutive runs are annular bands, stacking outward like tree rings.
 *
 * @param {Array} patches
 * @param {number} seedX
 * @param {number} seedY
 * @returns {Array} Sorted patches
 */
export function ringSort(patches, seedX, seedY) {
  return patches.sort((a, b) => {
    const distA = Math.hypot(a.x - seedX, a.y - seedY);
    const distB = Math.hypot(b.x - seedX, b.y - seedY);
    if (distA !== distB) return distA - distB;
    return Math.atan2(a.y - seedY, a.x - seedX) - Math.atan2(b.y - seedY, b.x - seedX);
  });
}

/**
 * Position of (x, y) along a Hilbert curve of side `n` (a power of two).
 *
 * @param {number} n Curve side length
 * @param {number} x
 * @param {number} y
 * @returns {number} Distance along the curve
 */
export function hilbertIndex(n, x, y) {
  let rx, ry, d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    rx = (x & s) > 0 ? 1 : 0;
    ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate the quadrant so the curve stays continuous.
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x; x = y; y = t;
    }
  }
  return d;
}

/**
 * Sort patches along a Hilbert curve covering the biome.
 *
 * Any contiguous run of a Hilbert curve is a compact blob, so a consecutive
 * slice gives a file one clump rather than a wedge or a ring. The curve covers
 * the smallest enclosing power-of-two square, so any biome shape works.
 *
 * @param {Array} patches
 * @returns {Array} Sorted patches
 */
export function hilbertSort(patches) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of patches) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let n = 1;
  while (n < Math.max(maxX - minX, maxY - minY) + 1) n <<= 1;

  return patches
    .map(p => ({ p, d: hilbertIndex(n, p.x - minX, p.y - minY) }))
    .sort((a, b) => (a.d - b.d) || (a.p.y - b.p.y) || (a.p.x - b.p.x))
    .map(e => e.p);
}

/**
 * Patch quota for each file, proportional to its share of the biome's lines.
 * Every file gets at least one patch so nothing can vanish entirely.
 *
 * @param {Array} files
 * @param {number} totalPatches
 * @returns {number[]} Quota per file, index-aligned with `files`
 */
export function computeQuotas(files, totalPatches) {
  const totalLines = files.reduce((sum, f) => sum + f.line_count, 0);
  if (totalLines <= 0) return files.map(() => 0);
  return files.map(f => Math.max(1, Math.round((f.line_count / totalLines) * totalPatches)));
}

/**
 * Walk a sorted patch list, handing each file a consecutive run.
 *
 * This couples every file's position to every file before it: a new file shifts
 * the cursor and everything after it moves. Use `growClusters` when layout
 * stability across commits matters.
 *
 * @param {Array} files
 * @param {Array} ordered Patches in the desired traversal order
 * @returns {Array<{fileIndex: number, x: number, y: number}>}
 */
export function assignInOrder(files, ordered) {
  const total = ordered.length;
  const quotas = computeQuotas(files, total);
  const out = [];

  let cursor = 0;
  for (let i = 0; i < files.length; i++) {
    if (cursor < total) {
      const end = Math.min(total, cursor + quotas[i]);
      for (let p = cursor; p < end; p++) {
        out.push({ fileIndex: i, x: ordered[p].x, y: ordered[p].y });
      }
      cursor += quotas[i];
    } else {
      // Out of room: fall back to a shared patch so the file still exists.
      const p = ordered[i % total];
      out.push({ fileIndex: i, x: p.x, y: p.y });
    }
  }
  return out;
}

/**
 * A file's preferred position inside its biome, derived only from its path.
 *
 * Because the anchor depends on nothing but the file's own name, adding or
 * deleting a file cannot move any other file's anchor.
 *
 * @param {string} filePath
 * @param {{minX: number, minY: number, spanX: number, spanY: number}} box
 * @returns {{x: number, y: number}}
 */
export function anchorFor(filePath, box) {
  const h = hash32(filePath);
  // Two independent 16-bit halves of the hash, as fractions of the bounding box.
  const fx = (h & 0xffff) / 0x10000;
  const fy = ((h >>> 16) & 0xffff) / 0x10000;
  return {
    x: Math.round(box.minX + fx * box.spanX),
    y: Math.round(box.minY + fy * box.spanY)
  };
}

/**
 * Push anchors apart so that files have room to grow to their quota.
 *
 * Raw hash positions clump like any random scatter, leaving big files anchored
 * on top of each other; one then gets enveloped and never spends its quota.
 *
 * Displacements are computed from the previous round and applied all at once,
 * so the result never depends on the order files are visited.
 *
 * @param {Array<{x: number, y: number}>} anchors Starting positions
 * @param {number[]} quotas Patch quota per file, index-aligned
 * @param {{minX: number, minY: number, spanX: number, spanY: number}} box
 * @param {number} [rounds]
 * @returns {Array<{x: number, y: number}>} Relaxed positions
 */
export function relaxAnchors(anchors, quotas, box, rounds = 12) {
  // A region of q patches occupies a disc of radius sqrt(q / PI).
  const radius = quotas.map(q => Math.sqrt(Math.max(1, q) / Math.PI));
  let current = anchors.map(a => ({ x: a.x, y: a.y }));

  for (let round = 0; round < rounds; round++) {
    const shift = current.map(() => ({ x: 0, y: 0 }));
    let moved = false;

    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const needed = radius[i] + radius[j];
        let dx = current[j].x - current[i].x;
        let dy = current[j].y - current[i].y;
        let dist = Math.hypot(dx, dy);

        if (dist >= needed) continue;
        if (dist === 0) {
          // Exactly coincident: separate along a fixed axis rather than a
          // random one, so the outcome stays reproducible.
          dx = 1; dy = 0; dist = 1;
        }
        const push = (needed - dist) / 2;
        const ux = dx / dist, uy = dy / dist;
        shift[i].x -= ux * push; shift[i].y -= uy * push;
        shift[j].x += ux * push; shift[j].y += uy * push;
        moved = true;
      }
    }

    if (!moved) break;

    current = current.map((a, i) => ({
      x: Math.min(box.minX + box.spanX, Math.max(box.minX, a.x + shift[i].x)),
      y: Math.min(box.minY + box.spanY, Math.max(box.minY, a.y + shift[i].y))
    }));
  }

  return current.map(a => ({ x: Math.round(a.x), y: Math.round(a.y) }));
}

/** Minimal binary heap ordered by a supplied comparator. */
class Heap {
  constructor(compare) { this.items = []; this.compare = compare; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(a[parent], a[i]) <= 0) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let small = i;
        if (l < a.length && this.compare(a[l], a[small]) < 0) small = l;
        if (r < a.length && this.compare(a[r], a[small]) < 0) small = r;
        if (small === i) break;
        [a[small], a[i]] = [a[i], a[small]];
        i = small;
      }
    }
    return top;
  }
}

const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Growth passes. Extra passes correct each file's area error, but the
 * correction is derived from the whole biome, so it couples every file to every
 * other one. Measured here, four passes cut the worst area error from 109% to
 * 72% but tripled how far a file moves when a neighbour appears — stability is
 * worth more than exact areas, so we take one pass.
 */
const GROWTH_ROUNDS = 1;

/**
 * Grow each file outward from its own anchor until it fills its quota.
 *
 * Every anchor expands at once, each claiming the nearest unclaimed patch, so
 * files come out as compact blobs meeting along natural boundaries. Anchors
 * depend only on the file's own path, so adding or removing a file disturbs
 * only the ground around it.
 *
 * @param {Array} files
 * @param {Array} patches Patches belonging to this biome
 * @returns {Array<{fileIndex: number, x: number, y: number}>}
 */
export function growClusters(files, patches) {
  if (files.length === 0 || patches.length === 0) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of patches) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const box = { minX, minY, spanX: maxX - minX, spanY: maxY - minY };

  const quotas = computeQuotas(files, patches.length);
  const anchors = relaxAnchors(files.map(f => anchorFor(f.path, box)), quotas, box);

  // Frontier order: scaled distance, then file, then position. Every component
  // is compared explicitly so ties resolve identically on every run.
  const byPriority = (a, b) =>
    (a.reach - b.reach) || (a.fileIndex - b.fileIndex) || (a.y - b.y) || (a.x - b.x);

  // Big files advance faster, so they claim their share instead of being walled
  // in by small neighbours.
  let rate = quotas.map(q => Math.sqrt(Math.max(1, q)));

  let best = null;
  for (let round = 0; round < GROWTH_ROUNDS; round++) {
    const result = growOnce(files, patches, quotas, anchors, rate, byPriority, box);

    const error = result.counts.reduce(
      (worst, got, i) => Math.max(worst, Math.abs(got - quotas[i]) / quotas[i]), 0
    );
    if (!best || error < best.error) best = { ...result, error };
    if (error < 0.05 || round === GROWTH_ROUNDS - 1) break;

    // Files that came up short push harder next round; files that overshot
    // yield. The square root keeps the correction proportional to area.
    rate = rate.map((r, i) => {
      const got = result.counts[i] || 1;
      const correction = Math.sqrt(quotas[i] / got);
      return r * Math.min(2, Math.max(0.5, correction));
    });
  }

  return best.out;
}

/**
 * One expansion pass at the given per-file growth rates.
 * @returns {{out: Array, counts: number[]}}
 */
function growOnce(files, patches, quotas, anchors, rate, byPriority, box) {
  const free = new Map(); // "x,y" -> patch, for patches nobody has claimed yet
  for (const p of patches) free.set(`${p.x},${p.y}`, p);

  const remaining = quotas.slice();
  const counts = new Array(files.length).fill(0);
  const out = [];

  const claim = (fileIndex, x, y) => {
    free.delete(`${x},${y}`);
    remaining[fileIndex] -= 1;
    counts[fileIndex] += 1;
    out.push({ fileIndex, x, y });
  };

  // Nearest free patch to a point, by expanding square rings around it.
  const nearestFree = (x, y) => {
    if (free.has(`${x},${y}`)) return free.get(`${x},${y}`);
    const reach = Math.max(box.spanX, box.spanY) + 1;
    for (let r = 1; r <= reach; r++) {
      let found = null;
      let foundSort = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
          const hit = free.get(`${x + dx},${y + dy}`);
          if (!hit) continue;
          // Deterministic tie-break, so the result never depends on Map order.
          const sort = (dx * dx + dy * dy) * 1e6 + (hit.y * 1e3 + hit.x);
          if (sort < foundSort) { foundSort = sort; found = hit; }
        }
      }
      if (found) return found;
    }
    return null;
  };

  // Every file plants its anchor first, so no file can be squeezed out.
  const heap = new Heap(byPriority);
  for (let i = 0; i < files.length; i++) {
    if (remaining[i] <= 0) continue;
    const start = nearestFree(anchors[i].x, anchors[i].y);
    if (!start) break; // biome is full
    claim(i, start.x, start.y);
    heap.push({ reach: 1 / rate[i], dist: 1, fileIndex: i, x: start.x, y: start.y });
  }

  const expand = (queue, capped) => {
    let progressed = false;
    while (queue.size > 0 && free.size > 0) {
      const node = queue.pop();
      if (capped && remaining[node.fileIndex] <= 0) continue;

      for (const [dx, dy] of NEIGHBOURS) {
        const nx = node.x + dx, ny = node.y + dy;
        if (!free.has(`${nx},${ny}`)) continue;
        if (capped && remaining[node.fileIndex] <= 0) break;
        claim(node.fileIndex, nx, ny);
        progressed = true;
        const dist = node.dist + 1;
        queue.push({
          reach: dist / rate[node.fileIndex],
          dist, fileIndex: node.fileIndex, x: nx, y: ny
        });
      }
    }
    return progressed;
  };

  expand(heap, true);

  // Rounding and enveloped frontiers leave gaps. Offer them to under-quota
  // files first: handing them to whichever file happens to be adjacent lets a
  // big neighbour swallow a whole region and throws the areas out.
  const refill = (capped) => {
    if (free.size === 0) return false;
    const frontier = new Heap(byPriority);
    const seeded = new Set();
    for (const a of out) {
      if (capped && remaining[a.fileIndex] <= 0) continue;
      const key = `${a.x},${a.y}`;
      if (seeded.has(key)) continue;
      for (const [dx, dy] of NEIGHBOURS) {
        if (free.has(`${a.x + dx},${a.y + dy}`)) {
          seeded.add(key);
          frontier.push({ reach: 0, dist: 0, fileIndex: a.fileIndex, x: a.x, y: a.y });
          break;
        }
      }
    }
    return expand(frontier, capped);
  };

  while (refill(true)) { /* keep offering gaps to files still under quota */ }
  refill(false);

  // Islands with no claimed neighbour go to the nearest anchor, so they still
  // land somewhere predictable.
  if (free.size > 0) {
    for (const key of [...free.keys()].sort()) {
      const [x, y] = key.split(',').map(Number);
      let pick = 0, pickDist = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const d = Math.hypot(anchors[i].x - x, anchors[i].y - y);
        if (d < pickDist) { pickDist = d; pick = i; }
      }
      claim(pick, x, y);
    }
  }

  return { out, counts };
}

/**
 * Perform a full assignment of files to patches.
 * @param {Database} db 
 * @param {Map} biomePatches 
 * @param {Array} seeds 
 * @param {string} [layout] 'grow' (default), 'hilbert', 'ring' or 'wedge'
 */
export function fullAssignment(db, biomePatches, seeds, layout = 'grow') {
  db.transaction(() => {
    clearAssignments(db);

    for (const seed of seeds) {
      const patches = biomePatches.get(seed.biome);
      if (!patches || patches.length === 0) continue;

      const files = db.prepare(
        'SELECT id, path, line_count FROM files WHERE biome = ? ORDER BY path ASC'
      ).all(seed.biome);
      if (files.length === 0) continue;

      let placements;
      if (layout === 'wedge') {
        placements = assignInOrder(files, spiralSort([...patches], seed.cx, seed.cy));
      } else if (layout === 'ring') {
        placements = assignInOrder(files, ringSort([...patches], seed.cx, seed.cy));
      } else if (layout === 'hilbert') {
        placements = assignInOrder(files, hilbertSort([...patches]));
      } else {
        placements = growClusters(files, patches);
      }

      const rows = placements.map(p => ({ fileId: files[p.fileIndex].id, px: p.x, py: p.y }));
      if (rows.length > 0) bulkInsertPatches(db, rows);
    }
  }).immediate();
}
