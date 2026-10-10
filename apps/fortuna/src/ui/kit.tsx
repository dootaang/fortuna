import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { friendlyError } from "@fortuna/data";

export function cx(...names: (string | false | null | undefined)[]): string { return names.filter(Boolean).join(" "); }

export function Coins({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  const text = `${signed && value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}`;
  return <span className={cx("coin num", className)}>{text}</span>;
}

export function Ornament({ label = "◆" }: { label?: string }) {
  return <div className="ornament" aria-hidden="true"><span>{label}</span></div>;
}

export function Frame({ children, className, as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={cx("deco-frame p-4 sm:p-5", className)}>{children}</Tag>;
}

export function PageTitle({ eyebrow, title, line }: { eyebrow?: string; title: string; line?: string }) {
  return (
    <header className="mb-5 text-center rise">
      {eyebrow && <p className="deco-caps mb-1">{eyebrow}</p>}
      <h1 className="deco-title text-[1.7rem] leading-tight sm:text-3xl">{title}</h1>
      {line && <p className="mt-2 text-sm text-mist">{line}</p>}
      <div className="mx-auto mt-3 max-w-56"><Ornament /></div>
    </header>
  );
}

export function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: "gold" | "ruby" | "jade" }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-1 text-center">
      <span className="text-[0.72rem] text-mist">{label}</span>
      <span className={cx("text-lg font-bold", tone === "ruby" && "text-[#f2b3aa]", tone === "jade" && "text-[#a9ecc9]", tone === "gold" && "text-gold-200")}>{children}</span>
    </div>
  );
}

export function Splash({ line = "기차가 역에 들어오는 중입니다…" }: { line?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="deco-caps">Fortuna Terminus</p>
        <p className="deco-title mt-2 text-3xl shimmer-text">포르투나</p>
        <p className="mt-3 text-sm text-mist">{line}</p>
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const color = tone === "error" ? "border-ruby/60 text-[#f2b3aa]" : tone === "success" ? "border-jade/50 text-[#a9ecc9]" : "border-gold-400/30 text-ivory";
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-sm border bg-ink/40 px-3 py-2 text-sm", color)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-mist">{children}</p>;
}

/** Modal dialog with focus on open and Escape to close. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4" onClick={onClose}>
      <div
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={cx("deco-frame max-h-[92dvh] w-full overflow-y-auto bg-felt-900 p-5 outline-none rise", wide ? "sm:max-w-2xl" : "sm:max-w-md")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="deco-title text-xl">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── 토스트 ──
interface Toast { id: number; tone: "info" | "error" | "success"; text: string; }
const ToastContext = createContext<(tone: Toast["tone"], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), tone === "error" ? 6_000 : 3_500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => <div key={toast.id} className="pointer-events-auto w-full max-w-md rise"><Notice tone={toast.tone}>{toast.text}</Notice></div>)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }

/** Run an async action with a busy flag; failures become an error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await action();
      if (success) toast("success", success);
      return result;
    } catch (error) {
      toast("error", friendlyError(error));
      return undefined;
    } finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

export function NumberField({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          className="field num" type="number" inputMode="numeric" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step}
          onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
        />
        {suffix && <span className="shrink-0 text-sm text-mist">{suffix}</span>}
      </span>
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, multiline, maxLength }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; maxLength?: number }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea className="field min-h-24" value={value} placeholder={placeholder} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
        : <input className="field" value={value} placeholder={placeholder} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-mist">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full border border-gold-400/50 bg-ink transition peer-checked:bg-gold-500 peer-focus-visible:outline-2 peer-focus-visible:outline-gold-300 after:absolute after:left-0.5 after:top-0.5 after:h-[18px] after:w-[18px] after:rounded-full after:bg-ivory after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(ms);
}
