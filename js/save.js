const SaveSystem = {
  key: 'farm-cards-expedition-save-v1',

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return false;

      GameState.gold = Number.isFinite(data.gold) ? data.gold : GameState.gold;
      GameState.seeds = Number.isFinite(data.seeds) ? data.seeds : GameState.seeds;
      GameState.materials = Number.isFinite(data.materials) ? data.materials : GameState.materials;
      GameState.unlockedPlots = clamp(Number(data.unlockedPlots) || 8, 8, 36);
      GameState.selectedMap = CONFIG.maps.some(map => map.id === data.selectedMap) ? data.selectedMap : 't1';
      GameState.selectedWeapon = CONFIG.weapons.some(weapon => weapon.id === data.selectedWeapon)
        ? data.selectedWeapon : 'harvest_sickle';
      GameState.selectedCrop = CONFIG.crops.some(crop => crop.id === data.selectedCrop) ? data.selectedCrop : 'wheat';
      GameState.unlockedCrops = Array.isArray(data.unlockedCrops)
        ? [...new Set(['wheat', ...data.unlockedCrops.filter(id => CONFIG.crops.some(crop => crop.id === id))])]
        : ['wheat'];
      GameState.loadout = { ...GameState.loadout, ...(data.loadout || {}) };
      GameState.farmItems = { ...GameState.farmItems, ...(data.farmItems || {}) };
      GameState.skillLevels = { ...GameState.skillLevels, ...(data.skillLevels || {}) };
      GameState.cardInventory = Array.isArray(data.cardInventory) ? data.cardInventory : [];
      GameState.selectedBoostCards = Array.isArray(data.selectedBoostCards)
        ? data.selectedBoostCards.filter(id => GameState.cardInventory.some(card => card.id === id)).slice(0, 3)
        : [];
      GameState.lastDailyClaim = typeof data.lastDailyClaim === 'string' ? data.lastDailyClaim : '';
      GameState.dailyStreak = Math.max(0, Number(data.dailyStreak) || 0);
      GameState.lastReliefClaim = typeof data.lastReliefClaim === 'string' ? data.lastReliefClaim : '';

      if (Array.isArray(data.farmPlots) && data.farmPlots.length === 36) {
        GameState.farmPlots = data.farmPlots.map(plot => ({
          crop: plot.cropId ? CONFIG.crops.find(crop => crop.id === plot.cropId) || null : null,
          plantedAt: Number(plot.plantedAt) || 0,
          status: ['drought', 'pest', 'weeds'].includes(plot.status) ? plot.status : null,
          ready: false,
        }));
      }
      // 确保 farmPlots 始终为 36 格（修复存档损坏或首次加载时空数组的问题）
      if (!Array.isArray(GameState.farmPlots) || GameState.farmPlots.length !== 36) {
        GameState.farmPlots = [];
        for (let i = 0; i < 36; i++) {
          GameState.farmPlots.push({ crop: null, plantedAt: 0, ready: false, status: null });
        }
      }
      // 加载物资仓库
      if (data.warehouse && typeof data.warehouse === 'object') {
        GameState.warehouse = {
          capacity: Number(data.warehouse.capacity) || 50,
          items: data.warehouse.items && typeof data.warehouse.items === 'object' ? data.warehouse.items : {}
        };
      } else {
        GameState.warehouse = { capacity: 50, items: {} };
      }
      // 加载育种温室
      if (data.greenhouse && typeof data.greenhouse === 'object') {
        GameState.greenhouse = {
          plots: Array.isArray(data.greenhouse.plots) ? data.greenhouse.plots.map(plot => ({
            plant: plot.plantId ? CONFIG.greenhousePlants.find(p => p.id === plot.plantId) || null : null,
            plantedAt: Number(plot.plantedAt) || 0,
            ready: false,
            status: plot.status || null
          })) : [],
          unlockedPlots: clamp(Number(data.greenhouse.unlockedPlots) || 4, 4, 16),
          selectedPlant: CONFIG.greenhousePlants.some(p => p.id === data.greenhouse.selectedPlant) ? data.greenhouse.selectedPlant : 'golden_wheat',
          unlockedPlants: Array.isArray(data.greenhouse.unlockedPlants) ? data.greenhouse.unlockedPlants : ['golden_wheat', 'void_mushroom'],
          weaponBonus: Number(data.greenhouse.weaponBonus) || 0
        };
      } else {
        GameState.greenhouse = { plots: [], unlockedPlots: 4, selectedPlant: 'golden_wheat', unlockedPlants: ['golden_wheat', 'void_mushroom'], weaponBonus: 0 };
      }
      // 加载植物防线（远征带回的可部署植物种子与培育进度）
      // 老存档无此字段时保留 config.js 的初始可部署种子
      if (data.defensePlants && typeof data.defensePlants === 'object') {
        GameState.defensePlants = {};
        Object.keys(data.defensePlants).forEach(id => {
          if (!CONFIG.plants.some(p => p.id === id)) return;
          const rec = data.defensePlants[id] || {};
          GameState.defensePlants[id] = {
            progress: clamp(Number(rec.progress) || 0, 0, 100),
            count: Math.max(0, Math.floor(Number(rec.count) || 1))
          };
        });
      }
      if (Array.isArray(data.defenseLoadout)) {
        GameState.defenseLoadout = data.defenseLoadout.filter(id => CONFIG.plants.some(p => p.id === id)).slice(0, 6);
      }
      return true;
    } catch (error) {
      console.warn('读取本地存档失败，将使用新存档。', error);
      return false;
    }
  },

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({
        version: 1,
        gold: GameState.gold,
        seeds: GameState.seeds,
        materials: GameState.materials,
        unlockedPlots: GameState.unlockedPlots,
        selectedMap: GameState.selectedMap,
        selectedWeapon: GameState.selectedWeapon,
        selectedCrop: GameState.selectedCrop,
        unlockedCrops: GameState.unlockedCrops,
        loadout: GameState.loadout,
        farmItems: GameState.farmItems,
        skillLevels: GameState.skillLevels,
        cardInventory: GameState.cardInventory,
        selectedBoostCards: GameState.selectedBoostCards,
        lastDailyClaim: GameState.lastDailyClaim,
        dailyStreak: GameState.dailyStreak,
        lastReliefClaim: GameState.lastReliefClaim,
        farmPlots: GameState.farmPlots.map(plot => ({
          cropId: plot.crop?.id || null,
          plantedAt: plot.plantedAt || 0,
          status: plot.status || null,
        })),
        warehouse: GameState.warehouse || { capacity: 50, items: {} },
        greenhouse: {
          plots: (GameState.greenhouse?.plots || []).map(plot => ({
            plantId: plot.plant?.id || null,
            plantedAt: plot.plantedAt || 0,
            status: plot.status || null
          })),
          unlockedPlots: GameState.greenhouse?.unlockedPlots || 4,
          selectedPlant: GameState.greenhouse?.selectedPlant || 'golden_wheat',
          unlockedPlants: GameState.greenhouse?.unlockedPlants || ['golden_wheat', 'void_mushroom'],
          weaponBonus: GameState.greenhouse?.weaponBonus || 0
        }
,
        defensePlants: GameState.defensePlants || {},
        defenseLoadout: Array.isArray(GameState.defenseLoadout) ? GameState.defenseLoadout : []
      }));
    } catch (error) {
      console.warn('保存本地存档失败。', error);
    }
  }
};

// ==================== 每日奖励与开荒保障 ====================
