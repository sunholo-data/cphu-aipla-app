# v0.1.0-jutland Build Sequence

**Anchor date:** 2026-05-27 (Wed) — JB + Aswin Jutland visit.
**v0.1 ready target:** 2026-05-20 EOD, leaving 5 working days of buffer for AR-led prompt iteration.

## Ordering

| Order | Doc | Priority | Estimate | Dependencies | Notes |
|---|---|---|---|---|---|
| 0.1 | [jutland-demo.md](jutland-demo.md) | P0 | 1d | None | M0 cloud bootstrap + M1–M5 (parallelisable M1/M2/M3) |

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
- One physics-tutor skill: `problem-set-hints`, defaulting to Claude Sonnet
- One seeded problem (Danish stx projectile motion, AR's example as fallback)
- `aipla smoke jutland` end-to-end smoke command
- OTel traces in Cloud Trace inside the AIPLA project (Axiom 8/9 trust boundary)

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
| Anthropic API rate limit during demo | Router falls to Gemini 2.5 via Vertex EU (already in template router); LOCAL_MODE on JB's laptop as ultimate fallback |
| AR can't deliver fresh problem set before demo | Use projectile-motion example from [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd) |
| Demo URL bandwidth-throttled on UCPH/Jutland school WiFi | Cloud Run min-instances=1 for the buffer week; pre-warm sessions; LOCAL_MODE fallback |
| Sonnet response gives a full solution despite scaffolding prompt | Buffer week is exactly for catching this with AR; smoke test asserts no-solution markers |

## Next

After v0.1.0-jutland lands, work proceeds against [SEQUENCE.md](../SEQUENCE.md) Phase 1, starting with **1.1 aipla-cloud-bootstrap** (Terraform-ify the manual M0 work) in parallel with **1.2 chat-log-pipeline** (BigQuery sink for OTel).
