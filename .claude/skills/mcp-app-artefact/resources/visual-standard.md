# Visual standard

A sim renders inside the AIPLA chat workspace: a **light** surface, roughly
**700px wide** on a laptop and **390px** on a phone. A dark header or a
fixed 900px bench does not read as a styling nit — it reads as a different app
that landed in the wrong container.

## Tokens

Start from this block. `_template` carries it, so a scaffolded sim already has it.

```css
:root {
  --bg:          #ffffff;
  --fg:          #0f172a;   /* slate-900 */
  --muted:       #64748b;   /* slate-500 */
  --border:      #e2e8f0;   /* slate-200 */
  --accent:      #2563eb;   /* blue-600 — physics convention, NOT the KU brand red */
  --accent-soft: #eff6ff;
  --ok:          #16a34a;
  --warn:        #d97706;
  --bad:         #dc2626;
  --surface:     #f8fafc;   /* insets: benches, cells, readouts */
  --mono:        ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

Add sim-specific hues (steel, flame, ice) as further tokens, chosen to sit on
white. Never redefine the base six per-component.

**Why blue, not KU red.** The brand red belongs to the app chrome. Inside a
physics instrument, blue is the convention and red carries meaning (hot, error,
plateau). `scripts/check-brand-literals.sh` scans `.tsx` under `frontend/src`,
so it will not catch a brand-red button in an artefact — that one is on you.

**Boldkast, KineBot and LED-Planck predate this block** and carry their own
palettes. Retrofit when you next touch one; do not "fix" them in passing.

## Rules

### No dark themes, no dark headers

Never `background: #0f172a`, never `linear-gradient(135deg, #0f172a, …)` on a
header. If the sim needs a header at all — many do not, since the host draws the
chrome — it is:

```css
header { padding: 10px 16px; background: #fff; border-bottom: 1px solid var(--border); color: var(--fg); }
```

`audit_artefact.sh` fails on hard-black backgrounds.

### Instrument readouts are light

The green-on-black LCD look is illegible against a white workspace.

```css
.display {
  background: var(--surface); color: var(--fg);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 8px;
  font-family: var(--mono); font-size: 0.9rem;
  text-align: right; font-variant-numeric: tabular-nums;
}
```

`font-variant-numeric: tabular-nums` on every live number — without it a
counting readout jitters as digit widths change.

### Type

- Body **≥14px**, labels and axis ticks **≥11px**, nothing below 11px.
  `0.68rem` is 10.9px and fails.
- Canvas text must be re-drawn on a language change; it is not in the DOM and
  `applyLang()` will not touch it.

### Layout — single column first

```css
main { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px; }
@media (min-width: 720px) { main { grid-template-columns: 1.05fr 1fr; } }
```

- **No `min-width` above 600px** on any container. The 720px breakpoint means
  the ~700px workspace pane gets the single-column layout, which is correct.
- A bench that is inherently wide may scroll **inside its own panel**
  (`overflow: auto`), but the page body must never scroll horizontally.
- Canvases: `canvas { width: 100%; height: auto; display: block; }` and size the
  backing store from `getBoundingClientRect()` × `devicePixelRatio`, redrawing
  on `resize`. A fixed `width="700"` attribute overflows a phone.
- Set `accent-color: var(--accent)` on range inputs, or the browser picks its
  own and it will not be your blue.

### Fit is verified, not asserted

```bash
node .claude/skills/mcp-app-artefact/scripts/verify_sim.mjs <id>
```

reports horizontal overflow at 390 / 700 / 1024px. Whether it *fits* and whether
it is *usable* are different questions — the script answers the first; you answer
the second by looking at the screenshots it writes.

## Things that have actually gone wrong

Each of these shipped once.

| Symptom | Cause |
|---|---|
| A grey line straight across the panel | a "worktop" div as a sibling of the bench with a negative margin. Make it the bench's own `border-bottom` |
| Y-axis title overlapping the tick labels | rotated canvas text drawn too close to right-aligned ticks. Budget ~58px of left padding |
| Water turning grey as it heated | an RGB ramp interpolating toward a neutral. Deepen within the hue instead |
| Orange sliders in a blue sim | no `accent-color` |
| A 1430px grid in a 700px pane | designed on a monitor, never checked at the target width |
| A default-active panel rendering nothing | an empty state nobody designed |
