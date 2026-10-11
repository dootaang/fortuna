import { useEffect, useState } from "react";
import { GAMES, GAME_CONTENT, GAME_IDS, NOTIFY_EVENTS, VENUES, cumulativeCosts, normalizeEconomy, type EconomyConfig, type GameId, type NotifyConfig, type NotifyEvent, type Venue } from "@fortuna/core";
import { limit, orderBy, query, where } from "firebase/firestore";
import { bootstrapCity, refs, saveEconomy, saveNotify } from "@fortuna/data";
import { useLiveQuery } from "../session/live.ts";
import { Empty, Frame, Notice, NumberField, TextField, Toggle, cx, formatDate, useAction } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";
import { relay } from "../relay.ts";

const NOTIFY_LABELS: Record<NotifyEvent, string> = {
  arrival: "새 승객 도착", bigGamble: "하우스의 큰 승패", skill: "특기 결제", shop: "상점 구매 (비밀 내용 제외)", fundFilled: "모금함 달성", liberation: "구역 해방", repaid: "빚 완제", houseOpen: "하우스 개방", pvp: "대결 판 열림·승리",
};

export function Settings() {
  const { config, notify, configExists, session } = useDealer();
  const { busy, run } = useAction();
  return (
    <div className="space-y-6">
      <Frame>
        <SectionTitle title="도시 초기화" />
        <p className="text-sm text-mist">경제 설정, 알림 설정, 구역 상태, 지배인 금고, 공동 지갑 중 없는 것만 기본값으로 만듭니다. 여러 번 눌러도 안전합니다.</p>
        {!configExists && <div className="mt-2"><Notice>처음 한 번은 반드시 실행해야 플레이어가 도착할 수 있습니다.</Notice></div>}
        <button type="button" className="btn btn-gold mt-3" disabled={busy} onClick={() => void run(async () => {
          const created = await bootstrapCity(session);
          window.alert(created.length ? `만들었습니다: ${created.join(", ")}` : "이미 모두 준비되어 있습니다.");
        })}>도시 초기화</button>
      </Frame>
      <EconomyEditor key={JSON.stringify(config)} config={config} />
      <NotifyEditor key={JSON.stringify(notify)} notify={notify} />
    </div>
  );
}

function EconomyEditor({ config }: { config: EconomyConfig }) {
  const { session, notify } = useDealer();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<EconomyConfig>(config);
  const [costsText, setCostsText] = useState(config.skill.costs.slice(1).join(", "));
  const update = (mutate: (next: EconomyConfig) => void) => setDraft((current) => { const next = structuredClone(current); mutate(next); return next; });
  const costs = [0, ...costsText.split(/[,\s]+/).filter(Boolean).map(Number)];
  const costsValid = costs.every((cost) => Number.isSafeInteger(cost) && cost >= 0) && costs.length >= 2;
  const dirty = JSON.stringify(draft) !== JSON.stringify(config) || costs.join() !== config.skill.costs.join();

  function save() {
    const next = normalizeEconomy({ ...draft, skill: { costs, cumulative: cumulativeCosts(costs) } });
    return saveEconomy(session, next, config);
  }

  return (
    <Frame>
      <SectionTitle title="경제 설정">
        <button type="button" className="btn btn-gold btn-sm" disabled={busy || !dirty || !costsValid} onClick={() => void run(save, "저장했습니다. 플레이어 화면에 바로 반영됩니다.").then((eventId) => relay(notify.relayUrl, eventId))}>저장</button>
      </SectionTitle>
      <div className="grid gap-5 lg:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="deco-caps mb-1">횟수 초기화 주기</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="횟수 초기화 주기">
            {(["day", "week"] as const).map((period) => (
              <button key={period} type="button" role="radio" aria-checked={draft.limitPeriod === period} className={cx("btn btn-sm", draft.limitPeriod === period ? "btn-gold" : "btn-dark")} onClick={() => update((next) => { next.limitPeriod = period; })}>
                {period === "day" ? "매일 0시" : "매주 월요일 0시"}
              </button>
            ))}
          </div>
          <legend className="deco-caps mb-1 pt-2">상점</legend>
          <Toggle label="상점 켜기" hint="꺼 두면 플레이어 화면에서 상점이 사라집니다. 품목과 구매 기록은 그대로 남습니다." checked={draft.shopEnabled} onChange={(value) => update((next) => { next.shopEnabled = value; })} />
          <legend className="deco-caps mb-1 pt-2">도착</legend>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="환영 봉투" value={draft.welcome.loan} onChange={(value) => update((next) => { next.welcome.loan = value; })} />
            <NumberField label="기록할 빚" value={draft.welcome.debt} onChange={(value) => update((next) => { next.welcome.debt = value; })} />
            <NumberField label="개찰구 요금" value={draft.welcome.gateFee} onChange={(value) => update((next) => { next.welcome.gateFee = value; })} />
          </div>
          <legend className="deco-caps mb-1 pt-2">추가 대출 (특기 결제 때)</legend>
          <Toggle label="잔액이 모자라면 빌려 주기" checked={draft.borrow.enabled} onChange={(value) => update((next) => { next.borrow.enabled = value; })} />
          <NumberField label="대출 수수료" value={draft.borrow.feeBps / 100} onChange={(value) => update((next) => { next.borrow.feeBps = Math.round(value * 100); })} suffix="%" />
          <legend className="deco-caps mb-1 pt-2">일</legend>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="일 횟수 (주기당)" value={draft.work.limit} onChange={(value) => update((next) => { next.work.limit = value; })} />
            <NumberField label="기본 임금 (표시용)" value={draft.work.baseWage} onChange={(value) => update((next) => { next.work.baseWage = value; })} />
            <NumberField label="최저 임금 (성과 0%)" value={draft.work.wageMin} onChange={(value) => update((next) => { next.work.wageMin = value; })} />
            <NumberField label="최고 임금 (성과 100%)" value={draft.work.wageMax} onChange={(value) => update((next) => { next.work.wageMax = value; })} />
            <NumberField label="임금 단위" value={draft.work.wageStep} onChange={(value) => update((next) => { next.work.wageStep = value; })} />
          </div>
          <p className="text-xs text-mist">구역별 공제율은 구역 탭에서 바꿉니다.</p>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="deco-caps mb-1">도박</legend>
          <Toggle label="하우스 개방" hint="닫혀 있어도 입구는 보입니다. 열면 디스코드에 알립니다." checked={draft.gambling.houseOpen} onChange={(value) => update((next) => { next.gambling.houseOpen = value; })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="판 수 (주기당)" value={draft.gambling.limit} onChange={(value) => update((next) => { next.gambling.limit = value; })} />
            <NumberField label="최소 판돈" value={draft.gambling.minBet} onChange={(value) => update((next) => { next.gambling.minBet = value; })} />
            <NumberField label="뒷골목 1판 최대" value={draft.gambling.alleyMaxBet} onChange={(value) => update((next) => { next.gambling.alleyMaxBet = value; })} />
            <NumberField label="하우스 1판 최대" value={draft.gambling.houseMaxBet} onChange={(value) => update((next) => { next.gambling.houseMaxBet = value; })} />
          </div>
          <legend className="deco-caps mb-1 pt-2">특기 비용표 (1점부터, 쉼표로 구분)</legend>
          <TextField label="1점, 2점, 3점, …" value={costsText} onChange={setCostsText} />
          {!costsValid && <Notice tone="error">숫자만 쉼표로 구분해 입력하십시오.</Notice>}
          <NumberField label="지배인 금고 초기값 (초기화 때만 사용)" value={draft.vaultInitial} onChange={(value) => update((next) => { next.vaultInitial = value; })} />
        </fieldset>
      </div>
      <GameTables draft={draft} update={update} />
    </Frame>
  );
}

function GameTables({ draft, update }: { draft: EconomyConfig; update: (mutate: (next: EconomyConfig) => void) => void }) {
  return (
    <div className="mt-6">
      <p className="deco-caps mb-2">테이블별 설정 (배당 파라미터는 JSON)</p>
      <div className="overflow-x-auto">
        <table className="table min-w-[48rem]">
          <thead><tr><th>게임</th>{VENUES.map((venue) => <th key={venue}>{venue === "alley" ? "뒷골목" : "하우스"}</th>)}</tr></thead>
          <tbody>
            {GAME_IDS.map((id) => (
              <tr key={id}>
                <td className="whitespace-nowrap font-bold">{GAME_CONTENT[id].icon} {GAME_CONTENT[id].title}</td>
                {VENUES.map((venue) => <td key={venue}><TableCell id={id} venue={venue} draft={draft} update={update} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-mist">최대 배수는 파라미터에서 자동 계산되어 보안 규칙의 지급 상한으로 쓰입니다. 기본값으로 되돌리려면 JSON 칸을 비우십시오.</p>
    </div>
  );
}

function TableCell({ id, venue, draft, update }: { id: GameId; venue: Venue; draft: EconomyConfig; update: (mutate: (next: EconomyConfig) => void) => void }) {
  const table = draft.gambling.games[id][venue];
  const [text, setText] = useState(JSON.stringify(table.params));
  const [error, setError] = useState(false);
  useEffect(() => setText(JSON.stringify(table.params)), [table.params]);
  function commit(value: string) {
    setText(value);
    try {
      const raw = value.trim() ? JSON.parse(value) : undefined;
      const params = GAMES[id].params(raw, venue);
      setError(false);
      update((next) => { next.gambling.games[id][venue] = { ...next.gambling.games[id][venue], params, maxMultiplier: GAMES[id].maxMultiplier(params) }; });
    } catch { setError(true); }
  }
  return (
    <div className="space-y-1">
      <Toggle label={table.enabled ? "열림" : "닫힘"} checked={table.enabled} onChange={(value) => update((next) => { next.gambling.games[id][venue].enabled = value; })} />
      <input className={cx("field !min-h-9 font-mono text-xs", error && "!border-ruby")} value={text} onChange={(event) => commit(event.target.value)} aria-label={`${GAME_CONTENT[id].title} ${venue} 파라미터`} />
      <p className="text-[0.7rem] text-mist">최대 ×{table.maxMultiplier.toFixed(2)}</p>
    </div>
  );
}

function NotifyEditor({ notify }: { notify: NotifyConfig }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState(notify);
  const dirty = JSON.stringify(draft) !== JSON.stringify(notify);
  return (
    <Frame>
      <SectionTitle title="디스코드 알림">
        <button type="button" className="btn btn-gold btn-sm" disabled={busy || !dirty} onClick={() => void run(() => saveNotify(session, draft), "저장했습니다.")}>저장</button>
      </SectionTitle>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          {NOTIFY_EVENTS.map((event) => (
            <Toggle key={event} label={NOTIFY_LABELS[event]} checked={draft.enabled[event]} onChange={(value) => setDraft({ ...draft, enabled: { ...draft.enabled, [event]: value } })} />
          ))}
        </div>
        <div className="space-y-3">
          <NumberField label="'큰 승패' 기준 (하우스 순손익)" value={draft.bigGamble} onChange={(value) => setDraft({ ...draft, bigGamble: value })} suffix="코인" />
          <TextField label="중계 주소 (Cloudflare Worker)" value={draft.relayUrl} onChange={(value) => setDraft({ ...draft, relayUrl: value.trim() })} placeholder="https://fortuna-notifier.<계정>.workers.dev" />
          <p className="text-xs text-mist">웹훅 주소 자체는 Worker의 비밀값에만 저장합니다. 이 칸에는 Worker 주소만 넣습니다. 설정 방법은 docs/DEALER-GUIDE.md를 보십시오.</p>
        </div>
      </div>
      <PendingEvents />
    </Frame>
  );
}

const KIND_LABELS: Record<string, string> = { ...NOTIFY_LABELS, houseOpen: "하우스 개방" };

/** Events the relay has not stamped yet: offline players, a missing Worker, or a Discord hiccup. */
function PendingEvents() {
  const { session, notify, players } = useDealer();
  const pending = useLiveQuery(query(refs.events(session.db), where("sentAt", "==", null), orderBy("at", "asc"), limit(30)), "dealer:events:pending");
  const rows = pending.status === "ready" ? pending.data : [];
  const names = new Map(players.map((row) => [row.id, row.data.name]));
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="deco-caps">보내지 못한 알림 {rows.length ? `(${rows.length})` : ""}</p>
        {rows.length > 0 && <button type="button" className="btn btn-dark btn-sm" disabled={!notify.relayUrl} onClick={() => rows.forEach((row) => relay(notify.relayUrl, row.id))}>모두 다시 보내기</button>}
      </div>
      {rows.length === 0 ? <Empty>밀린 알림이 없습니다.</Empty> : (
        <ul className="divide-y divide-gold-400/15 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>{KIND_LABELS[row.data.kind] ?? row.data.kind} · {row.data.playerId ? names.get(row.data.playerId) ?? "" : "딜러"} <span className="text-xs text-mist">{row.data.at ? formatDate(row.data.at.toMillis()) : ""}</span></span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!notify.relayUrl} onClick={() => relay(notify.relayUrl, row.id)}>보내기</button>
            </li>
          ))}
        </ul>
      )}
      {!notify.relayUrl && <p className="mt-2 text-xs text-mist">중계 주소를 저장하면 보낼 수 있습니다.</p>}
    </div>
  );
}
