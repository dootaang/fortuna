import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers,
  type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { barsFor, formatPrice, type CoinId, type HourDoc } from "@fortuna/core";
import type { Timestamp } from "firebase/firestore";

/** The chart library shows UTC; shifting by +9h makes its axis read in KST. */
const KST_SECONDS = 9 * 3600;

export interface ChartLine { price: number; color: string; title: string; }
export interface ChartFlag { atMs: number; tone: "up" | "down" | "warn" | "info"; text: string; }

const TONE_COLOR = { up: "#4fc08d", down: "#e06a5c", warn: "#e6c564", info: "#a9bfb4" } as const;

export function PriceChart({ hours, coin, minutes, lines, flags, accent }: {
  hours: readonly HourDoc<Timestamp>[];
  coin: CoinId;
  minutes: number;
  /** Prices in cents. */
  lines: ChartLine[];
  flags: ChartFlag[];
  accent: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const shown = useRef<string>("");
  const lastTime = useRef<number>(0);
  const times = useRef<number[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!box.current) return undefined;
    const created = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#a9bfb4", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(212,175,55,0.07)" }, horzLines: { color: "rgba(212,175,55,0.07)" } },
      rightPriceScale: { borderColor: "rgba(212,175,55,0.25)" },
      timeScale: { borderColor: "rgba(212,175,55,0.25)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "ko-KR", priceFormatter: (price: number) => price.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    });
    series.current = created.addSeries(CandlestickSeries, {
      upColor: "#4fc08d", downColor: "#c4473a", borderVisible: false, wickUpColor: "#4fc08d", wickDownColor: "#c4473a",
      priceLineColor: accent, priceLineWidth: 1,
    });
    markers.current = createSeriesMarkers(series.current, []);
    chart.current = created;
    return () => { created.remove(); chart.current = null; series.current = null; markers.current = null; priceLines.current = []; shown.current = ""; lastTime.current = 0; };
  }, []);

  // Candles: replace on coin/timeframe change; on a new tick only touch bars from the last shown one on,
  // because the library refuses to update anything older than its newest bar.
  useEffect(() => {
    const target = series.current;
    if (!target) return;
    const bars = barsFor(hours, coin, minutes).map((bar) => ({ ...bar, time: (bar.time + KST_SECONDS) as UTCTimestamp })) as CandlestickData<UTCTimestamp>[];
    const key = `${coin}:${minutes}`;
    try {
      if (shown.current !== key) {
        target.setData(bars);
        shown.current = key;
        chart.current?.timeScale().scrollToRealTime();
      } else {
        for (const bar of bars) if (bar.time >= lastTime.current) target.update(bar);
      }
    } catch {
      target.setData(bars);
    }
    lastTime.current = bars.at(-1)?.time ?? 0;
    times.current = bars.map((bar) => bar.time);
    setRevision((value) => value + 1);
  }, [hours, coin, minutes]);

  useEffect(() => {
    const target = series.current;
    if (!target) return;
    for (const line of priceLines.current) target.removePriceLine(line);
    priceLines.current = lines.map((line) => target.createPriceLine({ price: line.price / 100, color: line.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: line.title }));
  }, [JSON.stringify(lines)]);

  // Flags sit on the bar they happened in; flags outside the loaded bars are left out.
  useEffect(() => {
    const bucket = minutes * 60, shownTimes = new Set(times.current);
    const items: SeriesMarker<Time>[] = [...new Set(flags.map((flag) => Math.floor(flag.atMs / 1000 / bucket) * bucket + KST_SECONDS))]
      .filter((time) => shownTimes.has(time))
      .sort((a, b) => a - b)
      .map((time) => {
        const flag = flags.find((entry) => Math.floor(entry.atMs / 1000 / bucket) * bucket + KST_SECONDS === time)!;
        return { time: time as UTCTimestamp, position: "aboveBar" as const, color: TONE_COLOR[flag.tone], shape: "circle" as const, text: "" };
      });
    try { markers.current?.setMarkers(items); } catch { /* a flag the chart cannot place is not worth a crash */ }
  }, [JSON.stringify(flags), minutes, revision]);

  return <div ref={box} className="h-64 w-full sm:h-80" role="img" aria-label={`${coin} 가격 차트, ${minutes}분 봉. 최근가 ${formatPrice(hours.at(-1)?.last.p[coin] ?? 0)}`} />;
}

/** A chart failure shows a note instead of taking the whole page down. */
export class ChartBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: string | null }> {
  override state: { failed: string | null } = { failed: null };
  static getDerivedStateFromError(): { failed: string } { return { failed: "failed" }; }
  override componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: null });
  }
  override render() {
    return this.state.failed
      ? <p className="grid h-64 place-items-center text-sm text-mist sm:h-80">차트를 그리지 못했습니다. 봉 단위를 바꾸거나 새로고침해 주세요.</p>
      : this.props.children;
  }
}
