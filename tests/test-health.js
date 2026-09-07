import test from 'node:test';
import assert from 'node:assert';
import { computeHealth, decayPerCommit, replayHealth } from '../src/health.js';

/** Build a commit whose files are given as [path, added, removed, renamedFrom]. */
function commit(timestamp, files) {
  return {
    sha: `sha-${timestamp}`,
    timestamp,
    files: files.map(([path, linesAdded, linesRemoved, renamedFrom = null]) => ({
      path, linesAdded, linesRemoved, renamedFrom
    }))
  };
}

test('Health scoring logic', async (t) => {
  await t.test('computeHealth', () => {
    // Growth
    assert.strictEqual(computeHealth(100, 50, 0, 200), 105); // round(50/10) = 5
    assert.strictEqual(computeHealth(100, 250, 0, 200), 120); // capped at 20

    // Maintenance
    assert.strictEqual(computeHealth(100, 10, 10, 200), 105); // delta = 5

    // Decay
    assert.strictEqual(computeHealth(100, 0, 50, 200), 95); // round(50/10) = 5
    assert.strictEqual(computeHealth(100, 0, 200, 200), 90); // capped at 10

    // Clamp
    assert.strictEqual(computeHealth(5, 0, 100, 200), 0);
    assert.strictEqual(computeHealth(195, 200, 0, 200), 200);
  });

  await t.test('decayPerCommit spans the window', () => {
    // A file untouched for the whole window should land exactly on zero.
    assert.strictEqual(decayPerCommit(200, 100), 2);
    assert.strictEqual(decayPerCommit(200, 100) * 100, 200);
    assert.strictEqual(decayPerCommit(200, 0), 200); // guards against divide-by-zero
  });

  await t.test('replayHealth decays untouched files', () => {
    const commits = [
      commit(1000, [['a.js', 10, 0]]),
      commit(2000, [['a.js', 10, 0]]),
      commit(3000, [['a.js', 10, 0]])
    ];
    const health = replayHealth(
      new Set(['a.js', 'b.js']), commits, new Set(['a.js', 'b.js']), 200, 100
    );

    // a.js was touched every commit and was already at the cap.
    assert.strictEqual(health.get('a.js').health, 200);
    assert.strictEqual(health.get('a.js').commits, 3);
    assert.strictEqual(health.get('a.js').lastTouched, 3000);

    // b.js was never touched: 200 - 3 * 2.
    assert.strictEqual(health.get('b.js').health, 194);
    assert.strictEqual(health.get('b.js').commits, 0);
  });

  await t.test('replayHealth spares files created mid-window', () => {
    const commits = [
      commit(1000, [['old.js', 10, 0]]),
      commit(2000, [['old.js', 10, 0]]),
      commit(3000, [['new.js', 10, 0]])
    ];
    const health = replayHealth(
      new Set(['old.js', 'new.js']), commits, new Set(['old.js']), 200, 100
    );

    // new.js only existed for its own commit, so it never decayed.
    assert.strictEqual(health.get('new.js').health, 200);
    assert.strictEqual(health.get('new.js').commits, 1);
  });

  await t.test('replayHealth carries health through a rename', () => {
    const commits = [
      commit(1000, [['a.js', 0, 100]]),         // heavy deletion: 200 -> 190
      commit(2000, [['b.js', 1, 0, 'a.js']])    // renamed, small edit: 190 -> 191
    ];
    const health = replayHealth(new Set(['b.js']), commits, new Set(['a.js']), 200, 100);

    assert.strictEqual(health.get('b.js').health, 191);
    assert.strictEqual(health.get('b.js').commits, 2, 'history follows the rename');
  });

  await t.test('replayHealth reports untracked-in-history files as new', () => {
    const health = replayHealth(new Set(['fresh.js']), [], new Set(), 200, 100);
    assert.strictEqual(health.get('fresh.js').health, 200);
    assert.strictEqual(health.get('fresh.js').lastTouched, 0);
  });

  await t.test('replayHealth is deterministic', () => {
    const commits = [commit(1000, [['a.js', 30, 5]]), commit(2000, [['b.js', 4, 0]])];
    const paths = new Set(['a.js', 'b.js']);
    const first = replayHealth(paths, commits, new Set(['a.js', 'b.js']), 200, 100);
    const second = replayHealth(paths, commits, new Set(['a.js', 'b.js']), 200, 100);
    assert.deepStrictEqual([...first], [...second]);
  });
});
