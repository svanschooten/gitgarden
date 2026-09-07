import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'child_process';
import { getCommitHistory, getTreeFiles, getGitHubPagesUrl, parseNumstatPath } from '../src/git.js';

const testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-git-'));

test('Git history reading', async (t) => {
  execSync('git init', { cwd: testRepoRoot });
  execSync('git config user.email "test@example.com"', { cwd: testRepoRoot });
  execSync('git config user.name "Test User"', { cwd: testRepoRoot });

  fs.writeFileSync(path.join(testRepoRoot, 'file1.js'), 'line1\nline2\n');
  execSync('git add file1.js', { cwd: testRepoRoot });
  execSync('git commit -m "initial commit"', { cwd: testRepoRoot });
  const initialCommit = execSync('git rev-parse HEAD', { cwd: testRepoRoot }).toString().trim();

  fs.appendFileSync(path.join(testRepoRoot, 'file1.js'), 'line3\n');
  fs.writeFileSync(path.join(testRepoRoot, 'file2.js'), 'new file\n');
  execSync('git mv file1.js file1_new.js', { cwd: testRepoRoot });
  execSync('git add .', { cwd: testRepoRoot });
  execSync('git commit -m "update and rename"', { cwd: testRepoRoot });

  await t.test('parseNumstatPath handles both rename forms', () => {
    assert.deepStrictEqual(parseNumstatPath('src/a.js'), { path: 'src/a.js', renamedFrom: null });
    assert.deepStrictEqual(parseNumstatPath('old.js => new.js'), { path: 'new.js', renamedFrom: 'old.js' });
    assert.deepStrictEqual(
      parseNumstatPath('src/{old => new}/a.js'),
      { path: 'src/new/a.js', renamedFrom: 'src/old/a.js' }
    );
  });

  await t.test('getCommitHistory returns commits oldest-first with stats', async () => {
    const { commits, baseSha } = await getCommitHistory(testRepoRoot, 'HEAD', 100);
    assert.strictEqual(commits.length, 2);
    assert.strictEqual(commits[0].sha, initialCommit);
    assert.ok(commits[0].timestamp > 0);
    assert.strictEqual(baseSha, null, 'window reaches the root commit');

    const created = commits[0].files.find(f => f.path === 'file1.js');
    assert.strictEqual(created.linesAdded, 2);

    const renamed = commits[1].files.find(f => f.path === 'file1_new.js');
    assert.strictEqual(renamed.renamedFrom, 'file1.js');
    assert.strictEqual(renamed.linesAdded, 1);
  });

  await t.test('getCommitHistory honours the window limit', async () => {
    const { commits, baseSha } = await getCommitHistory(testRepoRoot, 'HEAD', 1);
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(baseSha, initialCommit, 'baseSha is the commit before the window');
  });

  await t.test('getTreeFiles lists files at a commit', async () => {
    const atInitial = await getTreeFiles(testRepoRoot, initialCommit);
    assert.deepStrictEqual([...atInitial].sort(), ['file1.js']);
    assert.strictEqual((await getTreeFiles(testRepoRoot, null)).size, 0);
  });

  await t.test('getGitHubPagesUrl detects URL from origin', async () => {
    execSync('git remote add origin https://github.com/user/project.git', { cwd: testRepoRoot });
    assert.strictEqual(await getGitHubPagesUrl(testRepoRoot), 'https://user.github.io/project/garden.html');

    execSync('git remote set-url origin git@github.com:sshuser/sshproject.git', { cwd: testRepoRoot });
    assert.strictEqual(await getGitHubPagesUrl(testRepoRoot), 'https://sshuser.github.io/sshproject/garden.html');

    // Repository names may contain dots.
    execSync('git remote set-url origin https://github.com/user/my.repo.git', { cwd: testRepoRoot });
    assert.strictEqual(await getGitHubPagesUrl(testRepoRoot), 'https://user.github.io/my.repo/garden.html');
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
