/**
 * 도시 지도. 장소마다 타일 격자(바닥) + 소품(여러 칸짜리 그림) + 출입구로 이루어진다.
 * 그림은 앱(apps/fortuna/src/city)이 코드로 그리고, 여기에는 모양과 통행 정보만 둔다. docs/SPEC-CITY-MAP.md 2절.
 */
export const TILE = 16;

/** Ground characters: what each letter of a map row means. */
export const GROUND = {
  ".": { id: "cobble", solid: false },
  ",": { id: "road", solid: false },
  ":": { id: "plaza", solid: false },
  "_": { id: "dirt", solid: false },
  g: { id: "grass", solid: false },
  "=": { id: "wood", solid: false },
  r: { id: "carpet", solid: false },
  m: { id: "marble", solid: false },
  c: { id: "concrete", solid: false },
  y: { id: "edge", solid: false },
  t: { id: "rail", solid: true },
  v: { id: "gravel", solid: true },
  B: { id: "facade", solid: true },
  R: { id: "roof", solid: true },
  "#": { id: "wallTop", solid: true },
  W: { id: "wallFace", solid: true },
  F: { id: "fence", solid: true },
} as const;
export type GroundChar = keyof typeof GROUND;
export type GroundId = (typeof GROUND)[GroundChar]["id"];

/**
 * A prop covers w×h cells. `mask` rows: '#' solid, '.' walkable, '^' walkable and drawn above
 * characters, '%' solid and drawn above characters. Missing mask = all solid.
 */
export interface PropDef { w: number; h: number; mask?: readonly string[]; frames?: number; fps?: number; }

export const PROPS = {
  station: { w: 12, h: 5, mask: ["############", "############", "############", "############", "#####..#####"] },
  fountain: { w: 4, h: 4, frames: 8, fps: 6 },
  lamp: { w: 1, h: 2, mask: ["^", "#"], frames: 2, fps: 1.5 },
  bench: { w: 2, h: 1 },
  kiosk: { w: 2, h: 2 },
  planter: { w: 1, h: 1 },
  barrier: { w: 2, h: 1 },
  ticketGate: { w: 4, h: 1, mask: ["#..#"] },
  pillar: { w: 1, h: 2, mask: ["%", "#"] },
  platformSign: { w: 4, h: 1 },
  crate: { w: 1, h: 1 },
  barrel: { w: 1, h: 1 },
  shop: { w: 4, h: 4, frames: 2, fps: 1 },
  alley: { w: 2, h: 4, frames: 2, fps: 2 },
  house: { w: 9, h: 5, mask: ["#########", "#########", "#########", "#########", "###...###"], frames: 4, fps: 3 },
  chandelier: { w: 2, h: 2, mask: ["^^", "^^"], frames: 2, fps: 2 },
  cardTable: { w: 3, h: 2 },
  rouletteTable: { w: 3, h: 2, frames: 8, fps: 8 },
  bar: { w: 6, h: 1 },
  cashier: { w: 4, h: 2 },
  palm: { w: 1, h: 2, mask: ["%", "#"] },
  portrait: { w: 1, h: 1 },
  booth: { w: 4, h: 4 },
  priceBoard: { w: 4, h: 4, frames: 4, fps: 2 },
  stall: { w: 3, h: 2 },
  tent: { w: 2, h: 2 },
  shack: { w: 3, h: 3 },
  campfire: { w: 1, h: 1, frames: 4, fps: 8 },
  log: { w: 1, h: 1 },
  laundry: { w: 3, h: 1, mask: ["^^^"], frames: 2, fps: 1 },
  pump: { w: 1, h: 2, mask: ["^", "#"] },
} as const satisfies Record<string, PropDef>;
export type PropId = keyof typeof PROPS;

/** [prop, x, y, variant] */
export type Placement = readonly [PropId, number, number, number?];

export interface Exit { x: number; y: number; to: PlaceId; at: readonly [number, number]; }
export interface MapLabel { x: number; y: number; text: string; kind?: "sign" | "place"; }

export const PLACE_IDS = ["wheel-plaza", "wheel-platform", "wheel-pandon", "wheel-house", "wheel-exchange", "wheel-daehap"] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

export interface PlaceMap {
  id: PlaceId;
  name: string;
  district: string;
  /** Rows of ground characters, all the same length. */
  ground: readonly string[];
  props: readonly Placement[];
  exits: readonly Exit[];
  spawn: readonly [number, number];
  labels: readonly MapLabel[];
  /** Base light: "day" outdoors, "lamp" for warm interiors. */
  mood: "day" | "lamp" | "station";
}

export interface Grid { width: number; height: number; solid: Uint8Array; over: Uint8Array; }

export function isPlaceId(value: unknown): value is PlaceId { return typeof value === "string" && (PLACE_IDS as readonly string[]).includes(value); }
