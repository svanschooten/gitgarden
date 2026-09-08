import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import {
  hash32, shade, fileColor, stippleDensity, edgeBits,
  SPECKLE_SHADE, BORDER_SHADE
} from './encoding.js';

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
  const ownerAt = (x, y) =>
    (x < 0 || y < 0 || x >= gridW || y >= gridH) ? -1 : owner[y * gridW + x];

  for (const patch of assigned) {
    const biomeColor = biomeColors[patch.biome] || [128, 128, 128];
    const color = fileColor(biomeColor, patch.health, max_score, patch.path);
    const edges = edgeBits(ownerAt, patch.px, patch.py, patch.file_id);
    drawPatch(png, patch, color, edges, PATCH_SIZE, width, height);
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
 * Draw one patch: flat fill, complexity stipple, and a darker edge on every
 * side that faces a different file.
 * @param {PNG} png
 * @param {Object} patch
 * @param {number[]} color
 * @param {number} edges Bitfield: 1 top, 2 right, 4 bottom, 8 left
 * @param {number} PATCH_SIZE
 * @param {number} width
 * @param {number} height
 */
function drawPatch(png, patch, color, edges, PATCH_SIZE, width, height) {
  const startX = patch.px * PATCH_SIZE;
  const startY = patch.py * PATCH_SIZE;

  const density = stippleDensity(patch.complexity);
  const speckle = shade(color, SPECKLE_SHADE);
  const border = shade(color, BORDER_SHADE);

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
        ((edges & 1) && dy === 0) ||
        ((edges & 4) && dy === PATCH_SIZE - 1) ||
        ((edges & 8) && dx === 0) ||
        ((edges & 2) && dx === PATCH_SIZE - 1);
      if (onEdge) pixel = border;

      const idx = (y * width + x) << 2;
      png.data[idx] = pixel[0];
      png.data[idx + 1] = pixel[1];
      png.data[idx + 2] = pixel[2];
      png.data[idx + 3] = 255;
    }
  }
}
