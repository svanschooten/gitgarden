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

    const originalCwd = process.cwd();
    const originalAuthorName = process.env.GIT_AUTHOR_NAME;
    const originalAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
    const originalCommitterName = process.env.GIT_COMMITTER_NAME;
    const originalCommitterEmail = process.env.GIT_COMMITTER_EMAIL;

    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_COMMITTER_NAME;
    delete process.env.GIT_COMMITTER_EMAIL;
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
        if (originalAuthorName) process.env.GIT_AUTHOR_NAME = originalAuthorName;
        if (originalAuthorEmail) process.env.GIT_AUTHOR_EMAIL = originalAuthorEmail;
        if (originalCommitterName) process.env.GIT_COMMITTER_NAME = originalCommitterName;
        if (originalCommitterEmail) process.env.GIT_COMMITTER_EMAIL = originalCommitterEmail;
        
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        if (fs.existsSync(targetRepo)) fs.rmSync(targetRepo, { recursive: true, force: true });
    }
});
