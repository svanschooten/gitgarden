import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';

const execFileAsync = util.promisify(execFile);

/**
 * Scan the repository for files, filter by git-tracked and static paths,
 * and count lines in each file.
 * @param {string} repoRoot 
 * @param {Object} extensionToBiome 
 * @param {string[]} staticPaths 
 * @returns {Promise<Array>}
 */
export async function scanFiles(repoRoot, extensionToBiome, staticPaths = []) {
  // 1. Get tracked files from git
  let trackedFilesSet;
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
    trackedFilesSet = new Set(stdout.split('\n').map(f => f.trim()).filter(Boolean));
  } catch (err) {
    // If not a git repo, assume all files are "tracked" for now
    trackedFilesSet = null;
  }

  // 2. Walk the file tree
  const results = [];
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (entry.isDirectory()) continue;

    // Get path relative to repoRoot
    const fullPath = path.join(entry.parentPath, entry.name);
    const relativePath = path.relative(repoRoot, fullPath);

    // Skip ignored directories
    const parts = relativePath.split(path.sep);
    if (parts.some(p => p === '.git' || p === 'node_modules' || p === '.gitgarden')) continue;

    // Skip static paths
    if (staticPaths.some(p => relativePath.startsWith(p))) continue;

    // Apply git tracked check
    if (trackedFilesSet && !trackedFilesSet.has(relativePath)) continue;

    const ext = path.extname(relativePath);
    const biome = extensionToBiome[ext] || 'dirt';
    const lineCount = await countLines(fullPath);

    results.push({
      path: relativePath,
      biome,
      lineCount: Math.max(1, lineCount)
    });
  }

  return results;
}

/**
 * Count lines in a file by reading it in chunks.
 * @param {string} filePath 
 * @returns {Promise<number>}
 */
function countLines(filePath) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const stream = fs.createReadStream(filePath);
    stream
      .on('data', chunk => {
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === 10) count++;
        }
      })
      .on('end', () => {
        stream.destroy();
        resolve(count);
      })
      .on('error', err => {
        stream.destroy();
        reject(err);
      });
  });
}
