import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

/**
 * Blend biome color with withered color based on health.
 * @param biomeColor {number[]} [R, G, B]
 * @param health {number} health
 * @param maxScore {number} maxScore
 * @returns {number[]} [R, G, B]
 */
export function blendColor(biomeColor, health, maxScore) {
  const t = health / maxScore;
  const withered = [110, 80, 40];
  const r = Math.round(withered[0] + t * (biomeColor[0] - withered[0]));
  const g = Math.round(withered[1] + t * (biomeColor[1] - withered[1]));
  const b = Math.round(withered[2] + t * (biomeColor[2] - withered[2]));
  return [r, g, b];
}

/**
 * Deterministic 32-bit FNV-1a hash. Used for anything that must look random
 * but stay identical across runs and between the PNG and the HTML.
 * @param {string} str
 * @returns {number}
 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** How far a file's shade may drift from its biome color, per channel. */
const TINT_RANGE = 26;

/**
 * A stable per-file shade offset, so neighbouring files of the same biome and
 * health are still distinguishable instead of merging into one flat blob.
 * @param {string} filePath
 * @returns {number} Offset in [-TINT_RANGE, TINT_RANGE]
 */
export function pathTint(filePath) {
  const normalized = (hash32(filePath) % 2001) / 1000 - 1; // [-1, 1]
  return Math.round(normalized * TINT_RANGE);
}

/**
 * Final per-file color: biome hue, health as vitality, identity as shade.
 * @param {number[]} biomeColor
 * @param {number} health
 * @param {number} maxScore
 * @param {string} filePath
 * @returns {number[]} [R, G, B]
 */
export function fileColor(biomeColor, health, maxScore, filePath) {
  const base = blendColor(biomeColor, health, maxScore);
  const tint = pathTint(filePath);
  return base.map(c => clamp8(c + tint));
}

/**
 * Fraction of a patch's pixels that get stippled, from an indentation
 * complexity score. Saturates at the library's "high complexity" threshold
 * so that deeply nested files read as visibly dense undergrowth.
 * @param {number} complexity
 * @returns {number} 0..0.45
 */
export function stippleDensity(complexity) {
  if (!complexity || complexity <= 1) return 0;
  return Math.min(0.45, (complexity - 1) / 14 * 0.45);
}

function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function shade(color, factor) {
  return [clamp8(color[0] * factor), clamp8(color[1] * factor), clamp8(color[2] * factor)];
}

/**
 * Render the garden to a PNG file.
 * @param {Database} db 
 * @param {Object} config 
 * @param {Object} biomeColors 
 * @param {number[]} baseColor 
 * @param {number} gridW 
 * @param {number} gridH 
 * @param {number} PATCH_SIZE 
 * @param {string} repoRoot 
 */
export async function renderGarden(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE, repoRoot) {
  const { width, height, max_score } = config;
  const png = new PNG({ width, height, filterType: -1 });

  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = baseColor[0];
    png.data[i + 1] = baseColor[1];
    png.data[i + 2] = baseColor[2];
    png.data[i + 3] = 255;
  }

  const assigned = db.prepare(`
    SELECT fp.px, fp.py, f.id AS file_id, f.path, f.health, f.biome, f.complexity
    FROM file_patches fp
    JOIN files f ON f.id = fp.file_id
  `).all();

  // Which file owns each patch, so borders can be drawn between them.
  const owner = new Int32Array(gridW * gridH).fill(-1);
  for (const patch of assigned) {
    if (patch.px < gridW && patch.py < gridH) {
      owner[patch.py * gridW + patch.px] = patch.file_id;
    }
  }

  for (const patch of assigned) {
    const biomeColor = biomeColors[patch.biome] || [128, 128, 128];
    const color = fileColor(biomeColor, patch.health, max_score, patch.path);
    drawPatch(png, patch, color, owner, gridW, gridH, PATCH_SIZE, width, height);
  }

  const buffer = PNG.sync.write(png);
  const gitgardenDir = path.join(repoRoot, '.gitgarden');
  if (!fs.existsSync(gitgardenDir)) fs.mkdirSync(gitgardenDir, { recursive: true });
  fs.writeFileSync(path.join(gitgardenDir, 'garden.png'), buffer);

  const docsDir = path.join(repoRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    fs.writeFileSync(path.join(docsDir, 'garden.png'), buffer);
  }
}

/**
 * Draw one patch: flat fill, complexity stipple, and a darker edge wherever
 * the neighbouring patch belongs to a different file.
 * @param {PNG} png
 * @param {Object} patch
 * @param {number[]} color
 * @param {Int32Array} owner
 * @param {number} gridW
 * @param {number} gridH
 * @param {number} PATCH_SIZE
 * @param {number} width
 * @param {number} height
 */
function drawPatch(png, patch, color, owner, gridW, gridH, PATCH_SIZE, width, height) {
  const { px, py, file_id } = patch;
  const startX = px * PATCH_SIZE;
  const startY = py * PATCH_SIZE;

  const density = stippleDensity(patch.complexity);
  const speckle = shade(color, 0.72);
  const border = shade(color, 0.55);

  const neighbour = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return -1;
    return owner[ny * gridW + nx];
  };
  const edgeTop = neighbour(px, py - 1) !== file_id;
  const edgeBottom = neighbour(px, py + 1) !== file_id;
  const edgeLeft = neighbour(px - 1, py) !== file_id;
  const edgeRight = neighbour(px + 1, py) !== file_id;

  for (let dy = 0; dy < PATCH_SIZE && startY + dy < height; dy++) {
    for (let dx = 0; dx < PATCH_SIZE && startX + dx < width; dx++) {
      const x = startX + dx;
      const y = startY + dy;

      let pixel = color;

      if (density > 0) {
        // Hashing absolute coordinates keeps the texture stable between runs
        // and stops it from tiling visibly across a file's patches.
        const noise = (hash32(`${x}:${y}`) % 1000) / 1000;
        if (noise < density) pixel = speckle;
      }

      const onEdge =
        (edgeTop && dy === 0) ||
        (edgeBottom && dy === PATCH_SIZE - 1) ||
        (edgeLeft && dx === 0) ||
        (edgeRight && dx === PATCH_SIZE - 1);
      if (onEdge) pixel = border;

      const idx = (y * width + x) << 2;
      png.data[idx] = pixel[0];
      png.data[idx + 1] = pixel[1];
      png.data[idx + 2] = pixel[2];
      png.data[idx + 3] = 255;
    }
  }
}
