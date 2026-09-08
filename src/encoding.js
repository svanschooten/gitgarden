/**
 * The visual encoding, shared by both renderers.
 *
 * The PNG (render.js) and the interactive page (html.js) must agree on what a
 * file looks like. Everything that decides colour, texture or borders lives
 * here so there is one definition rather than two that drift apart.
 */

/** Colour a file decays toward as its health drops. */
export const WITHERED = [110, 80, 40];

/** How far a file's shade may drift from its biome colour, per channel. */
export const TINT_RANGE = 26;

/** Brightness factors applied to a file's fill for its speckle and its border. */
export const SPECKLE_SHADE = 0.72;
export const BORDER_SHADE = 0.55;

/**
 * Deterministic 32-bit FNV-1a hash. Used for anything that must look random
 * but stay identical across runs and between the PNG and the page.
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

/** Clamp to a valid colour byte. */
export function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Multiply a colour's brightness.
 * @param {number[]} color
 * @param {number} factor
 * @returns {number[]}
 */
export function shade(color, factor) {
  return [clamp8(color[0] * factor), clamp8(color[1] * factor), clamp8(color[2] * factor)];
}

/**
 * Blend a biome colour toward the withered colour as health drops.
 * @param {number[]} biomeColor [R, G, B]
 * @param {number} health
 * @param {number} maxScore
 * @returns {number[]} [R, G, B]
 */
export function blendColor(biomeColor, health, maxScore) {
  const t = health / maxScore;
  return [
    Math.round(WITHERED[0] + t * (biomeColor[0] - WITHERED[0])),
    Math.round(WITHERED[1] + t * (biomeColor[1] - WITHERED[1])),
    Math.round(WITHERED[2] + t * (biomeColor[2] - WITHERED[2]))
  ];
}

/**
 * A stable per-file shade offset, so neighbouring files of the same biome and
 * health stay distinguishable instead of merging into one flat blob.
 * @param {string} filePath
 * @returns {number} Offset in [-TINT_RANGE, TINT_RANGE]
 */
export function pathTint(filePath) {
  const normalized = (hash32(filePath) % 2001) / 1000 - 1; // [-1, 1]
  return Math.round(normalized * TINT_RANGE);
}

/**
 * Final per-file colour: biome hue, health as vitality, identity as shade.
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
 * Fraction of a patch that gets stippled, from an indentation complexity
 * score. Saturates at the library's "high complexity" threshold so deeply
 * nested files read as dense undergrowth.
 * @param {number} complexity
 * @returns {number} 0..0.45
 */
export function stippleDensity(complexity) {
  if (!complexity || complexity <= 1) return 0;
  return Math.min(0.45, (complexity - 1) / 14 * 0.45);
}

/**
 * Complexity as a coarse level, 0 (none) to 3 (dense).
 *
 * The PNG stipples individual pixels from `stippleDensity`; the page cannot,
 * because it has to stay sharp at any zoom, so it tiles a dot pattern instead.
 * Both read the same density — this bucketing is only how the page picks a
 * tile. It is the one place the two renderers deliberately differ.
 *
 * @param {number} complexity
 * @returns {number} 0-3
 */
export function complexityLevel(complexity) {
  const density = stippleDensity(complexity);
  if (density <= 0) return 0;
  if (density < 0.15) return 1;
  if (density < 0.3) return 2;
  return 3;
}

/** Dot tile per complexity level, for renderers that cannot stipple pixels. */
export const STIPPLE_TILES = [
  null,
  { spacing: 4, alpha: 0.20, radius: 0.30 },
  { spacing: 3, alpha: 0.28, radius: 0.34 },
  { spacing: 2, alpha: 0.36, radius: 0.38 }
];

/** Neighbour offsets matching the edge bits below: top, right, bottom, left. */
const EDGE_STEPS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];

/**
 * Which sides of a patch face a different file, as a bitfield:
 * 1 top, 2 right, 4 bottom, 8 left.
 *
 * @param {function(number, number): number} ownerAt Owning file id at a
 *   grid position, or -1 outside the garden
 * @param {number} x
 * @param {number} y
 * @param {number} fileId Owner of this patch
 * @returns {number} 0-15
 */
export function edgeBits(ownerAt, x, y, fileId) {
  let bits = 0;
  for (const [dx, dy, bit] of EDGE_STEPS) {
    if (ownerAt(x + dx, y + dy) !== fileId) bits |= bit;
  }
  return bits;
}
