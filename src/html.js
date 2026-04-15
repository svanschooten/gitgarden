import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { blendColor } from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Render the garden to an interactive HTML file.
 */
export async function renderHtml(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot, debug = false) {
  const { max_score, width, height } = config;

  const assigned = db.prepare(`
    SELECT fp.px, fp.py, f.id as file_id, f.path, f.health, f.biome, f.line_count, f.last_merge
    FROM file_patches fp
    JOIN files f ON f.id = fp.file_id
  `).all();

  const biomeToExts = {};
  if (config.plant_map && config.plant_map.plants) {
    for (const [biome, details] of Object.entries(config.plant_map.plants)) {
      biomeToExts[biome] = details.extensions ? details.extensions.join(', ') : '';
    }
  }

  const biomes = db.prepare(`
    SELECT f.biome, COUNT(*) as patch_count, COUNT(DISTINCT f.id) as file_count
    FROM file_patches fp
    JOIN files f ON f.id = fp.file_id
    GROUP BY f.biome
  `).all();

  const seeds = db.prepare('SELECT * FROM biome_seeds').all();

  const fileMap = {};
  for (const patch of assigned) {
    if (!fileMap[patch.file_id]) {
      fileMap[patch.file_id] = {
        path: patch.path,
        biome: patch.biome,
        health: patch.health,
        lines: patch.line_count,
        last_modified: patch.last_merge
      };
    }
  }

  const patchMap = {};
  for (const row of assigned) {
    const key = `${row.px},${row.py}`;
    if (!patchMap[key]) {
      patchMap[key] = { px: row.px, py: row.py, fileIds: [] };
    }
    patchMap[key].fileIds.push(row.file_id);
  }

  const patches = [];
  
  for (const key in patchMap) {
    const patch = patchMap[key];
    const representativeFile = fileMap[patch.fileIds[0]];
    const bColor = biomeColors[representativeFile.biome] || [128, 128, 128];
    const color = blendColor(bColor, representativeFile.health, max_score);
    const fill = `rgb(${color.join(',')})`;
    patches.push({
      x: patch.px * PATCH_SIZE,
      y: patch.py * PATCH_SIZE,
      fill,
      fileIds: patch.fileIds,
      biome: representativeFile.biome
    });
  }

  const biomesData = biomes.map(b => ({
    name: b.biome,
    color: `rgb(${(biomeColors[b.biome] || [128, 128, 128]).join(',')})`,
    extensions: biomeToExts[b.biome] || '',
    patchCount: b.patch_count,
    fileCount: b.file_count
  }));

  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const repoName = path.basename(repoRoot);
  const html = template
    .replace(/{{REPO_NAME}}/g, repoName)
    .replace(/{{WIDTH}}/g, width)
    .replace(/{{HEIGHT}}/g, height)
    .replace(/{{PATCHES}}/g, JSON.stringify(patches))
    .replace(/{{BIOMES}}/g, JSON.stringify(biomesData))
    .replace(/{{SEEDS}}/g, JSON.stringify(seeds))
    .replace(/{{FILE_MAP}}/g, JSON.stringify(fileMap))
    .replace(/{{BIOME_TO_EXTS}}/g, JSON.stringify(biomeToExts))
    .replace(/{{MAX_SCORE}}/g, max_score)
    .replace(/{{PATCH_SIZE}}/g, PATCH_SIZE)
    .replace(/{{DEBUG_DISPLAY}}/g, debug ? 'block' : 'none');

  const gitgardenDir = path.join(repoRoot, '.gitgarden');
  if (!fs.existsSync(gitgardenDir)) fs.mkdirSync(gitgardenDir, { recursive: true });
  fs.writeFileSync(path.join(gitgardenDir, 'garden.html'), html);

  const docsDir = path.join(repoRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    fs.writeFileSync(path.join(docsDir, 'garden.html'), html);
  }
}
