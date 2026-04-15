# Git Garden — Merged Implementation Plan

This plan consolidates the three existing plans (PLAN.md, PLAN2.md, PLAN3.md) into a single, organized, and efficient implementation path. SQLite is introduced from the start to avoid refactoring a YAML-based state later. The approach uses **weighted Voronoi** for biome boundaries, **spiral-sorted patch assignment** for spatial clustering (simpler than Hilbert, works with any image dimensions), and **`pngjs`** for dependency-light PNG output.

---

## Phase 1 — Project Setup & Dependencies

### 1.1 Update `package.json`

- [x] Replace `canvas` dependency with `pngjs` (pure-JS, no native compile, CI-safe)
- [x] Add `better-sqlite3` for state management
- [x] Keep `js-yaml` (already present, pure JS) and `indent-complexity`
- [x] Confirm `"type": "module"` and `"engines": { "node": ">=24.0.0" }`

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

- [x] `openDb(repoRoot)` — open (or create) `.gitgarden/state.db`, run `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`, run migrations via `CREATE TABLE IF NOT EXISTS`
- [x] `getMeta(db, key)` / `setMeta(db, key, value)` — read/write meta table
- [x] `upsertFile(db, { path, biome, line_count, health, last_merge })` — insert or update a file row
- [x] `deleteFile(db, path)` — remove file + cascade deletes file_patches
- [x] `clearAssignments(db)` — delete all rows from `file_patches` and `vacant_patches` (used before full reassignment)
- [x] `bulkInsertPatches(db, patches)` — batch insert into `file_patches` inside a transaction
- [x] `bulkInsertVacant(db, vacant)` — batch insert into `vacant_patches` inside a transaction

---

## Phase 3 — Configuration Loading (`src/config.js`)

### 3.1 Load and validate

- [x] Read `.gitgarden/config.yaml` (using `js-yaml`)
- [x] Validate required fields: `width` (≥10), `height` (≥10), `max_score` (≥10), `min_distance` (≥1)
- [x] Validate plant map: each plant has `extensions` (array of strings) and `color` ([R, G, B]); `base` is a top-level [R, G, B]
- [x] Warn if any extension appears in more than one plant (overlap check)

### 3.2 Build lookup maps

- [x] `extensionToBiome` map: `{ '.js': 'grass', '.ts': 'grass', '.py': 'lavender', ... }`
- [x] `biomeColors` map: `{ 'grass': [33, 212, 30], 'lavender': [176, 131, 255], ... }`
- [x] `baseColor`: the background/vacant color from colormap (e.g., `[138, 204, 255]`)

### 3.3 Config change detection

- [x] Compute SHA-256 hash of both config files using `crypto.createHash`
- [x] Compare against `meta.config_hash` and `meta.colormap_hash` in DB
- [x] If either changed, set `configChanged = true` — this triggers a full reassignment (seeds may be regenerated if starting_points changed)

### 3.4 Derive grid constants

- [x] `PATCH_SIZE = 4` (each patch = 4×4 pixels, makes files visible)
- [x] `gridW = Math.ceil(config.width / PATCH_SIZE)`
- [x] `gridH = Math.ceil(config.height / PATCH_SIZE)`
- [x] `totalPatches = gridW * gridH`

---

## Phase 4 — Repository Scanning (`src/scan.js`)

### 4.1 Walk the file tree

- [x] Use `fs.readdir` with `{ withFileTypes: true, recursive: true }` (native in Node 24)
- [x] Skip directories: `.git`, `node_modules`, `.gitgarden`
- [x] Skip paths matching `static_paths` from config (use `path.matchesGlob` or prefix match)
- [x] Apply `.gitignore` rules: shell out to `git ls-files` to get the tracked file list, then intersect with the walk result. This is simpler and more correct than reimplementing gitignore logic

### 4.2 Classify and count

- [x] For each file, extract extension → look up biome via `extensionToBiome`. Fallback: `dirt` biome
- [x] Count lines per file using a streaming read (open `ReadStream`, count `\n` chars). Do not load entire file into memory
- [x] Return array: `{ path, biome, lineCount }`
- [x] Files with 0 lines get `lineCount = 1` minimum (guard against division by zero, ensure every file gets at least one patch)

---

## Phase 5 — Git Data Ingestion & Health Scoring

### 5.1 Diff stats (`src/git.js`)

- [x] `getDiffStats(repoRoot, fromCommit, toCommit)` — shell out to git:
  ```js
  const { stdout } = await execFile('git', [
    'diff', '--numstat', '-M', fromCommit, toCommit
  ], { cwd: repoRoot });
  ```
- [x] Parse `--numstat` output: each line is `{added}\t{deleted}\t{filepath}`
- [x] Handle renamed files: git outputs `old => new` in the path column with `-M` flag
- [x] Return map: `{ [filepath]: { linesAdded, linesRemoved, renamedFrom? } }`
- [ ] On first run (no `last_run_commit` in meta), use `git log --numstat --format="" HEAD~1..HEAD` or diff against initial commit

### 5.2 Health scoring (`src/health.js`)

- [x] `computeHealth(currentHealth, linesAdded, linesRemoved, maxScore)`:
    - **Growth** (added > removed by 2×): `delta = +Math.min(20, Math.round(linesAdded / 10))`
    - **Maintenance** (roughly equal added/removed): `delta = +5` (pruning is healthy)
    - **Decay** (removed > added): `delta = -Math.min(10, Math.round(linesRemoved / 10))`
    - **Passive deterioration** (unchanged files, applied separately): `delta = -2`
    - Clamp: `Math.max(0, Math.min(maxScore, currentHealth + delta))`
- [x] Apply health updates to all files in DB inside a transaction
- [x] Apply passive deterioration tick (`-2`) to all files NOT in the diff, then clamp to `≥ 0`
- [x] Update `files.last_merge` to current Unix timestamp for modified files

---

## Phase 6 — Weighted Voronoi Biome Map (`src/voronoi.js`)

### 6.1 Seed initialization (first run or config change)

- [x] If `biome_seeds` table is empty or `configChanged`:
    - Read `starting_points` from config. If present, use those coordinates (convert pixel coords to patch-grid coords: `cx = x_coord / PATCH_SIZE`, `cy = y_coord / PATCH_SIZE`)
    - If `starting_points` missing or incomplete, generate seeds via rejection sampling:
        - For each biome, pick random `(cx, cy)` in `[0, gridW) × [0, gridH)`
        - Reject if within `min_distance / PATCH_SIZE` patches of any existing seed
        - Cap retries at 1000; place with warning if exhausted
    - Insert all seeds into `biome_seeds` with `weight = 1.0`
    - **Seeds are never moved after initial placement** — only weights change

### 6.2 Compute weights

- [x] `computeSeedWeights(db)`:
    - Count files per biome: `SELECT biome, COUNT(*) as cnt FROM files GROUP BY biome`
    - Total files = sum of all counts
    - `weight_i = Math.sqrt(count_i / totalFiles)` — square root softens the weighting so dominant biomes don't completely crowd out small ones
    - Update `biome_seeds.weight` in DB
    - Return the seeds array: `[{ biome, cx, cy, weight }]`

### 6.3 Generate biome map

- [x] `computeVoronoiMap(seeds, gridW, gridH)`:
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

- [x] `extractBiomePatches(biomeMap, biomes, gridW, gridH)`:
    - Iterate the biome map, group patches by biome name
    - Return `Map<biomeName, [{ x, y }]>`

---

## Phase 7 — Spatial Clustering & File-to-Patch Assignment (`src/assign.js`)

### 7.1 Spiral sort

Sort a biome's patches by angle then distance from the biome seed. This creates a natural "garden growth" pattern radiating outward.

- [x] `spiralSort(patches, seedX, seedY)`:
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

- [x] Clear `file_patches` and `vacant_patches` tables
- [x] For each biome:
    1. Fetch files in this biome from DB, ordered by `path ASC` (lexicographic sort clusters directory siblings together)
    2. Get the biome's spiral-sorted patch list
    3. Compute total lines across all files in this biome
    4. `fill_factor` is a new config value with a default of `0.85`, add it to the cli, default config as `0.85` and tests.
    5. `fill_factor = 0.85` — leaves 15% headroom for growth without immediate reassignment
    6. For each file, compute `cellCount = Math.max(1, Math.round(file.lineCount / totalLines * totalBiomePatches * fill_factor))`
    7. Walk the spiral-sorted patch list with a cursor, assigning `cellCount` consecutive patches to each file
    8. Insert `file_patches` rows for assigned patches
    9. Insert remaining patches into `vacant_patches`
- [x] Wrap in a single transaction for performance

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

- [x] `blendColor(biomeColor, health, maxScore)`:
  ```js
  const t = health / maxScore;  // 0.0 = withered, 1.0 = full bloom
  const withered = [110, 80, 40]; // desaturated brown
  const r = Math.round(withered[0] + t * (biomeColor[0] - withered[0]));
  const g = Math.round(withered[1] + t * (biomeColor[1] - withered[1]));
  const b = Math.round(withered[2] + t * (biomeColor[2] - withered[2]));
  return [r, g, b];
  ```

### 8.2 Build pixel buffer

- [x] Create `PNG` instance with `width: config.width, height: config.height, filterType: -1`
- [x] Fill entire buffer with a background color (e.g., `#1a1a2e` dark navy or the `baseColor` dimmed)
- [x] Query DB for all assigned patches + health + biome color:
  ```sql
  SELECT fp.px, fp.py, f.health, bs.biome
  FROM file_patches fp
  JOIN files f ON f.id = fp.file_id
  JOIN biome_seeds bs ON f.biome = bs.biome
  ```
- [x] For each patch, compute the pixel color using `blendColor(biomeColors[biome], health, maxScore)`
- [x] Draw the patch as a `PATCH_SIZE × PATCH_SIZE` block:
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
- [x] For vacant patches, draw with a dimmed version of the biome color (or the `baseColor`) to show biome territory

### 8.3 Export

- [x] Write to `{repoRoot}/.gitgarden/garden.png` using `png.pack().pipe(fs.createWriteStream(...))`
- [x] Also write/copy to `{repoRoot}/docs/garden.png` if a `docs/` dir exists (for GitHub Pages)

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

- [x] Compare scanned files against DB: `SELECT path FROM files`
- [x] Files in scan but not DB → insert (new files)
- [x] Files in DB but not scan → delete (removed files, cascades to file_patches)
- [x] Files in both → update `line_count` if changed, update `biome` if extension mapping changed

---

## Phase 10 — CLI Integration

### 10.1 Update `cli.js`

- [x] Update `regenerate` command: remove `.gitgarden/state.db`
- [x] Update `install` command: create `.gitgarden/` directory and `.gitgarden/config.yaml`
- [x] Remove the old root-level config file creation code
- [x] Add `.gitgarden/state.db` and `.gitgarden/garden.png` to `.gitignore` entries
- [x] The `install` command no longer needs to create a state file — the DB is created on first `generateGarden` run

### 10.2 Update GitHub Actions workflow

- [x] The reusable workflow at `svanschooten/gitgarden/.github/workflows/gitgarden.yml` should:
1. Clone the target repository
2. Install Git Garden CLI (`npm install -g git-garden` or use the reusable workflow)
3. Run `git-garden generate --from ${{ github.event.before }} --to ${{ github.sha }}`
4. Publish `docs/garden.png` to `gh-pages` branch

### 10.3 Add `generate` CLI command

- [x] In `cli.js`, add handler for `git-garden generate`:
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
- [x] Update `showHelp()` to include the new command

---

## Phase 11 — Testing & Validation

### 11.1 Automated tests (`tests/*.js` using Node 24 built-in `node --test`)

- [x] **Voronoi correctness**: generate map with 3 seeds at known positions, verify each patch is assigned to the nearest weighted seed
- [x] **Weight proportionality**: create seeds with known weights, verify biome sizes roughly follow `weight²` proportions
- [x] **Spiral sort**: verify patches are sorted by angle then distance from seed
- [x] **Health scoring**: unit test `computeHealth` with various added/removed combinations
- [x] **Color blending**: verify `blendColor` at t=0 returns withered color, at t=1 returns biome color
- [x] **DB round-trip**: insert files, assign patches, query back, verify consistency

### 11.2 Manual visual verification

- [x] Run against a small synthetic repo (20 files of mixed types)
- [x] Verify: distinct biome regions with proportional sizes
- [x] Verify: files in the same directory cluster together spatially
- [x] Verify: health=0 files show withered color, health=max shows vibrant color
- [x] Verify: adding 50 `.ts` files causes the `grass` biome to visually expand on next run
- [x] Verify: deleting a file frees its patches (visible as vacant territory)
- [x] Verify: the output image dimensions match the config `width` × `height`

---

## Phase 12 — Interactive Page

### 12.1 HTML Generation (`src/html.js`)

- [x] Create a static HTML generator that produces a standalone `garden.html`
- [x] **Grid Implementation**: Use CSS Grid to create a grid matching the PNG's patch layout
    - Each patch in the grid is a `<div>`
    - Set the background color of each patch using the same `blendColor` logic as the PNG
- [x] **Data Embedding**: Embed the necessary patch metadata into the HTML as a JSON object
- [x] **Styles**: Add CSS for the grid, legend, and tooltip
- [x] **Filter empty biomes**: Ensure biomes with no files do not occupy space and are excluded from the legend.
- [x] **Display extensions**: Show representative file extensions for each biome in the legend and tooltip.

### 12.2 Interactivity & UI

- [x] **Hover Tooltip**: A lightweight tooltip that follows the mouse, showing basic stats (File, Biome, Health)
- [x] **Legend**: A visual list of biomes with their colors, extensions, and patch counts
- [x] **Performance**: Use vanilla JS and event delegation for maximum speed with large grids
- [x] **Minimalism**: Removed complex highlighting and sidebar info panels to ensure a smooth experience

### 12.3 Pipeline Integration

- [x] Update `generateGarden` in `src/garden.js` to call the HTML generator after PNG rendering
- [x] Save the output to `.gitgarden/garden.html`
- [x] Copy to `docs/garden.html` if the directory exists
- [x] Ensure the GitHub Actions workflow includes `garden.html` in the publication to `gh-pages`

### 12.4 Refactoring & UI Polish

- [x] Extract HTML template to `src/template.html` for better maintainability
- [x] Make `.garden-wrapper` background transparent in the interactive HTML

### 12.5 Interactive Enhancements

- [x] Remove file extensions from the hover tooltip (keep them in legend/info panel)
- [x] Highlight all patches of a file when a single-file patch is hovered

### 12.6 Performance Optimization

- [x] Migrated from SVG/Vue/D3 to a native HTML grid (CSS Grid) with vanilla JavaScript
- [x] Used string concatenation and `innerHTML` for fast grid rendering
- [x] Implemented event delegation on the grid container for efficient hover tracking
- [x] Removed all complex highlighting and reactive state to ensure high-performance interactivity

### 12.7 Visualization Options

- [x] Added a "Show Biome Centers" checkbox to the interactive HTML page
- [x] Render biome seed coordinates (center points) as toggleable overlays on the garden grid

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