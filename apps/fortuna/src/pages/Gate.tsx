import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { signInAnonymously } from "firebase/auth";
import { TEXT } from "@fortuna/core";
import { bindAccessCode, friendlyError } from "@fortuna/data";
import { auth, clock, db } from "../firebase.ts";
import { Frame, Notice, Ornament } from "../ui/kit.tsx";

export function Gate({ revoked }: { revoked: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(revoked ? TEXT.gate.revoked : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try {
      const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
      await bindAccessCode({ db, uid: user.uid, clock }, code);
    } catch (failure) {
      setError(friendlyError(failure));
    } finally { setBusy(false); }
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
              value={code} onChange={(event) => setCode(event.target.value)} placeholder="FRT-XXXX-XXXX-XXXX"
              autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode="text"
            />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" className="btn btn-gold w-full" disabled={busy || !code.trim()}>{busy ? "확인 중…" : TEXT.gate.submit}</button>
        </form>
      </Frame>
      <p className="mt-6 text-center text-xs text-mist">{TEXT.greeting} · <Link to="/dealer" className="underline-offset-2 hover:underline">딜러 입구</Link></p>
    </main>
  );
}
