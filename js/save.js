const SaveSystem = {
  key: 'farm-cards-expedition-save-v1',

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || (data.version !== 1 && data.version !== 2)) return false;

      GameState.gold = Number.isFinite(data.gold) ? data.gold : GameState.gold;
      // seeds 必须是对象（旧存档可能误存为数字）
      GameState.seeds = (data.seeds && typeof data.seeds === 'object' && !Array.isArray(data.seeds)) ? data.seeds : (GameState.seeds || {});
      GameState.materials = (data.materials && typeof data.materials === 'object') ? data.materials : (GameState.materials || {});
      GameState.unlockedPlots = clamp(Number(data.unlockedPlots) || 8, 8, 36);
      GameState.selectedMap = CONFIG.maps.some(map => map.id === data.selectedMap) ? data.selectedMap : 't1_1';
      GameState.selectedWeapon = CONFIG.weapons.some(weapon => weapon.id === data.selectedWeapon)
        ? data.selectedWeapon : 'harvest_sickle';
      GameState.selectedCrop = CONFIG.crops.some(crop => crop.id === data.selectedCrop) ? data.selectedCrop : 'wheat';
      GameState.unlockedCrops = Array.isArray(data.unlockedCrops)
        ? [...new Set(['wheat', 'ningqi_grass', ...data.unlockedCrops.filter(id => CONFIG.crops.some(crop => crop.id === id))])]
        : ['wheat', 'ningqi_grass'];
      GameState.loadout = { ...GameState.loadout, ...(data.loadout || {}) };
      GameState.farmItems = { ...GameState.farmItems, ...(data.farmItems || {}) };
      GameState.skillLevels = { ...GameState.skillLevels, ...(data.skillLevels || {}) };
      // v5.0 修行台 / 技能 / 档案 / 收获统计
      GameState.level = clamp(Number(data.level) || 1, 1, 100);
      GameState.cultivation = Number(data.cultivation) || 0;
      GameState.unlockedSkills = Array.isArray(data.unlockedSkills) ? data.unlockedSkills : (GameState.unlockedSkills || ['straw_smash']);
      GameState.equippedSkills = Array.isArray(data.equippedSkills) ? data.equippedSkills : (GameState.equippedSkills || ['straw_smash']);
      GameState.harvestCount = (data.harvestCount && typeof data.harvestCount === 'object') ? data.harvestCount : {};
      GameState.archive = (data.archive && typeof data.archive === 'object') ? data.archive : null;
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
          status: ['drought', 'pest', 'weeds', 'burn', 'beast'].includes(plot.status) ? plot.status : null,
          ready: false,
          moisture: Number.isFinite(plot.moisture) ? plot.moisture : 80,
          quality: ['common','fine','rare','legendary'].includes(plot.quality) ? plot.quality : 'common',
          harvestCount: Number(plot.harvestCount) || 0,
          fertilized: !!plot.fertilized,
        }));
      }
      // 确保 farmPlots 始终为 36 格（修复存档损坏或首次加载时空数组的问题）
      if (!Array.isArray(GameState.farmPlots) || GameState.farmPlots.length !== 36) {
        GameState.farmPlots = [];
        for (let i = 0; i < 36; i++) {
          GameState.farmPlots.push({ crop: null, plantedAt: 0, ready: false, status: null, moisture: 80, quality: 'common', harvestCount: 0, fertilized: false });
        }
      }
      // v2.0 农场大更新字段
      GameState.weather = ['sunny','rain','fog','storm'].includes(data.weather) ? data.weather : 'sunny';
      GameState.weatherTimer = Number.isFinite(data.weatherTimer) ? data.weatherTimer : 120;
      GameState.season = ['spring','summer','autumn','winter'].includes(data.season) ? data.season : 'spring';
      GameState.seasonDay = clamp(Number(data.seasonDay) || 1, 1, 7);
      GameState.workshopLevel = clamp(Number(data.workshopLevel) || 1, 1, 3);
      GameState.processingQueue = Array.isArray(data.processingQueue) ? data.processingQueue : [];
      GameState.cropCollection = (data.cropCollection && typeof data.cropCollection === 'object') ? data.cropCollection : {};
      GameState.decorations = Array.isArray(data.decorations) ? data.decorations : [];
      GameState.farmBeauty = Number(data.farmBeauty) || 0;
      GameState.visitorState = ['none','visiting'].includes(data.visitorState) ? data.visitorState : 'none';
      GameState.visitorTimer = Number.isFinite(data.visitorTimer) ? data.visitorTimer : 120;
      GameState.visitorName = data.visitorName || '';
      GameState.waterCooldown = Number.isFinite(data.waterCooldown) ? data.waterCooldown : 0;
      // 加载物资仓库
      if (data.warehouse && typeof data.warehouse === 'object') {
        GameState.warehouse = {
          capacity: Number(data.warehouse.capacity) || 50,
          items: data.warehouse.items && typeof data.warehouse.items === 'object' ? data.warehouse.items : {},
          materials: data.warehouse.materials && typeof data.warehouse.materials === 'object' ? data.warehouse.materials : (data.materials && typeof data.materials === 'object' ? data.materials : {}),
          crops: data.warehouse.crops && typeof data.warehouse.crops === 'object' ? data.warehouse.crops : {}
        };
      } else {
        GameState.warehouse = { capacity: 50, items: {}, materials: (data.materials && typeof data.materials === 'object' ? data.materials : {}), crops: {} };
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
        version: 2,
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
        level: GameState.level || 1,
        cultivation: GameState.cultivation || 0,
        unlockedSkills: GameState.unlockedSkills || ['straw_smash'],
        equippedSkills: GameState.equippedSkills || ['straw_smash'],
        harvestCount: GameState.harvestCount || {},
        archive: GameState.archive || null,
        cardInventory: GameState.cardInventory,
        selectedBoostCards: GameState.selectedBoostCards,
        lastDailyClaim: GameState.lastDailyClaim,
        dailyStreak: GameState.dailyStreak,
        lastReliefClaim: GameState.lastReliefClaim,
        farmPlots: GameState.farmPlots.map(plot => ({
          cropId: plot.crop?.id || null,
          plantedAt: plot.plantedAt || 0,
          status: plot.status || null,
          moisture: plot.moisture !== undefined ? plot.moisture : 80,
          quality: plot.quality || 'common',
          harvestCount: plot.harvestCount || 0,
          fertilized: !!plot.fertilized,
        })),
        weather: GameState.weather || 'sunny',
        weatherTimer: GameState.weatherTimer || 120,
        season: GameState.season || 'spring',
        seasonDay: GameState.seasonDay || 1,
        workshopLevel: GameState.workshopLevel || 1,
        processingQueue: GameState.processingQueue || [],
        cropCollection: GameState.cropCollection || {},
        decorations: GameState.decorations || [],
        farmBeauty: GameState.farmBeauty || 0,
        visitorState: GameState.visitorState || 'none',
        visitorTimer: GameState.visitorTimer || 120,
        visitorName: GameState.visitorName || '',
        waterCooldown: GameState.waterCooldown || 0,
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
