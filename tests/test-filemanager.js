import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { localFileManager } from '../src/filemanager.js';

test('LocalFileManager saves and loads garden correctly', async () => {
    const testFilename = 'test-garden.png';
    const testPath = path.join(process.cwd(), testFilename);
    
    const { createCanvas } = await import('canvas');
    const canvas = createCanvas(10, 10);
    const buffer = canvas.toBuffer('image/png');

    try {
        localFileManager.saveGarden(testFilename, buffer);
        assert.ok(fs.existsSync(testPath), 'File should be saved');

        const loadedImage = await localFileManager.loadGarden(testFilename);
        assert.ok(loadedImage, 'Image should be loaded');
        assert.strictEqual(loadedImage.width, 10, 'Loaded image width should match');
        assert.strictEqual(loadedImage.height, 10, 'Loaded image height should match');
    } finally {
        if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
        }
    }
});
