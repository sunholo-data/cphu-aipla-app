/**
 * One identifier per frontend build (1.1.138 M0/M2).
 *
 * Used three ways, and they must agree, which is why there is one source:
 *   - Next's `generateBuildId` — the id the app router compares on every RSC
 *     response, doing a full page load when a tab's build differs from the
 *     server's;
 *   - Next's `deploymentId` — appended as `?dpl=` to every chunk and stylesheet
 *     URL and sent as `x-deployment-id` on RSC fetches, so two builds never
 *     share an asset URL (in the browser cache or the service worker's);
 *   - `NEXT_PUBLIC_BUILD_ID` — inlined into the client bundle, so a crash report
 *     says which build the crashing tab was running.
 *
 * `AIPLA_BUILD_ID` wins when the build passes one (a commit SHA or release tag
 * would be the natural value). Nothing passes it today: the frontend image is
 * built from `frontend/` with no git metadata and no SHA build-arg, and
 * `APP_VERSION` is a *runtime* env var stamped at deploy (and is just `dev` for
 * every dev build). So the fallback is generated here — the UTC build time plus
 * a short random suffix. What matters for skew detection is that two builds
 * never share an id; the timestamp also lets a log reader order builds against
 * Cloud Run revision creation times without a lookup table.
 */

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * @param {Record<string, string | undefined>} env
 * @param {Date} now
 * @param {() => number} random
 * @returns {string}
 */
export function resolveBuildId(env = process.env, now = new Date(), random = Math.random) {
  const given = (env.AIPLA_BUILD_ID ?? "").trim();
  if (SAFE_ID.test(given)) return given;
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHMMSS
  const suffix = random().toString(36).slice(2, 6).padEnd(4, "0");
  return `b${stamp}-${suffix}`;
}
