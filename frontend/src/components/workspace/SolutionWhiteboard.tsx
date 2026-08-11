"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { Check, Download, Eraser, PenLine, RotateCcw, Trash2, Type } from "lucide-react";

import { triggerDownload } from "@/lib/download";

/**
 * SolutionWhiteboard (1.1.48 M2, JB-2) — the PRIMARY solution surface: the
 * student sketches their solution (equations, a free-body diagram) and adds
 * **typed text labels** (e.g. "F_g", "v₀ = 5 m/s"). It exports to an image that
 * rides the same multimodal-turn path as a photo. Custom `<canvas>` + Pointer
 * Events (mouse / touch / stylus); `perfect-freehand` (~4 KB) only smooths the
 * strokes — canvas, events, undo, text and export are ours. Retina-crisp;
 * `touch-action: none` so drawing never scrolls the page.
 *
 * Item-list model (strokes + text), not direct-to-bitmap, so undo is a pop +
 * redraw. Canvas rendering needs a browser — unit tests cover the toolbar +
 * wiring (with `getContext`/`toBlob` stubbed, since jsdom has no canvas).
 *
 * 1.1.73 M3 adds **"Hent tegning"** and stops clearing the board on send, so a
 * drawing is something the student keeps and revises rather than something that
 * only ever existed as a chat attachment.
 */
type StrokePoint = [number, number, number]; // x, y, pressure
interface Stroke {
  kind: "stroke";
  color: string;
  size: number;
  points: StrokePoint[];
}
interface TextItem {
  kind: "text";
  x: number;
  y: number;
  color: string;
  text: string;
}
type Item = Stroke | TextItem;

const COLOURS = ["#1e293b", "#dc2626", "#2563eb", "#16a34a"]; // slate, red, blue, green
const PEN_SIZE = 4;
const ERASER_SIZE = 26;
const ERASER_COLOUR = "#ffffff";
const TEXT_PX = 20;

function strokePath(s: Stroke): Path2D {
  const outline = getStroke(s.points, { size: s.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
  const path = new Path2D();
  if (outline.length === 0) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) path.lineTo(outline[i][0], outline[i][1]);
  path.closePath();
  return path;
}

export function SolutionWhiteboard({ onAdd }: { onAdd: (file: File) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentRef = useRef<Stroke | null>(null);
  const dprRef = useRef(1);
  const [items, setItems] = useState<Item[]>([]);
  const [colour, setColour] = useState(COLOURS[0]);
  const [tool, setTool] = useState<"pen" | "eraser" | "text">("pen");

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);
    ctx.textBaseline = "top";
    ctx.font = `${TEXT_PX}px sans-serif`;
    const all: Item[] = currentRef.current ? [...items, currentRef.current] : items;
    for (const it of all) {
      ctx.fillStyle = it.color;
      if (it.kind === "stroke") ctx.fill(strokePath(it));
      else ctx.fillText(it.text, it.x, it.y);
    }
  }, [items]);

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
    if (tool === "text") {
      const [x, y] = point(e);
      const text = window.prompt("Tekst (fx F_g eller v₀ = 5 m/s)")?.trim();
      if (text) setItems((arr) => [...arr, { kind: "text", x, y, color: colour, text }]);
      return;
    }
    canvasRef.current?.setPointerCapture(e.pointerId);
    currentRef.current = {
      kind: "stroke",
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
    if (done) setItems((arr) => [...arr, done]);
  };

  /** Composite the board onto white so it reads as ink-on-paper rather than
   *  transparency, and hand the PNG to `sink`. Shared by "Tilføj tegning"
   *  (stage it for the tutor) and "Hent tegning" (download it) — one
   *  compositing path, so the file the student keeps is byte-identical to the
   *  one the tutor sees. */
  const composite = (sink: (blob: Blob) => void) => {
    const c = canvasRef.current;
    if (!c) return;
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, 0, 0);
    out.toBlob((blob) => {
      if (blob) sink(blob);
    }, "image/png");
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  // Stage the drawing for the tutor. The board is NOT cleared (1.1.73 M3): it
  // used to be, on the assumption the student was drawing page 2 next — but
  // that silently destroyed the far more common case, revising the diagram you
  // just sent. "Ryd" is one click away when clearing IS what they want.
  const add = () => composite((blob) => onAdd(new File([blob], `tegning-${Date.now()}.png`, { type: "image/png" })));

  // Download the drawing (1.1.73 M3). Before this, a drawing existed only as a
  // chat attachment: the student could not keep it, and after a reload it was
  // not recoverable at all (restored history carries no image bytes).
  const download = () => composite((blob) => triggerDownload(blob, `tegning-${stamp()}.png`));

  const hasInk = items.length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Tegneværktøjer">
        <ToolBtn label="Pen" active={tool === "pen"} onClick={() => setTool("pen")}>
          <PenLine className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Tekst" active={tool === "text"} onClick={() => setTool("text")}>
          <Type className="h-4 w-4" aria-hidden="true" />
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
            aria-pressed={tool !== "eraser" && colour === col}
            onClick={() => {
              if (tool === "eraser") setTool("pen");
              setColour(col);
            }}
            className={`h-5 w-5 rounded-full border ${
              tool !== "eraser" && colour === col ? "ring-2 ring-offset-1 ring-primary" : "border-border"
            }`}
            style={{ backgroundColor: col }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn label="Fortryd" active={false} onClick={() => setItems((s) => s.slice(0, -1))}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Ryd" active={false} onClick={() => setItems([])}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </ToolBtn>
      </div>

      {tool === "text" ? (
        <p className="text-xs text-muted-foreground">Tryk på tavlen for at placere en tekst (fx en formel eller et navn).</p>
      ) : null}

      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label="Tegneflade"
        className="h-64 w-full touch-none rounded border border-border bg-white"
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={download}
          disabled={!hasInk}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" /> Hent tegning
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
