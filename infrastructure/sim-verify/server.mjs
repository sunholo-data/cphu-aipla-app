// sim-verify — run a sim draft in headless Chromium and report what happened.
//
// POST /verify  {"index_html": "...", "artefact_id": "my-sim"}
//   -> {"ok": true, "result": <verify_sim.mjs --json result>, "screenshots": {"700": "<base64 png>", ...}}
//
// The browser half of the sim gates (in-app-sim-authoring M3). The static half
// runs in the backend (backend/sim_gates); this service exists because a page
// can only be judged by running it. It stamps the bridge into a scratch copy,
// as `make sim-build` would, then runs the repo's verify_sim.mjs unchanged: the
// laptop, the benchmark and the app all use the one script.
//
// Private service: Cloud Run IAM decides who may call it (the backend's
// service account only). It runs as an account with no roles. The draft is
// written to a temp dir, run, and deleted; it is never logged or stored.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.env.APP_ROOT || "/app";
const PORT = Number(process.env.PORT || 8080);
const MAX_BYTES = 300 * 1024;
const TIMEOUT_MS = 120_000;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHOTS = ["390", "700", "driven"];

const run = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });

let busy = Promise.resolve();
async function verify(html, id) {
  const root = await mkdtemp(join(tmpdir(), "simverify-"));
  try {
    const art = join(root, "infrastructure/mcp-sandbox/artefacts", id, "v1");
    await mkdir(art, { recursive: true });
    await mkdir(join(root, "infrastructure/mcp-sandbox/bridge"), { recursive: true });
    await copyFile(join(APP, "infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js"), join(root, "infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js"));
    await writeFile(join(art, "index.html"), html);
    const stamp = await run("node", [join(APP, "scripts/build-artefact-bridge.mjs"), "--root", root], APP);
    if (stamp.code !== 0) return { ok: false, error: "could not stamp the bridge: " + stamp.stderr.slice(0, 300) };
    const out = join(root, "out");
    const json = join(root, "result.json");
    await run(
      "node",
      [join(APP, ".claude/skills/mcp-app-artefact/scripts/verify_sim.mjs"), id, "--path", join(art, "index.html"), "--drive", "--out", out, "--json", json],
      APP,
    );
    let result;
    try {
      result = JSON.parse(await readFile(json, "utf8"));
    } catch {
      return { ok: false, error: "the browser check did not produce a result (timeout or crash)" };
    }
    const screenshots = {};
    for (const k of SHOTS) {
      const p = result.screenshots?.[k];
      if (p) screenshots[k] = (await readFile(p).catch(() => null))?.toString("base64");
    }
    delete result.file;
    result.screenshots = Object.keys(screenshots);
    return { ok: true, result, screenshots };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/ready" || req.url === "/")) return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/verify") return send(res, 404, { ok: false, error: "POST /verify" });
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) req.destroy();
    else chunks.push(c);
  });
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { ok: false, error: "body must be JSON" });
    }
    const html = body.index_html, id = body.artefact_id || "draft";
    if (typeof html !== "string" || !html.trim()) return send(res, 400, { ok: false, error: "index_html is required" });
    if (!ID_RE.test(id)) return send(res, 400, { ok: false, error: "artefact_id must be kebab-case" });
    // One Chromium run at a time per instance; Cloud Run scales out for more.
    const job = busy.then(() => verify(html, id));
    busy = job.catch(() => {});
    try {
      const out = await job;
      send(res, out.ok ? 200 : 422, out);
    } catch (e) {
      send(res, 500, { ok: false, error: String(e).slice(0, 300) });
    }
  });
}).listen(PORT, () => console.log(`sim-verify listening on ${PORT}`));
