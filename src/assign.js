import { clearAssignments, bulkInsertPatches, bulkInsertVacant } from './db.js';

/**
 * Sort patches by angle then distance from the seed.
 * @param {Array} patches 
 * @param {number} seedX 
 * @param {number} seedY 
 * @returns {Array} Sorted patches
 */
export function spiralSort(patches, seedX, seedY) {
  return patches.sort((a, b) => {
    const angleA = Math.atan2(a.y - seedY, a.x - seedX);
    const angleB = Math.atan2(b.y - seedY, b.x - seedX);
    if (angleA !== angleB) return angleA - angleB;
    return Math.hypot(a.x - seedX, a.y - seedY)
         - Math.hypot(b.x - seedX, b.y - seedY);
  });
}

/**
 * Perform a full assignment of files to patches.
 * @param {Database} db 
 * @param {Map} biomePatches 
 * @param {Array} seeds 
 * @param {number} fillFactor 
 */
export function fullAssignment(db, biomePatches, seeds, fillFactor = 0.85) {
  clearAssignments(db);
  
  db.transaction(() => {
    for (const seed of seeds) {
      const biome = seed.biome;
      const patches = biomePatches.get(biome);
      if (!patches || patches.length === 0) continue;
      
      const sortedPatches = spiralSort([...patches], seed.cx, seed.cy);
      
      const files = db.prepare('SELECT id, path, line_count FROM files WHERE biome = ? ORDER BY path ASC').all(biome);
      const totalLines = files.reduce((sum, f) => sum + f.line_count, 0);
      const totalBiomePatches = sortedPatches.length;
      
      let cursor = 0;
      const patchAssignments = [];
      
      if (totalLines > 0) {
        for (const file of files) {
          const cellCount = Math.max(1, Math.round((file.line_count / totalLines) * totalBiomePatches * fillFactor));
          const filePatches = sortedPatches.slice(cursor, cursor + cellCount);
          cursor += cellCount;
          
          for (const p of filePatches) {
            patchAssignments.push({ fileId: file.id, px: p.x, py: p.y });
          }
          
          // Stop if we ran out of patches
          if (cursor >= totalBiomePatches) break;
        }
      }
      
      if (patchAssignments.length > 0) {
        bulkInsertPatches(db, patchAssignments);
      }
      
      const remainingPatches = sortedPatches.slice(cursor);
      if (remainingPatches.length > 0) {
        bulkInsertVacant(db, remainingPatches.map(p => ({ biome, px: p.x, py: p.y })));
      }
    }
  })();
}
