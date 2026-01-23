import { createCanvas } from 'canvas';

export function generateGarden(req, res){

    // const value = parseInt(req.query.value) || 0;

    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#492f1a';
    ctx.fillRect(0, 0, 400, 400);

    canvas.createPNGStream().pipe(res);
};