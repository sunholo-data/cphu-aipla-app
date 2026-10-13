# sim-verify

Runs a sim draft in headless Chromium and reports what happened: the self-test
verdict, page errors, fit at 390/700/1024 px, whether pressing start moves the
drawing, the events the sim emits when driven, and screenshots. The browser half
of the sim gates; the static half is `backend/sim_gates/`. Design:
[in-app-sim-authoring.md](../../docs/design/aipla/v2.1.0-extension/in-app-sim-authoring.md) (M3).

```
POST /verify  {"index_html": "<!doctype html>…", "artefact_id": "my-sim"}
→ 200 {"ok": true, "result": {…verify_sim.mjs --json…}, "screenshots": {"390": b64, "700": b64, "driven": b64}}
GET  /ready   → 200 {"ok": true}
```

It stamps the bridge into a scratch copy and runs the repo's
`.claude/skills/mcp-app-artefact/scripts/verify_sim.mjs` unchanged, so the
laptop, the benchmark and the app grade a sim with the same script.

- **Private.** `--no-allow-unauthenticated`; only the backend's runtime SA has
  `run.invoker`. The smoke step proves an unauthenticated call is refused.
- **Runs as `aipla-sim-verify@`, an account with no project roles**: the drafts
  are untrusted code, so the identity beside them can reach nothing.
- One Chromium run at a time per instance (`--concurrency=1`, up to 3 instances).
- Drafts are written to a temp dir and deleted; never logged or stored.

| | |
|---|---|
| Image inputs | `scripts/assemble-sim-verify.sh` lists them; nothing else reaches the image |
| Local run | `APP_ROOT=$PWD PORT=8080 node infrastructure/sim-verify/server.mjs` (from the repo root, with Playwright's Chromium installed) |
| Dev deploy | trigger `aipla-sim-verify-deploy` on push to `dev` touching the inputs |
| Test / prod | **not wired yet**: needs terraform triggers in `infrastructure/env/cloudbuild.tf` and a promote twin |
