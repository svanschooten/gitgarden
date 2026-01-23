import { createCanvas } from 'canvas';
import { readFile } from 'fs/promises';

let colormap = JSON.parse(await readFile("colormap.json", "utf8"));

export function generateGarden(req, res){

    // const value = parseInt(req.query.value) || 0;
    let canvas = initNewGarden();

    canvas.createPNGStream().pipe(res);
};


function initNewGarden(){
    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = getRgba(colormap.base);
    ctx.fillRect(0, 0, 512, 512);
    console.log("Welcome in your new garden, take care of it well!")
    return canvas;
}

function getRgba(item){
    return `rgba(${item[0]}, ${item[1]}, ${item[2]})`
}