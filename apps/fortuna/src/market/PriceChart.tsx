import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers,
  type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type SeriesType, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { barsFor, bollinger, formatPrice, rsi, sma, type CoinId, type HourDoc } from "@fortuna/core";
import type { Timestamp } from "firebase/firestore";

/** The chart library shows UTC; shifting by +9h makes its axis read in KST. */
const KST_SECONDS = 9 * 3600;

export interface ChartLine { price: number; color: string; title: string; }
export interface ChartFlag { atMs: number; tone: "up" | "down" | "warn" | "info"; text: string; }

const TONE_COLOR = { up: "#4fc08d", down: "#e06a5c", warn: "#e6c564", info: "#a9bfb4" } as const;

/** 보조지표 칩 (docs/SPEC-MARKET-DEPTH.md 2-4). */
export type Indicator = "ma" | "bb" | "vol" | "rsi";
export const INDICATORS: { id: Indicator; label: string; hint: string }[] = [
  { id: "ma", label: "이동평균", hint: "20·60봉 평균. 짧은 선이 긴 선을 뚫고 오르면 흐름이 위로 바뀌는 신호로 본다." },
  { id: "bb", label: "볼린저", hint: "평균 ±2표준편차. 띠가 좁아지면 큰 움직임이 가깝고, 띠 밖은 많이 달린 자리다." },
  { id: "vol", label: "거래량", hint: "주민 군중과 플레이어의 거래량. 거래량을 동반한 돌파가 믿을 만하다." },
  { id: "rsi", label: "RSI", hint: "70 이상은 최근에 많이 올랐다, 30 이하는 많이 내렸다. 흐름이 안 바뀌면 쉬어 가기 쉽다." },
];

export function PriceChart({ hours, coin, minutes, lines, flags, accent, indicators = [] }: {
  hours: readonly HourDoc<Timestamp>[];
  coin: CoinId;
  minutes: number;
  /** Prices in cents. */
  lines: ChartLine[];
  flags: ChartFlag[];
  accent: string;
  indicators?: readonly Indicator[];
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
  const extras = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());

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
    return () => { created.remove(); chart.current = null; series.current = null; markers.current = null; priceLines.current = []; shown.current = ""; lastTime.current = 0; extras.current.clear(); };
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

  // Indicators: recomputed from the loaded bars and redrawn whole (a few hundred points at most).
  useEffect(() => {
    const owner = chart.current;
    if (!owner) return;
    const bars = barsFor(hours, coin, minutes), closes = bars.map((bar) => bar.close), time = (index: number) => (bars[index]!.time + KST_SECONDS) as UTCTimestamp;
    const line = (values: (number | null)[]) => values.flatMap((value, index) => (value === null ? [] : [{ time: time(index), value }]));
    const wanted = new Map<string, () => void>();
    const ensure = (key: string, make: () => ISeriesApi<SeriesType>, fill: (target: ISeriesApi<SeriesType>) => void) => {
      wanted.set(key, () => {
        let target = extras.current.get(key);
        if (!target) { target = make(); extras.current.set(key, target); }
        fill(target);
      });
    };
    const thin = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    if (indicators.includes("ma")) {
      ensure("ma20", () => owner.addSeries(LineSeries, { ...thin, color: "#e6c564" }), (target) => target.setData(line(sma(closes, 20))));
      ensure("ma60", () => owner.addSeries(LineSeries, { ...thin, color: "#7fb7d9" }), (target) => target.setData(line(sma(closes, 60))));
    }
    if (indicators.includes("bb")) {
      const bands = bollinger(closes, 20, 2);
      ensure("bbUp", () => owner.addSeries(LineSeries, { ...thin, color: "rgba(211,95,209,0.7)", lineStyle: LineStyle.Dotted }), (target) => target.setData(line(bands.map((band) => band.upper))));
      ensure("bbLow", () => owner.addSeries(LineSeries, { ...thin, color: "rgba(211,95,209,0.7)", lineStyle: LineStyle.Dotted }), (target) => target.setData(line(bands.map((band) => band.lower))));
    }
    if (indicators.includes("vol")) {
      ensure("vol", () => {
        const made = owner.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
        owner.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        return made as unknown as ISeriesApi<SeriesType>;
      }, (target) => target.setData(bars.map((bar, index) => ({ time: time(index), value: bar.volume, color: bar.close >= bar.open ? "rgba(79,192,141,0.35)" : "rgba(196,71,58,0.35)" }))));
    }
    if (indicators.includes("rsi")) {
      ensure("rsi", () => {
        const made = owner.addSeries(LineSeries, { ...thin, color: "#e6c564", lastValueVisible: true }, 1);
        made.createPriceLine({ price: 70, color: "rgba(224,106,92,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        made.createPriceLine({ price: 30, color: "rgba(79,192,141,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        owner.panes()[1]?.setHeight(80);
        return made as unknown as ISeriesApi<SeriesType>;
      }, (target) => target.setData(line(rsi(closes, 14))));
    }
    try {
      for (const [key, target] of extras.current) if (!wanted.has(key)) { owner.removeSeries(target); extras.current.delete(key); }
      for (const draw of wanted.values()) draw();
    } catch { /* an indicator that cannot be drawn is left out */ }
  }, [hours, coin, minutes, indicators.join(",")]);

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

  return <div ref={box} className={indicators.includes("rsi") ? "h-80 w-full sm:h-96" : "h-64 w-full sm:h-80"} role="img" aria-label={`${coin} 가격 차트, ${minutes}분 봉. 최근가 ${formatPrice(hours.at(-1)?.last.p[coin] ?? 0)}`} />;
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
