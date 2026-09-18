/* Expedition 共享常量与类型（由 expedition.js 顶部抽离） */
// 静止形状粒子类型（不参与位移积分，仅缩放/旋转呈现）
const STATIC_SHAPE_TYPES = new Set(['aoe', 'slash', 'weaponRing', 'vine', 'earthTrail', 'impact', 'shock', 'trail', 'chain']);
// 武器专属打击反馈：命中主色、火花色、碎片色与命中音色
const WEAPON_FX = {
  harvest_sickle: { impact: '#fff3c4', spark: '#ffe9a8', debris: '#d9a94e', sound: 'sickle' },
  pea_repeater:   { impact: '#eaffd0', spark: '#d8ff9e', debris: '#6fae3f', sound: 'pea' },
  vine_staff:     { impact: '#e2fff5', spark: '#d5fff1', debris: '#3fae8a', sound: 'vine' }
};
