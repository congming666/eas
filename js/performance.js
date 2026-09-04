class SpatialHash {
  constructor(cellSize = 160) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this._queryResult = []; // 复用查询结果数组，避免每帧高频查询分配
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

  // 注意：返回内部复用数组，调用方必须在本次调用内消费完，不可跨调用持有引用。
  queryCircle(x, y, radius) {
    const result = this._queryResult;
    result.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const bucket = this.cells.get(`${cx},${cy}`);
      if (bucket) for (let i = 0; i < bucket.length; i++) result.push(bucket[i]);
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
