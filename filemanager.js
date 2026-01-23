import fs from 'fs';
import { loadImage } from 'canvas';

class LocalFileManager extends FileMngrInterface {
  async loadGarden(filename) {
    return loadImage(filename);
  }

  async saveGarden(filename, buffer) {
    fs.writeFileSync(filename, buffer);
  }
}

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

export const localFileManager = new LocalFileManager();