import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadConfig, deriveGridConstants } from '../src/config.js';
import { openDb } from '../src/db.js';

const testRepoRoot = path.join(process.cwd(), 'test-repo-config');

test('Configuration loading', async (t) => {
  if (fs.existsSync(testRepoRoot)) {
    fs.rmSync(testRepoRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(testRepoRoot);
  const db = openDb(testRepoRoot);

  await t.test('loadConfig with defaults', () => {
    const result = loadConfig(testRepoRoot, db);
    assert.strictEqual(result.config.width, 512);
    assert.strictEqual(result.config.height, 512);
    assert.ok(result.biomeColors.grass);
    assert.strictEqual(result.configChanged, true); // Since DB is empty
  });

  await t.test('loadConfig with user config', () => {
    const userConfig = {
      width: 1024,
      height: 768,
      max_score: 500
    };
    fs.writeFileSync(path.join(testRepoRoot, '.gitgarden', 'config.yaml'), yaml.dump(userConfig));
    
    const result = loadConfig(testRepoRoot, db);
    assert.strictEqual(result.config.width, 1024);
    assert.strictEqual(result.config.height, 768);
    assert.strictEqual(result.config.max_score, 500);
  });

  await t.test('deriveGridConstants', () => {
    const config = { width: 512, height: 512 };
    const constants = deriveGridConstants(config);
    assert.strictEqual(constants.PATCH_SIZE, 4);
    assert.strictEqual(constants.gridW, 128);
    assert.strictEqual(constants.gridH, 128);
    assert.strictEqual(constants.totalPatches, 128 * 128);
  });

  db.close();
  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
