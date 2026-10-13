// The page of a teacher-published sim, ready for the sandbox frame
// (in-app-sim-authoring M6).
//
// Built-in sims are fetched from the sandbox's own /artefacts/ route. A teacher
// sim's frozen page comes from the backend instead, and gets one thing built-in
// sims do not: a CSP that forbids every network call. The sandbox frame inherits
// `connect-src 'self'` from sandbox.html; this meta tag adds `connect-src 'none'`
// on top (policies only ever tighten), so code that slipped past the static gate
// still cannot call anything, the sandbox and our own server included. The rule
// is the security baseline M decided on 2026-10-13: a sim needs no network.

import { fetchWithAuth } from "@/lib/apiClient";

export const TEACHER_SIM_CSP =
  "connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";

const META = `<meta http-equiv="Content-Security-Policy" content="${TEACHER_SIM_CSP}">`;

/** Put the lockdown meta first in <head>, before any script can run. */
export function withTeacherSimLockdown(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + META + html.slice(at);
  }
  // No <head>: the parser opens one for a leading <meta>, so it still applies first.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + META + html.slice(doctype[0].length);
  return META + html;
}

/** `teacher-sims/<id>/<version>` → the backend page route, or null for a built-in path. */
export function teacherSimPageUrl(artefactPath: string): string | null {
  const m = /^teacher-sims\/([a-z0-9-]{1,64})\/(v\d{1,4})$/.exec(artefactPath);
  return m ? `/api/proxy/api/teacher-sims/${m[1]}/${m[2]}/index.html` : null;
}

/** Fetch a published teacher sim's page (student or teacher token) with the lockdown applied. */
export async function loadTeacherSimPage(
  artefactPath: string,
): Promise<string> {
  const url = teacherSimPageUrl(artefactPath);
  if (!url) throw new Error(`not a teacher sim path: ${artefactPath}`);
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`teacher sim page: ${res.status}`);
  return withTeacherSimLockdown(await res.text());
}
