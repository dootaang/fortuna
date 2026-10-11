import { useSyncExternalStore } from "react";

/** Per-device presentation settings. Stored locally; never affects game results. */
export interface FxSettings {
  /** Halve every staged delay — for players who replay the same table a lot. */
  fast: boolean;
  sound: boolean;
  /** Android only; iOS Safari has no vibration API. */
  haptics: boolean;
}

const KEY = "fortuna:fx:1";
const DEFAULTS: FxSettings = { fast: false, sound: true, haptics: true };
const listeners = new Set<() => void>();

function load(): FxSettings {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<FxSettings>) }; } catch { return DEFAULTS; }
}

let current = load();

export function fxSettings(): FxSettings { return current; }

export function setFxSettings(patch: Partial<FxSettings>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory */ }
  listeners.forEach((listener) => listener());
}

export function useFxSettings(): FxSettings {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => current, () => DEFAULTS);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Scale a staged duration by the player's settings. */
export function ms(duration: number): number {
  if (prefersReducedMotion()) return Math.round(duration * 0.3);
  return Math.round(duration * (current.fast ? 0.5 : 1));
}

export function wait(duration: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, duration)); }

export function haptic(pattern: number | number[]): void {
  if (!current.haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
