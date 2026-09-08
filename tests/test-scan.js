import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'child_process';
import { scanFiles, measureFile } from '../src/scan.js';
import { silence } from '../src/logger.js';

// node --test parses this process's stdout for its own IPC stream; library
// logging must not be interleaved into it.
silence();

const testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-repo-scan-'));

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

  await t.test('scanFiles measures indentation complexity', async () => {
    fs.writeFileSync(path.join(testRepoRoot, 'nested.js'),
      'function a() {\n  if (x) {\n    for (;;) {\n      while (y) {\n        deep();\n      }\n    }\n  }\n}\n');
    fs.writeFileSync(path.join(testRepoRoot, 'flat.js'), 'a();\nb();\nc();\nd();\n');
    execSync('git add nested.js flat.js', { cwd: testRepoRoot });
    execSync('git commit -m "complexity fixtures"', { cwd: testRepoRoot });

    const results = await scanFiles(testRepoRoot, extensionToBiome);
    const nested = results.find(r => r.path === 'nested.js');
    const flat = results.find(r => r.path === 'flat.js');

    assert.ok(nested.complexity > flat.complexity, 'deeply nested code scores higher');
    assert.strictEqual(flat.complexity, 0, 'unindented code has no nesting cost');
  });

  await t.test('measureFile handles binary and newline-less files', () => {
    const binary = path.join(testRepoRoot, 'blob.bin');
    fs.writeFileSync(binary, Buffer.from([0x00, 0x01, 0x02, 0x00]));
    assert.deepStrictEqual(measureFile(binary), { lineCount: 1, complexity: 0 });

    const noTrailing = path.join(testRepoRoot, 'no-trailing.txt');
    fs.writeFileSync(noTrailing, 'one\ntwo');
    assert.strictEqual(measureFile(noTrailing).lineCount, 2, 'final line without \\n still counts');

    assert.strictEqual(measureFile(path.join(testRepoRoot, 'does-not-exist')), null);
  });

  await t.test('scanFiles skips static paths', async () => {
    const results = await scanFiles(testRepoRoot, extensionToBiome, ['subdir']);
    assert.ok(!results.some(r => r.path.startsWith('subdir')));
    assert.ok(results.some(r => r.path === 'test.js'));
  });

  fs.rmSync(testRepoRoot, { recursive: true, force: true });
});
