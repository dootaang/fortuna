import { addDoc, deleteDoc, doc, getDoc, getDocs, increment, query, runTransaction, serverTimestamp, setDoc, where, writeBatch, type Timestamp } from "firebase/firestore";
import {
  DEFAULT_ECONOMY, DEFAULT_NOTIFY, DISTRICTS, accessCodeHash, emptyWallet, finalizeEconomy, generateAccessCode, normalizeEconomy, normalizeNotify,
  type EconomyConfig, type NotifyConfig,
} from "@fortuna/core";
import { FortunaError, writeEntry, type Session } from "./ledger-write.ts";
import { readWallet } from "./player-ops.ts";
import { refs, type EventKind, type FundDoc, type PlayerDoc, type ShopItemDoc, type SkillDoc } from "./refs.ts";

const DEFAULT_DEDUCTION_BPS = 5_000;

/**
 * A config saved by an older version lacks newer keys (limitPeriod, limits, pvp, shopEnabled).
 * Values the dealer set are kept; only missing fields are filled with defaults.
 */
export function economyNeedsUpgrade(stored: unknown): boolean {
  const raw = (stored ?? {}) as Record<string, any>;
  return raw.limitPeriod === undefined || raw.shopEnabled === undefined || raw.pvp === undefined || raw.work?.limit === undefined || raw.gambling?.limit === undefined;
}

async function adminEvent(session: Session, kind: EventKind, payload: Record<string, string | number | boolean>): Promise<string> {
  const ref = await addDoc(refs.events(session.db), { kind, ledgerId: null, playerId: null, actorUid: session.uid, at: serverTimestamp() as unknown as Timestamp, sentAt: null, payload });
  return ref.id;
}

async function log(session: Session, kind: string, target: string, amount: number, memo: string) {
  await addDoc(refs.adminLog(session.db), { kind, target, amount, memo, actorUid: session.uid, at: serverTimestamp() as unknown as Timestamp });
}

/** Create whatever the city still lacks: settings, districts, vault, joint treasury. Safe to run repeatedly. */
export async function bootstrapCity(session: Session, options: { pvpDeals?: boolean } = {}): Promise<string[]> {
  const { db } = session, created: string[] = [], batch = writeBatch(db);
  const stored = (await getDoc(refs.config(db))).data();
  if (!stored) { batch.set(refs.config(db), finalizeEconomy(DEFAULT_ECONOMY)); created.push("경제 설정"); }
  else if (economyNeedsUpgrade(stored)) { batch.set(refs.config(db), finalizeEconomy(normalizeEconomy(stored))); created.push("경제 설정 갱신"); }
  if (!(await getDoc(refs.notify(db))).exists()) { batch.set(refs.notify(db), DEFAULT_NOTIFY); created.push("알림 설정"); }
  for (const district of DISTRICTS) {
    if (!(await getDoc(refs.district(db, district.id))).exists()) { batch.set(refs.district(db, district.id), { liberated: false, deductionBps: DEFAULT_DEDUCTION_BPS }); created.push(`구역 ${district.name}`); }
  }
  const economy = (await getDoc(refs.config(db))).data() as EconomyConfig | undefined;
  if (!(await getDoc(refs.vault(db))).exists()) { batch.set(refs.vault(db), { amount: economy?.vaultInitial ?? DEFAULT_ECONOMY.vaultInitial, lastLedger: "" }); created.push("지배인 금고"); }
  if (!(await getDoc(refs.treasury(db))).exists()) { batch.set(refs.treasury(db), { amount: 0, lastLedger: "" }); created.push("공동 지갑"); }
  if (created.length) await batch.commit();
  if (options.pvpDeals !== false) {
    const { ensurePvpDeals } = await import("./pvp-ops.ts");
    if (await ensurePvpDeals(session)) created.push("대결 배분표");
  }
  return created;
}

export interface PlayerInput { name: string; districtId: string; skills: { id: string; name: string; level: number }[]; note: string; }

function skillMap(skills: PlayerInput["skills"]): Record<string, SkillDoc> {
  const map: Record<string, SkillDoc> = {};
  for (const skill of skills) {
    const name = skill.name.trim();
    if (!name) continue;
    if (!Number.isInteger(skill.level) || skill.level < 1 || skill.level > 20) throw new FortunaError("skill-level", `특기 "${name}"의 점수를 확인해 주십시오.`);
    map[skill.id || name] = { name, level: skill.level };
  }
  return map;
}

export async function createPlayer(session: Session, input: PlayerInput): Promise<{ pid: string; code: string }> {
  const { db } = session, ref = doc(refs.players(db)), pid = ref.id, code = generateAccessCode(), hash = accessCodeHash(code);
  if (!input.name.trim()) throw new FortunaError("name", "캐릭터 이름을 입력해 주십시오.");
  const batch = writeBatch(db);
  batch.set(refs.player(db, pid), { name: input.name.trim(), districtId: input.districtId, codeVersion: 1, codeHash: hash, skills: skillMap(input.skills), note: input.note, createdAt: serverTimestamp() as unknown as Timestamp });
  batch.set(refs.wallet(db, pid), emptyWallet(pid));
  batch.set(refs.accessCode(db, hash), { playerId: pid, version: 1 });
  batch.set(refs.playerSecret(db, pid), { code });
  await batch.commit();
  return { pid, code };
}

/** New code; every device bound to the old one is cut off because codeVersion moves on. */
export async function reissueCode(session: Session, pid: string): Promise<string> {
  const { db } = session, player = (await getDoc(refs.player(db, pid))).data();
  if (!player) throw new FortunaError("no-player", "플레이어가 없습니다.");
  const code = generateAccessCode(), hash = accessCodeHash(code), version = player.codeVersion + 1;
  const batch = writeBatch(db);
  batch.delete(refs.accessCode(db, player.codeHash));
  batch.set(refs.accessCode(db, hash), { playerId: pid, version });
  batch.update(refs.player(db, pid), { codeVersion: version, codeHash: hash });
  batch.set(refs.playerSecret(db, pid), { code });
  await batch.commit();
  const stale = await getDocs(query(refs.bindings(db), where("playerId", "==", pid)));
  await Promise.all(stale.docs.map((binding) => deleteDoc(binding.ref)));
  return code;
}

export async function updatePlayer(session: Session, pid: string, input: PlayerInput): Promise<void> {
  if (!input.name.trim()) throw new FortunaError("name", "캐릭터 이름을 입력해 주십시오.");
  await setDoc(refs.player(session.db, pid), { name: input.name.trim(), districtId: input.districtId, skills: skillMap(input.skills), note: input.note } as Partial<PlayerDoc>, { merge: true });
}

export interface Adjustment { delta: number; debtDelta: number; memo: string; closeWager?: boolean; resetArrival?: boolean; source?: string; }

export async function adjustWallet(session: Session, pid: string, adjustment: Adjustment): Promise<string> {
  const memo = adjustment.memo.trim();
  if (!memo) throw new FortunaError("memo", "사유 메모를 꼭 적어 주십시오.");
  if (!Number.isInteger(adjustment.delta) || !Number.isInteger(adjustment.debtDelta)) throw new FortunaError("amount", "금액은 정수로 입력해 주십시오.");
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, { ...session, pid });
    const extra: Record<string, unknown> = {};
    if (adjustment.closeWager) extra.openWager = null;
    if (adjustment.resetArrival) extra.arrived = false;
    return writeEntry(tx, session, pid, wallet, {
      type: "adminAdjust", actor: "admin", memo, delta: adjustment.delta, debtDelta: adjustment.debtDelta,
      detail: { reason: memo, source: adjustment.source ?? "manual" }, wallet: extra,
    });
  });
}

export async function adminUseItem(session: Session, pid: string, itemId: string, memo: string): Promise<string> {
  if (!memo.trim()) throw new FortunaError("memo", "사유 메모를 꼭 적어 주십시오.");
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, { ...session, pid });
    const inventoryRef = refs.inventory(session.db, pid, itemId), owned = (await tx.get(inventoryRef)).data();
    if (!owned || owned.quantity < 1) throw new FortunaError("no-item", "남은 물품이 없습니다.");
    const ledgerId = writeEntry(tx, session, pid, wallet, { type: "itemUse", actor: "admin", memo: memo.trim(), delta: 0, detail: { itemId, itemName: owned.itemName } });
    tx.update(inventoryRef, { quantity: owned.quantity - 1, used: owned.used + 1, lastLedger: ledgerId });
    return ledgerId;
  });
}

/** Returns the id of a "house opened" event to relay, if this save opened the house. */
export async function saveEconomy(session: Session, config: EconomyConfig, previous: EconomyConfig | null): Promise<string | null> {
  const finalized = finalizeEconomy(config);
  await setDoc(refs.config(session.db), finalized);
  return previous && !previous.gambling.houseOpen && finalized.gambling.houseOpen ? adminEvent(session, "houseOpen", {}) : null;
}

export async function saveNotify(session: Session, config: NotifyConfig): Promise<void> {
  await setDoc(refs.notify(session.db), normalizeNotify(config));
}

/** Returns the id of a liberation event to relay, if this change liberated the district. */
export async function setDistrict(session: Session, id: string, next: { liberated: boolean; deductionBps: number }, memo: string): Promise<string | null> {
  const ref = refs.district(session.db, id), before = (await getDoc(ref)).data();
  if (!Number.isInteger(next.deductionBps) || next.deductionBps < 0 || next.deductionBps > 10_000) throw new FortunaError("bps", "공제율은 0~100% 사이여야 합니다.");
  await setDoc(ref, next);
  await log(session, next.liberated && !before?.liberated ? "liberate" : "district", id, next.deductionBps, memo);
  return next.liberated && !before?.liberated ? adminEvent(session, "liberation", { districtId: id }) : null;
}

export async function adjustVault(session: Session, delta: number, memo: string): Promise<void> {
  if (!memo.trim()) throw new FortunaError("memo", "사유 메모를 꼭 적어 주십시오.");
  if (!Number.isInteger(delta) || delta === 0) throw new FortunaError("amount", "조정 금액을 확인해 주십시오.");
  await setDoc(refs.vault(session.db), { amount: increment(delta) as unknown as number, lastLedger: "" }, { merge: true });
  await log(session, "vault", "vault/main", delta, memo.trim());
}

/** Take coins out of the joint treasury; optionally hand them to a player. */
export async function withdrawJoint(session: Session, amount: number, memo: string, toPid: string | null): Promise<void> {
  const note = memo.trim();
  if (!note) throw new FortunaError("memo", "사유 메모를 꼭 적어 주십시오.");
  if (!Number.isInteger(amount) || amount <= 0) throw new FortunaError("amount", "금액을 확인해 주십시오.");
  await runTransaction(session.db, async (tx) => {
    const treasury = (await tx.get(refs.treasury(session.db))).data();
    if (!treasury || treasury.amount < amount) throw new FortunaError("insufficient", "공동 지갑 잔액이 부족합니다.");
    const wallet = toPid ? await readWallet(tx, { ...session, pid: toPid }) : null;
    tx.update(refs.treasury(session.db), { amount: treasury.amount - amount, lastLedger: "" });
    if (toPid && wallet) writeEntry(tx, session, toPid, wallet, { type: "adminAdjust", actor: "admin", memo: note, delta: amount, detail: { reason: note, source: "joint" } });
  });
  await log(session, "joint", toPid ?? "소멸", -amount, note);
}

export type ItemInput = Omit<ShopItemDoc, "lastLedger">;

export async function saveItem(session: Session, itemId: string | null, input: ItemInput, secretText: string | null): Promise<string> {
  if (!input.name.trim()) throw new FortunaError("name", "품목 이름을 입력해 주십시오.");
  if (!Number.isInteger(input.price) || input.price < 0) throw new FortunaError("price", "가격을 확인해 주십시오.");
  const ref = itemId ? refs.item(session.db, itemId) : doc(refs.items(session.db));
  const existing = itemId ? (await getDoc(ref)).data() : undefined;
  await setDoc(ref, { ...input, hasSecret: secretText !== null ? secretText.trim().length > 0 : input.hasSecret, lastLedger: existing?.lastLedger ?? "" });
  if (secretText !== null) await setDoc(refs.secret(session.db, ref.id), { text: secretText });
  return ref.id;
}

export async function deleteItem(session: Session, itemId: string): Promise<void> {
  await deleteDoc(refs.secret(session.db, itemId));
  await deleteDoc(refs.item(session.db, itemId));
}

export type FundInput = Omit<FundDoc, "lastLedger" | "current"> & { current?: number };

export async function saveFund(session: Session, fundId: string | null, input: FundInput): Promise<string> {
  if (!input.title.trim()) throw new FortunaError("title", "모금함 이름을 입력해 주십시오.");
  if (!Number.isInteger(input.goal) || input.goal <= 0) throw new FortunaError("goal", "목표 금액을 확인해 주십시오.");
  const ref = fundId ? refs.fund(session.db, fundId) : doc(refs.funds(session.db));
  const existing = fundId ? (await getDoc(ref)).data() : undefined;
  await setDoc(ref, { ...input, current: input.current ?? existing?.current ?? 0, lastLedger: existing?.lastLedger ?? "" });
  return ref.id;
}

export async function deleteFund(session: Session, fundId: string): Promise<void> { await deleteDoc(refs.fund(session.db, fundId)); }

/** Mark an admin-authored event as needing relay (used for manual announcements). */
export async function announce(session: Session, kind: EventKind, payload: Record<string, string | number | boolean>): Promise<string> { return adminEvent(session, kind, payload); }

/** Ask the notifier Worker to post one event. Never throws: notifications are best-effort. */
export async function relayEvent(relayUrl: string, idToken: string, eventId: string): Promise<string> {
  if (!relayUrl) return "no-relay";
  try {
    const response = await fetch(relayUrl, { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ eventId }) });
    return ((await response.json()) as { status?: string; error?: string }).status ?? "error";
  } catch { return "unreachable"; }
}

