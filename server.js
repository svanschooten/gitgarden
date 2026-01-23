import express from 'express';
import { generateGarden } from './visualizer.js';

const app = express();

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Bit Garden</h1>
        <img src="/generate" alt="Generated">
        <br><br>
        <script>
          function updateImage() {
            const value = Math.floor(Math.random() * 100);
            document.querySelector('img').src = '/generate;
          }
        </script>
      </body>
    </html>
  `);
});

app.get('/generate', (req, res) => {
    res.setHeader('Content-Type', 'image/png');
    generateGarden(req, res)
});

app.listen(3000, () => {
  console.log('Server at http://localhost:3000/');
});
