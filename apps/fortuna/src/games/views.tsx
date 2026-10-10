import { useState } from "react";
import {
  JOKER, RED_NUMBERS, basicStrategyHits, blackjackValue, diceHand, highLowOdds, lastTrainMultiplier, rouletteGross, suggestDiceHold, suggestPokerHold,
  type BlackjackState, type DicePokerState, type DrawPokerState, type GameId, type HighLowParams, type HighLowState, type LastTrainParams,
  type LastTrainState, type OddEvenState, type OldMaidState, type RouletteState,
} from "@fortuna/core";
import { Die, PlayingCard } from "../ui/pieces.tsx";
import { cx } from "../ui/kit.tsx";

export interface ViewProps<S, P = unknown> { state: S; params: P; busy: boolean; act: (action: string) => Promise<void> | void; }

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

function ActionRow({ children }: { children: React.ReactNode }) { return <div className="mt-4 grid grid-cols-2 gap-2">{children}</div>; }

function Verdict({ win, push, children }: { win: boolean; push?: boolean; children: React.ReactNode }) {
  return <p className={cx("mt-3 text-center font-bold", push ? "text-ivory" : win ? "text-[#a9ecc9]" : "text-[#f2b3aa]")} aria-live="polite">{children}</p>;
}

// ── 홀짝 ──
function OddEvenView({ state, busy, act }: ViewProps<OddEvenState>) {
  if (!state.done) {
    return (
      <div>
        <p className="text-center text-sm text-mist">딜러가 주사위 두 개를 컵에 넣고 흔듭니다. 합은 홀일까요, 짝일까요?</p>
        <ActionRow>
          <button type="button" className="btn btn-gold min-h-20 text-2xl" disabled={busy} onClick={() => void act("odd")}>홀</button>
          <button type="button" className="btn btn-gold min-h-20 text-2xl" disabled={busy} onClick={() => void act("even")}>짝</button>
        </ActionRow>
      </div>
    );
  }
  const sum = (state.dice?.[0] ?? 0) + (state.dice?.[1] ?? 0);
  return (
    <div className="text-center">
      <div className="flex justify-center gap-3">{state.dice?.map((value, index) => <Die key={index} value={value} red={value === 1 || value === 4} />)}</div>
      <p className="mt-3">합 <b className="num text-gold-200">{sum}</b> · {sum % 2 ? "홀" : "짝"} (선택: {state.pick === "odd" ? "홀" : "짝"})</p>
      <Verdict win={state.win}>{state.win ? "맞혔습니다" : "빗나갔습니다"}</Verdict>
    </div>
  );
}

// ── 하이로우 ──
function HighLowView({ state, params, busy, act }: ViewProps<HighLowState, HighLowParams>) {
  const odds = highLowOdds(state), multipliers = params?.multipliers ?? [];
  const current = state.streak > 0 ? multipliers[state.streak - 1] ?? 0 : 0;
  return (
    <div>
      <div className="flex items-end justify-center gap-4">
        {state.seen.slice(-4, -1).map((id) => <PlayingCard key={id} id={id} className="scale-75 opacity-60" />)}
        <PlayingCard key={state.current} id={state.current} />
      </div>
      <ol className="mt-4 flex justify-center gap-1 text-xs" aria-label="배수표">
        {multipliers.map((value, index) => (
          <li key={index} className={cx("chip num", index < state.streak ? "chip-gold" : "")}>×{value}</li>
        ))}
      </ol>
      {state.last && !state.done && <Verdict win>{state.streak}연속 적중</Verdict>}
      {state.done && <Verdict win={state.payout > 0}>{state.payout > 0 ? `×${current} 로 받았습니다` : state.last && state.last.card && "같은 숫자이거나 예측이 빗나갔습니다"}</Verdict>}
      {!state.done && (
        <>
          <ActionRow>
            <button type="button" className="btn btn-gold min-h-16 flex-col" disabled={busy} onClick={() => void act("higher")}>▲ 높다<span className="text-xs font-normal">{Math.round(odds.higher * 100)}%</span></button>
            <button type="button" className="btn btn-gold min-h-16 flex-col" disabled={busy} onClick={() => void act("lower")}>▼ 낮다<span className="text-xs font-normal">{Math.round(odds.lower * 100)}%</span></button>
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
function BlackjackView({ state, busy, act }: ViewProps<BlackjackState>) {
  const playerValue = blackjackValue(state.player), dealerValue = blackjackValue(state.dealer);
  const hint = !state.done && state.dealer[0] ? (basicStrategyHits(state.player, state.dealer[0]) ? "히트" : "스탠드") : null;
  const labels: Record<string, string> = { natural: "스물하나! 처음 두 장으로 21", win: "딜러를 이겼습니다", push: "비겼습니다", loss: "딜러의 수가 더 높습니다", bust: "21을 넘었습니다" };
  return (
    <div>
      <p className="text-center text-xs text-mist">딜러 · <span className="num">{dealerValue}</span></p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {state.dealer.map((id) => <PlayingCard key={id} id={id} />)}
        {!state.done && <PlayingCard id={null} label="딜러가 아직 받지 않은 카드" />}
      </div>
      <div className="my-4 h-px bg-gold-400/30" />
      <div className="flex flex-wrap justify-center gap-2">{state.player.map((id) => <PlayingCard key={id} id={id} />)}</div>
      <p className="mt-1 text-center text-sm">손님 · <b className="num text-gold-200">{playerValue}</b></p>
      {state.done && state.result && <Verdict win={state.result === "win" || state.result === "natural"} push={state.result === "push"}>{labels[state.result]}</Verdict>}
      {!state.done && (
        <>
          <ActionRow>
            <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void act("hit")}>한 장 더 (히트)</button>
            <button type="button" className="btn btn-dark min-h-14" disabled={busy} onClick={() => void act("stand")}>멈춤 (스탠드)</button>
          </ActionRow>
          {hint && <p className="mt-2 text-center text-xs text-mist">딜러의 귓속말: 저라면 {hint}를 하겠습니다.</p>}
        </>
      )}
    </div>
  );
}

// ── 막차 ──
function LastTrainView({ state, params, busy, act }: ViewProps<LastTrainState, LastTrainParams>) {
  const stations = params?.stations ?? 10, last = state.rolls[state.rolls.length - 1];
  return (
    <div>
      <ol className="flex items-center justify-between gap-1" aria-label="정거장">
        {Array.from({ length: stations }, (_, index) => (
          <li key={index} className="flex flex-1 flex-col items-center">
            <span className={cx("block h-3 w-3 rounded-full border", index < state.stations ? "border-gold-200 bg-gold-400" : "border-gold-400/40", state.caught && index === state.stations && "!border-ruby !bg-ruby")} />
            <span className="mt-1 text-[0.6rem] text-mist num">{params ? `×${lastTrainMultiplier(params, index + 1).toFixed(2)}` : index + 1}</span>
          </li>
        ))}
      </ol>
      <div className="my-5 flex justify-center">{last !== undefined ? <Die key={state.rolls.length} value={last} red={last === 1} /> : <span className="text-5xl" aria-hidden="true">🚂</span>}</div>
      <p className="text-center text-sm">
        {state.caught ? "검표원에게 걸렸습니다. 승차권이 찢어졌습니다." : state.stations === 0 ? "기차가 출발합니다. 1이 나오면 검표원입니다." : `${state.stations}번째 역 · 지금 내리면 ×${params ? lastTrainMultiplier(params, state.stations).toFixed(2) : "?"}`}
      </p>
      {state.done && !state.caught && <Verdict win>{state.stations >= stations ? "종점까지 무사히 왔습니다!" : `${state.stations}번째 역에서 내렸습니다`}</Verdict>}
      {!state.done && (
        <ActionRow>
          <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void act("roll")}>🎲 한 정거장 더</button>
          <button type="button" className="btn btn-dark min-h-14" disabled={busy || state.stations === 0} onClick={() => void act("stop")}>내린다</button>
        </ActionRow>
      )}
    </div>
  );
}

// ── 룰렛 ──
const ROULETTE_BETS: { id: string; label: string }[] = [
  { id: "red", label: "빨강" }, { id: "black", label: "검정" }, { id: "odd", label: "홀" }, { id: "even", label: "짝" },
  { id: "low", label: "1–18" }, { id: "high", label: "19–36" }, { id: "dozen1", label: "1–12" }, { id: "dozen2", label: "13–24" }, { id: "dozen3", label: "25–36" },
];

function RouletteView({ state, busy, act }: ViewProps<RouletteState>) {
  const [number, setNumber] = useState(17);
  if (state.done && state.pocket !== null) {
    const pocket = state.pocket, label = pocket === -1 ? "00" : String(pocket);
    const color = pocket <= 0 ? "bg-felt-600" : RED_NUMBERS.has(pocket) ? "bg-ruby" : "bg-ink";
    return (
      <div className="text-center">
        <div className={cx("mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-gold-400 font-deco text-4xl font-bold rise", color)}>{label}</div>
        <p className="mt-3 text-sm">건 곳: {ROULETTE_BETS.find((bet) => bet.id === state.wager)?.label ?? `숫자 ${state.wager?.slice(1)}`}</p>
        <Verdict win={state.payout > 0}>{state.payout > 0 ? `×${rouletteGross(state.wager ?? "red")} 적중` : "구슬이 다른 칸에 멈췄습니다"}</Verdict>
      </div>
    );
  }
  return (
    <div>
      <p className="text-center text-sm text-mist">한 곳에 걸면 딜러가 휠을 돌립니다.</p>
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
    </div>
  );
}

// ── 주사위 포커 ──
function DicePokerView({ state, busy, act }: ViewProps<DicePokerState>) {
  const [hold, setHold] = useState<string>(() => suggestDiceHold(state.player));
  const toggle = (index: number) => setHold((mask) => mask.split("").map((bit, slot) => (slot === index ? (bit === "1" ? "0" : "1") : bit)).join(""));
  if (state.done) {
    return (
      <div className="text-center">
        <p className="text-xs text-mist">딜러 · {state.dealerHand?.label}</p>
        <div className="mt-1 flex justify-center gap-2">{state.dealer?.map((value, index) => <Die key={index} value={value} />)}</div>
        <div className="my-4 h-px bg-gold-400/30" />
        <div className="flex justify-center gap-2">{state.player.map((value, index) => <Die key={index} value={value} red />)}</div>
        <p className="mt-1 text-sm">손님 · <b className="text-gold-200">{state.playerHand?.label}</b></p>
        <Verdict win={state.outcome === "win"} push={state.outcome === "tie"}>{state.outcome === "win" ? "족보가 더 높습니다" : state.outcome === "tie" ? "같은 족보입니다" : "딜러의 족보가 더 높습니다"}</Verdict>
      </div>
    );
  }
  return (
    <div>
      <p className="text-center text-sm text-mist">남길 주사위를 누르세요. 나머지는 한 번 다시 굴립니다. 지금: <b className="text-gold-200">{diceHand(state.player).label}</b></p>
      <div className="mt-4 flex justify-center gap-2">
        {state.player.map((value, index) => <Die key={index} value={value} red held={hold[index] === "1"} onClick={busy ? undefined : () => toggle(index)} />)}
      </div>
      <ActionRow>
        <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void act(`hold:${hold}`)}>{hold === "11111" ? "이대로 승부" : "다시 굴리기"}</button>
        <button type="button" className="btn btn-dark min-h-14" disabled={busy} onClick={() => setHold(suggestDiceHold(state.player))}>딜러의 추천</button>
      </ActionRow>
    </div>
  );
}

// ── 도둑잡기 ──
function OldMaidView({ state, busy, act }: ViewProps<OldMaidState>) {
  const last = state.log;
  return (
    <div>
      <p className="text-center text-xs text-mist">딜러의 패 {state.dealer.length}장 · 한 장을 뽑으세요</p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        {state.dealer.map((_, index) => (
          <button key={index} type="button" disabled={busy || state.done} onClick={() => void act(`pick:${index}`)} aria-label={`딜러의 ${index + 1}번째 카드 뽑기`} className="transition hover:-translate-y-1 disabled:hover:translate-y-0">
            {state.done ? <PlayingCard id={state.dealer[index] ?? null} className="scale-90" /> : <PlayingCard id={null} className="scale-90" />}
          </button>
        ))}
      </div>
      {last.length > 0 && (
        <p className="mt-3 text-center text-sm" aria-live="polite">
          {last.map((entry, index) => (
            <span key={index} className="block">
              {entry.by === "player" ? "손님이" : "딜러가"} {entry.card === JOKER ? "조커를" : "카드를"} 뽑았습니다{entry.paired ? " · 짝을 맞춰 버림" : ""}
            </span>
          ))}
        </p>
      )}
      <div className="my-4 h-px bg-gold-400/30" />
      <p className="text-center text-xs text-mist">손님의 패 {state.hand.length}장</p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">{state.hand.map((id) => <PlayingCard key={id} id={id} className="scale-90" />)}</div>
      {state.done && <Verdict win={state.win}>{state.win ? "조커는 딜러의 손에 남았습니다" : "조커가 손님의 손에 남았습니다"}</Verdict>}
    </div>
  );
}

// ── 포커 ──
function DrawPokerView({ state, busy, act }: ViewProps<DrawPokerState>) {
  const [hold, setHold] = useState<string>(() => suggestPokerHold(state.player));
  const toggle = (index: number) => setHold((mask) => mask.split("").map((bit, slot) => (slot === index ? (bit === "1" ? "0" : "1") : bit)).join(""));
  if (state.done) {
    return (
      <div className="text-center">
        <p className="text-xs text-mist">딜러 · {state.dealerHand?.label}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-1">{state.dealer?.map((id) => <PlayingCard key={id} id={id} className="scale-90" />)}</div>
        <div className="my-4 h-px bg-gold-400/30" />
        <div className="flex flex-wrap justify-center gap-1">{state.player.map((id) => <PlayingCard key={id} id={id} className="scale-90" />)}</div>
        <p className="mt-1 text-sm">손님 · <b className="text-gold-200">{state.playerHand?.label}</b></p>
        <Verdict win={state.outcome === "win"} push={state.outcome === "tie"}>{state.outcome === "win" ? "족보가 더 높습니다" : state.outcome === "tie" ? "같은 족보입니다" : "딜러의 족보가 더 높습니다"}</Verdict>
      </div>
    );
  }
  return (
    <div>
      <p className="text-center text-sm text-mist">남길 카드를 누르세요. 나머지는 한 번 바꿉니다.</p>
      <div className="mt-3 flex flex-wrap justify-center gap-1">
        {state.player.map((id, index) => (
          <button key={id} type="button" disabled={busy} onClick={() => toggle(index)} aria-pressed={hold[index] === "1"} className={cx("rounded-md transition", hold[index] === "1" ? "-translate-y-2 ring-2 ring-gold-400" : "opacity-80")}>
            <PlayingCard id={id} className="scale-90" />
          </button>
        ))}
      </div>
      <ActionRow>
        <button type="button" className="btn btn-gold min-h-14" disabled={busy} onClick={() => void act(`hold:${hold}`)}>{hold === "11111" ? "이대로 승부" : "교환"}</button>
        <button type="button" className="btn btn-dark min-h-14" disabled={busy} onClick={() => setHold(suggestPokerHold(state.player))}>딜러의 추천</button>
      </ActionRow>
    </div>
  );
}
