// Seed the AIPLA how-to guides into the platform itself: the guide PDFs go into
// the SHARED curriculum corpus under an "AIPLA guides" subject, and an onboarding
// class carries concept-dialogue tutors (teacher / student / researcher)
// grounded in them. This makes the guides QUERYABLE from inside AIPLA ("how do I
// create a class?"), dogfooding the product.
//
// Run via the wrapper (staleness gate, SA token, the env's URL):
//   make seed-guide-corpus ENV=dev|test|prod            # dry run
//   make seed-guide-corpus ENV=dev|test|prod GO=1       # write
// Or directly:  BASE_URL=… GUIDE_ADMIN_TOKEN=… [GO=1] node scripts/seed-guide-corpus.mjs
//
// Since 2026-10-26 this calls the SA-allowlisted /api/admin/guide-corpus/* routes
// (backend/admin/guide_corpus.py), which do the work server-side through the
// same code paths as the teacher routes. The teacher routes it used to call now
// refuse a test teacher, rightly — see the wrapper's header.
//
//   GO=1            write. Anything else is a DRY RUN (the server defaults to
//                   one too): it reports add / replace / reingest / unchanged /
//                   removed without extracting text or touching the RAG corpus.
//   GUIDE_SLUGS     comma-separated slugs: seed ONLY these. A subset run never
//                   prunes — the guides it leaves out were not part of it.
//   GUIDE_EXCLUDE   comma-separated slugs to leave out (an unreleased guide,
//                   e.g. GUIDE_EXCLUDE=t5-introduce-the-tutor on an env whose
//                   frontend does not serve it yet). A full run prunes an
//                   excluded guide that an earlier run seeded.
//
// IDEMPOTENT. Guides are matched by title, and the server compares the PDF's
// hash with what it holds: a second run over the same PDFs writes nothing, a
// changed PDF replaces the old doc (the old one is removed only once the new one
// is readable), a guide whose RAG upload had failed is re-ingested.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// No default: BASE_URL is resolved live per env by the wrapper. A hardcoded
// fallback is what once made "seed the guides" mean "seed DEV's guides".
const BASE = process.env.BASE_URL;
if (!BASE) {
  console.error("BASE_URL is required (use: make seed-guide-corpus ENV=dev|test|prod).");
  process.exit(1);
}
const TOKEN = process.env.GUIDE_ADMIN_TOKEN;
if (!TOKEN) {
  console.error("GUIDE_ADMIN_TOKEN is required (an SA ID token; the wrapper mints it).");
  process.exit(1);
}
const GO = process.env.GO === "1";
const DRY = !GO;
const list = (v) =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const ONLY = list(process.env.GUIDE_SLUGS);
const EXCLUDE = list(process.env.GUIDE_EXCLUDE);

// Seed the PUBLISHED PDFs — the committed bytes /guides links, printed from the
// guide pages (`make guides-pdf`), so corpus, page and download are one source.
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "public", "guides");
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const ADMIN = "/api/proxy/api/admin/guide-corpus";

const GUIDES = [
  { slug: "t1-set-up-a-class", title: "AIPLA guide — T1: Set up a class", aud: "teacher" },
  { slug: "t2-create-your-first-activity", title: "AIPLA guide — T2: Create your first activity", aud: "teacher" },
  { slug: "t3-add-curriculum-materials", title: "AIPLA guide — T3: Add curriculum materials", aud: "teacher" },
  { slug: "t4-author-with-the-copilot", title: "AIPLA guide — T4: Author with the co-pilot", aud: "teacher" },
  { slug: "t5-introduce-the-tutor", title: "AIPLA guide — T5: Introduce the tutor", aud: "teacher" },
  { slug: "s1-join-and-use-your-tutor", title: "AIPLA guide — S1: Join and use your tutor", aud: "student" },
  { slug: "r1-researcher-onboarding", title: "AIPLA guide — R1: Researcher onboarding", aud: "researcher" },
  { slug: "r2-propose-a-simulation", title: "AIPLA guide — R2: Propose a simulation", aud: "researcher" },
];

const TUTORS = [
  {
    title: "How to use AIPLA (for teachers)",
    audience: "teacher",
    teachingGoal:
      "You are an onboarding helper for teachers new to the AIPLA platform. Answer questions about setting up a class, creating an activity, adding curriculum materials, and using the AI authoring co-pilot, grounded in the AIPLA how-to guides. Be concise and practical, and point to the relevant guide (T1–T4) when it helps.",
  },
  {
    title: "How to use your tutor (for students)",
    audience: "student",
    teachingGoal:
      "You help students who are new to AIPLA. Answer questions about joining with a group code and using the tutor and its workspace, grounded in the AIPLA student guide (S1). Be friendly and brief.",
  },
  {
    title: "Researcher onboarding",
    audience: "researcher",
    teachingGoal:
      "You help researchers new to AIPLA. Answer questions about the cross-teacher observation views (research activity scan, research class view, all-teachers insights, cost) and the rubric experimentation workspace (judge lenses, versioning, running a judge), grounded in the AIPLA researcher guide (R1). Be concise and precise.",
  },
];

// --- choose the guides -------------------------------------------------------
const known = new Set(GUIDES.map((g) => g.slug));
for (const s of [...ONLY, ...EXCLUDE]) {
  if (!known.has(s)) {
    console.error(`Unknown guide slug '${s}'. Known: ${[...known].join(", ")}`);
    process.exit(2);
  }
}
const selected = GUIDES.filter((g) => (ONLY.length ? ONLY.includes(g.slug) : true) && !EXCLUDE.includes(g.slug));
// A missing PDF is an error, never a silent skip: skipping would make a full
// run PRUNE that guide from the env. Leave it out on purpose with GUIDE_EXCLUDE.
const missing = selected.filter((g) => !existsSync(resolve(OUT, `${g.slug}.pdf`)));
if (missing.length) {
  console.error(`No PDF for: ${missing.map((g) => g.slug).join(", ")} (in ${OUT}).`);
  console.error("  Print it (`make guides-pdf`) or leave it out: GUIDE_EXCLUDE=" + missing.map((g) => g.slug).join(","));
  process.exit(2);
}

async function call(path, init) {
  const r = await fetch(BASE + path, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

console.log(`${DRY ? "DRY RUN — nothing will be written (GO=1 to write)" : "WRITING"} on ${BASE}`);
if (EXCLUDE.length) console.log(`  excluded: ${EXCLUDE.join(", ")}`);
if (ONLY.length) console.log(`  subset: ${ONLY.join(", ")} (no prune)`);

console.log("1) Guide documents (shared corpus, subject: AIPLA guides)…");
const docResults = [];
for (const g of selected) {
  const fd = new FormData();
  const buf = readFileSync(resolve(OUT, `${g.slug}.pdf`));
  fd.append("file", new Blob([buf], { type: "application/pdf" }), `${g.slug}.pdf`);
  fd.append("title", g.title);
  fd.append("audience", g.aud);
  fd.append("dryRun", DRY ? "true" : "false");
  const r = await call(`${ADMIN}/doc`, { method: "POST", body: fd });
  docResults.push(r);
  const extra = [
    r.removed.length ? `removes ${r.removed.length} old cop${r.removed.length === 1 ? "y" : "ies"}` : "",
    r.kept.length ? `KEPT ${r.kept.length} old (new copy not readable yet)` : "",
  ]
    .filter(Boolean)
    .join(", ");
  console.log(
    `  ${r.action.padEnd(9)} ${g.title}${r.docId ? ` → ${r.docId}` : ""}${r.ragStatus ? ` [rag ${r.ragStatus}]` : ""}${extra ? ` — ${extra}` : ""}`,
  );
}

console.log("2) Onboarding class + tutors…");
const fin = await call(`${ADMIN}/finalize`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    titles: selected.map((g) => g.title),
    prune: ONLY.length === 0,
    tutors: TUTORS,
    dryRun: DRY,
  }),
});
for (const p of fin.pruned) console.log(`  remove    ${p.title} (${p.docId}) — not in this run's guide set`);
console.log(`  class     ${fin.class.action}${fin.class.classId ? ` ${fin.class.classId}` : ""} (owner ${fin.ownerUid})`);
for (const t of fin.tutors) {
  console.log(
    `  tutor     ${t.action.padEnd(9)} ${t.title}${t.activityId ? ` → ${t.activityId}` : ""} (${t.materials.length} guide doc(s))`,
  );
}
console.log(`  join code ${fin.groupCodes.action} ${JSON.stringify(fin.groupCodes.codes)}`);
if (DRY) {
  console.log("  (tutor actions are computed against the corpus as it stands now; a guide added or");
  console.log("   replaced above re-points its tutor on the real run)");
}
for (const c of fin.legacyClasses) {
  console.warn(
    `\nWARNING: a class named "AIPLA onboarding" owned by a PERSON (uid ${c.ownerUid}, class ${c.classId}) exists —`,
  );
  console.warn("  made by the old test-teacher seed. It is not modified: its tutors cite guide docs this seed");
  console.warn(`  replaces. Active codes: ${JSON.stringify(c.groupCodes)}. Revoke it from the class page once`);
  console.warn("  nobody is using those codes; the platform-owned class above replaces it.");
}

const failed = docResults.filter((r) => r.ragStatus === "failed");
const tally = (a) => docResults.filter((r) => r.action === a).length;
console.log(
  `\n${DRY ? "Would" : "Did"}: add ${tally("add")}, replace ${tally("replace")}, reingest ${tally("reingest")}, ` +
    `unchanged ${tally("unchanged")}, remove ${docResults.reduce((n, r) => n + r.removed.length, 0) + fin.pruned.length}.`,
);
if (!DRY && failed.length) {
  // Never a quiet success for a guide the tutor cannot read. The server
  // retries automatically on a schedule; re-running this also retries.
  console.error(`\n${failed.length} guide(s) are stored but NOT readable by the tutor (ragStatus failed):`);
  for (const r of failed) console.error(`  ${r.title} → ${r.docId}`);
  process.exit(1);
}
