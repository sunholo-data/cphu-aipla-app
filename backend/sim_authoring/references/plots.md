# Plots with uPlot

For a live graph of the sim's state (x–t, v–t, a–t, p–V, energy against time),
use **uPlot**: fast, small, and its axes, ticks and scaling are right, which is
the part generated graphs most often get wrong. Keep a plain canvas only for
drawings that are not graphs.

## Load it

In `<head>`, exactly:

```html
<script src="/vendor/uplot/1.6.32/uPlot.iife.min.js"
        integrity="sha384-HASH:uPlot.iife.min.js"
        crossorigin="anonymous"></script>
```

It defines the global `uPlot`. Its stylesheet is NOT served: paste this into
your own `<style>` (the CSP blocks external stylesheets):

```css
.uplot, .uplot *, .uplot *::before, .uplot *::after {box-sizing: border-box;}.uplot {font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";line-height: 1.5;width: min-content;}.u-title {text-align: center;font-size: 18px;font-weight: bold;}.u-wrap {position: relative;user-select: none;}.u-over, .u-under {position: absolute;}.u-under {overflow: hidden;}.uplot canvas {display: block;position: relative;width: 100%;height: 100%;}.u-axis {position: absolute;}.u-legend {font-size: 14px;margin: auto;text-align: center;}.u-inline {display: block;}.u-inline * {display: inline-block;}.u-inline tr {margin-right: 16px;}.u-legend th {font-weight: 600;}.u-legend th > * {vertical-align: middle;display: inline-block;}.u-legend .u-marker {width: 1em;height: 1em;margin-right: 4px;background-clip: padding-box !important;}.u-inline.u-live th::after {content: ":";vertical-align: middle;}.u-inline:not(.u-live) .u-value {display: none;}.u-series > * {padding: 4px;}.u-series th {cursor: pointer;}.u-legend .u-off > * {opacity: 0.3;}.u-select {background: rgba(0,0,0,0.07);position: absolute;pointer-events: none;}.u-cursor-x, .u-cursor-y {position: absolute;left: 0;top: 0;pointer-events: none;will-change: transform;}.u-hz .u-cursor-x, .u-vt .u-cursor-y {height: 100%;border-right: 1px dashed #607D8B;}.u-hz .u-cursor-y, .u-vt .u-cursor-x {width: 100%;border-bottom: 1px dashed #607D8B;}.u-cursor-pt {position: absolute;top: 0;left: 0;border-radius: 50%;border: 0 solid;pointer-events: none;will-change: transform;/*this has to be !important since we set inline "background" shorthand */background-clip: padding-box !important;}.u-axis.u-off, .u-select.u-off, .u-cursor-x.u-off, .u-cursor-y.u-off, .u-cursor-pt.u-off {display: none;}
```

## A live plot

```js
const P = window.AIPLA_PHYSICS;
const lang = "da";
const ts = [], xs = [];                       // the data: arrays of equal length
const plot = new uPlot(
  {
    width: Math.min(640, holder.clientWidth),
    height: 220,
    scales: { x: { time: false } },           // ALWAYS: x is seconds, not a date
    axes: [
      { label: "t (s)", values: (u, v) => v.map((x) => P.format(x, 1, lang)) },
      { label: "x (m)", values: (u, v) => v.map((x) => P.format(x, 2, lang)) },
    ],
    series: [{}, { label: "x", stroke: "#1f6feb", width: 2 }],
    legend: { show: false },
  },
  [ts, xs],
  holder,                                     // a <div> inside the sim
);
// in the loop's draw(t):
ts.push(t); xs.push(state.x);
plot.setData([ts, xs]);
// reset: ts.length = 0; xs.length = 0; plot.setData([ts, xs]);
```

- `scales: { x: { time: false } }` always, or the x axis shows clock times.
- **Give the time axis the length of one run** (`range: [0, 4]` for a 4 s
  collision), not uPlot's automatic range: an empty graph otherwise shows an
  axis to 100 s, and a run squeezes into its first few per cent.
- Format tick labels with `P.format` so Danish gets a decimal comma.
- Fixed axis ranges when the student compares runs: `scales: { x: { time: false, range: [0, 5] }, y: { range: [-1, 1] } }`.
- Two quantities: add a series and a second array: `[ts, xs, vs]`.
- Fit the phone: create it at `Math.min(640, holder.clientWidth)` and call
  `plot.setSize({ width, height })` on resize.
- A scatter of measured points (the student's data): `series: [{}, { stroke: "#1f6feb", paths: () => null, points: { size: 7 } }]`.
- Thin the data for long runs: push every 4th step, or cap the arrays (shift the oldest).
