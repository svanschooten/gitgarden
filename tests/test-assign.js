import test from 'node:test';
import assert from 'node:assert';
import { openDb, upsertFile, closeDb } from '../src/db.js';
import {
  spiralSort, ringSort, hilbertSort, hilbertIndex,
  computeQuotas, anchorFor, relaxAnchors, growClusters, fullAssignment
} from '../src/assign.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';

const testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-assign-'));

/** A square block of patches. */
function block(size) {
  const out = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.push({ x, y });
  return out;
}

/** How many disconnected pieces does each file's region break into? */
function pieces(cells) {
  const set = new Set(cells.map(c => `${c.x},${c.y}`));
  const seen = new Set();
  let count = 0;
  for (const key of set) {
    if (seen.has(key)) continue;
    count++;
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const [x, y] = stack.pop().split(',').map(Number);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const k = `${x + dx},${y + dy}`;
        if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
  }
  return count;
}

function makeFiles(spec) {
  return spec.map(([p, lines], i) => ({ id: i + 1, path: p, line_count: lines }));
}

test('File-to-patch assignment', async (t) => {
  const db = openDb(testRepoRoot);

  await t.test('spiralSort orders by angle then distance', () => {
    const sorted = spiralSort(
      [{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }], 0.5, 0.5
    );
    assert.deepStrictEqual(
      sorted.map(p => [p.x, p.y]),
      [[0, 0], [1, 0], [1, 1], [0, 1]]
    );
  });

  await t.test('ringSort orders outward from the seed', () => {
    const patches = [{ x: 5, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }];
    const sorted = ringSort(patches, 0, 0);
    assert.deepStrictEqual(sorted.map(p => p.x), [1, 3, 5]);
  });

  await t.test('hilbertIndex covers the square exactly once', () => {
    const seen = new Set();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) seen.add(hilbertIndex(8, x, y));
    }
    assert.strictEqual(seen.size, 64, 'every cell gets a distinct index');
    assert.strictEqual(Math.min(...seen), 0);
    assert.strictEqual(Math.max(...seen), 63);
  });

  await t.test('hilbertSort keeps consecutive runs adjacent', () => {
    const sorted = hilbertSort(block(8));
    for (let i = 1; i < sorted.length; i++) {
      const step = Math.abs(sorted[i].x - sorted[i - 1].x) + Math.abs(sorted[i].y - sorted[i - 1].y);
      assert.strictEqual(step, 1, `step ${i} moves to a neighbouring patch`);
    }
  });

  await t.test('computeQuotas splits by line count and never starves a file', () => {
    const quotas = computeQuotas(makeFiles([['a', 90], ['b', 10], ['tiny', 1]]), 100);
    assert.strictEqual(quotas.length, 3);
    assert.ok(quotas[0] > quotas[1], 'bigger file gets more ground');
    assert.ok(quotas[2] >= 1, 'a one-line file still gets a patch');
    assert.deepStrictEqual(computeQuotas(makeFiles([['a', 0]]), 100), [0]);
  });

  await t.test('anchorFor depends only on the path', () => {
    const box = { minX: 0, minY: 0, spanX: 100, spanY: 100 };
    const a = anchorFor('src/garden.js', box);
    assert.deepStrictEqual(a, anchorFor('src/garden.js', box), 'stable across calls');
    assert.notDeepStrictEqual(a, anchorFor('src/render.js', box));
    assert.ok(a.x >= 0 && a.x <= 100 && a.y >= 0 && a.y <= 100, 'lands inside the box');
  });

  await t.test('relaxAnchors separates crowded anchors deterministically', () => {
    const box = { minX: 0, minY: 0, spanX: 60, spanY: 60 };
    const crowded = [{ x: 30, y: 30 }, { x: 30, y: 30 }, { x: 31, y: 30 }];
    const quotas = [400, 400, 400];

    const relaxed = relaxAnchors(crowded, quotas, box);
    assert.deepStrictEqual(relaxed, relaxAnchors(crowded, quotas, box), 'reproducible');

    for (let i = 0; i < relaxed.length; i++) {
      for (let j = i + 1; j < relaxed.length; j++) {
        const d = Math.hypot(relaxed[i].x - relaxed[j].x, relaxed[i].y - relaxed[j].y);
        assert.ok(d > 1, `anchors ${i} and ${j} were pushed apart (got ${d.toFixed(1)})`);
      }
    }
  });

  await t.test('growClusters gives every file one connected clump', () => {
    const files = makeFiles([
      ['big.js', 900], ['mid.js', 300], ['small.js', 60], ['tiny.js', 4]
    ]);
    const patches = block(40);
    const placed = growClusters(files, patches);

    assert.strictEqual(placed.length, patches.length, 'every patch is used exactly once');
    assert.strictEqual(new Set(placed.map(p => `${p.x},${p.y}`)).size, patches.length, 'no patch is claimed twice');

    for (let i = 0; i < files.length; i++) {
      const own = placed.filter(p => p.fileIndex === i);
      assert.ok(own.length >= 1, `${files[i].path} got ground`);
      assert.strictEqual(pieces(own), 1, `${files[i].path} is a single clump, not scattered`);
    }
  });

  await t.test('growClusters is deterministic', () => {
    const files = makeFiles([['a.js', 100], ['b.js', 50], ['c.js', 25]]);
    const first = growClusters(files, block(24));
    const second = growClusters(files, block(24));
    assert.deepStrictEqual(first, second);
  });

  await t.test('adding a file leaves the other files where they were', () => {
    // The property this layout exists to provide: a new file must not reshuffle
    // the garden. Anchors are derived from each file's own path, so the newcomer
    // displaces the ground around itself and nothing else.
    const spec = [
      ['src/alpha.js', 420], ['src/beta.js', 380], ['src/gamma.js', 310],
      ['src/delta.js', 260], ['src/epsilon.js', 200], ['src/zeta.js', 160],
      ['src/eta.js', 130], ['src/theta.js', 110], ['src/iota.js', 90],
      ['src/kappa.js', 70], ['src/lambda.js', 50], ['src/mu.js', 30],
      ['src/nu.js', 20], ['src/xi.js', 12], ['src/omicron.js', 6]
    ];
    const before = makeFiles(spec);
    const after = makeFiles([...spec, ['src/NEWCOMER.js', 100]]);
    const patches = block(64);

    const centreOf = (placed, files, name) => {
      const idx = files.findIndex(f => f.path === name);
      const own = placed.filter(p => p.fileIndex === idx);
      return {
        x: own.reduce((s, p) => s + p.x, 0) / own.length,
        y: own.reduce((s, p) => s + p.y, 0) / own.length
      };
    };

    const placedBefore = growClusters(before, patches);
    const placedAfter = growClusters(after, patches);

    const moves = spec.map(([name]) => {
      const p = centreOf(placedBefore, before, name);
      const q = centreOf(placedAfter, after, name);
      return Math.hypot(p.x - q.x, p.y - q.y);
    }).sort((a, b) => a - b);

    const median = moves[Math.floor(moves.length / 2)];
    const settled = moves.filter(m => m < 4).length;

    // The garden is 64 patches across; a typical file should barely twitch.
    assert.ok(median < 3, `typical file moved ${median.toFixed(1)} of 64 patches`);
    assert.ok(settled >= spec.length * 0.7,
      `${settled}/${spec.length} files stayed within 4 patches`);
    assert.ok(moves[moves.length - 1] < 20,
      `worst file moved ${moves[moves.length - 1].toFixed(1)} of 64 patches`);
  });

  await t.test('fullAssignment writes patches for each layout', () => {
    const fileId = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    const seeds = [{ biome: 'grass', cx: 0, cy: 0, weight: 1.0 }];
    const biomePatches = new Map([['grass', block(2)]]);

    for (const layout of ['grow', 'hilbert', 'ring', 'wedge']) {
      fullAssignment(db, biomePatches, seeds, layout);
      const count = db.prepare('SELECT COUNT(*) AS count FROM file_patches WHERE file_id = ?').get(fileId).count;
      assert.strictEqual(count, 4, `${layout} gave the only file all four patches`);
    }
  });

  closeDb(db);
  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
