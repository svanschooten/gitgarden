import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

test('cli install and remove', async () => {
    const testRepo = path.join(process.cwd(), 'test-repo-cli');
    if (fs.existsSync(testRepo)) fs.rmSync(testRepo, { recursive: true, force: true });
    fs.mkdirSync(testRepo);
    
    const cliPath = path.join(process.cwd(), 'cli.js');
    
    try {
        execSync(`node ${cliPath} install`, { cwd: testRepo, stdio: 'pipe' });
        assert.fail('Should have failed because not a git repo');
    } catch (e) {
        assert.ok(e.message.includes('Current directory is not a git repository'));
    }

    execSync('git init', { cwd: testRepo });
    
    execSync(`echo y | node ${cliPath} install`, { cwd: testRepo });
    
    assert.ok(fs.existsSync(path.join(testRepo, '.gitgarden', 'config.yaml')), 'Config file should exist');
    assert.ok(fs.existsSync(path.join(testRepo, '.github', 'workflows', 'maintain-garden.yml')), 'Workflow file should exist');
    const workflowContent = fs.readFileSync(path.join(testRepo, '.github', 'workflows', 'maintain-garden.yml'), 'utf8');
    assert.ok(workflowContent.includes('permissions:'), 'Workflow should have permissions');
    assert.ok(workflowContent.includes('contents: write'), 'Workflow should have contents: write permission');
    assert.ok(fs.existsSync(path.join(testRepo, '.gitignore')), 'Gitignore should exist');

    const configContent = fs.readFileSync(path.join(testRepo, '.gitgarden', 'config.yaml'), 'utf8');
    assert.ok(configContent.includes('width: 512'), 'Config should have width: 512');

    execSync(`node ${cliPath} remove`, { cwd: testRepo });
    assert.ok(!fs.existsSync(path.join(testRepo, '.github', 'workflows', 'maintain-garden.yml')), 'Workflow file should be removed');
    assert.ok(!fs.existsSync(path.join(testRepo, '.gitgarden', 'config.yaml')), 'Config file should be removed');
    
    fs.rmSync(testRepo, { recursive: true, force: true });
});

test('cli install with --branch', async () => {
    const testRepo = path.join(process.cwd(), 'test-repo-branch');
    if (fs.existsSync(testRepo)) fs.rmSync(testRepo, { recursive: true, force: true });
    fs.mkdirSync(testRepo);
    execSync('git init', { cwd: testRepo });
    
    const cliPath = path.join(process.cwd(), 'cli.js');
    
    fs.mkdirSync(path.join(testRepo, '.github', 'workflows'), { recursive: true });
    
    execSync(`node ${cliPath} install --branch develop`, { cwd: testRepo });
    
    const workflowContent = fs.readFileSync(path.join(testRepo, '.github', 'workflows', 'maintain-garden.yml'), 'utf8');
    assert.ok(workflowContent.includes('branches: [ develop ]'), 'Should use develop branch');
    
    fs.rmSync(testRepo, { recursive: true, force: true });
});
