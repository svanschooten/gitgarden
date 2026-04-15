import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'child_process';
import { scanFiles } from '../src/scan.js';

const testRepoRoot = path.join(process.cwd(), 'test-repo-scan');

test('Repository scanning', async (t) => {
  if (fs.existsSync(testRepoRoot)) {
    fs.rmSync(testRepoRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(testRepoRoot);

  // Initialize git repo
  execSync('git init', { cwd: testRepoRoot });
  execSync('git config user.email "test@example.com"', { cwd: testRepoRoot });
  execSync('git config user.name "Test User"', { cwd: testRepoRoot });

  // Create some files
  fs.writeFileSync(path.join(testRepoRoot, 'test.js'), 'line1\nline2\nline3\n');
  fs.writeFileSync(path.join(testRepoRoot, 'test.py'), 'print("hello")\n');
  fs.mkdirSync(path.join(testRepoRoot, 'subdir'));
  fs.writeFileSync(path.join(testRepoRoot, 'subdir', 'other.js'), 'console.log("hi");\n');
  fs.writeFileSync(path.join(testRepoRoot, 'untracked.txt'), 'untracked\n');
  
  // Track some files
  execSync('git add test.js test.py subdir/other.js', { cwd: testRepoRoot });
  execSync('git commit -m "initial commit"', { cwd: testRepoRoot });

  const extensionToBiome = {
    '.js': 'grass',
    '.py': 'lavender'
  };

  await t.test('scanFiles lists only tracked files', async () => {
    const results = await scanFiles(testRepoRoot, extensionToBiome);
    assert.strictEqual(results.length, 3);
    
    const filePaths = results.map(r => r.path);
    assert.ok(filePaths.includes('test.js'));
    assert.ok(filePaths.includes('test.py'));
    assert.ok(filePaths.includes('subdir/other.js'));
    assert.ok(!filePaths.includes('untracked.txt'));
  });

  await t.test('scanFiles counts lines correctly', async () => {
    const results = await scanFiles(testRepoRoot, extensionToBiome);
    const testJs = results.find(r => r.path === 'test.js');
    assert.strictEqual(testJs.lineCount, 3);
    
    const testPy = results.find(r => r.path === 'test.py');
    assert.strictEqual(testPy.lineCount, 1);
  });

  await t.test('scanFiles assigns biomes correctly', async () => {
    const results = await scanFiles(testRepoRoot, extensionToBiome);
    const testJs = results.find(r => r.path === 'test.js');
    assert.strictEqual(testJs.biome, 'grass');
    
    const testPy = results.find(r => r.path === 'test.py');
    assert.strictEqual(testPy.biome, 'lavender');

    const otherJs = results.find(r => r.path === 'subdir/other.js');
    assert.strictEqual(otherJs.biome, 'grass');
  });

  await t.test('scanFiles skips static paths', async () => {
    const results = await scanFiles(testRepoRoot, extensionToBiome, ['subdir']);
    assert.strictEqual(results.length, 2);
    assert.ok(!results.some(r => r.path.startsWith('subdir')));
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
