#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { generateGarden } from './src/garden.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function showHelp() {
    console.log('### Git Garden CLI ###\n\nUsage:');
    console.log('  git-garden install                           Install Git Garden workflow');
    console.log('  git-garden install -b | --branch <name>      Install Git Garden workflow for a specific branch');
    console.log('  git-garden install -c | --configure          Install Git Garden and customize the configuration');
    console.log('  git-garden generate                          Generate the garden image');
    console.log('  git-garden generate --from <sha> --to <sha>  Generate between specific commits');
    console.log('  git-garden generate --fill-factor <0..1>     Override the fill factor');
    console.log('  git-garden remove                            Remove Git Garden workflow');
    console.log('  git-garden clear                             Clear state and start over');
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

async function handleInstall(args) {
    let branch;
    let configure = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--branch' || args[i] === '-b') {
            branch = args[++i];
        } else if (args[i] === '--configure' || args[i] === '-c') {
            configure = true;
        }
    }

    const repoRoot = process.cwd();
    
    if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        console.error('Error: Current directory is not a git repository');
        process.exit(1);
    }

    const workflowDir = path.join(repoRoot, '.github', 'workflows');
    const workflowFile = path.join(workflowDir, 'maintain-garden.yml');
    const gardenDir = path.join(repoRoot, '.gitgarden');
    const configFile = path.join(gardenDir, 'config.yaml');

    if (!fs.existsSync(workflowDir)) {
        const answer = await prompt('Do you want to create the GitHub Actions directory and initialize Git Garden? (Y/n)');
        if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
            console.log('Aborting installation.');
            process.exit(0);
        }
        fs.mkdirSync(workflowDir, { recursive: true });
    }

    let overwrite = false;
    if (fs.existsSync(configFile) || fs.existsSync(workflowFile) || fs.existsSync(gardenDir)) {
        const answer = await prompt('Git Garden seems to be already installed. Overwrite existing files? (y/N)');
        overwrite = (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    }

    if (configure || overwrite || !fs.existsSync(gardenDir)) {
        if (fs.existsSync(gardenDir) && (configure || overwrite)) {
            fs.rmSync(gardenDir, { recursive: true });
            console.log(`✓ Old directory ${gardenDir} cleaned up`);
        }
        if (!fs.existsSync(gardenDir)) {
            fs.mkdirSync(gardenDir, { recursive: true });
            console.log(`✓ Created  ${gardenDir} directory`);
        }
    }

    if (configure || overwrite || !fs.existsSync(configFile)) {
        const defaultConfigPath = path.join(__dirname, 'config.yaml');
        let config = {
            width: 512,
            height: 512,
            max_score: 200,
            min_distance: 35,
            fill_factor: 0.85,
            static_paths: []
        };

        if (fs.existsSync(defaultConfigPath)) {
            config = yaml.load(fs.readFileSync(defaultConfigPath, 'utf8'));
        }

        if (configure) {
            config.width = parseInt(await prompt('Garden width (between 100 and 1000)', config.width));
            config.height = parseInt(await prompt('Garden height (between 100 and 1000)', config.height));
            config.max_score = parseInt(await prompt('Max health score (between 100 and 256)', config.max_score));
            config.fill_factor = parseFloat(await prompt('Fill factor (between 0.1 and 0.9)', config.fill_factor));
            let static_path = await prompt('Add static path or press enter to continue');
            while (static_path) {
                config.static_paths.push(static_path);
                static_path = await prompt('Add another static path or press enter to finish');
            }
        }
        
        const configHeader = `# Git Garden Configuration
# For more info see https://github.com/svanschooten/gitgarden
`;
        fs.writeFileSync(configFile, configHeader + yaml.dump(config));
        console.log('✓ Created .gitgarden/config.yaml');
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

    updateGitignore(repoRoot);

    console.log('\nMake sure to commit these changes and push them to your repository.');
}

function updateGitignore(repoRoot) {
    const gitignoreFile = path.join(repoRoot, '.gitignore');
    const ignoreEntries = ['garden.png', '.git-garden-tool/', '.gitgarden/state.db', '.gitgarden/garden.png', '.gitgarden/garden.html'];
    
    if (fs.existsSync(gitignoreFile)) {
        let lines = fs.readFileSync(gitignoreFile, 'utf8').split(/\r?\n/);
        let updated = false;

        // Remove broad .gitgarden/ ignore if it exists to allow config.yaml to be tracked
        const broadIgnores = ['.gitgarden/', '.gitgarden'];
        for (const broad of broadIgnores) {
            const idx = lines.findIndex(l => l.trim() === broad);
            if (idx !== -1) {
                lines.splice(idx, 1);
                updated = true;
            }
        }

        for (const entry of ignoreEntries) {
            if (!lines.some(l => l.trim() === entry)) {
                lines.push(entry);
                updated = true;
            }
        }
        if (updated) {
            fs.writeFileSync(gitignoreFile, lines.join('\n'));
            console.log('✓ .gitignore updated');
        }
    } else {
        fs.writeFileSync(gitignoreFile, ignoreEntries.join('\n') + '\n');
        console.log('✓ .gitignore created');
    }
}

async function handleGenerate(args) {
    let fromCommit, toCommit, fillFactor;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--from') fromCommit = args[++i];
        else if (args[i] === '--to') toCommit = args[++i];
        else if (args[i] === '--fill-factor') fillFactor = parseFloat(args[++i]);
    }
    await generateGarden(process.cwd(), fromCommit, toCommit || 'HEAD', fillFactor);
}

async function handleRemove() {
    const repoRoot = process.cwd();
    const workflowFile = path.join(repoRoot, '.github', 'workflows', 'maintain-garden.yml');
    const stateDir = path.join(repoRoot, '.gitgarden');

    let removed = false;
    if (fs.existsSync(workflowFile)) {
        fs.unlinkSync(workflowFile);
        console.log('✓ Removed .github/workflows/maintain-garden.yml');
        removed = true;
    }

    if (fs.existsSync(stateDir)) {
        fs.rmSync(stateDir, { recursive: true, force: true });
        console.log('✓ Removed .gitgarden/ directory');
        removed = true;
    }

    if (!removed) {
        console.log('Git Garden is not installed in this repository.');
    }
}

async function handleClearState() {
    const repoRoot = process.cwd();
    const stateDir = path.join(repoRoot, '.gitgarden');
    const gardenPng = path.join(repoRoot, 'garden.png');

    if (fs.existsSync(stateDir)) {
        // We keep config.yaml but remove state.db
        const dbFile = path.join(stateDir, 'state.db');
        const gardenPngInDir = path.join(stateDir, 'garden.png');
        const gardenHtmlInDir = path.join(stateDir, 'garden.html');
        if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
        if (fs.existsSync(gardenPngInDir)) fs.unlinkSync(gardenPngInDir);
        if (fs.existsSync(gardenHtmlInDir)) fs.unlinkSync(gardenHtmlInDir);
        console.log('✓ Cleared .gitgarden state');
    }
    if (fs.existsSync(gardenPng)) {
        fs.unlinkSync(gardenPng);
        console.log('✓ Removed garden.png');
    }
    console.log('State cleared. Run "git-garden generate" to regenerate the garden.');
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case 'install':
                await handleInstall(args.slice(1));
                break;
            case 'generate':
                await handleGenerate(args.slice(1));
                break;
            case 'remove':
                await handleRemove();
                break;
            case 'clear':
                await handleClearState();
                break;
            case '-h':
            case '--help':
            case 'help':
            default:
                showHelp();
                break;
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

main().then(() => {
    process.exit(0);
});
