#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import yaml from 'js-yaml';
import { loadConfig, loadColorMap, generateStartingPoints } from './src/util.js';

function showHelp() {
    console.log('### Git Garden CLI ###\n\nUsage:');
    console.log('  git-garden install                           Install Git Garden workflow (uses [main, master] branches)');
    console.log('  git-garden install -b | --branch <name>      Install Git Garden workflow for a specific branch');
    console.log('  git-garden remove                            Remove Git Garden workflow from the current repository');
}

function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.toLowerCase());
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
    } else {
        showHelp();
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
        const answer = await prompt('Do you want to create the GitHub Actions directory and initialize Git Garden? (y/n): ');
        if (answer !== 'y' && answer !== 'yes') {
            console.log('Aborting installation.');
            process.exit(0);
        }
        fs.mkdirSync(workflowDir, { recursive: true });
    }


    if (!fs.existsSync(configFile)) {
        const colorMapDefinition = loadColorMap();
        const config = loadConfig();
        const plantNames = Object.keys(colorMapDefinition.plants);
        const minDistance = config.min_distance || 25;
        const points = generateStartingPoints(plantNames.length + 1, config.width, config.height, minDistance);

        const configContent = {
            starting_points: [
                {
                    type: 'base',
                    ...points.pop()
                }
            ]
        };
        plantNames.forEach((name) => configContent.starting_points.push({
            type: name,
            ...points.pop()
        }));
        
        fs.writeFileSync(configFile, `# Git Garden Configuration
# Define static files or directories that should not be treated as growing plants
static_paths: []
# Starting points for each plant\n` + yaml.dump(configContent));
        console.log('✓ Created .gitgarden-config.yaml with random starting points');
    }

    if (!fs.existsSync(workflowFile)) {
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

    if (!fs.existsSync(stateFile)) {
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
