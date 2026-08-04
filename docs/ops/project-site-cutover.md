# AIPLA project-site cutover

The maintained public project content is part of this application under
`/project`. The former Quarto site at `https://www.sunholo.com/aipla/` must stay
available until the production hostname is healthy and the redirect package in
the legacy `sunholo-data/aipla` repository is explicitly enabled.

## Sources of truth

- Public copy: `frontend/content/project/**/*.md`
- Routes and navigation: `frontend/src/lib/projectContent.ts`
- Legacy URL compatibility on the app: `frontend/next.config.mjs`
- Search controls: `frontend/src/middleware.ts`, `frontend/src/app/robots.txt/route.ts`
- Sitemap: `frontend/src/app/sitemap.ts`
- Legacy redirect package: `sunholo-data/aipla`, branch prepared from
  `codex/legacy-retirement-redirects`

Run `cd frontend && npm run check:project-content` whenever public copy changes.
It checks required editorial metadata, review deadlines, internal project links,
and accidental links or secrets copied from the retired site.

## Before DNS cutover

1. Deploy and review the content on dev, where pages must return
   `X-Robots-Tag: noindex, nofollow, noarchive` and `robots.txt` must disallow
   crawling.
2. Promote the tested application image through the normal test/prod process.
3. Confirm the production load balancer address, managed certificate, and the
   final KU DNS records with the domain owner. Remove conflicting records rather
   than leaving two hosting targets active.
4. Verify that the production service recognises `aipla.ku.dk` as a custom
   domain and that redirects preserve HTTPS.

## Production acceptance

Check all of the following over HTTPS:

- `/project` and every link in project navigation;
- `/project/activities/{boldkast,led-planck,kinebot}`;
- page canonical URLs and social metadata;
- `robots.txt` allows crawling only on `aipla.ku.dk`;
- `sitemap.xml` contains the project routes;
- all lesson images return 200;
- representative legacy paths map to the intended new page;
- no browser console errors or horizontal overflow at desktop and mobile widths.

Do not retire the Quarto site merely because DNS resolves. Wait for certificate
health and application smoke checks.

## Retiring the old site

In the legacy repository, set the repository variable
`AIPLA_LEGACY_RETIREMENT=enabled` only after production acceptance, then run its
Pages workflow. Verify at least the old home, About, Strands, Examples,
Architecture, Evaluation, Self-hosting, Timeline, LED Planck, and KineBot URLs.

Keep the legacy repository and redirects for at least 12 months. To roll back,
disable or remove the variable and rerun the workflow; it will publish the full
Quarto site again.

## Ongoing editorial review

The public pages show their status, owner, and last-reviewed date. The
`reviewBy` field is deliberately enforced in CI. Time-sensitive pages—progress,
evaluation, platform, and data/hosting—should normally use shorter review
intervals than stable project background. Publish dated research snapshots
instead of silently replacing historical evaluation results.
