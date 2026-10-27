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
      GameState.unlockedPlots = clamp(Number(data.unlockedPlots) || 16, 16, 48);
      GameState.selectedMap = CONFIG.maps.some(map => map.id === data.selectedMap) ? data.selectedMap : 't1_1';
      GameState.selectedWeapon = CONFIG.weapons.some(weapon => weapon.id === data.selectedWeapon)
        ? data.selectedWeapon : 'harvest_sickle';
      GameState.selectedCrop = CONFIG.crops.some(crop => crop.id === data.selectedCrop) ? data.selectedCrop : 'wheat';
      GameState.unlockedCrops = Array.isArray(data.unlockedCrops)
        ? [...new Set(['wheat', 'ningqi_grass', 'tinder_grass', ...data.unlockedCrops.filter(id => CONFIG.crops.some(crop => crop.id === id))])]
        : ['wheat', 'ningqi_grass'];
      // loadout：替换而非合并，并清洗非法 id / 超限数量（修复历史脏数据与旧默认值）
      const _rawLo = (data.loadout && typeof data.loadout === 'object') ? data.loadout : {};
      const _validLoIds = new Set((CONFIG.consumables || []).map(c => c.id));
      const _cleanLo = {};
      let _loTypes = 0;
      Object.keys(_rawLo).forEach(_id => {
        if (!_validLoIds.has(_id)) return;
        const _n = Math.max(0, Math.floor(Number(_rawLo[_id]) || 0));
        if (_n <= 0 || _loTypes >= 6) return;
        _cleanLo[_id] = Math.min(_n, 5);
        _loTypes++;
      });
      GameState.loadout = _cleanLo;
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
      GameState.selectedBoostCards = []; // v5.6 强化卡改为永久升级，不再局前临选
      GameState.lastDailyClaim = typeof data.lastDailyClaim === 'string' ? data.lastDailyClaim : '';
      GameState.dailyStreak = Math.max(0, Number(data.dailyStreak) || 0);
      GameState.lastReliefClaim = typeof data.lastReliefClaim === 'string' ? data.lastReliefClaim : '';
      // v5.8 卡牌系统新字段（旧存档缺失须容错）
      GameState.collection = (data.collection && typeof data.collection === 'object') ? {
        skill: (data.collection.skill && typeof data.collection.skill === 'object') ? data.collection.skill : {},
        item: (data.collection.item && typeof data.collection.item === 'object') ? data.collection.item : {},
        seed: (data.collection.seed && typeof data.collection.seed === 'object') ? data.collection.seed : {}
      } : { skill: {}, item: {}, seed: {} };
      // v5.8.7 卡面金库（旧存档缺失时从 0 起，重复卡历史不追溯、不伤存档）
      GameState.cardVault = (data.cardVault && typeof data.cardVault === 'object') ? {
        common: Math.max(0, Math.floor(Number(data.cardVault.common) || 0)),
        rare: Math.max(0, Math.floor(Number(data.cardVault.rare) || 0)),
        epic: Math.max(0, Math.floor(Number(data.cardVault.epic) || 0)),
        legendary: Math.max(0, Math.floor(Number(data.cardVault.legendary) || 0))
      } : { common: 0, rare: 0, epic: 0, legendary: 0 };
      GameState.blueprints = Array.isArray(data.blueprints) ? data.blueprints.filter(id => CONFIG.weapons.some(w => w.id === id && w.blueprint)) : [];
      GameState.expBoost = !!data.expBoost;
      GameState.ownedBlueprints = Array.isArray(data.ownedBlueprints) ? data.ownedBlueprints.slice() : [];
      GameState.safeBoxSlots = clamp(Number(data.safeBoxSlots) || 1, 1, 3);
      GameState.hardcoreFullLoss = !!data.hardcoreFullLoss;
      GameState.deckPresets = Array.isArray(data.deckPresets) ? data.deckPresets : [];
      GameState.captureLog = Array.isArray(data.captureLog) ? data.captureLog : [];
      // W1c/W2/W8 整体循环字段：经济状态（衰减/事件/土地投资记账）+ 建筑科技（含槽位/实付）
      GameState.econ = (data.econ && typeof data.econ === 'object') ? {
        diminishMult: Number.isFinite(data.econ.diminishMult) ? data.econ.diminishMult : 1,
        diminishClock: Number(data.econ.diminishClock) || 0,
        eventNextAt: Number(data.econ.eventNextAt) || 0,
        eventLog: Array.isArray(data.econ.eventLog) ? data.econ.eventLog : [],
        plotSpent: (data.econ.plotSpent && typeof data.econ.plotSpent === 'object') ? data.econ.plotSpent : {}
      } : { diminishMult: 1, diminishClock: 0, eventNextAt: 0, eventLog: [], plotSpent: {} };
      GameState.techPoints = Number(data.techPoints) || 0;
      GameState.unlockedTech = Array.isArray(data.unlockedTech) ? data.unlockedTech : [];
      GameState.labUnlocked = !!data.labUnlocked;
      GameState.buildings = (data.buildings && typeof data.buildings === 'object') ? data.buildings : GameState.buildings;

      // 农田格数：v5.1 起为 48 格（8×6）。旧实现这里写死 36 判等，
      // 而 save() 已按 48 格写出 —— 导致 48 格存档整段不恢复、作物全丢，
      // 随后 Farm.init() 的"初始种一些"+save() 会把玩家存档覆盖成 3 株默认作物。
      // 修复：按当前格数容错恢复（旧 36 格存档自动补齐，不重置已有作物）。
      const PLOT_TOTAL = (typeof Farm !== 'undefined' && Farm.PLOT_COUNT) ? Farm.PLOT_COUNT : 48;
      const srcPlots = Array.isArray(data.farmPlots) ? data.farmPlots : null;
      if (srcPlots && srcPlots.length) {
        const findCrop = (id) => {
          if (!id) return null;
          const c = CONFIG.crops.find(crop => crop.id === id);
          if (c) return c;
          try {
            if (typeof CropExpansion !== 'undefined' && Array.isArray(CropExpansion.NEW_CROPS)) {
              return CropExpansion.NEW_CROPS.find(crop => crop.id === id) || null;
            }
          } catch (e) {}
          return null;
        };
        GameState.farmPlots = [];
        for (let i = 0; i < PLOT_TOTAL; i++) {
          const plot = srcPlots[i] || {};
          GameState.farmPlots.push({
            crop: findCrop(plot.cropId),
            plantedAt: Number(plot.plantedAt) || 0,
            status: ['drought', 'pest', 'weeds', 'burn', 'beast'].includes(plot.status) ? plot.status : null,
            ready: false,
            moisture: Number.isFinite(plot.moisture) ? plot.moisture : 80,
            quality: ['common','fine','rare','legendary'].includes(plot.quality) ? plot.quality : 'common',
            harvestCount: Number(plot.harvestCount) || 0,
            fertilized: !!plot.fertilized,
            tier: clamp(Number(plot.tier) || 0, 0, 3), // W1c 土地等级
          });
        }
      }
      // 确保 farmPlots 始终为完整格数（修复存档损坏或首次加载时空数组的问题）
      if (!Array.isArray(GameState.farmPlots) || GameState.farmPlots.length !== PLOT_TOTAL) {
        GameState.farmPlots = [];
        for (let i = 0; i < PLOT_TOTAL; i++) {
          GameState.farmPlots.push({ crop: null, plantedAt: 0, ready: false, status: null, moisture: 80, quality: 'common', harvestCount: 0, fertilized: false, tier: 0 });
        }
      }
      // 标记本次是"读档进入"，Farm.init() 据此不再补种初始作物（只对真正的新档生效）
      GameState._saveLoaded = !!(srcPlots && srcPlots.length);
      // v2.0 农场大更新字段
      GameState.weather = ['sunny','rain','fog','storm'].includes(data.weather) ? data.weather : 'sunny';
      GameState.weatherTimer = Number.isFinite(data.weatherTimer) ? data.weatherTimer : 120;
      GameState.season = ['spring','summer','autumn','winter'].includes(data.season) ? data.season : 'spring';
      GameState.seasonDay = clamp(Number(data.seasonDay) || 1, 1, 7);
      // 季节计时（秒）：旧档没有该字段时按天数换算；每季 1200 秒（20 分钟）
      GameState.seasonTimer = Number.isFinite(data.seasonTimer)
        ? clamp(data.seasonTimer, 0, 1199.9)
        : (GameState.seasonDay - 1) * (1200 / 7);
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
      // v5.8 一次性守卫：旧 cardInventory / skillLevels 折算进新收藏与精通
      if (typeof CardV58 !== 'undefined' && !GameState._v58Migrated) {
        try { CardV58.migrate(); } catch (e) { console.warn('v58 migrate failed', e); }
        GameState._v58Migrated = true;
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
          tier: plot.tier || 0,
        })),
        econ: GameState.econ || { diminishMult: 1, diminishClock: 0, eventNextAt: 0, eventLog: [], plotSpent: {} },
        buildings: GameState.buildings || {},
        techPoints: GameState.techPoints || 0,
        unlockedTech: GameState.unlockedTech || [],
        labUnlocked: !!GameState.labUnlocked,
        weather: GameState.weather || 'sunny',
        weatherTimer: GameState.weatherTimer || 120,
        season: GameState.season || 'spring',
        seasonDay: GameState.seasonDay || 1,
        seasonTimer: GameState.seasonTimer || 0,
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
        defenseLoadout: Array.isArray(GameState.defenseLoadout) ? GameState.defenseLoadout : [],
        // v5.8 卡牌系统字段
        collection: GameState.collection || { skill: {}, item: {}, seed: {} },
        cardVault: GameState.cardVault || { common: 0, rare: 0, epic: 0, legendary: 0 },
        blueprints: Array.isArray(GameState.blueprints) ? GameState.blueprints : [],
        expBoost: !!GameState.expBoost,
        ownedBlueprints: Array.isArray(GameState.ownedBlueprints) ? GameState.ownedBlueprints : [],
        safeBoxSlots: GameState.safeBoxSlots || 1,
        hardcoreFullLoss: !!GameState.hardcoreFullLoss,
        deckPresets: Array.isArray(GameState.deckPresets) ? GameState.deckPresets : [],
        captureLog: Array.isArray(GameState.captureLog) ? GameState.captureLog : []
      }));
    } catch (error) {
      console.warn('保存本地存档失败。', error);
    }
  }
};

// ==================== 每日奖励与开荒保障 ====================
