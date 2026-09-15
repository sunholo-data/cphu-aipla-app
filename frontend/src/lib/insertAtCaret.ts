/**
 * Insert text into a controlled input/textarea value at the caret (replacing
 * any selection), returning the new value and where the caret should land.
 *
 * Pure on purpose: React owns the field's value, so the caller sets state with
 * `value` and then restores `caret` on the element AFTER React has re-rendered
 * — set synchronously, the caret is undone by the re-render that writes the new
 * value (see `restoreCaret`). 1.1.118.
 */
export interface CaretInsert {
  value: string;
  caret: number;
}

export function insertAtCaret(
  current: string,
  text: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
): CaretInsert {
  // A field that has never been focused reports null selection — append.
  const start = selectionStart ?? current.length;
  const end = selectionEnd ?? start;
  const value = current.slice(0, start) + text + current.slice(end);
  return { value, caret: start + text.length };
}

/** Re-focus the field and place the caret once React has flushed the new value. */
export function restoreCaret(el: HTMLInputElement | HTMLTextAreaElement | null, caret: number): void {
  if (!el) return;
  const place = () => {
    el.focus();
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      // Some input types (email/number) refuse setSelectionRange; focus is enough.
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(place);
  else place();
}
