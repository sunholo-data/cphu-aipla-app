# Voice pronunciation config — YAML-backed unit + symbol substitution catalogue

**Status:** Planned (P2)
**Last Updated:** 2026-06-04
**Priority:** **P2** — maintainability investment over the shipped `cc8507f` inline list. The list works; this doc extracts it to a structured config so engineering and AR can maintain it without touching React component internals
**Estimated:** ~1d total — ~0.4d YAML extraction + validation + schema, ~0.3d CLI + tests, ~0.3d runbook + polish
**Scope:** Frontend (extract inline arrays to YAML + loader + schema + tests) + CLI (`aiplatform voice-pronunciation list/validate/add`) + ops runbook
**Dependencies:**
- v1.1.11 [voice-provider-abstraction.md](voice-provider-abstraction.md) shipped — the TTS infrastructure that consumes the pronunciation rules
- v1.1.12 [voice-personas.md](../voice-personas.md) (planned) — sibling polish doc; both ship in parallel; pronunciation config is persona-agnostic
- Cloud Build's existing Next.js build pipeline — YAML import happens at build time, no runtime infrastructure change
**Source brief:** 2026-06-04 chat with M after the unit-substitution feature (`cc8507f`) shipped: *"this may be a list we need to maintain? perhaps we have a webpage or config for it?"* Agreed YAML at build time is the right next step; Firestore-backed admin is overkill until teachers need per-class custom pronunciations.

## Problem

The `cc8507f` commit added two inline TypeScript regex arrays in `frontend/src/components/chat/ReadAloudButton.tsx` — `UNIT_RULES_EN` and `UNIT_RULES_DA`, ~30 entries each. They handle the physics units the teacher review on 2026-06-04 surfaced ("9,82 m/s²" being read as "nine comma eight two m slash s squared"). Four concrete pain points:

1. **Editing requires React component context.** Adding a new unit means opening a 700-line `.tsx` file, finding the right array, understanding the regex syntax (look-behinds, look-aheads, escapes), and not breaking anything around it. AR can't review or propose additions without dropping into the engineering tool chain.
2. **No structural pairing between DA and EN.** Each English entry has a Danish counterpart, but they live in separate arrays with no enforced link. Easy to forget a translation pair when adding chemistry units in English-only. Drift between the two arrays is invisible until a Danish student hears "nine point eight two N" with the symbol spelled out.
3. **PR diffs are noisy.** A "add 5 chemistry units" change today is a 30-line TypeScript diff full of regex escaping. The same change as YAML is a 10-line structured diff that even a non-engineer can review.
4. **No validation.** A malformed regex in the inline array becomes a runtime error when a tutor message containing the trigger gets read. Build-time validation would catch this before deploy.

The right shape was always YAML — `cc8507f` was the right scope for the bug-fix sprint, but the structure didn't graduate with the scope.

## Goals

**Primary goal:** Migrate the pronunciation rules to `frontend/src/lib/voice-pronunciation/units.{en,da}.yaml`, validate them at build time against a JSON Schema, and surface a `aiplatform voice-pronunciation` CLI so engineers + AR can add units via PR with structured input + automatic checks.

**Concrete shippable outcomes:**

1. `frontend/src/lib/voice-pronunciation/units.en.yaml` + `units.da.yaml` — every rule expressed as `{ id, pattern, replacement }` triple. The shared `id` (e.g. `m_per_s2`) is the pairing key.
2. `frontend/src/lib/voice-pronunciation/schema.json` — JSON Schema validating shape, regex syntax, and uniqueness of `id` per file.
3. `frontend/src/lib/voice-pronunciation/index.ts` — YAML loader that runs at build time, validates against the schema, asserts DA/EN parity (every `id` appears in both files), and exports typed arrays.
4. `ReadAloudButton.tsx` — strip ~80 LOC of inline rule arrays + helper consts; import the typed rules from `voice-pronunciation/index.ts`.
5. `aiplatform voice-pronunciation list` (groups rules by category and lang), `validate` (re-runs schema + parity checks; exits non-zero on failure), `add <id> --en "pattern -> replacement" --da "pattern -> replacement"` (appends + re-runs validate).
6. `docs/ops/voice-pronunciation-runbook.md` — short authoring guide: when to add a rule, regex gotchas (word boundaries on single-letter units), how to test with the CLI, and how to add a brand-new language file.

**Success metrics:**

- `ReadAloudButton.tsx` shrinks by ~80 LOC; pronunciation rules become invisible to the React component
- Build fails when YAML is malformed OR when `units.da.yaml` is missing an `id` that exists in `units.en.yaml` (or vice versa)
- Adding 5 chemistry units (e.g. `mol`, `mol/L`, `pH`, `J/mol`, `K`) is a YAML diff that a non-engineer can read in 30 seconds, and `aiplatform voice-pronunciation validate` returns OK
- All 22 existing `ReadAloudButton.test.tsx` cases keep passing after the migration (regression bar; the logic doesn't change)
- Optional `voice.pronunciation_rules_version` OTel attr (git short-SHA) on synthesize spans so we can correlate audio bugs with the rules version that produced them

**Non-goals (deferred to later docs):**

- **Firestore-backed admin UI** for teacher-authored custom pronunciations — that's a v1.2+ feature with permissions, migration, and UX complexity orders of magnitude beyond YAML
- **Runtime hot-reload** of the rules — the list is baked at build time. Adding units is rare (weekly to monthly cadence); a deploy isn't a friction point worth solving
- **Per-skill or per-class pronunciation overrides** — same rules for everyone. If a class wants their tutor to pronounce "newton" differently, that's persona-level customization (1.1.12 territory); not here
- **SSML support** (`<phoneme>`, `<sub alias>`) — plain spelled-out text works on every Cloud TTS voice. SSML is per-voice + adds complexity for a marginal quality win
- **Multiple languages beyond DA / EN** — the schema + loader support N languages (just drop in a new `units.<lang>.yaml`), but v1.1.14 ships only the two we have today
- **Pronunciation analytics** (which substitutions fire most, which produce bad audio) — would be useful for cost-dashboard adjacent work but out of scope here

## Standards check

YAML 1.2 + JSON Schema are well-established standards; no custom format invented. The `{ pattern, replacement }` shape mirrors `sed` substitution — every engineer recognizes it instantly. Per [feedback_search_protocols_first](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md): searched W3C SSML (per-utterance markup, not a build-time config standard) and the broader speech-synthesis ecosystem; no protocol exists for "TTS pronunciation override config catalogue." The honest call is "thin YAML, schema-validated, no new protocol invented." JSON Schema validation uses `ajv` (already on the Next.js dependency tree via other tooling — confirm at implementation time; if not present, vendor a tiny inline validator).

No emoji in the YAML files per [feedback_no_emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md). Comments in YAML stay terse and English (the language of source-code review at AIPLA).

## Design

### YAML structure

```yaml
# frontend/src/lib/voice-pronunciation/units.en.yaml
# Voice pronunciation rules (English).
# Sibling file: units.da.yaml — every `id` here MUST exist there too.
# See docs/ops/voice-pronunciation-runbook.md for authoring guide.
version: 1
language: en
rules:
  - id: m_per_s2
    category: kinematics
    pattern: '(\d[\d.]*)\s*m\/s²'
    replacement: '$1 meters per second squared'
  - id: m_per_s
    category: kinematics
    pattern: '(\d[\d.]*)\s*m\/s(?![a-z])'
    replacement: '$1 meters per second'
  - id: kg
    category: mass
    pattern: '(\d[\d.]*)\s*kg(?![a-z])'
    replacement: '$1 kilograms'
  - id: superscript_2
    category: math
    pattern: '²'
    replacement: ' squared'
  - id: plus_minus
    category: math
    pattern: '±'
    replacement: ' plus or minus '
  # ... ~25 more entries
```

```yaml
# frontend/src/lib/voice-pronunciation/units.da.yaml
version: 1
language: da
rules:
  - id: m_per_s2
    category: kinematics
    pattern: '(\d[\d.]*)\s*m\/s²'
    replacement: '$1 meter per sekund i anden'
  - id: m_per_s
    category: kinematics
    pattern: '(\d[\d.]*)\s*m\/s(?![a-zæøå])'
    replacement: '$1 meter per sekund'
  - id: kg
    category: mass
    pattern: '(\d[\d.]*)\s*kg(?![a-zæøå])'
    replacement: '$1 kilogram'
  - id: superscript_2
    category: math
    pattern: '²'
    replacement: ' i anden'
  - id: plus_minus
    category: math
    pattern: '±'
    replacement: ' plus minus '
```

Order in the YAML file is order of application — longer patterns first so `m/s²` matches before `m/s`. The loader preserves this order.

Common-rules (decimal-comma normalisation) that apply across all languages live in a third file: `units.common.yaml`, applied before the language-specific rules.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Voice pronunciation ruleset",
  "type": "object",
  "required": ["version", "language", "rules"],
  "properties": {
    "version": { "type": "integer", "minimum": 1 },
    "language": { "type": "string", "pattern": "^(da|en)$" },
    "rules": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "category", "pattern", "replacement"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
          "category": { "type": "string", "enum": ["kinematics", "mass", "force", "energy", "power", "math", "temperature", "distance", "time"] },
          "pattern": { "type": "string", "minLength": 1 },
          "replacement": { "type": "string" }
        }
      }
    }
  }
}
```

Closed properties (`additionalProperties: false`) so typos like `replacment` fail validation. The `id` pattern enforces snake_case so PRs don't drift between `m_per_s2`, `mPerS2`, `m-per-s-2`.

### Build-time loader + validation

```typescript
// frontend/src/lib/voice-pronunciation/index.ts
import unitsEn from "./units.en.yaml";
import unitsDa from "./units.da.yaml";
import unitsCommon from "./units.common.yaml";
import schema from "./schema.json";
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

function assertValid(rules: unknown, name: string): void {
  if (!validate(rules)) {
    throw new Error(
      `voice-pronunciation: ${name} failed schema validation:\n` +
      ajv.errorsText(validate.errors),
    );
  }
}

function assertParity(en: typeof unitsEn, da: typeof unitsDa): void {
  const enIds = new Set(en.rules.map((r) => r.id));
  const daIds = new Set(da.rules.map((r) => r.id));
  const missingInDa = [...enIds].filter((id) => !daIds.has(id));
  const missingInEn = [...daIds].filter((id) => !enIds.has(id));
  if (missingInDa.length || missingInEn.length) {
    throw new Error(
      `voice-pronunciation: DA/EN parity check failed:\n` +
      `  Missing in DA: ${missingInDa.join(", ") || "(none)"}\n` +
      `  Missing in EN: ${missingInEn.join(", ") || "(none)"}`,
    );
  }
}

assertValid(unitsCommon, "units.common.yaml");
assertValid(unitsEn, "units.en.yaml");
assertValid(unitsDa, "units.da.yaml");
assertParity(unitsEn, unitsDa);

export interface PronunciationRule {
  id: string;
  category: string;
  pattern: string;
  replacement: string;
}

export function rulesForLang(lang: string): PronunciationRule[] {
  const langRules = lang.startsWith("da") ? unitsDa.rules : unitsEn.rules;
  return [...unitsCommon.rules, ...langRules];
}
```

Vite (Next.js's underlying bundler) supports YAML via `?raw` or with a small `@rollup/plugin-yaml` add. If we land on `@rollup/plugin-yaml`, it's a one-line `next.config.js` change. Verify at implementation time and document in the runbook.

### `ReadAloudButton.tsx` after migration

The 80-line inline arrays disappear. Replaced by:

```typescript
import { rulesForLang, type PronunciationRule } from "@/lib/voice-pronunciation";

function applyUnitRules(text: string, lang: string): string {
  let out = text;
  for (const rule of rulesForLang(lang)) {
    out = out.replace(new RegExp(rule.pattern, "g"), rule.replacement);
  }
  return out;
}
```

`plainTextForSpeech` keeps its current structure; only the data source changes.

### CLI surface

`aiplatform voice-pronunciation list [--lang da|en] [--category kinematics|...]`

```
$ aiplatform voice-pronunciation list --lang en --category kinematics
  m_per_s2     (\d[\d.]*)\s*m\/s²              -> $1 meters per second squared
  m_per_s      (\d[\d.]*)\s*m\/s(?![a-z])      -> $1 meters per second
  km_per_h     (\d[\d.]*)\s*km\/h               -> $1 kilometers per hour
```

`aiplatform voice-pronunciation validate` — re-runs schema + parity checks. Exit non-zero on failure. Suitable for CI.

`aiplatform voice-pronunciation add <id> --category <cat> --en-pattern '...' --en-replacement '...' --da-pattern '...' --da-replacement '...'` — appends to both YAML files (preserving comments) and re-runs validate. Atomic per command.

`aiplatform voice-pronunciation remove <id>` — for the inevitable "we shipped a bad rule, revert it" case.

### Files

| File | Change | LOC |
|---|---|---|
| `frontend/src/lib/voice-pronunciation/units.common.yaml` (new) | Language-agnostic rules (decimal-comma normalisation) | ~30 |
| `frontend/src/lib/voice-pronunciation/units.en.yaml` (new) | ~30 EN rules migrated from inline arrays | ~150 |
| `frontend/src/lib/voice-pronunciation/units.da.yaml` (new) | ~30 DA rules migrated from inline arrays | ~150 |
| `frontend/src/lib/voice-pronunciation/schema.json` (new) | JSON Schema for ruleset shape | ~50 |
| `frontend/src/lib/voice-pronunciation/index.ts` (new) | YAML loader + ajv validation + parity check + `rulesForLang` export | ~80 |
| `frontend/src/lib/voice-pronunciation/__tests__/index.test.ts` (new) | Schema validation, parity check, `rulesForLang` ordering tests | ~120 |
| `frontend/src/components/chat/ReadAloudButton.tsx` (modify) | Strip ~80 LOC inline arrays + helper consts; import from new module | -80 |
| `frontend/next.config.js` (modify) | Add `@rollup/plugin-yaml` if needed for YAML imports | +5 |
| `frontend/package.json` (modify) | Add `ajv` + `@rollup/plugin-yaml` if not already present | +2 |
| `cli/aiplatform/commands/voice_pronunciation.py` (new) | list / validate / add / remove subcommands | ~150 |
| `cli/tests/test_cli_voice_pronunciation.py` (new) | typer test cases | ~100 |
| `docs/ops/voice-pronunciation-runbook.md` (new) | Authoring guide | ~120 |

**Total:** ~960 LOC new (mostly YAML data), ~80 LOC removed.

### Empty / loading / error states (Axiom 11)

- **Empty (rules array empty in a file):** JSON Schema's `minItems: 1` fails validation; build errors with a clear message. Can't ship empty.
- **Loading:** N/A — rules are baked at build time, no runtime load.
- **Schema validation error during build:** Build fails with line/column from ajv pointing at the malformed rule. Engineer can read it and fix in one pass.
- **Parity error during build:** Build fails with explicit list of `id`s missing in one file. Engineer adds the translation or removes the orphan.
- **CLI `add` validation failure:** CLI exits non-zero with the same ajv error message; doesn't write the partial state.
- **Bad regex pattern (e.g. unbalanced parens):** ajv validates the string but not regex syntax. The loader's `new RegExp(rule.pattern)` throws at module-init time during build — runtime never sees an invalid regex. We could add an optional ajv `format: "regex"` check (ajv has a built-in `regex` format) — recommend doing so to fail fast in CI rather than at first `next build`.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Build-time bake = zero runtime cost. The student's click latency is identical to today; no extra fetch / parse / validation at read time |
| 2 | EARNED TRUST | +1 | Pronunciation correctness IS factual correctness for physics units. "Nine point eight two meters per second squared" conveys the value; "nine comma eight two m slash s squared" doesn't. Confidence in the audio = confidence in the tutor |
| 3 | SKILLS, NOT FEATURES | 0 | Pronunciation infrastructure — invisible to end users |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model selection involved |
| 5 | GRACEFUL DEGRADATION | +1 | Malformed YAML / bad regex / missing translation pair all caught at build time. Runtime never sees broken config. If the loader does fail at module-init in production (shouldn't happen, but defense in depth), `ReadAloudButton` falls back to passing raw text to TTS — degraded but functional |
| 6 | PROTOCOL OVER CUSTOM | 0 | YAML 1.2 + JSON Schema are standards. Custom *content* (the rules themselves) is necessarily project-specific; the *format* is not |
| 7 | API FIRST | 0 | No new HTTP API. CLI is the only programmatic surface |
| 8 | OBSERVABLE BY DEFAULT | +1 | Optional OTel attr `voice.pronunciation_rules_version` (git short-SHA at build time) on `voice.synthesize` spans. Lets us correlate "weird audio after Tuesday's deploy" with the specific config that shipped. Zero runtime cost |
| 9 | SECURE BY CONSTRUCTION | +1 | YAML files committed via PR + code review. No runtime input can inject a regex or replacement. The validation pipeline is the security boundary |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Pronunciation rules live client-side because they operate on text *before* sending to TTS. Build makes them static; no protocol layer. Neutral, not negative — server-side processing would add latency for no security or maintainability win |
| 11 | USABLE BY DESIGN | +1 | Structured YAML + JSON Schema validation + CLI + runbook are explicit usability wins for the NEXT engineer / AR / JB who adds units. Error messages designed up-front: empty/malformed/parity-failure states all produce actionable messages. The CLI `add` command is the empty-state UX (no curl + jq required) |
| | **Net Score** | **+6** | Threshold >= +4 ✓; target +5 exceeded |

**Conflict Justifications:** None — no axiom scored -1.

**Hard-fail checks:**
- EARNED TRUST is +1 (not -1) and the feature touches factual content (units in physics) → OK
- SECURE BY CONSTRUCTION is +1 → OK
- USABLE BY DESIGN is +1 with designed states → OK
- Zero axioms at -1 → well under the 2-axiom limit

## API Changes

None. This is a pure refactor of where the rules live — no HTTP endpoints touched.

## Migration

- **No data migration.** Existing classes / skills / personas continue to work; the rule application is invisible.
- **Build-pipeline change:** add `@rollup/plugin-yaml` (or equivalent for the Next.js bundler in use) so `import * from "./units.en.yaml"` works at build time. Verify the existing `next.config.js` + `package.json` already support this; if not, the install is one line + a config tweak. Document in the runbook.
- **No feature flag.** The migration is invisible — same rules, different source. Either it works (tests still pass) or build fails (loader couldn't validate; engineer fixes before deploy).
- **Rollback:** revert the commit. The inline arrays in `ReadAloudButton.tsx` come back; YAML files become orphan but harmless until cleanup.

## CLI Surface

| Command | Purpose |
|---|---|
| `aiplatform voice-pronunciation list [--lang da\|en] [--category kinematics\|...]` | Pretty-print rules, optionally filtered |
| `aiplatform voice-pronunciation validate` | Re-run schema + parity checks. Exit non-zero on failure. CI hook |
| `aiplatform voice-pronunciation add <id> --category <cat> --en-pattern '...' --en-replacement '...' --da-pattern '...' --da-replacement '...'` | Append to both YAML files + re-validate. Atomic |
| `aiplatform voice-pronunciation remove <id>` | Remove from both YAML files + re-validate |
| `aiplatform voice-pronunciation test <id> --text "..." --lang da\|en` | Dry-run apply one rule against sample text. Useful for "is my regex right?" before committing |

Estimate: **~0.3 day** for five subcommands (Click + ruamel.yaml for comment-preserving writes + a small validator wrapper + tests).

**Backlink:** [local-dev-cli.md](../../../v6.1.0/local-dev-cli.md).

## Testing Strategy

**Frontend (vitest):**

- `voice-pronunciation/__tests__/index.test.ts`:
  - Schema validation: malformed YAML (missing `id`, extra property, bad regex format) fails with the expected ajv error message
  - DA/EN parity check: orphan `id` in EN-only or DA-only fails with explicit message
  - `rulesForLang("da")` returns common rules first, then DA rules in order
  - `rulesForLang("en-US")` (full BCP-47) still maps to EN rules (prefix match)
  - `rulesForLang("zu")` (unknown lang) falls back to EN rules (current behavior; document in runbook)
- `ReadAloudButton.test.tsx`:
  - All 22 existing tests keep passing — the migration is a refactor, not a behavior change. This is the strictest regression bar
  - One new test: `ReadAloudButton` works when YAML files are loaded (smoke for the build-time import path)

**CLI (pytest):**

- `test_cli_voice_pronunciation.py`:
  - `list` returns valid output for both langs
  - `validate` exits 0 on the committed files
  - `add` atomically writes both files + re-validates; on failure, neither file changes
  - `remove` is idempotent (removing a non-existent id is a no-op + warning, not an error)
  - `test <id> --text "..."` correctly applies one rule

**Build-time validation:**

- A CI step runs `cd frontend && npm run build` — if the YAML loader fails its validation, the build errors out and the deploy doesn't ship. No separate test needed for the validation path; the build IS the test.

**Manual:**

- Run the dev server, open the chat, click read-aloud on a message containing "9,82 m/s²" — confirm audio still says "9.82 meter per sekund i anden" / "9.82 meters per second squared"
- Run `aiplatform voice-pronunciation add ph --category math --en-pattern 'pH' --en-replacement ' p H ' --da-pattern 'pH' --da-replacement ' p H '` — confirm files updated, validate passes, ReadAloudButton uses new rule on next build

## Implementation Plan

Suggested milestone breakdown (concrete sprint plan via sprint-planner skill at execution time):

| Step | What | Est |
|---|---|---|
| M1 | YAML migration: extract inline arrays to `units.common.yaml` + `units.en.yaml` + `units.da.yaml` | 0.2d |
| M2 | JSON Schema + ajv loader + parity check + tests | 0.2d |
| M3 | `next.config.js` YAML plugin + verify build green | 0.1d |
| M4 | `ReadAloudButton.tsx` refactor — strip inline arrays, import from new module | 0.1d |
| M5 | `aiplatform voice-pronunciation` CLI (list / validate / add / remove / test) + tests | 0.3d |
| M6 | `docs/ops/voice-pronunciation-runbook.md` authoring guide | 0.2d |
| | **Total** | **~1.1d** |

## Success Criteria

- [ ] `frontend/src/lib/voice-pronunciation/units.{common,en,da}.yaml` shipped with all rules from `cc8507f` migrated 1:1
- [ ] `frontend/src/lib/voice-pronunciation/schema.json` ships with closed properties + regex format validation
- [ ] `frontend/src/lib/voice-pronunciation/index.ts` validates both files + asserts parity at module-init; build fails on either error
- [ ] `ReadAloudButton.tsx` no longer carries the inline arrays — all rules come from the import
- [ ] All 22 existing `ReadAloudButton.test.tsx` cases pass without modification (behavior identical)
- [ ] `aiplatform voice-pronunciation list/validate/add/remove/test` work end-to-end against the committed YAML files
- [ ] `docs/ops/voice-pronunciation-runbook.md` exists and walks through adding a new rule from scratch
- [ ] Optional: `voice.pronunciation_rules_version` OTel attr on `voice.synthesize` spans
- [ ] `make lint` + `make test-fast` (backend untouched but verified) + `npm run quality:check` (frontend) all green
- [ ] CI gate: `aiplatform voice-pronunciation validate` runs as a step in the existing GitHub Actions / Cloud Build pipeline so a malformed PR can't merge

## Out of Scope

- Firestore-backed admin UI for teacher-authored custom pronunciations (v1.2+)
- Runtime hot-reload of the rules
- Per-skill or per-class pronunciation overrides (could land later via persona model 1.1.12)
- SSML / phoneme markup
- Languages beyond DA + EN (schema supports them; we just don't ship any)
- Pronunciation analytics (substitution frequency, audio quality scoring)

## Related Documents

- **Parent infrastructure:** [voice-provider-abstraction.md](voice-provider-abstraction.md) (1.1.11) — shipped 2026-06-04. The Cloud TTS path that consumes the rules
- **Sibling polish:** [voice-personas.md](../voice-personas.md) (1.1.12) — both 1.1.12 and 1.1.14 are P2 polish over 1.1.11; can ship in parallel; no cross-dependencies
- [feedback_search_protocols_first](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_search_protocols_first.md) — cited in Standards check (no protocol exists at this layer)
- [feedback_no_emoticons](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_emoticons.md) — YAML stays plain text; no emoji in rule replacements (we already substitute emoji *out* of message text)
- [feedback_no_prs_commit_to_dev](file:///Users/mark/.claude/projects/-Users-mark-dev-sunholo-cphu-aipla-app/memory/feedback_no_prs_commit_to_dev.md) — execution commits directly to dev; the runbook adopts the same workflow
- [local-dev-cli.md](../../../v6.1.0/local-dev-cli.md) — CLI command surface
- Origin commit: `cc8507f` (2026-06-04) — `feat(voice): spell out physics units + math symbols before TTS` — the inline list this doc extracts
