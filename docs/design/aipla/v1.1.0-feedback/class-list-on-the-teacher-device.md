# A class list that never leaves the teacher's device — names against codes, exported to Excel

**Status:** ✅ M0–M2 SHIPPED 2026-09-29 (CLASSVISIT-1 lane C) — **1.1.137**. The CI guard (§Guard) is not built yet
**Priority:** **P1 (M0–M1)** — teacher-sourced, cheap, and needs only teachers, so it is **un-gated**. **M0 also fixes a latent bug in every existing export.** The server-side alternative is **not** P-anything until JB decides, see *The line this does not cross*
**Estimated:** ~1–1.25d (M0 Excel-safe export ~0.25d · M1 the class list sheet ~0.75d · M2 import back ~0.25d)
**Scope:** Frontend only: `lib/download.ts`, `app/teacher/classes/[id]/page.tsx` (codes list :400–515), a new `_ClassListSheet.tsx`, `messages/{da,en}/`. **No backend change, by design**
**Dependencies:** ADR-001 ([snapshot](../_scoping-snapshot/architecture.qmd)) — the constraint; the class page's codes list with join links and revoke (**shipped**, revoke in `52ca6b5a`) — what this extends. **Un-gated**
**Created:** 2026-09-29
**Source:** [class-visit-2026-09-feedback-triage.md](class-visit-2026-09-feedback-triage.md), item 3 — *"The teacher also mentioned if there is an option where they can write students names in codes and download them as an excel."*

## Problem Statement

A teacher hands out six join codes to six groups. After the lesson, they
need to know that `still-violin-61` was Anna, Bo and Carl. That is what makes a
group report useful for **their** follow-up. Today they keep that on paper or
in their own spreadsheet, typing the codes by hand.

## The line this does not cross

ADR-001 ([architecture.qmd](../_scoping-snapshot/architecture.qmd), decided M + JB 2026-05-18) is unambiguous:

> collect **no student identity data at all** — not pseudonyms, not first
> names, not device identifiers, nothing. … the system is *architecturally
> incapable* of collecting student personal data … The "separate identity map
> that researchers cannot access casually" from the earlier draft is removed —
> the map doesn't exist.

The same promise went to UCPH IT (*"the 'personal data' category is empty by
construction"*, [ucph-it-hosting-requirements](../v2.0.0-handover/ucph-it-hosting-requirements.qmd)).
**A names ↔ codes table in Firestore is exactly the identity map ADR-001
removed.** It would also be one refactor away from reaching the LLM:
`tools/class_management.py:79–88` `_class_brief` sends `group_codes` to the
co-pilot, and so would the group report, `session.title` or the live view.

So the teacher's request is fine and the obvious implementation of it is not.
**The feasible version keeps the list on the teacher's device.** The teacher
types names into a sheet on the class page, which is saved in their browser
only, and downloads it as an Excel file. The server never receives a name,
so ADR-001 holds by construction rather than by care.

This matches what the teacher asked for. They asked to *write names and download
them*, not for AIPLA to remember names.

## Design

### M0 — Exports that open correctly in Danish Excel (~0.25d)

`lib/download.ts` `downloadCsv` writes UTF-8 **without a BOM**, comma-separated.
Danish-locale Excel reads that as Windows-1252 with `;` as the list
separator. `Søren` arrives as `SÃ¸ren` and every row lands in column A.
**This already affects the transcript exports teachers use today**
(`_exportHelpers.ts`, the group report).

Fix: prepend `﻿`. For the class list (M1), write a **real `.xlsx`**, which
is what was asked for and avoids the separator problem entirely:

- A small **write-only** xlsx library, `import()`-ed lazily on the button click.
  Teacher route only, so there is no student bundle cost. **Not the npm `xlsx`
  (SheetJS) package**: the registry copy is frozen at a version with open
  advisories and would fail `make security-check`. Run the security gate
  on whichever library is chosen before adding it.
- Keep CSV-with-BOM as the zero-dependency fallback.

### M1 — The class list sheet (~0.75d)

On the class page, next to the codes list: **"Class list"**, a table with one
row per live code.

| Code | Join link | Names (only on this device) | Note |
|---|---|---|---|
| `still-violin-61` | `…/group?code=still-violin-61` | *Anna, Bo, Carl* | |

- **Names are stored in `localStorage` only**, keyed `aipla.classlist.{classId}`,
  and never put in React state that is sent anywhere. Code comment and test: *no
  fetch body, query or header ever contains a names-column value*. The test
  spies on `fetch` while typing.
- The column header itself says **"only on this device"**, and one line under
  the table says so plainly (copy object, `da`/`en`). The teacher must know that
  another browser will not have it, **before** they rely on it.
- **"Download as Excel"** writes Code, Join link, Names, Note, and the class
  name and date in the title row. Revoked codes are dropped, and new codes appear
  with an empty name cell.
- The same sheet is useful **before** the lesson: a printable list of join
  links to hand out, which also helps with the footgun *"group code used on the
  wrong environment"*, because the link carries the env.
- Wrap every `localStorage` read/write in try/catch. A private window loses
  the list, and the page must say so rather than silently show blanks.

### M2 — Bring it back on another device (~0.25d)

**"Import from Excel/CSV"**: the teacher uploads the file they downloaded.
It is parsed **in the browser**, matched on the Code column, and written to
`localStorage`. Nothing is uploaded. This makes "only on this device"
bearable: the teacher's own Excel file becomes the portable copy, held by the
teacher on KU's systems, which is where the school already keeps class lists.

### Guard

A small CI check in the shape of `check-literature-corpus-isolation.sh`:
**no backend model may gain a field named like `student_name` / `names` /
`roster` on a class or group record** without an allowlist entry that cites a
DPIA decision. The cost is small, and it makes the
ADR-001 line enforced rather than remembered, which is the direction the
footguns table asks for.

## The server-side alternative, if JB ever wants it

If teachers later need the list **on every device** without an import step,
that is a stored identity map. It requires JB + DPIA sign-off, an ADR-001
revision, UCPH IT informed, and names fenced out of the LLM, BigQuery and
reports. It is **not recommended now**. It trades a 10-second import for the
project's strongest privacy property, in the middle of the Google data-agreement
negotiation that same property simplifies.

Relatedly, [teacher feedback item 27](teacher-feedback-2026-08-21-triage.md)
(individual codes combinable into groups) is the other open ADR-001 revision.
If JB takes that up, decide both together.

## Acceptance

- A teacher types names against codes, reloads, and the names are still there.
  In another browser they are not, and the page says why.
- The downloaded file opens in Danish-locale Excel with æøå intact and one
  value per cell.
- A test proves no request carries a names value.
- The existing transcript CSV export opens correctly in Danish Excel (M0 fixes it).

## What shipped — 2026-09-29

CLASSVISIT-1 lane C. Frontend only; no backend file changed.

- **M0 — `lib/download.ts`.** `downloadCsv` now writes a UTF-8 BOM
  (`toCsv`, exported so the bytes are testable), which fixes æøå in the
  existing transcript and group-report exports. ⚠️ **The BOM fixes the
  encoding, not the separator:** Danish Excel still splits a double-clicked
  comma CSV on `;`. A `sep=,` line would fix that but makes Excel ignore the
  BOM, so it was not added; the class list sidesteps it by writing xlsx.
  `parseCsv` (BOM-stripping, separator auto-detected by *consistency* so a `;`
  file full of "Anna, Bo, Carl" names still parses) serves M2.
- **M0 — `lib/xlsx.ts`, no new dependency.** A STORED ZIP writer + CRC-32 and
  the five minimal parts, inline strings, XML-escaped (forbidden control
  characters dropped). `downloadXlsx(filename, rows, {sheetName, columnWidths})`.
  Verified outside the test suite: `unzip -t` clean, `openpyxl` reads every
  cell with æøå intact, LibreOffice headless converts it. **Not verified in
  desktop Excel** — a teacher's first download is that check.
- **M1 — `_ClassListSheet.tsx`,** mounted as a collapsed "Class list" section
  on the class page, between Groups and Class settings. One row per live code
  (`cls.groupCodes`, which a revoke removes), join link, "Names (only on this
  device)", Note. Stored only in `localStorage` `aipla.classlist.{classId}`,
  every access in try/catch; if storage is refused the page says so. Writes
  keep live codes only, so a revoked code's names leave the device too. Copy
  is a `da`/`en` object; the page passes `en` (teacher surfaces stay English
  until i18n M2).
- **M2 — import.** Parsed in the browser: xlsx by magic bytes, else CSV.
  Matched on Code, header row found in either language, a non-empty cell
  overwrites and an empty one keeps what is on the device. Files **re-saved by
  Excel** (DEFLATE + `sharedStrings.xml`) are read through
  `DecompressionStream('deflate-raw')`; a browser without it gets "save as CSV
  and import that".
- **Tests.** `lib/__tests__/xlsx.test.ts` walks the archive independently of
  the reader (local headers, central directory, CRCs, EOCD) and reads a
  hand-built deflate + shared-strings file. `_ClassListSheet.test.tsx` spies on
  `fetch`, `fetchWithAuth` and `fetchWithTeacherAuth` while a name is typed,
  downloaded and imported, and asserts none was called and none carries it;
  plus persistence across remount, revoked-code exclusion, storage-refused
  warning, import. `page.test.tsx` repeats the no-request check on the real
  page while a group is minted.
