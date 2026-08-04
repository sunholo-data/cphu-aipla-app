# AIPLA — AI in Physics Learning and Assessment

Execution repo for **AIPLA**, a technical-infrastructure contract for the
University of Copenhagen Center for Digital Education: AI physics tutors,
interactive sims, and teacher/researcher tooling for upper-secondary physics.

Repo: `sunholo-data/cphu-aipla-app` · Default & working branch: **`dev`**.

> Built on the open-source **AI Protocol Platform** template (Skills + AG-UI +
> A2UI + MCP Apps + A2A on Google ADK). Some inherited files still say "Aitana
> Platform v6" — the AIPLA reality is authoritative. See [CLAUDE.md](CLAUDE.md).

## Run it locally (no GCP credentials)

```bash
cp .env.example backend/.env      # then set LOCAL_MODE=1
cd backend && make install && cd ..
make dev                          # frontend :3456 · backend :1956
```

Open **<http://localhost:3456>** — you get a yellow LOCAL_MODE banner and working
demo skills, with Firestore/Firebase/Vertex all stubbed in-memory. Full walkthrough
and the cloud tiers: [WORKSHOP.md](WORKSHOP.md).

## Where things are

| | |
|---|---|
| `frontend/` | Next.js 15 + React 19 + Tailwind (chat, teacher, researcher surfaces) |
| `backend/` | FastAPI + Google ADK (skills, agents, protocols, auth, analytics) |
| `cli/` | the `aiplatform` CLI (`make cli-install`) |
| `infrastructure/` | mcp-sandbox (sim iframes) + Terraform |
| `docs/design/` | design docs — **start at [docs/design/README.md](docs/design/README.md)** |

## Where the design lives

- **Execution design** (file paths, wire shapes, acceptance) → this repo,
  [`docs/design/aipla/SEQUENCE.md`](docs/design/aipla/SEQUENCE.md).
- **Public project information** → the app's native `/project` pages, authored
  from `frontend/content/project/` (English-first migration in progress).
- **Legacy product and pedagogical scoping material** → the separate AIPLA
  Quarto repository until its internal design records are fully consolidated.
- **Working with this repo as an AI agent** → [CLAUDE.md](CLAUDE.md) is the
  authoritative context (identity, gotchas, footguns, ports).

## Common commands

```bash
make dev                              # local dev servers (:3456 / :1956)
make seed ENV=dev                     # push SKILL.md templates to Firestore (manual, post-deploy)
cd frontend && npm run quality:check  # CI parity: lint + typecheck + tests + build
cd backend && make lint && make test-fast
```

See the [Makefile](Makefile) (`make help`) for the full target list and
[CLAUDE.md](CLAUDE.md) for the development workflow.
