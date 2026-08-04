/**
 * Which deployment is this? — runtime environment identity for the UI.
 *
 * AIPLA runs three near-identical deployments whose only visible difference is
 * an opaque Cloud Run hostname (`aipla-v01-frontend-wgwhd7mspa` vs `…-y2bmxayxca`
 * vs `…-6vwz657g3a`). On 2026-08-04 a teacher minted group codes on dev and
 * typed them into test for two hours, getting a 401 on every join, because
 * group codes are Firestore documents and Firestore is per-project. The URL is
 * not a usable signal for a human, so the UI has to say it in words.
 *
 * The answer comes from the BACKEND at request time, not from a
 * `NEXT_PUBLIC_*` build arg: prod runs the byte-identical image that test
 * built (build-once artifact promotion), so anything compiled in would label
 * prod as "test". See backend/config/environment.py.
 */

export type EnvironmentName = "dev" | "test" | "prod" | "local" | "unknown";

export interface EnvironmentInfo {
  env: EnvironmentName;
  projectId: string | null;
  version: string | null;
}

const KNOWN: readonly EnvironmentName[] = [
  "dev",
  "test",
  "prod",
  "local",
  "unknown",
];

/**
 * In-flight/settled fetch, shared across every component that asks. The banner
 * mounts on every page; without this each remount would re-request.
 */
let cached: Promise<EnvironmentInfo | null> | null = null;

async function requestEnvironment(): Promise<EnvironmentInfo | null> {
  try {
    // Public endpoint — deliberately no auth header. The student join page is
    // the surface that most needs the label and nobody is signed in there.
    const res = await fetch("/api/proxy/api/environment", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<EnvironmentInfo>;
    const env = KNOWN.includes(body.env as EnvironmentName)
      ? (body.env as EnvironmentName)
      : "unknown";
    return {
      env,
      projectId: body.projectId ?? null,
      version: body.version ?? null,
    };
  } catch {
    // Unreachable backend is not "this is production" — the caller treats
    // null as "don't claim to know", and renders nothing.
    return null;
  }
}

export function fetchEnvironment(): Promise<EnvironmentInfo | null> {
  cached ??= requestEnvironment();
  return cached;
}

/** Test seam — drops the shared cache so each test starts cold. */
export function resetEnvironmentCache(): void {
  cached = null;
}

/**
 * Should the environment be called out to the user?
 *
 * Prod is the one that needs no banner: it's the real thing, and a permanent
 * strip on the site teachers actually use is noise. Everything else — including
 * `unknown` — gets labelled. `local` is excluded because LocalModeBanner
 * already says it, louder.
 */
export function shouldAnnounceEnvironment(env: EnvironmentName): boolean {
  return env === "dev" || env === "test" || env === "unknown";
}

export interface EnvironmentLabel {
  /** Short all-caps tag, e.g. "TEST". */
  tag: string;
  /** One line, Danish (student-facing surfaces are bilingual). */
  da: string;
  /** The same line in English. */
  en: string;
}

export function environmentLabel(env: EnvironmentName): EnvironmentLabel {
  switch (env) {
    case "test":
      return {
        tag: "TEST",
        da: "Testmiljø til afprøvning — koder og klasser her virker kun på denne adresse.",
        en: "Test environment — codes and classes here work only on this address.",
      };
    case "dev":
      return {
        tag: "DEV",
        da: "Udviklingsmiljø — under opbygning. Data kan blive slettet uden varsel.",
        en: "Development environment — work in progress. Data may be wiped without warning.",
      };
    // prod and local never reach the banner (shouldAnnounceEnvironment), but
    // they DO reach the wrong-site hint on the join page, which names whichever
    // site the student is on. A "prod" that fell through to the unknown label
    // would tell a student on the real site that it is unrecognised.
    case "prod":
      return {
        tag: "AIPLA",
        da: "Det rigtige AIPLA — det miljø, undervisningen kører på.",
        en: "The live AIPLA site — the environment teaching runs on.",
      };
    case "local":
      return {
        tag: "LOCAL",
        da: "Lokal udgave på din egen maskine.",
        en: "Local build running on your own machine.",
      };
    case "unknown":
    default:
      return {
        tag: "UKENDT / UNKNOWN",
        da: "Ukendt miljø — kontrollér adressen med din underviser, før du bruger det.",
        en: "Unrecognised environment — check the address with your teacher before using it.",
      };
  }
}
