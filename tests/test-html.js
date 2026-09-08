import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { safeJson, fillTemplate, packCells, buildGardenData } from '../src/html.js';
import { openDb, upsertFile, bulkInsertPatches, closeDb } from '../src/db.js';

test('HTML data embedding', async (t) => {
  await t.test('safeJson neutralizes script-closing markup', () => {
    const embedded = safeJson([{ path: 'a</script><img src=x onerror=alert(1)>.js' }]);
    assert.ok(!embedded.includes('</script>'), 'must not close the script block');
    assert.ok(!embedded.includes('<'), 'no raw angle brackets survive');
    assert.ok(!embedded.includes('>'));
    assert.ok(!embedded.includes('&'));
    // Still valid JSON that round-trips to the original value.
    assert.deepStrictEqual(JSON.parse(embedded), [{ path: 'a</script><img src=x onerror=alert(1)>.js' }]);
  });

  await t.test('safeJson escapes JavaScript line terminators', () => {
    const raw = 'a\u2028b\u2029c';
    const embedded = safeJson({ path: raw });
    assert.ok(!embedded.includes('\u2028'), 'U+2028 is valid JSON but breaks a JS string literal');
    assert.ok(!embedded.includes('\u2029'));
    assert.deepStrictEqual(JSON.parse(embedded), { path: raw });
  });

  await t.test('fillTemplate does not interpret $ patterns in the data', () => {
    // A string replacement would expand $&, $` , $' and $1 out of the data.
    const data = safeJson([{ path: "weird/$&$`$'$1.js" }]);
    const html = fillTemplate('const p = {{PATCHES}};', { PATCHES: data });
    assert.strictEqual(html, `const p = ${data};`);
    assert.deepStrictEqual(JSON.parse(html.slice('const p = '.length, -1)), [{ path: "weird/$&$`$'$1.js" }]);
  });

  await t.test('fillTemplate replaces every occurrence of a token', () => {
    assert.strictEqual(
      fillTemplate('{{A}} and {{A}} and {{B}}', { A: 'x', B: 'y' }),
      'x and x and y'
    );
  });
});

test('Garden payload', async (t) => {
  const gridW = 4, gridH = 4;
  const config = { max_score: 100 };
  const biomeColors = { grass: [0, 255, 0] };

  function withDb(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-html-payload-'));
    const db = openDb(dir);
    try {
      return fn(db);
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  await t.test('packCells round-trips through base64', () => {
    const cells = new Int32Array([0, 1, -1, 5]);
    const packed = packCells(cells, 6);
    assert.strictEqual(packed.encoding, 'i16', 'a small file count uses the narrow form');
    const bytes = Buffer.from(packed.data, 'base64');
    assert.deepStrictEqual(
      Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, cells.length)),
      [0, 1, -1, 5]
    );
  });

  await t.test('packCells widens when the file count needs it', () => {
    const packed = packCells(new Int32Array([40000]), 40000);
    assert.strictEqual(packed.encoding, 'i32');
    const bytes = Buffer.from(packed.data, 'base64');
    assert.strictEqual(new Int32Array(bytes.buffer, bytes.byteOffset, 1)[0], 40000);
  });

  await t.test('every file appears once, with its colours resolved', () => {
    const data = withDb(db => {
      const a = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      const b = upsertFile(db, { path: 'b.js', biome: 'grass', line_count: 10, health: 50, last_merge: 0 });
      bulkInsertPatches(db, [
        { fileId: a, px: 0, py: 0 }, { fileId: a, px: 1, py: 0 },
        { fileId: b, px: 2, py: 0 }
      ]);
      return buildGardenData(db, config, biomeColors, gridW, gridH);
    });

    assert.strictEqual(data.files.length, 2, 'a file is listed once, not once per patch');
    for (const file of data.files) {
      assert.match(file.fill, /^rgb\(\d+,\d+,\d+\)$/);
      assert.match(file.border, /^rgb\(\d+,\d+,\d+\)$/);
      assert.match(file.speckle, /^rgb\(\d+,\d+,\d+\)$/);
      assert.ok(file.texture >= 0 && file.texture <= 3);
    }
    // The page never computes an encoding, so a withered file must already
    // differ from a healthy one here.
    assert.notStrictEqual(data.files[0].fill, data.files[1].fill);
  });

  await t.test('cells point at the file owning each patch', () => {
    const data = withDb(db => {
      const a = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      const b = upsertFile(db, { path: 'b.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      bulkInsertPatches(db, [{ fileId: a, px: 0, py: 0 }, { fileId: b, px: 3, py: 2 }]);
      return buildGardenData(db, config, biomeColors, gridW, gridH);
    });

    const bytes = Buffer.from(data.cells.data, 'base64');
    const cells = new Int16Array(bytes.buffer, bytes.byteOffset, gridW * gridH);
    const indexOf = p => data.files.findIndex(f => f.path === p);

    assert.strictEqual(cells[0 * gridW + 0], indexOf('a.js'));
    assert.strictEqual(cells[2 * gridW + 3], indexOf('b.js'));
    assert.strictEqual(cells[1 * gridW + 1], -1, 'unplanted patches stay empty');
  });

  await t.test('a patch shared by two files keeps both, out of line', () => {
    const data = withDb(db => {
      const a = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      const b = upsertFile(db, { path: 'b.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      // assign.js falls back to sharing a patch when a biome runs out of room.
      bulkInsertPatches(db, [{ fileId: a, px: 1, py: 1 }, { fileId: b, px: 1, py: 1 }]);
      return buildGardenData(db, config, biomeColors, gridW, gridH);
    });

    const cell = 1 * gridW + 1;
    const bytes = Buffer.from(data.cells.data, 'base64');
    const cells = new Int16Array(bytes.buffer, bytes.byteOffset, gridW * gridH);

    assert.ok(cells[cell] >= 0, 'one file still owns the patch for drawing');
    assert.deepStrictEqual(Object.keys(data.shared), [String(cell)]);
    assert.strictEqual(data.shared[cell].length, 1, 'the other file rides in the sparse table');
    assert.notStrictEqual(data.shared[cell][0], cells[cell]);
  });

  await t.test('no shared table at all when every patch has one owner', () => {
    const data = withDb(db => {
      const a = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      bulkInsertPatches(db, [{ fileId: a, px: 0, py: 0 }, { fileId: a, px: 1, py: 0 }]);
      return buildGardenData(db, config, biomeColors, gridW, gridH);
    });
    assert.deepStrictEqual(data.shared, {}, 'the common case costs nothing');
  });

  await t.test('patches outside the grid are dropped, not wrapped', () => {
    const data = withDb(db => {
      const a = upsertFile(db, { path: 'a.js', biome: 'grass', line_count: 10, health: 100, last_merge: 0 });
      bulkInsertPatches(db, [{ fileId: a, px: 0, py: 0 }, { fileId: a, px: 99, py: 99 }]);
      return buildGardenData(db, config, biomeColors, gridW, gridH);
    });
    const bytes = Buffer.from(data.cells.data, 'base64');
    const cells = new Int16Array(bytes.buffer, bytes.byteOffset, gridW * gridH);
    assert.strictEqual(cells.filter(c => c !== -1).length, 1);
  });
});
