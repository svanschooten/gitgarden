import { execFile } from 'child_process';
import util from 'util';
import * as logger from './logger.js';

const execFileAsync = util.promisify(execFile);

/** git log output on a large repository comfortably exceeds the 1 MB default. */
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

/**
 * Run a git command in the repository.
 * `core.quotePath=false` keeps non-ASCII paths literal instead of octal-escaped.
 * @param {string} repoRoot
 * @param {string[]} args
 * @returns {Promise<string>} stdout
 */
async function git(repoRoot, args) {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: repoRoot,
    maxBuffer: MAX_GIT_OUTPUT
  });
  return stdout;
}

/**
 * Split a `--numstat` path field into its real path and, for renames, the old path.
 * Git writes renames as either `a/{old => new}/c.js` or `old.js => new.js`.
 * @param {string} rawPath
 * @returns {{path: string, renamedFrom: string|null}}
 */
export function parseNumstatPath(rawPath) {
  if (!rawPath.includes(' => ')) return { path: rawPath, renamedFrom: null };

  const braceMatch = rawPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, oldPart, newPart, suffix] = braceMatch;
    return {
      path: (prefix + newPart + suffix).replace(/\/\//g, '/'),
      renamedFrom: (prefix + oldPart + suffix).replace(/\/\//g, '/')
    };
  }

  const parts = rawPath.split(' => ');
  if (parts.length === 2) {
    return { path: parts[1].trim(), renamedFrom: parts[0].trim() };
  }
  return { path: rawPath, renamedFrom: null };
}

/**
 * Parse one `added\tdeleted\tpath` numstat line. Binary files report `-`.
 * @param {string} line
 * @returns {{path: string, linesAdded: number, linesRemoved: number, renamedFrom: string|null}|null}
 */
function parseNumstatLine(line) {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const { path, renamedFrom } = parseNumstatPath(parts.slice(2).join('\t'));
  return {
    path,
    linesAdded: parseInt(parts[0], 10) || 0,
    linesRemoved: parseInt(parts[1], 10) || 0,
    renamedFrom
  };
}

/**
 * Read the commit history that the garden is replayed from.
 *
 * Returns at most `limit` commits ending at `ref`, oldest first, plus the
 * commit immediately preceding the window so callers can ask which files
 * already existed when the window opened.
 *
 * @param {string} repoRoot
 * @param {string} ref Commit-ish to end the window at (e.g. 'HEAD')
 * @param {number} limit Maximum number of commits to replay
 * @returns {Promise<{commits: Array, baseSha: string|null}>}
 */
export async function getCommitHistory(repoRoot, ref = 'HEAD', limit = 100) {
  let stdout;
  try {
    stdout = await git(repoRoot, [
      'log', '--no-merges', '-M', '--numstat',
      '--format=%x00%H%x00%ct',
      `-n${limit}`, ref
    ]);
  } catch (err) {
    logger.warn(`Could not read git history: ${err.message}`);
    return { commits: [], baseSha: null };
  }

  const commits = [];
  let current = null;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('\0')) {
      const [, sha, ts] = line.split('\0');
      current = { sha, timestamp: parseInt(ts, 10) || 0, files: [] };
      commits.push(current);
      continue;
    }
    if (!line || !current) continue;
    const stat = parseNumstatLine(line);
    if (stat) current.files.push(stat);
  }

  // git log is newest-first; the replay runs forwards through time.
  commits.reverse();

  let baseSha = null;
  if (commits.length > 0) {
    try {
      baseSha = (await git(repoRoot, ['rev-parse', '--verify', `${commits[0].sha}^`])).trim();
    } catch {
      baseSha = null; // window reaches the root commit
    }
  }

  return { commits, baseSha };
}

/**
 * List every file tracked at a given commit.
 * @param {string} repoRoot
 * @param {string|null} sha
 * @returns {Promise<Set<string>>}
 */
export async function getTreeFiles(repoRoot, sha) {
  if (!sha) return new Set();
  try {
    const stdout = await git(repoRoot, ['ls-tree', '-r', '--name-only', sha]);
    return new Set(stdout.split('\n').map(f => f.trim()).filter(Boolean));
  } catch (err) {
    logger.warn(`Could not list files at ${sha}: ${err.message}`);
    return new Set();
  }
}

/**
 * Get the GitHub Pages URL for the repository.
 * @param {string} repoRoot 
 * @returns {Promise<string|null>}
 */
export async function getGitHubPagesUrl(repoRoot) {
  let url;
  try {
    url = (await git(repoRoot, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    return null;
  }

  // https://github.com/owner/repo[.git] or git@github.com:owner/repo[.git]
  const match = url.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) return null;

  const [, owner, repo] = match;
  return `https://${owner}.github.io/${repo}/garden.html`;
}
