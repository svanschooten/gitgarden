import { openDb, setMeta, upsertFile, deleteFile, closeDb } from './db.js';
import { loadConfig, deriveGridConstants } from './config.js';
import { scanFiles } from './scan.js';
import { getCommitHistory, getTreeFiles } from './git.js';
import { replayHealth } from './health.js';
import { initBiomeSeeds, computeSeedWeights, computeVoronoiMap, extractBiomePatches } from './voronoi.js';
import { fullAssignment } from './assign.js';
import { renderGarden } from './render.js';
import { renderHtml } from './html.js';
import * as logger from './logger.js';

/**
 * Main garden generation pipeline.
 *
 * The garden is a pure function of the repository at `ref`: file health is
 * replayed from the commit history on every run rather than accumulated in the
 * database, so a clean checkout and an incremental run produce the same image.
 *
 * @param {string} repoRoot
 * @param {Object} [options]
 * @param {string} [options.ref] Commit-ish to grow the garden at. Default 'HEAD'.
 * @param {number} [options.historyLimit] Commits to replay. Defaults to config.
 * @param {string} [options.layout] 'cluster', 'ring' or 'wedge'. Defaults to config.
 * @param {boolean} [options.debug]
 */
export async function generateGarden(repoRoot, options = {}) {
  const { ref = 'HEAD', debug = false } = options;
  logger.setDebug(debug);
  logger.time('total');

  const db = openDb(repoRoot);

  try {
    logger.time('config');
    const { config, extensionToBiome, biomeColors, baseColor, configChanged, currentConfigHash, currentColormapHash } = loadConfig(repoRoot, db);
    const { gridW, gridH, PATCH_SIZE } = deriveGridConstants(config);
    const historyLimit = options.historyLimit || config.history_limit;
    logger.timeEnd('config');

    logger.time('scan');
    const scannedFiles = await scanFiles(repoRoot, extensionToBiome, config.static_paths);
    logger.timeEnd('scan');

    logger.time('history');
    const { commits, baseSha } = await getCommitHistory(repoRoot, ref, historyLimit);
    const baselinePaths = await getTreeFiles(repoRoot, baseSha);
    const currentPaths = new Set(scannedFiles.map(f => f.path));
    const health = replayHealth(currentPaths, commits, baselinePaths, config.max_score, historyLimit);
    logger.log(`Replayed ${commits.length} commits over ${currentPaths.size} files`);
    logger.timeEnd('history');

    logger.time('sync-files');
    syncFiles(db, scannedFiles, health);
    logger.timeEnd('sync-files');

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
    fullAssignment(db, biomePatches, seeds, options.layout || config.layout);
    logger.timeEnd('assign');

    logger.time('render');
    await renderGarden(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot);
    await renderHtml(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot, debug);
    logger.timeEnd('render');

    setMeta(db, 'last_run_ref', commits.length > 0 ? commits[commits.length - 1].sha : ref);
    setMeta(db, 'history_limit', historyLimit);
    if (configChanged) {
      setMeta(db, 'config_hash', currentConfigHash);
      setMeta(db, 'default_config_hash', currentColormapHash);
    }

    logger.timeEnd('total');
  } finally {
    db.pragma('optimize');
    closeDb(db);
  }
}

/**
 * Write the scanned tree and its replayed health into the database,
 * dropping files that no longer exist.
 * @param {Database} db 
 * @param {Array} scannedFiles 
 * @param {Map<string, Object>} health Replayed health, keyed by path
 */
function syncFiles(db, scannedFiles, health) {
  const existingFiles = db.prepare('SELECT path FROM files').all().map(f => f.path);
  const scannedPathsSet = new Set(scannedFiles.map(f => f.path));

  db.transaction(() => {
    for (const file of scannedFiles) {
      const stats = health.get(file.path) || { health: 0, lastTouched: 0, commits: 0 };
      upsertFile(db, {
        path: file.path,
        biome: file.biome,
        line_count: file.lineCount,
        health: stats.health,
        last_merge: stats.lastTouched,
        complexity: file.complexity,
        commit_count: stats.commits
      });
    }

    for (const path of existingFiles) {
      if (!scannedPathsSet.has(path)) {
        deleteFile(db, path);
      }
    }
  }).immediate();
}
