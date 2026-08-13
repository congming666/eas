const PixiEffects = {
  app: null,
  graphics: null,

  async init() {
    if (!window.PIXI || this.app) return;
    const host = document.getElementById('gameContainer');
    this.app = new PIXI.Application();
    await this.app.init({ width: CONFIG.canvas.width, height: CONFIG.canvas.height, backgroundAlpha: 0, antialias: true, resolution: 1 });
    this.app.canvas.id = 'pixiEffectsCanvas';
    this.app.canvas.setAttribute('aria-hidden', 'true');
    host.insertBefore(this.app.canvas, document.getElementById('audioControl'));
    this.graphics = new PIXI.Graphics();
    this.app.stage.addChild(this.graphics);
  },

  render(expedition) {
    if (!this.graphics || !expedition) return false;
    const graphics = this.graphics;
    graphics.clear();
    expedition.particles.forEach(particle => {
      if (particle.type && particle.type !== 'smoke') return;
      if (!expedition.isWorldVisible(particle.x, particle.y)) return;
      const x = particle.x - expedition.camera.x;
      const y = particle.y - expedition.camera.y;
      if (x < -30 || x > CONFIG.canvas.width + 30 || y < -30 || y > CONFIG.canvas.height + 30) return;
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      const color = Number(`0x${particle.color.replace('#', '').slice(0, 6)}`);
      graphics.circle(x, y, Math.max(1, particle.size * alpha)).fill({ color, alpha: alpha * .78 });
    });
    return true;
  },

  clear() { if (this.graphics) this.graphics.clear(); }
};

window.PixiEffects = PixiEffects;
