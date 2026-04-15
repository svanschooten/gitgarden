/**
 * Compute the new health score based on lines added and removed.
 * @param {number} currentHealth 
 * @param {number} linesAdded 
 * @param {number} linesRemoved 
 * @param {number} maxScore 
 * @returns {number}
 */
export function computeHealth(currentHealth, linesAdded, linesRemoved, maxScore) {
  let delta = 0;
  if (linesAdded >= linesRemoved * 2 && linesAdded > 0) {
    // Growth
    delta = Math.min(20, Math.max(1, Math.round(linesAdded / 10)));
  } else if (linesRemoved > linesAdded) {
    // Decay
    delta = -Math.min(10, Math.max(1, Math.round(linesRemoved / 10)));
  } else {
    // Maintenance (roughly equal added/removed)
    delta = 5;
  }
  return Math.max(0, Math.min(maxScore, currentHealth + delta));
}

/**
 * Update health for files present in the diff.
 * @param {Database} db 
 * @param {Object} diffStats 
 * @param {number} maxScore 
 */
export function applyHealthDeltas(db, diffStats, maxScore) {
  const files = db.prepare('SELECT id, path, health FROM files').all();
  const update = db.prepare('UPDATE files SET health = ?, last_merge = ? WHERE id = ?');
  const now = Math.floor(Date.now() / 1000);

  db.transaction(() => {
    for (const file of files) {
      const stats = diffStats[file.path];
      if (stats) {
        const newHealth = computeHealth(file.health, stats.linesAdded, stats.linesRemoved, maxScore);
        update.run(newHealth, now, file.id);
      }
    }
  }).immediate();
}

/**
 * Apply passive deterioration (-2) to files NOT in the diff.
 * @param {Database} db 
 * @param {Object} diffStats 
 */
export function applyPassiveDeterioration(db, diffStats) {
  const pathsInDiff = Object.keys(diffStats);
  if (pathsInDiff.length === 0) {
    db.prepare('UPDATE files SET health = MAX(0, health - 2)').run();
  } else {
    const placeholders = pathsInDiff.map(() => '?').join(',');
    db.prepare(`UPDATE files SET health = MAX(0, health - 2) WHERE path NOT IN (${placeholders})`).run(...pathsInDiff);
  }
}
