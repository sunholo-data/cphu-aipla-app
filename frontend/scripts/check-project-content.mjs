import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const contentRoot = path.join(process.cwd(), "content", "project");
const required = [
  "title",
  "description",
  "eyebrow",
  "owner",
  "reviewed",
  "reviewBy",
  "status",
  "order",
  "nav",
];
const validStatuses = new Set(["Current", "Provisional", "Historical"]);
const embeddedProjectRoutes = new Set(["demo/boldkast"]);
const failures = [];

function markdownFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute, relative);
    return entry.isFile() && entry.name.endsWith(".md") ? [relative] : [];
  });
}

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

function parse(relativePath) {
  const source = readFileSync(path.join(contentRoot, relativePath), "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    failures.push(`${relativePath}: missing YAML front matter`);
    return null;
  }
  const fields = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      failures.push(`${relativePath}: invalid front-matter line: ${line}`);
      continue;
    }
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
  }
  for (const key of required) {
    if (!fields[key]) failures.push(`${relativePath}: missing '${key}'`);
  }
  return {
    relativePath,
    slug: relativePath.replace(/\.md$/, ""),
    fields,
    body: match[2],
  };
}

const pages = markdownFiles(contentRoot).map(parse).filter(Boolean);
const slugs = new Set(pages.map((page) => page.slug));
const orders = new Map();
const today = new Date().toISOString().slice(0, 10);

for (const page of pages) {
  const { fields, relativePath, body } = page;
  if (!validStatuses.has(fields.status)) {
    failures.push(`${relativePath}: invalid status '${fields.status}'`);
  }
  if (!/^(true|false)$/.test(fields.nav ?? "")) {
    failures.push(`${relativePath}: nav must be 'true' or 'false'`);
  }
  if (!/^\d+$/.test(fields.order ?? "")) {
    failures.push(`${relativePath}: order must be an integer`);
  } else if (orders.has(fields.order)) {
    failures.push(`${relativePath}: order ${fields.order} is also used by ${orders.get(fields.order)}`);
  } else {
    orders.set(fields.order, relativePath);
  }
  for (const dateField of ["reviewed", "reviewBy"]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[dateField] ?? "")) {
      failures.push(`${relativePath}: ${dateField} must use YYYY-MM-DD`);
    }
  }
  if (fields.reviewBy && fields.reviewBy < today) {
    failures.push(`${relativePath}: review was due ${fields.reviewBy}`);
  }
  if (fields.reviewed && fields.reviewBy && fields.reviewed > fields.reviewBy) {
    failures.push(`${relativePath}: reviewed date is after reviewBy date`);
  }

  for (const match of body.matchAll(/\]\(\/project\/([^#)]+)(?:#[^)]+)?\)/g)) {
    if (!slugs.has(match[1]) && !embeddedProjectRoutes.has(match[1])) {
      failures.push(`${relativePath}: broken project link /project/${match[1]}`);
    }
  }
  if (/www\.sunholo\.com\/aipla|sunholo-data\.github\.io\/aipla/.test(body)) {
    failures.push(`${relativePath}: links back to the retiring legacy site`);
  }
  if (/AIza[0-9A-Za-z_-]{20,}|api[_ -]?key\s*[:=]/i.test(body)) {
    failures.push(`${relativePath}: appears to contain an API key or API-key instruction`);
  }
}

if (failures.length) {
  console.error(`Project content check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Project content check passed: ${pages.length} English pages, all reviews current.`);
