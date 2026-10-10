import { useState } from "react";
import { TEXT, arrivalSlip, fill } from "@fortuna/core";
import { arrive } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, Ornament, useAction } from "../ui/kit.tsx";
import { relay } from "../relay.ts";

type Step = "letter" | "envelope" | "receipt";

/** 도착 연출: 지배인의 편지 → 환영 봉투 → 차용증과 개찰구 요금 → 입장. */
export function Arrival() {
  const { session, player, content, config, notify } = usePlayer();
  const [step, setStep] = useState<Step>("letter");
  const { busy, run } = useAction();
  const welcome = config.welcome, slip = arrivalSlip(welcome);
  const values = { name: player.name, district: content.name };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      {step === "letter" && (
        <Frame className="rise bg-[linear-gradient(170deg,#f6edd4,#e9dcb5)] text-ink">
          <p className="deco-caps text-center !text-gold-700">{TEXT.arrival.letterTitle}</p>
          <div className="my-3"><Ornament /></div>
          <div className="space-y-3 font-display text-[0.98rem] leading-7">
            {TEXT.arrival.letter.map((line) => <p key={line}>{fill(line, values)}</p>)}
          </div>
          <p className="mt-5 text-right font-display font-bold">{TEXT.arrival.sign}</p>
          <button type="button" className="btn btn-dark mt-6 w-full" onClick={() => setStep("envelope")}>{TEXT.arrival.accept}</button>
        </Frame>
      )}

      {step === "envelope" && (
        <div className="text-center">
          <button
            type="button" onClick={() => setStep("receipt")}
            className="mx-auto block w-full max-w-xs [animation:envelope_700ms_ease-out_both]"
            aria-label="환영 봉투 열기"
          >
            <div className="deco-frame relative aspect-[3/2] overflow-hidden bg-[linear-gradient(160deg,#1d4d3b,#0a2a1f)]">
              <div className="absolute inset-x-0 top-0 h-1/2 origin-top bg-[linear-gradient(180deg,#0f3d2e,#0a2a1f)] [clip-path:polygon(0_0,100%_0,50%_100%)]" />
              <div className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gold-400 font-deco text-xl font-bold text-ink shadow-lg pulse-gold">F</div>
            </div>
          </button>
          <p className="deco-title mt-5 text-xl">{TEXT.arrival.envelope}</p>
          <p className="mt-1 text-sm text-mist">봉투를 눌러 여십시오.</p>
        </div>
      )}

      {step === "receipt" && (
        <Frame className="rise">
          <h1 className="deco-title text-center text-2xl">{TEXT.arrival.envelope}</h1>
          <div className="my-3"><Ornament /></div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt>{fill(TEXT.arrival.envelopeLine, { amount: welcome.loan })}</dt><dd><Coins value={welcome.loan} signed /></dd></div>
            <div className="flex justify-between gap-3 text-[#f2b3aa]"><dt>{fill(TEXT.arrival.gateLine, { amount: welcome.gateFee })}</dt><dd><Coins value={-welcome.gateFee} /></dd></div>
            <div className="flex justify-between gap-3 border-t border-gold-400/30 pt-2 font-bold"><dt>시작 잔액</dt><dd><Coins value={slip.delta} /></dd></div>
          </dl>
          <div className="mt-4 rounded-sm border border-ruby/50 bg-ink/50 p-3 text-sm">
            <p className="deco-caps !text-[#f2b3aa]">차용증</p>
            <p className="mt-1">{fill(TEXT.arrival.debtLine, { amount: welcome.debt })}</p>
          </div>
          <p className="mt-4 text-center text-sm text-mist">{fill(TEXT.arrival.startLine, { amount: slip.delta })}</p>
          <button type="button" className="btn btn-gold mt-5 w-full" disabled={busy} onClick={() => void run(() => arrive(session)).then((id) => relay(notify.relayUrl, id))}>
            {busy ? "개찰구 통과 중…" : TEXT.arrival.enter}
          </button>
        </Frame>
      )}
    </main>
  );
}
