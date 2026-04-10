import test from 'node:test';
import assert from 'node:assert';
import { analyzeDiff } from '../src/analyzer.js';

test('analyzeDiff returns correct structure', () => {
    const diff = {
        file: 'test.js',
        diff: '@@ -1,1 +1,1 @@\n-old\n+new'
    };
    const repoName = 'test-repo';
    const result = analyzeDiff(diff, repoName);

    assert.ok(result.plant);
    assert.ok(result.coords);
    assert.ok(typeof result.intensity === 'number');
    assert.ok(typeof result.complexity === 'number');
    assert.strictEqual(typeof result.coords.x, 'number');
    assert.strictEqual(typeof result.coords.y, 'number');
});

test('analyzeDiff identifies plant by extension', () => {
    const diffJs = { file: 'test.js', diff: 'test' };
    const resultJs = analyzeDiff(diffJs, 'repo');
    assert.strictEqual(resultJs.plant.name, 'grass');

    const diffPy = { file: 'test.py', diff: 'test' };
    const resultPy = analyzeDiff(diffPy, 'repo');
    assert.strictEqual(resultPy.plant.name, 'lavender');
});
