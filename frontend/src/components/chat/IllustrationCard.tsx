// Illustration card — the svg-illustrator's diagram, shown to the student
// straight from its tool result.
//
// Why a card and not the tutor's text: the illustrator computes the physics and
// checks the render (backend/adk/physics_diagram.py, svg_preview.py), then the
// tutor was asked to paste its ```svg block into the reply. In live runs the
// tutor dropped it two times in three ("Her er en skitse…" — and no sketch). The
// result reaches the client anyway, so it is delivered from there: what the
// student sees is exactly what was checked, and nothing depends on a copy.
// Session replay re-attaches the same SVG to the message text
// (backend/protocols/sessions_route.py), so it survives a reload.

"use client";

import { SVGBlock } from "@/components/chat/media/SVGBlock";

const SVG_FENCE = /```svg\s*([\s\S]*?)```/;
const RAW_SVG = /<svg[\s\S]*?<\/svg>/;

/** The SVG in an svg_illustrator result, or null. The AgentTool result arrives
 *  as `{"result": "<the illustrator's answer>"}`; a bare string is tolerated. */
export function parseIllustrationResult(resultContent: string | null | undefined): string | null {
  if (!resultContent) return null;
  let text = resultContent;
  try {
    const parsed: unknown = JSON.parse(resultContent);
    if (typeof parsed === "string") text = parsed;
    else if (parsed && typeof parsed === "object" && typeof (parsed as { result?: unknown }).result === "string") {
      text = (parsed as { result: string }).result;
    } else return null;
  } catch {
    // not JSON: treat as the answer text itself
  }
  const fenced = SVG_FENCE.exec(text)?.[1];
  const svg = (fenced ?? RAW_SVG.exec(text)?.[0] ?? "").trim();
  return svg.startsWith("<svg") ? svg : null;
}

export function IllustrationCard({ svg }: { svg: string }) {
  return (
    <div className="my-2 rounded-md border border-border bg-background p-2">
      <SVGBlock svgString={svg} />
    </div>
  );
}
