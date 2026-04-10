import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { processGarden } from '../src/garden.js';

test('processGarden generates and "publishes" to a local repo', async () => {
    const root = process.cwd();
    const testDir = path.join(root, 'test-garden-run');
    const targetRepo = path.join(root, 'test-target-repo');
    
    if (fs.existsSync(targetRepo)) fs.rmSync(targetRepo, { recursive: true, force: true });
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

    fs.mkdirSync(targetRepo, { recursive: true });
    execSync('git init --bare', { cwd: targetRepo });

    fs.mkdirSync(testDir, { recursive: true });
    
    const mockDiffs = [
        { file: 'test.js', diff: '@@ -0,0 +1,1 @@\n+console.log("hello");' }
    ];

    process.env.GIT_AUTHOR_NAME = 'Test User';
    process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
    process.env.GIT_COMMITTER_NAME = 'Test User';
    process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
        await processGarden('test-repo', targetRepo, mockDiffs);
        
        process.chdir(originalCwd);
        const verifyDir = path.join(root, 'test-verify-repo');
        if (fs.existsSync(verifyDir)) fs.rmSync(verifyDir, { recursive: true, force: true });
        
        execSync(`git clone --branch gh-pages "${targetRepo}" "${verifyDir}"`);
        assert.ok(fs.existsSync(path.join(verifyDir, 'garden.png')), 'garden.png should exist in gh-pages branch');
        assert.ok(fs.existsSync(path.join(verifyDir, 'index.html')), 'index.html should exist in gh-pages branch');

        if (fs.existsSync(verifyDir)) fs.rmSync(verifyDir, { recursive: true, force: true });
    } finally {
        process.chdir(originalCwd);
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        if (fs.existsSync(targetRepo)) fs.rmSync(targetRepo, { recursive: true, force: true });
    }
});
