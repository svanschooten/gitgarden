import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'child_process';
import { generateGarden } from '../src/garden.js';

const testRepoRoot = path.join(process.cwd(), 'test-repo-pipeline');

test('Full pipeline execution', async (t) => {
  if (fs.existsSync(testRepoRoot)) {
    fs.rmSync(testRepoRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(testRepoRoot);

  // Initialize git repo
  execSync('git init', { cwd: testRepoRoot });
  execSync('git config user.email "test@example.com"', { cwd: testRepoRoot });
  execSync('git config user.name "Test User"', { cwd: testRepoRoot });

  // Create some files
  fs.writeFileSync(path.join(testRepoRoot, 'a.js'), 'console.log("a");\n'.repeat(10));
  fs.writeFileSync(path.join(testRepoRoot, 'b.py'), 'print("b")\n'.repeat(5));
  
  execSync('git add .', { cwd: testRepoRoot });
  execSync('git commit -m "initial"', { cwd: testRepoRoot });
  const initialCommit = execSync('git rev-parse HEAD', { cwd: testRepoRoot }).toString().trim();

  await t.test('Initial generation', async () => {
    await generateGarden(testRepoRoot, null, initialCommit);
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'state.db')));
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'garden.png')));
  });

  await t.test('Subsequent generation with changes', async () => {
    fs.appendFileSync(path.join(testRepoRoot, 'a.js'), 'console.log("more");\n');
    execSync('git add a.js', { cwd: testRepoRoot });
    execSync('git commit -m "update"', { cwd: testRepoRoot });
    const secondCommit = execSync('git rev-parse HEAD', { cwd: testRepoRoot }).toString().trim();

    await generateGarden(testRepoRoot, initialCommit, secondCommit);
    assert.ok(fs.existsSync(path.join(testRepoRoot, '.gitgarden', 'garden.png')));
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
