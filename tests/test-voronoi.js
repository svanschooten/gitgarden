import test from 'node:test';
import assert from 'node:assert';
import { openDb, upsertFile } from '../src/db.js';
import { initBiomeSeeds, computeSeedWeights, computeVoronoiMap, extractBiomePatches } from '../src/voronoi.js';
import fs from 'fs';
import path from 'path';

const testRepoRoot = path.join(process.cwd(), 'test-repo-voronoi');

test('Voronoi biome map logic', async (t) => {
  if (fs.existsSync(testRepoRoot)) fs.rmSync(testRepoRoot, { recursive: true });
  const db = openDb(testRepoRoot);

  const biomes = ['grass', 'lavender', 'dirt'];
  const config = { width: 400, height: 400, min_distance: 50 };
  const PATCH_SIZE = 4;

  await t.test('initBiomeSeeds creates seeds', () => {
    initBiomeSeeds(db, biomes, config, PATCH_SIZE, false);
    const seeds = db.prepare('SELECT * FROM biome_seeds').all();
    assert.strictEqual(seeds.length, 3);
  });

  await t.test('computeSeedWeights respects file counts', () => {
    // Add files to biomes
    upsertFile(db, { path: 'f1.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    upsertFile(db, { path: 'f2.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    upsertFile(db, { path: 'f3.py', biome: 'lavender', line_count: 10, health: 100, last_merge: 0 });
    // Total 3 files. grass: 2, lavender: 1, dirt: 0
    
    const weightedSeeds = computeSeedWeights(db);
    const grass = weightedSeeds.find(s => s.biome === 'grass');
    const lavender = weightedSeeds.find(s => s.biome === 'lavender');
    const dirt = weightedSeeds.find(s => s.biome === 'dirt');
    
    assert.ok(grass.weight > lavender.weight);
    assert.strictEqual(dirt.weight, 0.1); // Min weight
  });

  await t.test('computeVoronoiMap and extractBiomePatches', () => {
    const seeds = [
      { biome: 'grass', cx: 0, cy: 0, weight: 1.0 },
      { biome: 'lavender', cx: 10, cy: 10, weight: 1.0 }
    ];
    const { biomeMap, biomes } = computeVoronoiMap(seeds, 11, 11);
    assert.strictEqual(biomeMap[0], 0); // (0,0) belongs to grass
    assert.strictEqual(biomeMap[10 * 11 + 10], 1); // (10,10) belongs to lavender
    
    const patches = extractBiomePatches(biomeMap, biomes, 11, 11);
    assert.ok(patches.get('grass').length > 0);
    assert.ok(patches.get('lavender').length > 0);
    assert.strictEqual(patches.get('grass').length + patches.get('lavender').length, 121);
  });

  db.close();
  fs.rmSync(testRepoRoot, { recursive: true });
});
