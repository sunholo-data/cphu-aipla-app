# ID-0 — Which identity service: survey and recommendation

**Status:** **SURVEY DONE, DECISION OPEN.** This is the recommendation for D1 in the [umbrella](protocol-first-identity.md#14-decisions-this-design-has-not-made-v01-open-decisions-plus-v02-additions). The decision waits on a two-day spike (§5) and one legal answer (§4.3)
**Parent:** [protocol-first-identity.md](protocol-first-identity.md) (1.1.159), sub-doc ID-0
**Created:** 2026-10-27. All product facts were checked against vendor docs, release notes and issue trackers **on 2026-10-27**. Items marked *UNVERIFIED* could not be confirmed. This area moves monthly (Better Auth CIMD shipped in April, Zitadel DCR in August, Clerk CIMD in September), so re-check before deciding if more than a month has passed
**Estimated:** this doc ~0.5d (done) · the spike in §5 ~2–3d (S11, the portability check, is a few hours)

---

## 1. What the service must do

These are the requirements from the umbrella, in order of how hard they are to satisfy:

1. **Connect to Danish federations as a relying party.** Unilogin (OIO OIDC profile), WAYF (OIDC, SAML-first), and Entra multi-tenant.
2. **Be the authorization server for MCP clients.** Required: OAuth 2.1, RFC 8414, RFC 8707 audience-bound tokens, PKCE S256, and **CIMD**. The 2026-07-28 MCP release deprecates DCR in favour of CIMD.
3. **Data-processor posture KU can accept.** This is the same open question that blocks Google ([1.1.158](../hosting-off-google-options.md)).
4. **Serverless: compute and storage both scale to zero** on Cloud Run across three environments, operated by a team of about 2.5 days a week.
5. Device grant for the CLI, key rotation, refresh rotation, and a **Danish and English** login UI (the localisation rule).
6. Nice to have: store auth state in **Firestore**, so a Sunholo deployment runs on one database.

---

## 2. What the Danish federations require

These facts constrain every candidate, so they come first.

### Unilogin (STIL)

| Fact | Consequence |
|---|---|
| The broker **is Keycloak**: discovery lists `client_secret_post/basic`, `private_key_jwt`, `client_secret_jwt` and `tls_client_auth` | Every candidate can authenticate to it |
| STIL's guide (2026-08-11) and its Python sample use **`client_secret_post`** ([guide](https://viden.stil.dk/rest/api/content/185470807)) | **`private_key_jwt` is not required.** This removes the one requirement that would have excluded Better Auth and Zitadel |
| **PKCE S256 with a `code_verifier` of exactly 128 characters**, new per request (same guide). Whether the broker enforces the length is *UNVERIFIED* | **The spike must test this.** A product that sends 43-character verifiers may fail |
| Employee-only login is requested with **`acr_values=dk:unilogin:aktoergruppe:medarbejder`**, live since 2026-02-03 ([OIDC page](https://viden.stil.dk/rest/api/content/185470808)) | The product must pass **custom authorize parameters**. Fallback: filter afterwards on the `aktoer_gruppe` claim |
| Claims: `sub` (a pseudonym), `uniid`, `aktoer_gruppe`, `acr`, `has_license`, `institution_ids`. Name and institution come **only from userinfo** (`inst_brugere`). **No email claim** | Confirms the umbrella's §2.4: **`teacher_access/{email}` cannot match a Unilogin teacher.** ID-4 is mandatory, not optional. `institution_ids` gives the institution boundary the policy layer needs |
| Licence management is optional, per grouping. With it on, unlicensed users are denied | We can turn it off for a pilot, or use it as a school-level opt-in |
| **Prerequisites:** register as an *Udbyder* (needs a **CVR number**), admins need **MitID Erhverv**, request "Unilogin Broker" on tilslutning.stil.dk, file a declaration of relevant purpose before production, and sign separate data agreements for extended data ([prerequisites](https://viden.stil.dk/rest/api/content/63537206)) | **This answers who can register (D6): a Danish legal entity with a CVR number.** That is KU, or Sunholo if it has one |
| **Fees:** 15,000 DKK to establish plus 15,000 DKK a year, or **7,500 + 7,500 DKK** below 2,000 logins a week (page dated 2024-09-30, [fees](https://viden.stil.dk/rest/api/content/161061375)) | A real line item. AIPLA is well under 2,000 logins a week |
| Test broker `et-broker.unilogin.dk` is free and comes with test users | The spike can start before registration |
| Employees can no longer use Unilogin credentials. They use a local IdP or MitID Erhverv, at NSIS level from 2026-01-15 | Teachers will see MitID or their school's Microsoft login *inside* the Unilogin flow |

### WAYF

| Fact | Consequence |
|---|---|
| OIDC code flow since 2025-04-30. **SAML is still described as the standard**, OIDC "to some extent" ([onboarding](https://wayf.dk/en/node/49)) | OIDC is enough for us |
| Token endpoint accepts `client_secret_post/basic`. PKCE is optional but enforced once you start it ([discovery](https://wayf.wayf.dk/.well-known/openid-configuration)) | No product is excluded |
| Scopes are ignored. The claim set is fixed at onboarding. **`mail` is only a MAY**; `eduPersonPrincipalName` and the affiliation are guaranteed ([attributes](https://wayf.dk/en/node/60)) | Same lesson as Unilogin: never key accounts on email |
| **KU is reachable**, with a per-organisation issuer `https://wayf.wayf.dk/op/ku.dk` beside the global one | The product must accept a configured issuer that is not the discovery root |
| Free. An external service needs a **sponsor statement from a member institution** (KU can give one), plus client credentials from the secretariat | Cheap, but it needs KU's signature |

### Entra

No new constraints. Multi-tenant app, with a tenant allow-list enforced by us.

---

## 3. The candidates

### 3.1 Ruled out

| Product | Reason |
|---|---|
| **Firebase Auth / Identity Platform** (as the long-term answer) | **No OAuth authorization server for third parties at all**, so no MCP. Its auth data is not on Google's data-residency list, so it does not help with the KU question. PKCE and custom authorize parameters for OIDC providers are undocumented, which puts Unilogin at risk. **It is still the right tool for the Entra interim** (umbrella §15) |
| **Ory** (Hydra + Kratos) | A maintainer stated on 2026-10-26 that CIMD will be **Enterprise / Ory Network only** ([#4061](https://github.com/ory/hydra/issues/4061)). Also three services plus our own UI, and RFC 8707 is missing |
| **Zitadel** | It **accepts the `resource` parameter but ignores it**, so tokens are not audience-bound. No CIMD and no Danish UI. AGPL |
| **authentik** | No DCR or CIMD in the open-source edition. Server + worker is awkward on Cloud Run |
| **Stytch, Clerk** | **US-only hosting.** Given the open processor question, that is disqualifying. Clerk also routes enterprise SSO by email domain, which does not work for Unilogin, since it returns no email |
| **WorkOS** | No EU residency found. Every federation is a paid SSO connection ($125 a month each) |
| **Casdoor** | CIMD is a week old, and discovery advertised `private_key_jwt` before it was implemented ([#5957](https://github.com/casdoor/casdoor/issues/5957)). Too immature |

### 3.2 Shortlist

| | **Better Auth** (build on a library) | **Keycloak** (adopt a server) | **Auth0, EU region** (buy) |
|---|---|---|---|
| Licence / cost | MIT. Cloud Run cost ≈ zero at idle | Apache-2.0. **min-instances 1, ~1.3 GB JVM, plus Cloud SQL**, × 3 environments | Free up to 25k MAU. Unilogin and WAYF are modelled as *custom social connections* to stay off B2B pricing |
| MCP authorization server | `@better-auth/mcp` is built on `@better-auth/oauth-provider` and targets **MCP 2026-07-28**: RFC 9728, RFC 8707 `aud`, device grant ([docs](https://www.better-auth.com/docs/plugins/mcp)) | Present, but **experimental** behind feature flags in 26.8, across MCP 2025-06-18 to 2026-07-28 ([docs](https://www.keycloak.org/securing-apps/mcp-authz-server)) | **GA since 2026-05-06**, including CIMD ([post](https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/)) |
| CIMD | `@better-auth/cimd` (draft-02, `mcp-2026-07-28` profile). First published 2026-04; **open hardening issues from October** | Experimental since 26.6.0 (`--features=cimd`) | GA. CIMD clients cannot use shared-secret client authentication |
| Upstream Unilogin / WAYF / Entra | SSO plugin: OIDC with `client_secret_post/basic` (**enough, per §2**) plus SAML SP. **PKCE length and `acr_values` pass-through are *UNVERIFIED*** | **Best of any candidate.** It is the same product as Unilogin's broker, with every client-auth method, SAML, and identity-provider mappers | Custom social connections. **PKCE and `acr_values` pass-through are *UNVERIFIED*** |
| Isolation | Organisations, not realms. **That does not matter for us:** our realm is a separate deployment (umbrella §5) | Realms: true isolation inside one server | Tenants |
| Storage | Kysely/Drizzle/Prisma → **Postgres**. Firestore only through a **community adapter with one maintainer** and an unpinned peer dependency | Postgres only | Theirs |
| Login UI and Danish | **We write it**, so Danish/English is our own `messages/` copy. Fits the localisation rule and KU branding | Community `messages_da` plus FreeMarker themes | Hosted Universal Login. Danish is *UNVERIFIED* |
| Processor | Us, on whatever host 1.1.158 picks | Us | **Okta (US-owned), EU-hosted.** EU region confirmed only via community forum, so *UNVERIFIED* officially. **The same DPA question as Google** |
| Ops burden at 2.5 d/week | Low infrastructure, but **we own the security-sensitive code paths**, and the plugins are moving fast (CVE-2026-53512 hit the old plugins; fixed in 1.6.11) | **Medium-high:** upgrades, themes, JVM tuning, Cloud SQL | **Lowest** |
| Firestore / Sunholo one-database goal | Not maturely | No | n/a (theirs) |

Logto was a close fourth: CIMD proven against ChatGPT and Codex, RFC 8707, device grant, on node-oidc-provider. It loses on no Danish locale, Postgres only, and unverified brokering. **node-oidc-provider** itself (panva; CIMD experimental, a custom storage adapter so Firestore is possible) is the "build more of it ourselves" version of Better Auth. Keep it as a fallback only.

---

## 4. Recommendation

### 4.1 Lean: Better Auth, conditional on the spike

1. **The one blocking question resolved in its favour.** Unilogin and WAYF accept `client_secret_post`, so the SSO plugin's lack of upstream `private_key_jwt` does not matter.
2. **Its gap in realms is neutralised by our own design.** A realm is already a separate deployment with its own database and keys. We never needed isolated realms inside one instance.
3. **It has the most current MCP stack** (2026-07-28 profile, RFC 9728, RFC 8707, device grant). It is TypeScript, beside the Next.js frontend that becomes the BFF (ID-5), and it is cheap at idle on Cloud Run across three environments.
4. **Our own login UI is an advantage here.** The localisation rule and KU branding would otherwise be fought through FreeMarker themes or a hosted page.

**What it costs:** we own more security-relevant code, and its CIMD is six months old. Mitigations: pin versions, subscribe to its advisories, put it in the `make security-check` pipeline, and run the ID-11 negative tests on every upgrade.

### 4.2 Fallback: Keycloak, if the spike fails on Unilogin

**(Revised for serverless.)** Keycloak is the **not-serverless** fallback: min-instances 1 and a JVM. So exhaust the serverless routes first:

1. Better Auth's `genericOAuth` plugin instead of the SSO plugin for Unilogin.
2. A small upstream PR (PKCE verifier length and extra authorize parameters are configuration-sized changes).
3. Logto on Cloud Run with Neon. This is *UNVERIFIED* for brokering.

If none of those work, and Better Auth's SSO plugin cannot send a 128-character PKCE verifier or pass `acr_values`, **switch to Keycloak.** Patching a security plugin is not a good use of 2.5 days a week. Keycloak is guaranteed to interoperate with a Keycloak broker. Its costs are known and paid in money, not risk: about 1.3 GB, min-instances 1, and Cloud SQL per environment. Its MCP support is experimental today; re-check the flags at decision time.

A **hybrid** (Keycloak as the upstream broker only, Better Auth as the MCP authorization server) also works. It doubles the operational surface, so use it only if *both* products fail on one side each.

### 4.3 The buy option is a legal question, not a technical one

**Auth0 EU is technically the strongest and cheapest to operate:** CIMD and MCP are GA, and the free tier covers AIPLA's scale. It is not recommended because it moves teacher identity to another US-owned processor at the same moment KU is deciding whether Google may hold it. **Add one line to the 1.1.158 legal questions:** *"would a US-owned identity provider with EU-region hosting (Auth0/Okta) be acceptable for teacher sign-in where Firebase is not?"* If legal says yes, Auth0 becomes the recommendation for AIPLA, and the platform contract (umbrella §10) is unchanged, because it is standards-based.

### 4.4 Storage: serverless **Postgres**, because the goal is to be able to leave Google (revised twice on 2026-10-27)

**How this decision moved.** The first draft said "a small Postgres". M then asked for serverless, and the second draft picked Firestore through an adapter we would own. M then gave the strategy behind the request: ***auth first, as the first step off Google; hosting and databases follow as each client's requirements are scoped.*** Against that goal, Firestore is the wrong store. It is the one place auth data could sit that would have to be **migrated** later, rather than simply moved. Postgres is the database every destination already runs:

| Destination | Postgres |
|---|---|
| Google, today | Cloud SQL, or any external serverless Postgres |
| An EU cloud | Scaleway, Aiven, OVH, … |
| KU on-prem / the [1.1.158](../hosting-off-google-options.md) box | a local Postgres |

So the auth service's portability is a `pg_dump` and a connection string, not an adapter swap and a data export.

**Decision (proposed): Postgres is the auth service's only supported store. The host is chosen per deployment, serverless where possible.**

| Host | Serverless | Owner | Use |
|---|---|---|---|
| **[Scaleway Serverless SQL Database](https://www.scaleway.com/en/serverless-sql-database/)** | **Yes.** PostgreSQL-compatible; compute goes idle after 5 min and is not billed; wakes "within seconds"; storage still billed ([overview](https://www.scaleway.com/en/docs/serverless-sql-databases/reference-content/serverless-sql-databases-overview.md)) | **Scaleway, French (Iliad group)** | **Default for AIPLA.** EU-owned, so no US parent behind the processor. Region availability beyond Paris is *UNVERIFIED* |
| [Neon](https://neon.com/docs/introduction/regions) | Yes. Frankfurt `aws-eu-central-1`, London | Databricks (US) since May 2025 | Fallback. The most mature serverless Postgres, but a US-owned processor |
| Cloud SQL | No (always on) | Google | Only if a deployment is staying on Google regardless |
| Self-hosted Postgres | n/a | the operator | Off-Google boxes, KU on-prem |

**What this drops: the Firestore adapter.** It saves 2–3 days of forking and hardening, and removes a permanent upgrade obligation. Better Auth's Postgres path (Kysely, with its own migrations) is first-class. The cost is that a Sunholo app that stays on Google runs **Firestore for app data plus a small serverless Postgres for auth**, not one database. **Portability beats one database.** If a deployment that will *never* leave Google later wants auth in Firestore, the conformance-suite route (`@better-auth/test-utils`, `consumeOne`) is still open. It is not built speculatively.

**The question this raises: where does the auth *service* run?** Moving only the database off Google buys portability but no legal change. Google still processes the auth data in memory if the container runs on Cloud Run. The container image is the same either way, so it is a deploy-target choice. It is decision **D10** in the umbrella:

- **(a) Cloud Run, with the database at Scaleway.** One cloud to operate. Portable when the time comes. **No change to who processes teacher sign-in.**
- **(b) [Scaleway Serverless Containers](https://www.scaleway.com/en/serverless-containers/) + Serverless SQL, both in Paris.** Teacher sign-in **leaves Google on day one**, which materially answers 1.1.158 legal question 5. Two caveats: the app's Firestore still holds the email-keyed register and teacher uids, and scale-to-zero on Serverless Containers is *UNVERIFIED* here. The bigger point is that **this is the smallest possible pilot of the off-Google hosting the rest of the stack will need**: IaC (the Terraform Scaleway provider), deploy, secrets and monitoring on a second cloud, learned on a service with no student data. The cost is a second cloud to operate at 2.5 days a week.

**Lean: (b), if M is confident the hosting move is the direction.** It turns auth-first from a portability claim into a tested one. Otherwise take (a), and move the container when the rest of the stack moves.

**Decided 2026-10-27 (M): (a) Cloud Run first, Scaleway on the roadmap.** CPH IT may later offer a Kubernetes cluster, which becomes a third possible destination. All three run the same image, so the decision holds only if the image stays movable. That is not automatic. **A container image is portable. A service is only as portable as its least portable dependency.** The rules below keep this one movable. Spike S11 checks them before anything is registered with a federation.

### 4.5 Keeping the container movable (Cloud Run → Scaleway → a KU cluster)

| # | Rule | Why it matters to a move |
|---|---|---|
| P1 | **The issuer is a hostname we own, never the host's.** `auth.aipla.ku.dk` from the first registration. No `*.run.app` URL is ever registered with Unilogin, WAYF, Entra or an MCP client | The issuer is inside every token, every redirect URI registered at STIL and WAYF, and every resource's accepted-issuer setting. **Keep it, and a move is a DNS change. Change it, and every federation registration is redone**, at STIL's lead time. This makes the KU DNS request in track N a *prerequisite* for registering with any federation, not a tidy-up. The prod load balancer already routes by host (`infrastructure/env/loadbalancer.tf`, `host_rule` for the app and the sandbox), so the auth host is a third rule on it |
| P2 | **Signing keys live in the auth database**, not Cloud KMS. Better Auth's JWKS table stores private keys encrypted under the app secret | Keys move with `pg_dump`. A move does not force a key rotation, and tokens already issued keep verifying |
| P3 | **Config and secrets arrive as environment variables only.** The code never calls the Secret Manager API | Cloud Run injects from Secret Manager, Kubernetes from Secrets, and Scaleway from its secret store. The image does not care which |
| P4 | **The database is a plain DSN.** No Cloud SQL connector, no IAM database auth | It is Scaleway from day one anyway. The DSN is the only line that changes if the database moves |
| P5 | **Stateless.** Listens on `$PORT`, no local disk, sessions in the database, JSON logs to stdout, one health endpoint | It runs as several replicas, which a cluster will do (S9 already tests the concurrency that implies). Any log collector can read it |
| P6 | **Name the one Google tie.** The custom-token bridge (`firestore_client: custom-token`) signs Firebase custom tokens as a Google service account. On Cloud Run that is free (ADC plus `signBlob`). Anywhere else it needs a service-account key or Workload Identity Federation | It exists only while a deployment's browser reads Firestore directly. **It ends with the bridge, not with the move**, so it is a reason to finish ID-12's work, not a blocker |

**What does *not* carry over unchanged:**
- **Scale-to-zero** is a Cloud Run and Knative feature. A Cloud Run service definition is a Knative Service, so a cluster running Knative takes it nearly as is. A plain Kubernetes cluster needs a Deployment, Service, Ingress and certificate, and runs at least one replica. That is fine for a service this small.
- **Latency.** On Cloud Run in `europe-north1` with the database in Paris, every database round trip crosses Europe. S10 measures it. If sign-in is slow, run the auth service in Cloud Run's Paris region (`europe-west9`) instead. It is a separate service, so it does not have to share the app's region.

---

## 5. The spike (~2–3 days, before deciding)

Run **Better Auth first; Keycloak only if it fails.** Everything runs on dev against the **Unilogin test broker** (free, test users, no registration needed).

| # | Test | Pass condition |
|---|---|---|
| S1 | Unilogin test broker login, `client_secret_post` | Code exchange succeeds with a **128-character S256 verifier** |
| S2 | `acr_values=dk:unilogin:aktoergruppe:medarbejder` | A pupil test user is refused at the broker, or by our `aktoer_gruppe` check |
| S3 | userinfo `inst_brugere` | Name and institution are retrieved. **No email is assumed**. `(iss, sub)` is stored as the principal |
| S4 | Entra multi-tenant | A tenant not on the allow-list is refused |
| S5 | **Claude or ChatGPT as an MCP client** via CIMD against a dummy protected resource | Discovery → consent → token with `aud` = resource. A wrong-`aud` token is refused at the resource |
| S6 | Cloud Run cold start, scale-to-zero | First sign-in completes in under ~3 s from cold |
| S7 | Key rotation | Old and new keys are both in the JWKS during the overlap. A resource with a cached JWKS keeps verifying |
| S8 | Better Auth migrations against **Scaleway Serverless SQL** (a PostgreSQL-compatible proxy, so check `pg`/Kysely compatibility), with Neon as the control | Schema migrates. Sign-in, session and refresh work |
| S9 | **Concurrent use of single-use credentials:** the same OAuth code exchanged twice in parallel, and the same verification token twice | Exactly one succeeds |
| S10 | **Double cold start:** container and database both idle (Scaleway's database idles after 5 min and wakes "within seconds"). Cloud Run is in Finland and the database in Paris, so also time a *warm* sign-in | First sign-in after an hour idle completes in under ~5 s. If not, set a tiny min-scale on the *database* only, never on the container. If the warm sign-in is slow, move the auth service to `europe-west9` (§4.5) |
| S11 | **Portability, without a second cloud** (D10 = a): the same image, run with `docker run` on a laptop and no Google credentials present, against the same Scaleway database and the same issuer | Sign-in and token refresh work, and tokens issued from Cloud Run still verify. Anything that fails names a hidden Google dependency that breaks rules P1–P6 in §4.5. (Moving to Scaleway Serverless Containers is on the roadmap, not in the spike) |

**WAYF cannot be spiked** until the secretariat issues credentials. **KU will provide the sponsor statement** (confirmed by M, 2026-10-27). Request the client credentials as soon as it is signed; onboarding is free.

---

## 6. What this changes in the umbrella

- **D1** → "Better Auth, conditional on spike S1–S7. Keycloak is the fallback. Auth0 EU only if legal accepts a US-owned EU-hosted processor."
- **D6** → **answered in part:** registration needs a CVR number and MitID Erhverv. The fees are 7,500 + 7,500 DKK a year at our volume.
- **§7.1** → email confirmed absent from Unilogin, so **ID-4 is on the critical path.**
- **§7.4 / §8 / D2** → the auth store is **Postgres only, on serverless hosting**: Scaleway Serverless SQL (EU-owned) by default, Neon EU as fallback, self-hosted off Google. No Firestore adapter.
- **New D10** → where the auth *container* runs. **Decided 2026-10-27: Cloud Run first; Scaleway Serverless Containers on the roadmap; a KU Kubernetes cluster possible later.** Movability is held by the rules in §4.5 and checked by S11.
- **Track N** → three non-engineering actions: the STIL Udbyder registration (CVR, MitID Erhverv, fee), the WAYF sponsor statement from KU (**available**, per M), and the extra legal question in §4.3.
