import { openDb, getMeta, setMeta, upsertFile, deleteFile } from './db.js';
import { loadConfig, deriveGridConstants } from './config.js';
import { scanFiles } from './scan.js';
import { getDiffStats } from './git.js';
import { applyHealthDeltas, applyPassiveDeterioration } from './health.js';
import { initBiomeSeeds, computeSeedWeights, computeVoronoiMap, extractBiomePatches } from './voronoi.js';
import { fullAssignment } from './assign.js';
import { renderGarden } from './render.js';
import { renderHtml } from './html.js';

/**
 * Main garden generation pipeline.
 * @param {string} repoRoot 
 * @param {string} fromCommit 
 * @param {string} toCommit 
 * @param {number|null} overrideFillFactor
 */
export async function generateGarden(repoRoot, fromCommit, toCommit, overrideFillFactor = null) {
  console.time('total');

  // 1. Open DB
  console.time('db');
  const db = openDb(repoRoot);
  console.timeEnd('db');

  try {
    // 2. Load config
    console.time('config');
    const { config, extensionToBiome, biomeColors, baseColor, configChanged, currentConfigHash, currentColormapHash } = loadConfig(repoRoot, db);
    const { gridW, gridH, PATCH_SIZE } = deriveGridConstants(config);
    console.timeEnd('config');

    // 3. Scan repo files
    console.time('scan');
    const scannedFiles = await scanFiles(repoRoot, extensionToBiome, config.static_paths);
    console.timeEnd('scan');

    // 4. Sync files into DB
    console.time('sync-files');
    syncFiles(db, scannedFiles, config.max_score);
    console.timeEnd('sync-files');

    // 5. Get diff stats and compute health
    console.time('health');
    if (fromCommit && toCommit && fromCommit !== 'null' && fromCommit !== '') {
      const diffStats = await getDiffStats(repoRoot, fromCommit, toCommit);
      applyHealthDeltas(db, diffStats, config.max_score);
      applyPassiveDeterioration(db, diffStats);
    } else {
      // Initial run or no diff provided
      applyPassiveDeterioration(db, {});
    }
    console.timeEnd('health');

    // 6. Init seeds if needed
    console.time('seeds');
    const biomes = Object.keys(biomeColors);
    initBiomeSeeds(db, biomes, config, PATCH_SIZE, configChanged);
    const seeds = computeSeedWeights(db);
    console.timeEnd('seeds');

    // 7. Compute Voronoi map
    console.time('voronoi');
    const { biomeMap, biomes: biomeList } = computeVoronoiMap(seeds, gridW, gridH);
    const biomePatches = extractBiomePatches(biomeMap, biomeList, gridW, gridH);
    console.timeEnd('voronoi');

    // 8. Assign files to patches
    console.time('assign');
    // Plan says MVP always full reassign
    fullAssignment(db, biomePatches, seeds, overrideFillFactor || config.fill_factor || 0.85);
    console.timeEnd('assign');

    // 9. Render PNG & HTML
    console.time('render');
    await renderGarden(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot);
    await renderHtml(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot);
    console.timeEnd('render');

    // 10. Update meta
    setMeta(db, 'last_run_commit', toCommit || 'HEAD');
    if (configChanged || getMeta(db, 'config_hash') === null) {
      setMeta(db, 'config_hash', currentConfigHash);
      setMeta(db, 'colormap_hash', currentColormapHash);
    }

    console.timeEnd('total');
  } finally {
    db.pragma('optimize');
    db.close();
  }
}

/**
 * Synchronize scanned files with the database.
 * @param {Database} db 
 * @param {Array} scannedFiles 
 * @param {number} maxScore 
 */
function syncFiles(db, scannedFiles, maxScore) {
  const existingFiles = db.prepare('SELECT path FROM files').all().map(f => f.path);
  const existingPathsSet = new Set(existingFiles);
  const scannedPathsSet = new Set(scannedFiles.map(f => f.path));

  db.transaction(() => {
    // New or updated files
    for (const file of scannedFiles) {
      upsertFile(db, {
        path: file.path,
        biome: file.biome,
        line_count: file.lineCount,
        health: maxScore, // Only used on initial insert
        last_merge: Math.floor(Date.now() / 1000)
      });
    }

    // Removed files
    for (const path of existingFiles) {
      if (!scannedPathsSet.has(path)) {
        deleteFile(db, path);
      }
    }
  }).immediate();
}
