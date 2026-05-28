"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const G = 9.8;

type GraphType = "xt" | "vt" | "at" | "range" | "height";

const GRAPH_OPTIONS: ReadonlyArray<{ value: GraphType; label: string }> = [
  { value: "xt", label: "Position-Time (x-t)" },
  { value: "vt", label: "Velocity-Time (v-t)" },
  { value: "at", label: "Acceleration-Time (a-t)" },
  { value: "range", label: "Projectile Range vs Angle" },
  { value: "height", label: "Max Height vs Angle" },
];

interface KineBotGraphProps {
  /** Report a graph-type change up to the shared snapshot hook so the
   *  tutor knows which graph the student is studying. */
  onGraphChange: (graphType: string) => void;
}

interface Series {
  xLabel: string;
  yLabel: string;
  xMax: number;
  yMax: number;
  /** Sampled points in data space. */
  pts: Array<{ x: number; y: number }>;
}

function computeSeries(type: GraphType, u: number, a: number): Series {
  const pts: Array<{ x: number; y: number }> = [];
  if (type === "xt") {
    const T = 10;
    for (let i = 0; i <= 100; i++) {
      const t = (T * i) / 100;
      pts.push({ x: t, y: u * t + 0.5 * a * t * t });
    }
    const yMax = Math.max(1, u * T + 0.5 * a * T * T);
    return { xLabel: "t (s)", yLabel: "x (m)", xMax: T, yMax, pts };
  }
  if (type === "vt") {
    const T = 10;
    for (let i = 0; i <= 100; i++) {
      const t = (T * i) / 100;
      pts.push({ x: t, y: u + a * t });
    }
    const yMax = Math.max(1, u + a * T);
    return { xLabel: "t (s)", yLabel: "v (m/s)", xMax: T, yMax, pts };
  }
  if (type === "at") {
    const T = 10;
    pts.push({ x: 0, y: a }, { x: T, y: a });
    return { xLabel: "t (s)", yLabel: "a (m/s²)", xMax: T, yMax: Math.max(1, a * 1.5), pts };
  }
  if (type === "range") {
    for (let deg = 0; deg <= 90; deg++) {
      const th = (deg * Math.PI) / 180;
      pts.push({ x: deg, y: (u * u * Math.sin(2 * th)) / G });
    }
    const yMax = Math.max(1, (u * u) / G);
    return { xLabel: "angle (°)", yLabel: "range (m)", xMax: 90, yMax, pts };
  }
  // height
  for (let deg = 0; deg <= 90; deg++) {
    const th = (deg * Math.PI) / 180;
    pts.push({ x: deg, y: (u * u * Math.sin(th) * Math.sin(th)) / (2 * G) });
  }
  const yMax = Math.max(1, (u * u) / (2 * G));
  return { xLabel: "angle (°)", yLabel: "max height (m)", xMax: 90, yMax, pts };
}

function draw(canvas: HTMLCanvasElement, series: Series) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const m = { l: 44, r: 12, t: 12, b: 30 };
  const iw = cssW - m.l - m.r;
  const ih = cssH - m.t - m.b;

  const grid = "rgba(120,120,140,0.18)";
  const muted = "rgba(100,116,139,0.9)";
  const accent = "#3b82f6";

  const xToPx = (x: number) => m.l + (x / series.xMax) * iw;
  const yToPx = (y: number) => m.t + ih - (y / series.yMax) * ih;

  // gridlines + ticks
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.font = "10px system-ui, sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gx = m.l + (iw * i) / 5;
    ctx.beginPath();
    ctx.moveTo(gx, m.t);
    ctx.lineTo(gx, m.t + ih);
    ctx.stroke();
    ctx.fillText(((series.xMax * i) / 5).toFixed(0), gx - 8, m.t + ih + 16);
    const gy = m.t + (ih * i) / 5;
    ctx.beginPath();
    ctx.moveTo(m.l, gy);
    ctx.lineTo(m.l + iw, gy);
    ctx.stroke();
    ctx.fillText(
      (series.yMax * (1 - i / 5)).toFixed(0),
      6,
      gy + 3,
    );
  }

  // axes
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(m.l, m.t);
  ctx.lineTo(m.l, m.t + ih);
  ctx.lineTo(m.l + iw + m.r - 2, m.t + ih);
  ctx.stroke();

  // axis labels
  ctx.fillStyle = muted;
  ctx.fillText(series.xLabel, m.l + iw / 2 - 18, cssH - 4);
  ctx.save();
  ctx.translate(10, m.t + ih / 2 + 24);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(series.yLabel, 0, 0);
  ctx.restore();

  // curve
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.pts.forEach((p, i) => {
    const px = xToPx(p.x);
    const py = yToPx(Math.max(0, p.y));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

export function KineBotGraph({ onGraphChange }: KineBotGraphProps) {
  const [graphType, setGraphType] = useState<GraphType>("xt");
  const [u, setU] = useState(20);
  const [a, setA] = useState(5);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    draw(c, computeSeries(graphType, u, a));
  }, [graphType, u, a]);

  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  const handleTypeChange = useCallback(
    (next: GraphType) => {
      setGraphType(next);
      onGraphChange(next);
    },
    [onGraphChange],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-2 text-sm font-semibold">Motion graphs</h3>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={graphType}
          onChange={(e) => handleTypeChange(e.target.value as GraphType)}
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
        >
          {GRAPH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <span className="font-mono">u</span>
          <input
            type="number"
            value={u}
            min={1}
            max={50}
            onChange={(e) => setU(Number(e.target.value) || 0)}
            className="w-16 rounded border border-border bg-background px-1.5 py-1 text-right"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="font-mono">a</span>
          <input
            type="number"
            value={a}
            min={0}
            max={20}
            onChange={(e) => setA(Number(e.target.value) || 0)}
            className="w-16 rounded border border-border bg-background px-1.5 py-1 text-right"
          />
        </label>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded border border-border bg-background"
        style={{ height: 220 }}
      />
    </section>
  );
}
