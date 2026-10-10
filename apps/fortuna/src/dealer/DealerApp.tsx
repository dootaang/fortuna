import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { GoogleAuthProvider, signInWithPopup, signOut, type User } from "firebase/auth";
import { type Timestamp } from "firebase/firestore";
import { DEFAULT_ECONOMY, DEFAULT_NOTIFY, normalizeEconomy, normalizeNotify, type EconomyConfig, type NotifyConfig, type Wallet } from "@fortuna/core";
import { refs, friendlyError, type DistrictDoc, type PlayerDoc, type PoolDoc, type Session } from "@fortuna/data";
import { auth, clock, db, usingEmulators } from "../firebase.ts";
import { useAuthUser } from "../session/auth.ts";
import { useLiveDoc, useLiveQuery, type Row } from "../session/live.ts";
import { Frame, Notice, Splash, cx } from "../ui/kit.tsx";
import { Overview } from "./Overview.tsx";
import { Players } from "./Players.tsx";
import { LedgerView } from "./LedgerView.tsx";
import { Districts } from "./Districts.tsx";
import { ShopAdmin } from "./ShopAdmin.tsx";
import { VaultAdmin } from "./VaultAdmin.tsx";
import { Settings } from "./Settings.tsx";

export interface DealerData {
  session: Session;
  players: Row<PlayerDoc>[];
  wallets: Map<string, Wallet<Timestamp>>;
  districts: Map<string, DistrictDoc>;
  config: EconomyConfig;
  configExists: boolean;
  notify: NotifyConfig;
  vault: PoolDoc | null;
  treasury: PoolDoc | null;
}

const DealerContext = createContext<DealerData | null>(null);
export function useDealer(): DealerData {
  const value = useContext(DealerContext);
  if (!value) throw new Error("useDealer outside dealer");
  return value;
}

export default function DealerApp() {
  const authState = useAuthUser();
  if (authState.status === "loading") return <Splash line="딜러 입구를 확인하는 중…" />;
  const user = authState.user;
  if (!user || user.isAnonymous) return <DealerLogin signedInAsPlayer={Boolean(user?.isAnonymous)} />;
  return <AdminCheck user={user} />;
}

function DealerLogin({ signedInAsPlayer }: { signedInAsPlayer: boolean }) {
  const [error, setError] = useState<string | null>(null);
  async function login() {
    setError(null);
    try {
      if (signedInAsPlayer && !window.confirm("이 브라우저는 플레이어로 연결되어 있습니다. 딜러로 로그인하면 이 기기의 플레이어 연결이 끊어지고, 다시 들어오려면 접속 코드가 필요합니다. 계속할까요?")) return;
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (failure) { setError(friendlyError(failure)); }
  }
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
      <Frame className="w-full text-center">
        <p className="deco-caps">Dealer Entrance</p>
        <h1 className="deco-title mt-1 text-2xl">딜러 입구</h1>
        <p className="mt-3 text-sm text-mist">딜러 계정(Google)으로 로그인하십시오. 허용 목록에 등록된 계정만 관리 화면을 열 수 있습니다.</p>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
        <button type="button" className="btn btn-gold mt-5 w-full" onClick={() => void login()}>Google로 로그인</button>
        <Link to="/" className="btn btn-ghost mt-2 w-full">플레이어 입구로</Link>
      </Frame>
    </main>
  );
}

function AdminCheck({ user }: { user: User }) {
  const admin = useLiveDoc(refs.admin(db, user.uid), `admin:${user.uid}`);
  if (admin.status === "loading") return <Splash line="허용 목록을 확인하는 중…" />;
  if (admin.status === "error" || !admin.data) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-lg place-items-center p-6">
        <Frame className="w-full">
          <h1 className="deco-title text-2xl">딜러 등록이 필요합니다</h1>
          <p className="mt-2 text-sm">{user.email} 계정은 아직 딜러 허용 목록에 없습니다. 아래 순서대로 한 번만 등록하면 됩니다.</p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-mist">
            <li>Firebase 콘솔 › Firestore Database › 데이터 탭을 엽니다.</li>
            <li><b className="text-ivory">컬렉션 시작</b>: 컬렉션 ID <code className="text-gold-200">admins</code></li>
            <li>문서 ID에 아래 UID를 붙여 넣고, 필드는 비워 둔 채 저장합니다.</li>
          </ol>
          <div className="mt-3 flex items-center gap-2 rounded-sm border border-gold-400/40 bg-ink/60 p-2">
            <code className="min-w-0 flex-1 break-all text-sm text-gold-200">{user.uid}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(user.uid)}>복사</button>
          </div>
          <p className="mt-3 text-xs text-mist">저장하면 이 화면이 자동으로 관리 화면으로 바뀝니다.{usingEmulators ? " (에뮬레이터: http://127.0.0.1:4000 에서 같은 방식으로 추가)" : ""}</p>
          <button type="button" className="btn btn-ghost mt-4 w-full" onClick={() => void signOut(auth)}>다른 계정으로 로그인</button>
        </Frame>
      </main>
    );
  }
  return <DealerData uid={user.uid} email={user.email ?? ""} />;
}

function DealerData({ uid, email }: { uid: string; email: string }) {
  const players = useLiveQuery(refs.players(db), "dealer:players");
  const wallets = useLiveQuery(refs.wallets(db), "dealer:wallets");
  const districts = useLiveQuery(refs.districts(db), "dealer:districts");
  const config = useLiveDoc(refs.config(db), "dealer:config");
  const notify = useLiveDoc(refs.notify(db), "dealer:notify");
  const vault = useLiveDoc(refs.vault(db), "dealer:vault");
  const treasury = useLiveDoc(refs.treasury(db), "dealer:treasury");

  const value = useMemo<DealerData>(() => ({
    session: { db, uid, clock },
    players: players.status === "ready" ? [...players.data].sort((a, b) => a.data.name.localeCompare(b.data.name, "ko")) : [],
    wallets: new Map(wallets.status === "ready" ? wallets.data.map((row) => [row.id, row.data]) : []),
    districts: new Map(districts.status === "ready" ? districts.data.map((row) => [row.id, row.data]) : []),
    config: config.status === "ready" && config.data ? normalizeEconomy(config.data) : DEFAULT_ECONOMY,
    configExists: config.status === "ready" && Boolean(config.data),
    notify: notify.status === "ready" && notify.data ? normalizeNotify(notify.data) : DEFAULT_NOTIFY,
    vault: vault.status === "ready" ? vault.data : null,
    treasury: treasury.status === "ready" ? treasury.data : null,
  }), [uid, players, wallets, districts, config, notify, vault, treasury]);

  if (config.status === "loading" || players.status === "loading") return <Splash line="장부를 펼치는 중…" />;
  return <DealerContext.Provider value={value}><DealerShell email={email} /></DealerContext.Provider>;
}

const TABS = [
  { id: "overview", label: "현황" },
  { id: "players", label: "플레이어" },
  { id: "ledger", label: "기록" },
  { id: "districts", label: "구역" },
  { id: "shop", label: "상점·모금" },
  { id: "vault", label: "금고" },
  { id: "settings", label: "설정" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function DealerShell({ email }: { email: string }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((entry) => entry.id === params.get("tab")) ? params.get("tab") : "overview") as TabId;
  const { configExists } = useDealer();
  const pages: Record<TabId, ReactNode> = {
    overview: <Overview />, players: <Players />, ledger: <LedgerView />, districts: <Districts />, shop: <ShopAdmin />, vault: <VaultAdmin />, settings: <Settings />,
  };
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-gold-400/25 bg-felt-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="deco-caps text-[0.6rem]">Dealer · Fortuna{usingEmulators ? " · EMULATOR" : ""}</p>
            <p className="deco-title truncate text-base">딜러 화면</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-mist sm:inline">{email}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut(auth)}>로그아웃</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2" aria-label="딜러 메뉴">
          {TABS.map((entry) => (
            <button key={entry.id} type="button" className={cx("btn btn-sm shrink-0", tab === entry.id ? "btn-gold" : "btn-dark")} onClick={() => setParams({ tab: entry.id })}>{entry.label}</button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        {!configExists && tab !== "settings" && (
          <div className="mb-4"><Notice>도시가 아직 초기화되지 않았습니다. <button type="button" className="underline" onClick={() => setParams({ tab: "settings" })}>설정 › 도시 초기화</button>를 먼저 실행하십시오.</Notice></div>
        )}
        {pages[tab]}
      </main>
    </div>
  );
}

export function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="deco-title text-xl">{title}</h2>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
