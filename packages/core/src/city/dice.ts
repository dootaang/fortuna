import { XorShift32, fnv1a32 } from "../rng.ts";

// ── 봉인된 주사위 ── 결과는 메시지 id와 서버 시각에서만 정해진다(도박판과 같은 봉인 방식).

export interface DiceExpr { count: number; sides: number; bonus: number; }

export function parseDice(text: string): DiceExpr | null {
  const match = /^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/i.exec(text.trim());
  if (!match) return null;
  const count = Number(match[1]), sides = Number(match[2]), bonus = Number(match[3] ?? 0);
  if (count < 1 || count > 20 || sides < 2 || sides > 100) return null;
  return { count, sides, bonus };
}

export function rollDice(expr: DiceExpr, messageId: string, serverMs: number): { faces: number[]; total: number } {
  const rng = new XorShift32(fnv1a32(`dice:${messageId}:${serverMs}`));
  const faces = Array.from({ length: expr.count }, () => rng.die(expr.sides));
  return { faces, total: faces.reduce((sum, face) => sum + face, 0) + expr.bonus };
}

export function diceText(expr: DiceExpr): string { return `${expr.count}d${expr.sides}${expr.bonus ? (expr.bonus > 0 ? `+${expr.bonus}` : `${expr.bonus}`) : ""}`; }
