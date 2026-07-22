# Development workflow (internal)

AIPLA is a solo-execution contract repo, not an open-source project accepting
external contributions. This file is the internal dev workflow. Product/pedagogy
decisions live in the AIPLA scoping site; execution design lives in
[`docs/design/aipla/`](docs/design/aipla/SEQUENCE.md).

## Branch & commit

- Default and working branch is **`dev`**. `test` and `prod` exist for promotion.
- Work on short-lived feature branches, then fast-forward-merge into `dev`. **No
  GitHub PRs** — this is solo execution; PR review is overhead we don't run.
- Never force-push `dev` / `test` / `prod`.
- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`, `chore:`, `refactor:`). Refer to people by initials (M, JB, AR, …).

## Before you push — run the CI-parity gates

The fast inner-loop checks skip tests; CI does not. Before pushing:

```bash
cd frontend && npm run quality:check        # lint + typecheck + vitest + build
cd backend && make lint && make test-fast   # ruff check + format-check + pytest
```

New behaviour lands with a regression test that would have caught the bug it
fixes or covered the case it adds. Prefer a self-runnable test over a manual
check (see the "self-testable loops" project convention).

## Conventions that keep the repo maintainable

- **Use the canonical helper — don't re-roll it.** Auth gates, ownership checks,
  model selection, config reads, API response parsing all have one shared
  implementation. See the "Canonical helpers" section in [CLAUDE.md](CLAUDE.md)
  and `backend/CLAUDE.md`. Half-adopted helpers are how we ended up with three
  ways to do the same thing — don't add a fourth.
- **Anonymous-group auth is a corner case.** Every identity-touching change must
  work for both teachers (Firebase) and anonymous-group students (custom JWT).
  See CLAUDE.md → "Anonymous-Group Auth". This has shipped as a bug 4+ times.
- **Any multi-step workflow gets a `make` target / script** — never document a
  manual multi-step process without automating it.
- **No Sunholo / LangChain** — pure ADK + FastAPI by design.
- **No mock data in shipped UI** — real data or honest empty/error states
  (enforced by the `check:no-mock` CI guard).
- **No emoticons** in docs / UI / commits — lucide-react icons in UI, plain words
  elsewhere.

## Code style

- **Backend:** Python 3.11+, `uv` for deps (`uv run ...`, never global pip),
  `ruff` for lint + format. Type hints on all signatures. See
  [backend/CLAUDE.md](backend/CLAUDE.md).
- **Frontend:** TypeScript strict, React 19, Tailwind + Radix.

## Adding a new skill template

Skill templates live in `backend/skills/templates/<name>/SKILL.md`. Loading is
dynamic — no code change, but **you must `make seed ENV=dev` after any template
change + deploy** (a code deploy does not propagate `SKILL.md` to Firestore). See
CLAUDE.md → the seed footgun.
