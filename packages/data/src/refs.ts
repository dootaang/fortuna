import { collection, doc, type CollectionReference, type DocumentReference, type Firestore, type Timestamp } from "firebase/firestore";
import type { CoinId, FeedTone, HourDoc, LedgerEntry, NewsSize, Side, Wallet } from "@fortuna/core";

export interface SkillDoc { name: string; level: number; }

export interface PlayerDoc {
  name: string;
  districtId: string;
  codeVersion: number;
  codeHash: string;
  /** skillId → skill. A map so firestore.rules can look a skill up by id. */
  skills: Record<string, SkillDoc>;
  note: string;
  createdAt: Timestamp;
}

export interface DistrictDoc { liberated: boolean; deductionBps: number; }
export interface BindingDoc { playerId: string; codeHash: string; version: number; boundAt: Timestamp; }
export interface AccessCodeDoc { playerId: string; version: number; }
export interface PlayerSecretDoc { code: string; }
export interface PoolDoc { amount: number; lastLedger: string; }

export const SHOP_CATEGORIES = ["rumor", "consumable", "challenge", "skillPoint", "misc"] as const;
export type ShopCategory = (typeof SHOP_CATEGORIES)[number];
export const SHOP_CATEGORY_LABELS: Readonly<Record<ShopCategory, string>> = {
  rumor: "소문", consumable: "소모품", challenge: "도전권", skillPoint: "특기 포인트", misc: "꾸미기·잡화",
};

export interface ShopItemDoc {
  name: string;
  description: string;
  price: number;
  category: ShopCategory;
  /** null = unlimited. */
  stock: number | null;
  /** null = no per-player limit. */
  perPlayerLimit: number | null;
  visible: boolean;
  consumable: boolean;
  hasSecret: boolean;
  /** Shown to the admin only: when to reveal this item. */
  revealNote: string;
  sortOrder: number;
  lastLedger: string;
}
export interface SecretDoc { text: string; }

export interface FundDoc {
  title: string;
  description: string;
  goal: number;
  current: number;
  status: "open" | "filled" | "closed";
  visible: boolean;
  sortOrder: number;
  lastLedger: string;
  /** District whose residents' debt this fund pays off (a ledger page turns blank when it is full). */
  book?: string | null;
}

export interface InventoryDoc {
  playerId: string;
  itemId: string;
  itemName: string;
  category: ShopCategory;
  consumable: boolean;
  purchased: number;
  quantity: number;
  used: number;
  lastLedger: string;
}

export const EVENT_KINDS = ["arrival", "bigGamble", "skill", "shop", "fundFilled", "liberation", "repaid", "houseOpen", "pvpOpen", "pvpWin", "marketWin", "marketLoss"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export interface EventDoc {
  kind: EventKind;
  ledgerId: string | null;
  playerId: string | null;
  actorUid: string;
  at: Timestamp;
  sentAt: Timestamp | null;
  /** Admin-authored events carry their text here; player events are rendered from the ledger entry. */
  payload: Record<string, string | number | boolean>;
}

/** positions/{ledgerId of marketOpen}. */
export interface PositionDoc {
  playerId: string;
  coin: CoinId;
  side: Side;
  leverage: number;
  margin: number;
  fee: number;
  entry: number;
  entrySeq: number;
  openedAt: Timestamp;
  liq: number;
  /** 0 = no take-profit cap (a short that could never reach it). */
  cap: number;
  /** open → (liquidated | capped by the price recorder, void by the dealer) → closed by the player's settlement. */
  status: "open" | "liquidated" | "capped" | "void" | "closed";
  exit: number | null;
  exitSeq: number | null;
  exitAt: Timestamp | null;
  outcome: "close" | "cap" | "liquidated" | "refund" | null;
  payout: number | null;
  lastLedger: string;
  /** 5단계 펀딩: index (ppm) at entry, and at the tick the recorder ended it. Missing on older positions. */
  F0?: number | null;
  exitF?: number | null;
}

/** holdings/{pid}_{coin}: spot coins owned, in 1/10,000 units, and the coins paid for them. */
export interface HoldingDoc { playerId: string; coin: CoinId; units: number; cost: number; lastLedger: string; }

/** marketFeed/{seq_i}: lines under the board, written by the price recorder. */
export interface FeedDoc { kind: string; coin: CoinId | null; tone: FeedTone; text: string; seq: number; at: Timestamp; }

/** marketNews/{id}: dealer drafts the recorder publishes at publishAt (whisper first, if any). */
export interface NewsDoc {
  coin: CoinId;
  dir: 1 | -1 | 0;
  size: NewsSize;
  minutes: number;
  headline: string;
  whisper: string;
  whisperAt: Timestamp | null;
  publishAt: Timestamp;
  status: "pending" | "published" | "cancelled";
  whispered: boolean;
  publishedSeq: number | null;
  createdAt: Timestamp;
}

export interface AdminLogDoc { kind: string; target: string; amount: number; memo: string; actorUid: string; at: Timestamp; }

const typed = <T>(ref: DocumentReference) => ref as DocumentReference<T>;
const typedCollection = <T>(ref: CollectionReference) => ref as CollectionReference<T>;

export const refs = {
  admin: (db: Firestore, uid: string) => doc(db, "admins", uid),
  config: (db: Firestore) => doc(db, "config", "economy"),
  notify: (db: Firestore) => doc(db, "config", "notify"),
  district: (db: Firestore, id: string) => typed<DistrictDoc>(doc(db, "districts", id)),
  districts: (db: Firestore) => typedCollection<DistrictDoc>(collection(db, "districts")),
  accessCode: (db: Firestore, hash: string) => typed<AccessCodeDoc>(doc(db, "accessCodes", hash)),
  binding: (db: Firestore, uid: string) => typed<BindingDoc>(doc(db, "bindings", uid)),
  bindings: (db: Firestore) => typedCollection<BindingDoc>(collection(db, "bindings")),
  player: (db: Firestore, pid: string) => typed<PlayerDoc>(doc(db, "players", pid)),
  players: (db: Firestore) => typedCollection<PlayerDoc>(collection(db, "players")),
  playerSecret: (db: Firestore, pid: string) => typed<PlayerSecretDoc>(doc(db, "playerSecrets", pid)),
  wallet: (db: Firestore, pid: string) => typed<Wallet<Timestamp>>(doc(db, "wallets", pid)),
  wallets: (db: Firestore) => typedCollection<Wallet<Timestamp>>(collection(db, "wallets")),
  ledger: (db: Firestore, id: string) => typed<LedgerEntry<Timestamp>>(doc(db, "ledger", id)),
  ledgers: (db: Firestore) => typedCollection<LedgerEntry<Timestamp>>(collection(db, "ledger")),
  vault: (db: Firestore) => typed<PoolDoc>(doc(db, "vault", "main")),
  treasury: (db: Firestore) => typed<PoolDoc>(doc(db, "treasury", "joint")),
  fund: (db: Firestore, id: string) => typed<FundDoc>(doc(db, "funds", id)),
  funds: (db: Firestore) => typedCollection<FundDoc>(collection(db, "funds")),
  item: (db: Firestore, id: string) => typed<ShopItemDoc>(doc(db, "shopItems", id)),
  items: (db: Firestore) => typedCollection<ShopItemDoc>(collection(db, "shopItems")),
  secret: (db: Firestore, itemId: string) => typed<SecretDoc>(doc(db, "shopItems", itemId, "secret", "body")),
  inventory: (db: Firestore, pid: string, itemId: string) => typed<InventoryDoc>(doc(db, "inventory", `${pid}_${itemId}`)),
  inventories: (db: Firestore) => typedCollection<InventoryDoc>(collection(db, "inventory")),
  event: (db: Firestore, id: string) => typed<EventDoc>(doc(db, "events", id)),
  events: (db: Firestore) => typedCollection<EventDoc>(collection(db, "events")),
  adminLog: (db: Firestore) => typedCollection<AdminLogDoc>(collection(db, "adminLog")),
  clock: (db: Firestore, uid: string) => doc(db, "clocks", uid),
  marketConfig: (db: Firestore) => doc(db, "config", "market"),
  marketHour: (db: Firestore, hour: number) => typed<HourDoc<Timestamp>>(doc(db, "market", `h${hour}`)),
  marketFeed: (db: Firestore) => typedCollection<FeedDoc>(collection(db, "marketFeed")),
  news: (db: Firestore, id: string) => typed<NewsDoc>(doc(db, "marketNews", id)),
  newsList: (db: Firestore) => typedCollection<NewsDoc>(collection(db, "marketNews")),
  position: (db: Firestore, id: string) => typed<PositionDoc>(doc(db, "positions", id)),
  positions: (db: Firestore) => typedCollection<PositionDoc>(collection(db, "positions")),
  oracle: (db: Firestore, uid: string) => doc(db, "oracles", uid),
  holding: (db: Firestore, pid: string, coin: CoinId) => typed<HoldingDoc>(doc(db, "holdings", `${pid}_${coin}`)),
  holdings: (db: Firestore) => typedCollection<HoldingDoc>(collection(db, "holdings")),
  oracles: (db: Firestore) => collection(db, "oracles"),
};
