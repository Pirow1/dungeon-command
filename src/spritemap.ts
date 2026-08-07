// Frame indices into Kenney Tiny Dungeon tilemap_packed.png (12 cols x 11 rows, 16px).
export const SHEET = 'tiny'
export const TILE_PX = 16
export const SCALE = 3
export const CELL = TILE_PX * SCALE // 48px on screen

export const FRAMES = {
  // environment — rows 0-2 are the dark dungeon-stone floors (moodier than the
  // tan sand tiles further down the sheet)
  // 0 and 1 are the only *clean* dark-stone floors; 2/3/13/25 have wall edges
  // baked in and read as obstacles when used as open ground.
  floor: 0,
  floorAlt: 1,
  floorPebble: 24,
  floorRubble: 12,
  wall: 40,
  wallTorch: 29,
  wallGargoyle: 19,
  wallBars: 28,
  pillar: 6,
  door: 46,
  altar: 41,
  // heroes
  brannor: 87, // horned helm — dwarvish
  sylvia: 99,
  pip: 84,
  mira: 100,
  // monsters
  goblin: 112,
  skeleton: 86,
  orc: 109,
  demon: 110,
  // fx / items
  shield: 102,
  bones: 89,
} as const

export const UNIT_FRAME: Record<string, number> = {
  fighter: FRAMES.brannor,
  archer: FRAMES.sylvia,
  mage: FRAMES.pip,
  cleric: FRAMES.mira,
  goblin: FRAMES.goblin,
  skeleton: FRAMES.skeleton,
  orc: FRAMES.orc,
  demon: FRAMES.demon,
  shrine: FRAMES.altar,
}
