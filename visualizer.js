import { createCanvas } from 'canvas';
import { localFileManager } from './filemanager.js';
import { analyzeDiff } from './garden.js';
import { readFile } from 'fs/promises';
import fs from 'fs';

let colormap = JSON.parse(await readFile("colormap.json", "utf8"));
let config = JSON.parse(await readFile("config.json", "utf8"));
let filename = 'garden.png'

// change filemanager based on your usage, the default is the LocalFileManager.
// new managers can be added in filemanager.js
let filemanager = localFileManager;

export async function generateGarden(commit){
    const canvas = createCanvas(config.width, config.height);
    const ctx = canvas.getContext('2d');
    
    await loadGarden(ctx)
    addCommitToGarden(ctx, commit)

    saveGarden(canvas)
};

async function loadGarden(ctx){
    if (fs.existsSync(filename)) {
        console.log('Loading previous garden')
        let previousGarden = await filemanager.loadGarden(filename)
        ctx.drawImage(previousGarden, 0, 0);
    } else {
        initNewGarden(ctx);
    }
}

function initNewGarden(ctx){
    ctx.fillStyle = getRgba(colormap.base);
    ctx.fillRect(0, 0, config.width, config.height);
    console.log("Welcome in your new garden, take care of it well!")
    return ctx;
}

function saveGarden(canvas){
    const buffer = canvas.toBuffer('image/png');
    filemanager.saveGarden(filename, buffer)    
    console.log(`Saved garden to ${filename}`);
}

function addCommitToGarden(ctx, commit){
    console.log('Growing the garden..')
    
}


function getRgba(item){
    return `rgba(${item[0]}, ${item[1]}, ${item[2]})`
}