import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import {
  JOKER, basicStrategyHits, blackjackValue, diceHand, highLowOdds, lastTrainMultiplier, rouletteGross, suggestDiceHold, suggestPokerHold,
  type BlackjackState, type DicePokerState, type DrawPokerState, type GameId, type HighLowParams, type HighLowState, type LastTrainParams,
  type LastTrainState, type OddEvenState, type OldMaidState, type RouletteParams, type RouletteState,
} from "@fortuna/core";
import { PlayingCard } from "../ui/pieces.tsx";
import { cx } from "../ui/kit.tsx";
import { Dice3D } from "../fx/Dice3D.tsx";
import { FlipCard } from "../fx/FlipCard.tsx";
import { RouletteWheel } from "../fx/RouletteWheel.tsx";
import { flash, shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { ms } from "../fx/settings.ts";
import type { Phase } from "./staging.ts";

export interface ViewProps<S, P = unknown> {
  state: S;
  /** State before the latest step, for working out what is new. */
  previous: S | null;
  params: P;
  phase: Phase;
  /** The decision being sealed while `phase === "rolling"`. */
  action: string | null;
  busy: boolean;
  act: (action: string) => Promise<void> | void;
}

export function GameView({ game, ...props }: { game: GameId } & ViewProps<any, any>) {
  switch (game) {
    case "odd-even": return <OddEvenView {...props} />;
    case "high-low": return <HighLowView {...props} />;
    case "blackjack": return <BlackjackView {...props} />;
    case "last-train": return <LastTrainView {...props} />;
    case "roulette": return <RouletteView {...props} />;
    case "dice-poker": return <DicePokerView {...props} />;
    case "old-maid": return <OldMaidView {...props} />;
    case "draw-poker": return <DrawPokerView {...props} />;
  }
}

function ActionRow({ children }: { children: ReactNode }) { return <div className="mt-4 grid grid-cols-2 gap-2">{children}</div>; }

/** Result line, held back until the reveal has finished so it never spoils the animation. */
function Verdict({ show, win, push, children }: { show: boolean; win: boolean; push?: boolean; children: ReactNode }) {
  return (
    <p className={cx("mt-3 min-h-6 text-center font-bold transition-opacity duration-300", show ? "opacity-100" : "opacity-0", push ? "text-ivory" : win ? "text-[#a9ecc9]" : "text-[#f2b3aa]")} aria-live="polite">
      {show ? children : null}
    </p>
  );
}

/** Run `effect` once each time `when` turns true. */
function useOnRise(when: boolean, effect: () => void) {
  const was = useRef(when);
  useEffect(() => { if (when && !was.current) effect(); was.current = when; }, [when]);
}

function Deck({ wobble }: { wobble: boolean }) {
  return (
    <span className={cx("relative inline-block", wobble && "deck-wobble")} aria-hidden="true">
      <PlayingCard id={null} className="absolute left-1 top-1 opacity-60" />
      <PlayingCard id={null} />
    </span>
  );
}

// ── 홀짝 ──
function Cup({ mode }: { mode: "rest" | "shake" | "lift" }) {
  return (
    <svg viewBox="0 0 120 120" className={cx("absolute left-1/2 top-0 h-36 w-36 -translate-x-1/2 drop-shadow-[0_12px_14px_#000c]", mode === "shake" && "cup-shake", mode === "lift" && "cup-lift")} aria-hidden="true">
      <defs>
        <linearGradient id="cupBody" x1="0" x2="1">
          <stop offset="0" stopColor="#1b120a" /><stop offset=".45" stopColor="#4a3218" /><stop offset="1" stopColor="#140d07" />
        </linearGradient>
      </defs>
      <path d="M30 10 H90 L104 112 H16 Z" fill="url(#cupBody)" stroke="#d4af37" strokeWidth="2" />
      <rect x="22" y="92" width="76" height="7" fill="#d4af37" />
      <rect x="27" y="30" width="66" height="4" fill="#d4af37" opacity=".8" />
      <path d="M60 46 l10 14 -10 14 -10 -14 z" fill="#d4af37" />
    </svg>
  );
}

function OddEvenView({ state, phase, action, busy, act }: ViewProps<OddEvenState>) {
  const rolling = phase === "rolling", revealed = state.done, settled = revealed && phase === "idle";
  useOnRise(rolling, () => cue("shake"));
  const sum = (state.dice?.[0] ?? 0) + (state.dice?.[1] ?? 0);
  const pick = state.pick ?? (action === "odd" || action === "even" ? action : null);
  return (
    <div>
      <div className="relative mx-auto h-40 w-60 overflow-hidden">
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-5">
          {revealed && state.dice ? state.dice.map((value, index) => <Dice3D key={index} value={value} red={value === 1 || value === 4} entrance={360 + index * 120} />) : null}
        </div>
        <div className="absolute inset-x-6 bottom-0 h-3 rounded-[50%] bg-black/50 blur-[2px]" />
        {!settled && <Cup mode={rolling ? "shake" : revealed ? "lift" : "rest"} />}
      </div>
      {!revealed ? (
        <>
          <p className="text-center text-sm text-mist">{rolling ? "컵을 흔드는 중…" : "주사위 두 개의 합, 홀일까 짝일까?"}</p>
          <ActionRow>
            {(["odd", "even"] as const).map((choice) => (
              <button key={choice} type="button" className={cx("btn min-h-20 text-2xl", pick === choice ? "btn-gold pulse-gold" : rolling ? "btn-dark opacity-50" : "btn-gold")} disabled={busy} onClick={() => void act(choice)}>
                {choice === "odd" ? "홀" : "짝"}
              </button>
            ))}
          </ActionRow>
        </>
      ) : (
        <div className="text-center">
          <p className={cx("transition-opacity duration-300", settled ? "opacity-100" : "opacity-0")}>합 <b className="num text-2xl text-gold-200">{sum}</b> · {sum % 2 ? "홀" : "짝"} <span className="text-mist">(선택: {state.pick === "odd" ? "홀" : "짝"})</span></p>
          <Verdict show={settled} win={state.win}>{state.win ? "적중" : "빗나감"}</Verdict>
        </div>
      )}
    </div>
  );
}

// ── 하이로우 ──
function HighLowView({ state, previous, params, phase, action, busy, act }: ViewProps<HighLowState, HighLowParams>) {
  const odds = highLowOdds(state), multipliers = params?.multipliers ?? [];
  const current = state.streak > 0 ? multipliers[state.streak - 1] ?? 0 : 0;
  const rolling = phase === "rolling", settled = phase === "idle";
  const fresh = previous !== null && previous.current !== state.current;
  useOnRise(phase === "landing" && state.done && state.payout === 0 && fresh, () => window.setTimeout(() => cue("wrong"), ms(1_050)));
  return (
    <div>
      <div className="flex items-end justify-center gap-3">
        <div className="flex -space-x-8">{state.seen.slice(-4, -1).map((id) => <PlayingCard key={id} id={id} className="scale-75 opacity-50" />)}</div>
        <FlipCard key={state.current} id={state.current} squeeze={fresh} delay={0} from={[70, -20]} />
        <Deck wobble={rolling && action !== "cashout"} />
      </div>
      <ol className="mt-4 flex justify-center gap-1 text-xs" aria-label="배수표">
        {multipliers.map((value, index) => (
          <li key={index} className={cx("chip num transition-all duration-300", index < state.streak ? "chip-gold scale-110" : "", index === state.streak - 1 && settled && "punch")}>×{value}</li>
        ))}
      </ol>
      <Verdict show={settled && (state.done || state.streak > 0)} win={state.payout > 0 || !state.done}>
        {state.done ? (state.payout > 0 ? `×${current}로 받았습니다` : "같은 숫자이거나 빗나갔습니다") : `${state.streak}연속 적중`}
      </Verdict>
      {!state.done && (
        <>
          <ActionRow>
            <button type="button" className={cx("btn min-h-16 flex-col", action === "higher" ? "btn-gold pulse-gold" : "btn-gold")} disabled={busy} onClick={() => void act("higher")}>▲ 높다<span className="text-xs font-normal">{Math.round(odds.higher * 100)}%</span></button>
            <button type="button" className={cx("btn min-h-16 flex-col", action === "lower" ? "btn-gold pulse-gold" : "btn-gold")} disabled={busy} onClick={() => void act("lower")}>▼ 낮다<span className="text-xs font-normal">{Math.round(odds.lower * 100)}%</span></button>
          </ActionRow>
          <button type="button" className="btn btn-ghost mt-2 w-full" disabled={busy || state.streak === 0} onClick={() => void act("cashout")}>
            멈추고 받기 {state.streak > 0 && `(×${current})`}
          </button>
        </>
      )}
    </div>
  );
}

// ── 스물하나 ──
function BlackjackView({ state, previous, phase, action, busy, act }: ViewProps<BlackjackState>) {
  const settled = phase === "idle", rolling = phase === "rolling";
  const opening = previous === null;
  const dealerBefore = previous?.dealer.length ?? 0;
  // Dealer draws come one by one; a stiff dealer reveals a beat slower for suspense.
  const dealerGap = blackjackValue(state.dealer.slice(0, 2)) >= 12 && blackjackValue(state.dealer.slice(0, 2)) <= 16 ? 640 : 520;
  const dealerDelay = (index: number) => (opening ? (index === 0 ? 160 : 900 + (index - 1) * dealerGap) : index >= dealerBefore ? 120 + (index - dealerBefore) * dealerGap : 0);
  const playerDelay = (index: number) => (opening ? index * 320 : 0);
  const hint = !state.done && state.dealer[0] ? (basicStrategyHits(state.player, state.dealer[0]) ? "히트" : "스탠드") : null;
  const labels: Record<string, string> = { natural: "스물하나! 처음 두 장으로 21", win: "딜러를 이겼습니다", push: "비겼습니다", loss: "딜러의 수가 더 높습니다", bust: "21을 넘었습니다" };
  const board = useRef<HTMLDivElement>(null);
  useOnRise(phase === "landing" && state.result === "bust", () => window.setTimeout(() => shake(board.current, 5), ms(450)));

  return (
    <div ref={board} className="relative">
      <div className="absolute right-0 top-0 scale-75 origin-top-right"><Deck wobble={rolling} /></div>
      <p className="text-xs text-mist">딜러 {settled && <span className="num text-ivory">· {blackjackValue(state.dealer)}</span>}</p>
      <div className="mt-1 flex min-h-[5.6rem] flex-wrap justify-center gap-2 pr-10">
        {state.dealer.map((id, index) => <FlipCard key={id} id={id} delay={dealerDelay(index)} squeeze={!opening && index === 1} />)}
        {!state.done && <span className={cx(rolling && action === "stand" && "deck-wobble")}><PlayingCard id={null} label="딜러가 아직 받지 않은 카드" /></span>}
      </div>
      <div className="my-4 h-px bg-gold-400/30" />
      <div className="flex min-h-[5.6rem] flex-wrap justify-center gap-2">{state.player.map((id, index) => <FlipCard key={id} id={id} delay={playerDelay(index)} />)}</div>
      <p className="mt-1 min-h-5 text-center text-sm">{settled && <>손님 · <b className="num text-gold-200">{blackjackValue(state.player)}</b></>}</p>
      {state.result && <Verdict show={settled} win={state.result === "win" || state.result === "natural"} push={state.result === "push"}>{labels[state.result]}</Verdict>}
      {!state.done && (
        <>
          <ActionRow>
            <button type="button" className={cx("btn min-h-14", action === "hit" ? "btn-gold pulse-gold" : "btn-gold")} disabled={busy} onClick={() => void act("hit")}>한 장 더 (히트)</button>
            <button type="button" className={cx("btn min-h-14", action === "stand" ? "btn-gold pulse-gold" : "btn-dark")} disabled={busy} onClick={() => void act("stand")}>멈춤 (스탠드)</button>
          </ActionRow>
          {hint && <p className="mt-2 text-center text-xs text-mist">추천: {hint}</p>}
        </>
      )}
    </div>
  );
}

// ── 막차 ──
function LastTrainView({ state, params, phase, action, busy, act }: ViewProps<LastTrainState, LastTrainParams>) {
  const stations = params?.stations ?? 10, last = state.rolls[state.rolls.length - 1];
  const rolling = phase === "rolling" && action === "roll", settled = phase === "idle";
  const board = useRef<HTMLDivElement>(null);
  const [cutIn, setCutIn] = useState(false);
  const tense = state.stations >= Math.ceil(stations / 2) && !state.done;

  useOnRise(phase === "landing" && state.caught, () => {
    window.setTimeout(() => { setCutIn(true); cue("caught"); shake(board.current, 7, 420); flash("ruby", 420); }, ms(560));
  });
  useEffect(() => { if (!cutIn) return undefined; const timer = window.setTimeout(() => setCutIn(false), ms(1_200)); return () => window.clearTimeout(timer); }, [cutIn]);
  useOnRise(rolling, () => cue("drum", state.stations));

  const position = Math.min(stations, state.stations) / stations;
  return (
    <div ref={board} className={cx("relative rounded-sm p-1", tense && rolling && "danger-pulse")}>
      <div className="relative px-2 pt-7">
        <div className="absolute inset-x-3 top-[2.35rem] h-1 rounded bg-gold-400/25" />
        <div className="absolute top-[2.35rem] h-1 rounded bg-gold-400 transition-[width] duration-500" style={{ left: "0.75rem", width: `calc((100% - 1.5rem) * ${position})` }} />
        <span className={cx("absolute top-1 -translate-x-1/2 text-2xl transition-[left] duration-500 ease-out", rolling && "deck-wobble")} style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${position})` }} aria-hidden="true">🚂</span>
        <ol className="relative flex justify-between" aria-label="정거장">
          {Array.from({ length: stations + 1 }, (_, index) => (
            <li key={index} className="flex w-0 flex-col items-center">
              <span className={cx("block h-3 w-3 rounded-full border transition-colors", index <= state.stations ? "border-gold-200 bg-gold-400" : "border-gold-400/40 bg-ink", state.caught && index === state.stations + 1 && "!border-ruby !bg-ruby")} />
              {index > 0 && <span className="mt-1 text-[0.58rem] text-mist num">×{params ? lastTrainMultiplier(params, index).toFixed(1) : index}</span>}
            </li>
          ))}
        </ol>
      </div>
      <div className="my-5 flex justify-center">
        <Dice3D value={last ?? 1} rolling={rolling} red={last === 1} size="3.6rem" />
      </div>
      <p className="text-center text-sm">
        {rolling ? (tense ? "검표원의 발소리가 가까워진다…" : "덜컹, 덜컹…") : state.caught ? (settled ? "검표원에게 걸렸습니다." : "…") : state.stations === 0 ? "1이 나오면 검표원입니다." : `${state.stations}번째 역 · 지금 내리면 ×${params ? lastTrainMultiplier(params, state.stations).toFixed(2) : "?"}`}
      </p>
      <Verdict show={settled && state.done && !state.caught} win>{state.stations >= stations ? "종점까지 무사히 왔습니다!" : `${state.stations}번째 역에서 내렸습니다`}</Verdict>
      {!state.done && (
        <ActionRow>
          <button type="button" className={cx("btn min-h-14", action === "roll" ? "btn-gold pulse-gold" : "btn-gold")} disabled={busy} onClick={() => void act("roll")}>🎲 한 정거장 더</button>
          <button type="button" className="btn btn-dark min-h-14" disabled={busy || state.stations === 0} onClick={() => void act("stop")}>내린다</button>
        </ActionRow>
      )}
      {cutIn && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <div className="slide-in-top rounded-sm border-2 border-ruby bg-ink/95 px-6 py-4 text-center shadow-[0_0_40px_#c4473a88]">
            <p className="text-4xl">🎫</p>
            <p className="deco-title mt-1 text-3xl !text-[#f2b3aa]">검표원!</p>
            <p className="text-xs text-mist">승차권이 찢어졌습니다</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 룰렛 ──
const ROULETTE_BETS: { id: string; label: string }[] = [
  { id: "red", label: "빨강" }, { id: "black", label: "검정" }, { id: "odd", label: "홀" }, { id: "even", label: "짝" },
  { id: "low", label: "1–18" }, { id: "high", label: "19–36" }, { id: "dozen1", label: "1–12" }, { id: "dozen2", label: "13–24" }, { id: "dozen3", label: "25–36" },
];
const betLabel = (wager: string | null) => ROULETTE_BETS.find((bet) => bet.id === wager)?.label ?? (wager ? `숫자 ${wager.slice(1)}` : "");

function RouletteView({ state, params, phase, action, busy, act }: ViewProps<RouletteState, RouletteParams>) {
  const [number, setNumber] = useState(17);
  const settled = phase === "idle";
  const wager = state.wager ?? action;
  return (
    <div>
      <RouletteWheel zeros={params?.zeros ?? 0} pocket={state.pocket} phase={phase} />
      {wager ? (
        <div className="mt-3 text-center">
          <p className="text-sm">건 곳: <b className="text-gold-200">{betLabel(wager)}</b> <span className="text-mist">(×{rouletteGross(wager as never)})</span></p>
          <Verdict show={settled && state.done} win={state.payout > 0}>{state.payout > 0 ? `${state.pocket === -1 ? "00" : state.pocket} · 적중` : `${state.pocket === -1 ? "00" : state.pocket} · 빗나감`}</Verdict>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {ROULETTE_BETS.map((bet) => (
              <button key={bet.id} type="button" disabled={busy} onClick={() => void act(bet.id)}
                className={cx("btn btn-sm min-h-12 flex-col", bet.id === "red" ? "btn-danger" : bet.id === "black" ? "btn-dark" : "btn-ghost")}>
                {bet.label}<span className="text-[0.65rem] font-normal opacity-80">×{rouletteGross(bet.id as never)}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1">
              <span className="field-label">숫자 하나 (×36)</span>
              <input type="number" className="field num" min={1} max={36} value={number} onChange={(event) => setNumber(Math.min(36, Math.max(1, Number(event.target.value) || 1)))} />
            </label>
            <button type="button" className="btn btn-gold" disabled={busy} onClick={() => void act(`n${number}`)}>{number}에 건다</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 주사위 포커 ──
function DicePokerView({ state, phase, action, busy, act }: ViewProps<DicePokerState>) {
  const [hold, setHold] = useState<string>(() => suggestDiceHold(state.player));
  const toggle = (index: number) => { cue("tap"); setHold((mask) => mask.split("").map((bit, slot) => (slot === index ? (bit === "1" ? "0" : "1") : bit)).join("")); };
  const rolling = phase === "rolling", landing = phase === "landing", settled = phase === "idle";
  const sealedHold = action?.startsWith("hold:") ? action.slice(5) : hold;
  useOnRise(rolling, () => cue("dice"));
  // Dealer rolls after the player's dice settle.
  const [dealer, setDealer] = useState<"hidden" | "rolling" | "shown">(state.done && settled ? "shown" : "hidden");
  useOnRise(landing && state.done, () => {
    setDealer("hidden");
    window.setTimeout(() => { setDealer("rolling"); cue("dice"); }, ms(750));
    window.setTimeout(() => { setDealer("shown"); cue("land"); }, ms(1_450));
  });

  return (
    <div className="text-center">
      {state.done && dealer !== "hidden" && (
        <div className="mb-3 slide-in-top">
          <p className="text-xs text-mist">딜러 {dealer === "shown" && settled ? `· ${state.dealerHand?.label}` : ""}</p>
          <div className="mt-1 flex justify-center gap-2">{state.dealer?.map((value, index) => <Dice3D key={index} value={value} rolling={dealer === "rolling"} size="2.6rem" />)}</div>
          <div className="my-3 h-px bg-gold-400/30" />
        </div>
      )}
      <p className="text-sm text-mist">{state.done ? (settled ? <>손님 · <b className="text-gold-200">{state.playerHand?.label}</b></> : " ") : <>남길 주사위를 고르세요 · 지금 <b className="text-gold-200">{diceHand(state.player).label}</b></>}</p>
      <div className="mt-3 flex justify-center gap-2">
        {state.player.map((value, index) => (
          <Dice3D key={index} value={value} red held={!state.done && sealedHold[index] === "1"} rolling={rolling && sealedHold[index] === "0"}
            entrance={!state.done && phase === "landing" ? 500 + index * 90 : 0} onClick={busy || state.done ? undefined : () => toggle(index)} />
        ))}
      </div>
      {state.done ? (
        <Verdict show={settled} win={state.outcome === "win"} push={state.outcome === "tie"}>{state.outcome === "win" ? "족보가 더 높습니다" : state.outcome === "tie" ? "같은 족보입니다" : "딜러의 족보가 더 높습니다"}</Verdict>
      ) : (
        <ActionRow>
          <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void act(`hold:${hold}`)}>{hold === "11111" ? "이대로 승부" : "다시 굴리기"}</button>
          <button type="button" className="btn btn-dark min-h-14" disabled={busy} onClick={() => setHold(suggestDiceHold(state.player))}>추천대로</button>
        </ActionRow>
      )}
    </div>
  );
}

// ── 도둑잡기 ──
function OldMaidView({ state, previous, phase, action, busy, act }: ViewProps<OldMaidState>) {
  const rolling = phase === "rolling", settled = phase === "idle";
  const picking = rolling && action?.startsWith("pick:") ? Number(action.slice(5)) : -1;
  const before = new Set(previous?.hand ?? []);
  const board = useRef<HTMLDivElement>(null);
  const drewJoker = phase === "landing" && state.log.some((entry) => entry.by === "player" && entry.card === JOKER);
  useOnRise(drewJoker, () => window.setTimeout(() => shake(board.current, 4), ms(380)));
  const [logShown, setLogShown] = useState(state.log.length);
  useEffect(() => {
    if (phase !== "landing") { setLogShown(state.log.length); return undefined; }
    setLogShown(1);
    const timer = window.setTimeout(() => setLogShown(state.log.length), ms(650));
    return () => window.clearTimeout(timer);
  }, [phase, state.log.length]);

  return (
    <div ref={board}>
      <p className="text-center text-xs text-mist">딜러의 패 {state.dealer.length}장{state.done ? "" : " · 한 장을 뽑으세요"}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        {state.dealer.map((card, index) => (
          <button key={`${state.dealer.length}-${index}`} type="button" disabled={busy || state.done} onClick={() => void act(`pick:${index}`)} aria-label={`딜러의 ${index + 1}번째 카드 뽑기`}
            className={cx("transition-transform duration-200 hover:-translate-y-1 disabled:hover:translate-y-0", picking === index && "-translate-y-4 drop-shadow-[0_0_10px_#d4af37]")}>
            {state.done ? <PlayingCard id={card} className="scale-90" /> : <PlayingCard id={null} className="scale-90" />}
          </button>
        ))}
      </div>
      <div className="min-h-12 py-2 text-center text-sm" aria-live="polite">
        {state.log.slice(0, logShown).map((entry, index) => (
          <p key={`${index}-${entry.card}`} className="slide-in-top">
            {entry.by === "player" ? "손님이" : "딜러가"} {entry.card === JOKER ? <b className="text-[#f2b3aa]">조커를</b> : "카드를"} 뽑았습니다{entry.paired ? " · 짝을 맞춰 버림" : ""}
          </p>
        ))}
      </div>
      <div className="h-px bg-gold-400/30" />
      <p className="mt-3 text-center text-xs text-mist">손님의 패 {state.hand.length}장</p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        <AnimatePresence mode="popLayout">
          {state.hand.map((id) => <FlipCard key={id} id={id} className="scale-90" dealt={previous !== null && !before.has(id)} from={[0, -140]} />)}
        </AnimatePresence>
      </div>
      {state.done && <Verdict show={settled} win={state.win}>{state.win ? "조커는 딜러의 손에 남았습니다" : "조커가 손님의 손에 남았습니다"}</Verdict>}
    </div>
  );
}

// ── 포커 ──
function DrawPokerView({ state, previous, phase, action, busy, act }: ViewProps<DrawPokerState>) {
  const [hold, setHold] = useState<string>(() => suggestPokerHold(state.player));
  const toggle = (index: number) => { cue("tap"); setHold((mask) => mask.split("").map((bit, slot) => (slot === index ? (bit === "1" ? "0" : "1") : bit)).join("")); };
  const rolling = phase === "rolling", settled = phase === "idle";
  const sealedHold = action?.startsWith("hold:") ? action.slice(5) : hold;
  const before = new Set(previous?.player ?? []);
  const opening = previous === null;
  let fresh = 0;

  return (
    <div className="text-center">
      {state.done && state.dealer && (
        <div className="mb-3">
          <p className="text-xs text-mist">딜러 {settled ? `· ${state.dealerHand?.label}` : ""}</p>
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {state.dealer.map((id, index) => <FlipCard key={id} id={id} className="scale-90" delay={750 + index * 200} dealt={!settled} />)}
          </div>
          <div className="my-3 h-px bg-gold-400/30" />
        </div>
      )}
      <p className="text-sm text-mist">{state.done ? (settled ? <>손님 · <b className="text-gold-200">{state.playerHand?.label}</b></> : " ") : "남길 카드를 누르세요. 나머지는 한 번 바꿉니다."}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-1">
        {state.player.map((id, index) => {
            const isNew = !opening && !before.has(id), delay = opening ? index * 120 : isNew ? 120 + fresh++ * 140 : 0;
            const held = !state.done && sealedHold[index] === "1";
            return (
              <button key={id} type="button" disabled={busy || state.done} onClick={() => toggle(index)} aria-pressed={held}
                className={cx("rounded-md transition-all duration-200", held ? "-translate-y-2 ring-2 ring-gold-400" : !state.done && "opacity-80", rolling && !held && "-translate-y-6 opacity-0")}>
                <FlipCard id={id} className="scale-90" delay={delay} dealt={opening || isNew} />
              </button>
            );
        })}
      </div>
      {state.done ? (
        <Verdict show={settled} win={state.outcome === "win"} push={state.outcome === "tie"}>{state.outcome === "win" ? "족보가 더 높습니다" : state.outcome === "tie" ? "같은 족보입니다" : "딜러의 족보가 더 높습니다"}</Verdict>
      ) : (
        <ActionRow>
          <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void act(`hold:${hold}`)}>{hold === "11111" ? "이대로 승부" : "교환"}</button>
          <button type="button" className="btn btn-dark min-h-14" disabled={busy} onClick={() => setHold(suggestPokerHold(state.player))}>추천대로</button>
        </ActionRow>
      )}
    </div>
  );
}
