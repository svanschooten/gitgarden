import { execFile } from 'child_process';
import util from 'util';
import * as logger from './logger.js';

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
    logger.warn(`Git diff failed: ${err.message}`);
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

/**
 * Get the GitHub Pages URL for the repository.
 * @param {string} repoRoot 
 * @returns {Promise<string|null>}
 */
export async function getGitHubPagesUrl(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot });
    const url = stdout.trim();
    
    // Patterns:
    // https://github.com/owner/repo[.git]
    // git@github.com:owner/repo[.git]
    
    const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?/);
    if (httpsMatch) {
      const owner = httpsMatch[1];
      const repo = httpsMatch[2];
      return `https://${owner}.github.io/${repo}/garden.html`;
    }
    
    const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?/);
    if (sshMatch) {
      const owner = sshMatch[1];
      const repo = sshMatch[2];
      return `https://${owner}.github.io/${repo}/garden.html`;
    }
    
    return null;
  } catch (err) {
    return null;
  }
}
