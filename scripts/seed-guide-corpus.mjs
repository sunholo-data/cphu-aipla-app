// Seed the AIPLA how-to guides into the platform itself: ingest the rendered
// guide PDFs into the SHARED curriculum corpus under an "AIPLA guides" subject,
// then build an onboarding class with two concept-dialogue tutors (teacher +
// student) grounded in those guides. This makes the guides discoverable and
// QUERYABLE from inside AIPLA ("how do I create a class?"), dogfooding the
// product.
//
// Run via the wrapper (mints token, renders guides):  make seed-guide-corpus
// Or directly:  GUIDE_TEACHER_TOKEN=… node scripts/seed-guide-corpus.mjs
//
// NOT idempotent — re-running ingests duplicate docs / classes. Clean up first
// if re-seeding (the printed ids + the curriculum/activity/class DELETE routes).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE =
  process.env.BASE_URL || "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app";
const TOKEN = process.env.GUIDE_TEACHER_TOKEN;
if (!TOKEN) {
  console.error("GUIDE_TEACHER_TOKEN is required (mint via scripts/mint-test-teacher-token.sh).");
  process.exit(1);
}
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "guides", "_output");
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

async function ingest(file, title) {
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
  console.log(`  ingested + tagged: ${title} → ${doc.docId}`);
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

console.log(`Seeding guide corpus on ${BASE}`);
console.log("1) Ingesting guides into the shared corpus (subject: AIPLA guides)…");
const docs = [];
for (const g of GUIDES) docs.push({ ...g, ...(await ingest(g.file, g.title)) });

console.log("2) Resolving the concept-dialogue skill…");
const skills = await api("/api/proxy/api/skills", { headers: AUTH });
const concept = skills.find((s) => s.name === "concept-dialogue");
if (!concept) throw new Error("concept-dialogue skill not seeded in this env");

console.log("3) Creating the onboarding class…");
const cls = await api("/api/proxy/api/classes", {
  method: "POST",
  headers: JSON_H,
  body: JSON.stringify({
    name: "AIPLA onboarding",
    description: "How to use AIPLA — queryable guides for teachers and students.",
  }),
});

console.log("4) Creating the two tutor activities…");
const teacherActivity = await api("/api/proxy/api/activities", {
  method: "POST",
  headers: JSON_H,
  body: JSON.stringify({
    skillId: concept.skillId,
    classId: cls.classId,
    title: "How to use AIPLA (for teachers)",
    teachingGoal:
      "You are an onboarding helper for teachers new to the AIPLA platform. Answer questions about setting up a class, creating an activity, adding curriculum materials, and using the AI authoring co-pilot, grounded in the AIPLA how-to guides. Be concise and practical, and point to the relevant guide (T1–T4) when it helps.",
    language: "en",
    materials: cite(docs.filter((d) => d.aud === "teacher")),
  }),
});

const studentActivity = await api("/api/proxy/api/activities", {
  method: "POST",
  headers: JSON_H,
  body: JSON.stringify({
    skillId: concept.skillId,
    classId: cls.classId,
    title: "How to use your tutor (for students)",
    teachingGoal:
      "You help students who are new to AIPLA. Answer questions about joining with a group code and using the tutor and its workspace, grounded in the AIPLA student guide (S1). Be friendly and brief.",
    language: "en",
    materials: cite(docs.filter((d) => d.aud === "student")),
  }),
});

const researcherActivity = await api("/api/proxy/api/activities", {
  method: "POST",
  headers: JSON_H,
  body: JSON.stringify({
    skillId: concept.skillId,
    classId: cls.classId,
    title: "Researcher onboarding",
    teachingGoal:
      "You help researchers new to AIPLA. Answer questions about the cross-teacher observation views (research activity scan, research class view, all-teachers insights, cost) and the rubric experimentation workspace (judge lenses, versioning, running a judge), grounded in the AIPLA researcher guide (R1). Be concise and precise.",
    language: "en",
    materials: cite(docs.filter((d) => d.aud === "researcher")),
  }),
});

console.log("5) Minting a group code…");
const groups = await api(`/api/proxy/api/classes/${cls.classId}/groups`, {
  method: "POST",
  headers: JSON_H,
  body: JSON.stringify({ count: 1 }),
});

console.log("\nDone.");
console.log("  class:", cls.classId, `(${cls.name})`);
console.log("  teacher tutor activity:", teacherActivity.activityId);
console.log("  student tutor activity:", studentActivity.activityId);
console.log("  researcher tutor activity:", researcherActivity.activityId);
console.log("  group code(s):", JSON.stringify(groups));
console.log("  guide docs:", docs.map((d) => d.docId).join(", "));
