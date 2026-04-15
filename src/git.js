import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

/**
 * Get diff statistics between two commits.
 * @param {string} repoRoot 
 * @param {string} fromCommit 
 * @param {string} toCommit 
 * @returns {Promise<Object>} Map of filepath to stats
 */
export async function getDiffStats(repoRoot, fromCommit, toCommit) {
  let stdout;
  try {
    const result = await execFileAsync('git', [
      'diff', '--numstat', '-M', fromCommit, toCommit
    ], { cwd: repoRoot });
    stdout = result.stdout;
  } catch (err) {
    // If it fails (e.g. fromCommit is invalid or initial commit), return empty
    console.warn(`Git diff failed: ${err.message}`);
    return {};
  }

  const stats = {};
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0];
    const deleted = parts[1];
    const rawPath = parts[2];
    
    let actualPath = rawPath;
    let renamedFrom = null;

    if (rawPath.includes(' => ')) {
      // Handle renames
      // Case 1: {dir => dir2}/file.js
      // Case 2: dir/{file => file2}.js
      // Case 3: file => file2
      const renameRegex = /^(.*)\{(.*) => (.*)\}(.*)$/;
      const match = rawPath.match(renameRegex);
      if (match) {
        const [_, prefix, oldPart, newPart, suffix] = match;
        renamedFrom = (prefix + oldPart + suffix).replace(/\/\//g, '/');
        actualPath = (prefix + newPart + suffix).replace(/\/\//g, '/');
      } else {
        const simpleRename = rawPath.split(' => ');
        if (simpleRename.length === 2) {
          renamedFrom = simpleRename[0].trim();
          actualPath = simpleRename[1].trim();
        }
      }
    }

    stats[actualPath] = {
      linesAdded: parseInt(added, 10) || 0,
      linesRemoved: parseInt(deleted, 10) || 0,
      renamedFrom
    };
  }
  return stats;
}
