/**
 * Compute the new health score based on lines added and removed.
 * @param {number} currentHealth 
 * @param {number} linesAdded 
 * @param {number} linesRemoved 
 * @param {number} maxScore 
 * @returns {number}
 */
export function computeHealth(currentHealth, linesAdded, linesRemoved, maxScore) {
  let delta = 0;
  if (linesAdded >= linesRemoved * 2 && linesAdded > 0) {
    delta = Math.min(20, Math.max(1, Math.round(linesAdded / 10)));
  } else if (linesRemoved > linesAdded) {
    delta = -Math.min(10, Math.max(1, Math.round(linesRemoved / 10)));
  } else {
    delta = 5;
  }
  return Math.max(0, Math.min(maxScore, currentHealth + delta));
}

/**
 * Per-commit decay for a file nobody touched.
 *
 * Derived from the window length so that a file left untouched for the whole
 * replay lands at exactly 0: neglect is measured relative to how much history
 * the garden looks at, not an arbitrary constant.
 *
 * @param {number} maxScore
 * @param {number} historyLimit
 * @returns {number}
 */
export function decayPerCommit(maxScore, historyLimit) {
  return maxScore / Math.max(1, historyLimit);
}

/**
 * Replay health for every currently-tracked file across a window of commits.
 *
 * Every file starts at full health when it enters the window — either because
 * it already existed when the window opened, or because a commit created it —
 * and then moves with `computeHealth` on the commits that touch it and decays
 * on the commits that don't. Renames carry a file's accumulated health with it.
 *
 * This is a pure function of the git history, so the garden is reproducible
 * from a clean checkout and needs no stored state.
 *
 * @param {Set<string>} currentPaths Paths tracked at the tip of the window
 * @param {Array} commits Commits oldest-first, from getCommitHistory
 * @param {Set<string>} baselinePaths Paths that existed before the window opened
 * @param {number} maxScore
 * @param {number} historyLimit Window length the decay is calibrated against
 * @returns {Map<string, {health: number, lastTouched: number, commits: number}>}
 */
export function replayHealth(currentPaths, commits, baselinePaths, maxScore, historyLimit) {
  const decay = decayPerCommit(maxScore, historyLimit);

  // path -> { health, lastTouched, commits }; only files alive at this point
  // in the replay are present, so files created mid-window are not punished
  // for the commits that predate them.
  const live = new Map();
  for (const p of baselinePaths) {
    live.set(p, { health: maxScore, lastTouched: 0, commits: 0 });
  }

  for (const commit of commits) {
    const touched = new Set();

    for (const change of commit.files) {
      if (change.renamedFrom && live.has(change.renamedFrom)) {
        live.set(change.path, live.get(change.renamedFrom));
        live.delete(change.renamedFrom);
      }

      const entry = live.get(change.path) || { health: maxScore, lastTouched: 0, commits: 0 };
      entry.health = computeHealth(entry.health, change.linesAdded, change.linesRemoved, maxScore);
      entry.lastTouched = commit.timestamp;
      entry.commits += 1;
      live.set(change.path, entry);
      touched.add(change.path);
    }

    for (const [p, entry] of live) {
      if (!touched.has(p)) {
        entry.health = Math.max(0, entry.health - decay);
      }
    }
  }

  const result = new Map();
  for (const p of currentPaths) {
    const entry = live.get(p);
    result.set(p, entry
      ? { health: Math.round(entry.health), lastTouched: entry.lastTouched, commits: entry.commits }
      // Tracked in the working tree but absent from the replayed window
      // (uncommitted, or the history was shallow-cloned): treat as brand new.
      : { health: maxScore, lastTouched: 0, commits: 0 });
  }
  return result;
}
