import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fileColor, stippleDensity } from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serialize a value for embedding inside a <script> block.
 *
 * JSON.stringify alone is not safe here: it leaves `<` and `>` untouched, so a
 * tracked file named `</script>...` would close the block and inject markup
 * into a page that gets published to the repo owner's github.io origin.
 * U+2028/U+2029 are valid JSON but break JavaScript string literals.
 *
 * @param {any} value
 * @returns {string}
 */
export function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Fill a {{TOKEN}} template.
 *
 * The replacement must be passed as a function: with a string replacement,
 * `String.replace` interprets `$&`, `$'`, "$`" and `$1` inside the *data*,
 * which silently corrupts any path containing them.
 *
 * @param {string} template
 * @param {Object<string, string>} values
 * @returns {string}
 */
export function fillTemplate(template, values) {
  let out = template;
  for (const [token, value] of Object.entries(values)) {
    out = out.replace(new RegExp(`{{${token}}}`, 'g'), () => value);
  }
  return out;
}

/** Complexity bucket (0-3) driving the texture overlay in the page. */
function complexityBucket(complexity) {
  const density = stippleDensity(complexity);
  if (density <= 0) return 0;
  if (density < 0.15) return 1;
  if (density < 0.3) return 2;
  return 3;
}

/**
 * Render the garden to an interactive HTML file.
 */
export async function renderHtml(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot, debug = false) {
  const { max_score, width, height } = config;

  const assigned = db.prepare(`
    SELECT fp.px, fp.py, f.id AS file_id, f.path, f.health, f.biome,
           f.line_count, f.last_merge, f.complexity, f.commit_count
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
    SELECT f.biome,
           COUNT(*) AS patch_count,
           COUNT(DISTINCT f.id) AS file_count,
           AVG(f.health) AS avg_health,
           AVG(f.complexity) AS avg_complexity
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
        complexity: Math.round(patch.complexity * 100) / 100,
        commits: patch.commit_count,
        lastTouched: patch.last_merge
      };
    }
  }

  // Which file owns each patch, so the page can draw the same borders as the PNG.
  const owner = new Map();
  for (const row of assigned) {
    owner.set(`${row.px},${row.py}`, row.file_id);
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
    const fileId = patch.fileIds[0];
    const file = fileMap[fileId];
    const biomeColor = biomeColors[file.biome] || [128, 128, 128];
    const color = fileColor(biomeColor, file.health, max_score, file.path);

    // Bitfield: 1 top, 2 right, 4 bottom, 8 left.
    let edges = 0;
    if (owner.get(`${patch.px},${patch.py - 1}`) !== fileId) edges |= 1;
    if (owner.get(`${patch.px + 1},${patch.py}`) !== fileId) edges |= 2;
    if (owner.get(`${patch.px},${patch.py + 1}`) !== fileId) edges |= 4;
    if (owner.get(`${patch.px - 1},${patch.py}`) !== fileId) edges |= 8;

    patches.push({
      x: patch.px * PATCH_SIZE,
      y: patch.py * PATCH_SIZE,
      fill: `rgb(${color.join(',')})`,
      fileIds: patch.fileIds,
      biome: file.biome,
      edges,
      texture: complexityBucket(file.complexity)
    });
  }

  const biomesData = biomes.map(b => ({
    name: b.biome,
    color: `rgb(${(biomeColors[b.biome] || [128, 128, 128]).join(',')})`,
    extensions: biomeToExts[b.biome] || '',
    patchCount: b.patch_count,
    fileCount: b.file_count,
    avgHealth: Math.round(b.avg_health || 0),
    avgComplexity: Math.round((b.avg_complexity || 0) * 100) / 100
  }));

  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const html = fillTemplate(template, {
    REPO_NAME: path.basename(repoRoot),
    WIDTH: String(width),
    HEIGHT: String(height),
    PATCHES: safeJson(patches),
    BIOMES: safeJson(biomesData),
    SEEDS: safeJson(seeds),
    FILE_MAP: safeJson(fileMap),
    BIOME_TO_EXTS: safeJson(biomeToExts),
    MAX_SCORE: String(max_score),
    PATCH_SIZE: String(PATCH_SIZE),
    DEBUG_DISPLAY: debug ? 'block' : 'none'
  });

  const gitgardenDir = path.join(repoRoot, '.gitgarden');
  if (!fs.existsSync(gitgardenDir)) fs.mkdirSync(gitgardenDir, { recursive: true });
  fs.writeFileSync(path.join(gitgardenDir, 'garden.html'), html);

  const docsDir = path.join(repoRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    fs.writeFileSync(path.join(docsDir, 'garden.html'), html);
  }
}
