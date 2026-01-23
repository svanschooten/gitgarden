import { analyzeDiffComplexity } from 'indent-complexity';
import {GitGardenArguments, GitGardenConfig, PlantMap, Diff} from './util.js'
import { generateGarden } from './visualizer.js';
import crypto from "crypto";

// Configuration
const SEED = 453214123413;
const {repo, target, diffs} = new GitGardenArguments();
const plantMap = new PlantMap();
const config = new GitGardenConfig();

// Normalization functions
function normalizeComplexity(score, max = 200) {
    return Math.min(score / max, 1);
}

function normalizeIntensity(intensity, max = 200) {
    return Math.min(intensity / max, 1);
}

function filePathToCoords(filePath, width, height) {
    const hash = crypto.createHash("sha1").update(filePath).digest("hex");
    const num = parseInt(hash.slice(0, 8), 16);

    return {
        x: num % width,
        y: Math.floor(num / width) % height
    };
}

// Analyze diffs
for (const diff of diffs) {
    let obj = analyzeDiff(diff)
    console.log(obj.plant, obj.coords, obj.intensity, obj.complexity);
}

function analyzeDiff(diff){
    const diffStats = analyzeDiffComplexity(diff.diff, {verbose: true, include: "both"});
    const complexity = normalizeComplexity(diffStats.score, config.max_score);
    const coords = filePathToCoords(`${repo}::${diff.file}`, config.width, config.height);
    const intensity = normalizeIntensity(diffStats.lineCount);
    const plant = plantMap.getByExtension(diff.file.split(".").pop());
    return new Diff(plant, coords, intensity, complexity)
}

// Update garden
generateGarden(diffs)

// Publish the garden to target

