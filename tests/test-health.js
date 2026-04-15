import test from 'node:test';
import assert from 'node:assert';
import { computeHealth, applyHealthDeltas, applyPassiveDeterioration } from '../src/health.js';
import { openDb, upsertFile } from '../src/db.js';
import fs from 'fs';
import path from 'path';

const testRepoRoot = path.join(process.cwd(), 'test-repo-health');

test('Health scoring logic', async (t) => {
  await t.test('computeHealth', () => {
    // Growth
    assert.strictEqual(computeHealth(100, 50, 0, 200), 105); // round(50/10) = 5
    assert.strictEqual(computeHealth(100, 250, 0, 200), 120); // capped at 20
    
    // Maintenance
    assert.strictEqual(computeHealth(100, 10, 10, 200), 105); // delta = 5
    
    // Decay
    assert.strictEqual(computeHealth(100, 0, 50, 200), 95); // round(50/10) = 5
    assert.strictEqual(computeHealth(100, 0, 200, 200), 90); // capped at 10
    
    // Clamp
    assert.strictEqual(computeHealth(5, 0, 100, 200), 0);
    assert.strictEqual(computeHealth(195, 200, 0, 200), 200);
  });

  await t.test('applyHealthDeltas and applyPassiveDeterioration', () => {
    if (fs.existsSync(testRepoRoot)) fs.rmSync(testRepoRoot, { recursive: true });
    const db = openDb(testRepoRoot);
    
    upsertFile(db, { path: 'file1.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    upsertFile(db, { path: 'file2.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    
    const diffStats = {
      'file1.js': { linesAdded: 100, linesRemoved: 0 }
    };
    
    applyHealthDeltas(db, diffStats, 200);
    
    const file1 = db.prepare('SELECT health FROM files WHERE path = ?').get('file1.js');
    assert.strictEqual(file1.health, 110);
    
    applyPassiveDeterioration(db, diffStats);
    const file2 = db.prepare('SELECT health FROM files WHERE path = ?').get('file2.js');
    assert.strictEqual(file2.health, 98); // 100 - 2
    
    db.close();
    fs.rmSync(testRepoRoot, { recursive: true });
  });
});
