import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { GAMES, GAME_CONTENT, GAME_IDS, TEXT, replayWager, usedThisWeek, wagerTrace, type GameId, type Venue } from "@fortuna/core";
import { friendlyError, openBet, sealStep, settleBet } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, Notice, Ornament, PageTitle, cx, useAction, useToast } from "../ui/kit.tsx";
import { summarize } from "./summaries.ts";
import { GameView } from "./views.tsx";
import { relay } from "../relay.ts";

interface Finished { game: GameId; bet: number; payout: number; state: unknown; params: unknown; }

export default function TablePage() {
  const { venue: venueParam, game: gameParam } = useParams();
  const { session, wallet, config, notify } = usePlayer();
  const venue = venueParam === "house" ? "house" : venueParam === "alley" ? "alley" : null;
  const game = GAME_IDS.includes(gameParam as GameId) ? (gameParam as GameId) : null;
  const toast = useToast();
  const [sealing, setSealing] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const settling = useRef(false);
  const open = wallet.openWager;

  // Rebuild the game from the sealed trace whenever the wallet snapshot changes.
  const live = useMemo(() => {
    if (!open || open.game !== game || open.venue !== venue) return null;
    try {
      const definition = GAMES[open.game];
      const state = replayWager(definition, open.bet, open.params, wagerTrace(open));
      return { state, done: definition.isDone(state) as boolean, params: open.params };
    } catch { return null; } // a step still waiting for its server timestamp
  }, [open, game, venue]);

  const settle = async () => {
    if (settling.current || !game) return;
    settling.current = true; setSettleError(null);
    try {
      const result = await settleBet(session, (final) => summarize(game, final), notify.bigGamble);
      setFinished({ game, bet: result.bet, payout: result.payout, state: live?.state, params: live?.params });
      if (venue === "house" && Math.abs(result.payout - result.bet) >= notify.bigGamble) relay(notify.relayUrl, result.ledgerId);
    } catch (error) {
      setSettleError(friendlyError(error));
    } finally { settling.current = false; }
  };

  // Settle as soon as the sealed replay says the hand is over.
  useEffect(() => { if (live?.done) void settle(); }, [live?.done]);

  if (!venue || !game) return <Navigate to="/alley" replace />;
  const info = GAME_CONTENT[game], table = config.gambling.games[game][venue];
  const backTo = venue === "house" ? "/house" : "/alley";

  if (open && (open.game !== game || open.venue !== venue)) {
    return (
      <div>
        <PageTitle title={info.title} />
        <Notice>{TEXT.gamble.resume}</Notice>
        <Link to={`/table/${open.venue}/${open.game}`} className="btn btn-gold mt-4 w-full">{GAME_CONTENT[open.game].title} 이어서 하기</Link>
      </div>
    );
  }

  async function act(action: string) {
    setSealing(true);
    try { await sealStep(session, action); } catch (error) { toast("error", friendlyError(error)); } finally { setSealing(false); }
  }

  return (
    <div>
      <PageTitle eyebrow={venue === "house" ? "THE HOUSE" : "BACK ALLEY"} title={`${info.icon} ${info.title}`} line={info.tagline} />
      {finished ? (
        <ResultPanel finished={finished} venue={venue} onAgain={() => setFinished(null)} backTo={backTo} />
      ) : open && live ? (
        <Frame>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span>판돈 <Coins value={open.bet} /></span>
            <span className={cx("text-xs", sealing ? "text-gold-200" : "text-mist")}>{sealing ? TEXT.gamble.sealing : `결정 ${open.stepCount}회 봉인됨`}</span>
          </div>
          <GameView game={game} state={live.state} params={live.params} busy={sealing || live.done} act={act} />
          {live.done && (
            <div className="mt-4">
              {settleError ? (
                <>
                  <Notice tone="error">{settleError}</Notice>
                  <button type="button" className="btn btn-gold mt-2 w-full" onClick={() => void settle()}>정산 다시 시도</button>
                </>
              ) : <Notice>딜러가 정산하고 있습니다…</Notice>}
            </div>
          )}
        </Frame>
      ) : open ? (
        <Notice>딜러가 판을 정리하고 있습니다…</Notice>
      ) : (
        <BetPanel game={game} venue={venue} enabled={table.enabled} />
      )}
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
  const left = config.gambling.weeklyLimit - usedThisWeek(wallet, "gamble", session.clock.now());
  const houseClosed = venue === "house" && !config.gambling.houseOpen;
  const blocked = houseClosed ? TEXT.lobby.houseLocked : !enabled ? "이 테이블은 지금 닫혀 있습니다." : left <= 0 ? TEXT.gamble.limitReached : wallet.balance < min ? "판돈이 부족합니다." : null;

  return (
    <Frame>
      <p className="deco-caps text-center">{TEXT.gamble.betLabel}</p>
      <p className="deco-title my-2 text-center text-4xl"><Coins value={bet} /></p>
      <input
        type="range" className="w-full accent-[var(--color-gold-400)]" min={min} max={Math.min(max, Math.max(min, wallet.balance))} step={min}
        value={bet} onChange={(event) => setBet(Number(event.target.value))} aria-label="판돈"
      />
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {presets.map((value) => (
          <button key={value} type="button" className={cx("btn btn-sm", value === bet ? "btn-gold" : "btn-dark")} disabled={value > wallet.balance} onClick={() => setBet(value)}>{value.toLocaleString("ko-KR")}</button>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-mist">이번 주 남은 판 {Math.max(0, left)} · 잔액 <Coins value={wallet.balance} /></p>
      {blocked ? <div className="mt-4"><Notice>{blocked}</Notice></div> : (
        <button type="button" className="btn btn-gold mt-4 w-full" disabled={busy || bet > wallet.balance} onClick={() => void run(() => openBet(session, game, venue, bet))}>
          {busy ? "판을 펴는 중…" : TEXT.gamble.open}
        </button>
      )}
    </Frame>
  );
}

function ResultPanel({ finished, venue, onAgain, backTo }: { finished: Finished; venue: Venue; onAgain: () => void; backTo: string }) {
  const net = finished.payout - finished.bet;
  const line = net > 0 ? TEXT.gamble.win : net < 0 ? TEXT.gamble.lose : TEXT.gamble.push;
  return (
    <Frame className="rise text-center">
      <p className="deco-caps">{venue === "house" ? "THE HOUSE" : "BACK ALLEY"}</p>
      <p className={cx("deco-title mt-2 text-4xl", net > 0 ? "shimmer-text" : net < 0 ? "!text-[#f2b3aa]" : "")}>{net > 0 ? "승리" : net < 0 ? "패배" : "무승부"}</p>
      <div className="my-4"><Ornament /></div>
      <GameView game={finished.game} state={finished.state} params={finished.params} busy act={async () => undefined} />
      <dl className="mx-auto mt-4 max-w-56 space-y-1 text-sm">
        <div className="flex justify-between"><dt>판돈</dt><dd><Coins value={finished.bet} /></dd></div>
        <div className="flex justify-between"><dt>지급</dt><dd><Coins value={finished.payout} /></dd></div>
        <div className="flex justify-between border-t border-gold-400/30 pt-1 font-bold"><dt>손익</dt><dd><Coins value={net} signed /></dd></div>
      </dl>
      <p className="mt-3 text-sm text-mist">{line}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link to={backTo} className="btn btn-ghost">나가기</Link>
        <button type="button" className="btn btn-gold" onClick={onAgain}>한 판 더</button>
      </div>
    </Frame>
  );
}

function Rules({ game }: { game: GameId }) {
  return (
    <details className="deco-frame p-4 text-sm">
      <summary className="cursor-pointer font-bold text-gold-200">규칙</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-mist">{GAME_CONTENT[game].rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      <p className="mt-2 text-xs text-mist">모든 결정은 서버 시각으로 봉인된 뒤에 결과가 정해집니다. 딜러는 기록을 재생해 판을 검증할 수 있습니다.</p>
    </details>
  );
}
