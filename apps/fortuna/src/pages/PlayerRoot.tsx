import { useState } from "react";
import { NavLink, Outlet, Link } from "react-router";
import { signOut } from "firebase/auth";
import { TEXT } from "@fortuna/core";
import { auth } from "../firebase.ts";
import { useAuthUser } from "../session/auth.ts";
import { PlayerProvider, usePlayer, usePlayerBinding } from "../session/player.tsx";
import { Frame, Splash, cx } from "../ui/kit.tsx";
import { Counter } from "../fx/Counter.tsx";
import { FxSettingsButton } from "../fx/FxSettings.tsx";
import { useAutoClaim } from "../pvp/PvpLobby.tsx";
import { Gate, type GateState } from "./Gate.tsx";
import { Arrival } from "./Arrival.tsx";

export function PlayerRoot() {
  const authState = useAuthUser();
  const user = authState.status === "ready" ? authState.user : null;
  const binding = usePlayerBinding(user?.isAnonymous ? user.uid : null);
  // Lives here so the gate keeps its input and error across auth/binding re-renders.
  const gate = useState<GateState>({ code: "", error: null, busy: false });
  if (authState.status === "loading") return <Splash />;
  if (user && !user.isAnonymous) return <DealerSignedIn email={user.email ?? ""} />;
  if (!user || binding.status === "unbound" || gate[0].busy) return <Gate state={gate} revoked={binding.status === "unbound" && binding.reason === "revoked"} />;
  if (binding.status === "loading") return <Splash />;
  return (
    <PlayerProvider value={binding.value}>
      {binding.value.wallet.arrived ? <PlayerShell /> : <Arrival />}
    </PlayerProvider>
  );
}

function DealerSignedIn({ email }: { email: string }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
      <Frame className="w-full text-center">
        <p className="deco-caps">Dealer</p>
        <h1 className="deco-title mt-1 text-2xl">딜러 계정으로 로그인되어 있습니다</h1>
        <p className="mt-2 text-sm text-mist">{email}</p>
        <p className="mt-3 text-sm">플레이어 화면을 확인하려면 다른 브라우저나 시크릿 창에서 접속 코드로 들어오십시오.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link to="/dealer" className="btn btn-gold">딜러 화면</Link>
          <button type="button" className="btn btn-ghost" onClick={() => void signOut(auth)}>로그아웃</button>
        </div>
      </Frame>
    </main>
  );
}

const NAV = [
  { to: "/", label: "로비", icon: "◆", end: true },
  { to: "/work", label: "일터", icon: "⚒" },
  { to: "/alley", label: "도박장", icon: "♠", also: "/house" },
  { to: "/skills", label: "특기", icon: "✦" },
  { to: "/wallet", label: "지갑", icon: "◈" },
];

function PlayerShell() {
  const { wallet, player } = usePlayer();
  useAutoClaim();
  return (
    <div className="with-nav min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-gold-400/25 bg-felt-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-2">
          <Link to="/" className="min-w-0">
            <p className="deco-caps truncate text-[0.6rem]">Fortuna Terminus</p>
            <p className="deco-title truncate text-base leading-tight">{player.name}</p>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
          <Link to="/wallet" className="flex shrink-0 items-center gap-2" aria-label="지갑 보기">
            <span className="chip chip-gold"><span className="coin"><Counter value={wallet.balance} /></span></span>
            {wallet.debt > 0 && <span className="chip chip-ruby">빚 <Counter value={wallet.debt} /></span>}
          </Link>
          <FxSettingsButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-gold-400/30 bg-felt-950/95 backdrop-blur" style={{ paddingBottom: "var(--safe-bottom)" }} aria-label="주요 메뉴">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to} end={item.end ?? false}
                className={({ isActive }) => cx("flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 text-[0.72rem]", isActive || (item.also && window.location.pathname.startsWith(item.also)) ? "text-gold-200" : "text-mist")}
              >
                <span aria-hidden="true" className="text-lg leading-none">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <footer className="mt-10 pb-4 text-center text-xs text-mist/70">
        {TEXT.greeting} · <button type="button" className="underline-offset-2 hover:underline" onClick={() => void signOut(auth)}>이 기기에서 나가기</button>
      </footer>
    </div>
  );
}
