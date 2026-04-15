import { openDb, getMeta, setMeta, upsertFile, deleteFile } from './db.js';
import { loadConfig, deriveGridConstants } from './config.js';
import { scanFiles } from './scan.js';
import { getDiffStats } from './git.js';
import { applyHealthDeltas, applyPassiveDeterioration } from './health.js';
import { initBiomeSeeds, computeSeedWeights, computeVoronoiMap, extractBiomePatches } from './voronoi.js';
import { fullAssignment } from './assign.js';
import { renderGarden } from './render.js';
import { renderHtml } from './html.js';
import * as logger from './logger.js';

/**
 * Main garden generation pipeline.
 * @param {string} repoRoot 
 * @param {string} fromCommit 
 * @param {string} toCommit 
 * @param {boolean} debug 
 */
export async function generateGarden(repoRoot, fromCommit, toCommit, debug = false) {
  logger.setDebug(debug);
  logger.time('total');

  logger.time('db');
  const db = openDb(repoRoot);
  logger.timeEnd('db');

  try {
    logger.time('config');
    const { config, extensionToBiome, biomeColors, baseColor, configChanged, currentConfigHash, currentColormapHash } = loadConfig(repoRoot, db);
    const { gridW, gridH, PATCH_SIZE } = deriveGridConstants(config);
    logger.timeEnd('config');

    logger.time('scan');
    const scannedFiles = await scanFiles(repoRoot, extensionToBiome, config.static_paths);
    logger.timeEnd('scan');

    logger.time('sync-files');
    syncFiles(db, scannedFiles, config.max_score);
    logger.timeEnd('sync-files');

    logger.time('health');
    if (fromCommit && toCommit && fromCommit !== 'null' && fromCommit !== '') {
      const diffStats = await getDiffStats(repoRoot, fromCommit, toCommit);
      applyHealthDeltas(db, diffStats, config.max_score);
      applyPassiveDeterioration(db, diffStats);
    } else {
      applyPassiveDeterioration(db, {});
    }
    logger.timeEnd('health');

    logger.time('seeds');
    const biomes = Object.keys(biomeColors);
    initBiomeSeeds(db, biomes, config, PATCH_SIZE, configChanged);
    const seeds = computeSeedWeights(db);
    logger.timeEnd('seeds');

    logger.time('voronoi');
    const { biomeMap, biomes: biomeList } = computeVoronoiMap(seeds, gridW, gridH);
    const biomePatches = extractBiomePatches(biomeMap, biomeList, gridW, gridH);
    logger.timeEnd('voronoi');

    logger.time('assign');
    fullAssignment(db, biomePatches, seeds);
    logger.timeEnd('assign');

    logger.time('render');
    await renderGarden(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot);
    await renderHtml(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot, debug);
    logger.timeEnd('render');

    setMeta(db, 'last_run_commit', toCommit || 'HEAD');
    if (configChanged || getMeta(db, 'config_hash') === null) {
      setMeta(db, 'config_hash', currentConfigHash);
      setMeta(db, 'colormap_hash', currentColormapHash);
    }

    logger.timeEnd('total');
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
    for (const file of scannedFiles) {
      upsertFile(db, {
        path: file.path,
        biome: file.biome,
        line_count: file.lineCount,
        health: maxScore,
        last_merge: Math.floor(Date.now() / 1000)
      });
    }

    for (const path of existingFiles) {
      if (!scannedPathsSet.has(path)) {
        deleteFile(db, path);
      }
    }
  }).immediate();
}
