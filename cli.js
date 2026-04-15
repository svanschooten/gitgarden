#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import yaml from 'js-yaml';
import { loadConfig, generateStartingPoints } from './src/util.js';

function showHelp() {
    console.log('### Git Garden CLI ###\n\nUsage:');
    console.log('  git-garden install                           Install Git Garden workflow (uses [main, master] branches)');
    console.log('  git-garden install -b | --branch <name>      Install Git Garden workflow for a specific branch');
    console.log('  git-garden remove                            Remove Git Garden workflow from the current repository');
    console.log('  git-garden regenerate                        Clear state and start over');
}

async function prompt(question, defaultValue = '') {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const query = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    return new Promise(resolve => {
        rl.question(query, answer => {
            rl.close();
            resolve(answer.trim() || defaultValue);
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'install') {
        let branch;
        for (let i = 1; i < args.length; i++) {
            if (args[i] === '--branch' || args[i] === '-b') {
                branch = args[i + 1];
                break;
            }
        }

        await install(branch);
    } else if (command === 'remove') {
        await remove();
    } else if (command === 'regenerate') {
        await regenerate();
    } else {
        showHelp();
    }
}

async function regenerate() {
    const repoRoot = process.cwd();
    const stateFile = path.join(repoRoot, '.gitgarden-state.yaml');
    const gardenPng = path.join(repoRoot, 'garden.png');

    if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
        console.log('✓ Removed .gitgarden-state.yaml');
    }
    if (fs.existsSync(gardenPng)) {
        fs.unlinkSync(gardenPng);
        console.log('✓ Removed garden.png');
    }
    console.log('State cleared. Run your workflow to regenerate the garden.');
}

function checkOverlap(plantMap) {
    const extensions = {};
    for (const [plantName, plant] of Object.entries(plantMap.plants)) {
        for (const ext of plant.extensions) {
            if (extensions[ext]) {
                console.warn(`Warning: Extension ${ext} is defined for both ${extensions[ext]} and ${plantName}. This will create issues.`);
            }
            extensions[ext] = plantName;
        }
    }
}

async function install(branch) {
    const repoRoot = process.cwd();
    
    if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        console.error('Error: Current directory is not a git repository');
        process.exit(1);
    }

    const workflowDir = path.join(repoRoot, '.github', 'workflows');
    const workflowFile = path.join(workflowDir, 'maintain-garden.yml');
    const configFile = path.join(repoRoot, '.gitgarden-config.yaml');
    const stateFile = path.join(repoRoot, '.gitgarden-state.yaml');

    if (!fs.existsSync(workflowDir)) {
        const answer = await prompt('Do you want to create the GitHub Actions directory and initialize Git Garden? (y/n)');
        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log('Aborting installation.');
            process.exit(0);
        }
        fs.mkdirSync(workflowDir, { recursive: true });
    }

    let overwrite = false;
    if (fs.existsSync(configFile) || fs.existsSync(workflowFile) || fs.existsSync(stateFile)) {
        const answer = await prompt('Git Garden seems to be already installed. Overwrite all existing files? (y/n)');
        overwrite = (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    }

    const customizeConfig = async function (name, min, max, defaultValue, setFn, parseFn = parseInt) {
        let input;
        do {
            input = await prompt(`${name} (min ${min}, max ${max}) or '0' to cancel`, defaultValue);
            if (input === '0') {
                console.log('Customization cancelled. Using default values.');
                break;
            }
            input = parseFn(input);
            if (isNaN(input) || input < min || input > max) {
                console.log(`Invalid ${name}. Please enter a value between ${min} and ${max}, or '0' to cancel.`);
            } else {
                setFn(input);
            }
        } while (isNaN(input) || input < min || input > max);
    }

    if (overwrite || !fs.existsSync(configFile)) {
        const config = loadConfig();
        const defaultConfig = loadConfig(true);

        const customize = await prompt('Do you want to customize garden setup (min/max size etc.)? (y/n)');
        if (customize.toLowerCase() === 'y' || customize.toLowerCase() === 'yes') {
            await customizeConfig('width', 10, 1000, defaultConfig.width, (value) => config.width = value);
            await customizeConfig('height', 10, 1000, defaultConfig.height, (value) => config.height = value);
            await customizeConfig('max_score', 100, 256, defaultConfig.max_score, (value) => config.max_score = value);
            await customizeConfig('min_distance', 1, Math.floor(config.width / 2), defaultConfig.min_distance, (value) => config.min_distance = value);
        }

        const customizePlants = await prompt('Do you want to override default plant map? (y/n)');
        if (customizePlants.toLowerCase() === 'y' || customizePlants.toLowerCase() === 'yes') {
             console.log('Current plant map:');
             console.log(yaml.dump(defaultConfig.plant_map));
             const newPlantsYaml = await prompt('Provide new plant map in YAML format (or press enter to keep current)');
             if (newPlantsYaml) {
                 try {
                     const newPlants = yaml.load(newPlantsYaml);
                     if (newPlants) {
                         config.plant_map = newPlants;
                         checkOverlap(config.plant_map);
                     }
                 } catch (e) {
                     console.error('Error parsing YAML, keeping default plants.');
                 }
             } else {
                 config.plant_map = defaultConfig.plant_map;
             }
        }

        const plantNames = Object.keys(config.plant_map.plants);
        const minDistance = config.min_distance || 25;
        const points = generateStartingPoints(plantNames.length + 1, config.width, config.height, minDistance);

        config.starting_points = [
            {
                type: 'base',
                ...points.pop()
            }
        ];
        plantNames.forEach((name) => config.starting_points.push({
            type: name,
            ...points.pop()
        }));
        
        fs.writeFileSync(configFile, `# Git Garden Configuration
# Define static files or directories that should not be treated as growing plants\n` + yaml.dump(config));
        console.log('✓ Created .gitgarden-config.yaml');
    }

    if (overwrite || !fs.existsSync(workflowFile)) {
        const branchList = branch ? `[ ${branch} ]` : '[ main, master ]';
        const workflowContent = `name: Maintain Git Garden

on:
  push:
    branches: ${branchList}

jobs:
  maintain-garden:
    permissions:
      contents: write
    uses: svanschooten/gitgarden/.github/workflows/gitgarden.yml@main
`;

        fs.writeFileSync(workflowFile, workflowContent);
        console.log('✓ Git Garden workflow installed in .github/workflows/maintain-garden.yml');
    }

    if (overwrite || !fs.existsSync(stateFile)) {
        const stateFileContent = `state: something`;

        fs.writeFileSync(stateFile, stateFileContent);
        console.log('✓ Git Garden state file installed in .gitgarden-state.yaml');
    }

    const gitignoreFile = path.join(repoRoot, '.gitignore');
    const ignoreEntries = ['garden.png', '.git-garden-tool/'];
    if (fs.existsSync(gitignoreFile)) {
        let content = fs.readFileSync(gitignoreFile, 'utf8');
        let updated = false;
        for (const entry of ignoreEntries) {
            if (!content.includes(entry)) {
                content += (content.endsWith('\n') ? '' : '\n') + entry + '\n';
                updated = true;
            }
        }
        if (updated) {
            fs.writeFileSync(gitignoreFile, content);
            console.log('✓ .gitignore updated');
        }
    } else {
        fs.writeFileSync(gitignoreFile, ignoreEntries.join('\n') + '\n');
        console.log('✓ .gitignore created');
    }

    console.log('\nMake sure to commit these changes and push them to your repository.');
}

async function remove() {
    const repoRoot = process.cwd();
    const workflowFile = path.join(repoRoot, '.github', 'workflows', 'maintain-garden.yml');
    const configYaml = path.join(repoRoot, '.gitgarden-config.yaml');
    const configYml = path.join(repoRoot, '.gitgarden-config.yml');

    let removed = false;
    if (fs.existsSync(workflowFile)) {
        fs.unlinkSync(workflowFile);
        console.log('✓ Removed .github/workflows/maintain-garden.yml');
        removed = true;
    }

    if (fs.existsSync(configYaml)) {
        fs.unlinkSync(configYaml);
        console.log('✓ Removed .gitgarden-config.yaml');
        removed = true;
    }

    if (fs.existsSync(configYml)) {
        fs.unlinkSync(configYml);
        console.log('✓ Removed .gitgarden-config.yml');
        removed = true;
    }

    if (!removed) {
        console.log('Git Garden is not installed in this repository.');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
