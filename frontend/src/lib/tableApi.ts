/** Student data table — load/save the group's cells (1.1.88).
 *
 *  `fetchWithAuth` (the GROUP token), NOT `fetchWithTeacherAuth`: this is a
 *  student workspace surface, and a student calling a teacher-auth helper sends
 *  a null token and gets a 401. The eslint `no-restricted-imports` fence over
 *  `components/workspace` enforces the same thing structurally.
 *
 *  Sibling of `writingApi.ts`, same shape on purpose. The one difference is that
 *  a save sends a PATCH of changed cells rather than the whole grid: two students
 *  filling different rows must not clobber each other, and this client's copy of
 *  the OTHER student's cells is by definition as old as its last read.
 */

import { fetchWithAuth } from "@/lib/apiClient";

/** The group's table state. Cells are keyed `${tableId}::${row}::${colId}` — the
 *  same key the grid has always used locally, so nothing about the client's own
 *  addressing changed to get here. */
export interface TableState {
  cells: Record<string, string>;
  /** Monotonic; a jump means another group member saved from another device. */
  revision: number;
}

const EMPTY: TableState = { cells: {}, revision: 0 };

/** Fetch the group's cells for an activity. Returns an empty state on any
 *  failure — an unreachable store must leave the student able to type, not
 *  staring at an error where their readings should be (Axiom 5). The caller
 *  shows the unsaved state; it never silently pretends a save worked. */
export async function fetchTable(activityId: string): Promise<TableState> {
  try {
    const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/table`);
    if (!resp.ok) return EMPTY;
    const body = await resp.json();
    const cells = body?.cells;
    return {
      cells: cells && typeof cells === "object" ? (cells as Record<string, string>) : {},
      revision: Number(body?.revision ?? 0),
    };
  } catch {
    return EMPTY;
  }
}

/** Save the cells that changed and get back the WHOLE merged grid.
 *
 *  The response carries every group member's readings, which is what the caller
 *  then renders and pushes to the tutor. Returning only an echo of what was sent
 *  is what would leave the AI seeing "the most recently entered values" — the
 *  reported defect — with the store fixed underneath it.
 *
 *  Rejects on a non-2xx so the caller can show an unsaved state rather than a
 *  false saved one. An empty-string value clears that cell.
 */
export async function saveTableCells(
  activityId: string,
  cells: Record<string, string>,
): Promise<TableState> {
  const resp = await fetchWithAuth(`/api/proxy/api/activities/${encodeURIComponent(activityId)}/table`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells }),
  });
  if (!resp.ok) throw new Error(`table save failed: ${resp.status}`);
  const body = await resp.json();
  return {
    cells: body?.cells && typeof body.cells === "object" ? (body.cells as Record<string, string>) : {},
    revision: Number(body?.revision ?? 0),
  };
}
