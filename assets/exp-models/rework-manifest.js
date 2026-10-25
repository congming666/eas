/* 远征实体写实化材质映射（P8 / 方案 C-2）。
 * 几何 GLB 保持轻量无贴图；本清单把每个实体的原始材质槽映射到 rework-tex 写实 PBR 库，
 * 由 three-entities.js 加载 <texturesBase><lib>/{albedo.jpg,normal.png,orm.png}。
 * emissive 为自发光库材质（晶体/能量），颜色与强度在此声明，配合 Bloom 表现科技感。
 * 此文件由人工按 tools/blender/inspect_all.py 的槽位结论维护。 */
window.EXP_REWORK = {
  texturesBase: "assets/exp-models/rework-tex/",
  emissive: {
    crystal_green: { color: 0x7dffb0, baseColor: 0x1e4630, strength: 2.3, roughness: 0.2, metalness: 0.0 },
    crystal_purple: { color: 0xb69cff, baseColor: 0x2e204e, strength: 2.3, roughness: 0.2, metalness: 0.0 }
  },
  slotMap: {
    char_farmer: { straw: "straw", skin: "skin", fur_dark: "hair_dark", cloth_red: "cloth_light", cloth_brown: "trousers" },
    mob_bat: { chitin_dark: "chitin_dark" },
    mob_boar: { fur_brown: "fur_brown" },
    mob_boss: { fur_dark: "fur_dark", horn: "bone" },
    mob_locust: { chitin_green: "chitin_green" },
    mob_spider: { chitin_dark: "chitin_dark" },
    mob_wolf: { fur_grey: "fur_grey" },
    obs_bush: { leaf: "leaf" },
    obs_deadTree: { bark: "bark" },
    obs_fence: { wood: "wood", wood_dark: "wood_dark" },
    obs_hay: { dark: "cloth_dark", straw: "straw" },
    obs_monolith: { crystal_purple: "crystal_purple", monolith: "stone_dark", stone_dark: "stone_dark" },
    obs_rock: { rock: "rock" },
    obs_ruin: { stone: "rock", stone_dark: "stone_dark" },
    obs_toxicCrystal: { crystal_green: "crystal_green", stone_dark: "stone_dark" },
    obs_tree: { bark: "bark", leaf: "leaf" },
    obs_voidCrystal: { crystal_purple: "crystal_purple", monolith: "stone_dark" },
    weapon_sickle: { metal: "metal_rust", wood: "wood", wood_dark: "wood_dark" },
    weapon_pea_repeater: { dark: "cloth_dark", leaf: "leaf", metal: "metal_rust", wood: "wood", wood_dark: "wood_dark" },
    weapon_vine_staff: { crystal_green: "crystal_green", leaf: "leaf", metal: "metal_rust", wood_dark: "wood_dark" }
  }
};
