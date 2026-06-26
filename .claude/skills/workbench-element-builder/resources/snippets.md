# Trust-wiring snippets

Copy the block matching your element's **interaction shape** (see the decision
table in SKILL.md). `<kind>` is the element's `ElementKind` (e.g. `calculator`).

---

## Shape A — one-shot action (card per action)

The student does one discrete thing (compute, toggle) → one card per action.
Reference: `WorkbenchCalculator.commit`, `ProgressChecklist.toggle`.

```tsx
import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";

const pushState = useSimSnapshotPush<Snapshot>(sessionId, "<kind>");
const humanToolEvents = useHumanToolEvents();
const committedRef = useRef<string>(""); // dedup: skip a commit that didn't change

const commit = useCallback(() => {
  const snap = buildSnapshot(/* current state */);
  const serialised = JSON.stringify(snap);
  if (serialised === committedRef.current) return; // nothing changed
  committedRef.current = serialised;

  const req = pushState(snap, "<kind>.commit"); // passive context, no auto-reply
  if (!req) return;                              // null until session bootstraps

  const label = cardLabel(snap);                 // Danish, names the value; null when nothing meaningful
  if (label) humanToolEvents.dispatch({ label, push: () => req });
  else void req.catch(() => {});                 // still flow the data, no card
}, [/* state deps */, pushState, humanToolEvents]);
```

Catch-up push when `sessionId` arrives (silent — NO card):

```tsx
useEffect(() => {
  if (!sessionId) return;
  const snap = buildSnapshot(/* current state */);
  if (hasMeaningfulState(snap)) {
    const req = pushState(snap, "<kind>.sync");
    if (req) void req.catch(() => {});
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sessionId]);
```

---

## Shape B — continuous entry (ONE debounced card per burst)

A grid of cells: blur fires as the student tabs through, so a per-cell card spams
the chat. Push per cell, but coalesce the card. Reference: `WorkbenchTable`.

```tsx
export const CARD_DEBOUNCE_MS = 1200;

const humanToolEvents = useHumanToolEvents();
const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const pendingCard = useRef<{ req: Promise<Response>; filled: number; title: string } | null>(null);

const flushCard = useCallback(() => {
  const p = pendingCard.current;
  pendingCard.current = null;
  cardTimer.current = null;
  if (!p || p.filled === 0) return;
  const unit = p.filled === 1 ? "felt" : "felter";
  humanToolEvents.dispatch({
    label: `${p.title || "Datatabel"} delt med vejlederen (${p.filled} ${unit})`,
    push: () => p.req,
  });
}, [humanToolEvents]);

useEffect(() => () => { if (cardTimer.current) clearTimeout(cardTimer.current); }, []);

// inside the per-cell commit, after `const req = pushState(snap, "<kind>.commit");`
if (req) {
  void req.catch(() => {});
  pendingCard.current = { req, filled: snap.filledCells, title: snap.title };
  if (cardTimer.current) clearTimeout(cardTimer.current);
  cardTimer.current = setTimeout(flushCard, CARD_DEBOUNCE_MS);
}
```

---

## Shape C — sends a real chat turn (NO card)

The submit IS a visible student message; the tutor's reply is the confirmation.
Reference: `SolutionElementMount`.

```tsx
import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";

const proactiveRef = useOptionalProactiveSimOptsRef();

const submit = useCallback(() => {
  // attachments ride as native multimodal image parts (1.1.7)
  proactiveRef?.current?.onProactiveTrigger("Her er min løsning — giv mig feedback.", attachments);
}, [proactiveRef, attachments]);
```

---

## Test stubs

### Shape A — assert the card dispatches with a labelled value

```tsx
const pushState = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useSimSnapshotPush", () => ({ useSimSnapshotPush: () => pushState }));
const dispatch = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({ useHumanToolEvents: () => ({ dispatch }) }));

it("surfaces a 'shared with the AI' card naming the value (trust bit)", () => {
  render(<YourElement sessionId="sess-1" /* ... */ />);
  // ...drive the interaction, then blur/commit...
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0].label).toMatch(/<expected value>/);
  expect(typeof dispatch.mock.calls[0][0].push).toBe("function"); // reuses the in-flight req
});

it("does not card while incomplete / on a no-op commit", () => {
  render(<YourElement sessionId="sess-1" /* ... */ />);
  // ...partial interaction...
  expect(pushState).toHaveBeenCalled();   // state still synced
  expect(dispatch).not.toHaveBeenCalled(); // but no card
});

afterEach(() => { pushState.mockClear(); dispatch.mockClear(); });
```

### Shape B — assert ONE debounced card per burst (fake timers)

```tsx
import { CARD_DEBOUNCE_MS } from "../YourElement";

it("surfaces ONE debounced card per editing burst, not per cell", () => {
  vi.useFakeTimers();
  try {
    render(<YourElement sessionId="sess-1" /* ... */ />);
    // ...fill + blur two cells...
    expect(dispatch).not.toHaveBeenCalled();        // still inside the window
    vi.advanceTimersByTime(CARD_DEBOUNCE_MS + 100);
    expect(dispatch).toHaveBeenCalledTimes(1);       // coalesced
  } finally {
    vi.useRealTimers();
  }
});
```
