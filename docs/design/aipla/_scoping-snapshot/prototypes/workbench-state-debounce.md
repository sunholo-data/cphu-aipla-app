# Design brief: Workbench state debounce

**Status:** Quick fix — implement before next teacher demo  
**Source:** 2026-05-25 meeting feedback: *"the UI feedback to the AI was overwhelming — needs to only take last modified value?"*  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Affects:** All workbench artefacts that emit postMessage state events (currently: Boldkast simulator)

---

## Problem

The current Boldkast workbench fires a `workbench-state` postMessage event on every slider change. If a student drags the v₀ slider from 10 → 25 m/s, the parent frame receives ~15 events in rapid succession, each one injected into the chat context as a human tool-use card. The tutor then has 15 cards to process ("Adjusted v₀ to 11 m/s ✓ · Adjusted v₀ to 12 m/s ✓ · ...") before replying, which:

- Creates visual clutter in the chat (too many cards)
- Bloats the context window sent to the model
- Makes the tutor's acknowledgement of "your last values" confusing

---

## Fix

**Two-part solution: debounce at the workbench + coalesce at the parent frame.**

### Part 1 — Debounce in the workbench artefact

Wrap all slider/input `onChange` handlers with a debounce of **800ms**. Only emit `postMessage` after the user has stopped moving the slider for 800ms.

```javascript
// Replace direct postMessage calls in slider handlers with:
let debounceTimer = null;
function emitWorkbenchState(changedKey, value) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function() {
    window.parent.postMessage({
      type: 'aipla:workbench',
      event: 'state-change',
      changed: changedKey,   // which field changed: 'v0' | 'theta' | 'gravity'
      value: value,          // the final settled value
      unit: unitFor(changedKey)
    }, '*');
  }, 800);
}
```

**Key point:** emit `changed` (which field) + `value` (the settled value), not a full state snapshot. The parent only needs to know what changed and to what.

### Part 2 — Coalesce at the parent frame

In the parent frame's `message` event listener, before creating a human tool-use card, check whether the most recent card for the same field is still pending (not yet sent to the model):

```javascript
const pendingCards = new Map(); // key: changed field, value: card timeout

window.addEventListener('message', function(e) {
  if (e.data.type !== 'aipla:workbench' || e.data.event !== 'state-change') return;

  const { changed, value, unit } = e.data;
  
  // Cancel any pending card for this field
  if (pendingCards.has(changed)) {
    clearTimeout(pendingCards.get(changed));
  }
  
  // Schedule a new card (300ms delay lets rapid changes coalesce)
  const timer = setTimeout(function() {
    pendingCards.delete(changed);
    createToolUseCard(changed, value, unit);
    // Only inject into chat context after card appears
    injectIntoContext(changed, value, unit);
  }, 300);
  
  pendingCards.set(changed, timer);
});
```

### Result

A student dragging v₀ from 10 → 25 m/s produces **exactly one card**: "Adjusted v₀ to 25 m/s ✓". The intermediate values never reach the chat or the model.

---

## Apply to LED Planck and KineBot

When wiring postMessage events into LED Planck and KineBot (per their integration briefs), apply the same debounce pattern from the start:

- LED Planck: voltage slider in Part 1, LED colour selector in Part 2
- KineBot: all sim parameter sliders, graph type selector, topic selector

**Default debounce values:**
- Continuous sliders (dragging): 800ms
- Discrete selectors (click to change): 0ms debounce (fire immediately, no intermediate values)

---

## Checklist

- [ ] Boldkast simulator: wrap slider handlers with 800ms debounce
- [ ] Boldkast simulator: emit `changed` + `value` (not full state snapshot)
- [ ] Parent frame: coalesce pending cards per field before display
- [ ] Parent frame: only inject into model context after card is displayed
- [ ] Verify: dragging v₀ slider produces 1 card, not N
- [ ] Verify: changing gravity preset (discrete) fires immediately
- [ ] Apply same pattern in LED Planck and KineBot integration
