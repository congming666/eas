class SpatialHash {
  constructor(cellSize = 160) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  key(x, y) { return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`; }

  rebuild(items) {
    this.cells.clear();
    items.forEach(item => {
      if (!item || item.hp <= 0) return;
      const key = this.key(item.x, item.y);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(item);
    });
  }

  queryCircle(x, y, radius) {
    const result = [];
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const bucket = this.cells.get(`${cx},${cy}`);
      if (bucket) result.push(...bucket);
    }
    return result;
  }
}

class TerrainChunkCache {
  constructor(mapSize, chunkSize = 512) {
    this.mapSize = mapSize;
    this.chunkSize = chunkSize;
    this.chunks = new Map();
  }

  get(cx, cy, renderer) {
    const key = `${cx},${cy}`;
    if (!this.chunks.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(this.chunkSize, this.mapSize - cx * this.chunkSize);
      canvas.height = Math.min(this.chunkSize, this.mapSize - cy * this.chunkSize);
      renderer(canvas.getContext('2d'), cx * this.chunkSize, cy * this.chunkSize, canvas.width, canvas.height);
      this.chunks.set(key, canvas);
    }
    return this.chunks.get(key);
  }

  clear() { this.chunks.clear(); }
}

window.SpatialHash = SpatialHash;
window.TerrainChunkCache = TerrainChunkCache;
