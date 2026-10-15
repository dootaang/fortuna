/**
 * 차트 보조지표 (docs/SPEC-MARKET-DEPTH.md 2-4). Computed in the browser from the loaded candles only.
 * Each returns one value per input point, null until there is enough history.
 */
export function sma(values: readonly number[], length: number): (number | null)[] {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= length) sum -= values[index - length]!;
    return index >= length - 1 ? sum / length : null;
  });
}

/** Bollinger bands: the moving average ± `width` standard deviations. */
export function bollinger(values: readonly number[], length = 20, width = 2): { mid: number | null; upper: number | null; lower: number | null }[] {
  const mids = sma(values, length);
  return values.map((_, index) => {
    const mid = mids[index];
    if (mid === null || mid === undefined) return { mid: null, upper: null, lower: null };
    let variance = 0;
    for (let k = index - length + 1; k <= index; k += 1) variance += (values[k]! - mid) ** 2;
    const sd = Math.sqrt(variance / length);
    return { mid, upper: mid + width * sd, lower: mid - width * sd };
  });
}

/** Relative strength index with Wilder's smoothing, 0–100. */
export function rsi(values: readonly number[], length = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= length) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= length; i += 1) { const change = values[i]! - values[i - 1]!; if (change > 0) gain += change; else loss -= change; }
  gain /= length; loss /= length;
  out[length] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = length + 1; i < values.length; i += 1) {
    const change = values[i]! - values[i - 1]!;
    gain = (gain * (length - 1) + Math.max(0, change)) / length;
    loss = (loss * (length - 1) + Math.max(0, -change)) / length;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
