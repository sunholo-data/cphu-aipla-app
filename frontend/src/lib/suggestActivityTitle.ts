/**
 * A name for a new activity, suggested from its teaching goal (the
 * new-activity wizard, 2026-11-12). Local and instant on purpose: there is no
 * backend purpose for activity titles (`chat_title` names a student chat), and
 * a suggestion the teacher can see change as they type is worth more than a
 * better one that arrives after they have moved on.
 *
 * The rule: the goal's first clause, without a leading "Students should
 * <verb> (that)" / "Eleverne skal <verb> (at)", at most six words, with a
 * capital first letter. The caller only ever fills an EMPTY name or one it
 * filled itself, never one the teacher typed.
 */

const MAX_WORDS = 6;

// "Eleverne skal (kunne) forstå, at …" / "Students should understand how …".
// The verb is any word, so the pattern needs no Danish letters of its own.
const LEAD_IN =
  /^(?:eleverne|eleven|students?|the students)\s+(?:skal|should|will|must|can|kan)\s+(?:(?:kunne|be able to)\s+)?\p{L}+\s*,?\s*(?:at|om|hvordan|hvorfor|hvad|that|how|why|what)?\s+/iu;

const CLAUSE_END = /[\n.!?;:,()–—]/;

function firstClause(text: string): string {
  return (text.split(CLAUSE_END)[0] ?? "").trim();
}

export function suggestActivityTitle(goal: string): string {
  const text = goal.trim();
  if (!text) return "";
  const stripped = text.replace(LEAD_IN, "");
  const clause = firstClause(stripped) || firstClause(text);
  const words = clause.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  if (words.length === 0) return "";
  const title = words.join(" ");
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}
