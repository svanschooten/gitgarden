export function parseGitGardenArgs() {
    const args = process.argv.slice(2);

    let repoName;
    let targetRepo;
    let fileDiffs = [];

    while (args.length > 0) {
        const arg = args.shift();
        switch (arg) {
            case '--r':
            case '--repo':
                if (repoName) throw Error('Repository name already provided');
                repoName = args.shift();
                break;
            case '--f':
            case '--file':
                const fileDiff = {
                    file: args.shift()
                }
                if (!['--diff', '--d'].includes(args.shift())) throw Error(`Missing diff for file ${fileDiff.file}`);
                fileDiff.diff = args.shift();
                fileDiffs.push(fileDiff);
                break;
            case '--t':
            case '--target':
                if (targetRepo) throw Error('Target repository already provided');
                targetRepo = args.shift();
                break;
        }
    }

    if (!repoName) throw Error('Repository name not provided');
    if (!targetRepo) throw Error('Target repository not provided');
    if (!fileDiffs.length) throw Error('No files to compare');

    return {
        repo: repoName,
        target: targetRepo,
        diffs: fileDiffs
    }
}