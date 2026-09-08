import test from 'node:test';
import assert from 'node:assert';
import {
  hash32, clamp8, shade, blendColor, pathTint, fileColor,
  stippleDensity, complexityLevel, edgeBits, STIPPLE_TILES,
  SPECKLE_SHADE, BORDER_SHADE, WITHERED
} from '../src/encoding.js';

test('Shared visual encoding', async (t) => {
  await t.test('hash32 is stable and well distributed', () => {
    assert.strictEqual(hash32('src/garden.js'), hash32('src/garden.js'));
    assert.notStrictEqual(hash32('src/garden.js'), hash32('src/garden.ts'));
    assert.ok(Number.isInteger(hash32('x')) && hash32('x') >= 0);
  });

  await t.test('clamp8 keeps values a valid colour byte', () => {
    assert.strictEqual(clamp8(-40), 0);
    assert.strictEqual(clamp8(300), 255);
    assert.strictEqual(clamp8(12.6), 13);
  });

  await t.test('shade darkens without leaving the palette', () => {
    assert.deepStrictEqual(shade([200, 100, 50], 0.5), [100, 50, 25]);
    for (const c of shade([255, 255, 255], BORDER_SHADE)) {
      assert.ok(c >= 0 && c <= 255);
    }
  });

  await t.test('blendColor runs from the biome colour to withered', () => {
    const biome = [255, 255, 255];
    assert.deepStrictEqual(blendColor(biome, 100, 100), biome, 'full health keeps the biome colour');
    assert.deepStrictEqual(blendColor(biome, 0, 100), WITHERED, 'no health is fully withered');
    assert.strictEqual(blendColor(biome, 50, 100)[0], Math.round((255 + WITHERED[0]) / 2));
  });

  await t.test('pathTint separates files without leaving the palette', () => {
    const paths = ['src/a.js', 'src/b.js', 'src/c.js', 'README.md', 'x/y/z.py'];
    for (const p of paths) {
      assert.ok(Math.abs(pathTint(p)) <= 26, `${p} stays within range`);
      assert.strictEqual(pathTint(p), pathTint(p), 'stable across calls');
    }
    assert.ok(new Set(paths.map(pathTint)).size > 1, 'shades do not all collapse');
  });

  await t.test('fileColor keeps channels in range and stays per-file', () => {
    for (const c of [
      ...fileColor([255, 255, 255], 100, 100, 'src/a.js'),
      ...fileColor([0, 0, 0], 0, 100, 'src/b.js')
    ]) {
      assert.ok(c >= 0 && c <= 255, `channel ${c} is a valid byte`);
    }
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

  await t.test('complexityLevel buckets the same density the PNG stipples', () => {
    assert.strictEqual(complexityLevel(0), 0);
    assert.strictEqual(complexityLevel(1), 0);
    assert.strictEqual(complexityLevel(100), 3, 'saturated complexity is the densest tile');
    // Monotonic, and every level has a tile the page can draw.
    let previous = 0;
    for (let c = 1; c <= 40; c += 0.5) {
      const level = complexityLevel(c);
      assert.ok(level >= previous, `level must not fall as complexity rises (at ${c})`);
      assert.ok(level === 0 || STIPPLE_TILES[level], `level ${level} has a tile`);
      previous = level;
    }
  });

  await t.test('edgeBits marks every side facing a different file', () => {
    // A 3x3 grid, all file 1 except the centre-right cell.
    const grid = [
      [1, 1, 1],
      [1, 1, 2],
      [1, 1, 1]
    ];
    const at = (x, y) => (x < 0 || y < 0 || x > 2 || y > 2) ? -1 : grid[y][x];

    assert.strictEqual(edgeBits(at, 1, 1, 1), 2, 'only the right side faces file 2');
    // Sits on the grid's right edge, so it borders the outside there too.
    assert.strictEqual(edgeBits(at, 2, 1, 2), 1 | 2 | 4 | 8, 'the lone cell borders on every side');
    assert.strictEqual(edgeBits(at, 0, 0, 1), 1 | 8, 'the corner borders the outside');
    assert.strictEqual(edgeBits(at, 1, 0, 1), 1, 'a top-row cell only borders upward');
  });

  await t.test('speckle and border shades are ordered darkest last', () => {
    assert.ok(BORDER_SHADE < SPECKLE_SHADE, 'a border must read darker than the stipple');
    assert.ok(SPECKLE_SHADE < 1, 'the stipple must be visible against the fill');
  });
});
