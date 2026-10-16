import { useEffect, useState } from "react";
import { onSnapshot, type Timestamp } from "firebase/firestore";
import { DISTRICTS, FRONT_DISTRICTS, LINES, LINE_IDS, type BookDoc, type BookPage } from "@fortuna/core";
import { storyRefs } from "@fortuna/data";
import { db } from "../firebase.ts";
import { Empty, cx, formatDate } from "../ui/kit.tsx";

/** 지배인의 가죽 장부: 구역마다 네 쪽(+ 파국의 검은 쪽), 승객마다 한 쪽. 지워진 쪽은 흰 종이로 보인다. */
export function useBook(enabled = true): BookDoc<Timestamp> | null {
  const [book, setBook] = useState<BookDoc<Timestamp> | null>(null);
  useEffect(() => (enabled ? onSnapshot(storyRefs.book(db), (snapshot) => setBook(snapshot.data() ?? null), () => setBook(null)) : undefined), [enabled]);
  return book;
}

const nameOf = (id: string) => DISTRICTS.find((entry) => entry.id === id)?.name ?? id;
const colorOf = (id: string) => LINES[LINE_IDS.find((line) => LINES[line].district === id) ?? "wheel"].light;

function Page({ page }: { page: BookPage }) {
  return (
    <li title={page.title} className={cx("ledger-page min-h-[4.2rem] rounded-[2px] border p-1.5 text-[0.68rem] leading-snug",
      page.state === "blank" ? "border-ivory/60 bg-ivory/90 text-ink/40" : page.state === "black" ? "border-[#c4473a] bg-black text-[#f2b3aa]" : "border-[#6b4a2a] bg-[#2a1a0c] text-ivory/85")}>
      <span className={cx(page.state === "blank" && "line-through decoration-ink/30")}>{page.title}</span>
    </li>
  );
}

export function LedgerBook({ book }: { book: BookDoc<Timestamp> | null }) {
  if (!book) return <Empty>장부를 아직 펼칠 수 없다.</Empty>;
  const blank = book.total - book.remaining;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm">지워진 쪽 <b className="text-gold-200">{blank}</b> / {book.total}</p>
        <p className="text-[0.7rem] text-mist">{book.at ? `${formatDate(book.at.toMillis())} 기준` : ""}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#2a1a0c]"><div className="h-full bg-ivory/80" style={{ width: `${book.total ? (blank / book.total) * 100 : 0}%` }} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FRONT_DISTRICTS.map((district) => (
          <section key={district}>
            <p className="mb-1 text-xs font-bold" style={{ color: colorOf(district) }}>{nameOf(district)}의 장</p>
            <ol className="grid grid-cols-4 gap-1">{(book.chapters[district] ?? []).map((page, index) => <Page key={index} page={page} />)}</ol>
          </section>
        ))}
      </div>
      {book.passengers.length > 0 && (
        <section>
          <p className="mb-1 text-xs font-bold text-gold-200">승객의 장</p>
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4">{book.passengers.map((page) => <Page key={page.pid} page={page} />)}</ol>
        </section>
      )}
    </div>
  );
}
