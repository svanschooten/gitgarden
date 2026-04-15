import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, getMeta, setMeta, upsertFile, deleteFile, clearAssignments, bulkInsertPatches } from '../src/db.js';

const testRepoRoot = path.join(process.cwd(), 'test-repo-db');

test('Database operations', async (t) => {
  if (fs.existsSync(testRepoRoot)) {
    fs.rmSync(testRepoRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(testRepoRoot);

  let db;

  await t.test('openDb initializes database', () => {
    db = openDb(testRepoRoot);
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'state.db')));
    
    // Check if tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes('meta'));
    assert.ok(tables.includes('biome_seeds'));
    assert.ok(tables.includes('files'));
    assert.ok(tables.includes('file_patches'));
  });

  await t.test('meta operations', () => {
    setMeta(db, 'test-key', 'test-value');
    assert.strictEqual(getMeta(db, 'test-key'), 'test-value');
    
    setMeta(db, 'test-key', 'updated-value');
    assert.strictEqual(getMeta(db, 'test-key'), 'updated-value');
    
    assert.strictEqual(getMeta(db, 'non-existent'), null);
  });

  let fileId;
  await t.test('file operations', () => {
    fileId = upsertFile(db, {
      path: 'src/main.js',
      biome: 'grass',
      line_count: 100,
      health: 80,
      last_merge: 123456789
    });
    assert.ok(fileId > 0);

    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    assert.strictEqual(file.path, 'src/main.js');
    assert.strictEqual(file.line_count, 100);

    // Update file
    upsertFile(db, {
      path: 'src/main.js',
      biome: 'grass',
      line_count: 120,
      health: 90,
      last_merge: 123456790
    });
    const updatedFile = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    assert.strictEqual(updatedFile.line_count, 120);
  });

  await t.test('patch operations', () => {
    bulkInsertPatches(db, [
      { fileId: fileId, px: 0, py: 0 },
      { fileId: fileId, px: 1, py: 0 }
    ]);
    const patches = db.prepare('SELECT * FROM file_patches WHERE file_id = ?').all(fileId);
    assert.strictEqual(patches.length, 2);
  });

  await t.test('clearAssignments', () => {
    clearAssignments(db);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM file_patches').get().count, 0);
    // Files should still exist
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM files').get().count, 1);
  });

  await t.test('deleteFile', () => {
    // Add some patches first to test cascade
    bulkInsertPatches(db, [{ fileId: fileId, px: 5, py: 5 }]);
    
    deleteFile(db, 'src/main.js');
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM files').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM file_patches').get().count, 0);
  });

  db.close();
  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
