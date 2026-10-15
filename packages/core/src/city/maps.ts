import { GROUND, PROPS, type Grid, type PlaceId, type PlaceMap } from "./types.ts";

/**
 * 휠 광장과 그 안쪽 장소들 (1단계). 행 하나가 지도 한 줄, 글자 하나가 한 칸이다(뜻은 types.ts의 GROUND).
 * 소품은 [이름, x, y, 변형]. 출입구 칸을 밟으면 `to` 장소의 `at` 칸으로 넘어간다.
 */
const PLAZA: PlaceMap = {
  id: "wheel-plaza", name: "휠 광장", district: "휠 광장", mood: "day",
  ground: [
    "BBBBBBBBBRRRRRRRRRRRRBBBBBBBBB",
    "BBBBBBBBBRRRRRRRRRRRRBBBBBBBBB",
    "BBBBBBBBB............BBBBBBBBB",
    "BBBBBBBBB............BBBBBBBBB",
    "BBBBBBBBB............BBBBBBBBB",
    ".............................B",
    "B............................B",
    "B.........::::::::::.........B",
    "B.......::::::::::::::.......B",
    "B......::::::::::::::::......B",
    ",,,,,,::::::::::::::::::,,,,,,",
    ",,,,,,::::::::::::::::::,,,,,,",
    "B......::::::::::::::::......B",
    "B.......::::::::::::::.......B",
    "B.........::::::::::.........B",
    "B............................B",
    "B............................B",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    "B............................B",
    "BB,,BB,,BB,,BB,,BB,,BB,,BB,,BB",
    "BB,,BB,,BB,,BB,,BB,,BB,,BB,,BB",
  ],
  props: [
    ["station", 9, 0], ["fountain", 13, 9],
    ["lamp", 6, 6], ["lamp", 23, 6], ["lamp", 6, 13], ["lamp", 23, 13],
    ["bench", 9, 15], ["bench", 19, 15], ["kiosk", 25, 8], ["planter", 3, 7], ["planter", 26, 13], ["planter", 3, 13],
    ["barrier", 2, 20], ["barrier", 6, 20], ["barrier", 10, 20], ["barrier", 14, 20], ["barrier", 18, 20], ["barrier", 22, 20], ["barrier", 26, 20],
  ],
  exits: [
    { x: 14, y: 4, to: "wheel-platform", at: [11, 11] }, { x: 15, y: 4, to: "wheel-platform", at: [12, 11] },
    { x: 0, y: 5, to: "wheel-daehap", at: [19, 7] },
    { x: 0, y: 10, to: "wheel-exchange", at: [22, 6] }, { x: 0, y: 11, to: "wheel-exchange", at: [22, 6] },
    { x: 29, y: 10, to: "wheel-pandon", at: [1, 6] }, { x: 29, y: 11, to: "wheel-pandon", at: [1, 6] },
  ],
  spawn: [14, 6],
  labels: [
    { x: 15, y: 3.04, text: "포르투나 종착역", kind: "place" },
    { x: 1.5, y: 4.55, text: "← 대합촌" }, { x: 2, y: 9.45, text: "← 환전가" }, { x: 27.5, y: 9.45, text: "판돈로 →" },
    { x: 3, y: 19.45, text: "한빛특구" }, { x: 7, y: 19.45, text: "로엔하임" }, { x: 11, y: 19.45, text: "중원" }, { x: 15, y: 19.45, text: "섹터9" },
    { x: 19, y: 19.45, text: "궤도 정거장" }, { x: 23, y: 19.45, text: "벨루체" }, { x: 27, y: 19.45, text: "무월리" },
  ],
};

const PLATFORM: PlaceMap = {
  id: "wheel-platform", name: "역 승강장", district: "휠 광장", mood: "station",
  ground: [
    "BBBBBBBBBBBBBBBBBBBBBBBB",
    "vvvvvvvvvvvvvvvvvvvvvvvv",
    "tttttttttttttttttttttttt",
    "vvvvvvvvvvvvvvvvvvvvvvvv",
    "yyyyyyyyyyyyyyyyyyyyyyyy",
    "cccccccccccccccccccccccc",
    "cccccccccccccccccccccccc",
    "cccccccccccccccccccccccc",
    "cccccccccccccccccccccccc",
    "cccccccccccccccccccccccc",
    "cccccccccccccccccccccccc",
    "cccccccccccccccccccccccc",
    "BBBBBBBBBBccccBBBBBBBBBB",
    "BBBBBBBBBBccccBBBBBBBBBB",
  ],
  props: [
    ["ticketGate", 10, 12], ["pillar", 4, 6], ["pillar", 19, 6, 1], ["platformSign", 10, 6],
    ["bench", 2, 9], ["bench", 7, 9], ["bench", 15, 9], ["bench", 20, 9],
    ["lamp", 1, 5], ["lamp", 22, 5], ["crate", 21, 11], ["crate", 22, 11], ["barrel", 1, 11],
  ],
  exits: [
    { x: 11, y: 13, to: "wheel-plaza", at: [14, 5] }, { x: 12, y: 13, to: "wheel-plaza", at: [15, 5] },
  ],
  spawn: [11, 11],
  labels: [{ x: 12, y: 6.55, text: "종점 · 포르투나", kind: "sign" }, { x: 12, y: 12.45, text: "개찰구" }],
};

const PANDON: PlaceMap = {
  id: "wheel-pandon", name: "판돈로", district: "휠 광장", mood: "lamp",
  ground: [
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "............................",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    "............................",
    "RRRRRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRRRRRR",
  ],
  props: [
    ["shop", 1, 0, 0], ["alley", 5, 0], ["shop", 7, 0, 1], ["shop", 12, 0, 2], ["house", 19, 0],
    ["lamp", 11, 3], ["lamp", 17, 3], ["crate", 3, 8], ["barrel", 14, 8], ["barrel", 15, 8], ["crate", 26, 8],
  ],
  exits: [
    { x: 0, y: 5, to: "wheel-plaza", at: [28, 10] }, { x: 0, y: 6, to: "wheel-plaza", at: [28, 10] }, { x: 0, y: 7, to: "wheel-plaza", at: [28, 11] },
    { x: 22, y: 4, to: "wheel-house", at: [9, 12] }, { x: 23, y: 4, to: "wheel-house", at: [9, 12] }, { x: 24, y: 4, to: "wheel-house", at: [10, 12] },
  ],
  spawn: [1, 6],
  labels: [
    { x: 3, y: 0.5, text: "전당포", kind: "sign" }, { x: 6, y: 0.5, text: "뒷골목" }, { x: 9, y: 0.5, text: "주사위", kind: "sign" },
    { x: 14, y: 0.5, text: "카드방", kind: "sign" }, { x: 23.5, y: 0.75, text: "THE HOUSE", kind: "place" },
    { x: 2, y: 8.45, text: "← 휠 광장" },
  ],
};

const HOUSE: PlaceMap = {
  id: "wheel-house", name: "하우스 로비", district: "휠 광장", mood: "lamp",
  ground: [
    "####################",
    "#WWWWWWWWWWWWWWWWWW#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#mmmmmmmmrrmmmmmmmm#",
    "#########rr#########",
  ],
  props: [
    ["cashier", 2, 2], ["bar", 12, 2],
    ["cardTable", 2, 6], ["cardTable", 15, 6, 1], ["rouletteTable", 2, 9], ["rouletteTable", 15, 9],
    ["chandelier", 6, 4], ["chandelier", 12, 4], ["chandelier", 6, 9], ["chandelier", 12, 9],
    ["palm", 1, 11], ["palm", 18, 11],
    ["portrait", 4, 1, 0], ["portrait", 7, 1, 1], ["portrait", 12, 1, 2], ["portrait", 15, 1, 3],
  ],
  exits: [{ x: 9, y: 13, to: "wheel-pandon", at: [23, 5] }, { x: 10, y: 13, to: "wheel-pandon", at: [23, 5] }],
  spawn: [9, 12],
  labels: [{ x: 10, y: 13.5, text: "판돈로 ↓" }],
};

const EXCHANGE: PlaceMap = {
  id: "wheel-exchange", name: "환전가", district: "휠 광장", mood: "day",
  ground: [
    "BBBBBBBBBBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBBBBBBBBBB",
    "........................",
    ",,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,",
    "........................",
    "........................",
    "........................",
    "........................",
    "RRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRR",
  ],
  props: [
    ["booth", 1, 0, 0], ["booth", 6, 0, 1], ["priceBoard", 10, 0], ["booth", 14, 0, 2], ["booth", 19, 0, 3],
    ["lamp", 5, 3], ["lamp", 18, 3],
    ["stall", 2, 9, 0], ["stall", 8, 9, 1], ["stall", 14, 9, 2], ["stall", 19, 9, 3], ["crate", 12, 10],
  ],
  exits: [
    { x: 23, y: 5, to: "wheel-plaza", at: [1, 10] }, { x: 23, y: 6, to: "wheel-plaza", at: [1, 10] }, { x: 23, y: 7, to: "wheel-plaza", at: [1, 11] },
  ],
  spawn: [22, 6],
  labels: [
    { x: 3, y: 0.5, text: "환전", kind: "sign" }, { x: 8, y: 0.5, text: "어음", kind: "sign" },
    { x: 16, y: 0.5, text: "귀금속", kind: "sign" }, { x: 21, y: 0.5, text: "전당", kind: "sign" },
    { x: 22, y: 8.45, text: "휠 광장 →" },
  ],
};

const DAEHAP: PlaceMap = {
  id: "wheel-daehap", name: "대합촌", district: "휠 광장", mood: "day",
  ground: [
    "FFFFFFFFFFFFFFFFFFFFFF",
    "F___gg_______________F",
    "F_gggg__________gg___F",
    "F__gg______________g_F",
    "F____________________F",
    "F_______gg___________F",
    "F____________________F",
    "F_____________________",
    "F_____________________",
    "F_g__________________F",
    "F____________________F",
    "F______________gg____F",
    "F____________________F",
    "F_________________gg_F",
    "Fgg__________________F",
    "FFFFFFFFFFFFFFFFFFFFFF",
  ],
  props: [
    ["tent", 3, 3, 0], ["tent", 7, 2, 1], ["tent", 2, 10, 2], ["tent", 13, 11, 3],
    ["shack", 16, 2, 0], ["shack", 8, 11, 1],
    ["campfire", 10, 7], ["log", 9, 7], ["log", 11, 7], ["log", 10, 8],
    ["laundry", 4, 6], ["pump", 17, 8], ["crate", 15, 6], ["crate", 19, 13], ["barrel", 14, 6],
  ],
  exits: [{ x: 21, y: 7, to: "wheel-plaza", at: [1, 5] }, { x: 21, y: 8, to: "wheel-plaza", at: [1, 5] }],
  spawn: [19, 7],
  labels: [{ x: 11, y: 0.5, text: "대합촌", kind: "place" }, { x: 19.5, y: 6.45, text: "휠 광장 →" }],
};

export const PLACES: Readonly<Record<PlaceId, PlaceMap>> = {
  "wheel-plaza": PLAZA, "wheel-platform": PLATFORM, "wheel-pandon": PANDON,
  "wheel-house": HOUSE, "wheel-exchange": EXCHANGE, "wheel-daehap": DAEHAP,
};

/** Where a newly made character first appears. */
export const ARRIVAL_PLACE: PlaceId = "wheel-plaza";

export function mapSize(place: PlaceMap): { width: number; height: number } {
  return { width: place.ground[0]?.length ?? 0, height: place.ground.length };
}

/** Walkability and draw-over cells, combining ground and prop masks. */
export function buildGrid(place: PlaceMap): Grid {
  const { width, height } = mapSize(place);
  const solid = new Uint8Array(width * height), over = new Uint8Array(width * height);
  place.ground.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) solid[y * width + x] = GROUND[row[x] as keyof typeof GROUND]?.solid ? 1 : 0;
  });
  for (const [id, px, py] of place.props) {
    const def = PROPS[id], mask = "mask" in def ? def.mask : undefined;
    for (let dy = 0; dy < def.h; dy += 1) for (let dx = 0; dx < def.w; dx += 1) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const cell = mask?.[dy]?.[dx] ?? "#";
      if (cell === "#" || cell === "%") solid[y * width + x] = 1;
      else if (cell === "." || cell === "^") solid[y * width + x] = 0;
      if (cell === "^" || cell === "%") over[y * width + x] = 1;
    }
  }
  return { width, height, solid, over };
}

const grids = new Map<PlaceId, Grid>();
export function gridOf(id: PlaceId): Grid {
  let grid = grids.get(id);
  if (!grid) { grid = buildGrid(PLACES[id]); grids.set(id, grid); }
  return grid;
}

/**
 * Where a new character appears: a free cell near the place's spawn, spread by `salt`
 * (the player id) so two newcomers do not stand on each other.
 */
export function spawnNear(id: PlaceId, salt: string): readonly [number, number] {
  const place = PLACES[id], grid = gridOf(id), [sx, sy] = place.spawn;
  const cells: [number, number][] = [];
  for (let dy = 0; dy <= 2; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
    const x = sx + dx, y = sy + dy;
    if (x >= 0 && y >= 0 && x < grid.width && y < grid.height && !grid.solid[y * grid.width + x] && !exitAt(place, x, y)) cells.push([x, y]);
  }
  let hash = 0;
  for (const char of salt) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return cells[hash % Math.max(1, cells.length)] ?? place.spawn;
}

export function exitAt(place: PlaceMap, x: number, y: number) { return place.exits.find((exit) => exit.x === x && exit.y === y) ?? null; }
