

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
- [ ] Create garden visualization that grows with every feeding
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
Or with specific commits and debug logging:
```bash
git-garden generate --from <sha> --to <sha> --debug
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
1.  Cloning the target repository.
2.  Loading the previous garden state.
3.  Analyzing the latest commit.
4.  Growing the garden with new plants.
5.  Publishing the updated visualization back to `gh-pages`.

## Garden Visualization
### Color mapping
Colorization and file extension mapping is based on [this](colormap.yaml) file containing color mappings for various file types.
We used [colorhexa](https://www.colorhexa.com/) to determine the color mappings in HSV color space.

### Design: File to Element Mapping
The Git Garden maps a variable number of files to a set number of elements (patches) through a two-step process:
1. **Weighted Voronoi Biome Partitioning**: The garden is divided into biomes (e.g., source code, documentation, configuration). Each biome is assigned an area proportional to the number of files it contains.
2. **Proportional Patch Allocation**: Within each biome, files are sorted alphabetically. Each file is allocated a number of patches proportional to its line count (size). This ensures that larger files appear as larger clusters within their respective biomes.

The patches within a biome are sorted by their distance and angle from the biome's center (seed point), which creates a cohesive and organized appearance. These center points are defined in `config.yaml` to ensure the garden layout remains consistent even if the state is cleared.

## Code organization
Everything is split out into separate files to keep concerns separate and make it easier to understand.
- [garden.js](./src/garden.js): The main script that imports, orchestrates, and runs the other scripts to generate the garden visualization.
- [install.sh](./install.sh): The installation script that installs the Git Garden CLI globally and cleans up old environment variables.
- [util.js](./src/util.js): Utility functions used by the other scripts, like loading YAML configuration files and parsing command line arguments.
- [visualizer.js](./src/visualizer.js): The script that generates the garden visualization in the form of a PNG image.
- [config.yaml](./config.yaml): Configuration file for the garden generation.
- [colormap.yaml](./colormap.yaml): Plant color and extension mapping configuration.


## Contributing
We welcome contributions to Git Garden! If you'd like to contribute, please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push your changes to your fork.
5. Create a pull request to merge your changes into the main repository.

## License
Git Garden is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.