import { useEffect, useRef, useState } from "react";
import {
  ACCESSORIES, DEFAULT_SPRITE, HAIR_COLORS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES, SPRITE_LIMITS,
  type Facing, type SpriteChoice,
} from "@fortuna/core";
import { saveCharacter, type ActorDoc } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { cx, useAction } from "../ui/kit.tsx";
import { SPRITE_H, SPRITE_W, spriteCanvas } from "./sprites.ts";

/** 도트 캐릭터 꾸미기. 처음 도시에 들어올 때와, 지도 위 "꾸미기" 버튼에서 연다. */
const FACINGS: Facing[] = ["down", "left", "up", "right"];

export function SpritePreview({ choice, scale = 6, walking = true }: { choice: SpriteChoice; scale?: number; walking?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let frameId = 0;
    const draw = (time: number) => {
      const ctx = canvas.current?.getContext("2d");
      if (ctx) {
        const facing = walking ? FACINGS[Math.floor(time / 1600) % 4]! : "down";
        const frame = walking ? [1, 0, 2, 0][Math.floor(time / 180) % 4]! : 0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, SPRITE_W * scale, SPRITE_H * scale);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(8 * scale, 22.5 * scale, 5.5 * scale, 2 * scale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(spriteCanvas(choice, facing, frame), 0, 0, SPRITE_W * scale, SPRITE_H * scale);
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [choice, scale, walking]);
  return <canvas ref={canvas} width={SPRITE_W * scale} height={SPRITE_H * scale} className="pixelated" aria-label="캐릭터 미리보기" role="img" />;
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: readonly string[]; value: number; onChange: (value: number) => void }) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((color, index) => (
          <button key={color} type="button" aria-label={`${label} ${index + 1}`} aria-pressed={value === index} onClick={() => { cue("tap"); onChange(index); }}
            className={cx("h-8 w-8 rounded-full border-2", value === index ? "border-gold-200 ring-2 ring-gold-400/60" : "border-ink")} style={{ background: color }} />
        ))}
      </div>
    </fieldset>
  );
}

function Choices({ label, options, value, onChange }: { label: string; options: readonly string[]; value: number; onChange: (value: number) => void }) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option, index) => (
          <button key={option} type="button" aria-pressed={value === index} onClick={() => { cue("tap"); onChange(index); }}
            className={cx("btn btn-sm", value === index ? "btn-gold" : "btn-dark")}>{option}</button>
        ))}
      </div>
    </fieldset>
  );
}

export function CharacterMaker({ existing, onDone }: { existing: ActorDoc | null; onDone: () => void }) {
  const { session, player } = usePlayer();
  const { busy, run } = useAction();
  const [choice, setChoice] = useState<SpriteChoice>(existing?.sprite ?? DEFAULT_SPRITE);
  const set = (patch: Partial<SpriteChoice>) => setChoice((current) => ({ ...current, ...patch }));
  const shuffle = () => {
    cue("dice");
    setChoice(Object.fromEntries(Object.entries(SPRITE_LIMITS).map(([key, n]) => [key, Math.floor(Math.random() * n)])) as unknown as SpriteChoice);
  };

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-4 text-center">
        <p className="deco-caps">Passenger</p>
        <h1 className="deco-title text-2xl">{existing ? "모습 고치기" : "도시에 들어서기 전에"}</h1>
        {!existing && <p className="mt-1 text-sm text-mist">지도 위를 걸어 다닐 {player.name}의 모습을 고르세요. 나중에 언제든 바꿀 수 있습니다.</p>}
      </header>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="deco-frame flex flex-col items-center justify-center gap-2 p-4">
          <SpritePreview choice={choice} />
          <p className="text-sm font-bold text-gold-200">{player.name}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={shuffle}>🎲 무작위</button>
        </div>
        <div className="deco-frame space-y-3 p-4">
          <Swatches label="피부" colors={SKIN_TONES} value={choice.skin} onChange={(skin) => set({ skin })} />
          <Choices label="머리 모양" options={HAIR_STYLES} value={choice.hair} onChange={(hair) => set({ hair })} />
          <Swatches label="머리 색" colors={HAIR_COLORS} value={choice.hairColor} onChange={(hairColor) => set({ hairColor })} />
          <Choices label="옷" options={OUTFITS} value={choice.outfit} onChange={(outfit) => set({ outfit })} />
          <Swatches label="옷 색" colors={OUTFIT_COLORS} value={choice.outfitColor} onChange={(outfitColor) => set({ outfitColor })} />
          <Choices label="소품" options={ACCESSORIES} value={choice.accessory} onChange={(accessory) => set({ accessory })} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        {existing && <button type="button" className="btn btn-ghost flex-1" onClick={onDone}>그대로 두기</button>}
        <button type="button" className="btn btn-gold flex-1" disabled={busy} onClick={() => void run(async () => {
          await saveCharacter(session, player.name, choice, existing);
          cue("chip");
          onDone();
        })}>{existing ? "이 모습으로" : "휠 광장으로 나가기"}</button>
      </div>
    </div>
  );
}
