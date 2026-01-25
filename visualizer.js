import { createCanvas } from 'canvas';
import { localFileManager } from './filemanager.js';
import { analyzeDiff } from './garden.js';
import fs from 'fs';
import path from 'path';
import { GitGardenConfig, PlantMap } from './util.js';

let colormap = new PlantMap();
let config = new GitGardenConfig();
let filename = 'garden.png'
const __dirname = import.meta.dirname;

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
    if (fs.existsSync(path.join(__dirname, 'garden.png'))) {
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
    for (const diff of commit) {
        drawFlower(ctx, analyzeDiff(diff))
    }
}

function drawFlower(ctx, growCycle){
    let plantColor = growCycle.plant != null ? growCycle.plant.color : colormap.unknown
    ctx.beginPath();
    ctx.arc(growCycle.coords.x, growCycle.coords.y, calculateSize(growCycle.complexity), 0, 2 * Math.PI);
    ctx.fillStyle = getRgba(plantColor);
    ctx.fill();
}

function calculateSize(complexity){
    const max_size = config.width * 0.1;
    const size = Math.round(complexity * max_size)
    return size < 1 ? 1 : size
}


function getRgba(item){
    return `rgba(${item[0]}, ${item[1]}, ${item[2]})`
}
