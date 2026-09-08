import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fileColor, shade, complexityLevel, STIPPLE_TILES, SPECKLE_SHADE, BORDER_SHADE
} from './encoding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Marks an unplanted patch in the packed cell grid. */
const EMPTY = -1;

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

/**
 * Pack one file index per patch into a base64 typed array.
 *
 * The page needs to know which file owns each of the ~16k patches. Sent as
 * objects that is megabytes of near-identical JSON; as a flat typed array it is
 * a few tens of kilobytes, and the page can index it directly. 16-bit is used
 * whenever the file count fits, which it does for any realistic garden.
 *
 * @param {Int32Array} cells One file index per patch, row-major, -1 for empty
 * @param {number} fileCount
 * @returns {{encoding: string, data: string}}
 */
export function packCells(cells, fileCount) {
  const wide = fileCount > 32766;
  const typed = wide ? new Int32Array(cells) : new Int16Array(cells);
  return {
    encoding: wide ? 'i32' : 'i16',
    data: Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64')
  };
}

/**
 * Build everything the page needs to draw and explore the garden.
 *
 * Colours come from the shared encoding module, already resolved per file, so
 * the page never computes an encoding of its own — it only paints what it is
 * given. Files are listed once; patches are just indices into that list.
 *
 * @returns {{files: Array, cells: Object, shared: Object, gridW: number, gridH: number}}
 */
export function buildGardenData(db, config, biomeColors, gridW, gridH) {
  const { max_score } = config;

  const rows = db.prepare(`
    SELECT fp.px, fp.py, f.id AS file_id, f.path, f.health, f.biome,
           f.line_count, f.last_merge, f.complexity, f.commit_count
    FROM file_patches fp
    JOIN files f ON f.id = fp.file_id
    ORDER BY f.path ASC, fp.py ASC, fp.px ASC
  `).all();

  const files = [];
  const indexOfFile = new Map(); // db file id -> index into `files`
  const cells = new Int32Array(gridW * gridH).fill(EMPTY);

  // Patches shared by more than one file, as cell index -> extra file indices.
  // Only the out-of-room fallback in assign.js produces these, so the map is
  // empty for any garden that fits; keeping it sparse costs nothing when so.
  const shared = {};

  for (const row of rows) {
    let index = indexOfFile.get(row.file_id);
    if (index === undefined) {
      const biomeColor = biomeColors[row.biome] || [128, 128, 128];
      const color = fileColor(biomeColor, row.health, max_score, row.path);
      index = files.length;
      indexOfFile.set(row.file_id, index);
      files.push({
        path: row.path,
        biome: row.biome,
        health: row.health,
        lines: row.line_count,
        complexity: Math.round(row.complexity * 100) / 100,
        commits: row.commit_count,
        lastTouched: row.last_merge,
        fill: rgb(color),
        speckle: rgb(shade(color, SPECKLE_SHADE)),
        border: rgb(shade(color, BORDER_SHADE)),
        texture: complexityLevel(row.complexity)
      });
    }

    if (row.px >= gridW || row.py >= gridH) continue;
    const cell = row.py * gridW + row.px;
    if (cells[cell] === EMPTY) {
      cells[cell] = index;
    } else if (cells[cell] !== index) {
      (shared[cell] || (shared[cell] = [])).push(index);
    }
  }

  return { files, cells: packCells(cells, files.length), shared, gridW, gridH };
}

function rgb(color) {
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

/**
 * Render the garden to an interactive HTML file.
 */
export async function renderHtml(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot, debug = false) {
  const { max_score } = config;

  const garden = buildGardenData(db, config, biomeColors, gridW, gridH);

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

  const biomesData = biomes.map(b => ({
    name: b.biome,
    color: rgb(biomeColors[b.biome] || [128, 128, 128]),
    extensions: biomeToExts[b.biome] || '',
    patchCount: b.patch_count,
    fileCount: b.file_count,
    avgHealth: Math.round(b.avg_health || 0),
    avgComplexity: Math.round((b.avg_complexity || 0) * 100) / 100
  }));

  const seeds = db.prepare('SELECT * FROM biome_seeds').all();

  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const html = fillTemplate(template, {
    REPO_NAME: path.basename(repoRoot),
    FILES: safeJson(garden.files),
    CELLS: safeJson(garden.cells),
    SHARED: safeJson(garden.shared),
    BIOMES: safeJson(biomesData),
    SEEDS: safeJson(seeds),
    STIPPLE_TILES: safeJson(STIPPLE_TILES),
    BASE_COLOR: safeJson(rgb(baseColor)),
    GRID_W: String(gridW),
    GRID_H: String(gridH),
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
