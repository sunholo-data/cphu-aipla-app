# Sunholo AI Protocol Platform v6

Open-source AI protocol platform — Skills + AG-UI + A2UI + MCP Apps + A2A on Google ADK.

> 🚀 **New here?** Start with [**WORKSHOP.md**](./WORKSHOP.md) — clone, set
> `LOCAL_MODE=1`, run `make dev`, working chat UI in under 30 minutes with
> zero GCP credentials. Use this for university courses, workshop attendees,
> or quick exploration of the protocol stack.

## What's New in v6

- **Skills replace Assistants** — clearer user-facing abstraction
- **Google ADK** — native agent orchestration (replaces Sunholo framework)
- **Protocol-native** — AG-UI, A2UI, MCP Apps, A2A, MCP
- **Three model providers** — Gemini, Claude, OpenAI
- **OpenTelemetry** — native observability from ADK

## Quick Start

### Backend
```bash
cd backend
make install
make dev          # API on port 1956
make playground   # ADK dev UI on port 8501
```

### Frontend
```bash
cd frontend
npm install
npm run dev       # Next.js on port 3000
```

## Architecture

```
platform/
├── frontend/     # Next.js 14 + React 18 + AG-UI + A2UI + MCP Apps
├── backend/      # FastAPI + Google ADK
├── cli/          # `aiplatform` CLI
├── docs/         # Design documents
└── firestore.rules
```

See [CLAUDE.md](CLAUDE.md) for detailed development guidelines.

See [docs/design/v5.0.0/migration-to-v6.md](docs/design/v5.0.0/migration-to-v6.md) for the full migration plan.
