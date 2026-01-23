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
            if (args.shift() !== '--diff') throw Error(`Missing diff for file ${fileDiff.file}`);
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

