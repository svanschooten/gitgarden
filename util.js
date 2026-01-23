import {readFileSync} from "fs";

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
        if (!this.target) throw Error('Target repository not provided');
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
    constructor() {
        const colorMapDefinition = JSON.parse(readFileSync("colormap.json", "utf8"));
        this.plants = Object.entries(colorMapDefinition.plants).map(([name, plant]) => new Plant(name, plant.color, plant.extensions));
        this.base = colorMapDefinition.base;
    }
    getByName(name) {
        return this.plants[name];
    }
    getByExtension(extension) {
        if (!extension.startsWith(".")) extension = `.${extension}`;
        for (const plant of Object.values(this.plants)) {
            if (plant.extensions.includes(extension)) return plant;
        }
        return null;
    }
}

export class GitGardenConfig {
    width;
    height;
    max_score;
    constructor() {
        const config = JSON.parse(readFileSync("config.json", "utf8"));
        this.width = config.width;
        this.height = config.height;
        this.max_score = config.max_score;
    }
}