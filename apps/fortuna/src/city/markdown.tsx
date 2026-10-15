import { useState, type ReactNode } from "react";
import { Link } from "react-router";

/**
 * 채팅용 작은 마크다운. 굵게(**), 기울임(* 또는 _), 취소선(~~), 스포일러(||), 코드(`), 인용(>), 줄바꿈만.
 * HTML은 만들지 않고 React 요소로만 그리므로 글에 무엇을 써도 화면을 깨뜨릴 수 없다.
 */
/** `[[일터]]`, `[[거래소:FTN]]`: links to the app's own screens. */
const SHORTCUTS: Record<string, string> = { 일터: "/work", 도박장: "/alley", 하우스: "/house", 거래소: "/market", 특기: "/skills", 지갑: "/wallet", 상점: "/shop", 로비: "/" };
function shortcut(token: string): { to: string; label: string } | null {
  const [name, coin] = token.slice(2, -2).split(":");
  const base = SHORTCUTS[name!];
  if (!base) return null;
  return { to: name === "거래소" && coin && /^[A-Z0-9]{2,6}$/.test(coin) ? `/market/${coin}` : base, label: coin ? `${name} ${coin}` : name! };
}

const INLINE = /(\[\[[^\]\n]{1,20}\]\])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\|\|[^|\n]+\|\|)|(\*[^*\n]+\*)|(_[^_\n]+_)/;

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen(true)} className={open ? "rounded-sm bg-ink/40 px-0.5" : "rounded-sm bg-mist/80 px-0.5 text-transparent"} aria-label={open ? undefined : "가려진 글 보기"}>
      {children}
    </button>
  );
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text, i = 0;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) { out.push(rest); break; }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const token = match[0], k = `${key}.${i++}`;
    if (match[1]) {
      const link = shortcut(token);
      out.push(link ? <Link key={k} to={link.to} className="rounded-sm border border-gold-400/50 px-1 text-gold-200 no-underline hover:bg-gold-400/15">↗ {link.label}</Link> : token);
    }
    else if (match[2]) out.push(<code key={k} className="rounded-sm bg-ink/60 px-1 font-mono text-[0.85em] text-gold-200">{token.slice(1, -1)}</code>);
    else if (match[3]) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    else if (match[4]) out.push(<s key={k}>{inline(token.slice(2, -2), k)}</s>);
    else if (match[5]) out.push(<Spoiler key={k}>{inline(token.slice(2, -2), k)}</Spoiler>);
    else out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n"), blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index]!.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.startsWith(">")) quote.push(lines[index++]!.replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={`q${index}`} className="my-1 border-l-2 border-gold-400/70 bg-ink/40 px-2 py-1 text-gold-50">
          {quote.map((line, n) => <span key={n} className="block">{inline(line, `q${index}.${n}`)}</span>)}
        </blockquote>,
      );
    } else {
      const line = lines[index]!;
      blocks.push(<span key={`l${index}`} className="block min-h-[1em]">{inline(line, `l${index}`)}</span>);
      index += 1;
    }
  }
  return <div className="break-words [word-break:keep-all]">{blocks}</div>;
}
