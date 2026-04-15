import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

/**
 * Blend biome color with withered color based on health.
 * @param {number[]} biomeColor [R, G, B]
 * @param {number} health 
 * @param {number} maxScore 
 * @returns {number[]} [R, G, B]
 */
export function blendColor(biomeColor, health, maxScore) {
  const t = health / maxScore;  // 0.0 = withered, 1.0 = full bloom
  const withered = [110, 80, 40]; // desaturated brown
  const r = Math.round(withered[0] + t * (biomeColor[0] - withered[0]));
  const g = Math.round(withered[1] + t * (biomeColor[1] - withered[1]));
  const b = Math.round(withered[2] + t * (biomeColor[2] - withered[2]));
  return [r, g, b];
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

  // Fill background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = baseColor[0];
    png.data[i + 1] = baseColor[1];
    png.data[i + 2] = baseColor[2];
    png.data[i + 3] = 255;
  }

  // Draw assigned patches
  const assigned = db.prepare(`
    SELECT fp.px, fp.py, f.health, f.biome
    FROM file_patches fp
    JOIN files f ON f.id = fp.file_id
  `).all();

  for (const patch of assigned) {
    const bColor = biomeColors[patch.biome] || [128, 128, 128];
    const color = blendColor(bColor, patch.health, max_score);
    drawPatch(png, patch.px, patch.py, color, PATCH_SIZE, width, height);
  }

  // Write to files
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
 * Draw a single patch as a square block of pixels.
 * @param {PNG} png 
 * @param {number} px 
 * @param {number} py 
 * @param {number[]} color 
 * @param {number} PATCH_SIZE 
 * @param {number} width 
 * @param {number} height 
 */
function drawPatch(png, px, py, color, PATCH_SIZE, width, height) {
  const startX = px * PATCH_SIZE;
  const startY = py * PATCH_SIZE;
  for (let dy = 0; dy < PATCH_SIZE && startY + dy < height; dy++) {
    for (let dx = 0; dx < PATCH_SIZE && startX + dx < width; dx++) {
      const idx = ((startY + dy) * width + (startX + dx)) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = 255;
    }
  }
}
