import test from 'node:test';
import assert from 'node:assert';
import { blendColor, renderGarden } from '../src/render.js';
import { openDb, upsertFile, bulkInsertPatches } from '../src/db.js';
import fs from 'fs';
import path from 'path';

const testRepoRoot = path.join(process.cwd(), 'test-repo-render');

test('PNG rendering logic', async (t) => {
  await t.test('blendColor', () => {
    const biomeColor = [255, 255, 255];
    const withered = [110, 80, 40];
    
    const mid = blendColor(biomeColor, 50, 100);
    assert.strictEqual(mid[0], Math.round((255 + 110) / 2));
    
    const full = blendColor(biomeColor, 100, 100);
    assert.deepStrictEqual(full, biomeColor);
    
    const dead = blendColor(biomeColor, 0, 100);
    assert.deepStrictEqual(dead, withered);
  });

  await t.test('renderGarden creates a file', async () => {
    if (fs.existsSync(testRepoRoot)) fs.rmSync(testRepoRoot, { recursive: true });
    const db = openDb(testRepoRoot);
    
    const fileId = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    bulkInsertPatches(db, [{ fileId, px: 0, py: 0 }]);
    
    const config = { width: 16, height: 16, max_score: 100 };
    const biomeColors = { 'grass': [0, 255, 0] };
    const baseColor = [0, 0, 255];
    
    await renderGarden(db, config, biomeColors, baseColor, 4, 4, 4, testRepoRoot);
    
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'garden.png')));
    
    db.close();
    fs.rmSync(testRepoRoot, { recursive: true });
  });
});
