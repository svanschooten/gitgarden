import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { updateBadge } from '../src/badge.js';

const testRepo = path.join(process.cwd(), 'test-badge-repo');

test('Badge Command', async (t) => {
  if (fs.existsSync(testRepo)) {
    fs.rmSync(testRepo, { recursive: true, force: true });
  }
  fs.mkdirSync(testRepo);

  await t.test('should add a badge to the top if tags are not present', async () => {
    const readmePath = path.join(testRepo, 'README.md');
    fs.writeFileSync(readmePath, '# My Project\nExisting content');

    await updateBadge(testRepo);

    const content = fs.readFileSync(readmePath, 'utf8');
    assert.ok(content.startsWith('<!-- git-garden-badge-start -->'));
    assert.ok(content.includes('https://badges.ws/badge/Git%20Garden-green?icon=gumtree'));
    assert.ok(content.includes('<!-- git-garden-badge-end -->'));
    assert.ok(content.includes('# My Project'));
  });

  await t.test('should update existing badge between tags', async () => {
    const readmePath = path.join(testRepo, 'README.md');
    fs.writeFileSync(readmePath, `
# My Project
<!-- git-garden-badge-start -->
OLD BADGE
<!-- git-garden-badge-end -->
Other content
`);

    await updateBadge(testRepo);

    const content = fs.readFileSync(readmePath, 'utf8');
    assert.ok(content.includes('<!-- git-garden-badge-start -->'));
    assert.ok(content.includes('https://badges.ws/badge/Git%20Garden-green?icon=gumtree'));
    assert.ok(content.includes('<!-- git-garden-badge-end -->'));
    assert.ok(!content.includes('OLD BADGE'));
    assert.ok(content.includes('# My Project'));
    assert.ok(content.includes('Other content'));
  });

  await t.test('should warn if README.md is missing', async () => {
    const missingReadmeRepo = path.join(testRepo, 'missing');
    fs.mkdirSync(missingReadmeRepo);
    // Should just log a warning and not crash
    await updateBadge(missingReadmeRepo);
  });

  fs.rmSync(testRepo, { recursive: true, force: true });
});
