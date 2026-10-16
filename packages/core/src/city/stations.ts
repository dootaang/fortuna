/**
 * 도시 노선도. 휠 광장이 종착역이고, 일곱 구역이 노선 일곱 개로 뻗는다. 역 하나가 장면(장소) 하나다.
 * 감각 묘사는 자료/fortuna-gm 02-style의 구역별 감각 단어에서 왔다. docs/SPEC-CITY-MAP.md 2절.
 */
export const LINE_IDS = ["wheel", "modern", "medieval", "wuxia", "cyberpunk", "scifi", "romance", "horror"] as const;
export type LineId = (typeof LINE_IDS)[number];

export interface LineDef {
  id: LineId;
  /** districts/{id} the line serves. */
  district: string;
  name: string;
  /** Deep and bright tones of the district: the scene filter, the default card and the line color. */
  dark: string;
  light: string;
  /** Direction the line leaves the terminus in, degrees (0 = right, clockwise). */
  angle: number;
}

export const LINES: Readonly<Record<LineId, LineDef>> = {
  wheel: { id: "wheel", district: "downtown", name: "휠 광장", dark: "#0f4634", light: "#d4af37", angle: 0 },
  modern: { id: "modern", district: "modern", name: "한빛특구선", dark: "#0d2a3a", light: "#7fb7d9", angle: -116 },
  medieval: { id: "medieval", district: "medieval", name: "로엔하임선", dark: "#2a1a0c", light: "#c9a46b", angle: -64 },
  wuxia: { id: "wuxia", district: "wuxia", name: "중원선", dark: "#2a0f0a", light: "#d97a5b", angle: -13 },
  cyberpunk: { id: "cyberpunk", district: "cyberpunk", name: "섹터9선", dark: "#1a0a2a", light: "#d35fd1", angle: 39 },
  scifi: { id: "scifi", district: "scifi", name: "궤도선", dark: "#0a2a2a", light: "#8fd0c4", angle: 90 },
  romance: { id: "romance", district: "romance", name: "벨루체선", dark: "#2a0f1a", light: "#e8a0b4", angle: 141 },
  horror: { id: "horror", district: "horror", name: "무월리선", dark: "#141a12", light: "#9aa36b", angle: -167 },
};

export const PLACE_IDS = [
  "wheel-plaza", "wheel-platform", "wheel-pandon", "wheel-house", "wheel-exchange", "wheel-daehap",
  "hanbit-square", "hanbit-guild", "hanbit-bulya", "hanbit-tower",
  "loen-gate", "loen-kaldrok", "loen-castle",
  "zhong-market", "zhong-unpyo", "zhong-chwiseon", "zhong-black",
  "s9-neon", "s9-downlink", "s9-glitch", "s9-lobby",
  "orbit-corridor", "orbit-deck3", "orbit-market", "orbit-core",
  "bel-road", "bel-ballroom", "bel-roses", "bel-salon",
  "moon-road", "moon-pond", "moon-village", "moon-hotel",
] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

export interface Station {
  id: PlaceId;
  name: string;
  line: LineId;
  /** Default sense line under the scene's name (the dealer can change it per scene or image). */
  sense: string;
  /** Position on the line map, in a 1000×1000 box with the terminus at the center. */
  x: number;
  y: number;
  /** The district's street-level stop (the rest are inner places). */
  outer: boolean;
}

type StopSpec = [PlaceId, string, string];

const STOPS: Readonly<Record<Exclude<LineId, "wheel">, readonly StopSpec[]>> = {
  modern: [
    ["hanbit-square", "중앙 전광판 광장", "유리벽에 번지는 전광판의 순위, 시스템 알림음"],
    ["hanbit-guild", "길드로", "올라가는 셔터 소리, 사채 전단지가 붙은 구인 게시판"],
    ["hanbit-bulya", "불야동", "편의점 불빛, 퉁퉁 불은 컵라면, 밤새 꺼지지 않는 네온"],
    ["hanbit-tower", "탑 로비", "허공의 푸른 시스템 창, 입장료가 빠져나가는 소리"],
  ],
  medieval: [
    ["loen-gate", "성문 광장", "성문의 쇠사슬, 끝없는 통행세 줄, 대여섯 언어의 흥정"],
    ["loen-kaldrok", "칼드록", "둔탁한 망치 소리, 쇠 냄새, 화로의 열기"],
    ["loen-castle", "마왕성 알현실", "검은 망토, 붉은 눈, 왕좌 팔걸이에 쌓인 장부"],
  ],
  wuxia: [
    ["zhong-market", "저잣거리", "찻물 끓는 소리, 처마 끝 붉은 등롱, 표국 수레바퀴"],
    ["zhong-unpyo", "운표가", "펄럭이는 표국 깃발, 짐 싣는 소리, 가장 빠른 소문"],
    ["zhong-chwiseon", "취선포", "객잔 등롱, 술 냄새, 홧김에 탁자를 내리치는 소리"],
    ["zhong-black", "흑전각 계단", "구름 위로 이어진 계단, 비어 있는 현판 자리, 바람 소리"],
  ],
  cyberpunk: [
    ["s9-neon", "네온 대로", "산성비, 번지는 홀로그램 간판, 귓전의 광고음"],
    ["s9-downlink", "다운링크", "배수관 물소리, 탈옥한 부품, 낮은 목소리의 거래"],
    ["s9-glitch", "글리치로", "지직거리는 깨진 간판, 먹통인 감시 카메라"],
    ["s9-lobby", "본사 로비", "민원 번호표, 네 자리 대기 인원, 회전하는 회사 로고"],
  ],
  scifi: [
    ["orbit-corridor", "중앙 복도", "늘 같은 세기의 환기구 바람, 따라오며 밝아지는 표시등"],
    ["orbit-deck3", "제3갑판", "합성 스튜 냄새, 손글씨 이름표, 사람 사는 소리"],
    ["orbit-market", "성간장터", "발음할 수 없는 향신료, 어느 별의 것인지 모를 부품"],
    ["orbit-core", "중앙 기관실", "발밑의 느린 진동, 푸른 빛 속에서 도는 궤도 모형"],
  ],
  romance: [
    ["bel-road", "마차 길", "자갈길의 마차 바퀴, 일제히 켜지는 창가의 촛불"],
    ["bel-ballroom", "대무도회장", "크리스털 샹들리에, 현악 4중주, 치맛자락 스치는 소리"],
    ["bel-roses", "로제뜰", "밤안개와 장미 향, 음악이 닿지 않는 미로의 속삭임"],
    ["bel-salon", "살롱 카드 탁자", "카드 섞는 소리, 부채 뒤의 웃음, 스캔들이라 불리는 조커"],
  ],
  horror: [
    ["moon-road", "안개 마을 길", "발목까지 차오른 안개, 꺼진 등롱, 젖은 나무 냄새"],
    ["moon-pond", "녹슨못", "폐가가 둘러선 저수지, 볕이 드는 낮에만 한적한 물가"],
    ["moon-village", "잠귀촌", "막다른 골목, 잠귀 얇은 주민들, 문 두드리는 소리"],
    ["moon-hotel", "호텔 로비", "금박 테두리 안내문, 꺼지지 않는 벽난로, 4층 버튼이 없는 승강기"],
  ],
};

/** 휠 광장: the terminus itself and the stops around it. [id, name, sense, angle, radius] */
const WHEEL: readonly [PlaceId, string, string, number, number][] = [
  ["wheel-plaza", "휠 광장", "동전 세는 소리, 역의 종소리, 분수 위에서 도는 금빛 휠", 0, 0],
  ["wheel-platform", "역 승강장", "비어 있는 선로, 멈춘 시계, 아직 따뜻한 벤치", -90, 86],
  ["wheel-pandon", "판돈로", "붉은 네온, 젖은 돌길, 주사위 구르는 소리", 13, 86],
  ["wheel-house", "하우스 로비", "샹들리에 아래 카드 섞는 소리, 붉은 카펫, 지배인의 금고", 13, 160],
  ["wheel-exchange", "환전가", "깜빡이는 시세판, 저울 위의 동전, 낮은 흥정 소리", 116, 86],
  ["wheel-daehap", "대합촌", "모닥불 연기, 빨랫줄의 천, 기차를 기다리지 않는 사람들", 167, 86],
];

const CENTER = 500;
const at = (angle: number, radius: number) => {
  const a = (angle * Math.PI) / 180;
  return { x: Math.round(CENTER + Math.cos(a) * radius), y: Math.round(CENTER + Math.sin(a) * radius) };
};

function buildStations(): Record<PlaceId, Station> {
  const out = {} as Record<PlaceId, Station>;
  for (const [id, name, sense, angle, radius] of WHEEL) out[id] = { id, name, line: "wheel", sense, ...at(angle, radius), outer: id === "wheel-plaza" };
  for (const line of LINE_IDS) {
    if (line === "wheel") continue;
    STOPS[line].forEach(([id, name, sense], index) => {
      out[id] = { id, name, line, sense, ...at(LINES[line].angle, 175 + index * 88), outer: index === 0 };
    });
  }
  return out;
}

export const STATIONS: Readonly<Record<PlaceId, Station>> = buildStations();

export function stationsOf(line: LineId): Station[] { return PLACE_IDS.map((id) => STATIONS[id]).filter((station) => station.line === line); }
export function lineOf(place: PlaceId): LineDef { return LINES[STATIONS[place].line]; }
export function isPlaceId(value: unknown): value is PlaceId { return typeof value === "string" && (PLACE_IDS as readonly string[]).includes(value); }
export function isLineId(value: unknown): value is LineId { return typeof value === "string" && (LINE_IDS as readonly string[]).includes(value); }

/** Where a newly made character first stands. */
export const ARRIVAL_PLACE: PlaceId = "wheel-plaza";

/** Scene effects the dealer can switch on (one-shot ones play once, the rest stay until switched off). */
export const SCENE_EFFECTS = {
  shake: { label: "흔들림", oneShot: true },
  gold: { label: "금빛", oneShot: true },
  alarm: { label: "경보", oneShot: false },
  blackout: { label: "정전", oneShot: false },
  rain: { label: "비", oneShot: false },
  fog: { label: "안개", oneShot: false },
} as const;
export type SceneEffect = keyof typeof SCENE_EFFECTS;
export function isSceneEffect(value: unknown): value is SceneEffect { return typeof value === "string" && value in SCENE_EFFECTS; }

/** How strongly an uploaded image is pulled into the district's colors. */
export const IMAGE_FILTERS = { soft: "은은하게", strong: "강하게", frame: "틀만" } as const;
export type ImageFilter = keyof typeof IMAGE_FILTERS;

/** 세계관 NPC (이름·구역만; 초상은 딜러가 채운다). */
export const PRESET_NPCS: readonly { id: string; name: string; line: LineId }[] = [
  { id: "manager", name: "지배인", line: "wheel" }, { id: "saintess", name: "성녀", line: "wheel" }, { id: "stationmaster", name: "역무원", line: "wheel" },
  { id: "gwakdu", name: "곽두", line: "wheel" }, { id: "tower", name: "탑", line: "modern" }, { id: "demon-king", name: "마왕", line: "medieval" },
  { id: "heavenly-demon", name: "천마", line: "wuxia" }, { id: "geum-manryang", name: "금만량", line: "wuxia" }, { id: "chairman", name: "회장", line: "cyberpunk" },
  { id: "mother", name: "마더", line: "scifi" }, { id: "grand-duke", name: "북부대공", line: "romance" }, { id: "duchess-rosalind", name: "로잘린드 공작부인", line: "romance" },
  { id: "hotel", name: "호텔", line: "horror" },
  { id: "kang-mujin", name: "강무진", line: "modern" }, { id: "demon-scribe", name: "마왕의 서기관", line: "medieval" }, { id: "duke-butler", name: "대공의 집사", line: "romance" },
];
