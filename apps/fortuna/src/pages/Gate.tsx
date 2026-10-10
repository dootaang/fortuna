import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Link } from "react-router";
import { signInAnonymously } from "firebase/auth";
import { TEXT } from "@fortuna/core";
import { bindAccessCode, friendlyError } from "@fortuna/data";
import { auth, clock, db } from "../firebase.ts";
import { Frame, Notice, Ornament } from "../ui/kit.tsx";

export interface GateState { code: string; error: string | null; busy: boolean; }

/** State is owned by PlayerRoot so signing in (which re-renders the root) does not wipe it. */
export function Gate({ state: [state, setState], revoked }: { state: [GateState, Dispatch<SetStateAction<GateState>>]; revoked: boolean }) {
  const error = state.error ?? (revoked ? TEXT.gate.revoked : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state.code.trim()) return;
    setState((current) => ({ ...current, busy: true, error: null }));
    try {
      const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
      await bindAccessCode({ db, uid: user.uid, clock }, state.code);
      setState({ code: "", error: null, busy: false });
    } catch (failure) {
      setState((current) => ({ ...current, busy: false, error: friendlyError(failure) }));
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="sunburst -mx-5 mb-6 px-5 pb-8 pt-10 text-center">
        <p className="deco-caps">Fortuna Terminus</p>
        <h1 className="deco-title mt-2 text-[2.4rem] leading-none shimmer-text">{TEXT.city}</h1>
        <p className="mt-3 text-sm text-mist">모든 기차의 종점. 내리는 순간, 기차는 사라집니다.</p>
      </div>
      <Frame className="rise">
        <h2 className="deco-title text-center text-xl">{TEXT.gate.title}</h2>
        <div className="my-3"><Ornament /></div>
        <p className="text-center">{TEXT.gate.prompt}</p>
        <p className="mt-1 text-center text-xs text-mist">{TEXT.gate.hint}</p>
        <form className="mt-5 space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="sr-only">접속 코드</span>
            <input
              className="field text-center font-deco text-lg tracking-[0.2em] uppercase"
              value={state.code} onChange={(event) => setState((current) => ({ ...current, code: event.target.value }))} placeholder="FRT-XXXX-XXXX-XXXX"
              autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode="text"
            />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" className="btn btn-gold w-full" disabled={state.busy || !state.code.trim()}>{state.busy ? "확인 중…" : TEXT.gate.submit}</button>
        </form>
      </Frame>
      <p className="mt-6 text-center text-xs text-mist">{TEXT.greeting} · <Link to="/dealer" className="underline-offset-2 hover:underline">딜러 입구</Link></p>
    </main>
  );
}
