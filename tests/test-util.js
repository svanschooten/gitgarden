import test from 'node:test';
import assert from 'node:assert';
import { generateStartingPoints, loadConfig, GitGardenConfig } from '../src/util.js';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

test('generateStartingPoints generates correct number of points', () => {
    const points = generateStartingPoints(5, 512, 512, 50);
    assert.strictEqual(points.length, 5);
});

test('generateStartingPoints respects min distance', () => {
    const points = generateStartingPoints(10, 512, 512, 50);
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = Math.sqrt(Math.pow(points[i].x - points[j].x, 2) + Math.pow(points[i].y - points[j].y, 2));
            assert.ok(dist >= 50, `Distance between point ${i} and ${j} is ${dist}, which is less than 50`);
        }
    }
});

test('loadConfig loads configuration correctly', () => {
    const config = loadConfig();
    assert.ok(config.width);
    assert.ok(config.height);
    assert.ok(config.max_score);
    assert.strictEqual(config.min_distance, 35);
    assert.ok(config.plant_map);
});

test('GitGardenConfig loads configuration correctly', () => {
    const config = new GitGardenConfig();
    assert.strictEqual(config.width, 512);
    assert.strictEqual(config.height, 512);
    assert.strictEqual(config.max_score, 200);
    assert.strictEqual(config.min_distance, 35);
    assert.ok(config.plant_map);
});

test('GitGardenConfig loads local starting points if present', () => {
    const dummyConfig = {
        width: 512,
        height: 512,
        max_score: 200,
        min_distance: 35,
        plant_map: { plants: {}, base: [0,0,0] },
        starting_points: [
            { type: 'base', x: 100, y: 100 },
            { type: 'grass', x: 200, y: 200 }
        ]
    };
    const configPath = path.join(process.cwd(), '.gitgarden-config.yaml');
    fs.writeFileSync(configPath, yaml.dump(dummyConfig));
    
    try {
        const config = new GitGardenConfig();
        assert.ok(config.starting_points);
        assert.strictEqual(config.starting_points.length, 2);
        assert.strictEqual(config.starting_points[0].type, 'base');
        assert.strictEqual(config.starting_points[0].x, 100);
    } finally {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    }
});
