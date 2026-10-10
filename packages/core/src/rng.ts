// Ported from lucky-arcade packages/engine/src/random.ts (GPL-3.0-or-later).
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class XorShift32 {
  #state: number;
  #position = 0;
  constructor(seed: number | string) { const initial = typeof seed === "string" ? fnv1a32(seed) : seed >>> 0; this.#state = initial || 0x6d2b79f5; }
  get position(): number { return this.#position; }
  nextUint32(): number { let value = this.#state; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; this.#state = value >>> 0; this.#position += 1; return this.#state; }
  next(): number { return this.nextUint32() / 0x1_0000_0000; }
  /** Uniform integer in [0, size). */
  int(size: number): number { return Math.floor(this.next() * size); }
  /** Uniform die face in [1, sides]. */
  die(sides = 6): number { return this.int(sides) + 1; }
}

export function shuffle<T>(values: readonly T[], rng: XorShift32): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = rng.int(index + 1);
    [output[index], output[target]] = [output[target] as T, output[index] as T];
  }
  return output;
}

/** Fresh-entropy seed for client-only randomness (work games, previews). */
export function randomSeed(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
