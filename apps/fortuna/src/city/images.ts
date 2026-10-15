import type { CSSProperties } from "react";
import type { ImageFilter } from "@fortuna/core";
import type { SceneImageDoc } from "@fortuna/data";

/**
 * 딜러·플레이어 이미지: 올리기 전에 브라우저에서 줄이고(WebP), 보여 줄 때는 같은 필터를 씌워 카드 톤을 맞춘다.
 * docs/SPEC-CITY-MAP.md 3-1, 6절.
 */
export const MAX_SIDE = { scene: 1600, portrait: 512, cut: 1600 } as const;

/** Shrink a picked file to at most `maxSide` px on the long side, as WebP (JPEG where WebP encoding is missing). */
export async function shrinkImage(file: File, maxSide: number, square = false): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있습니다.");
  if (file.size > 25 * 1024 * 1024) throw new Error("25MB보다 큰 파일은 올릴 수 없습니다.");
  const bitmap = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
  if (square) { const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = Math.max(0, (sh - side) / 4); sw = side; sh = side; }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode("image/webp", 0.82);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.85);
  if (!blob) throw new Error("이미지를 줄이지 못했습니다.");
  if (blob.size > 2.8 * 1024 * 1024) blob = (await encode(blob.type, 0.6)) ?? blob;
  return blob;
}

/** One look for every picture: the card's filter presets. */
export const FILTER_CSS: Record<ImageFilter, string> = {
  soft: "sepia(0.32) saturate(0.82) contrast(1.06) brightness(0.8)",
  strong: "grayscale(0.55) sepia(0.6) contrast(1.15) brightness(0.68)",
  frame: "none",
};

export function imageStyle(image: Pick<SceneImageDoc, "filter" | "focus">): CSSProperties {
  return { filter: FILTER_CSS[image.filter] ?? FILTER_CSS.soft, objectPosition: `center ${image.focus === "top" ? "20%" : image.focus === "bottom" ? "80%" : "50%"}` };
}
