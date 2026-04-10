import {existsSync, readFileSync} from "fs";
import {fileURLToPath} from 'url';
import path from 'path';
import {execSync} from 'child_process';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig() {
    const configPath = path.join(__dirname, "..", "config.yaml");
    return yaml.load(readFileSync(configPath, "utf8"));
}

export function loadLocalConfig() {
    const configPath = path.join(process.cwd(), ".gitgarden-config.yaml");
    if (existsSync(configPath)) {
        return yaml.load(readFileSync(configPath, "utf8"));
    }
    return null;
}

export function loadColorMap() {
    const colorMapPath = path.join(__dirname, "..", "colormap.yaml");
    return yaml.load(readFileSync(colorMapPath, "utf8"));
}

export function generateStartingPoints(count, width, height, minDistance) {
    const points = [];
    let attempts = 0;
    while (points.length < count && attempts < 10000) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const tooClose = points.some(p => Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2)) < minDistance);
        if (!tooClose) {
            points.push({ x: x, y: y });
        }
        attempts++;
    }
    return points;
}

class GitGardenFileDiff {
    file;
    diff;
    constructor(file, diff) {
        this.file = file;
        this.diff = diff;
    }
}

export class GitGardenArguments {
    repo;
    target;
    diffs = [];
    constructor() {
        const args = process.argv.slice(2);
        while (args.length > 0) {
            const arg = args.shift();
            switch (arg) {
                case '--r':
                case '--repo':
                    if (this.repo) throw Error('Repository name already provided');
                    this.repo = args.shift();
                    break;
                case '--f':
                case '--file':
                    const file = args.shift()
                    if (!['--diff', '--d'].includes(args.shift())) throw Error(`Missing diff for file ${file}`);
                    this.diffs.push(new GitGardenFileDiff(file, args.shift()));
                    break;
                case '--t':
                case '--target':
                    if (this.target) throw Error('Target repository already provided');
                    this.target = args.shift();
                    break;
            }
        }

        if (!this.repo) throw Error('Repository name not provided');

        if (!this.target) {
            try {
                this.target = execSync('git remote get-url origin').toString().trim();
            } catch (e) {
                throw Error('Target repository not provided and could not be determined from remote origin');
            }
        }

        if (this.diffs.length === 0) throw Error('No files to compare');
    }
}

class Plant {
    color;
    extensions;
    name;
    constructor(name, color, extensions) {
        this.name = name;
        this.color = color;
        this.extensions = extensions;
    }
}

export class PlantMap {
    plants;
    base;
    unknown;
    constructor() {
        const colorMapDefinition = loadColorMap();
        this.plants = Object.entries(colorMapDefinition.plants).map(([name, plant]) => new Plant(name, plant.color, plant.extensions));
        this.base = colorMapDefinition.base;
        this.unknown = colorMapDefinition.unknown;
    }
    getByName(name) {
        return this.plants.find(p => p.name === name);
    }
    getByExtension(extension) {
        if (!extension.startsWith(".")) extension = `.${extension}`;
        for (const plant of this.plants) {
            if (plant.extensions.includes(extension)) return plant;
        }
        return null;
    }
}

export class GitGardenConfig {
    width;
    height;
    max_score;
    min_distance;
    starting_points;
    constructor() {
        const config = loadConfig();
        this.width = config.width;
        this.height = config.height;
        this.max_score = config.max_score;
        this.min_distance = config.min_distance || 25;

        const localConfig = loadLocalConfig();
        if (localConfig && localConfig.starting_points) {
            this.starting_points = localConfig.starting_points;
        }
    }
}

export class Diff {
    plant;
    coords;
    intensity;
    complexity;
    constructor(plant, coords, intensity, complexity) {
        this.plant = plant;
        this.coords = coords;
        this.intensity = intensity;
        this.complexity = complexity;
    }
}
