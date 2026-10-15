import { isRecord } from "../games/index.ts";

/**
 * 도트 캐릭터 꾸미기. 저장은 고른 번호 몇 개뿐이고(actors/{pid}.sprite), 그림은 앱이 조립한다.
 * 옷과 소품은 세계관의 장르(무협·판타지·사이버펑크·SF·로판·괴담)가 다 들어가게 골랐다.
 */
export const SKIN_TONES = ["#f6d7b8", "#eec39a", "#d9a476", "#b97c50", "#8a5634", "#e8d8f0"] as const;
export const HAIR_STYLES = ["짧은 머리", "단발", "긴 머리", "뻗친 머리", "올림머리", "포니테일", "땋은 머리", "삭발"] as const;
export const HAIR_COLORS = ["#2a1d17", "#5a3a22", "#a8662c", "#e2c26a", "#d8d4cc", "#b8323a", "#3f6fd6", "#3fae7a"] as const;
export const OUTFITS = ["정장", "로브", "도포", "갑옷", "코트", "드레스", "작업복", "우주복"] as const;
export const OUTFIT_COLORS = ["#2b2f3a", "#0f4634", "#7a1f2b", "#3b4f8a", "#6b4a2b", "#d4af37", "#e8e2d6", "#5b2a6e"] as const;
export const ACCESSORIES = ["없음", "모자", "안경", "뿔", "고양이 귀", "의체 눈"] as const;

export interface SpriteChoice { skin: number; hair: number; hairColor: number; outfit: number; outfitColor: number; accessory: number; }

export const SPRITE_KEYS = ["skin", "hair", "hairColor", "outfit", "outfitColor", "accessory"] as const;
export const SPRITE_LIMITS: Readonly<Record<keyof SpriteChoice, number>> = {
  skin: SKIN_TONES.length, hair: HAIR_STYLES.length, hairColor: HAIR_COLORS.length,
  outfit: OUTFITS.length, outfitColor: OUTFIT_COLORS.length, accessory: ACCESSORIES.length,
};

export const DEFAULT_SPRITE: SpriteChoice = { skin: 1, hair: 0, hairColor: 1, outfit: 0, outfitColor: 0, accessory: 0 };

export function normalizeSprite(raw: unknown): SpriteChoice {
  const source = isRecord(raw) ? raw : {};
  const pick = (key: keyof SpriteChoice) => {
    const value = source[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SPRITE_LIMITS[key] ? value : DEFAULT_SPRITE[key];
  };
  return { skin: pick("skin"), hair: pick("hair"), hairColor: pick("hairColor"), outfit: pick("outfit"), outfitColor: pick("outfitColor"), accessory: pick("accessory") };
}

export function spriteKey(choice: SpriteChoice): string { return SPRITE_KEYS.map((key) => choice[key]).join("."); }
