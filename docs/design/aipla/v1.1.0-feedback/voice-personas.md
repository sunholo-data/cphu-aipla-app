# Voice personas — friendly identities that bundle voice + avatar + language

**Status:** Partially shipped (P2) — as of 2026-06-08, the friendly `VoiceStatusPill` mode has landed; the `Persona` model, `backend/personas/` YAMLs, and the persona-card picker are **still open** (~2d remaining). See [SEQUENCE Build status](SEQUENCE.md#build-status--verified-2026-06-08).
**Last Updated:** 2026-06-08
**Priority:** **P2** — UX polish over the v1.1.11 voice provider abstraction. Teacher review on 2026-06-04 surfaced that the technical voice picker ("gcp_chirp3hd / da-DK-Chirp3-HD-Aoede") is opaque to non-engineers. Production users need names and faces, not registry strings
**Estimated:** ~1.5d (backend persona model + routes + 4-6 default personas + CLI) + ~1d (frontend picker + bubble avatar + status pill) + ~0.5d (assets, docs, polish) = **~3d**
**Scope:** Fullstack — `backend/db/models/persona.py` (new) + `backend/personas/` YAMLs (new) + `backend/protocols/voice_routes.py` (extend) + `frontend/src/components/teacher/PersonaPickerPanel.tsx` (new) + `MessageBubble.tsx` (extend with avatar) + `VoiceStatusPill.tsx` (friendly mode) + 4-6 avatar PNGs
**Dependencies:**
- v1.1.11 [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) shipped — Persona is the UX layer over its `SkillVoiceConfig` + `ClassVoiceSettings` primitives
- ADR-003 (four-tier model selection) — personas inherit the tier swap pattern transparently
- 1.G [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — persona picker lives in the class-detail page next to the existing Voice section
**Source brief:** 2026-06-04 chat with M, after the v1.1.11 voice provider shipped to dev. M: *"we have technical debug info now but I'm thinking we add personas and avatars that will link to voices down the road, so we can visually check as well in production"*

## Problem

The 1.1.11 voice config landed with a deliberately technical surface — teacher picks **tier** (Standard / WaveNet / Neural2 / Chirp3 HD) + **voice name** (`da-DK-Chirp3-HD-Aoede`). The new `VoiceStatusPill` in chat reads:

> 🎙 Chirp3 HD · da-DK-Chirp3-HD-Aoede · da (class)

That is exactly the information an engineer wants. It is exactly **not** what a student or a teacher running a lesson wants. Three concrete pain points:

1. **No identity.** "Aoede" is a voice name. There is no character, no face. The tutor that read the student's last problem hint is an anonymous voice ID. Students naturally anthropomorphise — "the tutor sounded friendly" — but right now there's nothing for them to anchor to.
2. **Coupling without coherence.** Voice, avatar, language, and display name live in four different config fields (`SkillConfig.avatar`, `SkillVoiceConfig.tts_voice`, `SkillVoiceConfig.tts_provider`, `tts_lang`). A teacher who picks the "Aoede" voice for their class still sees the default skill icon next to messages — they changed the voice but not the face, and there's no UI surface that lets them do both at once.
3. **Technical jargon in production.** The teacher dropdown shows `"da-DK-Chirp3-HD-Aoede"`. The status pill shows `gcp_chirp3hd`. A non-engineer teacher running a parents'-evening demo will see those strings and either be confused or feel the product is unfinished. Engineers SHOULD still see them, but only when they ask.

## Goals

**Primary goal:** Introduce a `Persona` — a named, faced bundle of (voice, language, rate, avatar, title, optional bio). Teachers pick a persona for their class; students see the persona's avatar + name next to every tutor turn and a friendly status pill ("🎙 Aoede speaking · da"). The technical details we built in 1.1.11 stay accessible behind a `?debug=voice` query param so engineers and AR can still see the resolution chain.

**Concrete shippable outcomes:**

1. `backend/db/models/persona.py` — `Persona` Pydantic with `id`, `name`, `title`, `avatar`, `language`, `voice` (existing `SkillVoiceConfig` shape), `bio` (optional markdown).
2. `backend/personas/` directory — 4-6 default persona YAMLs shipped in the repo. Loader merges YAML defaults with optional Firestore-stored personas (teacher-authored personas come in v1.2; v1.1.12 ships YAML-only).
3. `SkillConfig.persona_id` and `ClassVoiceSettings.persona_id` fields — when set, derive voice + avatar + language from the persona. Per-field skill / class overrides still win (so a skill that explicitly sets `voice.tts_voice` keeps that override over the persona's voice).
4. `GET /api/personas` — returns the list of available personas (YAML defaults + any seeded Firestore docs). `GET /api/personas/{id}` returns one.
5. `GET /api/voice/config` response gains a `persona` block when one is resolved. Frontend renders avatar + friendly name from it.
6. `frontend/src/components/teacher/PersonaPickerPanel.tsx` — card grid replacing the existing `ClassVoiceSettingsPanel`'s tier+voice dropdowns. Each card shows avatar + name + title + language + a small tier badge ("Chirp3 HD" / "$$$"). The current technical dropdowns move behind a "Custom voice (advanced)" expander.
7. `MessageBubble.tsx` — persona avatar + name replace the skill avatar/name when a persona is resolved. Falls back to skill avatar/name when no persona.
8. `VoiceStatusPill.tsx` — friendly mode by default ("🎙 Aoede speaking · da"). Behind `?debug=voice` query param, shows the existing technical pill ("Chirp3 HD · da-DK-Chirp3-HD-Aoede · da (class)") plus the resolution-chain breakdown.
9. CLI: `aiplatform personas list/show/seed` — lists shipped + Firestore personas, shows one, seeds Firestore from YAML defaults for envs that want them (dev, test, prod).

**Success metrics:**

- Teacher picks "Aoede" from the persona grid → student in that class sees Aoede's avatar + name on every tutor turn AND hears Aoede's Chirp3 HD voice
- No technical strings (`gcp_chirp3hd`, `da-DK-Chirp3-HD-Aoede`) are visible in the chat surface by default
- Engineering team can still inspect the resolution chain via `?debug=voice`
- Persona missing / not seeded → graceful degradation to skill avatar + skill voice block + env defaults (existing 1.1.11 chain, no regression)
- Existing skills with explicit `voice:` blocks (`problem-set-hints`, `led-planck-tutor`, `kinebot-kinematics-tutor`) keep working as-is, with the option to layer a persona on top
- Teacher class-settings page loads <300ms even with 6 persona cards rendered
- `aiplatform personas list` works end-to-end against dev

**Non-goals (deferred to later docs):**

- **Student-authored personas** — v1.2+ social feature. v1.1.12 ships only teacher-pickable + skill-author-baked personas. No `POST /api/personas` write endpoint from the student surface
- **Multi-lingual personas** (one persona, multiple languages) — model says one persona = one language. A class that wants Danish + English tutoring uses two skills with two personas, or waits for a future "persona group" concept
- **Voice cloning / custom voice training** — only Cloud TTS-supplied voices are available. Personas are a naming layer over the existing 1.1.11 provider abstraction
- **Animated avatars / Lottie / video personas** — start with static PNG/SVG at 256×256. Revisit if pedagogically valuable
- **TTS persona-specific prompt injection** (e.g. "speak in Aoede's voice and personality") — that's a separate "tutor personality" feature. Voice is the only persona-ness here; the agent's writing style is still skill-driven
- **A2UI surface for persona selection** — just use a plain React card grid for v1.1.12

## Standards check

Searched (Agent Skills spec, A2UI, MCP, ADK) for a persona / character / agent-identity standard. **None defines this layer** at the granularity we need (avatar + name + voice bundle for a tutor surface). The closest references:

- **Agent Skills spec** — `SKILL.md` has `displayName` and `avatar` fields but no persona / voice bundle
- **A2A agent cards** — agent metadata for discovery; persona-adjacent but oriented at agent-to-agent rather than user-facing tutor identity
- **Cloud TTS voice list** — voice names (`da-DK-Chirp3-HD-Aoede`) exist as canonical IDs but carry no persona semantics

Per feedback_search_protocols_first (`feedback_search_protocols_first.md` — agent-memory note, on M's machine): the honest call is to keep the `Persona` model **thin** — just a bundle of existing primitives (avatar URL, voice ID, language tag, display strings). No new protocol invented. The persona definition YAML follows the existing SKILL.md frontmatter convention. Avatars use standard web image formats (PNG, SVG, WebP).

BCP-47 language tags throughout (matches 1.1.11). Per feedback_no_emoticons (`feedback_no_emoticons.md` — agent-memory note, on M's machine): persona display copy uses words ("Aoede speaking"), never emoji. The 🎙 in the status pill stays as a lucide icon (`Mic2`) per the existing v1.1.11 convention.

## Design

### Persona model

```python
# backend/db/models/persona.py
class Persona(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    """Stable persona ID (`"aoede-physics"`, `"charon-narrator"`). Used as
    foreign key from SkillConfig.persona_id and ClassVoiceSettings.persona_id."""

    name: str = Field(min_length=1, max_length=64)
    """Friendly first-name-ish ("Aoede", "Charon"). What shows in the
    bubble header and the status pill."""

    title: str | None = Field(default=None, max_length=128)
    """Optional role title ("Fysik-tutor", "Kinematics coach"). Shown
    smaller, beneath name in the picker."""

    avatar: str = Field(min_length=1, max_length=256)
    """Path or URL to a 256×256 PNG/SVG/WebP. Relative paths
    (`"/personas/aoede.png"`) resolve against the frontend public dir;
    absolute URLs are used as-is."""

    language: str = Field(min_length=2, max_length=16)
    """BCP-47 short tag ("da", "en"). One persona = one language."""

    voice: SkillVoiceConfig
    """The existing SkillVoiceConfig from 1.1.11. Carries provider, voice
    name, rate. Required (no fall-through) so a persona always knows
    what voice it speaks in."""

    bio: str | None = Field(default=None, max_length=2000)
    """Optional markdown description shown on the persona detail page
    or hovering. Not read aloud."""

    source: Literal["yaml", "firestore"] = "yaml"
    """Where this persona came from. Engineering / runbook diagnostic;
    not user-facing."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")
```

### Persona storage

Two-tier storage to match how we ship + customize:

| Layer | Location | Who writes | Lives forever? |
|---|---|---|---|
| **Defaults** (v1.1.12 ships these) | `backend/personas/*.yaml` | Engineering + AR commit YAMLs to the repo | Yes — versioned in git |
| **Custom** (future v1.2+) | Firestore `/personas/<id>` | Teachers / admin via UI | Yes — soft-delete only |

The loader merges both: YAML defaults are always available; Firestore entries override or extend by ID. For v1.1.12 we ship YAML only and seed Firestore via `aiplatform personas seed` for envs that want write-side flexibility.

### Default personas shipped

| ID | Name | Title | Language | Voice | Tier |
|---|---|---|---|---|---|
| `aoede-da` | Aoede | Fysik-tutor | da | da-DK-Chirp3-HD-Aoede | Chirp3 HD |
| `charon-en` | Charon | Kinematics coach | en | en-US-Chirp3-HD-Charon | Chirp3 HD |
| `kore-da` | Kore | Studievejleder | da | da-DK-Neural2-F | Neural2 |
| `puck-en` | Puck | Helpful tutor | en | en-US-Wavenet-A | WaveNet |
| `frida-da` | Frida | Lab-assistent | da | da-DK-Wavenet-D | WaveNet |
| `daniel-da` | Daniel | Klassisk lærer | da | da-DK-Standard-D | Standard |

Six covers the (lang × tier) cross product enough for early teacher feedback. Add more as the pilot teachers request specific personalities.

### Resolution chain

Personas slot into the existing 1.1.11 chain at the persona-defined level. Highest wins:

```
1. Student localStorage (lang only — student can't pick persona)
2. Class voice settings: ClassVoiceSettings.persona_id      <-- NEW v1.1.12
3. Class voice settings: ClassVoiceSettings.{voice,provider,language}  (1.1.11 raw)
4. Skill voice block: SkillConfig.persona_id                <-- NEW v1.1.12
5. Skill voice block: SkillConfig.voice.{...}               (1.1.11 raw)
6. Env VOICE_TTS_PROVIDER
7. "browser" default
```

Persona resolution at any level "explodes" into the voice + avatar + language + name fields at that level. Per-field overrides BELOW the persona-set level (e.g., a skill that sets `voice.tts_voice` explicitly) still take precedence.

### Backend file layout

```
backend/personas/
  __init__.py
  aoede-da.yaml
  charon-en.yaml
  kore-da.yaml
  puck-en.yaml
  frida-da.yaml
  daniel-da.yaml
  loader.py             # load_personas() merges YAML + Firestore

backend/db/
  models/persona.py     # Persona Pydantic
  personas.py           # Firestore CRUD wrappers
```

```yaml
# backend/personas/aoede-da.yaml
id: aoede-da
name: Aoede
title: Fysik-tutor
avatar: /personas/aoede.png
language: da
voice:
  ttsProvider: gcp_chirp3hd
  ttsVoice: da-DK-Chirp3-HD-Aoede
  rate: 1.0
bio: |
  Aoede er en venlig og opmuntrende fysik-tutor.
  Hun stiller spørgsmål og hjælper dig gennem opgaverne trin for trin.
```

### API surface

| Method + path | Body | Response | Auth |
|---|---|---|---|
| `GET /api/personas` | — | `{ personas: [Persona, ...] }` | Anonymous-group JWT or Firebase |
| `GET /api/personas/{id}` | — | `Persona` | Same |
| `GET /api/voice/config?skill_id=...` (extended) | — | `{ tts: {...}, stt: {...}, persona: Persona | null }` | Same |
| `PUT /api/voice/class/{class_id}/settings` (extended) | `{ ..., persona_id?: str }` | `{ ok: true }` | Teacher-only (owner check) |

### Frontend

**`PersonaPickerPanel.tsx` (new)** — replaces the dropdown half of `ClassVoiceSettingsPanel`:

```
┌─────────────────────────────────────────────────────────────┐
│  Voice persona                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ [img]  │ │ [img]  │ │ [img]  │ │ [img]  │ │ [img]  │    │
│  │ Aoede  │ │ Charon │ │ Kore   │ │ Puck   │ │ Frida  │    │
│  │ Fysik  │ │ Kine.. │ │ Stud.. │ │ Help.. │ │ Lab    │    │
│  │ DA ●●● │ │ EN ●●● │ │ DA ●●  │ │ EN ●   │ │ DA ●   │    │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘    │
│                                                             │
│  ▶ Custom voice (advanced)                                  │
└─────────────────────────────────────────────────────────────┘
```

Each card is a button. Active persona = colored border. `●●●` = tier dots (1 dot Standard, 2 WaveNet, 3 Neural2, 4 Chirp3 HD) so the teacher can see the cost tier at a glance without reading prices.

The "Custom voice (advanced)" expander wraps the existing 1.1.11 dropdowns — kept for power users who want fine control or to use a voice outside the curated personas.

**`MessageBubble.tsx` (extend)** — when `voiceConfig.persona` is non-null, render persona avatar + name in the bubble header instead of the existing skill avatar/name. When persona is null, fall back to the skill (no regression).

**`VoiceStatusPill.tsx` (extend)** — friendly mode by default:

```
🎙 Aoede speaking · da
```

Behind `?debug=voice` query param OR for accounts with `role:researcher` (per [researcher-role.md](researcher-role.md) when it lands), show the full chain:

```
🎙 Aoede speaking · da
    └─ Chirp3 HD · da-DK-Chirp3-HD-Aoede
    └─ resolved from: class persona (set by teacher@example.dk)
```

### CLI surface

```
aiplatform personas list                # YAML + Firestore, merged
aiplatform personas list --source yaml  # YAML defaults only
aiplatform personas show aoede-da       # YAML or Firestore, whichever wins
aiplatform personas seed                # Upsert YAML defaults into Firestore
aiplatform personas seed --dry-run      # Print what would change
```

Useful for engineering during bring-up and for env promotion (seed dev → test → prod with the same canonical personas).

### Files

| File | Change | LOC |
|---|---|---|
| `backend/db/models/persona.py` (new) | Persona Pydantic | ~80 |
| `backend/personas/loader.py` (new) | YAML + Firestore merge | ~100 |
| `backend/personas/aoede-da.yaml` ×6 (new) | Default persona definitions | ~30 each |
| `backend/db/personas.py` (new) | Firestore CRUD wrappers | ~80 |
| `backend/db/models/class_.py` (extend) | Add `persona_id` to ClassVoiceSettings | +10 |
| `backend/db/models/__init__.py` (extend) | Add `persona_id` to SkillVoiceConfig | +5 |
| `backend/protocols/voice_routes.py` (extend) | Persona resolution + `/api/personas` routes | +100 |
| `backend/protocols/classes_routes.py` (extend) | Accept persona_id in PUT body | +15 |
| `backend/skills/skill_processor.py` (extend) | Parse `persona_id` in SKILL.md | +20 |
| `backend/tests/unit/voice/test_personas.py` (new) | Resolution chain tests | ~150 |
| `backend/tests/api_tests/test_personas_routes.py` (new) | Route happy/sad paths | ~100 |
| `frontend/src/components/teacher/PersonaPickerPanel.tsx` (new) | Card grid + expander | ~220 |
| `frontend/src/components/teacher/ClassVoiceSettingsPanel.tsx` (extend) | Wrap PersonaPicker + collapse "Custom voice" | +50 |
| `frontend/src/components/teacher/__tests__/PersonaPickerPanel.test.tsx` (new) | vitest cases | ~120 |
| `frontend/src/components/chat/MessageBubble.tsx` (extend) | Persona avatar + name | +30 |
| `frontend/src/components/chat/VoiceStatusPill.tsx` (extend) | Friendly mode + debug query param gate | +60 |
| `frontend/src/hooks/useVoiceConfig.ts` (extend) | Add `persona` to response shape | +20 |
| `frontend/src/lib/teacherApi.ts` (extend) | `fetchPersonas`, `setClassPersona` | +50 |
| `frontend/public/personas/*.png` (new) | 6 avatar PNGs at 256×256 | — |
| `cli/aiplatform/commands/personas.py` (new) | list / show / seed | ~100 |
| `cli/tests/test_cli_personas.py` (new) | typer testing | ~80 |
| `docs/ops/personas-runbook.md` (new) | Seed procedure + customization guide | ~120 |

**Total:** ~1,400 LOC new, ~280 LOC modified, 6 avatar PNGs.

### Empty / loading / error states (Axiom 11)

- **Empty (no personas seeded):** Teacher picker shows the existing "Custom voice (advanced)" expander expanded by default, with a `<p>` above explaining "No personas available yet — pick a voice directly below." Chat surface continues to work via skill defaults.
- **Loading:** persona card grid renders 6 skeleton tiles for the duration of the `GET /api/personas` fetch (typically <100ms).
- **Error:** `GET /api/personas` fails → fall back to existing 1.1.11 custom-voice UI silently, log to console. Teacher can still pick voices the old way. Chat surface unaffected (server-side resolution still works from skill / class / env).
- **Missing avatar asset:** PNG fails to load → render a lucide `User` icon + persona initial as fallback. No broken-image icon visible.
- **Narrow viewport:** card grid wraps to 2-wide on mobile (chat workspace is ~700px wide; teacher dashboard is wider but capped at `max-w-4xl`).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Persona avatar in bubble = instant visual recognition; faster than reading "Problem-set hints (Boldkast)". Card grid renders <100ms |
| 2 | EARNED TRUST | 0 | Persona name + face is identity signaling, not factual claim. Neutral on citation/confidence |
| 3 | SKILLS, NOT FEATURES | 0 | Slight tension — personas are a new abstraction visible to teachers. Mitigated because personas are pickable INSIDE the skill picker / class settings, not a parallel menu. Skills remain the organizing unit; personas customize how a skill appears |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Personas don't change LLM model selection. Voice tier IS the model in this context, and the persona's bundling makes tier selection more legible to teachers |
| 5 | GRACEFUL DEGRADATION | +1 | Persona missing → fall back to skill avatar + skill voice block + env (1.1.11 chain unchanged). Avatar fails to load → lucide `User` + initial. `GET /api/personas` 503 → custom-voice UI still works |
| 6 | PROTOCOL OVER CUSTOM | 0 | Thin custom Persona model since no protocol exists at this layer (searched + documented). YAML follows existing SKILL.md convention; avatars use standard web formats; BCP-47 lang tags |
| 7 | API FIRST | +1 | Clean `GET /api/personas` + persona_id flows through existing `/api/voice/config` endpoint. Channels (Telegram, future) get persona resolution for free via the same API |
| 8 | OBSERVABLE BY DEFAULT | +1 | OTel span attribute `voice.persona_id` added to `voice.synthesize` spans. Cost dashboard (1.1.9) can split usage by persona. Resolution chain logged at INFO |
| 9 | SECURE BY CONSTRUCTION | +1 | Persona avatars are public images, no PII. Cloud TTS gates voices at project level (unchanged). Teacher-authored personas (v1.2 future) need a write authorization model — explicitly out of scope here. v1.1.12 personas are read-only from YAML |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Persona resolution server-side; frontend just renders avatar + name + tier badge. Voice config response carries the persona block; client doesn't re-resolve |
| 11 | USABLE BY DESIGN | +1 | Empty / loading / error / missing-avatar / narrow-viewport states all designed UP-FRONT (see Design > Empty/loading/error states). Card grid is the explicit usability win that motivated the doc |
| | **Net Score** | **+7** | Threshold >= +4 ✓; target +6 exceeded |

**Conflict Justifications:** None — no axiom scored -1.

**Hard-fail checks:**
- EARNED TRUST is 0 (not -1) and the feature involves no factual claims → OK
- SECURE BY CONSTRUCTION is +1 → OK
- USABLE BY DESIGN is +1 with designed states → OK
- Zero axioms at -1 → well under the 2-axiom limit

## API Changes

```
GET /api/personas
  auth: anonymous-group JWT or Firebase
  response: { personas: [Persona, ...] }
  cache: 5min on the server side (personas rarely change)

GET /api/personas/{id}
  auth: same
  response: Persona
  errors: 404 if not found

GET /api/voice/config?skill_id={skill_id}  (EXTENDED)
  response shape adds:
    "persona": {
      "id": "aoede-da",
      "name": "Aoede",
      "title": "Fysik-tutor",
      "avatar": "/personas/aoede.png",
      "language": "da",
      "voice": { ... },
      "bio": null
    } | null

PUT /api/voice/class/{class_id}/settings  (EXTENDED)
  body shape adds:
    "persona_id": "aoede-da" | null
  When persona_id is set, the voice/provider/language fields are
  derived server-side. When persona_id is null, the existing v1.1.11
  three-field body shape is used.
```

## Migration

- **No data migration required.** Existing classes with v1.1.11 raw voice settings keep working. UI shows "Custom voice" badge for them with a one-click "Pick a persona instead" CTA that suggests the closest matching persona.
- **Existing skills with `voice:` blocks** (problem-set-hints, led-planck-tutor, kinebot-kinematics-tutor — added 2026-06-04) need NO migration. Their explicit voice block remains; if a persona is later assigned to those skills, the persona resolves first and the explicit voice block overrides any persona field it sets.
- **Feature flag:** `NEXT_PUBLIC_PERSONAS=on|off` (default `on` once shipped). When off, the new picker doesn't render and the existing v1.1.11 dropdowns stay; chat surface uses skill / class voice block as today. Lets us ship dark and flip on per env.
- **Rollback:** flip `NEXT_PUBLIC_PERSONAS=off`. Personas in Firestore remain (not deleted), classes that picked a persona fall through to their skill / env defaults until re-enabled.

## CLI Surface

| Command | Purpose |
|---|---|
| `aiplatform personas list` | List merged YAML + Firestore personas |
| `aiplatform personas list --source yaml` | List YAML defaults only (for diff against Firestore) |
| `aiplatform personas show aoede-da` | Show one persona's resolved config |
| `aiplatform personas seed` | Upsert all YAML defaults into Firestore |
| `aiplatform personas seed --dry-run` | Print what would change without writing |
| `aiplatform personas seed --env test` | Seed against `aipla-test-2026` instead of the default dev project |

Estimate: **~0.3 day** for the four subcommands (Click + httpx + Firestore client + tests).

**Backlink:** [local-dev-cli.md](../../v6.1.0/local-dev-cli.md).

## Testing Strategy

**Backend (pytest):**

- `test_personas.py`:
  - YAML loader parses all 6 default personas and resolves their voice blocks
  - Firestore + YAML merge — Firestore entry with same ID overrides YAML
  - Persona missing in both YAML and Firestore → loader returns None gracefully
  - `Persona` Pydantic rejects malformed avatars / lang codes / voice blocks
- `test_personas_routes.py`:
  - `GET /api/personas` happy path returns merged list
  - `GET /api/personas/{id}` 404 on unknown ID
  - `GET /api/voice/config` returns persona block when class.voice.persona_id is set
  - `GET /api/voice/config` returns persona block when skill.persona_id is set
  - `GET /api/voice/config` resolution: class persona wins over skill persona
  - `PUT /api/voice/class/{id}/settings` accepts persona_id, writes to Firestore
  - `PUT /api/voice/class/{id}/settings` with persona_id and explicit voice block → both stored; persona used for derived fields; explicit voice block overrides per-field

**Frontend (vitest):**

- `PersonaPickerPanel.test.tsx`:
  - Renders 6 cards on empty class state
  - Click card → POST to update class settings + visual active state
  - Custom voice expander reveals existing 1.1.11 dropdowns
  - Empty state when `GET /api/personas` returns empty list
  - Loading skeleton renders during fetch
  - Error fallback when fetch fails (renders custom-voice expander expanded)
- `VoiceStatusPill.test.tsx`:
  - Default mode renders "Aoede speaking · da" when persona resolved
  - `?debug=voice` query param toggles to technical mode
  - Falls back to skill displayName when no persona
- `MessageBubble.test.tsx`:
  - Renders persona avatar + name when voiceConfig.persona is set
  - Renders skill avatar + name as fallback when persona null
  - Avatar onError handler swaps to lucide `User` + initial

**Manual:**

- Teacher logs in, opens class detail, picks Aoede card, saves. Student in that class sees Aoede avatar + name on next tutor turn AND hears Chirp3 HD voice
- Same teacher switches to "Custom voice (advanced)" → existing 1.1.11 picker works
- Engineering team opens chat with `?debug=voice` → status pill shows technical chain
- `aiplatform personas seed` against `aipla-dev-2026` → Firestore populated, CLI list shows YAML + Firestore merged

## Implementation Plan

Suggested milestone breakdown (concrete sprint plan via sprint-planner skill at execution time):

| Step | What | Est |
|---|---|---|
| M1 | `backend/db/models/persona.py` Pydantic + loader + 6 YAMLs + unit tests | 0.4d |
| M2 | `backend/db/personas.py` Firestore CRUD + integration tests | 0.2d |
| M3 | `backend/protocols/voice_routes.py` `/api/personas` routes + extend `/voice/config` + tests | 0.3d |
| M4 | `SkillConfig.persona_id` + `ClassVoiceSettings.persona_id` Pydantic + frontmatter parsing | 0.2d |
| M5 | Source 6 avatar PNGs (AI-generated for v1.1.12; commission later) | 0.2d (asset work) |
| M6 | `PersonaPickerPanel.tsx` + `ClassVoiceSettingsPanel.tsx` rework + vitest | 0.6d |
| M7 | `MessageBubble.tsx` persona avatar wiring + `useVoiceConfig` shape extend + vitest | 0.3d |
| M8 | `VoiceStatusPill.tsx` friendly mode + `?debug=voice` gate + vitest | 0.2d |
| M9 | `cli/aiplatform/commands/personas.py` + tests | 0.3d |
| M10 | `docs/ops/personas-runbook.md` + acceptance + AR sign-off on default persona set | 0.3d |
| | **Total** | **~3d** |

## Success Criteria

- [ ] 6 default personas ship as YAML in `backend/personas/`, each with a 256×256 avatar in `frontend/public/personas/`
- [ ] `GET /api/personas` returns the merged list; `GET /api/personas/{id}` returns one
- [ ] `GET /api/voice/config` response includes a `persona` block when a persona is resolved
- [ ] Teacher class-settings page renders the persona card grid + collapsed "Custom voice (advanced)" expander
- [ ] Picking a persona card writes to class settings + flows through to the student's `useVoiceConfig` response on next focus/refetch
- [ ] Student chat surface shows persona avatar + name in the bubble header when a persona is active
- [ ] `VoiceStatusPill` shows friendly mode by default; `?debug=voice` toggles to technical mode
- [ ] Persona missing / avatar 404 / API 503 all degrade gracefully to v1.1.11 behavior with no broken UI
- [ ] `aiplatform personas list/show/seed` work end-to-end against `aipla-dev-2026`
- [ ] OTel span `voice.synthesize` carries `voice.persona_id` attribute; cost dashboard surfaces per-persona spend
- [ ] AR sign-off on the 6 default persona names + titles (avatar art can be AI-generated for v1.1.12)
- [ ] `make lint` + `make test-fast` + `npm run quality:check` all green

## Out of Scope

- Student-authored personas (v1.2+ social feature)
- Multi-lingual personas / persona groups
- Voice cloning / custom voice training
- Animated / Lottie / video personas
- TTS persona-specific prompt injection (tutor writing-style personality)
- A2UI surface for persona selection (plain React card grid for v1.1.12)
- Per-message persona switching mid-conversation (one persona per session)

## Related Documents

- **Parent:** [voice-provider-abstraction.md](implemented/voice-provider-abstraction.md) (1.1.11) — Persona is the UX layer over its `SkillVoiceConfig` + `ClassVoiceSettings` primitives. Shipped 2026-06-04.
- ADR-003 (four-tier model selection) — personas inherit the tier swap pattern transparently
- ADR-005 (data residency) — persona avatars served from the frontend's public dir; no new data egress
- feedback_search_protocols_first (`feedback_search_protocols_first.md` — agent-memory note, on M's machine) — cited in Standards check (no persona protocol exists)
- feedback_no_emoticons (`feedback_no_emoticons.md` — agent-memory note, on M's machine) — persona display copy uses words, lucide icons for UI affordances
- feedback_no_prs_commit_to_dev (`feedback_no_prs_commit_to_dev.md` — agent-memory note, on M's machine) — execution commits directly to dev
- [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (1.G) — persona picker lives next to existing Voice section on class-detail page
- [researcher-role.md](researcher-role.md) (1.1.5) — `role:researcher` accounts get `?debug=voice` for free without the query param (future)
- [cost-dashboard.md](cost-dashboard.md) (1.1.9) — `voice.persona_id` span attr feeds this dashboard
- [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — CLI command surface
