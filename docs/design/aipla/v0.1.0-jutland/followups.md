# v0.1 Jutland — Follow-ups (capture before they slip)

Items surfaced during the buffer-week sprints that don't block the
2026-05-27 demo but should be picked up before v1 pilot starts. Each
entry has enough context that a fresh session can act on it.

## 1. Cloud Build seed-platform-skills returns 403 silently

**Where:** `cloudbuild.yaml` step `seed-platform-skills` (line 242),
hitting `POST /api/proxy/api/admin/seed-platform-skills` with a
metadata-server ID token.

**Observed:** Build SUCCEEDED but the seed step logged
`seed-platform-skills -> 403 body={"detail":"Not authorized"}` and
`exit 0` (the step is intentionally non-fatal). Result: cloud Firestore
had zero platform skills after the deploy. Worked around by running
`platform_seed.seed()` from a laptop directly against cloud Firestore
on 2026-05-20.

**Why it matters:** The seed step exists precisely so a redeploy
recovers the skills. If it silently fails, every deploy after a
PLATFORM_OWNER_UID change (or any seed-needing edit) leaves the cloud
in a half-broken state.

**Hypothesis 1 — token's `email` claim missing despite `include_email=true`.**
The cloudbuild.yaml comment from earlier debugging warns this is the
common failure mode and the fix is the explicit `include_email=true`
query param. That param is already there. So either:
- The metadata-server is ignoring `include_email` for this SA in this
  project. (Test: decode the token before sending and inspect claims.)
- The backend's `_assert_caller_is_service_account` is reading a
  different claim than `email`. (Test: log the full claims dict on the
  next 403.)

**Hypothesis 2 — audience mismatch.** The metadata-server mints the
token with `audience=$URL`. The backend's `id_token.verify_oauth2_token`
re-verifies against Google's keys. If the URL changed between the
trigger config and the deployed service URL (e.g. trailing slash), the
verify would fail before the email check even runs. (Test: print the
audience claim + the verifier's expected audience.)

**Hypothesis 3 — ADMIN_SEED_ALLOWED_SAS is stale or case-mismatched.**
Verified the deployed env var IS `aipla-v6@aipla-dev-2026.iam.gserviceaccount.com`
which matches the trigger SA. Probably not it, but worth re-checking
after a deploy by curling `/api/admin/whoami` (if it exists) under
the same token.

**Action when picked up:**
1. Add temporary debug logging in `backend/admin/auth.py
   _assert_caller_is_service_account` that logs the full token claims
   dict on the next 403.
2. Trigger a redeploy and inspect the cloud-run logs.
3. Once root cause is known, fix + delete the debug log + add an eval
   case that asserts the seed step succeeded.

**Why not block the demo on this:** the workaround (run seed from a
laptop) is a 10-second one-liner I can repeat after any cloud deploy.
The demo URL is currently working.

## 2. Firestore rules CI/CD — verify they actually deploy

**Where:** `cloudbuild.yaml` line 55 has
`firebase -P ${_PROJECT_ID} --json deploy --only firestore:rules,firestore:indexes --force`.

**Confirmed:** Yes, rules ARE deployed by every build. Indexes too.

**Open question:** are the deployed rules what the file says? The flow
is: Cloud Build container → `npm install -g firebase-tools` → runs the
`firebase deploy` command against `firestore.rules` + `firestore.indexes.json`.
A failure mid-step would log but the build's overall success/failure
isn't gated on this (it's in the same step as image push — if image
push succeeds the step exits 0 regardless of firebase deploy outcome).

**Action when picked up:**
1. Add a separate Cloud Build step that ONLY runs the firebase deploy,
   and gate the rest of the build on its success.
2. Add a smoke step that fetches the deployed rules + diffs against
   the file on disk. Fail the build if they diverge.
3. Add a unit test for `firestore.rules` that exercises a
   read-without-auth and a permitted read with the anon-group token
   identity — catches the case where rules drift to deny everything.

**Why not block the demo on this:** v0.1 uses LOCAL_MODE for most
testing; cloud rules are only really exercised by anonymous-group
joins which DO work end-to-end on the deployed URL right now (just
verified). So rules are deployed AND functional — the gap is
verification rigour, not a live bug.

## 3. Group code admin-mint endpoint vs. local seed

**Where:** `backend/admin/routes.py` `POST /api/admin/mint-demo-group`
takes the same SA-token gate as `seed-platform-skills`. So if (1) is
broken, ops can't mint a fresh demo code either. Currently we hand-mint
via Python from a laptop against cloud Firestore.

**Action when picked up:** once (1) is fixed, write a small
`scripts/mint-cloud-group.sh <env>` that wraps the admin endpoint with
the right metadata-server token + audience flow. Saves the manual
Python recipe.

## 4. Wordlist expansion + Danish version

**Where:** `backend/auth/group_id_wordlist.py`.

**Status:** 100 adjectives + 100 nouns + 100 two-digit suffixes = ~1M
codes. Plenty for v0.1.

**For v1:**
- Add a Danish wordlist next to the English one (same constraints —
  no homophones, no ambiguous-with-English words, classroom-safe).
- Route through skill metadata: a teacher minting a code can request
  Danish or English. Default per `Accept-Language` on the create
  endpoint, override on the request body.
- Possibly add curated themes (animals-only / colours-only) so codes
  for the same class share a "feel" and are easier to remember by
  association.

## 5. Group-code QR / share-sheet

**Why:** teachers shouting `bright-fox-42` works for tablets in the
classroom but a QR is faster and removes typo risk entirely.

**Sketch:** existing `create_group` returns a `join_url`. Add a small
client component that wraps the join_url in a QR (vendored qrcode-svg
generator, ~5 KB, no external fetch). Teacher screen-shares or projects.

Out of scope for v0.1.
