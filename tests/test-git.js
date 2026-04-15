import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'child_process';
import { getDiffStats, getGitHubPagesUrl } from '../src/git.js';

const testRepoRoot = path.join(process.cwd(), 'test-repo-git');

test('Git diff stats', async (t) => {
  if (fs.existsSync(testRepoRoot)) {
    fs.rmSync(testRepoRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(testRepoRoot);

  execSync('git init', { cwd: testRepoRoot });
  execSync('git config user.email "test@example.com"', { cwd: testRepoRoot });
  execSync('git config user.name "Test User"', { cwd: testRepoRoot });

  fs.writeFileSync(path.join(testRepoRoot, 'file1.js'), 'line1\nline2\n');
  execSync('git add file1.js', { cwd: testRepoRoot });
  execSync('git commit -m "initial commit"', { cwd: testRepoRoot });
  const initialCommit = execSync('git rev-parse HEAD', { cwd: testRepoRoot }).toString().trim();

  // Modify file1 and add file2
  fs.appendFileSync(path.join(testRepoRoot, 'file1.js'), 'line3\n');
  fs.writeFileSync(path.join(testRepoRoot, 'file2.js'), 'new file\n');
  
  // Rename file1 to file1_new.js
  execSync('git mv file1.js file1_new.js', { cwd: testRepoRoot });
  
  execSync('git add .', { cwd: testRepoRoot });
  execSync('git commit -m "update and rename"', { cwd: testRepoRoot });
  const secondCommit = execSync('git rev-parse HEAD', { cwd: testRepoRoot }).toString().trim();

  await t.test('getDiffStats detects changes and renames', async () => {
    const stats = await getDiffStats(testRepoRoot, initialCommit, secondCommit);
    
    assert.ok(stats['file2.js']);
    assert.strictEqual(stats['file2.js'].linesAdded, 1);
    
    assert.ok(stats['file1_new.js']);
    assert.strictEqual(stats['file1_new.js'].renamedFrom, 'file1.js');
    assert.strictEqual(stats['file1_new.js'].linesAdded, 1);
  });

  await t.test('getGitHubPagesUrl detects URL from origin', async () => {
    execSync('git remote add origin https://github.com/user/project.git', { cwd: testRepoRoot });
    const url = await getGitHubPagesUrl(testRepoRoot);
    assert.strictEqual(url, 'https://user.github.io/project/garden.html');

    execSync('git remote set-url origin git@github.com:sshuser/sshproject.git', { cwd: testRepoRoot });
    const sshUrl = await getGitHubPagesUrl(testRepoRoot);
    assert.strictEqual(sshUrl, 'https://sshuser.github.io/sshproject/garden.html');
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
