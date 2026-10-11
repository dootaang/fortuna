import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { GAMES, GAME_CONTENT, GAME_IDS, TEXT, limitReachedText, periodWords, replayWager, usesLeft, wagerTrace, type GameId, type Venue } from "@fortuna/core";
import { friendlyError, openBet, sealStep, settleBet } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, Notice, PageTitle, cx, useAction, useToast } from "../ui/kit.tsx";
import { Counter } from "../fx/Counter.tsx";
import { celebrate, shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { ms, wait } from "../fx/settings.ts";
import { summarize } from "./summaries.ts";
import { GameView } from "./views.tsx";
import { landingMs, minRollMs, winSize, type Phase } from "./staging.ts";
import { relay } from "../relay.ts";

interface Finished { bet: number; payout: number; }
interface Stage { wagerId: string | null; shownStep: number; phase: Phase; action: string | null; since: number; }

const IDLE: Stage = { wagerId: null, shownStep: 0, phase: "idle", action: null, since: 0 };

export default function TablePage() {
  const { venue: venueParam, game: gameParam } = useParams();
  const { session, wallet, config, notify } = usePlayer();
  const venue: Venue | null = venueParam === "house" ? "house" : venueParam === "alley" ? "alley" : null;
  const game = GAME_IDS.includes(gameParam as GameId) ? (gameParam as GameId) : null;
  const toast = useToast();
  const open = wallet.openWager && wallet.openWager.game === game && wallet.openWager.venue === venue ? wallet.openWager : null;
  const [stage, setStage] = useState<Stage>(IDLE);
  // The finished hand stays on the felt under the result until the next bet.
  const [board, setBoard] = useState<{ state: unknown; params: unknown; previous: unknown } | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleTry, setSettleTry] = useState(0);
  const settling = useRef(false);
  const table = useRef<HTMLDivElement>(null);

  const trace = useMemo(() => { try { return open ? wagerTrace(open) : null; } catch { return null; } }, [open]);
  const replayTo = (steps: number) => {
    if (!open || !trace || !game) return null;
    try { return replayWager(GAMES[game], open.bet, open.params, { ...trace, actions: trace.actions.slice(0, steps), timesMs: trace.timesMs.slice(0, steps) }); } catch { return null; }
  };

  // A new (or resumed) wager: show it as it stands; a fresh one gets its opening deal.
  useEffect(() => {
    if (!open || open.wagerId === stage.wagerId || !game) return;
    setFinished(null); setBoard(null); setSettleError(null);
    const opening = open.stepCount === 0;
    setStage({ wagerId: open.wagerId, shownStep: open.stepCount, phase: opening ? "landing" : "idle", action: null, since: performance.now() });
  }, [open?.wagerId]);

  const current = stage.wagerId !== null && stage.wagerId === open?.wagerId;
  const shown = useMemo(() => (current ? replayTo(stage.shownStep) : null), [current, stage.shownStep, trace]);
  const previous = useMemo(() => (current && stage.shownStep > 0 ? replayTo(stage.shownStep - 1) : null), [current, stage.shownStep, trace]);

  // rolling → landing once the sealed step is back and the minimum suspense has passed.
  useEffect(() => {
    if (stage.phase !== "rolling" || !open || open.stepCount <= stage.shownStep || !game) return undefined;
    let cancelled = false;
    const remaining = ms(minRollMs(game, shown)) - (performance.now() - stage.since);
    void wait(Math.max(0, remaining)).then(() => {
      if (cancelled) return;
      setStage((now) => ({ ...now, shownStep: open.stepCount, phase: "landing", since: performance.now() }));
    });
    return () => { cancelled = true; };
  }, [stage.phase, open?.stepCount]);

  // landing → idle after the game's reveal time.
  useEffect(() => {
    if (stage.phase !== "landing" || !game) return undefined;
    const duration = ms(landingMs(game, previous, shown, stage.shownStep === 0));
    const timer = window.setTimeout(() => setStage((now) => ({ ...now, phase: "idle", action: null })), duration);
    return () => window.clearTimeout(timer);
  }, [stage.phase, stage.shownStep]);

  const done = Boolean(shown && game && GAMES[game].isDone(shown));

  // Settle once the final reveal has played.
  useEffect(() => {
    if (!done || stage.phase !== "idle" || !open || settling.current || finished || !game || !venue) return;
    settling.current = true; setSettleError(null);
    // Keep the final hand on the felt even after the wallet snapshot drops the open wager.
    setBoard({ state: shown, params: open.params, previous });
    void (async () => {
      try {
        await wait(ms(350));
        const result = await settleBet(session, (final) => summarize(game, final), notify.bigGamble);
        setFinished({ bet: result.bet, payout: result.payout });
        react(result.bet, result.payout);
        if (venue === "house" && Math.abs(result.payout - result.bet) >= notify.bigGamble) relay(notify.relayUrl, result.ledgerId);
      } catch (error) {
        setSettleError(friendlyError(error));
      } finally { settling.current = false; }
    })();
  }, [done, stage.phase, open?.wagerId, settleTry]);

  function react(bet: number, payout: number) {
    const size = winSize(bet, payout);
    if (size > 0) { celebrate(size as 1 | 2 | 3); cue(size >= 2 ? "bigWin" : "win", size); if (size === 3) shake(table.current, 8, 420); }
    else if (payout < bet) { cue("lose"); shake(table.current, 3, 220); }
    else cue("push");
  }

  if (!venue || !game) return <Navigate to="/alley" replace />;
  const info = GAME_CONTENT[game], backTo = venue === "house" ? "/house" : "/alley";
  const other = wallet.openWager && !open ? wallet.openWager : null;

  if (other) {
    return (
      <div>
        <PageTitle title={info.title} />
        <Notice>{TEXT.gamble.resume}</Notice>
        <Link to={`/table/${other.venue}/${other.game}`} className="btn btn-gold mt-4 w-full">{GAME_CONTENT[other.game].title} 이어서 하기</Link>
      </div>
    );
  }

  async function act(action: string) {
    if (stage.phase !== "idle") return;
    cue("tap");
    setStage((now) => ({ ...now, phase: "rolling", action, since: performance.now() }));
    try { await sealStep(session, action); }
    catch (error) { toast("error", friendlyError(error)); setStage((now) => ({ ...now, phase: "idle", action: null })); }
  }

  const lost = finished !== null && finished.payout < finished.bet;
  // One felt for the live hand and the finished one, so nothing remounts (and re-deals) at the end.
  const view = open && shown
    ? { state: shown, previous, params: open.params, phase: stage.phase, action: stage.action, live: true }
    : board ? { state: board.state, previous: board.previous, params: board.params, phase: "idle" as Phase, action: null, live: false } : null;

  return (
    <div>
      <PageTitle eyebrow={venue === "house" ? "THE HOUSE" : "BACK ALLEY"} title={`${info.icon} ${info.title}`} line={info.tagline} />
      <div ref={table}>
        {view ? (
          <Frame className={cx("overflow-hidden", lost && "dim-lose")}>
            {open && (
              <div className="mb-3 flex items-center justify-between text-sm">
                <span>판돈 <Coins value={open.bet} /></span>
                <span className={cx("text-xs", stage.phase === "rolling" ? "text-gold-200" : "text-mist")}>{stage.phase === "rolling" ? TEXT.gamble.sealing : `결정 ${open.stepCount}회 기록됨`}</span>
              </div>
            )}
            <GameView key={stage.wagerId ?? "none"} game={game} state={view.state} previous={view.previous} params={view.params} phase={view.phase} action={view.action} busy={!view.live || stage.phase !== "idle" || done} act={act} />
            {view.live && done && stage.phase === "idle" && !finished && (
              <div className="mt-4">
                {settleError ? (
                  <>
                    <Notice tone="error">{settleError}</Notice>
                    <button type="button" className="btn btn-gold mt-2 w-full" onClick={() => setSettleTry((count) => count + 1)}>정산 다시 시도</button>
                  </>
                ) : <p className="text-center text-sm text-mist">정산 중…</p>}
              </div>
            )}
          </Frame>
        ) : open ? <Notice>판을 불러오는 중…</Notice> : null}
      </div>
      {finished && <ResultPanel finished={finished} venue={venue} onAgain={() => { setFinished(null); setBoard(null); }} backTo={backTo} />}
      {!open && !finished && !board && <BetPanel game={game} venue={venue} enabled={config.gambling.games[game][venue].enabled} />}
      <div className="mt-5"><Rules game={game} /></div>
      <Link to={backTo} className="btn btn-ghost mt-4 w-full">{venue === "house" ? "하우스로" : "뒷골목으로"}</Link>
    </div>
  );
}

function BetPanel({ game, venue, enabled }: { game: GameId; venue: Venue; enabled: boolean }) {
  const { session, wallet, config } = usePlayer();
  const { busy, run } = useAction();
  const max = venue === "house" ? config.gambling.houseMaxBet : config.gambling.alleyMaxBet, min = config.gambling.minBet;
  const presets = [...new Set([min, Math.round(max / 20), Math.round(max / 10), Math.round(max / 4), Math.round(max / 2), max].filter((value) => value >= min))];
  const [bet, setBet] = useState(Math.min(max, Math.max(min, Math.round(max / 4))));
  const left = usesLeft(wallet, config, "gamble", session.clock.now());
  const houseClosed = venue === "house" && !config.gambling.houseOpen;
  const blocked = houseClosed ? TEXT.lobby.houseLocked : !enabled ? "이 테이블은 지금 닫혀 있습니다." : left <= 0 ? limitReachedText(config, "gamble") : wallet.balance < min ? "판돈이 부족합니다." : null;

  return (
    <Frame>
      <p className="deco-caps text-center">{TEXT.gamble.betLabel}</p>
      <p key={bet} className="deco-title my-2 text-center text-4xl punch"><Coins value={bet} /></p>
      <input
        type="range" className="w-full accent-[var(--color-gold-400)]" min={min} max={Math.min(max, Math.max(min, wallet.balance))} step={min}
        value={bet} onChange={(event) => setBet(Number(event.target.value))} aria-label="판돈"
      />
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {presets.map((value) => (
          <button key={value} type="button" className={cx("btn btn-sm", value === bet ? "btn-gold" : "btn-dark")} disabled={value > wallet.balance} onClick={() => { cue("chip"); setBet(value); }}>{value.toLocaleString("ko-KR")}</button>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-mist">{periodWords(config.limitPeriod).now} 남은 판 {left} · 잔액 <Coins value={wallet.balance} /></p>
      {blocked ? <div className="mt-4"><Notice>{blocked}</Notice></div> : (
        <button type="button" className="btn btn-gold mt-4 w-full" disabled={busy || bet > wallet.balance} onClick={() => { cue("chip"); void run(() => openBet(session, game, venue, bet)); }}>
          {busy ? "판을 펴는 중…" : TEXT.gamble.open}
        </button>
      )}
    </Frame>
  );
}

function ResultPanel({ finished, venue, onAgain, backTo }: { finished: Finished; venue: Venue; onAgain: () => void; backTo: string }) {
  const net = finished.payout - finished.bet;
  return (
    <Frame className="mt-3 text-center slide-in-top">
      <p className="deco-caps">{venue === "house" ? "THE HOUSE" : "BACK ALLEY"}</p>
      <p className={cx("deco-title mt-1 text-4xl", net > 0 ? "shimmer-text" : net < 0 ? "!text-[#f2b3aa]" : "")}>{net > 0 ? "승리" : net < 0 ? "패배" : "무승부"}</p>
      <p className={cx("mt-2 text-3xl font-bold", net > 0 ? "text-[#a9ecc9]" : net < 0 ? "text-[#f2b3aa]" : "")}>
        {net > 0 ? "+" : net < 0 ? "−" : "±"}<RollUp value={Math.abs(net)} />
      </p>
      <p className="mt-1 text-sm text-mist">판돈 {finished.bet.toLocaleString("ko-KR")} · 지급 {finished.payout.toLocaleString("ko-KR")}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link to={backTo} className="btn btn-ghost">나가기</Link>
        <button type="button" className="btn btn-gold" onClick={onAgain}>한 판 더</button>
      </div>
    </Frame>
  );
}

/** Counts up from zero once mounted. */
function RollUp({ value }: { value: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => setTarget(value), 60); return () => window.clearTimeout(timer); }, [value]);
  return <Counter value={target} duration={ms(900)} className="!text-inherit ![text-shadow:none]" />;
}

function Rules({ game }: { game: GameId }) {
  return (
    <details className="deco-frame p-4 text-sm">
      <summary className="cursor-pointer font-bold text-gold-200">규칙</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-mist">{GAME_CONTENT[game].rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      <p className="mt-2 text-xs text-mist">모든 결정은 서버 시각으로 기록된 뒤에 결과가 정해집니다. 딜러는 기록을 재생해 판을 검증할 수 있습니다.</p>
    </details>
  );
}
