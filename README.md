# Git Garden
Git Garden visualizes the health, diversity, and evolution of a codebase as a living garden—grown from your commits.

## Features
- **Health**: Track the overall health of your codebase over time.
- **Diversity**: Explore the variety of contributors and their contributions.
- **Evolution**: Visualize how your codebase has evolved over time.

## Reasons to use Git Garden
- “A neglected repo literally looks dead.”
- “Monoculture codebases are visually boring.”
- “Healthy teams grow diverse gardens.”

## TODO
- [x] Create git hook
- [x] Create a script to analyze the commit
- [x] Create a script to generate garden feeding data from git commit analysis
- [x] Create garden visualization that grows with every feeding
- [x] Create a script to publish garden visualization to GitHub Pages
- [x] Create an installation script that sets the commit hook and initializes the garden
- [ ] Implement the generation scripts in GitHub actions workflow step

## Installation
The garden visualization is generated and then pushed to GitHub pages on a predefined page.
### Local usage
Use the included installation script to set up the git hook and initialize the garden visualization.
See [install.sh](./install.sh) for more details, it sets the global template directory for git to be `~/.git-templates`.
So if you have a pre-existing global template directory, it will be overwritten.
After each commit, the garden visualization will be updated.

### Github actions usage
Create a workflow file in your repository that runs the script after each commit.
For example:
```yaml
- name: Generate Git Garden
  run: |
    REPO_NAME=$(basename $GITHUB_REPOSITORY)
    args=(--repo "$REPO_NAME")
    for f in $(git diff --name-only $GITHUB_SHA~1 $GITHUB_SHA); do
      diff=$(git diff $GITHUB_SHA~1 $GITHUB_SHA -- "$f" | sed 's/"/\\"/g' | tr '\n' ' ')
      args+=(--file "$f" --diff "$diff")
    done
    args+=(--target "<target repository>")
    node garden.js "${args[@]}"
```

## Garden Visualization
### Color mapping
Colorization and file extension mapping is based on [this](colormap.json) file containing color mappings for various file types.
We used [colorhexa](https://www.colorhexa.com/) to determine the color mappings in HSV color space.

### Garden specifications
Plant location is based on repo name and file name for consistency,
see the following pseudocode for calculating plant location and coloring:
```
hashcode = hash(repoName + "::" + filePath)
x = hashcode % width
y = (hashcode / width) % height
hsv_h = ColorMap.getByExtension(fileExtension)
hsv_v = normalize(linesAdded + linesRemoved, 80)
hsv_s = normalize(complexity, 80)
```
This is deterministic and language-agnostic.


## Code organization
Everything is split out into separate files to keep concerns separate and make it easier to understand.
- [garden.js](./garden.js): The main script that imports, orchestrates, and runs the other scripts to generate the garden visualization.
- [install.sh](./install.sh): The installation script that sets up the git hook and other basic configuration.
- [util.js](./util.js): Utility functions used by the other scripts, like loading JSON files or parsing command line arguments.
- [visualizer.js](./visualizer.js): The script that generates the garden visualization in the form of a PNG image.
- [server.js](./server.js): The Express server that serves the garden visualization for testing and debugging purposes.
- [config.json](./config.json): Configuration file for the garden generation.
- [colormap.json](./colormap.json): Plant color and extension mapping configuration.


## Contributing
We welcome contributions to Git Garden! If you'd like to contribute, please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push your changes to your fork.
5. Create a pull request to merge your changes into the main repository.

## License
Git Garden is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

