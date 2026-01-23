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
- “Technical debt shows up as weeds and dark patches.”

## TODO
- [ ] Create git hook
- [ ] Create a script to analyze the commit
- [ ] Create a script to generate garden feeding data from git commit analysis
- [ ] Create garden visualization that grows with every feeding
- [ ] Create a script to publish garden visualization to GitHub Pages
- [ ] Create an installation script that sets the commit hook and initializes the garden
- [ ] Implement the generation scripts in github actions workflow step

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
hsv_v = normalize(linesAdded + linesRemoved, 80)
hsv_s = normalize(complexity, 80)
```
This is deterministic and language-agnostic.


## Contributing
We welcome contributions to Git Garden! If you'd like to contribute, please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push your changes to your fork.
5. Create a pull request to merge your changes into the main repository.

## License
Git Garden is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.