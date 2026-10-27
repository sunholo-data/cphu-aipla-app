# Protocol-first identity — a reusable auth service, with AIPLA as the pilot

**Status:** **PROPOSED, umbrella design (v0.6)** — v0.6 (2026-10-27): **D10 decided: Cloud Run first, Scaleway on the roadmap**, and possibly a KU Kubernetes cluster later. Movability rules are in [ID-0 §4.5](identity-provider-decision.md#45-keeping-the-container-movable-cloud-run--scaleway--a-ku-cluster). v0.5 (2026-10-27): **the strategy is auth first, as the first step off Google** (M). Storage is serverless Postgres, EU-owned by default (D2). Where the container runs is D10. The rationale and its limits are in §0. v0.4: survey done ([ID-0](identity-provider-decision.md)), WAYF sponsor statement available. — **1.1.159**. Nothing is built. v0.1 (2026-10-25) was a standalone specification; v0.2 (2026-10-27) restates it in this repo's format, adds what v0.1 left out (§2, §3, §13–§16), and splits the work into the sub-docs listed in §17. v0.3 (same day) adds the non-AIPLA case of keeping Firestore while leaving Firebase Auth (§7.4), the authentication-vs-delegation split (§6), and the standards to track (§9). Read §2 and §3 before the architecture: they are the parts v0.1 did not have
**Priority:** **P1 for the AIPLA teacher-login slice** (Microsoft 365 teachers cannot sign in with Google today, and the password fallback goes to spam). **P2 for everything else**, which is platform work for Sunholo with AIPLA as the first deployment
**Estimated:** **Not estimable as one number, and not affordable from AIPLA's extension alone.** Rough ranges per slice are in §16. The AIPLA-critical path (M0–M2) is roughly 15–25 days; the full M0–M5 programme is several times that. Either way it is **shell** work, and the [extension plan](../plan-2026-09-to-2027-04.md) funds the discipline layer, not the shell. §16 covers funding
**Scope:** A new deployable identity service (a separate Cloud Run service, or a delegated IdP). It comes with a provider-neutral verifier and policy contract for the platform template, and AIPLA's integration of both. Backend: `auth/` (dispatcher, verifiers, `User`), the custom-claim role writers, `teacher_access`, and `db/models` ownership fields, which stay as they are by design (§13). Frontend: `lib/firebase.ts`, `fetchWithTeacherAuth`, `AGUIProvider` token minting, `/teacher/sign-in`, and the two client-Firestore hooks. Infra: a new service, its database, DNS, and secrets per env
**Source:** A v0.1 design specification circulated 2026-10-25 (*"Protocol-First Identity Architecture — AI Protocol Platform / AIPLA / Sunholo"*). The AIPLA demand: [access-requests runbook §6](../../../../ops/runbooks/access-requests.md) (*"Some pilot schools run a Microsoft 365 tenant … so Google can never return their institutional address"*), [email-deliverability-followup.md](../../../../ops/email-deliverability-followup.md) (the password fallback lands in spam; KU IT closed the SPF/DKIM ticket without acting), and notes 2026-09-09 (*"If we move away from Google login…"*; Gmail login *"convenient but problematic"*)
**Related:** [1.1.158 hosting-off-google-options](../hosting-off-google-options.md) (legal question 5: *is Firebase acceptable for teacher sign-in on its own?*) · [ku-ai-office-alignment.md](../../v2.0.0-handover/ku-ai-office-alignment.md) (option 1, *"AIPLA consumes … KU OIDC"*) · [self-hosting-and-terraform-handover.md](../../v2.0.0-handover/self-hosting-and-terraform-handover.md) (Firebase Auth → OIDC broker, effort M) · [teacher-permission-model](../../v1.0.0-pilot/implemented/teacher-permission-model.md) · [public-access-tiers-and-spend-control](../../v1.1.0-feedback/public-access-tiers-and-spend-control.md) · [anonymous-group-id-auth](../../../v6.2.0/implemented/anonymous-group-id-auth.md) · [external-host-mcp-apps](../../v1.1.0-feedback/external-host-mcp-apps.md) (the public `/mcp` and its deferred auth decision) · ADR-001, ADR-007 in the [scoping snapshot](../../_scoping-snapshot/architecture.qmd)
**Created:** 2026-10-27 (v0.1: 2026-10-25)

---

## 0. Strategy: why auth first, and where that argument stops (added in v0.5)

**M's framing (2026-10-27):** *own the auth server first, because it is the easiest first step off Google. Move hosting and databases afterwards, as each client's requirements are scoped. Even if we stay on Google, owning our own auth server lets us do more for agent auth.*

**What holds:**

1. **The agent case holds even if we never leave Google.** Firebase / Identity Platform has **no OAuth authorization server for third-party clients** ([ID-0 §3.1](identity-provider-decision.md#31-ruled-out)). Without our own authorization server there is no way to let ChatGPT or Claude reach a teacher's private AIPLA resources through MCP. Consent, scopes, CIMD, the CLI device grant, and later MCP Enterprise-Managed Authorization (§9) all need one. This is the strongest argument, and it does not depend on any hosting decision.
2. **Auth is the right first piece to make portable.** Identity is what every later move depends on: who owns a class, who may spend, whose session it is. If identity is ours and portable, a later database or hosting move does not change *who anyone is*. The AIPLA readiness work also removes Firebase-specific coupling that would block a database move anyway:
   - roles out of custom claims (`ID-3`);
   - the register keyed by actor (`ID-4`);
   - no browser→Firestore reads (`ID-5`, `firestore_client: none`).
3. **It is the smallest, least entangled service to move.** It holds no student data, its data set is tiny, and it has one well-defined interface (OIDC/OAuth). That also makes it a good pilot for running something off Google (D10).

**Where it stops, so nobody over-claims it:**

- **It does not unblock the student-data DPA.** Student trials are blocked on the *student* data path: Vertex, Firestore and BigQuery ([1.1.158](../hosting-off-google-options.md)). Auth touches none of it. Owning auth answers legal question 5 (teacher sign-in), not questions 1–4. **Auth-first is the platform direction, not the urgent fix**, and the two must not silently compete for the same 2.5 days a week. M decides the order.
- **"Easiest" is relative.** Pointing the models at an EU provider is easier: the LiteLLM route to UCloud already exists. Auth is the easiest piece to move *that is also a foundation*.
- **Owning an authorization server means owning security operations:** key rotation, advisories, incident response for a credential-bearing service. Better Auth keeps that surface small (a library, not a platform), and ID-11's negative tests rerun on every upgrade. It is still a standing obligation at 2.5 days a week.
- **The storage and hosting choices have to serve the same goal**, or the strategy contradicts itself. Hence Postgres, not Firestore (D2), and the explicit D10 on where the container runs.

## 1. Executive decision (from v0.1, unchanged in substance)

Create a reusable authentication capability for the AI Protocol Platform. Deploy it as a separate Cloud Run service or delegate it to an existing identity provider. AIPLA is the pilot: it gets a dedicated identity realm, and teachers sign in through Danish institutional systems. Firebase remains a supported alternative. **No proprietary login or agent-identity protocol is introduced.**

> **Decision (proposed):** applications use OIDC/OAuth and provider-neutral claims. The deployable reference implementation ("Sunholo Auth") uses Better Auth. Serverless SQL is preferred for new deployments; PostgreSQL and existing Firebase integrations remain supported.

**v0.2 qualifiers.** The Better Auth and serverless-SQL choices are **proposed, not decided**. §14 holds them open against named alternatives, and §8 changes the storage recommendation. The protocol half of the decision (OIDC/OAuth, provider-neutral claims, no new protocol) carries no such qualifier, and matches every earlier AIPLA document on the subject.

---

## 2. What exists today (added in v0.2)

v0.1 described a target without describing the starting point. The starting point decides most of the cost.

### 2.1 Two kinds of authenticated caller, one dispatcher

| Caller | Token | Verifier | Identity |
|---|---|---|---|
| **Teacher / researcher / admin** | Firebase ID token (RS256, Google-issued) | `auth/firebase_auth.py` | Firebase `uid` + email. Google sign-in, plus email/password on prod |
| **Student** (ADR-001) | Our own HS256 JWT, `auth_mode=anonymous_group_id` | `auth/group_id_auth.py` | A **group code**. No person, no email, synthetic `uid` |
| Local dev | stub token | `auth/local_mode_stub.py` | refused when any deploy marker is set |

[`auth/__init__.py`](../../../../../backend/auth/__init__.py) reads the **unverified** `auth_mode` claim to choose a verifier, then verifies the signature. A new issuer is a fourth branch there. The routing key should become `iss`, matched against an explicit allow-list (§7.3), never against whatever the token says.

### 2.2 Roles live in Firebase custom claims, per environment

`role: researcher`, `programmeAdmin: true`, `accessTier`, and `groupTags` are all **Firebase custom claims**. They are written in three places ([`access_sync.py:54`](../../../../../backend/auth/access_sync.py), [`admin/routes.py:138`](../../../../../backend/admin/routes.py), [`teacher_bootstrap_routes.py:84`](../../../../../backend/protocols/teacher_bootstrap_routes.py)) and read off the token in [`firebase_auth.py`](../../../../../backend/auth/firebase_auth.py) (`User`, line 34). A new issuer cannot carry them. **Roles have to move into the application policy layer**, which is what v0.1 §4 asks for anyway, and it means removing a tested mechanism rather than adding a new one (sub-doc `ID-3`).

### 2.3 Ownership is keyed on the Firebase `uid`, sometimes inside a document ID

| Where | Field |
|---|---|
| `Class`, `Activity`, `ChatSession`, `Artefact` | `ownerUid` |
| `activity_configs/{teacher_uid}:{class_id}:{activity_id}` | **composite doc ID** ([`activity_config.py:663`](../../../../../backend/db/models/activity_config.py)) |
| class tag namespace | `class:<owner_uid>:<class_id>` (in every group JWT's tags) |
| spend metering | `billing_key = teacher:{uid}` |
| BigQuery research rows, OTel spans | teacher `uid` |

Re-keying any of these is a data migration across Firestore document IDs, live group tokens and the research record. §13 avoids it.

### 2.4 The access register is keyed on email

`teacher_access/{email}` is how a teacher is invited and given a spend tier. It already caused one silent failure: [CLAUDE.md](../../../../../CLAUDE.md), *"A money gate joins on a denormalised field"*. An upstream IdP that does not release a verified email breaks invitations outright. **Unilogin may not release one** (§7.1). Sub-doc `ID-4`.

### 2.5 Two client-SDK Firestore readers depend on Firebase identity

[`useDocument.ts`](../../../../../frontend/src/hooks/useDocument.ts) and [`useDocBrowser.ts`](../../../../../frontend/src/hooks/useDocBrowser.ts) read Firestore from the browser, so `firestore.rules` evaluates `request.auth`, which has 25 references. A non-Firebase teacher has no `request.auth` and is denied. These reads must move behind the API, or a Firebase custom-token bridge has to cover them during migration (`ID-5`).

### 2.6 The demand is narrower than the architecture

| Population | Today | What they need |
|---|---|---|
| Gymnasium teachers on **Google Workspace** | Google sign-in | Nothing |
| Gymnasium teachers on **Microsoft 365** (e.g. `o365.favrskov-gym.dk`) | `users invite-password`; the reset mail lands in spam | **Non-Google sign-in. This is the actual request** |
| KU researchers (JB, AR, …) | Google / password | KU login (WAYF or KU Entra). Nice to have |
| Students | anonymous group code | **Nothing.** ADR-001 is the design, not a gap |
| MCP / A2A clients | `/mcp` is **public, no auth**, by design | Only when private skills are exposed externally |

---

## 3. Students are out of scope, deliberately (added in v0.2)

v0.1 lists `student` as a role and does not mention the anonymous group JWT. For AIPLA that has to be explicit:

- **AIPLA students keep the anonymous group code.** ADR-001 removed the code→person map on purpose. That property simplifies the data agreement now under negotiation ([1.1.158](../hosting-off-google-options.md)), and `make check-student-identity` enforces it. Unilogin for students would put that map back, and needs JB, a DPIA decision and a revised ADR-001. It is not a by-product of this project.
- The **template** may support student identities for other Sunholo deployments. The contract should allow `student` as a policy role without assuming that every deployment has one.
- One later option, not a requirement: the auth service could sign group tokens **asymmetrically** (published in its JWKS) instead of HS256 with a shared secret. That lets a second resource server verify a student without holding the secret. It only matters once there is a second resource server (sub-doc `ID-9`).

---

## 4. Goals, boundaries, non-goals (v0.1, lightly edited)

**Goals**

- Switch providers at deployment time without rewriting business logic or changing stored ownership keys.
- Support an isolated AIPLA realm, a shared Sunholo realm, and a customer-owned issuer and deployment.
- Support Danish Unilogin and WAYF federation, standard enterprise OIDC (Entra), and optional local email/password.
- Expose browser sign-in, resource-bound API authorization, MCP protected-resource discovery and A2A security metadata.
- Use independently verifiable issuer, subject, audience and scope claims. No token passthrough across resources.
- Keep sensitive student data out of identity tokens. Keep school and tenant permissions in the application policy layer.
- **(v0.2)** Leave **AIPLA's existing teachers' data untouched**: no re-keying, no lost classes, no broken join links (§13).

**Non-goals for v1**

- A universal agent-identity standard.
- Custom cryptography or OAuth protocol flows, or a generic user-directory abstraction.
- Silent single sign-on across isolated issuers.
- Replacing university or school provisioning systems.
- **(v0.2)** Identity for AIPLA students (§3).
- **(v0.2)** Workload identity. Service-to-service calls (Cloud Scheduler OIDC, the seed job, admin SA impersonation) stay on the platform's own IAM.

---

## 5. Reference architecture (v0.1)

```
Browser / A2UI / CLI / MCP / A2A clients
       │  OAuth/OIDC discovery, redirects, resource-bound tokens
       ▼
AIPLA Web / API / MCP resource ── identity verifier + policy enforcement
       │                                   ▲
       │ authorization challenge           │ JWKS / issuer
       ▼                                   │
AUTH REALM: auth.aipla.ku.dk  (Cloud Run / Better Auth — proposed)
       │ upstream OIDC                      │ persistent identity state
       ├──> Unilogin / WAYF / Entra         └──> Postgres (see §8)
       └──> local credentials (optional, off for AIPLA)

Other template deployments: Firebase verifier OR external OIDC OR shared Sunholo issuer
```

The identity realm is a **security boundary**, not a tenant organisation. A dedicated realm has its own issuer URL, signing keys, secrets, user directory, OAuth clients, consent state and database. The same container image can be deployed in different projects or accounts.

**(v0.2) Realms per environment.** AIPLA has three environments, each a separate GCP project with separate Firestore. Group codes already fail when used on the wrong environment (CLAUDE.md footgun). Identity should follow that model: **one realm per environment** (`auth.aipla-dev…`, `auth.aipla-test.ku.dk`, `auth.aipla.ku.dk`). Each has its own keys and database, and each environment's resource accepts only its own issuer. Dev and test register against the **Unilogin test broker**; only prod uses production Unilogin. Sub-doc `ID-1` fixes the naming.

---

## 6. Identity and authorization model (v0.1)

| Object | Canonical representation | Policy |
|---|---|---|
| Principal | `(issuer, subject)` | Immutable external identity key. Never key on email |
| Local actor | `internal_actor_id` | Stable app-owned ID, mapped to one or more verified principals. **For existing AIPLA teachers it *is* their Firebase uid (§13)** |
| Institution | `institution_id` | Trusted membership. Never inferred from an email domain alone |
| Role | teacher / student / researcher / programme-admin / admin | From an explicit trusted claim mapping, or an administratively approved assignment, **held in the policy store, not the token** |
| Client | OAuth client identity | An MCP client, browser app, CLI or backend workload |
| Grant | actor + client + resource + scopes | Explicit delegation. Not the same as authentication |
| Authorization | `policy(actor, action, resource, context)` | Enforced at API/tool execution even when the token is valid |
| **(v0.3) Agent** | none in v1 | A specific autonomous agent is **not** an identity in v1. An agent acts as an OAuth *client*, under a human's *grant*. Agent identity is left to the emerging specs in §9 |

**(v0.3) Authentication is not delegation.** Keep these five apart in code and in conversation:

| Concept | Standard | Example |
|---|---|---|
| Human identity | OIDC | This is a teacher, authenticated by Unilogin |
| Application identity | OAuth client metadata (CIMD) | This is ChatGPT's MCP client |
| Delegated authority | OAuth access token + scopes | This client may read this teacher's simulations |
| Agent identity | emerging specs / workload identity | (not in v1) |
| Application authorization | our policy layer | This teacher may edit this class's simulations |

Unilogin answers only the first question. **A teacher who authenticates through Unilogin gains no school, class or role from that fact alone.** Institution membership and roles come from trusted claims or from our own provisioning.

**No automatic account linking by email.** Linking requires a verified existing session plus a verified new identity, or an administrator-assisted process. Legacy Firebase UID mappings are kept separately. **Never forward Unilogin or WAYF ID tokens to downstream MCP APIs as access tokens.**

---

## 7. Provider and deployment modes (v0.1)

| Mode | Identity authority | Expected deployment |
|---|---|---|
| `firebase` | Firebase Auth | Existing app. Firebase SDK and server-side verification |
| `sunholo-dedicated` | Per-project issuer | Own Cloud Run instance, separate storage and secrets |
| `sunholo-shared` | Shared Sunholo issuer | Several first-party apps. Tenant access constrained by policy |
| `external-oidc` | Institution or customer issuer | OIDC relying party, or direct resource validation, depending on the flow |
| `disabled-dev` | None | Local tests only. Blocked in production (as `LOCAL_MODE` is today) |

Sunholo dedicated and shared modes may broker upstream OIDC identity and then issue their own audience-specific access tokens to protected APIs. External-issuer mode should not mint Sunholo tokens implicitly. Use explicit broker mode when token translation is needed.

**(v0.2) Both modes can run at once during migration** (§13), so `firebase` plus `sunholo-dedicated` has to be a valid combination, not a conflicting one, for as long as the migration window lasts.

### 7.1 Unilogin

Use the **Unilogin Broker through its OIO OIDC profile**, not generic assumptions. Production onboarding needs STIL supplier/service registration, administrative approval and configured redirect URIs. The documented flow is authorization code + PKCE, `scope=openid`, nonce and state.

- Test discovery: `https://et-broker.unilogin.dk/auth/realms/broker/.well-known/openid-configuration`
- Production discovery: `https://broker.unilogin.dk/auth/realms/broker/.well-known/openid-configuration`

Teacher login does not mean typing a Unilogin password. **Employee login with Unilogin credentials is being phased out**: employees authenticate through MitID, or through their institution's own IdP via the broker. Use actor-group filtering for employee login where it is supported, and validate the claims actually returned. Extended institution/user data may need separate institutional data agreements. Write claims mapping only after inspecting the registered service's real token set.

**(v0.2) Questions v0.1 did not ask:**

- **Does the token carry a verified email?** **Answered by [ID-0](identity-provider-decision.md#2-what-the-danish-federations-require): no.** Unilogin returns a pseudonymous `sub`, `uniid`, `aktoer_gruppe` and `institution_ids`, with name and institution from userinfo only. So `teacher_access/{email}` cannot match a Unilogin teacher, and `ID-4` is on the critical path. WAYF's `mail` is only a MAY. Registration needs a CVR number and MitID Erhverv, and costs 7,500 + 7,500 DKK a year at our volume.
- **Do institutions have to grant our service access** before their staff can use it? That is a per-school step, outside our control.
- **MitID must never return a CPR number to us.** Request the minimum scope and assert in a test that no CPR-shaped claim is stored.
- **Lead time.** STIL registration is administrative and of unknown length. It is the critical path, so start it before any engineering (§16, track N).

### 7.2 WAYF

WAYF supports OIDC federation for higher education. Confirm onboarding and client credentials with the WAYF Secretariat. WAYF publishes explicit authorization, token and UserInfo endpoints, so do not assume conventional discovery until it has been tested. Institutional affiliation and entitlement claims are subject to agreed release policies. **For AIPLA this serves researchers, not the teachers who asked** (§2.6).

### 7.3 Entra / generic OIDC

Allow external issuers only by explicit trusted configuration: expected audiences, JWKS endpoints, claim mappings and verified institution ownership. **Never accept an issuer dynamically from a user-controlled claim.**

**(v0.2) Entra solves the known AIPLA case on its own.** The Microsoft 365 schools *are* Entra tenants. A multi-tenant Entra app registration, with an allow-list of tenant IDs (never `common` accepted unconditionally), signs those teachers in without STIL. See the interim option in §15.

### 7.4 Beyond AIPLA: identity and the data store are separate axes (added in v0.3)

The question for Sunholo and other template deployments is usually *"can we leave Firebase **Auth** but keep **Firestore**?"* Yes. The design must keep these as two separate configuration axes, because they are coupled in only one place.

**Where Firebase Auth and Firestore are actually coupled.** Server-side Firestore access does not involve Firebase Auth at all. The backend connects with the runtime service account's credentials (ADC) and enforces its own policy in Python, so swapping the identity provider changes nothing on that path. The coupling is **browser-side only**: the client SDK (`onSnapshot`, `getDoc`) is evaluated against `firestore.rules`, and the rules read `request.auth` (25 references in this repo: `uid`, `token.email`, `token.groupTags`, `token.admin`). A non-Firebase token has no `request.auth`.

**Three ways to handle the browser half. A deployment picks one in config:**

| `identity.firestore_client` | How it works | Keeps Google in the identity path? | Fits |
|---|---|---|---|
| `none` | The browser never reads Firestore. Every read goes through the API, and `firestore.rules` denies all client access | **No** | AIPLA (only two hooks to move), and any deployment that wants identity off Google |
| `custom-token` | After the new issuer authenticates the user, the backend mints a **Firebase custom token** (`create_custom_token(internal_actor_id, {email, groupTags, …})`). The client calls `signInWithCustomToken`. `request.auth.uid` is then the actor ID, and the rules are **unchanged** | **Minimally.** Firebase Auth holds an opaque uid record and issues the client's Firestore session, but it is no longer the identity of record and never sees the upstream login | **Sunholo / template apps with heavy client-side realtime** (the v5-inherited `onSnapshot` patterns) |
| `native` | Firebase Auth *is* the identity provider (today's mode, optionally Identity Platform with OIDC/SAML upstreams) | Yes | Deployments with no reason to move |

`custom-token` works cleanly **because of the §13 decision**. When `internal_actor_id` equals the legacy Firebase uid, the rule `request.auth.uid == ownerId` keeps matching existing documents. If actors were given new IDs, every rule and every `ownerUid` would have to change together.

**Costs of the custom-token bridge** (sub-doc `ID-12`):

- The runtime SA needs `iam.serviceAccounts.signBlob` on itself.
- The Firebase client session refreshes **independently** of the new issuer's session. Sign-out and revocation must also call `revoke_refresh_tokens(uid)`, or a revoked teacher keeps realtime reads for up to an hour.
- Claims in the custom token are copies. Rules that read them (`groupTags`, `admin`) are only as fresh as the last mint.

**The resulting deployment matrix** (identity mode × app data store × client-read strategy are independent):

| Deployment | Identity (§7) | App data | Browser reads |
|---|---|---|---|
| Template default | `firebase` | Firestore | `native` |
| **Sunholo first-party apps** | `sunholo-shared` | **Firestore** | `custom-token` |
| AIPLA, interim (§15) | `firebase` + Microsoft provider | Firestore | `native` |
| AIPLA, target | `sunholo-dedicated` | Firestore now; Postgres if [1.1.158](../hosting-off-google-options.md) option C is chosen | `none` |
| Customer with their own IdP | `external-oidc` | Firestore or Postgres | `none` or `custom-token` |

**The auth service's own storage is a third, separate axis.** Even in an all-Firestore deployment, the auth service keeps sessions, OAuth codes, consents and refresh tokens in its own store. Whether that store can also be Firestore depends on the chosen product having a mature Firestore adapter with transactional single-use codes. **[ID-0 §4.4](identity-provider-decision.md#44-storage-serverless-postgres-because-the-goal-is-to-be-able-to-leave-google-revised-twice-on-2026-10-27) answered this: possible, but deliberately not done.** Better Auth's conformance suite would let us own a Firestore adapter. We don't, because the auth service is meant to be the first thing that can leave Google. A Sunholo app that stays on Google therefore runs **Firestore for app data plus a small serverless Postgres for auth**. Portability beats one database. App data in Firestore is unaffected either way.

---

## 8. Auth service runtime and persistence (v0.1, storage recommendation changed)

**Reference service:** Node.js / TypeScript. Better Auth with its MCP plugin, JWT signing keys, CIMD support, a small consent/login UI and Cloud Run deployment. The MCP plugin is itself an OAuth provider, so do not combine it with a second OAuth Provider plugin in the same instance. Resource APIs may be FastAPI, Node or AILANG, and verify tokens independently.

> **(v0.2) Verify before relying on it:** the relationship between Better Auth's MCP plugin and its OAuth Provider plugin (which one is current, and whether one is deprecated), and its CIMD support. Both claims are from v0.1 and have not been re-checked. That check is M0's first spike.

**Storage evaluation gate (v0.1):** (1) libSQL/Turso in an EU location, (2) Neon serverless PostgreSQL in an EU region, (3) dedicated PostgreSQL. Compare transaction guarantees, migrations, durable OAuth code/consent/refresh-token storage, availability and data-processing terms. Firestore already holds application data, but using it for Better Auth storage needs a separately validated adapter, so it is not the default. **Never use local SQLite disk as durable storage on Cloud Run.**

**(v0.5) Storage: serverless Postgres, because auth is the first step off Google.** M, 2026-10-27: *"serverless please"* and *"auth first is the easiest step off Google; then hosting and databases as clients' requirements are scoped"*. Against that goal, Firestore is the one store auth data would have to be **migrated** out of. Postgres runs at every destination, so moving is a `pg_dump`. Default host: **Scaleway Serverless SQL Database** (scale-to-zero, PostgreSQL-compatible, French-owned). Fallback: **Neon EU** (Databricks, US-owned). Off Google: a self-hosted Postgres. **No Firestore adapter.** Where the auth *container* runs is the new D10. Full reasoning: [ID-0 §4.4](identity-provider-decision.md#44-storage-serverless-postgres-because-the-goal-is-to-be-able-to-leave-google-revised-twice-on-2026-10-27). The v0.2 paragraph below now holds for all deployments.

**(v0.2) Recommendation: Postgres-family, and drop libSQL from the shortlist.** Every off-Google and on-prem path AIPLA has designed lands on Postgres: [self-hosting handover](../../v2.0.0-handover/self-hosting-and-terraform-handover.md), [1.1.158 option C](../hosting-off-google-options.md), and KU IT's likely estate. A second database technology for one service adds ops cost for a small, low-traffic table set. Which Postgres is a **data-processor question before it is a technical one**:

- Neon is a new subprocessor.
- Cloud SQL is Google, which is the DPA problem 1.1.158 is trying to leave.
- The Postgres in 1.1.158's self-contained deployment is neither.

Decide this together with 1.1.158, not separately.

**Operational controls (v0.1):** Secret Manager, regional deployment, instance scaling caps, key rotation with overlapping JWKS, rate limits, secure cookies, password verification/reset email, CORS allow-list, trusted redirect URIs, backups, audit events, minimal PII in logs, health checks, rollback migrations.

**(v0.2) Two operational facts from this repo:**

- **Email.** Local credentials need outbound mail, which is blocked on the same KU SPF/DKIM form that has stalled since September ([email-deliverability-followup.md](../../../../ops/email-deliverability-followup.md)). Keep `local_credentials.enabled: false` for AIPLA until that is resolved.
- **DNS.** `auth.aipla.ku.dk` is a KU DNS change. Judging by the SPF ticket, that takes weeks. Request it early (track N). **(v0.6) It is now a prerequisite, not a tidy-up.** The issuer is fixed at the first federation registration, and a stable issuer is what makes a later move (Cloud Run → Scaleway → a KU cluster) a DNS change rather than a re-registration ([ID-0 §4.5](identity-provider-decision.md#45-keeping-the-container-movable-cloud-run--scaleway--a-ku-cluster), P1). So no registration happens against a `run.app` URL.

---

## 9. Standards and interop profile (v0.1)

| Standard | Use | Implementation requirement |
|---|---|---|
| OIDC | Human authentication and federation | Discovery, code flow, PKCE, exact redirect URIs, nonce/state |
| OAuth 2 security profile | Authorization and delegation | RFC 9207 `iss` binding, PKCE, refresh rotation, least privilege |
| OAuth protected resource metadata | MCP client authorization discovery | RFC 9728. Advertise the intended issuer and resource |
| CIMD | Client identification | Prefer the MCP 2026-07-28 metadata profile. Legacy DCR is opt-in only |
| MCP 2026-07-28 | Tool/resource access | Compatible SDK profile, bearer challenge, resource/audience/scope checks |
| A2A 1.x | Agent interoperability | Publish Agent Card security schemes. Use identical token validation |
| SCIM 2.0 | Provisioning (later) | Only after real institution demand. Separate from login |
| **(v0.2) RFC 8628 device grant** | **`aiplatform` CLI sign-in** | The CLI is a public client with no browser redirect. Today it uses a pasted token or gcloud impersonation ([`cli/aiplatform/http.py`](../../../../../cli/aiplatform/http.py)) |
| **(v0.2) OIDC RP-initiated / back-channel logout** | Sign-out and upstream session end | A teacher who leaves a school must lose access when their institutional account ends, not when a refresh token happens to expire |
| **(v0.3) OAuth 2.1** | The baseline profile MCP builds on | PKCE mandatory for every client, no implicit or password grants, exact redirect matching. This is the profile, not an extra feature |
| **(v0.3) RFC 8707 resource indicators** | How a client asks for an audience-bound token | The mechanism behind "audience-bound to the AIPLA MCP resource". The AS must honour `resource=` |

**(v0.3) Track, don't depend on:**

- **MCP Enterprise-Managed Authorization (EMA)**, an MCP extension that lets an institution centrally control which AI clients may reach a service. It is the most relevant future fit for KU and the schools. Adopt it when it stabilises; do not build our own equivalent.
- **Agent Identity Protocol (OpenA2A AIP)**, an individual IETF Internet-Draft for cryptographic agent identities and delegation chains. It is not a standard yet.

Neither should shape the v1 contract. Both should be re-checked at each MCP release.

**Do not implement a new identity protocol inside A2UI.** A2UI components react to auth state provided by the application and start a standard browser authorization. Sensitive tokens stay out of UI-generated component trees.

---

## 10. Proposed configuration (the template contract, v0.1)

```yaml
identity:
  provider: sunholo          # firebase | sunholo | external-oidc
  realm: aipla
  issuer: https://auth.aipla.ku.dk
  resource: https://api.aipla.ku.dk/mcp
  mode: dedicated            # dedicated | shared
  upstream:
    - type: unilogin
      enabled: true
      actor_group: medarbejder
    - type: wayf
      enabled: false
    - type: entra             # (v0.2) multi-tenant, tenant allow-list
      enabled: true
      allowed_tenants_ref: secret://aipla-entra-tenants
  local_credentials:
    enabled: false
  storage:
    driver: postgres          # (v0.5) the only supported store — portable is the point
    host: scaleway-serverless # scaleway-serverless | neon | cloudsql | self-hosted
    region: fr-par
    dsn: secret://aipla-auth-db-dsn
  mcp:
    profile: 2026-07-28
    cimd: true
    legacy_dcr: false
  authorization:
    policy: aipla
  migration:                  # (v0.2) §13
    legacy_firebase: accept   # accept | link-only | off
```

**(v0.3) Two vocabularies, reconciled.** The originating discussion used `mode: brokered | external`; v0.1 used `mode: dedicated | shared`. They are different axes, and the contract needs both:

- **`authority`**: who authenticates. `firebase` / `broker` (our issuer, with upstreams) / `external` (the customer's issuer, used directly).
- **`tenancy`**: who shares the issuer. `dedicated` / `shared`. Only meaningful when `authority: broker`.
- **`firestore_client`**: `none` / `custom-token` / `native` (§7.4).

`ID-1` renames the fields above accordingly.

This YAML is a Sunholo deployment contract, not a network protocol. Secrets are secret references, never plaintext. Validation must reject conflicting modes, wildcard callbacks, non-HTTPS production issuers, and missing audience or resource bindings. **(v0.2)** It must also reject a production config whose upstream points at a test broker, and the reverse, the same environment-mismatch class as group codes.

**(v0.2) Where `resource` points.** In AIPLA the API is not a separate host: the backend runs as a sidecar inside `aipla-v01-frontend`, behind `/api/proxy`. So `api.aipla.ku.dk` does not exist yet. The resource identifier should be the URL clients actually call (`https://aipla.ku.dk/mcp`) unless a separate API host is created for its own reasons.

---

## 11. API boundary and testable flows (v0.1, plus the browser session model)

**Human browser:** (1) the app shows the configured login methods; (2) redirect through the broker to Unilogin, WAYF, Entra or local sign-in; (3) the broker validates upstream claims and links a local actor; (4) the app sets an HttpOnly, Secure session; (5) app policy resolves institution and role.

**(v0.2) This is a change of session model, not just a change of provider.** Today the browser holds a Firebase ID token and sends it as a bearer through `/api/proxy`. `fetchWithTeacherAuth` and `AGUIProvider` (the SSE stream) each obtain it. Step (4) means the **Next.js server becomes a BFF**: it holds the session cookie and attaches the access token on the proxy hop. That is the right design, and `/api/proxy` is already the single choke point it needs. It touches every teacher fetch, the stream's auth header, and the two client-Firestore hooks (§2.5). Sub-doc `ID-5`.

**MCP client:** (1) request to the protected MCP resource; (2) `401` with `WWW-Authenticate` and protected-resource metadata; (3) the client discovers the authorization server; (4) Authorization Code + S256 PKCE with CIMD-compatible client identification; (5) explicit consent to a scoped resource; (6) the client receives an audience-bound access token; (7) the API validates signature, `iss`, `aud`, `exp`, scopes and tenant policy. Deny by default. Do not forward tokens to unrelated resources.

**(v0.3) The motivating case for M3:** a teacher signs in through Unilogin, then authorises ChatGPT's MCP client to use *their* AIPLA simulations and activities. ChatGPT never sees the school credentials. AIPLA's authorization server issues the token, bound to the AIPLA MCP resource and carrying only the scopes the teacher approved.

**(v0.2)** AIPLA's `/mcp` is **public and unauthenticated by design** (public skills and sims). The MCP flow becomes relevant when private, class-scoped skills are exposed to external hosts ([external-host-mcp-apps](../../v1.1.0-feedback/external-host-mcp-apps.md)). The public surface must **stay** public; adding protected-resource metadata must not turn it into a 401 wall.

**Agent-to-agent:** publish A2A Agent Card security schemes and enforce the same API/resource authorization. Agent metadata is not proof of identity or of delegated user authority.

---

## 12. Security, privacy and compliance (v0.1, extended)

**Threats:** OAuth mix-up, token substitution, consent phishing, redirect interception, SSRF through client metadata URLs, account-linking takeover, cross-realm and cross-institution data access. **(v0.2)** Also:

- **A verifier that fails open on a JWKS fetch error.** This is the CLAUDE.md footgun *"a checker answers when it could not read its subject"*. An unreachable JWKS endpoint must produce a 503, never a fall-through to another verifier.
- **Dispatcher confusion.** A token routed to the wrong verifier because routing trusted an unverified claim.

**Mitigations:** pin issuer and redirect URIs; state, nonce and PKCE; strict JWT verification; audience- and resource-bound tokens; trusted JWKS; SSRF-safe CIMD fetching with DNS/IP protections; explicit linking and policy enforcement.

**(v0.2) Guards to add, following the footgun-table discipline.** Each one is witnessed by a fixture that must fail:

1. **A real token per issuer through the real dispatcher.** This is the same lesson as `test_dual_auth_rejection`: route tests that override the dependency pass in lockstep with the bug.
2. **A cross-environment token is rejected.** A test-realm token at prod, and the reverse.
3. **No role is read from a token.** Once `ID-3` lands, a check fails on any read of `role` / `accessTier` / `programmeAdmin` from decoded claims.
4. **The routing key is `iss`, matched against configuration.** Extend `make check-auth-dispatcher`.

**Consent:** show the requesting client, the target AIPLA resource and the precise scopes. Revoke clients and refresh tokens. Distinguish personal from institutional grants.

**Data:** store the minimum necessary claims, rotate keys safely, define retention and deletion, and audit access. Keep pupils' personal information out of agent metadata and access tokens. **(v0.2)** Add **teacher erasure**: when a teacher leaves, what happens to their actor record, principal links, and classes? This is the counterpart of [group-erasure-cascade](../../v1.1.0-feedback/group-erasure-cascade.md).

**Governance:** establish institution/controller and supplier/processor responsibilities, the DPA, subprocessors, data locations, the incident process, and whether a DPIA is needed before processing real school data. **(v0.2)** For AIPLA this folds into the [1.1.158 legal questions](../hosting-off-google-options.md#questions-to-send-to-legal), and question 5 (*is Firebase acceptable for teacher sign-in?*) decides whether this project is urgent or merely desirable.

---

## 13. Migration from Firebase (v0.1, with the re-keying decision added)

v0.1: keep Firebase and the new OIDC authentication side by side, behind separate verifier modules, during migration. Persist a provider-neutral `internal_actor_id` and a mapping table keyed by `issuer+sub`. Backfill Firebase UID linkage before changing the sign-in UI. For local passwords, prefer user-initiated resets unless a secure password-hash migration has been tested. Preserve existing resource ownership and audit mappings. Roll back by configuration switch. Never rely on issuing the same subject from two issuers.

**(v0.2) Decision proposed: for every existing teacher, `internal_actor_id` = their current Firebase uid.** New actors get a fresh opaque ID in the same format space. As a result:

- `ownerUid`, the composite `activity_configs` doc IDs, class tag namespaces inside **live** group JWTs, `billing_key`, and every BigQuery research row stay exactly as they are. There is **no data migration**.
- The Firebase principal `(securetoken.google.com/<project>, uid)` becomes one row in the principal→actor table. A teacher links Entra or Unilogin to it once, from a signed-in Firebase session. That is v0.1's "verified existing session plus verified new identity" rule, exactly.
- Rollback is a config flip, because nothing was re-keyed.

The alternative (a fresh ID for everyone, then re-key the data) touches document IDs, live student tokens and the research record **at the same time**, during term. It buys nothing except tidier IDs.

**(v0.2) Order of operations** (detail in `ID-6`):

1. Actor table plus a Firebase-only verifier that resolves through it. **No behaviour change.**
2. Roles move from custom claims to the policy store (`ID-3`), with **dual-read**: the store wins, the claim is the fallback, and every disagreement is logged.
3. The register gains actor-keyed grants (`ID-4`).
4. New issuer accepted, reached only through **"link your school login"** from a signed-in session.
5. New issuer offered on `/teacher/sign-in`.
6. Only then: retire custom-claim writers, and in the end retire Firebase.

---

## 14. Decisions this design has not made (v0.1 open decisions, plus v0.2 additions)

| # | Decision | Owner | Blocks |
|---|---|---|---|
| D1 | **→ [ID-0](identity-provider-decision.md): Better Auth, conditional on spike S1–S7. Keycloak is the fallback. Identity Platform is ruled out long-term (no MCP authorization server, no residency).** Original question: **Build on Better Auth, or adopt Keycloak / Zitadel / Authentik, or use Firebase Identity Platform's OIDC/SAML providers?** v0.1 chose Better Auth without comparing alternatives. Earlier AIPLA docs named **Keycloak** (the Unilogin broker is itself Keycloak), and the self-hosting doc named Supabase GoTrue. Identity Platform could add Unilogin and Entra as providers **with no new service**, but keeps teacher identity at Google, which is the 1.1.158 question. Criteria: KU IT operability, on-prem story, MCP/CIMD maturity, ops burden at 2.5 d/week, licence | M (+ AD) | Everything after M0 |
| D2 | Storage: **→ Postgres only, on serverless hosting. Scaleway Serverless SQL (EU-owned) by default, Neon EU fallback, self-hosted off Google** ([ID-0 §4.4](identity-provider-decision.md#44-storage-serverless-postgres-because-the-goal-is-to-be-able-to-leave-google-revised-twice-on-2026-10-27)). Decided in principle by M 2026-10-27; confirmed by spike S8–S10 | M | M1 |
| D10 | **(v0.5) Where does the auth container run?** **Decided 2026-10-27 (M): Cloud Run first, with Scaleway Serverless Containers on the roadmap**, and possibly a KU Kubernetes cluster later. Running on Cloud Run makes no legal change to teacher sign-in until the move. The move stays cheap only under the six rules in [ID-0 §4.5](identity-provider-decision.md#45-keeping-the-container-movable-cloud-run--scaleway--a-ku-cluster). The one that cannot be fixed afterwards is P1: the issuer is `auth.aipla.ku.dk` from the first registration, never a `run.app` URL | M | ~~M1~~ decided |
| D3 | AIPLA teachers only for the pilot? Which institutional role/affiliation claims are contractually available? | JB | M2 claims mapping |
| D4 | Is `auth.aipla.ku.dk` customer-controlled? Who operates its keys, domain and DPA? | M + KU IT | M2 |
| D5 | Which MCP clients must work in the first release? Verify CIMD support, and define legacy DCR compatibility if needed | M | M3 |
| D6 | Who performs the Unilogin registration: Sunholo, the University of Copenhagen, or the operating institution? | M + JB | **Track N, now** |
| D7 | **(v0.2) Where does the service's code live?** A new repo (e.g. `sunholo-data/sunholo-auth`), with the template contract in `platform-source` and only the AIPLA profile here? The marker screen will classify anything naming Unilogin or KU as AIPLA-owned, so the generic half has to be written generic from the start or it cannot be ported up | M | M0 |
| D8 | **(v0.2) Who funds it?** See §16 | M | Starting M1 |
| D9 | **(v0.2) Take the Entra interim (§15) now, or wait?** | M | Nothing; it is independent |

---

## 15. An interim that fixes the actual complaint in days (added in v0.2)

The teachers who cannot sign in today are on **Microsoft 365**. Firebase Auth supports Microsoft as a built-in provider (`OAuthProvider('microsoft.com')`, configured with a multi-tenant Entra app). It is **no new service, no new database and no migration**: one provider in `infrastructure/env/firebase.tf`, one button on `/teacher/sign-in`, and the existing `teacher_access/{email}` match, because Entra returns the institutional email.

- **Cost:** roughly 1–2 days per env, mostly the Entra app registration and a tenant allow-list check in the bootstrap path (Firebase does not restrict tenants itself).
- **It removes the dependency on the stalled SPF/DKIM form** for these teachers, because they no longer need a password-reset email.
- **It does not** move teacher identity off Google, and it does not reach Unilogin. If legal answers 1.1.158 question 5 with "Firebase is not acceptable", the interim is still worth having for the months the full service takes, but it does not end the project.

**Recommendation:** take it (D9), unless legal has already ruled out Firebase for teachers.

---

## 16. Phasing, capacity and funding (v0.1 milestones, re-cut)

**v0.1 milestones, unchanged:**

| Stage | Deliverable | Acceptance gate |
|---|---|---|
| M0 — Contracts | Identity config schema, role policy, validation | Rejects unsafe issuers. Firebase baseline regression green |
| M1 — Core | Auth service on Cloud Run + SQL + reference SDK | Sign-in, session, signing/rotation, backup/restore and revocation tests |
| M2 — AIPLA | Dedicated realm + Unilogin staging | Teacher signs in with a test identity. Institution access is controlled |
| M3 — Agent | MCP OAuth/CIMD, A2A advertised schemes | Real MCP client discovery and consent. Wrong `aud`/scope denied |
| M4 — Portability | External OIDC, Firebase and self-hosted IaC | One template, three issuers, no changes to app business code |
| M5 — Enterprise | WAYF, Entra, tenant admin controls | Federated tests and an agreed role/claim mapping |

**(v0.2) Four tracks, because three of them do not wait on engineering:**

| Track | What | Rough size | Starts |
|---|---|---|---|
| **N — Non-engineering lead times** | STIL registration (D6), WAYF sponsor statement (**KU will provide it**, M 2026-10-27) then secretariat credentials, KU DNS for `auth.*`, legal question 5 | hours of M's time; **weeks to months of calendar** | **Now**. It is the critical path |
| **I — Interim** | Entra via Firebase (§15) | ~1–2d | On D9 |
| **A — AIPLA readiness** (useful whatever D1 decides) | Actor table + legacy mapping, roles out of claims, actor-keyed register, BFF session, client-Firestore reads behind the API (`ID-3` to `ID-6`) | ~8–12d | After M0 |
| **P — Platform service** | M1, M3, M4, M5 | ~15–30d for M1 + M4; M3/M5 on demand | When funded |

**Capacity.** The extension has ~75 days at 2.5 d/week. They are committed to the discipline layer, with about 11 days unallocated, and those are already spoken for (plan decision 15). **Track A alone exceeds that slack.** So, to be stated plainly rather than discovered later: **the AIPLA-funded part is N + I and, if M chooses, A. Track P is Sunholo platform work** that AIPLA consumes and should be funded as such (D8). If D1 resolves to Identity Platform, P largely disappears and A is most of the cost.

---

## 17. Sub-documents

Each is a separate design doc. They are **not written yet**, so they are named here as plain text rather than linked. Order is by dependency.

| ID | Sub-doc (planned file) | Covers | Track |
|---|---|---|---|
| ID-0 | [identity-provider-decision.md](identity-provider-decision.md) | **Written 2026-10-27.** Survey of 14 products against the Danish federation requirements. **Lean: Better Auth, if a ~2d spike passes. Fallback Keycloak. Auth0 EU only if legal accepts a US-owned EU-hosted processor** | M0 |
| ID-1 | `identity-config-contract.md` | §10 schema, validation rules, realm-per-env naming, the template/AIPLA split (D7) | M0 |
| ID-2 | `unilogin-integration.md` | §7.1: STIL registration steps, the test broker, the real claim set, actor-group filtering, the email question, MitID/CPR exclusion | N → M2 |
| ID-3 | `roles-out-of-custom-claims.md` | §2.2: policy store keyed by actor, dual-read migration, retiring the three claim writers, the guard | A |
| ID-4 | `access-register-by-actor.md` | §2.4: invitations that survive an IdP with no email (invite link bound on first sign-in), the uid-stamping footgun retired | A |
| ID-5 | `bff-session-and-client-reads.md` | §11 session model: `/api/proxy` as BFF, `fetchWithTeacherAuth`, `AGUIProvider`/SSE, `useDocument`/`useDocBrowser` behind the API or a custom-token bridge | A |
| ID-6 | `firebase-coexistence-and-linking.md` | §13: actor = legacy uid, the linking flow, rollback, the cutover order, teacher erasure | A |
| ID-7 | `entra-interim.md` | §15 (small enough to be a sprint note rather than a design) | I |
| ID-8 | `auth-service-runtime.md` | §8: service, storage, keys and rotation, email, DNS, ops, backups, observability | P / M1 |
| ID-9 | `mcp-a2a-authorization.md` | §11 MCP and A2A, keeping public `/mcp` public, CIMD, RFC 9728, optional asymmetric group tokens (§3) | P / M3 |
| ID-10 | `wayf-and-researcher-login.md` | §7.2 for KU researchers | P / M5 |
| ID-11 | `identity-threat-model-and-tests.md` | §12 threats, the guard set, and the test matrix below as runnable cases | all |
| ID-12 | `firestore-with-external-identity.md` | §7.4: the `firestore_client` modes, the custom-token bridge (minting, refresh, revocation, claim freshness), and rules that work unchanged because actor ID = legacy uid. **The piece that makes this design reusable for Sunholo** | P / M4 |

---

## 18. Test matrix (v0.1, plus v0.2 rows)

**Positive:** browser session, Unilogin test account, WAYF test account, email/password optional mode, MCP consent, token refresh and revocation, authenticated A2A request. **(v0.2)** Also: an existing Firebase teacher links Unilogin and **sees the same classes**; a student's group token issued **before** cutover still works after it.

**Negative:** altered JWT; unknown key; wrong issuer, audience, resource or scope; expired token; forged institution claim; invalid PKCE; replay; unauthorized account linkage; open redirect; malicious CIMD URL; cross-realm API call. **(v0.2)** Also: test-realm token at prod; JWKS unreachable (→ 503, not fall-through); a role claim injected into a token is ignored; an Entra token from a tenant not on the allow-list.

**Deployment:** Cloud Run scale-to-zero recovery; storage outage and rollback; concurrent authorization requests; schema migration; key rotation; login email service failure; DNS / certificate change. **(v0.2)** Also: the promote pipeline carries every per-env identity value. This is the *"anything per-env in `cloudbuild.yaml` needs a `cloudbuild.promote.yaml` twin"* footgun, and it applies to the issuer URL and client IDs.

**Isolation:** two dedicated realms with identical user emails and overlapping subject strings never share actors, grants, credentials or resources.

---

## 19. Axiom check

| # | Axiom | Score | Note |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | One redirect at sign-in. Token verification must stay local (cached JWKS), never a per-request call to the auth service |
| 2 | EARNED TRUST | +1 | Teachers sign in with the login their school already gave them, not a Google account or a reset email from `firebaseapp.com` |
| 5 | GRACEFUL DEGRADATION | ±0 | A new service is a new failure point. It must fail **closed** for teachers, and must not touch students, whose group JWTs are verified without it |
| 6 | PROTOCOL OVER CUSTOM | +1 | OIDC/OAuth, RFC 9728, CIMD, A2A schemes. No new protocol |
| 9 | SECURE BY CONSTRUCTION | +1 | Roles leave the token, the issuer is pinned per env, and every guard is witnessed |
| 11 | USABLE BY DESIGN | 0 | Depends on `ID-5`/`ID-6`: linking must be one click for an existing teacher, and the login page must work in Danish and English |

---

## 20. References

- MCP 2026-07-28 release — <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- MCP TypeScript SDK migration — <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>
- Better Auth MCP plugin — <https://better-auth.com/docs/plugins/mcp>
- Better Auth OAuth Provider — <https://better-auth.com/docs/plugins/oauth-provider>
- Better Auth database — <https://better-auth.com/docs/concepts/database>
- Unilogin implementation — <https://viden.stil.dk/spaces/OFFSKOLELOGIN/pages/185470807/Implementering+af+tjeneste>
- Unilogin service prerequisites — <https://viden.stil.dk/spaces/OFFSKOLELOGIN/pages/103678068/Servicebeskrivelse>
- Unilogin employee login change — <https://viden.stil.dk/spaces/STILVIDENOFFENTLIG/pages/237667653/Login+med+Unilogin+udfases+for+medarbejdere>
- WAYF OIDC configuration — <https://www.wayf.dk/en/oidc-configuration-wayf>
- A2A 1.0.1 specification — <https://a2a-protocol.org/v1.0.1/specification/>
- Danish DPA controller/processor guidance — <https://www.datatilsynet.dk/regler-og-vejledning/grundlaeggende-begreber/rollefordeling-dataansvarlig-og-databehandler>

The external references are carried over from v0.1 and **were not re-verified for v0.2**. ID-0's spike checks the Better Auth and MCP claims in particular.
