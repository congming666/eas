// ================= v0.9.0 作物多样性扩展系统（网页版） =================
(function () {
  'use strict';

  // ===== 8种新作物定义 =====
  const NEW_CROPS = [
    {
      id: 'chili', name: '辣椒', icon: '🌶️', growTime: 12, sellPrice: 20, seedPrice: 8,
      rarity: 'common', trait: 'combat_buff', buffType: 'attack', buffValue: 0.15, buffDuration: 3,
      qualityBonus: { common: 0.10, fine: 0.15, rare: 0.20, legendary: 0.30 },
      description: '收获后获得辣味buff，下一次远征攻击+15%（可叠加3层）'
    },
    {
      id: 'garlic', name: '大蒜', icon: '🧄', growTime: 25, sellPrice: 30, seedPrice: 12,
      rarity: 'common', trait: 'survival_buff', buffType: 'fog_vision', buffValue: 1, buffDuration: 2,
      comboWith: ['onion'], comboName: '辛香组合', comboEffect: 'growth_boost', comboValue: 0.20,
      description: '收获后获得驱虫buff，远征中雾天视野不缩减，持续2场'
    },
    {
      id: 'mint', name: '薄荷', icon: '🌿', growTime: 14, sellPrice: 18, seedPrice: 10,
      rarity: 'common', trait: 'dodge_buff', buffType: 'dodge_window', buffValue: 30, buffDuration: 1,
      reharvest: 3, rareVariant: { id: 'ice_mint', name: '冰薄荷', chance: 0.1, buffValue: 0.15 },
      description: '生长快、可反复收获3次。收获后获得清醒buff，完美闪避窗口+30ms'
    },
    {
      id: 'cactus', name: '仙人掌', icon: '🌵', growTime: 35, sellPrice: 40, seedPrice: 15,
      rarity: 'rare', trait: 'environment', droughtImmune: true, auraRange: 1, auraEffect: 'drought_immune',
      harvestBuff: { type: 'thorns', value: 0.10, duration: 1 },
      description: '极耐旱，周围4格作物干旱免疫。收获获得刺甲buff，受击反弹10%伤害'
    },
    {
      id: 'rice', name: '水稻', icon: '🌾', growTime: 28, sellPrice: 35, seedPrice: 12,
      rarity: 'common', trait: 'seasonal', weatherBoost: { rain: 2.0, fog: 'quality+1' },
      requiresWater: true, waterPlotOnly: true,
      description: '需水田格子，雨天生长速度×2，雾天品质+1级'
    },
    {
      id: 'ginseng', name: '人参', icon: '🫚', growTime: 72, sellPrice: 150, seedPrice: 50,
      rarity: 'legendary', trait: 'rare_event', rareEvent: {
        chance: 0.5, name: '千年人参', priceMultiplier: 10, npcAffectionAll: 10
      },
      requiresGreenhouse: 2,
      description: '生长极慢（3天），收获时50%概率千年人参（售价×10+所有NPC好感+10）'
    },
    {
      id: 'tomato', name: '番茄', icon: '🍅', growTime: 22, sellPrice: 25, seedPrice: 10,
      rarity: 'common', trait: 'combo', comboWith: ['mint', 'garlic'], comboName: '意式组合',
      comboEffect: 'quality_boost', comboValue: 1,
      processTo: { id: 'ketchup', name: '番茄酱', icon: '🍅', heal: 40 },
      description: '与薄荷/大蒜相邻触发意式组合→双方品质+1级。可加工为番茄酱（远征回血）'
    },
    {
      id: 'rosemary', name: '迷迭香', icon: '🌱', growTime: 30, sellPrice: 35, seedPrice: 15,
      rarity: 'rare', trait: 'cdr_buff', buffType: 'cooldown_reduction', buffValue: 0.10, buffDuration: 1,
      reharvest: 3, legendaryBonus: 0.25,
      description: '可反复收获。收获后获得记忆buff，远征技能冷却-10%（传说-25%）'
    },
    {
      id: 'frost_flower', name: '寒霜花', icon: '❄️', growTime: 30, sellPrice: 55, seedPrice: 18,
      rarity: 'rare', trait: 'dodge_buff', buffType: 'dodge_window', buffValue: 25, buffDuration: 1,
      qualityBonus: { common: 0.10, fine: 0.15, rare: 0.20, legendary: 0.30 },
      description: '远征寒霜花种子培育而成。收获后获得寒霜护体，完美闪避窗口+25ms'
    },
    {
      id: 'lightning_vine', name: '电藤', icon: '⚡', growTime: 36, sellPrice: 80, seedPrice: 22,
      rarity: 'rare', trait: 'cdr_buff', buffType: 'cooldown_reduction', buffValue: 0.12, buffDuration: 1,
      qualityBonus: { common: 0.10, fine: 0.15, rare: 0.20, legendary: 0.30 },
      description: '缠绕电光的藤蔓。收获后获得疾电buff，远征技能冷却-12%'
    },
    {
      id: 'shadow_flower', name: '暗影花', icon: '🌑', growTime: 45, sellPrice: 100, seedPrice: 32,
      rarity: 'epic', trait: 'dodge_buff', buffType: 'dodge_window', buffValue: 40, buffDuration: 2,
      qualityBonus: { common: 0.12, fine: 0.18, rare: 0.24, legendary: 0.35 },
      description: '只在阴影中绽放。收获后获得暗影步，完美闪避窗口+40ms，持续2场'
    },
    {
      id: 'deathcap', name: '亡语菇', icon: '🍄', growTime: 48, sellPrice: 120, seedPrice: 35,
      rarity: 'epic', trait: 'combat_buff', buffType: 'attack', buffValue: 0.20, buffDuration: 3,
      qualityBonus: { common: 0.12, fine: 0.18, rare: 0.24, legendary: 0.35 },
      description: 'T3远征亡语菇种子培育而成。收获后获得剧毒之力，下一次远征攻击+20%（可叠加3层）'
    }
  ];

  // ===== 作物buff系统 =====
  const CropBuffSystem = {
    _activeBuffs: [],

    init() {
      if (!GameState.cropBuffs) GameState.cropBuffs = [];
      this._activeBuffs = GameState.cropBuffs;
    },

    addBuff(buffType, value, duration, source, quality) {
      // 检查是否已有同类型buff，取最大值或叠加
      const existing = this._activeBuffs.find(b => b.type === buffType);
      if (existing) {
        if (buffType === 'attack') {
          existing.stacks = Math.min(3, (existing.stacks || 1) + 1);
          existing.value = value * existing.stacks;
        } else {
          existing.value = Math.max(existing.value, value);
          existing.duration = Math.max(existing.duration, duration);
        }
      } else {
        this._activeBuffs.push({
          type: buffType, value, duration, source, quality,
          stacks: buffType === 'attack' ? 1 : 1
        });
      }
      showToast(`🌿 获得作物buff：${this._buffName(buffType)} +${Math.round(value * 100)}%`, 'success');
    },

    onExpeditionStart() {
      // 远征开始时，所有buff持续时间-1
      this._activeBuffs = this._activeBuffs.filter(b => {
        b.duration--;
        return b.duration > 0;
      });
      GameState.cropBuffs = this._activeBuffs;
    },

    getBuff(type) {
      return this._activeBuffs.find(b => b.type === type);
    },

    getAllBuffs() { return this._activeBuffs; },

    _buffName(type) {
      const names = {
        attack: '辣味（攻击）', fog_vision: '驱虫（雾天视野）',
        dodge_window: '清醒（闪避窗口）', thorns: '刺甲（反弹）',
        cooldown_reduction: '记忆（冷却缩减）'
      };
      return names[type] || type;
    }
  };

  // ===== 生长4阶段系统 =====
  const GrowthStageSystem = {
    getStage(plot) {
      if (!plot.crop) return 0;
      const crop = CONFIG.crops.find(c => c.id === plot.crop) || NEW_CROPS.find(c => c.id === plot.crop);
      if (!crop) return 0;
      const elapsed = (Date.now() - plot.plantedAt) / 1000;
      const progress = Math.min(1, elapsed / crop.growTime);
      if (progress < 0.25) return 1; // 种子
      if (progress < 0.55) return 2;  // 幼苗
      if (progress < 0.85) return 3;  // 开花
      return 4; // 结果
    },

    getStageIcon(cropId, stage) {
      const stages = {
        1: '🌱', 2: '🌿', 3: '🌸', 4: null // 结果用作物本身icon
      };
      return stage === 4 ? (CONFIG.crops.find(c => c.id === cropId)?.icon || NEW_CROPS.find(c => c.id === cropId)?.icon || '🌾') : stages[stage];
    },

    getStageName(stage) {
      return ['空地', '种子', '幼苗', '开花', '结果'][stage] || '未知';
    }
  };

  // ===== 品质系统 =====
  const QualitySystem = {
    QUALITIES: ['common', 'fine', 'rare', 'legendary'],
    QUALITY_NAMES: { common: '普通', fine: '优质', rare: '稀有', legendary: '传说' },
    QUALITY_COLORS: { common: '#ffffff', fine: '#7fff7f', rare: '#cc88ff', legendary: '#ffd700' },

    rollQuality(baseRarity, bonusQuality = 0) {
      const roll = Math.random();
      let quality = 'common';
      const thresholds = baseRarity === 'legendary' ? [0.3, 0.6, 0.85, 1] :
                       baseRarity === 'rare' ? [0.5, 0.75, 0.92, 1] :
                       [0.7, 0.88, 0.97, 1];
      // bonusQuality直接提升等级
      for (let i = 0; i < thresholds.length; i++) {
        if (roll < thresholds[i]) { quality = this.QUALITIES[i]; break; }
      }
      if (bonusQuality > 0) {
        const idx = this.QUALITIES.indexOf(quality);
        quality = this.QUALITIES[Math.min(3, idx + bonusQuality)];
      }
      return quality;
    },

    getQualityMultiplier(quality) {
      return { common: 1.0, fine: 1.3, rare: 1.8, legendary: 2.5 }[quality] || 1.0;
    },

    playHarvestEffect(quality, x, y) {
      const colors = { common: '#ffffff', fine: '#7fff7f', rare: '#cc88ff', legendary: '#ffd700' };
      const color = colors[quality] || '#ffffff';
      // 创建收获粒子
      for (let i = 0; i < (quality === 'legendary' ? 20 : quality === 'rare' ? 12 : 6); i++) {
        FarmCareSystem._spawnFloatText(x, y, quality === 'legendary' ? '✨传说✨' : quality === 'rare' ? '稀有!' : '', color);
      }
      if (quality === 'legendary') {
        showToast('🌟 传说品质收获！', 'gold');
      } else if (quality === 'rare') {
        showToast('💜 稀有品质收获！', 'success');
      }
    }
  };

  // ===== 组合效果系统 =====
  const ComboSystem = {
    checkCombos(plotIndex) {
      const plot = GameState.farmPlots[plotIndex];
      if (!plot || !plot.crop) return [];
      const crop = this._getCropDef(plot.crop);
      if (!crop || !crop.comboWith) return [];

      const combos = [];
      const neighbors = this._getNeighbors(plotIndex);
      for (const neighborIdx of neighbors) {
        const neighborPlot = GameState.farmPlots[neighborIdx];
        if (!neighborPlot || !neighborPlot.crop) continue;
        if (crop.comboWith.includes(neighborPlot.crop)) {
          combos.push({
            name: crop.comboName || '组合',
            effect: crop.comboEffect,
            value: crop.comboValue || 0,
            with: neighborPlot.crop,
            plotIndex: neighborIdx
          });
        }
      }
      return combos;
    },

    getComboBonus(plotIndex) {
      const combos = this.checkCombos(plotIndex);
      let qualityBonus = 0;
      let growthBonus = 0;
      for (const c of combos) {
        if (c.effect === 'quality_boost') qualityBonus += c.value;
        if (c.effect === 'growth_boost') growthBonus += c.value;
      }
      return { qualityBonus, growthBonus, combos };
    },

    hasCombo(plotIndex) {
      return this.checkCombos(plotIndex).length > 0;
    },

    _getCropDef(id) {
      return CONFIG.crops.find(c => c.id === id) || NEW_CROPS.find(c => c.id === id);
    },

    _getNeighbors(index) {
      const cols = 6; // 6列农田
      const row = Math.floor(index / cols);
      const col = index % cols;
      const neighbors = [];
      if (row > 0) neighbors.push(index - cols);
      if (row < 5) neighbors.push(index + cols);
      if (col > 0) neighbors.push(index - 1);
      if (col < cols - 1) neighbors.push(index + 1);
      return neighbors;
    }
  };

  // ===== 环境交互系统 =====
  const EnvironmentSystem = {
    getEnvironmentBonus(plotIndex) {
      let droughtImmune = false;
      let moistureBoost = 0;
      const neighbors = ComboSystem._getNeighbors(plotIndex);
      for (const nIdx of neighbors) {
        const plot = GameState.farmPlots[nIdx];
        if (!plot || !plot.crop) continue;
        const crop = ComboSystem._getCropDef(plot.crop);
        if (crop?.trait === 'environment' && crop.auraEffect === 'drought_immune') {
          droughtImmune = true;
        }
      }
      return { droughtImmune, moistureBoost };
    }
  };

  // ===== 稀有事件系统 =====
  const RareEventSystem = {
    triggerHarvestEvent(cropId, quality) {
      const crop = NEW_CROPS.find(c => c.id === cropId);
      if (!crop?.rareEvent) return null;
      if (Math.random() < crop.rareEvent.chance) {
        return crop.rareEvent;
      }
      return null;
    }
  };

  // ===== 注册新作物到CONFIG =====
  function registerCrops() {
    for (const crop of NEW_CROPS) {
      if (!CONFIG.crops.find(c => c.id === crop.id)) {
        CONFIG.crops.push(crop);
      }
      // 注册到仓库物品
      if (!CONFIG.warehouseItems[crop.id]) {
        CONFIG.warehouseItems[crop.id] = {
          name: crop.name, icon: crop.icon, category: 'crop',
          sellPrice: crop.sellPrice, rarity: crop.rarity
        };
      }
    }
  }

  // 暴露全局
  window.CropExpansion = {
    NEW_CROPS, CropBuffSystem, GrowthStageSystem, QualitySystem,
    ComboSystem, EnvironmentSystem, RareEventSystem, registerCrops
  };
})();
