import test from 'node:test';
import assert from 'node:assert';
import { PNG } from 'pngjs';
import { blendColor, fileColor, pathTint, hash32, stippleDensity, renderGarden } from '../src/render.js';
import { openDb, upsertFile, bulkInsertPatches, closeDb } from '../src/db.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';

const testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-render-'));

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

  await t.test('hash32 is stable and well distributed', () => {
    assert.strictEqual(hash32('src/garden.js'), hash32('src/garden.js'));
    assert.notStrictEqual(hash32('src/garden.js'), hash32('src/garden.ts'));
    assert.ok(hash32('') >= 0 && Number.isInteger(hash32('x')));
  });

  await t.test('pathTint separates files without leaving the palette', () => {
    const paths = ['src/a.js', 'src/b.js', 'src/c.js', 'README.md', 'x/y/z.py'];
    for (const p of paths) {
      const tint = pathTint(p);
      assert.ok(Math.abs(tint) <= 26, `${p} tint ${tint} stays within range`);
      assert.strictEqual(tint, pathTint(p), 'stable across calls');
    }
    // Distinct paths should not all collapse onto the same shade.
    assert.ok(new Set(paths.map(pathTint)).size > 1);
  });

  await t.test('fileColor keeps channels in range', () => {
    const bright = fileColor([255, 255, 255], 100, 100, 'src/a.js');
    const dark = fileColor([0, 0, 0], 0, 100, 'src/b.js');
    for (const c of [...bright, ...dark]) {
      assert.ok(c >= 0 && c <= 255, `channel ${c} is a valid byte`);
    }
    // Two files of identical biome and health still differ.
    assert.notDeepStrictEqual(
      fileColor([100, 150, 100], 80, 100, 'src/a.js'),
      fileColor([100, 150, 100], 80, 100, 'src/b.js')
    );
  });

  await t.test('stippleDensity rises with complexity and saturates', () => {
    assert.strictEqual(stippleDensity(0), 0);
    assert.strictEqual(stippleDensity(1), 0, 'flat code gets no texture');
    assert.ok(stippleDensity(5) > stippleDensity(3));
    assert.ok(stippleDensity(100) <= 0.45, 'never swamps the base colour');
  });

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
