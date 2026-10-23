// Deployed ADK migration gate. Intentionally fixed to DEV; no production mode.
// AIPLA_DEV_TEACHER_TOKEN_FILE=<private file> node scripts/check-adk-dev.mjs <fixture.json>
// Reusing the fixture repeats against the same synthetic class and activities.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { HttpAgent } = require("@ag-ui/client");
const base = "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app";
const fixturePath = process.argv[2];
assert.ok(fixturePath, "Provide a private fixture/result file path");
const tokenFile = process.env.AIPLA_DEV_TEACHER_TOKEN_FILE;
assert.ok(tokenFile, "Set AIPLA_DEV_TEACHER_TOKEN_FILE to the existing dev test teacher ID token file");
const teacher = readFileSync(tokenFile, "utf8").trim();
async function request(path, { token, ...init } = {}) {
  const response = await fetch(base + "/api/proxy" + path, {
    ...init, signal: AbortSignal.timeout(120000),
    headers: { Origin: base, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...init.headers },
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${(await response.clone().text()).slice(0, 200)}`);
  return response.status === 204 ? null : response.json();
}
function post(path, token, body = {}) {
  return request(path, { token, method: "POST", body: JSON.stringify(body) });
}
let fixture;
if (existsSync(fixturePath)) {
  fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(fixture.base, base);
  assert.equal(fixture.synthetic, true);
} else {
  const who = await request("/api/auth/whoami", { token: teacher });
  assert.ok(who.uid, "The dev fixture requires an authenticated test teacher");
  const skills = await request("/api/skills", { token: teacher });
  const skill = skills.find(s => s.slug === "concept-dialogue");
  assert.ok(skill);
  const cls = await post("/api/classes", teacher, { name: "ADK 2 migration check (synthetic)", description: "Disposable dev-only upgrade fixture" });
  fixture = { base, synthetic: true, classId: cls.classId, skillId: skill.skillId, activities: [] };
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  for (const [name, artefactId, goal] of [
    ["dialogue", "boldkast", "Undersøg hvordan kastevinklen påvirker en bolds rækkevidde."],
    ["simulation", "sol-jord-maane", "Undersøg Månens faser med simulationen Sol, Jord og Måne."],
  ]) {
    const activity = await post("/api/activities", teacher, {
      classId: cls.classId, skillId: skill.skillId, title: `ADK migration ${name} (synthetic)`,
      teachingGoal: goal, artefactId, language: "da", openingByTeacher: true,
      studentOpening: "Start med at undersøge simulationen og forklar hvad du ser.",
      table: [{ id: "measurements", title: "Målinger", rows: 3, columns: [{ id: "trial", label: "Forsøg" }, { id: "value", label: "Måling" }] }],
      checklist: [{ id: "observe", label: "Beskriv din observation" }],
    });
    fixture.activities.push({ name, activityId: activity.activityId, artefactId });
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
}
assert.equal(fixture.activities.length, 2);
if (!fixture.group) {
  const groups = await post(`/api/classes/${fixture.classId}/groups`, teacher, { count: 1 });
  fixture.group = groups.codes[0];
}
writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
const joined = await post("/api/auth/group/join", null, { group_id: fixture.group });
const token = joined.token;
const headers = { Authorization: "Bearer " + token, Origin: base };
const results = [];
for (const activity of fixture.activities) {
  const open = () => post("/api/auth/group/session", token, { skillId: fixture.skillId, activityId: activity.activityId });
  const sessions = await Promise.all([open(), open(), open()]);
  assert.equal(new Set(sessions.map(s => s.sessionId)).size, 1, "Parallel devices opened different group sessions");
  const sid = sessions[0].sessionId;
  activity.sessionId = sid;
  await post(`/api/sessions/${sid}/iframe-context`, token, {
    serverId: "table", toolName: "state", activityId: activity.activityId,
    structuredContent: { rows: [{ trial: 1, value: 42 }], migrationMarker: activity.name },
    label: "Synthetic migration measurement shared",
  });
  const state = await request(`/api/sessions/${sid}/state`, { token });
  assert.ok(JSON.stringify(state).includes(activity.name), "Workspace snapshot was lost");
  for (let i = 0; i < 10; i++) {
    // Rebuild the installed client from persisted history each time, like reload.
    const before = await request(`/api/sessions/${sid}/messages`, { token });
    const agent = new HttpAgent({ url: base + `/api/proxy/api/skill/${fixture.skillId}/stream`, headers, threadId: sid });
    agent.setMessages(before.messages.filter(m => ["user", "assistant"].includes(m.role) && m.content).map(m => ({ id: m.id || crypto.randomUUID(), role: m.role, content: m.content })));
    const prompt = activity.name === "simulation"
      ? `Indstil simulationens klokkeslæt til 2027-02-${String(i + 1).padStart(2, "0")}T16:00:00Z med control_sim, kommandoen setTime og argumentet iso. Fortæl kort hvad du ændrede, og stil ét spørgsmål.`
      : `Forsøg ${i + 1}: Jeg har valgt en kastevinkel på 35 grader. Hvad bør jeg undersøge som det næste?`;
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: prompt });
    const events = [], errors = [];
    const start = performance.now();
    let firstTextMs = null;
    const timer = setTimeout(() => agent.abortRun(), 120000);
    try {
      await agent.runAgent({ runId: crypto.randomUUID(), forwardedProps: { activity_id: activity.activityId, ui_language: "da" } }, {
        onEvent: ({ event }) => { events.push(event); if (firstTextMs === null && event.type === "TEXT_MESSAGE_CONTENT" && event.delta) firstTextMs = performance.now() - start; },
        onRunFailed: ({ error }) => { errors.push(error.message); },
        onRunErrorEvent: ({ event }) => { errors.push(event.message); },
      });
    } finally { clearTimeout(timer); }
    fixture.lastRun = { journey: activity.name, iteration: i + 1, sessionId: sid, events };
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    assert.deepEqual(errors, []);
    assert.equal(events[0]?.type, "RUN_STARTED");
    assert.equal(events.at(-1)?.type, "RUN_FINISHED");
    assert.equal(events.filter(e => ["RUN_ERROR", "RUN_FINISHED"].includes(e.type)).length, 1);
    const hasText = events.some(e => e.type === "TEXT_MESSAGE_CONTENT" && e.delta);
    const toolCalls = events.filter(e => e.type === "TOOL_CALL_START").map(e => e.toolCallName);
    if (activity.name === "simulation") {
      assert.ok(toolCalls.includes("control_sim"), "Requested simulation command was not called: " + JSON.stringify(agent.messages.at(-1)));
      const outputs = events.filter(e => e.type === "TOOL_CALL_RESULT").map(e => JSON.parse(e.content));
      assert.ok(outputs.some(o => (o.result || o).ok === true && (o.result || o).command === "setTime"), "Simulation command did not succeed: " + JSON.stringify(outputs));
    } else assert.ok(hasText, "Dialogue produced no tutor text");
    const after = await request(`/api/sessions/${sid}/messages`, { token });
    assert.ok(after.messages.length > before.messages.length, "New turn did not persist");
    const reload = await request(`/api/sessions/${sid}/messages`, { token });
    assert.deepEqual(reload.messages, after.messages, "Reload changed persisted history");
    const restored = await post(`/api/sessions/${sid}/restore`, token);
    assert.ok(restored.messages.some(m => m.role === "assistant"));
    assert.equal(restored.workbenchState["mcp_app_context.table.state"].structuredContent.migrationMarker, activity.name);
    const result = { journey: activity.name, iteration: i + 1, firstTextMs: firstTextMs === null ? null : Math.round(firstTextMs), durationMs: Math.round(performance.now() - start), hasText, toolCalls, messages: after.messages.length };
    results.push(result);
    fixture.results = results;
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    console.log("PASS", JSON.stringify(result));
  }
}
assert.notEqual(fixture.activities[0].sessionId, fixture.activities[1].sessionId, "Activities shared a session");
fixture.results = results;
fixture.checkedAt = new Date().toISOString();
writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
console.log("PASS: 10/10 dialogue and 10/10 simulation turns; parallel join, activity isolation, workspace state, installed chat client, terminal order, persisted history and reload/restore");
