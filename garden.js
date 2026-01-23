import { analyzeDiffComplexity } from 'indent-complexity';
import {GitGardenArguments, GitGardenConfig, PlantMap, Diff} from './util.js'
import { generateGarden } from './visualizer.js';
import { execSync } from 'child_process';
import crypto from "crypto";
import path from 'path';
import fs from 'fs';

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

export function analyzeDiff(diff){
    const diffStats = analyzeDiffComplexity(diff.diff, {verbose: true, include: "both"});
    const complexity = normalizeComplexity(diffStats.score, config.max_score);
    const coords = filePathToCoords(`${repo}::${diff.file}`, config.width, config.height);
    const intensity = normalizeIntensity(diffStats.lineCount);
    const plant = plantMap.getByExtension(diff.file.split(".").pop());
    return new Diff(plant, coords, intensity, complexity)
}

// Update garden
await generateGarden(diffs)

// Publish the garden to target
function run(cmd, options = {}) {
    return execSync(cmd, { stdio: 'inherit', ...options });
}
const tempDir = path.join(process.cwd(), 'gh-pages-temp');
if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir);

let branchExists = true;

try {
    run(`git clone --branch gh-pages ${target} ${tempDir}`);
} catch {
    branchExists = false;
    run(`git clone ${target} ${tempDir}`);
}

if (!branchExists) {
    console.log('Creating gh-pages branch...');
    run(`git checkout --orphan gh-pages`, { cwd: tempDir });
    run(`git rm -rf .`, { cwd: tempDir });
    fs.writeFileSync(
        path.join(tempDir, 'index.html'),
        `<!doctype html><html><head><title>GitGarden</title><style>
    body { background:#111; color:#eee; text-align:center; }
    img { max-width:95vw; }
  </style></head><body><h1>🌱 GitGarden</h1><img src="garden.png" /></body></html>`
    );
}

fs.copyFileSync(
    path.join(process.cwd(), 'garden.png'),
    path.join(tempDir, 'garden.png')
);

run(`git add .`, { cwd: tempDir });
run(`git commit -m "Update GitGarden" || true`, { cwd: tempDir });
run(`git push origin gh-pages`, { cwd: tempDir });
if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });

console.log('🌿 GitGarden published');
