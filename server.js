import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateGarden } from './visualizer.js';

const app = express();

// Get __dirname equivalent in ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(__dirname)); 

app.get('/', async (req, res) => {
  await generateGarden(req, res)
  res.send(`
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Bit Garden</h1>
        <img src="/garden.png" alt="Generated">
        <br><br>
      </body>
    </html>
  `);
});

app.listen(3000, () => {
  console.log('Server at http://localhost:3000/');
});
