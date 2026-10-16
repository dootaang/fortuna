import { useEffect, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { DISTRICTS } from "@fortuna/core";
import { shareClue, storyRefs, type ClueCardDoc } from "@fortuna/data";
import { db } from "../firebase.ts";
import { usePlayer } from "../session/player.tsx";
import { Empty, Modal, cx, formatDate, useAction } from "../ui/kit.tsx";
import { useLookups } from "./useCity.ts";

/** 단서 수첩: 딜러가 장면에서 건넨 단서 카드. 뒷면(비밀면)은 가진 사람만 본다. 동료에게 보여 줄 수 있다. */
export function useMyClues(pid: string): (ClueCardDoc & { id: string })[] {
  const [cards, setCards] = useState<(ClueCardDoc & { id: string })[]>([]);
  useEffect(() => onSnapshot(query(storyRefs.cards(db), where("playerId", "==", pid)),
    (snapshot) => setCards(snapshot.docs.map((doc) => ({ ...doc.data({ serverTimestamps: "estimate" }), id: doc.id }))
      .sort((a, b) => (b.givenAt?.toMillis?.() ?? 0) - (a.givenAt?.toMillis?.() ?? 0))), () => setCards([])), [pid]);
  return cards;
}

const districtName = (id: string | null) => (id ? DISTRICTS.find((entry) => entry.id === id)?.name ?? id : "");

export function NotebookModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = usePlayer();
  const { actors } = useLookups();
  const cards = useMyClues(session.pid);
  const [opened, setOpened] = useState<string | null>(null);
  const others = [...actors.values()].filter((row) => row.id !== session.pid);
  return (
    <Modal open={open} onClose={onClose} title="단서 수첩" wide>
      {cards.length === 0 ? <Empty>아직 적힌 단서가 없다. 장면에서 무언가를 찾으면 여기에 남는다.</Empty> : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li key={card.id} className={cx("rounded-sm border bg-ink/40", card.kind === "collateral" ? "border-gold-300/60" : "border-gold-400/25")}>
              <button type="button" className="flex w-full items-baseline justify-between gap-2 p-2.5 text-left" aria-expanded={opened === card.id} onClick={() => setOpened(opened === card.id ? null : card.id)}>
                <span className="min-w-0">
                  <span className="mr-1.5 text-xs text-mist">{card.kind === "collateral" ? "◆ 담보" : "🔎"}{card.district ? ` ${districtName(card.district)}` : ""}</span>
                  <b className="text-gold-200">{card.title}</b>
                </span>
                <span className="shrink-0 text-[0.7rem] text-mist">{card.givenAt ? formatDate(card.givenAt.toMillis()) : ""}</span>
              </button>
              {opened === card.id && <CardBody card={card} others={others.map((row) => ({ id: row.id, name: row.data.name }))} fromName={card.from === "gm" ? "" : actors.get(card.from)?.data.name ?? "동료"} />}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function CardBody({ card, others, fromName }: { card: ClueCardDoc & { id: string }; others: { id: string; name: string }[]; fromName: string }) {
  const { session } = usePlayer();
  const { busy, run } = useAction();
  const [to, setTo] = useState(others[0]?.id ?? "");
  return (
    <div className="space-y-2 border-t border-gold-400/20 p-2.5 text-sm">
      {card.public && <p className="whitespace-pre-line text-ivory/90">{card.public}</p>}
      {card.secret && (
        <div className="rounded-sm border border-[#c4473a]/40 bg-[#c4473a]/10 p-2">
          <p className="deco-caps mb-1 text-[0.6rem] text-[#f2b3aa]">뒷면 — 가진 사람만 읽을 수 있다</p>
          <p className="whitespace-pre-line text-ivory/90">{card.secret}</p>
        </div>
      )}
      {fromName && <p className="text-xs text-mist">{fromName}이(가) 보여 준 단서</p>}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select className="field !w-auto" value={to} onChange={(event) => setTo(event.target.value)} aria-label="보여 줄 사람">
            {others.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <button type="button" className="btn btn-dark btn-sm" disabled={busy || !to} onClick={() => void run(() => shareClue(session, card.clueId, to), "수첩을 펼쳐 보여 주었다.")}>보여 주기</button>
        </div>
      )}
    </div>
  );
}
