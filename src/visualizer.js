import {createCanvas} from 'canvas';
import {localFileManager} from './filemanager.js';
import {analyzeDiff} from './analyzer.js';
import fs from 'fs';
import path from 'path';
import {loadColorMap, loadConfig} from './util.js';

const colormap = loadColorMap();
const config = loadConfig();
let filename = 'garden.png'

// change filemanager based on your usage, the default is the LocalFileManager.
// new managers can be added in filemanager.js
let filemanager = localFileManager;

export async function generateGarden(commit, repoName){
    const canvas = createCanvas(config.width, config.height);
    const ctx = canvas.getContext('2d');
    
    await loadGarden(ctx)
    addCommitToGarden(ctx, commit, repoName)

    saveGarden(canvas)
};

async function loadGarden(ctx){
    const gardenPath = path.join(process.cwd(), filename);
    if (fs.existsSync(gardenPath)) {
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

function addCommitToGarden(ctx, commit, repoName){
    console.log('Growing the garden..')
    for (const diff of commit) {
        drawFlower(ctx, analyzeDiff(diff, repoName))
    }
}

function drawFlower(ctx, growCycle){
    let plantColor = growCycle.plant != null ? growCycle.plant.color : colormap.unknown
    ctx.beginPath();
    ctx.arc(growCycle.coords.x, growCycle.coords.y, calculateSize(growCycle.complexity), 0, 2 * Math.PI);
    ctx.fillStyle = getRgba(plantColor);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = getRgba(growCycle.plant.color, 10);
    ctx.stroke();
}

function calculateSize(complexity){
    const max_size = config.width * 0.1;
    const size = Math.round(complexity * max_size)
    return size < 1 ? 1 : size
}

function getRgba(item, darken = 0){
    if (Array.isArray(item)) {
        return `rgba(${Math.max(0, item[0] - darken)}, ${Math.max(0, item[1] - darken)}, ${Math.max(0, item[2] - darken)})`;
    }
    return `rgba(${item}, ${item}, ${item})`;
}
