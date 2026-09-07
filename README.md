

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
Git Garden now uses a published reusable workflow automatically after running `git-garden install`. The generated workflow calls `svanschooten/gitgarden/.github/workflows/gitgarden.yml`, which handles:
1.  Cloning the target repository with its full history.
2.  Replaying the commit history to score every file.
3.  Growing the garden from that score.
4.  Publishing the updated visualization back to `gh-pages`.

The workflow keeps no state between runs. Everything the garden shows is derived
from the repository itself, so a fresh clone and an incremental run produce the
same image — see [Health](#health-is-replayed-not-accumulated) below.

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
| **Area** | The file's line count, inside a biome whose area follows its file count. |

The interactive page shows the same encoding, and its tooltip adds the exact
health, line count, complexity score, commit count and time since the file was
last touched.

### Health is replayed, not accumulated
Health is a pure function of the commit history, recomputed on every run:

- Every file starts at `max_score` when it enters the replay window — either because
  it already existed when the window opened, or because a commit created it.
- Commits that touch a file move its health: growth for net additions, a penalty for
  net deletions, a small credit for balanced maintenance.
- Commits that *don't* touch it decay it by `max_score / history_limit`, so a file left
  untouched for the whole window lands at exactly zero.
- Renames carry a file's accumulated health with it.

`history_limit` (default 100 commits) therefore sets how much neglect it takes to
wither. Because nothing is stored between runs, `.gitgarden/state.db` is a cache:
deleting it costs a little time and changes nothing about the result.

### Design: File to Element Mapping
The Git Garden maps a variable number of files to a set number of elements (patches) through a two-step process:
1. **Weighted Voronoi Biome Partitioning**: The garden is divided into biomes (e.g., source code, documentation, configuration). Each biome is assigned an area proportional to the number of files it contains.
2. **Proportional Patch Allocation**: Within each biome, files are sorted alphabetically. Each file is allocated a number of patches proportional to its line count (size). This ensures that larger files appear as larger clusters within their respective biomes.

The patches within a biome are sorted by their distance and angle from the biome's center (seed point), which creates a cohesive and organized appearance. These center points are defined in `config.yaml` to ensure the garden layout remains consistent even if the state is cleared.

## Code organization
Everything is split out into separate files to keep concerns separate and make it easier to understand.
- [cli.js](./cli.js): CLI entry point — `install`, `generate`, `badge`, `remove`, `clear`.
- [src/garden.js](./src/garden.js): Orchestrates the generation pipeline.
- [src/config.js](./src/config.js): Loads and validates config, builds extension/colour lookups.
- [src/db.js](./src/db.js): SQLite schema and helpers for the working store.
- [src/scan.js](./src/scan.js): Lists tracked files and measures size and complexity.
- [src/git.js](./src/git.js): Reads commit history and repository metadata.
- [src/health.js](./src/health.js): Replays file health across the commit window.
- [src/voronoi.js](./src/voronoi.js): Weighted Voronoi biome partitioning.
- [src/assign.js](./src/assign.js): Assigns files to patches within a biome.
- [src/render.js](./src/render.js): Writes the PNG, including the visual encoding above.
- [src/html.js](./src/html.js): Writes the interactive page from [src/template.html](./src/template.html).
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