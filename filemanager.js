import fs from 'fs';
import { loadImage } from 'canvas';
import { join } from 'path';

const __dirname = import.meta.dirname;

class FileMngrInterface {
  /**
   * loads an existing garden image
   * @param {filename} the filename of your garden
   * @return {image} A png image
   */
  loadGarden(filename) {
    this._WARNING('loadGarden(filename)');
  }

  /**
   * saves an existing garden image
   * @param {filename} the filename of your garden
   * @param {buffer} the garden canvas in buffer format
   * 
   */
  saveGarden(filename, buffer) {
    this._WARNING('saveGarden(filename, buffer)');
  }

  _WARNING(fName = 'unknown method') {
    console.warn('WARNING! Function "' + fName + '" is not overridden in ' + this.constructor.name);
  }
}

class LocalFileManager extends FileMngrInterface {
  async loadGarden(filename) {
    return loadImage(join(__dirname, filename));
  }

  async saveGarden(filename, buffer) {
    fs.writeFileSync(join(__dirname, filename), buffer);
  }
}


export const localFileManager = new LocalFileManager();
