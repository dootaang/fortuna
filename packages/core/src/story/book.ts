import { DISTRICTS } from "../content/districts.ts";
import { FRONT_DISTRICTS, FRONT_MAX, type FrontDistrict } from "../content/fronts.ts";

/**
 * 장부: 구역마다 네 쪽(+ 시계가 다 찬 동안 검은 쪽 하나)과 도착한 플레이어마다 한 쪽.
 * 쪽은 지금 상태에서 계산한다. 상태가 되돌아가면 쪽도 되돌아간다. 설계는 비공개 문서에 있다.
 *
 * - 1·2쪽: 그 구역 해방
 * - 3쪽: 그 구역 담보 단서를 찾음 (찾기 전에는 이름이 봉인된다)
 * - 4쪽: 그 구역에 연결된 모금함이 목표를 채움
 * - 플레이어 쪽: 그 사람의 빚이 0
 * - 검은 쪽: 지워지지 않는다 (시계를 되돌리면 사라진다)
 */
export type PageState = "ink" | "blank" | "black";
export interface BookPage { state: PageState; title: string; }
export interface PassengerPage extends BookPage { pid: string; name: string; }

export interface BookTitles { chapters: Partial<Record<FrontDistrict, string[]>>; passenger: string; }

export interface BookInput {
  liberated: ReadonlySet<string>;
  /** Districts whose collateral clue someone has found. */
  collateral: ReadonlySet<string>;
  /** Districts whose linked fund reached its goal. */
  funded: ReadonlySet<string>;
  fronts: Partial<Record<FrontDistrict, number>>;
  /** Arrived players. */
  passengers: readonly { pid: string; name: string; debt: number }[];
  titles: BookTitles | null;
}

export interface BookDoc<T = unknown> {
  chapters: Record<FrontDistrict, BookPage[]>;
  passengers: PassengerPage[];
  total: number;
  /** Pages not yet blank (black pages included). */
  remaining: number;
  at: T;
}

export const SEALED_TITLE = "봉인된 담보";

const districtName = (id: string) => DISTRICTS.find((entry) => entry.id === id)?.name ?? id;

export function deriveBook(input: BookInput): Omit<BookDoc, "at"> {
  const chapters = {} as Record<FrontDistrict, BookPage[]>;
  for (const district of FRONT_DISTRICTS) {
    const names = input.titles?.chapters[district] ?? [], title = (index: number) => names[index] || `${districtName(district)} 제${index + 1}쪽`;
    const freed = input.liberated.has(district), found = input.collateral.has(district);
    const pages: BookPage[] = [
      { state: freed ? "blank" : "ink", title: title(0) },
      { state: freed ? "blank" : "ink", title: title(1) },
      { state: found ? "blank" : "ink", title: found ? title(2) : SEALED_TITLE },
      { state: input.funded.has(district) ? "blank" : "ink", title: title(3) },
    ];
    if ((input.fronts[district] ?? 0) >= FRONT_MAX) pages.push({ state: "black", title: names[4] || `[파국] ${districtName(district)}` });
    chapters[district] = pages;
  }
  const pattern = input.titles?.passenger || "승객 [{name}]의 차용증";
  const passengers = input.passengers.map((entry) => ({ pid: entry.pid, name: entry.name, state: (entry.debt > 0 ? "ink" : "blank") as PageState, title: pattern.replace("{name}", entry.name) }));
  const all: BookPage[] = [...Object.values(chapters).flat(), ...passengers];
  return { chapters, passengers, total: all.length, remaining: all.filter((page) => page.state !== "blank").length };
}

type Row = { id: string; data: Record<string, unknown> };

/** Book inputs from raw documents, so the dealer's app and the price recorder compute the same thing. */
export function bookInputFrom(raw: { districts: Row[]; clues: Row[]; funds: Row[]; fronts: Row[]; players: Row[]; wallets: Row[]; titles: Record<string, unknown> | null }): BookInput {
  const wallets = new Map(raw.wallets.map((row) => [row.id, row.data]));
  const fronts: Partial<Record<FrontDistrict, number>> = {};
  for (const row of raw.fronts) if ((FRONT_DISTRICTS as readonly string[]).includes(row.id)) fronts[row.id as FrontDistrict] = Number(row.data.step) || 0;
  const titles = raw.titles && typeof raw.titles.chapters === "object" && raw.titles.chapters
    ? { chapters: raw.titles.chapters as BookTitles["chapters"], passenger: String(raw.titles.passenger ?? "") } : null;
  return {
    liberated: new Set(raw.districts.filter((row) => row.data.liberated === true).map((row) => row.id)),
    collateral: new Set(raw.clues.filter((row) => row.data.kind === "collateral" && row.data.found === true && typeof row.data.district === "string").map((row) => row.data.district as string)),
    funded: new Set(raw.funds.filter((row) => typeof row.data.book === "string" && Number(row.data.current) >= Number(row.data.goal) && Number(row.data.goal) > 0).map((row) => row.data.book as string)),
    fronts,
    passengers: raw.players.filter((row) => wallets.get(row.id)?.arrived === true)
      .map((row) => ({ pid: row.id, name: String(row.data.name ?? row.id), debt: Number(wallets.get(row.id)?.debt) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    titles,
  };
}
