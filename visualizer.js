import { createCanvas, loadImage } from 'canvas';
import { readFile } from 'fs/promises';
import fs from 'fs';

let colormap = JSON.parse(await readFile("colormap.json", "utf8"));

export async function generateGarden(commit, res){
    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    
    await loadGarden(ctx)
    // addCommitToGarden(ctx, commit)

    saveGarden(canvas)
};

async function loadGarden(ctx){
     // Check if previous garden exists
    if (fs.existsSync('garden.png')) {
        console.log('Loading previous garden')
        const previousGarden = await loadImage('garden.png');
        ctx.drawImage(previousGarden, 0, 0);
    } else {
        initNewGarden(ctx);
    }
}

function saveGarden(canvas){
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync('garden.png', buffer);
    
    console.log('Saved garden to garden.png');
}

function addCommitToGarden(ctx, commit){
    
}


function initNewGarden(ctx){
    ctx.fillStyle = getRgba(colormap.base);
    ctx.fillRect(0, 0, 512, 512);
    console.log("Welcome in your new garden, take care of it well!")
    return ctx;
}

function getRgba(item){
    return `rgba(${item[0]}, ${item[1]}, ${item[2]})`
}