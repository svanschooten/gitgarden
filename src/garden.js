import {GitGardenArguments} from './util.js'
import {generateGarden} from './visualizer.js';
import {analyzeDiff} from './analyzer.js';
import {execSync} from 'child_process';
import path from 'path';
import fs from 'fs';

import {fileURLToPath} from 'url';

function run(cmd, options = {}) {
    return execSync(cmd, { stdio: 'inherit', ...options });
}

export async function processGarden(repo, target, diffs) {
    for (const diff of diffs) {
        let obj = analyzeDiff(diff, repo)
        console.log(obj.plant, obj.coords, obj.intensity, obj.complexity);
    }

    const tempDir = path.join(process.cwd(), 'gh-pages-temp');
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir);

    let branchExists = true;

    try {
        console.log(`Cloning target repository: ${target}`);
        run(`git clone --branch gh-pages ${target} ${tempDir}`);
    } catch {
        branchExists = false;
        run(`git clone ${target} ${tempDir}`);
    }

    if (fs.existsSync(path.join(tempDir, 'garden.png'))) {
        fs.copyFileSync(path.join(tempDir, 'garden.png'), path.join(process.cwd(), 'garden.png'));
        console.log('✓ Loaded previous garden from target repository');
    }

    await generateGarden(diffs, repo)

    if (!branchExists) {
        console.log('Creating gh-pages branch...');
        run(`git checkout --orphan gh-pages`, { cwd: tempDir });
        run(`git rm -rf . || true`, { cwd: tempDir });
        fs.writeFileSync(
            path.join(tempDir, 'index.html'),
            `<!doctype html><html><head><title>GitGarden</title><style>
    body { background:#111; color:#eee; text-align:center; }
    img { max-width:95vw; }
  </style></head><body><h1>🌱 GitGarden (renewed!) </h1><img src="garden.png" /></body></html>`
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

    console.log('🌿 GitGarden updated and published');
}

async function main() {
    const {repo, target, diffs} = new GitGardenArguments();
    await processGarden(repo, target, diffs);
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith(path.sep + 'garden.js'))) {
    main().catch(err => {
        console.error('Error during garden generation:', err);
        process.exit(1);
    });
}
