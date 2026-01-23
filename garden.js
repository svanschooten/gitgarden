import {GitGardenArguments} from './util.js'
import { analyzeDiffComplexity } from 'indent-complexity';
import { readFileSync } from "fs";

const {repo, target, diffs} = new GitGardenArguments();
const SEED = 453214123413;
let config = JSON.parse(readFileSync("config.json", "utf8"));

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

for (const diff of diffs) {
    const diffStats = analyzeDiffComplexity(diff.diff, {verbose: true});
    const complexity = normalizeComplexity(diffStats.score, config.max_score);
    const coords = filePathToCoords(`${repo}::${diff.file}`, config.width, config.height);
    const intensity = normalizeIntensity(diffStats.lineCount);
}

