import { useEffect, useRef, useState } from "react";
import {
  ACCESSORIES, DEFAULT_SPRITE, HAIR_COLORS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, SKIN_TONES, SPRITE_LIMITS,
  type SpriteChoice,
} from "@fortuna/core";
import { cityRefs, saveCharacter, setPortrait, uploadSceneImage, type ActorDoc } from "@fortuna/data";
import { imageStyle, MAX_SIDE, shrinkImage } from "./images.ts";
import { useLiveDoc } from "../session/live.ts";
import { db, storage } from "../firebase.ts";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { cx, useAction } from "../ui/kit.tsx";
import { SPRITE_H, SPRITE_W, spriteCanvas, type Facing } from "./sprites.ts";

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
        {!existing && <p className="mt-1 text-sm text-mist">채팅과 노선도에 보일 {player.name}의 모습을 고르세요. 나중에 언제든 바꿀 수 있습니다.</p>}
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
      {existing && <PortraitPicker existing={existing} />}
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

/** 초상화(선택): 직접 올린 그림이 채팅과 장면의 얼굴이 된다. 없으면 도트 얼굴. docs/SPEC-CITY-MAP.md 9절. */
function PortraitPicker({ existing }: { existing: ActorDoc }) {
  const { session } = usePlayer();
  const { busy, run } = useAction();
  const current = useLiveDoc(existing.portrait ? cityRefs.image(db, existing.portrait) : null, `portrait:${existing.portrait}`);
  const image = current.status === "ready" ? current.data : null;

  async function upload(file: File) {
    const blob = await shrinkImage(file, MAX_SIDE.portrait, true);
    const id = await uploadSceneImage(session, storage, blob, { owner: "player", ref: session.pid, name: `${existing.name} 초상화`, filter: "soft", focus: "center", sense: "", credit: "" });
    await setPortrait(session, id);
    cue("chip");
  }

  return (
    <div className="deco-frame mt-4 flex items-center gap-3 p-4">
      {image ? <img src={image.url} alt="" className="h-16 w-16 rounded-sm border border-gold-400/50 object-cover" style={imageStyle(image)} />
        : <div className="grid h-16 w-16 place-items-center rounded-sm border border-dashed border-gold-400/40 text-xs text-mist">도트</div>}
      <div className="min-w-0 flex-1">
        <p className="font-bold">초상화</p>
        <p className="text-xs text-mist">직접 그린(또는 가진) 그림을 올리면 채팅 얼굴로 씁니다. 정사각형으로 잘라 줄여서 올라갑니다.</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <label className={cx("btn btn-dark btn-sm cursor-pointer", busy && "pointer-events-none opacity-50")}>
            {busy ? "올리는 중…" : image ? "다른 그림으로" : "그림 올리기"}
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void run(() => upload(file));
            }} />
          </label>
          {existing.portrait && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => setPortrait(session, null))}>도트 얼굴로</button>}
        </div>
      </div>
    </div>
  );
}
