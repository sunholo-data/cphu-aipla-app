// Gate on the how-to guides' content tree (1.1.116).
//
// The guides used to be Quarto documents published as static HTML, and the CI
// gate on them asked one question: does the published HTML still carry a nav
// band back into the app? That question is answered structurally now — they are
// app pages — so this checks what can still go wrong:
//
//   - front matter the loader requires (it throws at BUILD time otherwise, but
//     the message here names the file and every problem at once)
//   - a `.da.md` whose English twin is missing, or a lang/filename disagreement
//   - the screenshots a guide references actually existing in /public
//   - reviews that have fallen past their own deadline
//   - a guide still pointing at the retired .html/.pdf URLs of its siblings
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const contentRoot = path.join(process.cwd(), "content", "guides");
const publicRoot = path.join(process.cwd(), "public");
const required = [
  "title", "description", "tag", "audience",
  "order", "lang", "status", "owner", "reviewed", "reviewBy",
];
const validStatuses = new Set(["Current", "Provisional", "Historical"]);
const validAudiences = new Set(["teacher", "student", "researcher"]);
const failures = [];

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parse(fileName) {
  const source = readFileSync(path.join(contentRoot, fileName), "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    failures.push(`${fileName}: missing YAML front matter`);
    return null;
  }
  const fields = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      failures.push(`${fileName}: invalid front-matter line: ${line}`);
      continue;
    }
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
  }
  for (const key of required) {
    if (!fields[key]) failures.push(`${fileName}: missing '${key}'`);
  }
  return { fileName, slug: fileName.replace(/\.md$/, ""), fields, body: match[2] };
}

const guides = readdirSync(contentRoot)
  .filter((name) => name.endsWith(".md"))
  .map(parse)
  .filter(Boolean);

if (guides.length === 0) failures.push("no guides found in content/guides/");

const slugs = new Set(guides.map((guide) => guide.slug));
const trackOrders = new Map();
const today = new Date().toISOString().slice(0, 10);

for (const guide of guides) {
  const { fields, fileName, slug, body } = guide;

  if (!validStatuses.has(fields.status)) {
    failures.push(`${fileName}: invalid status '${fields.status}'`);
  }
  if (!validAudiences.has(fields.audience)) {
    failures.push(`${fileName}: invalid audience '${fields.audience}'`);
  }
  if (!/^\d+$/.test(fields.order ?? "")) {
    failures.push(`${fileName}: order must be an integer`);
  }
  // Order is per audience AND language — T1 and S1 are both "1".
  const trackKey = `${fields.audience}/${fields.lang}/${fields.order}`;
  if (trackOrders.has(trackKey)) {
    failures.push(`${fileName}: order ${fields.order} is also used by ${trackOrders.get(trackKey)}`);
  } else {
    trackOrders.set(trackKey, fileName);
  }

  // A `.da.md` that is not marked `lang: da` (or the reverse) silently breaks
  // the language switch — it links a guide to itself.
  const isDanishFile = slug.endsWith(".da");
  if (isDanishFile !== (fields.lang === "da")) {
    failures.push(`${fileName}: filename and 'lang: ${fields.lang}' disagree`);
  }
  if (isDanishFile && !slugs.has(slug.replace(/\.da$/, ""))) {
    failures.push(`${fileName}: Danish guide with no English source`);
  }

  for (const dateField of ["reviewed", "reviewBy"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[dateField] ?? "")) {
      failures.push(`${fileName}: ${dateField} must use YYYY-MM-DD`);
    }
  }
  if (fields.reviewBy && fields.reviewBy < today) {
    failures.push(`${fileName}: review was due ${fields.reviewBy}`);
  }

  // Screenshots are the half of a guide that rots without anyone noticing: a
  // renamed asset leaves a broken image and the prose still reads fine.
  for (const image of body.matchAll(/\]\((\/guides\/assets\/[^)\s]+)\)/g)) {
    if (!existsSync(path.join(publicRoot, image[1]))) {
      failures.push(`${fileName}: missing screenshot ${image[1]}`);
    }
  }
  for (const image of body.matchAll(/\]\((?!\/guides\/assets\/|https?:|\/)([^)\s]+\.(?:png|jpg|jpeg|svg|webp))\)/g)) {
    failures.push(`${fileName}: relative image path '${image[1]}' — use /guides/assets/…`);
  }

  // The Quarto era's own URLs. A guide linking to one would 301 at best and
  // 404 at worst, from inside the surface a new teacher is pointed at first.
  for (const link of body.matchAll(/\/guides\/([a-z0-9-]+(?:\.da)?)\.html/g)) {
    failures.push(`${fileName}: links to the retired /guides/${link[1]}.html — use /guides/${link[1]}`);
  }
}

if (failures.length) {
  console.error(`Guides content check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const byLang = guides.filter((g) => g.fields.lang === "da").length;
console.log(
  `Guides content check passed: ${guides.length - byLang} English + ${byLang} Danish guides, all reviews current.`,
);
