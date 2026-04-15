import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';

test('Randomization of biome centers during install', async () => {
    const testRepo = path.join(process.cwd(), 'test-repo-random');
    if (fs.existsSync(testRepo)) fs.rmSync(testRepo, { recursive: true, force: true });
    fs.mkdirSync(testRepo);
    execSync('git init', { cwd: testRepo });
    
    const cliPath = path.join(process.cwd(), 'cli.js');
    const rootConfigPath = path.join(process.cwd(), 'config.yaml');
    const rootConfig = yaml.load(fs.readFileSync(rootConfigPath, 'utf8'));
    
    // Run install twice in different repos to compare results
    execSync(`echo y | node ${cliPath} install`, { cwd: testRepo });
    const config1 = yaml.load(fs.readFileSync(path.join(testRepo, '.gitgarden', 'config.yaml'), 'utf8'));
    
    const testRepo2 = path.join(process.cwd(), 'test-repo-random-2');
    if (fs.existsSync(testRepo2)) fs.rmSync(testRepo2, { recursive: true, force: true });
    fs.mkdirSync(testRepo2);
    execSync('git init', { cwd: testRepo2 });
    
    execSync(`echo y | node ${cliPath} install`, { cwd: testRepo2 });
    const config2 = yaml.load(fs.readFileSync(path.join(testRepo2, '.gitgarden', 'config.yaml'), 'utf8'));
    
    // Check that config1 and config2 have different centers than rootConfig
    const biomes = Object.keys(rootConfig.plant_map.plants);
    
    for (const biome of biomes) {
        const rootCenter = rootConfig.plant_map.plants[biome].center;
        const center1 = config1.plant_map.plants[biome].center;
        const center2 = config2.plant_map.plants[biome].center;
        
        // It's technically possible but extremely unlikely to get the exact same random point
        assert.notDeepStrictEqual(center1, rootCenter, `Biome ${biome} center in config1 should be different from root`);
        assert.notDeepStrictEqual(center2, rootCenter, `Biome ${biome} center in config2 should be different from root`);
        assert.notDeepStrictEqual(center1, center2, `Biome ${biome} center in config1 should be different from config2`);
        
        // Verify min_distance from edges
        const minDistance = config1.min_distance;
        const width = config1.width;
        const height = config1.height;
        
        assert.ok(center1[0] >= minDistance && center1[0] <= width - minDistance, `Biome ${biome} x out of bounds: ${center1[0]}`);
        assert.ok(center1[1] >= minDistance && center1[1] <= height - minDistance, `Biome ${biome} y out of bounds: ${center1[1]}`);
    }
    
    // Verify min_distance between centers in config1
    const centers1 = biomes.map(b => ({ name: b, pos: config1.plant_map.plants[b].center }));
    for (let i = 0; i < centers1.length; i++) {
        for (let j = i + 1; j < centers1.length; j++) {
            const c1 = centers1[i].pos;
            const c2 = centers1[j].pos;
            const dist = Math.sqrt(Math.pow(c1[0] - c2[0], 2) + Math.pow(c1[1] - c2[1], 2));
            assert.ok(dist >= config1.min_distance, `Biomes ${centers1[i].name} and ${centers1[j].name} too close: ${dist} < ${config1.min_distance}`);
        }
    }

    fs.rmSync(testRepo, { recursive: true, force: true });
    fs.rmSync(testRepo2, { recursive: true, force: true });
});
