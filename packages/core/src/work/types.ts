export const WORK_TEMPLATES = ["sort", "memory", "math", "timing"] as const;
export type WorkTemplate = (typeof WORK_TEMPLATES)[number];

export interface WorkSkinBase {
  title: string;
  /** One line shown before the shift starts. */
  intro: string;
  icon: string;
}

/** 분류: drop each item in the right bin before time runs out. */
export interface SortSkin extends WorkSkinBase {
  bins: { id: string; label: string; icon: string }[];
  items: { label: string; icon: string; bin: string }[];
}

/** 기억: memorise an order, then pick exactly those things from the counter. */
export interface MemorySkin extends WorkSkinBase {
  /** What one round is called, e.g. "주문". */
  noun: string;
  items: { label: string; icon: string }[];
}

/** 빠른 셈: answer sums under time pressure. `{a}`/`{b}` are replaced in prompts. */
export interface MathSkin extends WorkSkinBase {
  unit: string;
  add: string[];
  sub: string[];
  mul: string[];
}

/** 타이밍: stop the moving needle inside the mark. */
export interface TimingSkin extends WorkSkinBase {
  action: string;
  hit: string;
  miss: string;
}

export interface WorkSkins { sort: SortSkin; memory: MemorySkin; math: MathSkin; timing: TimingSkin; }
