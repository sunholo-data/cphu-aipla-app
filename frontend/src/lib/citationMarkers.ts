/**
 * 1.1.122 — Vertex's RAG chunk labels, e.g. `[rag-source-1]`.
 *
 * Curriculum retrieval runs inside Vertex, which labels each retrieved chunk;
 * the model sometimes copies the label into its answer. The backend strips it
 * (`backend/adk/citation_markers.py`); this is the backstop for turns stored
 * before that fix (~50 on prod) and for anything that slips through. The
 * leading space goes with the marker: "effekt [rag-source-1]." → "effekt.".
 */
const RAG_SOURCE_MARKER_RE = /[ \t]*\[rag-source-\d+\]/g;

export function stripCitationMarkers(text: string): string {
  return text.includes("[rag-source-") ? text.replace(RAG_SOURCE_MARKER_RE, "") : text;
}
