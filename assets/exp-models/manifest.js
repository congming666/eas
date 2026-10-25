/* 远征实体 GLB 清单（gen_expedition_glb.py 自动生成，勿手改）
 * 架构：GLB 只含网格/UV/材质名（无贴图），PBR 纹理按材质名从 texturesBase 共享加载：
 *   <base>/albedo.jpg(sRGB) + normal.png(Linear) + orm.png(R=AO G=rough B=metal, Linear)
 * proceduralSlots 为无 PBR 纹理的兜底材质（crystal_* 自发光，其余纯色 rough=.85）。
 * 1 米 = 40 网页像素；heightM 为 Unity 运行时真实高度。 */
window.EXP_MODELS = {
  texturesBase: "assets/exp-models/textures/",
  textureSets: ["bark", "chitin_dark", "chitin_green", "cloth_brown", "cloth_red", "fur_brown", "fur_dark", "fur_grey", "horn", "leaf", "metal", "rock", "skin", "stone", "straw", "wood", "wood_dark"],
  proceduralSlots: {"crystal_green": {"type": "emissive", "roughness": 0.25, "emissiveStrength": 1.2}, "crystal_purple": {"type": "emissive", "roughness": 0.25, "emissiveStrength": 1.2}, "dark": {"type": "flat", "roughness": 0.85}, "monolith": {"type": "flat", "roughness": 0.85}, "stone_dark": {"type": "flat", "roughness": 0.85}},
  weaponRes: {"harvest_sickle": "weapon_sickle"},  // 业务武器 id → GLB 资源名
  models: {
    "char_farmer": {"file": "char_farmer.glb", "heightM": 2.0, "kind": "char", "triangles": 12000, "materialSlots": ["cloth_brown", "cloth_red", "fur_dark", "skin", "straw"]},
    "mob_bat": {"file": "mob_bat.glb", "heightM": 0.95, "kind": "mob", "triangles": 10000, "materialSlots": ["chitin_dark"]},
    "mob_boar": {"file": "mob_boar.glb", "heightM": 1.05, "kind": "mob", "triangles": 10000, "materialSlots": ["fur_brown"]},
    "mob_boss": {"file": "mob_boss.glb", "heightM": 2.9, "kind": "mob", "triangles": 18000, "materialSlots": ["fur_dark", "horn"]},
    "mob_locust": {"file": "mob_locust.glb", "heightM": 0.7, "kind": "mob", "triangles": 10000, "materialSlots": ["chitin_green"]},
    "mob_spider": {"file": "mob_spider.glb", "heightM": 0.85, "kind": "mob", "triangles": 10000, "materialSlots": ["chitin_dark"]},
    "mob_wolf": {"file": "mob_wolf.glb", "heightM": 1.35, "kind": "mob", "triangles": 10000, "materialSlots": ["fur_grey"]},
    "obs_bush": {"file": "obs_bush.glb", "heightM": 0.7, "kind": "obs", "triangles": 12000, "materialSlots": ["leaf"]},
    "obs_deadTree": {"file": "obs_deadTree.glb", "heightM": 2.4, "kind": "obs", "triangles": 10000, "materialSlots": ["bark"]},
    "obs_fence": {"file": "obs_fence.glb", "heightM": 1.0, "kind": "obs", "triangles": 120, "materialSlots": ["wood", "wood_dark"]},
    "obs_hay": {"file": "obs_hay.glb", "heightM": 1.0, "kind": "obs", "triangles": 2596, "materialSlots": ["dark", "straw"]},
    "obs_monolith": {"file": "obs_monolith.glb", "heightM": 2.4, "kind": "obs", "triangles": 36, "materialSlots": ["crystal_purple", "monolith", "stone_dark"]},
    "obs_rock": {"file": "obs_rock.glb", "heightM": 0.9, "kind": "obs", "triangles": 12000, "materialSlots": ["rock"]},
    "obs_ruin": {"file": "obs_ruin.glb", "heightM": 1.0, "kind": "obs", "triangles": 276, "materialSlots": ["stone", "stone_dark"]},
    "obs_toxicCrystal": {"file": "obs_toxicCrystal.glb", "heightM": 1.4, "kind": "obs", "triangles": 280, "materialSlots": ["crystal_green", "stone_dark"]},
    "obs_tree": {"file": "obs_tree.glb", "heightM": 3.0, "kind": "obs", "triangles": 12000, "materialSlots": ["bark", "leaf"]},
    "obs_voidCrystal": {"file": "obs_voidCrystal.glb", "heightM": 1.6, "kind": "obs", "triangles": 200, "materialSlots": ["crystal_purple", "monolith"]},
    "weapon_sickle": {"file": "weapon_sickle.glb", "heightM": 1.05, "kind": "weapon", "triangles": 684, "materialSlots": ["metal", "wood", "wood_dark"]},
    "weapon_pea_repeater": {"file": "weapon_pea_repeater.glb", "heightM": 0.95, "kind": "weapon", "triangles": 1160, "materialSlots": ["dark", "leaf", "metal", "wood", "wood_dark"]},
    "weapon_vine_staff": {"file": "weapon_vine_staff.glb", "heightM": 1.7, "kind": "weapon", "triangles": 2448, "materialSlots": ["crystal_green", "leaf", "metal", "wood_dark"]},
  },
};
