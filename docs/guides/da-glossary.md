# Danish translation glossary for the AIPLA guides

Reference for the Danish (`*.da.md`) guide versions in `frontend/content/guides/`.
Keeps terminology consistent and matched to the app's actual UI strings.

## The one rule that matters

**Keep on-screen button/label text exactly as it appears in the UI — in the
language of the page you are writing.** Since 1.1.108 M2 (2026-09-30) the
teacher screens are localised as well as the student ones, and they default to
Danish (`frontend/src/i18n/locale.ts`, `DEFAULT_LOCALE = "da"`). So a Danish
guide quotes the **Danish** label and an English guide the English one.

Take labels from the message files, never from memory or from an old
screenshot: `frontend/messages/da/*.json` for the Danish page,
`frontend/messages/en/*.json` for the English one (e.g. `Materialer`,
`Henvis`, `Synlig` / `Skjult`, `Tilslut`, the co-pilot `Medbygger` with
`Anvend` / `Redigér` / `Afvis` / `Send`). A page renders one language at a
time, so don't write combined labels like `Tilslut / Join`.

> Before 2026-09-30 the rule here was the opposite — the teacher UI was English
> and Danish prose kept English labels. Guides reviewed before that date may
> still follow it.

## Term map (prose, not labels)

| English | Danish |
|---|---|
| student | elev |
| teacher | lærer |
| class | klasse |
| group code | gruppekode |
| activity | aktivitet |
| the tutor / AI tutor | tutoren / AI-tutoren |
| workspace | arbejdsområde |
| checklist | tjekliste |
| simulation | simulation |
| data table | datatabel |
| chart | graf |
| calculator | beregner |
| note | note |
| teaching goal / lesson prompt | undervisningsmål (feltet hedder `Lesson prompt`) |
| co-pilot | medbygger (AI-medbygger) |
| tutor | tutor (kolonnen hedder `Tutor`) |
| tone (of a tutor) | tone |
| teaching approach | undervisningstilgang |
| curriculum materials | pensummaterialer |
| to cite (a document) | at citere / vedhæfte (knappen hedder `Cite`) |
| shared corpus | det delte materialebibliotek |
| group | gruppe |
| researcher | forsker |
| live preview | live-forhåndsvisning |

## Tone

Same as the English guides: clear, task-focused, direct address (du/din).
Address students informally. Keep sentences short and unidiomatic — many readers
are gymnasium teachers reading a second language comfortably, but plain Danish
travels best.
