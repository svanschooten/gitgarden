import test from 'node:test';
import assert from 'node:assert';
import { openDb, upsertFile } from '../src/db.js';
import { spiralSort, fullAssignment } from '../src/assign.js';
import fs from 'fs';
import path from 'path';

const testRepoRoot = path.join(process.cwd(), 'test-repo-assign');

test('File-to-patch assignment', async (t) => {
  if (fs.existsSync(testRepoRoot)) fs.rmSync(testRepoRoot, { recursive: true });
  const db = openDb(testRepoRoot);

  await t.test('spiralSort', () => {
    const patches = [
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 }
    ];
    // Seed at (0.5, 0.5)
    const sorted = spiralSort([...patches], 0.5, 0.5);
    assert.strictEqual(sorted.length, 4);
    // atan2(1-0.5, 1-0.5) = 0.785
    // atan2(1-0.5, 0-0.5) = 2.356
    // atan2(0-0.5, 1-0.5) = -0.785
    // atan2(0-0.5, 0-0.5) = -2.356
    
    // -2.356, -0.785, 0.785, 2.356
    assert.strictEqual(sorted[0].x, 0); assert.strictEqual(sorted[0].y, 0);
    assert.strictEqual(sorted[1].x, 1); assert.strictEqual(sorted[1].y, 0);
    assert.strictEqual(sorted[2].x, 1); assert.strictEqual(sorted[2].y, 1);
    assert.strictEqual(sorted[3].x, 0); assert.strictEqual(sorted[3].y, 1);
  });

  await t.test('fullAssignment', () => {
    const fileId = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    const seeds = [{ biome: 'grass', cx: 0, cy: 0, weight: 1.0 }];
    const biomePatches = new Map([['grass', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]]]);
    
    fullAssignment(db, biomePatches, seeds, 0.5); // Fill factor 0.5
    
    // totalPatches = 4. 0.5 * 4 = 2 patches expected for file.
    const assigned = db.prepare('SELECT COUNT(*) as count FROM file_patches WHERE file_id = ?').get(fileId);
    assert.strictEqual(assigned.count, 2);
    
    const vacant = db.prepare('SELECT COUNT(*) as count FROM vacant_patches WHERE biome = ?').get('grass');
    assert.strictEqual(vacant.count, 2);
  });

  db.close();
  fs.rmSync(testRepoRoot, { recursive: true });
});
