// Seed the AIPLA how-to guides into the platform itself: ingest the rendered
// guide PDFs into the SHARED curriculum corpus under an "AIPLA guides" subject,
// then build an onboarding class with two concept-dialogue tutors (teacher +
// student) grounded in those guides. This makes the guides discoverable and
// QUERYABLE from inside AIPLA ("how do I create a class?"), dogfooding the
// product.
//
// Run via the wrapper (renders, mints a token, resolves the env's URL):
//   make seed-guide-corpus ENV=dev|test|prod
// Or directly:  BASE_URL=… GUIDE_TEACHER_TOKEN=… node scripts/seed-guide-corpus.mjs
//
// IDEMPOTENT since 2026-08-04. Every step reconciles against what is already
// there — guide docs are matched by title within the "AIPLA guides" subject, the
// class by name, the tutors by title, the group code by "does the class have
// one". Re-running is how you UPDATE a guide: re-render, re-run, and the changed
// PDF replaces the old doc in place rather than adding a second copy.
//
// It was not idempotent before, which is a large part of why it only ever ran
// against dev: seeding test or prod was a one-way door nobody wanted to open.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// No default: BASE_URL is resolved live per env by the wrapper. A hardcoded
// fallback here is what made "seed the guides" mean "seed DEV's guides" — a
// mis-set env would silently re-seed dev instead of failing.
const BASE = process.env.BASE_URL;
if (!BASE) {
  console.error("BASE_URL is required (use: make seed-guide-corpus ENV=dev|test|prod).");
  process.exit(1);
}
const TOKEN = process.env.GUIDE_TEACHER_TOKEN;
if (!TOKEN) {
  console.error("GUIDE_TEACHER_TOKEN is required (mint via scripts/mint-test-teacher-token.sh).");
  process.exit(1);
}
// Seed the PUBLISHED PDFs — the exact bytes the /guides page serves — not the
// gitignored docs/guides/_output render dir. Two reasons: the corpus and the
// static pages then cannot disagree about what a guide says, and seeding stops
// depending on a working local quarto+xelatex toolchain (which is what made
// this un-runnable on a machine without xelatex). Update flow is unchanged:
// `make guides-publish` re-renders and commits, then seed.
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "public", "guides");
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const JSON_H = { ...AUTH, "Content-Type": "application/json" };
const SUBJECT = "AIPLA guides";

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Ingest a guide, replacing every previous copy of the same title.
//
// New-then-delete, deliberately in that order: if the ingest fails we still have
// the old doc, whereas delete-then-ingest would leave the env with no guide at
// all on a transient failure. The docId churns on every run, which is why the
// tutor activities below are always re-pointed at the freshly-returned ids.
//
// `staleIds` is a LIST, not one id: dev was seeded several times while this
// script was non-idempotent, so a title can already have duplicates. Deleting
// only the most recent would leave the older copies cluttering the Materials
// browse forever — this converges instead.
async function ingest(file, title, staleIds = []) {
  const buf = readFileSync(resolve(OUT, file));
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/pdf" }), file);
  fd.append("title", title);
  fd.append("level", "A"); // required field (Danish stx level); guides aren't leveled — the subject facet is what matters
  fd.append("origin", "AIPLA");
  fd.append("topic", "onboarding");
  fd.append("shared", "true");
  fd.append("copyright_status", "cleared");
  const body = await (async () => {
    const r = await fetch(BASE + "/api/proxy/api/curriculum/ingest", { method: "POST", headers: AUTH, body: fd });
    const text = await r.text();
    if (!r.ok) throw new Error(`ingest ${file} → ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  })();
  const doc = body.doc;
  await api(`/api/proxy/api/curriculum/${doc.docId}`, {
    method: "PATCH",
    headers: JSON_H,
    body: JSON.stringify({ subject: SUBJECT }),
  });
  for (const staleId of staleIds) {
    await api(`/api/proxy/api/curriculum/${staleId}`, { method: "DELETE", headers: AUTH });
  }
  if (staleIds.length) {
    console.log(`  replaced: ${title} → ${doc.docId} (removed ${staleIds.length} old copy/copies)`);
  } else {
    console.log(`  ingested + tagged: ${title} → ${doc.docId}`);
  }
  return { docId: doc.docId, origin: doc.origin || "AIPLA" };
}

const GUIDES = [
  { file: "t1-set-up-a-class.pdf", title: "AIPLA guide — T1: Set up a class", aud: "teacher" },
  { file: "t2-create-your-first-activity.pdf", title: "AIPLA guide — T2: Create your first activity", aud: "teacher" },
  { file: "t3-add-curriculum-materials.pdf", title: "AIPLA guide — T3: Add curriculum materials", aud: "teacher" },
  { file: "t4-author-with-the-copilot.pdf", title: "AIPLA guide — T4: Author with the co-pilot", aud: "teacher" },
  { file: "s1-join-and-use-your-tutor.pdf", title: "AIPLA guide — S1: Join and use your tutor", aud: "student" },
  { file: "r1-researcher-onboarding.pdf", title: "AIPLA guide — R1: Researcher onboarding", aud: "researcher" },
];

const cite = (docs) =>
  docs.map((d) => ({ kind: "curriculum", docId: d.docId, origin: d.origin, studentVisible: true }));

const CLASS_NAME = "AIPLA onboarding";

console.log(`Seeding guide corpus on ${BASE}`);

console.log("0) Reading what is already seeded…");
// Match on title within the "AIPLA guides" subject. Title is the stable identity
// here — docIds are minted per ingest, so they cannot be the key.
const existingDocs = await api(
  `/api/proxy/api/curriculum?subject=${encodeURIComponent(SUBJECT)}&scope=shared&limit=200`,
  { headers: AUTH },
);
const docIdsByTitle = new Map();
for (const d of existingDocs.docs || []) {
  docIdsByTitle.set(d.title, [...(docIdsByTitle.get(d.title) || []), d.docId]);
}
console.log(
  `  ${(existingDocs.docs || []).length} guide doc(s) already present across ${docIdsByTitle.size} title(s)`,
);

console.log("1) Ingesting guides into the shared corpus (subject: AIPLA guides)…");
const docs = [];
for (const g of GUIDES) {
  docs.push({ ...g, ...(await ingest(g.file, g.title, docIdsByTitle.get(g.title) || [])) });
}

console.log("2) Resolving the concept-dialogue skill…");
const skills = await api("/api/proxy/api/skills", { headers: AUTH });
const concept = skills.find((s) => s.name === "concept-dialogue");
if (!concept) {
  throw new Error(
    "concept-dialogue skill not seeded in this env — run `make seed-job ENV=<env>` first",
  );
}

console.log("3) Finding or creating the onboarding class…");
const ownClasses = await api("/api/proxy/api/classes", { headers: AUTH });
let cls = (ownClasses.classes || []).find((c) => c.name === CLASS_NAME);
if (cls) {
  console.log(`  reusing existing class ${cls.classId}`);
} else {
  cls = await api("/api/proxy/api/classes", {
    method: "POST",
    headers: JSON_H,
    body: JSON.stringify({
      name: CLASS_NAME,
      description: "How to use AIPLA — queryable guides for teachers and students.",
    }),
  });
  console.log(`  created class ${cls.classId}`);
}

// Upsert a tutor by title. PATCH takes the same full-replace body as POST, so
// both branches send the COMPLETE activity — a partial PATCH here would wipe
// the fields it omitted (the repo's full-overwrite footgun).
const existingActivities = await api("/api/proxy/api/activities", { headers: AUTH });
const activityIdByTitle = new Map((existingActivities || []).map((a) => [a.title, a.activityId]));

async function upsertTutor(title, teachingGoal, aud) {
  const body = JSON.stringify({
    skillId: concept.skillId,
    classId: cls.classId,
    title,
    teachingGoal,
    language: "en",
    materials: cite(docs.filter((d) => d.aud === aud)),
  });
  const existingId = activityIdByTitle.get(title);
  if (existingId) {
    const updated = await api(`/api/proxy/api/activities/${existingId}`, {
      method: "PATCH",
      headers: JSON_H,
      body,
    });
    console.log(`  updated tutor: ${title} → ${existingId}`);
    return updated;
  }
  const created = await api("/api/proxy/api/activities", { method: "POST", headers: JSON_H, body });
  console.log(`  created tutor: ${title} → ${created.activityId}`);
  return created;
}

console.log("4) Upserting the three tutor activities…");
const teacherActivity = await upsertTutor(
  "How to use AIPLA (for teachers)",
  "You are an onboarding helper for teachers new to the AIPLA platform. Answer questions about setting up a class, creating an activity, adding curriculum materials, and using the AI authoring co-pilot, grounded in the AIPLA how-to guides. Be concise and practical, and point to the relevant guide (T1–T4) when it helps.",
  "teacher",
);

const studentActivity = await upsertTutor(
  "How to use your tutor (for students)",
  "You help students who are new to AIPLA. Answer questions about joining with a group code and using the tutor and its workspace, grounded in the AIPLA student guide (S1). Be friendly and brief.",
  "student",
);

const researcherActivity = await upsertTutor(
  "Researcher onboarding",
  "You help researchers new to AIPLA. Answer questions about the cross-teacher observation views (research activity scan, research class view, all-teachers insights, cost) and the rubric experimentation workspace (judge lenses, versioning, running a judge), grounded in the AIPLA researcher guide (R1). Be concise and precise.",
  "researcher",
);

console.log("5) Ensuring the class has a group code…");
// Re-read: the class may have been created moments ago, and a reused one
// already carries codes. Minting unconditionally would hand out a new code on
// every run and quietly grow the list.
const freshClass = await api(`/api/proxy/api/classes/${cls.classId}`, { headers: AUTH });
let groups = freshClass.groupCodes || [];
if (groups.length === 0) {
  const minted = await api(`/api/proxy/api/classes/${cls.classId}/groups`, {
    method: "POST",
    headers: JSON_H,
    body: JSON.stringify({ count: 1 }),
  });
  groups = minted;
  console.log("  minted a group code");
} else {
  console.log(`  class already has ${groups.length} code(s) — leaving them alone`);
}

console.log("\nDone.");
console.log("  env:", BASE);
console.log("  class:", cls.classId, `(${cls.name})`);
console.log("  teacher tutor activity:", teacherActivity.activityId);
console.log("  student tutor activity:", studentActivity.activityId);
console.log("  researcher tutor activity:", researcherActivity.activityId);
console.log("  group code(s):", JSON.stringify(groups));
console.log("  guide docs:", docs.map((d) => d.docId).join(", "));
