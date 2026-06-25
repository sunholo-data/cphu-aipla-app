"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { Check, Eraser, PenLine, RotateCcw, Trash2, X } from "lucide-react";

/**
 * SolutionWhiteboard (1.1.48 M2, JB-2) — a freehand drawing surface for the
 * no-paper case: the student sketches their solution (equations, a free-body
 * diagram) and it's exported to an image that rides the same multimodal-turn
 * path as a photo. Custom `<canvas>` + Pointer Events (mouse / touch / stylus);
 * `perfect-freehand` (~4 KB) only smooths the strokes — canvas, events, undo and
 * export are ours. Retina-crisp; `touch-action: none` so drawing never scrolls
 * the page.
 *
 * Stroke-list model (not direct-to-bitmap) so undo is a pop + redraw. The canvas
 * rendering needs a browser — unit tests cover the toolbar + the export wiring.
 */
type StrokePoint = [number, number, number]; // x, y, pressure
interface Stroke {
  color: string;
  size: number;
  points: StrokePoint[];
}

const COLOURS = ["#1e293b", "#dc2626", "#2563eb", "#16a34a"]; // slate, red, blue, green
const PEN_SIZE = 4;
const ERASER_SIZE = 26;
const ERASER_COLOUR = "#ffffff";

function strokePath(s: Stroke): Path2D {
  const outline = getStroke(s.points, { size: s.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
  const path = new Path2D();
  if (outline.length === 0) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) path.lineTo(outline[i][0], outline[i][1]);
  path.closePath();
  return path;
}

export function SolutionWhiteboard({
  onAdd,
  onCancel,
}: {
  /** Called with the exported drawing (PNG on a white background). */
  onAdd: (file: File) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentRef = useRef<Stroke | null>(null);
  const dprRef = useRef(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [colour, setColour] = useState(COLOURS[0]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);
    const all = currentRef.current ? [...strokes, currentRef.current] : strokes;
    for (const s of all) {
      ctx.fillStyle = s.color;
      ctx.fill(strokePath(s));
    }
  }, [strokes]);

  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    redraw();
  }, [redraw]);

  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  useEffect(() => redraw(), [redraw]);

  const point = (e: React.PointerEvent): StrokePoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top, e.pressure || 0.5];
  };
  const down = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    currentRef.current = {
      color: tool === "eraser" ? ERASER_COLOUR : colour,
      size: tool === "eraser" ? ERASER_SIZE : PEN_SIZE,
      points: [point(e)],
    };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (!currentRef.current) return;
    currentRef.current.points.push(point(e));
    redraw();
  };
  const up = () => {
    const done = currentRef.current;
    currentRef.current = null;
    if (done) setStrokes((s) => [...s, done]);
  };

  const add = () => {
    const c = canvasRef.current;
    if (!c) return;
    // Composite onto white so the tutor sees ink-on-paper, not transparency.
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, 0, 0);
    out.toBlob((blob) => {
      if (blob) onAdd(new File([blob], `tegning-${Date.now()}.png`, { type: "image/png" }));
    }, "image/png");
  };

  const hasInk = strokes.length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Tegneværktøjer">
        <ToolBtn label="Pen" active={tool === "pen"} onClick={() => setTool("pen")}>
          <PenLine className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Viskelæder" active={tool === "eraser"} onClick={() => setTool("eraser")}>
          <Eraser className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        {COLOURS.map((col) => (
          <button
            key={col}
            type="button"
            aria-label={`Farve ${col}`}
            aria-pressed={tool === "pen" && colour === col}
            onClick={() => {
              setTool("pen");
              setColour(col);
            }}
            className={`h-5 w-5 rounded-full border ${
              tool === "pen" && colour === col ? "ring-2 ring-offset-1 ring-primary" : "border-border"
            }`}
            style={{ backgroundColor: col }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn label="Fortryd" active={false} onClick={() => setStrokes((s) => s.slice(0, -1))}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Ryd" active={false} onClick={() => setStrokes([])}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label="Tegneflade"
        className="h-64 w-full touch-none rounded border border-border bg-white"
      />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <X className="h-4 w-4" aria-hidden="true" /> Annuller
        </button>
        <button
          type="button"
          onClick={add}
          disabled={!hasInk}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Check className="h-4 w-4" aria-hidden="true" /> Tilføj tegning
        </button>
      </div>
    </div>
  );
}

function ToolBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`rounded p-1.5 hover:bg-muted ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}
