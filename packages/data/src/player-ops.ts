import { getDoc, increment, runTransaction, serverTimestamp, setDoc, type Firestore, type Timestamp, type Transaction } from "firebase/firestore";
import {
  GAMES, accessCodeHash, arrivalSlip, borrowDebt, bumpCounters, normalizeEconomy, replayWager, skillCost, wageFor, wageSlip, wagerTrace,
  type GameId, type Venue, type Wallet, type WorkTemplate,
} from "@fortuna/core";
import { FortunaError, writeEntry, type Clock, type PlayerSession, type Session } from "./ledger-write.ts";
import { refs } from "./refs.ts";

/** Measure server time once so weekly counters match firestore.rules even on a skewed device clock. */
export async function syncClock(db: Firestore, uid: string, clock: Clock): Promise<void> {
  const ref = refs.clock(db, uid), sentAt = Date.now();
  await setDoc(ref, { t: serverTimestamp() });
  const snapshot = await getDoc(ref), receivedAt = Date.now();
  const server = (snapshot.data()?.t as Timestamp | undefined)?.toMillis();
  if (server !== undefined) clock.offsetMs = server - (sentAt + receivedAt) / 2;
}

/** Link this browser (anonymous uid) to the character behind an access code. */
export async function bindAccessCode(session: Session, code: string): Promise<string> {
  const hash = accessCodeHash(code);
  const access = await getDoc(refs.accessCode(session.db, hash));
  if (!access.exists()) throw new FortunaError("invalid-code", "그런 승차권은 이 역에 등록되어 있지 않군요. 번호를 다시 확인해 주시겠습니까?");
  const { playerId, version } = access.data();
  await setDoc(refs.binding(session.db, session.uid), { playerId, codeHash: hash, version, boundAt: serverTimestamp() as unknown as Timestamp });
  return playerId;
}

export async function readWallet(tx: Transaction, session: PlayerSession): Promise<Wallet<Timestamp>> {
  const snapshot = await tx.get(refs.wallet(session.db, session.pid));
  if (!snapshot.exists()) throw new FortunaError("no-wallet", "지갑이 아직 준비되지 않았습니다. 딜러에게 문의하십시오.");
  return snapshot.data();
}

export async function readEconomy(tx: Transaction, db: Firestore) {
  const snapshot = await tx.get(refs.config(db));
  if (!snapshot.exists()) throw new FortunaError("no-config", "도시가 아직 문을 열지 않았습니다. 딜러가 초기 설정을 마쳐야 합니다.");
  return normalizeEconomy(snapshot.data());
}

function requireArrived(wallet: Wallet<Timestamp>) {
  if (!wallet.arrived) throw new FortunaError("not-arrived", "먼저 개찰구를 통과하셔야 합니다.");
}

export async function arrive(session: PlayerSession): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), config = await readEconomy(tx, session.db);
    if (wallet.arrived) throw new FortunaError("already-arrived", "이미 도착하셨습니다.");
    const slip = arrivalSlip(config.welcome);
    return writeEntry(tx, session, session.pid, wallet, {
      type: "arrival", actor: "player", ...slip,
      detail: { loan: config.welcome.loan, gateFee: config.welcome.gateFee, debt: config.welcome.debt },
      wallet: { arrived: true }, event: { kind: "arrival" },
    });
  });
}

export interface WorkResult { ledgerId: string; gross: number; deduction: number; net: number; deductionBps: number; }

export async function submitWork(session: PlayerSession, template: WorkTemplate, performance: number): Promise<WorkResult> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), config = await readEconomy(tx, session.db);
    requireArrived(wallet);
    const player = (await tx.get(refs.player(session.db, session.pid))).data();
    if (!player) throw new FortunaError("no-player", "등록되지 않은 승객입니다.");
    const district = (await tx.get(refs.district(session.db, player.districtId))).data();
    if (!district) throw new FortunaError("no-district", "소속 구역 정보가 없습니다. 딜러에게 문의하십시오.");
    const week = session.clock.week(), counters = bumpCounters(wallet, "work", week);
    if (counters.workUsed > config.work.weeklyLimit) throw new FortunaError("work-limit", "이번 주 일거리는 모두 끝났습니다.");
    const rounded = Math.round(performance * 1000) / 1000;
    const slip = wageSlip(wageFor(rounded, config.work), district);
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "work", actor: "player", delta: slip.net, vaultDelta: slip.deduction,
      detail: { template, performance: rounded, districtId: player.districtId, ...slip },
      wallet: { ...counters },
    });
    return { ledgerId, ...slip };
  });
}

export async function openBet(session: PlayerSession, game: GameId, venue: Venue, bet: number): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), config = await readEconomy(tx, session.db);
    requireArrived(wallet);
    if (wallet.openWager) throw new FortunaError("wager-open", "진행 중인 판이 있습니다. 하던 판부터 마저 하시지요.");
    if (venue === "house" && !config.gambling.houseOpen) throw new FortunaError("house-closed", "하우스는 아직 문을 열지 않았습니다.");
    const table = config.gambling.games[game][venue];
    if (!table.enabled) throw new FortunaError("table-closed", "이 테이블은 지금 닫혀 있습니다.");
    const maxBet = venue === "house" ? config.gambling.houseMaxBet : config.gambling.alleyMaxBet;
    if (!Number.isInteger(bet) || bet < config.gambling.minBet || bet > maxBet) throw new FortunaError("bet-range", `판돈은 ${config.gambling.minBet}~${maxBet}코인 사이로 정해 주십시오.`);
    const counters = bumpCounters(wallet, "gamble", session.clock.week());
    if (counters.gambleUsed > config.gambling.weeklyLimit) throw new FortunaError("gamble-limit", "이번 주에는 충분히 즐기셨군요.");
    const wagerId = `${session.pid}_${wallet.seq + 1}`;
    return writeEntry(tx, session, session.pid, wallet, {
      type: "betOpen", actor: "player", delta: -bet, vaultDelta: venue === "house" ? bet : 0,
      detail: { game, venue, bet },
      wallet: {
        ...counters,
        openWager: { wagerId, game, venue, bet, maxMultiplier: table.maxMultiplier, params: table.params, openedAt: serverTimestamp(), stepCount: 0, steps: {} },
      },
    });
  });
}

/** Commit one decision; the randomness that resolves it is derived from this write's server time. */
export async function sealStep(session: PlayerSession, action: string): Promise<void> {
  await runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), wager = wallet.openWager;
    if (!wager) throw new FortunaError("no-wager", "진행 중인 판이 없습니다.");
    const game = GAMES[wager.game], state = replayWager(game, wager.bet, wager.params, wagerTrace(wager));
    if (game.isDone(state) || !game.canApply(state, action)) throw new FortunaError("illegal-action", "지금은 그렇게 할 수 없습니다.");
    const step = wager.stepCount + 1;
    tx.update(refs.wallet(session.db, session.pid), { "openWager.stepCount": step, [`openWager.steps.${step}`]: { a: action, t: serverTimestamp() } });
  });
}

export interface SettleResult { ledgerId: string; payout: number; bet: number; }

/** Close the open wager with the payout its sealed replay produces. */
export async function settleBet(session: PlayerSession, summary: (state: unknown) => string, bigGamble = Number.POSITIVE_INFINITY): Promise<SettleResult> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), wager = wallet.openWager;
    if (!wager) throw new FortunaError("no-wager", "진행 중인 판이 없습니다.");
    const game = GAMES[wager.game], state = replayWager(game, wager.bet, wager.params, wagerTrace(wager));
    if (!game.isDone(state)) throw new FortunaError("wager-unfinished", "아직 판이 끝나지 않았습니다.");
    const payout = game.payout(state) as number, net = payout - wager.bet;
    const big = wager.venue === "house" && Math.abs(net) >= bigGamble;
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "betSettle", actor: "player", delta: payout, vaultDelta: wager.venue === "house" ? -payout : 0,
      detail: {
        wagerId: wager.wagerId, game: wager.game, venue: wager.venue, bet: wager.bet, params: wager.params, payout,
        openedAt: wager.openedAt, stepCount: wager.stepCount, steps: wager.steps, summary: summary(state).slice(0, 200),
      },
      wallet: { openWager: null },
      ...(big ? { event: { kind: "bigGamble" as const } } : {}),
    });
    return { ledgerId, payout, bet: wager.bet };
  });
}

export interface SkillPayment { skillId: string; usedLevel: number; note: string; borrow: boolean; }

export async function paySkill(session: PlayerSession, payment: SkillPayment): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), config = await readEconomy(tx, session.db);
    requireArrived(wallet);
    const skill = (await tx.get(refs.player(session.db, session.pid))).data()?.skills[payment.skillId];
    if (!skill) throw new FortunaError("no-skill", "등록되지 않은 특기입니다.");
    const cost = skillCost(skill.level, payment.usedLevel, config.skill.cumulative);
    let borrowed = 0;
    if (wallet.balance < cost) {
      if (!payment.borrow || !config.borrow.enabled) throw new FortunaError("insufficient", "잔액이 부족합니다.");
      borrowed = cost - wallet.balance;
    }
    return writeEntry(tx, session, session.pid, wallet, {
      type: "skill", actor: "player", delta: borrowed - cost, debtDelta: borrowDebt(borrowed, config.borrow.feeBps),
      detail: { skillId: payment.skillId, skillName: skill.name, baseLevel: skill.level, usedLevel: payment.usedLevel, cost, borrowed, note: payment.note.slice(0, 200) },
      event: { kind: "skill" },
    });
  });
}

export async function repayDebt(session: PlayerSession, amount: number): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session);
    requireArrived(wallet);
    if (!Number.isInteger(amount) || amount <= 0) throw new FortunaError("amount", "상환 금액을 확인해 주십시오.");
    if (amount > wallet.debt) throw new FortunaError("debt-negative", "빚보다 많이 갚을 수는 없습니다.");
    return writeEntry(tx, session, session.pid, wallet, {
      type: "repay", actor: "player", delta: -amount, debtDelta: -amount, vaultDelta: amount, detail: { amount },
      ...(amount === wallet.debt ? { event: { kind: "repaid" as const } } : {}),
    });
  });
}

export async function depositJoint(session: PlayerSession, amount: number): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session);
    requireArrived(wallet);
    if (!Number.isInteger(amount) || amount <= 0) throw new FortunaError("amount", "금액을 확인해 주십시오.");
    const id = writeEntry(tx, session, session.pid, wallet, { type: "jointDeposit", actor: "player", delta: -amount, detail: { amount } });
    tx.update(refs.treasury(session.db), { amount: increment(amount), lastLedger: id });
    return id;
  });
}

export async function contributeFund(session: PlayerSession, fundId: string, amount: number): Promise<{ ledgerId: string; filled: boolean }> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session);
    requireArrived(wallet);
    const fund = (await tx.get(refs.fund(session.db, fundId))).data();
    if (!fund || fund.status !== "open" || !fund.visible) throw new FortunaError("fund-closed", "이 모금함은 닫혀 있습니다.");
    const room = fund.goal - fund.current;
    if (!Number.isInteger(amount) || amount <= 0) throw new FortunaError("amount", "금액을 확인해 주십시오.");
    if (amount > room) throw new FortunaError("fund-overflow", `남은 금액은 ${room.toLocaleString("ko-KR")}코인입니다.`);
    const filled = amount === room;
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "fundContribution", actor: "player", delta: -amount, detail: { fundId, title: fund.title, amount, filled },
      ...(filled ? { event: { kind: "fundFilled" as const } } : {}),
    });
    tx.update(refs.fund(session.db, fundId), { current: fund.current + amount, status: filled ? "filled" : "open", lastLedger: ledgerId });
    return { ledgerId, filled };
  });
}

export async function buyItem(session: PlayerSession, itemId: string, quantity = 1): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session);
    requireArrived(wallet);
    const item = (await tx.get(refs.item(session.db, itemId))).data();
    if (!item || !item.visible) throw new FortunaError("no-item", "지금은 살 수 없는 물건입니다.");
    const inventoryRef = refs.inventory(session.db, session.pid, itemId), owned = (await tx.get(inventoryRef)).data();
    if (item.stock !== null && item.stock < quantity) throw new FortunaError("sold-out", "품절되었습니다.");
    const purchased = (owned?.purchased ?? 0) + quantity;
    if (item.perPlayerLimit !== null && purchased > item.perPlayerLimit) throw new FortunaError("limit", "구매 한도에 도달했습니다.");
    const total = item.price * quantity;
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "shop", actor: "player", delta: -total,
      detail: { itemId, itemName: item.name, category: item.category, quantity, unitPrice: item.price, total },
      event: { kind: "shop" },
    });
    tx.set(inventoryRef, {
      playerId: session.pid, itemId, itemName: item.name, category: item.category, consumable: item.consumable,
      purchased, quantity: (owned?.quantity ?? 0) + quantity, used: owned?.used ?? 0, lastLedger: ledgerId,
    });
    if (item.stock !== null) tx.update(refs.item(session.db, itemId), { stock: item.stock - quantity, lastLedger: ledgerId });
    return ledgerId;
  });
}

/** Mark one consumable as used. Players use their own; the admin may mark any item via `adminUseItem`. */
export async function useItem(session: PlayerSession, itemId: string): Promise<string> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session);
    const inventoryRef = refs.inventory(session.db, session.pid, itemId), owned = (await tx.get(inventoryRef)).data();
    if (!owned || owned.quantity < 1) throw new FortunaError("no-item", "남은 물품이 없습니다.");
    if (!owned.consumable) throw new FortunaError("not-consumable", "사용할 수 있는 물품이 아닙니다.");
    const ledgerId = writeEntry(tx, session, session.pid, wallet, { type: "itemUse", actor: "player", delta: 0, detail: { itemId, itemName: owned.itemName } });
    tx.update(inventoryRef, { quantity: owned.quantity - 1, used: owned.used + 1, lastLedger: ledgerId });
    return ledgerId;
  });
}

