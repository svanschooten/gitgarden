import fs from 'fs';
import path from 'path';
import { getGitHubPagesUrl } from './git.js';
import * as logger from './logger.js';

/**
 * Update the README.md with the Git Garden badge.
 * @param {string} repoRoot 
 */
export async function updateBadge(repoRoot) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    logger.warn('Warning: README.md not found in the current directory.');
    return;
  }

  let content = fs.readFileSync(readmePath, 'utf8');
  let gardenUrl = await getGitHubPagesUrl(repoRoot);
  if (!gardenUrl) {
    gardenUrl = 'URL_TO_GARDEN_PAGE';
  }

  const badgeUrl = 'https://badges.ws/badge/Git%20Garden-green?icon=gumtree';
  const badgeMarkdown = `[<img src="${badgeUrl}" />](${gardenUrl})`;
  
  const startTag = '<!-- git-garden-badge-start -->';
  const endTag = '<!-- git-garden-badge-end -->';
  
  const badgeBlock = `${startTag}\n${badgeMarkdown}\n${endTag}`;
  
  const startIndex = content.indexOf(startTag);
  const endIndex = content.indexOf(endTag);
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex + endTag.length);
    content = before + badgeBlock + after;
    logger.info('✓ Updated existing Git Garden badge in README.md');
  } else {
    content = badgeBlock + '\n\n' + content;
    logger.info('✓ Added Git Garden badge to the top of README.md');
  }
  
  fs.writeFileSync(readmePath, content, 'utf8');
}
