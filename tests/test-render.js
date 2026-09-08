import test from 'node:test';
import assert from 'node:assert';
import { PNG } from 'pngjs';
import { renderGarden } from '../src/render.js';
import { openDb, upsertFile, bulkInsertPatches, closeDb } from '../src/db.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';

const testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-render-'));

test('PNG rendering', async (t) => {
  await t.test('renderGarden draws borders between neighbouring files', async () => {
    const db = openDb(testRepoRoot);

    const a = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    const b = upsertFile(db, { path: 'b.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
    bulkInsertPatches(db, [{ fileId: a, px: 0, py: 0 }, { fileId: b, px: 1, py: 0 }]);

    const config = { width: 16, height: 16, max_score: 100 };
    const biomeColors = { grass: [0, 255, 0] };

    await renderGarden(db, config, biomeColors, [0, 0, 255], 4, 4, 4, testRepoRoot);

    const pngPath = path.join(testRepoRoot, '.gitgarden', 'garden.png');
    assert.ok(fs.existsSync(pngPath));

    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const at = (x, y) => {
      const i = (y * config.width + x) << 2;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };

    // Patch (0,0) spans x 0-3; its right-hand column touches a different file.
    const interior = at(1, 1);
    const border = at(3, 1);
    assert.notDeepStrictEqual(border, interior, 'file boundary is drawn darker');
    assert.ok(border[1] < interior[1], 'the border is a shaded version of the fill');

    // The two files are the same biome and health but must not be identical.
    assert.notDeepStrictEqual(at(1, 1), at(5, 1), 'each file gets its own shade');

    closeDb(db);
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
