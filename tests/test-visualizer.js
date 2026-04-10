import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { generateGarden } from '../src/visualizer.js';

test('generateGarden generates a garden image', async () => {
    const mockCommit = [
        { file: 'test.js', diff: '@@ -0,0 +1,1 @@\n+console.log("hello");' },
        { file: 'README.md', diff: '@@ -0,0 +1,1 @@\n+# Test Repo' }
    ];
    const repoName = 'test-repo';
    const gardenFilename = 'garden.png';
    const gardenPath = path.join(process.cwd(), gardenFilename);

    if (fs.existsSync(gardenPath)) {
        fs.unlinkSync(gardenPath);
    }

    try {
        await generateGarden(mockCommit, repoName);
        assert.ok(fs.existsSync(gardenPath), 'garden.png should be created');
        
        const stats = fs.statSync(gardenPath);
        assert.ok(stats.size > 0, 'garden.png should not be empty');
    } finally {
        if (fs.existsSync(gardenPath)) {
            fs.unlinkSync(gardenPath);
        }
    }
});
