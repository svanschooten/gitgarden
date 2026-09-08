import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import { analyzeComplexity } from 'indent-complexity';
import * as logger from './logger.js';

const execFileAsync = util.promisify(execFile);

/** `git ls-files` on a large repository exceeds the 1 MB default. */
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

/** Files above this size are counted but not complexity-analyzed. */
const MAX_ANALYZE_BYTES = 2 * 1024 * 1024;

/**
 * Scan the repository for files, filter by git-tracked and static paths,
 * and measure the size and complexity of each file.
 * @param {string} repoRoot 
 * @param {Object} extensionToBiome 
 * @param {string[]} staticPaths 
 * @returns {Promise<Array>}
 */
export async function scanFiles(repoRoot, extensionToBiome, staticPaths = []) {
  let paths;
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', 'ls-files'], {
      cwd: repoRoot,
      maxBuffer: MAX_GIT_OUTPUT
    });
    paths = stdout.split('\n').map(f => f.trim()).filter(Boolean);
  } catch {
    // Not a git repository (or git is unavailable): fall back to a tree walk.
    paths = walkTree(repoRoot);
  }

  const results = [];

  for (const relativePath of paths) {
    const parts = relativePath.split('/');
    if (parts.some(p => p === '.git' || p === 'node_modules' || p === '.gitgarden')) continue;
    if (staticPaths.some(p => relativePath.startsWith(p))) continue;

    const fullPath = path.join(repoRoot, relativePath);
    const measured = measureFile(fullPath);
    if (!measured) continue; // deleted from the working tree, or unreadable

    const ext = path.extname(relativePath);
    results.push({
      path: relativePath,
      biome: extensionToBiome[ext] || 'dirt',
      lineCount: Math.max(1, measured.lineCount),
      complexity: measured.complexity
    });
  }

  return results;
}

/**
 * Walk the working tree, skipping directories that never belong to a garden.
 * Only used when `git ls-files` is unavailable.
 * @param {string} repoRoot
 * @returns {string[]} Repo-relative paths
 */
function walkTree(repoRoot, prefix = '') {
  const skip = new Set(['.git', 'node_modules', '.gitgarden']);
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(repoRoot, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkTree(repoRoot, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Measure a file's line count and indentation complexity in a single read.
 * Binary and oversized files report a complexity of 0.
 * @param {string} filePath
 * @returns {{lineCount: number, complexity: number}|null}
 */
export function measureFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  let lineCount = 0;
  let binary = false;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === 10) lineCount++;
    else if (byte === 0) { binary = true; break; }
  }

  if (binary) {
    return { lineCount: 1, complexity: 0 };
  }

  // A trailing line without a newline still counts.
  if (buffer.length > 0 && buffer[buffer.length - 1] !== 10) lineCount++;

  if (stat.size > MAX_ANALYZE_BYTES) {
    return { lineCount, complexity: 0 };
  }

  let complexity = 0;
  try {
    complexity = analyzeComplexity(buffer.toString('utf8')).score || 0;
  } catch (err) {
    logger.log(`Complexity analysis failed for ${filePath}: ${err.message}`);
  }

  return { lineCount, complexity };
}
