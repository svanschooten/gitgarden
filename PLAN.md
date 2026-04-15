# Git Garden — Merged Implementation Plan

This plan consolidates the three existing plans (PLAN.md, PLAN2.md, PLAN3.md) into a single, organized, and efficient implementation path. SQLite is introduced from the start to avoid refactoring a YAML-based state later. The approach uses **weighted Voronoi** for biome boundaries, **spiral-sorted patch assignment** for spatial clustering (simpler than Hilbert, works with any image dimensions), and **`pngjs`** for dependency-light PNG output.

---

## Phase 1 — Project Setup & Dependencies

### 1.1 Update `package.json`

- [ ] Replace `canvas` dependency with `pngjs` (pure-JS, no native compile, CI-safe)
- [ ] Add `better-sqlite3` for state management
- [ ] Keep `js-yaml` (already present, pure JS) and `indent-complexity`
- [ ] Confirm `"type": "module"` and `"engines": { "node": ">=24.0.0" }`

```json
{
  "dependencies": {
    "better-sqlite3": "^1^.0.0",
    "pngjs": "^2^.0.0",
    "js-yaml": "^3^.1.1",
    "indent-complexity": ".1.1"
  }
}
```

### 1.2 Create source modules

All generation logic lives under `src/`. Keep the existing `cli.js` at root.

```
src/
  garden.js       ← main orchestrator (entry point for generation pipeline)
  db.js           ← SQLite open, migrate, helpers
  config.js       ← load + validate config.yaml & colormap.yaml
  scan.js         ← repository file tree walker
  git.js          ← git diff/log parsing
  health.js       ← health scoring logic
  voronoi.js      ← weighted Voronoi biome map
  assign.js       ← spiral sort + file-to-patch assignment
  render.js       ← PNG pixel writer
  util.js         ← shared helpers (existing, extend as needed)
cli.js            ← CLI entry point (existing)
install.sh        ← global install script (existing)
```

---

## Phase 2 — Database Layer (`src/db.js`)

Migrate state from `.gitgarden-state.yaml` to SQLite immediately. The DB lives at `{repoRoot}/.gitgarden/state.db`.

### 2.1 Schema

```sql
-- Key/value store for run metadata
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Keys: install_commit, config_hash, colormap_hash, last_run_commit

-- One row per biome (plant type). Seeds are placed once and never moved.
CREATE TABLE IF NOT EXISTS biome_seeds (
  biome   TEXT PRIMARY KEY,       -- e.g. 'grass', 'lavender'
  cx      REAL NOT NULL,          -- seed x in patch-grid coords
  cy      REAL NOT NULL,          -- seed y in patch-grid coords
  weight  REAL NOT NULL DEFAULT 1.0
);

-- One row per tracked file
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY,
  path        TEXT UNIQUE NOT NULL,
  biome       TEXT NOT NULL,      -- references biome_seeds.biome
  line_count  INTEGER NOT NULL DEFAULT 0,
  health      INTEGER NOT NULL DEFAULT 100,   -- 0..max_score
  last_merge  INTEGER NOT NULL DEFAULT 0       -- unix timestamp
);

-- Absolute patch coordinates owned by each file.
-- Supports future incremental updates without schema changes.
CREATE TABLE IF NOT EXISTS file_patches (
  file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  px       INTEGER NOT NULL,
  py       INTEGER NOT NULL,
  PRIMARY KEY (file_id, px, py)
) WITHOUT ROWID;

-- Vacant patches per biome (for incremental growth)
CREATE TABLE IF NOT EXISTS vacant_patches (
  biome  TEXT NOT NULL,
  px     INTEGER NOT NULL,
  py     INTEGER NOT NULL,
  PRIMARY KEY (biome, px, py)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_file_patches_file ON file_patches(file_id);
CREATE INDEX IF NOT EXISTS idx_vacant_patches_biome ON vacant_patches(biome);
CREATE INDEX IF NOT EXISTS idx_files_biome ON files(biome);
```

### 2.2 DB helpers

- [ ] `openDb(repoRoot)` — open (or create) `.gitgarden/state.db`, run `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`, run migrations via `CREATE TABLE IF NOT EXISTS`
- [ ] `getMeta(db, key)` / `setMeta(db, key, value)` — read/write meta table
- [ ] `upsertFile(db, { path, biome, line_count, health, last_merge })` — insert or update a file row
- [ ] `deleteFile(db, path)` — remove file + cascade deletes file_patches
- [ ] `clearAssignments(db)` — delete all rows from `file_patches` and `vacant_patches` (used before full reassignment)
- [ ] `bulkInsertPatches(db, patches)` — batch insert into `file_patches` inside a transaction
- [ ] `bulkInsertVacant(db, vacant)` — batch insert into `vacant_patches` inside a transaction

---

## Phase 3 — Configuration Loading (`src/config.js`)

### 3.1 Load and validate

 - [ ] Read `.gitgarden/config.yaml` (using `js-yaml`)
- [ ] Read `colormap.yaml` from the Git Garden installation directory (the tool's own config)
- [ ] Validate required fields: `width` (≥10), `height` (≥10), `max_score` (≥10), `min_distance` (≥1)
- [ ] Validate colormap: each plant has `extensions` (array of strings) and `color` ([R, G, B]); `base` is a top-level [R, G, B]
- [ ] Warn if any extension appears in more than one plant (overlap check)

### 3.2 Build lookup maps

- [ ] `extensionToBiome` map: `{ '.js': 'grass', '.ts': 'grass', '.py': 'lavender', ... }`
- [ ] `biomeColors` map: `{ 'grass': [33, 212, 30], 'lavender': [176, 131, 255], ... }`
- [ ] `baseColor`: the background/vacant color from colormap (e.g., `[138, 204, 255]`)

### 3.3 Config change detection

- [ ] Compute SHA-256 hash of both config files using `crypto.createHash`
- [ ] Compare against `meta.config_hash` and `meta.colormap_hash` in DB
- [ ] If either changed, set `configChanged = true` — this triggers a full reassignment (seeds may be regenerated if starting_points changed)

### 3.4 Derive grid constants

- [ ] `PATCH_SIZE = 4` (each patch = 4×4 pixels, makes files visible)
- [ ] `gridW = Math.ceil(config.width / PATCH_SIZE)`
- [ ] `gridH = Math.ceil(config.height / PATCH_SIZE)`
- [ ] `totalPatches = gridW * gridH`

---

## Phase 4 — Repository Scanning (`src/scan.js`)

### 4.1 Walk the file tree

- [ ] Use `fs.readdir` with `{ withFileTypes: true, recursive: true }` (native in Node 24)
- [ ] Skip directories: `.git`, `node_modules`, `.gitgarden`
- [ ] Skip paths matching `static_paths` from config (use `path.matchesGlob` or prefix match)
- [ ] Apply `.gitignore` rules: shell out to `git ls-files` to get the tracked file list, then intersect with the walk result. This is simpler and more correct than reimplementing gitignore logic

### 4.2 Classify and count

- [ ] For each file, extract extension → look up biome via `extensionToBiome`. Fallback: `dirt` biome
- [ ] Count lines per file using a streaming read (open `ReadStream`, count `\n` chars). Do not load entire file into memory
- [ ] Return array: `{ path, biome, lineCount }`
- [ ] Files with 0 lines get `lineCount = 1` minimum (guard against division by zero, ensure every file gets at least one patch)

---

## Phase 5 — Git Data Ingestion & Health Scoring

### 5.1 Diff stats (`src/git.js`)

- [ ] `getDiffStats(repoRoot, fromCommit, toCommit)` — shell out to git:
  ```js
  const { stdout } = await execFile('git', [
    'diff', '--numstat', '-M', fromCommit, toCommit
  ], { cwd: repoRoot });
  ```
- [ ] Parse `--numstat` output: each line is `{added}\t{deleted}\t{filepath}`
- [ ] Handle renamed files: git outputs `old => new` in the path column with `-M` flag
- [ ] Return map: `{ [filepath]: { linesAdded, linesRemoved, renamedFrom? } }`
- [ ] On first run (no `last_run_commit` in meta), use `git log --numstat --format="" HEAD~1..HEAD` or diff against initial commit

### 5.2 Health scoring (`src/health.js`)

- [ ] `computeHealth(currentHealth, linesAdded, linesRemoved, maxScore)`:
    - **Growth** (added > removed by 2×): `delta = +Math.min(20, Math.round(linesAdded / 10))`
    - **Maintenance** (roughly equal added/removed): `delta = +5` (pruning is healthy)
    - **Decay** (removed > added): `delta = -Math.min(10, Math.round(linesRemoved / 10))`
    - **Passive deterioration** (unchanged files, applied separately): `delta = -2`
    - Clamp: `Math.max(0, Math.min(maxScore, currentHealth + delta))`
- [ ] Apply health updates to all files in DB inside a transaction
- [ ] Apply passive deterioration tick (`-2`) to all files NOT in the diff, then clamp to `≥ 0`
- [ ] Update `files.last_merge` to current Unix timestamp for modified files

---

## Phase 6 — Weighted Voronoi Biome Map (`src/voronoi.js`)

### 6.1 Seed initialization (first run or config change)

- [ ] If `biome_seeds` table is empty or `configChanged`:
    - Read `starting_points` from config. If present, use those coordinates (convert pixel coords to patch-grid coords: `cx = x_coord / PATCH_SIZE`, `cy = y_coord / PATCH_SIZE`)
    - If `starting_points` missing or incomplete, generate seeds via rejection sampling:
        - For each biome, pick random `(cx, cy)` in `[0, gridW) × [0, gridH)`
        - Reject if within `min_distance / PATCH_SIZE` patches of any existing seed
        - Cap retries at 1000; place with warning if exhausted
    - Insert all seeds into `biome_seeds` with `weight = 1.0`
    - **Seeds are never moved after initial placement** — only weights change

### 6.2 Compute weights

- [ ] `computeSeedWeights(db)`:
    - Count files per biome: `SELECT biome, COUNT(*) as cnt FROM files GROUP BY biome`
    - Total files = sum of all counts
    - `weight_i = Math.sqrt(count_i / totalFiles)` — square root softens the weighting so dominant biomes don't completely crowd out small ones
    - Update `biome_seeds.weight` in DB
    - Return the seeds array: `[{ biome, cx, cy, weight }]`

### 6.3 Generate biome map

- [ ] `computeVoronoiMap(seeds, gridW, gridH)`:
    - Allocate `Uint8Array` of length `gridW * gridH` (biome index per patch)
    - Build a `biomes` index array so callers can look up biome name by index
    - For each patch `(x, y)`:
      ```
      for each seed i:
        dist = Math.hypot(x - seed.cx, y - seed.cy)
        score_i = dist / seed.weight
      assign patch to seed with lowest score
      ```
    - **Optimization**: compare squared distances and divide by `weight * weight` to avoid `Math.hypot` in the inner loop. Only compute `sqrt` for the final assignment if needed (actually not needed — we just compare scores, and `sqrt(a)/w < sqrt(b)/w` ⟺ `a/w² < b/w²`)
    - Return `{ biomeMap: Uint8Array, biomes: string[] }`

### 6.4 Extract per-biome patch lists

- [ ] `extractBiomePatches(biomeMap, biomes, gridW, gridH)`:
    - Iterate the biome map, group patches by biome name
    - Return `Map<biomeName, [{ x, y }]>`

---

## Phase 7 — Spatial Clustering & File-to-Patch Assignment (`src/assign.js`)

### 7.1 Spiral sort

Sort a biome's patches by angle then distance from the biome seed. This creates a natural "garden growth" pattern radiating outward.

- [ ] `spiralSort(patches, seedX, seedY)`:
  ```js
  return patches.sort((a, b) => {
    const angleA = Math.atan2(a.y - seedY, a.x - seedX);
    const angleB = Math.atan2(b.y - seedY, b.x - seedX);
    if (angleA !== angleB) return angleA - angleB;
    return Math.hypot(a.x - seedX, a.y - seedY)
         - Math.hypot(b.x - seedX, b.y - seedY);
  });
  ```

### 7.2 Full assignment (first run, config change, or significant biome shift)

- [ ] Clear `file_patches` and `vacant_patches` tables
- [ ] For each biome:
    1. Fetch files in this biome from DB, ordered by `path ASC` (lexicographic sort clusters directory siblings together)
    2. Get the biome's spiral-sorted patch list
    3. Compute total lines across all files in this biome
    4. `fill_factor` is a new config value with a default of `0.85`, add it to the cli, default config as `0.85` and tests.
    5. `fill_factor = 0.85` — leaves 15% headroom for growth without immediate reassignment
    6. For each file, compute `cellCount = Math.max(1, Math.round(file.lineCount / totalLines * totalBiomePatches * fill_factor))`
    7. Walk the spiral-sorted patch list with a cursor, assigning `cellCount` consecutive patches to each file
    8. Insert `file_patches` rows for assigned patches
    9. Insert remaining patches into `vacant_patches`
- [ ] Wrap in a single transaction for performance

### 7.3 Incremental assignment (future optimization — noted here for schema compatibility)

On subsequent runs where only a few files changed:
- [ ] **Deleted files**: `DELETE FROM files` (cascades to `file_patches`), re-insert freed patches into `vacant_patches`
- [ ] **Added files**: pop required patches from `vacant_patches` for that biome, insert `file_patches`
- [ ] **Renamed files**: `UPDATE files SET path = ? WHERE path = ?` (patches unchanged)
- [ ] **Modified files**: update health only. If `line_count` changed > 20%, grow/shrink patch allocation from/into `vacant_patches`
- [ ] After incremental changes, recompute weights and Voronoi. If any biome's proportion shifted > 5%, fall back to full reassignment

> **MVP scope**: implement full assignment only. The schema supports incremental from day one; the logic is a follow-up.

---

## Phase 8 — PNG Rendering (`src/render.js`)

### 8.1 Color interpolation

- [ ] `blendColor(biomeColor, health, maxScore)`:
  ```js
  const t = health / maxScore;  // 0.0 = withered, 1.0 = full bloom
  const withered = [110, 80, 40]; // desaturated brown
  const r = Math.round(withered[0] + t * (biomeColor[0] - withered[0]));
  const g = Math.round(withered[1] + t * (biomeColor[1] - withered[1]));
  const b = Math.round(withered[2] + t * (biomeColor[2] - withered[2]));
  return [r, g, b];
  ```

### 8.2 Build pixel buffer

- [ ] Create `PNG` instance with `width: config.width, height: config.height, filterType: -1`
- [ ] Fill entire buffer with a background color (e.g., `#1a1a2e` dark navy or the `baseColor` dimmed)
- [ ] Query DB for all assigned patches + health + biome color:
  ```sql
  SELECT fp.px, fp.py, f.health, bs.biome
  FROM file_patches fp
  JOIN files f ON f.id = fp.file_id
  JOIN biome_seeds bs ON f.biome = bs.biome
  ```
- [ ] For each patch, compute the pixel color using `blendColor(biomeColors[biome], health, maxScore)`
- [ ] Draw the patch as a `PATCH_SIZE × PATCH_SIZE` block:
  ```js
  const startX = px * PATCH_SIZE;
  const startY = py * PATCH_SIZE;
  for (let dy = 0; dy < PATCH_SIZE && startY + dy < height; dy++) {
    for (let dx = 0; dx < PATCH_SIZE && startX + dx < width; dx++) {
      const idx = ((startY + dy) * width + (startX + dx)) << 2;
      png.data[idx]     = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  ```
- [ ] For vacant patches, draw with a dimmed version of the biome color (or the `baseColor`) to show biome territory

### 8.3 Export

- [ ] Write to `{repoRoot}/.gitgarden/garden.png` using `png.pack().pipe(fs.createWriteStream(...))`
- [ ] Also write/copy to `{repoRoot}/docs/garden.png` if a `docs/` dir exists (for GitHub Pages)

---

## Phase 9 — Pipeline Orchestration (`src/garden.js`)

### 9.1 Main pipeline

```js
export async function generateGarden(repoRoot, fromCommit, toCommit) {
  console.time('total');

  // 1. Open DB
  console.time('db');
  const db = openDb(repoRoot);
  console.timeEnd('db');

  // 2. Load config
  console.time('config');
  const { config, colormap, extensionToBiome, biomeColors, baseColor, configChanged } = loadConfig(repoRoot, db);
  const { gridW, gridH, PATCH_SIZE } = deriveGridConstants(config);
  console.timeEnd('config');

  // 3. Scan repo files
  console.time('scan');
  const scannedFiles = scanFiles(repoRoot, extensionToBiome, config.static_paths);
  console.timeEnd('scan');

  // 4. Upsert files into DB (new files inserted, removed files deleted)
  console.time('sync-files');
  syncFiles(db, scannedFiles);  // diff against existing DB rows
  console.timeEnd('sync-files');

  // 5. Get diff stats and compute health
  console.time('health');
  if (fromCommit && toCommit) {
    const diffStats = await getDiffStats(repoRoot, fromCommit, toCommit);
    applyHealthDeltas(db, diffStats, config.max_score);
  }
  applyPassiveDeterioration(db, config.max_score);
  console.timeEnd('health');

  // 6. Compute biome weights
  console.time('weights');
  const seeds = computeSeedWeights(db);
  console.timeEnd('weights');

  // 7. Compute Voronoi map
  console.time('voronoi');
  const { biomeMap, biomes } = computeVoronoiMap(seeds, gridW, gridH);
  const biomePatches = extractBiomePatches(biomeMap, biomes, gridW, gridH);
  console.timeEnd('voronoi');

  // 8. Assign files to patches
  console.time('assign');
  const needsFullReassign = configChanged || isFirstRun(db);
  if (needsFullReassign) {
    fullAssignment(db, biomePatches, seeds, config.max_score);
  } else {
    // MVP: always full reassign. Incremental is a future optimization.
    fullAssignment(db, biomePatches, seeds, config.max_score);
  }
  console.timeEnd('assign');

  // 9. Render PNG
  console.time('render');
  await renderGarden(db, config, biomeColors, baseColor, gridW, gridH, PATCH_SIZE);
  console.timeEnd('render');

  // 10. Update meta
  setMeta(db, 'last_run_commit', toCommit || 'HEAD');
  if (configChanged) {
    setMeta(db, 'config_hash', currentConfigHash);
    setMeta(db, 'colormap_hash', currentColormapHash);
  }

  console.timeEnd('total');
}
```

### 9.2 `syncFiles` helper

- [ ] Compare scanned files against DB: `SELECT path FROM files`
- [ ] Files in scan but not DB → insert (new files)
- [ ] Files in DB but not scan → delete (removed files, cascades to file_patches)
- [ ] Files in both → update `line_count` if changed, update `biome` if extension mapping changed

---

## Phase 10 — CLI Integration

### 10.1 Update `cli.js`

 - [ ] Update `regenerate` command: remove `.gitgarden/state.db`
- [ ] Update `install` command: create `.gitgarden/` directory and `.gitgarden/config.yaml`
- [ ] Remove the old root-level config file creation code
- [ ] Add `.gitgarden/state.db` and `.gitgarden/garden.png` to `.gitignore` entries
- [ ] The `install` command no longer needs to create a state file — the DB is created on first `generateGarden` run

### 10.2 Update GitHub Actions workflow

The reusable workflow at `svanschooten/gitgarden/.github/workflows/gitgarden.yml` should:
1. Clone the target repository
2. Install Git Garden CLI (`npm install -g git-garden` or use the reusable workflow)
3. Run `git-garden generate --from ${{ github.event.before }} --to ${{ github.sha }}`
4. Publish `docs/garden.png` to `gh-pages` branch

### 10.3 Add `generate` CLI command

- [ ] In `cli.js`, add handler for `git-garden generate`:
  ```js
  } else if (command === 'generate') {
    let fromCommit, toCommit;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--from') fromCommit = args[++i];
      if (args[i] === '--to') toCommit = args[++i];
    }
    await generateGarden(process.cwd(), fromCommit, toCommit || 'HEAD');
  }
  ```
- [ ] Update `showHelp()` to include the new command

---

## Phase 11 — Testing & Validation

### 11.1 Automated tests (`tests/*.js` using Node 24 built-in `node --test`)

- [ ] **Voronoi correctness**: generate map with 3 seeds at known positions, verify each patch is assigned to the nearest weighted seed
- [ ] **Weight proportionality**: create seeds with known weights, verify biome sizes roughly follow `weight²` proportions
- [ ] **Spiral sort**: verify patches are sorted by angle then distance from seed
- [ ] **Health scoring**: unit test `computeHealth` with various added/removed combinations
- [ ] **Color blending**: verify `blendColor` at t=0 returns withered color, at t=1 returns biome color
- [ ] **DB round-trip**: insert files, assign patches, query back, verify consistency

### 11.2 Manual visual verification

- [ ] Run against a small synthetic repo (20 files of mixed types)
- [ ] Verify: distinct biome regions with proportional sizes
- [ ] Verify: files in the same directory cluster together spatially
- [ ] Verify: health=0 files show withered color, health=max shows vibrant color
- [ ] Verify: adding 50 `.ts` files causes the `grass` biome to visually expand on next run
- [ ] Verify: deleting a file frees its patches (visible as vacant territory)
- [ ] Verify: the output image dimensions match the config `width` × `height`

---

## Dependency Summary

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | `^1^.0.0` | Synchronous SQLite — fast, zero runtime deps |
| `pngjs` | `^2^.0.0` | Pure-JS PNG encoder — no native compile, CI safe |
| `js-yaml` | `^3^.1.0` | YAML parsing (already present) |
| `indent-complexity` | `.1.1` | Complexity metric (already present) |

Everything else: Node.js 24 built-ins (`fs/promises`, `path`, `child_process`, `crypto`, `stream`).

---

## Key Design Decisions (rationale)

| Decision | Rationale |
|---|---|
| **Spiral sort over Hilbert curve** | Works with any image dimensions (no power-of-2 constraint). Visually matches the "garden growing outward from seed" metaphor. Simpler to implement and debug. |
| **`file_patches` table over `cell_ranges`** | Absolute (px, py) coordinates are unambiguous and don't depend on a computed 1D ordering that could become stale. Slightly more rows but simpler logic. `WITHOUT ROWID` keeps it compact. |
| **`PATCH_SIZE = 4` (4×4 pixel patches)** | Even the smallest file (1 line) is visible as a distinct block. Voronoi grid is 16× smaller than the pixel grid, making computation fast. |
| **Full reassignment each run (MVP)** | For repos < 10k files, the full pipeline runs in < 500ms. Incremental assignment is a follow-up optimization that the schema already supports. |
| **`pngjs` over `canvas`** | Eliminates native Cairo/Pango dependencies. Critical for CI environments where native compiles fail. Pixel-level control is sufficient for this use case. |
| **SQLite from day one** | Avoids a painful YAML→SQLite migration later. WAL mode supports concurrent reads during CI. Schema is designed for both full and incremental assignment. |
| **`FILL_FACTOR = 0.85`** | Leaves 15% vacant patches per biome so new files can be added without immediate reassignment. Tunable constant. |