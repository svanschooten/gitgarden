import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Open (or create) the SQLite database and initialize the schema.
 * @param {string} repoRoot 
 * @returns {Database}
 */
export function openDb(repoRoot) {
  const dbDir = path.join(repoRoot, '.gitgarden');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, 'state.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS biome_seeds (
      biome   TEXT PRIMARY KEY,
      cx      REAL NOT NULL,
      cy      REAL NOT NULL,
      weight  REAL NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS files (
      id          INTEGER PRIMARY KEY,
      path        TEXT UNIQUE NOT NULL,
      biome       TEXT NOT NULL,
      line_count  INTEGER NOT NULL DEFAULT 0,
      health      INTEGER NOT NULL DEFAULT 100,
      last_merge  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS file_patches (
      file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      px       INTEGER NOT NULL,
      py       INTEGER NOT NULL,
      PRIMARY KEY (file_id, px, py)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_file_patches_file ON file_patches(file_id);
    CREATE INDEX IF NOT EXISTS idx_files_biome ON files(biome);
  `);

  process.on('exit', () => db.close());
  process.on('SIGHUP', () => process.exit(128 + 1));
  process.on('SIGINT', () => process.exit(128 + 2));
  process.on('SIGTERM', () => process.exit(128 + 15));

  return db;
}

/**
 * Get a metadata value by key.
 * @param {Database} db 
 * @param {string} key 
 * @returns {string|null}
 */
export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Set a metadata value by key.
 * @param {Database} db 
 * @param {string} key 
 * @param {any} value 
 */
export function setMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value));
}

/**
 * Insert or update a file record.
 * @param {Database} db 
 * @param {Object} fileData 
 * @returns {number} The file ID
 */
export function upsertFile(db, { path, biome, line_count, health, last_merge }) {
  const info = db.prepare(`
    INSERT INTO files (path, biome, line_count, health, last_merge)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      biome = EXCLUDED.biome,
      line_count = EXCLUDED.line_count
    RETURNING id
  `).get(path, biome, line_count, health, last_merge);
  return info.id;
}

/**
 * Delete a file record by path.
 * @param {Database} db 
 * @param {string} path 
 */
export function deleteFile(db, path) {
  db.prepare('DELETE FROM files WHERE path = ?').run(path);
}

/**
 * Clear all file-to-patch assignments.
 * @param {Database} db 
 */
export function clearAssignments(db) {
  db.transaction(() => {
    db.prepare('DELETE FROM file_patches').run();
  }).immediate();
}

/**
 * Bulk insert patch assignments.
 * @param {Database} db 
 * @param {Array} patches 
 */
export function bulkInsertPatches(db, patches) {
  const insert = db.prepare('INSERT INTO file_patches (file_id, px, py) VALUES (?, ?, ?)');
  const transaction = db.transaction((patches) => {
    for (const p of patches) {
      insert.run(p.fileId, p.px, p.py);
    }
  });
  transaction.immediate(patches);
}

