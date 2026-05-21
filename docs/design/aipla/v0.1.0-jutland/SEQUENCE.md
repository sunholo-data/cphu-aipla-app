# v0.1.0-jutland Build Sequence

**Anchor date:** 2026-05-27 (Wed) — JB + Aswin Jutland visit.
**v0.1 ready target:** 2026-05-20 EOD, leaving 5 working days of buffer for AR-led prompt iteration.

## Ordering

| Order | Doc | Priority | Estimate | Dependencies | Notes |
|---|---|---|---|---|---|
| 0.1 | [jutland-demo.md](jutland-demo.md) | P0 | 1d | None | M0 cloud bootstrap + M1–M5 (parallelisable M1/M2/M3) |
| 0.2 | [pedagogical-context-sprint.md](pedagogical-context-sprint.md) | P1 | (buffer-week sprint) | 0.1 | iframe-context endpoint + InstructionProvider injection |
| 0.3 | [boldkast-mcp-app.md](boldkast-mcp-app.md) | P2 (Stretch) | 1.5d | 0.1, 0.2 | Static-artefact sim under `mcp-sandbox` library-bypass path (ADR-013) |
| 0.4 | [group-tooling.md](group-tooling.md) | P1 | 0.5d | 0.1 | `aiplatform group` CLI — ops unblocker, not demo gate |
| 0.5 | [human-tool-use-cards.md](human-tool-use-cards.md) | P1 | 0.75d | 0.2, 0.3 | Visible chat cards mirroring student actions + `ChatSessionIndex` bootstrap fix (closes 2026-05-21 iframe-context 404 race) |
| 0.6 | [mcp-app-iframe-harness.md](mcp-app-iframe-harness.md) | P1 | 0.4d | 0.3, 0.5 | Standard way to surface MCP-App iframe activity in chat: shared `useSandboxedIframeMessages` hook (auth + filter + dev logs), Boldkast migrated, slider-end card for trust-the-context UX |
| 0.7 ✅ | [mcp-app-iframe-spec-compliance.md](mcp-app-iframe-spec-compliance.md) | P2 | 1.5d (actual: ~1d) | 0.3, 0.6 | Boldkast migrated to MCP Apps spec JSON-RPC + sandbox-proxy. M-signoff 2026-05-21; merged to dev. Closes the protocol-debt the harness sprint surfaced. 608/608 frontend tests, 21/21 sandbox |

## Timeline estimate

| Phase | Date | Status |
|---|---|---|
| Design doc landed | 2026-05-19 (today) | ✅ |
| Sprint plan landed | 2026-05-19 (today, follows this doc) | Pending |
| M0 cloud bootstrap | 2026-05-20 morning | Pending |
| M1+M2+M3 parallel | 2026-05-20 midday | Pending |
| M4 smoke test | 2026-05-20 afternoon | Pending |
| M5 deploy + verify | 2026-05-20 EOD | Pending |
| Buffer + AR iteration | 2026-05-21 → 26 | Pending |
| **Jutland demo** | **2026-05-27 (Wed)** | — |

## What ships in v0.1.0-jutland

- AIPLA-branded chat UI on `aipla-dev-2026` Cloud Run, region `europe-north1`
- Anonymous group-ID join (inherited upstream, AIPLA-configured with Danish copy)
- One physics-tutor skill: `problem-set-hints`, defaulting to `gemini-3.5-flash` on Vertex AI `global` endpoint (verified 2026-05-20; europe-north1 pending Google rollout)
- One seeded problem (Danish stx projectile motion, AR's example as fallback)
- `aipla smoke jutland` end-to-end smoke command
- OTel traces in Cloud Trace inside the AIPLA project + zero third-party egress (Vertex AI + Cloud Trace both inside the Google Cloud trust boundary — Axiom 8/9)

## What does NOT ship in v0.1.0-jutland

See [SEQUENCE.md](../SEQUENCE.md) Phase 1 for the post-Jutland roadmap. Anything not in the "What ships" list above is by definition v1 or later.

## Dependency Graph

```
M0 (cloud bootstrap, sequential)
    │
    ├──► M1 problem-set-hints skill   ┐
    ├──► M2 AIPLA branding + region   ├── parallel
    └──► M3 group-ID + seed corpus    ┘
             │
             ├──► M4 smoke test
             │       │
             │       └──► M5 deploy + verify ──► v0.1 ready
             │
             (buffer week: AR prompt iteration)
             │
             └──► 2026-05-27 Jutland demo
```

## Risks

| Risk | Mitigation |
|---|---|
| GCP project provisioning hits org-policy block | Fall back to deploying on Multivac dev; document in `notes/`; spin up Terraform for `aipla-dev-2026` in 1.1 |
| Vertex AI `gemini-3.5-flash` thinking-budget makes TTFT unacceptable | Set `thinkingConfig.thinkingBudget: 0` and redeploy (10-min round-trip); or switch model to `claude-sonnet-4-6` via Anthropic API (router fallback per ADR-008); LOCAL_MODE on JB's laptop as ultimate fallback |
| europe-north1 lights up for `gemini-3.5-flash` between now and pilot | Swap endpoint URL `global → europe-north1` in router config; no model-ID change. Probe weekly. |
| AR can't deliver fresh problem set before demo | Use projectile-motion example from [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd) |
| Demo URL bandwidth-throttled on UCPH/Jutland school WiFi | Cloud Run min-instances=1 for the buffer week; pre-warm sessions; LOCAL_MODE fallback |
| Sonnet response gives a full solution despite scaffolding prompt | Buffer week is exactly for catching this with AR; smoke test asserts no-solution markers |

## Next

After v0.1.0-jutland lands, work proceeds against [SEQUENCE.md](../SEQUENCE.md) Phase 1, starting with **1.1 aipla-cloud-bootstrap** (Terraform-ify the manual M0 work) in parallel with **1.2 chat-log-pipeline** (BigQuery sink for OTel).
