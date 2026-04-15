/**
 * Initialize biome seeds if they don't exist or if the configuration has changed.
 * @param {Database} db 
 * @param {string[]} biomes 
 * @param {Object} config 
 * @param {number} PATCH_SIZE 
 * @param {boolean} configChanged 
 */
export function initBiomeSeeds(db, biomes, config, PATCH_SIZE, configChanged) {
  const existingSeedsCount = db.prepare('SELECT COUNT(*) as count FROM biome_seeds').get().count;
  
  if (existingSeedsCount === 0 || configChanged) {
    db.prepare('DELETE FROM biome_seeds').run();
    
    const startingPoints = config.starting_points || [];
    const gridW = Math.ceil(config.width / PATCH_SIZE);
    const gridH = Math.ceil(config.height / PATCH_SIZE);
    const minDistancePatches = (config.min_distance || 35) / PATCH_SIZE;

    const placedSeeds = [];

    for (const biome of biomes) {
      let cx, cy;
      const sp = startingPoints.find(p => p.type === biome);
      if (sp) {
        cx = sp.x / PATCH_SIZE;
        cy = sp.y / PATCH_SIZE;
      } else {
        // Rejection sampling
        let attempts = 0;
        while (attempts < 1000) {
          cx = Math.random() * gridW;
          cy = Math.random() * gridH;
          const tooClose = placedSeeds.some(s => Math.hypot(s.cx - cx, s.cy - cy) < minDistancePatches);
          if (!tooClose || placedSeeds.length === 0) break;
          attempts++;
        }
      }
      placedSeeds.push({ biome, cx, cy });
      db.prepare('INSERT INTO biome_seeds (biome, cx, cy, weight) VALUES (?, ?, ?, ?)').run(biome, cx, cy, 1.0);
    }
  }
}

/**
 * Compute biome seed weights based on file counts.
 * @param {Database} db 
 * @returns {Array} Array of seeds with updated weights
 */
export function computeSeedWeights(db) {
  const rows = db.prepare('SELECT biome, COUNT(*) as cnt FROM files GROUP BY biome').all();
  const totalFiles = rows.reduce((sum, r) => sum + r.cnt, 0);
  
  const seeds = db.prepare('SELECT * FROM biome_seeds').all();
  const update = db.prepare('UPDATE biome_seeds SET weight = ? WHERE biome = ?');
  
  const result = [];
  db.transaction(() => {
    for (const seed of seeds) {
      const row = rows.find(r => r.biome === seed.biome);
      const count = row ? row.cnt : 0;
      // Square root softens the weighting
      const weight = totalFiles > 0 ? Math.sqrt(count / totalFiles) : 1.0;
      const finalWeight = Math.max(0.1, weight); 
      update.run(finalWeight, seed.biome);
      result.push({ ...seed, weight: finalWeight });
    }
  }).immediate();
  return result;
}

/**
 * Generate the biome map using weighted Voronoi.
 * @param {Array} seeds 
 * @param {number} gridW 
 * @param {number} gridH 
 * @returns {Object} { biomeMap: Uint8Array, biomes: string[] }
 */
export function computeVoronoiMap(seeds, gridW, gridH) {
  const biomeMap = new Uint8Array(gridW * gridH);
  const activeSeeds = seeds.filter(s => s.weight > 0);
  const biomes = seeds.map(s => s.biome);

  if (activeSeeds.length === 0) return { biomeMap, biomes };

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let bestScore = Infinity;
      let bestIndex = 0;

      for (let i = 0; i < seeds.length; i++) {
        const seed = seeds[i];
        if (seed.weight === 0) continue;
        const dx = x - seed.cx;
        const dy = y - seed.cy;
        const distSq = dx * dx + dy * dy;
        const score = distSq / (seed.weight * seed.weight);

        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      biomeMap[y * gridW + x] = bestIndex;
    }
  }

  return { biomeMap, biomes };
}

/**
 * Extract per-biome patch lists from the biome map.
 * @param {Uint8Array} biomeMap 
 * @param {string[]} biomes 
 * @param {number} gridW 
 * @param {number} gridH 
 * @returns {Map} Map<biomeName, Array<{x, y}>>
 */
export function extractBiomePatches(biomeMap, biomes, gridW, gridH) {
  const biomePatches = new Map();
  for (const biome of biomes) {
    biomePatches.set(biome, []);
  }

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const index = biomeMap[y * gridW + x];
      const biomeName = biomes[index];
      biomePatches.get(biomeName).push({ x, y });
    }
  }

  return biomePatches;
}
