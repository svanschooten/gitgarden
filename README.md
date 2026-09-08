

# Git Garden
Git Garden visualizes the health, diversity, and evolution of a codebase as a living garden—grown from your commits.
<!-- git-garden-badge-start -->
[<img src="https://badges.ws/badge/Git%20Garden-green?icon=gumtree" />](https://svanschooten.github.io/gitgarden/garden.html)
<!-- git-garden-badge-end -->

## Features
- **Health**: Track the overall health of your codebase over time.
- **Diversity**: Explore the variety of contributors and their contributions.
- **Evolution**: Visualize how your codebase has evolved over time.

## Reasons to use Git Garden
- “A neglected repo literally looks dead.”
- “Monoculture codebases are visually boring.”
- “Healthy teams grow diverse gardens.”

## TODO
- [x] Create GitHub Actions workflow to update the garden
- [x] Create a script to analyze the commit
- [x] Create a script to generate garden feeding data from git commit analysis
- [x] Create garden visualization that grows with every feeding
- [x] Create a script to publish garden visualization to GitHub Pages
- [x] Create an installation script that sets the commit hook and initializes the garden
- [x] Implement the generation scripts in GitHub actions workflow step

## Installation
### 1. Install Git Garden CLI globally
Run the installation script in the Git Garden directory to install the CLI globally:
```bash
./install.sh
```
This will install the `git-garden` command on your system.
Note that the `install.sh` only installs and links the cli, and the cli is actually what does the things.

### 2. Enable Git Garden for a repository
In the repository where you want to grow a garden, run:
```bash
git-garden install
```
Alternatively, you can specify a branch if it's different from `main` or `master`:
```bash
git-garden install --branch <branch-name>
```
This will create:
- A GitHub Actions workflow in `.github/workflows/git-garden.yml` that uses our published reusable workflow.
- A configuration file `.gitgarden/config.yaml` for user-specific settings (e.g., ignoring static files).

The garden visualization will now be automatically updated on every push to the specified branch (or `main` and `master` by default).
The visualization is hosted on the `gh-pages` branch of the repository.

### 3. Enabling GitHub Pages
1. Install Git Garden
2. (optional) Generate garden
3. Push to GitHub
4. Go to GitHub Settings → Pages
5. Select `Deploy from a branch` in the source dropdown
6. Select branch `gh-pages`

Once enabled, your garden will be available at: `https://<owner name>.github.io/<repo name>/garden.html`

_A generated static image of your garden will also be available at: `https://<owner name>.github.io/<repo name>/garden.png`_

### 4. Generate the garden manually
You can also generate the garden manually using the `generate` command:
```bash
git-garden generate
```
Or grow the garden as of an older commit, over a wider slice of history, with debug logging:
```bash
git-garden generate --at <sha> --history 250 --debug
```

### 5. Disable Git Garden for a repository
If you want to remove Git Garden from a repository, run:
```bash
git-garden remove
```

### 6. Clear Git Garden state
If you want to clear Git Garden state, but not remove the config, and start fresh, run:
```bash
git-garden clear
```

## Github actions usage
`git-garden install` writes a workflow that calls the published reusable workflow `svanschooten/gitgarden/.github/workflows/gitgarden.yml`, which:
1.  Clones the repository with its full history.
2.  Replays the commit history to score every file.
3.  Grows the garden from that score.
4.  Publishes the result back to `gh-pages`.

Nothing is carried between runs, so a fresh clone and an incremental run produce
the same image — see [Health](#health-is-replayed-not-accumulated) below.

## Garden Visualization
### Color mapping
Colorization and file-extension mapping live in [config.yaml](config.yaml), under `plant_map`.
We used [colorhexa](https://www.colorhexa.com/) to determine the color mappings in HSV color space.

### What the picture encodes
Every visual channel carries one piece of information:

| Channel | Meaning |
|---|---|
| **Colour** | The biome a file's extension belongs to (`plant_map` in the config). |
| **Withering toward brown** | Low health — the file has been left alone. |
| **Shade** | A stable per-file tint, so neighbouring files stay distinguishable instead of merging into one flat block. |
| **Speckle density** | Indentation complexity, via [`indent-complexity`](https://www.npmjs.com/package/indent-complexity). Denser means more deeply nested. |
| **Darker outline** | The boundary between two files. |
| **Area** | The file's line count, inside a biome whose area follows its file count. How faithfully depends on `layout` — see below. |

Both views paint the same values: colour, texture and the border rule all come
from [src/encoding.js](./src/encoding.js), so the PNG and the page cannot drift
apart.

### The interactive page
`garden.html` draws the map to a canvas, which keeps it quick to explore even
though a garden is ~16,000 patches:

- **Zoom** with the slider, the scroll wheel, or the +/− buttons; **drag to pan**,
  and **Fit** returns to the whole garden. Only the visible patches are ever
  drawn, so zooming in gets *cheaper*, not slower.
- **Hover** for a tooltip with exact health, line count, complexity, commit count
  and time since the file was last touched. The sidebar picks what else hovering
  does: nothing, outline the file's whole bed, or spotlight it by dimming
  everything else.
- **Search** any path fragment to light up matching files and dim the rest;
  click a result to centre the map on it.

### Health is replayed, not accumulated
Health is a pure function of the commit history, recomputed on every run:

- A file starts at `max_score` when it enters the replay window.
- Commits that touch it move its health: growth for net additions, a penalty for
  net deletions, a small credit for balanced maintenance.
- Commits that *don't* touch it decay it by `max_score / history_limit`, so a file
  left untouched for the whole window lands at exactly zero.
- Renames carry a file's health with it.

`history_limit` (default 100 commits) therefore sets how much neglect it takes to
wither. Nothing is stored between runs, so `.gitgarden/state.db` is only a cache —
deleting it changes nothing about the result.

### Design: File to Element Mapping
The Git Garden maps a variable number of files to a set number of elements (patches) through a two-step process:
1. **Weighted Voronoi Biome Partitioning**: The garden is divided into biomes (e.g., source code, documentation, configuration). Each biome is assigned an area proportional to the number of files it contains.
2. **Patch Allocation**: within each biome, every file is given ground proportional to its line count.

Biome centre points live in `config.yaml` so the overall layout stays put even if
the state is cleared.

### Layout
`layout` in the config, or `--layout` on the command line, decides how files are
placed inside a biome. Each option trades clumping against accuracy, measured on
this repository:

| `layout` | files drawn as one clump | area matches line count | movement when a file is added |
|---|---|---|---|
| **`grow`** (default) | **38/38** | ±32% typical | **0.8 patches median, 3.7 worst** |
| `hilbert` | 33/38 | ±0% | 2.0 median, 35.4 worst |
| `wedge` | 16/38 | ±0% | 0.7 median, 4.1 worst |
| `ring` | 12/38 | ±0% | 1.0 median, 20.4 worst |

Movement is how far a file's centre of mass shifts when one new file appears, on
a 128×128 patch garden.

- **`grow`** — each file is planted at a spot derived from its own path, and all
  files then spread outward at once until they run into each other. Every file
  ends up as one compact bed, and a new file only disturbs its own surroundings.
  The cost: files boxed in by their neighbours end up smaller than their line
  count says.
- **`hilbert`** — files take consecutive slices of a Hilbert curve. Sizes are
  exact and clumps are nearly as good, but the curve folds, so one new file can
  send a block somewhere else entirely.
- **`wedge`** / **`ring`** — files take slices ordered by angle, or by distance,
  from the biome centre. Sizes are exact, but each file becomes a thin pie slice
  or a ring that the biome edge breaks up, so files are hard to tell apart.

Keep `grow` for a garden of recognisable beds that stays put between commits;
pick `hilbert` if a file's size reading accurately matters more.

## Code organization
Everything is split out into separate files to keep concerns separate and make it easier to understand.
- [cli.js](./cli.js): CLI entry point — `install`, `generate`, `badge`, `remove`, `clear`.
- [src/garden.js](./src/garden.js): Orchestrates the generation pipeline.
- [src/config.js](./src/config.js): Loads and validates config, builds extension/colour lookups.
- [src/db.js](./src/db.js): SQLite schema and helpers for the working store.
- [src/scan.js](./src/scan.js): Lists tracked files and measures size and complexity.
- [src/git.js](./src/git.js): Reads commit history and repository metadata.
- [src/health.js](./src/health.js): Replays file health across the commit window.
- [src/encoding.js](./src/encoding.js): The visual encoding — colour, texture and borders — shared by both renderers.
- [src/voronoi.js](./src/voronoi.js): Weighted Voronoi biome partitioning.
- [src/assign.js](./src/assign.js): Assigns files to patches within a biome.
- [src/render.js](./src/render.js): Writes the PNG.
- [src/html.js](./src/html.js): Builds the page's data and writes it into [src/template.html](./src/template.html).
- [src/badge.js](./src/badge.js): Adds or updates the README badge.
- [src/logger.js](./src/logger.js): Debug-gated logging.
- [config.yaml](./config.yaml): Default configuration and plant/colour map.
- [install.sh](./install.sh): Installs and links the CLI globally.


## Contributing
We welcome contributions to Git Garden! If you'd like to contribute, please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push your changes to your fork.
5. Create a pull request to merge your changes into the main repository.

## License
Git Garden is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.