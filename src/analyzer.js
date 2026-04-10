import {analyzeDiffComplexity} from 'indent-complexity';
import {Diff, GitGardenConfig, PlantMap} from './util.js';
import crypto from "crypto";

const plantMap = new PlantMap();
const config = new GitGardenConfig();

function normalizeComplexity(score, max = 200) {
    return Math.min(score / max, 1);
}

function normalizeIntensity(intensity, max = 200) {
    return Math.min(intensity / max, 1);
}

function filePathToCoords(filePath, width, height, startingPoint) {
    const hash = crypto.createHash("sha1").update(filePath).digest("hex");
    const num = parseInt(hash.slice(0, 8), 16);

    if (!startingPoint) {
        return {
            x: num % width,
            y: Math.floor(num / width) % height
        };
    }
    
    const range = 100;
    const xOffset = (num % (range * 2)) - range;
    const yOffset = (Math.floor(num / range) % (range * 2)) - range;

    return {
        x: (startingPoint.x + xOffset + width) % width,
        y: (startingPoint.y + yOffset + height) % height
    };
}

export function analyzeDiff(diff, repoName){
    const diffStats = analyzeDiffComplexity(diff.diff, {verbose: true, include: "both"});
    const complexity = normalizeComplexity(diffStats.score, config.max_score);
    const plant = plantMap.getByExtension(diff.file.split(".").pop());
    
    const typeName = plant ? plant.name : 'base';
    const startingPoint = config.starting_points?.find(p => p.type === typeName);
    
    const coords = filePathToCoords(`${repoName}::${diff.file}`, config.width, config.height, startingPoint);
    const intensity = normalizeIntensity(diffStats.lineCount);
    return new Diff(plant, coords, intensity, complexity);
}
