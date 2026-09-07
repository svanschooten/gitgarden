import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'child_process';
import { generateGarden } from '../src/garden.js';
import { openDb, closeDb } from '../src/db.js';
import { silence } from '../src/logger.js';

// node --test parses this process's stdout for its own IPC stream; library
// logging must not be interleaved into it.
silence();

const testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-pipeline-'));

function git(cmd) {
  execSync(cmd, { cwd: testRepoRoot, stdio: 'pipe' });
}

test('Full pipeline execution', async (t) => {
  git('git init');
  git('git config user.email "test@example.com"');
  git('git config user.name "Test User"');

  fs.writeFileSync(path.join(testRepoRoot, 'a.js'), 'console.log("a");\n'.repeat(10));
  fs.writeFileSync(path.join(testRepoRoot, 'b.py'), 'print("b")\n'.repeat(5));
  git('git add .');
  git('git commit -m "initial"');

  await t.test('Initial generation', async () => {
    await generateGarden(testRepoRoot);
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'state.db')));
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'garden.png')));
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'garden.html')));
  });

  await t.test('Health is replayed from history, not accumulated', async () => {
    // Twenty commits that only ever touch a.js; b.py should be visibly neglected.
    for (let i = 0; i < 20; i++) {
      fs.appendFileSync(path.join(testRepoRoot, 'a.js'), `console.log("${i}");\n`);
      git('git add a.js');
      git(`git commit -m "edit ${i}"`);
    }

    await generateGarden(testRepoRoot, { historyLimit: 100 });

    const db = openDb(testRepoRoot);
    const a = db.prepare('SELECT * FROM files WHERE path = ?').get('a.js');
    const b = db.prepare('SELECT * FROM files WHERE path = ?').get('b.py');
    closeDb(db);

    assert.ok(a.health > b.health, 'the actively edited file is healthier');
    assert.strictEqual(a.health, 200, 'constant edits keep a file at full health');
    assert.strictEqual(b.health, 160, '200 - 20 untouched commits * 2');
    assert.ok(a.last_merge > 0, 'last_merge comes from the commit timestamp');
    assert.strictEqual(b.commit_count, 1, 'b.py was only ever touched by the initial commit');
  });

  await t.test('Generation is reproducible from a clean state', async () => {
    const db = openDb(testRepoRoot);
    const before = db.prepare('SELECT path, health, last_merge, commit_count FROM files ORDER BY path').all();
    closeDb(db);

    // Throwing the database away must not change the result.
    for (const f of ['state.db', 'state.db-wal', 'state.db-shm']) {
      fs.rmSync(path.join(testRepoRoot, '.gitgarden', f), { force: true });
    }
    await generateGarden(testRepoRoot, { historyLimit: 100 });

    const db2 = openDb(testRepoRoot);
    const after = db2.prepare('SELECT path, health, last_merge, commit_count FROM files ORDER BY path').all();
    closeDb(db2);

    assert.deepStrictEqual(after, before);
  });

  await t.test('A narrower history window withers everything', async () => {
    await generateGarden(testRepoRoot, { historyLimit: 5 });

    const db = openDb(testRepoRoot);
    const b = db.prepare('SELECT health FROM files WHERE path = ?').get('b.py');
    closeDb(db);

    // Five commits of decay at max_score/5 = 40 each.
    assert.strictEqual(b.health, 0);
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
