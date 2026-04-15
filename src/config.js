import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getMeta } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(repoRoot, db) {
  const userConfigPath = path.join(repoRoot, '.gitgarden', 'config.yaml');
  const defaultConfigPath = path.join(__dirname, '..', 'config.yaml'); 

  let config = {
    width: 512,
    height: 512,
    max_score: 200,
    min_distance: 35,
    static_paths: [],
    plant_map: {
      plants: {},
      base: [138, 204, 255]
    }
  };

  if (fs.existsSync(defaultConfigPath)) {
    const defaultConfig = yaml.load(fs.readFileSync(defaultConfigPath, 'utf8'));
    config = { ...config, ...defaultConfig };
  }

  if (fs.existsSync(userConfigPath)) {
    const userConfig = yaml.load(fs.readFileSync(userConfigPath, 'utf8'));
    config = { ...config, ...userConfig };
  }

  // Validation
  if (config.width < 10) config.width = 10;
  if (config.height < 10) config.height = 10;
  if (config.max_score < 10) config.max_score = 10;
  if (config.min_distance < 1) config.min_distance = 1;

  const extensionToBiome = {};
  const biomeColors = {};
  const plantMap = config.plant_map || {};
  const baseColor = plantMap.base || [138, 204, 255];

  if (plantMap.plants) {
    for (const [biome, details] of Object.entries(plantMap.plants)) {
      biomeColors[biome] = details.color;
      if (details.extensions) {
        for (const ext of details.extensions) {
          if (extensionToBiome[ext]) {
            console.warn(`Warning: Extension ${ext} appears in more than one biome!`);
          }
          extensionToBiome[ext] = biome;
        }
      }
    }
  }

  // Hash detection
  const userConfigContent = fs.existsSync(userConfigPath) ? fs.readFileSync(userConfigPath, 'utf8') : '';
  const defaultConfigContent = fs.existsSync(defaultConfigPath) ? fs.readFileSync(defaultConfigPath, 'utf8') : '';
  
  const userConfigHash = crypto.createHash('sha256').update(userConfigContent).digest('hex');
  const defaultConfigHash = crypto.createHash('sha256').update(defaultConfigContent).digest('hex');

  const oldUserConfigHash = getMeta(db, 'config_hash');
  const oldDefaultConfigHash = getMeta(db, 'colormap_hash');

  const configChanged = userConfigHash !== oldUserConfigHash || defaultConfigHash !== oldDefaultConfigHash;

  return {
    config,
    extensionToBiome,
    biomeColors,
    baseColor,
    configChanged,
    currentConfigHash: userConfigHash,
    currentColormapHash: defaultConfigHash
  };
}

export function deriveGridConstants(config) {
  const PATCH_SIZE = 4;
  const gridW = Math.ceil(config.width / PATCH_SIZE);
  const gridH = Math.ceil(config.height / PATCH_SIZE);
  const totalPatches = gridW * gridH;
  return { PATCH_SIZE, gridW, gridH, totalPatches };
}
